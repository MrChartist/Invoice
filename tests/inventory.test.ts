import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStock,
  deadStock,
  marginReport,
  movementSummary,
  makeAdjustment,
  shortfallsFor,
  stockSummaryCsv,
  summarize,
  type InvoiceLike,
  type PurchaseLike,
  type StockItem,
  type StockMove,
} from '../src/lib/inventory.ts';

const item = (over: Partial<StockItem> = {}): StockItem => ({
  id: 'i1', name: 'Widget', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 100,
  reorder_level: 0, ...over,
});

const inv = (
  id: string, date: string, qty: number, over: Partial<InvoiceLike> = {}, rate = 200,
): InvoiceLike => ({
  id, invoice_number: id, doc_type: 'INVOICE', status: 'Sent', issue_date: date,
  items: [{ id: id + 'l', name: 'widget', type: 'product', quantity: qty, rate, amount: qty * rate }],
  ...over,
});

const purchase = (id: string, date: string, qty: number, rate: number): PurchaseLike => ({
  id, bill_date: date, status: 'Posted', lines: [{ name: 'Widget', quantity: qty, rate }],
});

const run = (
  o: { items?: StockItem[]; moves?: StockMove[]; invoices?: InvoiceLike[]; purchases?: PurchaseLike[] },
  method: 'WEIGHTED_AVG' | 'FIFO' = 'WEIGHTED_AVG',
  extra: { includeChallans?: boolean; asOf?: string } = {},
) =>
  computeStock({
    items: o.items ?? [item()], moves: o.moves ?? [], invoices: o.invoices ?? [],
    purchases: o.purchases ?? [], method, ...extra,
  })[0];

test('weighted average: purchase blends cost, partial sale uses average', () => {
  const p = run({
    purchases: [purchase('p1', '2026-04-02', 10, 120)],
    invoices: [inv('S1', '2026-04-05', 5)],
  });
  assert.equal(p.qty, 15);
  assert.equal(p.cogs, 550); // 5 x 110
  assert.equal(p.value, 1650);
  assert.equal(p.avgCost, 110);
  assert.equal(p.revenue, 1000);
  assert.equal(p.purchasedQty, 10);
});

test('weighted average: sales return re-enters at last issue cost', () => {
  const p = run({
    purchases: [purchase('p1', '2026-04-02', 10, 120)],
    invoices: [
      inv('S1', '2026-04-05', 5),
      inv('C1', '2026-04-06', 2, { doc_type: 'CREDIT_NOTE' }),
    ],
  });
  assert.equal(p.qty, 17);
  assert.equal(p.value, 1870);
  assert.equal(p.returnedQty, 2);
  assert.equal(p.soldQty, 3);
  assert.equal(p.cogs, 330);
});

test('weighted average: negative stock flagged and valued at last cost', () => {
  const p = run({
    purchases: [purchase('p1', '2026-04-02', 10, 120)],
    invoices: [inv('S1', '2026-04-05', 23)],
  });
  assert.equal(p.qty, -3);
  assert.equal(p.status, 'negative');
  assert.equal(p.isNegative, true);
  assert.equal(p.value, -330);
  assert.equal(summarize([p]).negativeCount, 1);
});

test('FIFO: partial sale consumes oldest layers first', () => {
  const p = run(
    { purchases: [purchase('p1', '2026-04-02', 10, 120)], invoices: [inv('S1', '2026-04-05', 15)] },
    'FIFO',
  );
  assert.equal(p.cogs, 1600); // 10x100 + 5x120
  assert.equal(p.qty, 5);
  assert.equal(p.value, 600);
  assert.equal(p.avgCost, 120);
});

test('FIFO: negative stock is covered by the next receipt', () => {
  const base = {
    purchases: [purchase('p1', '2026-04-02', 10, 120)],
    invoices: [inv('S1', '2026-04-05', 15), inv('S2', '2026-04-06', 8)],
  };
  const neg = run(base, 'FIFO');
  assert.equal(neg.qty, -3);
  assert.equal(neg.value, -360);
  const covered = run(
    { ...base, purchases: [...base.purchases, purchase('p2', '2026-04-07', 5, 130)] },
    'FIFO',
  );
  assert.equal(covered.qty, 2);
  assert.equal(covered.value, 260);
});

test('methods differ on the same data', () => {
  const o = { purchases: [purchase('p1', '2026-04-02', 10, 120)], invoices: [inv('S1', '2026-04-05', 15)] };
  assert.notEqual(run(o, 'FIFO').cogs, run(o, 'WEIGHTED_AVG').cogs);
  assert.equal(run(o, 'WEIGHTED_AVG').cogs, 1650);
});

test('cancelled, draft, quotation and proforma never touch stock; challan is optional', () => {
  const invoices = [
    inv('X1', '2026-04-03', 4, { status: 'Cancelled' }),
    inv('X2', '2026-04-03', 4, { status: 'Draft' }),
    inv('X3', '2026-04-03', 4, { doc_type: 'QUOTATION' }),
    inv('X4', '2026-04-03', 4, { doc_type: 'PROFORMA' }),
    inv('X5', '2026-04-03', 3, { doc_type: 'DELIVERY_CHALLAN' }),
  ];
  assert.equal(run({ invoices }).qty, 10);
  assert.equal(run({ invoices }, 'WEIGHTED_AVG', { includeChallans: true }).qty, 7);
});

test('cancelled purchases are excluded', () => {
  const purchases = [{ ...purchase('p1', '2026-04-02', 10, 120), status: 'Cancelled' }];
  assert.equal(run({ purchases }).qty, 10);
});

test('matching is case-insensitive and respects HSN conflicts', () => {
  const items = [item({ hsn: '8471' })];
  const ok = inv('S1', '2026-04-05', 2);
  ok.items![0].hsn = '8471';
  const bad = inv('S2', '2026-04-05', 2);
  bad.items![0].hsn = '9999';
  assert.equal(run({ items, invoices: [ok] }).qty, 8);
  assert.equal(run({ items, invoices: [bad] }).qty, 10);
});

test('manual adjustments: add uses average when no rate, remove reduces value', () => {
  const moves = [
    makeAdjustment({ item_id: 'i1', date: '2026-04-02', direction: 'add', qty: 5, reason: 'Found' }),
    makeAdjustment({ item_id: 'i1', date: '2026-04-03', direction: 'remove', qty: 3, reason: 'Damaged' }),
  ];
  const p = run({ moves });
  assert.equal(p.qty, 12);
  assert.equal(p.value, 1200);
  assert.equal(p.adjustedInQty, 5);
  assert.equal(p.adjustedOutQty, 3);
  assert.equal(p.cogs, 0); // adjustments are not COGS
});

test('same-day receipts are applied before issues', () => {
  const p = run({
    items: [item({ opening_qty: 0 })],
    invoices: [inv('S1', '2026-04-05', 5)],
    purchases: [purchase('p1', '2026-04-05', 5, 50)],
  });
  assert.equal(p.qty, 0);
  assert.equal(p.status, 'out');
});

test('status: low at/below reorder level, ok above, untracked ignored', () => {
  assert.equal(run({ items: [item({ reorder_level: 10 })] }).status, 'low');
  assert.equal(run({ items: [item({ reorder_level: 9 })] }).status, 'ok');
  const u = run({ items: [item({ track_stock: false })], invoices: [inv('S1', '2026-04-05', 5)] });
  assert.equal(u.status, 'untracked');
  assert.equal(u.qty, 0);
});

test('ledger: running balance and value', () => {
  const p = run({
    purchases: [purchase('p1', '2026-04-02', 10, 120)],
    invoices: [inv('S1', '2026-04-05', 5)],
  });
  assert.deepEqual(p.ledger.map((r) => r.balance), [10, 20, 15]);
  assert.deepEqual(p.ledger.map((r) => r.value), [1000, 2200, 1650]);
  assert.equal(p.ledger[0].particulars, 'Opening balance');
  assert.equal(p.ledger[2].qtyOut, 5);
});

test('inputs are not mutated', () => {
  const invoices = [inv('S1', '2026-04-05', 5)];
  const snap = JSON.stringify(invoices);
  run({ invoices });
  assert.equal(JSON.stringify(invoices), snap);
});

test('movement summary for a period', () => {
  const positions = computeStock({
    items: [item()], moves: [],
    invoices: [inv('S1', '2026-04-05', 4), inv('S2', '2026-05-05', 2)],
    purchases: [purchase('p1', '2026-04-02', 10, 120)], method: 'WEIGHTED_AVG',
  });
  const [m] = movementSummary(positions, '2026-05-01', '2026-05-31');
  assert.equal(m.openingQty, 16);
  assert.equal(m.outQty, 2);
  assert.equal(m.inQty, 0);
  assert.equal(m.closingQty, 14);
});

test('dead stock and margin', () => {
  const positions = computeStock({
    items: [item()], moves: [], invoices: [inv('S1', '2026-01-05', 4)], purchases: [], method: 'WEIGHTED_AVG',
  });
  const dead = deadStock(positions, 90, '2026-04-30');
  assert.equal(dead.length, 1);
  assert.equal(dead[0].daysIdle, 115);
  assert.equal(deadStock(positions, 200, '2026-04-30').length, 0);
  const [m] = marginReport(positions);
  assert.equal(m.avgSaleRate, 200);
  assert.equal(m.avgCostRate, 100);
  assert.equal(m.marginPct, 50);
  assert.equal(m.totalMargin, 400);
});

test('shortfalls: warns only for stock-reducing docs and excludes the doc itself', () => {
  const inputs = { items: [item()], moves: [], invoices: [inv('S1', '2026-04-05', 8)], purchases: [] };
  const draft = { doc_type: 'INVOICE' as const, items: inv('N', '', 5).items! };
  const s = shortfallsFor(draft, inputs);
  assert.equal(s.length, 1);
  assert.equal(s[0].available, 2);
  assert.equal(s[0].shortBy, 3);
  assert.deepEqual(shortfallsFor({ ...draft, doc_type: 'QUOTATION' }, inputs), []);
  assert.deepEqual(shortfallsFor({ ...draft, doc_type: 'CREDIT_NOTE' }, inputs), []);
  // editing S1 itself: its own 8 units are released
  assert.deepEqual(shortfallsFor({ ...draft, id: 'S1', items: inv('S1', '', 8).items! }, inputs), []);
});

test('csv export escapes and guards formulas', () => {
  const p = run({ items: [item({ name: '=cmd, "x"' })] });
  const csv = stockSummaryCsv([p]);
  assert.ok(csv.includes('"\'=cmd, ""x"""'));
  assert.ok(csv.split('\r\n').length === 2);
});
