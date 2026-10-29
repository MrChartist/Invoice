/**
 * R14 PS-C1: the export-of-services check — the five conditions of Sec 2(6) IGST Act, each `ok | fail | pending |
 * unknown` with a reason key (strings in `prof-r14c-export.ts`):
 *   (i) supplier in India; (ii) recipient outside India (`Client.ps.country`, an Indian fixed establishment fails);
 *   (iii) place of supply outside India (`ps-pos.ts`, intermediary by the dated rule — PS4);
 *   (iv) payment in convertible foreign exchange, or INR where RBI permits (SRVA, Circular 202/14/2023) — pending until
 *        a receipt or an IRM exists;
 *   (v) not merely establishments of a distinct person (`Client.ps.relation: 'distinct_person'` — our own branch — fails,
 *       Explanation 1 Sec 8).
 * Soft only: the supply type is never changed. The result is snapshotted on the document as `ps.export.checks`
 * (`{ key, ok }` per condition, which the paper prints as "n / 5") with `checked_on`.
 * Pure. Working paper — verify with your CA (PS5).
 */
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import type { PsExportSnap } from '../../types/prof-r14';
import type { ExportIrm } from '../../types/trade-r4';
import { isExportDoc } from '../trade/exporter';
import { movedNoCash } from '../advance-tax';
import { servicePos, type PosClass } from './ps-pos';

export type CheckState = 'ok' | 'fail' | 'pending' | 'unknown';
export type CondId = 'supplier' | 'recipient' | 'pos' | 'payment' | 'distinct';
export interface Condition {
  id: CondId;
  state: CheckState;
  reason: string;
}
export interface ExportChecks {
  /** Local day the check was run for. */
  at: string;
  ok: number;
  items: Condition[];
}

/** The document's `ps.export` sub-object and the party's `Client.ps` (types in `types/prof-r14.ts`). */
export type PsExport = PsExportSnap;
export type PsExportParty = NonNullable<Client['ps']>;

type Doc = Partial<InvoiceRecord>;
export interface ExportCheckInput {
  invoice: Doc;
  client?: { ps?: PsExportParty; gstin?: string; state_code?: string } | null;
  /** Engagement class (PS-A engagement / B4 stage), when the document has none. */
  engagement?: { pos_class?: PosClass } | null;
  receipts?: readonly Partial<Payment>[];
  irms?: readonly Pick<ExportIrm, 'allocations'>[];
  date?: string;
}

const isIndia = (c: string) => /^(in|ind|india|bharat)$/i.test(c.trim());

export function exportCheck({ invoice: inv, client, engagement, receipts = [], irms = [], date }: ExportCheckInput): ExportChecks {
  const x = inv.ps?.export ?? {};
  const day = date || String(inv.issue_date ?? '').slice(0, 10);
  // (i) supplier: a GST state code of an Indian State / UT on the sender.
  const sc = String(inv.sender?.stateCode || inv.sender?.companyGstin?.slice(0, 2) || '');
  const supplier: Condition = /^\d\d$/.test(sc) && sc !== '96' && sc !== '97' ? { id: 'supplier', state: 'ok', reason: 'supplierIndia' } : { id: 'supplier', state: 'unknown', reason: 'supplierUnknown' };
  // (ii) recipient: the party's country, else a place of supply / state of 96 (foreign).
  const p = client?.ps ?? {};
  const country = String(p.country ?? '');
  const foreignPos = inv.place_of_supply === '96' || client?.state_code === '96';
  const recipient: Condition = country
    ? isIndia(country) ? { id: 'recipient', state: 'fail', reason: 'recipientIndia' }
      : p.fixed_estab_in_india ? { id: 'recipient', state: 'fail', reason: 'estabIndia' }
        : { id: 'recipient', state: 'ok', reason: 'recipientAbroad' }
    : foreignPos ? { id: 'recipient', state: p.fixed_estab_in_india ? 'fail' : 'ok', reason: p.fixed_estab_in_india ? 'estabIndia' : 'recipientAbroad' }
      : { id: 'recipient', state: 'unknown', reason: 'recipientUnknown' };
  // (iii) place of supply.
  const pos = servicePos({ cls: x.pos_class ?? engagement?.pos_class, propertyState: x.property_state, abroad: x.abroad, recipientAbroad: recipient.state === 'ok' ? true : recipient.state === 'fail' ? false : null }, day);
  const posC: Condition = { id: 'pos', state: pos.abroad === null ? 'unknown' : pos.abroad ? 'ok' : 'fail', reason: pos.reason };
  // (iv) payment: receipts (an adjusted advance did bring the money in) or IRMs allocated to the document.
  const id = String(inv.id ?? '');
  const paid = receipts.some((r) => r?.invoice_id === id && Number(r.amount) > 0 && (!movedNoCash(r) || !!r.advance_id))
    || irms.some((m) => m?.allocations?.some((a) => a?.invoice_id === id && Number(a.fcy) > 0));
  const inr = String(inv.currency || 'INR').toUpperCase() === 'INR';
  const payment: Condition = !paid ? { id: 'payment', state: 'pending', reason: 'payPending' }
    : !inr ? { id: 'payment', state: 'ok', reason: 'payFx' }
      : x.inr_permitted ? { id: 'payment', state: 'ok', reason: 'payInrRbi' } : { id: 'payment', state: 'fail', reason: 'payInr' };
  // (v) distinct person.
  const distinct: Condition = p.relation === 'distinct_person' ? { id: 'distinct', state: 'fail', reason: 'ownBranch' } : { id: 'distinct', state: 'ok', reason: p.relation === 'group' ? 'groupOk' : 'distinct' };
  const items = [supplier, recipient, posC, payment, distinct];
  return { at: day, ok: items.filter((c) => c.state === 'ok').length, items };
}

/** `export` = all five ok; `not` = any fail; `pending` = only (iv) pending; else `unknown`. */
export function verdict(c: Pick<ExportChecks, 'items'>): 'export' | 'not' | 'pending' | 'unknown' {
  if (c.items.some((i) => i.state === 'fail')) return 'not';
  if (c.items.every((i) => i.state === 'ok')) return 'export';
  return c.items.every((i) => i.state === 'ok' || i.id === 'payment') ? 'pending' : 'unknown';
}

/** The document with the check snapshotted under `ps.export` (other `ps` sub-objects kept). */
export function withChecks<T extends Doc>(inv: T, c: ExportChecks): T {
  return { ...inv, ps: { ...inv.ps, export: { ...inv.ps?.export, checks: snapChecks(c), checked_on: c.at } } };
}
export const snapChecks = (c: ExportChecks) => c.items.map((i) => ({ key: i.id, ok: i.state === 'ok' }));

/** Documents the check applies to: exports by supply type or place of supply 96 / 97. */
export const checkApplies = (inv: Doc): boolean => isExportDoc(inv as InvoiceRecord);

/**
 * GST preflight (soft): an LUT export with a failing condition → warning; (iv) still pending → info. Same shape as the
 * report issues (`ReconIssue`).
 */
export function preflightIssues(docs: readonly Doc[], input: Omit<ExportCheckInput, 'invoice' | 'client'> & { clients: readonly Pick<Client, 'id' | 'ps' | 'gstin' | 'state_code'>[] }) {
  const out: { id: string; severity: 'warning' | 'info'; code: string; message: string; invoiceId: string; invoiceNumber: string }[] = [];
  for (const d of docs) {
    if (d.supply_type !== 'EXPORT_LUT' || !d.id) continue;
    const c = exportCheck({ ...input, invoice: d, client: input.clients.find((x) => !!x.id && x.id === d.client?.id) ?? d.client });
    const v = verdict(c);
    const failed = c.items.filter((i) => i.state === 'fail').map((i) => i.id).join(', ');
    if (v === 'not') out.push({ id: `PS_EXPORT:${d.id}`, severity: 'warning', code: 'PS_EXPORT_FAIL', message: `${d.invoice_number}: Sec 2(6) condition not met (${failed}), zero-rating under LUT may not apply; verify with your CA (PS5)`, invoiceId: d.id, invoiceNumber: String(d.invoice_number ?? '') });
    else if (v === 'pending') out.push({ id: `PS_PAY:${d.id}`, severity: 'info', code: 'PS_EXPORT_PENDING', message: `${d.invoice_number}: payment in foreign exchange not received yet (Sec 2(6)(iv))`, invoiceId: d.id, invoiceNumber: String(d.invoice_number ?? '') });
  }
  return out;
}
