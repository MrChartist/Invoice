/**
 * Amount due after credit notes (src/lib/amount-due.ts) — beta bug-bash regression: after a credit note
 * against an invoice, paying the rest must make it Paid, nobody may be chased for the credited part,
 * and receivables must never invent a receipt for it.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { cancelDocument, createCreditNote, readLinks } from '../src/lib/documents.ts';
import { localDb } from '../src/lib/localDb.ts';
import { amountDue, linkedCredits, settledStatus } from '../src/lib/amount-due.ts';
import { buildLedger, buildReceivables, type ReceiptRow } from '../src/lib/receivables.ts';
import { pendingReminders, suggestStage } from '../src/lib/reminders.ts';
import { dueSoonProvider, overdueProvider, type NotificationContext } from '../src/lib/notifications.ts';
import { attentionList, summarize } from '../src/lib/stats.ts';
import { bulkMarkPaid, bulkPaidTotal, canMarkPaid, loadCredits, markPaidAmount } from '../src/lib/invoice-list.ts';
import { partyReminderQueue } from '../src/lib/khata.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const OVERDUE_DAY = new Date(2026, 3, 30); // due 24 Apr → overdue
const DUE_SOON_DAY = new Date(2026, 3, 22); // due 24 Apr → due within 3 days

/** ₹2,950 invoice (10 × 250 @ 18%), due 24 Apr 2026. */
function bill(): InvoiceRecord {
  const inv = createViaStore({ date: '2026-04-10', due: '2026-04-24', lines: [{ name: 'Steel bracket', qty: 10, rate: 250 }] });
  assert.equal(inv.total, 2950);
  return inv;
}

const credit = (inv: InvoiceRecord, qty: number) =>
  createCreditNote(reload(inv.id), { reason: 'Discount', lines: [{ itemId: reload(inv.id).items[0].id, quantity: qty }] });

function world() {
  const invoices = localDb.invoices.getAll();
  const links = readLinks();
  return { invoices, links, payments: localDb.payments.getAll() as ReceiptRow[], credits: linkedCredits(links, invoices) };
}

const notifCtx = (now: Date): NotificationContext => {
  const w = world();
  return { now, invoices: w.invoices, clients: [], profile: null, lastBackup: null, storageUsedBytes: 0, storageQuotaBytes: 1, credits: w.credits };
};

test('credit note, then paying the rest: Paid, nothing chased, no phantom receipt', () => {
  const inv = bill();
  const cn = credit(inv, 2); // ₹590
  assert.equal(cn.total, 590);
  // A part credit with nothing paid yet: partly settled, ₹2,360 due.
  assert.equal(reload(inv.id).status, 'Partially Paid');
  assert.equal(amountDue(reload(inv.id), world().credits.get(inv.id)), 2360);
  assert.equal(markPaidAmount(reload(inv.id), loadCredits()), 2360);

  localDb.payments.record({ invoiceId: inv.id, amount: 2360, method: 'UPI', date: '2026-04-20' });
  const paid = reload(inv.id);
  assert.equal(paid.status, 'Paid');
  assert.equal(paid.amount_paid, 2360);
  // `balance_due` keeps its stored meaning (total − TDS − received); the due is what amountDue says.
  assert.equal(paid.balance_due, 590);
  assert.equal(amountDue(paid, world().credits.get(inv.id)), 0);

  const w = world();
  assert.deepEqual(pendingReminders(w.invoices, OVERDUE_DAY, [], { credits: w.credits }), []);
  assert.equal(suggestStage(paid, OVERDUE_DAY, w.credits.get(inv.id)), 'thank_you');
  assert.equal(overdueProvider(notifCtx(OVERDUE_DAY)).length, 0);
  assert.equal(dueSoonProvider(notifCtx(DUE_SOON_DAY)).length, 0);
  assert.deepEqual(attentionList(w.invoices, 5, OVERDUE_DAY, w.credits), []);
  assert.equal(canMarkPaid(paid, w.credits), false);
  assert.equal(summarize(w.invoices, OVERDUE_DAY, w.links).outstanding, 0);

  const rep = buildReceivables({ invoices: w.invoices, payments: w.payments, links: w.links }, { now: OVERDUE_DAY });
  const party = rep.parties[0];
  assert.equal(party.bills.length, 0);
  assert.equal(party.net, 0);
  assert.equal(party.creditNotes, 0);
  // One real receipt, no "recorded on invoice" receipt for the credited ₹590.
  assert.deepEqual(party.entries.filter((e) => e.kind === 'payment').map((e) => [e.credit, !!e.derived]), [[2360, false]]);
  assert.equal(partyReminderQueue(rep, [], [], { today: OVERDUE_DAY }).items.length, 0);
});

test('a fully credited invoice is Paid with zero receipts', () => {
  const inv = bill();
  credit(inv, 10);
  const rec = reload(inv.id);
  assert.equal(rec.status, 'Paid');
  assert.equal(rec.amount_paid, 0);
  assert.equal(localDb.payments.listFor(inv.id).length, 0);

  const w = world();
  const rep = buildReceivables({ invoices: w.invoices, payments: w.payments, links: w.links }, { now: OVERDUE_DAY });
  const party = rep.parties[0];
  assert.equal(party.entries.filter((e) => e.kind === 'payment').length, 0);
  assert.equal(party.bills.length, 0);
  assert.equal(party.net, 0);
  assert.equal(buildLedger(party).closing, 0);
  // Bulk "mark paid" has nothing to collect.
  assert.equal(bulkPaidTotal([rec], w.credits), 0);
  assert.equal(bulkMarkPaid([inv.id], { method: 'UPI', date: '2026-04-21' }).paid.length, 0);
});

test('partial credit + partial payment: Partially Paid with the right amount due everywhere', () => {
  const inv = bill();
  credit(inv, 2); // ₹590
  localDb.payments.record({ invoiceId: inv.id, amount: 1000, method: 'Cash', date: '2026-04-20' });
  const rec = reload(inv.id);
  assert.equal(rec.status, 'Partially Paid');
  const w = world();
  const due = amountDue(rec, w.credits.get(inv.id));
  assert.equal(due, 1360); // 2950 − 590 − 1000

  const pending = pendingReminders(w.invoices, OVERDUE_DAY, [], { credits: w.credits });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].balance, 1360);
  assert.equal(attentionList(w.invoices, 5, OVERDUE_DAY, w.credits).length, 1);
  assert.equal(summarize(w.invoices, OVERDUE_DAY, w.links).outstanding, 1360);
  assert.match(overdueProvider(notifCtx(OVERDUE_DAY))[0].detail, /1,360/);
  // Record-payment / bulk mark-paid default amount and the bulk dialog subtitle.
  assert.equal(markPaidAmount(rec, w.credits), 1360);
  assert.equal(bulkPaidTotal([rec], w.credits), 1360);

  const rep = buildReceivables({ invoices: w.invoices, payments: w.payments, links: w.links }, { now: OVERDUE_DAY });
  const party = rep.parties[0];
  assert.equal(party.bills.length, 1);
  assert.equal(party.bills[0].outstanding, 1360);
  assert.equal(party.bills[0].credited, 590);
  assert.equal(party.net, 1360);
  assert.equal(rep.totals.overdue, 1360);
  assert.equal(partyReminderQueue(rep, [], [], { today: OVERDUE_DAY }).items[0].amount, 1360);

  // Paying exactly the due settles it; the bulk run records only that.
  const r = bulkMarkPaid([inv.id], { method: 'UPI', date: '2026-04-22' });
  assert.equal(r.total, 1360);
  assert.equal(reload(inv.id).status, 'Paid');
});

test('cancelling the credit note brings the balance (and the status) back', () => {
  const inv = bill();
  const cn = credit(inv, 2);
  localDb.payments.record({ invoiceId: inv.id, amount: 2360, method: 'UPI', date: '2026-04-20' });
  assert.equal(reload(inv.id).status, 'Paid');
  cancelDocument(reload(cn.id), 'Raised in error');
  const rec = reload(inv.id);
  assert.equal(rec.status, 'Partially Paid');
  assert.equal(amountDue(rec, world().credits.get(inv.id)), 590);
});

test('statements / ledger totals are unchanged by the status fix and by bill-wise allocation', () => {
  const inv = bill();
  credit(inv, 2);
  localDb.payments.record({ invoiceId: inv.id, amount: 2360, method: 'UPI', date: '2026-04-20' });
  const w = world();
  assert.equal(reload(inv.id).status, 'Paid');
  // The same books as the old code saw them: status stuck on Partially Paid, no allocation.
  const stuck = w.invoices.map((i) => (i.id === inv.id ? { ...i, status: 'Partially Paid' as const } : i));
  const before = buildReceivables({ invoices: stuck, payments: w.payments }, { now: OVERDUE_DAY }).parties[0];
  const after = buildReceivables({ invoices: w.invoices, payments: w.payments, links: w.links }, { now: OVERDUE_DAY }).parties[0];
  const lb = buildLedger(before);
  const la = buildLedger(after);
  assert.deepEqual([la.totalDebit, la.totalCredit, la.closing], [lb.totalDebit, lb.totalCredit, lb.closing]);
  assert.deepEqual([la.totalDebit, la.totalCredit, la.closing], [2950, 2950, 0]);
  assert.deepEqual(
    after.entries.map((e) => [e.kind, e.debit, e.credit]),
    before.entries.map((e) => [e.kind, e.debit, e.credit]),
  );
  assert.equal(after.net, before.net);
  // Allocation only moves the credit from "credit notes" into the bill: net identical.
  assert.equal(before.creditNotes, 590);
  assert.equal(before.gross, 590);
  assert.equal(after.creditNotes, 0);
  assert.equal(after.gross, 0);
});

test('settledStatus: thresholds and fallbacks', () => {
  assert.equal(settledStatus('Sent', 1000, 999.996, 0), 'Paid');
  assert.equal(settledStatus('Sent', 1000, 400, 600), 'Paid');
  assert.equal(settledStatus('Sent', 1000, 0, 300), 'Partially Paid');
  assert.equal(settledStatus('Paid', 1000, 0, 0), 'Sent');
  assert.equal(settledStatus('Cancelled', 1000, 1000, 0), 'Cancelled');
  assert.equal(settledStatus('Sent', 0, 0, 0), 'Sent');
  // A draft or cancelled credit note settles nothing.
  const inv = { id: 'i', doc_type: 'INVOICE', status: 'Sent', total: 100 } as InvoiceRecord;
  const draft = { id: 'c1', doc_type: 'CREDIT_NOTE', status: 'Draft', total: 40 } as InvoiceRecord;
  const cancelled = { id: 'c2', doc_type: 'CREDIT_NOTE', status: 'Cancelled', total: 40 } as InvoiceRecord;
  const live = { id: 'c3', doc_type: 'CREDIT_NOTE', status: 'Sent', total: 25 } as InvoiceRecord;
  const links = ['c1', 'c2', 'c3', 'c3'].map((to) => ({ from_id: 'i', to_id: to, relation: 'credit_note' }));
  assert.equal(linkedCredits(links, [inv, draft, cancelled, live]).get('i'), 25);
});
