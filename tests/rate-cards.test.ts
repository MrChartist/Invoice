/**
 * R3-B1 rate cards: resolution order, captured rates, re-rate unbilled, work-type SAC.
 */
import { resetStorage } from './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

const rc = await import('../src/lib/rate-cards.ts');
const ts = await import('../src/lib/timesheets.ts');
import type { TimeEntry } from '../src/types/time.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';

const prefs = { ...DEFAULT_TIME_PREFS, default_rate: 1000, sac: '998311' };
const wtAudit = { id: 'wt-audit', name: 'Audit', rate: 4000, sac: '998221' };
const data = {
  tasks: [{ id: 'task1', cost_centre_id: 'p1', rate: 5000 }, { id: 'task2', cost_centre_id: 'p1' }],
  centres: [{ id: 'p1', name: 'Website', kind: 'project' as const, active: true, created_at: '', hourly_rate: 3500 }, { id: 'p2', name: 'Plain', kind: 'project' as const, active: true, created_at: '' }],
  clients: [{ id: 'cA', name: 'A', email: '', address: '', city: '', zip: '', doc_defaults: { hourly_rate: 2500 } }, { id: 'cB', name: 'B', email: '', address: '', city: '', zip: '' }],
  workTypes: [wtAudit, { id: 'wt-off', name: 'Old', rate: 9999, inactive: true }],
  prefs,
};

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  client_id: 'cB',
  client_name: 'B',
  description: 'Work',
  date: '2026-10-19',
  minutes: 60,
  hourly_rate: 1000,
  billable: true,
  ...over,
});

test('each level of the resolution order wins in turn', () => {
  const all = { client_id: 'cA', task_id: 'task1', cost_centre_id: 'p1', work_type_id: 'wt-audit' };
  assert.deepEqual(rc.resolveEntryRate(all, data), { rate: 5000, source: 'task' });
  // A task without its own rate falls through to its project.
  assert.deepEqual(rc.resolveEntryRate({ ...all, task_id: 'task2' }, data), { rate: 3500, source: 'project' });
  assert.deepEqual(rc.resolveEntryRate({ client_id: 'cA', cost_centre_id: 'p2', work_type_id: 'wt-audit' }, data), { rate: 2500, source: 'client' });
  assert.deepEqual(rc.resolveEntryRate({ client_id: 'cB', work_type_id: 'wt-audit' }, data), { rate: 4000, source: 'work_type' });
  assert.deepEqual(rc.resolveEntryRate({ client_id: 'cB' }, data), { rate: 1000, source: 'default' });
});

test('inactive work type is ignored', () => {
  assert.deepEqual(rc.resolveEntryRate({ client_id: 'cB', work_type_id: 'wt-off' }, data), { rate: 1000, source: 'default' });
  assert.deepEqual(rc.pickableWorkTypes(data.workTypes).map((w) => w.id), ['wt-audit']);
  assert.deepEqual(rc.pickableWorkTypes(data.workTypes, 'wt-off').map((w) => w.id).sort(), ['wt-audit', 'wt-off']);
});

test('captured rate is unchanged after a card edit', () => {
  resetStorage();
  const captured = rc.resolveEntryRate({ client_id: 'cB', work_type_id: 'wt-audit' }, data).rate;
  const saved = ts.timeDb.save({ ...entry({ work_type_id: 'wt-audit' }), id: undefined, hourly_rate: captured });
  // The work type's rate goes up later: the logged entry keeps what it captured.
  const after = { ...data, workTypes: [{ ...wtAudit, rate: 6000 }] };
  assert.equal(ts.timeDb.all().find((e) => e.id === saved.id)!.hourly_rate, 4000);
  assert.equal(rc.resolveEntryRate({ client_id: 'cB', work_type_id: 'wt-audit' }, after).rate, 6000);
});

test('re-rate touches unbilled entries only', () => {
  const billed = entry({ id: 'billed', work_type_id: 'wt-audit', invoiced_in: 'inv1' });
  const open = entry({ id: 'open', work_type_id: 'wt-audit' });
  const same = entry({ id: 'same', hourly_rate: 1000 });
  const live = ts.liveInvoiceIds([{ id: 'inv1', status: 'Sent', items: [{ bill_refs: ['billed'] }] }]);
  const unbilled = ts.unbilledTime([billed, open, same], live);
  const changes = rc.reRate(unbilled, data);
  assert.deepEqual(changes.map((c) => [c.id, c.from, c.to, c.source]), [['open', 1000, 4000, 'work_type']]);
  const next = rc.applyReRate([billed, open, same], changes);
  assert.equal(next.find((e) => e.id === 'billed')!.hourly_rate, 1000);
  assert.equal(next.find((e) => e.id === 'open')!.hourly_rate, 4000);
});

test('commitReRate writes only the previewed rows and skips none when unlocked', () => {
  resetStorage();
  const a = ts.timeDb.save({ ...entry({ work_type_id: 'wt-audit' }), id: undefined });
  const b = ts.timeDb.save({ ...entry(), id: undefined });
  const n = rc.commitReRate([{ id: a.id, date: a.date, description: '', from: 1000, to: 4000, source: 'work_type' }]);
  assert.equal(n, 1);
  assert.equal(ts.timeDb.all().find((e) => e.id === a.id)!.hourly_rate, 4000);
  assert.equal(ts.timeDb.all().find((e) => e.id === b.id)!.hourly_rate, 1000);
});

test('work-type SAC reaches the invoice line, and lines split by work type', () => {
  const lines = ts.timeLines([entry({ id: 'x1', work_type_id: 'wt-audit', hourly_rate: 4000 }), entry({ id: 'x2', hourly_rate: 4000 })], prefs, [], data.workTypes);
  assert.equal(lines.length, 2);
  const audit = lines.find((l) => l.bill_refs?.includes('x1'))!;
  const plain = lines.find((l) => l.bill_refs?.includes('x2'))!;
  assert.equal(audit.hsn, '998221');
  assert.equal(plain.hsn, '998311');
  assert.equal(rc.sacFor({ work_type_id: 'wt-off' }, data.workTypes, '998311'), '998311', 'a work type without a SAC uses the preference');
});

test('work types: validation, save and delete-or-deactivate', () => {
  resetStorage();
  assert.match(rc.validateWorkType({ name: ' ', rate: 1 }, []), /name/);
  assert.match(rc.validateWorkType({ name: 'Audit', rate: 1, sac: '12' }, []), /SAC/);
  const w = rc.saveWorkType({ name: 'Audit', rate: 4000, sac: '998221' });
  assert.throws(() => rc.saveWorkType({ name: 'audit', rate: 1 }), /already exists/);
  ts.timeDb.save({ ...entry({ work_type_id: w.id }), id: undefined });
  assert.equal(rc.deleteWorkType(w.id), 'inactive');
  assert.equal(rc.loadWorkTypes()[0].inactive, true);
  const other = rc.saveWorkType({ name: 'Drafting', rate: 1500 });
  assert.equal(rc.deleteWorkType(other.id), 'deleted');
});
