/**
 * 8.88 (PENDING 47) — 8F follow-ups: one debit note spanning several bills of a supplier (also from Breakage / Expiry
 * Issue), kit component shortfall warnings, and the order pad's partial import.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { blankStockItem, computeStock, describeShortfall, shortfallsFromPositions, stockDb, stockWarningForInvoice, type StockItem } from '../src/lib/inventory.ts';
import { loadTracking } from '../src/lib/stock-tracking.ts';
import { notedValue, purchaseReturnsDb, returnableLines } from '../src/lib/purchase-returns.ts';
import { purchasesDb, returnedQtyIssue } from '../src/lib/purchases.ts';
import { brkExpCandidates, claimsDb, createBrkExpIssue, returnedByLine } from '../src/lib/expiry-ops.ts';
import { importOrders, importsDb, signOrderFile, verifyOrderFile, type PadPayload } from '../src/lib/order-pad.ts';
import { buildSalesOrder } from '../src/lib/order-pad-build.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { Bom } from '../src/types/manufacturing.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => {
  setActorProvider(null);
  thawDate();
});

const bill = (id: string, date: string, lines: PurchaseRecord['lines'], over: Partial<PurchaseRecord> = {}): PurchaseRecord => {
  const taxable = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  return {
    id, kind: 'PURCHASE', vendor_id: 'v-alpha', vendor_name: 'Alpha Pharma', bill_number: `A/${id}`, date, place_of_supply: '27', category: 'Purchases',
    lines, taxable, cgst: taxable * 0.06, sgst: taxable * 0.06, igst: 0, itc_eligible: true, total: taxable * 1.12, amount_paid: 0, ...over,
  };
};

function world() {
  stockDb.saveItem(blankStockItem({ id: 'para', name: 'Paracetamol 500', hsn: '3004', track_batches: true, tax_rate: 12 }));
  setTable('purchases', [
    bill('b1', '2026-01-10', [{ id: 'l1', name: 'Paracetamol 500', item_id: 'para', quantity: 10, rate: 20, tax_rate: 12, batch_no: 'P1', expiry_date: '2026-05-31' }]),
    bill('b2', '2026-02-10', [{ id: 'l2', name: 'Paracetamol 500', item_id: 'para', quantity: 5, rate: 22, tax_rate: 12, batch_no: 'P2', expiry_date: '2026-06-15' }]),
  ]);
}

test('one debit note spanning two bills: one number, lines name their bills, on account; returnable / value checks per bill', () => {
  world();
  const note = purchaseReturnsDb.createMulti({
    date: '2026-05-10', reason: '01', goodsReturned: true,
    lines: [
      { id: 'n1', purchase_id: 'b1', bill_line_id: 'l1', name: 'Paracetamol 500', quantity: 4, rate: 20, tax_rate: 12, batch_no: 'P1' },
      { id: 'n2', purchase_id: 'b2', bill_line_id: 'l2', name: 'Paracetamol 500', quantity: 5, rate: 22, tax_rate: 12, batch_no: 'P2' },
    ],
  });
  assert.match(note.note_number, /^DN\/FY26-27\/0001$/);
  assert.equal(note.purchase_id, undefined, 'on account');
  assert.deepEqual(note.bill_refs!.map((b) => b.purchase_id), ['b1', 'b2']);
  assert.equal(note.bill_number, 'A/b1, A/b2');
  assert.equal(note.total, 212.8, '(80 + 110) × 1.12');
  assert.equal(note.adjusted_amount, 0);
  assert.equal(purchasesDb.get('b1')!.amount_paid, 0, 'bill balances untouched');
  // Per-bill effects: returned quantity, value taken off, bill edit guard, delete guard.
  const all = purchaseReturnsDb.all();
  assert.equal(returnableLines(purchasesDb.get('b1')!, all)[0].available, 6);
  assert.equal(notedValue(purchasesDb.get('b2')!, all), 123.2);
  assert.match(returnedQtyIssue({ id: 'b2', lines: [{ ...purchasesDb.get('b2')!.lines[0], quantity: 2 }] }, all), /already returned/);
  assert.throws(() => purchasesDb.remove('b1'), /Delete the note first/);
  // Stock left both batches.
  const t = loadTracking();
  assert.equal(t.get('para')!.batches.find((b) => b.batch === 'P1')!.qty, 6);
  assert.equal(t.get('para')!.batches.find((b) => b.batch === 'P2')!.qty, 0);
  // Over-return on one bill refuses the whole note; mixed suppliers are refused.
  assert.throws(() => purchaseReturnsDb.createMulti({ date: '2026-05-10', reason: '01', goodsReturned: true, lines: [
    { id: 'x1', purchase_id: 'b1', bill_line_id: 'l1', name: 'Paracetamol 500', quantity: 7, rate: 20, tax_rate: 12 },
    { id: 'x2', purchase_id: 'b2', bill_line_id: 'l2', name: 'Paracetamol 500', quantity: 1, rate: 22, tax_rate: 12 },
  ] }), /Bill A\/b1: .*only 6/);
  setTable('purchases', [...getTable<PurchaseRecord>('purchases'), bill('b3', '2026-02-11', [{ id: 'l3', name: 'X', quantity: 1, rate: 10, tax_rate: 12 }], { vendor_id: 'v-beta', vendor_name: 'Beta' })]);
  assert.throws(() => purchaseReturnsDb.createMulti({ date: '2026-05-10', reason: '01', goodsReturned: true, lines: [
    { id: 'y1', purchase_id: 'b1', bill_line_id: 'l1', name: 'Paracetamol 500', quantity: 1, rate: 20, tax_rate: 12 },
    { id: 'y2', purchase_id: 'b3', bill_line_id: 'l3', name: 'X', quantity: 1, rate: 10, tax_rate: 12 },
  ] }), /same supplier/);
});

test('Breakage / Expiry Issue "one note per supplier": one debit note for the supplier\'s two bills, one claim', () => {
  world();
  const purchases = getTable<PurchaseRecord>('purchases');
  const rows = brkExpCandidates(loadTracking(), purchases, '2026-05-10', '2026-07-01', returnedByLine(purchaseReturnsDb.all(), purchases)).rows;
  const claims = createBrkExpIssue(rows, '2026-05-10', { createNote: (d) => purchaseReturnsDb.create(d), createMultiNote: (d) => purchaseReturnsDb.createMulti(d) }, undefined, { onePerSupplier: true });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].note_numbers.length, 1);
  assert.equal(purchaseReturnsDb.all().length, 1);
  assert.equal(purchaseReturnsDb.all()[0].bill_refs!.length, 2);
  assert.equal(claimsDb.all().length, 1);
});

test('kit shortfall: a kit line warns when a tracked component is short', () => {
  const items: StockItem[] = [
    blankStockItem({ id: 'kit', name: 'Gift hamper', track_stock: false, kit: true }),
    blankStockItem({ id: 'choc', name: 'Chocolate', opening_qty: 5, opening_rate: 20, sale_rate: 30 }),
    blankStockItem({ id: 'card', name: 'Card', opening_qty: 50, opening_rate: 2, sale_rate: 10 }),
  ];
  const boms: Bom[] = [{ id: 'bm', item_id: 'kit', name: 'Std', batch_qty: 1, is_default: true, components: [{ id: 'c1', item_id: 'choc', qty: 2 }, { id: 'c2', item_id: 'card', qty: 1 }] }];
  const doc = { doc_type: 'INVOICE', items: [{ id: 'l', name: 'Gift hamper', quantity: 3, rate: 140 }] } as unknown as InvoiceRecord;
  const pos = computeStock({ items, moves: [], invoices: [], kitBoms: boms });
  assert.deepEqual(shortfallsFromPositions(doc, pos), [], 'without the kit table nothing is known');
  const short = shortfallsFromPositions(doc, pos, undefined, { items, boms });
  assert.deepEqual(short.map((s) => [s.itemId, s.requested, s.available, s.kits]), [['choc', 6, 5, ['Gift hamper']]]);
  assert.match(describeShortfall(short[0]), /component of kit Gift hamper/);
  // Live: the editor warning reads the stock master and the BOMs.
  for (const it of items) stockDb.saveItem(it);
  setTable('boms', boms);
  assert.deepEqual(stockWarningForInvoice(doc).map((s) => s.itemId), ['choc']);
});

test('order pad partial import: only the ticked orders; the rest stay importable from the same file', async () => {
  const payload: PadPayload = {
    salesman: { name: 'Ravi' }, created_at: '2026-05-10T09:00:00Z',
    orders: [
      { id: 'o1', date: '2026-05-10', client_name: 'Asha', lines: [{ name: 'Soap', qty: 2, rate: 10 }] },
      { id: 'o2', date: '2026-05-10', client_name: 'Bina', lines: [{ name: 'Soap', qty: 3, rate: 10 }] },
    ],
  };
  const verified = await verifyOrderFile(JSON.stringify(await signOrderFile(payload, 'pw-123456')), 'pw-123456');
  const deps = { buildOrder: buildSalesOrder, save: (r: InvoiceRecord) => localDb.invoices.save(r), defaultTax: 18 };
  const r1 = importOrders(verified, deps, { only: ['o2'] });
  assert.deepEqual(r1.created.map((c) => c.client.name), ['Bina']);
  assert.deepEqual(importsDb.all().map((r) => r.id), ['o2']);
  const r2 = importOrders(verified, deps);
  assert.deepEqual(r2.created.map((c) => c.client.name), ['Asha']);
  assert.equal(r2.duplicates.length, 1);
});
