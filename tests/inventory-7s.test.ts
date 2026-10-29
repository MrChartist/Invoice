/**
 * 7S, pure logic: serial-tracked items on manufacturing / stock journals / job work, production plan (MRP) against
 * multi-level BOMs, per-godown (branch) closing-stock valuation, job-work e-Way bill JSON, ITC-04 JSON, the
 * principal's goods by godown / batch, selling price lists, group / category filters, physical counts and FEFO in
 * alternate units, and the bell's job-work clock notices.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvents, computeStock, stockVoucherInputs, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import { computeTracking } from '../src/lib/stock-tracking.ts';
import { allocateFefo, physicalLines, validateManufacturing, validateStockJournal } from '../src/lib/manufacturing.ts';
import { serialShapeError, serialsAvailable, voucherSerialIssues } from '../src/lib/serial-vouchers.ts';
import { challanBalances, jobWorkSerialIssues, validateMaterialIn } from '../src/lib/job-work.ts';
import { defaultBomMap, lastPurchaseRates, lowLevelCodes, poLinesFromMrp, runMrp, validatePlan } from '../src/lib/mrp.ts';
import { branchGodownIds, branchStockValuer, godownSetValuer } from '../src/lib/ledger/branch-stock.ts';
import { inventoryValuer } from '../src/lib/ledger/closing-stock.ts';
import { buildJobWorkEway } from '../src/lib/eway-job-work.ts';
import { EWAY_SUB_JOB_WORK } from '../src/lib/eway.ts';
import { buildItc04 } from '../src/lib/itc04.ts';
import { buildItc04Json, itc04Fp } from '../src/lib/itc04-json.ts';
import { principalStock } from '../src/lib/job-work-principal.ts';
import { listRateOn, priceListRate } from '../src/lib/price-list.ts';
import { applyItemFilter, filteredItemIds } from '../src/lib/stock-filters.ts';
import { jobWorkClockNotices } from '../src/lib/job-work-alerts.ts';
import { UNASSIGNED, type Branch } from '../src/lib/branch.ts';
import type { Bom, ManufacturingVoucher, StockJournal } from '../src/types/manufacturing.ts';
import type { MaterialIn, MaterialOut, PrincipalMovement } from '../src/types/job-work.ts';
import type { Godown, StockTransfer } from '../src/types/stock.ts';

const item = (id: string, name: string, extra: Partial<StockItem> = {}): StockItem => ({
  id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra,
});

/* ── Serial items in manufacturing ─────────────────────────────── */

const SERIAL_ITEMS = [
  item('board', 'Main board', { track_serials: true, opening_qty: 3, opening_rate: 1000, opening_serials: ['B1', 'B2', 'B3'] }),
  item('case', 'Case', { opening_qty: 10, opening_rate: 100 }),
  item('phone', 'Phone', { track_serials: true }),
];
const mfg = (v: Partial<ManufacturingVoucher> = {}): ManufacturingVoucher => ({
  id: 'm1', number: 'MFG/FY26-27/0001', date: '2026-05-10', item_id: 'phone', qty: 1, serials: ['P1'],
  components: [{ id: 'c1', item_id: 'board', qty: 1, serials: ['B1'] }, { id: 'c2', item_id: 'case', qty: 1 }],
  outputs: [], costs: [], ...v,
});
const base = (extra: Partial<StockInputs> = {}): StockInputs => ({ items: SERIAL_ITEMS, moves: [], invoices: [], ...extra });

test('manufacturing by serial: B1 consumed, the phone produced as P1, costed from the components', () => {
  const inputs = base({ vouchers: stockVoucherInputs([mfg()]) });
  const t = computeTracking(inputs);
  const b = t.get('board')!;
  assert.deepEqual(b.serials.filter((s) => s.inStock).map((s) => s.serial).sort(), ['B2', 'B3']);
  assert.equal(b.serials.find((s) => s.serial === 'B1')?.inStock, false);
  const p = t.get('phone')!;
  assert.deepEqual(p.serials.map((s) => [s.serial, s.inStock]), [['P1', true]]);
  const pos = new Map(computeStock(inputs).map((x) => [x.item.id, x]));
  assert.equal(pos.get('phone')!.value, 1100, 'board 1000 + case 100');
  assert.equal(pos.get('board')!.consumedQty, 1);
});

test('serial shape: whole units, one serial per unit, no repeats, base unit only', () => {
  assert.equal(validateManufacturing(mfg(), SERIAL_ITEMS), '');
  assert.match(validateManufacturing(mfg({ serials: [] }), SERIAL_ITEMS), /Phone: list 1 serial number/);
  assert.match(validateManufacturing(mfg({ qty: 1.5, serials: ['P1'] }), SERIAL_ITEMS), /whole units/);
  assert.match(validateManufacturing(mfg({ components: [{ id: 'c1', item_id: 'board', qty: 2, serials: ['B1'] }] }), SERIAL_ITEMS), /Main board: list 2 serial numbers/);
  assert.match(validateManufacturing(mfg({ components: [{ id: 'c1', item_id: 'board', qty: 2, serials: ['B1', 'b1'] }] }), SERIAL_ITEMS), /B1|b1/);
  assert.match(serialShapeError([{ item_id: 'board', qty: 1, unit_factor: 10, serials: ['B1'] }], SERIAL_ITEMS), /counted in NOS only/);
  const sj: StockJournal = { id: 's', number: 'SJ/1', date: '2026-05-10', consume: [{ id: 'a', item_id: 'board', qty: 1, serials: ['B2'] }], produce: [{ id: 'b', item_id: 'phone', qty: 1 }], costs: [] };
  assert.match(validateStockJournal(sj, SERIAL_ITEMS), /Phone: list 1 serial number/);
});

test('serial stock checks: consumed serial must be in stock (and not needed later); produced serial must be new', () => {
  const inputs = base();
  assert.deepEqual(voucherSerialIssues({ consume: mfg().components, produce: [{ item_id: 'phone', qty: 1, serials: ['P1'] }], day: '2026-05-10', input: inputs }), []);
  const missing = voucherSerialIssues({ consume: [{ item_id: 'board', qty: 1, serials: ['B9'] }], produce: [], day: '2026-05-10', input: inputs });
  assert.match(missing[0], /B9 was never received/);
  const dupNew = voucherSerialIssues({ consume: [], produce: [{ item_id: 'board', qty: 1, serials: ['B2'] }], day: '2026-05-10', input: inputs });
  assert.match(dupNew[0], /B2 is already in stock/);
  // A later voucher already consumed B1: consuming it again earlier is refused.
  const later = base({ vouchers: stockVoucherInputs([mfg({ id: 'm2', number: 'MFG/2', date: '2026-06-01' })]) });
  const clash = voucherSerialIssues({ consume: [{ item_id: 'board', qty: 1, serials: ['B1'] }], produce: [], day: '2026-05-10', input: later });
  assert.match(clash[0], /B1 is sold or moved later on MFG\/2/);
  // Godown check with several godowns: B2 is in Main, not in "g2".
  const wrongGodown = voucherSerialIssues({ consume: [{ item_id: 'board', qty: 1, serials: ['B2'], godown_id: 'g2' }], produce: [], day: '2026-05-10', input: inputs, multiGodown: true });
  assert.match(wrongGodown[0], /not in that godown/);
  const events = collectEvents({ ...inputs, includeTransfers: true });
  assert.deepEqual(serialsAvailable('board', '2026-05-10', 'main', events), ['B1', 'B2', 'B3']);
});

/* ── Serial items in job work ──────────────────────────────────── */

const JW_GODOWNS: Godown[] = [{ id: 'main', name: 'Main' }, { id: 'jw1', name: 'Acme (job worker)', job_worker: true }];
const outDoc = (o: Partial<MaterialOut> = {}): MaterialOut => ({
  id: 'o1', number: 'JWC/FY26-27/0001', date: '2026-05-01', party_name: 'Acme', job_worker_godown: 'jw1',
  lines: [{ id: 'ol1', item_id: 'board', qty: 2, serials: ['B1', 'B2'], rate: 1000, tax_rate: 18, hsn: '8473' }], ...o,
});

test('job work by serial: serials move to the job worker and back; checks against the job worker godown', () => {
  const back: MaterialIn = {
    id: 'i1', number: 'JWR/FY26-27/0001', date: '2026-05-20', party_name: 'Acme', job_worker_godown: 'jw1',
    consumed: [], received: [{ id: 'r1', item_id: 'board', qty: 1, kind: 'returned', serials: ['B1'] }],
  };
  const inputs = base({ jobWorkDocs: { outs: [outDoc()], ins: [back], rejections: [] } });
  const t = computeTracking(inputs).get('board')!;
  assert.equal(t.serials.find((s) => s.serial === 'B1')?.godown, 'main', 'B1 came back');
  assert.equal(t.serials.find((s) => s.serial === 'B2')?.godown, 'jw1', 'B2 is still with the job worker');
  assert.equal(t.serials.find((s) => s.serial === 'B2')?.inStock, true, 'still our stock');
  // Sending B3 is fine from Main; sending B2 again is refused (it is at the job worker).
  const noJw = base({ jobWorkDocs: { outs: [outDoc()], ins: [], rejections: [] } });
  assert.deepEqual(jobWorkSerialIssues({ kind: 'out', value: outDoc({ lines: [{ id: 'x', item_id: 'board', qty: 1, serials: ['B3'] }] }) }, noJw), []);
  assert.match(jobWorkSerialIssues({ kind: 'out', value: outDoc({ lines: [{ id: 'x', item_id: 'board', qty: 1, serials: ['B2'] }] }) }, noJw)[0], /not in that godown/);
  // Returning B3 from the job worker is refused: B3 never went there.
  assert.match(jobWorkSerialIssues({ kind: 'in', value: { ...back, received: [{ id: 'r', item_id: 'board', qty: 1, kind: 'returned', serials: ['B3'] }] } }, noJw)[0], /not in that godown/);
  // Validation needs the serials on a serial line.
  assert.match(validateMaterialIn({ ...back, received: [{ id: 'r', item_id: 'board', qty: 1, kind: 'returned' }] }, SERIAL_ITEMS, [outDoc()], [], '2026-06-01'), /serial number/);
  assert.equal(challanBalances([outDoc()], [back], '2026-06-01').lines[0].pending, 1);
});

/* ── MRP ───────────────────────────────────────────────────────── */

const MRP_ITEMS = [
  item('table', 'Table'),
  item('top', 'Table top', { min_order_qty: 0 }),
  item('leg', 'Leg'),
  item('wood', 'Wood plank', { unit: 'KG', min_order_qty: 10, tax_rate: 12, hsn: '4407' }),
  item('glue', 'Glue'),
];
const BOMS: Bom[] = [
  { id: 'b-table', item_id: 'table', name: 'Std', batch_qty: 1, is_default: true, components: [{ id: '1', item_id: 'top', qty: 1 }, { id: '2', item_id: 'leg', qty: 4 }, { id: '3', item_id: 'wood', qty: 1 }] },
  { id: 'b-leg', item_id: 'leg', name: 'Std', batch_qty: 2, is_default: true, components: [{ id: '4', item_id: 'wood', qty: 1, scrap_pct: 0 }, { id: '5', item_id: 'glue', qty: 0.2, scrap_pct: 50 }] },
  { id: 'b-leg-alt', item_id: 'leg', name: 'Alt', batch_qty: 1, components: [{ id: '6', item_id: 'glue', qty: 9 }] },
];

test('MRP: multi-level explosion, netted once per item at its lowest level, buy vs make, MOQ', () => {
  const levels = lowLevelCodes(['table'], defaultBomMap(BOMS));
  assert.deepEqual(Object.fromEntries(levels), { table: 0, top: 1, leg: 1, wood: 2, glue: 2 });
  const rows = runMrp({
    plan: [{ item_id: 'table', qty: 5 }], items: MRP_ITEMS, boms: BOMS,
    stock: new Map([['top', 2], ['leg', 3], ['wood', 1], ['table', -4]]),
    onOrder: new Map([['wood', 2]]),
    rates: new Map([['wood', { rate: 80, vendor: 'Timber Co' }]]),
  });
  const by = Object.fromEntries(rows.map((r) => [r.item.id, r]));
  assert.deepEqual([by.table.gross, by.table.stock, by.table.net, by.table.action, by.table.suggested], [5, 0, 5, 'make', 5], 'negative stock counts as nil');
  assert.deepEqual([by.top.net, by.top.action, by.top.suggested], [3, 'buy', 3]);
  assert.deepEqual([by.leg.gross, by.leg.net, by.leg.action], [20, 17, 'make']);
  // wood: 5 (table, direct) + 17 / 2 × 1 (legs) = 13.5 gross − 1 stock − 2 on order = 10.5 → buy 10.5 (above MOQ 10)
  assert.deepEqual([by.wood.level, by.wood.gross, by.wood.net, by.wood.suggested, by.wood.rate, by.wood.vendor], [2, 13.5, 10.5, 10.5, 80, 'Timber Co']);
  assert.deepEqual(by.wood.for.sort(), ['Leg', 'Table']);
  // glue: 17 / 2 × 0.2 × 1.5 = 2.55
  assert.equal(by.glue.gross, 2.55);
  const po = poLinesFromMrp(rows, () => 'id');
  assert.deepEqual(po.map((l) => [l.name, l.quantity]), [['Table top', 3], ['Glue', 2.55], ['Wood plank', 10.5]], 'by level, then name');
  assert.deepEqual(po.find((l) => l.item_id === 'wood'), { id: 'id', name: 'Wood plank', hsn: '4407', unit: 'KG', item_id: 'wood', quantity: 10.5, rate: 80, tax_rate: 12 });
});

test('MRP: stock covering the plan means nothing to do; MOQ raises a small buy; plan validation', () => {
  const rows = runMrp({ plan: [{ item_id: 'table', qty: 1 }], items: MRP_ITEMS, boms: BOMS, stock: new Map([['table', 3]]) });
  assert.deepEqual(rows.map((r) => [r.item.id, r.action]), [['table', 'none']], 'children of an item that needs no making are left out');
  const small = runMrp({ plan: [{ item_id: 'wood', qty: 2 }], items: MRP_ITEMS, boms: BOMS, stock: new Map() });
  assert.deepEqual([small[0].action, small[0].net, small[0].suggested], ['buy', 2, 10]);
  const raw = runMrp({ plan: [{ item_id: 'table', qty: 1 }], items: MRP_ITEMS, boms: BOMS, stock: new Map([['table', 3]]), netFinished: false });
  assert.equal(raw[0].action, 'make', 'finished stock ignored when asked');
  assert.match(validatePlan({ date: '2026-05-10', lines: [] }, MRP_ITEMS), /at least one/);
  assert.match(validatePlan({ date: '2026-05-10', lines: [{ id: 'l', item_id: 'table', qty: 0 }] }, MRP_ITEMS), /above zero/);
  assert.equal(validatePlan({ date: '2026-05-10', lines: [{ id: 'l', item_id: 'table', qty: 2 }] }, MRP_ITEMS), '');
  const rates = lastPurchaseRates(computeStock({ items: [item('x', 'X', { opening_qty: 2, opening_rate: 7 })], moves: [], invoices: [] }));
  assert.deepEqual(rates.get('x'), { rate: 7 });
});

/* ── Per-godown (branch) closing stock ─────────────────────────── */

test('branch stock: each branch values its godowns at the company cost; branches + No branch = company', () => {
  const items = [item('a', 'A', { opening_qty: 10, opening_rate: 100 }), item('b', 'B', { opening_qty: 4, opening_rate: 50 })];
  const godowns: Godown[] = [{ id: 'main', name: 'Main' }, { id: 'pune', name: 'Pune' }, { id: 'rack', name: 'Rack', parent_id: 'pune' }, { id: 'loose', name: 'Loose' }];
  const transfers: StockTransfer[] = [
    { id: 't1', transfer_number: 'STR/1', date: '2026-05-01', from_godown: 'main', to_godown: 'rack', lines: [{ id: 'l', item_id: 'a', qty: 4 }] },
    { id: 't2', transfer_number: 'STR/2', date: '2026-05-02', from_godown: 'main', to_godown: 'loose', lines: [{ id: 'l', item_id: 'b', qty: 1 }] },
  ];
  const branches: Branch[] = [{ id: 'mum', name: 'Mumbai', godown_id: 'main' }, { id: 'pun', name: 'Pune', godown_id: 'pune' }];
  const inputs: StockInputs = { items, moves: [], invoices: [], transfers };
  const positions = computeStock(inputs);
  const events = collectEvents({ ...inputs, includeTransfers: true });
  const company = inventoryValuer(positions);
  assert.deepEqual([...branchGodownIds('pun', branches, godowns)].sort(), ['pune', 'rack']);
  const ctx = { positions, events, branches, godowns, company };
  const mum = branchStockValuer('mum', ctx)!;
  const pun = branchStockValuer('pun', ctx)!;
  const none = branchStockValuer(UNASSIGNED, ctx)!;
  // Mumbai: 6 A × 100 + 3 B × 50 = 750; Pune 4 A × 100 = 400; Loose (no branch) 1 B × 50 = 50 (paise).
  assert.deepEqual([mum.value('2026-06-01'), pun.value('2026-06-01'), none.value('2026-06-01')], [75000, 40000, 5000]);
  assert.equal(mum.value('2026-06-01') + pun.value('2026-06-01') + none.value('2026-06-01'), company.value('2026-06-01'));
  // Before the transfers everything was in Main (Mumbai); opening stock sits there too.
  assert.equal(pun.value('2026-04-30'), 0);
  assert.equal(mum.openingIn('2026-06-01'), 120000);
  assert.equal(pun.openingIn('2026-06-01') + none.openingIn('2026-06-01'), 0);
  assert.equal(godownSetValuer(positions, events, new Set(['loose']), 'x').value('2026-06-01'), 5000);
  assert.equal(branchStockValuer('mum', { ...ctx, company: undefined }), undefined, 'typed closing stock is not split');
});

/* ── e-Way bill JSON for a job-work challan ────────────────────── */

test('job-work e-Way JSON: sub-type Job Work, CHL, inter-State IGST rate, nil tax, transport', () => {
  const items = [item('rod', 'Steel rod', { unit: 'KG', hsn: '7214' })];
  const o: MaterialOut = {
    id: 'o', number: 'JWC/FY26-27/0003', date: '2026-07-05', party_name: 'Acme Works', party_gstin: '29AABCT1332L1ZX', job_worker_godown: 'jw1', process: 'Machining',
    lines: [{ id: 'l', item_id: 'rod', qty: 40, rate: 50, tax_rate: 18 }], vehicle_no: 'mh 12 ab 1234', distance_km: 812,
  };
  const b = buildJobWorkEway(o, {
    sender: { name: 'Mr Chartist', gstin: '27AABCU9603R1ZM', address: '12 Dalal Street, Mumbai 400001', stateCode: '27' },
    vendor: { name: 'Acme Works', address: 'Plot 4, Peenya, Bengaluru 560058' }, items,
  });
  assert.equal(b.bill.subSupplyType, EWAY_SUB_JOB_WORK);
  assert.equal(b.bill.subSupplyType, 4);
  assert.deepEqual([b.bill.supplyType, b.bill.docType, b.bill.docNo, b.bill.docDate], ['O', 'CHL', 'JWC/FY26-27/0003', '05/07/2026']);
  assert.deepEqual([b.bill.fromStateCode, b.bill.toStateCode, b.bill.toPincode, b.bill.fromPincode], [27, 29, 560058, 400001]);
  assert.deepEqual(b.bill.itemList[0], {
    productName: 'Steel rod', productDesc: 'Steel rod: for Machining', hsnCode: 7214, quantity: 40, qtyUnit: 'KGS',
    taxableAmount: 2000, sgstRate: 0, cgstRate: 0, igstRate: 18, cessRate: 0,
  });
  assert.deepEqual([b.bill.totalValue, b.bill.igstValue, b.bill.totInvValue, b.bill.vehicleNo, b.bill.transDistance], [2000, 0, 2000, 'MH12AB1234', '812']);
  assert.equal(b.required, true, 'inter-State movement to a job worker needs an e-Way bill');
  assert.ok(b.notes.some((n) => /No tax is charged/.test(n)));
  const intra = buildJobWorkEway({ ...o, party_gstin: '27AAACB2230M1ZT', vehicle_no: undefined }, { sender: { name: 'X', stateCode: '27', gstin: '27AABCU9603R1ZM' }, items });
  assert.equal(intra.required, false);
  assert.deepEqual([intra.bill.itemList[0].cgstRate, intra.bill.itemList[0].igstRate], [9, 0]);
  assert.ok(intra.notes.some((n) => /vehicle number/.test(n)));
});

/* ── ITC-04 JSON ───────────────────────────────────────────────── */

test('ITC-04 JSON: Table 4 / 5A grouped by job worker, fp of the last month, dd-mm-yyyy dates', () => {
  const items = [item('rod', 'Steel rod', { unit: 'KG', hsn: '7214' }), item('shaft', 'Shaft')];
  const outs: MaterialOut[] = [{ id: 'o', number: 'JWC/1', date: '2026-05-01', party_name: 'Acme', party_gstin: '29AABCT1332L1ZX', job_worker_godown: 'jw1', lines: [{ id: 'l', item_id: 'rod', qty: 40, rate: 50, tax_rate: 18 }] }];
  const ins: MaterialIn[] = [{ id: 'i', number: 'JWR/1', date: '2026-06-10', party_name: 'Acme', party_gstin: '29AABCT1332L1ZX', job_worker_godown: 'jw1', jw_challan_no: 'AC/9', jw_challan_date: '2026-06-09', consumed: [{ id: 'c', item_id: 'rod', qty: 30 }], received: [{ id: 'r', item_id: 'shaft', qty: 10, kind: 'processed' }] }];
  const r = buildItc04(outs, ins, '2026-04-01', '2026-09-30', { items, ourStateCode: '27' });
  const j = buildItc04Json(r, '27aabcu9603r1zm');
  assert.equal(itc04Fp('2026-09-30'), '092026');
  assert.deepEqual([j.gstin, j.fp, j.m2jw.length, j.jw2m.length, j.jw2jw.length, j.jwsupply.length], ['27AABCU9603R1ZM', '092026', 1, 1, 0, 0]);
  assert.deepEqual(j.m2jw[0].items[0], { chnum: 'JWC/1', chdt: '01-05-2026', goods_ty: 'Inputs', desc: 'Steel rod', hsn: '7214', uqc: 'KGS', qty: 40, txval: 2000, tx_i: 18, tx_c: 0, tx_s: 0, tx_cs: 0 });
  assert.deepEqual([j.m2jw[0].ctin, j.m2jw[0].jw_stcd], ['29AABCT1332L1ZX', '29']);
  assert.deepEqual([j.jw2m[0].items[0].o_chnum, j.jw2m[0].items[0].jw2_chnum, j.jw2m[0].items[0].jw2_chdt, j.jw2m[0].items[0].qty], ['JWC/1', 'AC/9', '09-06-2026', 30]);
});

/* ── Principal's goods by godown / batch ───────────────────────── */

test("principal's goods by godown and batch; a return without a godown settles the oldest balance", () => {
  const rows: PrincipalMovement[] = [
    { id: '1', number: 'JWP/1', date: '2026-05-01', kind: 'receipt', party_name: 'Shah Textiles', lines: [{ id: 'a', name: 'Grey fabric', qty: 100, unit: 'MTR', godown_id: 'main', batch_no: 'L1' }, { id: 'b', name: 'Grey fabric', qty: 50, godown_id: 'g2', batch_no: 'L2' }] },
    { id: '2', number: 'JWP/2', date: '2026-05-10', kind: 'return', party_name: 'Shah Textiles', lines: [{ id: 'c', name: 'grey fabric', qty: 30, godown_id: 'g2' }] },
    { id: '3', number: 'JWP/3', date: '2026-05-20', kind: 'return', party_name: 'Shah Textiles', lines: [{ id: 'd', name: 'Grey fabric', qty: 110 }] },
  ];
  assert.deepEqual(principalStock(rows, '2026-05-15').map((r) => [r.godown, r.batch, r.pending]), [['main', 'L1', 100], ['g2', 'L2', 20]]);
  assert.deepEqual(principalStock(rows).map((r) => [r.godown, r.batch, r.received, r.returned, r.pending]), [['g2', 'L2', 50, 40, 10]]);
});

/* ── Price lists ───────────────────────────────────────────────── */

test('selling price list: the rate in force on the document date, matched by name / alias and HSN', () => {
  const list = [{ from: '2026-04-01', rate: 100 }, { from: '2026-07-01', rate: 110 }, { from: 'bad', rate: 5 }];
  assert.deepEqual([listRateOn(list, '2026-03-31'), listRateOn(list, '2026-04-01'), listRateOn(list, '2026-06-30'), listRateOn(list, '2026-07-01')], [undefined, 100, 100, 110]);
  const items = [{ name: 'Neem Soap', aliases: ['Soap Neem'], hsn: '3401', selling_prices: list }, { name: 'Plain', selling_prices: [] }];
  assert.equal(priceListRate(items, ' neem soap ', '3401', '2026-08-01'), 110);
  assert.equal(priceListRate(items, 'Soap Neem', undefined, '2026-05-01'), 100);
  assert.equal(priceListRate(items, 'Neem Soap', '9988', '2026-05-01'), undefined, 'a different HSN is another item');
  assert.equal(priceListRate(items, 'Plain', undefined, '2026-05-01'), undefined);
});

/* ── Group / category filters ──────────────────────────────────── */

test('group / category filter: sub-groups included, "-" = no group, both filters combine', () => {
  const groups = [{ id: 'g', name: 'Metals' }, { id: 'g2', name: 'Steel', parent_id: 'g' }];
  const cats = [{ id: 'c', name: 'Fast moving' }];
  const items = [{ id: 'a', group_id: 'g2', category_id: 'c' }, { id: 'b', group_id: 'g' }, { id: 'c' }];
  assert.equal(filteredItemIds({ group: '', category: '' }, items, groups, cats), null);
  assert.deepEqual([...filteredItemIds({ group: 'g', category: '' }, items, groups, cats)!].sort(), ['a', 'b']);
  assert.deepEqual([...filteredItemIds({ group: '-', category: '' }, items, groups, cats)!], ['c']);
  assert.deepEqual([...filteredItemIds({ group: 'g', category: 'c' }, items, groups, cats)!], ['a']);
  assert.deepEqual(applyItemFilter([{ id: 'a' }, { id: 'c' }], new Set(['c']), (r) => r.id), [{ id: 'c' }]);
});

/* ── Alternate units on physical counts and FEFO ───────────────── */

test('physical stock counted in an alternate unit: stored in base units with the typed figure kept', () => {
  const items = [item('screw', 'Screw', { opening_qty: 1000, opening_rate: 1, alt_units: [{ unit: 'BOX', factor: 100 }] })];
  const [l] = physicalLines([{ id: 'p', item_id: 'screw', counted: 9.5, unit: 'BOX', unit_factor: 100 }], '2026-05-10', { items, moves: [], invoices: [] });
  assert.deepEqual([l.counted, l.book_qty, l.diff, l.unit, l.unit_factor, l.counted_typed], [950, 1000, -50, 'BOX', 100, 9.5]);
});

test('FEFO allocation of a component typed in an alternate unit splits in base units and back', () => {
  const items = [item('resin', 'Resin', { track_batches: true, unit: 'KG', alt_units: [{ unit: 'BAG', factor: 25 }] })];
  const inputs: StockInputs = {
    items, invoices: [], moves: [
      { id: 'm1', item_id: 'resin', date: '2026-04-02', qty: 30, rate: 10, kind: 'adjustment', batch_no: 'R1', expiry_date: '2026-09-01' },
      { id: 'm2', item_id: 'resin', date: '2026-04-03', qty: 100, rate: 10, kind: 'adjustment', batch_no: 'R2', expiry_date: '2026-12-01' },
    ],
  };
  let n = 0;
  const out = allocateFefo([{ id: 'c', item_id: 'resin', qty: 2, unit: 'BAG', unit_factor: 25 }], items, computeTracking(inputs), '2026-05-01', () => `n${++n}`);
  assert.deepEqual(out.map((l) => [l.batch_no, l.qty, l.unit]), [['R1', 1.2, 'BAG'], ['R2', 0.8, 'BAG']]);
});

/* ── Bell notices ──────────────────────────────────────────────── */

test('bell: one critical notice for expired job-work clocks and one warning for due soon', () => {
  const outs: MaterialOut[] = [
    { id: 'o1', number: 'JWC/1', date: '2025-01-10', party_name: 'Acme', job_worker_godown: 'jw1', lines: [{ id: 'a', item_id: 'rod', qty: 5 }] },
    { id: 'o2', number: 'JWC/2', date: '2025-06-10', party_name: 'Acme', job_worker_godown: 'jw1', lines: [{ id: 'b', item_id: 'rod', qty: 5 }] },
  ];
  const notes = jobWorkClockNotices(challanBalances(outs, [], '2026-05-25'), '2026-05-25T10:00:00Z');
  assert.deepEqual(notes.map((n) => [n.severity, n.href]), [['critical', '/manufacturing?tab=jobwork&jw=clocks'], ['warning', '/manufacturing?tab=jobwork&jw=clocks']]);
  assert.match(notes[0].detail, /JWC\/1.*verify with your CA/);
  assert.deepEqual(jobWorkClockNotices(challanBalances([], [], '2026-05-25'), 'x'), []);
  void JW_GODOWNS;
});
