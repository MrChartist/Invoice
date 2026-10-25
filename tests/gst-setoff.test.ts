/**
 * WP-6 (P0-6): GST set-off order (date-keyed), set-off plan + journal, PMT-06 challans, electronic cash ledger,
 * cess on purchase bills. Expected figures are worked out by hand in the comments.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { buildGstReport, computeSetOff, type Gstr3bReport } from '../src/lib/gst-reports.ts';
import { GST_SETOFF_RULES, gstSetOffOrder, rule86b } from '../src/lib/tax-rules.ts';
import {
  CHALLAN_VOUCHER_CLASS,
  GST_LEDGERS,
  cashLedgerBalance,
  challanFromPlan,
  challanTotal,
  challanWarnings,
  deleteGstChallan,
  deleteSetOff,
  emptyAmounts,
  loadGstChallans,
  loadSetOffs,
  periodKeyOf,
  periodPaymentStatus,
  planSetOff,
  postSetOff,
  saveGstChallan,
  setOffVoucherLines,
  threeBDue,
  validateGstChallan,
} from '../src/lib/gst-setoff.ts';
import { A, loadUserAccounts, loadVouchers, voucherTotals } from '../src/lib/ledger/index.ts';
import { readPurchase } from '../src/lib/purchase-normalize.ts';

beforeEach(() => resetStorage());

const H0 = { igst: 0, cgst: 0, sgst: 0 };

test('set-off order is date-keyed: Sec 49(5) → Sec 49A → Rule 88A', () => {
  assert.deepEqual(gstSetOffOrder('2018-06-01'), { igstFirst: false, igstRemainder: 'cgst_then_sgst' });
  assert.deepEqual(gstSetOffOrder('2019-02-01'), { igstFirst: true, igstRemainder: 'cgst_then_sgst' });
  assert.deepEqual(gstSetOffOrder('2019-03-29'), { igstFirst: true, igstRemainder: 'any' });
  assert.deepEqual(gstSetOffOrder('2026-09-01'), { igstFirst: true, igstRemainder: 'any' });
  // append-only, oldest first
  const froms = GST_SETOFF_RULES.map((r) => r.from);
  assert.deepEqual([...froms].sort(), froms);
  assert.equal(rule86b('2020-12-01'), null);
  assert.deepEqual(rule86b('2025-04-01'), { monthlyTaxable: 5e6, cashPct: 1 });
});

test('computeSetOff follows the order in force for the period', () => {
  // Liability CGST 100 + SGST 100; credit IGST 100 + CGST 100.
  const L = { igst: 0, cgst: 100, sgst: 100 };
  const C = { igst: 100, cgst: 100, sgst: 0 };
  // Rule 88A: IGST credit goes to the SGST shortfall (CGST has its own credit) → no cash.
  const r88a = computeSetOff(L, C, H0, gstSetOffOrder('2025-04-01'));
  assert.deepEqual(r88a.cash, { igst: 0, cgst: 0, sgst: 0 });
  assert.equal(r88a.itcUsed.igst.sgst, 100);
  // Feb–Mar 2019 (Sec 49(5)(a) "CGST then SGST", IGST first): IGST → CGST 100; CGST credit cannot pay SGST.
  const r49a = computeSetOff(L, C, H0, gstSetOffOrder('2019-02-01'));
  assert.deepEqual(r49a.cash, { igst: 0, cgst: 0, sgst: 100 });
  assert.equal(r49a.itcCarry.cgst, 100);
  // Before Feb 2019: own-head credit first (CGST → CGST), then IGST → SGST → no cash.
  const r2018 = computeSetOff(L, C, H0, gstSetOffOrder('2018-04-01'));
  assert.deepEqual(r2018.cash, { igst: 0, cgst: 0, sgst: 0 });
  assert.equal(r2018.itcUsed.cgst.cgst, 100);
  assert.equal(r2018.itcUsed.igst.sgst, 100);
  // Default (no order passed) = Rule 88A, unchanged behaviour for existing callers.
  assert.deepEqual(computeSetOff(L, C).cash, r88a.cash);
});

/** A minimal 3B report around a given set-off. */
function report3b(liab: { igst: number; cgst: number; sgst: number }, itc: { igst: number; cgst: number; sgst: number; cess?: number }, rc = H0, cess = 0, taxable = 10000): Gstr3bReport {
  const payment = computeSetOff(liab, itc, rc);
  const cessUsed = Math.min(cess, itc.cess ?? 0);
  payment.cess = cess - cessUsed;
  if (itc.cess) {
    payment.cessLiability = cess;
    payment.cessItcUsed = cessUsed;
    payment.cessItcCarry = (itc.cess ?? 0) - cessUsed;
  }
  const z = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const zh = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  return {
    outward: { taxable: { ...z, taxable, ...liab, cess }, zeroRated: z, nilExempt: { inter: 0, intra: 0 }, inwardRcm: { ...z, ...rc }, nonGst: 0 },
    interStateUnreg: [],
    itc: { importGoods: zh, importServices: zh, availableRcm: zh, availableOther: { ...zh, ...itc }, reversedRules: zh, reversedOther: zh, net: { cess: 0, ...itc }, ineligible: zh },
    inwardExempt: { inter: 0, intra: 0 },
    payment,
    unadjustedCredit: { igst: 0, cgst: 0, sgst: 0 },
    purchasesConsidered: 1,
    outwardRcmTaxable: 0,
  };
}

const MAY = { kind: 'month' as const, fyStart: 2025, month: 5 };

test('planSetOff: liability, ITC by credit head, cash, interest and late fee', () => {
  // Liability IGST 1000, CGST 500, SGST 500, cess 100; ITC IGST 300, CGST 200, SGST 600; RCM CGST 50 + SGST 50.
  // IGST 300 → IGST (700 left). CGST 200 → CGST (300 left). SGST 600 → SGST 500, then 100 → IGST (600 left).
  // Cash: IGST 600, CGST 300 + 50, SGST 0 + 50, cess 100.
  const g3 = report3b({ igst: 1000, cgst: 500, sgst: 500 }, { igst: 300, cgst: 200, sgst: 600 }, { igst: 0, cgst: 50, sgst: 50 }, 100);
  const due = threeBDue(MAY, 'monthly', '27');
  assert.deepEqual(due, { form: 'GSTR3B', due: '2025-06-20' });
  const onTime = planSetOff(g3, { period: MAY, due: due.due });
  assert.equal(onTime.periodKey, '2025-05');
  assert.deepEqual(onTime.itcUsed, { igst: 300, cgst: 200, sgst: 600, cess: 0 });
  assert.deepEqual(onTime.cashTax, { igst: 600, cgst: 350, sgst: 50, cess: 100 });
  assert.deepEqual(onTime.interest, { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(onTime.daysLate, 0);

  // Paid 10 days late: interest 18% p.a. on the cash tax; late fee ₹50/day (₹25 CGST + ₹25 SGST), cap ₹2,000.
  const late = planSetOff(g3, { period: MAY, due: '2025-06-20', paidOn: '2025-06-30' });
  assert.equal(late.daysLate, 10);
  assert.equal(late.interest.igst, 2.96); // 600 × 18% × 10/365 = 2.958…
  assert.equal(late.interest.cgst, 1.73); // 350 × 0.18 × 10/365 = 1.726…
  assert.deepEqual([late.lateFee.cgst, late.lateFee.sgst], [250, 250]);
  assert.equal(late.totalCash.cgst, 350 + 1.73 + 250);

  // Journal: Dr outputs 1000/500/500/100 + RCM 100 = 2200; Cr inputs 300/200/600 = 1100; Cr cash ledger 1100.
  const lines = setOffVoucherLines(onTime);
  const by = (id: string, side: 'dr' | 'cr') => lines.filter((l) => l.account_id === id).reduce((s, l) => s + l[side], 0);
  assert.equal(by(A.outIgst, 'dr'), 100000);
  assert.equal(by(A.outCess, 'dr'), 10000);
  assert.equal(by(A.rcmPayable, 'dr'), 10000);
  assert.equal(by(A.inSgst, 'cr'), 60000);
  assert.equal(by(A.gstCash, 'cr'), 110000);
  assert.equal(voucherTotals(lines).diff, 0);
});

test('Rule 86B warning above ₹50 lakh a month with less than 1% in cash', () => {
  const g3 = report3b({ igst: 1_000_000, cgst: 0, sgst: 0 }, { igst: 1_000_000, cgst: 0, sgst: 0 }, H0, 0, 6_000_000);
  assert.ok(planSetOff(g3, { period: MAY, due: '2025-06-20' }).warnings.includes('RULE_86B'));
  const small = report3b({ igst: 1000, cgst: 0, sgst: 0 }, { igst: 1000, cgst: 0, sgst: 0 });
  assert.ok(!planSetOff(small, { period: MAY, due: '2025-06-20' }).warnings.includes('RULE_86B'));
});

test('postSetOff writes one balanced journal per period, re-post updates it, delete removes it', () => {
  const g3 = report3b({ igst: 1000, cgst: 500, sgst: 500 }, { igst: 300, cgst: 200, sgst: 600 });
  const plan = planSetOff(g3, { period: MAY, due: '2025-06-20', paidOn: '2025-06-25' });
  const rec = postSetOff(plan, { date: '2025-06-25', gstin: '27aapfu0939f1zv' });
  assert.equal(rec.gstin, '27AAPFU0939F1ZV');
  let vs = loadVouchers();
  assert.equal(vs.length, 1);
  assert.equal(vs[0].type, 'JOURNAL');
  assert.equal(vs[0].voucher_class, 'GST set-off');
  assert.equal(voucherTotals(vs[0].lines).diff, 0);
  // Interest / late fee were due → the two expense ledgers now exist and are used.
  const ids = loadUserAccounts().map((a) => a.id);
  assert.ok(ids.includes(GST_LEDGERS.interest.id) && ids.includes(GST_LEDGERS.lateFee.id));
  assert.ok(vs[0].lines.some((l) => l.account_id === GST_LEDGERS.lateFee.id && l.dr === 25000));

  const again = postSetOff(planSetOff(g3, { period: MAY, due: '2025-06-20' }), { date: '2025-06-20', gstin: '27AAPFU0939F1ZV' });
  assert.equal(again.id, rec.id);
  vs = loadVouchers();
  assert.equal(vs.length, 1, 're-posting keeps one voucher');
  assert.equal(vs[0].id, rec.voucher_id);
  assert.equal(vs[0].date, '2025-06-20');
  assert.ok(!vs[0].lines.some((l) => l.account_id === GST_LEDGERS.lateFee.id));

  deleteSetOff(again.id);
  assert.equal(loadVouchers().length, 0);
  assert.equal(loadSetOffs().length, 0);
});

test('a whole FY or an empty period cannot be posted', () => {
  const g3 = report3b(H0, H0);
  assert.throws(() => postSetOff(planSetOff(g3, { period: MAY, due: '' }), { date: '2025-06-20' }), /Nothing to set off/);
  const fy = planSetOff(report3b({ igst: 10, cgst: 0, sgst: 0 }, H0), { period: { kind: 'fy', fyStart: 2025 }, due: '' });
  assert.ok(fy.warnings.includes('NOT_A_3B_PERIOD'));
  assert.throws(() => postSetOff(fy, { date: '2026-04-20' }), /month or a quarter/);
});

test('period keys and QRMP due dates', () => {
  assert.equal(periodKeyOf({ kind: 'quarter', fyStart: 2025, quarter: 4 }), '2025-Q4');
  assert.equal(periodKeyOf({ kind: 'month', fyStart: 2025, month: 2 }), '2026-02');
  // QRMP quarter Apr–Jun 2025, Maharashtra (category X): 22 July.
  assert.deepEqual(threeBDue({ kind: 'quarter', fyStart: 2025, quarter: 1 }, 'qrmp', '27'), { form: 'GSTR3B', due: '2025-07-22' });
  // QRMP month 1: PMT-06 by the 25th, no return.
  assert.deepEqual(threeBDue({ kind: 'month', fyStart: 2025, month: 4 }, 'qrmp', '27'), { form: 'PMT06', due: '2025-05-25' });
});

const CPIN = '25062700012345';

test('PMT-06 challan: validation, deposit posts Dr cash ledger / Cr bank, cash ledger balance', () => {
  const amounts = emptyAmounts();
  amounts.igst.tax = 600;
  amounts.cgst.tax = 350;
  amounts.cgst.interest = 1.73;
  amounts.sgst.fee = 250;
  const base = { cpin: CPIN, generated_on: '2025-06-18', amounts, period_key: '2025-05' };
  assert.match(validateGstChallan({ ...base, cpin: '123' }).join(' '), /14 digits/);
  assert.match(validateGstChallan({ ...base, amounts: emptyAmounts() }).join(' '), /at least one amount/);
  assert.match(validateGstChallan({ ...base, deposited_on: '2025-06-19' }).join(' '), /CIN/);

  const unpaid = saveGstChallan(base);
  assert.equal(unpaid.voucher_id, undefined);
  assert.equal(loadVouchers().length, 0);
  assert.equal(challanTotal(unpaid), 1201.73);

  const paid = saveGstChallan({ ...base, id: unpaid.id, deposited_on: '2025-06-19', cin: `${CPIN}HDFC` });
  const v = loadVouchers().find((x) => x.id === paid.voucher_id)!;
  assert.equal(v.type, 'PAYMENT');
  assert.equal(v.voucher_class, CHALLAN_VOUCHER_CLASS);
  assert.deepEqual(v.lines.map((l) => [l.account_id, l.dr, l.cr]), [[A.gstCash, 120173, 0], [A.bank, 0, 120173]]);
  assert.throws(() => saveGstChallan({ ...base }), /already recorded/);

  // Balance before / after a set-off that uses it.
  assert.deepEqual(cashLedgerBalance(loadGstChallans(), []), { igst: 600, cgst: 351.73, sgst: 250, cess: 0 });
  const g3 = report3b({ igst: 1000, cgst: 500, sgst: 500 }, { igst: 300, cgst: 200, sgst: 600 }, { igst: 0, cgst: 50, sgst: 50 });
  const plan = planSetOff(g3, { period: MAY, due: '2025-06-20' });
  const status = periodPaymentStatus(plan, loadGstChallans(), []);
  assert.equal(status.deposited, 1201.73);
  assert.equal(status.shortfall.cgst, 0); // 350 needed, 351.73 there
  assert.equal(status.shortfall.sgst, 0); // 50 needed, 250 there
  const rec = postSetOff(plan, { date: '2025-06-20' });
  assert.deepEqual(cashLedgerBalance(loadGstChallans(), loadSetOffs()), { igst: 0, cgst: 1.73, sgst: 200, cess: 0 });
  // A new challan for the plan only asks for what the head's balance does not cover.
  const next = challanFromPlan(plan, { igst: 100, cgst: 0, sgst: 0, cess: 0 });
  assert.equal(next.igst.tax, 500);
  assert.equal(next.cgst.tax, 350);

  // Clearing the deposit removes the voucher; delete removes the challan.
  const back = saveGstChallan({ ...base, id: paid.id, deposited_on: '' , cin: '' });
  assert.equal(back.voucher_id, undefined);
  assert.equal(loadVouchers().filter((x) => x.type === 'PAYMENT').length, 0);
  deleteGstChallan(paid.id);
  assert.equal(loadGstChallans().length, 0);
  deleteSetOff(rec.id);
});

test('challan warnings: CPIN expired, CIN not built on the CPIN', () => {
  assert.deepEqual(challanWarnings({ cpin: CPIN, cin: `${CPIN}SBIN`, generated_on: '2025-06-01', deposited_on: '2025-06-10' }), []);
  assert.deepEqual(challanWarnings({ cpin: CPIN, cin: 'X'.repeat(18), generated_on: '2025-06-01', deposited_on: '2025-06-20' }), ['CPIN_EXPIRED', 'CIN_CPIN_MISMATCH']);
});

test('cess on purchase bills: read, claimed in 3B 4A and set off against output cess only', () => {
  const bill = {
    id: 'b1', kind: 'PURCHASE', vendor_name: 'Tobacco Co', vendor_gstin: '27AAPFU0939F1ZV', bill_number: 'T-1', date: '2025-05-10',
    category: 'Stock', lines: [], taxable: 1000, cgst: 140, sgst: 140, igst: 0, cess_amount: 120, itc_eligible: true, total: 1400, amount_paid: 0,
  };
  const core = readPurchase(bill)!;
  assert.equal(core.cess, 120);
  assert.equal(core.tax, 280, 'cess stays outside the GST total');
  const inv = {
    id: 'i1', invoice_number: 'INV/FY25-26/0001', doc_type: 'INVOICE', issue_date: '2025-05-20', due_date: '2025-05-20', status: 'Sent', currency: 'INR',
    sender: { companyName: 'Seller', companyGstin: '27AAPFU0939F1ZV', stateCode: '27' },
    client: { name: 'Buyer', gstin: '27AABCU9603R1ZM', state_code: '27' }, place_of_supply: '27', gst_mode: 'CGST_SGST',
    items: [{ id: 'l1', name: 'Pan masala', hsn: '2106', quantity: 1, rate: 2000, tax_rate: 28, cess_rate: 10 }],
  };
  const r = buildGstReport([inv as never], [bill], { period: MAY, gstin: '27AAPFU0939F1ZV' });
  assert.equal(r.gstr3b.itc.availableOther.cess, 120);
  assert.equal(r.gstr3b.itc.net.cess, 120);
  // Output cess 10% of 2000 = 200; cess credit 120 → 80 in cash.
  assert.equal(r.gstr3b.payment.cessLiability, 200);
  assert.equal(r.gstr3b.payment.cessItcUsed, 120);
  assert.equal(r.gstr3b.payment.cess, 80);
  const plan = planSetOff(r.gstr3b, { period: MAY, due: '2025-06-20' });
  assert.equal(plan.itcUsed.cess, 120);
  assert.equal(plan.cashTax.cess, 80);
  const lines = setOffVoucherLines(plan);
  assert.equal(lines.find((l) => l.account_id === A.inCess)?.cr, 12000);
});
