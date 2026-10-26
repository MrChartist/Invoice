/**
 * Loyalty tiers and points expiry (R4-B2) — pure maths used by `loyalty.ts`.
 *
 *  - Tiers: `{ id, name, min_spend_12m, multiplier }`, up to 5, kept as DATED sets (`{ from, tiers }`, appended,
 *    never overwritten), so a bill keeps the tier rules of its own date.
 *  - A customer's tier on a bill date = the highest tier whose `min_spend_12m` ≤ the customer's taxable spend in the
 *    365 days BEFORE that date (sales − credit notes; the bill itself is not counted).
 *  - Earning = base points × the tier multiplier, rounded down.
 *  - Expiry (`expiry_months`, absent = never): each earn lot expires on its earn date + N months; redemptions and
 *    negative entries (credit notes, negative adjustments) consume the OLDEST lots first (FIFO). Points still in a lot
 *    on its expiry date become an "Expired" ledger row on that date.
 *
 * With no tiers and no expiry every result equals the single-rate ledger of WP-9.
 */
import { num } from '../invoice-calc';
import { shiftDay } from '../dates';

export interface LoyaltyTier {
  id: string;
  name: string;
  /** Taxable spend in the last 365 days needed for the tier (₹). */
  min_spend_12m: number;
  /** Points multiplier (1 = base rate). */
  multiplier: number;
}

export interface TierSet {
  /** Effective from (YYYY-MM-DD). */
  from: string;
  tiers: LoyaltyTier[];
}

export const MAX_TIERS = 5;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Clean a tier list: named, non-negative spend, multiplier > 0, at most 5, by spend ascending. */
export function cleanTiers(raw: unknown): LoyaltyTier[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<LoyaltyTier>[])
    .filter((t) => t && String(t.name ?? '').trim() && num(t.multiplier) > 0 && num(t.min_spend_12m) >= 0)
    .map((t, i) => ({ id: String(t.id || `tier${i + 1}`), name: String(t.name).trim(), min_spend_12m: Math.max(num(t.min_spend_12m), 0), multiplier: num(t.multiplier) }))
    .sort((a, b) => a.min_spend_12m - b.min_spend_12m)
    .slice(0, MAX_TIERS);
}

export function cleanTierSets(raw: unknown): TierSet[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<TierSet>[])
    .filter((s) => s && ISO.test(String(s.from ?? '')))
    .map((s) => ({ from: String(s.from), tiers: cleanTiers(s.tiers) }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** The tier set in force on `day` (latest dated on or before it), or an empty list. */
export function tiersOn(sets: readonly TierSet[] | undefined, day: string): LoyaltyTier[] {
  let best: TierSet | undefined;
  for (const s of sets ?? []) if (s.from <= day) best = s;
  return best?.tiers ?? [];
}

/** Append a tier set from `from` (replacing one with the same date only). */
export function appendTierSet(sets: readonly TierSet[] | undefined, from: string, tiers: readonly LoyaltyTier[]): TierSet[] {
  return [...(sets ?? []).filter((s) => s.from !== from), { from, tiers: cleanTiers(tiers) }].sort((a, b) => a.from.localeCompare(b.from));
}

/** The tier for a 12-month spend (highest reached), or undefined (base points). */
export function tierFor(tiers: readonly LoyaltyTier[], spend: number): LoyaltyTier | undefined {
  let best: LoyaltyTier | undefined;
  for (const t of tiers) if (spend + 1e-9 >= t.min_spend_12m) best = t;
  return best;
}

/** The next tier above `spend` and the spend still needed for it. */
export function nextTier(tiers: readonly LoyaltyTier[], spend: number): { tier: LoyaltyTier; need: number } | undefined {
  const t = tiers.find((x) => x.min_spend_12m > spend + 1e-9);
  return t ? { tier: t, need: Math.round((t.min_spend_12m - spend) * 100) / 100 } : undefined;
}

/** A customer's dated spend entries (taxable ₹, negative for a credit note). */
export interface SpendEntry {
  date: string;
  amount: number;
}

/** Spend in the 365 days before `day` (from `day − 365` inclusive to `day` exclusive). */
export function rollingSpend(entries: readonly SpendEntry[], day: string): number {
  const from = shiftDay(day, -365);
  let s = 0;
  for (const e of entries) if (e.date >= from && e.date < day) s += num(e.amount);
  return Math.round(s * 100) / 100;
}

/** Base points × multiplier, rounded down (sign kept). */
export function multiplyPoints(base: number, multiplier: number): number {
  const m = num(multiplier) > 0 ? num(multiplier) : 1;
  const v = Math.floor(Math.abs(base) * m + 1e-9);
  return base < 0 ? -v : v;
}

/** `day` + `months` calendar months (the day clamped to the month's end). */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const total = m - 1 + Math.floor(months);
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  const last = new Date(ty, tm + 1, 0).getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${ty}-${p(tm + 1)}-${p(Math.min(d, last))}`;
}

/* ── Lots and expiry ──────────────────────────────────────────── */

export interface LedgerEvent {
  date: string;
  ref: string;
  /** Points earned (negative = taken back, e.g. a credit note or a negative adjustment). */
  earned: number;
  redeemed: number;
  doc_id?: string;
  note?: string;
}

export interface LotRow extends LedgerEvent {
  /** Points that lapsed on `date` (the "Expired" row). */
  expired: number;
  /** Earn rows: the day their points expire. */
  expires_on?: string;
  kind: 'earn' | 'redeem' | 'expired';
}

export interface Lot {
  earned_on: string;
  expires_on: string;
  qty: number;
}

/**
 * Run the events (oldest first) through FIFO lots expiring `months` after they were earned, up to `asOf`. Returns
 * the rows with "Expired" rows inserted on each lot's expiry date, and the lots still open. A debit larger than the
 * open lots leaves a deficit that later earnings fill first.
 */
export function runLots(events: readonly LedgerEvent[], months: number | undefined, asOf: string): { rows: LotRow[]; lots: Lot[] } {
  const rows: LotRow[] = [];
  const lots: Lot[] = [];
  let deficit = 0;
  const expireUpTo = (day: string, inclusive: boolean) => {
    if (!months) return;
    while (lots.length && (inclusive ? lots[0].expires_on <= day : lots[0].expires_on < day)) {
      const lot = lots.shift()!;
      if (lot.qty > 0) rows.push({ date: lot.expires_on, ref: 'Expired', earned: 0, redeemed: 0, expired: lot.qty, kind: 'expired', note: `Earned ${lot.earned_on}` });
    }
  };
  const consume = (qty: number) => {
    let rest = qty;
    while (rest > 0 && lots.length) {
      const take = Math.min(rest, lots[0].qty);
      lots[0].qty -= take;
      rest -= take;
      if (lots[0].qty <= 0) lots.shift();
    }
    deficit += rest;
  };
  for (const e of events) {
    expireUpTo(e.date, true);
    const expires = months ? addMonths(e.date, months) : undefined;
    if (e.earned > 0) {
      let qty = e.earned;
      const cover = Math.min(deficit, qty);
      deficit -= cover;
      qty -= cover;
      if (qty > 0) lots.push({ earned_on: e.date, expires_on: expires ?? '9999-12-31', qty });
    } else if (e.earned < 0) consume(-e.earned);
    if (e.redeemed > 0) consume(e.redeemed);
    rows.push({ ...e, expired: 0, ...(expires && e.earned > 0 ? { expires_on: expires } : {}), kind: e.redeemed > 0 && e.earned <= 0 ? 'redeem' : 'earn' });
  }
  expireUpTo(asOf, true);
  return { rows, lots: lots.filter((l) => l.qty > 0) };
}

/** The next expiry: points that lapse on the earliest date after `day`, within `withinDays` (default: any). */
export function nextExpiry(lots: readonly Lot[], day: string, withinDays?: number): { date: string; points: number } | undefined {
  const limit = withinDays !== undefined ? shiftDay(day, withinDays) : '9999-12-30';
  const open = lots.filter((l) => l.expires_on > day && l.expires_on <= limit && l.qty > 0);
  if (!open.length) return undefined;
  const date = open.reduce((m, l) => (l.expires_on < m ? l.expires_on : m), open[0].expires_on);
  return { date, points: open.filter((l) => l.expires_on === date).reduce((s, l) => s + l.qty, 0) };
}

/** Points lapsing in [from, to] (both inclusive). */
export function expiringBetween(lots: readonly Lot[], from: string, to: string): number {
  return lots.filter((l) => l.expires_on >= from && l.expires_on <= to).reduce((s, l) => s + l.qty, 0);
}
