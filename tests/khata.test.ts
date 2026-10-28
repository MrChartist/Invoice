/**
 * Daily khata loop (8A): FIFO allocation of a quick receipt, the all-or-nothing party receipt,
 * balance-first party rows, the WhatsApp statement, party reminders (en / Hinglish / Hindi) and
 * their queue, "₹ Given" per profile type, and the party balance snapshot printed on a bill.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH, reload, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setJson, SINGLETON_KEYS } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { buildReceivables, type PartyReceivable } from '../src/lib/receivables.ts';
import {
  balanceKind, buildPartyReminder, buildWhatsAppStatement, computePartyBalanceSnapshot, fifoAllocate, khataRows, khataTotals,
  makePartyLogEntry, makePartySnooze, overdueOf, partyReminderQueue, quickReceiptIssues, sortKhataRows,
} from '../src/lib/khata.ts';
import { savePartyReceipt } from '../src/lib/bill-allocation.ts';
import { givenModeFor, loadKhataReport, loadReceivablesInput, recordCreditGiven } from '../src/lib/khata-actions.ts';
import { nextPartyBalanceSnapshot, partyBalanceRows, partyBalanceTotal, sanitizePartyBalance } from '../src/lib/party-balance.ts';
import { buildLedger, loadLedgerInput } from '../src/lib/ledger/index.ts';
import { loadBooksData, buildVouchers } from '../src/lib/books.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const NOW = new Date(2026, 9, 25); // 25 Oct 2026

/* ── FIFO ───────────────────────────────────────────────────── */

test('fifoAllocate: oldest due first, each bill at most its outstanding, the rest on account', () => {
  const bills = [
    { id: 'b2', ref: 'INV/2', due: '2026-08-10', outstanding: 500 },
    { id: 'b1', ref: 'INV/1', due: '2026-07-01', outstanding: 300 },
    { id: 'b3', ref: 'INV/3', due: '2026-09-01', outstanding: 1000 },
  ];
  assert.deepEqual(fifoAllocate(bills, 650), { allocations: [{ bill_id: 'b1', ref: 'INV/1', amount: 300 }, { bill_id: 'b2', ref: 'INV/2', amount: 350 }], onAccount: 0 });
  assert.deepEqual(fifoAllocate(bills, 2000.5).allocations.map((a) => a.amount), [300, 500, 1000]);
  assert.equal(fifoAllocate(bills, 2000.5).onAccount, 200.5);
  assert.deepEqual(fifoAllocate([], 99), { allocations: [], onAccount: 99 });
  assert.deepEqual(fifoAllocate(bills, 0), { allocations: [], onAccount: 0 });
  // Same due date keeps the listed order.
  const tie = [{ id: 'x', ref: 'X', due: '2026-01-01', outstanding: 10 }, { id: 'y', ref: 'Y', due: '2026-01-01', outstanding: 10 }];
  assert.deepEqual(fifoAllocate(tie, 15).allocations.map((a) => [a.bill_id, a.amount]), [['x', 10], ['y', 5]]);
});

test('quickReceiptIssues: over a bill, over the total, unknown bill, zero amount', () => {
  const bills = [{ id: 'b1', ref: 'INV/1', due: '2026-07-01', outstanding: 300 }];
  assert.deepEqual(quickReceiptIssues(300, [{ bill_id: 'b1', ref: 'INV/1', amount: 300 }], bills), []);
  assert.match(quickReceiptIssues(500, [{ bill_id: 'b1', ref: 'INV/1', amount: 400 }], bills).join(' '), /only/);
  assert.match(quickReceiptIssues(100, [{ bill_id: 'b1', ref: 'INV/1', amount: 200 }], bills).join(' '), /more than the amount/);
  assert.match(quickReceiptIssues(100, [{ bill_id: 'zz', ref: 'ZZ', amount: 50 }], bills).join(' '), /not an open bill/);
  assert.match(quickReceiptIssues(0, [], bills).join(' '), /above zero/);
});

/* ── Party receipt: one save, every report agrees ─────────────── */

function twoBills() {
  const old = createViaStore({ date: '2026-07-01', due: '2026-07-15', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const recent = createViaStore({ date: '2026-09-01', due: '2026-09-15', lines: [{ qty: 1, rate: 2000, tax: 0 }] });
  return { old, recent };
}

test('savePartyReceipt: FIFO rows tagged with the party, remainder on account; receivables, ledger and cash book agree', () => {
  const { old, recent } = twoBills();
  const before = loadKhataReport(NOW).report.parties.find((p) => p.key === clientMH.id)!;
  assert.equal(before.net, 3000);
  const split = fifoAllocate(before.bills.map((b) => ({ id: b.invoiceId, ref: b.number, due: b.dueDate, outstanding: b.outstanding })), 3500);
  const rows = savePartyReceipt({ client: { id: clientMH.id, name: clientMH.name }, amount: 3500, method: 'UPI', reference: 'UTR123', date: '2026-10-20', allocations: split.allocations });
  assert.deepEqual(rows.map((r) => [r.invoice_id || 'onacc', r.amount]), [[old.id, 1000], [recent.id, 2000], ['onacc', 500]]);
  assert.ok(rows.every((r) => r.client_id === clientMH.id && r.client_name === clientMH.name && r.reference === 'UTR123'));
  assert.ok(rows.every((r) => /^RCPT\/FY26-27\/\d{4}$/.test(r.receipt_number ?? '')), 'every row carries a receipt number');
  assert.equal(new Set(rows.map((r) => r.receipt_number)).size, 3, 'no receipt number twice');
  assert.equal(reload(old.id).status, 'Paid');
  assert.equal(reload(recent.id).status, 'Paid');
  const after = loadKhataReport(NOW).report.parties.find((p) => p.key === clientMH.id)!;
  assert.equal(after.net, -500, 'the extra ₹500 is an advance');
  assert.equal(balanceKind(after.net), 'advance');
  // Books: three receipts from the party, ₹3,500 in total, none of them twice.
  const receipts = buildVouchers(loadBooksData()).filter((v) => v.type === 'Receipt');
  assert.equal(receipts.length, 3);
  assert.equal(receipts.reduce((s, v) => s + v.credit, 0), 3500);
  assert.ok(receipts.every((v) => v.party === clientMH.name), 'every receipt is posted to the party');
  const ledger = buildLedger(loadLedgerInput());
  assert.equal(ledger.vouchers.filter((x) => x.kind === 'Receipt').length, 3);
});

test('savePartyReceipt is all or nothing: a locked bill refuses the whole receipt', () => {
  const { old, recent } = twoBills();
  setJson(SINGLETON_KEYS.settings, { ...localDb.settings.get(), lock_until: '2026-07-31' });
  assert.throws(() => savePartyReceipt({
    client: { id: clientMH.id, name: clientMH.name }, amount: 3000, method: 'Cash', date: '2026-10-20',
    allocations: [{ bill_id: recent.id, ref: recent.invoice_number, amount: 2000 }, { bill_id: old.id, ref: old.invoice_number, amount: 1000 }],
  }), /lock/i);
  assert.equal(getTable('transactions').length, 0);
  assert.equal(reload(recent.id).amount_paid ?? 0, 0);
  // On account inside the locked period is refused too.
  assert.throws(() => savePartyReceipt({ client: { id: clientMH.id, name: clientMH.name }, amount: 100, method: 'Cash', date: '2026-07-10', allocations: [] }), /lock/i);
  assert.equal(getTable('transactions').length, 0);
});

test('savePartyReceipt needs payment.record (a viewer is refused)', () => {
  twoBills();
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => savePartyReceipt({ client: { id: clientMH.id, name: clientMH.name }, amount: 100, method: 'Cash', date: '2026-10-20', allocations: [] }));
  assert.equal(getTable('transactions').length, 0);
});

/* ── Balance-first rows ─────────────────────────────────────── */

const bill = (id: string, number: string, outstanding: number, daysOverdue: number, issueDate = '2026-07-01') => ({
  invoiceId: id, number, issueDate, dueDate: issueDate, total: outstanding, paid: 0, outstanding, daysOverdue, bucket: 'Not due' as const,
});
function party(over: Partial<PartyReceivable>): PartyReceivable {
  return {
    key: 'p', name: 'Ramesh Kirana', bills: [], gross: 0, creditNotes: 0, advances: 0, net: 0,
    buckets: { 'Not due': 0, '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 }, oldestOverdueDays: 0, entries: [], ...over,
  };
}

test('khataRows / totals / sort: to collect, advance, settled; overdue capped at the net', () => {
  const report = {
    currency: 'INR',
    parties: [
      party({ key: 'a', name: 'Asha', net: 1200, bills: [bill('i1', 'INV/1', 1200, 40)], oldestOverdueDays: 40 }),
      party({ key: 'b', name: 'Bala', net: -300, advances: 300 }),
      party({ key: 'c', name: 'Chetan', net: 200, bills: [bill('i2', 'INV/2', 500, 10)], creditNotes: 300, oldestOverdueDays: 10 }),
    ],
    totals: { gross: 0, creditNotes: 0, advances: 0, net: 0, buckets: party({}).buckets, overdue: 0, billCount: 0 },
  };
  const clients = [{ id: 'a', name: 'Asha' }, { id: 'b', name: 'Bala' }, { id: 'c', name: 'Chetan' }, { id: 'd', name: 'Devi' }] as never[];
  const rows = khataRows(clients, report);
  assert.deepEqual(rows.map((r) => [r.name, r.kind, r.overdue]), [['Asha', 'collect', 1200], ['Bala', 'advance', 0], ['Chetan', 'collect', 200], ['Devi', 'settled', 0]]);
  assert.deepEqual(khataTotals(rows), { youGet: 1400, youGive: 300, overdue: 1400, overdueParties: 2 });
  assert.deepEqual(sortKhataRows(rows).map((r) => r.name), ['Asha', 'Chetan', 'Devi', 'Bala']);
  assert.deepEqual(sortKhataRows(rows, 'name').map((r) => r.name), ['Asha', 'Bala', 'Chetan', 'Devi']);
  assert.equal(overdueOf(report.parties[2]), 200);
});

/* ── WhatsApp statement ─────────────────────────────────────── */

test('WhatsApp statement: open bills, net due and a upi:// link for exactly the net', () => {
  const p = party({ net: 1500.5, bills: [bill('i1', 'INV/FY26-27/0001', 1000, 12), bill('i2', 'INV/FY26-27/0002', 800.5, 0, '2026-10-20')], advances: 300 });
  const text = buildWhatsAppStatement({ sender: SELLER, party: p, today: NOW });
  assert.match(text, /INV\/FY26-27\/0001/);
  assert.match(text, /12 days overdue/);
  assert.match(text, /Less credits \/ advances: ₹300\.00/);
  assert.match(text, /\*Net due: ₹1,500\.50\*/);
  assert.match(text, /upi:\/\/pay\?pa=chartist@upi&pn=Mr%20Chartist%20Research&am=1500\.50&cu=INR/);
  assert.doesNotMatch(buildWhatsAppStatement({ sender: { ...SELLER, upiId: '' }, party: p }), /upi:\/\//);
  assert.match(buildWhatsAppStatement({ sender: SELLER, party: party({ net: -200 }) }), /Advance with us: ₹200\.00/);
});

/* ── Party reminders ────────────────────────────────────────── */

test('buildPartyReminder: total overdue, oldest bill and a UPI link, in English, Hinglish and Hindi', () => {
  const p = party({ net: 5000, bills: [bill('i1', 'INV/1', 2000, 45, '2026-08-01'), bill('i2', 'INV/2', 1000, 5, '2026-09-10'), bill('i3', 'INV/3', 2000, 0, '2026-10-20')], oldestOverdueDays: 45 });
  const en = buildPartyReminder({ party: p, sender: SELLER, lang: 'en', today: NOW });
  assert.equal(en.amount, 3000);
  assert.equal(en.oldest?.number, 'INV/1');
  assert.match(en.body, /₹3,000\.00 is overdue/);
  assert.match(en.body, /oldest bill INV\/1 of 1 Aug 2026, 45 days overdue/);
  assert.match(en.body, /Total balance: ₹5,000\.00/);
  assert.match(en.body, /upi:\/\/pay\?pa=chartist@upi&.*am=3000\.00/);
  const hinglish = buildPartyReminder({ party: p, sender: SELLER, lang: 'hinglish', today: NOW }).body;
  assert.match(hinglish, /Namaste Ramesh Kirana ji/);
  assert.match(hinglish, /45 din se baaki/);
  const hi = buildPartyReminder({ party: p, sender: SELLER, lang: 'hi', today: NOW }).body;
  assert.match(hi, /नमस्ते Ramesh Kirana जी/);
  assert.match(hi, /₹3,000\.00 बकाया/);
  assert.match(hi, /UPI से भुगतान: upi:\/\//);
  // Balance kind (monthly preset): the whole balance, no overdue wording.
  const bal = buildPartyReminder({ party: p, sender: SELLER, kind: 'balance', lang: 'en', today: NOW });
  assert.equal(bal.amount, 5000);
  assert.match(bal.body, /balance with Mr Chartist Research as of 25 Oct 2026 is ₹5,000\.00/);
  // Nothing overdue falls back to the balance wording.
  assert.doesNotMatch(buildPartyReminder({ party: party({ net: 100, bills: [bill('x', 'X', 100, 0)] }), sender: SELLER }).body, /overdue/);
});

test('partyReminderQueue: overdue parties only, snoozed and recently reminded left out, oldest first', () => {
  const report = {
    currency: 'INR',
    parties: [
      party({ key: 'a', name: 'Asha', net: 100, bills: [bill('1', 'A1', 100, 5)], oldestOverdueDays: 5 }),
      party({ key: 'b', name: 'Bala', net: 900, bills: [bill('2', 'B1', 900, 60)], oldestOverdueDays: 60 }),
      party({ key: 'c', name: 'Chetan', net: 400, bills: [bill('3', 'C1', 400, 20)], oldestOverdueDays: 20 }),
      party({ key: 'd', name: 'Devi', net: 700, bills: [bill('4', 'D1', 700, 0)] }),
      party({ key: 'e', name: 'Esha', net: 50, bills: [bill('5', 'E1', 50, 9)], oldestOverdueDays: 9 }),
    ],
    totals: { gross: 0, creditNotes: 0, advances: 0, net: 0, buckets: party({}).buckets, overdue: 0, billCount: 0 },
  };
  const clients = [{ id: 'b', name: 'Bala', phone: '98765 43210' }] as never[];
  const log = [makePartySnooze('s1', 'c', 3, new Date(2026, 9, 24)), makePartyLogEntry('l1', 'e', 'whatsapp', 'overdue_polite', new Date(2026, 9, 24))];
  const q = partyReminderQueue(report, clients, log, { today: NOW });
  assert.deepEqual(q.items.map((i) => i.party.name), ['Bala', 'Asha']);
  assert.equal(q.items[0].phone, '919876543210');
  assert.equal(q.snoozed, 1);
  assert.equal(q.recent, 1);
  // Monthly balance preset: everyone with a balance (Devi too), biggest first.
  const all = partyReminderQueue(report, clients, [], { kind: 'balance', today: NOW });
  assert.deepEqual(all.items.map((i) => i.party.name), ['Bala', 'Devi', 'Chetan', 'Asha', 'Esha']);
  // The party rows never count as invoice reminders.
  assert.equal(log[1].invoice_id, '');
  assert.equal(log[1].party_key, 'e');
});

/* ── ₹ Given ────────────────────────────────────────────────── */

test('₹ Given: composition → Bill of Supply, no GSTIN → plain bill, GST registrant → editor (refused here)', () => {
  assert.equal(givenModeFor({ gst_scheme: 'composition', companyGstin: SELLER.companyGstin }), 'bos');
  assert.equal(givenModeFor({ companyGstin: '' }), 'plain');
  assert.equal(givenModeFor(SELLER), 'editor');
  localDb.clients.upsert({ ...clientMH, credit_days: 10 });
  const client = localDb.clients.getAll().find((c) => c.name === clientMH.name)!;
  assert.throws(() => recordCreditGiven({ client, amount: 500 }), /tax invoice/);
  installSettings({ profiles: [{ ...SELLER, gst_scheme: 'composition' }] });
  const bos = recordCreditGiven({ client, amount: 500, note: 'Rice 10 kg', date: '2026-10-20' });
  assert.equal(bos.doc_type, 'BILL_OF_SUPPLY');
  assert.equal(bos.gst_mode, 'NONE');
  assert.equal(bos.total, 500);
  assert.equal(bos.items[0].name, 'Rice 10 kg');
  assert.equal(bos.due_date, '2026-10-30', 'the party credit days set the due date');
  assert.equal(bos.status, 'Sent');
  installSettings({ profiles: [{ ...SELLER, companyGstin: '' }] });
  const plain = recordCreditGiven({ client, amount: 250, date: '2026-10-21' });
  assert.equal(plain.doc_type, 'INVOICE');
  assert.equal(plain.tax_amount, 0);
  assert.equal(plain.party_balance_snapshot?.previous, 500, 'the earlier credit is the previous balance');
  const net = buildReceivables(loadReceivablesInput(), { now: NOW }).parties.find((p) => p.key === client.id)?.net;
  assert.equal(net, 750);
});

/* ── Party balance snapshot (Critical Rule 3) ─────────────────── */

test('snapshot: previous balance excludes this bill; frozen at issue and never recomputed on reprint or edit', () => {
  const first = createViaStore({ date: '2026-09-01', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  assert.deepEqual(first.party_balance_snapshot && { ...first.party_balance_snapshot, as_of: 'x' }, { previous: 0, bill: 1000, as_of: 'x' });
  const second = createViaStore({ date: '2026-10-01', lines: [{ qty: 1, rate: 500, tax: 0 }] });
  assert.equal(second.party_balance_snapshot?.previous, 1000);
  assert.equal(second.party_balance_snapshot?.bill, 500);
  assert.equal(partyBalanceTotal(second.party_balance_snapshot!), 1500);
  // Money comes in later: the ledger changes, the printed snapshot does not.
  savePartyReceipt({ client: { id: clientMH.id, name: clientMH.name }, amount: 1000, method: 'Cash', date: '2026-10-05', allocations: [{ bill_id: first.id, ref: first.invoice_number, amount: 1000 }] });
  const stored = reload(second.id);
  assert.equal(stored.party_balance_snapshot?.previous, 1000);
  assert.deepEqual(normalizeRecord(stored).party_balance_snapshot, stored.party_balance_snapshot, 'survives load');
  // Re-saving the issued bill keeps the previous balance (only the bill amount follows an edit).
  const resaved = localDb.invoices.save({ ...stored, notes: 'reprinted' });
  assert.equal(resaved.party_balance_snapshot?.previous, 1000);
  const next = nextPartyBalanceSnapshot({ ...stored, total: 600, balance_due: 600 }, stored, () => ({ previous: 0, bill: 0, as_of: '2030-01-01' }));
  assert.deepEqual(next && [next.previous, next.bill], [1000, 600]);
});

test('snapshot: legacy issued bills stay without one; drafts get one when issued; walk-in customers get none', () => {
  const legacy = { id: 'L1', doc_type: 'INVOICE', status: 'Sent', currency: 'INR', total: 100 } as InvoiceRecord;
  assert.equal(nextPartyBalanceSnapshot({ ...legacy, notes: 'edit' }, legacy, () => ({ previous: 5, bill: 100, as_of: '2026-10-25' })), undefined);
  const draft = { ...legacy, status: 'Draft' } as InvoiceRecord;
  assert.deepEqual(nextPartyBalanceSnapshot(legacy, draft, () => ({ previous: 5, bill: 100, as_of: '2026-10-25' })), { previous: 5, bill: 100, as_of: '2026-10-25' });
  assert.equal(nextPartyBalanceSnapshot(draft, undefined, () => ({ previous: 5, bill: 100, as_of: '2026-10-25' })), undefined, 'a draft never carries one');
  assert.equal(nextPartyBalanceSnapshot({ ...legacy, currency: 'USD' }, undefined, () => ({ previous: 5, bill: 100, as_of: '2026-10-25' })), undefined);
  const walkIn = { ...legacy, id: 'W1', client: { name: 'Walk-in', email: '', address: '', city: '', zip: '' } } as InvoiceRecord;
  assert.equal(computePartyBalanceSnapshot(walkIn, { invoices: [], payments: [], clients: [] }), undefined);
  // Draft saved first, then issued: the snapshot appears at issue.
  const d = createViaStore({ date: '2026-10-01', lines: [{ qty: 1, rate: 100, tax: 0 }], asDraft: true });
  assert.equal(d.party_balance_snapshot, undefined);
});

test('party balance rows: nothing to print without a previous balance; advance shown as negative', () => {
  assert.equal(partyBalanceRows(undefined), null);
  assert.equal(partyBalanceRows({ previous: 0, bill: 100, as_of: '2026-10-25' }), null);
  assert.deepEqual(partyBalanceRows({ previous: 400, bill: 100, paid: 50, as_of: '2026-10-25' }), { previous: 400, bill: 100, paid: 50, total: 450 });
  assert.deepEqual(partyBalanceRows({ previous: -300, bill: 100, as_of: '2026-10-25' })?.total, -200);
  assert.equal(sanitizePartyBalance({ previous: 'x', bill: 1, as_of: '2026-10-25' }), undefined);
  assert.equal(sanitizePartyBalance({ previous: 1, bill: 1, as_of: '25/10/2026' }), undefined);
});

test('editor: a client picked from the master sets the due date from its credit days', async () => {
  const { useInvoiceStore } = await import('../src/store/useInvoiceStore.ts');
  const { clientToParty } = await import('../src/store/invoice-defaults.ts');
  localDb.clients.upsert({ ...clientMH, credit_days: 21 });
  const s = useInvoiceStore.getState();
  s.newDraft();
  useInvoiceStore.getState().setDates('2026-10-01', '2026-10-01');
  useInvoiceStore.getState().setClient(clientToParty(localDb.clients.getAll()[0]));
  assert.equal(useInvoiceStore.getState().due_date, '2026-10-22');
  // Typing a name does not move the due date.
  useInvoiceStore.getState().setDates('2026-10-01', '2026-10-05');
  useInvoiceStore.getState().setClient({ name: clientMH.name });
  assert.equal(useInvoiceStore.getState().due_date, '2026-10-05');
});

/* ── R6-C5 (8.7): documents issued outside the editor take the snapshot too ── */

/** The party's open balance right now (what "previous balance" must show on the next document). */
const openBalance = () => loadKhataReport(NOW).report.parties.find((p) => p.key === clientMH.id)?.net ?? 0;

test('R6-C5: a recurring issue, a conversion, a late-fee issue and an issued draft each freeze the previous balance', async () => {
  const { createSchedule, generateInvoiceFromSchedule, templateFromInvoice } = await import('../src/lib/recurring.ts');
  const { convertDocument } = await import('../src/lib/documents.ts');
  const { createLateFeeInvoice } = await import('../src/lib/late-fee.ts');
  const { issueDraft } = await import('../src/lib/khata-actions.ts');
  const { freezeDate, thawDate } = await import('./helpers/shim.ts');
  freezeDate('2026-10-25T10:00:00');
  try {
  const first = createViaStore({ date: '2026-09-01', due: '2026-09-10', lines: [{ qty: 1, rate: 1000, tax: 0 }] });

  // Recurring run in "issue" mode.
  const s = createSchedule({ name: 'Monthly', template: templateFromInvoice(first), frequency: 'monthly', start_date: '2026-10-01', mode: 'issue' });
  let prev = openBalance();
  const rec = generateInvoiceFromSchedule(s, '2026-10-01').invoice;
  assert.equal(rec.status, 'Sent');
  assert.deepEqual([rec.party_balance_snapshot?.previous, rec.party_balance_snapshot?.bill], [prev, rec.total]);
  assert.equal(prev, 1000);

  // A draft run takes none (it is numbered and snapshotted when issued).
  const draftRun = generateInvoiceFromSchedule({ ...createSchedule({ name: 'D', template: templateFromInvoice(first), frequency: 'monthly', start_date: '2026-10-02', mode: 'draft' }) }, '2026-10-02').invoice;
  assert.equal(draftRun.status, 'Draft');
  assert.equal(draftRun.party_balance_snapshot, undefined, 'a draft carries none');

  // A quotation converted straight to an issued invoice.
  const quote = createViaStore({ docType: 'QUOTATION', date: '2026-10-03', lines: [{ qty: 1, rate: 300, tax: 0 }] });
  prev = openBalance();
  const conv = convertDocument(quote, 'INVOICE', { issue: true });
  assert.equal(conv.status, 'Sent');
  assert.equal(conv.party_balance_snapshot?.previous, prev);
  const convDraft = convertDocument(quote, 'PROFORMA');
  assert.equal(convDraft.party_balance_snapshot, undefined, 'a converted draft carries none');

  // A late fee issued straight away.
  localDb.clients.upsert({ ...clientMH, id: clientMH.id, late_fee: { mode: 'flat', rate: 500, graceDays: 7 } });
  prev = openBalance();
  const fee = createLateFeeInvoice(reload(first.id), new Date(2026, 9, 25), { issue: true });
  assert.equal(fee.status, 'Sent');
  assert.equal(fee.party_balance_snapshot?.previous, prev);

  // The recurring draft issued later from the list (no editor): snapshot at that moment.
  const issued = issueDraft(draftRun.id);
  assert.ok(issued.invoice_number, 'numbered on issue');
  // The previous balance is the party's ledger up to the document's own date (2 Oct): the two September / 1 Oct bills.
  assert.equal(issued.party_balance_snapshot?.previous, 2000);

  // A reprint after a later payment is unchanged.
  savePartyReceipt({ client: { id: clientMH.id, name: clientMH.name }, amount: 1000, method: 'Cash', date: '2026-10-21', allocations: [{ bill_id: first.id, ref: first.invoice_number, amount: 1000 }] });
  assert.equal(reload(rec.id).party_balance_snapshot?.previous, 1000);
  const resaved = localDb.invoices.save({ ...reload(conv.id), notes: 'reprint' });
  assert.equal(resaved.party_balance_snapshot?.previous, conv.party_balance_snapshot?.previous);
  } finally {
    thawDate();
  }
});

test('R6-C5: a batch run takes one snapshot per party — the balance before the run, not its own earlier bills', async () => {
  const { withIssueSnapshot } = await import('../src/lib/khata-actions.ts');
  createViaStore({ date: '2026-09-01', lines: [{ qty: 1, rate: 1000, tax: 0 }] });
  const prev = openBalance();
  const cache = new Map();
  const base = { ...reload(localDb.invoices.getAll()[0].id), id: 'n1', invoice_number: 'B/1', issue_date: '2026-10-01', party_balance_snapshot: undefined } as InvoiceRecord;
  const a = withIssueSnapshot(base, undefined, cache);
  localDb.invoices.save(a);
  const b = withIssueSnapshot({ ...base, id: 'n2', invoice_number: 'B/2', total: 250, balance_due: 250 }, undefined, cache);
  assert.equal(a.party_balance_snapshot?.previous, prev);
  assert.equal(b.party_balance_snapshot?.previous, prev, 'the second bill of the party in the run shows the same previous balance');
  assert.equal(b.party_balance_snapshot?.bill, 250);
  assert.equal(withIssueSnapshot({ ...base, id: 'n3', status: 'Draft' }, undefined, cache).party_balance_snapshot, undefined);
});
