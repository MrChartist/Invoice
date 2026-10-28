/**
 * Approvals for bills, expenses and supplier payments (8.44): the request side (clerk) and the
 * owner's decisions. The gate itself is `purchase-approval-gate.ts`.
 *
 *  - A held bill / expense is a `purchase_drafts` row with `draft.approval.state = 'pending'`: out of
 *    the books (no report reads drafts). Approving posts it with `purchasesDb.save` as the owner (and
 *    records the "paid now" payment of a held expense); rejecting keeps the draft with the reason, so
 *    the clerk edits and sends it again.
 *  - A held supplier payment is a `payment_requests` row. Approving records it with
 *    `paymentsDb.record`; rejecting keeps the request with the reason.
 *  - Every decision writes the audit log and a row in the shared `approvals` decision log (owner-only
 *    table), so the Approvals tile shows one history for sales documents and purchases.
 * All writes are all-or-nothing (`withTablesRollback`).
 */

import type { PurchaseRecord } from '../types/purchases';
import { currentActor, requireAccess } from './access';
import { audit } from './audit';
import { APPROVALS_TABLE, approvalLog, type ApprovalLogRow } from './approvals';
import { draftsDb, billOfDraft, PURCHASE_DRAFTS_TABLE, type DraftMeta, type PurchaseDraft } from './purchase-drafts';
import { DOC_INBOX_TABLE, inboxDb } from './doc-inbox';
import { PAYMENTS_TABLE, PURCHASES_TABLE, paymentsDb, purchasesDb, validatePayment } from './purchases';
import { supplierPayable } from './purchase-normalize';
import { PURCHASE_APPROVAL_POLICY_KEY, type PurchaseApprovalPolicy } from './purchase-approval-gate';
import { ApprovalRequiredError } from './approval-gate';
import { generateId, getTable, setJson, setTable } from './storage';
import { withTablesRollback } from './table-txn';
import { formatCurrency } from './utils';

export const PAYMENT_REQUESTS_TABLE = 'payment_requests';

export interface PaymentRequest {
  id: string;
  purchase_id: string;
  bill_number: string;
  vendor_name: string;
  /** Cash to pay (₹). */
  amount: number;
  tds_amount?: number;
  /** YYYY-MM-DD the payment is to be dated. */
  date: string;
  method: string;
  reference?: string;
  bank_account_id?: string;
  requested_by: string;
  requested_at: string;
  state: 'pending' | 'approved' | 'rejected';
  decided_by?: string;
  decided_at?: string;
  note?: string;
  /** `purchase_payments` id recorded on approval. */
  payment_id?: string;
}

export class PurchaseApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseApprovalError';
  }
}

const who = () => currentActor()?.name ?? '';
const nowIso = () => new Date().toISOString();
const label = (b: Pick<PurchaseRecord, 'kind' | 'bill_number' | 'vendor_name'>) =>
  `${b.kind === 'EXPENSE' ? 'expense' : 'bill'}${b.bill_number ? ` ${b.bill_number}` : ''} of ${b.vendor_name || '—'}`;

function logSafe(fn: () => void) {
  try {
    fn();
  } catch {
    /* logging never blocks */
  }
}

export function savePurchaseApprovalPolicy(policy: PurchaseApprovalPolicy): void {
  requireAccess('settings.manage');
  const next: PurchaseApprovalPolicy = {
    bills: !!policy.bills,
    billAbove: Math.max(Number(policy.billAbove) || 0, 0),
    payments: !!policy.payments,
    paymentAbove: Math.max(Number(policy.paymentAbove) || 0, 0),
  };
  setJson(PURCHASE_APPROVAL_POLICY_KEY, next);
  logSafe(() =>
    audit.record({
      entity: 'settings',
      entity_id: 'purchase_approval_policy',
      action: 'update',
      summary: `Purchase approvals: bills ${next.bills ? `above ${formatCurrency(next.billAbove)}` : 'off'}, supplier payments ${next.payments ? `above ${formatCurrency(next.paymentAbove)}` : 'off'}`,
    }),
  );
}

/* ── Bills / expenses ───────────────────────────────────────────── */

/**
 * File a bill / expense for the owner's approval (a clerk's save above the threshold). Keeps the id of
 * the draft it was opened from, so a rejected request that is edited and sent again stays one row.
 * Editing the amount of a bill already in the books is refused instead (holding it would pull a posted
 * bill out of the books behind the owner's back).
 */
export function submitBillForApproval(input: Omit<PurchaseRecord, 'id'> & { id?: string }, opts: { payNow?: DraftMeta['pay_now'] } = {}): PurchaseDraft {
  requireAccess('books.edit');
  if (input.id && purchasesDb.get(input.id)) {
    throw new ApprovalRequiredError(`Changing the amount of ${label(input)} needs the owner's approval: ask the owner to make the change.`);
  }
  const prev = input.id ? draftsDb.get(input.id) : undefined;
  const at = nowIso();
  const draft: DraftMeta = {
    ...(prev?.draft ?? { source: 'approval', created_at: at }),
    approval: { state: 'pending', requested_by: who(), requested_at: at, amount: Number(input.total) || 0 },
    ...(opts.payNow ? { pay_now: opts.payNow } : {}),
  };
  const { status: _s, draft: _d, ...bill } = input as typeof input & { draft?: unknown };
  void _s;
  void _d;
  const row = draftsDb.save({ ...bill, id: prev?.id ?? input.id, draft });
  logSafe(() =>
    audit.record({ entity: 'purchase', entity_id: row.id, action: 'update', doc_number: row.bill_number || undefined, summary: `Sent ${label(row)} (${formatCurrency(row.total)}) for the owner's approval` }),
  );
  return row;
}

/** Bills / expenses waiting for the owner, oldest request first. */
export function pendingBillApprovals(drafts: readonly PurchaseDraft[] = draftsDb.all()): PurchaseDraft[] {
  return drafts
    .filter((d) => d.draft.approval?.state === 'pending')
    .sort((a, b) => (a.draft.approval?.requested_at ?? '').localeCompare(b.draft.approval?.requested_at ?? ''));
}

function logDecision(row: Omit<ApprovalLogRow, 'id'>) {
  setTable(APPROVALS_TABLE, [...approvalLog(), { id: generateId(), ...row }]);
}

/** Mark the inbox rows behind a draft as done (posted as `purchaseId`). */
export function settleInboxFor(draftId: string, purchaseId: string): void {
  for (const r of inboxDb.all()) if (r.draft_id === draftId && r.status === 'new') inboxDb.update(r.id, { status: 'done', purchase_id: purchaseId });
}

/** Owner: post a held bill / expense (and its "paid now" payment). */
export function approveBill(draftId: string, note?: string): PurchaseRecord {
  requireAccess('doc.approve');
  const d = draftsDb.get(draftId);
  if (!d || d.draft.approval?.state !== 'pending') throw new PurchaseApprovalError('This bill is not waiting for approval.');
  const ap = d.draft.approval;
  const by = who() || 'Owner';
  const at = nowIso();
  const saved = withTablesRollback([PURCHASES_TABLE, PAYMENTS_TABLE, PURCHASE_DRAFTS_TABLE, APPROVALS_TABLE, DOC_INBOX_TABLE], () => {
    const bill = purchasesDb.save({ ...billOfDraft(d), id: d.id, amount_paid: 0 });
    const pay = d.draft.pay_now;
    if (pay) {
      const tds = Math.max(Number(pay.tds_amount) || 0, 0);
      paymentsDb.record(bill.id, { amount: supplierPayable(bill) - tds, date: pay.date, method: pay.method, reference: pay.reference, bankAccountId: pay.bank_account_id, tdsAmount: tds });
    }
    draftsDb.remove(d.id, { keepFiles: true });
    settleInboxFor(d.id, bill.id);
    logDecision({
      doc_id: d.id, doc_number: d.bill_number, doc_type: d.kind === 'EXPENSE' ? 'EXPENSE' : 'BILL', amount: d.total, decision: 'approved',
      requested_by: ap.requested_by, requested_at: ap.requested_at, decided_by: by, decided_at: at, ...(note?.trim() ? { note: note.trim() } : {}),
    });
    return bill;
  });
  logSafe(() =>
    audit.record({ entity: 'purchase', entity_id: saved.id, action: 'create', doc_number: saved.bill_number || undefined, summary: `Approved ${label(saved)} (${formatCurrency(saved.total)}) requested by ${ap.requested_by || 'a clerk'}${note?.trim() ? ` — ${note.trim()}` : ''}` }),
  );
  return purchasesDb.get(saved.id) ?? saved;
}

/** Owner: send a held bill back with a reason (it stays a draft for the clerk to fix). */
export function rejectBill(draftId: string, note: string): PurchaseDraft {
  requireAccess('doc.approve');
  const d = draftsDb.get(draftId);
  if (!d || d.draft.approval?.state !== 'pending') throw new PurchaseApprovalError('This bill is not waiting for approval.');
  if (!note?.trim()) throw new PurchaseApprovalError('Add a reason so the clerk knows what to change.');
  const ap = d.draft.approval;
  const by = who() || 'Owner';
  const at = nowIso();
  const row = withTablesRollback([PURCHASE_DRAFTS_TABLE, APPROVALS_TABLE], () => {
    const next = draftsDb.save({ ...d, draft: { ...d.draft, approval: { ...ap, state: 'rejected', decided_by: by, decided_at: at, note: note.trim() } } });
    logDecision({
      doc_id: d.id, doc_number: d.bill_number, doc_type: d.kind === 'EXPENSE' ? 'EXPENSE' : 'BILL', amount: d.total, decision: 'rejected',
      requested_by: ap.requested_by, requested_at: ap.requested_at, decided_by: by, decided_at: at, note: note.trim(),
    });
    return next;
  });
  logSafe(() => audit.record({ entity: 'purchase', entity_id: d.id, action: 'update', doc_number: d.bill_number || undefined, summary: `Rejected ${label(d)} (${formatCurrency(d.total)}) — ${note.trim()}` }));
  return row;
}

/* ── Supplier payments ──────────────────────────────────────────── */

export function paymentRequests(): PaymentRequest[] {
  return getTable<PaymentRequest>(PAYMENT_REQUESTS_TABLE).filter((r) => r && typeof r.id === 'string');
}

export function pendingPaymentRequests(rows: readonly PaymentRequest[] = paymentRequests()): PaymentRequest[] {
  return rows.filter((r) => r.state === 'pending').sort((a, b) => a.requested_at.localeCompare(b.requested_at));
}

/** Clerk: ask the owner to approve a supplier payment (nothing is paid or posted yet). */
export function requestSupplierPayment(input: { purchaseId: string; amount: number; date: string; method: string; reference?: string; bankAccountId?: string; tdsAmount?: number }): PaymentRequest {
  requireAccess('books.edit');
  const bill = purchasesDb.get(input.purchaseId);
  if (!bill) throw new PurchaseApprovalError('Bill not found.');
  const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
  const tds = Math.max(Math.round((Number(input.tdsAmount) || 0) * 100) / 100, 0);
  const waiting = pendingPaymentRequests().filter((r) => r.purchase_id === bill.id).reduce((t, r) => t + r.amount + (r.tds_amount ?? 0), 0);
  const problem = validatePayment({ ...bill, amount_paid: (Number(bill.amount_paid) || 0) + waiting }, amount, input.date, tds);
  if (problem) throw new PurchaseApprovalError(waiting > 0 ? `${problem} (payments already waiting for approval count too)` : problem);
  const row: PaymentRequest = {
    id: generateId(),
    purchase_id: bill.id,
    bill_number: bill.bill_number,
    vendor_name: bill.vendor_name,
    amount,
    ...(tds > 0 ? { tds_amount: tds } : {}),
    date: input.date,
    method: input.method,
    ...(input.reference?.trim() ? { reference: input.reference.trim().slice(0, 80) } : {}),
    ...(input.bankAccountId ? { bank_account_id: input.bankAccountId } : {}),
    requested_by: who(),
    requested_at: nowIso(),
    state: 'pending',
  };
  setTable(PAYMENT_REQUESTS_TABLE, [...paymentRequests(), row]);
  logSafe(() => audit.record({ entity: 'purchase', entity_id: bill.id, action: 'update', doc_number: bill.bill_number || undefined, summary: `Requested approval to pay ${formatCurrency(amount)} on ${label(bill)}` }));
  return row;
}

function decidePayment(id: string, decision: 'approved' | 'rejected', note?: string): PaymentRequest {
  requireAccess('doc.approve');
  const rows = paymentRequests();
  const req = rows.find((r) => r.id === id);
  if (!req || req.state !== 'pending') throw new PurchaseApprovalError('This payment is not waiting for approval.');
  if (decision === 'rejected' && !note?.trim()) throw new PurchaseApprovalError('Add a reason so the clerk knows what to change.');
  const by = who() || 'Owner';
  const at = nowIso();
  const next = withTablesRollback([PAYMENT_REQUESTS_TABLE, PAYMENTS_TABLE, PURCHASES_TABLE, APPROVALS_TABLE], () => {
    let paymentId: string | undefined;
    if (decision === 'approved') {
      paymentId = paymentsDb.record(req.purchase_id, { amount: req.amount, date: req.date, method: req.method, reference: req.reference, bankAccountId: req.bank_account_id, tdsAmount: req.tds_amount }).id;
    }
    const row: PaymentRequest = { ...req, state: decision, decided_by: by, decided_at: at, ...(note?.trim() ? { note: note.trim() } : {}), ...(paymentId ? { payment_id: paymentId } : {}) };
    setTable(PAYMENT_REQUESTS_TABLE, paymentRequests().map((r) => (r.id === id ? row : r)));
    logDecision({
      doc_id: req.purchase_id, doc_number: req.bill_number, doc_type: 'PAYMENT', amount: req.amount, decision,
      requested_by: req.requested_by, requested_at: req.requested_at, decided_by: by, decided_at: at, ...(note?.trim() ? { note: note.trim() } : {}),
    });
    return row;
  });
  logSafe(() =>
    audit.record({ entity: 'purchase', entity_id: req.purchase_id, action: 'update', doc_number: req.bill_number || undefined, summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} payment of ${formatCurrency(req.amount)} to ${req.vendor_name || '—'} requested by ${req.requested_by || 'a clerk'}${note?.trim() ? ` — ${note.trim()}` : ''}` }),
  );
  return next;
}

export const approvePayment = (id: string, note?: string) => decidePayment(id, 'approved', note);
export const rejectPayment = (id: string, note: string) => decidePayment(id, 'rejected', note);

/** Decision history for purchases (bills, expenses, payments), newest first. */
export function purchaseApprovalHistory(limit = 30): ApprovalLogRow[] {
  // Rows are appended in decision order; reverse first so the stable sort keeps the later of two same-millisecond
  // decisions on top.
  return approvalLog()
    .reverse()
    .filter((r) => r.doc_type === 'BILL' || r.doc_type === 'EXPENSE' || r.doc_type === 'PAYMENT')
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at))
    .slice(0, limit);
}
