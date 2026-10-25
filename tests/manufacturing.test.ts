/**
 * Phase 7 (Tally parity), pure logic: BOM explosion (by-product, scrap), manufacturing cost roll-up
 * through the stock engine (weighted average and FIFO, multi-level), FEFO batch consumption,
 * stock journals, physical stock differences, reorder suggestions and the inventory reports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStock, computeStockDetailed, stockVoucherInputs, type StockInputs, type StockItem } from '../src/lib/inventory.ts';
import {
  allocateFefo, bomHasCycle, explodeBom, isPureTransfer, nextVoucherNumber, physicalLines, physicalSummary,
  validateBom, validateManufacturing, validateStockJournal, additionalCostTotal, physicalDrift,
} from '../src/lib/manufacturing.ts';
import { computeTracking } from '../src/lib/stock-tracking.ts';
import { pendingPoQty, poLinesFromReorder, reorderNotices, reorderStatus, suggestedQty } from '../src/lib/reorder.ts';
import { monthVouchers, monthlyMovement, movementAnalysis, negativeStockReport, stockAgeing } from '../src/lib/stock-reports.ts';
import type { Bom, ManufacturingVoucher, PhysicalStockVoucher, StockJournal } from '../src/types/manufacturing.ts';
import type { PurchaseOrder, PurchaseRecord } from '../src/types/purchases.ts';

const item = (id: string, name: string, extra: Partial<StockItem> = {}): StockItem => ({
  id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra,
});

const ITEMS = [
  item('wood', 'Wood plank', { opening_qty: 100, opening_rate: 50, unit: 'KG' }),
  item('screw', 'Screw', { opening_qty: 1000, opening_rate: 1 }),
  item('chair', 'Chair'),
  item('dust', 'Saw dust', { unit: 'KG' }),
  item('stool', 'Stool'),
];

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

const bom: Bom = {
  id: 'b1', item_id: 'chair', name: 'Standard', batch_qty: 1, is_default: true,
  components: [
    { id: 'c1', item_id: 'wood', qty: 4, scrap_pct: 10 },
    { id: 'c2', item_id: 'screw', qty: 20 },
  ],
  outputs: [{ id: 'o1', item_id: 'dust', qty: 0.5, kind: 'by_product', rate: 10 }],
};

const mfg = (over: Partial<ManufacturingVoucher> = {}): ManufacturingVoucher => {
  const exp = explodeBom(bom, over.qty ?? 2, ids());
  return {
    id: 'm1', number: 'MFG/FY26-27/0001', date: '2026-05-10', item_id: 'chair', bom_id: 'b1', qty: 2,
    components: exp.components.map(({ base: _b, scrap: _s, ...l }) => { void _b; void _s; return l; }),
    outputs: exp.outputs,
    costs: [{ id: 'k1', label: 'Labour', mode: 'amount', value: 200 }, { id: 'k2', label: 'Overhead', mode: 'pct', value: 10 }],
    ...over,
  };
};

const inputs = (vouchers: ReturnType<typeof stockVoucherInputs> = [], extra: Partial<StockInputs> = {}): StockInputs => ({
  items: ITEMS, moves: [], invoices: [], purchases: [], vouchers, ...extra,
});

test('BOM explosion: scrap % grosses up consumption, by-products scale with quantity', () => {
  const exp = explodeBom(bom, 2, ids());
  assert.deepEqual(exp.components.map((c) => [c.item_id, c.qty, c.base, c.scrap]), [['wood', 8.8, 8, 0.8], ['screw', 40, 40, 0]]);
  assert.deepEqual(exp.outputs.map((o) => [o.item_id, o.qty, o.kind, o.rate]), [['dust', 1, 'by_product', 10]]);
  // batch_qty: the BOM is for 4 chairs → 2 chairs need half.
  const four = explodeBom({ ...bom, batch_qty: 4 }, 2, ids());
  assert.equal(four.components[1].qty, 10);
});

test('BOM validation: own item, co-product shares, cycles through sub-assemblies', () => {
  assert.equal(validateBom(bom, ITEMS), '');
  assert.match(validateBom({ ...bom, components: [{ id: 'x', item_id: 'chair', qty: 1 }] }, ITEMS), /itself/);
  assert.match(validateBom({ ...bom, outputs: [{ id: 'o', item_id: 'dust', qty: 1, kind: 'co_product', cost_pct: 100 }] }, ITEMS), /less than 100/);
  const stoolBom: Bom = { id: 'b2', item_id: 'stool', name: 'S', batch_qty: 1, components: [{ id: 'z', item_id: 'chair', qty: 1 }] };
  const chairFromStool = { ...bom, components: [{ id: 'y', item_id: 'stool', qty: 1 }] };
  assert.equal(bomHasCycle(chairFromStool, [stoolBom]), true);
  assert.match(validateBom(chairFromStool, ITEMS, [stoolBom]), /own finished item/);
});

test('manufacturing cost roll-up: components + additional − by-product = finished value (weighted average)', () => {
  const v = mfg();
  const { positions, vouchers } = computeStockDetailed(inputs(stockVoucherInputs([v])));
  const vc = vouchers.get('m1')!;
  // wood 8.8 × 50 = 440, screws 40 × 1 = 40 → 480; + 200 + 10% of 480 = 248 → 728; − dust 1 × 10 → 718.
  assert.equal(vc.consumed, 480);
  assert.equal(vc.extra, 248);
  assert.equal(vc.fixed, 10);
  assert.equal(vc.pool, 718);
  const by = new Map(positions.map((p) => [p.item.id, p]));
  assert.equal(by.get('chair')!.qty, 2);
  assert.equal(by.get('chair')!.value, 718);
  assert.equal(by.get('chair')!.avgCost, 359);
  assert.equal(by.get('dust')!.value, 10);
  assert.equal(by.get('wood')!.qty, 91.2);
  assert.equal(by.get('screw')!.qty, 960);
  // Consumption is not a sale: no COGS, no revenue.
  assert.equal(by.get('wood')!.cogs, 0);
  assert.equal(by.get('wood')!.soldQty, 0);
  assert.equal(by.get('wood')!.consumedQty, 8.8);
  assert.equal(by.get('chair')!.producedQty, 2);
  assert.equal(additionalCostTotal(v.costs, 480), 248);
});

test('FIFO costing issues the oldest layers to production; selling the produced goods uses that cost', () => {
  const purchases = [{
    id: 'p1', kind: 'PURCHASE', vendor_name: 'Timber Co', bill_number: 'T/1', date: '2026-05-01', category: 'Purchases',
    lines: [{ id: 'l', name: 'Wood plank', quantity: 10, rate: 80, tax_rate: 18 }], taxable: 800, cgst: 72, sgst: 72, igst: 0, total: 944, amount_paid: 0, itc_eligible: true,
  }];
  const v = mfg({ costs: [], outputs: [], components: [{ id: 'a', item_id: 'wood', qty: 105 }] , qty: 1 });
  const sale = { id: 'i1', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-05-20', invoice_number: 'INV/1', items: [{ id: 'x', name: 'Chair', quantity: 1, rate: 9000, tax_rate: 18, amount: 9000 }] };
  const res = computeStockDetailed(inputs(stockVoucherInputs([v]), { method: 'FIFO', purchases: purchases as never, invoices: [sale as never] }));
  // FIFO: 100 opening @50 + 5 of the purchase @80 = 5,400.
  assert.equal(res.vouchers.get('m1')!.consumed, 5400);
  const chair = res.positions.find((p) => p.item.id === 'chair')!;
  assert.equal(chair.cogs, 5400, 'the sale of the chair costs what it took to make');
  assert.equal(chair.qty, 0);
});

test('co-products share the net cost; multi-level BOM: the sub-assembly cost flows into the next voucher', () => {
  const v = mfg({ outputs: [{ id: 'o', item_id: 'dust', qty: 1, kind: 'co_product', cost_pct: 25 }], costs: [] });
  const { positions } = computeStockDetailed(inputs(stockVoucherInputs([v])));
  const by = new Map(positions.map((p) => [p.item.id, p]));
  assert.equal(by.get('dust')!.value, 120); // 25% of 480
  assert.equal(by.get('chair')!.value, 360);
  // Same day: a second voucher consumes the chairs to make a stool (numbered later, so it runs after).
  const v2: ManufacturingVoucher = { id: 'm2', number: 'MFG/FY26-27/0002', date: '2026-05-10', item_id: 'stool', qty: 1, components: [{ id: 's', item_id: 'chair', qty: 2 }], outputs: [], costs: [{ id: 'l', label: 'Labour', mode: 'amount', value: 40 }] };
  const two = computeStockDetailed(inputs(stockVoucherInputs([v2, v])));
  assert.equal(two.positions.find((p) => p.item.id === 'stool')!.value, 400);
  assert.equal(two.positions.find((p) => p.item.id === 'chair')!.qty, 0);
});

test('batch components are consumed first-expiry-first and the batch balance drops', () => {
  const items = [item('resin', 'Resin', { track_batches: true }), item('pot', 'Pot')];
  const purchases = [{
    id: 'p', kind: 'PURCHASE', vendor_name: 'Chem', bill_number: 'C/1', date: '2026-04-01', category: 'Purchases',
    lines: [
      { id: 'a', name: 'Resin', quantity: 10, rate: 100, tax_rate: 18, batch_no: 'LATE', expiry_date: '2027-12-31' },
      { id: 'b', name: 'Resin', quantity: 4, rate: 90, tax_rate: 18, batch_no: 'SOON', expiry_date: '2026-09-30' },
    ], taxable: 1360, cgst: 0, sgst: 0, igst: 0, total: 1360, amount_paid: 0, itc_eligible: true,
  }];
  const base: StockInputs = { items, moves: [], invoices: [], purchases: purchases as never, includeTransfers: true, transfers: [] };
  const tracking = computeTracking({ ...base, asOf: '2026-05-01' });
  const lines = allocateFefo([{ id: 'l1', item_id: 'resin', qty: 6 }], items, tracking, '2026-05-01', ids());
  assert.deepEqual(lines.map((l) => [l.batch_no, l.qty]), [['SOON', 4], ['LATE', 2]]);
  const v: ManufacturingVoucher = { id: 'm', number: 'MFG/FY26-27/0001', date: '2026-05-01', item_id: 'pot', qty: 3, components: lines, outputs: [], costs: [] };
  assert.equal(validateManufacturing(v, items), '');
  const after = computeTracking({ ...base, vouchers: stockVoucherInputs([v]) });
  const b = new Map(after.get('resin')!.batches.map((x) => [x.batch, x.qty]));
  assert.deepEqual([b.get('SOON'), b.get('LATE')], [0, 8]);
  assert.equal(after.get('pot')!.qty, 3);
  // A batch component without a batch is refused.
  assert.match(validateManufacturing({ ...v, components: [{ id: 'x', item_id: 'resin', qty: 1 }] }, items), /choose the batch/);
});

test('numbering: MFG / SJ / PHY per Indian FY, the sequence restarts on 1 April', () => {
  const existing = ['MFG/FY25-26/0007', 'MFG/FY26-27/0002'];
  assert.equal(nextVoucherNumber('MFG', existing, '2026-03-31'), 'MFG/FY25-26/0008');
  assert.equal(nextVoucherNumber('MFG', existing, '2026-04-01'), 'MFG/FY26-27/0003');
  assert.equal(nextVoucherNumber('SJ', existing, '2027-04-01'), 'SJ/FY27-28/0001');
});

test('stock journal: repacking shares cost by quantity; a pure godown move is refused (use STR)', () => {
  const items = [...ITEMS, item('pack', 'Wood pack 1 kg')];
  const j: StockJournal = {
    id: 's1', number: 'SJ/FY26-27/0001', date: '2026-05-02', costs: [{ id: 'c', label: 'Packing', mode: 'amount', value: 20 }],
    consume: [{ id: 'a', item_id: 'wood', qty: 10 }], produce: [{ id: 'b', item_id: 'pack', qty: 10 }],
  };
  assert.equal(validateStockJournal(j, items), '');
  const p = computeStock({ items, moves: [], invoices: [], vouchers: stockVoucherInputs([], [j]) });
  assert.equal(p.find((x) => x.item.id === 'pack')!.value, 520);
  assert.equal(p.find((x) => x.item.id === 'wood')!.qty, 90);
  const move: StockJournal = { ...j, costs: [], consume: [{ id: 'a', item_id: 'wood', qty: 5, godown_id: 'main' }], produce: [{ id: 'b', item_id: 'wood', qty: 5, godown_id: 'shop' }] };
  assert.equal(isPureTransfer(move), true);
  assert.match(validateStockJournal(move, items), /godown transfer/);
});

test('physical stock: the difference is posted on the date and positions afterwards follow the count', () => {
  const sale = { id: 'i1', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-06-05', invoice_number: 'INV/9', items: [{ id: 'x', name: 'Screw', quantity: 50, rate: 2, tax_rate: 18, amount: 100 }] };
  const base = inputs([], { invoices: [sale as never], includeTransfers: true, transfers: [] });
  const lines = physicalLines([{ id: 'l', item_id: 'screw', counted: 930 }, { id: 'w', item_id: 'wood', counted: 104 }], '2026-05-31', base);
  assert.deepEqual(lines.map((l) => [l.book_qty, l.diff, l.rate]), [[1000, -70, 1], [100, 4, 50]]);
  assert.deepEqual(physicalSummary(lines), { shortageQty: 70, shortageValue: 70, excessQty: 4, excessValue: 200 });
  const v: PhysicalStockVoucher = { id: 'ph', number: 'PHY/FY26-27/0001', date: '2026-05-31', lines };
  const after = computeStock({ ...base, vouchers: stockVoucherInputs([], [], [v]) });
  const screw = after.find((p) => p.item.id === 'screw')!;
  assert.equal(screw.qty, 880, 'counted 930 on 31 May, then the June sale of 50');
  assert.equal(screw.adjustedOutQty, 70);
  assert.equal(after.find((p) => p.item.id === 'wood')!.qty, 104);
  // A back-dated purchase before the count makes the book figure drift.
  const late = { ...base, vouchers: stockVoucherInputs([], [], [v]), moves: [{ id: 'mv', item_id: 'screw', date: '2026-05-15', qty: 10, rate: 1, kind: 'adjustment' as const }] };
  assert.deepEqual(physicalDrift(v, late).map((d) => d.bookNow), [1010]);
});

test('reorder: shortfall, pending POs and minimum order quantity', () => {
  assert.equal(suggestedQty(30, 10, 0), 20);
  assert.equal(suggestedQty(30, 10, 50), 50);
  assert.equal(suggestedQty(10, 15, 50), 0);
  const items = [item('a', 'Alpha', { reorder_level: 50, min_order_qty: 40, opening_qty: 20, opening_rate: 5, tax_rate: 18 }), item('b', 'Beta', { reorder_level: 10, opening_qty: 30 })];
  const po: PurchaseOrder = { id: 'po', po_number: 'PO/FY26-27/0001', date: '2026-05-01', vendor_name: 'V', lines: [{ id: 'pl', name: 'Alpha', quantity: 25, rate: 5, tax_rate: 18 }], taxable: 125, cgst: 0, sgst: 0, igst: 0, total: 125 };
  const bill = { id: 'bl', po_id: 'po', kind: 'PURCHASE', vendor_name: 'V', bill_number: '1', date: '2026-05-02', lines: [{ id: 'x', name: 'Alpha', quantity: 5, rate: 5, tax_rate: 18, po_line_id: 'pl' }] } as unknown as PurchaseRecord;
  const pending = pendingPoQty([po], [bill], items);
  assert.equal(pending.get('a'), 20);
  const rows = reorderStatus(computeStock({ items, moves: [], invoices: [] }), pending);
  const alpha = rows.find((r) => r.item.id === 'a')!;
  assert.deepEqual([alpha.closing, alpha.shortfall, alpha.pendingPo, alpha.suggested, alpha.below], [20, 30, 20, 40, true]);
  assert.equal(rows.find((r) => r.item.id === 'b')!.suggested, 0);
  const lines = poLinesFromReorder(rows, ids());
  assert.deepEqual(lines.map((l) => [l.name, l.quantity, l.rate, l.tax_rate]), [['Alpha', 40, 5, 18]]);
  const notes = reorderNotices(rows, '2026-05-10T00:00:00Z');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].href, '/manufacturing?tab=reorder');
});

test('reports: monthly drill-down agrees with the ledger; movement by party; ageing; negative stock', () => {
  const v = mfg();
  const sale = { id: 'i1', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-06-03', invoice_number: 'INV/3', client: { name: 'Asha Traders' }, items: [{ id: 'x', name: 'Chair', quantity: 3, rate: 900, tax_rate: 18, amount: 2700 }] };
  const positions = computeStock(inputs(stockVoucherInputs([v]), { invoices: [sale as never] }));
  const chair = positions.find((p) => p.item.id === 'chair')!;
  const mm = monthlyMovement(chair, 2026);
  const may = mm.months.find((m) => m.month === '2026-05')!;
  const jun = mm.months.find((m) => m.month === '2026-06')!;
  assert.deepEqual([may.inQty, may.inValue, may.closingQty, may.closingValue], [2, 718, 2, 718]);
  assert.deepEqual([jun.outQty, jun.closingQty], [3, -1]);
  assert.equal(mm.months.find((m) => m.month === '2027-03')!.closingQty, -1, 'later months carry the closing');
  assert.equal(monthVouchers(chair, '2026-05').length, 1);
  const mv = movementAnalysis(positions, '2026-04-01', '2027-03-31').find((x) => x.position.item.id === 'chair')!;
  assert.deepEqual(mv.inward.map((m) => [m.party, m.inQty]), [['Manufacturing', 2]]);
  assert.deepEqual(mv.outward.map((m) => [m.party, m.outQty]), [['Asha Traders', 3]]);
  const neg = negativeStockReport(positions);
  assert.deepEqual(neg.map((n) => [n.position.item.id, n.firstDate, n.lowest, n.episodes]), [['chair', '2026-06-03', -1, 1]]);
  const age = stockAgeing(positions, '2026-07-15').find((r) => r.position.item.id === 'wood')!;
  assert.equal(age.qty[4], 91.2, 'opening stock is in the oldest bucket');
  assert.equal(age.value.reduce((s, x) => s + x, 0), age.position.value);
});
