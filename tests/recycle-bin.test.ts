/**
 * R4-C4 recycle bin: capture on delete (bill, voucher, client, stock item, invoice + its receipts), numbers never
 * reused, restore through the save paths (lock refusal, reused number, parent missing → restore both), purge by age /
 * size (audited), payroll privacy, backed up but never synced.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { DB_PREFIX, SINGLETON_KEYS, getTable, peekTable, setJson, setTable } from '../src/lib/storage.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { A, deleteVoucher, saveVoucher } from '../src/lib/ledger/index.ts';
import { audit } from '../src/lib/audit.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';
import { buildBackup, validateBackupData } from '../src/lib/backup.ts';
import { isSyncedKey } from '../src/lib/sync-engine.ts';
import {
  BIN_TABLE, RestoreError, deleteForGood, describeEntry, planPurge, planRestore, purgeBin, restoreEntry, setBinRetentionDays, visibleEntries,
} from '../src/lib/trust/recycle-bin.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';

beforeEach(() => {
  resetStorage();
  setActorProvider(null);
});

const bin = () => getTable<BinEntry>(BIN_TABLE);
const entry = (table: string) => bin().find((e) => e.table === table)!;

test('every delete of an edit-logged table keeps the whole row: bill, voucher, client, stock item', () => {
  const p = purchasesDb.save({ kind: 'PURCHASE', vendor_name: 'Sharma Supplies', bill_number: 'S-1', date: '2026-05-10', category: 'Goods', lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0 });
  purchasesDb.remove(p.id);
  const v = saveVoucher({ type: 'JOURNAL', date: '2026-05-11', narration: 'rent', lines: [{ account_id: A.rent, dr: 1000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 1000 }] });
  deleteVoucher(v.id);
  const cid = localDb.clients.upsert({ name: 'Acme Traders', gstin: '27AAPFU0939F1ZV' } as never);
  localDb.clients.remove(String(cid));
  stockDb.saveItem({ id: 's1', name: 'Paper ream', unit: 'NOS', track_stock: true, opening_qty: 5, opening_rate: 100, reorder_level: 0 } as never);
  stockDb.deleteItem('s1');
  assert.deepEqual(bin().map((e) => e.table).sort(), ['clients', 'purchases', 'stock_items', 'vouchers']);
  assert.equal((entry('purchases').row as { bill_number: string }).bill_number, 'S-1');
  const dv = describeEntry(entry('vouchers'));
  assert.deepEqual([dv.label, dv.number, dv.day], ['Voucher', v.number, '2026-05-11']);
  assert.equal(describeEntry(entry('clients')).name, 'Acme Traders');
});

test('an invoice and its receipts go to the bin; the deleted number is never handed out again', () => {
  installSettings();
  const a = createViaStore({ date: '2026-05-10', lines: [{ qty: 1, rate: 100 }] });
  const b = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  localDb.payments.record({ invoiceId: b.id, amount: 50, method: 'UPI', date: '2026-05-12' });
  localDb.invoices.remove(b.id);
  assert.deepEqual(bin().map((e) => e.table).sort(), ['invoices', 'transactions']);
  assert.equal(describeEntry(entry('invoices')).number, b.invoice_number);
  const next = localDb.invoices.nextNumber('2026-05-20');
  assert.notEqual(next, b.invoice_number, 'the binned number stays reserved');
  assert.ok(next > b.invoice_number && a.invoice_number < b.invoice_number);
});

test('restore: parent missing → refused, offered as one action; both come back consistent and audited', () => {
  installSettings();
  const b = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  localDb.payments.record({ invoiceId: b.id, amount: 50, method: 'UPI', date: '2026-05-12' });
  localDb.invoices.remove(b.id);
  const pay = entry('transactions');
  const plan = planRestore(pay, (t) => peekTable(t), bin());
  assert.equal(plan.refusal, 'parentMissing');
  assert.equal(plan.parentEntry?.table, 'invoices');
  assert.throws(() => restoreEntry(pay.id), (e) => e instanceof RestoreError && e.refusal === 'parentMissing');
  const back = restoreEntry(pay.id, { withParent: true });
  assert.deepEqual(back.map((e) => e.table), ['invoices', 'transactions']);
  const inv = localDb.invoices.getById(b.id)!;
  assert.equal(inv.invoice_number, b.invoice_number, 'same number');
  assert.equal(inv.amount_paid, 50);
  assert.equal(localDb.payments.listFor(b.id).length, 1);
  assert.equal(bin().length, 0);
  const rows = audit.all().filter((r) => r.action === 'restore');
  assert.equal(rows.length, 2);
  assert.match(rows[0].summary, /from the recycle bin \(bin /);
});

test('restore: the invoice brings back the receipts deleted with it; a live row already holding the id or number refuses', () => {
  installSettings();
  const b = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  localDb.payments.record({ invoiceId: b.id, amount: b.total, method: 'UPI', date: '2026-05-12' });
  localDb.invoices.remove(b.id);
  const inv = entry('invoices');
  assert.equal(planRestore(inv, (t) => peekTable(t), bin()).children.length, 1);
  // Someone typed the same number by hand meanwhile.
  setTable('invoices', [...getTable('invoices'), { id: 'other', invoice_number: b.invoice_number, doc_type: 'INVOICE', issue_date: '2026-05-11', status: 'Draft' }]);
  assert.throws(() => restoreEntry(inv.id), (e) => e instanceof RestoreError && e.refusal === 'numberReused' && /has been reused/.test(e.message));
  setTable('invoices', getTable<{ id: string }>('invoices').filter((i) => i.id !== 'other'));
  restoreEntry(inv.id, { withChildren: true });
  assert.equal(localDb.invoices.getById(b.id)?.status, 'Paid');
  assert.equal(localDb.payments.listFor(b.id).length, 1);
  assert.throws(() => restoreEntry(inv.id), /no longer in the bin/);
});

test('restore into a locked period is refused by the save path (PIN override as usual)', () => {
  installSettings();
  const b = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  localDb.invoices.remove(b.id);
  setJson(SINGLETON_KEYS.settings, { ...localDb.settings.get(), lock_until: '2026-05-31' });
  const e = entry('invoices');
  assert.equal(planRestore(e, (t) => peekTable(t), bin()).refusal, 'locked');
  assert.throws(() => restoreEntry(e.id), (err) => isPeriodLockedError(err));
  assert.equal(bin().length, 1, 'still in the bin');
});

test('purge: entries older than the retention go, then the oldest until the bin fits the cap; audited', () => {
  const at = (d: string, n = 10): BinEntry => ({ id: d, table: 'clients', row_id: d, deleted_at: `${d}T00:00:00.000Z`, row: { id: d, name: 'x'.repeat(n) } });
  const now = new Date('2026-06-30T00:00:00Z');
  const { keep, purged } = planPurge([at('2026-05-01'), at('2026-06-20'), at('2026-06-25')], now, 30);
  assert.deepEqual([keep.map((e) => e.id), purged.map((e) => e.id)], [['2026-06-20', '2026-06-25'], ['2026-05-01']]);
  const big = planPurge([at('2026-06-20', 400), at('2026-06-25', 400)], now, 30, 600);
  assert.deepEqual([big.keep.map((e) => e.id), big.purged.map((e) => e.id)], [['2026-06-25'], ['2026-06-20']]);
  setTable(BIN_TABLE, [at('2026-05-01'), at('2026-06-25')]);
  assert.equal(purgeBin(now), 1);
  assert.deepEqual(bin().map((e) => e.id), ['2026-06-25']);
  assert.ok(audit.all().some((r) => r.entity_id === BIN_TABLE && /removed for good/.test(r.summary)));
  setBinRetentionDays(90);
  assert.throws(() => setBinRetentionDays(3), /binDaysRange/);
});

test('privacy: payroll rows only with payroll.view; clerks see their own deletes, the owner all; delete for good is owner-only and audited', () => {
  const e = (id: string, table: string, by?: string): BinEntry => ({ id, table, row_id: id, deleted_at: '2026-06-01T00:00:00Z', ...(by ? { deleted_by: by } : {}), row: { id } });
  const list = [e('1', 'employees', 'Asha'), e('2', 'clients', 'Asha'), e('3', 'clients', 'Ravi')];
  assert.deepEqual(visibleEntries(list, { all: true, payroll: true }).map((x) => x.id), ['1', '2', '3']);
  assert.deepEqual(visibleEntries(list, { all: true, payroll: false }).map((x) => x.id), ['2', '3']);
  assert.deepEqual(visibleEntries(list, { all: false, name: 'Asha', payroll: false }).map((x) => x.id), ['2']);
  setTable(BIN_TABLE, list);
  setActorProvider(() => ({ id: 'u', name: 'Asha', role: 'clerk' }));
  assert.throws(() => deleteForGood(['2']));
  setActorProvider(null);
  assert.equal(deleteForGood(['2']), 1);
  assert.ok(audit.all().some((r) => /Deleted for good from the recycle bin/.test(r.summary)));
});

test('an unnumbered batch / recurring draft (QA5-2) is binned and restored without a number and reserves none', () => {
  installSettings();
  const d = localDb.invoices.save({ ...localDb.invoices.getById(createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] }).id)!, id: 'draft-1', invoice_number: '', status: 'Draft', batch_run_id: 'run1' } as never);
  assert.equal(d.invoice_number, '', 'unnumbered until issued');
  const seriesBefore = JSON.stringify(getTable('series_counters'));
  localDb.invoices.remove('draft-1');
  const e = bin().find((x) => x.row_id === 'draft-1')!;
  assert.equal(describeEntry(e).number, '');
  assert.equal(JSON.stringify(getTable('series_counters')), seriesBefore, 'no number reserved');
  assert.equal(planRestore(e, (t) => peekTable(t), bin()).ok, true);
  restoreEntry(e.id);
  const back = localDb.invoices.getById('draft-1')!;
  assert.deepEqual([back.status, back.invoice_number], ['Draft', '']);
});

test('a gift-voucher receipt (R4-B) comes back from the bin with its gift_voucher_id', async () => {
  installSettings();
  const { giftVouchersDb } = await import('../src/lib/retail/gift-vouchers.ts');
  // QA6-1 F1: the voucher must exist and still have the balance (the restore re-checks it).
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 100, issued_on: '2026-05-01', method: 'Cash' }).vouchers;
  const b = createViaStore({ date: '2026-05-11', lines: [{ qty: 1, rate: 200 }] });
  setTable('transactions', [...getTable('transactions'), { id: 'gvp', invoice_id: b.id, amount: 20, method: 'Gift voucher', date: '2026-05-11', gift_voucher_id: gv.id }]);
  setTable('transactions', getTable<{ id: string }>('transactions').filter((t) => t.id !== 'gvp'));
  const e = entry('transactions');
  assert.equal((e.row as { gift_voucher_id?: string }).gift_voucher_id, gv.id);
  restoreEntry(e.id);
  assert.equal(getTable<{ id: string; gift_voucher_id?: string }>('transactions').find((t) => t.id === 'gvp')?.gift_voucher_id, gv.id);
});

test('the bin is backed up but never synced', () => {
  setTable(BIN_TABLE, [{ id: 'b', table: 'clients', row_id: 'c', deleted_at: '2026-06-01T00:00:00Z', row: { id: 'c' } }]);
  assert.equal(isSyncedKey(`${DB_PREFIX}recycle_bin`), false);
  assert.equal(isSyncedKey(`${DB_PREFIX}export_irms`), true);
  const file = buildBackup();
  assert.ok(file.data[`${DB_PREFIX}recycle_bin`]);
  validateBackupData(file.data);
});
