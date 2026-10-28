/**
 * R14 PS-B1 disbursements and the pure-agent GSTR fix: a pure-agent expense billed by the timesheet flow is left out of
 * GSTR-1 Table 8 / HSN, the e-Invoice item list (kept in OthChrg) and the e-Way item list (kept in OthValue) with the
 * document total unchanged; old invoices keep their nil-rated line and a guard lists them; kinds and defaults; TDS
 * base; unrecovered ageing and write-off.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { billUnbilled, liveInvoiceIds, PURE_AGENT_NOTE, unbilledFor, expenseLine } from '../src/lib/timesheets.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { preflightEInvoice, preflightEway } from '../src/lib/einvoice-validate.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import { withCharges } from '../src/lib/trade/tr-charges.ts';
import { gstExceptions } from '../src/lib/gst-guards.ts';
import { psExceptions } from '../src/lib/prof/ps-disb-guard.ts';
import {
  ageBuckets, disbursementPatch, disbursementSchedule, DISB_KINDS, isLegacyPureAgentLine, onBehalfByDefault,
  reverseDisbursementWriteOff, unrecoveredDisbursements, writeOffDisbursement,
} from '../src/lib/prof/ps-disb.ts';
import { feeBase as feeTdsBase } from '../src/lib/prof/ps-tds-recv.ts'; // QA17 R3: one fee base (PS-B's duplicate dropped)
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const fee = (over: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 'd1', kind: 'EXPENSE', vendor_name: 'Delhi High Court', bill_number: 'CF-778', date: '2026-10-05', category: 'Court fee',
  lines: [{ id: 'l', name: 'Court fee', quantity: 1, rate: 2450, tax_rate: 0 }], taxable: 2450, cgst: 0, sgst: 0, igst: 0,
  itc_eligible: false, total: 2450, amount_paid: 2450, ...over,
});

const billed = () => {
  purchasesDb.save({ ...fee(), ...disbursementPatch(fee(), 'court_fee', 'c-mh') } as PurchaseRecord);
  const draft = billUnbilled('c-mh', unbilledFor('c-mh'));
  localDb.invoices.save({ ...draft, status: 'Sent' });
  return localDb.invoices.getById(draft.id) as InvoiceRecord;
};

test('B1 regression: a timesheet pure-agent line is not a supply in GSTR-1 / e-Invoice / e-Way; the total is unchanged', () => {
  const rec = billed();
  const l = rec.items[0];
  assert.equal(l.charge_head_id, 'rule33', 'the line key survives save / load');
  assert.ok(isPureAgentLine(l));
  assert.equal(rec.total, 2450);
  const r = buildGstReport([rec], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(r.gstr1.nil, [], 'was reported as a nil-rated supply before the fix');
  assert.deepEqual(r.gstr1.hsn, []);
  assert.ok(r.issues.some((i: { code: string }) => i.code === 'PURE_AGENT'));
  const e = preflightEInvoice(rec, { now: new Date('2026-10-06') });
  assert.equal(e.payload?.ItemList?.length ?? 0, 0);
  const w = preflightEway(rec, { now: new Date('2026-10-06') });
  assert.equal((w.bill?.itemList ?? []).length, 0);
});

test('B1: e-Invoice keeps the reimbursement in OthChrg next to a fee line', () => {
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-10-05', lines: [{ name: 'Professional fees', hsn: '998211', qty: 1, rate: 20000, tax: 18 }] });
  const pa = expenseLine({ ...fee(), pure_agent: true, billable_to_client_id: 'c-mh' }, { ...DEFAULT_TIME_PREFS });
  localDb.invoices.save({ ...inv, items: [...inv.items, pa] });
  const rec = localDb.invoices.getById(inv.id) as InvoiceRecord;
  const e = preflightEInvoice(rec, { now: new Date('2026-10-06') });
  assert.equal(e.payload!.ItemList.length, 1);
  assert.equal(e.payload!.ValDtls.AssVal, 20000);
  assert.equal(e.payload!.ValDtls.OthChrg, 2450);
  const r = buildGstReport([rec], [], { period: { kind: 'month', fyStart: 2026, month: 10 } });
  assert.deepEqual(r.gstr1.hsn.map((h: { hsn: string; taxable: number }) => [h.hsn, h.taxable]), [['998211', 20000]]);
  assert.equal(feeTdsBase(rec), 20000, 'TDS base: fees only, no GST, no pure-agent recovery');
});

test('B1: an old invoice keeps its nil-rated line; the guard lists it', () => {
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-09-05', lines: [{ name: 'Reimbursement — Court fee', qty: 1, rate: 500, tax: 0 }] });
  localDb.invoices.save({ ...inv, items: inv.items.map((i) => ({ ...i, description: `5 Sep · ${PURE_AGENT_NOTE}` })) });
  const rec = localDb.invoices.getById(inv.id) as InvoiceRecord;
  assert.ok(isLegacyPureAgentLine(rec.items[0]));
  assert.ok(!isPureAgentLine(rec.items[0]));
  const r = buildGstReport([rec], [], { period: { kind: 'month', fyStart: 2026, month: 9 } });
  assert.equal(r.gstr1.nil.length > 0, true, 'reported as before');
  assert.deepEqual(psExceptions(rec).map((x) => [x.code, x.vars.n]), [['PS_PURE_AGENT_OLD', 1]]);
  assert.equal(feeTdsBase(rec), 0);
  void gstExceptions; // the check is registered lazily for service companies
});

test('B1: kinds and defaults — court fee / stamp / government fees on behalf, travel and courier part of the fee', () => {
  assert.equal(DISB_KINDS.length, 8);
  for (const k of ['court_fee', 'stamp', 'govt_fee', 'filing'] as const) assert.equal(onBehalfByDefault(k, '2026-10-05'), true, k);
  for (const k of ['travel', 'courier', 'notary', 'other'] as const) assert.equal(onBehalfByDefault(k, '2026-10-05'), false, k);
  const p = disbursementPatch({ date: '2026-10-05', itc_eligible: true }, 'stamp', 'c-mh', { matterId: 'cc1' });
  assert.deepEqual(p, { ps: { disb: 'stamp', on_behalf: true }, billable_to_client_id: 'c-mh', cost_centre_id: 'cc1', pure_agent: true, markup_percent: undefined, itc_eligible: false });
  const t = disbursementPatch({ date: '2026-10-05', itc_eligible: true }, 'travel', 'c-mh');
  assert.deepEqual([t.pure_agent, t.markup_percent, t.itc_eligible, t.ps.on_behalf], [undefined, 0, true, false]);
  const line = expenseLine({ ...fee({ id: 't', total: 1180, taxable: 1000, cgst: 90, sgst: 90, itc_eligible: true }), ...t } as PurchaseRecord, { ...DEFAULT_TIME_PREFS, gst_rate: 18 });
  assert.equal(line.charge_head_id, undefined, 'part of the fee: taxable, no pure-agent key');
  assert.equal(line.rate, 1000);
});

test('B1: unrecovered disbursements age, bill away and can be written off (and back, by the owner)', () => {
  purchasesDb.save({ ...fee(), ...disbursementPatch(fee(), 'court_fee', 'c-mh') } as PurchaseRecord);
  purchasesDb.save({ ...fee({ id: 'd2', bill_number: 'ST-1', date: '2026-08-01', total: 500, taxable: 500 }), ...disbursementPatch(fee(), 'stamp', 'c-mh') } as PurchaseRecord);
  purchasesDb.save({ ...fee({ id: 'x', billable_to_client_id: 'c-mh', pure_agent: true }) }); // not tagged: not a disbursement
  const live = () => liveInvoiceIds(localDb.invoices.getAll());
  const isBilled = (id: string) => (live().byRow.get(id) ?? []).length > 0;
  const rows = unrecoveredDisbursements(purchasesDb.all(), isBilled, '2026-10-27');
  assert.deepEqual(rows.map((r) => [r.id, r.age, r.amount, r.kind]), [['d2', 87, 500, 'stamp'], ['d1', 22, 2450, 'court_fee']]);
  assert.deepEqual(ageBuckets(rows), [2450, 0, 500, 0]);
  writeOffDisbursement('d2', '2026-10-27', 'Client absconded');
  assert.throws(() => writeOffDisbursement('d2', '2026-10-27', 'again'), /Already/);
  assert.throws(() => writeOffDisbursement('d1', '2026-10-27', ' '), /reason/);
  assert.deepEqual(unrecoveredDisbursements(purchasesDb.all(), isBilled, '2026-10-27').map((r) => r.id), ['d1']);
  reverseDisbursementWriteOff('d2');
  assert.equal(unrecoveredDisbursements(purchasesDb.all(), isBilled, '2026-10-27').length, 2);
  const draft = billUnbilled('c-mh', unbilledFor('c-mh'));
  assert.deepEqual(unrecoveredDisbursements(purchasesDb.all(), isBilled, '2026-10-27'), []);
  const sched = disbursementSchedule(draft, purchasesDb.all());
  assert.deepEqual(sched.map((s) => `${s.kind}|${s.ref}|${s.amount}`).sort(), ['court_fee|CF-778|2450', 'stamp|ST-1|500', '|CF-778|2450'].sort());
});

test('B1: the R8 charge-strip recompute keeps a pure-agent line (no head of that id)', () => {
  const pa = { id: 'p', name: 'Reimbursement', quantity: 1, rate: 100, tax_rate: 0, hsn: '', charge_head_id: 'rule33' };
  const goods = { id: 'g', name: 'Fees', quantity: 1, rate: 1000, tax_rate: 18, hsn: '998211' };
  const out = withCharges([goods, pa] as never[], [], new Set(['rule33']), (c) => c as never);
  assert.deepEqual(out.map((l: { id: string }) => l.id), ['g', 'p']);
});
