/**
 * RT-A2: the MRP guard for every shop, GST-cut MRP pricing and the relabel queue's price snapshot.
 *
 *  - **MRP guard** (`retail_settings.mrp_guard`, off by default): a sale line priced above its MRP — per base unit,
 *    inclusive of GST, after the line discount and the line's share of an invoice discount — is a warning (`warn`) or
 *    an error (`block`). Under `block` the owner (`doc.approve`) is asked instead ("Sell anyway") and the override is
 *    audited (`rt-settings.ts` `recordMrpOverrides`). The MRP is the batch's (`PurchaseLine.mrp`, per base unit), else the catalogue's,
 *    each lowered by its GST-cut basis. Credit notes, quotations and free (₹0) lines are never checked. The 7U pharma
 *    option "block sale above MRP" keeps working; a line it already refused is not reported twice (the stricter wins).
 *  - **GST-cut MRP** (`mrpAfterRateChange`): stock whose MRP was printed for an older, higher GST rate
 *    (`mrp_tax_basis: { rate, until? }` on the stock item or catalogue item) sells at MRP × (100 + new) ÷ (100 + old),
 *    rounded to the paisa. It never raises an MRP: a rate increase changes nothing (the maker relabels; RT4).
 *
 * Pure. The live readers are wired in `stock-tracking.ts`; the audit of an owner's override is `rt-settings.ts`
 * `recordMrpOverrides`. Working paper —
 * verify with your CA (RT4).
 */
import { num, round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import type { GuardMode, MrpTaxBasis, RetailSettings } from '../../types/retail-r9';

/** Suffix that marks a guard message (the editor shows MRP warnings at save; other stock warnings stay as they were). */
export const MRP_TAG = '(MRP check)';
export const isMrpMessage = (m: string): boolean => m.endsWith(MRP_TAG);

/** MRP after a GST rate change: lowered by (100 + new) ÷ (100 + old) when the rate fell; unchanged otherwise. */
export function mrpAfterRateChange(mrp: number, oldRate: number, newRate: number): number {
  const m = num(mrp);
  const o = num(oldRate);
  const n = num(newRate);
  if (!(m > 0) || !(o > n) || n < 0) return m;
  return round2((m * (100 + n)) / (100 + o));
}

/**
 * The MRP that applies to a sale at `lineRate` % GST: the printed MRP lowered by its basis when the stock was received
 * up to the basis's `until` day (or the basis has none). `receivedOn` = the batch's first receipt (local day).
 */
export function effectiveMrp(mrp: number, basis: MrpTaxBasis | undefined, lineRate: number, receivedOn?: string): number {
  if (!basis || !(num(basis.rate) > num(lineRate))) return num(mrp);
  if (basis.until && receivedOn && receivedOn > basis.until) return num(mrp);
  return mrpAfterRateChange(mrp, basis.rate, lineRate);
}

export interface MrpLine {
  name: string;
  quantity?: number;
  rate?: number;
  discount_percent?: number;
  tax_rate?: number;
  unit_factor?: number;
  free_of?: string;
  batch_no?: string;
  hsn?: string;
  optional?: boolean;
  alt_group?: string;
  selected?: boolean;
}

export interface MrpDoc {
  id?: string;
  invoice_number?: string;
  doc_type?: string;
  status?: string;
  price_includes_tax?: boolean;
  discount_type?: string;
  discount_rate?: number;
  items: readonly MrpLine[];
}

const SALE_TYPES = new Set(['', 'INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
const excluded = (l: MrpLine) => (l.optional || (l.alt_group ?? '').trim()) && !l.selected;
const lineNet = (l: MrpLine) => num(l.quantity) * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100);

/**
 * Selling price per BASE unit of each line, inclusive of GST, after the line discount and the line's share of the
 * invoice discount (percent, or an amount spread by line value). Lines with no quantity or no rate give 0.
 */
export function pricesPerBaseUnit(doc: MrpDoc): number[] {
  const nets = doc.items.map((l) => (excluded(l) ? 0 : lineNet(l)));
  const sum = nets.reduce((s, n) => s + n, 0);
  const disc = num(doc.discount_rate);
  const share = (n: number) => (!(disc > 0) || !(sum > 0) ? 0 : doc.discount_type === 'AMOUNT' ? (Math.min(disc, sum) * n) / sum : (n * Math.min(disc, 100)) / 100);
  return doc.items.map((l, i) => {
    const q = num(l.quantity);
    if (!(q > 0) || !(nets[i] > 0)) return 0;
    const net = nets[i] - share(nets[i]);
    const gross = doc.price_includes_tax ? net : net * (1 + Math.max(num(l.tax_rate), 0) / 100);
    const f = num(l.unit_factor) > 0 ? num(l.unit_factor) : 1;
    return gross / q / f;
  });
}

export interface MrpIssues {
  errors: string[];
  warnings: string[];
  /** Block mode, owner signed in: ask "Sell anyway" (the existing confirmation); the save is then audited. */
  confirm: string[];
}

/**
 * The guard for one document. `mrpOf(line)` = the effective MRP per base unit (undefined / 0 = unknown, not checked).
 * `already` = names a stricter check (the pharma option) already refused.
 */
export function mrpIssues(doc: MrpDoc, opts: { mode: GuardMode | undefined; mrpOf: (l: MrpLine) => number | undefined; owner: boolean; already?: ReadonlySet<string> }): MrpIssues {
  const out: MrpIssues = { errors: [], warnings: [], confirm: [] };
  if (!opts.mode || opts.mode === 'off' || !SALE_TYPES.has(doc.doc_type ?? '')) return out;
  const prices = pricesPerBaseUnit(doc);
  doc.items.forEach((l, i) => {
    const name = (l.name ?? '').trim();
    if (!name || l.free_of || !(prices[i] > 0) || opts.already?.has(name)) return;
    const mrp = num(opts.mrpOf(l));
    if (!(mrp > 0) || prices[i] <= mrp + 0.005) return;
    const msg = `${name}: ₹${prices[i].toFixed(2)} a unit (incl. GST) is above the MRP ₹${mrp.toFixed(2)} ${MRP_TAG}`;
    if (opts.mode === 'warn') out.warnings.push(msg);
    else if (opts.owner) out.confirm.push(msg);
    else out.errors.push(`${msg.slice(0, -MRP_TAG.length).trim()} — only the owner can sell above MRP ${MRP_TAG}`);
  });
  return out;
}

/** Merge the guard into stock issues: errors stop the save, confirmations join the "Sell anyway" list. */
export function withMrpIssues<T extends { errors: string[]; expired: string[]; warnings: string[] }>(issues: T, m: MrpIssues): T {
  if (!m.errors.length && !m.warnings.length && !m.confirm.length) return issues;
  return { ...issues, errors: [...issues.errors, ...m.errors], expired: [...issues.expired, ...m.confirm], warnings: [...issues.warnings, ...m.warnings] };
}

/** Is the guard on for this company (so callers without stock tracking still check)? */
export const mrpGuardOn = (s: Pick<RetailSettings, 'mrp_guard'>): boolean => !!s.mrp_guard && s.mrp_guard !== 'off';

/**
 * Audit the owner's "Sell anyway" over blocked MRP lines once, after the confirmed save. `record` is `audit.record`
 * (passed in, so this module stays pure and its callers keep their own audit import).
 */
export function recordMrpOverrides(doc: { id?: string; invoice_number?: string }, confirmed: readonly string[], actor: string, record: (row: { entity: 'invoice'; entity_id: string; action: 'update'; doc_number?: string; summary: string }) => unknown): void {
  const lines = confirmed.filter(isMrpMessage);
  if (!lines.length) return;
  try {
    record({ entity: 'invoice', entity_id: doc.id || doc.invoice_number || 'pos', action: 'update', doc_number: doc.invoice_number, summary: `Sale above MRP allowed by ${actor}: ${lines.map((m) => m.replace(MRP_TAG, '').trim()).join('; ')}` });
  } catch {
    /* logging never blocks */
  }
}

/** RT-A2 relabel queue: the price a shelf label shows now (selling rate and effective MRP at the item's own GST rate). */
export function labelPriceNow(item: { rate?: number; sale_rate?: number; mrp?: number; tax_rate?: number; mrp_tax_basis?: MrpTaxBasis }): { rate: number; mrp: number } {
  const rate = round2(num(item.rate ?? item.sale_rate));
  const mrp = num(item.mrp) > 0 ? effectiveMrp(num(item.mrp), item.mrp_tax_basis, num(item.tax_rate)) : 0;
  return { rate, mrp: round2(mrp) };
}

/** Items whose label shows an old price: printed before, and the rate or effective MRP has changed since. */
export function relabelDue<T extends { label_printed_at?: string; label_price?: { rate: number; mrp: number }; rate?: number; sale_rate?: number; mrp?: number; tax_rate?: number; mrp_tax_basis?: MrpTaxBasis }>(items: readonly T[]): T[] {
  return items.filter((i) => {
    if (!i.label_printed_at || !i.label_price) return false;
    const now = labelPriceNow(i);
    return Math.abs(now.rate - num(i.label_price.rate)) > 0.004 || Math.abs(now.mrp - num(i.label_price.mrp)) > 0.004;
  });
}

/**
 * The default GST-cut basis from an HSN master row's dated rates (RT-A2 bulk action): the latest rate change on or
 * before `day` that LOWERED the rate gives `{ rate: old rate, until: the day before the new rate }`. Undefined when the
 * rate in force did not fall (a rate increase never lowers — or raises — an MRP).
 */
export function basisFromRates(rates: readonly { from: string; rate: number }[], day: string): MrpTaxBasis | undefined {
  const sorted = [...rates].filter((r) => r.from && r.from <= day).sort((a, b) => a.from.localeCompare(b.from));
  for (let i = sorted.length - 1; i > 0; i--) {
    if (num(sorted[i - 1].rate) > num(sorted[i].rate)) return { rate: num(sorted[i - 1].rate), until: shiftDay(sorted[i].from, -1) };
    if (num(sorted[i - 1].rate) !== num(sorted[i].rate)) return undefined;
  }
  return undefined;
}
