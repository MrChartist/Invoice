/**
 * MF-D5 / D6 Schedule III inventories split (view `inventories`, pack `shopfloor`; also the `inventoryNote` rows of the
 * annual-accounts pack through one optional argument):
 *  - each stock item has a class `StockItem.mf_inv_class` — raw, wip, finished, traded, stores, packing, tools, scrap —
 *    else a default from its BOM role: a BOM's scrap output → scrap; an item made by a BOM → finished; a BOM component
 *    only → raw; anything else → traded (R9 / R12 shops keep "traded");
 *  - each item is valued exactly as the report-time valuer does (`inventoryValuer` over the engine's positions: the last
 *    running value on or before the day, negative counted as nil), so the split sums to the valuation Books, the
 *    Gateway and ratios use (`loadStockValuer`);
 *  - stock sitting in a WIP godown (kind `wip`) on the day is moved to "Work-in-progress" at the item's average value;
 *  - a memo conversion (D5, open job cards) is shown in the working only — it is not in the stock engine or the note;
 *  - the year-end WIP statement: open production orders, materials issued, output reported, WIP materials and memo
 *    conversion.
 * Amounts in integer PAISE (the notes' unit). Pure. Working paper — verify MF25 (sub-heads) with your CA.
 */
import { ruleAt } from '../tax-rules';
import { INVENTORY_HEADS, type InvClass } from './mf-d-rules';

export type { InvClass };
export const INV_CLASSES: readonly InvClass[] = ['raw', 'wip', 'finished', 'traded', 'stores', 'packing', 'tools', 'scrap'];

/** Rupees → paise exactly as `closing-stock.ts` rounds it. */
const paise = (r: number) => Math.round((Number.isFinite(r) ? r : 0) * 100);

interface ItemLike {
  id: string;
  name: string;
  track_stock?: boolean;
  mf_inv_class?: string;
}
interface BomLike {
  item_id: string;
  components: readonly { item_id: string }[];
  outputs?: readonly { item_id: string; kind: string }[];
}

/** Default class of every item from the BOMs (`fallback` = 'traded'). */
export function defaultClasses(items: readonly ItemLike[], boms: readonly BomLike[]): Map<string, InvClass> {
  const made = new Set<string>();
  const used = new Set<string>();
  const scrap = new Set<string>();
  for (const b of boms) {
    made.add(b.item_id);
    for (const c of b.components) used.add(c.item_id);
    for (const o of b.outputs ?? []) (o.kind === 'scrap' ? scrap : made).add(o.item_id);
  }
  const out = new Map<string, InvClass>();
  for (const i of items) out.set(i.id, scrap.has(i.id) ? 'scrap' : made.has(i.id) ? 'finished' : used.has(i.id) ? 'raw' : 'traded');
  return out;
}

/** The item's class: its own `mf_inv_class` when valid, else the default. */
export function classOf(item: ItemLike, defaults: ReadonlyMap<string, InvClass>): InvClass {
  const own = item.mf_inv_class as InvClass | undefined;
  return own && INV_CLASSES.includes(own) ? own : defaults.get(item.id) ?? 'traded';
}

/** At least one item carries an explicit class (the note then prints the split). */
export const anyExplicitClass = (items: readonly ItemLike[]) => items.some((i) => !!i.mf_inv_class && INV_CLASSES.includes(i.mf_inv_class as InvClass));

interface PositionLike {
  item: ItemLike;
  ledger: readonly { date: string; value: number; balance: number }[];
}

/** Value (paise, ≥ 0) and quantity of a position at the end of `date` — `inventoryValuer`'s maths. */
export function valueAt(p: PositionLike, date: string): { value: number; qty: number } {
  let hit: { value: number; balance: number } | undefined;
  for (const r of p.ledger) if (r.date <= date) hit = r;
  return { value: Math.max(paise(hit?.value ?? 0), 0), qty: hit?.balance ?? 0 };
}

export interface SplitRow {
  cls: InvClass;
  label: string;
  value: number;
}

export interface InventorySplit {
  rows: SplitRow[];
  /** Σ rows = the valuer's total for the same positions. */
  total: number;
  /** Memo conversion on open orders (working only). */
  memoConversion: number;
}

/**
 * Split on `date`. `wipQty(itemId)` = base units of the item in WIP godowns on that day (0 when unknown); `classes` from
 * `classOf`. Every head of `INVENTORY_HEADS` is returned (zero ones too) in print order.
 */
export function inventorySplit(positions: readonly PositionLike[], date: string, cls: (item: ItemLike) => InvClass, wipQty: (itemId: string) => number = () => 0, memoConversion = 0): InventorySplit {
  const by = new Map<InvClass, number>();
  const add = (c: InvClass, v: number) => by.set(c, (by.get(c) ?? 0) + v);
  for (const p of positions) {
    if (!p.item.track_stock || !p.ledger.length) continue;
    const { value, qty } = valueAt(p, date);
    if (!value) continue;
    const w = qty > 0 ? Math.min(Math.max(wipQty(p.item.id), 0), qty) : 0;
    const wipValue = w > 0 ? Math.round((value * w) / qty) : 0;
    if (wipValue) add('wip', wipValue);
    add(cls(p.item), value - wipValue);
  }
  const heads = ruleAt(INVENTORY_HEADS, date);
  const rows = heads.map((h) => ({ cls: h.cls, label: h.label, value: by.get(h.cls) ?? 0 }));
  return { rows, total: rows.reduce((s, r) => s + r.value, 0), memoConversion: Math.round(memoConversion) };
}

/**
 * The note's rows (label, this year, previous year) — only heads with a value in either year. `bsCur` / `bsPrev` = the
 * balance-sheet Inventories line: a difference (an Inventories ledger balance, typed figures) is shown as its own row so
 * the note still totals to the balance sheet.
 */
export function noteRows(cur: InventorySplit, prev: InventorySplit, bsCur: number, bsPrev: number): { label: string; cur: number; prev: number }[] {
  const rows = cur.rows.map((r, i) => ({ label: r.label, cur: r.value, prev: prev.rows[i]?.value ?? 0 })).filter((r) => r.cur || r.prev);
  const dc = bsCur - cur.total;
  const dp = bsPrev - prev.total;
  if (dc || dp) rows.push({ label: 'Other inventories (ledger balances / typed closing stock)', cur: dc, prev: dp });
  return rows;
}

/* ── Year-end WIP statement ───────────────────────────────────── */

export interface WipOrderRow {
  order_id: string;
  number: string;
  item: string;
  status: string;
  /** Material issued less returned (paise at today's average). */
  issued: number;
  outputQty: number;
  /** Material still on the shop floor for the order (paise). */
  wipMaterial: number;
  /** Memo conversion spent on its open job cards (paise; D5). */
  memoConversion: number;
  total: number;
}

/** One row per released / in-progress order with material on the floor or output pending. */
export function wipStatement(
  orders: readonly { id: string; number: string; item_id: string; status: string }[],
  progress: (orderId: string) => { issued: ReadonlyMap<string, number>; returned: ReadonlyMap<string, number>; held: ReadonlyMap<string, number>; output: number },
  avgPaise: (itemId: string) => number,
  itemName: (itemId: string) => string,
  memoConversion: (orderId: string) => number = () => 0,
): { rows: WipOrderRow[]; total: number } {
  const rows: WipOrderRow[] = [];
  for (const o of orders) {
    if (o.status === 'closed' || o.status === 'cancelled' || o.status === 'planned') continue;
    const p = progress(o.id);
    let issued = 0;
    for (const [id, q] of p.issued) issued += Math.round((q - (p.returned.get(id) ?? 0)) * avgPaise(id));
    let wipMaterial = 0;
    for (const [id, q] of p.held) if (q > 0) wipMaterial += Math.round(q * avgPaise(id));
    const conv = Math.round(memoConversion(o.id));
    if (!wipMaterial && !conv) continue;
    rows.push({ order_id: o.id, number: o.number, item: itemName(o.item_id), status: o.status, issued, outputQty: p.output, wipMaterial, memoConversion: conv, total: wipMaterial + conv });
  }
  return { rows, total: rows.reduce((s, r) => s + r.total, 0) };
}

export function wipSheet(s: { rows: readonly WipOrderRow[]; total: number }, date: string): (string | number)[][] {
  const r = (p: number) => p / 100;
  return [
    [`Year-end WIP statement on ${date} — material at average cost; conversion is a memo (not in stock value unless absorption is on) — verify MF24`],
    ['Order', 'Item', 'Status', 'Material issued ₹', 'Output reported', 'WIP material ₹', 'Memo conversion ₹', 'Total ₹'],
    ...s.rows.map((x) => [x.number, x.item, x.status, r(x.issued), x.outputQty, r(x.wipMaterial), r(x.memoConversion), r(x.total)]),
    ['Total', '', '', '', '', '', '', r(s.total)],
  ];
}
