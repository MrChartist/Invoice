/** PS-A4 WIP: ageing buckets by matter / client, cap left; write-off stamps and leaves the Unbilled list; owner reverses; locked period refused. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { DEFAULT_TIME_PREFS, type TimeEntry } from '../src/types/time.ts';
import { timeDb, unbilledTime, unbilledExpenses } from '../src/lib/timesheets.ts';
import { setTable } from '../src/lib/storage.ts';
import { reverseWriteOff, wipRows, writeOffWip } from '../src/lib/prof/ps-wip.ts';
import type { CostCentre } from '../src/lib/cost-centres.ts';
import type { Engagement } from '../src/types/prof-r14.ts';

const te = (id: string, date: string, minutes: number, cc?: string): TimeEntry => ({ id, client_id: 'c1', client_name: 'Acme', description: 'w', date, minutes, hourly_rate: 1000, billable: true, ...(cc ? { cost_centre_id: cc } : {}) });

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

test('ageing by matter with the engagement model and cap left; by client', () => {
  const centres = [{ id: 'm1', name: 'Audit', kind: 'project', active: true, created_at: '', ps: { code: 'A/001', kind: 'matter', opened: '2026-01-01', parties: [] } }] as CostCentre[];
  const eng = { id: 'e1', number: 'ENG/1', client_id: 'c1', matter_ids: ['m1'], title: 'T', model: 'capped', cap: 10000, currency: 'INR', disb_policy: 'agent', start: '2026-01-01', status: 'active', created_at: '' } as Engagement;
  const rows = wipRows([te('a', '2026-06-25', 60, 'm1'), te('b', '2026-05-15', 120, 'm1'), te('c', '2026-01-01', 60)], [{ id: 'p1', date: '2026-06-01', billable_to_client_id: 'c1', vendor_name: 'Court', total: 500, taxable: 500, cost_centre_id: 'm1' } as never], { prefs: DEFAULT_TIME_PREFS, today: '2026-06-30', buckets: [30, 60, 90], by: 'matter', centres, engagements: [eng], capUsed: () => 4000 });
  const m = rows.find((r) => r.key === 'm1')!;
  assert.deepEqual([m.label, m.hours, m.time, m.costs, m.aged, m.oldest, m.model, m.capLeft], ['A/001 — Audit', 3, 3000, 500, [1500, 2000, 0, 0], '2026-05-15', 'capped', 6000]);
  assert.deepEqual(rows.find((r) => r.key === 'client:Acme')!.aged, [0, 0, 0, 1000], 'older than the last bucket');
  assert.equal(wipRows([te('a', '2026-06-25', 60, 'm1'), te('c', '2026-01-01', 60)], [], { prefs: DEFAULT_TIME_PREFS, today: '2026-06-30', buckets: [30], by: 'client', centres }).length, 1);
});

test('write-off leaves the Unbilled list (time and costs); the owner reverses; a locked period is refused', () => {
  timeDb.save(te('a', '2026-06-25', 60));
  setTable('purchases', [{ id: 'p1', date: '2026-06-01', billable_to_client_id: 'c1', total: 500, taxable: 500 }]);
  assert.throws(() => writeOffWip(['a'], [], ' ', '2026-06-30'), /reason/);
  assert.equal(writeOffWip(['a'], ['p1'], 'Inefficiency', '2026-06-30'), 2);
  assert.equal(timeDb.all()[0].ps?.wo?.reason, 'Inefficiency');
  assert.deepEqual(unbilledTime(timeDb.all(), new Set()), []);
  assert.deepEqual(unbilledExpenses(localDb.invoices.getAll() as never, new Set()), []);
  setActorProvider(() => ({ id: 'u2', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => reverseWriteOff(['a']));
  setActorProvider(null);
  assert.equal(reverseWriteOff(['a'], ['p1']), 2);
  assert.equal(timeDb.all()[0].ps, undefined);
  assert.equal(unbilledTime(timeDb.all(), new Set()).length, 1);
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-06-30' } as never);
  assert.throws(() => writeOffWip(['a'], [], 'x', '2026-07-01'), /lock|Lock|period/i);
});
