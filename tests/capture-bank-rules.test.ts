/**
 * 8C (8.40–8.45): e-invoice QR decode + draft bill, documents inbox, duplicate supplier bill guard,
 * recurring draft bills, approvals for bills / payments, bank rules + memory (all-or-nothing apply).
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, gstin, SELLER_GSTIN, clientMH } from './helpers/world.ts';
import { setActorProvider, isAccessDeniedError, type Role } from '../src/lib/access.ts';
import { decodeEinvoiceQr, encodeEinvoiceQrForTest, qrDay, MAX_QR_TEXT } from '../src/lib/einvoice-qr.ts';
import { draftFromQr, findVendorByGstin } from '../src/lib/bill-capture.ts';
import { inboxDb } from '../src/lib/doc-inbox.ts';
import { draftsDb, billOfDraft } from '../src/lib/purchase-drafts.ts';
import { duplicateBillPairs, findBillDuplicates, normaliseBillNo } from '../src/lib/bill-duplicates.ts';
import { saveBillGuarded } from '../src/lib/bill-guard.ts';
import { billApprovalRequired, paymentApprovalRequired, DEFAULT_PURCHASE_POLICY } from '../src/lib/purchase-approval-gate.ts';
import {
  approveBill, approvePayment, pendingBillApprovals, pendingPaymentRequests, purchaseApprovalHistory, rejectBill, rejectPayment,
  requestSupplierPayment, savePurchaseApprovalPolicy,
} from '../src/lib/purchase-approvals.ts';
import { paymentsDb, purchasesDb } from '../src/lib/purchases.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { billsDueSoon, recurringBillsAll, runDueBillSchedules, saveRecurringBill } from '../src/lib/recurring-bills.ts';
import {
  buildMemory, conditionMatches, counterpartyToken, ruleDraftFromLine, ruleMatches, rulesDb, safeRegex, suggestCategorisations, validateRule,
  type BankRule,
} from '../src/lib/bank-rules.ts';
import { applyBankBatch } from '../src/lib/bank-rules-apply.ts';
import { bankDb, type BankLine, type BankStatement } from '../src/lib/bank-recon.ts';
import { captureNotices } from '../src/lib/capture-alerts.ts';
import { exceptionReport } from '../src/lib/ledger/exceptions.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const as = (role: Role, name: string = role) => setActorProvider(() => ({ id: name, name, role }));
const SUPPLIER = '27AAPFU0939F1ZV';
const SUPPLIER_KA = gstin('29AABCT1332L1Z');
const IRN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

const qrFixture = (over: Record<string, unknown> = {}) =>
  encodeEinvoiceQrForTest({
    SellerGstin: SUPPLIER, BuyerGstin: SELLER_GSTIN, DocNo: 'AS/2026/0042', DocTyp: 'INV', DocDt: '12/05/2026',
    TotInvVal: 11800, ItemCnt: 1, MainHsnCode: '84713010', Irn: IRN, IrnDt: '2026-05-12 10:30:00', ...over,
  });

function bill(over: Partial<PurchaseRecord> = {}): Omit<PurchaseRecord, 'id'> & { id?: string } {
  return {
    kind: 'PURCHASE', vendor_name: 'Acme Supplies', vendor_gstin: SUPPLIER, bill_number: 'AS/22', date: '2026-05-10', place_of_supply: '27',
    category: 'Purchases', lines: [{ id: 'l1', name: 'Paper', quantity: 10, rate: 100, tax_rate: 18 }], taxable: 1000, cgst: 90, sgst: 90, igst: 0,
    itc_eligible: true, total: 1180, amount_paid: 0, ...over,
  };
}

/* ── 8.40 QR decode ─────────────────────────────────────────────── */

test('signed QR: JWT payload decoded from a fixture (signature not verified)', () => {
  const res = decodeEinvoiceQr(qrFixture());
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.deepEqual(res.data, {
    sellerGstin: SUPPLIER, buyerGstin: SELLER_GSTIN, docNo: 'AS/2026/0042', docType: 'INV', docDate: '2026-05-12', total: 11800, itemCount: 1,
    mainHsn: '84713010', irn: IRN, irnDate: '2026-05-12',
  });
  assert.deepEqual(res.warnings, []);
  // `data` as an object (not a string) is accepted too
  const b64u = (s: string) => Buffer.from(s).toString('base64url');
  const objToken = `${b64u('{}')}.${b64u(JSON.stringify({ data: { SellerGstin: SUPPLIER, DocNo: 'X1', Irn: IRN, DocDt: '01/04/2026', TotInvVal: '10.5' } }))}.sig`;
  const o = decodeEinvoiceQr(objToken);
  assert.ok(o.ok && o.data.total === 10.5 && o.data.docDate === '2026-04-01');
});

test('signed QR: untrusted text is capped and cleaned, bad fields become warnings', () => {
  assert.deepEqual(decodeEinvoiceQr(''), { ok: false, error: 'empty' });
  assert.deepEqual(decodeEinvoiceQr('x'.repeat(MAX_QR_TEXT + 1)), { ok: false, error: 'tooLong' });
  assert.deepEqual(decodeEinvoiceQr('8901234567890'), { ok: false, error: 'notSignedQr' });
  assert.deepEqual(decodeEinvoiceQr('a.$$$.c'), { ok: false, error: 'unreadable' });
  const bad = decodeEinvoiceQr(qrFixture({ SellerGstin: '27AAPFU0939F1ZX', DocDt: '31/02/2026', Irn: 'nope', TotInvVal: -5, DocNo: 'A\u0000B<script>alert(1)</script>' }));
  assert.ok(bad.ok);
  if (!bad.ok) return;
  assert.ok(bad.warnings.includes('sellerGstin') && bad.warnings.includes('docDate') && bad.warnings.includes('irn') && bad.warnings.includes('total'));
  assert.equal(bad.data.docNo.length <= 16, true, 'doc no capped at 16');
  assert.ok(!bad.data.docNo.includes('\u0000'));
  assert.equal(bad.data.total, 0);
  assert.equal(qrDay('2026-13-01'), '');
  assert.equal(qrDay('5/6/2026'), '2026-06-05');
});

test('draft from QR: vendor by GSTIN, IGST for another state, GST backed out from the HSN master, buyer warning', () => {
  const v = vendorsDb.save({ name: 'Acme Supplies', gstin: SUPPLIER });
  const res = decodeEinvoiceQr(qrFixture());
  assert.ok(res.ok);
  if (!res.ok) return;
  const ctx = { vendors: [v], ourGstins: [SELLER_GSTIN], businessState: '27', today: '2026-06-01', hsnRate: (h: string) => (h.startsWith('8471') ? 18 : undefined) };
  const out = draftFromQr(res.data, ctx);
  assert.equal(out.vendor?.id, v.id);
  assert.equal(out.buyerMismatch, false);
  assert.equal(out.bill!.bill_number, 'AS/2026/0042');
  assert.equal(out.bill!.date, '2026-05-12');
  assert.equal(out.bill!.einvoice_irn, IRN);
  assert.equal(out.bill!.taxable, 10000);
  assert.equal(out.bill!.cgst + out.bill!.sgst, 1800);
  assert.equal(out.bill!.total, 11800);
  assert.equal(out.bill!.draft.review, undefined);
  assert.equal(out.bill!.draft.expected_total, 11800);

  // Supplier from Karnataka, unknown HSN rate, made out to someone else's GSTIN
  const ka = decodeEinvoiceQr(qrFixture({ SellerGstin: SUPPLIER_KA, BuyerGstin: gstin('07AAACB2230M1Z'), ItemCnt: 3 }));
  assert.ok(ka.ok);
  if (!ka.ok) return;
  const out2 = draftFromQr(ka.data, ctx);
  assert.equal(out2.vendor, null);
  assert.equal(out2.buyerMismatch, true);
  assert.equal(out2.bill!.place_of_supply, '29', 'IGST via the supplier state');
  assert.equal(out2.bill!.igst, 0, 'rate unknown → value kept, GST to check');
  assert.equal(out2.bill!.total, 11800);
  assert.deepEqual(out2.bill!.draft.review, ['gst', 'vendor']);
  assert.equal(out2.bill!.itc_eligible, false);
  assert.ok(out2.bill!.draft.foreign_buyer);
  // A supplier credit note is not a bill
  const crn = decodeEinvoiceQr(qrFixture({ DocTyp: 'CRN' }));
  assert.ok(crn.ok && draftFromQr(crn.data, ctx).bill === null);
  assert.equal(findVendorByGstin([v], SUPPLIER.toLowerCase())?.id, v.id);
});

test('inbox: add / update / remove; drafts stay out of purchases', () => {
  const row = inboxDb.add({ source: 'share', intent: 'expense', note: 'x'.repeat(500) });
  assert.equal(inboxDb.open().length, 1);
  assert.equal(row.note!.length, 200);
  const d = draftsDb.save({ ...bill(), draft: { source: 'capture', created_at: '' } });
  inboxDb.update(row.id, { draft_id: d.id });
  assert.equal(purchasesDb.all().length, 0, 'a draft is not a bill');
  assert.equal(d.status, 'draft');
  inboxDb.update(row.id, { status: 'dismissed' });
  assert.equal(inboxDb.open().length, 0);
  inboxDb.remove(row.id);
  assert.equal(inboxDb.all().length, 0);
  as('viewer');
  assert.throws(() => inboxDb.add({ source: 'upload' }), isAccessDeniedError);
});

/* ── 8.42 duplicates ────────────────────────────────────────────── */

test('duplicate guard: same supplier + bill no. in the FY; near duplicate within ±3 days', () => {
  assert.equal(normaliseBillNo('INV/0042'), normaliseBillNo('inv-42'));
  assert.equal(normaliseBillNo('A-001-B'), 'A1B');
  const existing = [{ ...bill(), id: 'p1' }, { ...bill({ bill_number: 'AS/99', date: '2026-05-12', total: 5000 }), id: 'p2' }] as PurchaseRecord[];
  assert.equal(findBillDuplicates(bill({ bill_number: 'as-0022', date: '2027-03-31', total: 50 }), existing).exact.length, 1, 'same FY 26-27');
  assert.equal(findBillDuplicates(bill({ bill_number: 'AS/22', date: '2027-04-01', total: 50 }), existing).exact.length, 0, 'next FY');
  assert.equal(findBillDuplicates(bill({ vendor_gstin: SUPPLIER_KA }), existing).exact.length, 0, 'other supplier');
  const near = findBillDuplicates(bill({ bill_number: 'NEW-1', date: '2026-05-15', total: 5000 }), existing);
  assert.deepEqual([near.exact.length, near.near.map((p) => p.id)], [0, ['p2']]);
  assert.equal(findBillDuplicates(bill({ bill_number: 'NEW-1', date: '2026-05-16', total: 5000 }), existing).near.length, 0, '4 days apart');
  assert.equal(findBillDuplicates({ ...bill(), id: 'p1' }, existing).exact.length, 0, 'itself');
  const pairs = duplicateBillPairs([...existing, { ...bill({ bill_number: 'AS-22', date: '2026-06-01' }), id: 'p3' }] as PurchaseRecord[]);
  assert.deepEqual(pairs.map((p) => [p.kind, p.a.id, p.b.id]), [['exact', 'p1', 'p3']]);
  const ex = exceptionReport({ accounts: [], vouchers: [], warnings: [] } as never, { start: '2026-04-01', end: '2027-03-31' }, '2026-06-30', { duplicateBills: pairs });
  assert.equal(ex.duplicateBills.length, 1, 'exception report row');
});

test('bill form save: soft duplicate warning, then override saves', () => {
  purchasesDb.save(bill());
  const first = saveBillGuarded(bill({ bill_number: 'AS-0022' }));
  assert.equal(first.kind, 'warn');
  assert.equal(purchasesDb.all().length, 1);
  const second = saveBillGuarded(bill({ bill_number: 'AS-0022' }), { confirmed: true });
  assert.equal(second.kind, 'saved');
  assert.equal(purchasesDb.all().length, 2);
});

test('posting a captured draft: total checked against the QR value, draft removed, inbox done', () => {
  const row = inboxDb.add({ source: 'upload' });
  const d = draftsDb.save({ ...bill({ bill_number: 'Q-1' }), draft: { source: 'capture', created_at: '', expected_total: 1500, inbox_id: row.id } });
  inboxDb.update(row.id, { draft_id: d.id });
  const r1 = saveBillGuarded({ ...billOfDraft(d), id: d.id });
  assert.equal(r1.kind, 'warn');
  const r2 = saveBillGuarded({ ...billOfDraft(d), id: d.id }, { confirmed: true });
  assert.equal(r2.kind, 'saved');
  assert.equal(purchasesDb.get(d.id)?.bill_number, 'Q-1');
  assert.equal((purchasesDb.get(d.id) as { status?: string }).status, undefined, 'no draft status in the books');
  assert.equal(draftsDb.all().length, 0);
  assert.equal(inboxDb.get(row.id)?.status, 'done');
});

/* ── 8.44 approvals ─────────────────────────────────────────────── */

test('approval gate (pure): bills above the threshold by clerks; payments; owner free', () => {
  const p = { ...DEFAULT_PURCHASE_POLICY, bills: true, billAbove: 10000, payments: true, paymentAbove: 0 };
  assert.equal(billApprovalRequired({ total: 15000 }, undefined, p, false), true);
  assert.equal(billApprovalRequired({ total: 5000 }, undefined, p, false), false);
  assert.equal(billApprovalRequired({ total: 15000 }, undefined, p, true), false);
  assert.equal(billApprovalRequired({ total: 15000 }, { total: 15000 }, p, false), false, 'unchanged value');
  assert.equal(billApprovalRequired({ total: 15000, branch_transfer_id: 't' }, undefined, p, false), false);
  assert.equal(paymentApprovalRequired(1, p, false), true, '0 = all payments');
  assert.equal(paymentApprovalRequired(1, { ...p, payments: false }, false), false);
});

test('approvals for bills: clerk held out of the books, owner approves or rejects with a reason', () => {
  as('owner');
  savePurchaseApprovalPolicy({ bills: true, billAbove: 1000, payments: true, paymentAbove: 500 });
  as('clerk', 'Ravi');
  assert.throws(() => purchasesDb.save(bill()), /owner's approval/, 'data layer refuses a direct save');
  const held = saveBillGuarded(bill(), { confirmed: true });
  assert.equal(held.kind, 'held');
  assert.equal(purchasesDb.all().length, 0, 'pending bill stays out of the books');
  assert.equal(pendingBillApprovals().length, 1);
  const id = held.kind === 'held' ? held.draft.id : '';
  assert.throws(() => approveBill(id), isAccessDeniedError);
  as('owner');
  assert.throws(() => rejectBill(id, ' '), /reason/);
  rejectBill(id, 'Wrong GST rate');
  assert.equal(draftsDb.get(id)?.draft.approval?.state, 'rejected');
  assert.equal(draftsDb.get(id)?.draft.approval?.note, 'Wrong GST rate');
  // Clerk fixes and sends again (same draft id)
  as('clerk', 'Ravi');
  const again = saveBillGuarded({ ...billOfDraft(draftsDb.get(id)!), id, notes: 'fixed' }, { confirmed: true });
  assert.equal(again.kind, 'held');
  assert.equal(draftsDb.all().length, 1);
  as('owner');
  const posted = approveBill(id, 'ok');
  assert.equal(posted.id, id);
  assert.equal(purchasesDb.all().length, 1);
  assert.equal(draftsDb.all().length, 0);
  assert.deepEqual(purchaseApprovalHistory().map((h) => h.decision), ['approved', 'rejected']);
});

test('approvals: a held "paid now" expense records its payment on approval; payment requests', () => {
  as('owner');
  savePurchaseApprovalPolicy({ bills: true, billAbove: 100, payments: true, paymentAbove: 500 });
  as('clerk');
  const exp = saveBillGuarded(
    { ...bill({ kind: 'EXPENSE', bill_number: '', category: 'Rent' }) },
    { confirmed: true, payNow: { method: 'UPI', date: '2026-05-10' } },
  );
  assert.equal(exp.kind, 'held');
  as('owner');
  const posted = approveBill(exp.kind === 'held' ? exp.draft.id : '');
  assert.equal(paymentsDb.forPurchase(posted.id).length, 1);
  assert.equal(purchasesDb.get(posted.id)?.amount_paid, 1180);

  const b = purchasesDb.save(bill({ bill_number: 'B-2' }));
  as('clerk');
  assert.throws(() => requestSupplierPayment({ purchaseId: b.id, amount: 5000, date: '2026-05-20', method: 'UPI' }), /exceeds/);
  const req = requestSupplierPayment({ purchaseId: b.id, amount: 1000, date: '2026-05-20', method: 'NEFT' });
  assert.equal(paymentsDb.forPurchase(b.id).length, 0, 'nothing paid while pending');
  assert.throws(() => requestSupplierPayment({ purchaseId: b.id, amount: 500, date: '2026-05-20', method: 'NEFT' }), /waiting/);
  as('owner');
  approvePayment(req.id);
  assert.equal(paymentsDb.forPurchase(b.id).length, 1);
  as('clerk');
  const req2 = requestSupplierPayment({ purchaseId: b.id, amount: 180, date: '2026-05-21', method: 'NEFT' });
  as('owner');
  rejectPayment(req2.id, 'Pay next week');
  assert.equal(pendingPaymentRequests().length, 0);
  assert.equal(paymentsDb.forPurchase(b.id).length, 1);
});

/* ── 8.43 recurring bills ───────────────────────────────────────── */

test('recurring bills write drafts only, idempotently, and show in "due this week"', () => {
  const s = saveRecurringBill(
    {
      name: 'Office rent', kind: 'EXPENSE', vendor_name: 'Landlord', category: 'Rent', place_of_supply: '27',
      lines: [{ id: 'x', name: 'Rent for {month} {year}', quantity: 1, rate: 20000, tax_rate: 18 }], itc_eligible: true, due_in_days: 5,
      frequency: 'monthly', interval: 1, start_date: '2026-04-01', active: true,
    },
    '2026-04-01',
  );
  const r = runDueBillSchedules('2026-06-15', '27');
  assert.equal(r.drafted.length, 3, 'Apr, May, Jun');
  assert.equal(purchasesDb.all().length, 0, 'never posted');
  const jun = draftsDb.all().find((d) => d.recurring_date === '2026-06-01')!;
  assert.equal(jun.lines[0].name, 'Rent for June 2026');
  assert.equal(jun.total, 23600);
  assert.equal(jun.due_date, '2026-06-06');
  assert.equal(jun.draft.source, 'recurring');
  assert.equal(runDueBillSchedules('2026-06-15', '27').drafted.length, 0, 'idempotent');
  assert.equal(recurringBillsAll()[0].next_run, '2026-07-01');
  const due = billsDueSoon([{ ...bill({ due_date: '2026-06-18' }), id: 'b1' } as PurchaseRecord], recurringBillsAll(), '2026-06-27', '27');
  assert.deepEqual([due.bills.length, due.upcoming.map((u) => [u.id, u.date])], [1, [[s.id, '2026-07-01']]]);
  const notes = captureNotices({ today: '2026-06-27', at: '', due, drafts: 3, inbox: 0, approver: false, pendingBills: 0, pendingPayments: 0 });
  assert.equal(notes.length, 3);
  assert.equal(notes[0].severity, 'warning', 'an overdue bill');
});

/* ── 8.45 bank rules + memory ───────────────────────────────────── */

const line = (id: string, narration: string, debit: number, credit = 0, date = '2026-05-10'): BankLine => ({ id, date, narration, ref: '', debit, credit });
const ctx = { accountOf: () => undefined };
const rule = (over: Partial<BankRule> = {}): BankRule => ({
  id: 'r1', name: 'Bank charges', match: 'all', conditions: [{ kind: 'contains', text: 'CHARGES' }, { kind: 'direction', dir: 'debit' }],
  action: { kind: 'expense', category: 'Bank charges', gst_rate: 18, itc: true }, priority: 1, active: true, created_at: '2026-01-01', ...over,
});

test('bank rules: safe regex, conditions, ALL / ANY', () => {
  assert.ok(safeRegex('^NEFT.*RENT'));
  assert.equal(safeRegex('(a+)+$'), null, 'nested quantifier');
  assert.equal(safeRegex('(a|aa)*b'), null, 'quantified alternation');
  assert.equal(safeRegex('(x)\\1'), null, 'back-reference');
  assert.equal(safeRegex('a'.repeat(121)), null, 'too long');
  assert.equal(safeRegex('[unclosed'), null);
  const l = line('a', 'SMS CHARGES QTR MAR26', 59);
  assert.equal(conditionMatches({ kind: 'starts', text: 'sms' }, l, ctx), true);
  assert.equal(conditionMatches({ kind: 'amount', min: 50, max: 60 }, l, ctx), true);
  assert.equal(conditionMatches({ kind: 'amount', min: 60 }, l, ctx), false);
  assert.equal(conditionMatches({ kind: 'regex', pattern: 'charges\\s+qtr' }, l, ctx), true);
  assert.equal(conditionMatches({ kind: 'account', bankAccountId: 'default' }, l, ctx), true);
  assert.equal(ruleMatches(rule(), l, ctx), true);
  assert.equal(ruleMatches(rule(), line('b', 'SMS CHARGES REVERSAL', 0, 59), ctx), false, 'credit fails ALL (and an expense needs a debit)');
  assert.equal(ruleMatches(rule({ match: 'any', conditions: [{ kind: 'contains', text: 'ZZZ' }, { kind: 'starts', text: 'SMS' }] }), l, ctx), true);
  assert.equal(counterpartyToken('UPI-BHARAT TRADERS-bharat@okhdfc-HDFC0000123-412345678901'), 'BHARAT TRADERS');
  assert.match(validateRule({ name: 'x', conditions: [{ kind: 'regex', pattern: '(.*)*' }], action: { kind: 'ignore' } }), /pattern/);
});

test('bank rules: run after invoice matching, memory learns from past categorisations, labels', () => {
  const exp = purchasesDb.save(bill({ kind: 'EXPENSE', category: 'Software & subscriptions', vendor_name: 'Zoho', bill_number: '', lines: [{ id: 'x', name: 'SaaS', quantity: 1, rate: 1000, tax_rate: 18 }] }));
  const pay = paymentsDb.record(exp.id, { amount: 1180, date: '2026-04-05', method: 'Card' });
  const past: BankStatement = { id: 's0', imported_at: '', bank_label: 'HDFC', file_name: 'a.csv', lines: [{ ...line('old', 'POS ZOHO CORPORATION CHENNAI', 1180, 0, '2026-04-05'), matched_to: { type: 'purchase_payment', id: pay.id } }] };
  const memory = buildMemory([past], purchasesDb.all(), paymentsDb.all());
  const tok = counterpartyToken('POS ZOHO CORPORATION CHENNAI');
  assert.equal(memory.get(tok)?.category, 'Software & subscriptions');
  const lines = [line('m', 'POS ZOHO CORPORATION CHENNAI', 1180), line('c', 'SMS CHARGES', 59), line('k', 'NEFT ACME PAYMENT INV/1', 500), line('i', 'IGNORED CHARGES', 10)];
  lines[3].ignored = true;
  const sug = suggestCategorisations(lines, [rule()], memory, ctx, new Set(['k']));
  assert.deepEqual(sug.map((s) => [s.lineId, s.source]), [['m', 'memory'], ['c', 'rule']]);
  assert.equal(sug[0].action.category, 'Software & subscriptions');
  const draft = ruleDraftFromLine(lines[0], sug[0].action);
  assert.deepEqual(draft.conditions[0], { kind: 'counterparty', token: tok });
  assert.equal(draft.action.category, 'Software & subscriptions');
});

test('bank rules apply: expense + payment + match through the writers; batch is all or nothing', () => {
  const st: BankStatement = { id: 's1', imported_at: '', bank_label: 'HDFC', file_name: 'b.csv', lines: [line('c1', 'SMS CHARGES', 59), line('c2', 'OLD CHARGES', 118, 0, '2026-03-10')] };
  bankDb.saveAll([st]);
  rulesDb.save({ name: 'Charges', match: 'all', conditions: [{ kind: 'contains', text: 'CHARGES' }], action: { kind: 'expense', category: 'Bank charges', gst_rate: 18, itc: true }, priority: 1, active: true });
  const action = rulesDb.all()[0].action;
  // Period locked up to 31 Mar: the second line refuses → nothing is written.
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-03-31' });
  assert.throws(() => applyBankBatch([{ line: st.lines[0], action, source: 'rule', label: 'Charges' }, { line: st.lines[1], action, source: 'rule', label: 'Charges' }]));
  assert.equal(purchasesDb.all().length, 0, 'rolled back');
  assert.equal(paymentsDb.all().length, 0);
  assert.equal(bankDb.all()[0].lines[0].matched_to, undefined);
  // The open line alone applies.
  const next = applyBankBatch([{ line: st.lines[0], action, source: 'rule', label: 'Charges' }]);
  const e = purchasesDb.all()[0];
  assert.deepEqual([e.kind, e.category, e.taxable, e.cgst + e.sgst, e.total, e.itc_eligible], ['EXPENSE', 'Bank charges', 50, 9, 59, true]);
  assert.equal(next[0].lines[0].matched_to?.type, 'purchase_payment');
  assert.equal(paymentsDb.all()[0].purchase_id, e.id);
  // An expense on a credit line is refused before anything is written.
  assert.throws(() => applyBankBatch([{ line: line('zz', 'REFUND CHARGES', 0, 59), action, source: 'manual' }]), /debit/);
  // Viewer cannot apply.
  as('viewer');
  assert.throws(() => applyBankBatch([{ line: st.lines[1], action: { kind: 'ignore' }, source: 'manual' }]), isAccessDeniedError);
});

test('bank rules apply: contra posts once (twin reused), receipt settles a customer\'s open invoices', () => {
  const a: BankStatement = { id: 'sa', imported_at: '', bank_label: 'HDFC', file_name: 'a.csv', lines: [line('t1', 'TRF TO CASH', 5000, 0, '2026-05-10'), line('r1', 'NEFT FROM BUYER', 0, 1180, '2026-05-11')] };
  bankDb.saveAll([a]);
  const st2 = applyBankBatch([{ line: a.lines[0], action: { kind: 'contra', ledger_id: 'cash' }, source: 'rule', label: 'Cash' }]);
  assert.equal(loadVouchers().filter((v) => v.type === 'CONTRA').length, 1);
  assert.equal(st2[0].lines[0].matched_to?.type, 'manual');
  // Same transfer seen again (e.g. from a second import): the existing contra is reused.
  bankDb.saveAll([...st2, { id: 'sb', imported_at: '', bank_label: 'HDFC', file_name: 'b.csv', lines: [line('t2', 'TRF TO CASH', 5000, 0, '2026-05-11')] }]);
  applyBankBatch([{ line: line('t2', 'TRF TO CASH', 5000, 0, '2026-05-11'), action: { kind: 'contra', ledger_id: 'cash' }, source: 'rule', label: 'Cash' }]);
  assert.equal(loadVouchers().filter((v) => v.type === 'CONTRA').length, 1, 'not posted twice');
  // Receipt against invoices
  const client = { ...clientMH, id: 'c-mh' };
  localDb.clients.upsert(client);
  const inv = localDb.invoices.save({
    id: 'i1', invoice_number: 'INV/FY26-27/0001', doc_type: 'INVOICE', issue_date: '2026-05-01', due_date: '2026-05-15', status: 'Sent', currency: 'INR',
    template_id: 'classic_orange', client, items: [{ id: 'l', name: 'Work', type: 'Service', quantity: 1, rate: 1180, tax_rate: 0, amount: 1180 }],
    gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: 1180, discount_amount: 0, taxable_value: 1180, cgst_amount: 0, sgst_amount: 0,
    igst_amount: 0, tax_amount: 0, round_off: 0, total: 1180, balance_due: 1180,
  } as never);
  const out = applyBankBatch([{ line: a.lines[1], action: { kind: 'receipt', client_id: client.id }, source: 'rule', label: 'Buyer' }]);
  assert.equal(out.find((s) => s.id === 'sa')!.lines[1].matched_to?.type, 'payment');
  assert.equal(localDb.invoices.getById((inv as { id: string }).id)?.amount_paid, 1180);
});

test('approval history: two decisions in the same millisecond list the later one first', async () => {
  const { setTable } = await import('../src/lib/storage.ts');
  const { APPROVALS_TABLE } = await import('../src/lib/approvals.ts');
  const at = '2026-05-12T10:30:00.000Z';
  const row = (id: string, decision: 'approved' | 'rejected') =>
    ({ id, doc_id: 'b1', doc_type: 'BILL', doc_number: 'AS/22', decision, decided_by: 'owner', decided_at: at });
  setTable(APPROVALS_TABLE, [row('r1', 'rejected'), row('r2', 'approved')]);
  assert.deepEqual(purchaseApprovalHistory().map((h) => h.decision), ['approved', 'rejected']);
});
