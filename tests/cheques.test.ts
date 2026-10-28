/**
 * Cheque register & PDC (roadmap 6.26): lifecycle, payment recording / bounce reversal through the
 * payments API, period lock, PDC notifications and cheque printing.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  canTransition,
  chequeSummary,
  chequesCsv,
  deleteCheque,
  filterCheques,
  loadCheques,
  nextStatuses,
  saveCheque,
  transitionCheque,
  validateCheque,
  type ChequeInput,
} from '../src/lib/cheques.ts';
import { isPostDated, pdcReminders, validUntil } from '../src/lib/cheque-reminders.ts';
import { buildChequePrint, chequeDateDigits, chequeFigures, chequeHtml, chequeWords, normalizeChequePrefs, splitWords } from '../src/lib/cheque-print.ts';
import { chequeProvider, collectNotifications, type NotificationContext } from '../src/lib/notifications.ts';
import { localDb } from '../src/lib/localDb.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { KEYS, SINGLETON_KEYS, getTable, setJson, setTable } from '../src/lib/storage.ts';
import { isPeriodLockedError } from '../src/lib/period-lock.ts';
import { creditCheck } from '../src/lib/credit-limit.ts';
import type { Cheque } from '../src/types/cheques.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => resetStorage());

const TODAY = '2026-10-24';

function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'I1', invoice_number: 'INV/FY26-27/0007', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-10-01', due_date: '2026-10-15',
    currency: 'INR', client: { id: 'c1', name: 'Acme Buyers' }, taxable_value: 10000, tax_amount: 1800, total: 11800, balance_due: 11800, amount_paid: 0,
    ...over,
  } as InvoiceRecord;
}

const received = (over: Partial<ChequeInput> = {}): ChequeInput => ({
  direction: 'received', number: '004512', bank: 'HDFC Bank', cheque_date: '2026-10-20', amount: 11800,
  party_name: 'Acme Buyers', client_id: 'c1', invoice_id: 'I1', ...over,
});

test('validation: 6-digit number, bank, date, amount, party; duplicates refused', () => {
  assert.deepEqual(validateCheque(received()), []);
  const errs = validateCheque({ ...received(), number: '45', bank: ' ', cheque_date: 'x', amount: 0, party_name: '' });
  assert.equal(errs.length, 5);
  const saved = saveCheque(received());
  assert.match(validateCheque(received(), [saved])[0], /already in the register/);
  // Same number from another bank is a different cheque.
  assert.deepEqual(validateCheque(received({ bank: 'SBI' }), [saved]), []);
});

test('status flow per direction', () => {
  assert.deepEqual(nextStatuses({ direction: 'received', status: 'received' }), ['deposited', 'cleared']);
  assert.deepEqual(nextStatuses({ direction: 'received', status: 'deposited' }), ['cleared', 'bounced']);
  assert.deepEqual(nextStatuses({ direction: 'received', status: 'bounced' }), ['deposited']);
  assert.deepEqual(nextStatuses({ direction: 'issued', status: 'issued' }), ['presented', 'cleared', 'cancelled']);
  assert.deepEqual(nextStatuses({ direction: 'issued', status: 'cleared' }), []);
  assert.equal(canTransition({ direction: 'received', status: 'received' }, 'bounced'), false);
});

test('received cheque: deposit → clear records the payment; bounce reverses it and flags the party', () => {
  setTable(KEYS.invoices, [invoice()]);
  const c = saveCheque(received());
  assert.equal(c.status, 'received');
  transitionCheque(c.id, 'deposited', { date: '2026-10-21', today: TODAY });
  const cleared = transitionCheque(c.id, 'cleared', { date: '2026-10-23', today: TODAY });
  assert.ok(cleared.payment);
  assert.equal(cleared.payment!.method, 'Cheque');
  assert.equal(cleared.payment!.reference, '004512');
  assert.equal(cleared.payment!.date, '2026-10-23');
  assert.equal(cleared.cheque.payment_id, cleared.payment!.id);
  let inv = localDb.invoices.getById('I1')!;
  assert.equal(inv.status, 'Paid');
  assert.equal(inv.balance_due, 0);

  const bounced = transitionCheque(c.id, 'bounced', { date: '2026-10-24', reason: 'Funds insufficient', today: TODAY });
  assert.equal(bounced.cheque.status, 'bounced');
  assert.equal(bounced.cheque.payment_id, undefined);
  assert.equal(bounced.cheque.bounce_count, 1);
  assert.equal(bounced.cheque.bounce_reason, 'Funds insufficient');
  assert.equal(getTable<Payment>(KEYS.transactions).length, 0, 'the receipt is reversed');
  inv = localDb.invoices.getById('I1')!;
  assert.equal(inv.balance_due, 11800);
  assert.notEqual(inv.status, 'Paid');
  // The party is flagged at billing.
  const check = creditCheck({ client: { id: 'c1', name: 'Acme Buyers', email: '', address: '', city: '', zip: '' }, draft: { doc_type: 'INVOICE', total: 100 }, invoices: [inv], today: TODAY, cheques: loadCheques() });
  assert.equal(check.bounced, 1);
  assert.match(check.warnings.join(' '), /bounced/);
  // Re-presented and cleared: payment recorded again.
  transitionCheque(c.id, 'deposited', { date: '2026-10-24', today: TODAY });
  const again = transitionCheque(c.id, 'cleared', { date: '2026-10-24', today: TODAY });
  assert.ok(again.payment);
  assert.equal(localDb.invoices.getById('I1')!.status, 'Paid');
  const audit = getTable<{ entity: string }>('audit_log').filter((a) => a.entity === 'cheque');
  assert.ok(audit.length >= 5);
});

test('clearing without recording, over-balance cheques and foreign invoices', () => {
  setTable(KEYS.invoices, [invoice({ balance_due: 5000, amount_paid: 6800 })]);
  const big = saveCheque(received());
  assert.throws(() => transitionCheque(big.id, 'cleared', { date: '2026-10-21', today: TODAY }), /more than the balance/);
  assert.equal(loadCheques()[0].status, 'received', 'nothing changed');
  const r = transitionCheque(big.id, 'cleared', { date: '2026-10-21', today: TODAY, recordPayment: false });
  assert.equal(r.payment, undefined);
  assert.equal(r.cheque.status, 'cleared');

  setTable(KEYS.invoices, [invoice({ id: 'U', currency: 'USD', exchange_rate: 83 })]);
  const usd = saveCheque(received({ number: '000111', invoice_id: 'U' }));
  // PENDING 39: a rupee cheque settles ₹ ÷ the rate in the invoice currency; the bank gets exactly the cheque's rupees.
  const u = transitionCheque(usd.id, 'cleared', { date: '2026-10-21', today: TODAY, realisedRate: 84 });
  assert.equal(u.payment?.amount, 140.48); // 11,800 / 84
  assert.equal(Math.round(u.payment!.amount * u.payment!.realised_rate! * 100) / 100, 11800);
  assert.match(u.note!, /USD 140\.48/);
  // No typed rate: the invoice rate (83) → USD 142.17.
  const usd2 = saveCheque(received({ number: '000112', invoice_id: 'U' }));
  assert.equal(transitionCheque(usd2.id, 'cleared', { date: '2026-10-21', today: TODAY }).payment?.amount, 142.17);
  // No rate anywhere: nothing recorded, the note says why.
  setTable(KEYS.invoices, [...getTable<InvoiceRecord>(KEYS.invoices), invoice({ id: 'E', currency: 'EUR' })]);
  const eur = saveCheque(received({ number: '000113', invoice_id: 'E' }));
  const e = transitionCheque(eur.id, 'cleared', { date: '2026-10-21', today: TODAY });
  assert.equal(e.payment, undefined);
  assert.match(e.note!, /EUR with no exchange rate/);
});

test('post-dated cheques cannot be deposited before their date; expired ones cannot be deposited', () => {
  const pdc = saveCheque(received({ cheque_date: '2026-11-05', invoice_id: undefined }));
  assert.equal(isPostDated(pdc, TODAY), true);
  assert.throws(() => transitionCheque(pdc.id, 'deposited', { date: TODAY, today: TODAY }), /cannot be deposited before/);
  assert.throws(() => transitionCheque(pdc.id, 'deposited', { date: '2026-11-06', today: TODAY }), /future/);
  const old = saveCheque(received({ number: '000222', cheque_date: '2026-06-01', invoice_id: undefined }));
  assert.equal(validUntil('2026-06-01'), '2026-08-31');
  assert.equal(validUntil('2026-11-30'), '2027-02-27');
  assert.throws(() => transitionCheque(old.id, 'deposited', { date: TODAY, today: TODAY }), /expired/);
});

test('period lock: a cleared cheque in a locked period cannot bounce (payment stays), status unchanged', () => {
  setTable(KEYS.invoices, [invoice({ issue_date: '2026-09-01' })]);
  const c = saveCheque(received({ cheque_date: '2026-09-10' }));
  transitionCheque(c.id, 'cleared', { date: '2026-09-15', today: TODAY });
  setJson(SINGLETON_KEYS.settings, { lock_until: '2026-09-30' });
  assert.throws(() => transitionCheque(c.id, 'bounced', { date: TODAY, today: TODAY }), (e: unknown) => isPeriodLockedError(e));
  assert.equal(loadCheques()[0].status, 'cleared');
  assert.equal(getTable<Payment>(KEYS.transactions).length, 1);
  // And a payment against a locked invoice cannot be recorded by clearing either.
  setJson(SINGLETON_KEYS.settings, {});
  setTable(KEYS.invoices, [invoice({ id: 'I2', invoice_number: 'INV/2', issue_date: '2026-09-02' })]);
  const c2 = saveCheque(received({ number: '000333', invoice_id: 'I2', cheque_date: '2026-10-01' }));
  setJson(SINGLETON_KEYS.settings, { lock_until: '2026-09-30' });
  assert.throws(() => transitionCheque(c2.id, 'cleared', { date: '2026-10-05', today: TODAY }), (e: unknown) => isPeriodLockedError(e));
  assert.equal(loadCheques().find((x) => x.id === c2.id)!.status, 'received');
});

test('issued cheque against a bill: clearing pays the supplier, cancelling reverses it', () => {
  const bill: PurchaseRecord = {
    id: 'B1', kind: 'PURCHASE', vendor_name: 'Paper Mart', bill_number: 'PM/9', date: '2026-10-02', category: 'Purchases', lines: [],
    taxable: 5000, cgst: 450, sgst: 450, igst: 0, itc_eligible: true, total: 5900, amount_paid: 0,
  };
  purchasesDb.save(bill);
  const c = saveCheque({ direction: 'issued', number: '100045', bank: 'ICICI Bank', cheque_date: '2026-10-22', amount: 5900, party_name: 'Paper Mart', purchase_id: 'B1' });
  assert.equal(c.status, 'issued');
  assert.equal(c.account_payee, true);
  transitionCheque(c.id, 'presented', { date: '2026-10-23', today: TODAY });
  const r = transitionCheque(c.id, 'cleared', { date: '2026-10-24', today: TODAY });
  assert.ok(r.cheque.purchase_payment_id);
  assert.equal(purchasesDb.get('B1')!.amount_paid, 5900);
  assert.throws(() => deleteCheque(c.id), /payment was recorded/);

  const c2 = saveCheque({ direction: 'issued', number: '100046', bank: 'ICICI Bank', cheque_date: '2026-10-22', amount: 100, party_name: 'Paper Mart' });
  transitionCheque(c2.id, 'cancelled', { date: TODAY, today: TODAY, reason: 'Stop payment' });
  assert.equal(loadCheques().find((x) => x.id === c2.id)!.status, 'cancelled');
  assert.equal(paymentsDb.all().length, 1);
});

test('editing money fields is refused once a payment was recorded', () => {
  setTable(KEYS.invoices, [invoice()]);
  const c = saveCheque(received());
  transitionCheque(c.id, 'cleared', { date: '2026-10-21', today: TODAY });
  const live = loadCheques()[0];
  assert.throws(() => saveCheque({ ...live, amount: 1 }), /Bounce or cancel/);
  saveCheque({ ...live, notes: 'Collected at office' });
  assert.equal(loadCheques()[0].notes, 'Collected at office');
});

test('PDC reminders and notification-bell notices', () => {
  const base = { bank: 'SBI', party_name: 'Acme', amount: 1000, created_at: '' };
  const cheques = [
    { ...base, id: 'a', direction: 'received', number: '000001', cheque_date: '2026-10-24', status: 'received' },
    { ...base, id: 'b', direction: 'received', number: '000002', cheque_date: '2026-10-26', status: 'received' },
    { ...base, id: 'c', direction: 'received', number: '000003', cheque_date: '2026-11-15', status: 'received' },
    { ...base, id: 'd', direction: 'received', number: '000004', cheque_date: '2026-07-28', status: 'received' },
    { ...base, id: 'e', direction: 'issued', number: '000005', cheque_date: '2026-10-25', status: 'issued' },
    { ...base, id: 'f', direction: 'received', number: '000006', cheque_date: '2026-10-20', status: 'cleared' },
  ] as Cheque[];
  const r = pdcReminders(cheques, TODAY);
  assert.deepEqual(r.map((x) => [x.kind, x.cheques.map((c) => c.id)]), [
    ['stale', ['d']],
    ['deposit-now', ['a']],
    ['deposit-soon', ['b']],
    ['issued-due', ['e']],
  ]);
  const ctx = { now: new Date(2026, 9, 24, 10), invoices: [], clients: [], profile: null, lastBackup: null, storageUsedBytes: 0, storageQuotaBytes: 0, cheques } as NotificationContext;
  const notes = chequeProvider(ctx);
  assert.equal(notes.length, 4);
  assert.equal(notes[0].severity, 'critical');
  assert.match(notes[0].detail, /valid till 27 Oct 2026|valid till/);
  assert.match(notes[2].title, /post-dated cheque due within 3 days/);
  assert.ok(notes.every((n) => n.href?.startsWith('/cheques')));
  // Wired into the bell's built-in providers.
  assert.ok(collectNotifications(ctx).some((n) => n.id.startsWith('cheque-deposit-now:')));
  // Changing the date gives a new notice id (dismissing one does not hide the next).
  const moved = chequeProvider({ ...ctx, cheques: cheques.map((c) => (c.id === 'a' ? { ...c, cheque_date: '2026-10-23' } : c)) });
  assert.notEqual(moved[1].id, notes[1].id);
});

test('summary, filters and CSV', () => {
  saveCheque(received({ invoice_id: undefined }));
  saveCheque(received({ number: '000009', cheque_date: '2026-12-01', invoice_id: undefined }));
  saveCheque({ direction: 'issued', number: '100001', bank: 'ICICI', cheque_date: '2026-10-30', amount: 500, party_name: 'Vendor' });
  const all = loadCheques();
  const s = chequeSummary(all, TODAY);
  assert.deepEqual(s.inHand, { count: 1, amount: 11800 });
  assert.deepEqual(s.postDatedIn, { count: 1, amount: 11800 });
  assert.deepEqual(s.issuedOpen, { count: 1, amount: 500 });
  assert.equal(filterCheques(all, { status: 'pdc' }, TODAY).length, 2);
  assert.equal(filterCheques(all, { direction: 'issued' }, TODAY).length, 1);
  assert.equal(filterCheques(all, { query: 'vendor' }, TODAY).length, 1);
  assert.match(chequesCsv(all), /Valid till/);
});

test('cheque printing: Indian words, figures, DDMMYYYY boxes, crossing and offsets', () => {
  assert.equal(chequeWords(123456.5), 'One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only');
  assert.equal(chequeWords(10000000), 'One Crore Only');
  assert.equal(chequeFigures(123456), '**1,23,456/-');
  assert.equal(chequeFigures(123456.5), '**1,23,456.50');
  assert.deepEqual(chequeDateDigits('2026-10-05'), ['0', '5', '1', '0', '2', '0', '2', '6']);
  const [a, b] = splitWords('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only', 52);
  assert.ok(a.length <= 52 && !a.endsWith(' ') && b.length > 0);

  const p = buildChequePrint({ party_name: 'Paper Mart', amount: 5900, cheque_date: '2026-10-22', account_payee: true });
  const byField = Object.fromEntries(p.items.map((i) => [i.field, i]));
  assert.equal(byField.payee.text, 'Paper Mart');
  assert.equal(byField.words1.text, 'Five Thousand Nine Hundred Only');
  assert.equal(byField.date.text, '22102026');
  assert.equal(byField.crossing.text, 'A/C PAYEE');
  const shifted = buildChequePrint({ party_name: 'X', amount: 1, cheque_date: '2026-10-22', account_payee: false }, normalizeChequePrefs({ offsetX: 2, offsetY: -1.5, fields: { payee: { dx: 1, dy: 0 } } }));
  const sf = Object.fromEntries(shifted.items.map((i) => [i.field, i]));
  assert.equal(sf.payee.x, byField.payee.x + 3);
  assert.equal(sf.payee.y, byField.payee.y - 1.5);
  assert.equal(sf.crossing, undefined, 'no crossing when A/C payee is off');
  assert.equal(normalizeChequePrefs({ offsetX: 99 }).offsetX, 30, 'offsets are clamped');

  const html = chequeHtml(p, { guide: true });
  assert.match(html, /@page \{ size: 203mm 92mm; margin: 0; \}/);
  assert.match(html, /Paper Mart/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(chequeHtml(buildChequePrint({ party_name: '<b>x</b>', amount: 1, cheque_date: '2026-01-01' })), /<b>x<\/b>/);
});
