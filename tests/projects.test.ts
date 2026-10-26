/**
 * R3-B2 projects: burn / forecast, budget thresholds, derived Invoiced column, board moves.
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientMH, installSettings } from './helpers/world.ts';

const pj = await import('../src/lib/projects.ts');
const ts = await import('../src/lib/timesheets.ts');
const cc = await import('../src/lib/cost-centres.ts');
const rc = await import('../src/lib/rate-cards.ts');
const alerts = await import('../src/lib/project-alerts.ts');
const { localDb } = await import('../src/lib/localDb.ts');
import type { TimeEntry } from '../src/types/time.ts';
import type { ProjectTask } from '../src/lib/projects.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';

const prefs = { ...DEFAULT_TIME_PREFS };
const task = (over: Partial<ProjectTask>): ProjectTask => ({ id: 't', cost_centre_id: 'p1', title: 'Task', column: 'To do', estimate_minutes: 0, sort: 0, created_at: '2026-10-01', ...over });
const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2), client_id: 'c-mh', client_name: 'Bharat Traders', description: 'Work', date: '2026-10-10', minutes: 60, hourly_rate: 1000, billable: true, ...over,
});
const project = { id: 'p1', budget_minutes: 600, fee_budget: 10000, start: '2026-10-01', due: '2026-10-30' };

test('burn and forecast', () => {
  const tasks = [task({ id: 'a', estimate_minutes: 300 }), task({ id: 'b', estimate_minutes: 200 })];
  const entries = [entry({ task_id: 'a', minutes: 120 }), entry({ cost_centre_id: 'p1', minutes: 60 }), entry({ cost_centre_id: 'other', minutes: 999 })];
  const b = pj.projectBurn(project, entries, tasks, prefs, new Set(), '2026-10-10');
  assert.equal(b.tracked_minutes, 180);
  assert.equal(b.pct, 30);
  assert.equal(b.estimate_minutes, 500);
  // 180 min over 10 days → 18 min/day × 30 days.
  assert.equal(b.forecast_minutes, 540);
  assert.equal(b.unbilled_amount, 3000);
  assert.equal(b.fee_pct, 30);
  assert.equal(pj.projectBurn({ id: 'p1' }, entries, tasks, prefs, new Set(), '2026-10-10').forecast_minutes, null, 'no dates → no forecast');
});

test('80 / 100% thresholds (and the bell notices)', () => {
  assert.equal(pj.budgetLevel(null), 0);
  assert.equal(pj.budgetLevel(79.99), 0);
  assert.equal(pj.budgetLevel(80), 80);
  assert.equal(pj.budgetLevel(100), 100);
  const b80 = pj.projectBurn(project, [entry({ cost_centre_id: 'p1', minutes: 480 })], [], prefs, new Set(), '2026-10-10');
  assert.equal(b80.level, 80);
  const b100 = pj.projectBurn(project, [entry({ cost_centre_id: 'p1', minutes: 600 })], [], prefs, new Set(), '2026-10-10');
  assert.equal(b100.level, 100);
  const notes = alerts.projectNotices({ id: 'p1', name: 'Website' }, b100, '2026-10-10T00:00:00Z');
  // 600 min × ₹1,000/h = ₹10,000: the fee budget is used up too.
  assert.deepEqual(notes.map((n) => [n.id, n.severity]), [['project-hours:p1:100', 'critical'], ['project-fee:p1:100', 'critical']]);
  assert.equal(alerts.projectNotices({ id: 'p1', name: 'Website' }, b80, 'x')[0].severity, 'warning');
});

test('derived Invoiced column after billing and after cancelling the invoice', () => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
  const t = task({ id: 'tk', column: 'Doing' });
  ts.timeDb.save({ ...entry({ task_id: 'tk', cost_centre_id: 'p1' }), id: 'e1' });
  ts.timeDb.save({ ...entry({ task_id: 'tk', cost_centre_id: 'p1', billable: false }), id: 'e2' });
  assert.equal(pj.displayColumn(t, ts.timeDb.all(), ts.currentLiveInvoiceIds()), 'Doing');
  const inv = ts.billUnbilled('c-mh', ts.unbilledFor('c-mh', undefined, { projectId: 'p1' }));
  assert.equal(pj.displayColumn(t, ts.timeDb.all(), ts.currentLiveInvoiceIds()), pj.INVOICED);
  localDb.invoices.save({ ...localDb.invoices.getById(inv.id)!, status: 'Cancelled' });
  assert.equal(pj.displayColumn(t, ts.timeDb.all(), ts.currentLiveInvoiceIds()), 'Doing');
});

test('bill project: the unbilled selection is limited to the project', () => {
  resetStorage();
  ts.timeDb.save({ ...entry({ cost_centre_id: 'p1' }), id: 'in' });
  ts.timeDb.save({ ...entry({ cost_centre_id: 'p2' }), id: 'out' });
  pj.saveTask({ cost_centre_id: 'p1', title: 'Design', column: 'To do', estimate_minutes: 60 });
  const tk = pj.loadTasks()[0];
  ts.timeDb.save({ ...entry({ task_id: tk.id }), id: 'viaTask' });
  const sel = ts.unbilledFor('c-mh', undefined, { projectId: 'p1' });
  assert.deepEqual(sel.time.map((e) => e.id).sort(), ['in', 'viaTask']);
});

test('board move ordering', () => {
  const tasks = [
    task({ id: 'a', column: 'To do', sort: 0 }), task({ id: 'b', column: 'To do', sort: 1 }), task({ id: 'c', column: 'To do', sort: 2 }),
    task({ id: 'd', column: 'Doing', sort: 0 }), task({ id: 'x', cost_centre_id: 'p2', column: 'To do', sort: 0 }),
  ];
  const moved = pj.moveTask(tasks, 'c', 'To do', 0);
  assert.deepEqual(pj.columnTasks(moved, 'p1', 'To do').map((t) => t.id), ['c', 'a', 'b']);
  const across = pj.moveTask(tasks, 'a', 'Doing', 1);
  assert.deepEqual(pj.columnTasks(across, 'p1', 'Doing').map((t) => t.id), ['d', 'a']);
  assert.deepEqual(pj.columnTasks(across, 'p1', 'To do').map((t) => [t.id, t.sort]), [['b', 0], ['c', 1]]);
  assert.equal(across.find((t) => t.id === 'x')!.sort, 0, 'other projects untouched');
  const cols = ['To do', 'Doing', 'Done'];
  const right = pj.moveTaskBy(tasks, 'b', 1, cols)!;
  assert.deepEqual(pj.columnTasks(right, 'p1', 'Doing').map((t) => t.id), ['d', 'b'], 'Alt+→ goes to the end of the next column');
  assert.equal(pj.moveTaskBy(tasks, 'a', -1, cols), null, 'no column left of the first');
  const r = pj.renameColumn({ columns: cols }, tasks, 'Doing', 'In progress');
  assert.deepEqual(r.settings.columns, ['To do', 'In progress', 'Done']);
  assert.equal(r.tasks.find((t) => t.id === 'd')!.column, 'In progress');
});

test('task → project and rate on the timer', () => {
  const data = {
    tasks: [{ id: 'tk', cost_centre_id: 'p1' }],
    centres: [{ id: 'p1', name: 'Website', kind: 'project' as const, active: true, created_at: '', hourly_rate: 3000 }],
    clients: [],
    workTypes: [],
    prefs: { default_rate: 500 },
  };
  const ctx = rc.rateContext({ client_id: 'c', task_id: 'tk' }, data);
  assert.equal((ctx.project as { id?: string } | null)?.id, 'p1', 'the task names its project');
  assert.deepEqual(rc.resolveRate(ctx), { rate: 3000, source: 'project' });
});

test('cost-centre delete is refused while tasks exist; project fields survive other editors', () => {
  resetStorage();
  const p = cc.saveCostCentre({ name: 'Website', kind: 'project', active: true, budget_minutes: 600, hourly_rate: 3000, start: '2026-10-01', status: 'active' });
  assert.equal(cc.loadCostCentres()[0].budget_minutes, 600);
  // Books → cost centres saves without the project fields: they are kept.
  cc.saveCostCentre({ id: p.id, name: 'Website v2', kind: 'project', active: true });
  assert.equal(cc.loadCostCentres()[0].hourly_rate, 3000);
  pj.saveTask({ cost_centre_id: p.id, title: 'Design', column: 'To do', estimate_minutes: 60 });
  assert.equal(cc.readCostCentreUsage(p.id).tasks, 1);
  assert.throws(() => cc.deleteCostCentre(p.id), /project tasks/);
  assert.match(cc.validateCostCentre({ name: 'X', kind: 'project', active: true, start: '2026-10-10', due: '2026-10-01' }, [])[0], /due date/);
});

test('a task with logged time cannot be deleted; settings normalise', () => {
  resetStorage();
  const t = pj.saveTask({ cost_centre_id: 'p1', title: 'Design', column: 'To do', estimate_minutes: 60 });
  ts.timeDb.save({ ...entry({ task_id: t.id }), id: undefined });
  assert.throws(() => pj.deleteTask(t.id), /Time is logged/);
  assert.deepEqual(pj.normalizeSettings(null).columns, ['To do', 'Doing', 'Done']);
  assert.deepEqual(pj.normalizeSettings({ columns: ['A', 'A', ' ', 'B'] }).columns, ['A', 'B']);
  const rows = pj.tasksToRows(pj.loadTasks(), [{ id: 'p1', name: 'Website', kind: 'project', active: true, created_at: '' }], ts.timeDb.all(), prefs, new Set());
  assert.deepEqual(rows[1].slice(0, 5), ['Website', 'Design', 'To do', 1, 1]);
});
