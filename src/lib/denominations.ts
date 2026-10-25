/** Cash denominations for pay-in slips and the day-end cash tally (WP-5). Pure. */

import { round2 } from './invoice-calc';

/** Notes / coins in circulation used on Indian pay-in slips (₹2,000 notes were withdrawn in 2023). */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Count per denomination, keyed by the face value as text (`'500'`). */
export type DenominationCounts = Record<string, number>;

/** Non-negative whole counts for the known denominations only. */
export function normalizeCounts(raw: unknown): DenominationCounts {
  const out: DenominationCounts = {};
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const d of DENOMINATIONS) {
    const n = Math.floor(Number(o[String(d)]));
    if (Number.isFinite(n) && n > 0) out[String(d)] = n;
  }
  return out;
}

export interface DenominationRow {
  value: number;
  count: number;
  amount: number;
}

export function denominationRows(counts: DenominationCounts): DenominationRow[] {
  const c = normalizeCounts(counts);
  return DENOMINATIONS.map((value) => ({ value, count: c[String(value)] ?? 0, amount: round2(value * (c[String(value)] ?? 0)) }));
}

export function cashTotal(counts: DenominationCounts): number {
  return round2(denominationRows(counts).reduce((s, r) => s + r.amount, 0));
}

