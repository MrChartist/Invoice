/**
 * Landed cost (WP-8, P2 — Tally's "additional cost of purchase"): freight, loading, insurance … paid to
 * someone else (or not invoiced on the bill) spread over a purchase bill's goods lines so the stock
 * cost includes them. `PurchaseRecord.landed_costs` are memo amounts: they change only the stock
 * valuation (`PurchaseLineCore.landedUnit`), never the bill total, GST, ITC or the books — book the
 * freight itself as its own expense / bill. Basis `value` (default) splits by line value, `qty` by
 * quantity in base units. Pure.
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

/**
 * Extra cost per line unit for each line (index-aligned; 0 for lines without quantity). The shares add
 * up to the charges total (before per-unit rounding).
 */
export function allocateLandedCost(
  lines: readonly { quantity: number; unitCost: number; unitFactor?: number }[],
  charges: unknown,
  basis: 'value' | 'qty' = 'value',
): number[] {
  const total = landedTotal(charges);
  if (!(total > 0)) return lines.map(() => 0);
  const weight = (l: { quantity: number; unitCost: number; unitFactor?: number }) =>
    l.quantity > 0 ? (basis === 'qty' ? l.quantity * (n(l.unitFactor) > 0 ? n(l.unitFactor) : 1) : l.quantity * Math.max(l.unitCost, 0)) : 0;
  let sum = lines.reduce((s, l) => s + weight(l), 0);
  // Free goods only (value 0): fall back to quantity so the charge still lands somewhere.
  const byQty = basis === 'value' && !(sum > 0);
  if (byQty) sum = lines.reduce((s, l) => s + (l.quantity > 0 ? l.quantity * (n(l.unitFactor) > 0 ? n(l.unitFactor) : 1) : 0), 0);
  if (!(sum > 0)) return lines.map(() => 0);
  return lines.map((l) => {
    if (!(l.quantity > 0)) return 0;
    const w = byQty ? l.quantity * (n(l.unitFactor) > 0 ? n(l.unitFactor) : 1) : weight(l);
    return (total * w) / sum / l.quantity;
  });
}
