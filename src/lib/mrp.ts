/**
 * Production plan and material requirement planning (7S, roadmap 7.37) — "what must I buy or make to produce
 * this plan?".
 *
 * For a planned quantity of one or more finished items the default BOMs are exploded level by level
 * (multi-level: a sub-assembly with its own BOM is made, not bought). Every item is netted once, at its lowest
 * level in the BOM tree (low-level code), so the demand of every parent is summed before its stock is used:
 *
 *   gross     = planned quantity (finished items) + Σ parents' net make quantity × component per unit × (1 + scrap %)
 *   available = closing stock (never below zero) + quantity still to receive on purchase orders / GRNs
 *   net       = max(0, gross − available)
 *   make      = net, for an item with a BOM (its components are exploded for `net`)
 *   buy       = max(net, minimum order quantity), for an item without one
 *
 * Suggestions only: "Create purchase order" writes a PO through `purchaseOrdersDb`, "Manufacture" opens a
 * Manufacturing Journal for the item. Plans are stored in `production_plans` (`PP/FY…`, series counters, period
 * lock, roles, audit); nothing here moves stock or posts to the books.
 *
 * Pure above the "Storage" divider.
 */
import type { Bom, ProductionPlan, ProductionPlanLine } from '../types/manufacturing';
import type { PurchaseOrderLine } from '../types/purchases';
import type { StockItem, StockPosition } from './inventory';
import { num, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';

export const PLANS_TABLE = 'production_plans';
export const PLAN_PREFIX = 'PP';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
/** Deepest BOM nesting followed (a guard: validateBom already refuses cycles). */
const MAX_DEPTH = 25;

/** The default BOM of each item (the one marked default, else the first by name). */
export function defaultBomMap(boms: readonly Bom[]): Map<string, Bom> {
  const out = new Map<string, Bom>();
  const sorted = [...boms].sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.name.localeCompare(b.name));
  for (const b of sorted) if (b.item_id && !out.has(b.item_id)) out.set(b.item_id, b);
  return out;
}

/** Lowest level each item reaches below the planned items (0 = planned), following default BOMs. */
export function lowLevelCodes(planned: readonly string[], bomOf: ReadonlyMap<string, Bom>): Map<string, number> {
  const level = new Map<string, number>();
  const visit = (id: string, depth: number, path: Set<string>) => {
    if (depth > MAX_DEPTH || path.has(id)) return;
    if ((level.get(id) ?? -1) >= depth) return;
    level.set(id, depth);
    const bom = bomOf.get(id);
    if (!bom) return;
    path.add(id);
    for (const c of bom.components ?? []) if (c.item_id && num(c.qty) > 0) visit(c.item_id, depth + 1, path);
    path.delete(id);
  };
  for (const id of planned) visit(id, 0, new Set());
  return level;
}

export interface MrpRow {
  item: StockItem;
  /** Low-level code (0 = a planned finished item). */
  level: number;
  gross: number;
  /** Closing stock used (never below zero). */
  stock: number;
  /** Still to receive on purchase orders / GRNs. */
  onOrder: number;
  net: number;
  action: 'make' | 'buy' | 'none';
  /** Quantity to make / order (buy: raised to the minimum order quantity). */
  suggested: number;
  bomId?: string;
  /** Last purchase rate (else average / opening cost), for a purchase order. */
  rate: number;
  vendor?: string;
  /** Items whose make quantity creates this demand ("Plan" for a planned item). */
  for: string[];
}

export interface MrpInput {
  plan: readonly Pick<ProductionPlanLine, 'item_id' | 'qty'>[];
  items: readonly StockItem[];
  boms: readonly Bom[];
  /** Closing stock per item id (base units). */
  stock: ReadonlyMap<string, number>;
  /** Pending purchase-order / GRN quantity per item id (base units, `pendingPoQty`). */
  onOrder?: ReadonlyMap<string, number>;
  /** Last purchase rate / vendor per item id. */
  rates?: ReadonlyMap<string, { rate: number; vendor?: string }>;
  /** Net the planned finished items against their own stock too (default true). */
  netFinished?: boolean;
}

/** Material requirement for a plan (see the module comment). Rows ordered by level, then name. */
export function runMrp(x: MrpInput): MrpRow[] {
  const byId = new Map(x.items.map((i) => [i.id, i]));
  const bomOf = defaultBomMap(x.boms);
  const planned = x.plan.filter((l) => l.item_id && num(l.qty) > 0 && byId.has(l.item_id));
  const levels = lowLevelCodes(planned.map((l) => l.item_id), bomOf);
  const gross = new Map<string, number>();
  const parents = new Map<string, Set<string>>();
  const plannedIds = new Set<string>();
  for (const l of planned) {
    gross.set(l.item_id, roundQty((gross.get(l.item_id) ?? 0) + num(l.qty)));
    plannedIds.add(l.item_id);
    parents.set(l.item_id, new Set(['Plan']));
  }
  const order = [...levels.entries()].sort((a, b) => a[1] - b[1] || (byId.get(a[0])?.name ?? '').localeCompare(byId.get(b[0])?.name ?? ''));
  const rows: MrpRow[] = [];
  for (const [id, level] of order) {
    const item = byId.get(id);
    if (!item) continue;
    const g = roundQty(gross.get(id) ?? 0);
    const skipStock = plannedIds.has(id) && level === 0 && x.netFinished === false;
    const stock = skipStock || !item.track_stock ? 0 : roundQty(Math.max(x.stock.get(id) ?? 0, 0));
    const bom = bomOf.get(id);
    const onOrder = skipStock ? 0 : roundQty(Math.max(x.onOrder?.get(id) ?? 0, 0));
    const net = roundQty(Math.max(0, g - stock - onOrder));
    let suggested = 0;
    let action: MrpRow['action'] = 'none';
    if (net > EPS && bom) {
      action = 'make';
      suggested = net;
      const per = net / (num(bom.batch_qty) > 0 ? num(bom.batch_qty) : 1);
      for (const c of bom.components ?? []) {
        if (!c.item_id || !(num(c.qty) > 0) || !levels.has(c.item_id)) continue;
        const need = roundQty(num(c.qty) * per * (1 + Math.max(num(c.scrap_pct), 0) / 100));
        gross.set(c.item_id, roundQty((gross.get(c.item_id) ?? 0) + need));
        const set = parents.get(c.item_id) ?? new Set<string>();
        set.add(item.name);
        parents.set(c.item_id, set);
      }
    } else if (net > EPS) {
      action = 'buy';
      suggested = roundQty(Math.max(net, Math.max(num(item.min_order_qty), 0)));
    }
    const r = x.rates?.get(id);
    rows.push({
      item, level, gross: g, stock, onOrder, net, action, suggested, ...(bom ? { bomId: bom.id } : {}),
      rate: round2(r?.rate ?? num(item.opening_rate)), ...(r?.vendor ? { vendor: r.vendor } : {}),
      for: [...(parents.get(id) ?? [])],
    });
  }
  // Items reached only through a parent that needs no making carry zero demand: keep them out of the list.
  return rows.filter((r) => r.gross > EPS || r.level === 0);
}

/** Purchase-order lines for the "buy" rows (one per item). */
export function poLinesFromMrp(rows: readonly MrpRow[], newId: () => string = generateId): PurchaseOrderLine[] {
  return rows.filter((r) => r.action === 'buy' && r.suggested > EPS).map((r) => ({
    id: newId(), name: r.item.name, ...(r.item.hsn ? { hsn: r.item.hsn } : {}), unit: r.item.unit, item_id: r.item.id,
    quantity: r.suggested, rate: r.rate, tax_rate: num(r.item.tax_rate),
  }));
}

/** Last purchase rate and vendor per item from the stock ledger (else average / opening cost). */
export function lastPurchaseRates(positions: readonly StockPosition[]): Map<string, { rate: number; vendor?: string }> {
  const out = new Map<string, { rate: number; vendor?: string }>();
  for (const p of positions) {
    let found: { rate: number; vendor?: string } | undefined;
    for (let i = p.ledger.length - 1; i >= 0 && !found; i--) {
      const r = p.ledger[i];
      if (r.kind === 'purchase' && r.rate > 0) found = { rate: r.rate, vendor: r.party || undefined };
    }
    out.set(p.item.id, found ?? { rate: p.avgCost > 0 ? p.avgCost : num(p.item.opening_rate) });
  }
  return out;
}

/** Shape checks for a plan; '' when fine. */
export function validatePlan(p: Pick<ProductionPlan, 'date' | 'lines'>, items: readonly StockItem[]): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '')) return 'Choose the plan date.';
  const lines = (p.lines ?? []).filter((l) => l.item_id);
  if (!lines.length) return 'Add at least one item to produce.';
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of lines) {
    const it = byId.get(l.item_id);
    if (!it) return 'A plan line points at a deleted stock item.';
    if (!(num(l.qty) > 0)) return `${it.name}: the planned quantity must be above zero.`;
  }
  return '';
}

/* ================================================================
   Storage
   ================================================================ */

const now = () => new Date().toISOString();
const lockOf = (r: { id: string; date: string; number: string }) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });

export const productionPlansDb = {
  all: (): ProductionPlan[] => getTable<ProductionPlan>(PLANS_TABLE),
  nextNumber: (date?: string) => nextSeriesNumberFor(PLAN_PREFIX, date, productionPlansDb.all().map((r) => r.number)),

  /** Insert or update (books.edit, period lock on the plan date, audited). */
  save(input: Omit<ProductionPlan, 'id' | 'number'> & { id?: string; number?: string }, items: readonly StockItem[]): ProductionPlan {
    requireAccess('books.edit');
    const err = validatePlan(input, items);
    if (err) throw new Error(err);
    const rows = productionPlansDb.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (existing) assertUnlocked(lockOf(existing), 'edit');
    const kept = (input.number ?? '').trim() || existing?.number || '';
    const number = kept && numberFitsFy(kept, input.date) ? kept : nextSeriesNumberFor(PLAN_PREFIX, input.date, rows.map((r) => r.number));
    const id = existing?.id ?? input.id ?? generateId();
    const state = assertUnlocked(lockOf({ id, date: input.date, number }), existing ? 'edit' : 'create');
    if (rows.some((r) => r.id !== id && r.number.toUpperCase() === number.toUpperCase())) throw new Error(`Plan number ${number} is already used.`);
    const record: ProductionPlan = {
      ...existing, ...input, id, number,
      lines: input.lines.filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ id: l.id, item_id: l.item_id, qty: num(l.qty) })),
      created_at: existing?.created_at ?? now(), updated_at: now(),
    };
    setTable(PLANS_TABLE, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
    recordSeries(number);
    const names = record.lines.map((l) => `${l.qty} × ${items.find((i) => i.id === l.item_id)?.name ?? '?'}`).join(', ');
    audit.record({
      entity: 'manufacturing', entity_id: id, action: existing ? 'update' : 'create', doc_number: number,
      summary: `${existing ? 'Edited' : 'Created'} production plan ${number}: ${names}${state === 'overridden' ? ' (period lock overridden)' : ''}`,
    });
    return record;
  },

  remove(id: string): void {
    requireAccess('books.edit');
    const rows = productionPlansDb.all();
    const r = rows.find((x) => x.id === id);
    if (!r) return;
    const state = assertUnlocked(lockOf(r), 'delete');
    setTable(PLANS_TABLE, rows.filter((x) => x.id !== id));
    audit.record({ entity: 'manufacturing', entity_id: id, action: 'delete', doc_number: r.number, summary: `Deleted production plan ${r.number}${state === 'overridden' ? ' (period lock overridden)' : ''}` });
  },
};
