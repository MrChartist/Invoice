/** R16-B1: the WIP → Disbursements view model — client / matter filters, buckets and totals, the written-off list. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { disbursementPatch, reverseDisbursementWriteOff, unrecoveredDisbursements, writeOffDisbursement } from '../src/lib/prof/ps-disb.ts';
import { disbView, writtenOff } from '../src/lib/prof/ps-disb-view.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const T = '2026-10-27';
const exp = (id: string, date: string, total: number, client: string, matter?: string): PurchaseRecord => ({
  id, kind: 'EXPENSE', vendor_name: 'Court', bill_number: id.toUpperCase(), date, category: 'Court fee', taxable: total, cgst: 0, sgst: 0, igst: 0, total, itc_eligible: false, amount_paid: total,
  ...disbursementPatch({ date, itc_eligible: false }, 'court_fee', client, { matterId: matter }),
} as PurchaseRecord);
const none = () => false;

test('filters by client and matter; buckets 0–30 / 31–60 / 61–90 / 90+ and the total follow the filter', () => {
  purchasesDb.save(exp('a', '2026-08-18', 2500, 'c1', 'm1')); // 70 days
  purchasesDb.save(exp('b', '2026-10-20', 1000, 'c1', 'm2')); // 7 days
  purchasesDb.save(exp('c', '2026-06-01', 400, 'c2')); // 148 days
  const rows = unrecoveredDisbursements(purchasesDb.all(), none, T);
  const all = disbView(rows);
  assert.deepEqual([all.buckets, all.total], [[1000, 0, 2500, 400], 3900]);
  const c1 = disbView(rows, { client: 'c1' });
  assert.deepEqual([c1.rows.map((r) => r.id), c1.buckets, c1.total], [['a', 'b'], [1000, 0, 2500, 0], 3500]);
  const m1 = disbView(rows, { client: 'c1', matter: 'm1' });
  assert.deepEqual([m1.rows.map((r) => r.id), m1.total], [['a'], 2500]);
  assert.deepEqual(disbView(rows, { client: 'nobody' }), { rows: [], buckets: [0, 0, 0, 0], total: 0 });
});

test('a write-off leaves the open list for the written-off list (with its stamp); reverse brings it back', () => {
  purchasesDb.save(exp('a', '2026-08-18', 2500, 'c1'));
  purchasesDb.save(exp('b', '2026-10-20', 1000, 'c2'));
  writeOffDisbursement('a', T, 'Client absconded', 'Owner');
  assert.deepEqual(disbView(unrecoveredDisbursements(purchasesDb.all(), none, T)).rows.map((r) => r.id), ['b']);
  const off = writtenOff(purchasesDb.all(), none, T);
  assert.deepEqual(off.map((r) => [r.id, r.amount, r.age, r.wo.reason, r.wo.by]), [['a', 2500, 70, 'Client absconded', 'Owner']]);
  assert.deepEqual(writtenOff(purchasesDb.all(), none, T, { client: 'c2' }), []);
  assert.deepEqual(writtenOff(purchasesDb.all(), (id) => id === 'a', T), [], 'billed later: neither list');
  reverseDisbursementWriteOff('a');
  assert.equal(writtenOff(purchasesDb.all(), none, T).length, 0);
  assert.equal(disbView(unrecoveredDisbursements(purchasesDb.all(), none, T)).total, 3500);
});
