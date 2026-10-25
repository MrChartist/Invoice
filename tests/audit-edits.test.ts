/**
 * WP-7 P0-10: the MCA edit log covers every books table. Direct table writers (purchases, vendors,
 * supplier payments…) are logged row by row with before → after; module rows (vouchers, accounts)
 * gain the field-level changes instead of a second row; bulk writes become one summary row; private
 * fields are only flagged; the chain still verifies; archive segments travel in backups, not sync.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { audit, AUDIT_TABLE } from '../src/lib/audit.ts';
import { BULK_DETAIL, drainEdits, genericChanges, resetEditTracker, WATCHED_TABLES } from '../src/lib/audit-edits.ts';
import { verifyAuditChain } from '../src/lib/audit-chain.ts';
import { getTable, setTable, DB_PREFIX } from '../src/lib/storage.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { purchasesDb, paymentsDb } from '../src/lib/purchases.ts';
import { A, saveVoucher, deleteVoucher, saveUserAccount } from '../src/lib/ledger/index.ts';
import { buildBackup, validateBackupData } from '../src/lib/backup.ts';
import { isSyncedKey } from '../src/lib/sync-engine.ts';
import type { AuditEntry } from '../src/types/audit.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  resetEditTracker();
});

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const rowsFor = (id: string) => audit.all().filter((r) => r.entity_id === id);

function bill(over: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'id'> {
  return {
    kind: 'BILL', vendor_name: 'Sharma Supplies', bill_number: 'S-1', date: '2025-05-10', category: 'Goods',
    lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0,
    status: 'Unpaid', created_at: '2025-05-10T00:00:00.000Z',
    ...over,
  } as unknown as Omit<PurchaseRecord, 'id'>;
}

test('a supplier saved straight to its table is logged: create, edit with before → after, delete', async () => {
  const v = vendorsDb.save({ name: 'Sharma Supplies', email: 'a@b.example' });
  await tick();
  vendorsDb.save({ ...v, gstin: '29BBBCS5678B1Z4', email: 'new@b.example' });
  await tick();
  vendorsDb.remove(v.id);
  await tick();
  const rows = rowsFor(v.id);
  assert.deepEqual(rows.map((r) => [r.entity, r.action]).reverse(), [['vendor', 'create'], ['vendor', 'update'], ['vendor', 'delete']]);
  const edit = rows.find((r) => r.action === 'update')!;
  assert.match(edit.summary, /^Supplier Sharma Supplies edited: /);
  assert.ok(edit.changes?.some((c) => c.field === 'Gstin' && c.from === null && c.to === '29BBBCS5678B1Z4'));
  const email = edit.changes?.find((c) => c.field === 'Email');
  assert.deepEqual([email?.from, email?.to], ['(hidden)', '(changed)'], 'contact details are never copied');
  assert.ok(!JSON.stringify(rows).includes('new@b.example'));
});

test('purchase bills and supplier payments (no module logging before WP-7) are in the edit log', async () => {
  const b = purchasesDb.save(bill());
  await tick();
  purchasesDb.save({ ...b, total: 1300, taxable: 1100 });
  await tick();
  paymentsDb.record(b.id, { amount: 500, date: '2025-05-20', method: 'NEFT' });
  await tick();
  const billRows = rowsFor(b.id);
  assert.ok(billRows.some((r) => r.entity === 'purchase' && r.action === 'create' && r.doc_number === 'S-1'));
  const edit = billRows.find((r) => r.action === 'update' && r.changes?.some((c) => c.field === 'Total'))!;
  assert.deepEqual(edit.changes!.find((c) => c.field === 'Total'), { field: 'Total', from: '1180', to: '1300' });
  const pay = audit.all().find((r) => r.entity === 'purchase_payment')!;
  assert.equal(pay.action, 'create');
  assert.ok(pay.changes?.some((c) => c.field === 'Amount' && c.to === '500'));
});

test('a module row (voucher edit) carries the field-level changes; no second row is written', async () => {
  const v = saveVoucher({ type: 'JOURNAL', date: '2025-05-01', narration: 'Accrual', lines: [{ account_id: A.rent, dr: 10000, cr: 0 }, { account_id: A.provisions, dr: 0, cr: 10000 }] });
  await tick();
  saveVoucher({ ...v, narration: 'Accrual for May', lines: [{ account_id: A.rent, dr: 12000, cr: 0 }, { account_id: A.provisions, dr: 0, cr: 12000 }] });
  await tick();
  deleteVoucher(v.id);
  await tick();
  const rows = rowsFor(v.id);
  assert.equal(rows.length, 3, 'one row per change, written by vouchers.ts');
  const edit = rows.find((r) => r.action === 'update')!;
  assert.match(edit.summary, /^Edited journal voucher/);
  assert.deepEqual(edit.changes!.find((c) => c.field === 'Narration'), { field: 'Narration', from: 'Accrual', to: 'Accrual for May' });
  const lines = edit.changes!.find((c) => c.field === 'Lines')!;
  assert.match(lines.from!, /rent Dr 100\.00/);
  assert.match(lines.to!, /rent Dr 120\.00/);
  const del = rows.find((r) => r.action === 'delete')!;
  assert.ok(del.changes?.some((c) => c.field === 'Lines' && c.to === null), 'before values of a deleted voucher are kept');
});

test('a chart account created through saveUserAccount is one row with its fields', async () => {
  const a = saveUserAccount({ code: 'X1', name: 'Stationery', group: 'INDIRECT_EXPENSES' });
  await tick();
  const rows = rowsFor(a.id);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].changes?.some((c) => c.field === 'Name' && c.to === 'Stationery'));
});

test(`a bulk write of more than ${BULK_DETAIL} rows is one summary row, never silent`, async () => {
  const rows = Array.from({ length: BULK_DETAIL + 5 }, (_, i) => ({ id: `st${i}`, name: `Item ${i}`, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }));
  setTable('stock_items', rows);
  await tick();
  const sum = audit.all().filter((r) => r.entity_id === 'stock_items');
  assert.equal(sum.length, 1);
  assert.match(sum[0].summary, /Stock items changed in one save: 45 added, 0 altered, 0 removed/);
});

test('the chain verifies with tracked rows; audit tables themselves are never tracked', async () => {
  vendorsDb.save({ name: 'A' });
  vendorsDb.save({ name: 'B' });
  drainEdits();
  await tick();
  const log = getTable<AuditEntry>(AUDIT_TABLE);
  assert.equal(log.length, 2);
  assert.equal(verifyAuditChain(log).ok, true);
  assert.ok(!(AUDIT_TABLE in WATCHED_TABLES));
  assert.ok(!('invoices' in WATCHED_TABLES), 'documents are logged by localDb with their own diff');
});

test('genericChanges: create / delete show key fields only; unchanged rows give nothing', () => {
  assert.deepEqual(genericChanges({ a: 1, updated_at: 'x' }, { a: 1, updated_at: 'y' }), []);
  const c = genericChanges(null, { id: 'z', name: 'N', date: '2025-04-01', secret_blob: 'x'.repeat(500) });
  assert.deepEqual(c, [{ field: 'Name', from: null, to: 'N' }, { field: 'Date', from: null, to: '2025-04-01' }]);
});

test('archive segments ride in backups (validated) and stay out of folder sync', () => {
  setTable('audit_archive_0001', [{ id: 'a', at: 'x', entity: 'system', entity_id: 'x', action: 'update', summary: 's' }]);
  const b = buildBackup();
  assert.ok(`${DB_PREFIX}audit_archive_0001` in b.data);
  validateBackupData(b.data);
  assert.throws(() => validateBackupData({ ...b.data, [`${DB_PREFIX}audit_archive_0002`]: '{"not":"a list"}' }), /audit archive/);
  assert.equal(isSyncedKey(`${DB_PREFIX}audit_archive_0001`), false);
  assert.equal(isSyncedKey(`${DB_PREFIX}vouchers`), true);
});
