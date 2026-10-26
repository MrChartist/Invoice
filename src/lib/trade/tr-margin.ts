/**
 * TR-A1 minimum margin: stock groups (inherited down the tree) or the company default (`trade_min_margin`) set a
 * floor. The editor's margin chip marks lines below it; with credit policy Block a clerk's document with such a line
 * is held for the owner (approval reason `margin`) and the owner's save is an audited override — through
 * `registerMarginCheck` in credit-policy.ts, registered when this module loads (editor, trade discounts on).
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { num } from '../invoice-calc';
import { peekTable } from '../storage';
import type { StockTreeNode } from '../stock-groups';
import { liveUnitCosts, type UnitCost } from '../margin';
import { registerMarginCheck } from '../credit-policy';
import { localDb } from '../localDb';

/** Item name (folded) → minimum margin %, from its stock group (nearest up the tree) or the company default. */
export function minMarginIndex(items: readonly { name: string; group_id?: string }[], groups: readonly StockTreeNode[], fallback?: number): (name: string) => number | undefined {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const ofGroup = (id?: string): number | undefined => {
    for (let g = id ? byId.get(id) : undefined, n = 0; g && n < 50; g = g.parent_id ? byId.get(g.parent_id) : undefined, n++) {
      if (num(g.min_margin_percent) > 0) return num(g.min_margin_percent);
    }
    return undefined;
  };
  const map = new Map(items.map((i) => [i.name.trim().toLowerCase(), ofGroup(i.group_id)]));
  const def = num(fallback) > 0 ? num(fallback) : undefined;
  return (name) => map.get(name.trim().toLowerCase()) ?? def;
}

export interface MarginShort {
  id: string;
  name: string;
  pct: number;
  min: number;
}

/** Costed, priced lines whose margin % (net of the line discount) is below their minimum. */
export function marginShortfalls(lines: readonly InvoiceItem[], costs: ReadonlyMap<string, UnitCost>, minFor: (name: string) => number | undefined): MarginShort[] {
  const out: MarginShort[] = [];
  for (const l of lines) {
    const k = String(l.name ?? '').trim().toLowerCase();
    const c = costs.get(k);
    const min = minFor(k);
    const rev = num(l.quantity) * num(l.rate) * (1 - Math.min(num(l.discount_percent), 100) / 100);
    if (!c || min === undefined || l.free_of || !(rev > 0)) continue;
    const pct = Math.round(((rev - num(l.quantity) * (num(l.unit_factor) || 1) * c.cost) / rev) * 10000) / 100;
    if (pct < min) out.push({ id: l.id, name: l.name, pct, min });
  }
  return out;
}

/** Live index for the editor and the gate. */
export function liveMinMargin(): (name: string) => number | undefined {
  return minMarginIndex(peekTable<{ name: string; group_id?: string }>('stock_items'), peekTable<StockTreeNode>('stock_groups'), localDb.settings.get().trade_min_margin);
}

/** The gate's check: '' or the reason a clerk's document is held. */
export function marginReason(doc: Pick<InvoiceRecord, 'items'>): string {
  const minFor = liveMinMargin();
  if (!(doc.items ?? []).some((l) => minFor(String(l.name ?? '')) !== undefined)) return '';
  const low = marginShortfalls(doc.items ?? [], liveUnitCosts(), minFor);
  return low.length ? `Below the minimum margin: ${low.map((l) => `${l.name} ${l.pct}% (min ${l.min}%)`).join(', ')}` : '';
}

registerMarginCheck(marginReason);
