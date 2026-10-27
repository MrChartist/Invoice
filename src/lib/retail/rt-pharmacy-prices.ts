/**
 * RT-B3 ceiling price, loose units and margins (docs/prd/round-9.md §4 RT-B3).
 *
 *  - Ceiling prices (stock item `ceiling_prices`: `{from, price_per_unit, unit?}` ex-GST, dated, append-only — typed or
 *    pasted as CSV from the NPPA order; no network, RT8). `ceilingIssues` warns when the batch MRP per base unit is above
 *    ceiling × (1 + GST %) on the date (bill modal, POS). It warns, never blocks.
 *  - Loose units: a catalogue row with `mrp_pack` (the strip of 10) sells one base unit at MRP ÷ pack when no rate is set
 *    (the guarded branch in `pricing.ts` `mrpLessRate`); `loosePack` offers the item's largest alternate unit.
 *  - Margin view: PTR (net rate of the last bill), PTS (typed), MRP, selling rate, margin % on the cost after free goods,
 *    the scheme received ("10 + 1"). Read through the purchases contract. Read-only, CSV.
 *
 * Working papers — verify with your CA. Pure above "Storage".
 */
import type { InvoiceItem } from '../../types/invoice';
import type { StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { cleanAltUnits, lineFactor } from '../units';
import { requireAccess } from '../access';
import { getTable, setTable } from '../storage';

type Ceiling = NonNullable<StockItem['ceiling_prices']>[number];
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/* ── Pure: ceiling ── */

/** The ceiling (ex-GST, per base unit) in force on `day`, or undefined. */
export function ceilingAt(list: readonly Ceiling[] | undefined, day: string): Ceiling | undefined {
  let hit: Ceiling | undefined;
  for (const c of list ?? []) if (isDay(c.from) && c.from <= day && num(c.price_per_unit) > 0 && (!hit || c.from >= hit.from)) hit = c;
  return hit;
}

/** Append a dated ceiling (a row with the same date replaces nothing: it is refused). */
export function addCeiling(list: readonly Ceiling[] | undefined, row: Ceiling): Ceiling[] {
  if (!isDay(row.from)) throw new Error('Choose the date of the price order.');
  if (!(num(row.price_per_unit) > 0)) throw new Error('Type the ceiling price per unit (ex-GST).');
  if ((list ?? []).some((c) => c.from === row.from)) throw new Error(`A ceiling from ${row.from} is already recorded (rows are never edited — add a new date).`);
  return [...(list ?? []), { from: row.from, price_per_unit: round2(num(row.price_per_unit)), ...(row.unit?.trim() ? { unit: row.unit.trim() } : {}) }].sort((a, b) => a.from.localeCompare(b.from));
}

export interface CeilingIssue { name: string; mrp: number; limit: number; ceiling: number; from: string }

/**
 * Lines whose MRP per base unit is above ceiling × (1 + GST %) on `day`. A line's MRP is per its own unit (bill line:
 * the purchase unit; sale line: the batch / catalogue MRP), so it is divided by the line's unit factor.
 */
export function ceilingIssues(
  lines: readonly { name: string; mrp?: number; tax_rate?: number; unit_factor?: number; item_id?: string }[],
  items: readonly Pick<StockItem, 'id' | 'name' | 'ceiling_prices'>[],
  day: string,
): CeilingIssue[] {
  const out: CeilingIssue[] = [];
  for (const l of lines) {
    if (!(num(l.mrp) > 0)) continue;
    const it = (l.item_id && items.find((i) => i.id === l.item_id)) || items.find((i) => norm(i.name) === norm(l.name));
    const c = ceilingAt(it?.ceiling_prices, day);
    if (!c) continue;
    const mrp = num(l.mrp) / lineFactor(l);
    const limit = round2(num(c.price_per_unit) * (1 + Math.max(num(l.tax_rate), 0) / 100));
    if (mrp > limit + 0.005) out.push({ name: l.name, mrp: round2(mrp), limit, ceiling: num(c.price_per_unit), from: c.from });
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
  const alts = cleanAltUnits(item.alt_units, item.unit || 'NOS') ?? [];
  return alts.reduce<{ unit: string; factor: number } | undefined>((best, a) => (!best || a.factor > best.factor ? a : best), undefined);
}

/* ── Pure: margins ── */

export interface MarginRow {
  item: string;
  batch: string;
  ptr: number;
  /** Cost per base unit after free goods. */
  cost: number;
  pts?: number;
  mrp: number;
  sell: number;
  margin: number | null;
  scheme: string;
  bill: string;
}

/**
 * One row per item and batch of its last bill: PTR = net purchase rate per base unit, cost = PTR spread over paid + free,
 * selling rate per base unit ex-GST from the catalogue, margin % = (sell − cost) ÷ cost.
 */
export function marginRows(purchases: readonly unknown[], items: readonly Pick<StockItem, 'id' | 'name' | 'pts'>[], catalog: readonly Pick<InvoiceItem, 'name' | 'rate' | 'mrp' | 'mrp_pack' | 'mrp_less_percent'>[]): MarginRow[] {
  const last = new Map<string, { date: string; row: MarginRow }>();
  for (const raw of purchases) {
    const b = readPurchase(raw);
    if (!b || b.isExpense || isVoidStatus(b.status)) continue;
    for (const l of readPurchaseLines(raw)) {
      const it = (l.itemId && items.find((i) => i.id === l.itemId)) || items.find((i) => norm(i.name) === norm(l.name));
      if (!it) continue;
      const key = `${it.id}|${l.batchNo.toUpperCase()}`;
      const prev = last.get(key);
      if (prev && prev.date > b.date) continue;
      const cat = catalog.find((c) => norm(c.name) === norm(it.name));
      const f = l.unitFactor || 1;
      const pack = num(cat?.mrp_pack) > 1 ? num(cat?.mrp_pack) : 1;
      const sell = cat ? (num(cat.rate) > 0 ? num(cat.rate) : (num(cat.mrp) / pack) * (1 - Math.min(num(cat.mrp_less_percent), 99) / 100)) : 0;
      const cost = l.unitCost / f;
      last.set(key, {
        date: b.date,
        row: {
          item: it.name, batch: l.batchNo, ptr: round2(l.netRate / f), cost: round2(cost), ...(num(it.pts) > 0 ? { pts: num(it.pts) } : {}),
          mrp: round2((l.mrp || num(cat?.mrp)) / (l.mrp ? f : pack)), sell: round2(sell),
          margin: cost > 0 && sell > 0 ? round2(((sell - cost) / cost) * 100) : null,
          scheme: l.freeQty > 0 ? `${l.paidQty} + ${l.freeQty}` : '', bill: `${b.partyName} ${b.number}`.trim(),
        },
      });
    }
  }
  return [...last.values()].map((x) => x.row).sort((a, b) => a.item.localeCompare(b.item) || a.batch.localeCompare(b.batch));
}

export function marginCsv(rows: readonly MarginRow[]): string {
  return toCsv([
    ['Margins on purchase rate — working paper, verify with your CA'],
    ['Item', 'Batch', 'PTR', 'Cost after free', 'PTS', 'MRP', 'Selling rate', 'Margin %', 'Scheme', 'Last bill'],
    ...rows.map((r) => [r.item, r.batch, r.ptr, r.cost, r.pts ?? '', r.mrp, r.sell, r.margin ?? '', r.scheme, r.bill]),
  ]);
}

/* ── Storage ── */

/** Owner / master editor: patch pharmacy fields of a stock item (ceilings append-only through `addCeiling`). */
export function patchStockItem(id: string, patch: Partial<Pick<StockItem, 'ceiling_prices' | 'narcotic' | 'pts'>>): void {
  requireAccess('master.edit');
  const all = getTable<StockItem>('stock_items');
  if (!all.some((i) => i?.id === id)) throw new Error('Stock item not found.');
  setTable('stock_items', all.map((i) => {
    if (i?.id !== id) return i;
    const next: StockItem = { ...i, ...patch };
    if (!next.narcotic) delete next.narcotic;
    if (!(num(next.pts) > 0)) delete next.pts;
    return next;
  }));
}

/** Set (or clear with 0) the loose-sale pack on the catalogue row(s) named like the stock item. */
export function setMrpPack(name: string, pack: number): number {
  requireAccess('master.edit');
  const all = getTable<InvoiceItem>('items_catalog');
  let n = 0;
  setTable('items_catalog', all.map((c) => {
    if (norm(c?.name) !== norm(name)) return c;
    n += 1;
    const next = { ...c };
    if (pack > 1) next.mrp_pack = pack;
    else delete next.mrp_pack;
    return next;
  }));
  if (!n) throw new Error(`${name} is not in the item list (catalogue) — add it there with its MRP first.`);
  return n;
}
