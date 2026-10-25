/**
 * 7R — GST / TDS statutory gaps: Form 27Q (non-residents, DTAA vs Act rate), TRACES justification import, 194-O
 * individual exemption and 5% no-PAN rate, TDS on payment after supplier returns, TCS / 27Q due items, PMT-09 and
 * refund claims (RFD-01) with the Rule 89(4) working paper, ISD distribution + GSTR-6 + 3B 4A(4), consolidated
 * e-Way Bill JSON, GSTR-9C rate-wise Table 9 / Table 14 / Table 12 split, cess on supplier notes, accounting
 * gst_summary cess, signed 4C in the 3B JSON, GSTR-9 Part V, GSTR-1 Table 14A and the per-GSTIN paper.
 * Expected figures are worked out in comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, gstin, installSettings, reload } from './helpers/world.ts';
import type { PurchaseRecord, PurchaseReturn } from '../src/types/purchases.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import {
  dueCalendar,
  loadTcsDue,
  loadTdsDue,
  paymentTdsLeft,
  suggestTds,
  tcsRowsLite,
  tdsDeductions,
  tdsRateFor,
  thresholdCheck,
  usesTcs,
  cleanVendorTds,
  vendorTdsProblem,
} from '../src/lib/tds-payables.ts';
import { NR_ACT_RATE_RULES, TDS_194O_RULES, nrActRate, sectionRate } from '../src/lib/tds-rules.ts';
import { form27Q, form27QCsv, nr27qRows, nrRateCheck, nrPayeeOf, trcValidOn } from '../src/lib/tds-27q.ts';
import { form26Q } from '../src/lib/tds-returns.ts';
import {
  MAX_CELL,
  flagsByKey,
  importJustification,
  justificationCsv,
  loadJustifications,
  matchFindings,
  parseAmount,
  parseJustification,
  parseTracesDate,
  setFindingResolved,
} from '../src/lib/traces-justification.ts';
import { businessNotices } from '../src/lib/business-alerts.ts';
import { emptyAmounts, type GstChallan, type GstSetOffRecord } from '../src/lib/gst-setoff.ts';
import {
  advanceRefund,
  cashLedgerDetail,
  detailByHead,
  loadRefunds,
  refundDeadline,
  refundDelayInterest,
  refundVoucherLines,
  rule894Basis,
  rule894Refund,
  savePmt09,
  saveRefund,
  validatePmt09,
  type GstRefundClaim,
  type Pmt09Transfer,
} from '../src/lib/gst-cash-refunds.ts';
import { REFUND_TIME_RULES, gstr6DueDate, nextFyCutoff } from '../src/lib/gst-penalties.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { buildGstr6, isdCreditPool, isdInwardRows, issueDistribution, loadIsdDocs, planIsdDistribution, saveIsdDoc, type IsdDoc } from '../src/lib/isd.ts';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { buildGstr3bJson } from '../src/lib/gstr-json.ts';
import { buildConsolidatedEway, ewbCandidates, parseEwbList } from '../src/lib/eway-consolidated.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import { buildGstr9c } from '../src/lib/gstr9c.ts';
import { expenseHeadOf, gstr9cRateWise, gstr9cTable14, notesItcForFy } from '../src/lib/gstr9c-extra.ts';
import { createCreditNote, readLinks } from '../src/lib/documents.ts';
import { noteCess, noteCessFor, noteSelfTax, itcAdjustmentsFromNotes, noteItc } from '../src/lib/purchase-returns-gst.ts';
import { purchaseReturnPostings } from '../src/lib/ledger/postings-returns.ts';
import { chartOf } from '../src/lib/ledger/accounts.ts';
import { buildDataset } from '../src/lib/accounting-export.ts';
import { emptySource } from '../src/lib/export-shared.ts';
import { table14A } from '../src/lib/eco-amend.ts';
import { buildByGstin, gstinColumns } from '../src/lib/gst-by-gstin.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const VENDOR_MH = gstin('27AAAPL1234C1Z');
const VENDOR_KA = gstin('29AAAPL1234C1Z');

/* ── TDS: 194-O, Sec 195 rates ─────────────────────────────────── */

test('194-O: ₹5 lakh exemption for an individual / HUF with PAN, catch-up when crossed; 5% without PAN', () => {
  assert.equal(TDS_194O_RULES.length >= 2, true);
  const ind = { pan: 'ABCPE1234F' }; // 4th letter P → individual
  const prior = [{ id: 'a', date: '2026-05-01', base: 300000, tds: 0, code: '194O' }];
  // FY total 300000 + 150000 = 450000 ≤ 500000 → no TDS (reason Y).
  const within = suggestTds('194O', '2026-06-01', 150000, ind, prior)!;
  assert.equal(within.applies, false);
  assert.equal(within.reason, 'Y');
  // 300000 + 250000 = 550000 > 500000 → TDS on 250000 + catch-up 300000 = 550000 at 0.1% = 550.
  const crossed = suggestTds('194O', '2026-06-01', 250000, ind, prior)!;
  assert.equal(crossed.applies, true);
  assert.equal(crossed.base, 550000);
  assert.equal(crossed.amount, 550);
  // A company gets no exemption: 0.1% of 150000 = 150.
  assert.equal(suggestTds('194O', '2026-06-01', 150000, { pan: 'ABCCE1234F' }, prior)!.amount, 150);
  // No PAN: 5% (not 20%), reason C; and no exemption (needs PAN / Aadhaar).
  const noPan = tdsRateFor('194O', '2026-06-01', {})!;
  assert.equal(noPan.rate, 5);
  assert.equal(noPan.reason, 'C');
  assert.equal(thresholdCheck('194O', '2026-06-01', 1000, [], undefined, {}).applies, true);
  // Before 1 Oct 2020 the section did not exist.
  assert.equal(tdsRateFor('194O', '2020-06-01', {}), null);
});

test('Sec 195 Act rates are date-keyed with cess; foreign company "other sums" 40% → 35%', () => {
  assert.ok(NR_ACT_RATE_RULES.every((r, i, a) => i === 0 || a[i - 1].from < r.from), 'append-only, sorted');
  assert.equal(sectionRate('195-R', '2023-03-31'), 10.4); // 10% + 4% cess
  assert.equal(sectionRate('195-R', '2023-04-01'), 20.8); // 20% + 4% cess
  assert.equal(sectionRate('195-O', '2024-03-31', 'COMPANY'), 41.6);
  assert.equal(sectionRate('195-O', '2024-04-01', 'COMPANY'), 36.4);
  assert.equal(sectionRate('195-O', '2024-04-01', 'INDIVIDUAL'), 31.2);
  assert.equal(nrActRate('INTEREST', '2017-12-01').rate, 20.6); // 3% cess before 1 Apr 2018
});

test('27Q rate check: DTAA only with TRC + 10F, expired TRC, no PAN without Rule 37BC', () => {
  const base = nrPayeeOf({ nr_country: 'Singapore', nr_tin: 'T123', nr_trc_no: 'TRC9', nr_trc_to: '2026-12-31', nr_form10f: true, nr_dtaa_rate: 10, nr_dtaa_article: 'Art 12' });
  assert.equal(trcValidOn(base, '2026-06-01'), true);
  const ok = nrRateCheck('195-F', '2026-06-01', 'AAACZ1234F', 'COMPANY', base);
  assert.equal(ok.basis, 'DTAA');
  assert.equal(ok.required, 10);
  const expired = nrRateCheck('195-F', '2027-01-15', 'AAACZ1234F', 'COMPANY', base);
  assert.equal(expired.basis, 'ACT');
  assert.equal(expired.required, 20.8);
  assert.equal(expired.dtaaBlocked, true);
  const no10f = nrRateCheck('195-F', '2026-06-01', 'AAACZ1234F', 'COMPANY', { ...base, form10f: false });
  assert.equal(no10f.required, 20.8);
  // No PAN, Rule 37BC details on file → no 206AA floor; the DTAA rate stands.
  assert.equal(nrRateCheck('195-F', '2026-06-01', '', 'COMPANY', base).required, 10);
  // No PAN, no details → at least 20% (Act 20.8 already higher; with a 10% DTAA blocked by no TRC → 20.8).
  const bare = nrRateCheck('195-I', '2026-06-01', '', 'OTHER', nrPayeeOf({}));
  assert.equal(bare.required, 20.8); // interest 20% + 4% cess = 20.8 ≥ 20
  // A non-resident booked under a resident section is flagged.
  assert.ok(nrRateCheck('194J', '2026-06-01', 'AAACZ1234F', 'COMPANY', base).notes.some((n) => /Sec 195/.test(n)));
});

function nrSetup() {
  setTable('vendors', [
    { id: 'nr1', name: 'Lion Tech Pte', non_resident: true, nr_country: 'Singapore', nr_tin: 'T1', nr_trc_no: 'TRC1', nr_trc_to: '2027-03-31', nr_form10f: true, nr_dtaa_rate: 10 },
    { id: 'nr2', name: 'Euro GmbH', non_resident: true, nr_country: 'Germany' },
    { id: 'r1', name: 'Local Co' },
  ]);
  const bills: PurchaseRecord[] = [
    // DTAA 10% applied on 100000 → 10000, fine.
    { id: 'b1', kind: 'EXPENSE', vendor_id: 'nr1', vendor_name: 'Lion Tech Pte', bill_number: 'L-1', lines: [], date: '2026-05-10', category: 'Professional fees', taxable: 100000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 100000, amount_paid: 0, tds_section: '195-F', tds_rate: 10, tds_base: 100000, tds_amount: 10000, tds_pan: 'AAACL1234F' },
    // No TRC: Act 20.8% required, 10% applied on 50000 → short 10400 − 5000 = 5400.
    { id: 'b2', kind: 'EXPENSE', vendor_id: 'nr2', vendor_name: 'Euro GmbH', bill_number: 'E-1', lines: [], date: '2026-06-10', category: 'Royalty', taxable: 50000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 50000, amount_paid: 0, tds_section: '195-R', tds_rate: 10, tds_base: 50000, tds_amount: 5000, tds_pan: 'AAACE1234F' },
    { id: 'b3', kind: 'EXPENSE', vendor_id: 'r1', vendor_name: 'Local Co', bill_number: 'R-1', lines: [], date: '2026-06-12', category: 'Professional fees', taxable: 60000, cgst: 5400, sgst: 5400, igst: 0, itc_eligible: true, total: 70800, amount_paid: 0, tds_section: '194J', tds_rate: 10, tds_base: 60000, tds_amount: 6000, tds_pan: 'AAACR1234F' },
  ];
  setTable('purchases', bills);
  return tdsDeductions({ purchases: bills, payments: [], vendors: getTable('vendors') });
}

test('Form 27Q: non-residents only, short deduction flagged, cess split, 26Q points to the 27Q tab', () => {
  const rows = nrSetup();
  const checks = nr27qRows(rows, getTable('vendors'));
  assert.equal(checks.length, 2);
  assert.equal(checks.find((c) => c.row.payee === 'Lion Tech Pte')!.shortBy, 0);
  assert.equal(checks.find((c) => c.row.payee === 'Euro GmbH')!.shortBy, 5400);
  const challan = { id: 'c1', kind: 'TDS' as const, date: '2026-06-05', bsr_code: '0510308', challan_no: '00011', amount: 10000, minor_head: '200' as const, deduction_keys: ['bill:b1'] };
  const p = form27Q(rows, getTable('vendors'), [challan], 2026, 1);
  assert.equal(p.deducteeRows.length, 3); // header + 2
  assert.equal(p.totals.deducted, 15000);
  assert.equal(p.totals.deposited, 10000);
  assert.equal(p.totals.shortBy, 5400);
  const euro = p.deducteeRows.find((r) => r[5] === 'Euro GmbH')!;
  assert.equal(euro[17], 'A'); // rate as per IT Act
  // Act basis: 5000 = tax 4807.69 + cess 192.31 (4%).
  assert.equal(euro[8], '4807.69');
  assert.equal(euro[10], '192.31');
  const lion = p.deducteeRows.find((r) => r[5] === 'Lion Tech Pte')!;
  assert.equal(lion[17], 'B'); // DTAA
  assert.ok(p.warnings.some((w) => /Euro GmbH: short deduction/.test(w)));
  assert.ok(p.warnings.some((w) => /Euro GmbH.*not linked to a challan/.test(w)));
  assert.match(form27QCsv(p), /UNVERIFIED Form 27Q/);
  const p26 = form26Q(rows, [], 2026, 1);
  assert.equal(p26.deducteeRows.length, 2, '26Q keeps only the resident');
  assert.ok(p26.warnings.some((w) => /Form 27Q tab/.test(w)));
});

test('Vendor NR fields are validated and kept only while non-resident', () => {
  assert.match(vendorTdsProblem({ non_resident: true, nr_dtaa_rate: 120 }), /0–100/);
  assert.equal(vendorTdsProblem({ non_resident: true, nr_dtaa_rate: 15, nr_trc_to: '2026-12-31' }), '');
  const kept = cleanVendorTds({ non_resident: true, nr_country: ' Singapore ', nr_dtaa_rate: 15, nr_form10f: true });
  assert.equal(kept.nr_country, 'Singapore');
  assert.equal(kept.nr_dtaa_rate, 15);
  const dropped = cleanVendorTds({ non_resident: false, nr_country: 'Singapore', nr_form10f: true });
  assert.equal(dropped.nr_country, undefined);
  assert.equal(dropped.nr_form10f, undefined);
});

test('27Q and TCS due items: separate 27Q return item; TCS (27EQ) items reach the bell', () => {
  nrSetup();
  const due = loadTdsDue('2026-10-25');
  assert.ok(due.some((d) => d.form === '27Q' && d.what === 'return' && d.period === '2026-Q1'));
  assert.ok(due.some((d) => !d.form && d.what === 'return' && d.period === '2026-Q1'), '26Q item for the resident');
  assert.equal(due.filter((d) => d.what === 'deposit' && d.period === '2026-05').length, 1, 'one deposit item per month');
  // TCS on invoices.
  assert.equal(usesTcs(), false);
  setTable('invoices', [
    { id: 'i1', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-09-15', tcs_amount: 120 },
    { id: 'i2', doc_type: 'TAX_INVOICE', status: 'Draft', issue_date: '2026-09-16', tcs_amount: 99 },
    { id: 'i3', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2026-09-17', tcs_amount: 10, currency: 'USD', exchange_rate: 80 },
  ]);
  assert.equal(usesTcs(), true);
  const rows = tcsRowsLite(getTable('invoices'));
  assert.deepEqual(rows.map((r) => r.amount), [120, 800]);
  const tcs = loadTcsDue('2026-10-05');
  const dep = tcs.find((d) => d.what === 'deposit' && d.period === '2026-09')!;
  assert.equal(dep.due, '2026-10-07');
  assert.equal(dep.amount, 920);
  const out = businessNotices({ today: '2026-10-05', at: '2026-10-05T10:00:00Z', approver: false, invoices: [], amc: [], tcsDue: tcs });
  assert.ok(out.some((n) => n.id.startsWith('tdsdue:TCS:dep:2026-09')));
  const r27 = dueCalendar(rows, [], [], 2026, '2026-10-05', 'TCS');
  assert.ok(r27.some((d) => d.what === 'return' && d.due === '2026-10-15'));
});

test('TDS on payment-mode bills: later supplier returns reduce what is left to deduct', () => {
  const bill = { id: 'p1', tds_on: 'PAYMENT', tds_amount: 1000, tds_base: 100000, taxable: 100000 };
  const returns = [{ id: 'n1', purchase_id: 'p1', date: '2026-06-01', taxable: 20000, total: 23600 }, { id: 'n2', purchase_id: 'other', date: '2026-06-01', taxable: 50000, total: 59000 }];
  const payments = [{ id: 'pp1', purchase_id: 'p1', tds_amount: 300 }];
  // TDS on returned value: 1000 × 20000 / 100000 = 200; left = 1000 − 200 − 300 = 500.
  assert.deepEqual(paymentTdsLeft(bill, payments, returns), { left: 500, returnedTds: 200, deducted: 300 });
  assert.deepEqual(paymentTdsLeft({ ...bill, tds_on: 'BILL' }, payments, returns), { left: 0, returnedTds: 0, deducted: 0 });
  // Fully returned → nothing left.
  assert.equal(paymentTdsLeft(bill, [], [{ purchase_id: 'p1', date: '2026-06-01', taxable: 150000, total: 1 }]).left, 0);
});

/* ── TRACES justification ─────────────────────────────────────── */

const SAMPLE = [
  'Justification Report',
  'TAN: MUMA12345B  Financial Year 2026-27  Quarter Q1  Form 26Q',
  '',
  'Short Deduction',
  'Sr. No.,Challan Serial No.,Deductee PAN,Deductee Name,Section Code,Amount Paid / Credited,Date of Payment / Credit,Tax Deducted,Applicable Rate,Short Deduction Amount',
  '1,1,AAACR1234F,Local Co,94J,"60,000.00",12-06-2026,"6,000.00",10,"=1+1"',
  '2,1,ZZZZZ9999Z,Unknown Person,94C,1000,01-05-2026,10,1,5',
  '',
  'Interest on Late Payment',
  'Sr No,PAN,Name,Section,Date of Payment,Amount,TDS Deducted,Interest Amount',
  '1,AAACR1234F,Local Co,194J,2026-06-12,60000,6000,90.00',
  '',
  'PAN Errors',
  'Sr No,Deductee PAN,Deductee Name,Amount Paid,Tax Deducted,Default',
  '1,PANNOTAVBL,Walk In,25000,5000,0\u0007',
].join('\n');

test('TRACES justification: sections, columns, dates, amounts, meta; untrusted text cleaned', () => {
  assert.equal(parseAmount('1,23,456.50'), 123456.5);
  assert.equal(parseAmount('(12.50)'), -12.5);
  assert.equal(parseAmount('abc'), 0);
  assert.equal(parseTracesDate('12-06-2026'), '2026-06-12');
  assert.equal(parseTracesDate('5/7/2026'), '2026-07-05');
  assert.equal(parseTracesDate('01-Jun-2026'), '2026-06-01');
  assert.equal(parseTracesDate('garbage'), '');
  const p = parseJustification(SAMPLE);
  assert.deepEqual(p.meta, { tan: 'MUMA12345B', fy: 2026, quarter: 1, form: '26Q' });
  assert.equal(p.findings.length, 4);
  const [sd1, sd2, lp, pe] = p.findings;
  assert.equal(sd1.kind, 'SHORT_DEDUCTION');
  assert.equal(sd1.base, 60000);
  assert.equal(sd1.date, '2026-06-12');
  assert.equal(sd1.demand, 0, 'a formula-looking cell is not a number');
  assert.equal(sd2.demand, 5);
  assert.equal(lp.kind, 'LATE_PAYMENT');
  assert.equal(lp.demand, 90);
  assert.equal(pe.kind, 'PAN_ERROR');
  assert.ok(!JSON.stringify(p.findings).includes(String.fromCharCode(7)), 'control characters removed');
  // Caret-separated export reads the same.
  const caret = parseJustification(['Short Deduction', 'Sr^PAN^Name^Section^Date of Payment^Amount Paid^Tax Deducted^Short Deduction', '1^AAACR1234F^Local Co^94J^12/06/2026^60000^6000^100'].join('\n'));
  assert.equal(caret.findings.length, 1);
  assert.equal(caret.findings[0].demand, 100);
  // Caps: an over-long cell is cut, a huge file is truncated, nothing throws.
  const long = parseJustification(`Short Deduction\nPAN,Name,Amount Paid,Short\nAAACR1234F,${'x'.repeat(5000)},100,5`);
  assert.equal(long.findings[0].name.length, MAX_CELL);
  const huge = parseJustification('a\n'.repeat(1_100_000));
  assert.equal(huge.truncated, true);
  assert.equal(huge.findings.length, 0);
});

test('TRACES justification: matched to deductions, flags by key, resolve, stored and audited', () => {
  const rows = nrSetup();
  const matched = matchFindings(parseJustification(SAMPLE).findings, rows);
  assert.equal(matched[0].key, 'bill:b3', 'PAN + section + date + amount');
  assert.equal(matched[1].key, undefined, 'unknown PAN is not matched');
  assert.equal(matched[2].key, 'bill:b3', 'another kind may hit the same row');
  const imp = importJustification('justification.txt', SAMPLE, rows, '2026-10-25');
  assert.equal(loadJustifications().length, 1);
  assert.deepEqual(flagsByKey(loadJustifications()).get('bill:b3'), ['SHORT_DEDUCTION', 'LATE_PAYMENT']);
  setFindingResolved(imp.id, 0, true);
  assert.deepEqual(flagsByKey(loadJustifications()).get('bill:b3'), ['LATE_PAYMENT']);
  assert.match(justificationCsv(loadJustifications()[0]), /TRACES demand is what counts/);
  assert.ok(getTable<{ summary?: string }>('audit_log').some((r) => /TRACES justification report/.test(String(r.summary))), 'audited');
  assert.throws(() => importJustification('empty.txt', 'nothing here', rows, '2026-10-25'), /No default rows/);
});

/* ── Cash ledger, PMT-09, refunds ─────────────────────────────── */

function challan(id: string, day: string, head: 'igst' | 'cgst' | 'sgst', tax: number, interest = 0): GstChallan {
  const amounts = emptyAmounts();
  amounts[head].tax = tax;
  amounts[head].interest = interest;
  return { id, cpin: `2627${id.padStart(10, '0')}`, generated_on: day, deposited_on: day, cin: 'X', amounts };
}

test('Cash ledger by minor head: challans, set-offs, PMT-09 and a filed cash refund (rejected part back)', () => {
  const challans = [challan('1', '2026-05-10', 'igst', 10000, 500), challan('2', '2026-05-10', 'cgst', 2000)];
  const z = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const setoffs = [{ id: 's', period_key: '2026-04', gstin: '', from: '2026-04-01', to: '2026-04-30', date: '2026-05-20', due: '2026-05-20', voucher_id: '', voucher_number: '', liability: z, rc_liability: z, itc_used: z, cash_tax: { ...z, igst: 4000 }, interest: { ...z, igst: 200 }, late_fee: z, created_at: '' } as GstSetOffRecord];
  const transfers: Pmt09Transfer[] = [{ id: 't', date: '2026-06-01', from: { head: 'igst', minor: 'tax' }, to: { head: 'sgst', minor: 'tax' }, amount: 1500 }];
  const refunds: GstRefundClaim[] = [{ id: 'r', category: 'EXCESS_CASH', period_from: '2026-04-01', period_to: '2026-06-30', relevant_date: '2026-06-30', filed_on: '2026-07-01', claimed: { ...z, igst: 3000 }, rejected: { ...z, igst: 1000 }, status: 'SANCTIONED', history: [{ date: '2026-07-01', status: 'FILED' }, { date: '2026-08-01', status: 'SANCTIONED' }] }];
  const d = cashLedgerDetail(challans, setoffs, transfers, refunds);
  // IGST tax: 10000 − 4000 − 1500 − 3000 + 1000 = 2500; IGST interest: 500 − 200 = 300; SGST tax 1500.
  assert.equal(d.igst.tax, 2500);
  assert.equal(d.igst.interest, 300);
  assert.equal(d.sgst.tax, 1500);
  assert.deepEqual(detailByHead(d), { igst: 2800, cgst: 2000, sgst: 1500, cess: 0 });
  // Before the refund was filed and before the PMT-09.
  assert.equal(cashLedgerDetail(challans, setoffs, transfers, refunds, '2026-05-31').igst.tax, 6000);
  assert.equal(validatePmt09({ date: '2026-06-02', from: { head: 'cgst', minor: 'tax' }, to: { head: 'igst', minor: 'tax' }, amount: 2500 }, d).length > 0, true);
  assert.equal(validatePmt09({ date: '2026-06-02', from: { head: 'cgst', minor: 'tax' }, to: { head: 'igst', minor: 'tax' }, amount: 2000 }, d), '');
  assert.match(validatePmt09({ date: '2026-06-02', from: { head: 'cgst', minor: 'tax' }, to: { head: 'cgst', minor: 'tax' }, amount: 1 }, d), /same/);
});

test('Refund time limit, delay interest, receipt voucher lines and Rule 89(4)', () => {
  assert.equal(REFUND_TIME_RULES[0].value.limitYears, 2);
  assert.deepEqual(refundDeadline('2024-06-30', '2026-06-29'), { lastDay: '2026-06-29', late: false });
  assert.equal(refundDeadline('2024-06-30', '2026-06-30').late, true);
  // Filed 1 Jan, paid 31 Mar (89 days): 29 days past 60 → 6% on 100000 × 29 / 365 = 476.71.
  assert.deepEqual(refundDelayInterest({ filed_on: '2026-01-01', paid_on: '2026-03-31', claimed: { igst: 100000, cgst: 0, sgst: 0, cess: 0 }, relevant_date: '2025-12-31' }, '2026-10-25'), { daysLate: 29, interest: 476.71 });
  const cash = refundVoucherLines({ category: 'EXCESS_CASH', claimed: { igst: 100, cgst: 50, sgst: 50, cess: 0 }, bank_ledger_id: 'bank' });
  assert.deepEqual(cash, [{ account_id: 'bank', dr: 20000, cr: 0 }, { account_id: A.gstCash, dr: 0, cr: 20000 }]);
  const itc = refundVoucherLines({ category: 'EXPORT_LUT_ITC', claimed: { igst: 100, cgst: 0, sgst: 0, cess: 0 }, sanctioned: { igst: 80, cgst: 0, sgst: 0, cess: 0 } });
  assert.deepEqual(itc, [{ account_id: A.bank, dr: 8000, cr: 0 }, { account_id: A.inIgst, dr: 0, cr: 8000 }]);
  // 400000 zero-rated of 1000000 adjusted turnover, net ITC IGST 50000 + CGST 10000 → 40%: 20000 + 4000.
  const r = rule894Refund({ zeroRatedTurnover: 400000, adjustedTotalTurnover: 1000000, netItc: { igst: 50000, cgst: 10000, sgst: 0, cess: 0 }, creditBalance: { igst: 15000, cgst: 9000, sgst: 0, cess: 0 } });
  assert.equal(r.ratio, 0.4);
  assert.equal(r.formula, 24000);
  assert.deepEqual(r.byHead, { igst: 15000, cgst: 4000, sgst: 0, cess: 0 }, 'IGST capped by the credit ledger');
  assert.equal(r.total, 19000);
  assert.equal(rule894Refund({ zeroRatedTurnover: 1, adjustedTotalTurnover: 0, netItc: { igst: 1, cgst: 0, sgst: 0, cess: 0 } }).total, 0);
  const basis = rule894Basis(
    { exp: [{ expType: 'WOPAY', taxable: 300 }, { expType: 'WPAY', taxable: 999 }], b2b: [{ invTyp: 'SEWOP', taxable: 200 }], cdnr: [{ invTyp: 'SEWOP', noteType: 'C', taxable: 50 }], cdnur: [] } as never,
    { outward: { taxable: { taxable: 1000 }, zeroRated: { taxable: 500 } }, itc: { net: { igst: 10, cgst: 5, sgst: 5, cess: 0 } } } as never,
  );
  assert.deepEqual(basis, { zeroRatedTurnover: 450, adjustedTotalTurnover: 1500, netItc: { igst: 10, cgst: 5, sgst: 5, cess: 0 } });
});

test('PMT-09 / refund claim storage: checks, trail, receipt voucher on PAID', () => {
  setTable('gst_challans', [challan('9', '2026-05-10', 'igst', 5000)]);
  const challans = getTable<GstChallan>('gst_challans');
  assert.throws(() => savePmt09({ date: '2026-05-11', from: { head: 'igst', minor: 'tax' }, to: { head: 'cgst', minor: 'tax' }, amount: 6000 }, challans, []), /holds only/);
  savePmt09({ date: '2026-05-11', from: { head: 'igst', minor: 'tax' }, to: { head: 'cgst', minor: 'tax' }, amount: 1000 }, challans, []);
  assert.equal(getTable('gst_pmt09').length, 1);
  const claim = saveRefund({ category: 'EXCESS_CASH', period_from: '2026-04-01', period_to: '2026-06-30', relevant_date: '2026-06-30', filed_on: '2026-07-02', arn: 'AA2707260000123', claimed: { igst: 2000, cgst: 0, sgst: 0, cess: 0 } });
  assert.equal(claim.status, 'FILED');
  assert.throws(() => advanceRefund(claim.id, { status: 'SANCTIONED', date: '2026-07-01' }), /before the filing date/);
  advanceRefund(claim.id, { status: 'SANCTIONED', date: '2026-08-01', sanctioned: { igst: 1500 }, rejected: { igst: 500 } });
  const paid = advanceRefund(claim.id, { status: 'PAID', date: '2026-08-20', bankLedgerId: A.bank });
  assert.equal(paid.history.length, 3);
  const v = loadVouchers().find((x) => x.id === paid.voucher_id)!;
  assert.equal(v.type, 'RECEIPT');
  assert.equal(v.voucher_class, 'GST refund (RFD)');
  assert.deepEqual(v.lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.bank, 150000, 0], [A.gstCash, 0, 150000]]);
  assert.equal(loadRefunds()[0].status, 'PAID');
  // Cash ledger: 5000 − 1000 (PMT-09) − 2000 (claim) + 500 (rejected) = 2500 IGST, 1000 CGST.
  const d = detailByHead(cashLedgerDetail(challans, [], getTable('gst_pmt09'), loadRefunds()));
  assert.equal(d.igst, 2500);
  assert.equal(d.cgst, 1000);
});

/* ── ISD ──────────────────────────────────────────────────────── */

const ISD_GSTIN = gstin('27AABCU9603R2Z');
const UNIT_MH = gstin('27AABCU9603R1Z');
const UNIT_KA = gstin('29AABCU9603R1Z');

test('ISD: Rule 39 shares by turnover, CGST/SGST → IGST for another State, GSTR-6 paper and due date', () => {
  const pool = { eligible: { igst: 1000, cgst: 900, sgst: 900, cess: 0 }, ineligible: { igst: 0, cgst: 90, sgst: 90, cess: 0 } };
  const plan = planIsdDistribution(pool, [{ gstin: UNIT_MH, name: 'Pune', turnover: 600000 }, { gstin: UNIT_KA, name: 'Bengaluru', turnover: 400000 }, { gstin: UNIT_KA.replace(/.$/, 'X'), name: 'Bad', turnover: 0 }], '27');
  const mh = plan.shares.find((s) => s.gstin === UNIT_MH)!;
  const ka = plan.shares.find((s) => s.gstin === UNIT_KA)!;
  // MH (same State, 60%): IGST 600, CGST 540, SGST 540. KA (40%): IGST 400 + 360 + 360 = 1120.
  assert.deepEqual(mh.eligible, { igst: 600, cgst: 540, sgst: 540, cess: 0 });
  assert.deepEqual(ka.eligible, { igst: 1120, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(ka.ineligible, { igst: 72, cgst: 0, sgst: 0, cess: 0 });
  assert.ok(plan.warnings.some((w) => /no turnover/.test(w)));
  assert.equal(gstr6DueDate('2026-12-01'), '2027-01-13');

  saveIsdDoc({ kind: 'INWARD', date: '2026-07-05', number: 'S-1', isd_gstin: ISD_GSTIN, party_gstin: VENDOR_MH, party_name: 'Audit firm', taxable: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, eligible: true });
  saveIsdDoc({ kind: 'INWARD', date: '2026-07-08', number: 'S-2', isd_gstin: ISD_GSTIN, party_gstin: VENDOR_KA, party_name: 'Ad agency', taxable: 5000, igst: 900, cgst: 0, sgst: 0, cess: 0, eligible: true });
  assert.throws(() => saveIsdDoc({ kind: 'INWARD', date: '2026-07-09', number: 's-1', isd_gstin: ISD_GSTIN, party_gstin: VENDOR_MH, party_name: 'Audit firm', igst: 0, cgst: 1, sgst: 1, cess: 0, eligible: true }), /already recorded/);
  const docs = loadIsdDocs();
  const p = isdCreditPool(docs, '2026-07', ISD_GSTIN);
  assert.deepEqual(p.eligible, { igst: 900, cgst: 900, sgst: 900, cess: 0 });
  const before = buildGstr6(docs, '2026-07', ISD_GSTIN);
  assert.ok(before.warnings.some((w) => /not distributed/.test(w)));
  const issued = issueDistribution(planIsdDistribution(p, [{ gstin: UNIT_MH, name: 'Pune', turnover: 1 }, { gstin: UNIT_KA, name: 'Bengaluru', turnover: 1 }], '27').shares, { date: '2026-07-31', month: '2026-07', isdGstin: ISD_GSTIN });
  assert.deepEqual(issued.map((d) => d.number), ['ISD/FY26-27/0001', 'ISD/FY26-27/0002']);
  const paper = buildGstr6(loadIsdDocs(), '2026-07', ISD_GSTIN);
  assert.equal(paper.table3.length, 2);
  assert.equal(paper.table5.length, 2);
  assert.equal(paper.warnings.length, 0, paper.warnings.join(' | '));
  assert.equal(paper.due, '2026-08-13');
});

test('ISD credit received → 3B 4A(4) (ineligible to 4D(2)), JSON ISD row, GSTR-9 6G', () => {
  const rows = isdInwardRows([
    { id: 'a', kind: 'RECEIVED', date: '2026-07-10', number: 'ISD/1', isd_gstin: ISD_GSTIN, party_gstin: UNIT_KA, party_name: '', igst: 1120, cgst: 0, sgst: 0, cess: 0, eligible: true },
    { id: 'b', kind: 'RECEIVED', date: '2026-07-10', number: 'ISD/2', isd_gstin: ISD_GSTIN, party_gstin: UNIT_KA, party_name: '', igst: 72, cgst: 0, sgst: 0, cess: 0, eligible: false },
    { id: 'c', kind: 'RECEIVED', date: '2026-07-20', number: 'ISD/3', isd_gstin: ISD_GSTIN, party_gstin: UNIT_KA, party_name: '', igst: 120, cgst: 0, sgst: 0, cess: 0, eligible: true, credit_note: true },
    { id: 'd', kind: 'INWARD', date: '2026-07-10', number: 'S', isd_gstin: ISD_GSTIN, party_gstin: VENDOR_MH, party_name: '', igst: 5, cgst: 0, sgst: 0, cess: 0, eligible: true },
  ] as IsdDoc[]);
  assert.equal(rows.length, 3);
  const period: ReportPeriod = { kind: 'month', fyStart: 2026, month: 7 };
  const rep = buildGstReport([], [], { period, gstin: UNIT_KA, isdInward: rows });
  assert.deepEqual(rep.gstr3b.itc.isd, { igst: 1000, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(rep.gstr3b.itc.ineligible.igst, 72);
  assert.equal(rep.gstr3b.itc.net.igst, 1000);
  const json = buildGstr3bJson(rep.gstr3b, UNIT_KA, '072026') as { itc_elg: { itc_avl: { ty: string; iamt: number }[] } };
  assert.equal(json.itc_elg.itc_avl.find((x) => x.ty === 'ISD')!.iamt, 1000);
  // Another GSTIN does not get it.
  assert.equal(buildGstReport([], [], { period, gstin: UNIT_MH, isdInward: rows }).gstr3b.itc.isd, undefined);
  const g9 = buildGstr9([], [], { fyStart: 2026, gstin: UNIT_KA, isdInward: rows });
  assert.equal(g9.table6.find((r) => r.id === '6G')!.igst, 1000);
});

test('GSTR-3B JSON writes the signed 4C when reversals exceed ITC', () => {
  const period: ReportPeriod = { kind: 'month', fyStart: 2026, month: 6 };
  const note: PurchaseReturn = { id: 'n', kind: 'SUPPLIER_CN', note_number: 'DN/FY26-27/0001', date: '2026-06-10', vendor_name: 'V', vendor_gstin: VENDOR_MH, reason: 'SALES_RETURN' as never, goods_returned: true, lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180, itc_eligible: true, adjusted_amount: 0 };
  const rep = buildGstReport([], [], { period, purchaseNotes: [note] });
  assert.equal(rep.gstr3b.itc.net.cgst, 0);
  assert.equal(rep.gstr3b.itc.netSigned!.cgst, -90);
  const json = buildGstr3bJson(rep.gstr3b, VENDOR_MH, '062026') as { itc_elg: { itc_net: { camt: number } } };
  assert.equal(json.itc_elg.itc_net.camt, -90);
});

/* ── Supplier-note cess ───────────────────────────────────────── */

test('Cess on supplier notes: pro rata from the bill, reversed in 3B, ledger and self-assessed tax', () => {
  assert.equal(noteCessFor({ cess_amount: 1200, taxable: 10000 }, 2500), 300);
  assert.equal(noteCessFor({ cess_amount: 1200, taxable: 10000 }, 2500, 1000), 200, 'capped by earlier notes');
  assert.equal(noteCessFor({ taxable: 10000 }, 2500), 0);
  const n: PurchaseReturn = { id: 'n1', kind: 'DEBIT_NOTE', note_number: 'DN/FY26-27/0001', date: '2026-06-10', purchase_id: 'b', vendor_name: 'Car dealer', vendor_gstin: VENDOR_MH, reason: 'SALES_RETURN' as never, goods_returned: true, lines: [], taxable: 2500, cgst: 350, sgst: 350, igst: 0, cess_amount: 300, total: 3500, itc_eligible: true, adjusted_amount: 0, category: 'Purchases', bill_kind: 'PURCHASE' };
  assert.equal(noteCess(n), 300);
  assert.equal(noteItc(n).cess, 300);
  assert.equal(noteItc(n).total, 1000);
  const adj = itcAdjustmentsFromNotes([n], () => true)[0];
  assert.equal(adj.cess, -300);
  const v = purchaseReturnPostings([n], chartOf([]))[0];
  const cr = (acc: string) => v.lines.filter((l) => l.account === acc).reduce((t, l) => t + l.cr - l.dr, 0);
  assert.equal(cr(A.inCess), 30000);
  assert.equal(v.lines.reduce((t, l) => t + l.dr - l.cr, 0), 0, 'balanced');
  assert.equal(v.lines.some((l) => l.account === A.roundOff), false);
  // Reverse charge: GST + cess are self-assessed.
  assert.equal(noteSelfTax({ ...n, reverse_charge: true }), 1000);
  // 3B: the note's cess comes off 4A cess for the period.
  const rep = buildGstReport([], [{ id: 'b', kind: 'PURCHASE', vendor_name: 'Car dealer', vendor_gstin: VENDOR_MH, date: '2026-06-01', taxable: 10000, cgst: 1400, sgst: 1400, igst: 0, cess_amount: 1200, itc_eligible: true, total: 14000, amount_paid: 0, category: 'Purchases' }], { period: { kind: 'month', fyStart: 2026, month: 6 }, purchaseNotes: [n] });
  assert.equal(rep.gstr3b.itc.net.cess, 900);
});

test('Accounting gst_summary has a cess column inside Total Tax', () => {
  const src = emptySource();
  src.purchases = [{ id: 'b', kind: 'PURCHASE', vendor_name: 'Car dealer', vendor_gstin: VENDOR_MH, bill_number: 'C-1', date: '2026-06-01', taxable: 10000, cgst: 1400, sgst: 1400, igst: 0, cess_amount: 1200, itc_eligible: true, total: 14000, amount_paid: 0, category: 'Purchases' } as never];
  const t = buildDataset('gst_summary', src);
  assert.deepEqual(t.headers.slice(6), ['IGST', 'Cess', 'Total Tax']);
  const val = (c: unknown) => (c && typeof c === 'object' ? (c as { money: number }).money : c);
  assert.deepEqual(t.rows[0].map(val), ['Purchases', 28, 1, 10000, 1400, 1400, 0, 1200, 4000]);
});

/* ── Consolidated e-Way Bill ──────────────────────────────────── */

test('Consolidated e-Way Bill: list parsing, checks, JSON shape, expired bills, saved candidates', () => {
  const { numbers, rejected } = parseEwbList('111000609282, 111000609283\n111000609282 12ab 99');
  assert.deepEqual(numbers, ['111000609282', '111000609283']);
  assert.deepEqual(rejected, ['12ab', '99']);
  const bad = buildConsolidatedEway({ userGstin: '', fromPlace: '', fromStateCode: '99x', transMode: 'ROAD', vehicleNo: 'XX', ewbNos: ['12'] });
  assert.equal(bad.payload, null);
  assert.ok(bad.errors.length >= 4);
  const ok = buildConsolidatedEway({ userGstin: UNIT_MH, fromPlace: 'Pune', fromStateCode: '27', transMode: 'ROAD', vehicleNo: 'mh 12 ab 1234', ewbNos: numbers, validUpto: { '111000609283': '2026-10-01' }, today: '2026-10-25' });
  assert.deepEqual(ok.errors, []);
  assert.ok(ok.warnings.some((w) => /expired/.test(w)));
  const sheet = (ok.payload as { tripSheets: Record<string, unknown>[] }).tripSheets[0];
  assert.equal(sheet.vehicleNo, 'MH12AB1234');
  assert.equal(sheet.fromState, 27);
  assert.equal(sheet.transMode, '1');
  assert.deepEqual(sheet.tripSheetEwbBills, [{ ewbNo: 111000609282 }, { ewbNo: 111000609283 }]);
  const rail = buildConsolidatedEway({ userGstin: UNIT_MH, fromPlace: 'Pune', fromStateCode: '27', transMode: 'RAIL', ewbNos: numbers });
  assert.ok(rail.errors.some((e) => /transport document/.test(e)));
  const c = ewbCandidates([{ invoice_id: 'i1', eway_no: '111000609282', eway_valid_upto: '2026-10-30' }, { invoice_id: 'i2', eway_no: 'bad' }], [{ id: 'i1', invoice_number: 'INV/1', issue_date: '2026-10-20', client: { name: 'A' } }]);
  assert.equal(c.length, 1);
  assert.equal(c[0].number, 'INV/1');
});

/* ── GSTR-9C extras, GSTR-9 Part V, Table 14A, by GSTIN ─────────── */

test('GSTR-9C: rate-wise Table 9 (incl. RC rows), Table 14 heads, Table 12 split of supplier notes', () => {
  createViaStore({ date: '2026-05-10', lines: [{ name: 'Widget', hsn: '8471', qty: 10, rate: 1000, tax: 18 }] });
  createViaStore({ date: '2026-06-10', lines: [{ name: 'Gadget', hsn: '8517', qty: 5, rate: 1000, tax: 12 }] });
  const purchases = [
    { id: 'p1', kind: 'EXPENSE', vendor_name: 'Transporter', vendor_gstin: '', date: '2026-05-15', taxable: 10000, cgst: 250, sgst: 250, igst: 0, itc_eligible: true, reverse_charge: true, total: 10500, amount_paid: 0, category: 'Freight' },
    { id: 'p2', kind: 'EXPENSE', vendor_name: 'Landlord', vendor_gstin: VENDOR_MH, date: '2026-05-20', taxable: 20000, cgst: 1800, sgst: 1800, igst: 0, itc_eligible: true, total: 23600, amount_paid: 0, category: 'Rent' },
    { id: 'p3', kind: 'PURCHASE', vendor_name: 'Importer', vendor_gstin: '', date: '2026-06-20', taxable: 50000, cgst: 0, sgst: 0, igst: 9000, itc_eligible: true, import_type: 'GOODS', total: 59000, amount_paid: 0, category: 'Purchases' },
  ];
  const notes = [{ id: 'n', kind: 'DEBIT_NOTE', note_number: 'DN/FY26-27/0001', date: '2026-07-01', purchase_id: 'p2', vendor_name: 'Landlord', vendor_gstin: VENDOR_MH, reason: 'OTHER', goods_returned: false, lines: [], taxable: 2000, cgst: 180, sgst: 180, igst: 0, total: 2360, itc_eligible: true, adjusted_amount: 0 }] as unknown as PurchaseReturn[];
  const g9 = buildGstr9(getTable('invoices'), purchases, { fyStart: 2026, purchaseNotes: notes, filerStateCode: '27' });
  const rate = gstr9cRateWise(g9, purchases, '27');
  const row = (id: string) => rate.rows.find((r) => r.id === id)!;
  assert.equal(row('9E').taxable, 10000);
  assert.equal(row('9E').cgst, 900);
  assert.equal(row('9C').taxable, 5000);
  assert.equal(row('9B').taxable, 10000, '5% reverse charge');
  assert.equal(row('9B').cgst, 250);
  // Table 9 payable includes RCM; total = 900+300+250 per CGST.
  assert.equal(row('9-TOT').cgst, 1450);
  assert.equal(row('9Q').cgst, Math.round((1450 - row('9P').cgst) * 100) / 100);
  const t14 = gstr9cTable14(g9, purchases, '27', notes);
  const h = (id: string) => t14.rows.find((r) => r.id === id)!;
  assert.equal(expenseHeadOf({}, 'Freight', ''), '14B');
  assert.equal(h('14B').eligible, 500);
  assert.equal(h('14D').eligible, 9000, 'imported material');
  // Rent: 3600 − note 360 = 3240.
  assert.equal(h('14E').eligible, 3240);
  assert.equal(h('14R').eligible, 12740);
  assert.equal(notesItcForFy(notes, 2026), 360);
  const c9 = buildGstr9c(g9, { turnover: 0, tax: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, itc: 13100, notesItc: 360 });
  const t12 = (id: string) => c9.table12.find((r) => r.id === id)!.amount;
  assert.equal(t12('12A-N'), 360);
  assert.equal(t12('12D'), 12740);
  // Without the split field the table stays as before.
  assert.equal(buildGstr9c(g9, { turnover: 0, tax: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, itc: 100 }).table12.some((r) => r.id === '12A-N'), false);
});

test('GSTR-9 Part V: next-FY credit notes on this FY invoices and supplier notes on this FY bills, up to the cut-off', () => {
  assert.equal(nextFyCutoff(2020), '2021-10-20');
  assert.equal(nextFyCutoff(2025), '2026-11-30');
  const inv = createViaStore({ date: '2025-10-10', lines: [{ qty: 10, rate: 1000 }] });
  freezeDate('2026-06-15T10:00:00');
  createCreditNote(reload(inv.id), { lines: [{ itemId: reload(inv.id).items[0].id, quantity: 4 }], reason: 'Sales return' });
  thawDate();
  const notes = [{ id: 'n', kind: 'DEBIT_NOTE', note_number: 'DN/FY26-27/0001', date: '2026-05-05', purchase_id: 'pb', bill_date: '2026-02-01', vendor_name: 'V', vendor_gstin: VENDOR_MH, reason: 'OTHER', goods_returned: false, lines: [], taxable: 1000, cgst: 90, sgst: 90, igst: 0, total: 1180, itc_eligible: true, adjusted_amount: 0 }] as unknown as PurchaseReturn[];
  const purchases = [{ id: 'pb', kind: 'PURCHASE', vendor_name: 'V', vendor_gstin: VENDOR_MH, date: '2026-02-01', taxable: 5000, cgst: 450, sgst: 450, igst: 0, itc_eligible: true, total: 5900, amount_paid: 0 }];
  const g9 = buildGstr9(getTable('invoices'), purchases, { fyStart: 2025, links: readLinks(), purchaseNotes: notes, nextFy: true, today: '2026-10-25' });
  const pv = (id: string) => g9.partV.find((r) => r.id === id)!;
  assert.equal(pv('11').taxable, 4000);
  assert.equal(pv('11').cgst + pv('11').sgst + pv('11').igst, 720);
  assert.equal(pv('10').taxable, 0);
  assert.equal(pv('12').cgst, 90);
  assert.equal(pv('14').cgst, 0, 'no positive differential');
  // Off by default.
  assert.equal(buildGstr9(getTable('invoices'), purchases, { fyStart: 2025, links: readLinks() }).partV.find((r) => r.id === '11')!.taxable, 0);
});

test('GSTR-1 Table 14A from amendment rows with an operator GSTIN', () => {
  const g1 = {
    amendments: {
      b2ba: [{ etin: 'X1', origPeriod: '052026', taxable: 1000, igst: 180, cgst: 0, sgst: 0, cess: 0 }],
      b2cla: [],
      cdnra: [{ etin: 'X1', origPeriod: '052026', noteType: 'C', taxable: 100, igst: 18, cgst: 0, sgst: 0 }],
      cdnura: [],
      b2csa: [],
    },
  } as never;
  assert.deepEqual(table14A(g1), [{ etin: 'X1', origPeriod: '052026', value: 900, igst: 162, cgst: 0, sgst: 0, cess: 0, count: 2 }]);
  assert.deepEqual(table14A({} as never), []);
});

test('GSTR-1 / 3B by GSTIN: bills by branch GSTIN or place-of-supply State, unassigned listed', () => {
  const cols = gstinColumns([{ companyGstin: UNIT_MH, companyName: 'HO' }], [{ gstin: UNIT_KA, name: 'Bengaluru' }, { gstin: 'bad', name: 'x' }]);
  assert.deepEqual(cols.map((c) => c.gstin), [UNIT_MH, UNIT_KA]);
  const purchases = [
    { id: 'p1', kind: 'PURCHASE', vendor_name: 'V', vendor_gstin: VENDOR_KA, date: '2026-06-02', taxable: 1000, cgst: 90, sgst: 90, igst: 0, itc_eligible: true, total: 1180, amount_paid: 0, branch_id: 'blr' },
    { id: 'p2', kind: 'PURCHASE', vendor_name: 'V', vendor_gstin: VENDOR_MH, date: '2026-06-03', taxable: 2000, cgst: 180, sgst: 180, igst: 0, itc_eligible: true, total: 2360, amount_paid: 0, place_of_supply: '27' },
    { id: 'p3', kind: 'PURCHASE', vendor_name: 'V', vendor_gstin: VENDOR_MH, date: '2026-06-04', taxable: 500, cgst: 45, sgst: 45, igst: 0, itc_eligible: true, total: 590, amount_paid: 0, place_of_supply: '07' },
  ];
  const r = buildByGstin([], purchases, { period: { kind: 'month', fyStart: 2026, month: 6 }, columns: cols, branches: [{ id: 'blr', gstin: UNIT_KA }] });
  assert.equal(r.columns.length, 3);
  assert.equal(r.unassignedIndex, 2);
  const itc = r.rows.find((x) => x.id === '4a')!;
  assert.deepEqual(itc.values, [360, 180, 90]);
  assert.equal(itc.total, 630);
  assert.ok(r.warnings.some((w) => /no branch GSTIN/.test(w)));
});

test('storage wiring: new tables are in backups, TABLE_ACTIONS and the sync DATED list', async () => {
  const backup = await import('../src/lib/backup.ts');
  const src = (await import('node:fs')).readFileSync(new URL('../src/lib/backup.ts', import.meta.url), 'utf8');
  for (const t of ['gst_pmt09', 'gst_refunds', 'isd_documents', 'tds_justifications']) assert.equal(src.split(`'${t}'`).length - 1, 2, `${t} in both backup lists`);
  void backup;
  const access = (await import('node:fs')).readFileSync(new URL('../src/lib/access.ts', import.meta.url), 'utf8');
  for (const t of ['gst_pmt09', 'gst_refunds', 'isd_documents', 'tds_justifications']) assert.match(access, new RegExp(`${t}: 'books.edit'`));
  const sync = (await import('node:fs')).readFileSync(new URL('../src/lib/sync-engine.ts', import.meta.url), 'utf8');
  for (const t of ['gst_pmt09', 'gst_refunds', 'isd_documents']) assert.ok(sync.includes(`\${DB_PREFIX}${t}\`]:`), `${t} in DATED`);
});
