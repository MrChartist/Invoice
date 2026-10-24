/** Party / item profitability (roadmap 6.25). */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoster, itemProfitCsv, itemProfitability, partyProfitCsv, partyProfitability } from '../src/lib/profitability.ts';
import { computeStock, type StockItem } from '../src/lib/inventory.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const FY = { start: '2026-04-01', end: '2027-03-31' };

function sale(over: Partial<InvoiceRecord> & { items: InvoiceRecord['items'] }): InvoiceRecord {
  const taxable = over.items.reduce((s, i) => s + i.quantity * i.rate, 0);
  return {
    id: 'S', invoice_number: 'INV/1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-06-10', due_date: '2026-06-25', currency: 'INR',
    client: { id: 'c1', name: 'Acme' }, gst_mode: 'NONE', tax_rate: 0, discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: false, amount_paid: 0, taxable_value: taxable, tax_amount: 0, total: taxable, balance_due: taxable, ...over,
  } as InvoiceRecord;
}
const line = (name: string, quantity: number, rate: number, hsn = '') => ({ id: name + quantity, name, hsn, type: 'Goods', quantity, rate, tax_rate: 0, amount: quantity * rate });

function bill(over: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    id: 'P', kind: 'PURCHASE', vendor_name: 'Supplier', bill_number: 'B1', date: '2026-05-01', category: 'Purchases', lines: [],
    taxable: 0, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 0, amount_paid: 0, ...over,
  };
}

const purchases = [
  bill({ id: 'P1', date: '2026-05-01', lines: [{ id: 'l', name: 'Widget', hsn: '8471', quantity: 10, rate: 60, tax_rate: 18 }], taxable: 600, total: 708 }),
  bill({ id: 'P2', date: '2026-07-01', lines: [{ id: 'l', name: 'Widget', hsn: '8471', quantity: 10, rate: 80, tax_rate: 18 }], taxable: 800, total: 944 }),
  bill({ id: 'X', status: 'Cancelled' as never, lines: [{ id: 'l', name: 'Widget', hsn: '8471', quantity: 100, rate: 1, tax_rate: 18 }], taxable: 100, total: 100 } as Partial<PurchaseRecord>),
  bill({ id: 'E', kind: 'EXPENSE', category: 'Travel', billable_to_client_id: 'c1', date: '2026-06-15', taxable: 1000, cgst: 25, sgst: 25, total: 1050, itc_eligible: false }),
  bill({ id: 'E2', kind: 'EXPENSE', category: 'Travel', billable_to_client_id: 'c3', date: '2026-06-15', taxable: 200, total: 200 }),
];

test('purchase costing: weighted average of bills on or before the sale, by name + HSN', () => {
  const c = buildCoster(purchases);
  // Sale on 10 Jun: only P1 (60) is older; cancelled bill ignored.
  assert.deepEqual(c.cost({ name: 'widget', hsn: '8471', quantity: 5 }, { id: 'S', date: '2026-06-10' }), { cost: 300, source: 'purchases' });
  // Sale on 10 Jul: average of 60 and 80 = 70.
  assert.deepEqual(c.cost({ name: 'Widget', hsn: '', quantity: 2 }, { id: 'S', date: '2026-07-10' }), { cost: 140, source: 'purchases' });
  // Before any bill: falls back to all bills.
  assert.equal(c.cost({ name: 'Widget', hsn: '8471', quantity: 1 }, { id: 'S', date: '2026-01-01' }).cost, 70);
  // Conflicting HSN does not match.
  assert.equal(c.cost({ name: 'Widget', hsn: '9999', quantity: 1 }, { id: 'S', date: '2026-07-10' }).source, 'none');
  assert.deepEqual(c.cost({ name: 'Consulting', hsn: '', quantity: 3 }, { id: 'S', date: '2026-07-10' }), { cost: 0, source: 'none' });
});

test('inventory costing wins for tracked items (cost issued for that very invoice)', () => {
  const items: StockItem[] = [{ id: 'w', name: 'Gadget', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 40, reorder_level: 0 }];
  const inv = sale({ id: 'G', items: [line('Gadget', 4, 100)] });
  const positions = computeStock({ items, moves: [], invoices: [inv], purchases: [] });
  const c = buildCoster([], [], positions);
  assert.deepEqual(c.cost({ name: 'Gadget', hsn: '', quantity: 4 }, { id: 'G', date: '2026-06-10' }), { cost: 160, source: 'stock' });
});

test('item profitability: revenue, cost, margin; credit notes reverse; uncosted services flagged', () => {
  const invoices = [
    sale({ id: 'S1', items: [line('Widget', 5, 100, '8471'), line('Consulting', 2, 1500)] }),
    sale({ id: 'S2', invoice_number: 'INV/2', issue_date: '2026-07-10', items: [line('Widget', 10, 90, '8471')] }),
    sale({ id: 'C1', invoice_number: 'CRN/1', doc_type: 'CREDIT_NOTE', issue_date: '2026-07-12', items: [line('Widget', 1, 90, '8471')] }),
    sale({ id: 'D', status: 'Draft', items: [line('Widget', 99, 1)] }),
  ];
  const rep = itemProfitability({ invoices, purchases }, FY);
  const w = rep.rows.find((r) => r.name === 'Widget')!;
  // Revenue 500 + 900 − 90 = 1,310; cost 5×60 + 10×70 − 1×70 = 930; profit 380
  assert.equal(w.quantity, 14);
  assert.equal(w.revenue, 1310);
  assert.equal(w.cost, 930);
  assert.equal(w.profit, 380);
  assert.equal(w.margin, 29.01);
  assert.equal(w.source, 'purchases');
  const s = rep.rows.find((r) => r.name === 'Consulting')!;
  assert.equal(s.source, 'none');
  assert.equal(s.uncosted, 3000);
  assert.equal(rep.totals.revenue, 4310);
  assert.equal(rep.totals.uncosted, 3000);
  assert.match(itemProfitCsv(rep, FY), /Not costed/);
});

test('party profitability: COGS plus billable expenses; foreign docs at their rate; rate-less left out', () => {
  const invoices = [
    sale({ id: 'S1', items: [line('Widget', 5, 100, '8471')] }),
    sale({ id: 'F', invoice_number: 'INV/F', client: { id: 'c2', name: 'Globex' } as never, currency: 'USD', exchange_rate: 80, items: [line('Consulting', 1, 100)] }),
    sale({ id: 'N', invoice_number: 'INV/N', client: { id: 'c2', name: 'Globex' } as never, currency: 'EUR', items: [line('Consulting', 1, 100)] }),
  ];
  const rep = partyProfitability({ invoices, purchases, clients: [{ id: 'c3', name: 'Gamma', email: '', address: '', city: '', zip: '' }] }, FY);
  const acme = rep.rows.find((r) => r.clientId === 'c1')!;
  // 500 revenue − 300 COGS − 1,050 travel re-billable (ITC not claimed → total) = −850
  assert.equal(acme.revenue, 500);
  assert.equal(acme.cogs, 300);
  assert.equal(acme.expenses, 1050);
  assert.equal(acme.profit, -850);
  const globex = rep.rows.find((r) => r.clientId === 'c2')!;
  assert.equal(globex.revenue, 8000);
  assert.equal(rep.excluded, 1);
  const gamma = rep.rows.find((r) => r.clientId === 'c3')!;
  assert.equal(gamma.name, 'Gamma');
  assert.equal(gamma.expenses, 200);
  assert.equal(rep.totals.profit, round(rep.rows.reduce((s, r) => s + r.profit, 0)));
  assert.match(partyProfitCsv(rep, FY), /Billable expenses/);
});

const round = (n: number) => Math.round(n * 100) / 100;
