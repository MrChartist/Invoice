/** CN-C4 RERA 70% account: collections (pass-through and advance adjustments excluded), 70% required, deposited,
 * shortfall, withdrawal checks (deposits, completion %, three certificates), QPR rows and the year's statement. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { book, realtyWorld } from './helpers/realty.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { loadAdvances } from '../src/lib/advances.ts';
import { certifyStage } from '../src/lib/construction/cn-plans.ts';
import { raiseDemands } from '../src/lib/construction/cn-demands.ts';
import { loadBookings, recordReceipt } from '../src/lib/construction/cn-bookings.ts';
import { loadUnits } from '../src/lib/construction/cn-units.ts';
import { collections, deleteReraEntry, loadReraEntries, qprCsv, reraStatement, saveReraEntry, statementCsv, withdrawalWarnings } from '../src/lib/construction/cn-rera.ts';

afterEach(() => thawDate());

const cert = { engineer: { name: 'E', ref: 'E/1', date: '2026-07-01' }, architect: { name: 'A', ref: 'A/1', date: '2026-07-01' }, ca: { name: 'C', ref: 'C/1', date: '2026-07-01' } };

test('70% required vs deposited, pass-through excluded, advance adjustments not counted twice; withdrawals checked', () => {
  const w = realtyWorld();
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 1000000, method: 'Bank transfer', bankAccountId: 'rera' });
  recordReceipt(b.id, { date: '2026-05-03', amount: 400000, method: 'Bank transfer', passThrough: true, bankAccountId: 'rera' });
  recordReceipt(b.id, { date: '2026-05-04', amount: 500000, method: 'Bank transfer' });
  const [inv] = raiseDemands(certifyStage({ project_id: w.project.id, tower_id: w.tower.id, stage_id: w.plan.stages[2].id, stage_label: 'Plinth', certified_on: '2026-06-01', by: 'Architect' }).id, '2026-06-01');
  localDb.payments.record({ invoiceId: inv.id, amount: 100000, method: 'Bank transfer', date: '2026-06-10', bankAccountId: 'rera' } as never);
  const cols = collections(w.project, loadBookings(), loadAdvances(), getTable('transactions'), localDb.invoices.getAll());
  assert.deepEqual(cols.map((c) => [c.date, c.amount, c.intoRera]), [['2026-05-02', 1000000, true], ['2026-05-04', 500000, false], ['2026-06-10', 100000, true]], 'pass-through and advance adjustments left out');
  saveReraEntry({ project_id: w.project.id, date: '2026-05-20', amount: 200000, kind: 'deposit', note: 'Transfer from collection account' });
  const st = reraStatement(w.project, cols, loadReraEntries());
  assert.deepEqual(st.map((m) => [m.month, m.collected, m.required, m.deposited, m.shortfall]), [['2026-05', 1500000, 1050000, 1200000, 0], ['2026-06', 100000, 70000, 100000, 0]]);
  assert.deepEqual(withdrawalWarnings(w.project, cols, loadReraEntries(), { amount: 500000, completion_pct: 42, certificates: cert }), [], '₹5 lakh ≤ 42% of ₹13 lakh');
  assert.deepEqual(withdrawalWarnings(w.project, cols, loadReraEntries(), { amount: 600000, completion_pct: 42 }), ['over_completion', 'certificates']);
  assert.deepEqual(withdrawalWarnings(w.project, cols, loadReraEntries(), { amount: 1400000, completion_pct: 100, certificates: cert }), ['over_deposits', 'over_completion']);
  const wd = saveReraEntry({ project_id: w.project.id, date: '2026-07-02', amount: 500000, completion_pct: 42, certificates: cert, purpose: 'construction' });
  const st2 = reraStatement(w.project, cols, loadReraEntries());
  assert.equal(st2.at(-1)!.balance, 800000);
  assert.match(statementCsv(st2), /2026-07,0,0,0,500000,0,800000/);
  const qpr = qprCsv(w.project, loadUnits(), loadBookings(), cols, st2);
  assert.match(qpr.split('\r\n')[1], /^Green Heights,P52100012345,A,4,1,1600000,0,800000,500000$/);
  deleteReraEntry(wd.id);
  assert.equal(loadReraEntries().length, 1);
});

test('shortfall when deposits lag the 70%', () => {
  const w = realtyWorld();
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 1000000, method: 'Cash' });
  const st = reraStatement(w.project, collections(w.project, loadBookings(), loadAdvances(), [], []), []);
  assert.deepEqual([st[0].required, st[0].deposited, st[0].shortfall], [700000, 0, 700000]);
});
