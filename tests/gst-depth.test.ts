/**
 * WP-6 (P1-16): HSN master + rate inheritance, purchase HSN register, month-wise reconciliation, e-Invoice
 * ShipDtls / DispDtls / PayDtls / EwbDtls, GSTR-9C working paper.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  addSuggested,
  deleteHsn,
  findHsn,
  loadHsnMaster,
  offSlabRates,
  rateOn,
  resolveGstRate,
  saveHsn,
  suggestFromLines,
  validateHsn,
  type HsnMasterRow,
} from '../src/lib/hsn-master.ts';
import { purchaseHsnRegister } from '../src/lib/hsn-purchase-register.ts';
import { gstr1Tax, gstr3bTax, reconMonthly } from '../src/lib/gst-recon-monthly.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { buildGstr9c, GSTR9C_THRESHOLD } from '../src/lib/gstr9c.ts';
import { invoice, item, sender, BUYER_MH } from './einvoice-fixtures.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const master: HsnMasterRow[] = [
  { id: 'a', code: '8471', description: 'Computers', kind: 'goods', uqc: 'NOS', rates: [{ from: '2017-07-01', rate: 18 }] },
  { id: 'b', code: '847130', description: 'Laptops', kind: 'goods', rates: [{ from: '2017-07-01', rate: 18 }, { from: '2025-09-22', rate: 12 }] },
  { id: 'c', code: '2106', description: 'Pan masala', kind: 'goods', rates: [{ from: '2017-07-01', rate: 28, cess_rate: 60 }] },
];

test('HSN master: rate history by date, longest-prefix match, inheritance order', () => {
  assert.equal(rateOn(master[1], '2025-09-21')!.rate, 18);
  assert.equal(rateOn(master[1], '2025-09-22')!.rate, 12);
  assert.equal(rateOn(master[1], '2017-06-30'), undefined);
  assert.equal(findHsn(master, '84713010')!.code, '847130');
  assert.equal(findHsn(master, '84719000')!.code, '8471');
  assert.equal(findHsn(master, '9983'), undefined);
  // item → HSN master → group → company
  assert.deepEqual(resolveGstRate(master, { itemRate: 5, hsn: '847130', date: '2025-10-01' }), { rate: 5, cess_rate: 0, source: 'item' });
  assert.deepEqual(resolveGstRate(master, { itemRate: '', hsn: '847130', date: '2025-10-01', groupRate: 28 }), { rate: 12, cess_rate: 0, source: 'hsn', hsn: '847130' });
  assert.deepEqual(resolveGstRate(master, { hsn: '2106', date: '2025-10-01' }), { rate: 28, cess_rate: 60, source: 'hsn', hsn: '2106' });
  assert.deepEqual(resolveGstRate(master, { hsn: '9983', date: '2025-10-01', groupRate: 18, companyRate: 5 }), { rate: 18, cess_rate: 0, source: 'group' });
  assert.deepEqual(resolveGstRate(master, { hsn: '', date: '2025-10-01', companyRate: 5 }), { rate: 5, cess_rate: 0, source: 'company' });
  assert.equal(resolveGstRate(master, { date: '2025-10-01' }).source, 'none');
});

test('HSN master storage: validate, save, rate change appended, delete, suggestions from documents', () => {
  assert.match(validateHsn({ code: '12', description: '', kind: 'goods', rates: [] }).join(' '), /4 to 8 digits/);
  const r = saveHsn({ code: '9983', description: 'Consulting', kind: 'services', rates: [{ from: '2017-07-01', rate: 18 }] });
  assert.equal(r.kind, 'services');
  assert.throws(() => saveHsn({ code: '9983', description: 'dup', kind: 'services', rates: [] }), /already in the master/);
  const edited = saveHsn({ ...r, rates: [...r.rates, { from: '2026-01-01', rate: 5 }] });
  assert.deepEqual(edited.rates.map((x) => [x.from, x.rate]), [['2017-07-01', 18], ['2026-01-01', 5]]);
  assert.deepEqual(offSlabRates({ rates: [{ from: '2017-07-01', rate: 17 }, { from: '2018-01-01', rate: 18 }] }), [17]);
  const sugg = suggestFromLines([
    { hsn: '9983', name: 'x', rate: 18, date: '2025-04-01' },
    { hsn: '4802', name: 'Paper', unit: 'nos', rate: 12, date: '2025-05-01' },
    { hsn: '4802', name: 'Paper', unit: 'nos', rate: 18, date: '2025-04-15' },
    { hsn: '4802', name: 'Paper', unit: 'nos', rate: 18, date: '2025-06-01' },
  ], loadHsnMaster());
  assert.deepEqual(sugg, [{ code: '4802', description: 'Paper', uqc: 'NOS', rate: 18, from: '2025-04-15', kind: 'goods' }]);
  assert.equal(addSuggested(sugg), 1);
  assert.equal(addSuggested(sugg), 0);
  assert.deepEqual(loadHsnMaster().map((x) => x.code), ['4802', '9983']);
  deleteHsn(r.id);
  assert.deepEqual(loadHsnMaster().map((x) => x.code), ['4802']);
});

test('purchase HSN register spreads bill heads over lines and totals equal the bills', () => {
  const bill = {
    id: 'p', kind: 'PURCHASE', vendor_name: 'V', vendor_gstin: '29AABCT1332L1ZX', bill_number: '1', date: '2025-05-02', category: 'Stock',
    lines: [
      { id: 'a', name: 'Laptop', hsn: '847130', unit: 'NOS', quantity: 1, rate: 600, tax_rate: 18 },
      { id: 'b', name: 'Mouse', hsn: '847160', unit: 'NOS', quantity: 2, rate: 200, tax_rate: 18 },
    ],
    taxable: 1000, cgst: 0, sgst: 0, igst: 180, itc_eligible: true, total: 1180, amount_paid: 0,
  };
  const legacy = { id: 'q', date: '2025-05-03', vendor_name: 'W', taxable: 500, tax_amount: 25, total: 525 };
  const reg = purchaseHsnRegister([bill, legacy], { from: '2025-05-01', to: '2025-05-31', filerStateCode: '27', master });
  assert.equal(reg.billsConsidered, 2);
  assert.deepEqual(reg.rows.map((r) => [r.hsn, r.rate, r.taxable, r.igst + r.cgst + r.sgst, r.description]), [
    ['847130', 18, 600, 108, 'Laptops'],
    ['847160', 18, 400, 72, 'Mouse'],
    ['—', 5, 500, 25, 'W'],
  ]);
  assert.equal(reg.linesWithoutHsn, 1);
  assert.deepEqual(reg.totals, { taxable: 1500, igst: 180, cgst: 12.5, sgst: 12.5, cess: 0 });
  assert.deepEqual(reg.byRate.map((r) => [r.rate, r.taxable, r.tax]), [[5, 500, 25], [18, 1000, 180]]);
});

const sale = (over: Partial<InvoiceRecord>): InvoiceRecord => invoice({ sender, place_of_supply: '27', gst_mode: 'CGST_SGST', items: [item({ rate: 1000, tax_rate: 18 })], ...over });

test('month-wise reconciliation: GSTR-1, 3B and books per month', () => {
  const invs = [
    sale({ id: 'a', invoice_number: 'INV/FY25-26/0001', issue_date: '2025-04-10' }),
    sale({ id: 'b', invoice_number: 'INV/FY25-26/0002', issue_date: '2025-05-10', client: { ...invoice().client, gstin: '' } as never }),
  ];
  const april = buildGstReport(invs, [], { period: { kind: 'month', fyStart: 2025, month: 4 } });
  assert.equal(gstr1Tax(april.gstr1), 180);
  assert.equal(gstr3bTax(april.gstr3b), 180);
  const rows = reconMonthly(invs, [], {
    fyStart: 2025,
    upTo: '2025-06-30',
    books: (from) => (from === '2025-05-01' ? { tax: 170, itc: 0 } : { tax: from === '2025-04-01' ? 180 : 0, itc: 0 }),
  });
  assert.deepEqual(rows.map((r) => [r.from, r.g1, r.g3b, r.books, r.diff13, r.diff3Books, r.ok]), [
    ['2025-04-01', 180, 180, 180, 0, 0, true],
    ['2025-05-01', 180, 180, 170, 0, 10, false],
    ['2025-06-01', 0, 0, 0, 0, 0, true],
  ]);
});

test('e-Invoice ShipDtls / PayDtls / EwbDtls / DispDtls from the record', () => {
  const rec = invoice({
    sender: { ...sender, accountName: 'Mr Chartist Research', accountNumber: '1234 5678 9012', ifsc: 'hdfc0001234' },
    terms: 'Payable within 14 days',
    amount_paid: 500,
    ship_to: { name: 'Acme Warehouse', address: 'Plot 7, MIDC Bhiwandi 421302', city: 'Bhiwandi', state_code: '27', gstin: BUYER_MH },
    transport: { mode: 'ROAD', vehicle_no: 'mh 04 ab-1234', transporter_name: 'Fast Movers', lr_no: 'LR55', lr_date: '2025-06-18', distance_km: 42.4 },
  });
  const { payload, assumptions } = buildEInvoice(rec, { dispatch: { name: 'Godown 2', address: 'Unit 3, Taloja 410208', state_code: '27' } });
  assert.deepEqual(payload.ShipDtls, { Gstin: BUYER_MH, LglNm: 'Acme Warehouse', Addr1: 'Plot 7, MIDC Bhiwandi 421302', Loc: 'Bhiwandi', Pin: 421302, Stcd: '27' });
  assert.equal(payload.DispDtls!.Nm, 'Godown 2');
  assert.equal(payload.DispDtls!.Pin, 410208);
  assert.equal(payload.PayDtls!.AccDet, '123456789012');
  assert.equal(payload.PayDtls!.FinInsBr, 'HDFC0001234');
  assert.equal(payload.PayDtls!.CrDay, 14); // 18 Jun → 2 Jul
  assert.equal(payload.PayDtls!.PaidAmt, 500);
  assert.equal(payload.PayDtls!.PaymtDue, payload.ValDtls.TotInvVal - 500);
  assert.deepEqual(payload.EwbDtls, { Distance: 42, TransName: 'Fast Movers', TransMode: '1', TransDocNo: 'LR55', TransDocDt: '18/06/2025', VehNo: 'MH04AB1234', VehType: 'R' });
  assert.ok(!assumptions.some((a) => a.code === 'SHIP_PIN'));
  // Nothing extra for a plain invoice without bank details, ship-to or transport.
  const plain = buildEInvoice(invoice()).payload;
  assert.equal(plain.ShipDtls, undefined);
  assert.equal(plain.PayDtls, undefined);
  assert.equal(plain.EwbDtls, undefined);
  assert.equal(buildEInvoice(rec, { withPayment: false, withEwb: false }).payload.PayDtls, undefined);
});

test('GSTR-9C working paper: turnover, taxable turnover, tax and ITC vs GSTR-9', () => {
  const invs = [sale({ id: 'a', issue_date: '2025-04-10' }), sale({ id: 'b', invoice_number: 'INV/FY25-26/0002', issue_date: '2025-08-10' })];
  const bill = { id: 'p', kind: 'PURCHASE', vendor_name: 'V', vendor_gstin: '27AAPFU0939F1ZV', bill_number: '1', date: '2025-05-02', category: 'Stock', lines: [], taxable: 500, cgst: 45, sgst: 45, igst: 0, itc_eligible: true, total: 590, amount_paid: 0 };
  const g9 = buildGstr9(invs, [bill], { fyStart: 2025 });
  // Books: turnover 2,100 (100 of it unbilled revenue at year end), tax 180 + 180, ITC 90.
  const c = buildGstr9c(g9, { turnover: 2100, tax: { igst: 0, cgst: 180, sgst: 180, cess: 0 }, itc: 90 }, { unbilledClosing: 100 });
  const line = (t: { id: string; amount: number }[], id: string) => t.find((x) => x.id === id)!.amount;
  assert.equal(line(c.table5, '5O'), 2000);
  assert.equal(line(c.table5, '5P'), 2000);
  assert.equal(c.unreconciled.turnover, 0);
  assert.equal(line(c.table7, '7E'), 2000);
  assert.equal(line(c.table7, '7F'), 2000);
  assert.deepEqual(c.table9.map((r) => [r.head, r.books, r.returns, r.diff]), [['IGST', 0, 0, 0], ['CGST', 180, 180, 0], ['SGST', 180, 180, 0], ['Cess', 0, 0, 0]]);
  assert.equal(line(c.table12, '12E'), 90);
  assert.equal(c.unreconciled.itc, 0);
  assert.equal(c.required, false);
  assert.equal(GSTR9C_THRESHOLD, 5e7);
  // An unexplained difference shows as unreconciled.
  assert.equal(buildGstr9c(g9, { turnover: 2500, tax: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, itc: 100 }).unreconciled.turnover, 500);
});
