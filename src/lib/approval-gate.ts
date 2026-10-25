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
import { DB_PREFIX, getJson, readRaw } from './storage';

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

type GateDoc = Pick<InvoiceRecord, 'id' | 'status' | 'total' | 'currency' | 'exchange_rate' | 'pos' | 'approval'>;
type GateStored = Pick<InvoiceRecord, 'status'> & Partial<Pick<InvoiceRecord, 'total' | 'currency' | 'exchange_rate'>>;

const sameValue = (a: number, b: number) => Math.abs(a - b) <= 0.004;
/** Would a document of this value need approval under the policy (ignoring who saves it)? */
const valueNeedsApproval = (doc: GateDoc, policy: ApprovalPolicy) => policy.mode === 'all' || rupeeValue(doc) > policy.threshold + 0.004;

/**
 * Pure: does saving `doc` (over `stored`) need the owner's approval? Only when it is being issued
 * now (new, or leaving Draft), the saver cannot approve, it is not a POS counter bill (paid on the
 * spot — the counter is exempt), and this very document was not approved already AT THIS VALUE
 * (H3: an approved document whose value was changed since must be approved again; approvals made
 * before `approved_value` existed still count as they did).
 */
export function approvalRequired(doc: GateDoc, stored: GateStored | undefined, policy: ApprovalPolicy, saverCanApprove: boolean): boolean {
  if (!policy.enabled || saverCanApprove || doc.pos) return false;
  if (doc.status === 'Draft') return false;
  if (stored && stored.status !== 'Draft') return false;
  if (doc.approval?.state === 'approved' && doc.approval.doc_id === doc.id) {
    const approved = doc.approval.approved_value;
    if (approved === undefined || sameValue(rupeeValue(doc), approved)) return false;
  }
  return valueNeedsApproval(doc, policy);
}

/**
 * Pure (H3): is this an edit of an ISSUED document by someone who may not approve, changing its
 * value so that it would need approval? Such an edit is refused, not held: turning an issued
 * document back into a draft would pull it out of revenue, GST papers and the books behind the
 * owner's back. The baseline is the value the owner approved, else the stored value.
 */
export function issuedValueChangeBlocked(doc: GateDoc, stored: GateStored | undefined, policy: ApprovalPolicy, saverCanApprove: boolean): boolean {
  if (!policy.enabled || saverCanApprove || doc.pos || !stored || stored.status === 'Draft' || doc.status === 'Draft') return false;
  if (stored.total === undefined) return false;
  const approved = doc.approval?.state === 'approved' && doc.approval.doc_id === doc.id ? doc.approval.approved_value : undefined;
  const baseline = approved ?? rupeeValue({ total: stored.total, currency: stored.currency ?? 'INR', exchange_rate: stored.exchange_rate });
  if (sameValue(rupeeValue(doc), baseline)) return false;
  return valueNeedsApproval(doc, policy);
}

export class ApprovalRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRequiredError';
  }
}

/** The data layer's single branch: hold `doc` as a pending draft when approval is required. */
export function holdIfApprovalNeeded(doc: InvoiceRecord, stored: InvoiceRecord | undefined): void {
  const policy = readApprovalPolicy();
  const canApprove = can('doc.approve');
  if (issuedValueChangeBlocked(doc, stored, policy, canApprove)) {
    throw new ApprovalRequiredError(`Changing the amount of ${doc.invoice_number || 'this issued document'} needs the owner's approval: ask the owner to make the change, or issue a credit / debit note.`);
  }
  if (!approvalRequired(doc, stored, policy, canApprove)) return;
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

/** Refuse money / status moves on a document still waiting for the owner (H3). */
export function assertNotPendingApproval(doc: Pick<InvoiceRecord, 'invoice_number' | 'approval'> | undefined, what: string): void {
  if (doc?.approval?.state === 'pending') {
    throw new ApprovalRequiredError(`${doc.invoice_number || 'This document'} is waiting for the owner's approval; ${what} after it is approved.`);
  }
}

/* ── Credit-limit gate (8.80, BUSY / Marg / Zoho "credit limit: block") ──────────────────────────
 * The policy, figures and decision live in `credit-policy.ts` (lazy editor / POS chunks), which
 * registers itself here; this is only the data layer's hook, kept tiny for first paint. A document
 * being issued (new, or leaving Draft; POS bills exempt) goes through the registered gate. Until it is
 * loaded (the editor chunk is prefetched on idle), a clerk's issue under a company Block policy is held
 * for the owner (fail-safe).
 */

export const CREDIT_POLICY_KEY = `${DB_PREFIX}credit_policy`;

type CreditGate = (doc: InvoiceRecord) => void;
let creditGate: CreditGate | null = null;
export function registerCreditGate(fn: CreditGate | null): void {
  creditGate = fn;
}

/** Hold `doc` as a draft pending the owner's approval because of its credit position. */
export function holdForCredit(doc: InvoiceRecord, note: string): void {
  doc.approval = { state: 'pending', doc_id: doc.id, requested_status: doc.status, requested_by: currentActor()?.name ?? '', requested_at: new Date().toISOString(), reason: 'credit', note };
  doc.status = 'Draft';
}

/** The data layer's credit branch (next to `holdIfApprovalNeeded` in `localDb.invoices.save` / `setStatus`). */
export function holdIfCreditBlocked(doc: InvoiceRecord, stored: InvoiceRecord | undefined): void {
  if (doc.pos || doc.status === 'Draft' || doc.status === 'Cancelled' || (stored && stored.status !== 'Draft')) return;
  if (creditGate) creditGate(doc);
  else if (!can('doc.approve') && /"block"/.test(readRaw(CREDIT_POLICY_KEY) ?? '')) holdForCredit(doc, 'The credit position could not be checked.');
}
