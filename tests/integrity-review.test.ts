/**
 * Regression tests for the independent DATA-INTEGRITY review (2026-10). One block per finding;
 * the reviewer's reproductions are the first test of items 1–5.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH, reload } from './helpers/world.ts';
import { saveAdvance, applyAdvance, loadAdvances, advanceBalance, nextAdvanceNumber, deleteAdvance } from '../src/lib/advances.ts';
import { cancelDocument, convertDocument, createCreditNote, reinstateDocument, readLinks } from '../src/lib/documents.ts';
import { localDb } from '../src/lib/localDb.ts';
import { stockDb, blankStockItem, loadPositions, stockWarningForInvoice, buildItemIndex, hsnCompatible, saveSettings, loadSettings, makeAdjustment } from '../src/lib/inventory.ts';
import { loadTracking, serialsInStock, liveDocTrackingIssues, editorStockContext, transferIssues, liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { isStockDependencyError, liveRemovalIssues } from '../src/lib/stock-timeline.ts';
import { purchasesDb, paymentsDb } from '../src/lib/purchases.ts';
import { godownsDb, transfersDb, godownReferences } from '../src/lib/godowns.ts';
import { purchaseOrdersDb } from '../src/lib/purchase-orders.ts';
import { receiptNumber } from '../src/lib/receipts.ts';
import { saveCheque, transitionCheque, deleteCheque, linkedPaymentMissing } from '../src/lib/cheques.ts';
import * as ts from '../src/lib/timesheets.ts';
import * as R from '../src/lib/recurring.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';
import { bankAccountUsage } from '../src/lib/bank-accounts.ts';
import { costCentreUsage, usageTotal } from '../src/lib/cost-centres.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { audit } from '../src/lib/audit.ts';
import { setTable, getTable } from '../src/lib/storage.ts';
import { dayCloseDb } from '../src/lib/pos.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { TimeEntry } from '../src/types/time.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => setActorProvider(null));

const TODAY = '2026-10-25';

function phone(serials: string[]) {
  const item = blankStockItem({ name: 'Phone', hsn: '8517', track_serials: true, opening_qty: serials.length, opening_rate: 100, opening_serials: serials });
  stockDb.saveItem(item);
  return item;
}
const withSerials = (id: string, serials: string[]): InvoiceRecord => ({ ...reload(id), items: reload(id).items.map((i) => ({ ...i, serials })) });
const sellPhone = (date: string, serials: string[]) => {
  const inv = createViaStore({ date, lines: [{ name: 'Phone', hsn: '8517', qty: serials.length, rate: 1000 }] });
  localDb.invoices.save(withSerials(inv.id, serials));
  return reload(inv.id);
};
function bill(over: Partial<PurchaseRecord> & { lines: PurchaseRecord['lines'] }): PurchaseRecord {
  return purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'V', bill_number: `B-${Math.random().toString(36).slice(2, 6)}`, date: '2026-04-20', category: 'Purchases',
    taxable: 100, cgst: 0, sgst: 0, igst: 0, itc_eligible: true, total: 100, amount_paid: 0, ...over,
  } as PurchaseRecord);
}

/* ── 1. Reinstating a cancelled document ─────────────────────── */

test('1: reinstating refuses an advance that was re-applied elsewhere meanwhile (reviewer repro)', () => {
  const a = saveAdvance({ date: '2026-04-05', client: { id: clientMH.id, name: clientMH.name }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 1180, method: 'Bank transfer' }, { today: TODAY });
  const inv1 = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const inv2 = createViaStore({ date: '2026-04-11', lines: [{ qty: 1, rate: 1000 }] });
  applyAdvance({ advanceId: a.id, invoiceId: inv1.id, amount: 1180 }, { today: TODAY });
  cancelDocument(reload(inv1.id), 'mistake', { acknowledgePayments: true });
  applyAdvance({ advanceId: a.id, invoiceId: inv2.id, amount: 1180 }, { today: TODAY });
  assert.throws(() => reinstateDocument(reload(inv1.id)), /Advance ADV\/FY26-27\/0001 was used elsewhere/);
  assert.equal(reload(inv1.id).status, 'Cancelled');
  const bal = advanceBalance(loadAdvances()[0], localDb.payments.getAll(), localDb.invoices.getAll());
  assert.equal(bal.adjusted, 1180);
  assert.equal(bal.over, 0);
  // `over` reports an over-adjustment the clamped `open` hides.
  const forced = advanceBalance(loadAdvances()[0], localDb.payments.getAll(), localDb.invoices.getAll().map((i) => ({ ...i, status: 'Sent' as const })));
  assert.deepEqual([forced.open, forced.over], [0, 1180]);
});

test('1: reinstating refuses a serial resold meanwhile (reviewer repro); a clean reinstate still works', () => {
  phone(['IMEI1', 'IMEI2']);
  const inv1 = sellPhone('2026-04-10', ['IMEI1']);
  cancelDocument(inv1, 'mistake');
  const inv2 = createViaStore({ date: '2026-04-11', lines: [{ name: 'Phone', hsn: '8517', qty: 1, rate: 1000 }] });
  assert.deepEqual(liveDocTrackingIssues(withSerials(inv2.id, ['IMEI1'])).errors, []);
  localDb.invoices.save(withSerials(inv2.id, ['IMEI1']));
  assert.throws(() => reinstateDocument(reload(inv1.id)), /serial IMEI1 is sold or moved later on INV\/FY26-27\/0002/);
  const t = [...loadTracking().values()][0];
  assert.equal(t.serials.find((s) => s.serial === 'IMEI1')!.history.filter((h) => h.kind === 'sale').length, 1);
  // Nothing conflicts: reinstate goes through.
  const inv3 = sellPhone('2026-04-12', ['IMEI2']);
  cancelDocument(inv3, 'oops');
  assert.equal(reinstateDocument(reload(inv3.id)).status, 'Sent');
});

const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: over.id ?? Math.random().toString(36).slice(2), client_id: clientMH.id, client_name: clientMH.name, description: 'Research',
  date: '2026-10-19', minutes: 60, hourly_rate: 1000, billable: true, ...over,
});

test('1: time billed again while the invoice was cancelled blocks the reinstate', () => {
  localDb.clients.upsert(clientMH);
  ts.timeDb.save(entry({ id: 't1' }));
  const inv1 = ts.billUnbilled(clientMH.id, ts.unbilledFor(clientMH.id));
  assert.deepEqual(inv1.items[0].bill_refs, ['t1']);
  cancelDocument(inv1, 'redo');
  const inv2 = ts.billUnbilled(clientMH.id, ts.unbilledFor(clientMH.id));
  assert.throws(() => reinstateDocument(reload(inv1.id)), new RegExp(`time entries on this document has since been billed on ${inv2.invoice_number.replace(/\//g, '\\/')}`));
});

test('1: billed state follows the lines — deleting the line frees it; a duplicate keeps billing after the original goes', () => {
  localDb.clients.upsert(clientMH);
  ts.timeDb.save(entry({ id: 't1', project: 'A' }));
  ts.timeDb.save(entry({ id: 't2', project: 'B' }));
  const inv = ts.billUnbilled(clientMH.id, ts.unbilledFor(clientMH.id));
  assert.equal(ts.unbilledFor(clientMH.id).time.length, 0);
  // Delete the "B" line from the draft: t2 is free again, t1 stays billed.
  localDb.invoices.save({ ...reload(inv.id), items: reload(inv.id).items.filter((i) => !i.bill_refs?.includes('t2')) });
  assert.deepEqual(ts.unbilledFor(clientMH.id).time.map((e) => e.id), ['t2']);
  // Duplicate (copies lines with their refs), then delete the original: the copy still bills t1.
  const copy = localDb.invoices.save({ ...reload(inv.id), id: 'copy-1', invoice_number: '', status: 'Draft' });
  localDb.invoices.remove(inv.id);
  assert.deepEqual(ts.unbilledFor(clientMH.id).time.map((e) => e.id), ['t2']);
  assert.equal(ts.billedBy(ts.timeDb.all().find((e) => e.id === 't1')!.invoiced_in, ts.currentLiveInvoiceIds(), 't1'), copy.id);
  // Legacy invoice without refs: the old pointer rule still applies.
  const legacy = ts.liveInvoiceIds([{ id: 'old', status: 'Sent', items: [{}] }]);
  assert.equal(ts.isBilled('old', legacy, 'x'), true);
});

test('1: reinstating an invoice refuses sales-order over-fulfilment', () => {
  const so = createViaStore({ docType: 'SALES_ORDER', date: '2026-05-01', lines: [{ name: 'Widget', qty: 10, rate: 100 }] });
  const a = convertDocument(so, 'TAX_INVOICE');
  localDb.invoices.save({ ...reload(a.id), status: 'Sent' });
  cancelDocument(reload(a.id), 'wrong rate');
  const b = convertDocument(reload(so.id), 'TAX_INVOICE');
  localDb.invoices.save({ ...reload(b.id), status: 'Sent' });
  assert.throws(() => reinstateDocument(reload(a.id)), /20 would be invoiced against 10 ordered/);
  assert.ok(readLinks().some((l) => l.relation === 'cancelled' && l.from_id === a.id), 'still cancelled');
});

/* ── 2. Serials, as-of dates, removals ───────────────────────── */

test('2a: partial credit notes take serials not already returned, and are checked', () => {
  phone(['S1', 'S2']);
  const inv = sellPhone('2026-04-10', ['S1', 'S2']);
  const line = inv.items[0];
  const cn1 = createCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: line.id, quantity: 1 }] });
  const cn2 = createCreditNote(reload(inv.id), { reason: 'Sales return', lines: [{ itemId: line.id, quantity: 1 }] });
  assert.deepEqual([cn1.items[0].serials, cn2.items[0].serials], [['S1'], ['S2']]);
  assert.deepEqual(serialsInStock([...loadTracking().values()][0]).sort(), ['S1', 'S2']);
});

test('2b: a sale dated before the serial was received is refused (reviewer repro)', () => {
  stockDb.saveItem(blankStockItem({ name: 'Phone', hsn: '8517', track_serials: true }));
  bill({ date: '2026-04-20', lines: [{ id: 'l1', name: 'Phone', hsn: '8517', quantity: 1, rate: 100, tax_rate: 0, serials: ['S9'] }] });
  const early = createViaStore({ date: '2026-04-05', lines: [{ name: 'Phone', hsn: '8517', qty: 1, rate: 1000 }], asDraft: true });
  const e1 = liveDocTrackingIssues({ ...withSerials(early.id, ['S9']), status: 'Sent' }).errors;
  assert.match(e1[0], /serial S9 is not in stock on 2026-04-05 \(it was received on 2026-04-20\)/);
  // After the receipt it sells once …
  const late = sellPhone('2026-04-25', ['S9']);
  // … and the early (back-dated) sale can no longer take it: a later document depends on it.
  const again = liveDocTrackingIssues({ ...withSerials(early.id, ['S9']), status: 'Sent', issue_date: '2026-04-22' }).errors;
  assert.match(again[0], new RegExp(`sold or moved later on ${late.invoice_number.replace(/\//g, '\\/')}`));
});

test('2b: a transfer cannot move stock a later sale from the source godown relies on', () => {
  const item = blankStockItem({ name: 'Widget', hsn: '1234', opening_qty: 10, opening_rate: 5 });
  stockDb.saveItem(item);
  const shop = godownsDb.save({ name: 'Shop' });
  createViaStore({ date: '2026-05-10', lines: [{ name: 'Widget', hsn: '1234', qty: 8, rate: 10 }] }); // from Main
  const errors = transferIssues({ id: 'n', date: '2026-05-01', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'a', item_id: item.id, qty: 5 }] }, liveTrackingInputs());
  assert.match(errors[0], /only 2 NOS in the source godown \(later documents use the rest/);
});

test('2c: deleting a bill whose serial was sold is refused; quantities need a confirmation', () => {
  stockDb.saveItem(blankStockItem({ name: 'Phone', hsn: '8517', track_serials: true }));
  const b = bill({ date: '2026-04-01', lines: [{ id: 'l1', name: 'Phone', hsn: '8517', quantity: 1, rate: 100, tax_rate: 0, serials: ['S1'] }] });
  sellPhone('2026-04-10', ['S1']);
  assert.throws(() => purchasesDb.remove(b.id), (err: unknown) => isStockDependencyError(err) && !err.confirmable && /serial S1/.test(err.message));
  assert.throws(() => purchasesDb.remove(b.id, { confirmStock: true }), /serial S1/);
  assert.ok(purchasesDb.get(b.id));

  stockDb.saveItem(blankStockItem({ name: 'Bolt', hsn: '7318' }));
  const b2 = bill({ date: '2026-04-01', lines: [{ id: 'l2', name: 'Bolt', hsn: '7318', quantity: 10, rate: 1, tax_rate: 0 }] });
  createViaStore({ date: '2026-04-15', lines: [{ name: 'Bolt', hsn: '7318', qty: 4, rate: 2 }] });
  assert.throws(() => purchasesDb.remove(b2.id), (err: unknown) => isStockDependencyError(err) && err.confirmable);
  purchasesDb.remove(b2.id, { confirmStock: true });
  assert.equal(purchasesDb.get(b2.id), undefined);
});

test('2c: deleting a transfer / cancelling a credit note whose goods moved on is refused', () => {
  const item = phone(['S1', 'S2']);
  const shop = godownsDb.save({ name: 'Shop' });
  const t = transfersDb.save({ date: '2026-04-05', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'x', item_id: item.id, qty: 1, serials: ['S1'] }] });
  const inv = createViaStore({ date: '2026-04-10', lines: [{ name: 'Phone', hsn: '8517', qty: 1, rate: 1000 }] });
  localDb.invoices.save({ ...withSerials(inv.id, ['S1']), items: reload(inv.id).items.map((i) => ({ ...i, serials: ['S1'], godown_id: shop.id })) });
  assert.throws(() => transfersDb.remove(t.id), /serial S1/);

  const inv2 = sellPhone('2026-04-11', ['S2']);
  const cn = createCreditNote(inv2, { reason: 'Sales return', lines: [{ itemId: inv2.items[0].id, quantity: 1 }] });
  sellPhone('2026-12-01', ['S2']); // resold after the return
  assert.ok(liveRemovalIssues({ refType: 'invoice', refId: cn.id }).errors.length > 0);
  assert.throws(() => cancelDocument(reload(cn.id), 'oops'), /serial S2/);
});

/* ── 3. Bill of Supply / recurring issue ─────────────────────── */

test('3: Bill of Supply is an outgoing stock document everywhere (reviewer repro)', () => {
  phone(['S1']);
  assert.ok(editorStockContext({ doc_type: 'BILL_OF_SUPPLY', issue_date: '2026-04-10' })?.outgoing);
  const issues = liveDocTrackingIssues({ doc_type: 'BILL_OF_SUPPLY', status: 'Sent', issue_date: '2026-04-10', items: [{ id: 'x', name: 'Phone', hsn: '8517', quantity: 1, rate: 1, amount: 1, type: 'Goods' }] });
  assert.match(issues.errors[0], /pick 1 serial number/);
  assert.ok(stockWarningForInvoice({ doc_type: 'BILL_OF_SUPPLY', items: [{ id: 'x', name: 'Phone', hsn: '8517', quantity: 3, rate: 1, amount: 1, type: 'Goods' }] }).length > 0);
});

test('3: an issue-mode recurring invoice with a serial item is saved as a Draft, with the reason', () => {
  phone(['S1']);
  const draft = makeDraft({ settings: localDb.settings.get(), sender: null });
  draft.client = { ...draft.client, name: 'Acme' };
  draft.items = [{ id: 'i1', name: 'Phone', hsn: '8517', type: 'Goods', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }];
  const s = R.recurringDb.save(R.createSchedule({ name: 'Phones', template: R.templateFromInvoice(draft), frequency: 'monthly', due_in_days: 10, mode: 'issue', start_date: '2026-06-05' }));
  const r = R.generateInvoiceFromSchedule(s, '2026-06-05');
  assert.equal(r.invoice.status, 'Draft');
  assert.match(r.heldAsDraft![0], /pick 1 serial number/);
});

/* ── 4. Rename / HSN refinement keeps history ────────────────── */

test('4: refining the HSN or renaming an item keeps its history (reviewer repro)', () => {
  const item = blankStockItem({ name: 'Widget', hsn: '8517', opening_qty: 10, opening_rate: 100 });
  stockDb.saveItem(item);
  createViaStore({ date: '2026-04-10', lines: [{ name: 'Widget', hsn: '8517', qty: 4, rate: 1000 }] });
  stockDb.saveItem({ ...item, hsn: '85171300' });
  assert.equal(loadPositions()[0].qty, 6);
  stockDb.saveItem({ ...stockDb.items()[0], name: 'Widget Pro' });
  assert.deepEqual(stockDb.items()[0].aliases, ['Widget']);
  assert.equal(loadPositions()[0].qty, 6);
  assert.equal(hsnCompatible('8517', '8517 13 00'), true);
  assert.equal(hsnCompatible('8517', '9403'), false);
  // A current name wins over another item's alias.
  const idx = buildItemIndex([{ ...stockDb.items()[0] }, blankStockItem({ name: 'Widget', id: 'new' })]);
  assert.equal(idx.find('Widget')?.id, 'new');
  // Opening serials are not resurrected after a rename.
  const p = phone(['S1']);
  sellPhone('2026-04-10', ['S1']);
  stockDb.saveItem({ ...p, name: 'Phone X' });
  assert.deepEqual(serialsInStock(loadTracking().get(p.id)), []);
});

/* ── 5. Receipt numbers are stamped ─────────────────────────── */

test('5: receipt numbers never shift when a cheque bounces (reviewer repro)', () => {
  const a = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const b = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const c = saveCheque({ direction: 'received', number: '123456', bank: 'HDFC', cheque_date: '2026-04-11', amount: 500, party_name: 'X', invoice_id: a.id });
  transitionCheque(c.id, 'cleared', { date: '2026-04-11', today: TODAY });
  const p2 = localDb.payments.record({ invoiceId: b.id, amount: 300, method: 'UPI', date: '2026-04-12' });
  assert.equal(p2.receipt_number, 'RCPT/FY26-27/0002');
  transitionCheque(c.id, 'bounced', { date: '2026-04-13', today: TODAY });
  assert.equal(receiptNumber(p2, localDb.payments.getAll()), 'RCPT/FY26-27/0002');
  // The bounced receipt's number is not handed out again.
  assert.equal(localDb.payments.record({ invoiceId: a.id, amount: 100, method: 'UPI', date: '2026-04-14' }).receipt_number, 'RCPT/FY26-27/0003');
});

test('5: legacy unstamped receipts keep their derived numbers; new ones continue after them', () => {
  const a = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  setTable('transactions', [
    { id: 'p1', invoice_id: a.id, amount: 10, method: 'UPI', date: '2026-04-11' },
    { id: 'p2', invoice_id: a.id, amount: 10, method: 'UPI', date: '2026-04-12' },
  ]);
  const p3 = localDb.payments.record({ invoiceId: a.id, amount: 10, method: 'UPI', date: '2026-04-05' });
  assert.equal(p3.receipt_number, 'RCPT/FY26-27/0003', 'after the legacy count, even though dated earlier');
  const all = localDb.payments.getAll();
  assert.deepEqual(['p1', 'p2'].map((id) => receiptNumber(all.find((p) => p.id === id)!, all)), ['RCPT/FY26-27/0001', 'RCPT/FY26-27/0002']);
});

/* ── 6. Editor stock warning cost ────────────────────────────── */

test('6: stock warnings stay cheap per keystroke with 10k invoices', () => {
  const invoices = Array.from({ length: 10000 }, (_, n) => ({
    id: `i${n}`, invoice_number: `INV/FY26-27/${n}`, doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-01',
    client: { name: 'C' }, items: Array.from({ length: 5 }, (_, k) => ({ id: `l${n}-${k}`, name: `Item ${k}`, hsn: '1234', quantity: 1, rate: 100, amount: 100, type: 'Goods' })), total: 500,
  }));
  setTable('invoices', invoices);
  const doc = { doc_type: 'INVOICE' as const, items: invoices[0].items as never };
  const time = (fn: () => void) => { const t0 = performance.now(); fn(); return performance.now() - t0; };
  // No stock items at all: returns before reading invoices.
  assert.ok(time(() => { for (let i = 0; i < 20; i++) stockWarningForInvoice(doc); }) / 20 < 5);
  // Tracked item: the first call computes, later calls (same data) hit the cache.
  stockDb.saveItem(blankStockItem({ name: 'Item 1', hsn: '1234', opening_qty: 5 }));
  assert.equal(stockWarningForInvoice({ doc_type: 'INVOICE', items: [{ ...invoices[0].items[1], quantity: 6 }] as never })[0].shortBy, 6);
  const cached = time(() => { for (let i = 0; i < 20; i++) stockWarningForInvoice({ doc_type: 'INVOICE', items: [{ ...invoices[0].items[1], quantity: i + 1 }] as never }); }) / 20;
  assert.ok(cached < 25, `cached keystroke took ${cached.toFixed(1)} ms`);
  // A quotation never computes.
  assert.deepEqual(stockWarningForInvoice({ doc_type: 'QUOTATION', items: doc.items }), []);
});

/* ── 7. Delete guards ───────────────────────────────────────── */

test('7: godown, bank-account and cost-centre usage see drafts, templates, advances and settings', () => {
  assert.deepEqual(godownReferences('g2', { invoices: [{ items: [{ godown_id: 'g2' }] }] }), ['documents (including drafts, quotations and cancelled ones)']);
  assert.deepEqual(godownReferences('g2', { defaultGodown: 'g2', recurring: [{ template: { items: [{ godown_id: 'g2' }] } }] }), ['recurring templates', 'the default-godown setting']);
  assert.deepEqual(bankAccountUsage('b2', { advances: [{ refunds: [{ bank_account_id: 'b2' }] }], cheques: [{ bank_account_id: 'b2' }] }), ['advances / refunds', 'cheques']);
  const u = costCentreUsage('cc', { recurring: [{ template: { items: [{ cost_centre_id: 'cc' }] } }] });
  assert.equal(u.recurring, 1);
  assert.equal(usageTotal(u), 1);
});

/* ── 8. Number series never reuse a deleted latest number ────── */

test('8: STR / PO / ADV keep a high-water mark; cross-FY edits renumber', () => {
  const item = blankStockItem({ name: 'Widget', opening_qty: 50 });
  stockDb.saveItem(item);
  const shop = godownsDb.save({ name: 'Shop' });
  const t1 = transfersDb.save({ date: '2026-05-01', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'a', item_id: item.id, qty: 1 }] });
  const t2 = transfersDb.save({ date: '2026-05-02', from_godown: 'main', to_godown: shop.id, lines: [{ id: 'b', item_id: item.id, qty: 1 }] });
  transfersDb.remove(t2.id);
  assert.equal(transfersDb.nextNumber('2026-05-03'), 'STR/FY26-27/0003');
  // Moving the date into the previous FY takes that FY's series.
  assert.equal(transfersDb.save({ ...t1, date: '2026-03-20' }).transfer_number, 'STR/FY25-26/0001');

  const po = (date: string) => purchaseOrdersDb.save({ vendor_name: 'V', date, lines: [{ id: 'l', name: 'X', quantity: 1, rate: 1, tax_rate: 0 }] } as never);
  po('2026-05-01');
  const p2 = po('2026-05-02');
  purchaseOrdersDb.remove(p2.id, []);
  assert.equal(purchaseOrdersDb.nextNumber('2026-05-03'), 'PO/FY26-27/0003');
  assert.equal(purchaseOrdersDb.save({ ...p2, id: undefined, po_number: undefined, date: '2027-04-02' } as never).po_number, 'PO/FY27-28/0001');
  assert.ok(audit.all().some((r) => r.entity === 'purchase_order' && r.action === 'delete'));
  assert.ok(audit.all().some((r) => r.entity === 'godown' && r.action === 'create'));

  const adv = (date: string) => saveAdvance({ date, client: { name: 'A' }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 100, method: 'UPI' }, { today: TODAY });
  adv('2026-05-01');
  const a2 = adv('2026-05-02');
  deleteAdvance(a2.id);
  assert.equal(nextAdvanceNumber('2026-05-03'), 'ADV/FY26-27/0003');
  // The marks are a backed-up table.
  assert.ok(getTable<{ id: string }>('series_counters').some((r) => r.id === 'STR/FY26-27'));
});

/* ── 9. Roles + audit ───────────────────────────────────────── */

test('9: a viewer cannot change stock valuation or time preferences; adjustments respect the lock and are audited', () => {
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  assert.throws(() => saveSettings({ ...loadSettings(), method: 'FIFO' }), /cannot change settings/);
  assert.throws(() => ts.saveTimePrefs(ts.readTimePrefs()), /Viewer/);
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => saveSettings({ ...loadSettings(), method: 'FIFO' }), /cannot change settings/);
  setActorProvider(null);
  saveSettings({ ...loadSettings(), method: 'FIFO' });
  assert.ok(audit.all().some((r) => r.entity === 'settings' && /FIFO/.test(r.summary)));

  const item = blankStockItem({ name: 'Widget' });
  stockDb.saveItem(item);
  stockDb.addMove(makeAdjustment({ item_id: item.id, date: '2026-04-02', direction: 'add', qty: 3, reason: 'Found' }));
  assert.ok(audit.all().some((r) => r.entity === 'stock_adjustment' && r.action === 'create'));
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-04-30' });
  assert.throws(() => stockDb.addMove(makeAdjustment({ item_id: item.id, date: '2026-04-10', direction: 'remove', qty: 1, reason: 'Late' })), /lock/i);
  assert.throws(() => stockDb.deleteMove(stockDb.moves()[0].id), /lock/i);
});

test('9: POS day re-counts are audited', () => {
  const z = { day: '2026-06-01', bills: 1, net: 100, tenders: { cash: 100, upi: 0, card: 0 } } as never;
  dayCloseDb.close(z, 0, 100);
  dayCloseDb.close(z, 0, 90);
  const rows = audit.all().filter((r) => r.entity === 'pos_day_close');
  assert.deepEqual(rows.map((r) => r.action).sort(), ['create', 'update']);
  assert.match(rows.find((r) => r.action === 'update')!.summary, /Re-counted .* \(was counted ₹100\)/);
});

/* ── 10. Cheques ────────────────────────────────────────────── */

test('10: a cleared cheque records the payment into its bank account; a deleted invoice leaves an editable cheque', () => {
  const a = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const c = saveCheque({ direction: 'received', number: '654321', bank: 'HDFC', cheque_date: '2026-04-11', amount: 500, party_name: 'X', invoice_id: a.id, bank_account_id: 'acc2' });
  const r = transitionCheque(c.id, 'cleared', { date: '2026-04-11', today: TODAY });
  assert.equal(r.payment?.bank_account_id, 'acc2');
  localDb.invoices.remove(a.id);
  const cleared = r.cheque;
  assert.equal(linkedPaymentMissing(cleared), true);
  assert.match(transitionCheque(c.id, 'bounced', { date: '2026-04-12', today: TODAY }).note ?? '', /no longer exists/);
  deleteCheque(c.id);

  const bill2 = bill({ date: '2026-04-01', lines: [{ id: 'l', name: 'Rent', quantity: 1, rate: 100, tax_rate: 0 }] });
  const iss = saveCheque({ direction: 'issued', number: '111111', bank: 'SBI', cheque_date: '2026-04-11', amount: 50, party_name: 'V', purchase_id: bill2.id, bank_account_id: 'acc3' });
  transitionCheque(iss.id, 'cleared', { date: '2026-04-11', today: TODAY });
  assert.equal(paymentsDb.forPurchase(bill2.id)[0].bank_account_id, 'acc3');
});

/* ── 11. Bill unbilled expenses without a client master ──────── */

test('11: billing expenses of a client no longer in the list is refused with a message', () => {
  purchasesDb.save({
    kind: 'EXPENSE', vendor_name: 'IndiGo', bill_number: 'T1', date: '2026-10-20', category: 'Travel',
    lines: [{ id: 'l', name: 'Travel', quantity: 1, rate: 100, tax_rate: 0 }], taxable: 100, cgst: 0, sgst: 0, igst: 0,
    itc_eligible: false, total: 100, amount_paid: 0, billable_to_client_id: 'gone-client',
  } as PurchaseRecord);
  const sel = ts.unbilledFor('gone-client');
  assert.equal(sel.expenses.length, 1);
  assert.throws(() => ts.billUnbilled('gone-client', sel), /no longer in your client list/);
  localDb.clients.upsert({ ...clientMH, id: 'gone-client' });
  assert.equal(ts.billUnbilled('gone-client', sel).client.name, clientMH.name);
});
