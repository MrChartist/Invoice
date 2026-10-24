/** Cash-flow forecast (roadmap 6.18): collection lag, weekly bucketing and sources. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast, collectionLags, clientKey, forecastCsv, openingCash, weeklyBuckets } from '../src/lib/cash-forecast.ts';
import { EMPTY_BOOKS, type BooksData } from '../src/lib/books.ts';
import { createSchedule, templateFromInvoice } from '../src/lib/recurring.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { Cheque } from '../src/types/cheques.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';

const TODAY = '2026-10-24';

const inv = (over: Partial<InvoiceRecord>) =>
  ({ id: 'x', invoice_number: 'INV/x', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-09-01', due_date: '2026-10-01', currency: 'INR', client: { id: 'c1', name: 'Acme' }, total: 1000, balance_due: 1000, amount_paid: 0, ...over }) as InvoiceRecord;
const pay = (over: Partial<Payment>): Payment => ({ id: 'p', invoice_id: 'x', amount: 1000, method: 'UPI', date: '2026-01-01', ...over });

test('collection lag is the amount-weighted average of days paid after due, clamped', () => {
  const invoices = [
    inv({ id: 'a', due_date: '2026-01-10' }),
    inv({ id: 'b', due_date: '2026-02-10' }),
    inv({ id: 'c', due_date: '2026-03-10', client: { id: 'c2', name: 'Beta' } as never }),
    inv({ id: 'd', due_date: '2025-01-01', client: { id: 'c3', name: 'Slow' } as never }),
  ];
  const lags = collectionLags(invoices, [
    pay({ id: '1', invoice_id: 'a', amount: 3000, date: '2026-01-20' }), // +10, weight 3000
    pay({ id: '2', invoice_id: 'b', amount: 1000, date: '2026-03-02' }), // +20, weight 1000 → (30000+20000)/4000 = 12.5 → 13
    pay({ id: '3', invoice_id: 'c', amount: 500, date: '2026-03-05' }), //  −5
    pay({ id: '4', invoice_id: 'd', amount: 500, date: '2026-01-01' }), // +365 → clamped to 120
  ]);
  assert.equal(lags.get(clientKey({ id: 'c1', name: 'Acme' }))!.days, 13);
  assert.equal(lags.get(clientKey({ id: 'c2', name: 'Beta' }))!.days, -5);
  assert.equal(lags.get(clientKey({ id: 'c3', name: 'Slow' }))!.days, 120);
});

test('weekly buckets cover the horizon; the last one may be short', () => {
  const b = weeklyBuckets(TODAY, 30);
  assert.equal(b.length, 5);
  assert.deepEqual(b[0], { start: '2026-10-24', end: '2026-10-30' });
  assert.deepEqual(b[4], { start: '2026-11-21', end: '2026-11-22' });
  assert.equal(weeklyBuckets(TODAY, 90).length, 13);
  assert.equal(weeklyBuckets(TODAY, 180).length, 26);
});

test('receivables move by the client lag; overdue lands today; no history = due date', () => {
  const invoices = [
    // History: Acme pays 10 days late.
    inv({ id: 'h', due_date: '2026-05-01', status: 'Paid', balance_due: 0, amount_paid: 1000 }),
    inv({ id: 'o1', invoice_number: 'INV/1', due_date: '2026-11-02', total: 5000, balance_due: 5000 }),
    inv({ id: 'o2', invoice_number: 'INV/2', due_date: '2026-10-01', total: 2000, balance_due: 2000 }),
    inv({ id: 'n1', invoice_number: 'INV/3', due_date: '2026-11-05', total: 700, balance_due: 700, client: { id: 'c9', name: 'New Co' } as never }),
    inv({ id: 'fx', invoice_number: 'INV/4', due_date: '2026-11-05', total: 100, balance_due: 100, currency: 'USD', exchange_rate: 80 }),
    inv({ id: 'nr', invoice_number: 'INV/5', due_date: '2026-11-05', total: 100, balance_due: 100, currency: 'EUR' }),
    inv({ id: 'dr', status: 'Draft', total: 999, balance_due: 999 }),
    inv({ id: 'qt', doc_type: 'QUOTATION', total: 999, balance_due: 999 }),
  ];
  const f = buildForecast({ today: TODAY, horizon: 30, opening: 10000, invoices, payments: [pay({ invoice_id: 'h', date: '2026-05-11' })], purchases: [] });
  const by = (ref: string) => f.items.find((i) => i.ref === ref)!;
  assert.equal(by('INV/1').date, '2026-11-12');
  assert.match(by('INV/1').basis, /\+ 10 days usual delay/);
  assert.equal(by('INV/2').date, TODAY);
  assert.equal(by('INV/2').overdue, true);
  assert.equal(by('INV/3').date, '2026-11-05');
  assert.match(by('INV/3').basis, /no payment history/);
  assert.equal(by('INV/4').amount, 8000);
  assert.equal(f.excludedForeign, 1);
  assert.equal(f.items.length, 4);
  // Buckets (weeks from 24 Oct): INV/2 today; INV/3 on 5 Nov; INV/1 on 12 Nov; INV/4 (Acme, +10) on 15 Nov.
  assert.equal(by('INV/4').date, '2026-11-15');
  assert.equal(f.buckets[0].inflow, 2000);
  assert.equal(f.buckets[0].closing, 12000);
  assert.equal(f.buckets[1].inflow, 700);
  assert.equal(f.buckets[2].inflow, 5000);
  assert.equal(f.buckets[3].inflow, 8000);
  assert.equal(f.totals.closing, 25700);
  assert.equal(f.totals.inflow, 15700);
  // Optional: leave out long-overdue invoices.
  const strict = buildForecast({ today: TODAY, horizon: 30, opening: 0, invoices, payments: [], purchases: [], skipOverdueAfter: 14 });
  assert.equal(strict.items.some((i) => i.ref === 'INV/2'), false);
});

test('payables at due date, MSME limit when earlier; pending cheques replace linked amounts', () => {
  const vendors: Vendor[] = [{ id: 'v1', name: 'Micro Parts', msme_category: 'MICRO' }];
  const bill = (over: Partial<PurchaseRecord>): PurchaseRecord => ({
    id: 'B', kind: 'PURCHASE', vendor_name: 'Supplier', bill_number: 'B', date: '2026-10-10', category: 'Purchases', lines: [],
    taxable: 0, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 3000, amount_paid: 0, ...over,
  });
  const purchases = [
    bill({ id: 'B1', bill_number: 'B1', due_date: '2026-11-20' }),
    // MSME with agreed 60 days → capped at 45 days from 10 Oct = 24 Nov.
    bill({ id: 'B2', bill_number: 'B2', vendor_id: 'v1', vendor_name: 'Micro Parts', due_date: '2026-12-09', total: 1000 }),
    // MSME without a due date → 15 days = 25 Oct.
    bill({ id: 'B3', bill_number: 'B3', vendor_id: 'v1', vendor_name: 'Micro Parts', total: 400 }),
    bill({ id: 'B4', bill_number: 'B4', due_date: '2026-11-01', total: 900, amount_paid: 900 }),
    bill({ id: 'B5', bill_number: 'B5', due_date: '2026-11-01', total: 2500 }),
  ];
  const cheques = [
    { id: 'q1', direction: 'issued', number: '100001', bank: 'ICICI', cheque_date: '2026-10-28', amount: 2500, party_name: 'Supplier', purchase_id: 'B5', status: 'issued' },
    { id: 'q2', direction: 'received', number: '000777', bank: 'SBI', cheque_date: '2026-11-03', amount: 600, party_name: 'Acme', invoice_id: 'o1', status: 'received' },
    { id: 'q3', direction: 'received', number: '000778', bank: 'SBI', cheque_date: '2026-10-20', amount: 50, party_name: 'Acme', status: 'cleared' },
  ] as Cheque[];
  const f = buildForecast({ today: TODAY, horizon: 90, opening: 0, invoices: [inv({ id: 'o1', invoice_number: 'INV/1', due_date: '2026-11-10', total: 1000, balance_due: 1000 })], payments: [], purchases, vendors, cheques });
  const by = (ref: string) => f.items.find((i) => i.ref === ref)!;
  assert.equal(by('B1').date, '2026-11-20');
  assert.equal(by('B2').date, '2026-11-24');
  assert.match(by('B2').basis, /MSME limit/);
  assert.equal(by('B3').date, '2026-10-25');
  assert.equal(f.items.some((i) => i.ref === 'B4'), false, 'paid bills are left out');
  assert.equal(f.items.some((i) => i.ref === 'B5'), false, 'covered by the issued cheque');
  assert.equal(by('Cheque 100001').date, '2026-10-28');
  assert.equal(by('Cheque 000777').amount, 600);
  assert.equal(by('INV/1').amount, 400, 'the cheque replaces that much of the invoice');
  assert.equal(f.items.some((i) => i.ref === 'Cheque 000778'), false, 'cleared cheques are already cash');
  assert.equal(f.totals.outflow, 6900);
  assert.equal(f.firstNegative, TODAY);
  // −2,900 → −2,300 → −1,900 → −4,900 → −5,900 (week of 21 Nov)
  assert.deepEqual(f.lowest, { balance: -5900, week: '2026-11-21' });
});

test('recurring schedules add future invoices; average expenses are optional', () => {
  const draft = makeDraft({ settings: localDb.settings.get(), sender: null });
  draft.client = { ...draft.client, id: 'c1', name: 'Acme' };
  draft.items = [{ id: 'i', name: 'Retainer', type: 'Service', quantity: 1, rate: 10000, tax_rate: 18, amount: 10000 }];
  draft.gst_mode = 'IGST';
  draft.round_off_enabled = false;
  const s = createSchedule({ name: 'Monthly retainer', template: templateFromInvoice(draft), frequency: 'monthly', start_date: '2026-11-01', due_in_days: 7, mode: 'issue' });
  const expenses: PurchaseRecord[] = ['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'].map((date, i) => ({
    id: `E${i}`, kind: 'EXPENSE', vendor_name: 'Landlord', bill_number: `R${i}`, date, category: 'Rent', lines: [],
    taxable: 30000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 30000, amount_paid: 30000,
  }));
  const f = buildForecast({ today: TODAY, horizon: 90, opening: 0, invoices: [], payments: [], purchases: expenses, recurring: [s], includeExpenses: true });
  const rec = f.items.filter((i) => i.kind === 'recurring');
  assert.deepEqual(rec.map((r) => r.date), ['2026-11-08', '2026-12-08', '2027-01-08']);
  assert.equal(rec[0].amount, 11800);
  // Jul, Aug, Sep (the October bill is in the current month) → 30,000 a month.
  assert.equal(f.averageMonthlyExpenses, 30000);
  const exp = f.items.filter((i) => i.kind === 'expenses');
  assert.equal(exp.length, 13);
  assert.equal(exp[0].amount, Math.round(((30000 * 12 * 7) / 365) * 100) / 100);
  const off = buildForecast({ today: TODAY, horizon: 90, opening: 0, invoices: [], payments: [], purchases: expenses, recurring: [{ ...s, active: false }] });
  assert.equal(off.items.length, 0);
  assert.match(forecastCsv(f), /ESTIMATE/);
});

test('opening cash comes from the Books cash and bank books', () => {
  const books: BooksData = {
    ...EMPTY_BOOKS,
    invoices: [inv({ id: 'a', status: 'Paid' })] as BooksData['invoices'],
    transactions: [pay({ invoice_id: 'a', amount: 1000, method: 'Cash', date: '2026-10-01' }), pay({ id: 'b', invoice_id: 'a', amount: 500, method: 'UPI', date: '2026-10-30' })],
    openings: [{ id: 'o', account: 'bank', amount: 20000, as_of: '2026-04-01' }],
  };
  assert.equal(openingCash(books, TODAY), 21000);
});
