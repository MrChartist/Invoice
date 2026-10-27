/** MF-B5 print estimates: passes, impressions, plates, breaks; quotation drafts; job ticket order and its paper; classes by date. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { stockDb } from '../src/lib/inventory.ts';
import { bomsDb } from '../src/lib/manufacturing.ts';
import { productionOrdersDb } from '../src/lib/production/orders.ts';
import {
  actualPaper, colourPasses, estimateBreak, estimateBreaks, loadEstimates, makeJobTicket, makePrintQuotations, printClassRate, removeEstimate, saveEstimate, savePress, ticketHtml, validateEstimate,
} from '../src/lib/mfg/mf-estimates.ts';
import type { MfPress, PrintEstimate } from '../src/types/mfg-r13.ts';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
});

const press: MfPress = { id: 'p4', name: 'Heidelberg SM 74-4', max_sheet: { w: 762, h: 520 }, colours: 4, impressions_per_hour: 8000, make_ready_min: 45, make_ready_sheets: 150, rate_per_1000_imp: 400, min_charge: 1500 };
const carton: Omit<PrintEstimate, 'id' | 'number' | 'status'> = {
  date: '2026-10-27', job: '4-colour carton + varnish', size: { w: 350, h: 230 }, breaks: [10000, 5000], colours_front: 4, colours_back: 0, varnish_plate: true,
  sheet: { w: 762, h: 508 }, margins: { gripper: 10, bleed: 3, edge: 5 }, gsm: 300, paper_rate: 80, plate_rate: 350, running_waste_pct: 2,
  finishing: [{ name: 'Die-cutting', basis: 'sheet', rate: 0.5 }, { name: 'Pasting', basis: 'piece', rate: 0.2 }, { name: 'Lamination', basis: 'sqin', rate: 0.001 }, { name: 'Die', basis: 'lot', rate: 2500 }],
  outside: 0, margin_pct: 15,
};

test('passes, sheets, impressions, plates, press cost and price per piece', () => {
  assert.equal(colourPasses(4, 0, press), 1);
  assert.equal(colourPasses(4, 1, press), 2);
  assert.equal(colourPasses(4, 0), 4, 'single-colour (no press): a pass per colour');
  const b = estimateBreak(carton, 10000, press);
  assert.deepEqual([b.ups, b.net_sheets, b.waste_sheets, b.sheets], [4, 2500, 200, 2700], '150 make-ready + 2% running');
  assert.equal(b.kg, 313.548);
  assert.equal(b.plates, 5, '4 colours + varnish');
  assert.equal(b.impressions, 2700);
  assert.equal(b.press, 1500, 'minimum charge');
  assert.equal(b.paper, 25083.84);
  assert.equal(b.finishing, 1350 + 2000 + 1620 + 2500);
  assert.equal(b.total, Math.round((25083.84 + 1750 + 1500 + 7470) * 1.15 * 100) / 100);
  assert.equal(b.per_piece, Math.round((b.total / 10000) * 1000) / 1000);
  assert.equal(b.press_hours, Math.round((2700 / 8000 + 0.75) * 100) / 100);
  const one = estimateBreak({ ...carton, colours_front: 4 }, 10000);
  assert.equal(one.impressions, (2500 + 50) * 4, 'no press: impressions = sheets × colour passes (running waste, no make-ready)');
  assert.deepEqual(estimateBreaks(carton, press).map((x) => x.qty), [5000, 10000]);
  assert.match(validateEstimate({ ...carton, size: { w: 900, h: 900 } }), /does not fit/);
});

test('printing classes by date (suggestions; own-paper goods: the product rate)', () => {
  assert.equal(printClassRate('print_job_ch48_49', '2025-09-21').rate, 12);
  assert.equal(printClassRate('print_job_ch48_49', '2025-09-22').rate, 5);
  assert.equal(printClassRate('cartons_4819', '2026-10-27').rate, 5);
  assert.equal(printClassRate('printing_paper_4802', '2026-10-27').rate, 18);
  assert.equal(printClassRate('print_goods_own_paper', '2026-10-27').rate, null);
  assert.equal(printClassRate('print_other', '2026-10-27').rate, 18);
});

test('PES numbering, quotation per break with the print particulars, job ticket order with the paper; actual vs estimate', () => {
  for (const [id, name, unit] of [['ctn', 'Carton 350', 'NOS'], ['board', 'Board 300 GSM', 'KG']]) stockDb.saveItem({ id, name, unit, track_stock: true, opening_qty: 1000, opening_rate: 80, reorder_level: 0, tax_rate: 5, hsn: id === 'ctn' ? '4819' : '4810' } as never);
  savePress(press);
  const e = saveEstimate({ ...carton, press_id: savePressId(), item_id: 'ctn', stock_item_id: 'board' });
  assert.equal(e.number, 'PES/FY26-27/0001');
  const q = makePrintQuotations(e.id);
  assert.equal(q.length, 2);
  assert.equal(q[0].doc_type, 'QUOTATION');
  assert.equal(q[1].mf!.kind, 'print');
  assert.deepEqual(q[1].mf!.print, { size: '350 × 230 mm', colours: '4 + 0 + varnish', quantity: '10000', ups: 4, sheets: 2700, impressions: 2700, paper: '300 GSM 762 × 508 mm · 313.548 kg' });
  assert.equal(loadEstimates()[0].status, 'quoted');
  const o = makeJobTicket(e.id, 10000);
  assert.equal(o.planned_qty, 10000);
  const bom = bomsDb.all().find((b) => b.id === o.bom_id)!;
  assert.deepEqual(bom.components.map((c) => [c.item_id, c.qty]), [['board', 313.548]], 'paper in the item\'s unit (KG)');
  assert.equal(loadEstimates()[0].order_id, o.id);
  assert.equal(productionOrdersDb.all().length, 1);
  assert.equal(actualPaper(loadEstimates()[0]), 0);
  assert.match(ticketHtml(loadEstimates()[0], estimateBreaks(loadEstimates()[0])[1], o, 2690), /Actual sheets issued.*2690 \(estimate 2700\)/);
  assert.throws(() => makeJobTicket(e.id, 10000), /already has a job ticket/);
  assert.throws(() => removeEstimate(e.id), /job ticket/);
});

function savePressId() { return 'p4'; }
