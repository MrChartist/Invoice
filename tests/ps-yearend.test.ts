/** PS-A4 year-end unbilled work: unbilled on the closing date, expected write-down, completed-service rows, accrual on / off, reversal next day, no GST rows. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DEFAULT_TIME_PREFS, type TimeEntry } from '../src/types/time.ts';
import { accrualOn, postAccrual, yearEndPaper } from '../src/lib/prof/ps-yearend.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import type { CostCentre } from '../src/lib/cost-centres.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const te = (id: string, date: string, minutes: number, cc?: string, extra: Partial<TimeEntry> = {}): TimeEntry => ({ id, client_id: 'c1', client_name: 'Acme', description: '', date, minutes, hourly_rate: 1000, billable: true, ...(cc ? { cost_centre_id: cc } : {}), ...extra });

test('unbilled on the closing date less the expected write-down; billed after the date still counts; completed-service rows at nil', () => {
  const centres = [{ id: 'm1', name: 'Audit', kind: 'project', active: true, created_at: '', ps: { code: 'A/1', kind: 'matter', opened: '2026-01-01', parties: [] } }, { id: 'm2', name: 'Quick', kind: 'project', active: true, created_at: '' }] as CostCentre[];
  const engagements = [{ id: 'e2', number: 'ENG/2', client_id: 'c1', matter_ids: ['m2'], title: 'Q', model: 'fixed', fee: 1, currency: 'INR', disb_policy: 'agent', start: '2027-03-01', end: '2027-04-15', status: 'active', created_at: '' }] as never[];
  const entries = [te('a', '2027-03-10', 600, 'm1'), te('b', '2027-03-20', 300, 'm1'), te('c', '2027-04-02', 600, 'm1'), te('d', '2027-03-25', 120, 'm2'), te('w', '2027-03-01', 60, 'm1', { ps: { wo: { date: '2027-03-30', reason: 'x' } } })];
  const invoices = [{ id: 'i1', issue_date: '2027-04-05', items: [{ id: 'l', bill_refs: ['b'] }] }, { id: 'i0', issue_date: '2027-03-15', items: [{ id: 'l', bill_refs: ['a'] }] }] as never[];
  const p = yearEndPaper({ closing: '2027-03-31', prefs: DEFAULT_TIME_PREFS, entries, costs: [{ id: 'p', date: '2027-03-12', billable_to_client_id: 'c1', total: 400, taxable: 400 } as never], invoices, centres, engagements, realisationOf: () => 0.8 });
  const m1 = p.rows.find((r) => r.key === 'm1')!;
  assert.deepEqual([m1.standard, m1.realisation, m1.net, m1.method], [5000, 0.8, 4000, 'poc'], 'b billed after the closing date is still unbilled on it; a billed before; w written off; c after');
  assert.deepEqual(p.rows.find((r) => r.key === 'm2')!.method, 'completed');
  assert.equal(p.rows.find((r) => r.key === 'm2')!.net, 0);
  const over = yearEndPaper({ closing: '2027-03-31', prefs: DEFAULT_TIME_PREFS, entries, costs: [], invoices, centres, overrides: { m1: 1 } });
  assert.equal(over.rows.find((r) => r.key === 'm1')!.net, 5000);
});

test('the dated accrual: off by default; one journal reversed the next day; once per closing date; no invoice or GST row', async () => {
  assert.equal(accrualOn(undefined, '2027-03-31'), false);
  assert.equal(accrualOn('2027-03-31', '2026-03-31'), false);
  assert.equal(accrualOn('2027-03-31', '2027-03-31'), true);
  const n = localDb.invoices.getAll().length;
  const no = await postAccrual(4000, '2027-03-31');
  const v = loadVouchers().find((x) => x.number === no)!;
  assert.deepEqual([v.date, v.reverse_on, v.lines.map((l) => [l.dr, l.cr])], ['2027-03-31', '2027-04-01', [[400000, 0], [0, 400000]]]);
  await assert.rejects(postAccrual(4000, '2027-03-31'), /already posted/);
  assert.equal(localDb.invoices.getAll().length, n);
});
