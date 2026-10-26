/**
 * R3-B4 timesheet & expense annexure: snapshot of the billed rows, tie-out, CSV, template wiring.
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientMH, installSettings } from './helpers/world.ts';

const ax = await import('../src/lib/annexure.ts');
const ts = await import('../src/lib/timesheets.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const { purchasesDb } = await import('../src/lib/purchases.ts');
import type { TimeEntry } from '../src/types/time.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';

const prefs = { ...DEFAULT_TIME_PREFS, round_increment: 15, round_mode: 'up' as const };
const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2), client_id: 'c-mh', client_name: 'Bharat Traders', description: 'Drafting', date: '2026-10-05', minutes: 50, hourly_rate: 2000, billable: true, ...over,
});
const expense = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: over.id ?? 'e1', kind: 'EXPENSE', vendor_name: 'IndiGo', bill_number: 'TKT9', date: '2026-10-06', category: 'Travel',
  lines: [{ id: 'l', name: 'Travel', quantity: 1, rate: 5000, tax_rate: 0 }], taxable: 5000, total: 5000, itc_eligible: false,
  billable_to_client_id: 'c-mh', markup_percent: 10, ...over,
} as PurchaseRecord);

const ctx = { tasks: [{ id: 'tk', title: 'Contract review', assignee_id: 'u1' }], centres: [{ id: 'p1', name: 'Merger' }], people: new Map([['u1', 'Asha']]) };

test('snapshot equals the billed rows', () => {
  const sel = { time: [entry({ id: 'a', task_id: 'tk', cost_centre_id: 'p1' }), entry({ id: 'b', date: '2026-10-01', minutes: 20, project: 'Due diligence' }), entry({ id: 'nb', billable: false })], expenses: [expense()] };
  const a = ax.buildAnnexure(sel, prefs, ctx, '2026-10-07T00:00:00Z');
  assert.equal(a.kind, 'timesheet');
  assert.deepEqual(a.rows.map((r) => r.ref), ['b', 'a'], 'billable rows only, by date');
  assert.deepEqual(a.rows[1], { date: '2026-10-05', who: 'Asha', project: 'Merger', task: 'Contract review', description: 'Drafting', minutes: 50, billed_minutes: 60, rate: 2000, amount: 2000, ref: 'a' });
  assert.equal(a.rows[0].project, 'Due diligence');
  assert.equal(a.expenses![0].amount, 5500, 'cost + 10% markup, as on the line');
  assert.equal(a.taken_at, '2026-10-07T00:00:00Z');
});

test('tie-out vs lines (rounding to the billing step)', () => {
  const time = [entry({ id: 'a', minutes: 50 }), entry({ id: 'b', minutes: 7 }), entry({ id: 'c', minutes: 22 })];
  const sel = { time, expenses: [expense()], mileage: [] };
  const lines = ts.buildBillLines(sel, prefs);
  const a = ax.buildAnnexure(sel, prefs, ctx);
  const t = ax.tieOut(a, lines);
  assert.equal(t.ok, true);
  assert.equal(t.annexure_minutes, 60 + 15 + 30);
  assert.equal(t.line_minutes, 105);
  // Editing a line quantity in the editor breaks the tie (shown in the editor, never on paper).
  const edited = lines.map((l, i) => (i === 0 ? { ...l, quantity: 3, amount: 6000 } : l));
  assert.equal(ax.tieOut(a, edited).ok, false);
  // Removing the expense line leaves an annexure row no line bills.
  assert.equal(ax.tieOut(a, lines.slice(0, 1)).missing_rows, 1);
});

test('billUnbilled stores the snapshot; a later time-entry edit leaves it unchanged', () => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  ts.timeDb.save(entry({ id: 'a', minutes: 90 }));
  purchasesDb.save(expense({ id: 'e9', pure_agent: true, markup_percent: 0 }));
  const inv = ts.billUnbilled('c-mh', ts.unbilledFor('c-mh', undefined, { prefs }), prefs, { annexure: true });
  const before = JSON.stringify(localDb.invoices.getById(inv.id)!.annexure);
  assert.equal(localDb.invoices.getById(inv.id)!.annexure!.rows[0].billed_minutes, 90);
  ts.timeDb.save({ ...ts.timeDb.all().find((e) => e.id === 'a')!, minutes: 300, description: 'Changed later' });
  assert.equal(JSON.stringify(localDb.invoices.getById(inv.id)!.annexure), before, 'snapshot (Critical Rule 3)');
  // Without the option nothing is stored.
  ts.timeDb.save(entry({ id: 'z', minutes: 30 }));
  const plain = ts.billUnbilled('c-mh', ts.unbilledFor('c-mh', undefined, { prefs }), prefs);
  assert.equal(localDb.invoices.getById(plain.id)!.annexure, undefined);
});

test('pure-agent rows flagged', () => {
  const a = ax.buildAnnexure({ time: [], expenses: [expense({ pure_agent: true, markup_percent: 15 })] }, prefs, ctx);
  assert.equal(a.expenses![0].pure_agent, true);
  assert.equal(a.expenses![0].markup_pct, 0, 'no markup for a pure agent');
  assert.equal(a.expenses![0].amount, 5000, 'actual cost');
});

test('CSV columns', () => {
  const a = ax.buildAnnexure({ time: [entry({ id: 'a', task_id: 'tk', cost_centre_id: 'p1' })], expenses: [expense({ pure_agent: true })] }, prefs, ctx);
  const rows = ax.annexureRows(a);
  assert.deepEqual(rows[0], ['Kind', 'Date', 'Who', 'Project', 'Task', 'Description', 'Minutes', 'Billed hours', 'Rate', 'Markup %', 'Pure agent', 'Amount']);
  assert.deepEqual(rows[1], ['Time', '2026-10-05', 'Asha', 'Merger', 'Contract review', 'Drafting', 50, 1, 2000, '', '', 2000]);
  assert.equal(rows[2][0], 'Expense');
  assert.equal(rows[2][10], 'Yes');
  const totals = ax.annexureTotals(a);
  assert.equal(totals.total, 7000);
});

test('legacy invoice without `annexure` renders unchanged (template wiring)', () => {
  const src = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  assert.match(src, /const LazyAnnexure = lazy\(\(\) => import\('\.\/parts\/AnnexureBlock'\)\)/);
  assert.match(src, /\{invoice\.annexure && layout !== 'receipt' && <Suspense fallback=\{null\}><LazyAnnexure invoice=\{invoice\} \/><\/Suspense>\}/, 'nothing renders without data; never on thermal');
  const css = readFileSync(new URL('../src/components/templates/parts/annexure-paper.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, 'no raw hex in paper parts (accent only)');
  assert.match(css, /break-before: page/);
});
