/**
 * 8F stock depth & pharma: Breakage / Expiry Issue grouping and all-or-nothing debit notes, claims,
 * Expiry receive / destroy + ITC reminders, non-saleable godown and MRP sale gates, fast / slow / ABC,
 * variants, kits as a stock event source, thermal roll labels (TSPL / EPL / ZPL) and weighed-goods EANs.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { setActorProvider, isAccessDeniedError, type Role } from '../src/lib/access.ts';
import { getTable, setTable, generateId } from '../src/lib/storage.ts';
import { audit } from '../src/lib/audit.ts';
import { blankStockItem, collectEvents, computeStock, loadPositions, stockDb, type StockItem } from '../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs, loadTracking } from '../src/lib/stock-tracking.ts';
import { purchaseReturnsDb } from '../src/lib/purchase-returns.ts';
import {
  brkExpCandidates, claimsDb, createBrkExpIssue, destroyExpiryStock, groupBySupplier, itcReminders, receiptsDb, returnedByLine,
} from '../src/lib/expiry-ops.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import { linePricePerBase, saleLimitGate, type PharmaSettings } from '../src/lib/pharma-gate.ts';
import { abcClasses, abcAnalysis, movingAnalysis } from '../src/lib/stock-analysis.ts';
import { cleanAxes, combinations, generateVariants, planVariants } from '../src/lib/variants.ts';
import { kitTable } from '../src/lib/events-kits.ts';
import { LABEL_LAYOUTS, labelSheetHtml, layoutById, pageSize } from '../src/lib/label-sheet.ts';
import { parseWeighedEan, rawLabels, weighedEan, weighedLabel } from '../src/lib/label-raw.ts';
import { isValidEan13 } from '../src/lib/barcode.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { Bom } from '../src/types/manufacturing.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const as = (role: Role | null) => setActorProvider(role ? () => ({ id: 'u', name: 'U', role }) : null);

beforeEach(() => {
  as(null);
  resetStorage();
  installSettings();
  freezeDate('2026-05-10T10:00:00');
});
afterEach(() => {
  as(null);
  thawDate();
});

const bill = (id: string, vendor: string, date: string, lines: PurchaseRecord['lines']): PurchaseRecord => {
  const taxable = lines.reduce((s, l) => s + l.quantity * l.rate, 0);
  return {
    id, kind: 'PURCHASE', vendor_id: `v-${vendor}`, vendor_name: vendor, bill_number: `${vendor}/${id}`, date, place_of_supply: '27', category: 'Purchases',
    lines, taxable, cgst: taxable * 0.06, sgst: taxable * 0.06, igst: 0, itc_eligible: true, total: taxable * 1.12, amount_paid: 0,
  };
};

function pharmaWorld() {
  stockDb.saveItem(blankStockItem({ id: 'para', name: 'Paracetamol 500', hsn: '3004', track_batches: true, tax_rate: 12 }));
  stockDb.saveItem(blankStockItem({ id: 'amox', name: 'Amoxicillin 250', hsn: '3004', track_batches: true, tax_rate: 12 }));
  setTable('purchases', [
    bill('b1', 'Alpha Pharma', '2026-01-10', [
      { id: 'l1', name: 'Paracetamol 500', item_id: 'para', quantity: 10, rate: 20, tax_rate: 12, batch_no: 'P1', expiry_date: '2026-05-31', mrp: 30 },
      { id: 'l2', name: 'Amoxicillin 250', item_id: 'amox', quantity: 5, rate: 50, tax_rate: 12, batch_no: 'A1', expiry_date: '2026-04-30' },
    ]),
    bill('b2', 'Beta Distributors', '2026-02-10', [
      { id: 'l3', name: 'Paracetamol 500', quantity: 8, rate: 21, tax_rate: 12, batch_no: 'P2', expiry_date: '2026-06-15' },
      { id: 'l4', name: 'Paracetamol 500', quantity: 50, rate: 21, tax_rate: 12, batch_no: 'P9', expiry_date: '2028-01-01' },
    ]),
  ]);
}

test('Breakage / Expiry Issue: batches traced to supplier bills and grouped by supplier', () => {
  pharmaWorld();
  const tracking = loadTracking();
  const { rows, untraced } = brkExpCandidates(tracking, getTable<PurchaseRecord>('purchases'), '2026-05-10', '2026-07-01');
  assert.deepEqual(rows.map((r) => [r.vendorName, r.item, r.batch, r.qty, r.expired]), [
    ['Alpha Pharma', 'Amoxicillin 250', 'A1', 5, true],
    ['Alpha Pharma', 'Paracetamol 500', 'P1', 10, false],
    ['Beta Distributors', 'Paracetamol 500', 'P2', 8, false],
  ]);
  assert.equal(untraced.length, 0);
  const groups = groupBySupplier(rows);
  assert.deepEqual(groups.map((g) => [g.vendorName, g.bills, g.value]), [['Alpha Pharma', ['b1'], 450], ['Beta Distributors', ['b2'], 168]]);
  // Already returned quantity is not offered again.
  const returned = new Map([['l1', 4]]);
  assert.equal(brkExpCandidates(tracking, getTable<PurchaseRecord>('purchases'), '2026-05-10', '2026-07-01', returned).rows.find((r) => r.batch === 'P1')!.qty, 6);
});

test('Breakage / Expiry Issue: one debit note per bill, one claim per supplier, all-or-nothing; claims tracked', () => {
  pharmaWorld();
  const purchases = getTable<PurchaseRecord>('purchases');
  const rows = brkExpCandidates(loadTracking(), purchases, '2026-05-10', '2026-07-01', returnedByLine(purchaseReturnsDb.all(), purchases)).rows;
  // Refused half-way (second supplier's note): nothing is written.
  let n = 0;
  assert.throws(() => createBrkExpIssue(rows, '2026-05-10', { createNote: (d) => { if (++n === 2) throw new Error('locked'); return purchaseReturnsDb.create(d); } }), /locked/);
  assert.equal(purchaseReturnsDb.all().length, 0);
  assert.equal(claimsDb.all().length, 0);
  assert.equal(getTable<PurchaseRecord>('purchases').find((p) => p.id === 'b1')!.amount_paid, 0, 'bill adjustments rolled back too');

  const claims = createBrkExpIssue(rows, '2026-05-10', { createNote: (d) => purchaseReturnsDb.create(d) });
  assert.equal(claims.length, 2);
  assert.equal(purchaseReturnsDb.all().length, 2);
  const alpha = claims.find((c) => c.vendor_name === 'Alpha Pharma')!;
  assert.match(alpha.note_numbers[0], /^DN\/FY26-27\//);
  assert.equal(alpha.amount, 504, '450 + 12% GST');
  // Stock left the batches.
  const t = loadTracking();
  assert.equal(t.get('para')!.batches.find((b) => b.batch === 'P1')!.qty, 0);
  assert.equal(t.get('amox')!.qty, 0);
  assert.equal(t.get('para')!.batches.find((b) => b.batch === 'P9')!.qty, 50);
  // Claim: credit received → supplier note number on the debit notes.
  assert.throws(() => claimsDb.decide(alpha.id, 'credited', { on: '2026-05-20' }), /credit note number/);
  claimsDb.decide(alpha.id, 'credited', { supplierNoteNumber: 'CN-77', supplierNoteDate: '2026-05-18', on: '2026-05-20' }, (id, num, d) => purchaseReturnsDb.setSupplierNote(id, num, d));
  assert.equal(purchaseReturnsDb.get(alpha.note_ids[0])!.supplier_note_number, 'CN-77');
  assert.equal(claimsDb.all().find((c) => c.id === alpha.id)!.state, 'credited');
  const beta = claims.find((c) => c.vendor_name === 'Beta Distributors')!;
  assert.throws(() => claimsDb.decide(beta.id, 'rejected', { on: '2026-05-20' }), /remark/);
  claimsDb.decide(beta.id, 'rejected', { remarks: 'Past return window', on: '2026-05-20' });
  assert.ok(audit.all().some((r) => /Expiry claim .* rejected — Past return window/.test(r.summary)));
  as('viewer');
  assert.throws(() => createBrkExpIssue(rows, '2026-05-10', { createNote: (d) => purchaseReturnsDb.create(d) }), isAccessDeniedError);
});

test('Breakage / Expiry Receive into a non-saleable godown, replacement, destroy + ITC reminder; sale from it refused', () => {
  pharmaWorld();
  as('owner');
  const exp = godownsDb.save({ name: 'Expiry', kind: 'expiry' });
  const r = receiptsDb.receive({
    date: '2026-05-10', client_name: 'Asha Medicals', godown_id: exp.id,
    lines: [{ id: 'x', item_id: 'para', qty: 2, batch_no: 'P1' }], replacement: [{ id: 'y', item_id: 'para', qty: 2, batch_no: 'P9' }], replace_from: 'main',
  });
  assert.equal(r.number, 'BER/FY26-27/0001');
  let t = loadTracking().get('para')!;
  assert.equal(t.byGodown[exp.id], 2);
  assert.equal(t.batches.find((b) => b.batch === 'P9')!.qty, 48);
  // Selling from the expiry godown is refused.
  const issues = saleLimitGate({ errors: [], expired: [], warnings: [] }, { doc_type: 'INVOICE', items: [{ name: 'Paracetamol 500', quantity: 1, godown_id: exp.id }] }, { nonSaleable: new Set([exp.id]), godownName: () => 'Expiry' });
  assert.match(issues.errors[0], /non-saleable/);
  // Destroy → ITC reminder (cost × GST rate), estimate only.
  destroyExpiryStock({ date: '2026-05-12', godown_id: exp.id, lines: [{ item_id: 'para', qty: 2, batch_no: 'P1', cost: 20 }] });
  t = loadTracking().get('para')!;
  assert.equal(t.byGodown[exp.id] ?? 0, 0);
  const rem = itcReminders(stockDb.moves(), stockDb.items());
  assert.deepEqual(rem, [{ month: '2026-05', moves: 1, value: 40, itc: 4.8 }]);
  assert.ok(audit.all().some((a) => /17\(5\)\(h\)/.test(a.summary)));
  receiptsDb.remove(r.id);
  assert.equal(getTable('expiry_receipts').length, 0);
  assert.equal(stockDb.moves().filter((m) => m.ref_type === 'expiry_receipt').length, 0);
});

test('MRP ceiling: price incl. GST per base unit vs batch MRP (pharma option)', () => {
  const settings: PharmaSettings = { enabled: true, block_expired: false, near_expiry_days: 0, block_near_expiry: false, block_above_mrp: true };
  assert.equal(Math.round(linePricePerBase({ name: 'x', rate: 100, discount_percent: 10, tax_rate: 12, unit_factor: 10 }) * 100) / 100, 10.08);
  const gate = (rate: number) => saleLimitGate({ errors: [], expired: [], warnings: [] }, { doc_type: 'INVOICE', items: [{ name: 'Para', quantity: 1, rate, tax_rate: 12, batch_no: 'P1' }] }, { nonSaleable: new Set(), godownName: () => '', mrpOf: () => 30, settings });
  assert.equal(gate(26).errors.length, 0, '26 × 1.12 = 29.12 ≤ 30');
  assert.match(gate(27).errors[0], /above the batch MRP ₹30\.00/);
  assert.equal(saleLimitGate({ errors: [], expired: [], warnings: [] }, { doc_type: 'QUOTATION', items: [{ name: 'Para', quantity: 1, rate: 99 }] }, { nonSaleable: new Set(), godownName: () => '', mrpOf: () => 30, settings }).errors.length, 0);
  assert.equal(gate.length, 1);
  assert.equal(saleLimitGate({ errors: [], expired: [], warnings: [] }, { doc_type: 'INVOICE', items: [{ name: 'Para', quantity: 1, rate: 99 }] }, { nonSaleable: new Set(), godownName: () => '', mrpOf: () => 30, settings: { ...settings, block_above_mrp: false } }).errors.length, 0);
});

/* ── Analysis ──────────────────────────────────────────────────── */

test('ABC classes: cumulative cut-offs (the item crossing the line stays in the class), zero value is C', () => {
  const rows = abcClasses([
    { itemId: 'a', name: 'A', outValue: 500 }, { itemId: 'b', name: 'B', outValue: 300 }, { itemId: 'c', name: 'C', outValue: 120 },
    { itemId: 'd', name: 'D', outValue: 80 }, { itemId: 'e', name: 'E', outValue: 0 },
  ]);
  assert.deepEqual(rows.map((r) => [r.itemId, r.cls, r.share, r.cumulative]), [['a', 'A', 50, 50], ['b', 'A', 30, 80], ['c', 'B', 12, 92], ['d', 'C', 8, 100], ['e', 'C', 0, 100]]);
  assert.deepEqual(abcClasses([{ itemId: 'x', name: 'X', outValue: 0 }]).map((r) => r.cls), ['C']);
});

test('fast / slow / non-moving from the stock ledger', () => {
  const items: StockItem[] = [
    blankStockItem({ id: 'f', name: 'Fast', opening_qty: 10, opening_rate: 10 }),
    blankStockItem({ id: 's', name: 'Slow', opening_qty: 100, opening_rate: 10 }),
    blankStockItem({ id: 'n', name: 'Idle', opening_qty: 5, opening_rate: 10 }),
  ];
  const sale = (id: string, name: string, qty: number, date: string) => ({ id, doc_type: 'INVOICE', status: 'Sent', issue_date: date, invoice_number: id, items: [{ id: 'l', name, quantity: qty, rate: 20 }] }) as unknown as InvoiceRecord;
  const positions = computeStock({ items, moves: [], invoices: [sale('i1', 'Fast', 8, '2026-04-10'), sale('i2', 'Slow', 5, '2026-04-20')] });
  const rows = movingAnalysis(positions, { from: '2026-04-01', to: '2026-04-30' });
  assert.deepEqual(rows.map((r) => [r.itemId, r.cls]), [['f', 'fast'], ['s', 'slow'], ['n', 'non']]);
  const f = rows.find((r) => r.itemId === 'f')!;
  assert.equal(f.outQty, 8);
  assert.equal(f.outValue, 80);
  assert.equal(f.daysCover, 8, '2 left at 8 per 30 days ≈ 8 days');
  assert.deepEqual(abcAnalysis(positions, { from: '2026-04-01', to: '2026-04-30' }).map((r) => [r.itemId, r.cls]), [['f', 'A'], ['s', 'A'], ['n', 'C']]);
});

/* ── Variants & kits ───────────────────────────────────────────── */

test('variants: grid → child items with SKUs / barcodes; regenerating only adds new combinations', () => {
  assert.deepEqual(cleanAxes([{ name: ' Size ', values: ['S', ' m', 'S', ''] }, { name: 'size', values: ['X'] }, { name: 'Colour', values: [] }]), [{ name: 'Size', values: ['S', 'm'] }]);
  assert.equal(combinations([{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Red', 'Blue'] }]).length, 4);
  as('owner');
  stockDb.saveItem(blankStockItem({ id: 'tee', name: 'T-shirt', sku: 'TEE', unit: 'PCS', sale_rate: 299, tax_rate: 5, track_stock: false }));
  const p1 = generateVariants('tee', [{ name: 'Size', values: ['S', 'M'] }, { name: 'Colour', values: ['Red'] }], { withBarcodes: true, newId: generateId });
  assert.deepEqual(p1.create.map((c) => [c.name, c.sku]), [['T-shirt - S / Red', 'TEE-S-RED'], ['T-shirt - M / Red', 'TEE-M-RED']]);
  assert.ok(p1.create.every((c) => c.variant_of === 'tee' && c.track_stock && c.sale_rate === 299 && isValidEan13(c.barcode ?? '')));
  assert.notEqual(p1.create[0].barcode, p1.create[1].barcode);
  const p2 = generateVariants('tee', [{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['Red'] }], { withBarcodes: false, newId: generateId });
  assert.deepEqual(p2.create.map((c) => c.name), ['T-shirt - L / Red']);
  assert.equal(p2.existing.length, 2);
  assert.deepEqual(stockDb.items().find((i) => i.id === 'tee')!.variant_axes, [{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['Red'] }]);
  assert.throws(() => generateVariants(p1.create[0].id, [{ name: 'X', values: ['1'] }], { newId: generateId }), /cannot have variants/);
  // Pure planning keeps names unique.
  const plan = planVariants({ ...blankStockItem({ id: 'p', name: 'Cap' }) }, [{ name: 'C', values: ['Red'] }], [blankStockItem({ id: 'q', name: 'Cap - Red' })], { newId: () => 'n' });
  assert.equal(plan.create[0].name, 'Cap - Red (2)');
  as('viewer');
  assert.throws(() => generateVariants('tee', [{ name: 'Size', values: ['XL'] }], { newId: generateId }), isAccessDeniedError);
});

test('kits: a kit sale issues its BOM components (value shared by sale rate); a goods credit note brings them back', () => {
  const items: StockItem[] = [
    blankStockItem({ id: 'kit', name: 'Gift hamper', track_stock: false, kit: true }),
    blankStockItem({ id: 'choc', name: 'Chocolate', opening_qty: 50, opening_rate: 20, sale_rate: 30 }),
    blankStockItem({ id: 'card', name: 'Card', opening_qty: 50, opening_rate: 2, sale_rate: 10 }),
  ];
  const boms: Bom[] = [{ id: 'bm', item_id: 'kit', name: 'Std', batch_qty: 1, is_default: true, components: [{ id: 'c1', item_id: 'choc', qty: 2 }, { id: 'c2', item_id: 'card', qty: 1 }] }];
  assert.deepEqual([...kitTable(items, boms).get('kit')!].map((c) => [c.item_id, c.per, Math.round(c.share * 1000) / 1000]), [['choc', 2, 0.857], ['card', 1, 0.143]]);
  const sale = { id: 's1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-01', invoice_number: 'INV/1', items: [{ id: 'l', name: 'Gift Hamper', quantity: 3, rate: 140 }] } as unknown as InvoiceRecord;
  const credit = { id: 'cn', doc_type: 'CREDIT_NOTE', status: 'Sent', issue_date: '2026-05-02', invoice_number: 'CN/1', items: [{ id: 'l', name: 'Gift hamper', quantity: 1, rate: 140 }] } as unknown as InvoiceRecord;
  const draft = { ...sale, id: 'd', status: 'Draft' } as InvoiceRecord;
  const pos = computeStock({ items, moves: [], invoices: [sale, credit, draft], kitBoms: boms });
  assert.equal(pos.find((p) => p.item.id === 'choc')!.qty, 46, '50 − 6 + 2');
  assert.equal(pos.find((p) => p.item.id === 'card')!.qty, 48);
  assert.equal(pos.find((p) => p.item.id === 'choc')!.revenue, 240, 'kit value 420 × 6/7 on 6 sold, less 2 returned');
  const ev = collectEvents({ items, moves: [], invoices: [sale], kitBoms: boms, excludeInvoiceId: 's1' });
  assert.equal(ev.get('choc')!.filter((e) => e.kind === 'sale').length, 0, 'the "what if I edit it" exclusion covers kits');
  assert.equal(computeStock({ items, moves: [], invoices: [sale] }).find((p) => p.item.id === 'choc')!.qty, 50, 'no BOMs passed → no kit events');
  // Live inputs read the boms table.
  for (const it of items) stockDb.saveItem(it);
  setTable('boms', boms);
  setTable('invoices', [{ ...sale, sender: SELLER }]);
  assert.equal(loadPositions().find((p) => p.item.id === 'choc')!.qty, 44);
  assert.equal(computeTracking(liveTrackingInputs()).get('card')!.qty, 47);
});

/* ── Labels ────────────────────────────────────────────────────── */

test('thermal roll layouts: page = roll width × label height; raw TSPL / EPL / ZPL commands', () => {
  const two = layoutById('roll-38x25-2');
  assert.ok(two.roll);
  assert.deepEqual(pageSize(two), { width: 78, height: 25 });
  assert.deepEqual(pageSize(layoutById('a4-24')), { width: 210, height: 297 });
  assert.ok(LABEL_LAYOUTS.some((l) => l.id === 'roll-50x25') && LABEL_LAYOUTS.some((l) => l.id === 'roll-100x50'));
  const html = labelSheetHtml([{ name: 'Soap', code: '8901234567890', rate: 25, copies: 3 }], { layout: two, price: 'sale' });
  assert.match(html, /@page \{ size: 78mm 25mm; margin: 0; \}/);
  assert.equal((html.match(/<section class="sheet">/g) ?? []).length, 2, '3 labels, 2 across → 2 rows');

  const items = [{ name: 'Soap ₹ "Lux"', code: '8901234567890', rate: 25, mrp: 30, copies: 3 }, { name: 'Rope', code: 'ROPE-1', copies: 1 }];
  const tspl = rawLabels(items, two, 'tspl');
  assert.match(tspl, /^SIZE 78 mm,25 mm\r\n/);
  assert.equal((tspl.match(/PRINT 1,1/g) ?? []).length, 2);
  assert.match(tspl, /BARCODE 8,\d+,"EAN13",\d+,1,0,2,2,"890123456789"/);
  assert.match(tspl, /BARCODE 328,\d+,"128",/, 'second label offset by one label pitch (38+2 mm × 8 dots)');
  assert.match(tspl, /TEXT 8,8,"2",0,1,1,"Soap Rs\. 'Lux'"/);
  assert.ok([...tspl].every((ch) => ch.charCodeAt(0) < 128), 'ASCII only');
  const epl = rawLabels(items, layoutById('roll-50x25'), 'epl');
  assert.equal((epl.match(/\r\nP1/g) ?? []).length, 4);
  assert.match(epl, /B8,\d+,0,E30,/);
  const zpl = rawLabels(items, layoutById('roll-100x50'), 'zpl');
  assert.equal((zpl.match(/\^XA/g) ?? []).length, 4);
  assert.match(zpl, /\^PW800/);
  assert.match(zpl, /\^BEN,\d+,Y,N\^FD890123456789\^FS/);
  assert.match(zpl, /\^BCN,\d+,Y,N,N\^FDROPE-1\^FS/);
  assert.equal(rawLabels([], two, 'zpl'), '');
});

test('weighed goods: price / weight embedded EAN-13 round-trips', () => {
  const code = weighedEan(123, 89.5);
  assert.equal(code.length, 13);
  assert.ok(code.startsWith('220012308950'));
  assert.ok(isValidEan13(code));
  assert.deepEqual(parseWeighedEan(code), { plu: 123, mode: 'price', value: 89.5 });
  assert.deepEqual(parseWeighedEan(weighedEan(7, 1.25, 'weight')), { plu: 7, mode: 'weight', value: 1.25 });
  assert.equal(parseWeighedEan('8901234567890'), null);
  assert.throws(() => weighedEan(0, 10), /1 to 9999/);
  assert.throws(() => weighedEan(1, 1000), /999\.99/);
  const label = weighedLabel({ name: 'Basmati rice', plu: 42, weightKg: 0.75, ratePerKg: 120 });
  assert.equal(label.rate, 90);
  assert.equal(parseWeighedEan(label.code)!.value, 90);
  assert.match(label.note!, /0\.750 kg @ Rs\.120\.00\/kg/);
});
