/**
 * Approvals (maker-checker, WP-9 / gap P1-18): the owner's side.
 *
 *  - Policy: Settings → "Invoices above ₹X / all documents by clerks need owner approval",
 *    stored under `mrchartist_inv_approval_policy` (backed up like any data key).
 *  - Queue: documents whose `approval.state` is 'pending' (held as drafts by `approval-gate.ts`).
 *  - Decisions: `approveDocument` issues the document with the status the clerk asked for;
 *    `rejectDocument` leaves it a draft with the owner's note (the clerk edits and saves again,
 *    which files a new request). Both need `doc.approve`, write the audit log and append a row to
 *    the `approvals` decision log.
 */
import type { InvoiceRecord } from '../types/invoice';
import { currentActor, requireAccess } from './access';
import { audit } from './audit';
import { localDb } from './localDb';
import { assertNoteStillSettles } from './settlement';
import { generateId, getTable, setJson, setTable } from './storage';
import { APPROVAL_POLICY_KEY, readApprovalPolicy, rupeeValue, type ApprovalPolicy } from './approval-gate';
import { formatCurrency } from './utils';

export { readApprovalPolicy, approvalRequired, rupeeValue, type ApprovalPolicy } from './approval-gate';

export const APPROVALS_TABLE = 'approvals';

export interface ApprovalLogRow {
  id: string;
  doc_id: string;
  doc_number: string;
  doc_type: string;
  amount: number;
  decision: 'approved' | 'rejected';
  requested_by: string;
  requested_at: string;
  decided_by: string;
  decided_at: string;
  note?: string;
}

export function saveApprovalPolicy(policy: ApprovalPolicy): void {
  requireAccess('settings.manage');
  const before = readApprovalPolicy();
  const next: ApprovalPolicy = {
    enabled: !!policy.enabled,
    mode: policy.mode === 'all' ? 'all' : 'above',
    threshold: Math.max(Number(policy.threshold) || 0, 0),
  };
  setJson(APPROVAL_POLICY_KEY, next);
  try {
    audit.record({
      entity: 'settings',
      entity_id: 'approval_policy',
      action: 'update',
      summary: next.enabled
        ? `Approvals on: ${next.mode === 'all' ? 'every document a clerk issues' : `documents above ${formatCurrency(next.threshold)}`} need the owner's approval`
        : before.enabled ? 'Approvals switched off' : 'Approval settings saved (off)',
    });
  } catch {
    /* logging never blocks */
  }
}

/** Documents waiting for the owner, oldest request first. */
export function pendingApprovals(invoices: readonly InvoiceRecord[] = localDb.invoices.getAll()): InvoiceRecord[] {
  return invoices
    .filter((i) => i.approval?.state === 'pending' && i.status === 'Draft')
    .sort((a, b) => (a.approval?.requested_at ?? '').localeCompare(b.approval?.requested_at ?? ''));
}

export function approvalLog(): ApprovalLogRow[] {
  return getTable<ApprovalLogRow>(APPROVALS_TABLE);
}

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

function decide(id: string, decision: 'approved' | 'rejected', note?: string): InvoiceRecord {
  requireAccess('doc.approve');
  const doc = localDb.invoices.getById(id);
  if (!doc || doc.approval?.state !== 'pending') throw new ApprovalError('This document is not waiting for approval.');
  if (decision === 'rejected' && !note?.trim()) throw new ApprovalError('Add a note so the clerk knows what to change.');
  // QA5 F1: a settlement note (FCN) may only be issued while the bill still owes it (a receipt or another note
  // may have settled it since the clerk asked). Issuing it re-settles the bill through `invoices.save`.
  if (decision === 'approved') assertNoteStillSettles(doc);
  const by = currentActor()?.name ?? 'Owner';
  const at = new Date().toISOString();
  const approval = {
    ...doc.approval,
    state: decision,
    decided_by: by,
    decided_at: at,
    ...(note?.trim() ? { note: note.trim() } : {}),
    // H3: the value approved; a later change of value by a clerk needs approval again.
    ...(decision === 'approved' ? { approved_value: rupeeValue(doc) } : {}),
  };
  const next: InvoiceRecord = {
    ...doc,
    approval,
    status: decision === 'approved' ? doc.approval.requested_status || 'Sent' : 'Draft',
  };
  const saved = localDb.invoices.save(next);
  setTable(APPROVALS_TABLE, [
    ...approvalLog(),
    {
      id: generateId(),
      doc_id: doc.id,
      doc_number: doc.invoice_number,
      doc_type: doc.doc_type,
      amount: doc.total,
      decision,
      requested_by: doc.approval.requested_by,
      requested_at: doc.approval.requested_at,
      decided_by: by,
      decided_at: at,
      ...(note?.trim() ? { note: note.trim() } : {}),
    },
  ]);
  try {
    audit.record({
      entity: 'invoice',
      entity_id: doc.id,
      action: 'update',
      doc_number: doc.invoice_number,
      summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${doc.invoice_number} (${formatCurrency(doc.total, doc.currency)}) requested by ${doc.approval.requested_by || 'a clerk'}${note?.trim() ? ` — ${note.trim()}` : ''}`,
    });
  } catch {
    /* logging never blocks */
  }
  return saved;
}

export const approveDocument = (id: string, note?: string) => decide(id, 'approved', note);
export const rejectDocument = (id: string, note: string) => decide(id, 'rejected', note);
