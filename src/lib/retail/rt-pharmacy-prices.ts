/**
 * RT-B3 ceiling price, loose units and margins (docs/prd/round-9.md §4 RT-B3).
 *
 *  - Ceiling prices (stock item `ceiling_prices`: `{from, price_per_unit, unit?}` ex-GST, dated, append-only — typed or
 *    pasted as CSV from the NPPA order; no network, RT8). A ceiling typed per an alternate unit (per STRIP) is compared
 *    per base unit. `ceilingIssues` warns when the MRP per base unit (the app's MRP convention: `PurchaseLine.mrp` and the
 *    catalogue MRP are per base unit, RT-A2) is above ceiling × (1 + GST %) on the date (bill modal, POS). Warn only.
 *  - Loose units: an item with an alternate unit (STRIP = 10 TAB) prices one TAB from the strip MRP when no base rate is
 *    set — strip MRP ÷ 10, less the item's `mrp_less_percent` (`looseRate`, `applyLoosePrice`). The catalogue keeps MRP
 *    and rate per TAB, so the counter's unit picker sells "4 TAB" or "1 STRIP" (`lineFactor`) and the MRP guard agrees.
 *  - Margin view: PTR (net rate of the last bill, per base unit), PTS (typed), MRP, selling rate, margin % on PTR and on
 *    the cost after free goods, the scheme received ("10 + 1", RT-A4). Read through the purchases contract. CSV.
 *
 * Working papers — verify with your CA. Pure above "Storage".
 */
import type { InvoiceItem } from '../../types/invoice';
import type { StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { cleanAltUnits, factorFor } from '../units';
import { requireAccess } from '../access';
import { getTable, setTable } from '../storage';

type Ceiling = NonNullable<StockItem['ceiling_prices']>[number];
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ── Pure: ceiling ── */

/** The ceiling (ex-GST) in force on `day`, or undefined. */
export function ceilingAt(list: readonly Ceiling[] | undefined, day: string): Ceiling | undefined {
  let hit: Ceiling | undefined;
  for (const c of list ?? []) if (isDay(c.from) && c.from <= day && num(c.price_per_unit) > 0 && (!hit || c.from >= hit.from)) hit = c;
  return hit;
}

/** Append a dated ceiling (append-only: a second row with the same date is refused). */
export function addCeiling(list: readonly Ceiling[] | undefined, row: Ceiling): Ceiling[] {
  if (!isDay(row.from)) throw new Error('Choose the date of the price order.');
  if (!(num(row.price_per_unit) > 0)) throw new Error('Type the ceiling price per unit (ex-GST).');
  if ((list ?? []).some((c) => c.from === row.from)) throw new Error(`A ceiling from ${row.from} is already recorded (rows are never edited — add a new date).`);
  return [...(list ?? []), { from: row.from, price_per_unit: round2(num(row.price_per_unit)), ...(row.unit?.trim() ? { unit: row.unit.trim() } : {}) }].sort((a, b) => a.from.localeCompare(b.from));
}

export interface CeilingIssue { name: string; mrp: number; limit: number; ceiling: number; from: string }

/** The ceiling of `c` per base unit of `item` (a ceiling typed per STRIP of 10 → ÷ 10; an unknown unit is taken as base). */
export function ceilingPerBase(c: Pick<Ceiling, 'price_per_unit' | 'unit'>, item: Pick<StockItem, 'unit' | 'alt_units'>): number {
  const f = c.unit ? (factorFor(item, c.unit) ?? 1) : 1;
  return num(c.price_per_unit) / (f > 0 ? f : 1);
}

/**
 * Lines whose MRP per base unit is above ceiling × (1 + GST %) on `day` (bill lines and sale lines both carry the MRP per
 * base unit). Lines with no MRP, and items with no ceiling in force, are not checked.
 */
export function ceilingIssues(
  lines: readonly { name: string; mrp?: number; tax_rate?: number; item_id?: string }[],
  items: readonly Pick<StockItem, 'id' | 'name' | 'unit' | 'alt_units' | 'ceiling_prices'>[],
  day: string,
): CeilingIssue[] {
  const out: CeilingIssue[] = [];
  for (const l of lines) {
    if (!(num(l.mrp) > 0)) continue;
    const it = (l.item_id && items.find((i) => i.id === l.item_id)) || items.find((i) => norm(i.name) === norm(l.name));
    const c = it ? ceilingAt(it.ceiling_prices, day) : undefined;
    if (!it || !c) continue;
    const per = ceilingPerBase(c, it);
    const limit = round2(per * (1 + Math.max(num(l.tax_rate), 0) / 100));
    if (num(l.mrp) > limit + 0.005 && !out.some((o) => o.name === l.name)) out.push({ name: l.name, mrp: round2(num(l.mrp)), limit, ceiling: round2(per), from: c.from });
  }
  return out;
}

/** CSV rows "item, ceiling, unit, date" (header optional; dates YYYY-MM-DD or DD-MM-YYYY). */
export function parseCeilingCsv(text: string): { name: string; row: Ceiling }[] {
  const out: { name: string; row: Ceiling }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2 || !cells[0]) continue;
    const price = Number(cells[1]);
    if (!(price > 0)) continue; // header / junk
    const d = cells[3] ?? '';
    const m = /^(\d{2})[-/.](\d{2})[-/.](\d{4})$/.exec(d);
    const from = m ? `${m[3]}-${m[2]}-${m[1]}` : d;
    if (!isDay(from)) continue;
    out.push({ name: cells[0], row: { from, price_per_unit: price, ...(cells[2] ? { unit: cells[2] } : {}) } });
  }
  return out;
}

/* ── Pure: loose units ── */

/** The pack the MRP is printed for: the item's largest alternate unit (STRIP = 10 TAB → 10), or undefined. */
export function loosePack(item: Pick<StockItem, 'unit' | 'alt_units'>): { unit: string; factor: number } | undefined {
  const alts = (cleanAltUnits(item.alt_units, item.unit || 'NOS') ?? []).filter((a) => a.factor > 1);
  return alts.reduce<{ unit: string; factor: number } | undefined>((best, a) => (!best || a.factor > best.factor ? a : best), undefined);
}

/** Rate of one base unit from the pack's MRP: strip MRP ÷ factor, less `lessPercent` (₹62 strip of 10 → ₹6.20 a tablet). */
export function looseRate(packMrp: number, factor: number, lessPercent = 0): number {
  if (!(num(packMrp) > 0) || !(num(factor) > 0)) return 0;
  const pct = num(lessPercent);
  return round2((num(packMrp) / num(factor)) * (pct > 0 && pct < 100 ? 1 - pct / 100 : 1));
}

/* ── Pure: margins ── */

export interface MarginRow {
  item: string;
  batch: string;
  /** Net purchase rate per base unit (price to retailer, after the line discount). */
  ptr: number;
  /** Cost per base unit after free goods. */
  cost: number;
  pts?: number;
  mrp: number;
  sell: number;
  /** Margin % on PTR, and on the cost after free goods (null without a selling rate). */
  margin: number | null;
  marginNet: number | null;
  scheme: string;
  bill: string;
}

const pctOn = (sell: number, cost: number) => (cost > 0 && sell > 0 ? round2(((sell - cost) / cost) * 100) : null);

/**
 * One row per item and batch, from its latest bill: PTR = net purchase rate per base unit, cost = PTR spread over paid +
 * free, MRP per base unit (the batch's, else the catalogue's), selling rate per base unit ex-GST from the catalogue (its
 * rate, else MRP less %), margins on PTR and on the cost after free goods.
 */
export function marginRows(purchases: readonly unknown[], items: readonly Pick<StockItem, 'id' | 'name' | 'pts'>[], catalog: readonly Pick<InvoiceItem, 'name' | 'rate' | 'mrp' | 'mrp_less_percent'>[]): MarginRow[] {
  const last = new Map<string, { date: string; row: MarginRow }>();
  for (const raw of purchases) {
    const b = readPurchase(raw);
    if (!b || b.isExpense || isVoidStatus(b.status)) continue;
    for (const l of readPurchaseLines(raw)) {
      const it = (l.itemId && items.find((i) => i.id === l.itemId)) || items.find((i) => norm(i.name) === norm(l.name));
      if (!it || !(l.paidQty > 0)) continue;
      const key = `${it.id}|${l.batchNo.toUpperCase()}`;
      const prev = last.get(key);
      if (prev && prev.date > b.date) continue;
      const cat = catalog.find((c) => norm(c.name) === norm(it.name));
      const f = l.unitFactor || 1;
      const sell = cat ? (num(cat.rate) > 0 ? num(cat.rate) : num(cat.mrp) * (1 - Math.min(Math.max(num(cat.mrp_less_percent), 0), 99) / 100)) : 0;
      const ptr = l.netRate / f;
      const cost = l.unitCost / f;
      last.set(key, {
        date: b.date,
        row: {
          item: it.name, batch: l.batchNo, ptr: round2(ptr), cost: round2(cost), ...(num(it.pts) > 0 ? { pts: num(it.pts) } : {}),
          mrp: round2(l.mrp || num(cat?.mrp)), sell: round2(sell), margin: pctOn(sell, ptr), marginNet: pctOn(sell, cost),
          scheme: l.freeQty > 0 ? `${l.paidQty} + ${l.freeQty}` : '', bill: `${b.partyName} ${b.number}`.trim(),
        },
      });
    }
  }
  return [...last.values()].map((x) => x.row).sort((a, b) => a.item.localeCompare(b.item) || a.batch.localeCompare(b.batch));
}

export function marginCsv(rows: readonly MarginRow[]): string {
  return toCsv([
    ['Margins on purchase rate (PTR) — working paper, verify with your CA'],
    ['Item', 'Batch', 'PTR', 'Cost after free', 'PTS', 'MRP', 'Selling rate', 'Margin % on PTR', 'Margin % after free', 'Scheme', 'Last bill'],
    ...rows.map((r) => [r.item, r.batch, r.ptr, r.cost, r.pts ?? '', r.mrp, r.sell, r.margin ?? '', r.marginNet ?? '', r.scheme, r.bill]),
  ]);
}

/* ── Storage ── */

const STOCK = 'stock_items';
const CATALOG = 'items_catalog';

/** Master editor: patch pharmacy fields of a stock item (ceilings stay append-only through `addCeiling`). */
export function patchStockItem(id: string, patch: Partial<Pick<StockItem, 'ceiling_prices' | 'narcotic' | 'pts'>>): void {
  requireAccess('master.edit');
  const all = getTable<StockItem>(STOCK);
  if (!all.some((i) => i?.id === id)) throw new Error('Stock item not found.');
  setTable(STOCK, all.map((i) => {
    if (i?.id !== id) return i;
    const next: StockItem = { ...i, ...patch };
    if (!next.narcotic) delete next.narcotic;
    if (!(num(next.pts) > 0)) delete next.pts;
    if (!next.ceiling_prices?.length) delete next.ceiling_prices;
    return next;
  }));
}

/** Append ceilings read from CSV to the stock items named in it; returns how many were added and the names not found. */
export function importCeilings(rows: readonly { name: string; row: Ceiling }[]): { added: number; missing: string[] } {
  requireAccess('master.edit');
  const next = getTable<StockItem>(STOCK).map((i) => ({ ...i }));
  const missing: string[] = [];
  let added = 0;
  for (const r of rows) {
    const it = next.find((i) => norm(i?.name) === norm(r.name));
    if (!it) {
      missing.push(r.name);
      continue;
    }
    if ((it.ceiling_prices ?? []).some((c) => c.from === r.row.from)) continue;
    it.ceiling_prices = addCeiling(it.ceiling_prices, r.row);
    added += 1;
  }
  if (added) setTable(STOCK, next);
  return { added, missing };
}

/**
 * Loose sale from the strip MRP: the catalogue row named like the stock item gets MRP per base unit = pack MRP ÷ factor
 * and, when it has no rate yet (or is priced as MRP less %), the loose rate; the stock item's sale rate likewise when it
 * has none. Returns the rate per base unit now in the catalogue.
 */
export function applyLoosePrice(stockItemId: string, packMrp: number): number {
  requireAccess('master.edit');
  const items = getTable<StockItem>(STOCK);
  const it = items.find((i) => i?.id === stockItemId);
  if (!it) throw new Error('Stock item not found.');
  const pack = loosePack(it);
  if (!pack) throw new Error(`${it.name} has no larger unit (for example STRIP = 10 ${it.unit || 'TAB'}). Add it in the item's alternate units first.`);
  if (!(num(packMrp) > 0)) throw new Error('Type the MRP printed on the strip.');
  const catalog = getTable<InvoiceItem>(CATALOG);
  const cat = catalog.find((c) => norm(c?.name) === norm(it.name));
  if (!cat) throw new Error(`${it.name} is not in the item list (catalogue) — add it there first.`);
  const rate = looseRate(packMrp, pack.factor, cat.mrp_less_percent);
  const setRate = !(num(cat.rate) > 0) || num(cat.mrp_less_percent) > 0;
  setTable(CATALOG, catalog.map((c) => (c === cat ? { ...c, mrp: round2(num(packMrp) / pack.factor), ...(setRate ? { rate } : {}) } : c)));
  if (!(num(it.sale_rate) > 0)) setTable(STOCK, items.map((i) => (i === it ? { ...i, sale_rate: setRate ? rate : num(cat.rate) } : i)));
  return setRate ? rate : num(cat.rate);
}
