/**
 * R2-A2 settlement discount / short payment (financial credit note, FCN series): due after settlement, status,
 * receivables, GSTR-1 unchanged, GST variant in CDNR, e-invoice refusal, ledger balance, Tally ledgers,
 * dashboard revenue, clerk cap → approval queue, period lock, undo offer.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, reload, BUYER_MH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import {
  buildFinancialNote, cancelFinancialNote, clerkCap, createFinancialNote, dueOn, recordReceiptAndSettle, saveCollectionSettings,
  settlementNotesFor, settlementOptions, DEFAULT_COLLECTION_SETTINGS,
} from '../src/lib/settlement.ts';
import { isFinancialNote, isNonGstFinancialNote } from '../src/lib/financial-note.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import { eInvoiceDocType } from '../src/lib/einvoice.ts';
import { validateEInvoice } from '../src/lib/einvoice-validate.ts';
import { buildEInvoice } from '../src/lib/einvoice.ts';
import { buildLedger } from '../src/lib/ledger/postings.ts';
import { loadLedgerInput } from '../src/lib/ledger/index.ts';
import { trialBalance } from '../src/lib/ledger/reports.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { summarize } from '../src/lib/stats.ts';
import { pendingApprovals } from '../src/lib/approvals.ts';
import { SETTINGS_OVERRIDE } from '../src/lib/period-lock.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';

const PERIOD = { kind: 'month' as const, fyStart: 2026, month: 10 };

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const bill = (rate = 50000) => createViaStore({ date: '2026-10-05', due: '2026-11-04', lines: [{ qty: 1, rate, tax: 18 }], status: 'Sent' });
const links = () => getTable<{ from_id: string; to_id: string; relation: string }>('doc_links');

test('settlement options: rest after the receipt, early offer only on or before its date', () => {
  const terms = { payment_terms: { id: 't', name: 'Net 30 / 2%', early_discount: { percent: 2, until: '2026-10-12', amount: 1180 } } };
  assert.deepEqual(settlementOptions(terms, 59000, 57820, '2026-10-10'), { rest: 1180, early: { amount: 1180, until: '2026-10-12', percent: 2 }, suggested: 'settlement_discount' });
  assert.equal(settlementOptions(terms, 59000, 57820, '2026-10-13').early, undefined);
  assert.equal(settlementOptions({}, 59000, 59000, '2026-10-10').rest, 0);
  assert.equal(clerkCap(59000, DEFAULT_COLLECTION_SETTINGS), 100, 'lower of ₹100 and 2%');
  assert.equal(clerkCap(1000, DEFAULT_COLLECTION_SETTINGS), 20);
});

test('short payment settles the bill: due 0, status Paid, receivables net, FCN series, linked, no GST', () => {
  const inv = bill();
  const total = inv.total;
  const { note } = recordReceiptAndSettle({ invoiceId: inv.id, amount: total - 40, method: 'UPI', date: '2026-10-20', settle: { reason: 'short_payment', amount: 40 } });
  assert.ok(note && !note.pending);
  const n = note!.note;
  assert.match(n.invoice_number, /^FCN\/FY26-27\/0001$/);
  assert.ok(isFinancialNote(n) && isNonGstFinancialNote(n));
  assert.equal(n.total, 40);
  assert.equal(n.tax_amount, 0);
  assert.equal(n.financial_reason, 'short_payment');
  assert.equal(dueOn(inv.id), 0);
  assert.equal(reload(inv.id).status, 'Paid');
  assert.ok(links().some((l) => l.from_id === inv.id && l.to_id === n.id && l.relation === 'credit_note'));
  const r = buildReceivables({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: localDb.clients.getAll(), links: links() });
  const party = r.parties[0];
  assert.equal(party.net, 0);
  assert.equal(party.bills.length, 0);
  assert.ok(party.entries.some((e) => e.financial === 'short_payment' && /Short payment/.test(e.particulars)));
  assert.ok(!localDb.items.getAll().some((i) => /Short payment/.test(i.name)), 'the settlement line is not learnt as a catalogue item');
  // The next note takes the next number; numbers are never reused.
  const inv2 = bill(1000);
  const second = createFinancialNote(inv2.id, { amount: 10, reason: 'short_payment', date: '2026-10-21' });
  assert.match(second.note.invoice_number, /\/0002$/);
});

test('GSTR-1 / 3B unchanged by a financial note; e-Invoice and e-Way refuse it', () => {
  const inv = bill();
  const before = buildGstReport(localDb.invoices.getAll(), [], { period: PERIOD });
  recordReceiptAndSettle({ invoiceId: inv.id, amount: inv.total - 590, method: 'UPI', date: '2026-10-20', settle: { reason: 'settlement_discount', amount: 590 } });
  const after = buildGstReport(localDb.invoices.getAll(), [], { period: PERIOD });
  assert.deepEqual(after.gstr1.cdnr, before.gstr1.cdnr);
  assert.deepEqual(after.gstr1.cdnur, before.gstr1.cdnur);
  assert.deepEqual(after.gstr1.hsn, before.gstr1.hsn);
  assert.deepEqual(after.gstr1.docIssue, before.gstr1.docIssue, 'the FCN series is not in Table 13');
  assert.deepEqual(after.gstr3b, before.gstr3b);
  const note = localDb.invoices.getAll().find(isFinancialNote)!;
  assert.equal(eInvoiceDocType(note), null);
  const { payload } = buildEInvoice(note, {});
  assert.ok(validateEInvoice(payload, note).some((i) => i.code === 'DOC_TYPE' && i.severity === 'error'));
});

test('GST variant (company setting): GST pro rata, reported in CDNR like a discount credit note', () => {
  saveCollectionSettings({ ...DEFAULT_COLLECTION_SETTINGS, gst_variant: true });
  const inv = bill(10000);
  const r = createFinancialNote(inv.id, { amount: 1180, reason: 'settlement_discount', date: '2026-10-20', gst: true });
  assert.equal(r.note.total, 1180);
  assert.equal(r.note.taxable_value, 1000);
  assert.equal(Math.round((r.note.cgst_amount + r.note.sgst_amount) * 100), 18000);
  assert.ok(!isNonGstFinancialNote(r.note));
  const rep = buildGstReport(localDb.invoices.getAll(), [], { period: PERIOD });
  assert.equal(rep.gstr1.cdnr.length, 1, `client GSTIN ${BUYER_MH} → CDNR`);
});

test('ledger: Dr Discount allowed / Cr party, trial balance balances; short payments go to the configured account', () => {
  saveCollectionSettings({ ...DEFAULT_COLLECTION_SETTINGS, short_pay_account: 'round_off' });
  const a = bill();
  recordReceiptAndSettle({ invoiceId: a.id, amount: a.total - 1000, method: 'UPI', date: '2026-10-20', settle: { reason: 'settlement_discount', amount: 1000 } });
  const b = bill(2000);
  recordReceiptAndSettle({ invoiceId: b.id, amount: b.total - 3, method: 'Cash', date: '2026-10-21', settle: { reason: 'short_payment', amount: 3 } });
  const led = buildLedger(loadLedgerInput(undefined, '2026-10-31'));
  const cn = led.vouchers.filter((v) => v.kind === 'Credit Note');
  assert.equal(cn.length, 2);
  const disc = cn.find((v) => v.lines.some((l) => l.account === 'discount_allowed'))!;
  assert.equal(disc.lines.find((l) => l.account === 'discount_allowed')!.dr, 100000);
  assert.equal(disc.lines.find((l) => l.account === 'debtors')!.cr, 100000);
  assert.ok(!disc.lines.some((l) => /^out_/.test(l.account)), 'no output-tax lines');
  assert.ok(cn.some((v) => v.lines.some((l) => l.account === 'round_off' && l.dr === 300)));
  const tb = trialBalance(led, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
});

test('Tally XML: a financial note posts to Discount Allowed with no GST ledgers and no stock', () => {
  const a = bill();
  recordReceiptAndSettle({ invoiceId: a.id, amount: a.total - 500, method: 'UPI', date: '2026-10-20', settle: { reason: 'settlement_discount', amount: 500 } });
  const { vouchers } = buildTallyModel({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll() as Payment[], clients: [], items: [], purchases: [], vendors: [] }, { companyName: 'Test', includeInventory: true });
  const cn = vouchers.find((v) => v.type === 'Credit Note')!;
  assert.ok(cn.entries.some((e) => e.ledger === 'Discount Allowed'));
  assert.ok(!cn.entries.some((e) => /GST/i.test(e.ledger)), cn.entries.map((e) => e.ledger).join(', '));
  assert.equal(cn.inventory.length, 0);
});

test('dashboard: a settlement discount is an expense, not a reduction of billed revenue', () => {
  const a = bill();
  const before = summarize(localDb.invoices.getAll(), new Date(2026, 9, 25), links(), 'INR');
  recordReceiptAndSettle({ invoiceId: a.id, amount: a.total - 500, method: 'UPI', date: '2026-10-20', settle: { reason: 'settlement_discount', amount: 500 } });
  const after = summarize(localDb.invoices.getAll(), new Date(2026, 9, 25), links(), 'INR');
  assert.equal(after.billed, before.billed);
  assert.equal(after.credited, 0);
  assert.equal(after.outstanding, 0);
});

test('a clerk over the cap asks the owner: the note waits as a pending draft and settles nothing until approved', () => {
  const inv = bill();
  setActorProvider(() => ({ id: 'c', name: 'Asha', role: 'clerk' }));
  const small = createFinancialNote(inv.id, { amount: 50, reason: 'short_payment', date: '2026-10-20' });
  assert.equal(small.pending, false, 'within ₹100 / 2%');
  const big = createFinancialNote(inv.id, { amount: 5000, reason: 'settlement_discount', date: '2026-10-20' });
  assert.equal(big.pending, true);
  assert.equal(reload(big.note.id).status, 'Draft');
  assert.ok(pendingApprovals().some((d) => d.id === big.note.id));
  assert.equal(Math.round(dueOn(inv.id) * 100), Math.round((inv.total - 50) * 100), 'a pending note reduces nothing');
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  assert.throws(() => createFinancialNote(inv.id, { amount: 1, reason: 'short_payment', date: '2026-10-20' }), /cannot/);
});

test('refusals: more than the due, a draft bill, a locked period; undo offers the note, never cancels it alone', () => {
  const inv = bill(1000);
  assert.throws(() => createFinancialNote(inv.id, { amount: inv.total + 1, reason: 'short_payment', date: '2026-10-20' }), /still due/);
  const draft = createViaStore({ date: '2026-10-05', lines: [{ qty: 1, rate: 10 }], asDraft: true });
  assert.throws(() => createFinancialNote(draft.id, { amount: 1, reason: 'short_payment', date: '2026-10-20' }), /issued invoice/);
  const { payment } = recordReceiptAndSettle({ invoiceId: inv.id, amount: inv.total - 5, method: 'UPI', date: '2026-10-20', settle: { reason: 'short_payment', amount: 5 } });
  localDb.payments.remove(payment.id);
  const notes = settlementNotesFor(inv.id);
  assert.equal(notes.length, 1, 'removing the receipt leaves the note');
  cancelFinancialNote(notes[0].id);
  assert.equal(settlementNotesFor(inv.id).length, 0);
  assert.equal(Math.round(dueOn(inv.id) * 100), Math.round(inv.total * 100));
  // Period lock: nothing on or before the lock date.
  const s = localDb.settings.get();
  localDb.settings.save({ ...s, lock_until: '2026-10-31' });
  const count = localDb.invoices.getAll().length;
  assert.throws(() => createFinancialNote(inv.id, { amount: 1, reason: 'short_payment', date: '2026-10-25' }), /lock/i);
  assert.equal(localDb.invoices.getAll().length, count, 'all or nothing');
  void SETTINGS_OVERRIDE;
});

test('pure builder: one 0% line without GST; the note total is the amount', () => {
  const inv = bill(1234) as InvoiceRecord;
  const n = buildFinancialNote(inv, { amount: 12.34, reason: 'short_payment', date: '2026-10-20' }, { id: 'n1', number: 'FCN/FY26-27/0009' });
  assert.equal(n.items.length, 1);
  assert.equal(n.gst_mode, 'NONE');
  assert.equal(n.total, 12.34);
  assert.equal(n.balance_due, 0);
  assert.equal(n.po_number, inv.invoice_number);
});
