/**
 * Maker-checker gate (WP-9, gap P1-18) — the small part the data layer needs.
 *
 * `localDb.invoices.save` calls `holdIfApprovalNeeded` once (its single guarded branch). When the
 * owner has switched approvals on and the signed-in user may not approve (`doc.approve`: a clerk),
 * a document being issued (a new one, or a draft moving to Sent / Paid …) is kept as a **Draft**
 * with `approval.state = 'pending'`: nothing is issued, nothing reaches revenue, GST papers or the
 * books (they all skip drafts), and it cannot take payments. It keeps its provisional number (the
 * gap's "or a provisional number" option, so approving never renumbers a document). The owner
 * approves or rejects it from the queue (`approvals.ts`).
 *
 * Kept tiny and free of heavy imports: it is loaded with `localDb` on first paint.
 */
import type { ApprovalInfo, InvoiceRecord } from '../types/invoice';
import { can, currentActor } from './access';
import { DB_PREFIX, getJson } from './storage';

export const APPROVAL_POLICY_KEY = `${DB_PREFIX}approval_policy`;

export interface ApprovalPolicy {
  enabled: boolean;
  /** 'all' = every document a clerk issues; 'above' = only documents above `threshold` (₹). */
  mode: 'all' | 'above';
  threshold: number;
}

export const DEFAULT_POLICY: ApprovalPolicy = { enabled: false, mode: 'above', threshold: 50000 };

export function readApprovalPolicy(): ApprovalPolicy {
  const raw = getJson<Partial<ApprovalPolicy> | null>(APPROVAL_POLICY_KEY, null);
  if (!raw || typeof raw !== 'object') return DEFAULT_POLICY;
  return {
    enabled: raw.enabled === true,
    mode: raw.mode === 'all' ? 'all' : 'above',
    threshold: Number.isFinite(Number(raw.threshold)) ? Math.max(Number(raw.threshold), 0) : DEFAULT_POLICY.threshold,
  };
}

/** Rupee value of a document (foreign currency at its exchange rate when it has one). */
export function rupeeValue(doc: Pick<InvoiceRecord, 'total' | 'currency' | 'exchange_rate'>): number {
  const total = Number(doc.total) || 0;
  const fx = Number(doc.exchange_rate);
  return (doc.currency || 'INR').toUpperCase() !== 'INR' && fx > 0 ? total * fx : total;
}

/**
 * Pure: does saving `doc` (over `stored`) need the owner's approval? Only when it is being issued
 * now (new, or leaving Draft), the saver cannot approve, it is not a POS counter bill (paid on the
 * spot — the counter is exempt), and this very document was not approved already.
 */
export function approvalRequired(
  doc: Pick<InvoiceRecord, 'id' | 'status' | 'total' | 'currency' | 'exchange_rate' | 'pos' | 'approval'>,
  stored: Pick<InvoiceRecord, 'status'> | undefined,
  policy: ApprovalPolicy,
  saverCanApprove: boolean,
): boolean {
  if (!policy.enabled || saverCanApprove || doc.pos) return false;
  if (doc.status === 'Draft') return false;
  if (stored && stored.status !== 'Draft') return false;
  if (doc.approval?.state === 'approved' && doc.approval.doc_id === doc.id) return false;
  return policy.mode === 'all' || rupeeValue(doc) > policy.threshold + 0.004;
}

/** The data layer's single branch: hold `doc` as a pending draft when approval is required. */
export function holdIfApprovalNeeded(doc: InvoiceRecord, stored: InvoiceRecord | undefined): void {
  if (!approvalRequired(doc, stored, readApprovalPolicy(), can('doc.approve'))) return;
  const actor = currentActor();
  const info: ApprovalInfo = {
    state: 'pending',
    doc_id: doc.id,
    requested_status: doc.status,
    requested_by: actor?.name ?? '',
    requested_at: new Date().toISOString(),
  };
  doc.status = 'Draft';
  doc.approval = info;
}
