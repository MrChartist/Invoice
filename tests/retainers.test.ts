/**
 * R3-B3 prepaid retainer hours: drawdown, rollover, forfeiture, overage billing, fee cancellation, FY quarters.
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientMH, installSettings } from './helpers/world.ts';

const rt = await import('../src/lib/retainers.ts');
const ts = await import('../src/lib/timesheets.ts');
const { localDb } = await import('../src/lib/localDb.ts');
import type { TimeEntry } from '../src/types/time.ts';
import type { Retainer } from '../src/lib/retainers.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';

const prefs = { ...DEFAULT_TIME_PREFS };
const billable = (e: TimeEntry) => ts.billableMinutes(e, prefs);
const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2), client_id: 'c-mh', client_name: 'Bharat Traders', description: 'Work', date: '2026-10-05', minutes: 60, hourly_rate: 2000, billable: true, created_at: '2026-10-05T10:00:00Z', ...over,
});
const retainer = (over: Partial<Retainer> = {}): Retainer => ({
  id: 'r1', client_key: 'c-mh', client_name: 'Bharat Traders', hours_per_period: 10, period: 'month', fee: 20000, start: '2026-10-01', rollover_cap: 2, closes: [], ...over,
});

test('drawdown in date order (an entry straddling the block is split)', () => {
  const entries = [
    entry({ id: 'late', date: '2026-10-20', minutes: 240 }),
    entry({ id: 'early', date: '2026-10-02', minutes: 480 }),
    entry({ id: 'mid', date: '2026-10-10', minutes: 180 }),
    entry({ id: 'other', client_id: 'c-ka', client_name: 'X', date: '2026-10-03', minutes: 600 }),
  ];
  const [oct] = rt.drawdown(retainer(), entries, billable, [], '2026-10-25');
  assert.equal(oct.allowance, 600);
  assert.deepEqual([...oct.covered], [['early', 480], ['mid', 120]]);
  assert.deepEqual([...oct.overage], [['mid', 60], ['late', 240]]);
  assert.equal(oct.used, 600);
  assert.equal(oct.remaining, 0);
});

test('rollover cap and forfeiture', () => {
  const entries = [entry({ id: 'a', date: '2026-10-02', minutes: 360 })]; // 6 of 10 h used
  const r = retainer();
  const [oct, nov] = rt.drawdown(r, entries, billable, [], '2026-11-05');
  assert.equal(oct.remaining, 240);
  assert.equal(oct.rolled_out, 120, 'up to the 2 h cap');
  assert.equal(oct.forfeited, 120);
  assert.equal(nov.rolled_in, 120);
  assert.equal(nov.allowance, 720);
  const closed = rt.closePeriod(r, '2026-10-01', entries, billable, [], '2026-11-05', '2026-11-05T00:00:00Z');
  assert.deepEqual(closed.row, { period: '2026-10-01', used: 360, rolled: 120, forfeited: 120, at: '2026-11-05T00:00:00Z' });
  assert.deepEqual(closed.stamp, ['a']);
  assert.throws(() => rt.closePeriod(closed.retainer, '2026-10-01', entries, billable, [], '2026-11-05'), /already closed/);
  assert.throws(() => rt.closePeriod(r, '2026-11-01', entries, billable, [], '2026-12-05'), /Close Oct 2026 first/);
  assert.equal(rt.periodsToClose(rt.drawdown(r, entries, billable, [], '2026-11-05')).length, 1);
});

test('overage only billed once; covered time never reaches the Unbilled flow', () => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  rt.saveRetainer({ client_key: 'c-mh', client_name: 'Bharat Traders', hours_per_period: 1, period: 'month', fee: 2000, start: '2026-10-01', rollover_cap: 0, overage_rate: 3000 });
  ts.timeDb.save(entry({ id: 'in', date: '2026-10-02', minutes: 60 }));
  ts.timeDb.save(entry({ id: 'over', date: '2026-10-03', minutes: 90 }));
  const sel = ts.unbilledFor('c-mh');
  assert.deepEqual(sel.time.map((e) => [e.id, e.minutes, e.hourly_rate]), [['over', 90, 3000]], 'covered entry left out; overage at the overage rate');
  const inv = ts.billUnbilled('c-mh', sel);
  assert.equal(inv.items[0].quantity, 1.5);
  assert.equal(inv.items[0].rate, 3000);
  assert.equal(ts.unbilledFor('c-mh').time.length, 0, 'overage billed once');
  // The stored entry keeps its own captured rate (the overage rate lives on the bill only).
  assert.equal(ts.timeDb.all().find((e) => e.id === 'over')!.hourly_rate, 2000);
});

test('cancelling the fee invoice uncovers entries (open and closed periods)', () => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  const fee = { id: 'fee1', status: 'Sent' as const, issue_date: '2026-10-01', recurring_id: 'rec1' };
  const r = retainer({ recurring_id: 'rec1' });
  const entries = [entry({ id: 'a', date: '2026-10-02', minutes: 120 })];
  let [oct] = rt.drawdown(r, entries, billable, [fee], '2026-10-20');
  assert.equal(oct.fee_state, 'live');
  assert.equal(oct.covered.get('a'), 120);
  [oct] = rt.drawdown(r, entries, billable, [{ ...fee, status: 'Cancelled' }], '2026-10-20');
  assert.equal(oct.fee_state, 'cancelled');
  assert.equal(oct.covered.size, 0);
  assert.equal(oct.overage.get('a'), 120);
  // A period without any fee invoice yet still covers ("pending fee").
  [oct] = rt.drawdown(r, entries, billable, [], '2026-10-20');
  assert.equal(oct.fee_state, 'pending');
  assert.equal(oct.covered.get('a'), 120);
  // Closed: stamps decide, and a cancelled fee still uncovers.
  const closed = rt.closePeriod(r, '2026-10-01', entries, billable, [fee], '2026-11-02');
  const stamped = entries.map((e) => ({ ...e, retainer_id: 'r1', retainer_period: '2026-10-01' }));
  [oct] = rt.drawdown(closed.retainer, stamped, billable, [fee], '2026-11-02');
  assert.equal(oct.covered.get('a'), 120);
  [oct] = rt.drawdown(closed.retainer, stamped, billable, [{ ...fee, status: 'Cancelled' }], '2026-11-02');
  assert.equal(oct.covered.size, 0);
  // Through storage: commitClose stamps the entries.
  rt.saveRetainer({ ...r, id: 'r1' });
  ts.timeDb.save(entries[0]);
  rt.commitClose('r1', '2026-10-01', billable, [fee], '2026-11-02');
  const e = ts.timeDb.all().find((x) => x.id === 'a')!;
  assert.equal(e.retainer_id, 'r1');
  assert.equal(e.retainer_period, '2026-10-01');
  assert.equal(rt.loadRetainers()[0].closes.length, 1);
});

test('quarter periods across the FY boundary (local days 31 Mar / 1 Apr)', () => {
  assert.equal(rt.periodStart('2027-03-31', 'quarter'), '2027-01-01');
  assert.equal(rt.periodStart('2027-04-01', 'quarter'), '2027-04-01');
  assert.equal(rt.periodEnd('2027-01-01', 'quarter'), '2027-03-31');
  assert.equal(rt.nextPeriod('2027-01-01', 'quarter'), '2027-04-01');
  assert.equal(rt.periodLabel('2027-01-01', 'quarter'), 'Q4 FY26-27');
  assert.equal(rt.periodLabel('2027-04-01', 'quarter'), 'Q1 FY27-28');
  assert.equal(rt.periodEnd('2028-02-01', 'month'), '2028-02-29');
  const r = retainer({ period: 'quarter', start: '2027-02-10', hours_per_period: 1, rollover_cap: 0 });
  const entries = [entry({ id: 'mar', date: '2027-03-31', minutes: 60 }), entry({ id: 'apr', date: '2027-04-01', minutes: 60 })];
  const [q4, q1] = rt.drawdown(r, entries, billable, [], '2027-04-02');
  assert.deepEqual([q4.period, [...q4.covered.keys()]], ['2027-01-01', ['mar']]);
  assert.deepEqual([q1.period, [...q1.covered.keys()]], ['2027-04-01', ['apr']]);
  assert.equal(q4.ended, true);
});

test('doubleBilledRows unaffected by retainer coverage', () => {
  const entries = [entry({ id: 'a', invoiced_in: 'inv1' })];
  const doc = { id: 'inv1', items: [{ bill_refs: ['a'] }] };
  const live = ts.liveInvoiceIds([{ id: 'inv2', status: 'Sent', items: [{ bill_refs: [] }] }]);
  assert.deepEqual(ts.doubleBilledRows(doc, { time: entries, mileage: [], expenses: [] }, live), []);
});

test('report rows and validation', () => {
  const entries = [entry({ id: 'a', date: '2026-10-02', minutes: 720, invoiced_in: 'inv9' })];
  const periods = rt.drawdown(retainer({ fee_invoices: { '2026-10-01': 'fee1' } }), entries, billable, [{ id: 'fee1', status: 'Sent', issue_date: '2026-10-01' }], '2026-10-20');
  const rows = rt.retainerReport(periods, new Map([['fee1', 'INV/FY26-27/0001']]), (_id, m) => m / 60 * 2000, new Set(['a']));
  assert.deepEqual(rows[0], { period: '2026-10-01', label: 'Oct 2026', fee_invoice: 'INV/FY26-27/0001', allowance_h: 10, used_h: 10, remaining_h: 0, rolled_h: 0, forfeited_h: 0, overage_h: 2, overage_invoiced: 4000, state: 'Open' });
  assert.match(rt.validateRetainer({ client_key: 'x', hours_per_period: 0, start: '2026-10-01' }), /hours/);
  assert.equal(rt.validateRetainer({ client_key: 'x', hours_per_period: 5, start: '2026-10-01', fee: 0, rollover_cap: 0 }), '');
});
