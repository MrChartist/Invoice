/**
 * Exchange gain / loss (roadmap 6.19): realised on receipts (posted to the ledger), unrealised
 * revaluation (report only), and the trial balance still balancing.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { EMPTY_BOOKS, buildVouchers, type BooksData } from '../src/lib/books.ts';
import { A, buildLedger, ledgerBalanceSheet, trialBalance, type LedgerInput } from '../src/lib/ledger/index.ts';
import { foreignReceipts, realisedCsv, realisedFx, realisedTotals, receiptInr, revaluationCsv, revalueReceivables } from '../src/lib/fx-gain.ts';
import { localDb } from '../src/lib/localDb.ts';
import { KEYS, SINGLETON_KEYS, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const FY = { start: '2025-04-01', end: '2026-03-31' };

function usd(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'F', invoice_number: 'INV/FY25-26/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: '2025-06-01', due_date: '2025-06-30',
    currency: 'USD', exchange_rate: 83.25, client: { name: 'Globex Inc' }, taxable_value: 1000, tax_amount: 0, total: 1000,
    balance_due: 1000, amount_paid: 0, supply_type: 'EXPORT_LUT', gst_mode: 'NONE',
    ...over,
  } as InvoiceRecord;
}

const pay = (over: Partial<Payment>): Payment => ({ id: 'r1', invoice_id: 'F', amount: 1000, method: 'Bank transfer', date: '2025-07-05', ...over });

function input(over: Partial<LedgerInput> = {}): LedgerInput {
  return { ...EMPTY_BOOKS, userAccounts: [], manual: [], assets: [], today: '2026-03-31', ...over };
}

function lines(v: { lines: { account: string; dr: number; cr: number }[] } | undefined): Record<string, number> {
  assert.ok(v, 'voucher missing');
  const out: Record<string, number> = {};
  for (const l of v!.lines) out[l.account] = (out[l.account] ?? 0) + (l.dr - l.cr) / 100;
  return out;
}

test('realised gain = (receipt rate − invoice rate) × foreign amount', () => {
  // USD 1,000 booked @ 83.25 = 83,250; received @ 84.10 = 84,100 → gain 850
  const fx = realisedFx(pay({ realised_rate: 84.1 }), usd());
  assert.ok(fx);
  assert.equal(fx!.bookInr, 83250);
  assert.equal(fx!.realisedInr, 84100);
  assert.equal(fx!.gain, 850);
  // Part receipt of USD 400 @ 82.90 → (82.90 − 83.25) × 400 = −140 (loss)
  assert.equal(realisedFx(pay({ amount: 400, realised_rate: 82.9 }), usd())!.gain, -140);
  // Paise-exact: USD 333.33 @ 83.2575 vs 83.25 → 27,752.22 − 27,749.72 = 2.50 (each side rounded on its own)
  const odd = realisedFx(pay({ amount: 333.33, realised_rate: 83.2575 }), usd())!;
  assert.equal(odd.realisedInr, 27752.22);
  assert.equal(odd.bookInr, 27749.72);
  assert.equal(odd.gain, 2.5);
});

test('no realised difference for INR invoices, rate-less foreign invoices or receipts without a rate', () => {
  assert.equal(realisedFx(pay({ realised_rate: 84 }), usd({ currency: 'INR' })), null);
  assert.equal(realisedFx(pay({ realised_rate: 84 }), usd({ exchange_rate: undefined })), null);
  assert.equal(realisedFx(pay({}), usd()), null);
  assert.equal(realisedFx(pay({ realised_rate: -2 }), usd()), null);
  assert.equal(receiptInr(pay({}), usd()), 83250);
  assert.equal(receiptInr(pay({ realised_rate: 84.1 }), usd()), 84100);
});

test('ledger: Dr bank at the realised rupees, Cr debtor at the invoice rate, gain to FX account', () => {
  const led = buildLedger(input({
    invoices: [usd()] as BooksData['invoices'],
    transactions: [pay({ id: 'g', amount: 600, realised_rate: 84.1 }), pay({ id: 'l', amount: 400, realised_rate: 82.9, date: '2025-08-01' })],
  }));
  assert.deepEqual(led.warnings, []);
  // 600 × 84.10 = 50,460 vs 600 × 83.25 = 49,950 → gain 510
  assert.deepEqual(lines(led.vouchers.find((v) => v.id === 'rcpt:g')), { [A.bank]: 50460, [A.debtors]: -49950, [A.fxGain]: -510 });
  // 400 × 82.90 = 33,160 vs 33,300 → loss 140 (a debit)
  assert.deepEqual(lines(led.vouchers.find((v) => v.id === 'rcpt:l')), { [A.bank]: 33160, [A.debtors]: -33300, [A.fxGain]: 140 });
  assert.match(led.vouchers.find((v) => v.id === 'rcpt:g')!.narration, /realised @ ₹84\.1 \(exchange gain 510\.00\)/);

  const tb = trialBalance(led, FY);
  assert.equal(tb.totals.debit, tb.totals.credit, 'trial balance debits = credits');
  assert.equal(tb.totals.closingDr, tb.totals.closingCr, 'closing balances agree');
  const fxRow = tb.rows.find((r) => r.account.id === A.fxGain)!;
  assert.equal(fxRow.closing, -37000, 'net gain 370 sits as a credit');
  const debtor = tb.rows.find((r) => r.account.id === A.debtors)!;
  assert.equal(debtor.closing, 0, 'the customer is fully settled at the invoice rate');
  const bs = ledgerBalanceSheet(led, '2026-03-31');
  assert.equal(bs.difference, 0, 'balance sheet still ties');
});

test('trial balance balances with fuzzed foreign receipts and rates', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const invoices: InvoiceRecord[] = [];
  const transactions: Payment[] = [];
  for (let i = 0; i < 40; i++) {
    const total = Math.round(rnd() * 500000) / 100;
    const rate = Math.round((70 + rnd() * 20) * 10000) / 10000;
    invoices.push(usd({ id: `F${i}`, invoice_number: `INV/${i}`, total, taxable_value: total, balance_due: total, exchange_rate: rate, currency: i % 3 ? 'USD' : 'EUR' }));
    const part = Math.round(total * rnd() * 100) / 100;
    transactions.push(pay({ id: `p${i}a`, invoice_id: `F${i}`, amount: part, realised_rate: Math.round((rate + (rnd() - 0.5) * 4) * 10000) / 10000 }));
    transactions.push(pay({ id: `p${i}b`, invoice_id: `F${i}`, amount: Math.round((total - part) * 100) / 100, date: '2025-09-01', realised_rate: i % 4 ? rate + 1.37 : undefined }));
  }
  const led = buildLedger(input({ invoices: invoices as BooksData['invoices'], transactions }));
  assert.deepEqual(led.warnings, []);
  const tb = trialBalance(led, FY);
  assert.equal(tb.totals.debit, tb.totals.credit);
  assert.equal(tb.totals.closingDr, tb.totals.closingCr);
  // The FX account is exactly the sum of the receipts' realised differences, to the paisa.
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const expected = transactions.reduce((s, t) => s + Math.round((realisedFx(t, byId.get(t.invoice_id))?.gain ?? 0) * 100), 0);
  assert.equal(-tb.rows.find((r) => r.account.id === A.fxGain)!.closing, expected);
});

test('Books cash book books the rupees actually realised, like the ledger bank', () => {
  const data: BooksData = { ...EMPTY_BOOKS, invoices: [usd()] as BooksData['invoices'], transactions: [pay({ realised_rate: 84.1 })] };
  const v = buildVouchers(data).find((x) => x.id === 'rcpt:r1')!;
  assert.equal(v.credit, 84100);
});

test('register of foreign receipts in a period, with totals and CSV', () => {
  const invs = [usd()];
  const rows = foreignReceipts(invs, [pay({ id: 'a', amount: 600, realised_rate: 84.1 }), pay({ id: 'b', amount: 400 }), pay({ id: 'c', date: '2024-01-01' })], FY);
  assert.equal(rows.length, 2);
  const t = realisedTotals(rows);
  assert.deepEqual(t, { gain: 510, loss: 0, net: 510, missingRate: 1 });
  const csv = realisedCsv(rows, FY);
  assert.match(csv, /verify with your CA/);
  assert.match(csv, /invoice-date rate/);
  assert.match(csv, /rate not entered/);
});

test('revaluation: open foreign balances at the closing rate, unrealised and not posted', () => {
  const invs = [
    usd(),
    usd({ id: 'E', invoice_number: 'INV/2', currency: 'EUR', exchange_rate: 90, total: 500, issue_date: '2025-12-01' }),
    usd({ id: 'X', invoice_number: 'INV/3', status: 'Cancelled' }),
    usd({ id: 'N', invoice_number: 'INV/4', exchange_rate: undefined }),
    usd({ id: 'L', invoice_number: 'INV/5', issue_date: '2026-04-02' }),
  ];
  // USD 600 received before the year end, so USD 400 is open.
  const rev = revalueReceivables(invs, [pay({ amount: 600 }), pay({ id: 'late', amount: 400, date: '2026-04-10' })], { USD: 85, EUR: undefined }, '2026-03-31');
  assert.deepEqual(rev.currencies, ['EUR', 'USD']);
  const u = rev.rows.find((r) => r.invoiceId === 'F')!;
  assert.equal(u.openForeign, 400);
  assert.equal(u.bookInr, 33300);
  assert.equal(u.closingInr, 34000);
  assert.equal(u.unrealised, 700);
  const e = rev.rows.find((r) => r.invoiceId === 'E')!;
  assert.equal(e.closingRate, null);
  assert.equal(e.unrealised, null);
  assert.deepEqual(rev.totals, { bookInr: 33300, closingInr: 34000, unrealised: 700, missingRate: 1 });
  assert.match(revaluationCsv(rev), /not posted/);
  // A revaluation never changes the ledger: no FX line appears from it.
  const led = buildLedger(input({ invoices: invs as BooksData['invoices'] }));
  assert.equal(led.vouchers.some((v) => v.lines.some((l) => l.account === A.fxGain)), false);
});

test('localDb: realised rate stored only on foreign invoices; editable; respects the period lock', () => {
  setTable(KEYS.invoices, [usd(), usd({ id: 'I', invoice_number: 'INV/9', currency: 'INR', exchange_rate: undefined })]);
  const p = localDb.payments.record({ invoiceId: 'F', amount: 1000, method: 'Bank transfer', date: '2025-07-05', realisedRate: 84.1 });
  assert.equal(p.realised_rate, 84.1);
  const inr = localDb.payments.record({ invoiceId: 'I', amount: 100, method: 'Cash', date: '2025-07-05', realisedRate: 84.1 });
  assert.equal(inr.realised_rate, undefined);
  assert.equal(localDb.invoices.getById('F')!.status, 'Paid', 'settlement is tracked in the invoice currency');

  localDb.payments.setRealisedRate(p.id, 83.9);
  assert.equal(getTable<Payment>(KEYS.transactions).find((t) => t.id === p.id)!.realised_rate, 83.9);
  localDb.payments.setRealisedRate(p.id, undefined);
  assert.equal(getTable<Payment>(KEYS.transactions).find((t) => t.id === p.id)!.realised_rate, undefined);
  assert.throws(() => localDb.payments.setRealisedRate(inr.id, 80), /foreign-currency/);

  setJson(SINGLETON_KEYS.settings, { lock_until: '2025-12-31' });
  assert.throws(() => localDb.payments.setRealisedRate(p.id, 85), (e: unknown) => isPeriodLockedError(e));
  const audit = getTable<{ entity: string; summary: string }>('audit_log');
  assert.ok(audit.some((a) => a.entity === 'payment' && /Realised rate/.test(a.summary)));
});
