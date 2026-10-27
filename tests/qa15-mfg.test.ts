/**
 * QA round 15 (Round 13 manufacturing): regression tests for the findings in docs/prd/qa-round-15.md (M1 …).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { blankStockItem, computeStock, loadPositions, stockDb } from '../src/lib/inventory.ts';
import { liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { getTable } from '../src/lib/storage.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { buildIssueLines, buildOutputVoucher, loadOrderDocs, materialRows, orderProgress, productionOrdersDb } from '../src/lib/production/orders.ts';
import { computeTracking } from '../src/lib/stock-tracking.ts';
import { saveCentre } from '../src/lib/mfg/mf-centres.ts';
import { saveRouting } from '../src/lib/mfg/mf-routings.ts';
import { outputExtras, reportEntry } from '../src/lib/mfg/mf-jobcards.ts';
import { saveMfgSettings } from '../src/lib/mfg/mf-settings.ts';
import { receiveCmt, sendCmt, cmtOutLine } from '../src/lib/mfg/mf-cmt.ts';
import { reportFinished, saveBundles, scanStep } from '../src/lib/mfg/mf-bundles.ts';
import { cutPlanOf } from '../src/lib/mfg/mf-cutplans.ts';
import { scrapRegister } from '../src/lib/mfg/mf-scrap.ts';
import { outwardLines, rule895, suggestInvertedRates, type IdLine } from '../src/lib/mfg/mf-inverted.ts';
import { lotWithOrder, SIZES } from './helpers/garments.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { advanceOutstanding, draftPieceBill, payAdvance, pieceOf, removePieceBill, savePieceBill } from '../src/lib/mfg/mf-piece-bill.ts';
import { BIN_TABLE, restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';
import type { ProductionOrder } from '../src/types/production-r4.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings({ industry_packs: ['shopfloor', 'garments'] } as never);
  freezeDate('2026-10-12T10:00:00');
});
afterEach(() => thawDate());

/* ── M1: CMT-received pieces reach stock once ─────────────────── */

test('M1 a CMT-received bundle is not received twice and is never reported as output again', () => {
  const { plan } = lotWithOrder();
  saveBundles(plan.id, 12, SIZES);
  const vendor = { id: 'k9', name: 'Salim Fabricators' };
  const out = sendCmt(plan.id, [1, 2], { date: '2026-10-13', vendor, perPieceM: 1.2 }, stockDb.items());
  const lineId = out.lines[0].id;
  receiveCmt(out.id, lineId, [{ no: 1, good: 12, rejected: 0 }, { no: 2, good: 10, rejected: 0 }], { date: '2026-10-18', rate: 38 }, stockDb.items());
  const qty = (id: string) => new Map(loadPositions().map((x) => [x.item.id, x.qty])).get(id) ?? 0;
  assert.equal(qty('kt-S-Blue'), 22, 'stitched pieces in stock from the Material In');
  let p = cutPlanOf(plan.id)!;
  assert.deepEqual([p.bundles![0].at.where, p.bundles![0].reported], ['floor', p.bundles![0].reported], 'bundle 1 back on the floor');
  assert.match(p.bundles![0].reported ?? '', /^cmt:/, 'marked as in stock through the CMT receipt');
  assert.deepEqual([p.bundles![1].at.where, p.bundles![1].at.got], ['fabricator', 10], 'part-received bundle 2 stays at the fabricator');
  // The same bundle cannot be received again; bundle 2 only for its 2 open pieces.
  assert.throws(() => receiveCmt(out.id, lineId, [{ no: 1, good: 12, rejected: 0 }], { date: '2026-10-19' }, stockDb.items()), /not at the fabricator/);
  assert.throws(() => receiveCmt(out.id, lineId, [{ no: 2, good: 12, rejected: 0 }], { date: '2026-10-19' }, stockDb.items()), /2 pieces still at the fabricator/);
  receiveCmt(out.id, lineId, [{ no: 2, good: 2, rejected: 0 }], { date: '2026-10-19' }, stockDb.items());
  assert.equal(qty('kt-S-Blue'), 24);
  // In-house finishing then "last step": the bundles are finished, but nothing more reaches stock.
  scanStep(`${plan.number}/1`, { date: '2026-10-20', op: 'Press', last: true });
  scanStep(`${plan.number}/2`, { date: '2026-10-20', op: 'Press', last: true });
  assert.throws(() => reportFinished(plan.id, '2026-10-20', stockDb.items(), liveTrackingInputs()), /No finished bundles/);
  assert.equal(qty('kt-S-Blue'), 24, 'still 24, not 48');
  // A stitched bundle cannot go out again as fabric.
  p = cutPlanOf(plan.id)!;
  assert.throws(() => cmtOutLine({ ...p, bundles: p.bundles!.map((b) => (b.no === 1 ? { ...b, at: { where: 'floor' as const } } : b)) }, [1], { perPieceM: 1.2, godownId: 'main' }), /already stitched/);
});

test('M1 an in-house bundle is still reported once as before', () => {
  const { plan } = lotWithOrder();
  saveBundles(plan.id, 12, SIZES);
  scanStep(`${plan.number}/3`, { date: '2026-10-14', op: 'Stitch', last: true });
  const ids = reportFinished(plan.id, '2026-10-14', stockDb.items(), liveTrackingInputs());
  assert.equal(ids.length, 1);
  assert.equal(new Map(loadPositions().map((x) => [x.item.id, x.qty])).get('kt-S-Blue'), 12);
});

/* ── M2 / M3: job-card scrap ─────────────────────────────────── */

function shop(bomScrapPerUnit = 0) {
  stockDb.saveItem(blankStockItem({ id: 'steel', name: 'Steel', unit: 'KG', opening_qty: 1000, opening_rate: 60 }));
  stockDb.saveItem(blankStockItem({ id: 'br', name: 'Bracket' }));
  stockDb.saveItem(blankStockItem({ id: 'scrap', name: 'MS off-cuts', unit: 'KG', sale_rate: 28 }));
  bomsDb.save({ item_id: 'br', name: 'Std', batch_qty: 1, components: [{ id: 'c', item_id: 'steel', qty: 0.5 }], ...(bomScrapPerUnit ? { outputs: [{ id: 'bs', item_id: 'scrap', qty: bomScrapPerUnit, kind: 'scrap', rate: 28 }] } : {}) } as never, stockDb.items());
  const shifts = [{ name: 'S', hours: 8 }];
  const laser = saveCentre({ name: 'Laser', kind: 'machine', hourly_rate: 1800, shifts, days: [1, 2, 3, 4, 5, 6] });
  saveRouting({ item_id: 'br', name: 'Std', is_default: true, ops: [{ id: 'cut', seq: 10, name: 'Cut', work_centre_id: laser.id, setup_min: 15, run_min_per_unit: 3 }] } as never);
  const o = productionOrdersDb.release(productionOrdersDb.save({ date: '2026-10-12', item_id: 'br', planned_qty: 200 }, stockDb.items(), bomsDb.all()).id, bomsDb.all());
  const ord = productionOrdersDb.get(o.id) as ProductionOrder;
  const p = orderProgress(ord, loadOrderDocs());
  const lines = buildIssueLines(materialRows(ord, p), stockDb.items(), computeTracking({ ...liveTrackingInputs(), asOf: '2026-10-12' }), '2026-10-12', 'main', new Map([['steel', 100]]), () => `l${Math.random()}`);
  productionOrdersDb.issue(o.id, { date: '2026-10-12', from: 'main', lines }, stockDb.items(), liveTrackingInputs());
  return o.id;
}
const scrapQty = () => computeStock(liveTrackingInputs()).find((x) => x.item.id === 'scrap')?.qty ?? 0;
const output = (orderId: string, qty: number, withExtras: boolean) => {
  const ord = productionOrdersDb.get(orderId)!;
  const ex = outputExtras(ord, stockDb.items());
  const draft = buildOutputVoucher(ord, orderProgress(ord, loadOrderDocs()), bomsDb.all()[0], { qty, date: '2026-10-12' }, undefined, withExtras && ex.replaceScrapOf.length ? { scrapLines: ex.scrapLines, replaceScrapOf: ex.replaceScrapOf } : undefined);
  productionOrdersDb.reportOutput(orderId, draft, stockDb.items(), liveTrackingInputs());
};

test('M2 job-card scrap with no item named uses Settings\' default scrap item in the output journal', () => {
  const id = shop();
  saveMfgSettings({ scrap_item_id: 'scrap' });
  reportEntry(id, 'cut', { date: '2026-10-12', hours: 4, good: 100, scrap_kg: 0.7 });
  const ex = outputExtras(productionOrdersDb.get(id)!, stockDb.items());
  assert.deepEqual(ex.scrapLines.map((l) => [l.item_id, l.qty, l.mf_jc]), [['scrap', 0.7, true]]);
  output(id, 100, true);
  assert.equal(scrapQty(), 0.7);
  const reg = scrapRegister({ items: stockDb.items(), mfg: getTable('manufacturing_vouchers') as never, journals: [], cards: [{ order_id: id, entries: [{ id: 'e', date: '2026-10-12', hours: 4, good: 100, rejected: 0, rework: 0, scrap_kg: 0.7 }] }] as never, invoices: [], scrapItemId: 'scrap' });
  assert.deepEqual(reg.map((r) => [r.made, r.pending]), [[0.7, 0]], 'register: made, nothing left pending');
});

test('M3 the BOM\'s standard scrap line and the job cards\' actual scrap of the same item are not both posted', () => {
  const id = shop(0.01);
  reportEntry(id, 'cut', { date: '2026-10-12', hours: 4, good: 100, scrap_kg: 1.2, scrap_item_id: 'scrap' });
  output(id, 100, true);
  assert.equal(scrapQty(), 1.2, 'actual 1.2 kg, not 1.2 + 1.0 standard');
  output(id, 50, true);
  assert.equal(scrapQty(), 1.2, 'the next journal adds no BOM scrap of the card item');
});

test('M3 BOM scrap posted before the cards counts against the cards\' kg', () => {
  const id = shop(0.01);
  output(id, 100, false); // 1.0 kg standard scrap
  reportEntry(id, 'cut', { date: '2026-10-12', hours: 4, good: 100, scrap_kg: 1.2, scrap_item_id: 'scrap' });
  assert.deepEqual(outputExtras(productionOrdersDb.get(id)!, stockDb.items()).scrapLines.map((l) => l.qty), [0.2]);
  output(id, 50, true);
  assert.equal(scrapQty(), 1.2);
});

/* ── M4: Rule 89(5) ───────────────────────────────────────────── */

const inv = (id: string, rate: number, amount: number, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id, invoice_number: id, issue_date: '2026-08-10', doc_type: 'TAX_INVOICE', status: 'Unpaid', supply_type: 'B2B', gst_mode: 'CGST_SGST', place_of_supply: '27',
  sender: { stateCode: '27' } as never, client: { name: 'Buyer', state_code: '27' } as never,
  items: [{ id: `${id}l`, name: 'Fabric', hsn: '5407', quantity: 1, rate: amount, tax_rate: rate }], ...extra,
} as InvoiceRecord);

test('M4 LUT exports are in ATT but not inverted turnover; a credit note on a nil-rated supply does not cut ATT', () => {
  const o = outwardLines([inv('S1', 5, 1000000), inv('EX', 5, 400000, { supply_type: 'EXPORT_LUT', gst_mode: 'IGST' } as never), inv('NIL', 0, 50000), inv('CN0', 0, 20000, { doc_type: 'CREDIT_NOTE' })], '2026-07-01', '2026-09-30');
  const ins: IdLine[] = [{ doc_id: 'B', doc: 'B', date: '2026-08-05', rate: 12, taxable: 800000, tax: 96000, itc: true }];
  const r = rule895(o, ins, [5], '2026-09-30');
  assert.equal(r.invertedTurnover, 1000000, 'the export (no tax) is a Rule 89(4) supply');
  assert.equal(r.taxPayable, 50000);
  assert.equal(r.att, 1400000, 'ATT = taxable 1,000,000 + zero-rated 400,000; nil and its credit note out');
  assert.deepEqual(suggestInvertedRates(o, ins), [5]);
});

/* ── M5: piece bill restore with its advance-recovery journal ───── */

test('M5 a restored piece bill brings back its advance-recovery journal; the journal alone is refused', () => {
  const k = vendorsDb.save({ name: 'Rehmat', mf: { karigar: { kind: 'home', rates: [] } } } as never);
  payAdvance(k, { date: '2026-10-12', amount: 500 });
  const bill = savePieceBill(k, draftPieceBill(k, [{ op: 'Stitching', pieces: 100, rate: 38, amount: 0, source: 'typed' }], { date: '2026-10-12', period: { from: '2026-10-06', to: '2026-10-12' }, advance: 300 }));
  const jv = pieceOf(bill)!.advance_jv_id!;
  removePieceBill(bill.id);
  assert.equal(advanceOutstanding(k), 500);
  const bin = getTable<BinEntry>(BIN_TABLE);
  const jvEntry = bin.find((b) => b.table === 'vouchers' && b.row_id === jv)!;
  assert.throws(() => restoreEntry(jvEntry.id), /post it twice/);
  restoreEntry(bin.find((b) => b.table === 'purchases' && b.row_id === bill.id)!.id);
  assert.ok(loadVouchers().some((v) => v.id === jv), 'the recovery journal is back with the bill');
  assert.equal(advanceOutstanding(k), 200);
});
