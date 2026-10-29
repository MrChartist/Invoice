/**
 * PENDING 40 (7.131) — 7R follow-ups: ITC refund claims netted in the carried credit (Rule 89(3)), surcharge and
 * Sec 195A grossing-up on the 27Q paper, the Form 15CA part / 15CB need (Rule 37BB), the books column of GSTR-9C
 * rate-wise Table 9, Rules-2026 labels for 15CA / 15CB / 195A, and TRACES flags in the Deductions tab.
 * Expected figures are worked out in comments.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { carryForwardFor, creditLedgerBalance, type GstSetOffRecord, type Heads } from '../src/lib/gst-setoff.ts';
import { creditLedgerRefundMoves, type GstRefundClaim } from '../src/lib/gst-cash-refunds.ts';
import { FORM15CA_RULES, NR_SURCHARGE_RULES, nrSurchargePct } from '../src/lib/tds-rules.ts';
import { form15caPlan, form27Q, grossUp195A, nr27qRows, nrRateCheck, nrPayeeOf } from '../src/lib/tds-27q.ts';
import type { TdsDeductionRow } from '../src/lib/tds-payables.ts';
import { gstr9cBooksColumn, type Gstr9cRateRow } from '../src/lib/gstr9c-extra.ts';
import { formText, sectionText } from '../src/lib/ita2025.ts';

const H = (igst = 0, cgst = 0, sgst = 0, cess = 0): Heads => ({ igst, cgst, sgst, cess });
const Z = H();

function setoff(id: string, from: string, to: string, date: string, carry: Heads): GstSetOffRecord {
  return { id, period_key: from.slice(0, 7), gstin: '27AAAAA0000A1Z5', from, to, date, due: '', voucher_id: '', voucher_number: '', liability: Z, rc_liability: Z, itc_used: Z, cash_tax: Z, interest: Z, late_fee: Z, itc_carry: carry, created_at: '' };
}
function claim(p: Partial<GstRefundClaim>): GstRefundClaim {
  return { id: 'r', category: 'EXPORT_LUT_ITC', period_from: '2025-04-01', period_to: '2025-04-30', relevant_date: '2025-04-30', claimed: H(30000), status: 'FILED', history: [], gstin: '27AAAAA0000A1Z5', ...p };
}

test('ITC refund claims filed after the last set-off debit the carried credit (Rule 89(3)); rejected / withdrawn come back', () => {
  const g = '27AAAAA0000A1Z5';
  const s = [setoff('a', '2025-04-01', '2025-04-30', '2025-05-20', H(100000, 20000, 20000))];
  // Old behaviour (no moves): the carry is the stored one.
  assert.deepEqual(carryForwardFor(s, '2025-05-01', g).heads, H(100000, 20000, 20000));
  // Filed 25 May (after the 20 May posting): 30,000 IGST leaves the credit ledger → 70,000.
  const filed = claim({ filed_on: '2025-05-25', history: [{ date: '2025-05-25', status: 'FILED' }] });
  const c = carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([filed]));
  assert.deepEqual(c.heads, H(70000, 20000, 20000));
  assert.ok(c.notes.includes('REFUND_NETTED'));
  assert.deepEqual(c.refundNet, H(-30000));
  // Filed before the posting: already in that set-off's figures — not netted again.
  assert.deepEqual(carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([claim({ filed_on: '2025-05-10' })])).heads, H(100000, 20000, 20000));
  // Filed after this period's own posting day (upTo): belongs to the next period.
  assert.deepEqual(carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([filed]), '2025-05-22').heads, H(100000, 20000, 20000));
  // 12,000 rejected on 10 Jul (PMT-03 re-credit): 100,000 − 30,000 + 12,000 = 82,000.
  const rej = claim({ filed_on: '2025-05-25', status: 'REJECTED', rejected: H(12000), history: [{ date: '2025-05-25', status: 'FILED' }, { date: '2025-07-10', status: 'REJECTED' }] });
  assert.equal(carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([rej])).heads.igst, 82000);
  // Withdrawn: comes back in full.
  const wd = claim({ filed_on: '2025-05-25', status: 'WITHDRAWN', history: [{ date: '2025-05-25', status: 'FILED' }, { date: '2025-06-02', status: 'WITHDRAWN' }] });
  assert.equal(carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([wd])).heads.igst, 100000);
  // Cash refunds (EXCESS_CASH), drafts and other GSTINs do not touch the credit ledger.
  assert.deepEqual(creditLedgerRefundMoves([claim({ category: 'EXCESS_CASH', filed_on: '2025-05-25' }), claim({ status: 'DRAFT', filed_on: '2025-05-25' })]), []);
  assert.equal(carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([claim({ gstin: '29AAAAA0000A1Z5', filed_on: '2025-05-25' })])).heads.igst, 100000);
  // Never below zero; the credit-ledger stat follows the same moves.
  assert.equal(carryForwardFor(s, '2025-05-01', g, creditLedgerRefundMoves([claim({ filed_on: '2025-05-25', claimed: H(150000) })])).heads.igst, 0);
  assert.deepEqual(creditLedgerBalance(s, g, undefined, creditLedgerRefundMoves([filed])), H(70000, 20000, 20000));
});

function nrRow(p: Partial<TdsDeductionRow>): TdsDeductionRow {
  return {
    key: 'bill:1', source: 'bill', payee: 'Acme Ltd (UK)', payeeKey: 'v1', vendorId: 'v1', pan: '', deducteeType: 'COMPANY', code: '195-R', section: '195', rpu: '195',
    billNumber: 'B1', base: 100000, rate: 20.8, amount: 20800, creditedOn: '2025-06-10', deductedOn: '2025-06-10', reason: '', certNo: '', nonResident: true, fy: 2025, quarter: 1, ...p,
  };
}
const vendor = (p: Record<string, unknown> = {}) => ({ id: 'v1', name: 'Acme', non_resident: true, nr_country: 'United Kingdom', nr_tin: 'UK123', nr_trc_no: 'TRC1', ...p });

test('surcharge on the Act rate by the payee’s FY aggregate (unverified Part II slabs)', () => {
  assert.ok(NR_SURCHARGE_RULES.every((r) => r.verified === false));
  assert.equal(nrSurchargePct('COMPANY', 9_000_000, '2025-06-10'), 0);
  assert.equal(nrSurchargePct('COMPANY', 20_000_000, '2025-06-10'), 2);
  assert.equal(nrSurchargePct('COMPANY', 200_000_000, '2025-06-10'), 5);
  assert.equal(nrSurchargePct('INDIVIDUAL', 15_000_000, '2025-06-10'), 15);
  assert.equal(nrSurchargePct('INDIVIDUAL', 60_000_000, '2025-06-10'), 37);
  assert.equal(nrSurchargePct('INDIVIDUAL', 60_000_000, '2018-06-10'), 15);
  assert.equal(nrSurchargePct('FIRM', 12_000_000, '2025-06-10'), 12);
  // Royalty 20% for an individual with ₹1.5 crore: 20 × 1.15 × 1.04 = 23.92%.
  const c = nrRateCheck('195-R', '2025-06-10', 'ABCDE1234F', 'INDIVIDUAL', nrPayeeOf(vendor()), 15_000_000);
  assert.equal(c.actRate, 23.92);
  assert.equal(c.surchargePct, 15);
  assert.equal(c.required, 23.92);
  // A DTAA rate (TRC + 10F) carries no surcharge.
  const d = nrRateCheck('195-R', '2025-06-10', 'ABCDE1234F', 'INDIVIDUAL', nrPayeeOf(vendor({ nr_dtaa_rate: 15, nr_form10f: true })), 15_000_000);
  assert.equal(d.basis, 'DTAA');
  assert.equal(d.surchargePct, 0);
  // The register rows of the whole FY add up to the slab: two ₹60 lakh royalties to a foreign company → ₹1.2 crore → 2%.
  const rows = [nrRow({ key: 'a', base: 6_000_000, pan: 'ABCDE1234F' }), nrRow({ key: 'b', base: 6_000_000, pan: 'ABCDE1234F', quarter: 2, creditedOn: '2025-08-10' })];
  const q1 = nr27qRows(rows.filter((r) => r.quarter === 1), [vendor()], rows);
  assert.equal(q1[0].check.surchargePct, 2);
  // 20 × 1.02 × 1.04 = 21.216 → 21.22%; required TDS 6,000,000 × 21.22% = 1,273,200.
  assert.equal(q1[0].check.required, 21.22);
  assert.equal(q1[0].requiredTds, 1_273_200);
  // The 27Q paper splits the deducted tax into tax / surcharge / cess (1,272,960 = 1,200,000 + 24,000 + 48,960).
  const p = form27Q(rows.map((r) => ({ ...r, amount: 1_272_960, rate: 21.22 })), [vendor()], [], 2025, 1);
  const head = p.deducteeRows[0];
  const r1 = p.deducteeRows[1];
  assert.equal(r1[head.indexOf('TDS (₹)')], '1200000.00');
  assert.equal(r1[head.indexOf('Surcharge (₹)')], '24000.00');
  assert.equal(r1[head.indexOf('Education cess (₹)')], '48960.00');
  assert.equal(r1[head.indexOf('Form 15CA part (Rule 37BB)')], 'C + 15CB');
});

test('Sec 195A grossing-up when the payer bears the tax', () => {
  // ₹80,000 net at 20.8%: 80,000 × 100 ÷ 79.2 = 101,010.10 → 101,010; tax 101,010 × 20.8% = 21,010.
  assert.equal(grossUp195A(80000, 20.8), 101010);
  assert.equal(grossUp195A(80000, 0), 80000);
  const [x] = nr27qRows([nrRow({ base: 80000, amount: 16640, pan: 'ABCDE1234F' })], [vendor({ nr_tax_borne: true })]);
  assert.equal(x.grossedUp, 101010);
  assert.equal(x.requiredTds, 21010);
  assert.equal(x.shortBy, 4370);
  assert.ok(x.check.notes.some((n) => n.startsWith('Sec 195A: tax borne by the payer')));
  // Without the flag nothing is grossed up.
  assert.equal(nr27qRows([nrRow({ base: 80000, amount: 16640, pan: 'ABCDE1234F' })], [vendor()])[0].grossedUp, undefined);
});

test('Form 15CA part and 15CB need per remittance (Rule 37BB, ₹5 lakh Part A limit, unverified)', () => {
  assert.equal(FORM15CA_RULES[0].value.partALimit, 500000);
  assert.equal(FORM15CA_RULES[0].verified, false);
  const rows = [
    nrRow({ key: '1', base: 300000, pan: 'ABCDE1234F', creditedOn: '2025-05-01' }),
    nrRow({ key: '2', base: 150000, pan: 'ABCDE1234F', creditedOn: '2025-06-01' }), // 4.5 lakh: still A
    nrRow({ key: '3', base: 100000, pan: 'ABCDE1234F', creditedOn: '2025-07-01' }), // 5.5 lakh: C
    nrRow({ key: '4', base: 900000, pan: 'ABCDE1234F', certNo: 'CERT-197', creditedOn: '2025-08-01' }), // B
    nrRow({ key: '5', base: 50000, vendorId: 'v2', payeeKey: 'v2', payee: 'NoTax Inc', pan: 'ZZZZZ9999Z', creditedOn: '2025-08-01' }), // D (DTAA 0%)
  ];
  const plan = form15caPlan(nr27qRows(rows, [vendor(), { id: 'v2', non_resident: true, nr_trc_no: 'T', nr_form10f: true, nr_dtaa_rate: 0 }]));
  assert.deepEqual(plan.map((p) => p.part), ['A', 'A', 'C', 'B', 'D']);
  assert.deepEqual(plan.map((p) => p.needs15cb), [false, false, true, false, false]);
  assert.equal(plan[2].aggregate, 550000);
});

test('Income-tax Act 2025 labels for 15CA / 15CB / 195A go through ita2025 (unverified)', () => {
  assert.equal(formText('15CA', '2026-03-31'), 'Form 15CA');
  assert.ok(formText('15CA', '2026-04-01').startsWith('Form 145 [old 15CA]'));
  assert.ok(formText('15CB', '2026-04-01').includes('verify with your CA'));
  assert.equal(sectionText('195A', '2026-03-31'), '195A');
  assert.ok(sectionText('195A', '2026-04-01').includes('[old 195A]'));
});

test('GSTR-9C rate-wise Table 9 gets a books column (sales register by rate vs documents)', () => {
  const r = (id: string, igst: number, extra: Partial<Gstr9cRateRow> = {}): Gstr9cRateRow => ({ id, label: id, taxable: 0, cgst: 0, sgst: 0, igst, cess: 0, ...extra });
  const rows = [r('9A', 500), r('9B', 0), r('9E', 1800), r('9F', 90), r('9-TOT', 2390, { total: true })];
  const out = gstr9cBooksColumn(rows, [{ rate: 18, taxable: 11000, cgst: 0, sgst: 0, igst: 1980, cess: 0 }, { rate: 5, taxable: 10000, cgst: 0, sgst: 0, igst: 500, cess: 0 }, { rate: 0, taxable: 900, cgst: 0, sgst: 0, igst: 0, cess: 0 }], { igst: 2600, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(out.books.get('9E')!.igst, 1980);
  assert.equal(out.diff.get('9E'), 180); // a credit note left out of GSTR-1, say: books 1,980 − documents 1,800
  assert.equal(out.diff.get('9A'), 0);
  // Reverse-charge rows: the bills are the books → no difference.
  assert.equal(out.books.get('9F')!.igst, 90);
  assert.equal(out.diff.get('9F'), 0);
  assert.equal(out.diff.has('9-TOT'), false);
  // 2,600 booked − 2,480 on lines by rate = 120 not by rate.
  assert.equal(out.notByRate.igst, 120);
});

test('TRACES findings are flagged in the Deductions tab', () => {
  const src = readFileSync(new URL('../src/components/tds/TdsTabs.tsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function DeductionsTab'));
  assert.match(body.slice(0, 2500), /flagsByKey\(loadJustifications\(\)\)/);
  assert.match(body, /data-traces-flag/);
});
