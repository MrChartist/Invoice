/**
 * Time tracking, billable expenses and mileage (roadmap 6.13 / 6.14).
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientKA, clientMH, installSettings } from './helpers/world.ts';

const ts = await import('../src/lib/timesheets.ts');
const timer = await import('../src/lib/timer.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const { purchasesDb, billablePatch } = await import('../src/lib/purchases.ts');
const { validateBackupData } = await import('../src/lib/backup.ts');
const { DB_PREFIX } = await import('../src/lib/storage.ts');
import type { TimeEntry, MileageEntry } from '../src/types/time.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';

const prefs = { ...DEFAULT_TIME_PREFS };

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  client_id: 'c-mh',
  client_name: 'Bharat Traders',
  description: 'Research',
  date: '2026-10-19',
  minutes: 60,
  hourly_rate: 1000,
  billable: true,
  ...over,
});

const expense = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: over.id ?? 'e1',
  kind: 'EXPENSE',
  vendor_name: 'IndiGo',
  bill_number: 'TKT9',
  date: '2026-10-20',
  category: 'Travel',
  lines: [{ id: 'l', name: 'Travel', quantity: 1, rate: 5000, tax_rate: 5 }],
  taxable: 5000,
  cgst: 125,
  sgst: 125,
  igst: 0,
  itc_eligible: true,
  total: 5250,
  amount_paid: 5250,
  billable_to_client_id: 'c-mh',
  ...over,
});

// ── Timer ───────────────────────────────────────────────────────

test('timer: elapsed survives a reload because only the start moment is stored', () => {
  resetStorage();
  const t0 = new Date(2026, 9, 24, 10, 0, 0).getTime();
  timer.writeTimer(timer.startTimer({ client_name: 'Bharat Traders' }, t0));
  // "Reload": read it back from storage, 25 minutes later.
  const back = timer.readTimer();
  assert.ok(back && timer.isRunning(back));
  assert.equal(back!.date, '2026-10-24');
  assert.equal(timer.elapsedMs(back, t0 + 25 * 60000), 25 * 60000);
  assert.equal(timer.formatElapsed(timer.elapsedMs(back, t0 + 3725000)), '1:02:05');
});

test('timer: pause banks the run, resume restarts the clock, stop rounds to minutes', () => {
  const t0 = 1_000_000;
  let t = timer.startTimer({}, t0);
  t = timer.pauseTimer(t, t0 + 10 * 60000);
  assert.equal(t.started_at, null);
  assert.equal(timer.elapsedMs(t, t0 + 99 * 60000), 10 * 60000, 'paused time does not count');
  assert.equal(timer.pauseTimer(t, t0 + 50 * 60000), t, 'pausing twice is a no-op');
  t = timer.resumeTimer(t, t0 + 60 * 60000);
  assert.equal(timer.timerMinutes(t, t0 + 65 * 60000 + 29000), 15);
  assert.equal(timer.timerMinutes(t, t0 + 65 * 60000 + 31000), 16);
  // A clock that went backwards never produces negative time.
  assert.equal(timer.elapsedMs(timer.startTimer({}, t0), t0 - 5000), 0);
  timer.writeTimer(null);
  assert.equal(timer.readTimer(), null);
});

// ── Rounding & totals ────────────────────────────────────────────

test('rounding: exact, nearest and up to 6 / 15 minute steps', () => {
  assert.equal(ts.roundMinutes(7, 0, 'nearest'), 7);
  assert.equal(ts.roundMinutes(7, 6, 'none'), 7);
  assert.equal(ts.roundMinutes(7, 6, 'nearest'), 6);
  assert.equal(ts.roundMinutes(9, 6, 'nearest'), 12);
  assert.equal(ts.roundMinutes(7, 6, 'up'), 12);
  assert.equal(ts.roundMinutes(12, 6, 'up'), 12, 'an exact multiple is not bumped');
  assert.equal(ts.roundMinutes(52, 15, 'nearest'), 45);
  assert.equal(ts.roundMinutes(53, 15, 'nearest'), 60);
  assert.equal(ts.roundMinutes(46, 15, 'up'), 60);
  assert.equal(ts.toHours(50), 0.83);
  const p = { ...prefs, round_increment: 15, round_mode: 'up' as const };
  assert.equal(ts.entryAmount(entry({ minutes: 50 }), p), 1000);
  assert.equal(ts.entryAmount(entry({ minutes: 50, billable: false }), p), 0);
});

test('parseDuration reads h:mm, decimals and h/m forms', () => {
  assert.equal(ts.parseDuration('1:30'), 90);
  assert.equal(ts.parseDuration('1.5'), 90);
  assert.equal(ts.parseDuration('90m'), 90);
  assert.equal(ts.parseDuration('2h'), 120);
  assert.equal(ts.parseDuration('1h 15m'), 75);
  assert.ok(Number.isNaN(ts.parseDuration('abc')));
});

test('weekly grid: Monday start, rows per client × project, day and billable totals', () => {
  assert.equal(ts.weekStart('2026-10-24'), '2026-10-19'); // Saturday → Monday
  assert.equal(ts.weekStart('2026-10-19'), '2026-10-19');
  assert.equal(ts.weekStart('2026-10-25'), '2026-10-19'); // Sunday belongs to the same week
  assert.equal(ts.weekStart('2026-03-02'), '2026-03-02');
  const g = ts.weekGrid([
    entry({ date: '2026-10-19', minutes: 90 }),
    entry({ date: '2026-10-21', minutes: 30 }),
    entry({ date: '2026-10-21', minutes: 45, project: 'Audit' }),
    entry({ date: '2026-10-25', minutes: 15, billable: false, client_id: 'c-ka', client_name: 'Karnataka Tech' }),
    entry({ date: '2026-10-26', minutes: 600 }), // next week
  ], '2026-10-19');
  assert.equal(g.days[6], '2026-10-25');
  assert.equal(g.rows.length, 3);
  const plain = g.rows.find((r) => r.client_name === 'Bharat Traders' && !r.project)!;
  assert.deepEqual(plain.minutes, [90, 0, 30, 0, 0, 0, 0]);
  assert.deepEqual(g.dayTotals, [90, 0, 75, 0, 0, 0, 15]);
  assert.equal(g.total, 180);
  assert.equal(g.billableTotal, 165);
  const weeks = ts.totalsByWeek([entry({ date: '2026-10-19' }), entry({ date: '2026-10-26', minutes: 30 })], prefs);
  assert.deepEqual(weeks.map((w) => [w.key, w.minutes]), [['2026-10-19', 60], ['2026-10-26', 30]]);
  const byClient = ts.totalsByClient([entry(), entry({ minutes: 30 })], prefs);
  assert.equal(byClient[0].amount, 1500);
});

// ── Lines ────────────────────────────────────────────────────────

test('time lines group by project + description + rate, qty in hours to 2 dp with SAC', () => {
  const lines = ts.timeLines([
    entry({ minutes: 50, date: '2026-10-19' }),
    entry({ minutes: 40, date: '2026-10-21' }),
    entry({ minutes: 30, project: 'Audit', description: 'Ledger review' }),
    entry({ minutes: 30, hourly_rate: 2000 }),
    entry({ minutes: 600, billable: false }),
  ], prefs);
  assert.equal(lines.length, 3);
  const research = lines[0];
  assert.equal(research.name, 'Research');
  assert.equal(research.quantity, 1.5);
  assert.equal(research.unit, 'HRS');
  assert.equal(research.hsn, '998311');
  assert.equal(research.tax_rate, 18);
  assert.equal(research.amount, 1500);
  assert.match(research.description!, /2 entries/);
  assert.equal(lines[1].name, 'Audit — Ledger review');
  assert.equal(lines[2].rate, 2000);
  // Per-entry rounding before summing.
  const up = ts.timeLines([entry({ minutes: 7 }), entry({ minutes: 7 })], { ...prefs, round_increment: 6, round_mode: 'up' });
  assert.equal(up[0].quantity, 0.4);
});

test('billable expense: cost net of claimed ITC plus markup, taxable at the preference rate', () => {
  const l = ts.expenseLine(expense({ markup_percent: 10 }), prefs);
  assert.equal(l.rate, 5500);
  assert.equal(l.tax_rate, 18);
  assert.equal(l.hsn, '998311');
  assert.match(l.description!, /10% markup/);
  // ITC not claimed: the GST paid is part of the cost.
  assert.equal(ts.expenseLine(expense({ itc_eligible: false }), prefs).rate, 5250);
});

test('pure-agent reimbursement: actual amount paid, no markup, 0% with the Rule 33 note', () => {
  const l = ts.expenseLine(expense({ pure_agent: true, markup_percent: 25 }), prefs);
  assert.equal(l.rate, 5250);
  assert.equal(l.tax_rate, 0);
  assert.match(l.name, /Reimbursement/);
  assert.match(l.description!, /Rule 33/);
  assert.match(l.description!, /verify with your CA/i);
  assert.deepEqual(billablePatch({ billable_to_client_id: 'c', markup_percent: 25, pure_agent: true }), { billable_to_client_id: 'c', markup_percent: undefined, pure_agent: true });
  assert.deepEqual(billablePatch({ markup_percent: 5 }), { billable_to_client_id: undefined, markup_percent: undefined, pure_agent: undefined });
});

test('mileage totals and lines (one per rate, unit KM)', () => {
  const trips: MileageEntry[] = [
    { id: 'm1', client_id: 'c-mh', client_name: 'Bharat Traders', date: '2026-10-19', from: 'Fort', to: 'Pune', purpose: 'Visit', km: 148.5, rate_per_km: 10 },
    { id: 'm2', client_id: 'c-mh', client_name: 'Bharat Traders', date: '2026-10-20', from: 'Pune', to: 'Fort', purpose: 'Return', km: 150, rate_per_km: 10 },
    { id: 'm3', client_id: 'c-mh', client_name: 'Bharat Traders', date: '2026-10-22', from: 'A', to: 'B', purpose: '', km: 12, rate_per_km: 12 },
  ];
  assert.deepEqual(ts.mileageTotals(trips), { km: 310.5, amount: 3129, count: 3 });
  const lines = ts.mileageLines(trips, prefs);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].quantity, 298.5);
  assert.equal(lines[0].unit, 'KM');
  assert.equal(lines[0].amount, 2985);
  assert.equal(lines[1].amount, 144);
});

// ── Billing flow (storage) ───────────────────────────────────────

function seed() {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  localDb.clients.upsert(clientKA);
  ts.timeDb.save(entry({ id: 't1', minutes: 90 }));
  ts.timeDb.save(entry({ id: 't2', minutes: 30, project: 'Audit' }));
  ts.timeDb.save(entry({ id: 't3', minutes: 60, billable: false }));
  ts.timeDb.save(entry({ id: 't4', client_id: 'c-ka', client_name: 'Karnataka Tech' }));
  ts.mileageDb.save({ id: 'm1', client_id: 'c-mh', client_name: 'Bharat Traders', date: '2026-10-20', from: 'Fort', to: 'Pune', purpose: 'Visit', km: 100, rate_per_km: 10 });
  purchasesDb.save(expense({ id: 'e1', markup_percent: 10 }));
  purchasesDb.save(expense({ id: 'e2', pure_agent: true, bill_number: 'FEE1', category: 'Government fees', total: 1000, taxable: 1000, cgst: 0, sgst: 0, itc_eligible: false }));
  purchasesDb.save(expense({ id: 'e3', billable_to_client_id: undefined }));
}

test('bill unbilled time creates a new draft with the right lines and marks the rows', () => {
  seed();
  const sel = ts.unbilledFor('c-mh');
  assert.deepEqual(sel.time.map((e) => e.id).sort(), ['t1', 't2']);
  assert.deepEqual(sel.expenses.map((p) => p.id).sort(), ['e1', 'e2']);
  assert.equal(sel.mileage.length, 1);

  const inv = ts.billUnbilled('c-mh', sel);
  assert.equal(inv.status, 'Draft');
  assert.equal(inv.client.name, 'Bharat Traders');
  assert.equal(inv.client.gstin, clientMH.gstin);
  assert.match(inv.invoice_number, /^INV\/FY26-27\/\d{4}$/);
  assert.equal(inv.gst_mode, 'CGST_SGST', 'Maharashtra seller → Maharashtra client');
  const names = inv.items.map((i) => i.name);
  assert.deepEqual(names, ['Research', 'Audit — Research', 'Re-billed expense — Travel: IndiGo (#TKT9)', 'Reimbursement — Government fees: IndiGo (#FEE1)', 'Mileage']);
  // 1.5 h + 0.5 h at 1000, 5500 re-billed, 1000 pure agent, 1000 mileage.
  assert.equal(inv.taxable_value, 1500 + 500 + 5500 + 1000 + 1000);
  assert.equal(inv.tax_amount, Math.round((1500 + 500 + 5500 + 1000) * 0.18 * 100) / 100, 'pure-agent line carries no GST');
  assert.ok(localDb.invoices.getById(inv.id), 'saved');

  assert.equal(ts.timeDb.all().find((e) => e.id === 't1')!.invoiced_in, inv.id);
  assert.equal(ts.timeDb.all().find((e) => e.id === 't3')!.invoiced_in, undefined, 'non-billable untouched');
  assert.equal(ts.timeDb.all().find((e) => e.id === 't4')!.invoiced_in, undefined, 'other client untouched');
  assert.equal(ts.mileageDb.all()[0].invoiced_in, inv.id);
  assert.equal(purchasesDb.get('e1')!.rebilled_in, inv.id);
  assert.equal(purchasesDb.get('e3')!.rebilled_in, undefined);

  const after = ts.unbilledFor('c-mh');
  assert.equal(after.time.length + after.expenses.length + after.mileage.length, 0);
  assert.throws(() => ts.billUnbilled('c-mh', after), ts.NothingToBillError);
});

test('inter-state client gets IGST', () => {
  seed();
  const inv = ts.billUnbilled('c-ka', ts.unbilledFor('c-ka'));
  assert.equal(inv.gst_mode, 'IGST');
  assert.equal(inv.igst_amount, 180);
});

test('deleting (or cancelling) the invoice frees the entries again', () => {
  seed();
  const inv = ts.billUnbilled('c-mh', ts.unbilledFor('c-mh'));
  localDb.invoices.remove(inv.id);
  const freed = ts.unbilledFor('c-mh');
  assert.equal(freed.time.length, 2);
  assert.equal(freed.expenses.length, 2);
  assert.equal(freed.mileage.length, 1);

  const again = ts.billUnbilled('c-mh', freed);
  localDb.invoices.save({ ...localDb.invoices.getById(again.id)!, status: 'Cancelled' });
  assert.equal(ts.unbilledFor('c-mh').time.length, 2);
});

test('re-billed link is stamped even inside a locked period; the cost itself stays locked', () => {
  seed();
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-10-31' });
  purchasesDb.setRebilled(['e1'], 'inv-x');
  assert.equal(purchasesDb.get('e1')!.rebilled_in, 'inv-x');
  assert.throws(() => purchasesDb.save({ ...purchasesDb.get('e1')!, markup_percent: 50 }));
});

test('CSV rows and backup validation cover the new tables', () => {
  const live = ts.liveInvoiceIds([{ id: 'i1', status: 'Sent' }, { id: 'i2', status: 'Cancelled' }]);
  const rows = ts.timeEntriesToRows([entry({ invoiced_in: 'i1' }), entry({ invoiced_in: 'i2', date: '2026-10-20' })], prefs, live, new Map([['i1', 'INV/1']]));
  assert.deepEqual(rows[1].slice(-2), ['Billed', 'INV/1']);
  assert.deepEqual(rows[2].slice(-2), ['Unbilled', '']);
  assert.throws(() => validateBackupData({ [`${DB_PREFIX}time_entries`]: '{"a":1}' }), /time_entries/);
  assert.throws(() => validateBackupData({ [`${DB_PREFIX}mileage`]: '[{"km":3}]' }), /mileage/);
  validateBackupData({ [`${DB_PREFIX}time_entries`]: '[{"id":"t"}]', [`${DB_PREFIX}mileage`]: '[]' });
});
