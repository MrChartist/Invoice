/**
 * TR-B1 weight and bag billing (pure). A line of an item sold by weight / bags snapshots its weighing as `wt`
 * (`LineWeight`, src/types/trade-r8.ts); the **net weight becomes the line quantity** in the line's billing unit, so
 * invoice-calc, GST, the HSN summary and the stock engine (quantity × `unit_factor`) read it unchanged (§8 Q4).
 *
 *   net kg = gross − packages × tare − deduction        (rounded to the gram)
 *   deduction: `per_package` kg a bag · `per_qtl` kg per quintal of the weight after tare (dhalta) · `percent` of it
 *
 * Tare and deductions are in kg; gross is in `gross_unit` (KG / QTL / MT). Quantity = net kg ÷ kg per billing unit,
 * 3 decimals; a billing unit that is not a weight (BAG, NOS) gives no quantity (the line keeps what was typed).
 */
import type { LineWeight } from '../../types/trade-r8';

const KG: Readonly<Record<string, number>> = { KG: 1, KGS: 1, QTL: 100, QUINTAL: 100, MT: 1000, TON: 1000, TONNE: 1000, G: 0.001, GM: 0.001, GMS: 0.001 };
export const PACKAGE_KINDS = ['BAG', 'KATTA', 'BORI', 'CRATE', 'BALE'] as const;
export const WEIGHT_UNITS = ['KG', 'QTL', 'MT'] as const;

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;

/** Kilograms in one `unit` (undefined when the unit is not a weight). */
export const kgPer = (unit: string | undefined): number | undefined => KG[String(unit ?? '').trim().toUpperCase()];

export const blankWeight = (kind = 'BAG'): LineWeight => ({ packages: 0, kind, gross: 0, tare_per_package: 0, deduction: { basis: 'per_qtl', value: 0 }, gross_unit: 'KG' });

/** The weighing in kg: gross, tare, deduction and net (net never below 0). */
export function weighNet(wt: LineWeight): { gross: number; tare: number; ded: number; net: number } {
  const gross = r3(Math.max(n(wt.gross), 0) * (kgPer(wt.gross_unit) ?? 1));
  const tare = r3(Math.max(n(wt.packages), 0) * Math.max(n(wt.tare_per_package), 0));
  const after = Math.max(gross - tare, 0);
  const v = Math.max(n(wt.deduction?.value), 0);
  const b = wt.deduction?.basis;
  const ded = r3(b === 'per_package' ? n(wt.packages) * v : b === 'percent' ? (after * v) / 100 : b === 'per_qtl' ? (after / 100) * v : 0);
  return { gross, tare, ded, net: r3(Math.max(after - ded, 0)) };
}

/** The line quantity in `unit` (3 decimals), or null when `unit` is not a weight unit. */
export function wtQuantity(wt: LineWeight, unit: string | undefined): number | null {
  const k = kgPer(unit);
  return k ? r3(weighNet(wt).net / k) : null;
}

/** False when the quantity was typed over the weighing (the line is then manual: `wt` is dropped). */
export function wtHolds(line: { wt?: LineWeight; quantity?: unknown; unit?: string }): boolean {
  if (!line.wt) return false;
  const q = wtQuantity(line.wt, line.unit);
  return q === null || Math.abs(q - n(line.quantity)) < 0.0005;
}

const fmt = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Printed sub-line: "120 BAG · gross 6,072 kg − tare 72 kg − dhalta 60 kg = 5,940 kg" ('' without a weighing). */
export function weightText(wt: LineWeight | undefined): string {
  if (!wt || !(n(wt.gross) > 0)) return '';
  const w = weighNet(wt);
  return [
    n(wt.packages) > 0 ? `${fmt(n(wt.packages))} ${wt.kind || 'BAG'} · ` : '',
    `gross ${fmt(w.gross)} kg`,
    w.tare > 0 ? ` − tare ${fmt(w.tare)} kg` : '',
    w.ded > 0 ? ` − dhalta ${fmt(w.ded)} kg` : '',
    ` = ${fmt(w.net)} kg`,
  ].join('');
}

/** Bags and net quintals of a line (brokerage / charge bases): from its weighing, else from a weight / bag unit. */
export function lineBags(l: { wt?: LineWeight; quantity?: unknown; unit?: string }): { bags: number; qtl: number } {
  if (l.wt) return { bags: n(l.wt.packages), qtl: r3(weighNet(l.wt).net / 100) };
  const k = kgPer(l.unit);
  const bag = (PACKAGE_KINDS as readonly string[]).includes(String(l.unit ?? '').toUpperCase());
  return { bags: bag ? n(l.quantity) : 0, qtl: k ? r3((n(l.quantity) * k) / 100) : 0 };
}
