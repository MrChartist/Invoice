/**
 * QA round 16 (Round 13 MF-D food / FMCG and statutory desk, QA15 leftovers): regression tests for the findings in
 * docs/prd/qa-round-16.md (P1 …).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setTable } from '../src/lib/storage.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { blankStockItem, stockDb } from '../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs, splitLineByFefo } from '../src/lib/stock-tracking.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { buildIssueLines, loadOrderDocs, materialRows, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { deleteVoucher, loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { mseReceivables } from '../src/lib/mfg/mf-msme-recv.ts';
import { meetsFloor } from '../src/lib/mfg/mf-shelf-floor.ts';
import { liveWipStatement } from '../src/lib/mfg/mf-inventories-live.ts';
import { incentiveClaimsDb, recogniseClaim } from '../src/lib/mfg/mf-incentives.ts';
import { defaultDates, eoStatus, exportsAgainst, withExportAa, type ExportAuthorisation } from '../src/lib/mfg/mf-authorisations.ts';
import { incentivesDb } from '../src/lib/trade/export-incentives.ts';
import { outputFoodDates } from '../src/lib/mfg/mf-food.ts';
import { paperIssueQty, estimateBreak } from '../src/lib/mfg/mf-estimates.ts';
import { assertHours, backwardLoad } from '../src/lib/mfg/mf-capacity.ts';
import { recordStep } from '../src/lib/mfg/mf-bundles.ts';
import type { InvoiceItem, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { CutPlan, PrintEstimate, WorkCentre } from '../src/types/mfg-r13.ts';
import type { ProductionOrder } from '../src/types/production-r4.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings({ industry_packs: ['shopfloor', 'foodmfg'] } as never);
  freezeDate('2026-05-12T10:00:00');
});
afterEach(() => thawDate());

/* ── P1: credit notes settle an MSE receivable ─────────────────── */

test('P1 a credit note against a sale stops Sec 16 interest on the credited amount', () => {
  const gstin = '27AAPFU0939F1ZV';
  const sale = { id: 'a', invoice_number: 'INV/a', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-01-01', due_date: '', total: 100000, amount_paid: 0, client: { name: 'Buyer', gstin }, items: [] } as unknown as InvoiceRecord;
  const cn = { id: 'cn', invoice_number: 'CN/1', doc_type: 'CREDIT_NOTE', status: 'Sent', issue_date: '2026-01-10', total: 100000, amount_paid: 0, client: { name: 'Buyer', gstin }, items: [] } as unknown as InvoiceRecord;
  const links = [{ from_id: 'a', to_id: 'cn', relation: 'credit_note' }];
  const rows = mseReceivables([sale, cn], [] as Payment[], '2026-05-12', links);
  assert.deepEqual(rows, [], 'fully credited before the Sec 15 limit: nothing owed, no interest');
  const part = mseReceivables([sale, { ...cn, total: 40000 } as InvoiceRecord], [], '2026-05-12', links);
  assert.equal(part[0].unpaid, 60000);
});

/* ── P2: the FEFO split honours the client's minimum shelf life ─── */

test('P2 "split across batches" skips batches below the client\'s minimum remaining life', () => {
  const t = {
    item: { id: 'b', name: 'Bhujia', track_batches: true },
    batches: [
      { batch: 'B-SOON', qty: 5, byGodown: { main: 5 }, mfg: '2026-01-01', expiry: '2026-06-30', firstIn: '2026-01-02' },
      { batch: 'B-LATE', qty: 10, byGodown: { main: 10 }, mfg: '2026-04-01', expiry: '2026-10-28', firstIn: '2026-04-02' },
    ],
  } as never;
  const line = { id: 'l1', name: 'Bhujia', quantity: 7, rate: 30, amount: 210 } as InvoiceItem;
  const floor = { pct: 70 };
  const split = splitLineByFefo(line, t, '2026-05-10', () => 'new', (b) => meetsFloor(b, '2026-05-10', floor));
  assert.deepEqual(split.map((l) => [l.batch_no, l.quantity]), [['B-LATE', 7]]);
});

/* ── P3: the year-end WIP statement is as on the year end ─────── */

test('P3 the WIP statement on 31 Mar shows an order open then, without later issues', () => {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel', unit: 'KG', opening_qty: 1000, opening_rate: 60 }));
  stockDb.saveItem(blankStockItem({ id: 'br', name: 'Bracket' }));
  bomsDb.save({ item_id: 'br', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'steel', qty: 0.5 }] }, stockDb.items());
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-03-10', item_id: 'br', planned_qty: 400 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  const issue = (date: string, kg: number) => {
    const ord = productionOrdersDb.get(o.id) as ProductionOrder;
    const lines = buildIssueLines(materialRows(ord, orderProgress(ord, loadOrderDocs())), stockDb.items(), computeTracking({ ...liveTrackingInputs(), asOf: date }), date, 'main', new Map([['steel', kg]]), () => `l${Math.random()}`);
    productionOrdersDb.issue(o.id, { date, from: 'main', lines }, stockDb.items(), liveTrackingInputs());
  };
  issue('2026-03-20', 50);
  issue('2026-04-15', 30);
  productionOrdersDb.close(o.id, { date: '2026-04-25', writeOff: true }, stockDb.items(), liveTrackingInputs());
  const w = liveWipStatement('2026-03-31');
  assert.deepEqual(w.rows.map((r) => [r.number, r.wipMaterial]), [[o.number, 300000]], '50 kg × ₹60 on the shop floor at the year end');
});

/* ── P4: a grant journal goes only with its claim ─────────────── */

test('P4 a recognised grant journal cannot be deleted from Books while its claim counts it', () => {
  const c = incentiveClaimsDb.save({ scheme: 'pli', name: 'PLI FY 2025-26', period_from: '2025-04-01', period_to: '2026-03-31', claimed: 200000, kind: 'income' });
  recogniseClaim(c.id, '2026-05-01');
  const [v] = loadVouchers();
  assert.throws(() => deleteVoucher(v.id), /Incentives/);
  assert.equal(loadVouchers().length, 1);
});

/* ── P6: food batch dates follow the output date ──────────────── */

test('P6 MFG / best-before follow the output date, not the day the dialog opened; a typed expiry wins', () => {
  const item = { shelf_life_days: 90 };
  assert.deepEqual(outputFoodDates({}, item, '2026-05-01', null), { mfg_date: '2026-05-01', expiry_date: '2026-07-30' });
  assert.deepEqual(outputFoodDates({ mf: { food: { packed_on: '2026-04-28' } } }, item, '2026-05-01', null), { mfg_date: '2026-04-28', expiry_date: '2026-07-27' });
  assert.equal(outputFoodDates({}, item, '2026-05-01', '2026-06-30').expiry_date, '2026-06-30');
  assert.deepEqual(outputFoodDates({}, {}, '2026-05-01', null), { expiry_date: '' }, 'no food data: nothing filled');
});

/* ── P7 / P8: AA obligation items; RoDTEP 4RE ─────────────────── */

const aa = (): ExportAuthorisation => ({
  id: 'aa1', kind: 'aa', number: '0310001234', date: '2026-01-15', items_import: [{ item_id: 'pp', qty: 12000, cif_value: 1200000 }], items_export: [{ item_id: 'caps', qty: 10000, fob_value: 2000000 }],
  norm: 'sion', ...defaultDates('aa', '2026-01-15'), duty_saved: 300000, status: 'open',
});

test('P7 only the authorisation\'s export items count towards an AA obligation', () => {
  const ex = { id: 'e1', invoice_number: 'EXP/1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-03-01', items: [{ id: 'l', name: 'Caps', quantity: 4000, rate: 100, tax_rate: 0 }, { id: 'm', name: 'Crates', quantity: 6000, rate: 200, tax_rate: 0 }], mf: withExportAa(undefined, aa()) } as unknown as InvoiceRecord;
  const ids: Record<string, string> = { caps: 'caps', crates: 'crates' };
  const s = eoStatus(aa(), exportsAgainst([ex], 'aa1', (n) => ids[n.toLowerCase()]), [], '2026-05-12');
  assert.deepEqual([s.qtyDone, s.valueDone, s.fulfilled], [4000, 400000, 0.2]);
});

test('P8 a RoDTEP row on an export under an AA defaults to Appendix 4RE', () => {
  setTable('invoices', [{ id: 'e1', invoice_number: 'EXP/1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-03-01', items: [], mf: withExportAa(undefined, aa()) }, { id: 'e2', invoice_number: 'EXP/2', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-03-01', items: [] }]);
  assert.equal(incentivesDb.save({ invoice_id: 'e1', kind: 'rodtep', date: '2026-03-05', claimed: 5000 }).appendix, '4RE');
  assert.equal(incentivesDb.save({ invoice_id: 'e2', kind: 'rodtep', date: '2026-03-05', claimed: 5000 }).appendix, undefined);
  assert.equal(incentivesDb.save({ invoice_id: 'e1', kind: 'rodtep', date: '2026-03-05', claimed: 5000, appendix: '4R' }).appendix, '4R', 'a chosen appendix wins');
});

/* ── P5: paper on the job ticket in the paper item's unit ─────── */

test('P5 the job ticket issues paper in the item\'s own unit (KGS, reams, tonnes), sheets otherwise', () => {
  const e = {
    date: '2026-10-27', job: 'Carton', size: { w: 350, h: 230 }, breaks: [10000], colours_front: 4, colours_back: 0, sheet: { w: 762, h: 508 }, margins: { gripper: 10, bleed: 3, edge: 5 }, gsm: 300,
    paper_rate: 80, plate_rate: 350, running_waste_pct: 2, finishing: [], outside: 0, margin_pct: 15,
  } as unknown as Omit<PrintEstimate, 'id' | 'number' | 'status'>;
  const b = estimateBreak(e, 10000);
  assert.equal(paperIssueQty('KG', b), b.kg);
  assert.equal(paperIssueQty('Kgs', b), b.kg);
  assert.ok(Math.abs(paperIssueQty('MT', b) - b.kg / 1000) < 0.001);
  assert.equal(paperIssueQty('REAM', b), b.reams);
  assert.equal(paperIssueQty('SHEETS', b), b.sheets);
});

/* ── P9: no silent reject on a bundle already in stock ────────── */

test('P9 rejecting pieces of a bundle received stitched (already in stock) is refused with the way to write them off', () => {
  const plan = { id: 'p', number: 'CUT/FY26-27/0001', cut: { M: 12 }, colour: 'Blue', bundles: [{ no: 1, size: 'M', colour: 'Blue', pieces: 12, at: { where: 'floor' }, history: [], reported: 'cmt:mi1' }] } as unknown as CutPlan;
  assert.throws(() => recordStep(plan, 1, { date: '2026-05-12', rejected: 1, reason: 'stain' }), /Rejections/);
  assert.equal(recordStep(plan, 1, { date: '2026-05-12', op: 'Press', last: true }).bundles![0].at.where, 'finished', 'finishing steps still record');
});

/* ── P10: a shutdown week is not "no working hours" ───────────── */

test('P10 a Diwali shutdown of a full working week does not stop the load view', () => {
  const c = { id: 'wc', name: 'Press 1', shifts: [{ name: 'S', hours: 8 }], days: [1, 2, 3, 4, 5, 6], holidays: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'] } as unknown as WorkCentre;
  assert.doesNotThrow(() => assertHours(c, '2026-11-08'));
  const order = { id: 'o', number: 'WO/1', status: 'released', date: '2026-11-01', due_date: '2026-11-14', planned_qty: 10 } as unknown as ProductionOrder;
  const load = backwardLoad([order], () => [{ id: 'op', seq: 10, name: 'Print', work_centre_id: 'wc', planned_hours: 4 } as never], [], [c]);
  assert.deepEqual([...load.get('wc')!.entries()], [['2026-11-07', 4]], 'placed on the last working day before the shutdown');
});
