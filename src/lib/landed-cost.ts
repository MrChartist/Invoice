/**
 * Landed cost (WP-8, P2 — Tally's "additional cost of purchase"): freight, loading, insurance … paid to
 * someone else (or not invoiced on the bill) spread over a purchase bill's goods lines so the stock
 * cost includes them. `PurchaseRecord.landed_costs` are memo amounts: they change only the stock
 * valuation (`PurchaseLineCore.landedUnit`), never the bill total, GST, ITC or the books — book the
 * freight itself as its own expense / bill. Basis `value` (default) splits by line value, `qty` by
 * quantity in base units; R4-A5 adds `weight` and `equal` for the landed-cost voucher. Pure.
 */

export interface LandedCharge {
  label: string;
  amount: number;
}

const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Charges with a positive amount (label trimmed), or undefined. */
export function cleanLandedCosts(list: unknown): LandedCharge[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = list
    .map((r) => ({ label: String((r as LandedCharge)?.label ?? '').trim(), amount: Math.round(n((r as LandedCharge)?.amount) * 100) / 100 }))
    .filter((r) => r.amount > 0);
  return out.length ? out : undefined;
}

export function landedTotal(list: unknown): number {
  return (cleanLandedCosts(list) ?? []).reduce((s, c) => s + c.amount, 0);
}

/** A goods line as the allocation sees it. `netWeight` = kg per base unit (R4-A5 weight basis). */
export interface LandedLine {
  quantity: number;
  unitCost: number;
  unitFactor?: number;
  netWeight?: number;
}

/**
 * Basis of the split: `value` (default) by line value, `qty` by quantity in base units; R4-A5 adds `weight` (net weight
 * in kg = base quantity × catalogue net weight) and `equal` (the same amount per goods line).
 */
export type LandedBasis = 'value' | 'qty' | 'weight' | 'equal';

/**
 * Extra cost per line unit for each line (index-aligned; 0 for lines without quantity). The shares add
 * up to the charges total (before per-unit rounding). A basis with nothing to weigh (free goods by value, no weights
 * by weight) falls back to quantity so the charge still lands somewhere.
 */
export function allocateLandedCost(lines: readonly LandedLine[], charges: unknown, basis: LandedBasis = 'value'): number[] {
  const total = landedTotal(charges);
  if (!(total > 0)) return lines.map(() => 0);
  const base = (l: LandedLine) => (l.quantity > 0 ? l.quantity * (n(l.unitFactor) > 0 ? n(l.unitFactor) : 1) : 0);
  const weight = (l: LandedLine, b: LandedBasis): number => {
    if (!(l.quantity > 0)) return 0;
    if (b === 'qty') return base(l);
    if (b === 'weight') return base(l) * Math.max(n(l.netWeight), 0);
    if (b === 'equal') return 1;
    return l.quantity * Math.max(l.unitCost, 0);
  };
  let used: LandedBasis = basis;
  let sum = lines.reduce((s, l) => s + weight(l, used), 0);
  if (!(sum > 0) && (basis === 'value' || basis === 'weight')) {
    used = 'qty';
    sum = lines.reduce((s, l) => s + weight(l, used), 0);
  }
  if (!(sum > 0)) return lines.map(() => 0);
  return lines.map((l) => (l.quantity > 0 ? (total * weight(l, used)) / sum / l.quantity : 0));
}

/**
 * R4-A5: the same split in rupees per line (index-aligned), each rounded to the paisa; the rounding drift goes to the
 * largest line so the amounts add up to the charges total exactly.
 */
export function allocateLandedAmounts(lines: readonly LandedLine[], charges: unknown, basis: LandedBasis = 'value'): number[] {
  const total = Math.round(landedTotal(charges) * 100);
  const per = allocateLandedCost(lines, charges, basis);
  const paise = lines.map((l, i) => Math.round(per[i] * Math.max(l.quantity, 0) * 100));
  const drift = total - paise.reduce((s, x) => s + x, 0);
  if (drift && paise.some((x) => x > 0)) {
    let big = 0;
    paise.forEach((x, i) => { if (x > paise[big]) big = i; });
    paise[big] += drift;
  }
  return paise.map((x) => x / 100);
}
