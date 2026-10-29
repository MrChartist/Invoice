/**
 * R21-C2 tank-lorry receipt (pure). The OMC bill is read by `fu-stock-io.ts` through `readPurchase` /
 * `readPurchaseLines` (purchases contract); this module takes the normalised lines. Per compartment: invoice litres and
 * invoice vs observed density at 15 °C, flagged outside ± `tol` kg/m³ (MDG receipt procedure (iv), FU15). Short receipt
 * = invoice litres − (tank after − tank before + litres sold while decanting); a shortage is a note and a debit-note
 * suggestion to the OMC, never posted. Working papers — verify with your CA.
 */
import type { PurchaseLineCore } from '../purchase-normalize';
import type { FuelTankLog } from '../../types/fuel-r21';
import { fuAt, MDG_DENSITY_RULES } from '../fuel-rules';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The MDG receipt density tolerance (kg/m³) in force on `day` (± 3.0 from the 2022 text). */
export const densityTol = (day: string): number => fuAt(MDG_DENSITY_RULES, day)?.value.tol ?? 3;

export interface ReceiptCheck { invoice_l: number; received_l: number | null; short_l: number | null; flags: { i: number; diff: number }[] }

/** The receipt's totals, short receipt (null without both dips) and the compartments whose density is out of band. */
export function receiptCheck(log: Pick<FuelTankLog, 'compartments' | 'before_l' | 'after_l' | 'sold_l'>, tol: number): ReceiptCheck {
  const c = log.compartments ?? [];
  const invoice_l = r3(c.reduce((s, x) => s + (Number(x.invoice_l) || 0), 0));
  const received_l = log.before_l != null && log.after_l != null ? r3(log.after_l - log.before_l + (Number(log.sold_l) || 0)) : null;
  const flags = c.flatMap((x, i) => {
    const diff = Math.round(((x.observed_density ?? 0) - (x.invoice_density ?? 0)) * 10) / 10;
    return x.invoice_density && x.observed_density && Math.abs(diff) > tol ? [{ i, diff }] : [];
  });
  return { invoice_l, received_l, short_l: received_l == null ? null : r3(invoice_l - received_l), flags };
}

/** Litres (base unit) and the rate per litre of `item` on a bill's lines (matched by item id, else by name). */
export function billLitres(lines: readonly PurchaseLineCore[], item: { id: string; name: string }): { litres: number; rate: number } {
  const mine = lines.filter((l) => (l.itemId ? l.itemId === item.id : l.name.trim().toLowerCase() === item.name.trim().toLowerCase()));
  const litres = r3(mine.reduce((s, l) => s + l.quantity * l.unitFactor, 0));
  return { litres, rate: mine.length ? Math.round((mine[0].unitCost / mine[0].unitFactor) * 100) / 100 : 0 };
}

/** The debit note to suggest for a short receipt (₹, at the bill's rate), or 0. */
export const debitFor = (shortL: number | null, rate: number): number => (shortL && shortL > 0 ? Math.round(shortL * rate * 100) / 100 : 0);
