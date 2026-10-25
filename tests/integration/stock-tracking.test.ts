/**
 * Batches, godowns and serials end to end through storage: a batch bill + FEFO sale through the
 * store, transfer vouchers (FY numbering, period lock, audit), backup round-trip of the new tables,
 * and the double-entry ledger / Books never posting a stock transfer.
 */
import '../helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, freezeDate, resetStorage, thawDate } from '../helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { DB_PREFIX } from '../../src/lib/storage.ts';
import { blankStockItem, stockDb, loadPositions } from '../../src/lib/inventory.ts';
import { computePurchaseTotals, purchasesDb } from '../../src/lib/purchases.ts';
import { godownsDb, transfersDb } from '../../src/lib/godowns.ts';
import {
  editorStockContext, fefoBatch, liveDocTrackingIssues, loadTracking, lookupSerial, serialsInStock,
} from '../../src/lib/stock-tracking.ts';
import { clearOverrides, isPeriodLockedError } from '../../src/lib/period-lock.ts';
import { audit } from '../../src/lib/audit.ts';
import { applyBackup, buildBackup, parseBackup, validateBackupData, wipeAppData } from '../../src/lib/backup.ts';
import { buildVouchers, loadBooksData } from '../../src/lib/books.ts';
import { createCreditNote } from '../../src/lib/documents.ts';
import { DEVICE_LOCAL_KEYS } from '../../src/lib/auth.ts';
import type { PurchaseLine } from '../../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => thawDate());

function saveBill(number: string, date: string, lines: PurchaseLine[]) {
  const t = computePurchaseTotals(lines, { placeOfSupply: '27', businessState: '27' });
  return purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Mumbai Pharma', bill_number: number, date, category: 'Purchases', lines,
    taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, itc_eligible: true, total: t.total, amount_paid: 0,
  });
}

function setup() {
  stockDb.saveItem(blankStockItem({ id: 'syr', name: 'Cough Syrup', hsn: '3004', track_batches: true }));
  stockDb.saveItem(blankStockItem({ id: 'ph', name: 'Phone X', hsn: '8517', track_serials: true, warranty_months: 12 }));
  saveBill('MP/1', '2026-03-05', [
    { id: 'a', name: 'Cough Syrup', hsn: '3004', quantity: 10, rate: 50, tax_rate: 12, batch_no: 'LATE', expiry_date: '2027-03-31' },
    { id: 'b', name: 'Cough Syrup', hsn: '3004', quantity: 5, rate: 50, tax_rate: 12, batch_no: 'SOON', expiry_date: '2026-07-31', mfg_date: '2025-08-01' },
    { id: 'c', name: 'Phone X', hsn: '8517', quantity: 2, rate: 10000, tax_rate: 18, serials: ['IMEI111', 'IMEI222'] },
  ]);
}

test('a batch bought with an expiry is sold FEFO through the editor flow; serial sale + credit note', () => {
  setup();
  const ctx = editorStockContext({ doc_type: 'INVOICE', issue_date: '2026-05-10' })!;
  assert.ok(ctx, 'tracked items give the editor a picker context');
  const syrup = ctx.find('cough syrup', '3004')!;
  const fefo = fefoBatch(ctx.tracking.get(syrup.id), ctx.day);
  assert.equal(fefo?.batch, 'SOON');

  const inv = createViaStore({ date: '2026-05-10', client: clientMH, lines: [{ name: 'Cough Syrup', qty: 3, rate: 80, tax: 12 }] });
  const items = inv.items.map((i) => ({ ...i, hsn: '3004', batch_no: fefo!.batch, batch_expiry: fefo!.expiry }));
  assert.deepEqual(liveDocTrackingIssues({ ...inv, items }).errors, []);
  localDb.invoices.save({ ...inv, items });
  const soon = loadTracking().get('syr')!.batches.find((b) => b.batch === 'SOON')!;
  assert.equal(soon.qty, 2);

  // Serial sale and return.
  const sale = createViaStore({ date: '2026-05-10', client: clientMH, lines: [{ name: 'Phone X', qty: 1, rate: 15000, tax: 18 }] });
  const phoneItems = sale.items.map((i) => ({ ...i, hsn: '8517', serials: ['IMEI111'], warranty_months: 12 }));
  assert.deepEqual(liveDocTrackingIssues({ ...sale, items: phoneItems }).errors, []);
  const saved = localDb.invoices.save({ ...sale, items: phoneItems });
  assert.deepEqual(serialsInStock(loadTracking().get('ph')), ['IMEI222']);
  const again = liveDocTrackingIssues({ doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-11', items: phoneItems });
  assert.match(again.errors[0], /not in stock/);
  const hit = lookupSerial(loadTracking(), 'imei111', '2026-05-12')[0];
  assert.deepEqual([hit.received?.refNumber, hit.sale?.refNumber, hit.sale?.party, hit.warranty], ['MP/1', saved.invoice_number, clientMH.name, 'active']);

  createCreditNote(saved, { lines: [{ itemId: saved.items[0].id, quantity: 1 }], reason: 'Sales return' });
  assert.deepEqual(serialsInStock(loadTracking().get('ph')), ['IMEI111', 'IMEI222'], 'the credit note puts the serial back');
  // Costing is unchanged by tracking: 15 bought − 3 sold.
  assert.equal(loadPositions().find((p) => p.item.id === 'syr')!.qty, 12);
});

test('godowns appear only after a second one is created; transfers move stock and are numbered per FY', () => {
  setup();
  assert.equal(godownsDb.isMulti(), false);
  const shop = godownsDb.save({ name: 'Shop' });
  assert.equal(godownsDb.isMulti(), true);
  assert.throws(() => godownsDb.save({ name: 'shop' }), /already exists/);

  const t1 = transfersDb.save({ date: '2026-03-31', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'x', item_id: 'syr', qty: 4, batch_no: 'LATE' }] });
  const t2 = transfersDb.save({ date: '2026-04-01', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'y', item_id: 'ph', qty: 1, serials: ['IMEI222'] }] });
  const t3 = transfersDb.save({ date: '2026-04-02', from_godown: shop.id, to_godown: 'main', lines: [{ id: 'z', item_id: 'syr', qty: 1, batch_no: 'LATE' }] });
  assert.deepEqual([t1.transfer_number, t2.transfer_number, t3.transfer_number], ['STR/FY25-26/0001', 'STR/FY26-27/0001', 'STR/FY26-27/0002']);

  const tr = loadTracking();
  assert.deepEqual(tr.get('syr')!.byGodown, { main: 12, [shop.id]: 3 });
  assert.deepEqual(serialsInStock(tr.get('ph'), shop.id), ['IMEI222']);
  // Deleting never reuses a number — not even the latest one (series high-water mark).
  transfersDb.remove(t3.id);
  assert.equal(transfersDb.nextNumber('2026-05-01'), 'STR/FY26-27/0003');
  assert.equal(transfersDb.save({ date: '2026-05-01', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'q', item_id: 'syr', qty: 1, batch_no: 'SOON' }] }).transfer_number, 'STR/FY26-27/0003');
  // In use → cannot delete.
  assert.throws(() => godownsDb.remove(shop.id, true), /cannot be deleted/);
  // Audited.
  const rows = audit.all().filter((r) => r.entity === 'stock_transfer');
  assert.deepEqual(rows.map((r) => r.action).sort(), ['create', 'create', 'create', 'create', 'delete']);
  assert.ok(rows.some((r) => r.doc_number === 'STR/FY25-26/0001'));
});

test('transfers respect the period lock', () => {
  setup();
  const shop = godownsDb.save({ name: 'Shop' });
  const t = transfersDb.save({ date: '2026-03-20', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'x', item_id: 'syr', qty: 1 }] });
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-03-31' });
  assert.throws(
    () => transfersDb.save({ date: '2026-03-25', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'x', item_id: 'syr', qty: 1 }] }),
    (e: unknown) => isPeriodLockedError(e),
  );
  assert.throws(() => transfersDb.remove(t.id), (e: unknown) => isPeriodLockedError(e));
  assert.throws(() => transfersDb.save({ ...t, date: '2026-04-05' }), (e: unknown) => isPeriodLockedError(e), 'moving a locked transfer out is an edit of a locked one');
  assert.equal(transfersDb.save({ date: '2026-04-05', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'y', item_id: 'syr', qty: 1 }] }).transfer_number, 'STR/FY26-27/0001');
});

test('a stock transfer never posts to Books or the double-entry ledger', async () => {
  setup();
  const { buildLedger } = await import('../../src/lib/ledger/index.ts');
  const data = loadBooksData();
  const before = buildLedger({ ...data, userAccounts: [], manual: [], assets: [], today: '2026-06-30' });
  const booksBefore = buildVouchers(data);
  const shop = godownsDb.save({ name: 'Shop' });
  transfersDb.save({ date: '2026-05-01', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'x', item_id: 'syr', qty: 5, batch_no: 'LATE' }] });
  const after = buildLedger({ ...loadBooksData(), userAccounts: [], manual: [], assets: [], today: '2026-06-30' });
  assert.deepEqual(after.vouchers, before.vouchers, 'no ledger voucher for a transfer');
  assert.deepEqual(buildVouchers(loadBooksData()), booksBefore, 'no Books voucher for a transfer');
  // Company-wide quantity and value are unchanged.
  const pos = loadPositions().find((p) => p.item.id === 'syr')!;
  assert.deepEqual([pos.qty, pos.value], [15, 750]);
});

test('godowns and stock transfers survive backup → wipe → restore', () => {
  setup();
  const shop = godownsDb.save({ name: 'Shop', address: 'Dadar' });
  transfersDb.save({ date: '2026-05-01', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'x', item_id: 'ph', qty: 1, serials: ['IMEI111'] }] });
  const keep = (snap: Record<string, string>) =>
    Object.fromEntries(Object.entries(snap).filter(([k]) => k.startsWith(DB_PREFIX) && !DEVICE_LOCAL_KEYS.includes(k) && k !== `${DB_PREFIX}audit_log`));
  const before = keep(dumpStorage());
  for (const t of ['godowns', 'stock_transfers', 'stock_items', 'purchases']) assert.ok(before[DB_PREFIX + t], `fixture populates ${t}`);
  const file = JSON.stringify(buildBackup(new Date('2026-05-10T10:00:00Z')));
  wipeAppData();
  const { data } = parseBackup(file);
  applyBackup(data);
  assert.deepEqual(keep(dumpStorage()), before);
  assert.deepEqual(serialsInStock(loadTracking().get('ph'), shop.id), ['IMEI111']);
  // A damaged transfers table is refused before anything is written.
  assert.throws(() => validateBackupData({ [`${DB_PREFIX}stock_transfers`]: '[{"date":"2026-05-01"}]' }), /stock_transfers/);
});
