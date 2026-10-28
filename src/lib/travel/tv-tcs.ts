/**
 * R15-D1 TCS on overseas tour programme packages (seller), pure: the dated rate (`TOUR_PACKAGE_TCS_RULES` — 5 % from
 * 1 Oct 2020; 5 % / 20 % slabs over the buyer's FY aggregate from 1 Oct 2023 (₹7 lakh) and 1 Apr 2025 (₹10 lakh); 2 %
 * flat under Sec 394(1) Table Sl. No. 8 from 1 Apr 2026), the no-PAN rate (`TCS_NO_PAN_RULES`), the stand-alone test (a
 * ticket or a hotel alone is not a package, TV4) and the non-resident exclusion (TV5). The result is written to the
 * invoice's existing TCS fields (`tcs_enabled`, `tcs_rate`, `tcs_base`, `tcs_label`) — the invoice maths computes
 * `tcs_amount`, so the TCS register, Form 27EQ / 143 and the due calendar read it as today — plus `tv.tcs`. On a slab
 * crossing the stored rate is the effective rate (the split is in `tv.tcs.slab`). `tax-rules.ts` is not touched.
 * Working papers — verify with your CA (TV1–TV7).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { TvComponent, TvSnapshot } from '../../types/travel-r15';
import { ruleAt } from '../tax-rules';
import { round2 } from '../invoice-calc';
import { TCS_NO_PAN_RULES, TOUR_PACKAGE_TCS_RULES } from '../travel-rules';

/** First day of the Income-tax Act 2025 labels (Sec 394(1) Sl. No. 8). */
const ACT_2025 = '2026-04-01';
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const MOVE = new Set<TvComponent>(['air', 'rail', 'bus', 'transfer']);

/** A package = travel and stay together (or a booked `package`); a ticket or a hotel alone is not (TV4). */
export const isTourPackage = (c: readonly TvComponent[]): boolean => c.includes('package') || (c.includes('hotel') && c.some((x) => MOVE.has(x)));

/** Indian FY start year of a local day. */
export const fyOf = (d: string): number => Number(d.slice(0, 4)) - (d.slice(5, 7) < '04' ? 1 : 0);

export type TourTcsStatus = 'off' | 'not_package' | 'non_resident' | 'ok';
export interface TourTcs {
  status: TourTcsStatus;
  /** Effective rate, % (6 decimals on a crossing invoice). */
  rate: number;
  amount: number;
  label: string;
  /** The split on a slab-crossing invoice, e.g. "5 % on ₹10,00,000.00 + 20 % on ₹2,00,000.00". */
  slab?: string;
  noPan?: boolean;
  /** The FY threshold of a slab year (for the "near the threshold" list), else undefined. */
  threshold?: number;
}

export interface TourTcsInput {
  date: string;
  /** TCS base of this invoice (total incl. GST, or taxable value — `travel_settings.tcs.base`, TV6), INR. */
  base: number;
  /** Buyer's earlier flagged tour-package bases in the same FY (slab years only), INR. */
  prior?: number;
  pan?: string;
  nonResident?: boolean;
  /** Components of the trip (non-cancelled bookings); absent = not tested. */
  components?: readonly TvComponent[];
  /** The user ticked "overseas tour programme package" over the stand-alone test. */
  force?: boolean;
}

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function tourTcsLabel(date: string, rates: readonly number[], noPan = false): string {
  const r = [...new Set(rates)].map((x) => `${x} %`).join(' / ');
  return `${date >= ACT_2025 ? 'Sec 394(1) Sl. 8 —' : '206C(1G)'} overseas tour package ${r}${noPan ? ' (no PAN)' : ''}`;
}

/** TCS of one invoice by date, base and the buyer's FY aggregate. */
export function tourTcs(i: TourTcsInput): TourTcs {
  const rule = ruleAt(TOUR_PACKAGE_TCS_RULES, i.date);
  const none = (status: TourTcsStatus): TourTcs => ({ status, rate: 0, amount: 0, label: '' });
  if (!rule) return none('off');
  if (i.nonResident) return none('non_resident');
  if (!i.force && i.components && !isTourPackage(i.components)) return none('not_package');
  const base = Math.max(round2(i.base), 0);
  let parts: { rate: number; on: number }[];
  let threshold: number | undefined;
  if ('slabs' in rule) {
    let used = Math.max(i.prior ?? 0, 0), left = base;
    parts = [];
    for (const s of rule.slabs) {
      if (s.upTo !== undefined) threshold = threshold ?? s.upTo;
      const on = Math.min(left, Math.max((s.upTo ?? Infinity) - used, 0));
      if (on > 0) parts.push({ rate: s.rate, on });
      left -= on;
      used += on;
    }
    if (!parts.length) parts = [{ rate: rule.slabs[0].rate, on: 0 }];
  } else parts = [{ rate: rule.rate, on: base }];
  const np = ruleAt(TCS_NO_PAN_RULES, i.date);
  const noPan = !!np && !PAN.test(String(i.pan ?? '').trim().toUpperCase());
  if (noPan && np) parts = parts.map((p) => ({ ...p, rate: Math.max(np.twice ? 2 * p.rate : p.rate, np.floor) }));
  const amount = round2(parts.reduce((s, p) => s + (p.on * p.rate) / 100, 0));
  const rate = base > 0 && parts.length > 1 ? Math.round((amount / base) * 1e8) / 1e6 : parts[0].rate;
  return {
    status: 'ok', rate, amount, noPan, threshold,
    label: tourTcsLabel(i.date, parts.map((p) => p.rate), noPan),
    ...(parts.length > 1 ? { slab: parts.map((p) => `${p.rate} % on ${inr(p.on)}`).join(' + ') } : {}),
  };
}

type Doc = Pick<InvoiceRecord, 'id' | 'issue_date' | 'status' | 'doc_type' | 'client' | 'currency'> & Partial<Pick<InvoiceRecord, 'exchange_rate' | 'tcs_amount' | 'tcs_enabled'>> & { tv?: TvSnapshot };
const fx = (d: Partial<Doc>) => (d.currency && d.currency.toUpperCase() !== 'INR' && Number(d.exchange_rate) > 0 ? Number(d.exchange_rate) : 1);
const SALE = /^(INVOICE|TAX_INVOICE|BILL_OF_SUPPLY)$/i;
/** A live sale carrying the travel TCS flag (drafts and cancelled documents left out). */
export const isTourTcsDoc = (d: Partial<Doc>): boolean => !!d.tv?.tcs && !d.tv.tcs.nr && SALE.test(String(d.doc_type ?? '')) && !/^(draft|cancelled)$/i.test(String(d.status ?? ''));
export const buyerKey = (c?: { id?: string; pan?: string; name?: string }): string => c?.id || (c?.pan ? `pan:${c.pan.toUpperCase()}` : `n:${(c?.name ?? '').trim().toLowerCase()}`);

/** Buyer's flagged tour-package bases in the FY of `date`, dated on or before it (this document left out), INR. */
export function priorTourBase(docs: readonly Partial<Doc>[], buyer: string, date: string, selfId?: string): number {
  const fy = fyOf(date);
  let s = 0;
  for (const d of docs) {
    const day = String(d.issue_date ?? '').slice(0, 10);
    if (d.id === selfId || !isTourTcsDoc(d) || buyerKey(d.client) !== buyer || fyOf(day) !== fy || day > date) continue;
    s += (Number(d.tv?.tcs?.base) || 0) * fx(d);
  }
  return round2(s);
}

/** The invoice patch for a computed TCS (`tv` other sub-objects kept). Status other than `ok` switches TCS off. */
export function tcsPatch(r: TourTcs, base: number, baseKind: 'total' | 'taxable', tv: TvSnapshot | undefined, extra: { force?: boolean } = {}): Partial<InvoiceRecord> {
  const ok = r.status === 'ok';
  const tcs = { rate: r.rate, base: ok ? round2(base) : 0, label: r.label, ...(r.slab ? { slab: r.slab } : {}), ...(r.status === 'non_resident' ? { nr: true } : {}), ...(extra.force ? { force: true } : {}), ...(r.noPan ? { no_pan: true } : {}) };
  return { tcs_enabled: ok && r.rate > 0, tcs_rate: ok ? r.rate : 0, tcs_base: baseKind, ...(ok ? { tcs_label: r.label } : {}), tv: { ...tv, tcs } };
}

/* ── Register (view `tcs`) ─────────────────────────────────────────────────────────────────────────────────── */

export interface BuyerRow { key: string; name: string; pan: string; count: number; base: number; tcs: number }
export interface TcsRegister { fy: number; buyers: BuyerRow[]; quarters: [number, number, number, number]; noPan: BuyerRow[]; near: BuyerRow[]; total: number }

/** TCS collected on flagged tour packages per buyer for the FY, the quarter totals (Form 27EQ / 143), PAN missing, and
 * buyers at 80 % or more of a slab year's threshold (history years). INR. */
export function tcsRegister(docs: readonly Partial<Doc>[], fy: number): TcsRegister {
  const by = new Map<string, BuyerRow>();
  const q: [number, number, number, number] = [0, 0, 0, 0];
  let threshold = 0;
  for (const d of docs) {
    const day = String(d.issue_date ?? '').slice(0, 10);
    if (!isTourTcsDoc(d) || fyOf(day) !== fy) continue;
    const k = buyerKey(d.client);
    const r = by.get(k) ?? { key: k, name: d.client?.name ?? '', pan: String(d.client?.pan ?? '').toUpperCase(), count: 0, base: 0, tcs: 0 };
    const tcs = round2((Number(d.tcs_amount) || 0) * fx(d));
    r.count++;
    r.base = round2(r.base + (Number(d.tv?.tcs?.base) || 0) * fx(d));
    r.tcs = round2(r.tcs + tcs);
    by.set(k, r);
    const m = Number(day.slice(5, 7));
    q[m >= 4 && m <= 6 ? 0 : m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : 3] += tcs;
    const rule = ruleAt(TOUR_PACKAGE_TCS_RULES, day);
    if (rule && 'slabs' in rule) threshold = rule.slabs[0].upTo ?? 0;
  }
  const buyers = [...by.values()].sort((a, b) => b.tcs - a.tcs || a.name.localeCompare(b.name));
  return {
    fy, buyers, quarters: q.map(round2) as TcsRegister['quarters'],
    noPan: buyers.filter((b) => !PAN.test(b.pan)),
    near: threshold ? buyers.filter((b) => b.base >= threshold * 0.8) : [],
    total: round2(q.reduce((s, x) => s + x, 0)),
  };
}
