/**
 * QA round 3, package QA-1 (money and data): regression tests for docs/prd/qa-round-3.md.
 *  F1  shift X/Z report counts the returns made during the shift
 *  F2  POS refunds / exchanges reduce the party's credit in the khata and receivables
 *  F3  the data layer refuses a payment against a quotation (non-revenue document)
 *  F6  recurring: drafts take no series number, "Run now" never bills a future period unasked,
 *      a schedule made from an invoice starts after it
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { clearOverrides } from '../src/lib/period-lock.ts';
import { buildPosRecord, savePosBill, WALK_IN_NAME } from '../src/lib/pos.ts';
import { posReturnsDb, savePosReturn } from '../src/lib/pos-returns.ts';
import { shiftExpected, shiftReport, shiftsDb } from '../src/lib/pos-shifts.ts';
import { buildLedger, buildReceivables, posRefunds } from '../src/lib/receivables.ts';
import { loadKhataReport } from '../src/lib/khata-actions.ts';
import { createSchedule, recurringDb, runDueSchedules, runNow, startAfterInvoice, templateFromInvoice } from '../src/lib/recurring.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

const DAY = '2026-05-10';

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const line = (id: string, name: string, quantity: number, rate: number, tax_rate = 5): InvoiceItem => ({
  id, name, type: 'Product', hsn: '0713', unit: 'NOS', quantity, rate, tax_rate, discount_percent: 0, amount: quantity * rate,
});

function sell(items: InvoiceItem[], tenders: { method: 'Cash' | 'UPI' | 'Card'; amount: number }[]) {
  const rec = buildPosRecord({ items, party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY });
  const res = savePosBill({ record: rec, tenders });
  assert.ok(res.ok, res.errors.join('; '));
  return res.record!;
}

/* ── F1 ─────────────────────────────────────────────────────────── */

test('F1: the shift report counts a cash refund made during the shift (expected drawer = float + cash − refund)', () => {
  const shift = shiftsDb.open(1000, DAY);
  // Toor Dal 145 @5% + Steel rack 1,250 @18% = 152.25 + 1,475 → 1,627 (rounded).
  const bill = sell([line('dal', 'Toor Dal 1kg', 1, 145, 5), line('rack', 'Steel rack', 1, 1250, 18)], [{ method: 'Cash', amount: 1627 }]);
  shiftsDb.addBill(shift.id, bill.id);
  const ret = savePosReturn({ bill, lines: [{ itemId: 'dal', quantity: 1 }], settlement: 'refund', refunds: [{ method: 'Cash', amount: 152 }] });
  assert.ok(ret.ok, ret.errors.join('; '));
  const refund = ret.row!.amount;

  const z = shiftReport(shiftsDb.current()!, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all());
  assert.equal(z.bills, 1, 'the credit note is not counted as a bill');
  assert.equal(z.returns.count, 1);
  assert.equal(z.returns.value, refund);
  assert.equal(z.returns.refunds.cash, refund);
  assert.equal(shiftExpected(z, 1000), Math.round((1000 + bill.total - refund) * 100) / 100);
});

/* ── F2 ─────────────────────────────────────────────────────────── */

test('F2: a POS cash refund settles the walk-in credit note (khata no longer shows an advance)', () => {
  const bill = sell([line('dal', 'Toor Dal 1kg', 1, 145, 5), line('rack', 'Steel rack', 1, 1250, 18)], [{ method: 'Cash', amount: 1627 }]);
  const ret = savePosReturn({ bill, lines: [{ itemId: 'dal', quantity: 1 }], settlement: 'refund', refunds: [{ method: 'Cash', amount: 152 }] });
  assert.ok(ret.ok, ret.errors.join('; '));

  const { report } = loadKhataReport(new Date(`${DAY}T12:00:00`));
  const walkIn = report.parties.find((p) => p.name === WALK_IN_NAME || p.name === bill.client.name)!;
  assert.ok(walkIn, 'walk-in party present');
  assert.equal(walkIn.net, 0, 'bill − receipt − credit note + refund = 0');
  assert.equal(walkIn.creditNotes, 0);
  assert.equal(walkIn.advances, 0);
  // net === ledger closing (the module's invariant) and the refund is a debit entry.
  assert.equal(buildLedger(walkIn).closing, 0);
  assert.ok(walkIn.entries.some((e) => e.kind === 'refund' && e.debit === ret.row!.amount));
  assert.equal(report.totals.creditNotes, 0);
});

test('F2: refund of a credit note against a partly paid bill leaves the bill open by the unpaid part', () => {
  const party = { id: 'c1', name: 'Pune Mart' };
  const bill = {
    id: 'b1', invoice_number: 'INV/1', doc_type: 'INVOICE', status: 'Partially Paid', issue_date: DAY, due_date: DAY,
    client: party, total: 1000, amount_paid: 500, balance_due: 500, currency: 'INR',
  } as never;
  const cn = { id: 'n1', invoice_number: 'CN/1', doc_type: 'CREDIT_NOTE', status: 'Issued', issue_date: DAY, client: party, total: 300, currency: 'INR' } as never;
  const payments = [{ id: 'p1', invoice_id: 'b1', amount: 500, date: DAY, method: 'Cash' }] as never[];
  const links = [{ from_id: 'b1', to_id: 'n1', relation: 'credit_note' }] as never[];
  const base = buildReceivables({ invoices: [bill, cn], payments, links });
  assert.equal(base.parties[0].net, 200, 'without a refund the note settles 300 of the 500 open');
  const refunds = posRefunds([{ id: 'r', day: DAY, bill_id: 'b1', bill_number: 'INV/1', credit_note_id: 'n1', credit_note_number: 'CN/1', amount: 300, settlement: 'refund', refunds: [{ method: 'Cash', amount: 300 }], voucher_id: 'v', reason: 'x', created_at: '' }]);
  const rep = buildReceivables({ invoices: [bill, cn], payments, links, refunds });
  const p = rep.parties[0];
  assert.equal(p.net, 500, 'the note was paid back in cash, so the 500 is still owed');
  assert.equal(p.bills[0].outstanding, 500);
  assert.equal(buildLedger(p).closing, p.net);
  // A refund without a booked voucher, or against a missing note, changes nothing.
  assert.deepEqual(posRefunds([{ id: 'r', day: DAY, bill_id: 'b1', bill_number: '', credit_note_id: 'n1', credit_note_number: '', amount: 300, settlement: 'refund', refunds: [{ method: 'Cash', amount: 300 }], reason: '', created_at: '' }]), []);
  assert.equal(buildReceivables({ invoices: [bill], payments, links, refunds }).parties[0].net, 500);
});

test('F2: an exchange credit used on a new bill nets to zero for the walk-in party', () => {
  const bill = sell([line('a', 'Shirt', 1, 500, 18)], [{ method: 'Cash', amount: 590 }]);
  const ret = savePosReturn({ bill, lines: [{ itemId: 'a', quantity: 1 }], settlement: 'exchange' });
  assert.ok(ret.ok, ret.errors.join('; '));
  const rec = buildPosRecord({ items: [line('b', 'Shirt XL', 1, 600, 18)], party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: 'classic_orange', day: DAY });
  const res = savePosBill({ record: rec, tenders: [{ method: 'Cash', amount: 118 }], exchangeReturnId: ret.row!.id });
  assert.ok(res.ok, res.errors.join('; '));
  const { report } = loadKhataReport(new Date(`${DAY}T12:00:00`));
  assert.equal(report.totals.net, 0);
  assert.equal(report.totals.advances, 0);
});

/* ── F3 ─────────────────────────────────────────────────────────── */

test('F3: a payment against a quotation is refused by the data layer; invoices still take payments', () => {
  const quote = createViaStore({ date: DAY, docType: 'QUOTATION', lines: [{ qty: 1, rate: 1000 }] });
  assert.throws(() => localDb.payments.record({ invoiceId: quote.id, amount: 500, method: 'Cash', date: DAY }), /invoices only/);
  assert.equal(localDb.payments.listFor(quote.id).length, 0);
  assert.equal(localDb.invoices.getById(quote.id)!.status, quote.status, 'the quote is not marked paid');
  for (const docType of ['PROFORMA', 'DELIVERY_CHALLAN'] as const) {
    const d = createViaStore({ date: DAY, docType, lines: [{ qty: 1, rate: 100 }] });
    assert.throws(() => localDb.payments.record({ invoiceId: d.id, amount: 10, method: 'Cash', date: DAY }), /invoices only/);
  }
  const inv = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 1000 }] });
  localDb.payments.record({ invoiceId: inv.id, amount: 500, method: 'Cash', date: DAY });
  assert.equal(localDb.invoices.getById(inv.id)!.status, 'Partially Paid');
});

/* ── F6 ─────────────────────────────────────────────────────────── */

function retainerSchedule(mode: 'draft' | 'issue', start: string) {
  const src = createViaStore({ date: DAY, lines: [{ name: 'Retainer', qty: 1, rate: 1000, tax: 0 }] });
  return { src, s: recurringDb.save(createSchedule({ name: 'Retainer', template: templateFromInvoice(src), frequency: 'monthly', start_date: start, mode })) };
}

test('F6: a recurring draft takes no number; deleting it leaves no gap; issuing it numbers it next in the series', () => {
  const { src, s } = retainerSchedule('draft', DAY);
  assert.equal(src.invoice_number, 'INV/FY26-27/0001');
  const run = runDueSchedules(DAY);
  assert.equal(run.generated.length, 1);
  const draft = run.generated[0];
  assert.equal(draft.status, 'Draft');
  assert.equal(draft.invoice_number, '', 'a draft does not consume a series number');
  assert.equal(recurringDb.getById(s.id)!.next_run, '2026-06-10');
  // Deleting the draft: the next invoice is 0002, no hole.
  localDb.invoices.remove(draft.id);
  const next = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 50 }] });
  assert.equal(next.invoice_number, 'INV/FY26-27/0002');

  // A second draft, issued from the list: numbered then, after everything already issued.
  recurringDb.save({ ...recurringDb.getById(s.id)!, next_run: DAY, history: [] });
  const again = runDueSchedules(DAY).generated[0];
  assert.equal(again.invoice_number, '');
  localDb.invoices.setStatus(again.id, 'Sent');
  assert.equal(localDb.invoices.getById(again.id)!.invoice_number, 'INV/FY26-27/0003');
  // Already issued numbers never change.
  assert.equal(localDb.invoices.getById(src.id)!.invoice_number, 'INV/FY26-27/0001');
  assert.equal(localDb.invoices.getById(next.id)!.invoice_number, 'INV/FY26-27/0002');
});

test('F6: issue-mode schedules still number at once; a payment that settles an unnumbered draft numbers it', () => {
  const { s } = retainerSchedule('issue', DAY);
  const issued = runDueSchedules(DAY).generated[0];
  assert.equal(issued.invoice_number, 'INV/FY26-27/0002');
  recurringDb.save({ ...recurringDb.getById(s.id)!, mode: 'draft', next_run: '2026-05-11', start_date: '2026-05-11', history: [] });
  freezeDate('2026-05-11T10:00:00');
  const draft = runDueSchedules('2026-05-11').generated[0];
  assert.equal(draft.invoice_number, '');
  localDb.payments.record({ invoiceId: draft.id, amount: draft.total, method: 'Cash', date: '2026-05-11' });
  const paid = localDb.invoices.getById(draft.id)!;
  assert.equal(paid.status, 'Paid');
  assert.equal(paid.invoice_number, 'INV/FY26-27/0003');
});

test('F6: "Run now" never bills a period that is not due unless confirmed, and a stale list cannot bill today twice', () => {
  const { s } = retainerSchedule('draft', DAY);
  runDueSchedules(DAY); // the first auto-run bills today
  // The page still shows next run = today; runNow re-reads and sees the next period is in the future.
  assert.throws(() => runNow(s.id, DAY), /not due yet/);
  assert.equal(localDb.invoices.getAll().filter((i) => (i as { recurring_id?: string }).recurring_id === s.id).length, 1);
  const early = runNow(s.id, DAY, { early: true })!;
  assert.equal(early.created, true);
  assert.equal(early.invoice.issue_date, DAY);
  assert.equal(recurringDb.getById(s.id)!.next_run, '2026-07-10');
});

test('F6: a schedule made from an invoice starts at the next occurrence after it, never in the past', () => {
  assert.equal(startAfterInvoice({ frequency: 'monthly', interval: 1 }, '2026-10-25', '2026-10-25'), '2026-11-25');
  assert.equal(startAfterInvoice({ frequency: 'quarterly', interval: 1 }, '2026-10-25', '2026-10-25'), '2027-01-25');
  assert.equal(startAfterInvoice({ frequency: 'weekly', interval: 1 }, '2026-10-25', '2026-10-25'), '2026-11-01');
  // An old invoice: the first date on or after today, on the invoice's day of month.
  assert.equal(startAfterInvoice({ frequency: 'monthly', interval: 1 }, '2026-08-10', '2026-10-25'), '2026-11-10');
  assert.equal(startAfterInvoice({ frequency: 'monthly', interval: 1 }, 'junk', '2026-10-25'), '2026-10-25');
});

/* ── F16 / F27 ──────────────────────────────────────────────────── */

test('F16: the day Z report float comes from the first shift of that day', async () => {
  const { dayOpeningFloat } = await import('../src/lib/pos-shifts.ts');
  const row = (number: number, day: string, opening_float: number) => ({ id: `s${number}${day}`, day, number, user_id: 'u', user_name: 'U', opened_at: '', opening_float, bill_ids: [] });
  assert.equal(dayOpeningFloat([row(2, DAY, 300), row(1, DAY, 1000), row(1, '2026-05-09', 50)], DAY), 1000);
  assert.equal(dayOpeningFloat([row(1, '2026-05-09', 50)], DAY), 0);
});

test('F27: the main company is labelled with its profile name, never over a name the user chose', async () => {
  const { COMPANY_REGISTRY_KEY, DEFAULT_COMPANY_NAME, readRegistry, writeRegistry } = await import('../src/lib/company-registry.ts');
  const { labelMainCompany } = await import('../src/lib/companies.ts');
  writeRegistry({ active: 'default', list: [{ id: 'default', name: DEFAULT_COMPANY_NAME, created: '' }, { id: 'demo1', name: 'Demo', created: '' }] });
  assert.equal(labelMainCompany(''), false);
  assert.equal(labelMainCompany('Demo'), false, 'a name another company has is skipped');
  assert.equal(labelMainCompany('  Asha   Traders '), true);
  assert.equal(readRegistry().list[0].name, 'Asha Traders');
  assert.equal(labelMainCompany('Other Name'), false, 'a labelled company keeps its name');
  writeRegistry({ active: 'demo1', list: [{ id: 'default', name: DEFAULT_COMPANY_NAME, created: '' }, { id: 'demo1', name: 'Demo', created: '' }] });
  assert.equal(labelMainCompany('Demo profile'), false, 'only while the main company is open');
  localStorage.removeItem(COMPANY_REGISTRY_KEY);
});

/* ── F15 ────────────────────────────────────────────────────────── */

test('F15: Dashboard "Outstanding" equals the Receivables open bills; net differs only by the credits shown', async () => {
  const { summarize } = await import('../src/lib/stats.ts');
  const { createCreditNote, readLinks } = await import('../src/lib/documents.ts');
  const { loadReceivablesInput } = await import('../src/lib/khata-actions.ts');
  const pune = { id: 'pune', name: 'Pune Mart', state_code: '27' } as never;
  const paid = createViaStore({ date: DAY, client: pune, lines: [{ name: 'Rack', qty: 1, rate: 1000, tax: 18 }] });
  localDb.payments.record({ invoiceId: paid.id, amount: paid.total, method: 'Cash', date: DAY });
  createCreditNote(localDb.invoices.getById(paid.id)!, { lines: [{ itemId: paid.items[0].id, quantity: 1 }], reason: 'Sales return', goodsReturned: false });
  const open = createViaStore({ date: DAY, lines: [{ qty: 2, rate: 5000, tax: 18 }] });
  localDb.payments.record({ invoiceId: open.id, amount: 1000, method: 'UPI', date: DAY });
  const now = new Date(`${DAY}T12:00:00`);
  const dash = summarize(localDb.invoices.getAll(), now, readLinks(), 'INR');
  const rep = buildReceivables(loadReceivablesInput(), { now });
  assert.equal(dash.outstanding, rep.totals.gross, 'same open-bill figure on both screens');
  assert.equal(rep.totals.net, Math.round((rep.totals.gross - rep.totals.creditNotes - rep.totals.advances) * 100) / 100);
  assert.equal(rep.totals.creditNotes, paid.total, 'the credit note on a paid bill is what separates net from gross');
});
