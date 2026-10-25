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

test('profitability (WP-8) costs per base unit from bill lines typed in an alternate unit', async () => {
  const { buildCoster } = await import('../src/lib/profitability.ts');
  const boxed: PurchaseRecord = { ...bill, id: 'p6', lines: [{ ...bill.lines[0], unit: 'BOX', unit_factor: 5 }] };
  const unit = buildCoster([bill]).cost({ name: 'Paper ream', hsn: '4802', quantity: 1 }, { id: 's', date: '2026-05-01' }).cost;
  // Same bill, lines in BOX of 5: one base unit costs a fifth; a sale of 1 BOX (factor 5) costs the same as before.
  const c = buildCoster([boxed]);
  assert.equal(c.cost({ name: 'Paper ream', hsn: '4802', quantity: 1 }, { id: 's', date: '2026-05-01' }).cost, unit / 5);
  assert.equal(c.cost({ name: 'Paper ream', hsn: '4802', quantity: 1, unitFactor: 5 }, { id: 's', date: '2026-05-01' }).cost, unit);
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
  // GSTR-4 Tables 7-9 (gstr4-annual) read purchases through buildGstr4: reverse charge is tax payable in Table 8.
  const { buildGstr4Annual } = await import('../src/lib/gstr4-annual.ts');
  const annual = buildGstr4Annual([], [{ ...bill, reverse_charge: true }], 2026, null, { filerStateCode: '27' });
  assert.equal(annual.table8.find((r) => r.head === 'cgst')!.taxPayable, 90);
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

test('TDS-on-payables fields (Tally parity): every reader agrees on what the supplier is owed', async () => {
  const { supplierPayable } = await import('../src/lib/purchase-normalize.ts');
  const { tdsDeductions, priorCreditsFor } = await import('../src/lib/tds-payables.ts');
  const { billwisePayables } = await import('../src/lib/billwise.ts');
  const withTds: PurchaseRecord = { ...bill, id: 'p-tds', tds_section: '194J', tds_rate: 10, tds_base: 1000, tds_amount: 100, tds_on: 'BILL', tds_pan: 'ABCPK1234F' };
  const core = readPurchase(withTds)!;
  assert.deepEqual([core.tdsSection, core.tdsAmount, core.tdsOnBill], ['194J', 100, 100]);
  assert.equal(supplierPayable(withTds), 1080);
  assert.equal(booksNormalize(withTds as never)!.payable, 1080);
  assert.equal(booksNormalize(withTds as never)!.tds, 100);
  assert.equal(exportNormalize(withTds)!.payable, 1080);
  assert.equal(exportNormalize(withTds)!.tds, 100);
  // Deduct on payment: nothing comes off the bill up front.
  assert.equal(supplierPayable({ ...withTds, tds_on: 'PAYMENT' }), 1180);
  assert.equal(tdsDeductions({ purchases: [withTds], payments: [] })[0].amount, 100);
  assert.equal(priorCreditsFor([withTds], { name: 'Acme Supplies' })[0].base, 1000);
  assert.equal(billwisePayables({ purchases: [withTds], payments: [], vendorPayments: [], asOf: '2026-12-31' })[0].bills[0].balance, 1080);
  // Legacy rows read as no TDS.
  assert.deepEqual([readPurchase(bill)!.tdsAmount, readPurchase(bill)!.tdsOnBill, supplierPayable(bill)], [0, 0, 1180]);
});

test('integrity review: removal checks, godown and cost-centre usage read bills through the contract', async () => {
  const { removalIssues } = await import('../src/lib/stock-timeline.ts');
  const { godownReferences } = await import('../src/lib/godowns.ts');
  const { costCentreUsage } = await import('../src/lib/cost-centres.ts');
  const item = { id: 'w', name: 'Widget', hsn: '8471', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, track_serials: true };
  const tracked: PurchaseRecord = { ...bill, id: 'pb', cost_centre_id: 'cc', lines: [{ id: 'l', name: 'Widget', hsn: '8471', quantity: 1, rate: 10, tax_rate: 0, serials: ['S1'], godown_id: 'g2' }] };
  const sale = { id: 's', invoice_number: 'INV/1', doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2099-01-01', items: [{ id: 'x', name: 'Widget', hsn: '8471', type: 'Goods', quantity: 1, rate: 1, amount: 1, serials: ['S1'] }] };
  assert.equal(removalIssues({ items: [item], moves: [], invoices: [sale], purchases: [tracked] }, { refType: 'purchase', refId: 'pb' }, false).errors.length, 1);
  assert.deepEqual(godownReferences('g2', { purchases: [tracked] }), ['purchase bills']);
  assert.equal(costCentreUsage('cc', { purchases: [tracked as never] }).purchases, 1);
});

test('WP-3 readers (purchase returns, receipt notes, GRN stock source) understand the real bill shape', async () => {
  const { returnableLines, validateNote, noteGstMode } = await import('../src/lib/purchase-returns.ts');
  const { billedByGrnLine, purchaseOrderOutstanding } = await import('../src/lib/receipt-notes.ts');
  const { grnCoverage } = await import('../src/lib/events-returns.ts');
  // Returnable lines come from the bill's own `lines`; the GST mode from its split.
  const r = returnableLines(bill, []);
  assert.deepEqual([r[0].line.id, r[0].billed, r[0].available, r[0].unitCost], ['l1', 10, 10, 100]);
  assert.equal(noteGstMode(bill), 'CGST_SGST');
  assert.equal(noteGstMode({ ...bill, cgst: 0, sgst: 0, igst: 180 }), 'IGST');
  assert.match(validateNote({ kind: 'DEBIT_NOTE', date: '2026-05-01', purchaseId: 'p1', reason: '01', goodsReturned: true, lines: [{ id: 'x', bill_line_id: 'l1', name: 'Paper ream', quantity: 1, rate: 100, tax_rate: 18 }] }, { ...bill, status: 'Draft' } as never, []), /draft or cancelled/);
  // Bill lines billing a GRN are found through `grn_line_id`; void bills and expenses are ignored.
  const g = { ...bill, lines: [{ ...bill.lines[0], grn_line_id: 'gl1' }] };
  assert.equal(billedByGrnLine([g, { ...g, id: 'v', status: 'cancelled' } as never, { ...g, id: 'e', kind: 'EXPENSE' }]).get('gl1'), 10);
  assert.equal(readPurchaseLines(g)[0].grnLineId, 'gl1');
  assert.equal(readPurchaseLines(bill)[0].grnLineId, '');
  assert.equal(grnCoverage({ notes: [], receipts: [{ id: 'g', kind: 'GRN', number: 'G', date: '2026-04-01', vendor_name: 'A', lines: [{ id: 'gl1', name: 'Paper ream', quantity: 4, rate: 1, tax_rate: 0 }] }] }).take('gl1', 10), 4);
  assert.equal(purchaseOrderOutstanding([], [bill], [], '2026-12-31').length, 0);
});

test('WP-1: a vendor placed in a Sundry Creditors sub-group (additive group_id) reads the same everywhere', async () => {
  const { buildLedger, A, trialBalance } = await import('../src/lib/ledger/index.ts');
  const { EMPTY_BOOKS } = await import('../src/lib/books.ts');
  const vendor = { id: 'v1', name: 'Acme Supplies', group_id: 'grp-mumbai-creditors' };
  const withGroup = { ...bill, vendor_id: 'v1' };
  assert.equal(booksNormalize(withGroup as never, [vendor] as never)!.total, 1180);
  const ledger = buildLedger({ ...EMPTY_BOOKS, purchases: [withGroup] as never, vendors: [vendor], userAccounts: [], manual: [], assets: [], today: '2026-04-30' });
  const tb = trialBalance(ledger, { start: '2026-04-01', end: '2026-04-30' });
  assert.equal(tb.rows.find((r) => r.account.id === A.creditors)!.credit, 118000);
});

test('payment advice (WP-5) reads the real purchase shape', async () => {
  const { buildPaymentAdvice } = await import('../src/lib/payment-advice.ts');
  const adv = buildPaymentAdvice('pp:pay1', {
    purchases: [{ ...bill, tds_amount: 100, tds_on: 'BILL' }],
    payments: [{ id: 'pay1', purchase_id: 'p1', amount: 1080, date: '2026-04-20', method: 'NEFT' }],
    vendorPayments: [],
  });
  assert.ok(adv);
  assert.equal(adv!.vendor, 'Acme Supplies');
  assert.equal(adv!.vendorGstin, '27AAPFU0939F1ZV');
  assert.deepEqual(adv!.lines.map((l) => [l.billNo, l.billDate, l.billAmount, l.tdsOnBill, l.paid, l.balance]), [['AS/22', '2026-04-12', 1180, 100, 1080, 0]]);
});

test('branches (WP-9) read the real purchase shape: branch_id, then place of supply', async () => {
  const { branchOfPurchase, branchSummary } = await import('../src/lib/branch.ts');
  const branches = [{ id: 'mh', name: 'Mumbai', state_code: '27' }];
  assert.equal(branchOfPurchase(bill, branches), 'mh');
  assert.equal(branchOfPurchase({ ...bill, branch_id: 'x' }, branches), 'x');
  assert.equal(branchSummary(branches, [], [bill])[0].purchases, 1000);
});

test('reorder status (Phase 7) reads received PO quantity from the real purchase shape', async () => {
  const { pendingPoQty } = await import('../src/lib/reorder.ts');
  const items = [{ id: 's', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 5 }];
  const po = { id: 'po1', po_number: 'PO/FY26-27/0001', date: '2026-04-01', vendor_name: 'Acme Supplies', lines: [{ id: 'pl', name: 'Paper ream', hsn: '4802', quantity: 25, rate: 100, tax_rate: 18 }], taxable: 2500, cgst: 0, sgst: 0, igst: 0, total: 2500 };
  const received: PurchaseRecord = { ...bill, po_id: 'po1', lines: [{ ...bill.lines[0], po_line_id: 'pl' }] };
  assert.equal(pendingPoQty([po], [received], items).get('s'), 15);
});

test('7S readers: MRP nets the quantity still due on POs from the real bill shape; branch stock reads bill lines through the engine', async () => {
  const { pendingPoQty } = await import('../src/lib/reorder.ts');
  const { runMrp } = await import('../src/lib/mrp.ts');
  const { godownSetValuer } = await import('../src/lib/ledger/branch-stock.ts');
  const { computeStock } = await import('../src/lib/inventory.ts');
  const items = [{ id: 's', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }];
  const po = { id: 'po1', po_number: 'PO/FY26-27/0001', date: '2026-04-01', vendor_name: 'Acme Supplies', lines: [{ id: 'pl', name: 'Paper ream', hsn: '4802', quantity: 25, rate: 100, tax_rate: 18 }], taxable: 2500, cgst: 0, sgst: 0, igst: 0, total: 2500 };
  const received: PurchaseRecord = { ...bill, po_id: 'po1', lines: [{ ...bill.lines[0], po_line_id: 'pl', godown_id: 'g2' }] };
  const onOrder = pendingPoQty([po], [received], items, []);
  const inputs = { items, moves: [], invoices: [], purchases: [received] };
  const stock = new Map(computeStock(inputs).map((p) => [p.item.id, p.qty]));
  const [row] = runMrp({ plan: [{ item_id: 's', qty: 40 }], items, boms: [], stock, onOrder });
  assert.deepEqual([row.stock, row.onOrder, row.net, row.action], [10, 15, 15, 'buy']);
  const valuer = godownSetValuer(computeStock(inputs), collectEvents({ ...inputs, includeTransfers: true }), new Set(['g2']), 'x');
  assert.equal(valuer.value('2026-04-30'), 100000, '10 reams × ₹100 in the bill line godown');
});

test('WP-6 readers: cess on bills, purchase HSN register and the monthly 1-vs-3B-vs-books reconciliation', async () => {
  const { purchaseHsnRegister } = await import('../src/lib/hsn-purchase-register.ts');
  const { reconMonthly } = await import('../src/lib/gst-recon-monthly.ts');
  const { buildLedger, A, trialBalance } = await import('../src/lib/ledger/index.ts');
  const { EMPTY_BOOKS } = await import('../src/lib/books.ts');
  // Additive cess_amount: read once, outside the GST total; readers that ignore cess still see the same bill.
  const cessBill: PurchaseRecord = { ...bill, id: 'pc', cess_amount: 50, total: 1230 };
  assert.equal(readPurchase(cessBill)!.cess, 50);
  assert.equal(readPurchase(bill)!.cess, 0);
  assert.equal(gstNormalize(cessBill, '27')!.cess, 50);
  assert.equal(gstNormalize(bill, '27')!.cess, undefined);
  assert.equal(booksNormalize(cessBill as never, [])!.total, 1230);
  // The ledger debits Input cess (2353) for an ITC bill, so nothing lands in round-off.
  const ledger = buildLedger({ ...EMPTY_BOOKS, purchases: [cessBill] as never, vendors: [], userAccounts: [], manual: [], assets: [], today: '2026-04-30' });
  const tb = trialBalance(ledger, { start: '2026-04-01', end: '2026-04-30' });
  assert.equal(tb.rows.find((r) => r.account.id === A.inCess)!.debit, 5000);
  assert.equal(tb.rows.find((r) => r.account.id === A.roundOff), undefined);
  // HSN register: lines → HSN × rate, bill heads spread over lines.
  const reg = purchaseHsnRegister([cessBill, { ...bill, id: 'd', status: 'Draft' } as never], { from: '2026-04-01', to: '2026-04-30', filerStateCode: '27' });
  assert.equal(reg.billsConsidered, 1);
  assert.deepEqual(reg.rows.map((r) => [r.hsn, r.rate, r.uqc, r.qty, r.taxable, r.cgst, r.sgst, r.cess]), [['4802', 18, 'NOS', 10, 1000, 90, 90, 50]]);
  // Monthly reconciliation reads purchases through buildGstReport: April ITC = 90 + 90 + 50.
  const rows = reconMonthly([], [cessBill], { fyStart: 2026, upTo: '2026-04-30' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].itc3b, 230);
});

test('WP-7 readers (Tally supplier payments, books integrity) read the real purchase shape', async () => {
  const { booksVouchers } = await import('../src/lib/tally-books.ts');
  const { tallyBankResolver } = await import('../src/lib/tally-bank.ts');
  const names = {
    range: {}, salesLedger: 'Sales', purchaseLedger: 'Purchases', bankLedger: 'Bank Account', cashLedger: 'Cash', roundOffLedger: 'Round Off',
    otherChargesLedger: 'Freight', outputCgst: 'Output CGST', outputSgst: 'Output SGST', outputIgst: 'Output IGST', outputGst: 'Output GST',
    outputCess: 'Output Cess', tcsLedger: 'TCS Payable', tdsLedger: 'TDS Receivable', inputCgst: 'Input CGST', inputSgst: 'Input SGST',
    inputIgst: 'Input IGST', rcmPayableLedger: 'RCM', customsIgstLedger: 'Customs IGST',
  };
  const vs = booksVouchers({ purchasePayments: [{ id: 'pay1', purchase_id: 'p1', amount: 1180, date: '2026-04-20', method: 'NEFT' }] }, { purchases: [bill], vendors: [] }, names, () => {}, tallyBankResolver('Bank Account', 'Cash', []), []);
  assert.deepEqual(vs.map((v) => [v.type, v.party, v.entries[0].bill?.name, v.entries[0].paise]), [['Payment', 'Acme Supplies', 'AS/22', 118000]]);
  const { checkBooksIntegrity } = await import('../src/lib/books-integrity.ts');
  const r = checkBooksIntegrity({
    ledger: { accounts: [], byId: new Map(), vouchers: [], warnings: [] },
    invoices: [], transactions: [], purchases: [bill], docLinks: [], openingBills: [], manualVoucherIds: [], clientIds: [], vendorIds: [], openingSum: 0,
    purchasePayments: [{ id: 'pay1', purchase_id: 'p1', amount: 1180, date: '2026-04-20' }],
  });
  assert.equal(r.ok, true, 'a payment against the real bill is not orphaned');
});

test('WP-8 readers (item_id / unit_factor on bill lines, stock query, reorder with GRNs) read the real bill shape', async () => {
  const { pendingPoQty } = await import('../src/lib/reorder.ts');
  const { stockQuery } = await import('../src/lib/stock-query.ts');
  const { computeStock } = await import('../src/lib/inventory.ts');
  // A line picked from the stock list, bought by the box of 12.
  const boxed: PurchaseRecord = { ...bill, lines: [{ ...bill.lines[0], name: 'Paper (supplier name)', unit: 'BOX', quantity: 2, rate: 1200, item_id: 's', unit_factor: 12 }] };
  const core = readPurchaseLines(boxed)[0];
  assert.deepEqual([core.itemId, core.unitFactor, core.quantity, core.unitCost], ['s', 12, 2, 1200]);
  const plain = readPurchaseLines(bill)[0];
  assert.deepEqual([plain.itemId, plain.unitFactor], ['', 1], 'older lines: no item, factor 1');
  const items = [{ id: 's', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 5 }];
  const ev = collectEvents({ items, moves: [], invoices: [], purchases: [boxed] }).get('s') ?? [];
  assert.deepEqual(ev.map((e) => [e.qty, e.rate]), [[24, 100]], 'stock in base units at cost per base unit, matched by item_id');
  // The money readers ignore the new line fields.
  assert.equal(booksNormalize(boxed as never).taxable, booksNormalize(bill as never).taxable);
  assert.equal(readPurchase(boxed)?.taxable, readPurchase(bill)?.taxable);
  const [position] = computeStock({ items, moves: [], invoices: [], purchases: [boxed] });
  const q = stockQuery({ position, events: ev, godowns: [], soLines: [], pendingPo: 0, day: '2026-12-31' });
  assert.deepEqual(q.lastPurchases.map((r) => [r.party, r.qty, r.rate]), [['Acme Supplies', 24, 100]]);
  const po = { id: 'po1', po_number: 'PO/FY26-27/0001', date: '2026-04-01', vendor_name: 'Acme Supplies', lines: [{ id: 'pl', name: 'Paper ream', hsn: '4802', quantity: 25, rate: 100, tax_rate: 18 }], taxable: 2500, cgst: 0, sgst: 0, igst: 0, total: 2500 };
  const grn = { id: 'g', kind: 'GRN' as const, number: 'GRN/FY26-27/0001', date: '2026-04-05', vendor_name: 'Acme Supplies', po_id: 'po1', lines: [{ id: 'gl', name: 'Paper ream', hsn: '4802', quantity: 5, rate: 100, tax_rate: 18, po_line_id: 'pl' }] };
  const viaGrn: PurchaseRecord = { ...bill, po_id: 'po1', lines: [{ ...bill.lines[0], quantity: 5, po_line_id: 'pl', grn_line_id: 'gl' }] };
  assert.equal(pendingPoQty([po], [viaGrn], items, [grn]).get('s'), 20, 'a bill against a GRN is counted once');
  // Landed cost: stock cost only; every money / GST reader sees the bill unchanged.
  const landed: PurchaseRecord = { ...bill, landed_costs: [{ label: 'Freight', amount: 100 }] };
  assert.equal(readPurchaseLines(landed)[0].landedUnit, 10);
  assert.equal(readPurchaseLines(landed)[0].unitCost, 100);
  assert.deepEqual(booksNormalize(landed as never), booksNormalize(bill as never));
  assert.deepEqual(exportNormalize(landed as never), exportNormalize(bill as never));
  assert.deepEqual(gstNormalize(landed, '27'), gstNormalize(bill, '27'));
  assert.equal(collectEvents({ items, moves: [], invoices: [], purchases: [landed] }).get('s')?.[0]?.rate, 110);
});

test('7O readers (RCM self-invoice / payment voucher, TDS reversal on returns, cess in exports) read the real bill shape', async () => {
  const { rcmBills, linesOfBill, buildSelfInvoice } = await import('../src/lib/rcm-self-invoice.ts');
  const { tdsReversalForReturn } = await import('../src/lib/tds-payables.ts');
  const { selfAssessedCessOf } = await import('../src/lib/purchase-normalize.ts');
  // Reverse charge from an unregistered supplier, with cess, typed lines and a lump split.
  const rcm: PurchaseRecord = { ...bill, id: 'rc', vendor_gstin: undefined, reverse_charge: true, cess_amount: 20, total: 1200 };
  const rows = rcmBills([rcm, bill, { ...rcm, id: 'dr', status: 'Draft' } as never], []);
  assert.deepEqual(rows.map((r) => r.id), ['rc']);
  assert.equal(rows[0].supplierPayable, 1000, 'GST 180 and cess 20 are ours to pay');
  const lines = linesOfBill(rcm);
  assert.deepEqual(lines.map((l) => [l.hsn, l.quantity, l.taxable, l.cgst, l.sgst, l.cess]), [['4802', 10, 1000, 90, 90, 20]]);
  const doc = buildSelfInvoice({ date: '2026-04-30', number: 'RCM/FY26-27/0001', recipient: { name: 'Us' }, bills: [rcm] });
  assert.equal(doc.total, 1200);
  assert.equal(selfAssessedCessOf(readPurchase(rcm)!), 20);
  // TDS fields on the real shape.
  assert.equal(tdsReversalForReturn({ ...bill, tds_section: '194C-2', tds_amount: 20, tds_base: 1000 }, 500), 10);
  assert.equal(exportNormalize({ ...bill, cess_amount: 30, total: 1210 })!.roundOff, 0);
});

test('branch-wise books and Sec 25(4) transfer bills (WP-9) read the real purchase shape', async () => {
  const { voucherBranches } = await import('../src/lib/ledger/branch-books.ts');
  const branches = [{ id: 'mh', name: 'Mumbai', state_code: '27' }, { id: 'ka', name: 'Bengaluru', state_code: '29' }];
  const src = { invoices: [], transactions: [], manual: [], purchases: [bill, { ...bill, id: 'p2', branch_id: 'ka' }], purchasePayments: [{ id: 'pp', purchase_id: 'p2', amount: 10, date: '2026-04-20' }], purchaseReturns: [] };
  const map = voucherBranches(src as never, [{ id: 'pur:p1' }, { id: 'pur:p2' }, { id: 'pay:pp' }] as never, branches);
  assert.equal(map.get('pur:p1'), 'mh', 'place of supply');
  assert.equal(map.get('pur:p2'), 'ka', 'branch_id');
  assert.equal(map.get('pay:pp'), 'ka', 'payment follows its bill');
  // A transfer bill posts to "Branch transfer (inward)" instead of Purchases.
  const { buildLedger } = await import('../src/lib/ledger/postings.ts');
  const l = buildLedger({ invoices: [], transactions: [], purchases: [{ ...bill, branch_transfer_id: 'str1' }], vendors: [], purchasePayments: [], openings: [], userAccounts: [], manual: [], assets: [], today: '2026-05-01' } as never);
  assert.ok(l.vouchers[0].lines.some((x) => x.account === 'branch_transfer_in' && x.dr === 100000));
});

test('7R readers (GSTR-9C rate-wise / Table 14, GSTR-9 Part V, per-GSTIN paper, cess on notes) read the real bill shape', async () => {
  const { gstr9cRateWise, gstr9cTable14 } = await import('../src/lib/gstr9c-extra.ts');
  const { buildGstr9PartV } = await import('../src/lib/gstr9-partv.ts');
  const { buildByGstin } = await import('../src/lib/gst-by-gstin.ts');
  const { noteCessFor } = await import('../src/lib/purchase-returns-gst.ts');
  const g9 = buildGstr9([], [bill], { fyStart: 2026, filerStateCode: '27' });
  // A reverse-charge bill with a lump tax and no split: 5% RC row via splitLumpTax (intra-State → CGST + SGST).
  const rcm = { ...bill, id: 'rc', reverse_charge: true, cgst: undefined, sgst: undefined, igst: undefined, tax_amount: 50, total: 1050 } as never;
  const rate = gstr9cRateWise(g9, [rcm], '27');
  const b = rate.rows.find((r) => r.id === '9B')!;
  assert.equal(b.taxable, 1000);
  assert.equal(b.cgst + b.sgst, 50);
  // Table 14: the real bill (category Purchases, ITC claimed) lands in 14A with its GST; drafts are skipped.
  const t14 = gstr9cTable14(g9, [bill, { ...bill, id: 'dr', status: 'Draft' } as never], '27');
  assert.equal(t14.rows.find((r) => r.id === '14A')!.eligible, 180);
  // Part V reads bill dates through readPurchase.
  const note = { id: 'n', kind: 'DEBIT_NOTE', note_number: 'DN/1', date: '2026-05-01', purchase_id: 'p1', vendor_name: 'A', reason: 'OTHER', goods_returned: false, lines: [], taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118, itc_eligible: true, adjusted_amount: 0 } as never;
  const pv = buildGstr9PartV([], { fyStart: 2025, rawPurchases: [bill], purchaseNotes: [note] });
  assert.equal(pv.t12.cgst, 0, 'the bill of 12 Apr 2026 is not in FY 2025-26');
  // Per-GSTIN paper assigns the bill by its place of supply (27).
  const ka = `29AAPFU0939F1Z${gstinChecksumChar('29AAPFU0939F1Z')}`;
  const r = buildByGstin([], [bill], { period: { kind: 'fy', fyStart: 2026 }, columns: [{ gstin: '27AAPFU0939F1ZV', label: 'MH' }, { gstin: ka, label: 'KA' }], branches: [] });
  assert.equal(r.rows.find((x) => x.id === '4a')!.values[0], 180);
  // Cess on a note is pro rata to the bill's `cess_amount` / `taxable`.
  assert.equal(noteCessFor({ ...bill, cess_amount: 40 }, 250), 10);
});

test('7U reader (e-payment confirmation: open bills of a supplier) reads the real bill shape', async () => {
  const { openBillsOf } = await import('../src/lib/epay-confirm.ts');
  const withVendor = { ...bill, vendor_id: 'v1', due_date: '2026-05-12' };
  assert.deepEqual(openBillsOf([withVendor], { id: 'v1', name: 'Acme Supplies' }), [{ purchaseId: 'p1', balance: 1180, due: '2026-05-12' }]);
  // Legacy rows without vendor_id match by name; paid / void bills drop out.
  assert.equal(openBillsOf([bill], { id: 'v1', name: 'acme supplies' }).length, 1);
  assert.equal(openBillsOf([{ ...bill, amount_paid: 1180 }], { name: 'Acme Supplies' }).length, 0);
  assert.equal(openBillsOf([{ ...bill, status: 'Cancelled' } as never], { name: 'Acme Supplies' }).length, 0);
});
