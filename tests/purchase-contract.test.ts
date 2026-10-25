/**
 * Contract test: the report modules read the `purchases` table through the shared
 * `readPurchase` / `splitLumpTax` and their own thin adapters. They must all understand
 * the real PurchaseRecord shape (src/types/purchases.ts) and split legacy rows alike.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurchase as booksNormalize } from '../src/lib/books.ts';
import { normalizePurchase as exportNormalize } from '../src/lib/export-shared.ts';
import { normalizePurchase as gstNormalize } from '../src/lib/gst-reports.ts';
import { collectEvents } from '../src/lib/inventory.ts';
import { bookBills } from '../src/lib/gstr2b.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { readPurchase, readPurchaseLines } from '../src/lib/purchase-normalize.ts';
import { expenseLine, rebillCost, unbilledExpenses, liveInvoiceIds } from '../src/lib/timesheets.ts';
import { DEFAULT_TIME_PREFS } from '../src/types/time.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';

const bill: PurchaseRecord = {
  id: 'p1',
  kind: 'PURCHASE',
  vendor_name: 'Acme Supplies',
  vendor_gstin: '27AAPFU0939F1ZV',
  bill_number: 'AS/22',
  date: '2026-04-12',
  place_of_supply: '27',
  category: 'Purchases',
  lines: [{ id: 'l1', name: 'Paper ream', hsn: '4802', unit: 'NOS', quantity: 10, rate: 100, tax_rate: 18 }],
  taxable: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  itc_eligible: true,
  total: 1180,
  amount_paid: 0,
};

test('books reads the real purchase shape', () => {
  const n = booksNormalize(bill as never);
  assert.ok(n, 'books normaliser returned null');
  assert.equal(n!.date, '2026-04-12');
  assert.equal(n!.taxable, 1000);
  assert.equal(n!.cgst, 90);
  assert.equal(n!.sgst, 90);
  assert.equal(n!.total, 1180);
  assert.equal(n!.itcEligible, true);
  assert.equal(n!.isExpense, false);
});

test('books treats kind EXPENSE as an indirect expense', () => {
  const n = booksNormalize({ ...bill, kind: 'EXPENSE', category: 'Rent' } as never);
  assert.equal(n!.isExpense, true);
});

test('exports reads the real purchase shape', () => {
  const n = exportNormalize(bill);
  assert.ok(n);
  assert.equal(n!.date, '2026-04-12');
  assert.equal(n!.taxable, 1000);
  assert.equal(n!.cgst, 90);
  assert.equal(n!.total, 1180);
  assert.equal(n!.partyGstin, '27AAPFU0939F1ZV');
});

test('gst-reports reads the real purchase shape and ITC flag', () => {
  const n = gstNormalize(bill, '27');
  assert.ok(n);
  assert.equal(n!.taxable, 1000);
  assert.equal(n!.cgst, 90);
  assert.equal(n!.sgst, 90);
  assert.equal(n!.itcEligible, true);
  assert.equal(n!.supplierGstin, '27AAPFU0939F1ZV');
  const blocked = gstNormalize({ ...bill, itc_eligible: false }, '27');
  assert.equal(blocked!.itcEligible, false);
});

test('every reader understands the GST-completeness fields (RCM, import, reversal, 17(5))', () => {
  const full: PurchaseRecord = {
    ...bill,
    id: 'p2',
    reverse_charge: true,
    import_type: 'GOODS',
    boe_number: '7654321',
    boe_date: '2026-04-10',
    port_code: 'INNSA1',
    itc_reversed: 18,
    itc_reversal_reason: 'RULE_42',
  };
  const core = readPurchase(full)!;
  assert.equal(core.reverseCharge, true);
  assert.equal(core.importType, 'GOODS');
  assert.equal(core.itcReversed, 18);
  assert.equal(core.itcReversalReason, 'RULE_42');
  const g = gstNormalize(full, '27')!;
  assert.equal(g.reverseCharge, true);
  assert.equal(g.importType, 'GOODS');
  assert.equal(g.itcReversalReason, 'RULE_42');
  const blocked = gstNormalize({ ...bill, itc_eligible: false, itc_reversal_reason: 'SEC_17_5' }, '27')!;
  assert.equal(blocked.itcEligible, false);
  assert.equal(blocked.itcReversalReason, 'SEC_17_5');
  // Books and exports keep reading the same money figures regardless of the new flags.
  assert.equal(booksNormalize(full as never)!.total, 1180);
  assert.equal(exportNormalize(full)!.taxable, 1000);
  // Legacy rows without the fields read as domestic, forward charge, no reversal.
  const legacy = readPurchase(bill)!;
  assert.deepEqual([legacy.reverseCharge, legacy.importType, legacy.itcReversed, legacy.itcReversalReason], [false, '', 0, '']);
});

test('gstr9 reads the real purchase shape (Table 6B, 7, 18)', () => {
  const g = buildGstr9([], [bill, { ...bill, id: 'p3', itc_reversed: 18, itc_reversal_reason: 'RULE_42' }], { fyStart: 2026, filerStateCode: '27' });
  const b6 = g.table6.find((r) => r.id === '6B(i)')!;
  assert.deepEqual([b6.cgst, b6.sgst, b6.igst], [180, 180, 0]);
  assert.equal(g.table7.find((r) => r.id === '7C')!.cgst, 9);
  const h = g.table18.find((r) => r.hsn === '4802')!;
  assert.deepEqual([h.qty, h.taxable, h.cgst, h.rate], [20, 2000, 180, 18]);
});

test('inventory brings purchase lines in as stock-in', () => {
  const events = collectEvents({
    items: [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }] as never,
    moves: [],
    invoices: [],
    purchases: [bill] as never,
  });
  const list = events.get('s1') ?? [];
  assert.equal(list.length, 1);
  assert.equal(list[0].qty, 10);
});

test('stock tracking reads batch, MFG / expiry, MRP, serials and godown from bill lines (6.6 / 6.10 / 6.11)', () => {
  const tracked: PurchaseRecord = {
    ...bill,
    id: 'p-track',
    lines: [{
      id: 'l1', name: 'Paper ream', hsn: '4802', unit: 'NOS', quantity: 2, rate: 100, tax_rate: 18,
      batch_no: 'B7', mfg_date: '2026-01-01', expiry_date: '2027-12-31', mrp: 150, serials: ['S1', 'S2'], godown_id: 'g2',
    }],
  };
  const line = readPurchaseLines(tracked)[0];
  assert.deepEqual(
    [line.batchNo, line.mfgDate, line.expiryDate, line.mrp, line.serials, line.godownId],
    ['B7', '2026-01-01', '2027-12-31', 150, ['S1', 'S2'], 'g2'],
  );
  const ev = collectEvents({
    items: [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, track_batches: true, track_serials: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }],
    moves: [],
    invoices: [],
    purchases: [tracked],
  }).get('s1')![0];
  assert.deepEqual([ev.batch, ev.expiry, ev.mfg, ev.mrp, ev.serials, ev.godown, ev.refNumber, ev.party], ['B7', '2027-12-31', '2026-01-01', 150, ['S1', 'S2'], 'g2', 'AS/22', 'Acme Supplies']);
  // Lines without tracking read as untracked, Main godown; the money readers ignore the new fields.
  const plain = readPurchaseLines(bill)[0];
  assert.deepEqual([plain.batchNo, plain.serials, plain.godownId], ['', [], '']);
  assert.equal(booksNormalize(tracked as never)!.total, 1180);
  assert.equal(exportNormalize(tracked)!.taxable, 1000);
  assert.equal(gstNormalize(tracked, '27')!.cgst, 90);
});

test('a legacy lump-tax row splits the same way in GST reports, books and exports', () => {
  // Intra-state supplier (27) buying in 27: CGST + SGST, never all IGST.
  const intra = { id: 'old1', vendor_name: 'Old Co', vendor_gstin: '27AAPFU0939F1ZV', bill_number: 'L1', date: '2026-04-12', place_of_supply: '27', taxable: 1000, tax_amount: 180, total: 1180 };
  const g = gstNormalize(intra, '27')!;
  const b = booksNormalize(intra as never)!;
  const e = exportNormalize(intra)!;
  for (const [name, n] of [['gst', g], ['books', b], ['export', e]] as const) {
    assert.deepEqual([n.cgst, n.sgst, n.igst], [90, 90, 0], `${name} split`);
  }
  assert.equal(e.tax, 180);
  assert.equal(b.gst, 180);

  // Inter-state supplier (07) billing into 27: all IGST everywhere.
  const delhi = '07AAPFU0939F1Z' + gstinChecksumChar('07AAPFU0939F1Z');
  const inter = { ...intra, id: 'old2', vendor_gstin: delhi };
  assert.equal(gstNormalize(inter, '27')!.igst, 180);
  assert.equal(booksNormalize(inter as never)!.igst, 180);
  assert.equal(exportNormalize(inter)!.igst, 180);

  // Rate only (no tax figure): tax derived from the rate and taken out of the total.
  const rateOnly = { id: 'old3', vendor_name: 'Old Co', date: '2026-04-12', place_of_supply: '27', tax_rate: 18, total: 1180 };
  const r = exportNormalize(rateOnly)!;
  assert.equal(r.taxable + r.tax, 1180);
});

test('GSTR-2B matcher reads the real purchase shape (and skips drafts)', () => {
  const [b] = bookBills([bill, { ...bill, id: 'p2', status: 'draft' }], '27');
  assert.equal(bookBills([bill, { ...bill, id: 'p2', status: 'draft' }], '27').length, 1);
  assert.equal(b.number, 'AS/22');
  assert.equal(b.gstin, '27AAPFU0939F1ZV');
  assert.equal(b.date, '2026-04-12');
  assert.equal(b.taxable, 1000);
  assert.equal(b.tax, 180);
  assert.equal(b.in4a5, true);
});

test('the double-entry ledger posts the real purchase shape (and legacy rows like books)', async () => {
  const { buildLedger, A } = await import('../src/lib/ledger/index.ts');
  const { EMPTY_BOOKS } = await import('../src/lib/books.ts');
  const legacy = { id: 'old1', vendor_name: 'Old Co', vendor_gstin: '27AAPFU0939F1ZV', bill_number: 'L1', date: '2026-04-12', place_of_supply: '27', taxable: 1000, tax_amount: 180, total: 1180 };
  const led = buildLedger({ ...EMPTY_BOOKS, purchases: [bill as never, legacy], userAccounts: [], manual: [], assets: [], today: '2026-04-30' });
  assert.deepEqual(led.warnings, []);
  for (const id of ['pur:p1', 'pur:old1']) {
    const v = led.vouchers.find((x) => x.id === id)!;
    assert.ok(v, `${id} missing`);
    const amt = (acc: string) => v.lines.filter((l) => l.account === acc).reduce((s, l) => s + l.dr - l.cr, 0);
    assert.deepEqual([amt(A.purchases), amt(A.inCgst), amt(A.inSgst), amt(A.creditors)], [100000, 9000, 9000, -118000], id);
  }
});

test('billable-expense fields (6.14) are read by timesheets and ignored by the report readers', () => {
  const billable: PurchaseRecord = { ...bill, id: 'p3', billable_to_client_id: 'c1', markup_percent: 10, rebilled_in: 'inv-gone' };
  // Report readers see the same money with or without the re-billing fields.
  assert.equal(booksNormalize(billable as never)!.total, 1180);
  assert.equal(exportNormalize(billable)!.taxable, 1000);
  assert.equal(gstNormalize(billable, '27')!.cgst, 90);
  assert.equal(readPurchase(billable)!.taxable, 1000);
  // The timesheets reader: ITC claimed → cost is the taxable value; the link to a deleted invoice frees it.
  assert.equal(rebillCost(billable), 1000);
  assert.equal(expenseLine(billable, DEFAULT_TIME_PREFS).rate, 1100);
  assert.equal(expenseLine({ ...billable, pure_agent: true }, DEFAULT_TIME_PREFS).tax_rate, 0);
  assert.deepEqual(unbilledExpenses([billable, bill], liveInvoiceIds([])).map((p) => p.id), ['p3']);
  assert.equal(unbilledExpenses([billable], liveInvoiceIds([{ id: 'inv-gone', status: 'Sent' }])).length, 0);
});

test('every reader accepts a bill converted from a purchase order (po_id + po_line_id) unchanged', () => {
  const fromPo: PurchaseRecord = {
    ...bill,
    id: 'p3',
    po_id: 'po1',
    lines: bill.lines.map((l) => ({ ...l, po_line_id: 'pl1' })),
  };
  assert.equal(booksNormalize(fromPo as never)!.total, 1180);
  assert.equal(exportNormalize(fromPo)!.taxable, 1000);
  assert.equal(gstNormalize(fromPo, '27')!.cgst, 90);
  assert.equal(readPurchase(fromPo)!.taxable, 1000);
  assert.equal(bookBills([fromPo], '27')[0].tax, 180);
  const events = collectEvents({
    items: [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }] as never,
    moves: [],
    invoices: [],
    purchases: [fromPo] as never,
  });
  assert.equal(events.get('s1')?.[0].qty, 10);
  // The PO itself is a separate table (purchase_orders) that no report reads: it never posts.
});

test('cost centre (6.16): the ledger, project P&L and budgets read cost_centre_id; other readers ignore it', async () => {
  const { buildLedger, costCentrePnl, monthlyActuals, A } = await import('../src/lib/ledger/index.ts');
  const { EMPTY_BOOKS } = await import('../src/lib/books.ts');
  const tagged: PurchaseRecord = { ...bill, id: 'p4', cost_centre_id: 'cc1' };
  // Report readers see the same money with or without the cost centre.
  assert.equal(booksNormalize(tagged as never)!.total, 1180);
  assert.equal(exportNormalize(tagged)!.taxable, 1000);
  assert.equal(gstNormalize(tagged, '27')!.cgst, 90);
  const led = buildLedger({ ...EMPTY_BOOKS, purchases: [tagged as never, bill as never], userAccounts: [], manual: [], assets: [], today: '2026-04-30' });
  const v = led.vouchers.find((x) => x.id === 'pur:p4')!;
  assert.ok(v.lines.every((l) => l.cost_centre === 'cc1'));
  const pnl = costCentrePnl(led, { start: '2026-04-01', end: '2027-03-31' }, [{ id: 'cc1', name: 'Site A', kind: 'project', active: true, created_at: '' }]);
  assert.equal(pnl.totals.cc1.directCosts, 100000);
  assert.equal(pnl.totals[''].directCosts, 100000);
  assert.equal(monthlyActuals(led, 2026).get(`${A.purchases}|cc1`)![0], 100000);
  assert.equal(expenseLine(tagged, DEFAULT_TIME_PREFS).cost_centre_id, 'cc1');
});

test('attachments (6.12) are carried on the record and ignored by every report reader', async () => {
  const { attachmentIdsIn } = await import('../src/lib/attachments.ts');
  const withFiles: PurchaseRecord = {
    ...bill,
    id: 'p4',
    attachments: [{ id: 'f1', name: 'bill.pdf', mime: 'application/pdf', size: 1200, added_at: '2026-04-12T10:00:00Z' }],
  };
  assert.equal(booksNormalize(withFiles as never)?.total, 1180);
  assert.equal(exportNormalize(withFiles)?.taxable, 1000);
  assert.equal(gstNormalize(withFiles, '27')?.cgst, 90);
  assert.equal(readPurchase(withFiles)?.taxable, 1000);
  assert.deepEqual(bookBills([withFiles], '27')[0]?.taxable, bookBills([bill], '27')[0]?.taxable);
  // The attachments module is the one reader of the field.
  assert.deepEqual([...attachmentIdsIn([withFiles, bill])], ['f1']);
});

test('cash-flow forecast (6.18) reads the real purchase shape: open balance at the due date', async () => {
  const { buildForecast } = await import('../src/lib/cash-forecast.ts');
  const open: PurchaseRecord = { ...bill, id: 'p4', due_date: '2026-04-30', amount_paid: 180 };
  const legacy = { id: 'old2', vendor_name: 'Old Co', bill_number: 'L2', date: '2026-04-20', taxable: 500, tax_amount: 90, total: 590, paid_amount: 90 };
  const f = buildForecast({ today: '2026-04-15', horizon: 30, opening: 0, invoices: [], payments: [], purchases: [open, legacy, { ...open, id: 'void', status: 'cancelled' }] });
  assert.deepEqual(f.items.map((i) => [i.ref, i.date, i.amount]), [['L2', '2026-04-20', 500], ['AS/22', '2026-04-30', 1000]]);
});

test('profitability (6.25) costs sales from the real purchase lines and billable expenses', async () => {
  const { buildCoster, partyProfitability } = await import('../src/lib/profitability.ts');
  const c = buildCoster([bill]);
  assert.deepEqual(c.cost({ name: 'Paper ream', hsn: '4802', quantity: 3 }, { id: 's', date: '2026-05-01' }), { cost: 300, source: 'purchases' });
  const billable: PurchaseRecord = { ...bill, id: 'p5', kind: 'EXPENSE', billable_to_client_id: 'c1' };
  const rep = partyProfitability({ invoices: [], purchases: [billable], clients: [{ id: 'c1', name: 'Acme', email: '', address: '', city: '', zip: '' }] }, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(rep.rows[0].expenses, 1000);
});

test('composition returns (CMP-08 / GSTR-4) read the real purchase shape: RCM taxed, ordinary ITC never claimed', async () => {
  const { buildCmp08, buildGstr4 } = await import('../src/lib/composition-returns.ts');
  const q = { kind: 'quarter' as const, fyStart: 2026, quarter: 1 as const };
  const plain = buildCmp08([], [bill], q, { filerStateCode: '27' });
  assert.equal(plain.counts.purchases, 1);
  assert.equal(plain.itcNotClaimable, 180);
  assert.equal(plain.payable.total, 0);
  const rcm = buildCmp08([], [{ ...bill, reverse_charge: true }], q, { filerStateCode: '27' });
  assert.deepEqual(rcm.rcm, { value: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 });
  assert.equal(rcm.itcNotClaimable, 0);
  const g4 = buildGstr4([], [bill, { ...bill, id: 'd', status: 'Draft' }], 2026, { filerStateCode: '27' });
  assert.equal(g4.inward.registered.value, 1000);
});

test('supplierPayable: every "what we owe the vendor" reader leaves self-assessed GST out (RCM, imports)', async () => {
  const { supplierPayable } = await import('../src/lib/purchase-normalize.ts');
  const { balanceOf, deriveStatus, payablesOutstanding, validatePayment } = await import('../src/lib/purchases.ts');
  const { msmeBills } = await import('../src/lib/msme.ts');
  const { vendorBalances } = await import('../src/lib/vendors.ts');
  const { buildForecast } = await import('../src/lib/cash-forecast.ts');
  const rcm: PurchaseRecord = { ...bill, id: 'p-rcm', vendor_id: 'v1', reverse_charge: true, due_date: '2026-05-12' };
  const impGoods: PurchaseRecord = { ...bill, id: 'p-imp', cgst: 0, sgst: 0, igst: 180, import_type: 'GOODS', boe_number: '1', boe_date: '2026-04-12', port_code: 'INNSA1' };
  const impSvc: PurchaseRecord = { ...bill, id: 'p-svc', cgst: 0, sgst: 0, igst: 180, import_type: 'SERVICES' };
  assert.deepEqual([rcm, impGoods, impSvc, bill].map((b) => supplierPayable(b)), [1000, 1000, 1000, 1180]);
  assert.equal(balanceOf(rcm), 1000);
  assert.equal(balanceOf({ ...rcm, amount_paid: 1000 }), 0);
  assert.equal(deriveStatus({ ...rcm, amount_paid: 1000 }, '2026-06-01'), 'Paid');
  assert.equal(payablesOutstanding([rcm, impGoods, bill]), 3180);
  assert.match(validatePayment(rcm, 1001, '2026-04-20'), /exceeds the balance of 1000/);
  // Books / exports / ledger-facing readers expose the same figure; the bill total is unchanged.
  const b = booksNormalize(rcm as never)!;
  assert.deepEqual([b.payable, b.selfTax, b.total], [1000, 180, 1180]);
  assert.deepEqual([exportNormalize(impGoods)!.payable, exportNormalize(impGoods)!.selfTaxKind], [1000, 'CUSTOMS']);
  // MSME tracker, vendor balances and the cash forecast.
  const vendor = { id: 'v1', name: 'Acme Supplies', msme_udyam: 'UDYAM-MH-00-0000001', msme_category: 'MICRO' as const };
  assert.equal(msmeBills([rcm], [vendor], [], '2026-06-30')[0].total, 1000);
  const vb = vendorBalances([rcm]).get('v1')!;
  assert.deepEqual([vb.billed, vb.outstanding], [1000, 1000]);
  const f = buildForecast({ today: '2026-04-15', horizon: 90, opening: 0, invoices: [], payments: [], purchases: [rcm], vendors: [vendor] });
  assert.equal(f.items.find((i) => i.kind === 'payable')!.amount, 1000);
});
