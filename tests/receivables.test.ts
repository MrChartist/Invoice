import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGING_BUCKETS,
  agingCsv,
  buildLedger,
  buildReceivables,
  buildStatementText,
  closingInWords,
  compactMoney,
  niceMax,
  computeDso,
  csvCell,
  currenciesIn,
  dateKey,
  debtorShare,
  monthlyCollections,
  overallEfficiency,
  statementCsv,
  topDebtors,
  type ReceiptRow,
} from '../src/lib/receivables.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

/* Fixed "today": 7 Oct 2026 (local). */
const NOW = new Date(2026, 9, 7);

function inv(over: Partial<InvoiceRecord> & { id: string }): InvoiceRecord {
  return {
    invoice_number: over.id.toUpperCase(),
    doc_type: 'INVOICE',
    issue_date: '2026-01-01',
    due_date: '2026-01-15',
    status: 'Sent',
    currency: 'INR',
    client: { id: 'a', name: 'Alpha Ltd' },
    total: 0,
    amount_paid: 0,
    balance_due: 0,
    ...over,
  } as InvoiceRecord;
}

function pay(invoice_id: string, amount: number, date: string, extra: Partial<ReceiptRow> = {}): ReceiptRow {
  return { id: `p-${invoice_id}-${date}-${amount}`, invoice_id, amount, method: 'UPI', date, ...extra };
}

/*
 * Alpha (id a)
 *   INV1  1 Jun  due 15 Jun  10,000   paid 4,000 on 20 Jun        -> open 6,000 (114 days overdue, 90+)
 *   INV2  1 Sep  due 30 Sep   5,000   unpaid                        -> open 5,000 (7 days, 1–30)
 *   INV3  1 Oct  due 31 Oct   2,000   unpaid                        -> open 2,000 (not due)
 *   CRN1 10 Sep               1,000   credit note
 *   ignored: draft 9,999 / cancelled 8,888 / quotation 7,777
 *   gross 13,000 - CN 1,000 = net 12,000;  debits 17,000 - credits 5,000 = 12,000
 *
 * Beta Co (no id — matched by name)
 *   INV4  1 Aug  due 31 Aug   3,000   status Paid, amount_paid 3,000, NO payment row (legacy)
 *   INV5 15 Sep  due 20 Sep   2,000   paid 2,500 on 18 Sep (500 overpaid)
 *   on-account receipt 1,000 on 2 Oct (no invoice)
 *   advances 1,500, net -1,500;  debits 5,000 - credits 6,500 = -1,500
 */
const invoices: InvoiceRecord[] = [
  inv({ id: 'inv1', issue_date: '2026-06-01', due_date: '2026-06-15', total: 10000, amount_paid: 4000, status: 'Partially Paid' }),
  inv({ id: 'inv2', issue_date: '2026-09-01', due_date: '2026-09-30', total: 5000 }),
  inv({ id: 'inv3', issue_date: '2026-10-01', due_date: '2026-10-31', total: 2000 }),
  inv({ id: 'crn1', doc_type: 'CREDIT_NOTE', issue_date: '2026-09-10', due_date: '2026-09-10', total: 1000 }),
  inv({ id: 'drf', status: 'Draft', total: 9999, issue_date: '2026-09-02' }),
  inv({ id: 'can', status: 'Cancelled', total: 8888, issue_date: '2026-09-02' }),
  inv({ id: 'qtn', doc_type: 'QUOTATION', total: 7777, issue_date: '2026-09-02' }),
  inv({
    id: 'inv4', client: { name: 'Beta Co' }, issue_date: '2026-08-01', due_date: '2026-08-31',
    total: 3000, amount_paid: 3000, status: 'Paid', updated_at: '2026-08-20T10:00:00',
  }),
  inv({ id: 'inv5', client: { name: 'beta co' }, issue_date: '2026-09-15', due_date: '2026-09-20', total: 2000, amount_paid: 2500, status: 'Paid' }),
];
const payments: ReceiptRow[] = [
  pay('inv1', 4000, '2026-06-20'),
  pay('inv5', 2500, '2026-09-18'),
  pay('', 1000, '2026-10-02', { client_name: 'Beta Co', note: 'advance' }),
  pay('drf', 500, '2026-09-03'), // payment on a draft is ignored
  pay('ghost', 500, '2026-09-03'), // unknown invoice is ignored
];

const report = buildReceivables({ invoices, payments, clients: [] }, { now: NOW });
const alpha = report.parties.find((p) => p.name === 'Alpha Ltd')!;
const beta = report.parties.find((p) => p.name === 'Beta Co')!;

test('only live invoices and credit notes reach the ledger; parties merge by name', () => {
  assert.equal(report.parties.length, 2);
  assert.equal(beta.entries.filter((e) => e.kind === 'invoice').length, 2);
});

test('bill-wise outstanding, days overdue and buckets', () => {
  assert.deepEqual(alpha.bills.map((b) => [b.number, b.outstanding, b.daysOverdue, b.bucket]), [
    ['INV1', 6000, 114, '90+ days'],
    ['INV2', 5000, 7, '1–30 days'],
    ['INV3', 2000, 0, 'Not due'],
  ]);
  assert.equal(alpha.gross, 13000);
  assert.equal(alpha.creditNotes, 1000);
  assert.equal(alpha.net, 12000);
  assert.equal(alpha.oldestOverdueDays, 114);
  assert.equal(alpha.buckets['90+ days'], 6000);
  assert.equal(alpha.buckets['31–60 days'], 0);
});

test('legacy Paid invoices settle, overpayment and on-account receipts become advances', () => {
  assert.equal(beta.bills.length, 0);
  assert.equal(beta.advances, 1500);
  assert.equal(beta.net, -1500);
  const derived = beta.entries.find((e) => e.derived)!;
  assert.equal(derived.credit, 3000);
  assert.equal(derived.date, '2026-08-20');
});

test('totals across parties', () => {
  const t = report.totals;
  assert.equal(t.gross, 13000);
  assert.equal(t.creditNotes, 1000);
  assert.equal(t.advances, 1500);
  assert.equal(t.net, 10500);
  assert.equal(t.overdue, 11000);
  assert.equal(t.billCount, 3);
  assert.deepEqual(AGING_BUCKETS.map((b) => t.buckets[b]), [2000, 5000, 0, 0, 6000]);
});

test('party net equals ledger closing balance (reconciles)', () => {
  for (const p of report.parties) {
    const l = buildLedger(p);
    assert.equal(l.closing, p.net, p.name);
    assert.equal(p.entries.at(-1)?.balance, p.net);
  }
});

test('ledger: opening balance rolls up earlier entries', () => {
  const l = buildLedger(alpha, '2026-09-01', '2026-10-31');
  assert.equal(l.opening, 6000);
  assert.deepEqual(l.entries.map((e) => [e.ref, e.debit, e.credit, e.balance]), [
    ['INV2', 5000, 0, 11000],
    ['CRN1', 0, 1000, 10000],
    ['INV3', 2000, 0, 12000],
  ]);
  assert.equal(l.totalDebit, 7000);
  assert.equal(l.totalCredit, 1000);
  assert.equal(l.closing, 12000);
});

test('ledger: end date cuts off later entries; partial payment shows as credit', () => {
  const l = buildLedger(alpha, '2026-06-10', '2026-09-05');
  assert.equal(l.opening, 10000);
  assert.deepEqual(l.entries.map((e) => [e.date, e.balance]), [
    ['2026-06-20', 6000],
    ['2026-09-01', 11000],
  ]);
  assert.equal(l.closing, 11000);
});

test('ledger: same-day invoice precedes receipt', () => {
  const r = buildReceivables({
    invoices: [inv({ id: 'x', total: 100, issue_date: '2026-05-05', due_date: '2026-05-20' })],
    payments: [pay('x', 100, '2026-05-05')],
  }, { now: NOW });
  assert.deepEqual(r.parties[0].entries.map((e) => e.kind), ['invoice', 'payment']);
  assert.equal(r.parties[0].net, 0);
  assert.equal(r.parties[0].bills.length, 0);
});

test('ranking: top debtors only includes positive balances', () => {
  const top = topDebtors(report);
  assert.deepEqual(top.map((p) => p.name), ['Alpha Ltd']);
  assert.equal(debtorShare(report, alpha), 100);
  assert.equal(report.parties[0].name, 'Alpha Ltd'); // sorted by net desc
});

test('monthly collections and efficiency', () => {
  const rows = monthlyCollections(report, 6, NOW);
  assert.deepEqual(rows.map((r) => r.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  const by = Object.fromEntries(rows.map((r) => [r.month, r]));
  assert.equal(by['2026-05'].efficiency, null);
  assert.equal(by['2026-06'].billed, 10000);
  assert.equal(by['2026-06'].received, 4000);
  assert.equal(by['2026-06'].efficiency, 40);
  assert.equal(by['2026-08'].efficiency, 100);
  // Sep: billed 5,000 + 2,000, credited 1,000, received 2,500 -> 2,500 / 6,000
  assert.equal(by['2026-09'].billed, 7000);
  assert.equal(by['2026-09'].credited, 1000);
  assert.equal(by['2026-09'].efficiency, 41.67);
  // Oct: billed 2,000, received 1,000 advance
  assert.equal(by['2026-10'].efficiency, 50);
  // overall: received 4000+3000+2500+1000 = 10500; net billed 10000+3000+6000+2000 = 21000
  assert.equal(overallEfficiency(rows), 50);
});

test('DSO over 90 days = net receivables / net sales x 90', () => {
  // Window 10 Jul..7 Oct: 3,000 + 5,000 + 2,000 + 2,000 - 1,000 = 11,000; receivables 10,500
  assert.equal(computeDso(report, 90, NOW), 85.9);
  assert.equal(computeDso(buildReceivables({ invoices: [], payments: [] }), 90, NOW), null);
});

test('currency filter keeps currencies apart', () => {
  const mixed = [...invoices, inv({ id: 'usd1', currency: 'USD', total: 50, client: { id: 'u', name: 'US Inc' } })];
  assert.deepEqual(currenciesIn(mixed), ['INR', 'USD']);
  const usd = buildReceivables({ invoices: mixed, payments }, { currency: 'USD', now: NOW });
  assert.equal(usd.totals.net, 50);
  assert.equal(usd.parties.length, 1);
});

test('dateKey handles plain dates, timestamps and junk', () => {
  assert.equal(dateKey('2026-04-01'), '2026-04-01');
  assert.equal(dateKey('2026-04-01T10:00:00'), '2026-04-01');
  assert.equal(dateKey('nope'), '');
  assert.equal(dateKey(undefined), '');
});

test('CSV: escaping and formula-injection guard', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(-5), '-5');
  const csv = statementCsv(buildLedger(alpha, '2026-09-01', '2026-10-31'));
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Date,Voucher,Particulars,Debit,Credit,Balance (Dr+/Cr-)');
  assert.equal(lines[1], '2026-09-01,,Opening balance,,,6000');
  assert.equal(lines.at(-1), '2026-10-31,,Closing balance,,,12000');
  assert.match(agingCsv(report), /^Party,Not due,1–30 days/);
});

test('statement text: amounts, bills and payment details', () => {
  const text = buildStatementText({
    sender: { companyName: 'Mr Chartist', upiId: 'a@upi', bankName: 'ICICI', accountNumber: '123', ifsc: 'ICIC0001' },
    party: alpha,
    ledger: buildLedger(alpha, '2026-09-01', '2026-10-31'),
  });
  assert.match(text, /\*Statement of Account – Mr Chartist\*/);
  assert.match(text, /Opening balance: ₹6,000\.00 Dr/);
  assert.match(text, /\*Closing balance: ₹12,000\.00 Dr\*/);
  assert.match(text, /INV1: ₹6,000\.00 \(114 days overdue\)/);
  assert.match(text, /Amount payable: \*₹12,000\.00\* \(overdue: ₹11,000\.00\)/);
  assert.match(text, /UPI: a@upi/);

  const credit = buildStatementText({ sender: null, party: beta, ledger: buildLedger(beta) });
  assert.match(credit, /Credit balance in your favour: ₹1,500\.00/);
});

test('closing in words', () => {
  assert.equal(closingInWords(12000), 'Rupees Twelve Thousand Only (Dr)');
  assert.equal(closingInWords(-1500), 'Rupees One Thousand Five Hundred Only (Cr)');
  assert.equal(closingInWords(0), 'Nil');
});

test('chart helpers: compact labels and nice axis max', () => {
  assert.equal(compactMoney(1250000), '12.5L');
  assert.equal(compactMoney(32000000), '3.2Cr');
  assert.equal(compactMoney(4500), '4.5K');
  assert.equal(compactMoney(-999), '-999');
  assert.equal(compactMoney(2500000, 'USD'), '2.5M');
  assert.equal(niceMax(0), 1);
  assert.equal(niceMax(7300), 10000);
  assert.equal(niceMax(1800), 2000);
  assert.equal(niceMax(4100), 5000);
});
