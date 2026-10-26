/**
 * TR-A2 scheme scope v2: a scheme with `scope` counts the paid quantity across every qualifying line of the bill
 * (a stock group with its sub-groups, listed items, a brand = stock category name or a word of the item name), for
 * listed parties / price levels only. The free goods are one ₹0 line (the scheme's free item, or for a same-item
 * scheme the cheapest qualifying item) under the first qualifying line; GST as for any scheme (Circular 92/11/2019).
 * Schemes without `scope` keep the single-item behaviour of `pricing.ts`. Pure.
 */
import type { InvoiceItem } from '../../types/invoice';
import { num } from '../invoice-calc';
import { freeQty, schemeActive, schemeLabel, type Scheme } from '../pricing';
import { KEYS, peekTable } from '../storage';

export interface ScopeItem {
  ids: string[];
  group_id?: string;
  /** Stock category name. */
  category?: string;
}
export interface ScopeCtx {
  clientId?: string;
  levelId?: string;
  /** Item facts by line name. */
  item: (name: string) => ScopeItem | undefined;
  /** Group id → parent id. */
  parents: ReadonlyMap<string, string | undefined>;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

function underGroup(id: string | undefined, groups: readonly string[], parents: ScopeCtx['parents']): boolean {
  for (let g = id, n = 0; g && n < 50; g = parents.get(g), n++) if (groups.includes(g)) return true;
  return false;
}

/** The party may use the scheme (no client / level list = everyone). */
export function partyInScope(s: Pick<Scheme, 'scope'>, ctx: Pick<ScopeCtx, 'clientId' | 'levelId'>): boolean {
  const sc = s.scope;
  if (!sc) return true;
  const clients = sc.client_ids ?? [];
  const levels = sc.level_ids ?? [];
  if (!clients.length && !levels.length) return true;
  return (!!ctx.clientId && clients.includes(ctx.clientId)) || (!!ctx.levelId && levels.includes(ctx.levelId));
}

/** A line qualifies for a scoped scheme (any of group / items / brand; the scheme's own item counts too). */
export function lineInScope(s: Scheme, line: Pick<InvoiceItem, 'name'>, ctx: ScopeCtx): boolean {
  const sc = s.scope ?? {};
  const info = ctx.item(line.name);
  if (norm(s.item_name) && norm(s.item_name) === norm(line.name)) return true;
  if (info && (s.item_id && info.ids.includes(s.item_id))) return true;
  if (info && sc.item_ids?.some((id) => info.ids.includes(id))) return true;
  if (sc.group_ids?.length && underGroup(info?.group_id, sc.group_ids, ctx.parents)) return true;
  const b = norm(sc.brand);
  return !!b && (norm(info?.category) === b || norm(line.name).split(/[^a-z0-9]+/).includes(b));
}

/** Free quantity of a scheme for `qty`: the best free slab reached, else free_qty per full buy_qty. */
export function schemeFree(s: Scheme, qty: number): number {
  const slabs = (s.free_slabs ?? []).filter((x) => num(x.min_qty) > 0 && num(x.free_qty) > 0 && qty >= num(x.min_qty));
  if (s.free_slabs?.length) return slabs.reduce((m, x) => (num(x.min_qty) > m.min ? { min: num(x.min_qty), free: num(x.free_qty) } : m), { min: 0, free: 0 }).free;
  return freeQty(s, qty);
}

/**
 * Add / refresh the free lines of every running scoped scheme. `items` already went through the single-item pass;
 * `before` (the lines as they were) gives a scoped free line its old id back.
 */
export function applyScopedSchemes(items: readonly InvoiceItem[], before: readonly InvoiceItem[], schemes: readonly Scheme[], day: string, ctx: ScopeCtx, newId: () => string, catalog: readonly InvoiceItem[]): InvoiceItem[] {
  let out = items.filter((i) => !(i.free_of && schemes.some((s) => s.scope && s.id === i.scheme_id)));
  for (const s of schemes) {
    if (!s.scope || s.kind === 'bill_value' || !schemeActive(s, day) || !partyInScope(s, ctx)) continue;
    const paid = out.filter((l) => !l.free_of && l.name.trim() && lineInScope(s, l, ctx));
    const want = schemeFree(s, paid.reduce((t, l) => t + num(l.quantity), 0));
    const anchor = paid.find((l) => !out.some((f) => f.free_of === l.id));
    if (!anchor || !(want > 0)) continue;
    const cheapest = paid.reduce((a, b) => (num(b.rate) < num(a.rate) ? b : a));
    const src = s.kind === 'buy_get' ? (s.free_item_id && catalog.find((c) => c.id === s.free_item_id)) || catalog.find((c) => norm(c.name) === norm(s.free_item_name)) || { ...cheapest, name: s.free_item_name || cheapest.name } : cheapest;
    const old = before.find((f) => f.free_of && f.scheme_id === s.id);
    const free: InvoiceItem = {
      id: old?.id ?? newId(),
      name: src.name,
      description: `Free under scheme: ${schemeLabel(s)}`,
      type: src.type ?? anchor.type,
      hsn: src.hsn,
      unit: src.unit,
      quantity: want,
      rate: 0,
      tax_rate: src.tax_rate,
      discount_percent: 0,
      amount: 0,
      scheme_id: s.id,
      free_of: anchor.id,
      ...(anchor.godown_id ? { godown_id: anchor.godown_id } : {}),
    };
    const at = out.indexOf(anchor) + 1;
    out = [...out.slice(0, at), free, ...out.slice(at)];
  }
  return out;
}

/** The item facts and group tree of a scope check, from the live tables (read-only views). */
export function liveScopeItems(catalog: readonly InvoiceItem[] = peekTable<InvoiceItem>(KEYS.items)): Pick<ScopeCtx, 'item' | 'parents'> {
  const cats = new Map(peekTable<{ id: string; name: string }>('stock_categories').map((c) => [c.id, c.name]));
  const items = new Map(peekTable<{ id: string; name: string; group_id?: string; category_id?: string }>('stock_items').map((i) => [norm(i.name), i]));
  const byName = new Map(catalog.map((c) => [norm(c.name), c]));
  return {
    parents: new Map(peekTable<{ id: string; parent_id?: string }>('stock_groups').map((g) => [g.id, g.parent_id])),
    item: (name) => {
      const i = items.get(norm(name));
      const c = byName.get(norm(name));
      return i || c ? { ids: [i?.id, c?.id].filter((x): x is string => !!x), group_id: i?.group_id, category: i?.category_id ? cats.get(i.category_id) : undefined } : undefined;
    },
  };
}

/** A sale line counts for a scheme: in its scope, or (no scope) the scheme's own item. */
export const lineForScheme = (s: Scheme, line: Pick<InvoiceItem, 'name'>, ctx: ScopeCtx) => (s.scope ? lineInScope(s, line, ctx) : norm(s.item_name) === norm(line.name));
