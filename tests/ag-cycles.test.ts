/**
 * AG-A4 cycles: periods by length; one purchases row per cycle; Σ lines = purchase total; feed set-off receipts carry
 * `exchange_purchase_id` (cash readers skip them); the journal balances; negative net carries forward; bank file rows;
 * Rule 6DD(e) only for agriculturists; reopen deletes the cycle's documents through their guards.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { purchasesDb, paymentsDb } from '../src/lib/purchases.ts';
import { cycleUploadRows } from '../src/lib/bank-upload.ts';
import { cashPaymentIssue } from '../src/lib/retail/rt-cash-guard.ts';
import { saveFarmer } from '../src/lib/agri/ag-farmers.ts';
import { carriedIn, cyclePeriod, cycleTotals, inputDeductions, lineNet } from '../src/lib/agri/ag-cycles.ts';
import { closeCycle, loadCycles, payCycle, reopenCycle, saveCycleDraft } from '../src/lib/agri/ag-cycle-post.ts';
import { isCultivatorPayee } from '../src/lib/agri/ag-cash.ts';
import type { Payment } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('periods by length (local days)', () => {
  assert.deepEqual(cyclePeriod('2026-10-15', { length: '10day' }), { from: '2026-10-11', to: '2026-10-20' });
  assert.deepEqual(cyclePeriod('2026-02-25', { length: '10day' }), { from: '2026-02-21', to: '2026-02-28' });
  assert.deepEqual(cyclePeriod('2026-10-16', { length: 'fortnight' }), { from: '2026-10-16', to: '2026-10-31' });
  assert.deepEqual(cyclePeriod('2026-10-28', { length: 'weekly', start_day: 0 }), { from: '2026-10-26', to: '2026-11-01' }, 'Monday start');
  assert.deepEqual(cyclePeriod('2026-04-30', { length: 'monthly' }), { from: '2026-04-01', to: '2026-04-30' });
});

test('net never below zero; the excess carries to the next cycle', () => {
  assert.deepEqual(lineNet({ amount: 1000, deductions: [{ kind: 'advance', amount: 1300 }] }), { raw: -300, net: 0, carry_out: -300 });
  const c = [{ id: 'a', number: 'CYB/FY26-27/0001', period_from: '2026-10-01', period_to: '2026-10-10', source: 'milk' as const, status: 'closed' as const, lines: [{ farmer_id: 'f', qty: 1, unit: 'L', amount: 1, deductions: [], net: 0, carry_out: -300 }] }];
  assert.equal(carriedIn(c, undefined, '2026-10-11').get('f'), -300);
});

test('close → one purchase, feed set-off receipt (no cash), balanced journal; pay; reopen', () => {
  const ram = saveFarmer({ name: 'Ram', ag: { code: 'F-0001', bank: { account: '1234567890', ifsc: 'SBIN0001234' } } });
  const sita = saveFarmer({ name: 'Sita', ag: { code: 'F-0002' } });
  const client = { ...clientMH, id: 'c-ram', name: 'Ram', ag: { code: 'F-0001' } };
  const feed = createViaStore({ client, date: '2026-10-05', lines: [{ name: 'Cattle feed', qty: 2, rate: 500, tax: 0, hsn: '2309' }] });
  const ded = inputDeductions('F-0001', [client], getTable('invoices'), [], 5000);
  assert.deepEqual(ded.map((d) => [d.kind, d.ref_id, d.amount]), [['input', feed.id, 1000]]);
  const draft = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 100, unit: 'KG', amount: 5000, deductions: [...ded, { kind: 'share', amount: 50 }], net: 0, mode: 'bank' },
    { farmer_id: sita.id, name: 'Sita', qty: 40, unit: 'KG', amount: 2000, deductions: [], net: 0, mode: 'cash' },
  ] });
  assert.equal(draft.number, 'CYB/FY26-27/0001');
  const closed = closeCycle(draft.id, 'Rampur');
  const bills = getTable<{ ag?: { cycle_id?: string }; total: number; amount_paid: number; vendor_name: string }>('purchases').filter((p) => p.ag?.cycle_id === draft.id);
  assert.equal(bills.length, 1, 'one purchases row per cycle');
  assert.equal(bills[0].total, 7000, 'Σ lines = purchase total');
  assert.equal(bills[0].amount_paid, 1050, 'deductions rolled into amount_paid');
  assert.equal(bills[0].vendor_name, 'Farmers — Rampur');
  const r = getTable<Payment>('transactions').find((p) => p.invoice_id === feed.id)!;
  assert.equal(r.exchange_purchase_id, closed.purchase_id);
  assert.ok(movedNoCash(r), 'cash readers skip the set-off');
  const jv = loadVouchers().find((v) => v.id === closed.journal_id)!;
  assert.equal(jv.lines.reduce((s, l) => s + l.dr, 0), jv.lines.reduce((s, l) => s + l.cr, 0));
  assert.equal(jv.lines.reduce((s, l) => s + l.dr, 0), 105000);
  const t = cycleTotals(closed);
  assert.deepEqual([t.bank, t.cash, t.net], [3950, 2000, 5950]);
  const rows = cycleUploadRows(closed.lines.map((l) => ({ ...l, bank: l.farmer_id === ram.id ? ram.ag.bank : undefined })), closed.number);
  assert.deepEqual(rows.map((x) => [x.beneficiary, x.amount]), [['Ram', 3950]], 'bank file: farmers with an account');
  assert.throws(() => reopenCycle('nope'));
  const reopened = reopenCycle(closed.id);
  assert.equal(reopened.status, 'draft');
  assert.equal(purchasesDb.get(closed.purchase_id!), undefined);
  assert.ok(!getTable<Payment>('transactions').some((p) => p.id === r.id));
  const again = closeCycle(draft.id, 'Rampur');
  const paid = payCycle(again.id, '2026-10-22');
  assert.equal(paid.status, 'paid');
  assert.deepEqual(paymentsDb.forPurchase(again.purchase_id!).map((p) => [p.method, p.amount]), [['Bank transfer', 3950], ['Cash', 2000]]);
  assert.throws(() => reopenCycle(again.id), /paid/);
  assert.equal(loadCycles().length, 1);
});

test('Rule 6DD(e): no 40A(3) warning to a farmer, the note instead; others keep the warning', () => {
  assert.ok(isCultivatorPayee({ principal_kind: 'agriculturist' }));
  assert.ok(!isCultivatorPayee({ principal_kind: 'registered' }));
  assert.match(cashPaymentIssue(15000, '2026-10-20', { principal_kind: 'agriculturist' }), /Rule 6DD\(e\)/);
  assert.match(cashPaymentIssue(15000, '2026-10-20', { principal_kind: 'registered' }), /40A\(3\)/);
  assert.match(cashPaymentIssue(15000, '2026-10-20'), /40A\(3\)/);
  assert.equal(cashPaymentIssue(9000, '2026-10-20', { principal_kind: 'agriculturist' }), '');
});

test('a milk cycle closed from Farm → Cycles marks its purchase stock_by_shift (milk is not counted twice)', () => {
  const ram = saveFarmer({ name: 'Ram', ag: { code: 'F-0001' } });
  const milk = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'milk', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 100, unit: 'L', amount: 4000, deductions: [], net: 0, mode: 'cash' },
  ] });
  const produce = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 10, unit: 'KG', amount: 500, deductions: [], net: 0, mode: 'cash' },
  ] });
  const m = closeCycle(milk.id, 'Rampur');
  const p = closeCycle(produce.id, 'Rampur');
  const flag = (id?: string) => (purchasesDb.get(id!) as { ag?: { stock_by_shift?: boolean } } | undefined)?.ag?.stock_by_shift;
  assert.equal(flag(m.purchase_id), true);
  assert.equal(flag(p.purchase_id), undefined, 'produce stays in stock through its purchase');
});
