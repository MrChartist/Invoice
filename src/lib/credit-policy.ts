/**
 * Credit-limit enforcement (8.80 — BUSY / Marg / Zoho Inventory "credit limit: warn / block").
 *
 *  - Policy per company (`credit_policy`: Off / Warn / Block, include open sales orders, block on bills
 *    overdue beyond the party's credit days) and per party (`Client.credit_policy`, overrides the company).
 *  - Warn: the editor / POS notice (`credit-limit.ts` figures) — saving is never stopped.
 *  - Block: a document that ADDS credit (its unpaid rupee value > 0) while the party is over its limit (or
 *    overdue, when that option is on) is held for the owner's approval through the approval gate
 *    (`holdIfCreditBlocked` in `approval-gate.ts`, registered below); the owner's own save is an audited
 *    override. POS bills (exempt from the data-layer gate) are checked on the unpaid part before saving:
 *    a clerk must take payment or ask the owner; the owner's override is audited.
 *
 * Imported by the editor's credit notice and the POS credit notice (lazy chunks); importing it registers
 * the evaluator with the data layer.
 */

import type { Client, InvoiceRecord } from '../types/invoice';
import { creditCheck, belongsTo, masterFor, type BounceLike, type CreditCheck } from './credit-limit';
import { buildOrderIndex, fulfilmentFromIndex } from './sales-orders';
import { num, round2 } from './invoice-calc';
import { fxRate } from './fx';
import { localDayOf } from './dates';
import { can, currentActor, requireAccess } from './access';
import { audit } from './audit';
import { getJson, getTable, setJson } from './storage';
import { CREDIT_POLICY_KEY, holdForCredit, registerCreditGate, rupeeValue } from './approval-gate';

export { CREDIT_POLICY_KEY };
export type CreditMode = 'off' | 'warn' | 'block';

export interface CreditPolicy {
  mode: CreditMode;
  /** Count open sales orders (still to bill) in the exposure. */
  include_orders: boolean;
  /** Block also when the party has bills overdue beyond its credit days. */
  block_overdue: boolean;
}

const isMode = (m: unknown): m is CreditMode => m === 'off' || m === 'warn' || m === 'block';

/** Company policy (key `credit_policy`); Warn by default (the 6.25 advisory notice). */
export function readCreditPolicy(): CreditPolicy {
  const raw = getJson<Partial<CreditPolicy> | null>(CREDIT_POLICY_KEY, null);
  return { mode: raw && isMode(raw.mode) ? raw.mode : 'warn', include_orders: raw?.include_orders === true, block_overdue: raw?.block_overdue === true };
}

/** Effective mode for a party: its own override, else the company policy. */
export const partyCreditMode = (policy: CreditPolicy, master: Pick<Client, 'credit_policy'> | undefined): CreditMode =>
  master && isMode(master.credit_policy) ? master.credit_policy : policy.mode;

const creditMaster = (snap: Pick<Client, 'id' | 'name'> | undefined): Client | undefined => (snap?.name || snap?.id ? masterFor({ id: snap.id, name: snap.name ?? '' }, getTable<Client>('clients')) : undefined);

interface LinkLike { from_id: string; to_id: string; relation: string }

/** Rupee value still to bill on the party's open (issued, not closed / fulfilled) sales orders, GST included. */
export function openOrderValue(client: Pick<Client, 'id' | 'name'>, invoices: readonly InvoiceRecord[], links: readonly LinkLike[], excludeId?: string): number {
  const orders = invoices.filter((o) => o.doc_type === 'SALES_ORDER' && o.status !== 'Draft' && o.status !== 'Cancelled' && o.id !== excludeId && belongsTo(o, client));
  if (!orders.length) return 0;
  const index = buildOrderIndex(invoices, links);
  let sum = 0;
  for (const o of orders) {
    const f = fulfilmentFromIndex(o, index);
    if (f.state !== 'Open' && f.state !== 'Partly fulfilled') continue;
    const rate = fxRate(o);
    if (rate === null) continue;
    for (const l of f.lines) {
      const net = num(l.item.rate) * (1 - Math.min(Math.max(num(l.item.discount_percent), 0), 100) / 100);
      sum += l.pendingInvoice * net * (1 + Math.max(num(l.item.tax_rate), 0) / 100) * rate;
    }
  }
  return round2(sum);
}

export interface CreditStatus {
  mode: CreditMode;
  check: CreditCheck;
  /** Why a save would be blocked ('' = not blocked; always '' unless the mode is Block). */
  blocked: string;
}

/** Reason the figures block a document ('' = not blocked). Only a document that adds credit is blocked. */
export function blockReason(check: CreditCheck, policy: Pick<CreditPolicy, 'block_overdue'>): string {
  if (!(check.thisInvoice > 0.004)) return '';
  if (check.overBy > 0) return check.warnings[0] ?? 'Over the credit limit.';
  if (policy.block_overdue && check.overdue.count > 0) return check.warnings.find((w) => /credit period/.test(w)) ?? 'Bills are overdue beyond the credit period.';
  return '';
}

const today = () => localDayOf(new Date());

/**
 * Pure-ish status of a draft for a party master (reads invoices / links from storage unless given).
 * `unpaid` overrides the draft's own unpaid value (the POS: total less what is being tendered).
 */
export function creditStatus(doc: Partial<InvoiceRecord> & Pick<InvoiceRecord, 'client'>, opts: {
  master?: Client; policy?: CreditPolicy; invoices?: readonly InvoiceRecord[]; links?: readonly LinkLike[]; day?: string; unpaid?: number; cheques?: readonly BounceLike[];
} = {}): CreditStatus | null {
  const master = opts.master ?? creditMaster(doc.client);
  if (!master) return null;
  const policy = opts.policy ?? readCreditPolicy();
  const mode = partyCreditMode(policy, master);
  if (mode === 'off') return null;
  const invoices = opts.invoices ?? getTable<InvoiceRecord>('invoices');
  const links = opts.links ?? getTable<LinkLike>('doc_links');
  const total = num(doc.total);
  const draft = {
    id: doc.id, doc_type: doc.doc_type, status: doc.status === 'Draft' ? 'Sent' : doc.status, total,
    tds_amount: doc.tds_amount, currency: doc.currency, exchange_rate: doc.exchange_rate,
    amount_paid: opts.unpaid !== undefined ? Math.max(round2(total - num(doc.tds_amount) - opts.unpaid), 0) : doc.amount_paid,
    reverse_charge: doc.reverse_charge, tax_amount: doc.tax_amount, cess_amount: doc.cess_amount,
  };
  const check = creditCheck({
    client: master, draft, invoices, today: opts.day ?? today(), cheques: opts.cheques,
    openOrders: policy.include_orders ? openOrderValue(master, invoices, links, doc.id) : 0,
  });
  return { mode, check, blocked: mode === 'block' ? blockReason(check, policy) : '' };
}

const CREDIT_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

/**
 * The data layer's credit gate (registered with `approval-gate.ts` on import), for a document being issued:
 * Block party over the limit → a clerk's document is held for the owner (`reason: 'credit'`); the owner's
 * save passes and is audited; a document the owner already approved at this value passes.
 */
export function creditGate(doc: InvoiceRecord): void {
  if (!CREDIT_DOCS.has(doc.doc_type ?? 'INVOICE') || !doc.client?.name) return;
  const master = creditMaster(doc.client);
  const policy = readCreditPolicy();
  if (!master || partyCreditMode(policy, master) !== 'block') return;
  const a = doc.approval;
  if (a?.state === 'approved' && a.doc_id === doc.id && (a.approved_value === undefined || Math.abs(rupeeValue(doc) - a.approved_value) <= 0.004)) return;
  const credit = creditStatus(doc, { master, policy })?.blocked ?? '';
  // TR-A1: a line below its minimum margin is held too (reason `margin`), once the trade-discount module registered.
  const low = credit || !marginCheck ? '' : marginCheck(doc);
  const reason = credit || low;
  if (!reason) return;
  if (!can('doc.approve')) {
    holdForCredit(doc, reason);
    if (low && doc.approval) doc.approval.reason = 'margin';
    return;
  }
  try {
    audit.record({ entity: 'invoice', entity_id: doc.id, action: 'update', doc_number: doc.invoice_number, summary: `${low ? 'Minimum margin' : 'Credit limit'} overridden by ${currentActor()?.name ?? 'the owner'} for ${master.name}: ${reason}` });
  } catch {
    /* logging never blocks */
  }
}
registerCreditGate(creditGate);

/** TR-A1: the minimum-margin check (`trade/tr-discounts.ts` registers it when loaded). */
let marginCheck: ((doc: InvoiceRecord) => string) | null = null;
export function registerMarginCheck(fn: ((doc: InvoiceRecord) => string) | null): void {
  marginCheck = fn;
}

/** Owner only: the company policy (audited). */
export function saveCreditPolicy(p: CreditPolicy): void {
  requireAccess('settings.manage');
  const before = readCreditPolicy();
  const next: CreditPolicy = { mode: p.mode, include_orders: !!p.include_orders, block_overdue: !!p.block_overdue };
  setJson(CREDIT_POLICY_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: 'credit_policy', action: 'update', summary: `Credit policy: ${before.mode} → ${next.mode}${next.include_orders ? ', open sales orders counted' : ''}${next.block_overdue ? ', overdue bills block' : ''}` });
  } catch {
    /* logging never blocks */
  }
}

/** Can the signed-in user override a blocked POS bill? (The owner / anyone who may approve.) */
export const canOverrideCredit = (): boolean => can('doc.approve');

/** Audit an owner's override of a blocked POS bill (the data-layer gate audits editor saves itself). */
export function recordCreditOverride(party: string, reason: string, docNumber?: string): void {
  try {
    audit.record({ entity: 'invoice', entity_id: docNumber ?? party, action: 'update', doc_number: docNumber, summary: `Credit limit overridden by ${currentActor()?.name ?? 'the owner'} at the counter for ${party}: ${reason}` });
  } catch {
    /* logging never blocks */
  }
}
