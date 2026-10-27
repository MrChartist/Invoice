/** PS-A4 profitability: fees − staff cost at dated cost rates − unrecovered costs, by matter / client / engagement. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIME_PREFS, type TimeEntry } from '../src/types/time.ts';
import type { ServiceStaff } from '../src/types/services-r10.ts';
import { profitability } from '../src/lib/prof/ps-profit.ts';

const te = (id: string, date: string, minutes: number, cc: string): TimeEntry => ({ id, client_id: 'c1', client_name: 'Acme', description: '', date, minutes, hourly_rate: 4000, billable: true, staff_id: 's1', cost_centre_id: cc });
const staff = new Map<string, ServiceStaff>([['s1', { id: 's1', name: 'Asha', role: 'other', employment: 'employee', created_at: '', ps: { rates: [{ from: '2026-01-01', standard_rate: 4000, cost_rate: 1500 }, { from: '2026-06-15', standard_rate: 4000, cost_rate: 2000 }] } }]]);

test('contribution and margin by matter; engagement key; unrecovered costs', () => {
  const entries = [te('a', '2026-06-02', 300, 'm1'), te('b', '2026-06-20', 300, 'm1'), te('c', '2026-06-21', 120, 'm2')];
  const invoices = [{ id: 'i1', issue_date: '2026-06-30', items: [{ id: 'l', amount: 30000, bill_refs: ['a', 'b'] }], ps: {} }] as never[];
  const costs = [{ id: 'p', date: '2026-06-10', total: 2500, taxable: 2500, cost_centre_id: 'm1', billable_to_client_id: 'c1', ps: { wo: { date: '2026-06-25', reason: 'x' } } }] as never[];
  const rows = profitability({ from: '2026-06-01', to: '2026-06-30', by: 'matter', prefs: DEFAULT_TIME_PREFS, invoices, entries, costs, staff });
  const m1 = rows.find((r) => r.key === 'm1')!;
  assert.deepEqual([m1.fees, m1.cost, m1.unrecovered, m1.contribution, m1.margin], [30000, 17500, 2500, 10000, 33.33]);
  assert.deepEqual(rows.find((r) => r.key === 'm2'), { key: 'm2', fees: 0, cost: 4000, unrecovered: 0, contribution: -4000, margin: null });
  const byEng = profitability({ from: '2026-06-01', to: '2026-06-30', by: 'engagement', prefs: DEFAULT_TIME_PREFS, invoices, entries, costs, staff, engOf: (m) => (m === 'm1' ? 'e1' : undefined) });
  assert.equal(byEng.find((r) => r.key === 'e1')!.fees, 30000);
});
