/**
 * Batches / FEFO / expiry (6.6), godowns + transfers (6.10), serials + warranty (6.11):
 * pure derivations over the same events the costing engine reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStock, type InvoiceLike, type StockItem, type StockMove } from '../src/lib/inventory.ts';
import {
  addMonthsDay, batchOptions, computeTracking, docTrackingIssues, duplicateSerials, expiringBatches,
  expiryNotices, fefoAllocate, fefoBatch, godownSummary, lookupSerial, parseSerials, serialsInStock,
  splitLineByFefo, transferIssues, warrantyUntil,
} from '../src/lib/stock-tracking.ts';
import { nextTransferNumber, godownList, isMultiGodown } from '../src/lib/godowns.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import { trackingText } from '../src/components/templates/paper-helpers.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';
import type { StockTransfer } from '../src/types/stock.ts';

const syrup: StockItem = {
  id: 'syr', name: 'Cough Syrup', hsn: '3004', unit: 'NOS', track_stock: true, track_batches: true,
  opening_qty: 0, opening_rate: 0, reorder_level: 0,
};
const phone: StockItem = {
  id: 'ph', name: 'Phone X', hsn: '8517', unit: 'NOS', track_stock: true, track_serials: true, warranty_months: 12,
  opening_qty: 0, opening_rate: 0, reorder_level: 0,
};

function bill(id: string, date: string, lines: Partial<PurchaseRecord['lines'][number]>[]): PurchaseRecord {
  return {
    id, kind: 'PURCHASE', vendor_name: 'Pharma Dist', bill_number: `B-${id}`, date, category: 'Purchases',
    lines: lines.map((l, i) => ({ id: `${id}-${i}`, name: 'Cough Syrup', quantity: 1, rate: 50, tax_rate: 12, ...l })),
    taxable: 0, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 100, amount_paid: 0,
  };
}

const line = (over: Partial<InvoiceItem>): InvoiceItem => ({
  id: 'l1', name: 'Cough Syrup', type: 'product', quantity: 1, rate: 80, amount: 80, ...over,
});

const sale = (id: string, date: string, items: InvoiceItem[], over: Partial<InvoiceLike> = {}): InvoiceLike => ({
  id, invoice_number: `INV/${id}`, doc_type: 'INVOICE', status: 'Sent', issue_date: date, client: { name: 'Ravi Medicals' } as never,
  items, ...over,
});

const purchases = [
  bill('p1', '2026-04-05', [{ batch_no: 'B-LATE', expiry_date: '2027-12-31', mfg_date: '2026-01-01', quantity: 10 }]),
  bill('p2', '2026-04-06', [{ batch_no: 'B-SOON', expiry_date: '2026-06-30', quantity: 5 }]),
  bill('p3', '2026-04-07', [{ batch_no: 'B-OLD', expiry_date: '2026-04-30', quantity: 3 }]),
];

test('FEFO suggests the unexpired batch that expires first; expired batches are flagged last', () => {
  const t = computeTracking({ items: [syrup], moves: [], invoices: [], purchases }).get('syr');
  const opts = batchOptions(t, '2026-05-10');
  assert.deepEqual(opts.map((o) => [o.batch, o.qty, o.expired]), [
    ['B-SOON', 5, false], ['B-LATE', 10, false], ['B-OLD', 3, true],
  ]);
  assert.equal(fefoBatch(t, '2026-05-10')?.batch, 'B-SOON');
  // Before B-OLD expires it is the first to go.
  assert.equal(fefoBatch(t, '2026-04-20')?.batch, 'B-OLD');
  // Allocation spills to the next batch and never into expired stock.
  const alloc = fefoAllocate(t, '2026-05-10', 7);
  assert.deepEqual(alloc.lines.map((l) => [l.batch, l.qty]), [['B-SOON', 5], ['B-LATE', 2]]);
  assert.equal(alloc.short, 0);
  const split = splitLineByFefo(line({ quantity: 7 }), t, '2026-05-10', () => 'new');
  assert.deepEqual(split.map((l) => [l.id, l.batch_no, l.quantity, l.batch_expiry, l.amount]), [
    ['l1', 'B-SOON', 5, '2026-06-30', 400], ['new', 'B-LATE', 2, '2027-12-31', 160],
  ]);
});

test('sales reduce the batch they name; batch dates come from the purchase', () => {
  const invoices = [sale('s1', '2026-05-01', [line({ quantity: 4, batch_no: 'B-SOON' })])];
  const t = computeTracking({ items: [syrup], moves: [], invoices, purchases }).get('syr')!;
  const soon = t.batches.find((b) => b.batch === 'B-SOON')!;
  assert.equal(soon.qty, 1);
  assert.equal(soon.expiry, '2026-06-30');
  assert.equal(t.batches.find((b) => b.batch === 'B-LATE')!.mfg, '2026-01-01');
  assert.equal(t.qty, 14);
  // Company-wide costing is unchanged by batch tracking.
  assert.equal(computeStock({ items: [syrup], moves: [], invoices, purchases })[0].qty, 14);
});

test('issuing an invoice: a batch is required, an expired batch needs confirmation, short batches warn', () => {
  const input = { items: [syrup], moves: [], invoices: [], purchases };
  const noBatch = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-10', items: [line({})] }, input);
  assert.match(noBatch.errors[0], /choose a batch \(first to expire: B-SOON\)/);
  const expired = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-10', items: [line({ batch_no: 'B-OLD' })] }, input);
  assert.equal(expired.errors.length, 0);
  assert.match(expired.expired[0], /batch B-OLD expired on 2026-04-30/);
  const short = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-10', items: [line({ batch_no: 'B-SOON', quantity: 6 })] }, input);
  assert.match(short.warnings[0], /only 5 NOS left in batch B-SOON/);
  // Quotations and drafts are never checked.
  assert.deepEqual(docTrackingIssues({ doc_type: 'QUOTATION', issue_date: '2026-05-10', items: [line({ batch_no: 'B-OLD' })] }, input).expired, []);
  assert.deepEqual(docTrackingIssues({ doc_type: 'INVOICE', status: 'Draft', issue_date: '2026-05-10', items: [line({})] }, input).errors, []);
});

test('expiry alerts: batches with stock expired or expiring within N days, as bell notices', () => {
  const tracking = computeTracking({ items: [syrup], moves: [], invoices: [], purchases });
  const rows = expiringBatches(tracking, '2026-06-10', 30);
  assert.deepEqual(rows.map((r) => [r.batch, r.daysLeft]), [['B-OLD', -41], ['B-SOON', 20]]);
  assert.equal(expiringBatches(tracking, '2026-06-10', 10).length, 1, 'B-SOON is 20 days out');
  const notes = expiryNotices(rows, '2026-06-10', 30, '2026-06-10T00:00:00.000Z');
  assert.deepEqual(notes.map((n) => n.severity), ['critical', 'warning']);
  assert.match(notes[1].title, /1 batch expiring within 30 days/);
  assert.equal(notes[0].href, '/inventory?tab=batches');
  // Sold-out batches never alert.
  const gone = computeTracking({ items: [syrup], moves: [], invoices: [sale('s', '2026-04-08', [line({ quantity: 3, batch_no: 'B-OLD' })])], purchases });
  assert.ok(!expiringBatches(gone, '2026-06-10', 30).some((r) => r.batch === 'B-OLD'));
});

test('godown balances follow bills, sales and transfers; costing stays company-wide', () => {
  const plain: StockItem = { id: 'w', name: 'Widget', unit: 'NOS', track_stock: true, opening_qty: 5, opening_rate: 10, reorder_level: 0 };
  const bills = [{ ...bill('g1', '2026-05-01', [{ name: 'Widget', quantity: 10, rate: 20, godown_id: 'shop' }]) }];
  const transfers: StockTransfer[] = [{
    id: 't1', transfer_number: 'STR/FY26-27/0001', date: '2026-05-02', from_godown: 'shop', to_godown: 'main',
    lines: [{ id: 'x', item_id: 'w', qty: 4 }],
  }];
  const invoices = [sale('s1', '2026-05-03', [line({ name: 'Widget', quantity: 3, godown_id: 'main' })])];
  const tracking = computeTracking({ items: [plain], moves: [], invoices, purchases: bills, transfers });
  const row = godownSummary(tracking)[0];
  assert.deepEqual(row.byGodown, { main: 6, shop: 6 });
  assert.equal(row.total, 12);
  // Transfers never change quantity or value in the costing engine.
  const withT = computeStock({ items: [plain], moves: [], invoices, purchases: bills, transfers, includeTransfers: true })[0];
  const withoutT = computeStock({ items: [plain], moves: [], invoices, purchases: bills })[0];
  assert.deepEqual([withT.qty, withT.value], [withoutT.qty, withoutT.value]);
  // A transfer cannot take more than the source godown holds.
  const issues = transferIssues({ id: 'new', date: '2026-05-04', from_godown: 'main', to_godown: 'shop', lines: [{ id: 'a', item_id: 'w', qty: 7 }] },
    { items: [plain], moves: [], invoices, purchases: bills, transfers });
  assert.match(issues[0], /only 6 NOS in the source godown/);
  assert.deepEqual(transferIssues({ id: 'new', date: '2026-05-04', from_godown: 'main', to_godown: 'shop', lines: [{ id: 'a', item_id: 'w', qty: 6 }] },
    { items: [plain], moves: [], invoices, purchases: bills, transfers }), []);
});

test('godown list: Main is implicit, multi-godown mode starts with a second godown', () => {
  assert.deepEqual(godownList([]).map((g) => g.name), ['Main']);
  assert.equal(isMultiGodown([]), false);
  assert.equal(isMultiGodown([{ id: 'main', name: 'Head office' }]), false, 'renaming Main is not a second godown');
  assert.deepEqual(godownList([{ id: 'main', name: 'Head office' }, { id: 'g2', name: 'Bhiwandi' }]).map((g) => g.name), ['Head office', 'Bhiwandi']);
});

test('transfer numbers follow the Indian FY and restart on 1 April', () => {
  assert.equal(nextTransferNumber([], '2026-03-31'), 'STR/FY25-26/0001');
  assert.equal(nextTransferNumber(['STR/FY25-26/0001', 'STR/FY25-26/0007'], '2026-03-31'), 'STR/FY25-26/0008');
  assert.equal(nextTransferNumber(['STR/FY25-26/0001', 'STR/FY25-26/0007'], '2026-04-01'), 'STR/FY26-27/0001');
});

const phoneBill = bill('ph1', '2026-04-10', [{ name: 'Phone X', quantity: 3, rate: 10000, serials: ['IMEI-001', 'IMEI-002', 'imei-003'] }]);
const phoneLine = (over: Partial<InvoiceItem>): InvoiceItem => ({ id: 'pl', name: 'Phone X', type: 'product', quantity: 1, rate: 15000, amount: 15000, ...over });

test('serials: bought in, sold out once, never twice; counts must match quantity', () => {
  const sold = sale('s1', '2026-05-10', [phoneLine({ serials: ['IMEI-001'], warranty_months: 12 })]);
  const input = { items: [phone], moves: [] as StockMove[], invoices: [sold], purchases: [phoneBill] };
  const t = computeTracking(input).get('ph');
  assert.deepEqual(serialsInStock(t), ['IMEI-002', 'imei-003']);
  const again = docTrackingIssues({ id: 'new', doc_type: 'INVOICE', issue_date: '2026-05-12', items: [phoneLine({ serials: ['imei-001'] })] }, input);
  assert.match(again.errors[0], /serial imei-001 is not in stock \(sold on INV\/s1\)/);
  const count = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-12', items: [phoneLine({ quantity: 2, serials: ['IMEI-002'] })] }, input);
  assert.match(count.errors[0], /pick 2 serial numbers \(1 picked\)/);
  const unknown = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-12', items: [phoneLine({ serials: ['NOPE'] })] }, input);
  assert.match(unknown.errors[0], /never received/);
  const dup = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-12', items: [phoneLine({ quantity: 2, serials: ['IMEI-002', 'imei-002'] })] }, input);
  assert.ok(dup.errors.some((e) => /appears twice/.test(e)));
  // Re-saving the invoice that sold it is fine (its own copy is excluded).
  assert.deepEqual(docTrackingIssues({ ...sold, items: sold.items!, issue_date: '2026-05-10', doc_type: 'INVOICE' }, input).errors, []);
  assert.deepEqual(duplicateSerials(['a', 'B', 'A ']), ['A']);
  assert.deepEqual(parseSerials('A1\n A2 ,A3\n\n'), ['A1', 'A2', 'A3']);
});

test('a credit note that names a serial puts it back in stock', () => {
  const sold = sale('s1', '2026-05-10', [phoneLine({ serials: ['IMEI-001'] })]);
  const cn = sale('c1', '2026-05-20', [phoneLine({ serials: ['IMEI-001'] })], { doc_type: 'CREDIT_NOTE', invoice_number: 'CRN/1' });
  const input = { items: [phone], moves: [], invoices: [sold, cn], purchases: [phoneBill] };
  assert.deepEqual(serialsInStock(computeTracking(input).get('ph')), ['IMEI-001', 'IMEI-002', 'imei-003']);
  // Returning a serial that is in stock is refused.
  const bad = docTrackingIssues({ doc_type: 'CREDIT_NOTE', issue_date: '2026-05-21', items: [phoneLine({ serials: ['IMEI-002'] })] }, input);
  assert.match(bad.errors[0], /already in stock/);
});

test('warranty runs from the sale date and ends the day before the anniversary', () => {
  assert.equal(warrantyUntil('2026-05-10', 12), '2027-05-09');
  assert.equal(warrantyUntil('2026-01-31', 1), '2026-02-27');
  assert.equal(addMonthsDay('2024-01-31', 1), '2024-02-29');
  assert.equal(warrantyUntil('2026-05-10', 0), '');
});

test('serial lookup: purchase bill, vendor, sale invoice, client and warranty status', () => {
  const sold = sale('s1', '2026-05-10', [phoneLine({ serials: ['IMEI-002'], warranty_months: 12 })]);
  const tracking = computeTracking({ items: [phone], moves: [], invoices: [sold], purchases: [phoneBill] });
  const [hit] = lookupSerial(tracking, 'imei-002', '2026-10-24');
  assert.equal(hit.serial, 'IMEI-002');
  assert.equal(hit.item.name, 'Phone X');
  assert.equal(hit.inStock, false);
  assert.deepEqual([hit.received?.refNumber, hit.received?.party, hit.received?.date], ['B-ph1', 'Pharma Dist', '2026-04-10']);
  assert.deepEqual([hit.sale?.refNumber, hit.sale?.party, hit.sale?.date], ['INV/s1', 'Ravi Medicals', '2026-05-10']);
  assert.deepEqual([hit.warrantyUntil, hit.warranty], ['2027-05-09', 'active']);
  assert.equal(lookupSerial(tracking, 'imei-002', '2027-05-10')[0].warranty, 'expired');
  const inStock = lookupSerial(tracking, 'IMEI-001', '2026-10-24')[0];
  assert.deepEqual([inStock.inStock, inStock.warranty, inStock.sale], [true, 'none', undefined]);
  // Partial search lists every match, exact first.
  assert.equal(lookupSerial(tracking, 'imei', '2026-10-24').length, 3);
  assert.deepEqual(lookupSerial(tracking, '', '2026-10-24'), []);
});

test('serials move between godowns with a transfer and must be sold from where they are', () => {
  const transfers: StockTransfer[] = [{
    id: 't1', transfer_number: 'STR/FY26-27/0001', date: '2026-04-11', from_godown: 'main', to_godown: 'shop',
    lines: [{ id: 'x', item_id: 'ph', qty: 1, serials: ['IMEI-001'] }],
  }];
  const input = { items: [phone], moves: [], invoices: [], purchases: [phoneBill], transfers };
  const t = computeTracking(input).get('ph');
  assert.deepEqual(serialsInStock(t, 'shop'), ['IMEI-001']);
  assert.deepEqual(serialsInStock(t, 'main'), ['IMEI-002', 'imei-003']);
  const wrong = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-01', items: [phoneLine({ serials: ['IMEI-001'], godown_id: 'main' })] }, input, true);
  assert.match(wrong.errors[0], /in another godown/);
  const right = docTrackingIssues({ doc_type: 'INVOICE', issue_date: '2026-05-01', items: [phoneLine({ serials: ['IMEI-001'], godown_id: 'shop' })] }, input, true);
  assert.deepEqual(right.errors, []);
  const badTransfer = transferIssues({ id: 'n', date: '2026-05-01', from_godown: 'main', to_godown: 'shop', lines: [{ id: 'a', item_id: 'ph', qty: 1, serials: ['IMEI-001'] }] }, input);
  assert.match(badTransfer[0], /not in stock in the source godown/);
});

test('opening serials and adjustment moves carry tracking too', () => {
  const item: StockItem = { ...phone, opening_qty: 1, opening_serials: ['OPEN-1'] };
  const moves: StockMove[] = [
    { id: 'm1', item_id: 'ph', date: '2026-04-02', qty: 1, rate: 9000, kind: 'adjustment', serials: ['ADJ-1'] },
    { id: 'm2', item_id: 'ph', date: '2026-04-03', qty: -1, rate: 0, kind: 'adjustment', serials: ['OPEN-1'], note: 'Damaged' },
  ];
  assert.deepEqual(serialsInStock(computeTracking({ items: [item], moves, invoices: [] }).get('ph')), ['ADJ-1']);
});

test('when challans move stock, an invoice made from a challan does not move it again', () => {
  const plain: StockItem = { id: 'w', name: 'Widget', unit: 'NOS', track_stock: true, opening_qty: 10, opening_rate: 10, reorder_level: 0 };
  const dc = sale('dc', '2026-05-01', [line({ name: 'Widget', quantity: 4 })], { doc_type: 'DELIVERY_CHALLAN' });
  const inv = sale('iv', '2026-05-02', [line({ name: 'Widget', quantity: 4 })]);
  const links = [{ from_id: 'dc', to_id: 'iv', relation: 'converted' }];
  assert.equal(computeStock({ items: [plain], moves: [], invoices: [dc, inv], includeChallans: true, links })[0].qty, 6);
  // Without challan stock (the default) the invoice is what moves stock.
  assert.equal(computeStock({ items: [plain], moves: [], invoices: [dc, inv], includeChallans: false, links })[0].qty, 6);
});

test('printed sub-line: batch + MFG / expiry as MM/YYYY, serials with warranty; nothing for plain lines', () => {
  assert.equal(trackingText({ batch_no: 'B12', batch_mfg: '2026-01-15', batch_expiry: '2027-06-30' }), 'Batch B12 · Mfg 01/2026 · Exp 06/2027');
  assert.equal(trackingText({ serials: ['A1', 'A2'], warranty_months: 12 }), 'S/N: A1, A2 · Warranty 12 months');
  assert.equal(trackingText({}), '');
  assert.equal(trackingText(undefined), '');
});
