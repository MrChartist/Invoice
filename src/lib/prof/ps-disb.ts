/**
 * R14 PS-B1 disbursements: court fees, stamp duty, government / filing fees … paid for a client and recovered at actual.
 * A disbursement is an ordinary expense row (`purchases`) with the additive `PurchaseRecord.ps = { disb, on_behalf, wo? }`,
 * the matter as `cost_centre_id` and the client as `billable_to_client_id`; on the client's behalf it is a pure-agent row
 * (`pure_agent`, no GST, no ITC), billed by the timesheet flow as a line that carries the R8 pure-agent key
 * (`charge_head_id: 'rule33'` + `PURE_AGENT_CHARGE`), so GSTR-1 / e-Invoice / e-Way leave it out (`isPureAgentLine`).
 * Ledger unchanged (gross: the cost is an expense, the recovery income — PS3 / T25). Purchases are read through
 * `readPurchase` (tests/purchase-contract.test.ts). Working paper — verify with your CA (PS3, PS25).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { isoDay } from '../dates';
import { ruleAt } from '../tax-rules';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { isPureAgentLine } from '../trade/pure-agent';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { getTable, setTable } from '../storage';
import { DISB_DEFAULTS, DISB_KINDS, type DisbKind } from './ps-b-rules';

export { DISB_KINDS, type DisbKind };

/** The PS-B part of `PurchaseRecord.ps` (declared in `types/prof-r14.ts`). */
export interface PsPurchaseB {
  disb?: DisbKind;
  on_behalf?: boolean;
  wo?: { date: string; reason: string; by?: string };
}
export const psOfPurchase = (p: unknown): PsPurchaseB => ((p as { ps?: PsPurchaseB } | null)?.ps ?? {});

/** Default for a kind on a date: court fee / stamp / government / filing fees are paid on the client's behalf. */
export const onBehalfByDefault = (kind: DisbKind, date?: string): boolean => ruleAt(DISB_DEFAULTS, date).on_behalf.includes(kind);

/**
 * The fields that make an expense a disbursement. On behalf: pure agent, no markup, no ITC (the GST, if any, is the
 * client's). Part of the fee (travel, courier): taxable re-bill at 0 % markup.
 */
export function disbursementPatch(p: Pick<PurchaseRecord, 'date' | 'itc_eligible'> & { ps?: unknown }, kind: DisbKind, clientId: string, opts: { matterId?: string; onBehalf?: boolean } = {}): Partial<PurchaseRecord> & { ps: PsPurchaseB } {
  const onBehalf = opts.onBehalf ?? onBehalfByDefault(kind, p.date);
  return {
    ps: { ...psOfPurchase(p), disb: kind, on_behalf: onBehalf },
    billable_to_client_id: clientId,
    ...(opts.matterId ? { cost_centre_id: opts.matterId } : {}),
    pure_agent: onBehalf || undefined,
    markup_percent: onBehalf ? undefined : 0,
    itc_eligible: onBehalf ? false : p.itc_eligible,
  };
}

/** A line of an old invoice billed as pure agent before PS-B1 (0 %, the timesheet note, no pure-agent key). */
export const LEGACY_PURE_AGENT_TEXT = 'as a pure agent (Rule 33, CGST Rules)';
export const isLegacyPureAgentLine = (l: { charge_head_id?: string; description?: string; tax_rate?: number } | null | undefined): boolean =>
  !!l && !l.charge_head_id && num(l.tax_rate) === 0 && String(l.description ?? '').includes(LEGACY_PURE_AGENT_TEXT);

/**
 * Base for the expected 194J on a fee note: the taxable value of the fee lines — GST and pure-agent recoveries (new and
 * old style) left out (PS25, Circular 23/2017 as recalled).
 */
export function feeTdsBase(rec: InvoiceRecord): number {
  const items = rec.items ?? [];
  const skip = new Set(items.filter((i) => isPureAgentLine(i) || isLegacyPureAgentLine(i)).map((i) => i.id));
  const calc = calculateInvoice(calcInputFromRecord(rec, { round_off_enabled: false, round_mode: 'none', amount_paid: 0 }));
  return round2(calc.lines.filter((l) => !skip.has(l.id)).reduce((s, l) => s + num(l.taxable), 0));
}

export interface DisbRow {
  id: string;
  date: string;
  kind: DisbKind | '';
  clientId: string;
  matterId: string;
  ref: string;
  amount: number;
  onBehalf: boolean;
  /** Days since the payment. */
  age: number;
}

const days = (from: string, to: string) => Math.max(Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000), 0);

/**
 * Disbursements not yet recovered on `today`: rows tagged `ps.disb`, billable to a client, not on a live invoice
 * (`billed` = the row ids billed by live invoices, from `liveInvoiceIds`), not written off and not void.
 */
export function unrecoveredDisbursements(purchases: readonly unknown[], billed: (id: string, rebilledIn?: string) => boolean, today: string): DisbRow[] {
  const out: DisbRow[] = [];
  for (const raw of purchases) {
    const ps = psOfPurchase(raw);
    const r = raw as Partial<PurchaseRecord>;
    if (!ps.disb || ps.wo || !r.billable_to_client_id || !r.id) continue;
    const p = readPurchase(raw);
    if (!p || isVoidStatus(p.status) || billed(r.id, r.rebilled_in)) continue;
    // Recovered at what it cost us: the full amount on behalf (no ITC), net of claimed ITC otherwise.
    const amount = round2(ps.on_behalf || !p.itcEligible ? p.total : p.taxable);
    out.push({ id: r.id, date: p.date, kind: ps.disb, clientId: r.billable_to_client_id, matterId: r.cost_centre_id ?? '', ref: p.number, amount, onBehalf: !!ps.on_behalf, age: days(p.date, today) });
  }
  return out.sort((a, b) => b.age - a.age || a.id.localeCompare(b.id));
}

/** Ageing buckets (days, inclusive upper bounds; the last is open). */
export function ageBuckets(rows: readonly Pick<DisbRow, 'age' | 'amount'>[], edges: readonly number[] = [30, 60, 90]): number[] {
  const out = new Array<number>(edges.length + 1).fill(0);
  for (const r of rows) {
    const k = edges.findIndex((e) => r.age <= e);
    out[k < 0 ? edges.length : k] = round2(out[k < 0 ? edges.length : k] + r.amount);
  }
  return out;
}

/** The disbursement schedule of a fee note (fee-note group / annexure): its pure-agent lines and the rows they bill. */
export function disbursementSchedule(rec: Pick<InvoiceRecord, 'items'>, purchases: readonly unknown[]): { date: string; kind: DisbKind | ''; ref: string; name: string; amount: number }[] {
  const byId = new Map((purchases as Partial<PurchaseRecord>[]).filter((p) => p?.id).map((p) => [p.id as string, p]));
  const out: { date: string; kind: DisbKind | ''; ref: string; name: string; amount: number }[] = [];
  for (const l of rec.items ?? []) {
    if (!isPureAgentLine(l) && !isLegacyPureAgentLine(l)) continue;
    const src = (l.bill_refs ?? []).map((id) => byId.get(id)).find(Boolean);
    const p = src ? readPurchase(src) : null;
    out.push({ date: p?.date ?? '', kind: src ? psOfPurchase(src).disb ?? '' : '', ref: p?.number ?? '', name: l.name, amount: round2(num(l.quantity) * num(l.rate)) });
  }
  return out;
}

/** Validate a write-off stamp. */
export function validateWriteOff(date: string, reason: string): string {
  if (!isoDay(date)) return 'Type the write-off date.';
  if (!reason.trim()) return 'Give a reason for the write-off.';
  return '';
}

const PURCHASES = 'purchases';

function stamp(id: string, fn: (ps: PsPurchaseB) => PsPurchaseB): void {
  const rows = getTable<PurchaseRecord>(PURCHASES);
  if (!rows.some((p) => p?.id === id && psOfPurchase(p).disb)) throw new Error('Disbursement not found.');
  setTable(PURCHASES, rows.map((p) => (p?.id === id ? { ...p, ps: fn(psOfPurchase(p)) } as PurchaseRecord : p)));
}

/** Write off an unrecovered disbursement (it leaves the unrecovered list; refused in a locked period). */
export function writeOffDisbursement(id: string, date: string, reason: string, by?: string): void {
  requireAccess('books.edit');
  const err = validateWriteOff(date, reason);
  if (err) throw new Error(err);
  assertUnlocked({ issue_date: date }, 'edit');
  stamp(id, (ps) => {
    if (ps.wo) throw new Error('Already written off.');
    return { ...ps, wo: { date, reason: reason.trim(), ...(by ? { by } : {}) } };
  });
}

/** Owner only: undo a write-off (refused when its date is locked). */
export function reverseDisbursementWriteOff(id: string): void {
  requireAccess('settings.manage');
  const p = getTable<PurchaseRecord>(PURCHASES).find((x) => x?.id === id);
  const wo = psOfPurchase(p).wo;
  if (!wo) throw new Error('Not written off.');
  assertUnlocked({ issue_date: wo.date }, 'edit');
  stamp(id, ({ wo: _w, ...ps }) => ps);
}
