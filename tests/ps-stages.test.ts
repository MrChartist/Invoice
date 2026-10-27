/** R14 PS-B4 stage fees on project cost: maths, revisions up / down, credit-note suggestion, extra %, rupee rounding. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billedOnEngagement, costOn, exampleStages, feeOn, stageBill, stageSchedule, validatePlan, type StagePlan } from '../src/lib/prof/ps-stages.ts';
import { DESIGN_STAGE_EXAMPLE } from '../src/lib/prof/ps-b-rules.ts';

const plan = (over: Partial<StagePlan> = {}): StagePlan => ({
  fee_pct: 6, cost_basis: 'estimate', revisions: [{ date: '2026-04-01', cost: 42000000 }], stages: exampleStages(), property: { state: 'Maharashtra', city: 'Pune' }, ...over,
});

test('the example stages are an example, cumulative to 100', () => {
  assert.deepEqual(exampleStages().map((s) => s.cum_pct), [10, 30, 50, 75, 100]);
  assert.equal(DESIGN_STAGE_EXAMPLE[0].verified, false);
  assert.match(DESIGN_STAGE_EXAMPLE[0].source!, /Example only/);
  assert.equal(validatePlan(plan()), '');
  assert.match(validatePlan(plan({ stages: [{ id: 'a', label: 'A', cum_pct: 50 }, { id: 'b', label: 'B', cum_pct: 40 }] })), /cumulative/);
  assert.match(validatePlan(plan({ fee_pct: 0 })), /fee/);
});

test('₹4.2 crore at 6 %: stages 1–2, then a revision to ₹4.6 crore — stage 3 catches up', () => {
  const p = plan();
  assert.equal(feeOn(p, '2026-05-01'), 2520000);
  const s1 = stageBill(p, 's1', '2026-05-01', 0);
  assert.deepEqual([s1.cumulative, s1.amount], [252000, 252000]);
  const s2 = stageBill(p, 's2', '2026-07-01', s1.amount);
  assert.equal(s2.amount, 504000);
  const rev = plan({ revisions: [...p.revisions, { date: '2026-09-15', cost: 46000000, note: 'After tender' }], cost_basis: 'tender' });
  assert.equal(costOn(rev, '2026-09-14'), 42000000);
  const s3 = stageBill(rev, 's3', '2026-10-01', 756000);
  assert.deepEqual([s3.cost, s3.fee, s3.cumulative, s3.amount, s3.credit], [46000000, 2760000, 1380000, 624000, 0]);
  assert.equal(s3.amount - 504000, 120000, 'the extra 4 % of fee on stages 1–2 (₹24,000) and the stage-3 share of it');
});

test('a downward revision suggests a credit note; extra % and rupee rounding', () => {
  const down = plan({ revisions: [{ date: '2026-04-01', cost: 42000000 }, { date: '2026-09-01', cost: 30000000 }] });
  const b = stageBill(down, 's2', '2026-10-01', 756000);
  assert.deepEqual([b.amount, b.credit], [0, 216000]);
  const extra = plan({ extra_pct: 10, revisions: [{ date: '2026-04-01', cost: 1234567 }] });
  assert.equal(feeOn(extra, '2026-05-01'), 81481.42);
  assert.equal(stageBill(extra, 's1', '2026-05-01', 0).amount, 8148);
  assert.deepEqual(stageSchedule(plan(), '2026-05-01').map((r) => r.cumulative), [252000, 756000, 1260000, 1890000, 2520000]);
  assert.throws(() => stageBill(plan(), 'nope', '2026-05-01', 0), /stage/);
});

test('already billed: live stage bills of the engagement less their credit notes', () => {
  const inv = (id: string, v: number, over: Record<string, unknown> = {}) => ({ id, doc_type: 'TAX_INVOICE', status: 'Sent', taxable_value: v, ps: { engagement: { id: 'e1' }, kind: 'stage' }, ...over });
  const rows = [inv('a', 252000), inv('b', 504000), inv('c', 1, { status: 'Cancelled' }), inv('d', 9, { ps: { engagement: { id: 'e2' } } }), { id: 'cn', doc_type: 'CREDIT_NOTE', status: 'Sent', taxable_value: 2000 }];
  assert.equal(billedOnEngagement('e1', rows, [{ relation: 'credit_note', from_id: 'b', to_id: 'cn' }] as never), 754000);
});

test('the stage snapshot for the paper', async () => {
  const { stageSnap } = await import('../src/lib/prof/ps-stages.ts');
  assert.deepEqual(stageSnap(plan(), 's3', '2026-10-01', 756000), { no: 3, of: 5, label: 'Working drawings and tender', project_cost: 42000000, fee_pct: 6, stage_pct: 50, billed_before: 756000 });
});

test('a stage bill: the property State is the place of supply for a client abroad; the next stage catches up', async () => {
  const { resetStorage } = await import('./helpers/shim.ts');
  const { installSettings } = await import('./helpers/world.ts');
  const { localDb } = await import('../src/lib/localDb.ts');
  const { createStageBill } = await import('../src/lib/prof/ps-stages.ts');
  resetStorage();
  installSettings();
  localDb.clients.upsert({ id: 'dxb', name: 'Mr A. Khan (Dubai)', email: '', address: 'Dubai', city: 'Dubai', zip: '', state_code: '96', country: 'AE' } as never);
  const e = { id: 'e1', number: 'ENG/FY26-27/0001', model: 'milestone', client_id: 'dxb', stage: plan({ property: { state: 'Karnataka', city: 'Bengaluru', country: 'India' } }) };
  const s1 = createStageBill(e, 's1', '2026-05-01');
  assert.deepEqual([s1.place_of_supply, s1.gst_mode, s1.taxable_value, s1.igst_amount], ['29', 'IGST', 252000, 45360]);
  assert.match(s1.items[0].name, /stage 1 of 5: Concept design/);
  localDb.invoices.save({ ...s1, status: 'Sent' } as never);
  const rev = { ...e, stage: { ...e.stage, revisions: [...e.stage.revisions, { date: '2026-09-15', cost: 46000000 }] } };
  const s2 = createStageBill(rev, 's2', '2026-10-01');
  assert.equal(s2.taxable_value, Math.round(2760000 * 0.3) - 252000);
  assert.throws(() => createStageBill(e, 's1', '2026-10-01'), /Nothing is due/);
});
