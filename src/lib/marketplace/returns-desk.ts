/**
 * Returns, RTO and claims desk (R5-A6). Every customer return, RTO (undelivered, back to the seller) and courier loss
 * is listed until it is physically received, checked and either restocked or claimed before the window closes.
 *
 * Status (derived): Pending receipt → Received → Restocked / Claimed → Closed.
 *  - "Restock" saves a credit note with `goods_returned` to the chosen godown (once) when the invoice exists and no
 *    credit note does yet; a damaged item goes to the channel's damaged / non-saleable godown.
 *  - Claim deadline = event date + the channel's window (date-keyed per platform; defaults Amazon 60 days, Flipkart 14
 *    days — marketplace policy, not law: verify on the seller portal).
 *  - A4 settlement `claim` / `reimbursement` lines mark open claims reimbursed by order id (`matchClaimsFrom`).
 * Rows come from a returns-report import, from A3 refund rows, or by hand. The GST position of an RTO after the invoice
 * is a CA question (credit note vs cancellation).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { ChannelPlatform, ClaimStatus, MarketplaceReturn, ReturnCondition, ReturnType, SalesChannel } from '../../types/marketplace-r5';
import { ruleAt, type Versioned } from '../tax-rules';
import { shiftDay } from '../dates';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb, resettleCreditedInvoices } from '../localDb';
import { cellOf, dayOf, guessColumns, type FileTable, type SynonymTable } from './file-map';
import { MARKETPLACE_RETURNS_TABLE } from './channels';

/** Platform claim windows in days, by effective date (marketplace policy — verify on the seller portal). */
export const CLAIM_WINDOW_RULES: Readonly<Record<ChannelPlatform, readonly Versioned<number>[]>> = {
  amazon: [{ from: '2017-07-01', value: 60, source: 'Amazon SAFE-T / FBA reimbursement window as published — verify' }],
  flipkart: [{ from: '2017-07-01', value: 14, source: 'Flipkart SPF claim window as published — verify' }],
  meesho: [{ from: '2017-07-01', value: 0, source: 'typed on the channel' }],
  other: [{ from: '2017-07-01', value: 0, source: 'typed on the channel' }],
};

export const PENDING_ALERT_DAYS = 15;
export const CLAIM_ALERT_DAYS = 3;

export type DeskStatus = 'pending' | 'received' | 'restocked' | 'claimed' | 'closed';

export function deskStatus(r: MarketplaceReturn): DeskStatus {
  if (r.closed_on) return 'closed';
  if (r.claim && r.claim.status !== 'rejected') return 'claimed';
  if (r.received_on && r.credit_note_id && r.condition === 'good') return 'restocked';
  if (r.received_on) return 'received';
  return 'pending';
}

/** Claim window (days) for a channel on a date: the channel's own dated rows first, else the platform default. */
export function claimWindow(c: Pick<SalesChannel, 'platform' | 'claim_window'>, day: string): number {
  const own = (c.claim_window ?? []).filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.from) && w.days >= 0).sort((a, b) => a.from.localeCompare(b.from));
  const hit = own.filter((w) => w.from <= day).pop();
  if (hit) return hit.days;
  return ruleAt(CLAIM_WINDOW_RULES[c.platform] ?? CLAIM_WINDOW_RULES.other, day);
}

/** The event a claim is counted from: receipt (damaged / wrong item), else the expected date (lost / not returned). */
export const eventDay = (r: MarketplaceReturn): string => r.received_on || r.expected_on || (r.created_at ?? '').slice(0, 10);

/** Last day to raise a claim ('' when the channel has no window). */
export function claimDeadline(r: MarketplaceReturn, c: Pick<SalesChannel, 'platform' | 'claim_window'>): string {
  const day = eventDay(r);
  if (!day) return '';
  const w = claimWindow(c, day);
  return w > 0 ? shiftDay(day, w) : '';
}

/** Rows that need attention for the bell: pending receipt beyond 15 days; claim windows closing in ≤ 3 days. */
export function deskAlerts(rows: readonly MarketplaceReturn[], channels: readonly SalesChannel[], today: string): { overdue: MarketplaceReturn[]; closing: { row: MarketplaceReturn; deadline: string }[] } {
  const overdue: MarketplaceReturn[] = [];
  const closing: { row: MarketplaceReturn; deadline: string }[] = [];
  for (const r of rows) {
    if (r.closed_on) continue;
    const st = deskStatus(r);
    if (st === 'pending' && r.expected_on && shiftDay(r.expected_on, PENDING_ALERT_DAYS) < today) overdue.push(r);
    const c = channels.find((x) => x.id === r.channel_id);
    const needsClaim = !r.claim && (r.type === 'courier_lost' || (r.condition && r.condition !== 'good') || st === 'pending');
    if (c && needsClaim) {
      const dl = claimDeadline(r, c);
      if (dl && dl >= today && shiftDay(today, CLAIM_ALERT_DAYS) >= dl) closing.push({ row: r, deadline: dl });
    }
  }
  return { overdue, closing };
}

/* ── Import (returns reports) ───────────────────────────────────── */

export const RETURNS_FIELDS: SynonymTable = {
  order_id: ['order id', 'order item id', 'sub order no', 'suborder number', 'order number'],
  type: ['return type', 'type', 'return category', 'reason type'],
  reason: ['return reason', 'reason', 'detailed disposition', 'disposition', 'status'],
  expected: ['expected date', 'return date', 'return requested date', 'return created date', 'date'],
  received: ['received date', 'return received date', 'delivered to seller date', 'return delivered date'],
  condition: ['condition', 'item condition', 'detailed disposition', 'disposition', 'qc status'],
  sku: ['sku', 'seller sku'],
};

export type ReturnsPresetId = 'amazon_returns' | 'amazon_fba_returns' | 'flipkart_returns' | 'meesho_returns' | 'generic';
export const RETURNS_PRESETS: readonly ReturnsPresetId[] = ['amazon_returns', 'amazon_fba_returns', 'flipkart_returns', 'meesho_returns', 'generic'];

export function returnTypeOf(text: string): ReturnType {
  const t = text.toLowerCase();
  if (/rto|undeliver|courier return|return to origin/.test(t)) return 'rto';
  if (/lost|missing in transit/.test(t)) return 'courier_lost';
  return 'customer_return';
}

export function conditionOf(text: string): ReturnCondition | undefined {
  const t = text.toLowerCase();
  if (!t.trim()) return undefined;
  if (/wrong|different item|swap/.test(t)) return 'wrong_item';
  if (/missing|empty box/.test(t)) return 'missing';
  if (/damag|defect|unsellable|broken|customer_damaged|carrier_damaged/.test(t)) return 'damaged';
  if (/sellable|good|ok|pass/.test(t)) return 'good';
  return undefined;
}

export interface ReturnsPlan {
  rows: Omit<MarketplaceReturn, 'id'>[];
  already: number;
  skipped: number[];
}

/** Returns-report rows → desk rows (idempotent per channel × order × type; existing rows gain a received date). */
export function planReturnsImport(table: FileTable, channel: SalesChannel, existing: readonly MarketplaceReturn[], invoices: readonly Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'channel_id' | 'channel_order_id'>[]): ReturnsPlan {
  const cols = guessColumns(table.headers, RETURNS_FIELDS, channel.presets?.returns);
  const rows: Omit<MarketplaceReturn, 'id'>[] = [];
  const skipped: number[] = [];
  let already = 0;
  const seen = new Set(existing.filter((r) => r.channel_id === channel.id).map((r) => `${r.order_id.toLowerCase()}|${r.type}`));
  table.rows.forEach((row, i) => {
    const order_id = cellOf(row, cols, 'order_id');
    if (!order_id) {
      skipped.push(i + 2);
      return;
    }
    const type = returnTypeOf(`${cellOf(row, cols, 'type')} ${cellOf(row, cols, 'reason')}`);
    const k = `${order_id.toLowerCase()}|${type}`;
    if (seen.has(k)) {
      already++;
      return;
    }
    seen.add(k);
    const doc = invoices.find((d) => d.channel_id === channel.id && d.channel_order_id?.toLowerCase() === order_id.toLowerCase() && d.doc_type !== 'CREDIT_NOTE' && d.status !== 'Cancelled');
    const cn = invoices.find((d) => d.channel_id === channel.id && d.channel_order_id?.toLowerCase() === order_id.toLowerCase() && d.doc_type === 'CREDIT_NOTE' && d.status !== 'Cancelled');
    const received = dayOf(row, cols, 'received');
    const cond = conditionOf(cellOf(row, cols, 'condition'));
    rows.push({
      channel_id: channel.id,
      order_id,
      ...(doc ? { doc_id: doc.id } : {}),
      ...(cn ? { credit_note_id: cn.id } : {}),
      type,
      ...(dayOf(row, cols, 'expected') ? { expected_on: dayOf(row, cols, 'expected') } : {}),
      ...(received ? { received_on: received } : {}),
      ...(cond ? { condition: cond } : {}),
      ...(cellOf(row, cols, 'reason') ? { note: cellOf(row, cols, 'reason').slice(0, 200) } : {}),
    });
  });
  return { rows, already, skipped };
}

export function loadReturns(channelId?: string): readonly MarketplaceReturn[] {
  const rows = peekTable<MarketplaceReturn>(MARKETPLACE_RETURNS_TABLE).filter((r) => r && typeof r.id === 'string');
  return channelId ? rows.filter((r) => r.channel_id === channelId) : rows;
}

export function addReturns(rows: readonly Omit<MarketplaceReturn, 'id'>[]): MarketplaceReturn[] {
  requireAccess('doc.create');
  const at = new Date().toISOString();
  const made = rows.map((r) => ({ ...r, id: generateId(), created_at: r.created_at ?? at }));
  setTable(MARKETPLACE_RETURNS_TABLE, [...getTable<MarketplaceReturn>(MARKETPLACE_RETURNS_TABLE), ...made]);
  return made;
}

export class DeskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeskError';
  }
}

function patch(id: string, fn: (r: MarketplaceReturn) => MarketplaceReturn): MarketplaceReturn {
  requireAccess('doc.create');
  const all = getTable<MarketplaceReturn>(MARKETPLACE_RETURNS_TABLE);
  const r = all.find((x) => x.id === id);
  if (!r) throw new DeskError('Return not found.');
  const next = fn(r);
  setTable(MARKETPLACE_RETURNS_TABLE, all.map((x) => (x.id === id ? next : x)));
  return next;
}

export const markReceived = (id: string, day: string, condition: ReturnCondition, godownId?: string) =>
  patch(id, (r) => ({ ...r, received_on: day, condition, ...(godownId ? { godown_id: godownId } : {}) }));

export const raiseClaim = (id: string, claim: { id?: string; raised_on: string; amount?: number }) =>
  patch(id, (r) => ({ ...r, claim: { ...claim, ...(claim.amount ? { amount: round2(claim.amount) } : {}), status: 'open' } }));

export const setClaimStatus = (id: string, status: ClaimStatus) =>
  patch(id, (r) => {
    if (!r.claim) throw new DeskError('No claim on this return.');
    return { ...r, claim: { ...r.claim, status } };
  });

export const closeReturn = (id: string, day: string) => patch(id, (r) => ({ ...r, closed_on: day }));

/**
 * "Restock": save the goods-returned credit note (to the chosen godown; damaged → the channel's damaged godown) when
 * the invoice exists and none was raised yet. Creates it once; the next call is refused.
 */
export function restockReturn(id: string, opts: { day: string; godownId?: string; channel: SalesChannel }): { row: MarketplaceReturn; creditNote?: InvoiceRecord } {
  requireAccess('doc.create');
  const r = getTable<MarketplaceReturn>(MARKETPLACE_RETURNS_TABLE).find((x) => x.id === id);
  if (!r) throw new DeskError('Return not found.');
  if (r.credit_note_id) return { row: patch(id, (x) => ({ ...x, received_on: x.received_on ?? opts.day, condition: x.condition ?? 'good' })) };
  const inv = r.doc_id ? localDb.invoices.getById(r.doc_id) : undefined;
  if (!inv || inv.status === 'Cancelled') throw new DeskError('The invoice for this order is not in the books — import the sales report first.');
  const damaged = !!r.condition && r.condition !== 'good';
  const godown = damaged ? opts.channel.damaged_godown_id || opts.godownId : opts.godownId || opts.channel.godown_id;
  return withTablesRollback(['invoices', 'doc_links', 'clients', 'items_catalog', MARKETPLACE_RETURNS_TABLE, 'transactions'], () => {
    const note = localDb.invoices.save({
      ...inv,
      id: '',
      invoice_number: '',
      doc_type: 'CREDIT_NOTE',
      issue_date: opts.day,
      due_date: opts.day,
      status: 'Sent',
      amount_paid: 0,
      balance_due: num(inv.total),
      goods_returned: true,
      items: inv.items.map((it) => ({ ...it, id: generateId(), ...(godown ? { godown_id: godown } : {}) })),
      notes: `Return of order ${r.order_id} (${r.type === 'rto' ? 'RTO' : 'customer return'}) against ${inv.invoice_number}. Reason: Sales return.`,
      channel_id: opts.channel.id,
      channel_order_id: r.order_id,
      channel_import_id: undefined,
      created_at: undefined,
      updated_at: undefined,
      attachments: undefined,
      approval: undefined,
    } as InvoiceRecord);
    setTable('doc_links', [...getTable('doc_links'), { id: generateId(), from_id: inv.id, to_id: note.id, relation: 'credit_note', reason: 'Sales return', created_at: new Date().toISOString() }]);
    resettleCreditedInvoices(note.id);
    const row = patch(id, (x) => ({ ...x, credit_note_id: note.id, received_on: x.received_on ?? opts.day, condition: x.condition ?? 'good', ...(godown ? { godown_id: godown } : {}) }));
    return { row, creditNote: note };
  });
}
