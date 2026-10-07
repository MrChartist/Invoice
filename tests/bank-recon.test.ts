import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  applySuggestions,
  bankDb,
  bestSuggestions,
  brsCsv,
  buildBrs,
  closingAcross,
  confirmableAll,
  detectColumns,
  documentNumberHit,
  extractReferences,
  guessCounterparty,
  ignoreLine,
  inferMode,
  lineState,
  makeStatement,
  matchLine,
  nameOverlap,
  parseBankAmount,
  parseBankDate,
  parseBankStatement,
  payoutCandidates,
  receiptCandidates,
  referenceFor,
  splitDuplicates,
  suggestInvoices,
  suggestMatches,
  summarizeRecon,
  unmatchLine,
  type BankLine,
  type Candidate,
} from '../src/lib/bank-recon.ts';
import { toCsv } from '../src/lib/csv.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { recordBillPaymentFromLine, recordExpenseFromLine, recordReceiptFromLine } from '../src/components/bank/actions.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

/* ── fixtures ─────────────────────────────────────────────────── */

let seq = 0;
const line = (over: Partial<BankLine>): BankLine => ({
  id: `L${++seq}`,
  date: '2026-04-10',
  narration: '',
  ref: '',
  debit: 0,
  credit: 0,
  ...over,
});
const cand = (over: Partial<Candidate>): Candidate => ({
  kind: 'payment',
  id: `C${++seq}`,
  date: '2026-04-10',
  amount: 1000,
  method: 'UPI',
  reference: '',
  docNumber: '',
  party: '',
  docId: 'inv1',
  ...over,
});
const best = (ls: BankLine[], cs: Candidate[]) => bestSuggestions(suggestMatches(ls, cs));

/* ── dates & amounts ──────────────────────────────────────────── */

test('parseBankDate: every common Indian format, day-first', () => {
  const cases: [string, string][] = [
    ['01/04/26', '2026-04-01'],
    ['01/04/2026', '2026-04-01'],
    ['1-4-26', '2026-04-01'],
    ['01-04-2026', '2026-04-01'],
    ['01-Apr-2026', '2026-04-01'],
    ['01-APR-26', '2026-04-01'],
    ['1 April 2026', '2026-04-01'],
    ['01 Apr 26', '2026-04-01'],
    ['2026-04-01', '2026-04-01'],
    ['2026/04/01', '2026-04-01'],
    ['Apr 01, 2026', '2026-04-01'],
    ['31/03/26', '2026-03-31'],
    ['01/04/2026 10:22:33', '2026-04-01'],
    ['01-Apr-2026 10:22 PM', '2026-04-01'],
    ['29/02/2028', '2028-02-29'],
    ['12/01/98', '1998-01-12'],
  ];
  for (const [raw, iso] of cases) assert.equal(parseBankDate(raw), iso, raw);
  for (const bad of ['', 'Opening Balance', '31/02/2026', '32/01/2026', '13/13/2026', 'Page 1 of 3', '12345']) {
    assert.equal(parseBankDate(bad), '', bad);
  }
});

test('parseBankAmount: Indian grouping, Dr/Cr, brackets, symbols', () => {
  const v = (s: string) => parseBankAmount(s)?.value;
  assert.equal(v('1,23,456.78'), 123456.78);
  assert.equal(v('₹ 5,000.00'), 5000);
  assert.equal(v('Rs. 99'), 99);
  assert.equal(v('(250.00)'), -250);
  assert.equal(v('-1,000'), -1000);
  assert.equal(v('1000-'), -1000);
  assert.equal(v('12,50,000.00 Dr'), 1250000);
  assert.equal(parseBankAmount('12,50,000.00 Dr')?.side, 'Dr');
  assert.equal(parseBankAmount('500.00CR')?.side, 'Cr');
  assert.equal(parseBankAmount('Cr 500')?.side, 'Cr');
  assert.equal(v('0.00'), 0);
  for (const bad of ['', '-', 'NIL', 'abc', '1.2.3', '12,34,5x']) assert.equal(parseBankAmount(bad), null, bad);
});

/* ── CSV layouts ──────────────────────────────────────────────── */

const HDFC = [
  'HDFC BANK LTD,,,,,,',
  'Account Branch :MUMBAI FORT,,,,,,',
  'Statement From : 01/04/2026 To: 30/04/2026,,,,,,',
  ',,,,,,',
  'Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance',
  '********,********,********,********,********,********,********',
  '01/04/26,UPI-BHARAT TRADERS-bharat@okhdfc-HDFC0000123-412345678901-INV 0001,0000412345678901,01/04/26,,"11,800.00","1,11,800.00"',
  '03/04/26,NEFT DR-HDFC0000001-ACME STATIONERS-ACME-HDFCN52026040312345678,HDFCN52026040312345678,03/04/26,"5,000.00",,"1,06,800.00"',
  '05/04/26,CHQ DEP 000123 - MUMBAI CLG,000123,05/04/26,,"2,500.00","1,09,300.00"',
  '05/04/26,POS 436431XXXXXX1234 AMAZON,,05/04/26,"1,200.00",,"1,08,100.00"',
  ',,,,,,',
  'STATEMENT SUMMARY  :-,,,,,,',
  'Opening Balance,Dr Count,Cr Count,Debits,Credits,Closing Bal,',
  '"1,00,000.00",2,2,"6,200.00","14,300.00","1,08,100.00",',
  'Generated On: 01/05/2026,,,,,,',
].join('\n');

test('HDFC statement: junk header/footer skipped, columns detected, Indian numbers parsed', () => {
  const p = parseBankStatement(HDFC);
  assert.equal(p.bankLabel, 'HDFC Bank');
  assert.equal(p.lines.length, 4);
  assert.deepEqual(p.lines.map((l) => [l.date, l.debit, l.credit, l.balance]), [
    ['2026-04-01', 0, 11800, 111800],
    ['2026-04-03', 5000, 0, 106800],
    ['2026-04-05', 0, 2500, 109300],
    ['2026-04-05', 1200, 0, 108100],
  ]);
  assert.match(p.lines[0].narration, /BHARAT TRADERS/);
  assert.equal(p.lines[0].ref, '0000412345678901');
  assert.ok(p.skipped >= 3, 'summary/footer rows are skipped, not imported');
  assert.equal(p.warnings.length, 0);
});

test('ICICI layout (Withdrawal Amount (INR ) / Transaction Remarks)', () => {
  const csv = [
    'DETAILED STATEMENT,,,,,,,',
    'S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )',
    '1,01-04-2026,01-04-2026,,UPI/412345678901/Payment/bharat@ybl/HDFC BANK,0.00,"11,800.00","1,11,800.00"',
    '2,02-04-2026,02-04-2026,,MMT/IMPS/409112345678/INV 0002/Karnataka Tech,"5,900.00",0.00,"1,05,900.00"',
  ].join('\n');
  const p = parseBankStatement(csv);
  assert.equal(p.bankLabel, 'ICICI Bank');
  assert.deepEqual(p.lines.map((l) => [l.date, l.debit, l.credit]), [['2026-04-01', 0, 11800], ['2026-04-02', 5900, 0]]);
  assert.equal(inferMode(p.lines[0].narration), 'UPI');
  assert.equal(inferMode(p.lines[1].narration), 'IMPS');
});

test('SBI layout (Txn Date / Description / Ref No./Cheque No. / Debit / Credit / Balance)', () => {
  const csv = [
    'Account Name : MR CHARTIST,,,,,,',
    'Txn Date,Value Date,Description,Ref No./Cheque No.,Debit,Credit,Balance',
    '1 Apr 2026,1 Apr 2026,BY TRANSFER-UPI/CR/412345678901/BHARAT T/HDFC/bharat@ok/,TRANSFER FROM 4897 ,,"11,800.00","1,11,800.00 CR"',
    '2 Apr 2026,2 Apr 2026,TO TRANSFER-NEFT*HDFC0000001*N123456789*ACME,,"5,000.00",,"1,06,800.00 CR"',
  ].join('\n');
  const p = parseBankStatement(csv);
  assert.equal(p.bankLabel, 'SBI');
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[0].credit, 11800);
  assert.equal(p.lines[0].balance, 111800);
  assert.equal(p.lines[1].debit, 5000);
});

test('Axis layout (TRAN DATE / PARTICULARS / DR / CR / BAL) with ragged footer', () => {
  const csv = [
    'SRL NO,TRAN DATE,CHQNO,PARTICULARS,DR,CR,BAL,SOL',
    '1,01-04-2026,,NEFT/HDFCN52026040100012345/BHARAT TRADERS,,"11,800.00","11,800.00",123',
    '2,02-04-2026,000456,CHQ PAID-ACME PRINTERS,"3,000.00",,"8,800.00",123',
    'Unless the constituent notifies the bank immediately,,,,,,,',
  ].join('\n');
  const p = parseBankStatement(csv);
  assert.equal(p.bankLabel, 'Axis Bank');
  assert.equal(p.lines.length, 2);
  assert.equal(p.lines[1].ref, '000456');
  assert.equal(p.skipped, 1);
});

test('Kotak layout: one Amount column + Dr / Cr indicator', () => {
  const csv = [
    'Sl. No.,Transaction Date,Value Date,Description,Chq / Ref No.,Amount,Dr / Cr,Balance,Dr / Cr',
    '1,01/04/2026,01/04/2026,UPI/BHARAT TRADERS/412345678901/Payment from Ph,UPI-412345678901,"11,800.00",CR,"1,11,800.00",CR',
    '2,02/04/2026,02/04/2026,NEFT-ACME STATIONERS,NEFT123,"5,000.00",DR,"1,06,800.00",CR',
  ].join('\n');
  const p = parseBankStatement(csv);
  assert.equal(p.lines.length, 2);
  assert.deepEqual(p.lines.map((l) => [l.debit, l.credit]), [[0, 11800], [5000, 0]]);
});

test('generic: single signed Amount column, Dr suffix, brackets', () => {
  const signed = parseBankStatement(['Date,Description,Amount,Balance', '01/04/2026,Receipt A,"1,000.00","1,000.00"', '02/04/2026,Payment B,"-400.00",600.00'].join('\n'));
  assert.deepEqual(signed.lines.map((l) => [l.debit, l.credit]), [[0, 1000], [400, 0]]);
  const suffix = parseBankStatement(['Date,Narration,Amount', '01/04/2026,Out,"400.00 Dr"', '02/04/2026,In,"900.00 Cr"'].join('\n'));
  assert.deepEqual(suffix.lines.map((l) => [l.debit, l.credit]), [[400, 0], [0, 900]]);
  const brackets = parseBankStatement(['Date,Narration,Debit,Credit', '01/04/2026,Fee,(50.00),', '02/04/2026,Dep,,75'].join('\n'));
  assert.deepEqual(brackets.lines.map((l) => [l.debit, l.credit]), [[50, 0], [0, 75]]);
});

test('semicolon delimiter, BOM, and wrapped narration continuation', () => {
  const csv = '﻿Date;Narration;Withdrawal;Deposit;Balance\n01/04/2026;UPI/412345678901/Payment for;;"5,000.00";"5,000.00"\n;invoice INV 0007 from Bharat;;;\n02/04/2026;ATM WDL;"1,000.00";;"4,000.00"';
  const p = parseBankStatement(csv);
  assert.equal(p.lines.length, 2);
  assert.match(p.lines[0].narration, /Payment for invoice INV 0007 from Bharat/);
  assert.equal(p.lines[1].debit, 1000);
});

test('opening balance row is captured, not imported as a transaction', () => {
  const p = parseBankStatement(['Date,Narration,Debit,Credit,Balance', '01/04/2026,Opening Balance,,,"1,00,000.00"', '02/04/2026,Dep,,500,"1,00,500.00"'].join('\n'));
  assert.equal(p.openingBalance, 100000);
  assert.equal(p.lines.length, 1);
});

test('unreadable files never throw and explain themselves', () => {
  for (const txt of ['', 'hello world', 'a,b,c\n1,2,3', 'Date,Narration\n01/04/2026,x']) {
    const p = parseBankStatement(txt);
    assert.equal(p.lines.length, 0, txt);
    assert.ok(p.warnings.length > 0, txt);
  }
  const sci = parseBankStatement(['Date,Narration,Chq./Ref.No.,Debit,Credit', '01/04/2026,UPI x,4.12E+11,,100'].join('\n'));
  assert.ok(sci.warnings.some((w) => /E\+11/.test(w)));
});

test('forced column mapping works when the headers are unrecognisable', () => {
  const csv = ['Foo,Bar,Baz', '01/04/2026,some text,100.00', '02/04/2026,more,-50.00'].join('\n');
  assert.equal(parseBankStatement(csv).lines.length, 0);
  const p = parseBankStatement(csv, { columns: { date: 0, narration: 1, amount: 2 }, headerRow: 0 });
  assert.deepEqual(p.lines.map((l) => [l.debit, l.credit]), [[0, 100], [50, 0]]);
  assert.deepEqual(detectColumns(['Date', 'Particulars', 'Dr', 'Cr', 'Bal']), { date: 0, narration: 1, debit: 2, credit: 3, balance: 4 });
});

/* ── de-duplication on re-import ──────────────────────────────── */

test('re-importing the same file adds nothing; a longer overlapping file adds only the new lines', () => {
  const first = parseBankStatement(HDFC);
  const st = makeStatement(first, first.lines, 'apr.csv');
  const again = splitDuplicates([st], first.lines);
  assert.equal(again.fresh.length, 0);
  assert.equal(again.duplicates.length, 4);

  const extended = [...first.lines, { date: '2026-04-09', narration: 'NEW', ref: '', debit: 0, credit: 70, balance: 108170 }];
  const part = splitDuplicates([st], extended);
  assert.equal(part.fresh.length, 1);
  assert.equal(part.fresh[0].narration, 'NEW');
});

test('identical lines inside one file are both real (no balance column) but a re-import is still caught', () => {
  const twin = { date: '2026-04-10', narration: 'UPI/500/Coffee', ref: '', debit: 500, credit: 0 };
  const file = [twin, { ...twin }];
  const once = splitDuplicates([], file);
  assert.equal(once.fresh.length, 2);
  const st = makeStatement({ bankLabel: 'X' }, once.fresh, 'a.csv');
  const twice = splitDuplicates([st], file);
  assert.equal(twice.fresh.length, 0);
  // A third identical line in a later file is genuinely new.
  const third = splitDuplicates([st], [twin, { ...twin }, { ...twin }]);
  assert.equal(third.fresh.length, 1);
});

/* ── narration helpers ────────────────────────────────────────── */

test('inferMode across bank wordings', () => {
  const cases: [string, string][] = [
    ['UPI/412345678901/Payment/bharat@ybl/HDFC BANK', 'UPI'],
    ['UPI-BHARAT TRADERS-bharat@okhdfc-HDFC0000123-412345678901-UPI', 'UPI'],
    ['BY TRANSFER-UPI/CR/412345678901/BHARAT T', 'UPI'],
    ['NEFT-HDFCN52026040112345678-BHARAT TRADERS PVT LTD-INV 0001', 'NEFT'],
    ['NEFT CR-HDFC0000123-BHARAT-SBIN426091234567', 'NEFT'],
    ['IMPS-412345678901-BHARAT TRADERS-HDFC-XXXX1234-INV0001', 'IMPS'],
    ['MMT/IMPS/412345678901/INV 1/BHARAT', 'IMPS'],
    ['RTGS-HDFCR52026040100012345-BHARAT-', 'RTGS'],
    ['RTGS CR-SBIN0001234-BHARAT', 'RTGS'],
    ['CHQ DEP 000123 - MUMBAI CLG', 'Cheque'],
    ['INWARD CLEARING 000123', 'Cheque'],
    ['CASH DEPOSIT SELF', 'Cash'],
    ['ACH D- LIC OF INDIA', 'ACH'],
    ['POS 436431XXXXXX1234 AMAZON', 'Card'],
    ['INTEREST CREDIT', 'Other'],
  ];
  for (const [n, mode] of cases) assert.equal(inferMode(n), mode, n);
});

test('extractReferences: RRN, UTR, zero-padded column, cheque no.', () => {
  const r = extractReferences('UPI-BHARAT-412345678901-INV 0001', '0000412345678901');
  assert.ok(r.includes('412345678901'));
  const n = extractReferences('NEFT-HDFCN52026040112345678-BHARAT', '');
  assert.ok(n.includes('HDFCN52026040112345678'));
  const c = extractReferences('CHQ DEP 000123 - MUMBAI CLG', '000123');
  assert.ok(c.includes('123'));
  assert.equal(referenceFor({ narration: 'UPI/412345678901/x', ref: '' }), '412345678901');
});

test('nameOverlap handles truncation, suffixes and glued names', () => {
  assert.equal(nameOverlap('Bharat Traders Pvt Ltd', 'UPI-BHARAT TRADERS-xx'), 1);
  assert.ok(nameOverlap('Bharat Traders Pvt Ltd', 'NEFT-BHARAT TRADE') >= 0.99, 'truncated');
  assert.ok(nameOverlap('Karnataka Tech', 'IMPS/KARNATAKATECH/INV') >= 0.5);
  assert.equal(nameOverlap('Acme Inc', 'NEFT-Bharat Traders'), 0);
  assert.equal(nameOverlap('', 'anything'), 0);
});

test('documentNumberHit: full, prefix+sequence, loose "INV NO 7"', () => {
  assert.equal(documentNumberHit('INV/FY25-26/0001', 'NEFT-X-INV/FY25-26/0001'), 'full');
  assert.equal(documentNumberHit('INV/FY25-26/0001', 'UPI/PAYMENT FOR INV0001/x'), 'short');
  assert.equal(documentNumberHit('INV/FY25-26/0001', 'IMPS-INV 0001-BHARAT'), 'short');
  assert.equal(documentNumberHit('INV/FY25-26/0007', 'PAYMENT FOR INVOICE NO 7'), 'short');
  assert.equal(documentNumberHit('INV/FY25-26/0001', 'INV 00012 other'), null, '0001 must not match 00012');
  assert.equal(documentNumberHit('INV/FY25-26/0001', 'random'), null);
  assert.equal(documentNumberHit('', 'INV 1'), null);
});

/* ── matching ─────────────────────────────────────────────────── */

test('exact amount + same day + name + UPI is high confidence; amount alone is not', () => {
  const l = line({ credit: 11800, narration: 'UPI-BHARAT TRADERS-bharat@okhdfc-412345678901' });
  const strong = cand({ amount: 11800, party: 'Bharat Traders', method: 'UPI' });
  const s = best([l], [strong]).get(l.id)!;
  assert.ok(s.confidence >= 90, String(s.confidence));
  assert.deepEqual(s.candidateIds, [strong.id]);

  const l2 = line({ credit: 777, narration: 'TRANSFER' });
  const weak = cand({ amount: 777, party: 'Someone Else', method: 'Bank transfer' });
  const w = best([l2], [weak]).get(l2.id)!;
  assert.ok(w.confidence < 70, String(w.confidence));
});

test('amount tolerance +-0.01 only; date window +-5 days', () => {
  const l = line({ credit: 1000, narration: 'x' });
  assert.equal(suggestMatches([l], [cand({ amount: 1000.01 })]).length, 1);
  assert.equal(suggestMatches([l], [cand({ amount: 1000.02 })]).length, 0);
  assert.equal(suggestMatches([l], [cand({ date: '2026-04-15' })]).length, 1);
  assert.equal(suggestMatches([l], [cand({ date: '2026-04-05' })]).length, 1);
  assert.equal(suggestMatches([l], [cand({ date: '2026-04-16' })]).length, 0);
  assert.equal(suggestMatches([l], [cand({ date: '2026-04-04' })]).length, 0);
});

test('a credit never matches a purchase payment and a debit never matches a receipt', () => {
  const credit = line({ credit: 500 });
  const debit = line({ debit: 500 });
  const rc = cand({ kind: 'payment', amount: 500 });
  const pp = cand({ kind: 'purchase_payment', amount: 500 });
  const out = bestSuggestions(suggestMatches([credit, debit], [rc, pp]));
  assert.deepEqual(out.get(credit.id)!.candidateIds, [rc.id]);
  assert.deepEqual(out.get(debit.id)!.candidateIds, [pp.id]);
});

test('UTR in narration: confident even when the books date is 12 days off', () => {
  const l = line({ date: '2026-04-20', credit: 25000, narration: 'NEFT-HDFCN52026042012345678-SOME CO', ref: '' });
  const c = cand({ date: '2026-04-08', amount: 25000, reference: 'HDFCN52026042012345678', method: 'Bank transfer' });
  const s = best([l], [c]).get(l.id)!;
  assert.ok(s, 'within the 15-day UTR window');
  assert.ok(s.confidence >= 90);
  assert.ok(s.reasons.some((r) => /UTR/.test(r)));
  // ...but no UTR evidence => outside the window => no suggestion
  assert.equal(suggestMatches([l], [{ ...c, reference: '' }]).length, 0);
});

test('zero-padded bank reference column still matches a bare UTR on the payment', () => {
  const l = line({ credit: 11800, narration: 'UPI-BHARAT', ref: '0000412345678901' });
  const c = cand({ amount: 11800, reference: '412345678901', party: 'Bharat Traders' });
  assert.ok(best([l], [c]).get(l.id)!.reasons.some((r) => /UTR/.test(r)));
});

test('cheque numbers match on the short (4+ digit) reference', () => {
  const l = line({ credit: 2500, narration: 'CHQ DEP 000123 - MUMBAI CLG', ref: '000123', date: '2026-04-07' });
  const c = cand({ amount: 2500, method: 'Cheque', reference: '123456', docNumber: '', date: '2026-04-05' });
  const hit = cand({ amount: 2500, method: 'Cheque', reference: '000123', date: '2026-04-05' });
  assert.ok(!best([l], [c]).get(l.id)!.reasons.some((r) => /UTR/.test(r)));
  assert.ok(best([l], [hit]).get(l.id)!.reasons.some((r) => /UTR/.test(r)));
});

test('invoice number in the narration lifts confidence', () => {
  const l = line({ credit: 5900, narration: 'IMPS-409112345678-KARNATAKATECH-INV0002', date: '2026-04-07' });
  const c = cand({ amount: 5900, date: '2026-04-03', docNumber: 'INV/FY26-27/0002', party: 'Karnataka Tech', method: 'Bank transfer' });
  const s = best([l], [c]).get(l.id)!;
  assert.ok(s.confidence >= 90, String(s.confidence));
});

test('truncated name + NEFT prefix + different case still scores on the name', () => {
  const l = line({ credit: 4400, narration: 'neft cr-hdfc0000123-bharat trade-', date: '2026-04-11' });
  const c = cand({ amount: 4400, party: 'Bharat Traders Pvt Ltd', method: 'Bank transfer', date: '2026-04-10' });
  const s = best([l], [c]).get(l.id)!;
  assert.ok(s.reasons.includes('Name matches'));
  assert.ok(s.confidence >= 80);
});

test('duplicates: two same-amount lines, two same-amount payments -> paired by date, flagged ambiguous, not bulk-confirmable', () => {
  const l1 = line({ date: '2026-04-10', credit: 1000, narration: 'UPI/1' });
  const l2 = line({ date: '2026-04-11', credit: 1000, narration: 'UPI/2' });
  const p1 = cand({ date: '2026-04-10', amount: 1000 });
  const p2 = cand({ date: '2026-04-11', amount: 1000 });
  const all = suggestMatches([l1, l2], [p1, p2]);
  const b = bestSuggestions(all);
  assert.deepEqual(b.get(l1.id)!.candidateIds, [p1.id]);
  assert.deepEqual(b.get(l2.id)!.candidateIds, [p2.id]);
  assert.ok(b.get(l1.id)!.ambiguous && b.get(l2.id)!.ambiguous);
  assert.equal(confirmableAll(all).length, 0);
  // one-to-one: a payment is the rank-1 pick of at most one line
  const used = [...b.values()].flatMap((s) => s.candidateIds);
  assert.equal(new Set(used).size, used.length);
});

test('two lines, one payment: only one line gets it', () => {
  const l1 = line({ credit: 800, narration: 'a' });
  const l2 = line({ credit: 800, narration: 'b', date: '2026-04-12' });
  const p = cand({ amount: 800 });
  const b = bestSuggestions(suggestMatches([l1, l2], [p]));
  assert.equal(b.size, 1);
});

test('already-matched entries and lines are never suggested again', () => {
  const l = line({ credit: 300 });
  const c = cand({ amount: 300 });
  assert.equal(suggestMatches([l], [c], { taken: new Set([c.id]) }).length, 0);
  assert.equal(suggestMatches([{ ...l, matched_to: { type: 'manual' } }], [c]).length, 0);
  assert.equal(suggestMatches([{ ...l, ignored: true }], [c]).length, 0);
});

test('partial payments: a part-payment entry matches the part credit, not the invoice total', () => {
  // invoice 10,000; customer paid 4,000 now (recorded as a payment of 4,000)
  const l = line({ credit: 4000, narration: 'NEFT-BHARAT TRADERS-PART PAYMENT INV 0001' });
  const part = cand({ amount: 4000, docNumber: 'INV/FY26-27/0001', party: 'Bharat Traders', method: 'Bank transfer' });
  const s = best([l], [part]).get(l.id)!;
  assert.ok(s.confidence >= 90);
});

test('one credit paying two invoices is offered as a combo (never above 89)', () => {
  const l = line({ credit: 17700, narration: 'NEFT-BHARAT TRADERS-INV 0003 INV 0004', date: '2026-04-12' });
  const a = cand({ amount: 11800, docNumber: 'INV/FY26-27/0003', party: 'Bharat Traders', date: '2026-04-09', method: 'Bank transfer' });
  const b = cand({ amount: 5900, docNumber: 'INV/FY26-27/0004', party: 'Bharat Traders', date: '2026-04-09', method: 'Bank transfer' });
  const out = suggestMatches([l], [a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].combo, true);
  assert.deepEqual([...out[0].candidateIds].sort(), [a.id, b.id].sort());
  assert.ok(out[0].confidence <= 89 && out[0].confidence >= 60, String(out[0].confidence));
  assert.equal(confirmableAll(out).length, 0, 'combos always need a human');
  // applying it records both ids
  const st = makeStatement({ bankLabel: 'X' }, [{ ...l }], 'f.csv');
  st.lines[0].id = l.id;
  const applied = applySuggestions([st], out);
  assert.deepEqual(applied[0].lines[0].matched_to?.ids?.slice().sort(), [a.id, b.id].sort());
});

test('combo is not offered when a single entry already explains the line', () => {
  const l = line({ credit: 17700 });
  const whole = cand({ amount: 17700 });
  const a = cand({ amount: 11800 });
  const b = cand({ amount: 5900 });
  const out = suggestMatches([l], [whole, a, b]);
  assert.ok(out.every((s) => !s.combo));
});

test('alternatives are ranked behind the pick', () => {
  const l = line({ credit: 1000, narration: 'UPI-BHARAT TRADERS' });
  const good = cand({ amount: 1000, party: 'Bharat Traders', method: 'UPI' });
  const meh = cand({ amount: 1000, party: 'Zed Corp', date: '2026-04-13' });
  const all = suggestMatches([l], [meh, good]);
  assert.equal(all[0].candidateIds[0], good.id);
  assert.equal(all.find((s) => s.candidateIds[0] === meh.id)!.rank, 2);
});

test('NOTHING is applied by suggestMatches; apply is explicit and skips already matched lines', () => {
  const st = makeStatement({ bankLabel: 'X' }, [{ date: '2026-04-10', narration: 'UPI BHARAT', ref: '', debit: 0, credit: 100 }], 'f.csv');
  const c = cand({ amount: 100, party: 'Bharat' });
  const sug = suggestMatches(st.lines, [c]);
  assert.equal(st.lines[0].matched_to, undefined, 'engine is advisory');
  const applied = applySuggestions([st], sug);
  assert.deepEqual(applied[0].lines[0].matched_to, { type: 'payment', id: c.id });
  const manual = matchLine([st], st.lines[0].id, { type: 'manual' });
  assert.equal(applySuggestions(manual, sug)[0].lines[0].matched_to?.type, 'manual', 'never overwrites a user decision');
});

test('performance: 400 lines x 400 entries is fast', () => {
  const lines: BankLine[] = [];
  const cands: Candidate[] = [];
  for (let i = 0; i < 400; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    lines.push(line({ date: `2026-04-${day}`, credit: 1000 + i, narration: `UPI/${100000000000 + i}/PAY` }));
    cands.push(cand({ date: `2026-04-${day}`, amount: 1000 + i }));
  }
  const t = Date.now();
  const out = suggestMatches(lines, cands);
  assert.ok(Date.now() - t < 2000);
  assert.equal(bestSuggestions(out).size, 400);
});

/* ── books-side candidates ────────────────────────────────────── */

const inv = (over: Partial<InvoiceRecord>): InvoiceRecord =>
  ({
    id: 'i1',
    invoice_number: 'INV/FY26-27/0001',
    doc_type: 'INVOICE',
    issue_date: '2026-04-01',
    status: 'Sent',
    total: 11800,
    amount_paid: 0,
    balance_due: 11800,
    client: { name: 'Bharat Traders', email: '', address: '', city: '', zip: '' },
    ...over,
  }) as InvoiceRecord;

test('receipt candidates skip cash and zero rows; payout candidates read purchases via the shared reader', () => {
  const invoices = [inv({})];
  const payments: Payment[] = [
    { id: 'p1', invoice_id: 'i1', amount: 100, method: 'UPI', date: '2026-04-02' },
    { id: 'p2', invoice_id: 'i1', amount: 100, method: 'Cash', date: '2026-04-02' },
    { id: 'p3', invoice_id: 'i1', amount: 0, method: 'UPI', date: '2026-04-02' },
  ];
  const rc = receiptCandidates(invoices, payments);
  assert.deepEqual(rc.map((c) => c.id), ['p1']);
  assert.equal(rc[0].party, 'Bharat Traders');
  assert.equal(rc[0].docNumber, 'INV/FY26-27/0001');

  const purchases = [
    { id: 'b1', kind: 'PURCHASE', vendor_name: 'Acme Stationers', bill_number: 'AS-77', date: '2026-04-01', taxable: 100, total: 118, status: 'Unpaid' },
    { id: 'b2', kind: 'PURCHASE', vendor_name: 'Void Co', bill_number: 'V1', date: '2026-04-01', total: 5, status: 'Cancelled' },
  ];
  const pp = [
    { id: 'q1', purchase_id: 'b1', amount: 118, date: '2026-04-03', method: 'Bank transfer', reference: 'HDFCN52026040312345678' },
    { id: 'q2', purchase_id: 'b1', amount: 5, date: '2026-04-03', method: 'Cash' },
  ];
  const po = payoutCandidates(purchases, [], pp);
  assert.deepEqual(po.map((c) => c.id), ['q1']);
  assert.equal(po[0].party, 'Acme Stationers');
  assert.equal(po[0].docNumber, 'AS-77');
  const l = line({ debit: 118, date: '2026-04-03', narration: 'NEFT DR-HDFC0000001-ACME STATIONERS-HDFCN52026040312345678' });
  assert.ok(best([l], po).get(l.id)!.confidence >= 90);
});

test('suggestInvoices ranks the invoice whose balance, number and name fit', () => {
  const a = inv({ id: 'a', invoice_number: 'INV/FY26-27/0001', total: 11800, balance_due: 11800 });
  const b = inv({ id: 'b', invoice_number: 'INV/FY26-27/0002', total: 5900, balance_due: 5900, client: { name: 'Karnataka Tech', email: '', address: '', city: '', zip: '' } });
  const paid = inv({ id: 'c', status: 'Paid', balance_due: 0 });
  const l = line({ credit: 5900, narration: 'IMPS-409-KARNATAKA TECH-INV0002' });
  const out = suggestInvoices(l, [a, b, paid]);
  assert.equal(out[0].invoice.id, 'b');
  assert.ok(!out.some((o) => o.invoice.id === 'c'));
});

/* ── state, summary, BRS ──────────────────────────────────────── */

test('lineState / summary: matched, manual, ignored, orphan (entry deleted), unmatched', () => {
  const idx = { payments: new Set(['p1']), purchasePayments: new Set(['q1']) };
  const lines: BankLine[] = [
    line({ credit: 100, matched_to: { type: 'payment', id: 'p1' } }),
    line({ debit: 50, matched_to: { type: 'purchase_payment', id: 'q1' } }),
    line({ credit: 10, matched_to: { type: 'manual' } }),
    line({ debit: 5, ignored: true }),
    line({ credit: 70, matched_to: { type: 'payment', id: 'gone' } }),
    line({ debit: 30 }),
    line({ credit: 20, matched_to: { type: 'payment', ids: ['p1', 'gone'] } }),
  ];
  assert.deepEqual(lines.map((l) => lineState(l, idx)), ['matched', 'matched', 'manual', 'ignored', 'orphan', 'unmatched', 'orphan']);
  const s = summarizeRecon(lines, idx);
  assert.equal(s.total, 7);
  assert.equal(s.matched, 2);
  assert.equal(s.unreconciled, 3);
  assert.equal(s.unreconciledCredits, 90);
  assert.equal(s.unreconciledDebits, 30);
  assert.equal(s.unreconciledNet, 60);
  assert.equal(s.matchedAmount, 150);
});

test('mutations: match / unmatch / ignore are pure and isolated to one line', () => {
  const st = makeStatement({ bankLabel: 'X' }, [
    { date: '2026-04-01', narration: 'a', ref: '', debit: 0, credit: 1 },
    { date: '2026-04-02', narration: 'b', ref: '', debit: 2, credit: 0 },
  ], 'f.csv');
  const id0 = st.lines[0].id;
  const m = matchLine([st], id0, { type: 'payment', id: 'p' });
  assert.equal(st.lines[0].matched_to, undefined, 'input untouched');
  assert.equal(m[0].lines[0].matched_to?.id, 'p');
  assert.equal(m[0].lines[1].matched_to, undefined);
  const u = unmatchLine(m, id0);
  assert.equal(u[0].lines[0].matched_to, undefined);
  const ig = ignoreLine(m, id0, true, 'transfer between own accounts');
  assert.equal(ig[0].lines[0].ignored, true);
  assert.equal(ig[0].lines[0].matched_to, undefined, 'ignoring clears a match');
  assert.equal(ig[0].lines[0].note, 'transfer between own accounts');
  assert.equal(ignoreLine(ig, id0, false)[0].lines[0].ignored, false);
});

test('BRS closes to zero when every difference is explained', () => {
  // Books: opening 100,000 + receipt 10,000 (matched) + receipt 5,000 (not yet credited)
  //        - payment 2,000 (matched) - payment 1,000 (cheque not yet cleared)  => books 112,000
  // Bank:  100,000 + 10,000 - 2,000 + 300 interest - 118 charges                => 108,182
  const receipts: Candidate[] = [
    cand({ id: 'r1', amount: 10000, date: '2026-04-05' }),
    cand({ id: 'r2', amount: 5000, date: '2026-04-28', party: 'Late Payer', docNumber: 'INV 9' }),
  ];
  const payouts: Candidate[] = [
    cand({ id: 'v1', kind: 'purchase_payment', amount: 2000, date: '2026-04-06' }),
    cand({ id: 'v2', kind: 'purchase_payment', amount: 1000, date: '2026-04-29', party: 'Acme', docNumber: 'B-1' }),
  ];
  const lines: BankLine[] = [
    line({ date: '2026-04-05', credit: 10000, balance: 110000, matched_to: { type: 'payment', id: 'r1' } }),
    line({ date: '2026-04-06', debit: 2000, balance: 108000, matched_to: { type: 'purchase_payment', id: 'v1' } }),
    line({ date: '2026-04-30', credit: 300, balance: 108300, narration: 'INT.PD' }),
    line({ date: '2026-04-30', debit: 118, balance: 108182, narration: 'SMS CHARGES' }),
  ];
  const idx = { payments: new Set(['r1', 'r2']), purchasePayments: new Set(['v1', 'v2']) };
  const brs = buildBrs({ asOf: '2026-04-30', booksBalance: 112000, lines, receipts, payouts, statementBalance: 108182, index: idx });
  assert.equal(brs.paymentsNotCleared.length, 1);
  assert.equal(brs.receiptsNotCleared.length, 1);
  assert.equal(brs.bankCreditsNotInBooks.length, 1);
  assert.equal(brs.bankDebitsNotInBooks.length, 1);
  assert.equal(brs.computedBankBalance, 108182); // 112000 + 1000 - 5000 + 300 - 118
  assert.equal(brs.difference, 0);
  const csv = brsCsv(brs);
  assert.match(csv, /Balance as per books,,112000/);
  assert.match(csv, /Difference \(unexplained\),,0/);
});

test('BRS: ignored / manual / orphan lines stay on the bank side; books items before `fromDate` are assumed cleared', () => {
  const lines: BankLine[] = [
    line({ date: '2026-04-02', credit: 50, ignored: true, narration: 'own transfer' }),
    line({ date: '2026-04-03', debit: 20, matched_to: { type: 'manual' }, narration: 'bank fee' }),
    line({ date: '2026-04-04', credit: 70, matched_to: { type: 'payment', id: 'gone' }, narration: 'orphan' }),
  ];
  const idx = { payments: new Set<string>(), purchasePayments: new Set<string>() };
  const old = cand({ id: 'old', amount: 999, date: '2026-03-01' });
  const brs = buildBrs({ asOf: '2026-04-30', fromDate: '2026-04-01', booksBalance: 0, lines, receipts: [old], payouts: [], statementBalance: null, index: idx });
  assert.equal(brs.bankCreditsNotInBooks.length, 2);
  assert.equal(brs.bankDebitsNotInBooks.length, 1);
  assert.equal(brs.receiptsNotCleared.length, 0, 'pre-statement items are not "outstanding"');
  assert.equal(brs.difference, null, 'no statement balance => no difference');
  assert.equal(brs.computedBankBalance, 100);
});

test('closing balance: typed override > last dated line balance; latest statement wins', () => {
  const a = makeStatement({ bankLabel: 'X' }, [
    { date: '2026-04-01', narration: '', ref: '', debit: 0, credit: 1, balance: 10 },
    { date: '2026-04-09', narration: '', ref: '', debit: 0, credit: 1, balance: 30 },
    { date: '2026-04-05', narration: '', ref: '', debit: 0, credit: 1, balance: 20 },
  ], 'a.csv');
  assert.equal(closingAcross([a]).balance, 30);
  assert.equal(closingAcross([a]).asOf, '2026-04-09');
  const b = { ...makeStatement({ bankLabel: 'X' }, [{ date: '2026-05-01', narration: '', ref: '', debit: 1, credit: 0 }], 'b.csv'), closing_balance: 77 };
  assert.deepEqual(closingAcross([a, b]), { balance: 77, asOf: '2026-05-01' });
  assert.deepEqual(closingAcross([]), { balance: null, asOf: '' });
});

/* ── storage ──────────────────────────────────────────────────── */

test('bank_statements round-trips and tolerates a damaged table', () => {
  resetStorage();
  assert.deepEqual(bankDb.all(), []);
  const st = makeStatement({ bankLabel: 'HDFC Bank', openingBalance: 5 }, [
    { date: '2026-04-01', narration: 'a', ref: 'r', debit: 0, credit: 1, balance: 6 },
  ], 'f.csv');
  const matched = matchLine([st], st.lines[0].id, { type: 'payment', id: 'p', ids: ['p', 'q'] });
  bankDb.saveAll(matched);
  const back = bankDb.all();
  assert.equal(back.length, 1);
  assert.equal(back[0].opening_balance, 5);
  assert.deepEqual(back[0].lines[0].matched_to, { type: 'payment', id: 'p', ids: ['p', 'q'] });

  localStorage.setItem('mrchartist_inv_bank_statements', JSON.stringify([null, 5, { id: 'x' }, { id: 'ok', lines: [null, { id: 'l', date: 'garbage' }, { id: 'l2', date: '2026-04-01', debit: '12.5' }] }]));
  const dmg = bankDb.all();
  assert.equal(dmg.length, 1);
  assert.equal(dmg[0].lines.length, 1);
  assert.equal(dmg[0].lines[0].debit, 12.5);
  localStorage.setItem('mrchartist_inv_bank_statements', '{not json');
  assert.deepEqual(bankDb.all(), []);
});

test('statement CSV export uses the safe cell writer', () => {
  assert.equal(toCsv([['=1+1']]), "'=1+1");
});

/* ── shortcuts that write to the books ────────────────────────── */

test('create receipt from a credit: method/reference/date from the line, invoice status follows, then it matches itself', () => {
  resetStorage();
  installSettings();
  const invoice = createViaStore({ date: '2026-04-01', lines: [{ qty: 1, rate: 10000, tax: 18 }] }); // 11,800
  const l = line({ date: '2026-04-09', credit: 5000, narration: 'NEFT-HDFCN52026040912345678-BHARAT TRADERS-PART PAYMENT' });
  const p = recordReceiptFromLine(l, invoice.id);
  assert.equal(p.method, 'NEFT');
  assert.equal(p.date, '2026-04-09');
  assert.equal(p.reference, 'HDFCN52026040912345678');
  assert.equal(p.amount, 5000);
  const after = localDb.invoices.getById(invoice.id)!;
  assert.equal(after.amount_paid, 5000);
  assert.equal(after.status, 'Partially Paid');
  // the new entry is now a candidate that matches the very line it came from, with high confidence
  const cands = receiptCandidates(localDb.invoices.getAll(), localDb.payments.getAll());
  const s = bestSuggestions(suggestMatches([l], cands)).get(l.id)!;
  assert.deepEqual(s.candidateIds, [p.id]);
  assert.ok(s.confidence >= 90, String(s.confidence));
  // guards
  assert.throws(() => recordReceiptFromLine(l, invoice.id, 7000), /more than the invoice balance of 6800\.00/);
  assert.throws(() => recordReceiptFromLine(line({ debit: 5 }), invoice.id), /Only a credit/);
  assert.throws(() => recordReceiptFromLine(l, 'nope'), /no longer exists/);
  assert.equal(localDb.payments.getAll().length, 1, 'failed attempts write nothing');
  // a UPI credit is recorded as UPI
  const u = recordReceiptFromLine(line({ date: '2026-04-10', credit: 6800, narration: 'UPI/412345678901/Payment/bharat@ybl/HDFC BANK' }), invoice.id);
  assert.equal(u.method, 'UPI');
  assert.equal(localDb.invoices.getById(invoice.id)!.status, 'Paid');
});

test('create expense from a debit: GST backed out, paid on the line date, matches its own line; bill payment shortcut', () => {
  resetStorage();
  installSettings();
  const l = line({ date: '2026-04-12', debit: 1180, narration: 'UPI-ZOHO CORPORATION-zoho@axis-UTIB0000001-412345678999' });
  const { bill, payment } = recordExpenseFromLine(l, { category: 'Software & subscriptions', vendorName: 'Zoho', taxRate: 18, itcEligible: true });
  assert.equal(bill.kind, 'EXPENSE');
  assert.equal(bill.taxable, 1000);
  assert.equal(bill.total, 1180);
  assert.equal(bill.itc_eligible, true);
  const pays = paymentsDb.forPurchase(bill.id);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].id, payment.id);
  assert.equal(pays[0].method, 'UPI');
  assert.equal(pays[0].date, '2026-04-12');
  assert.equal(purchasesDb.get(bill.id)!.amount_paid, 1180);
  const cands = payoutCandidates(purchasesDb.all(), [], paymentsDb.all());
  const s = bestSuggestions(suggestMatches([l], cands)).get(l.id)!;
  assert.deepEqual(s.candidateIds, [pays[0].id]);
  assert.ok(s.confidence >= 80, String(s.confidence));
  assert.throws(() => recordExpenseFromLine(line({ debit: 1000 }), { category: 'Rent', vendorName: 'x', taxRate: 0, itcEligible: false }) && recordExpenseFromLine(line({ credit: 5 }), { category: 'Rent', vendorName: 'x', taxRate: 0, itcEligible: false }), /Only a debit/);
  // pay an existing bill
  const open = purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Acme', bill_number: 'A-1', date: '2026-04-01', category: 'Purchases', lines: [],
    taxable: 1000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 1000, amount_paid: 0,
  });
  recordBillPaymentFromLine(line({ date: '2026-04-13', debit: 400, narration: 'NEFT DR-ACME' }), open.id);
  assert.equal(purchasesDb.get(open.id)!.amount_paid, 400);
  assert.throws(() => recordBillPaymentFromLine(line({ debit: 700 }), open.id), /more than the bill balance of 600\.00/);
});

test('guessCounterparty pulls a name out of messy narrations', () => {
  assert.equal(guessCounterparty('UPI-BHARAT TRADERS-bharat@okhdfc-HDFC0000123-412345678901-UPI'), 'Bharat Traders');
  assert.equal(guessCounterparty('NEFT DR-HDFC0000001-ACME STATIONERS-ACME-HDFCN52026040312345678'), 'Acme Stationers');
  assert.equal(guessCounterparty('POS 436431XXXXXX1234 AMAZON'), 'Amazon');
  assert.equal(guessCounterparty('UPI/412345678901/Payment/bharat@ybl/HDFC BANK'), '');
  assert.equal(guessCounterparty('CHQ DEP 000123 - MUMBAI CLG'), 'Mumbai');
  assert.equal(guessCounterparty(''), '');
});
