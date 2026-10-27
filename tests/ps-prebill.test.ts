/** PS-A3 pre-bill and billing models: standard value, write-up / write-down, each model, bill_refs as billUnbilled's, annexure fields, cancel frees. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, clientMH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DEFAULT_TIME_PREFS, type TimeEntry } from '../src/types/time.ts';
import { currentLiveInvoiceIds, readTimePrefs, timeDb, unbilledTime } from '../src/lib/timesheets.ts';
import { saveMatter } from '../src/lib/prof/ps-matters.ts';
import { saveEngagement, type EngagementInput } from '../src/lib/prof/ps-engagements.ts';
import { planBill } from '../src/lib/prof/ps-models.ts';
import { createPrebillDraft, prebillFor } from '../src/lib/prof/ps-prebill.ts';
import { docBilling } from '../src/lib/prof/ps-writedown.ts';

const P = DEFAULT_TIME_PREFS;
const money = (n: number) => `₹${n}`;
const te = (id: string, date: string, minutes: number, rate: number, extra: Partial<TimeEntry> = {}): TimeEntry => ({ id, client_id: clientMH.id, client_name: clientMH.name, description: 'Work', date, minutes, hourly_rate: rate, billable: true, ...extra });

beforeEach(() => {
  resetStorage();
  installSettings({ prof_kind: 'consulting', industry_packs: ['practice'] } as never);
  localDb.clients.upsert(clientMH);
  freezeDate('2026-06-30T10:00:00');
});
afterEach(() => thawDate());

function matterWith(model: Partial<EngagementInput>) {
  const m = saveMatter({ name: 'Sec 138', client_id: clientMH.id, ps: { code: 'RSK/014', kind: 'matter', opened: '2026-06-01', parties: [] } });
  const e = saveEngagement({ client_id: clientMH.id!, matter_ids: [m.id], title: 'Defence', model: 'hourly', currency: 'INR', disb_policy: 'agent', start: '2026-06-01', status: 'active', ...model }).row;
  timeDb.save(te('t1', '2026-06-02', 300, 4000, { cost_centre_id: m.id }));
  timeDb.save(te('t2', '2026-06-10', 330, 4000, { cost_centre_id: m.id }));
  timeDb.save(te('t3', '2026-06-20', 240, 4000, { cost_centre_id: m.id }));
  return { m, e };
}

test('pure models: hourly target, blended, capped (date order), fixed / milestone / success / retainer cover time; exclude and defer', () => {
  const rows = [te('a', '2026-06-01', 600, 4000), te('b', '2026-06-02', 270, 4000)];
  const h = planBill(rows, {}, undefined, { prefs: P, money, target: 29000 });
  assert.equal(h.time.reduce((s, e) => s + (e.minutes / 60) * e.hourly_rate, 0), 29000);
  const capped = { id: 'e', number: 'ENG/1', client_id: 'c', matter_ids: [], title: 'T', currency: 'INR', disb_policy: 'agent', start: '2026-06-01', status: 'active', created_at: '' } as const;
  const c = planBill(rows, {}, { ...capped, model: 'capped', cap: 40000 }, { prefs: P, money, used: 0 });
  assert.deepEqual(c.time.map((e) => [e.id, e.minutes, e.hourly_rate]), [['a', 600, 4000], ['b', 0 + 270, 0]], 'the cap stops billing; the rest covered at 0');
  assert.deepEqual([c.basis, c.reason], ['Capped at ₹40000 (₹40000 used)', 'Cap']);
  const part = planBill(rows, {}, { ...capped, model: 'capped', cap: 50000 }, { prefs: P, money, used: 0 });
  assert.deepEqual(part.time.map((e) => [e.minutes, e.hourly_rate]), [[600, 4000], [150, 4000]], 'the crossing entry is cut to the cap');
  assert.deepEqual(planBill(rows, {}, { ...capped, model: 'blended', blended_rate: 3000 }, { prefs: P, money }).time.map((e) => e.hourly_rate), [3000, 3000]);
  const fx = planBill(rows, {}, { ...capped, model: 'fixed', fee: 60000 }, { prefs: P, money, feesBefore: 20000 });
  assert.deepEqual([fx.fees.map((f) => f.amount), fx.covered], [[40000], ['a', 'b']]);
  const ms = { ...capped, model: 'milestone' as const, fee: 60000, milestones: [{ id: 'm1', label: 'Filing', pct: 50 }, { id: 'm2', label: 'Trial', pct: 50 }] };
  assert.deepEqual(planBill(rows, {}, ms, { prefs: P, money, milestoneIds: ['m1', 'm2'], milestonesBilled: ['m1'] }).fees.map((f) => [f.milestone, f.amount]), [['m2', 30000]]);
  const sc = { ...capped, model: 'success' as const, success: { basis: 'recovery', event: 'Decree', pct: 10, base_amount: 500000 } };
  assert.throws(() => planBill(rows, {}, sc, { prefs: P, money }), /success event/);
  assert.deepEqual(planBill(rows, {}, { ...sc, success: { ...sc.success, done_on: '2026-06-20' } }, { prefs: P, money }).fees.map((f) => f.amount), [50000]);
  assert.deepEqual(planBill(rows, {}, { ...capped, model: 'retainer', fee: 25000 }, { prefs: P, money }).fees.map((f) => f.amount), [25000]);
  const ed = planBill(rows, { a: { exclude: true }, b: { defer: true } }, undefined, { prefs: P, money });
  assert.deepEqual([ed.time.map((e) => [e.id, e.hourly_rate]), ed.covered], [[['a', 0]], ['a']]);
});

test('capped engagement: 14.5 h worth ₹58,000 billed at ₹40,000 → write-down ₹18,000 "Cap"; bill_refs and annexure; cancel frees', () => {
  const { m, e } = matterWith({ model: 'capped', cap: 40000 });
  const view = prebillFor(clientMH.id!, m.id);
  assert.equal(view.standard, 58000);
  assert.equal(view.engagement?.id, e.id);
  const inv = createPrebillDraft({ key: clientMH.id!, projectId: m.id, annexure: true });
  assert.equal(inv.taxable_value, 40000);
  assert.deepEqual(inv.ps?.wd, { standard: 58000, billed: 40000, reasons: [{ reason: 'Cap', amount: -18000 }] });
  assert.equal(inv.ps?.matter?.code, 'RSK/014');
  assert.equal(inv.ps?.engagement?.number, e.number);
  assert.match(inv.ps!.basis!, /^Capped at/);
  assert.deepEqual(inv.items.flatMap((i) => i.bill_refs ?? []).sort(), ['t1', 't2', 't3'], 'every entry billed by the draft');
  assert.deepEqual(unbilledTime(timeDb.all(), currentLiveInvoiceIds(), undefined, readTimePrefs()), []);
  const ann = inv.annexure!.rows;
  assert.deepEqual(ann.map((r) => r.standard), [20000, 22000, 16000]);
  assert.equal(ann.reduce((s, r) => s + (r.billed ?? 0), 0), 40000);
  const b = docBilling(inv, new Map(timeDb.all().map((x) => [x.id, x])), readTimePrefs());
  assert.deepEqual([b!.standard, b!.billed], [58000, 40000]);
  localDb.invoices.save({ ...localDb.invoices.getById(inv.id)!, status: 'Cancelled' });
  assert.equal(unbilledTime(timeDb.all(), currentLiveInvoiceIds(), undefined, readTimePrefs()).length, 3, 'a cancelled note frees its entries');
  const again = createPrebillDraft({ key: clientMH.id!, projectId: m.id });
  assert.equal(again.taxable_value, 40000, 'the cancelled note does not use the cap');
});

test('fixed fee: time covered at 0 on the paper, the fee line once, write-up when the fee beats the time', () => {
  const { m } = matterWith({ model: 'fixed', fee: 60000 });
  const inv = createPrebillDraft({ key: clientMH.id!, projectId: m.id });
  const fee = inv.items.find((i) => inv.ps?.lines?.[i.id]?.fee)!;
  assert.equal(fee.amount, 60000);
  assert.ok(inv.items.filter((i) => i.bill_refs?.length).every((i) => i.amount === 0 && inv.ps!.lines![i.id].covered));
  assert.deepEqual(inv.ps?.wd?.reasons, [{ reason: 'Fixed fee', amount: 2000 }]);
  assert.throws(() => createPrebillDraft({ key: clientMH.id!, projectId: m.id }), /Nothing to bill/, 'no time left, fee already billed');
});
