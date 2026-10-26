/**
 * Live gross margin in the editor (8G, 8.102). A cost per BASE unit for each item name, from (in
 * order) the latest purchase bill line (landed rate per base unit), the item's latest standard cost,
 * its opening rate. Built once per editor visit (`buildUnitCosts`), then `documentMargin` is O(lines)
 * so typing stays cheap. Never printed; the chip is hidden from viewers.
 */

import type { InvoiceItem } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { isVoidStatus, readPurchase, readPurchaseLines } from './purchase-normalize';
import { liveInputs } from './inventory';
import { peekTable } from './storage';

export type CostBasis = 'purchase' | 'standard' | 'opening';
export interface UnitCost {
  cost: number;
  basis: CostBasis;
  date?: string;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

interface StockItemLike {
  name: string;
  opening_rate?: number;
  standard_costs?: { from: string; rate: number }[];
  aliases?: string[];
}

export function buildUnitCosts(purchases: readonly unknown[], stockItems: readonly StockItemLike[], vendors: readonly unknown[] = []): Map<string, UnitCost> {
  const out = new Map<string, UnitCost>();
  for (const it of stockItems) {
    const std = [...(it.standard_costs ?? [])].filter((s) => num(s.rate) > 0).sort((a, b) => (a.from < b.from ? 1 : -1))[0];
    const entry: UnitCost | null = std ? { cost: num(std.rate), basis: 'standard', date: std.from } : num(it.opening_rate) > 0 ? { cost: num(it.opening_rate), basis: 'opening' } : null;
    if (!entry) continue;
    for (const n of [it.name, ...(it.aliases ?? [])]) if (norm(n)) out.set(norm(n), entry);
  }
  // The latest purchase wins over standard / opening rates.
  const latest = new Map<string, UnitCost>();
  for (const raw of purchases) {
    const bill = readPurchase(raw, vendors);
    if (!bill || isVoidStatus(bill.status) || bill.isExpense) continue;
    for (const l of readPurchaseLines(raw)) {
      const k = norm(l.name);
      if (!k || !(l.unitCost > 0)) continue;
      const f = l.unitFactor > 0 ? l.unitFactor : 1;
      const prev = latest.get(k);
      if (!prev || (prev.date ?? '') <= bill.date) latest.set(k, { cost: (l.unitCost + (l.landedUnit || 0)) / f, basis: 'purchase', date: bill.date });
    }
  }
  for (const [k, v] of latest) out.set(k, v);
  return out;
}

/**
 * R6-C1: purchases as the stock engine sees them (`liveInputs().purchases`): engine copies with the landed-cost
 * vouchers (R4-A5) applied, so the chip and the insights cost goods at the landed rate the stock reports use.
 * Stored bills never change.
 */
export function liveCostPurchases(): unknown[] {
  return [...(liveInputs().purchases ?? [])] as unknown[];
}

/** R6-C1: `buildUnitCosts` over `liveCostPurchases()` and the live stock items (margin chip, insights tile). */
export function liveUnitCosts(vendors: readonly unknown[] = peekTable('vendors')): Map<string, UnitCost> {
  return buildUnitCosts(liveCostPurchases(), peekTable<StockItemLike>('stock_items'), vendors);
}

export interface MarginResult {
  /** Taxable value of the lines that have a cost. */
  revenue: number;
  cost: number;
  margin: number;
  /** Percent of revenue (null when nothing is costed). */
  pct: number | null;
  costed: number;
  uncosted: number;
}

type Line = Pick<InvoiceItem, 'name' | 'quantity' | 'rate'> & Partial<Pick<InvoiceItem, 'discount_percent' | 'unit_factor' | 'free_of'>>;

/**
 * Gross margin of the document's lines against `costs`. Revenue per line = qty × rate less the line
 * discount (pre-tax, before the bill-level discount — a quick indicator, not a P&L). Free scheme lines
 * add cost with no revenue.
 */
export function documentMargin(lines: readonly Line[], costs: ReadonlyMap<string, UnitCost>, billDiscount = 0): MarginResult {
  let revenue = 0;
  let cost = 0;
  let costed = 0;
  let uncosted = 0;
  for (const l of lines) {
    const name = norm(l.name);
    const qty = num(l.quantity);
    if (!name || !qty) continue;
    const c = costs.get(name);
    if (!c) {
      uncosted++;
      continue;
    }
    costed++;
    const f = num(l.unit_factor) > 0 ? num(l.unit_factor) : 1;
    const gross = qty * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100);
    revenue += l.free_of ? 0 : gross;
    cost += qty * f * c.cost;
  }
  revenue = round2(Math.max(revenue - Math.max(billDiscount, 0), 0));
  cost = round2(cost);
  const margin = round2(revenue - cost);
  return { revenue, cost, margin, pct: costed && revenue > 0 ? round2((margin / revenue) * 100) : null, costed, uncosted };
}

/** Tone for the chip: below 0 = loss, below `low` % = thin. */
export function marginTone(pct: number | null, low = 10): 'loss' | 'thin' | 'ok' | 'none' {
  if (pct === null) return 'none';
  if (pct < 0) return 'loss';
  return pct < low ? 'thin' : 'ok';
}
