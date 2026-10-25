/**
 * 8G invoicing UX & insights: payment schedules (and their readers: reminders, ageing, cash forecast),
 * quote acceptance snapshots (immutable), client-copy response links, SmartFind parsing + search,
 * insights, last rate, margin, Today card, counter receipt (A3), save choice (A4), write-off, views.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { useInvoiceStore } from '../src/store/useInvoiceStore.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import { effectiveDueDate, instalmentAmounts, instalmentStatus, openInstalments } from '../src/lib/payment-schedule.ts';
import { normalizeSchedule } from '../src/lib/doc-snapshots.ts';
import { daysToDue, depositAmount, presetSchedule, scheduleIssues } from '../src/lib/schedule-tools.ts';
import { acceptIssues, buildAcceptance, responseLinks, sanitizeAcceptance, setQuoteAcceptance } from '../src/lib/quote-acceptance.ts';
import { buildClientCopyHtml } from '../src/lib/client-copy.ts';
import { amountMatches, detectId, editDistance, parseAmountQuery, parseMoney, parseQuery, typoScore } from '../src/lib/smart-find.ts';
import { buildIndex, searchAll } from '../src/lib/search.ts';
import { buildInsights, dsoAt, monthWindow } from '../src/lib/insights.ts';
import { lastRateFor, lastRateToApply, lastRatesFor, LAST_RATE_BASIS } from '../src/lib/last-rate.ts';
import { buildUnitCosts, documentMargin, marginTone } from '../src/lib/margin.ts';
import { modeOf, todaySummary, todayText } from '../src/lib/today.ts';
import { cleanReference, fullyPaidAmount, splitCounterReceipt, WALK_IN_NAME } from '../src/lib/counter-receipt.ts';
import { WALK_IN_NAME as POS_WALK_IN } from '../src/lib/pos.ts';
import { getSaveChoice, normalizeSaveChoice, SAVE_CHOICE_KEY, setSaveChoice } from '../src/lib/save-choice.ts';
import { DEVICE_LOCAL_KEYS } from '../src/lib/storage.ts';
import { bulkWriteOff, writeOffBlock } from '../src/lib/write-off.ts';
import { loadBooksData, profitAndLoss, buildVouchers } from '../src/lib/books.ts';
import { deleteView, loadPackSchedule, loadViews, monthPeriod, packDue, previousMonth, savePackSchedule, saveView, viewHref } from '../src/lib/report-views.ts';
import { periodForPreset } from '../src/lib/books.ts';
import { pendingReminders } from '../src/lib/reminders.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { partyOutstanding, sendMessage, sheetMessage } from '../src/lib/send-summary.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const inv = (o: Partial<InvoiceRecord>): InvoiceRecord => ({
  id: 'i1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-09-01', due_date: '2026-09-30',
  currency: 'INR', client: { name: 'Acme', email: '', address: '', city: '', zip: '' }, items: [], total: 10000, balance_due: 10000, amount_paid: 0,
  subtotal: 0, discount_amount: 0, taxable_value: 10000, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, notes: '', terms: '',
  ...o,
} as InvoiceRecord);

/* ── Payment schedule ───────────────────────────────────────── */

test('normalizeSchedule keeps valid rows, one basis each, sorted by date', () => {
  const s = normalizeSchedule([
    { id: 'b', due_date: '2026-10-30', percent: 70 },
    { id: 'a', due_date: '2026-10-01', amount: 3000, label: ' Deposit ' },
    { id: 'x', due_date: 'bad', percent: 10 },
    { id: 'y', due_date: '2026-11-01' },
    'junk',
  ]);
  assert.deepEqual(s.map((r) => r.id), ['a', 'b']);
  assert.equal(s[0].label, 'Deposit');
  assert.equal(s[0].amount, 3000);
  assert.equal(s[1].percent, 70);
  assert.deepEqual(normalizeSchedule(undefined), []);
});

test('instalment amounts: percent of total, last takes the remainder when the split is 100%', () => {
  const sched = presetSchedule('thirds', '2026-09-01');
  const amounts = instalmentAmounts(sched, 1000);
  assert.deepEqual(amounts, [340, 330, 330]);
  assert.equal(instalmentAmounts(presetSchedule('deposit30', '2026-09-01'), 999.99).reduce((a, b) => a + b, 0), 999.99);
  assert.equal(depositAmount(presetSchedule('deposit50', '2026-09-01'), 5000), 2500);
  assert.equal(sched[1].due_date, '2026-10-01');
  assert.deepEqual(scheduleIssues([{ id: 'a', due_date: '2026-09-01', percent: 60 }, { id: 'b', due_date: '2026-09-02', percent: 60 }], 100), ['pct', 'over']);
  assert.deepEqual(scheduleIssues([{ id: 'a', due_date: '2026-09-01', amount: 40 }], 100), ['under']);
});

test('received money settles instalments in due-date order; effective due date follows the first open one', () => {
  const sched = presetSchedule('deposit30', '2026-09-01'); // 30% on 1 Sep, 70% on 1 Oct
  const st = instalmentStatus(sched, 10000, 3500);
  assert.deepEqual(st.map((x) => [x.amount, x.paid, x.open]), [[3000, 3000, 0], [7000, 500, 6500]]);
  const unpaid = inv({ payment_schedule: sched });
  assert.equal(effectiveDueDate(unpaid), '2026-09-01');
  const partly = inv({ payment_schedule: sched, amount_paid: 3000, balance_due: 7000 });
  assert.equal(effectiveDueDate(partly), '2026-10-01');
  assert.equal(openInstalments(partly).length, 1);
  assert.equal(effectiveDueDate(inv({})), '2026-09-30');
});

test('schedule feeds reminders and ageing (earliest unpaid instalment)', () => {
  const sched = [{ id: 'a', due_date: '2026-09-05', percent: 50 }, { id: 'b', due_date: '2026-12-31', percent: 50 }];
  const doc = inv({ payment_schedule: sched, due_date: '2026-12-31' });
  const pending = pendingReminders([doc], new Date(2026, 9, 25));
  assert.equal(pending.length, 1, 'the overdue deposit is chased although the final due date is in December');
  assert.ok(pending[0].daysToDue < 0);
  const rep = buildReceivables({ invoices: [doc], payments: [] }, { now: new Date(2026, 9, 25) });
  assert.equal(rep.parties[0].bills[0].dueDate, '2026-09-05');
  assert.ok(rep.parties[0].bills[0].daysOverdue > 40);
});

test('schedule and acceptance survive normalisation; absent on legacy rows', () => {
  const sched = [{ id: 'a', due_date: '2026-09-05', percent: 50, label: 'Deposit' }];
  const acc = { signer: 'Ravi', signed_at: '2026-09-02T10:00:00.000Z', method: 'counter', amount: 500, signature: 'data:image/png;base64,AAAA' };
  const r = normalizeRecord({ ...inv({ doc_type: 'QUOTATION' }), payment_schedule: sched, acceptance: acc } as never);
  assert.deepEqual(r.payment_schedule, sched);
  assert.deepEqual(r.acceptance, acc);
  const legacy = normalizeRecord(inv({}) as never);
  assert.ok(!('payment_schedule' in legacy) && !('acceptance' in legacy));
});

test('daysToDue counts local days', () => {
  assert.equal(daysToDue('2026-10-30', new Date(2026, 9, 25, 23, 30)), 5);
  assert.equal(daysToDue('2026-10-20', new Date(2026, 9, 25)), -5);
  assert.equal(daysToDue(undefined), null);
});

/* ── Quote acceptance ───────────────────────────────────────── */

const SIG = 'data:image/png;base64,iVBORw0KGgo=';

test('acceptance: sanitize, issues, build', () => {
  assert.equal(sanitizeAcceptance({ signer: '', signed_at: '2026-01-01T00:00:00Z' }), null);
  assert.equal(sanitizeAcceptance({ signer: 'A', signed_at: '2026-01-01T00:00:00Z', signature: 'javascript:alert(1)' })?.signature, undefined);
  const q = inv({ doc_type: 'QUOTATION', total: 4200 });
  assert.deepEqual(acceptIssues(q, { signer: 'Ravi' }), ['signature']);
  assert.deepEqual(acceptIssues(q, { signer: 'Ravi', method: 'remote' }), []);
  assert.deepEqual(acceptIssues(inv({}), { signer: 'Ravi' }), ['notQuote']);
  const a = buildAcceptance(q, { signer: ' Ravi ', signature: SIG, now: new Date('2026-09-02T10:00:00Z') });
  assert.deepEqual(a, { signer: 'Ravi', signed_at: '2026-09-02T10:00:00.000Z', method: 'counter', amount: 4200, signature: SIG });
});

test('counter acceptance is snapshotted once: Accepted, audited, and later edits never change it', () => {
  const q = createViaStore({ docType: 'QUOTATION', date: '2026-09-01', lines: [{ qty: 1, rate: 1000 }] });
  const acc = buildAcceptance(q, { signer: 'Ravi', signature: SIG, now: new Date('2026-09-02T10:00:00Z') });
  setQuoteAcceptance(q.id, acc);
  const after = reload(q.id);
  assert.equal(after.quote_status, 'Accepted');
  assert.deepEqual(after.acceptance, acc);
  assert.throws(() => setQuoteAcceptance(q.id, { ...acc, signer: 'Someone else' }), /already accepted/);
  // Edit the quote (new rate) through the editor: total changes, the acceptance snapshot does not.
  const st = useInvoiceStore.getState();
  st.loadInvoice(q.id);
  const line = useInvoiceStore.getState().items[0];
  useInvoiceStore.getState().updateItem(line.id, 'rate', 2000);
  useInvoiceStore.getState().patch({ acceptance: { ...acc, amount: 99999, signer: 'Forged' } });
  const res = useInvoiceStore.getState().saveInvoice();
  assert.ok(res.ok);
  const edited = reload(q.id);
  assert.notEqual(edited.total, after.total);
  assert.deepEqual(edited.acceptance, acc, 'acceptance is immutable through edits');
  const log = getTable<{ summary: string }>('audit_log');
  assert.ok(log.some((r) => /accepted by Ravi/.test(r.summary)), 'acceptance is audited');
});

test('client copy of a quotation gets Accept / Request changes links (wa.me or mailto only)', () => {
  const q = inv({ doc_type: 'QUOTATION', invoice_number: 'QT/FY26-27/0004', sender: { companyPhone: '+91 98200 12345', companyEmail: 'a@b.in' } as never });
  const links = responseLinks(q, '₹4,200.00');
  assert.ok(links && links.accept.startsWith('https://wa.me/919820012345?text='));
  assert.ok(decodeURIComponent(links!.accept).includes('QT/FY26-27/0004') && decodeURIComponent(links!.accept).includes('₹4,200.00'));
  const mail = responseLinks({ ...q, sender: { companyEmail: 'a@b.in' } } as never, '₹1');
  assert.ok(mail?.accept.startsWith('mailto:a@b.in?subject='));
  assert.equal(responseLinks(inv({}), '₹1'), null);
  const html = buildClientCopyHtml({ title: 'Q', paperHtml: '<div></div>', css: '', business: 'B', generatedOn: 'today', respond: links });
  assert.ok(html.includes('>Accept</a>') && html.includes('Request changes') && !/<script/i.test(html));
  const bad = buildClientCopyHtml({ title: 'Q', paperHtml: '', css: '', business: 'B', generatedOn: 'x', respond: { accept: 'javascript:alert(1)', changes: 'https://evil.example' } });
  assert.ok(!bad.includes('>Accept</a>'));
});

/* ── SmartFind ──────────────────────────────────────────────── */

test('amount parsing: units, ranges, comparisons; bare digits stay text', () => {
  assert.equal(parseMoney('12.5k'), 12500);
  assert.equal(parseMoney('₹1,20,000'), 120000);
  assert.equal(parseMoney('1.2L'), 120000);
  assert.equal(parseMoney('2cr'), 20000000);
  assert.deepEqual(parseAmountQuery('>50k'), { op: 'gt', min: 50000.001, max: Infinity, raw: '>50k' });
  assert.equal(parseAmountQuery('<=1000')?.max, 1000);
  assert.deepEqual(parseAmountQuery('10k-20k'), { op: 'range', min: 10000, max: 20000, raw: '10k-20k' });
  assert.equal(parseAmountQuery('12500'), null);
  assert.equal(parseAmountQuery('0007'), null);
  assert.equal(parseAmountQuery('2026-10-01'), null);
  assert.ok(amountMatches(parseAmountQuery('12.5k')!, [12499.6]));
  assert.ok(!amountMatches(parseAmountQuery('>50k')!, [50000]));
  const pq = parseQuery('acme > 50k 27AABCU9603R1ZM');
  assert.equal(pq.text, 'acme');
  assert.equal(pq.amount?.op, 'gt');
  assert.equal(pq.ids[0]?.kind, 'gstin');
});

test('id detection and typo tolerance', () => {
  assert.equal(detectId('aabcu9603r')?.kind, 'pan');
  assert.equal(detectId('a'.repeat(64))?.kind, 'irn');
  assert.equal(detectId('HDFCN52026102512345')?.kind, 'utr');
  assert.equal(detectId('Consulting'), null);
  assert.equal(editDistance('sharma', 'sharmaa'), 1);
  assert.equal(editDistance('kumar', 'kumra'), 1, 'transposition is one edit');
  assert.ok(typoScore('sharmaa', 'sharma traders') > 0);
  assert.equal(typoScore('xyzq', 'sharma traders'), 0);
  assert.equal(typoScore('abc', 'abd'), 0, 'short tokens are never fuzzed');
});

test('searchAll finds bills, payments (UTR), vendors, cheques, by amount and with typos', () => {
  const NOW = new Date(2026, 9, 25);
  const data = {
    invoices: [inv({ id: 'a', total: 11800, client: { name: 'Sharma Traders', email: '', address: '', city: '', zip: '' } }), inv({ id: 'b', invoice_number: 'INV/FY26-27/0002', total: 64000 })],
    clients: [], items: [],
    vendors: [{ id: 'v1', name: 'Kumar Steel', gstin: '27AABCU9603R1ZM' }],
    bills: [{ id: 'p1', bill_number: 'KS/88', vendor_id: 'v1', date: '2026-10-01', total: 52000 }],
    payments: [{ id: 't1', invoice_id: 'a', amount: 11800, method: 'UPI', reference: 'HDFCN52026102512345', date: '2026-10-02', receipt_number: 'RCPT/FY26-27/0001' } as Payment],
    cheques: [{ id: 'c1', number: '000123', party_name: 'Kumar Steel', amount: 52000, bank: 'SBI', cheque_date: '2026-10-05', status: 'issued' }],
  };
  assert.equal(searchAll('sharmaa', { data, now: NOW }).find((r) => r.group === 'invoices')?.id, 'inv:a', 'typo finds the invoice');
  assert.equal(searchAll('HDFCN52026102512345', { data, now: NOW })[0]?.id, 'pay:t1', 'UTR finds the payment');
  const big = searchAll('>50k', { data, now: NOW }).map((r) => r.id);
  assert.ok(big.includes('inv:b') && big.includes('bill:p1') && big.includes('chq:c1') && !big.includes('inv:a'), big.join(','));
  assert.ok(searchAll('kumar 52k', { data, now: NOW }).some((r) => r.id === 'bill:p1'));
  assert.ok(searchAll('27AABCU9603R1ZM', { data, now: NOW }).some((r) => r.id === 'vendor:v1'));
  assert.equal(searchAll('0002', { data, now: NOW })[0]?.id, 'inv:b', 'invoice sequence search still works');
  assert.equal(buildIndex({ ...data }, NOW).length, 6);
});

/* ── Insights ───────────────────────────────────────────────── */

test('insights are deterministic and compare this month with the 3-month average', () => {
  const month = (m: string, total: number, id: string, client = 'Acme') => inv({ id, invoice_number: id, issue_date: `2026-${m}-05`, due_date: `2026-${m}-20`, total, taxable_value: total, client: { name: client, email: '', address: '', city: '', zip: '' } });
  const invoices = [month('07', 10000, 'j'), month('08', 10000, 'a'), month('09', 10000, 's'), month('10', 9000, 'o1'), month('10', 6000, 'o2', 'Zen')];
  const purchases = [
    { id: 'p7', date: '2026-07-10', total: 1000, taxable: 1000, category: 'Rent', kind: 'EXPENSE' },
    { id: 'p8', date: '2026-08-10', total: 1000, taxable: 1000, category: 'Rent', kind: 'EXPENSE' },
    { id: 'p9', date: '2026-09-10', total: 1000, taxable: 1000, category: 'Rent', kind: 'EXPENSE' },
    { id: 'p10', date: '2026-10-10', total: 5000, taxable: 5000, category: 'Rent', kind: 'EXPENSE' },
  ];
  const input = { invoices, payments: [], purchases, stock: [{ name: 'Widget', qty: 2, reorder: 5 }] };
  const a = buildInsights(input, '2026-10-25');
  const b = buildInsights(input, '2026-10-25');
  assert.deepEqual(a, b);
  const rev = a.find((c) => c.id === 'revenue')!;
  assert.equal(rev.value, 15000);
  assert.equal(rev.baseline, 10000);
  assert.equal(rev.tone, 'good');
  const top = a.find((c) => c.id === 'topCustomers')!;
  assert.deepEqual(top.rows.map((r) => r.label), ['Acme', 'Zen']);
  const spike = a.find((c) => c.id === 'expenseSpike')!;
  assert.equal(spike.rows[0]?.label, 'Rent');
  assert.equal(a.find((c) => c.id === 'stockRisk')?.rows[0]?.label, 'Widget');
  assert.ok(a.every((c) => c.href.startsWith('/')));
  assert.deepEqual(monthWindow('2026-01-15').previous, ['2025-12', '2025-11', '2025-10']);
});

test('insights: DSO and slower payers', () => {
  const docs = [inv({ id: 'x', issue_date: '2026-09-01', total: 9000 })];
  assert.equal(dsoAt(docs, [], '2026-10-25'), 90);
  const old = inv({ id: 'o', issue_date: '2026-03-01', total: 1000 });
  const recent = inv({ id: 'r', issue_date: '2026-08-01', total: 1000 });
  const pays = [
    { id: 'p1', invoice_id: 'o', amount: 1000, method: 'UPI', date: '2026-03-06' },
    { id: 'p2', invoice_id: 'r', amount: 1000, method: 'UPI', date: '2026-09-15' },
  ] as Payment[];
  const cards = buildInsights({ invoices: [old, recent], payments: pays, purchases: [] }, '2026-10-25');
  const slow = cards.find((c) => c.id === 'slowPayers')!;
  assert.equal(slow.rows[0]?.label, 'Acme');
  assert.equal(slow.rows[0]?.value, 45);
});

/* ── Last rate & margin ─────────────────────────────────────── */

test('last rate to this party: latest issued sale, same party, same currency', () => {
  const line = (rate: number, unit = 'NOS') => ({ id: 'l', name: 'Rice 5 kg', quantity: 1, rate, unit } as never);
  const docs = [
    inv({ id: 'a', issue_date: '2026-08-01', items: [line(300)] }),
    inv({ id: 'b', issue_date: '2026-09-10', items: [line(320)] }),
    inv({ id: 'c', issue_date: '2026-10-01', items: [line(999)], status: 'Draft' }),
    inv({ id: 'd', issue_date: '2026-10-02', items: [line(250)], client: { name: 'Other', email: '', address: '', city: '', zip: '' } }),
  ];
  const last = lastRateFor(docs, { name: 'acme ' }, 'RICE 5 KG');
  assert.equal(last?.rate, 320);
  assert.equal(last?.date, '2026-09-10');
  assert.equal(lastRatesFor(docs, { name: 'Acme' }, { excludeId: 'b' }).get('rice 5 kg')?.rate, 300);
  assert.equal(lastRateToApply({ rate: 280 }, last), 320);
  assert.equal(lastRateToApply({ rate: 280, price_basis: 'Wholesale' }, last), null, 'a price level wins');
  assert.equal(lastRateToApply({ rate: 280, unit: 'BOX' }, last), null, 'another unit is not the same rate');
  assert.equal(LAST_RATE_BASIS, 'Last rate');
});

test('picking an item applies the last rate to this party in the editor', async () => {
  createViaStore({ date: '2026-09-01', lines: [{ name: 'Rice 5 kg', qty: 1, rate: 320 }] });
  const { pickCatalogItem } = await import('../src/components/creator/pricing-actions.ts');
  const st = useInvoiceStore.getState();
  st.newDraft('INVOICE');
  useInvoiceStore.getState().setClient(clientMH);
  const id = useInvoiceStore.getState().items[0].id;
  pickCatalogItem(id, { name: 'Rice 5 kg', rate: 300, hsn: '1006', unit: 'NOS' });
  const l = useInvoiceStore.getState().items[0];
  assert.equal(l.rate, 320);
  assert.equal(l.price_basis, LAST_RATE_BASIS);
});

test('margin: latest purchase cost per base unit, then standard / opening; tone', () => {
  const costs = buildUnitCosts(
    [
      { id: 'p1', date: '2026-08-01', lines: [{ name: 'Widget', quantity: 10, rate: 50 }], total: 500 },
      { id: 'p2', date: '2026-09-01', lines: [{ name: 'Widget', quantity: 2, rate: 1200, unit_factor: 24 }], total: 2400 },
    ],
    [{ name: 'Gadget', opening_rate: 80 }, { name: 'Widget', opening_rate: 1 }],
  );
  assert.equal(costs.get('widget')?.cost, 50);
  assert.equal(costs.get('widget')?.basis, 'purchase');
  assert.equal(costs.get('gadget')?.basis, 'opening');
  const m = documentMargin([{ name: 'Widget', quantity: 2, rate: 75 }, { name: 'Unknown', quantity: 1, rate: 10 }], costs);
  assert.deepEqual([m.revenue, m.cost, m.margin, m.pct, m.uncosted], [150, 100, 50, 33.33, 1]);
  assert.equal(marginTone(-1), 'loss');
  assert.equal(marginTone(5), 'thin');
  assert.equal(marginTone(null), 'none');
});

/* ── Today, send sheet ──────────────────────────────────────── */

test('Today card: sales, collections by mode, udhaar, expenses', () => {
  const docs = [inv({ id: 'a', issue_date: '2026-10-25', total: 1000, balance_due: 400, amount_paid: 600 }), inv({ id: 'b', issue_date: '2026-10-24', total: 500 })];
  const pays = [
    { id: 'p1', invoice_id: 'a', amount: 500, method: 'Cash', date: '2026-10-25' },
    { id: 'p2', invoice_id: 'a', amount: 100, method: 'UPI', date: '2026-10-25' },
    { id: 'p3', invoice_id: 'b', amount: 50, method: 'Bank Transfer', date: '2026-10-25', write_off: true },
  ] as Payment[];
  const s = todaySummary({ invoices: docs, payments: pays, purchases: [{ id: 'e', date: '2026-10-25', total: 200, kind: 'EXPENSE', category: 'Tea' }], cashInHand: 900 }, '2026-10-25');
  assert.deepEqual([s.sales, s.bills, s.cash, s.upi, s.bank, s.udhaar, s.expenses], [1000, 1, 500, 100, 0, 400, 200]);
  assert.equal(modeOf('PhonePe'), 'upi');
  assert.ok(todayText(s, 'Shop').includes('Udhaar given'));
});

test('send sheet message: balance, party outstanding, next instalment and UPI link', () => {
  const a = inv({ id: 'a', balance_due: 4000, amount_paid: 6000, payment_schedule: [{ id: 'x', due_date: '2026-11-01', percent: 100 }] });
  const b = inv({ id: 'b', invoice_number: 'INV/FY26-27/0002', balance_due: 1000 });
  const out = partyOutstanding([a, b], a.client);
  assert.deepEqual(out, { total: 5000, bills: 2 });
  const text = sheetMessage(sendMessage(a, out), 'upi://pay?pa=x@y');
  assert.ok(/Total outstanding on your account: ₹5,000/.test(text) && /Next instalment/.test(text) && /upi:\/\/pay/.test(text));
});

/* ── A3 counter receipt, A4 save choice, A6 walk-in ─────────── */

test('counter receipt split: the unbacked part becomes a receipt with the chosen mode', () => {
  const r = inv({ amount_paid: 1000, balance_due: 0, total: 1000 });
  assert.deepEqual(splitCounterReceipt(r, 0, null).amount, 0);
  const s = splitCounterReceipt(r, 300, 'UPI');
  assert.equal(s.amount, 700);
  assert.equal(s.record.amount_paid, 300);
  assert.equal(s.record.balance_due, 700);
  assert.equal(splitCounterReceipt(inv({ status: 'Draft', amount_paid: 10 }), 0, 'Cash').amount, 0);
  assert.equal(fullyPaidAmount({ total: 1000, tds_amount: 100 }), 900);
  assert.equal(cleanReference('Cash', 'x'), undefined);
  assert.equal(cleanReference('UPI', ' 1234 '), '1234');
  assert.equal(WALK_IN_NAME, POS_WALK_IN);
});

test('editor save with a payment mode records the receipt with that method (and UTR)', () => {
  const st = useInvoiceStore.getState();
  st.newDraft('INVOICE');
  const s = () => useInvoiceStore.getState();
  s().setClient(clientMH);
  s().setDates('2026-09-01', '2026-09-01');
  const id = s().items[0].id;
  s().updateItem(id, 'name', 'Item');
  s().updateItem(id, 'quantity', 1);
  s().updateItem(id, 'rate', 1000);
  useInvoiceStore.setState({ pay_mode: 'UPI', pay_ref: 'UTR998877', fully_paid: true });
  const res = s().saveInvoice();
  assert.ok(res.ok, res.errors.join());
  const pays = localDb.payments.getAll().filter((p) => p.invoice_id === res.record!.id);
  assert.equal(pays.length, 1);
  assert.equal(pays[0].method, 'UPI');
  assert.equal(pays[0].reference, 'UTR998877');
  assert.equal(pays[0].amount, res.record!.total);
  assert.equal(reload(res.record!.id).status, 'Paid');
  assert.equal(reload(res.record!.id).amount_paid, res.record!.total, 'no double counting');
});

test('save choice is device-local and validated', () => {
  assert.equal(getSaveChoice(), 'save');
  assert.equal(setSaveChoice('print'), 'print');
  assert.equal(getSaveChoice(), 'print');
  assert.equal(normalizeSaveChoice('rm -rf'), 'save');
  assert.ok(DEVICE_LOCAL_KEYS.includes(SAVE_CHOICE_KEY), 'never in a backup');
});

/* ── Write-off ──────────────────────────────────────────────── */

test('bulk write-off settles the balance as a bad debt: not cash, an expense, audited', () => {
  const a = createViaStore({ date: '2026-09-01', lines: [{ qty: 1, rate: 1000 }] });
  const d = createViaStore({ date: '2026-09-02', lines: [{ qty: 1, rate: 500 }], asDraft: true });
  assert.equal(writeOffBlock(d), 'status');
  const r = bulkWriteOff([a.id, d.id], { date: '2026-10-01', reason: 'Shop closed' });
  assert.equal(r.done.length, 1);
  assert.equal(r.skipped.length, 1);
  assert.equal(reload(a.id).status, 'Paid');
  const p = localDb.payments.getAll().find((x) => x.invoice_id === a.id)!;
  assert.ok(p.write_off && !p.receipt_number);
  const books = loadBooksData();
  assert.ok(!buildVouchers(books).some((v) => v.id === `rcpt:${p.id}`), 'no cash / bank receipt');
  const pl = profitAndLoss(books, { start: '2026-10-01', end: '2026-10-31' });
  assert.ok(pl.totalExpenses >= a.total - 0.01, `bad debt is an expense (${pl.totalExpenses})`);
  const log = getTable<{ summary: string }>('audit_log');
  assert.ok(log.some((l) => /Bulk write-off of 1 invoice/.test(l.summary)));
});

/* ── Views, packs, presets ──────────────────────────────────── */

test('saved views and pack schedule are device-local; pack due on the first open after the day', () => {
  const v = saveView({ name: 'Q2 P&L', route: '/books', tab: 'pnl', preset: 'custom', period: { start: '2026-07-01', end: '2026-09-30' }, prefs: { pnl: { detailed: true } as never } }, new Date(2026, 9, 1));
  assert.equal(v.length, 1);
  assert.equal(loadViews()[0].prefs?.pnl.detailed, true);
  assert.equal(viewHref(loadViews()[0]).startsWith('/books?tab=pnl&view='), true);
  saveView({ name: 'q2 p&l', route: '/books', tab: 'tb', preset: 'ytd' });
  assert.equal(loadViews().length, 1, 'same name on a route replaces');
  deleteView(loadViews()[0].id);
  assert.equal(loadViews().length, 0);
  assert.ok(!Object.keys(localStorage).some((k) => k.startsWith('mrchartist_inv_report')), 'outside the backed-up prefix');
  savePackSchedule({ day: 3, lastMonth: '', autoFolder: true });
  assert.equal(packDue(loadPackSchedule(), '2026-10-02'), null);
  assert.equal(packDue(loadPackSchedule(), '2026-10-05'), '2026-09');
  savePackSchedule({ ...loadPackSchedule(), lastMonth: '2026-09' });
  assert.equal(packDue(loadPackSchedule(), '2026-10-25'), null);
  assert.equal(previousMonth('2026-01-10'), '2025-12');
  assert.deepEqual(monthPeriod('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
});

test('MTD / QTD / YTD presets run from the period start to today', () => {
  const today = new Date(2026, 10, 14); // 14 Nov 2026
  assert.deepEqual(periodForPreset('mtd', today), { start: '2026-11-01', end: '2026-11-14' });
  assert.deepEqual(periodForPreset('qtd', today), { start: '2026-10-01', end: '2026-11-14' });
  assert.deepEqual(periodForPreset('ytd', today), { start: '2026-04-01', end: '2026-11-14' });
  assert.deepEqual(periodForPreset('ytd', new Date(2027, 1, 3)), { start: '2026-04-01', end: '2027-02-03' });
});
