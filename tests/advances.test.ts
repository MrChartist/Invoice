/**
 * Advances / receipt vouchers / GSTR-1 Table 11 (roadmap 5.3).
 * Hand-computed: ₹11,800 received for services @ 18% = ₹10,000 + ₹1,800 GST (CGST 900 + SGST 900).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  ADJUST_METHOD,
  advanceRows,
  advanceVoucherHtml,
  advancesCsv,
  applyAdvance,
  deleteAdvance,
  deleteRefund,
  loadAdvances,
  nextAdvanceNumber,
  openAdvancesFor,
  refundAdvance,
  refundVoucherHtml,
  saveAdvance,
  type AdvanceInput,
} from '../src/lib/advances.ts';
import { advanceBalance, advanceMovements, advanceTaxEvents, computeAdvanceTax } from '../src/lib/advance-tax.ts';
import { advanceTaxable } from '../src/lib/tax-rules.ts';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { buildGstr1Json, gstr3bRows, sectionCsv } from '../src/lib/gstr-json.ts';
import { localDb } from '../src/lib/localDb.ts';
import { KEYS, SINGLETON_KEYS, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';
import { isAccessDeniedError, setActorProvider } from '../src/lib/access.ts';
import { loadBooksData, buildVouchers } from '../src/lib/books.ts';
import { A, buildLedger, closingBalances, loadLedgerInput, trialBalance, voucherDiff } from '../src/lib/ledger/index.ts';
import { buildReceivables, buildLedger as partyLedger } from '../src/lib/receivables.ts';
import { receiptNumber } from '../src/lib/receipts.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { buildBackup, parseBackup } from '../src/lib/backup.ts';
import { buildGstr9 } from '../src/lib/gstr9.ts';
import type { AdvanceRecord } from '../src/types/advances.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

const SENDER_GSTIN = '27AAPFU0939F1ZV'; // Maharashtra
const CLIENT = { id: 'c1', name: 'Beta Services', gstin: '27CCCCC2222C1Z8' };
const TODAY = '2026-03-31';

function setup(lock = ''): void {
  setJson(SINGLETON_KEYS.settings, {
    profiles: [{ id: 'p1', companyName: 'Mr Chartist', companyGstin: SENDER_GSTIN, stateCode: '27', companyAddress: 'Mumbai <HQ>' }],
    activeProfileId: 'p1',
    onboarded: true,
    ...(lock ? { lock_until: lock } : {}),
  });
}

beforeEach(() => {
  resetStorage();
  setup();
});

const adv = (over: Partial<AdvanceInput> = {}): AdvanceInput => ({
  date: '2025-05-10', client: { ...CLIENT }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 11800,
  method: 'Bank transfer', reference: 'UTR123', description: 'Retainer for audit', ...over,
});

function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'I1', invoice_number: 'INV/FY25-26/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: '2025-06-05', due_date: '2025-06-20',
    currency: 'INR', client: { ...CLIENT } as InvoiceRecord['client'], sender: { companyName: 'Mr Chartist', companyGstin: SENDER_GSTIN, stateCode: '27' },
    place_of_supply: '27', gst_mode: 'CGST_SGST',
    items: [{ id: 'l1', name: 'Audit fee', type: 'Service', hsn: '998221', quantity: 1, rate: 20000, tax_rate: 18, amount: 20000 }],
    discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: false,
    subtotal: 20000, discount_amount: 0, taxable_value: 20000, cgst_amount: 1800, sgst_amount: 1800, igst_amount: 0, tax_amount: 3600,
    round_off: 0, total: 23600, amount_paid: 0, balance_due: 23600,
    ...over,
  } as InvoiceRecord;
}

const month = (fyStart: number, m: number): ReportPeriod => ({ kind: 'month', fyStart, month: m });

function gst(period: ReportPeriod) {
  const invoices = localDb.invoices.getAll();
  const events = advanceTaxEvents(loadAdvances(), localDb.payments.getAll(), invoices);
  return buildGstReport(invoices, [], { period, gstin: SENDER_GSTIN, advances: events });
}

/* ── Numbering ─────────────────────────────────────────────── */

test('ADV numbering follows the Indian FY: 31 Mar stays in FY25-26, 1 Apr starts FY26-27 at 0001', () => {
  assert.equal(nextAdvanceNumber('2025-04-01', []), 'ADV/FY25-26/0001');
  const a1 = saveAdvance(adv({ date: '2025-04-01' }), { today: TODAY });
  const a2 = saveAdvance(adv({ date: '2026-03-31' }), { today: TODAY });
  assert.equal(a1.number, 'ADV/FY25-26/0001');
  assert.equal(a2.number, 'ADV/FY25-26/0002');
  const a3 = saveAdvance(adv({ date: '2026-04-01' }), { today: '2026-04-01' });
  assert.equal(a3.number, 'ADV/FY26-27/0001');
  // Deleting the highest never hands its number out again.
  deleteAdvance(a2.id);
  // Integrity review: the series high-water mark keeps a deleted LATEST number from coming back.
  assert.equal(nextAdvanceNumber('2026-01-10'), 'ADV/FY25-26/0003', 'above the high-water mark');
  const a4 = saveAdvance(adv({ date: '2025-08-01' }), { today: TODAY });
  assert.equal(a4.number, 'ADV/FY25-26/0003');
});

test('validation refuses a future date, no client, zero amount, bad POS or GSTIN', () => {
  assert.throws(() => saveAdvance(adv({ date: '2027-01-01' }), { today: TODAY }), /future/);
  assert.throws(() => saveAdvance(adv({ client: { name: ' ' } }), { today: TODAY }), /who paid/);
  assert.throws(() => saveAdvance(adv({ amount: 0 }), { today: TODAY }), /above zero/);
  assert.throws(() => saveAdvance(adv({ place_of_supply: '00' }), { today: TODAY }), /place of supply/);
  assert.throws(() => saveAdvance(adv({ client: { name: 'X', gstin: '27ABC' } }), { today: TODAY }), /GSTIN/);
});

/* ── GST on the advance ────────────────────────────────────── */

test('goods vs services by date: goods advances taxed only before 15 Nov 2017 (Notification 66/2017-CT)', () => {
  assert.equal(advanceTaxable('services', '2025-05-10'), true);
  assert.equal(advanceTaxable('goods', '2017-10-01'), true);
  assert.equal(advanceTaxable('goods', '2017-11-14'), true);
  assert.equal(advanceTaxable('goods', '2017-11-15'), false);
  assert.equal(advanceTaxable('goods', '2025-05-10'), false);
  const goods = saveAdvance(adv({ supply: 'goods' }), { today: TODAY });
  assert.equal(goods.tax.applies, false);
  assert.equal(goods.tax.taxable, 11800);
  const old = computeAdvanceTax({ amount: 11800, rate: 18, supply: 'goods', date: '2017-10-01', pos: '27', senderState: '27' });
  assert.equal(old.applies, true);
  assert.equal(old.cgst, 900);
});

test('inclusive split: CGST/SGST intra-state, IGST inter-state, none for export or rate 0', () => {
  assert.deepEqual(computeAdvanceTax({ amount: 11800, rate: 18, supply: 'services', date: '2025-05-10', pos: '27', senderState: '27' }),
    { applies: true, supply_type: 'INTRA', taxable: 10000, igst: 0, cgst: 900, sgst: 900 });
  assert.deepEqual(computeAdvanceTax({ amount: 11800, rate: 18, supply: 'services', date: '2025-05-10', pos: '29', senderState: '27' }),
    { applies: true, supply_type: 'INTER', taxable: 10000, igst: 1800, cgst: 0, sgst: 0 });
  // 1,000 @ 18%: tax 152.54 (1000 × 18 / 118), halves 76.27 each.
  const odd = computeAdvanceTax({ amount: 1000, rate: 18, supply: 'services', date: '2025-05-10', pos: '27', senderState: '27' });
  assert.deepEqual([odd.taxable, odd.cgst, odd.sgst], [847.46, 76.27, 76.27]);
  assert.equal(computeAdvanceTax({ amount: 1000, rate: 18, supply: 'services', date: '2025-05-10', pos: '96', senderState: '27' }).applies, false);
  assert.equal(computeAdvanceTax({ amount: 1000, rate: 0, supply: 'services', date: '2025-05-10', pos: '27', senderState: '27' }).applies, false);
  const saved = saveAdvance(adv({ place_of_supply: '29', client: { name: 'Karnataka Co' } }), { today: TODAY });
  assert.equal(saved.tax.igst, 1800, 'sender state comes from the snapshotted profile');
  assert.equal(saved.sender?.companyGstin, SENDER_GSTIN);
});

/* ── Adjustment ────────────────────────────────────────────── */

test('partial adjustment records a payment through the payments API; the invoice is partly paid', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  const p = applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 5900 }, { today: TODAY });
  assert.equal(p.advance_id, a.id);
  assert.equal(p.method, ADJUST_METHOD);
  assert.equal(p.reference, 'ADV/FY25-26/0001');
  assert.equal(p.date, '2025-06-05', 'defaults to the invoice date (later than the advance)');
  const inv = localDb.invoices.getById('I1')!;
  assert.equal(inv.status, 'Partially Paid');
  assert.equal(inv.amount_paid, 5900);
  assert.equal(inv.balance_due, 17700);
  const bal = advanceBalance(a, localDb.payments.getAll(), localDb.invoices.getAll());
  assert.deepEqual(bal, { amount: 11800, adjusted: 5900, refunded: 0, open: 5900, over: 0 });
  assert.equal(openAdvancesFor(CLIENT, loadAdvances(), localDb.payments.getAll(), localDb.invoices.getAll())[0].balance.open, 5900);
  // Over-apply, wrong client, draft invoice, before the advance: refused.
  assert.throws(() => applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 6000 }, { today: TODAY }), /Only ₹5,900\.00/);
  setTable(KEYS.invoices, [...localDb.invoices.getAll(), invoice({ id: 'I2', invoice_number: 'INV/FY25-26/0002', client: { id: 'zz', name: 'Other' } as InvoiceRecord['client'] })]);
  assert.throws(() => applyAdvance({ advanceId: a.id, invoiceId: 'I2', amount: 100 }, { today: TODAY }), /received from Beta Services/);
  setTable(KEYS.invoices, [...localDb.invoices.getAll(), invoice({ id: 'I3', invoice_number: 'INV/FY25-26/0003', status: 'Draft' })]);
  assert.throws(() => applyAdvance({ advanceId: a.id, invoiceId: 'I3', amount: 100 }, { today: TODAY }), /draft/);
  assert.throws(() => applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 100, date: '2025-05-01' }, { today: TODAY }), /before it was received/);
  // An adjusted advance is frozen; removing the adjustment payment frees it again.
  assert.throws(() => saveAdvance({ ...adv(), id: a.id, amount: 20000 }, { today: TODAY }), /adjusted or refunded/);
  assert.throws(() => deleteAdvance(a.id), /adjusted or refunded/);
  localDb.payments.remove(p.id);
  assert.equal(advanceBalance(a, localDb.payments.getAll(), localDb.invoices.getAll()).open, 11800);
  assert.equal(localDb.invoices.getById('I1')!.balance_due, 23600);
  // Audit trail: the advance and the payment are both logged.
  const log = getTable<{ entity: string; summary: string }>('audit_log');
  assert.ok(log.some((r) => r.entity === 'advance' && /5,900\.00 adjusted against INV\/FY25-26\/0001/.test(r.summary)));
  assert.ok(log.some((r) => r.entity === 'payment'));
});

test('cancelling the invoice gives the advance back', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 11800 }, { today: TODAY });
  assert.equal(advanceBalance(a, localDb.payments.getAll(), localDb.invoices.getAll()).open, 0);
  localDb.invoices.setStatus('I1', 'Cancelled');
  assert.equal(advanceBalance(a, localDb.payments.getAll(), localDb.invoices.getAll()).open, 11800);
});

test('tax released by adjustments follows the running total; the last one takes the remainder', () => {
  const a = saveAdvance(adv({ amount: 1000 }), { today: TODAY }); // CGST 76.27 + SGST 76.27
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 333.33, date: '2025-06-05' }, { today: TODAY });
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 666.67, date: '2025-06-06' }, { today: TODAY });
  const moves = advanceMovements(loadAdvances(), localDb.payments.getAll(), localDb.invoices.getAll()).filter((m) => m.kind === 'adjusted');
  assert.deepEqual(moves.map((m) => [m.cgst, m.sgst]), [[25.42, 25.42], [50.85, 50.85]]);
  assert.equal(Math.round((moves[0].cgst + moves[1].cgst) * 100) / 100, 76.27);
  assert.equal(Math.round((moves[0].taxable + moves[1].taxable) * 100) / 100, 847.46);
});

/* ── Refund (Rule 51) ──────────────────────────────────────── */

test('refund of the unadjusted balance: RFV series, voucher, reported with adjustments', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 5900 }, { today: TODAY });
  assert.throws(() => refundAdvance(a.id, { amount: 6000, date: '2025-07-01', method: 'Bank transfer' }, { today: TODAY }), /Only ₹5,900\.00/);
  const r = refundAdvance(a.id, { amount: 5900, date: '2025-07-01', method: 'Bank transfer', reference: 'UTR9' }, { today: TODAY });
  assert.equal(r.number, 'RFV/FY25-26/0001');
  assert.equal(advanceBalance(loadAdvances()[0], localDb.payments.getAll(), localDb.invoices.getAll()).open, 0);
  const july = gst(month(2025, 7)).gstr1;
  assert.deepEqual(july.txpd?.map((x) => [x.taxable, x.cgst, x.sgst]), [[5000, 450, 450]]);
  const html = refundVoucherHtml(loadAdvances()[0], r, { igst: 0, cgst: 450, sgst: 450 });
  assert.match(html, /Refund voucher/);
  assert.match(html, /ADV\/FY25-26\/0001 dated/);
  deleteRefund(a.id, r.id);
  assert.equal(advanceBalance(loadAdvances()[0], localDb.payments.getAll(), localDb.invoices.getAll()).open, 5900);
});

/* ── GSTR-1 Table 11, JSON, CSV, GSTR-3B ───────────────────── */

test('Table 11A in the month received, 11B in the month adjusted; JSON at / txpd; 3B 3.1(a) moves with them', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  saveAdvance(adv({ date: '2025-05-20', place_of_supply: '29', client: { name: 'Karnataka Co' }, amount: 5900, tax_rate: 18 }), { today: TODAY });
  saveAdvance(adv({ date: '2025-05-21', supply: 'goods', amount: 50000 }), { today: TODAY }); // no GST on goods advances
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 5900 }, { today: TODAY });

  const may = gst(month(2025, 5));
  assert.deepEqual(may.gstr1.at, [
    { pos: '27', supply: 'INTRA', rate: 18, gross: 11800, taxable: 10000, igst: 0, cgst: 900, sgst: 900, cess: 0, count: 1 },
    { pos: '29', supply: 'INTER', rate: 18, gross: 5900, taxable: 5000, igst: 900, cgst: 0, sgst: 0, cess: 0, count: 1 },
  ]);
  assert.equal(may.gstr1.txpd, undefined);
  // 3B May: no invoices, only the advances' tax.
  assert.deepEqual(may.gstr3b.outward.taxable, { taxable: 15000, igst: 900, cgst: 900, sgst: 900, cess: 0 });
  assert.deepEqual(may.gstr3b.payment.liability, { igst: 900, cgst: 900, sgst: 900 });

  const json = buildGstr1Json(may.gstr1) as Record<string, unknown>;
  assert.deepEqual(json.at, [
    { pos: '27', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 10000, camt: 900, samt: 900, csamt: 0 }] },
    { pos: '29', sply_ty: 'INTER', itms: [{ rt: 18, ad_amt: 5000, iamt: 900, csamt: 0 }] },
  ]);
  assert.equal(json.txpd, undefined);
  assert.match(sectionCsv(may.gstr1, 'at'), /^Place of supply,Supply type,Rate %/);
  assert.match(sectionCsv(may.gstr1, 'at'), /27,INTRA,18,11800,10000,0,900,900,0/);

  const june = gst(month(2025, 6));
  assert.equal(june.gstr1.at, undefined);
  assert.deepEqual(june.gstr1.txpd, [{ pos: '27', supply: 'INTRA', rate: 18, gross: 5900, taxable: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0, count: 1 }]);
  assert.deepEqual((buildGstr1Json(june.gstr1) as Record<string, unknown>).txpd, [
    { pos: '27', sply_ty: 'INTRA', itms: [{ rt: 18, ad_amt: 5000, camt: 450, samt: 450, csamt: 0 }] },
  ]);
  // 3B June: invoice 20,000 + 1,800 + 1,800, less the adjusted advance 5,000 + 450 + 450.
  assert.deepEqual(june.gstr3b.outward.taxable, { taxable: 15000, igst: 0, cgst: 1350, sgst: 1350, cess: 0 });
  assert.deepEqual(june.gstr3b.advances?.adjusted, { taxable: 5000, igst: 0, cgst: 450, sgst: 450, cess: 0 });
  assert.ok(gstr3bRows(june.gstr3b).some((r) => /Table 11B/.test(String(r[1]))));
  // Another filer GSTIN sees none of it.
  const other = buildGstReport(localDb.invoices.getAll(), [], {
    period: month(2025, 5), gstin: '29BBBBB1111B1ZJ',
    advances: advanceTaxEvents(loadAdvances(), localDb.payments.getAll(), localDb.invoices.getAll()),
  });
  assert.equal(other.gstr1.at, undefined);
  // GSTR-9 4F: the year's net (received 15,000 taxable − adjusted 5,000).
  const g9 = buildGstr9(localDb.invoices.getAll(), [], {
    fyStart: 2025, gstin: SENDER_GSTIN, advances: advanceTaxEvents(loadAdvances(), localDb.payments.getAll(), localDb.invoices.getAll()),
  });
  const f = g9.table4.find((r) => r.id === '4F')!;
  assert.equal(f.taxable, 10000);
  assert.equal(f.cgst, 450);
  assert.equal(f.igst, 900);
});

/* ── Ledger ────────────────────────────────────────────────── */

test('ledger: receipt, GST on advance, adjustment and refund post balanced; trial balance agrees', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 5900 }, { today: TODAY });
  const led = buildLedger(loadLedgerInput(loadBooksData(), TODAY));
  assert.deepEqual(led.warnings, []);
  for (const v of led.vouchers) assert.equal(voucherDiff(v), 0, `${v.id} balances`);
  const receipt = led.vouchers.find((v) => v.id === `adv:${a.id}`)!;
  assert.equal(receipt.kind, 'Receipt');
  const adj = led.vouchers.find((v) => v.id.startsWith('advadj:'))!;
  assert.equal(adj.kind, 'Journal');
  assert.ok(!led.vouchers.some((v) => v.id.startsWith('rcpt:')), 'an adjustment is not a cash receipt');

  const bal = closingBalances(led, '2025-06-30');
  const rupees = (id: string) => (bal.get(id) ?? 0) / 100;
  assert.equal(rupees(A.bank), 11800);
  assert.equal(rupees(A.custAdvances), -5900, 'half the advance still owed to the customer (credit)');
  assert.equal(rupees(A.gstOnAdvances), 900, 'GST paid on the unadjusted half (CGST 450 + SGST 450)');
  assert.equal(rupees(A.outCgst), -2250, '900 on the advance + 1,800 on the invoice − 450 released');
  assert.equal(rupees(A.debtors), 17700);
  const tb = trialBalance(led, { start: '2025-04-01', end: '2026-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);

  // Refund the rest: the advance and its GST both go to zero.
  refundAdvance(a.id, { amount: 5900, date: '2025-07-01', method: 'Cash' }, { today: TODAY });
  const led2 = buildLedger(loadLedgerInput(loadBooksData(), TODAY));
  const b2 = closingBalances(led2, '2025-07-31');
  assert.equal(b2.get(A.custAdvances) ?? 0, 0);
  assert.equal(b2.get(A.gstOnAdvances) ?? 0, 0);
  assert.equal((b2.get(A.cash) ?? 0) / 100, -5900);
  assert.equal((b2.get(A.outCgst) ?? 0) / 100, -1800, 'only the invoice GST is left');

  // Books cash book: the advance is cash in, the adjustment is not, the refund is cash out.
  const books = buildVouchers(loadBooksData());
  assert.ok(books.some((v) => v.id === `adv:${a.id}` && v.credit === 11800 && v.account === 'bank'));
  assert.ok(books.some((v) => v.id.startsWith('advrf:') && v.debit === 5900 && v.account === 'cash'));
  assert.ok(!books.some((v) => v.id.startsWith('rcpt:')));
});

/* ── Receivables ───────────────────────────────────────────── */

test('client ledger shows the advance as a credit, the adjustment as information, unadjusted advance in credits', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 5900 }, { today: TODAY });
  const rep = buildReceivables({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: [], advances: loadAdvances() }, { now: new Date(2025, 5, 30) });
  const p = rep.parties.find((x) => x.key === 'c1')!;
  assert.equal(p.gross, 17700, 'the bill is reduced by the adjustment');
  assert.equal(p.advances, 5900, 'unadjusted half of the advance');
  assert.equal(p.net, 11800);
  const led = partyLedger(p);
  assert.equal(led.closing, p.net, 'ledger closing = net');
  assert.ok(led.entries.some((e) => e.ref === 'ADV/FY25-26/0001' && e.credit === 11800));
  assert.ok(led.entries.some((e) => /adjusted against INV\/FY25-26\/0001/.test(e.particulars) && e.credit === 0 && e.debit === 0));
  // Receipt numbers skip the adjustment row.
  const rows = localDb.payments.getAll();
  const real: Payment = { id: 'zz', invoice_id: 'I1', amount: 100, method: 'UPI', date: '2025-06-10' };
  assert.equal(receiptNumber(real, [...rows, real]), 'RCPT/FY25-26/0001');
});

/* ── Period lock ───────────────────────────────────────────── */

test('period lock: no new, edited or deleted advance, adjustment or refund inside the locked period', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice({ issue_date: '2025-07-05' })]);
  setup('2025-06-30');
  assert.throws(() => saveAdvance(adv({ date: '2025-06-01' }), { today: TODAY }), isPeriodLockedError);
  assert.throws(() => saveAdvance({ ...adv(), id: a.id, amount: 100 }, { today: TODAY }), isPeriodLockedError);
  assert.throws(() => deleteAdvance(a.id), isPeriodLockedError);
  assert.throws(() => refundAdvance(a.id, { amount: 100, date: '2025-06-15', method: 'Cash' }, { today: TODAY }), isPeriodLockedError);
  // The open period still works: adjust on the July invoice, refund in July.
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 100 }, { today: TODAY });
  refundAdvance(a.id, { amount: 100, date: '2025-07-15', method: 'Cash' }, { today: TODAY });
  assert.equal(advanceBalance(loadAdvances()[0], localDb.payments.getAll(), localDb.invoices.getAll()).open, 11600);
  // A locked invoice refuses the adjustment (payments API, 'pay').
  setTable(KEYS.invoices, [...localDb.invoices.getAll(), invoice({ id: 'I9', invoice_number: 'INV/FY25-26/0009', issue_date: '2025-06-05' })]);
  assert.throws(() => applyAdvance({ advanceId: a.id, invoiceId: 'I9', amount: 100, date: '2025-07-20' }, { today: TODAY }), isPeriodLockedError);
});

/* ── Voucher, CSV, Tally, backup ───────────────────────────── */

test('receipt voucher (Rule 50) escapes every value and has no script', () => {
  const a = saveAdvance(adv({ client: { name: 'Evil <script>alert(1)</script> & Co' }, description: '"quoted" <b>' }), { today: TODAY });
  const html = advanceVoucherHtml(a);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /Evil &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; Co/);
  assert.match(html, /Mumbai &lt;HQ&gt;/);
  assert.match(html, /27 — Maharashtra/);
  assert.match(html, /CGST @ 9%/);
  assert.match(html, /Rule 50/);
  const csv = advancesCsv(advanceRows(loadAdvances(), [], []));
  assert.match(csv, /ADV\/FY25-26\/0001,2025-05-10/);
  assert.match(csv, /Verify with your CA/);
});

test('Tally: the advance is a Receipt with an "Advance" bill; the adjustment sends no voucher; a refund is a Payment', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 5900 }, { today: TODAY });
  refundAdvance(a.id, { amount: 5900, date: '2025-07-01', method: 'Bank transfer' }, { today: TODAY });
  const build = buildTallyModel({
    invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: [], items: [], purchases: [], vendors: [], advances: loadAdvances(),
  }, { companyName: 'Mr Chartist' });
  const receipts = build.vouchers.filter((v) => v.type === 'Receipt');
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0].entries.find((e) => e.bill)?.bill, { name: 'ADV/FY25-26/0001', type: 'Advance' });
  const pay = build.vouchers.find((v) => v.type === 'Payment')!;
  assert.equal(pay.number, 'RFV/FY25-26/0001');
  assert.deepEqual(pay.entries.find((e) => e.bill)?.bill, { name: 'ADV/FY25-26/0001', type: 'Agst Ref' });
  for (const v of build.vouchers) assert.equal(v.entries.reduce((s, e) => s + (e.side === 'Cr' ? e.paise : -e.paise), 0), 0);
});

test('backup round-trip keeps the advances table and refuses a damaged one', () => {
  saveAdvance(adv(), { today: TODAY });
  const file = buildBackup(new Date(2026, 2, 31));
  const { data } = parseBackup(JSON.stringify(file));
  const rows = JSON.parse(data.mrchartist_inv_advances) as AdvanceRecord[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].number, 'ADV/FY25-26/0001');
  const broken = { ...file, data: { ...file.data, mrchartist_inv_advances: JSON.stringify([{ number: 'x' }]) } };
  assert.throws(() => parseBackup(JSON.stringify(broken)), /advances/);
});

test('local roles: a viewer cannot record, apply, refund or delete an advance', () => {
  const a = saveAdvance(adv(), { today: TODAY });
  setTable(KEYS.invoices, [invoice()]);
  setActorProvider(() => ({ id: 'u2', name: 'Viewer', role: 'viewer' }));
  try {
    assert.throws(() => saveAdvance(adv(), { today: TODAY }), isAccessDeniedError);
    assert.throws(() => applyAdvance({ advanceId: a.id, invoiceId: 'I1', amount: 100 }, { today: TODAY }), isAccessDeniedError);
    assert.throws(() => refundAdvance(a.id, { amount: 100, date: '2025-07-01', method: 'Cash' }, { today: TODAY }), isAccessDeniedError);
    assert.throws(() => deleteAdvance(a.id), isAccessDeniedError);
  } finally {
    setActorProvider(null);
  }
  assert.equal(loadAdvances().length, 1);
});
