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
  // Review M2: the Sec 25(4) pair guard reads `branch_transfer_id` and treats a void bill as gone.
  const { transferPairOf } = await import('../src/lib/godowns.ts');
  assert.deepEqual(transferPairOf('str9', { invoices: [], purchases: [{ ...bill, branch_transfer_id: 'str9' }] }), { bill: bill.bill_number });
  assert.equal(transferPairOf('str9', { invoices: [], purchases: [{ ...bill, branch_transfer_id: 'str9', status: 'void' }] }), null);
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

test('8C: draft bills (status draft, purchase_drafts) are skipped by every reader; capture fields change no figure', async () => {
  const { isVoidStatus } = await import('../src/lib/purchase-normalize.ts');
  const draft = { ...bill, id: 'd1', status: 'draft', draft: { source: 'capture', created_at: '' } } as never;
  // If a draft row ever reached `purchases`, the books, GST papers, exports and stock skip it.
  assert.equal(isVoidStatus(readPurchase(draft)!.status), true);
  assert.equal(booksNormalize(draft), null);
  assert.equal(gstNormalize(draft, '27'), null);
  const stock = collectEvents({
    items: [{ id: 's1', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }] as never,
    moves: [],
    invoices: [],
    purchases: [draft] as never,
  });
  assert.equal([...stock.values()].flat().length, 0, 'no stock-in from a draft');
  // e-invoice IRN / recurring links are additive and leave every money figure alone.
  const captured: PurchaseRecord = { ...bill, id: 'c1', einvoice_irn: 'f'.repeat(64), einvoice_irn_date: '2026-04-12', recurring_bill_id: 'rb1', recurring_date: '2026-04-01' };
  assert.equal(booksNormalize(captured as never)!.total, 1180);
  assert.equal(gstNormalize(captured, '27')!.cgst, 90);
  assert.equal(exportNormalize(captured)!.taxable, 1000);
  // Posting strips the draft envelope.
  const { billOfDraft } = await import('../src/lib/purchase-drafts.ts');
  const posted = billOfDraft(draft) as unknown as Record<string, unknown>;
  assert.equal(posted.status, undefined);
  assert.equal(posted.draft, undefined);
  assert.equal(posted.total, 1180);
});

test('8C readers (duplicate guard, bank memory, bills due soon) read the real bill shape and skip drafts', async () => {
  const { findBillDuplicates } = await import('../src/lib/bill-duplicates.ts');
  const { buildMemory } = await import('../src/lib/bank-rules.ts');
  const { billsDueSoon } = await import('../src/lib/recurring-bills.ts');
  assert.equal(findBillDuplicates({ ...bill, id: undefined, bill_number: 'as-22' }, [bill]).exact.length, 1);
  assert.equal(findBillDuplicates({ ...bill, id: undefined }, [{ ...bill, status: 'draft' }]).exact.length, 0);
  const expense: PurchaseRecord = { ...bill, id: 'e1', kind: 'EXPENSE', category: 'Rent' };
  const st = [{ id: 's', imported_at: '', bank_label: '', file_name: '', lines: [{ id: 'l', date: '2026-04-12', narration: 'NEFT ACME SUPPLIES RENT', ref: '', debit: 1180, credit: 0, matched_to: { type: 'purchase_payment' as const, id: 'pp' } }] }];
  const mem = buildMemory(st, [expense], [{ id: 'pp', purchase_id: 'e1' }]);
  assert.equal([...mem.values()][0]?.category, 'Rent');
  assert.equal([...mem.values()][0]?.gst_rate, 18);
  assert.equal(buildMemory(st, [{ ...expense, status: 'draft' }], [{ id: 'pp', purchase_id: 'e1' }]).size, 0);
  // Bills due: what the SUPPLIER is owed (supplierPayable via balanceOf), drafts skipped.
  const due = billsDueSoon([{ ...bill, due_date: '2026-04-15', reverse_charge: true }, { ...bill, id: 'd', due_date: '2026-04-15', status: 'draft' }], [], '2026-04-12', '27');
  assert.deepEqual(due.bills.map((b) => [b.id, b.balance]), [['p1', 1000]]);
});

test('8F Breakage / Expiry Issue reads the real purchase shape (batch → supplier bill line)', async () => {
  const { brkExpCandidates } = await import('../src/lib/expiry-ops.ts');
  const item = { id: 's1', name: 'Paper ream', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, track_batches: true };
  const withBatch: PurchaseRecord = { ...bill, lines: [{ ...bill.lines[0], batch_no: 'B1', expiry_date: '2026-05-01' }] };
  const tracking = new Map([['s1', { item, qty: 10, byGodown: { main: 10 }, serials: [], batches: [{ batch: 'B1', expiry: '2026-05-01', firstIn: '2026-04-12', qty: 10, byGodown: { main: 10 } }] }]]);
  const { rows } = brkExpCandidates(tracking as never, [withBatch, { ...withBatch, id: 'x', status: 'Draft' } as unknown as PurchaseRecord, { ...withBatch, id: 'e', kind: 'EXPENSE' }], '2026-05-10', '2026-06-01');
  assert.equal(rows.length, 1, 'drafts and expenses are not supplier stock bills');
  assert.equal(rows[0].billId, 'p1');
  assert.equal(rows[0].vendorName, 'Acme Supplies');
  assert.equal(rows[0].unitCost, 100);
  assert.equal(rows[0].qty, 10);
});

test('8G readers (margin chip, insights, Today card, SmartFind) read the real purchase shape', async () => {
  const { buildUnitCosts } = await import('../src/lib/margin.ts');
  assert.equal(buildUnitCosts([bill, { ...bill, id: 'v', status: 'cancelled', lines: [{ ...bill.lines[0], rate: 999 }] }], []).get('paper ream')?.cost, 100);
  const { buildInsights } = await import('../src/lib/insights.ts');
  const gst = buildInsights({ invoices: [], payments: [], purchases: [bill] }, '2026-04-20').find((c) => c.id === 'gstTrend');
  assert.equal(gst?.value, -180, 'input tax on the bill reduces the GST estimate');
  const { todaySummary } = await import('../src/lib/today.ts');
  const exp: PurchaseRecord = { ...bill, id: 'e1', kind: 'EXPENSE' };
  assert.equal(todaySummary({ invoices: [], payments: [], purchases: [bill, exp] }, '2026-04-12').expenses, 1180);
  const { buildIndex } = await import('../src/lib/search.ts');
  const idx = buildIndex({ invoices: [], clients: [], items: [], bills: [bill as never] });
  assert.equal(idx[0]?.title, 'AS/22');
  assert.ok(idx[0]?.ids.includes('27AAPFU0939F1ZV') && idx[0]?.subtitle.includes('Acme Supplies'));
});

test('R2-C2 deferrals read the real purchase shape (prepaid expense source lines, expense account)', async () => {
  const { purchaseSourceLines, expenseAccountOf } = await import('../src/lib/deferrals.ts');
  const lines = purchaseSourceLines(bill);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 1000, '10 × ₹100 before tax');
  assert.equal(lines[0].date, '2026-04-12');
  assert.equal(lines[0].number, 'AS/22');
  assert.equal(lines[0].party, 'Acme Supplies');
  assert.equal(purchaseSourceLines({ ...bill, status: 'cancelled' })[0].cancelled, true);
  const lump = purchaseSourceLines({ ...bill, kind: 'EXPENSE', category: 'Rent', lines: [] });
  assert.equal(lump[0].amount, 1000, 'a bill without lines defers its taxable value');
  assert.equal(expenseAccountOf({ ...bill, kind: 'EXPENSE', category: 'Rent' }, []), 'rent');
  assert.equal(expenseAccountOf(bill, []), 'purchases');
});

test('R2-B5 back-to-back reader (backorders, cancel warning) reads bills against PO lines', async () => {
  const { backorderRows, openLinkedPos } = await import('../src/lib/back-to-back.ts');
  const po = {
    id: 'po1', po_number: 'PO/FY26-27/0001', date: '2026-04-05', vendor_name: 'Acme Supplies', so_id: 'so1',
    lines: [{ id: 'pl1', name: 'Paper ream', quantity: 10, rate: 100, tax_rate: 18, so_line_id: 'L1' }], taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180,
  };
  const order = {
    id: 'so1', invoice_number: 'SO/FY26-27/0001', doc_type: 'SALES_ORDER', status: 'Sent', issue_date: '2026-04-01', due_date: '2026-04-30',
    client: { name: 'C' }, items: [{ id: 'L1', name: 'Paper ream', type: 'goods', quantity: 10, rate: 150, amount: 1500 }],
  };
  const billed = { ...bill, po_id: 'po1', lines: [{ ...bill.lines[0], po_line_id: 'pl1' }] };
  const rows = backorderRows({ invoices: [order as never], links: [], orders: [po], purchases: [billed], notes: [] });
  assert.equal(rows[0].pos[0].received, 10, 'the bill against the PO line counts as received');
  assert.equal(rows[0].status, 'arrived');
  assert.deepEqual(openLinkedPos('so1', [po], [billed], []), []);
  assert.equal(openLinkedPos('so1', [po], [], []).length, 1);
});

// R4-A: genealogy (bill → batch source), QC desk (receipt lots by source document) and the landed-cost voucher read
// bills through the engine / `readPurchase` + `readPurchaseLines`.
test('R4-A readers (genealogy, QC desk, landed-cost voucher) read the real purchase shape', async () => {
  const { buildGenealogy, traceBackward } = await import('../src/lib/production/genealogy.ts');
  const { qcStock } = await import('../src/lib/production/qc.ts');
  const { targetLines, chargeCandidates, applyLandedVouchers } = await import('../src/lib/landed-voucher.ts');
  const item = { id: 's1', name: 'Paper ream', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, track_batches: true };
  const withBatch: PurchaseRecord = { ...bill, lines: [{ ...bill.lines[0], batch_no: 'B1', godown_id: 'qc' }] };
  const draft = { ...withBatch, id: 'd', status: 'Draft' } as unknown as PurchaseRecord;
  const ev = collectEvents({ items: [item], moves: [], invoices: [], purchases: [withBatch, draft] });
  const t = traceBackward(buildGenealogy(ev), 's1', 'B1');
  assert.deepEqual(t.sources.map((s) => [s.refNumber, s.party, s.qty]), [['AS/22', 'Acme Supplies', 10]], 'drafts never source a batch');
  const lots = qcStock(ev, new Set(['qc']), '2026-04-15');
  assert.deepEqual(lots.map((l) => [l.source.kind, l.source.number, l.qty, l.ageDays]), [['purchase', 'AS/22', 10, 3]]);
  const lines = targetLines([{ kind: 'bill', id: 'p1' }], [withBatch], [], [item]);
  assert.deepEqual(lines.map((l) => [l.lineId, l.quantity, l.unitCost, l.date, l.docNumber]), [['l1', 10, 100, '2026-04-12', 'AS/22']]);
  const exp: PurchaseRecord = { ...bill, id: 'e1', kind: 'EXPENSE', category: 'Freight', lines: [] };
  assert.deepEqual(chargeCandidates([withBatch, exp], [item], []).map((c) => [c.source.id, c.amount]), [['e1', 1000]], 'a lump expense is a charge; goods lines are not');
  const lcv = { id: 'v', number: 'LCV/FY26-27/0001', date: '2026-04-20', method: 'value' as const, charges: [{ id: 'c', source: { kind: 'memo' as const }, label: 'CHA', amount: 50 }], targets: [{ kind: 'bill' as const, id: 'p1' }], allocation_snapshot: [] };
  const applied = applyLandedVouchers([lcv], [withBatch], [], [item]);
  assert.equal(readPurchaseLines(applied.purchases[0])[0].landedUnit, 5, '₹50 over 10 reams');
  assert.equal(readPurchaseLines(withBatch)[0].landedUnit, 0, 'the stored bill is untouched');
});

test('R3-B4 annexure reads the real purchase shape (re-billed cost through expenseLine)', async () => {
  const { buildAnnexure } = await import('../src/lib/annexure.ts');
  const billable: PurchaseRecord = { ...bill, id: 'p9', billable_to_client_id: 'c1', markup_percent: 10 };
  const a = buildAnnexure({ time: [], expenses: [billable, { ...billable, id: 'p10', pure_agent: true }] }, DEFAULT_TIME_PREFS, { tasks: [], centres: [] });
  assert.deepEqual(a.expenses!.map((x) => [x.ref, x.amount, x.markup_pct, x.pure_agent]), [['p9', 1100, 10, false], ['p10', 1180, 0, true]]);
  assert.equal(a.expenses![0].amount, expenseLine(billable, DEFAULT_TIME_PREFS).amount, 'same amount as the invoice line');
});

test('R3-C6 practice board reads the real purchase shape (bill date counts as the last entry)', async () => {
  const { buildPracticeRow } = await import('../src/lib/practice.ts');
  const row = buildPracticeRow({ id: 'c', name: 'C', tables: { purchases: [bill, { ...bill, id: 'p2', date: undefined, bill_date: '2026-05-01' }] } }, '2026-06-01');
  assert.equal(row.lastVoucher, '2026-05-01');
});

// R4-C: the import register by Bill of Entry reads bills through `readPurchase`; the open-format export flattens
// the real purchase shape into purchases.csv + purchase_lines.csv keyed by purchase_id.
test('R4-C readers (import register by BOE, open-format export) read the real purchase shape', async () => {
  const { computeBoe, applyBoe, importRegister } = await import('../src/lib/trade/boe-duty.ts');
  const { AssetSink, flattenTable } = await import('../src/lib/trust/open-export.ts');
  const imp: PurchaseRecord = { ...bill, id: 'imp', vendor_gstin: undefined, place_of_supply: '96', import_type: 'GOODS', boe_number: '7654321', boe_date: '2026-04-13', cgst: 0, sgst: 0, igst: 180, total: 1180 };
  const d = computeBoe({ date: '2026-04-13', rate: 1, cif: 1000, lines: [{ line_id: 'l1', value: 1000, bcd_pct: 10, igst_pct: 18 }] });
  const withDuty = { ...imp, ...applyBoe(imp, d) };
  const rows = importRegister([bill, withDuty]);
  assert.deepEqual(rows.map((r) => [r.billId, r.boeNo, r.supplier, r.billNo, r.igst, r.duty, r.itcTaken]), [['imp', '7654321', 'Acme Supplies', 'AS/22', 200, 110, 200]], 'domestic bills have no BOE sheet');
  const [parent, lines] = flattenTable('purchases', [bill], new AssetSink());
  assert.equal(parent.rows.length, 1);
  assert.ok(parent.columns.includes('bill_number') && !parent.columns.includes('lines'));
  assert.deepEqual(lines.columns.slice(0, 3), ['purchase_id', 'line_no', 'id']);
  assert.deepEqual(lines.rows[0].slice(0, 3), ['p1', 1, 'l1']);
});

// R5-A: `settlement-post.ts` WRITES fee bills (marketplace fee tax invoice); every reader sees the real shape.
test('R5-A fee bill written by settlement-post reads back through readPurchase / books / GST / export readers', async () => {
  await import('./helpers/shim.ts');
  const { fixture, importMtr, setupWorld } = await import('./helpers/marketplace.ts');
  const { importSettlement, parseSettlement } = await import('../src/lib/marketplace/settlement-import.ts');
  const { postSettlement, recordFeeInvoice } = await import('../src/lib/marketplace/settlement-post.ts');
  const ch = setupWorld();
  importMtr(ch);
  const s = importSettlement(ch, parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2'), 'v2.csv');
  postSettlement(s.id);
  const { bill: fee } = recordFeeInvoice(s.id, { bill_number: 'AMZ-FEE-10', date: '2026-10-31', hsn: '9985' });
  assert.ok(readPurchase(fee));
  const n = booksNormalize(fee as never);
  assert.equal(n!.taxable, 220);
  assert.equal(n!.isExpense, true);
  assert.equal(n!.itcEligible, true);
  const g = gstNormalize(fee, '27');
  assert.equal(Math.round((g!.cgst + g!.sgst + g!.igst) * 100) / 100, 30.6);
  assert.equal(exportNormalize(fee)!.total, 250.6);
});

// R5-C: `common-credit.ts` READS bills (Rule 42 / 43 inputs) through readPurchase — ITC by head, the itc_use tag, void bills skipped.
test('R5-C common-credit reads the real purchase shape', async () => {
  const { inputsFor, rule42 } = await import('../src/lib/institutions/common-credit.ts');
  const tagged = { ...bill, id: 'p2', itc_use: 'exempt_only' } as PurchaseRecord;
  const blocked = { ...bill, id: 'p3', itc_eligible: false } as PurchaseRecord;
  const draft = { ...bill, id: 'p4', status: 'draft' } as unknown as PurchaseRecord;
  const i = inputsFor([bill, tagged, blocked, draft], '2026-04-01', '2026-04-30');
  assert.deepEqual(i.T, { igst: 0, cgst: 270, sgst: 270, cess: 0 });
  assert.deepEqual(i.T2, { igst: 0, cgst: 90, sgst: 90, cess: 0 });
  assert.deepEqual(i.T3, { igst: 0, cgst: 90, sgst: 90, cess: 0 });
  assert.equal(rule42(i, 0, 1, '2026-04').C2.cgst, 90);
});

// R5-B: `trips.ts` WRITES trip expenses / lorry-hire bills and reads them back (`tripExpenses`); `trip-pnl.ts` reads
// `purchases` for the trip P&L — both through `readPurchase`, so they understand the real purchase shape.
test('R5-B trip readers (trip expenses, trip P&L) read the real purchase shape', async () => {
  const { tripExpenses } = await import('../src/lib/transport/trips.ts');
  const { tripPnl } = await import('../src/lib/transport/trip-pnl.ts');
  const exp: PurchaseRecord = { ...bill, id: 'e1', kind: 'EXPENSE', category: 'Trip — Toll', trip_id: 'trp1', itc_eligible: false, cgst: 0, sgst: 0, taxable: 500, total: 500 };
  const fuel: PurchaseRecord = { ...bill, id: 'e2', kind: 'EXPENSE', category: 'Trip — Diesel', trip_id: 'trp1' };
  const hire: PurchaseRecord = { ...bill, id: 'h1', kind: 'EXPENSE', category: 'Lorry hire', trip_id: 'trp1', itc_eligible: false, cgst: 0, sgst: 0, taxable: 20000, total: 20000, tds_section: '194C-1', tds_amount: 200 };
  const rows = tripExpenses('trp1', [bill, exp, fuel, hire]);
  assert.deepEqual(rows.map((r) => [r.id, r.amount]), [['e1', 500], ['e2', 1000]], 'ITC-eligible cost at taxable value; hire kept apart');
  const [p] = tripPnl({ trips: [{ id: 'trp1', number: 'TRP/FY26-27/0001', vehicle_id: 'v1', start_date: '2026-04-12', lr_ids: [], advance_ids: [], status: 'open' }], vehicles: [], lrs: [], invoices: [], purchases: [bill, exp, fuel, hire] });
  assert.deepEqual([p.expenses, p.hire, p.margin], [1500, 20000, -21500]);
  assert.equal(readPurchase(hire)?.category, 'Lorry hire');
});

// R6-C1: `margin.ts` (editor margin chip) and `insights.ts` (margin erosion, stock at risk) read purchases through
// `liveInputs().purchases` (`liveCostPurchases`): the stock engine's copies of the real bill shape, with landed-cost
// vouchers left on them as `LANDED_EXTRA_KEY`. Totals / tax are the bill's own, so the GST and expense cards agree.
test('R6-C1 readers (margin chip, insights) read the engine copies of the real bill shape (landed cost included)', async () => {
  const { buildUnitCosts } = await import('../src/lib/margin.ts');
  const { buildInsights } = await import('../src/lib/insights.ts');
  const { LANDED_EXTRA_KEY } = await import('../src/lib/purchase-normalize.ts');
  const copy = { ...bill, [LANDED_EXTRA_KEY]: { l1: 5 } };
  assert.equal(buildUnitCosts([bill], []).get('paper ream')?.cost, 100);
  assert.equal(buildUnitCosts([copy], []).get('paper ream')?.cost, 105, 'landed ₹5 a ream from a voucher');
  const gst = (purchases: unknown[]) => buildInsights({ invoices: [], payments: [], purchases }, '2026-04-20').find((c) => c.id === 'gstTrend')?.value;
  assert.equal(gst([copy]), gst([bill]), 'the engine copy keeps the bill\'s tax');
});

test('R8-C: the bank stock statement counts unpaid goods bills (kind PURCHASE) as creditors for goods, not expenses', async () => {
  const { resetStorage } = await import('./helpers/shim.ts');
  const { setTable } = await import('../src/lib/storage.ts');
  const { creditorsForGoods } = await import('../src/lib/trade/tr-stock-live.ts');
  resetStorage();
  setTable('purchases', [bill, { ...bill, id: 'p2', kind: 'EXPENSE', category: 'Rent', bill_number: 'R/1' }]);
  assert.equal(creditorsForGoods('2026-04-30'), 1180);
  assert.equal(creditorsForGoods('2026-04-01'), 0, 'a bill dated after the statement date is not owed yet');
});

// R7-C1: the hotel GST desk's ITC guard reads bills through `readPurchase` (claimed, not RCM, not reversed, not void).
test('R7-C1: the hotel GST desk reads the real purchase shape for its ITC guard', async () => {
  const { hotelGuards } = await import('../src/lib/hotel/hotel-gst.ts');
  const lowRoom = { id: 'h1', invoice_number: 'H/1', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-04-10', gst_mode: 'CGST_SGST', items: [{ id: 'i', name: 'Room', type: 'Service', hsn: '996311', quantity: 1, rate: 3000, tax_rate: 5, amount: 3000 }] };
  const itc = (bills: unknown[]) => hotelGuards([lowRoom as never], bills, () => false, '2026-04-01', '2026-04-30').find((g) => g.kind === 'itc')?.amount ?? 0;
  assert.equal(itc([bill]), 180);
  assert.equal(itc([{ ...bill, itc_eligible: false }]), 0);
  assert.equal(itc([{ ...bill, reverse_charge: true }]), 0);
  assert.equal(itc([{ ...bill, itc_reversed: 180 }]), 0);
  assert.equal(itc([{ ...bill, status: 'draft' }]), 0);
});

// R7-B: `agent-commission.ts` and `ota-payout.ts` WRITE commission bills (purchase drafts, posted later as bills); the
// bill they draft reads back through readPurchase / books / GST / export like any bill.
test('R7-B commission bills (agent-commission, ota-payout) read back through readPurchase / books / GST / export readers', async () => {
  const { commissionBill } = await import('../src/lib/hotel/agent-commission.ts');
  const { billOfDraft } = await import('../src/lib/purchase-drafts.ts');
  const agentGstin = `29AAPFU0939F1Z${gstinChecksumChar('29AAPFU0939F1Z')}`;
  const agent = { ...commissionBill({ vendor: { name: 'Travel Co', gstin: agentGstin }, amount: 1000, date: '2026-10-20', home: '27', ref: 'RES/FY26-27/0001', lowBand: false, tds194h: true }), id: 'c1' } as PurchaseRecord;
  const ota = { ...commissionBill({ vendor: { name: 'Booking.com' }, amount: 500, gst: 90, date: '2026-10-20', home: '27', ref: 'OTA payout', lowBand: true, tds194h: false }), id: 'c2' } as PurchaseRecord;
  assert.equal(readPurchase(agent)?.total, 1180);
  assert.equal(booksNormalize(agent as never)!.taxable, 1000);
  assert.equal(booksNormalize(agent as never)!.itcEligible, true);
  assert.equal(gstNormalize(agent, '27')!.igst, 180, 'agent in another state → IGST');
  assert.equal(exportNormalize(agent)!.total, 1180);
  assert.equal(agent.tds_section, '194H');
  assert.equal(booksNormalize(ota as never)!.itcEligible, false, 'fully low-band hotel: ITC flagged');
  const draft = { ...ota, status: 'draft', draft: { source: 'manual', created_at: '' } } as never;
  assert.equal(readPurchase({ ...billOfDraft(draft), id: 'c3' } as PurchaseRecord)?.total, 590);
});

test('R8-A: the last purchase rate reads the real bill shape (lines, legacy items, expenses) through readPurchaseLines', async () => {
  const { lastPurchaseRate } = await import('../src/lib/trade/tr-party-rates.ts');
  const legacy = { ...bill, id: 'p3', lines: undefined, items: [{ name: 'Paper ream', quantity: 10, rate: 90 }], date: '2026-03-01' };
  assert.deepEqual(lastPurchaseRate([bill, legacy], { name: 'Acme Supplies' }, 'paper ream'), { rate: 100, date: '2026-04-12', number: 'AS/22' });
  assert.equal(lastPurchaseRate([{ ...bill, kind: 'EXPENSE' }], { name: 'Acme Supplies' }, 'Paper ream'), null, 'expenses are not goods bought');
});

// R8-B: the market fee register (`tr-charges.ts`) and the brokerage statement (`tr-brokers.ts`) read goods bills through
// `readPurchase` (date, number, party, status, kind) and keep the stored lines' `charge_head_id` / `wt`.
test('R8-B readers (market fee register, brokerage statement) read the real purchase shape', async () => {
  const { chargeRegister } = await import('../src/lib/trade/tr-charges.ts');
  const { brokerageStatement } = await import('../src/lib/trade/tr-brokers.ts');
  const withFee: PurchaseRecord = { ...bill, broker_id: 'b1', lines: [...bill.lines, { id: 'l2', name: 'Market fee', hsn: '4802', unit: 'OTH', quantity: 1, rate: 10, tax_rate: 18, charge_head_id: 'h1' }] };
  const heads = [{ id: 'h1', name: 'Market fee', side: 'both' as const, basis: 'percent' as const, rate: 1, gst: 'in_value' as const }];
  const period = { from: '2026-04-01', to: '2026-04-30' };
  assert.deepEqual(chargeRegister(period, { invoices: [], purchases: [withFee, { ...withFee, id: 'e', kind: 'EXPENSE' }], heads }).map((r) => [r.side, r.number, r.party, r.base, r.amount]), [['purchase', 'AS/22', 'Acme Supplies', 1000, 10]]);
  const st = brokerageStatement({ id: 'b1', name: 'B', rate: 0, basis: 'invoice', kind: 'broker', brokerage_basis: 'percent', brokerage_rate: 1 }, period, { invoices: [], purchases: [withFee] });
  assert.deepEqual(st.lines.map((l) => [l.number, l.base, l.brokerage]), [['AS/22', 1000, 10]]);
});

test('R9 (RT-A4) free quantity / line discount: stock takes paid + free, every money reader keeps the paid value', async () => {
  // 10 + 1 free at ₹100 less 10%: taxable ₹900, GST ₹162 (on the paid value only).
  const free: PurchaseRecord = { ...bill, id: 'pf', lines: [{ ...bill.lines[0], id: 'lf', free_qty: 1, discount_percent: 10 }], taxable: 900, cgst: 81, sgst: 81, total: 1062 };
  for (const n of [booksNormalize(free as never), exportNormalize(free), gstNormalize(free, '27')]) assert.equal(n!.taxable, 900);
  const c = readPurchase(free)!;
  assert.deepEqual([c.taxable, c.tax, c.itcEligible], [900, 162, true], 'GSTR-2 / ITC: value only');
  const [l] = readPurchaseLines(free);
  assert.deepEqual([l.quantity, l.paidQty, l.freeQty, l.netRate], [11, 10, 1, 90]);
  assert.equal(Math.round(l.quantity * l.unitCost * 100) / 100, 900);
  const items = [{ id: 's', name: 'Paper ream', hsn: '4802', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }];
  const ev = collectEvents({ items, moves: [], invoices: [], purchases: [free] } as never).get('s') ?? [];
  assert.deepEqual(ev.filter((e) => e.kind === 'purchase').map((e) => e.qty), [11], 'the stock engine receives 11');
  const { purchaseHsnRegister } = await import('../src/lib/hsn-purchase-register.ts');
  const reg = purchaseHsnRegister([free], { from: '2026-04-01', to: '2026-04-30' });
  assert.equal(reg.totals.taxable, 900, 'the purchase HSN register keeps the bill value');
  const { lastSuppliers } = await import('../src/lib/retail/rt-short-book.ts');
  const s = lastSuppliers([free]).get('name:paper ream')!;
  assert.deepEqual([s.vendorName, s.rate], ['Acme Supplies', 90], 'short book: last supplier and the rate per paid unit');
});

test('R9 (RT-B2 / RT-B3) pharmacy readers (narcotic register, margin view) read the real bill shape', async () => {
  const free: PurchaseRecord = { ...bill, id: 'pn', lines: [{ ...bill.lines[0], id: 'ln', batch_no: 'B7', free_qty: 1, discount_percent: 10, unit: 'BOX', unit_factor: 2 }] };
  const { narcoticRegister } = await import('../src/lib/retail/rt-pharmacy-registers.ts');
  const [n] = narcoticRegister([{ id: 's', name: 'Paper ream', unit: 'NOS', narcotic: true }], [free, { ...free, id: 'void', status: 'void' }], [], { from: '2026-04-01', to: '2026-04-30' });
  assert.deepEqual([n.batch, n.received], ['B7', 22], 'paid + free, in base units; a void bill is skipped');
  const { marginRows } = await import('../src/lib/retail/rt-pharmacy-prices.ts');
  const [m] = marginRows([free], [{ id: 's', name: 'Paper ream' }], [{ name: 'Paper ream', rate: 60 }]);
  assert.deepEqual([m.ptr, m.cost, m.scheme], [45, 40.91, '10 + 1'], 'PTR per base unit after the line discount; cost spread over the free units');
});

test('R9 (RT-E3) old-gold voucher reader reads the real bill shape (no GST, value only; void skipped)', async () => {
  const urd: PurchaseRecord = { ...bill, id: 'pu', vendor_gstin: undefined, bill_number: 'URD/FY26-27/0001', category: 'Old gold purchase (URD)', lines: [{ id: 'lu', name: 'Old gold (fine 24K)', hsn: '7108', unit: 'GMS', quantity: 10.125, rate: 10000.355556, tax_rate: 0 }], taxable: 101253.6, cgst: 0, sgst: 0, total: 101253.6, itc_eligible: false, amount_paid: 50000, old_metal: { metal: 'gold', gross_wt: 12.3, stone_wt: 0, net_wt: 12.3, purity_pct: 84, melt_loss_pct: 2, fine_wt: 10.125, rate_24k: 10000, value: 101253.6 } };
  const { oldGoldVouchers } = await import('../src/lib/retail/rt-old-gold.ts');
  const rows = oldGoldVouchers([urd, bill, { ...urd, id: 'pv', status: 'void' } as never], [{ id: 'x', invoice_id: 'i', amount: 50000, method: 'Exchange', date: '2026-04-12', exchange_purchase_id: 'pu' } as never]);
  assert.deepEqual(rows.map((r) => [r.id, r.exchanged, r.open]), [['pu', 50000, 51253.6]]);
  const c = readPurchase(urd)!;
  assert.deepEqual([c.taxable, c.tax, c.itcEligible], [101253.6, 0, false], 'GSTR-2 / ITC: nothing claimed');
});

test('R9 (RT-D3) buy-back URD voucher: no GST / ITC in every reader, stock 1 serial into the used godown; the margin reader uses the contract', async () => {
  const urd: PurchaseRecord = {
    ...bill, id: 'urd1', vendor_gstin: undefined, bill_number: 'URD/FY26-27/0001', category: 'Used goods (buy-back)', itc_eligible: false, cgst: 0, sgst: 0, igst: 0, taxable: 18000, total: 18000,
    lines: [{ id: 'lu', name: 'iPhone 12 (used)', item_id: 's', hsn: '8517', unit: 'NOS', quantity: 1, rate: 18000, tax_rate: 0, serials: ['356938035643809'], godown_id: 'g-used' }],
    used_goods: { serial: '356938035643809', model: 'iPhone 12' },
  };
  for (const n of [booksNormalize(urd as never), exportNormalize(urd), gstNormalize(urd, '27')]) assert.equal(n!.taxable, 18000);
  const c = readPurchase(urd)!;
  assert.deepEqual([c.tax, c.itcEligible], [0, false], 'no GST, no ITC');
  const ev = collectEvents({ items: [{ id: 's', name: 'iPhone 12 (used)', unit: 'NOS', track_stock: true, track_serials: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }], moves: [], invoices: [], purchases: [urd] } as never).get('s') ?? [];
  assert.deepEqual(ev.filter((e) => e.kind === 'purchase').map((e) => [e.qty, e.godown, e.serials]), [[1, 'g-used', ['356938035643809']]]);
  const { buyBackOf } = await import('../src/lib/retail/rt-buyback.ts');
  assert.equal(buyBackOf('356938035643809', [urd])?.value, 18000);
  assert.equal(buyBackOf('356938035643809', [{ ...urd, itc_eligible: true }]), undefined, 'ITC taken: no margin scheme');
  assert.equal(buyBackOf('356938035643809', [{ ...urd, status: 'void' } as never]), undefined, 'a void voucher is skipped');
});

test('R11 (CN-C5) 80% procurement test reads the real bill shape (registered by GSTIN, line HSN, the project cost centre)', async () => {
  const { procurement80 } = await import('../src/lib/construction/cn-procurement80.ts');
  const t = procurement80({ cost_centre_id: 'cc' }, 2026, [{ ...bill, cost_centre_id: 'cc' }, { ...bill, id: 'p2', vendor_gstin: undefined, cost_centre_id: 'cc' }, { ...bill, id: 'p3', status: 'void', cost_centre_id: 'cc' } as never]);
  assert.deepEqual([t.total, t.registered, t.unregistered, t.pct], [2000, 1000, 1000, 50]);
});
