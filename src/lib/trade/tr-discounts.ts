/**
 * TR-A1 trade discounts: compound chains ("18+4"), ₹ per unit, and the minimum-margin hold.
 *
 * The line keeps ONE effective `discount_percent` (10 decimals — QA8 T11: enough that the net of a ₹1,000-crore line
 * still equals qty × (rate × chain − per unit) to the paisa) — `invoice-calc.ts` is untouched, so GST, HSN, Tally,
 * books and every reader see the same figure (§8 Q2). `disc_chain` / `disc_per_unit` are print snapshots:
 *   chain %     = 100 × (1 − Π(1 − dᵢ/100))
 *   effective % = chain % + disc_per_unit / rate × 100   (net unit price = rate × (1 − chain %) − per unit)
 * Re-derived when the rate changes; a typed % clears both snapshots (`reconcileDiscount`).
 * Pure (the editor's pricing glue imports it). Minimum margin: `tr-margin.ts`.
 */
import type { InvoiceItem } from '../../types/invoice';
import { num } from '../invoice-calc';

const r10 = (n: number) => Math.round(n * 1e10) / 1e10;

/** "18+4" / "18 + 4 + 2" / "10" → steps; null when not a chain of ≤ 3 numbers in 0–100. */
export function parseChain(text: string): number[] | null {
  const parts = String(text ?? '').replace(/%/g, '').split('+').map((p) => p.trim());
  if (!parts.length || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const steps = parts.map(Number);
  return steps.every((d) => d >= 0 && d <= 100) ? steps : null;
}

export const chainPercent = (chain: readonly number[] | undefined): number =>
  r10(100 * (1 - (chain ?? []).reduce((p, d) => p * (1 - Math.min(Math.max(num(d), 0), 100) / 100), 1)));

/** The effective line % for a chain and a ₹-per-unit discount on `rate` (capped at 100). */
export function effectivePercent(chain: readonly number[] | undefined, perUnit: number | undefined, rate: number): number {
  const c = chainPercent(chain);
  const pu = num(perUnit) > 0 && num(rate) > 0 ? (num(perUnit) / num(rate)) * 100 : 0;
  return r10(Math.min(c + pu, 100));
}

/** "18 + 4 %" · "18 + 4 % + ₹5/unit" · '' (print sub-line and editor label). */
export function discountLabel(item: Pick<InvoiceItem, 'disc_chain' | 'disc_per_unit'>): string {
  const chain = (item.disc_chain ?? []).filter((d) => num(d) > 0);
  const parts = [chain.length ? `${chain.join(' + ')} %` : '', num(item.disc_per_unit) > 0 ? `₹${num(item.disc_per_unit)}/unit` : ''].filter(Boolean);
  return parts.join(' + ');
}

/**
 * What to patch on a line whose snapshots may be stale: `lastWritten` is the % this module last set. A % that
 * differs from both the expected and the last-written one was typed: the snapshots go. A rate change: re-derived.
 */
export function reconcileDiscount(item: Pick<InvoiceItem, 'rate' | 'discount_percent' | 'disc_chain' | 'disc_per_unit'>, lastWritten?: number): Partial<InvoiceItem> | null {
  if (!item.disc_chain?.length && !(num(item.disc_per_unit) > 0)) return null;
  const want = effectivePercent(item.disc_chain, item.disc_per_unit, num(item.rate));
  const have = num(item.discount_percent);
  if (Math.abs(have - want) < 1e-6) return null;
  if (lastWritten !== undefined && Math.abs(have - lastWritten) < 1e-6) return { discount_percent: want };
  return { disc_chain: undefined, disc_per_unit: undefined };
}
