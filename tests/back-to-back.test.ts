import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { backorderRows, buildBackToBackPos, createBackToBackPos, onOrderQty, openLinkedPos, soToPoRows, type FreeStockFn } from '../src/lib/back-to-back.ts';
import { orderFulfilment } from '../src/lib/sales-orders.ts';
import { poHtml, posForSalesOrder, purchaseOrdersDb } from '../src/lib/purchase-orders.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseOrder, PurchaseRecord, ReceiptNote } from '../src/types/purchases.ts';

function so(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'so1', invoice_number: 'SO/FY26-27/0001', doc_type: 'SALES_ORDER', issue_date: '2026-06-01', due_date: '2026-06-20', status: 'Sent',
    currency: 'INR', template_id: 't', client: { name: 'Acme', company: 'Acme Pvt Ltd', email: '', address: 'Plot 4, Ambattur', city: 'Chennai', zip: '600058', state_code: '33' }, sender: null,
    items: [
      { id: 'L1', name: 'Bearing 6205', type: 'goods', hsn: '8482', unit: 'BOX', unit_factor: 10, quantity: 5, rate: 900, tax_rate: 18, amount: 4500 },
      { id: 'L2', name: 'Grease', type: 'goods', hsn: '3403', unit: 'KG', quantity: 4, rate: 300, tax_rate: 18, amount: 1200 },
      { id: 'L3', name: 'Installation', type: 'service', hsn: '998719', unit: 'NOS', quantity: 1, rate: 2000, tax_rate: 18, amount: 2000 },
    ],
    gst_mode: 'IGST', place_of_supply: '33', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '',
    subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
    ...over,
  } as InvoiceRecord;
}

// 12 base units of bearings (1.2 boxes) and no grease; installation is not a stock item.
const free: FreeStockFn = (line) => (line.name === 'Bearing 6205' ? { itemId: 'brg', qty: 12 } : line.name === 'Grease' ? { itemId: 'grs', qty: 0 } : undefined);
const lastSupplier = (id: string) => (id === 'brg' ? { vendor_name: 'SKF Dealer', vendor_id: 'v1', rate: 80 } : { vendor_name: 'Oil Co', rate: 250 });

test('short quantity with stock and alternate units; last supplier and rate per line unit', () => {
  const f = orderFulfilment(so(), [so()], []);
  const rows = soToPoRows(f, 'so1', [], { free, lastSupplier });
  const b = rows.find((r) => r.line.id === 'L1')!;
  assert.equal(b.free, 1.2, '12 NOS = 1.2 BOX');
  assert.equal(b.short, 3.8);
  assert.equal(b.vendor_name, 'SKF Dealer');
  assert.equal(b.rate, 800, '80 per NOS × 10 per BOX');
  assert.equal(rows.find((r) => r.line.id === 'L2')!.short, 4);
  const svc = rows.find((r) => r.line.id === 'L3')!;
  assert.equal(svc.free, 0);
  assert.equal(svc.vendor_name, '');
  const full = soToPoRows(f, 'so1', [], { free, lastSupplier, fullQty: true });
  assert.equal(full.find((r) => r.line.id === 'L1')!.short, 5);
});

test('one PO per supplier; lines carry so_line_id, the PO so_id; drop-ship takes the customer address', () => {
  const pos = buildBackToBackPos(so(), [
    { soLineId: 'L1', quantity: 3.8, rate: 800, vendor_name: 'SKF Dealer', vendor_id: 'v1', vendor_gstin: '33AAACS1234D1Z5' },
    { soLineId: 'L2', quantity: 4, rate: 250, vendor_name: 'Oil Co' },
    { soLineId: 'L3', quantity: 1, rate: 1500, vendor_name: 'skf dealer' },
    { soLineId: 'L2', quantity: 0, rate: 1, vendor_name: 'Ignored' },
  ], { date: '2026-06-02', dropShip: true, businessState: '33' });
  assert.equal(pos.length, 2);
  const skf = pos[0];
  assert.equal(skf.so_id, 'so1');
  assert.deepEqual(skf.lines.map((l) => [l.so_line_id, l.quantity, l.unit_factor]), [['L1', 3.8, 10], ['L3', 1, undefined]]);
  assert.equal(skf.place_of_supply, '33');
  assert.ok(skf.cgst > 0 && skf.igst === 0, 'same state: CGST + SGST');
  assert.equal(skf.drop_ship, true);
  assert.equal(skf.ship_to?.name, 'Acme Pvt Ltd');
  assert.equal(skf.ship_to?.city, 'Chennai');
  assert.match(poHtml({ ...skf, id: 'p', po_number: 'PO/FY26-27/0001' } as PurchaseOrder, { name: 'Us' }), /Deliver to \(drop-ship\)/);
  assert.throws(() => buildBackToBackPos(so(), [{ soLineId: 'L1', quantity: 1, rate: 1, vendor_name: ' ' }], { date: '2026-06-02' }), /supplier/);
});

test('earlier back-to-back POs reduce the next proposal; backorder status through GRN', () => {
  const po: PurchaseOrder = {
    id: 'p1', po_number: 'PO/FY26-27/0001', date: '2026-06-02', expected_date: '2026-06-10', vendor_name: 'SKF Dealer', so_id: 'so1',
    lines: [{ id: 'pl1', name: 'Bearing 6205', unit: 'BOX', quantity: 3.8, rate: 800, tax_rate: 18, so_line_id: 'L1' }],
    taxable: 3040, cgst: 0, sgst: 0, igst: 547.2, total: 3587.2,
  };
  assert.equal(onOrderQty('so1', [po]).get('L1'), 3.8);
  const f = orderFulfilment(so(), [so()], []);
  assert.equal(soToPoRows(f, 'so1', [po], { free, lastSupplier }).find((r) => r.line.id === 'L1')!.short, 0);
  const input = { invoices: [so()], links: [], orders: [po], purchases: [] as PurchaseRecord[], notes: [] as ReceiptNote[], free };
  let rows = backorderRows(input);
  const bearing = rows.find((r) => r.lineId === 'L1')!;
  assert.equal(bearing.status, 'on_order');
  assert.equal(bearing.pos[0].pending, 3.8);
  assert.equal(rows.find((r) => r.lineId === 'L2')!.status, 'awaiting_po');
  assert.ok(!rows.some((r) => r.lineId === 'L3'), 'a non-stock line with no PO is not a backorder');
  const grn: ReceiptNote = { id: 'g1', kind: 'GRN', number: 'GRN/FY26-27/0001', date: '2026-06-09', po_id: 'p1', vendor_name: 'SKF Dealer', lines: [{ id: 'gl1', name: 'Bearing 6205', quantity: 3.8, rate: 800, tax_rate: 18, po_line_id: 'pl1' }] } as ReceiptNote;
  rows = backorderRows({ ...input, notes: [grn] });
  assert.equal(rows.find((r) => r.lineId === 'L1')!.status, 'arrived');
  assert.equal(rows.find((r) => r.lineId === 'L1')!.pos[0].received, 3.8);
  // Delivered in full: no backorder any more.
  const dc = { ...so({ id: 'dc1', doc_type: 'DELIVERY_CHALLAN', invoice_number: 'DCH/1', sales_order_id: 'so1' }), items: [{ ...so().items[0], id: 'x', order_line_id: 'L1' }] } as InvoiceRecord;
  rows = backorderRows({ ...input, invoices: [so(), dc], notes: [grn] });
  assert.ok(!rows.some((r) => r.lineId === 'L1'));
});

test('cancel warning lists open linked POs only', () => {
  const open: PurchaseOrder = { id: 'p1', po_number: 'PO/1', date: '2026-06-02', vendor_name: 'A', so_id: 'so1', lines: [{ id: 'a', name: 'X', quantity: 2, rate: 1, tax_rate: 0 }], taxable: 2, cgst: 0, sgst: 0, igst: 0, total: 2 };
  const closed = { ...open, id: 'p2', po_number: 'PO/2', closed_on: '2026-06-05', lines: [{ id: 'b', name: 'X', quantity: 2, rate: 1, tax_rate: 0 }] };
  const other = { ...open, id: 'p3', po_number: 'PO/3', so_id: 'so9', lines: [{ id: 'c', name: 'X', quantity: 2, rate: 1, tax_rate: 0 }] };
  assert.deepEqual(openLinkedPos('so1', [open, closed, other], [], []).map((p) => p.po_number), ['PO/1']);
  const bill = { id: 'b1', kind: 'PURCHASE', po_id: 'p1', vendor_name: 'A', bill_number: '1', date: '2026-06-06', lines: [{ id: 'bl', name: 'X', quantity: 2, rate: 1, tax_rate: 0, po_line_id: 'a' }] } as unknown as PurchaseRecord;
  assert.deepEqual(openLinkedPos('so1', [open], [bill], []), [], 'fully billed');
});

test('storage: POs saved in the PO series, queried by sales order', () => {
  resetStorage();
  const drafts = buildBackToBackPos(so(), [{ soLineId: 'L1', quantity: 2, rate: 800, vendor_name: 'A' }, { soLineId: 'L2', quantity: 1, rate: 250, vendor_name: 'B' }], { date: '2026-06-02', businessState: '33' });
  const saved = createBackToBackPos(drafts);
  assert.deepEqual(saved.map((p) => p.po_number), ['PO/FY26-27/0001', 'PO/FY26-27/0002']);
  assert.equal(posForSalesOrder('so1', purchaseOrdersDb.all()).length, 2);
  assert.throws(() => createBackToBackPos([]), /Nothing to order/);
});
