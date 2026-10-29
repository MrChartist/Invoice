/**
 * Manufacturing and stock vouchers (Tally parity, Phase 7):
 *  - Bill of Materials (`boms`): components per unit of a finished item, by-products / co-products /
 *    scrap, normal-loss scrap %, optional godown per component, several BOMs per item with a default.
 *  - Manufacturing Journal (`manufacturing_vouchers`, `MFG/FY<yy-yy>/<seq>`).
 *  - Stock Journal (`stock_journals`, `SJ/FY…`): free-form source → destination for conversions and
 *    repacking. A pure godown move is refused here and saved as a stock transfer (`STR/FY…`).
 *  - Physical Stock (`physical_stock`, `PHY/FY…`): counted vs book; the difference is posted.
 *
 * The vouchers are read-only inputs to the stock engine (`stockVoucherInputs` → `collectEvents`), so
 * FIFO / weighted-average costing, godown, batch and every report downstream see them. Nothing here
 * posts to Books or the double-entry ledger (stock is not valued there; see docs/features/manufacturing.md).
 *
 * Every save / delete checks the role (`books.edit`; BOMs are masters: `master.edit`), the period lock,
 * and is written to the audit log. Everything above the "Storage" divider is pure and unit-tested.
 */

import type {
  AdditionalCost, Bom, BomComponent, BomOutput, ManufacturingVoucher, PhysicalStockLine, PhysicalStockVoucher,
  StockJournal, VoucherCostSnapshot, VoucherOutputLine, VoucherStockLine,
} from '../types/manufacturing';
import { MAIN_GODOWN_ID } from '../types/stock';
import { buildInvoiceNumber, getIndianFY, highestSequence } from './invoice-number';
import { num, round2 } from './invoice-calc';
import {
  VOUCHER_TABLES, computeStock, computeStockDetailed, stockVoucherInputs,
  type StockInputs, type StockItem, type StockVoucherInput, type VoucherCosting,
} from './inventory';
import { computeTracking, fefoAllocate, type ItemTracking, type TrackingMap } from './stock-tracking';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { lineFactor } from './units';
import { serialLineShape, serialShapeError, touchesSerials, voucherSerialIssues, type SerialLine } from './serial-vouchers';
import { assertRemovable, liveRemovalIssues } from './stock-timeline';

export const BOMS_TABLE = VOUCHER_TABLES.boms;
export const MFG_TABLE = VOUCHER_TABLES.manufacturing;
export const SJ_TABLE = VOUCHER_TABLES.stockJournals;
export const PHYSICAL_TABLE = VOUCHER_TABLES.physical;
export const MFG_PREFIX = 'MFG';
export const SJ_PREFIX = 'SJ';
export const PHYSICAL_PREFIX = 'PHY';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/* ── Numbering ────────────────────────────────────────────────── */

/** Next `<prefix>/FY<yy-yy>/<seq>` from existing numbers alone (pure). Storage adds the series high-water mark. */
export function nextVoucherNumber(prefix: string, existing: readonly string[], date?: string): string {
  const fy = getIndianFY(date).label;
  return buildInvoiceNumber(prefix, fy, highestSequence([...existing], prefix, fy) + 1);
}

/* ── BOM ──────────────────────────────────────────────────────── */

export function bomsForItem(boms: readonly Bom[], itemId: string): Bom[] {
  return boms.filter((b) => b.item_id === itemId).sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.name.localeCompare(b.name));
}

/** The item's default BOM (else its first). */
export function defaultBom(boms: readonly Bom[], itemId: string): Bom | undefined {
  return bomsForItem(boms, itemId)[0];
}

/** True when making `itemId` with `bom` would (through default BOMs of sub-assemblies) need `itemId` itself. */
export function bomHasCycle(bom: Pick<Bom, 'item_id' | 'components'>, boms: readonly Bom[]): boolean {
  const seen = new Set<string>();
  const visit = (itemId: string): boolean => {
    if (itemId === bom.item_id) return true;
    if (seen.has(itemId)) return false;
    seen.add(itemId);
    const sub = defaultBom(boms.filter((b) => b.item_id !== bom.item_id), itemId);
    return !!sub && sub.components.some((c) => visit(c.item_id));
  };
  return bom.components.some((c) => visit(c.item_id));
}

/** Shape checks for a BOM; returns an error message or ''. */
export function validateBom(bom: Pick<Bom, 'item_id' | 'name' | 'batch_qty' | 'components' | 'outputs'>, items: readonly StockItem[], boms: readonly Bom[] = []): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!bom.item_id || !byId.get(bom.item_id)) return 'Choose the finished item.';
  if (!bom.name?.trim()) return 'Give the BOM a name.';
  if (!(num(bom.batch_qty) > 0)) return 'The BOM quantity must be above zero.';
  const comps = (bom.components ?? []).filter((c) => c.item_id);
  if (comps.length === 0) return 'Add at least one component.';
  for (const c of comps) {
    const name = byId.get(c.item_id)?.name ?? 'A component';
    if (!byId.get(c.item_id)) return 'A component points at a deleted stock item.';
    if (c.item_id === bom.item_id) return 'An item cannot be a component of itself.';
    if (!(num(c.qty) > 0)) return `${name}: quantity must be above zero.`;
    if (num(c.scrap_pct) < 0 || num(c.scrap_pct) >= 100) return `${name}: scrap % must be between 0 and 99.`;
  }
  let pct = 0;
  for (const o of (bom.outputs ?? []).filter((x) => x.item_id)) {
    const name = byId.get(o.item_id)?.name ?? 'An output';
    if (!byId.get(o.item_id)) return 'A by-product points at a deleted stock item.';
    if (o.item_id === bom.item_id) return `${name} is already the main product.`;
    if (!(num(o.qty) > 0)) return `${name}: quantity must be above zero.`;
    if (o.kind === 'co_product') {
      if (!(num(o.cost_pct) > 0)) return `${name}: enter the co-product's share of cost (%).`;
      pct += num(o.cost_pct);
    } else if (num(o.rate) < 0) return `${name}: value per unit cannot be negative.`;
  }
  if (pct >= 100) return 'Co-product cost shares must add up to less than 100%.';
  if (bomHasCycle({ item_id: bom.item_id, components: comps }, boms)) return 'This BOM uses its own finished item through a sub-assembly.';
  return '';
}

export interface Explosion {
  components: (VoucherStockLine & { base: number; scrap: number })[];
  outputs: VoucherOutputLine[];
}

/**
 * Component and by-product quantities for `qty` finished units: each component is
 * qty / batch_qty × component qty × (1 + scrap %). Fresh line ids from `newId`.
 */
export function explodeBom(bom: Pick<Bom, 'batch_qty' | 'components' | 'outputs'>, qty: number, newId: () => string = generateId): Explosion {
  const factor = num(qty) / (num(bom.batch_qty) > 0 ? num(bom.batch_qty) : 1);
  const components = (bom.components ?? []).filter((c: BomComponent) => c.item_id && num(c.qty) > 0).map((c) => {
    const base = roundQty(num(c.qty) * factor);
    const total = roundQty(base * (1 + Math.max(num(c.scrap_pct), 0) / 100));
    return { id: newId(), item_id: c.item_id, qty: total, base, scrap: roundQty(total - base), ...(c.godown_id ? { godown_id: c.godown_id } : {}) };
  });
  const outputs = (bom.outputs ?? []).filter((o: BomOutput) => o.item_id && num(o.qty) > 0).map((o) => ({
    id: newId(), item_id: o.item_id, qty: roundQty(num(o.qty) * factor), kind: o.kind,
    ...(o.kind === 'co_product' ? { cost_pct: num(o.cost_pct) } : { rate: Math.max(num(o.rate), 0) }),
    ...(o.godown_id ? { godown_id: o.godown_id } : {}),
  }));
  return { components, outputs };
}

/**
 * Split component lines of batch-tracked items across batches, first-expiry-first (FEFO), in the
 * line's godown. A shortfall stays on a last line with no batch (validation reports it).
 */
export function allocateFefo(
  lines: readonly VoucherStockLine[], items: readonly StockItem[], tracking: TrackingMap, date: string, newId: () => string = generateId,
): VoucherStockLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: VoucherStockLine[] = [];
  for (const l of lines) {
    const item = byId.get(l.item_id);
    if (!item?.track_batches || l.batch_no) {
      out.push(l);
      continue;
    }
    const godown = l.godown_id || MAIN_GODOWN_ID;
    // 7S: a line typed in an alternate unit is allocated in base units and split back into its own unit.
    const f = lineFactor(l);
    const { lines: picks, short } = fefoAllocate(tracking.get(item.id), date, num(l.qty) * f, godown);
    picks.forEach((b, i) => out.push({ ...l, id: i === 0 ? l.id : newId(), qty: roundQty(b.qty / f), batch_no: b.batch }));
    if (short > EPS || picks.length === 0) out.push({ ...l, id: picks.length ? newId() : l.id, qty: picks.length ? roundQty(short / f) : num(l.qty) });
  }
  return out;
}

/** Sum of additional costs: ₹ amounts plus % of `componentCost`. */
export function additionalCostTotal(costs: readonly AdditionalCost[] | undefined, componentCost: number): number {
  return round2((costs ?? []).reduce((s, c) => s + (c.mode === 'pct' ? (componentCost * Math.max(num(c.value), 0)) / 100 : Math.max(num(c.value), 0)), 0));
}

/** Display snapshot of a voucher's cost roll-up (main finished line = `mainItemId`). */
export function costSnapshot(vc: VoucherCosting | undefined, mainItemId: string | undefined, mainQty: number): VoucherCostSnapshot {
  const finished = vc && mainItemId ? round2(vc.produced[mainItemId] ?? 0) : vc ? round2(vc.pool) : 0;
  return {
    components: vc?.consumed ?? 0,
    additional: vc?.extra ?? 0,
    deductions: vc?.fixed ?? 0,
    finished,
    unit: num(mainQty) > 0 ? round2(finished / num(mainQty)) : 0,
  };
}

/** Cost roll-up of a draft voucher on top of live stock (its saved copy, `input.id`, left out). */
export function previewVoucherCost(inputs: StockInputs, input: StockVoucherInput): VoucherCosting | undefined {
  const vouchers = [...(inputs.vouchers ?? []).filter((v) => v.id !== input.id), input];
  return computeStockDetailed({ ...inputs, vouchers }).vouchers.get(input.id);
}

const trackedItem = (byId: Map<string, StockItem>, id: string) => {
  const it = byId.get(id);
  return it?.track_stock ? it : undefined;
};

function lineShapeErrors(lines: readonly VoucherStockLine[], byId: Map<string, StockItem>, what: string, needBatch: boolean): string {
  for (const l of lines) {
    const item = trackedItem(byId, l.item_id);
    if (!item) return `${what}: choose a stock item that tracks stock.`;
    if (!(num(l.qty) > 0)) return `${item.name}: quantity must be above zero.`;
    // 7S: serial items move by serial (one per unit, whole base units).
    const serialErr = serialLineShape(l, item);
    if (serialErr) return serialErr;
    if (needBatch && item.track_batches && !l.batch_no?.trim()) return `${item.name}: choose the batch.`;
  }
  return '';
}

/** Shape checks for a Manufacturing Journal; returns an error message or ''. */
export function validateManufacturing(v: Pick<ManufacturingVoucher, 'date' | 'item_id' | 'qty' | 'batch_no' | 'components' | 'outputs' | 'costs'> & Pick<Partial<ManufacturingVoucher>, 'serials'>, items: readonly StockItem[]): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!v.date) return 'Choose the date.';
  const fin = trackedItem(byId, v.item_id);
  if (!fin) return 'Choose the finished item (a stock item that tracks stock).';
  if (!(num(v.qty) > 0)) return 'The quantity to manufacture must be above zero.';
  // 7S: serial-tracked finished goods get one new serial per unit.
  const finErr = serialLineShape({ item_id: fin.id, qty: num(v.qty), serials: v.serials }, fin);
  if (finErr) return finErr;
  if (fin.track_batches && !v.batch_no?.trim()) return `${fin.name}: enter the batch number of the finished goods.`;
  const comps = (v.components ?? []).filter((l) => l.item_id);
  if (comps.length === 0) return 'Add at least one component.';
  if (comps.some((l) => l.item_id === v.item_id)) return 'The finished item cannot also be a component.';
  const err = lineShapeErrors(comps, byId, 'Component', true) || lineShapeErrors((v.outputs ?? []).filter((l) => l.item_id), byId, 'By-product', true);
  if (err) return err;
  const pct = (v.outputs ?? []).reduce((s, o) => s + (o.kind === 'co_product' ? num(o.cost_pct) : 0), 0);
  if (pct >= 100) return 'Co-product cost shares must add up to less than 100%.';
  const dup = serialShapeError([...comps, { item_id: fin.id, qty: num(v.qty), serials: v.serials }, ...(v.outputs ?? []).filter((l) => l.item_id)], items);
  if (dup) return dup;
  if ((v.costs ?? []).some((c) => num(c.value) < 0)) return 'Additional costs cannot be negative.';
  return '';
}

/** True when every source line has a destination line of the same item, batch and quantity in another godown. */
export function isPureTransfer(j: Pick<StockJournal, 'consume' | 'produce' | 'costs'>): boolean {
  const src = (j.consume ?? []).filter((l) => l.item_id);
  const dst = (j.produce ?? []).filter((l) => l.item_id);
  if (src.length === 0 || src.length !== dst.length || additionalCostTotal(j.costs, 1) > 0) return false;
  const key = (l: VoucherStockLine) => `${l.item_id}|${(l.batch_no ?? '').toUpperCase()}|${roundQty(num(l.qty))}`;
  const left = [...dst];
  for (const s of src) {
    const i = left.findIndex((d) => key(d) === key(s) && (d.godown_id || MAIN_GODOWN_ID) !== (s.godown_id || MAIN_GODOWN_ID));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

/** Shape checks for a Stock Journal; returns an error message or ''. */
export function validateStockJournal(j: Pick<StockJournal, 'date' | 'consume' | 'produce' | 'costs'>, items: readonly StockItem[]): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!j.date) return 'Choose the date.';
  const src = (j.consume ?? []).filter((l) => l.item_id);
  const dst = (j.produce ?? []).filter((l) => l.item_id);
  if (src.length === 0) return 'Add at least one source (consumption) line.';
  if (dst.length === 0) return 'Add at least one destination (production) line.';
  const err = lineShapeErrors(src, byId, 'Source', true) || lineShapeErrors(dst, byId, 'Destination', true);
  if (err) return err;
  if (dst.reduce((s, l) => s + Math.max(num(l.cost_pct), 0), 0) > 100 + EPS) return 'Destination cost shares cannot exceed 100%.';
  if (isPureTransfer(j)) return 'This only moves stock between godowns — save it as a godown transfer instead.';
  return serialShapeError([...src, ...dst], items);
}

/** Availability problems for the consumption lines on the voucher date (the voucher's saved copy left out). */
export function consumptionShortfalls(
  lines: readonly VoucherStockLine[], date: string, inputs: StockInputs, excludeVoucherId?: string,
): string[] {
  const tracking = computeTracking({ ...inputs, asOf: date || undefined, vouchers: (inputs.vouchers ?? []).filter((v) => v.id !== excludeVoucherId) });
  const want = new Map<string, { item: StockItem; godown: string; batch: string; qty: number }>();
  for (const l of lines) {
    const t = tracking.get(l.item_id);
    if (!t || !(num(l.qty) > 0)) continue;
    const godown = l.godown_id || MAIN_GODOWN_ID;
    const batch = t.item.track_batches ? (l.batch_no ?? '').trim().toUpperCase() : '';
    const k = `${l.item_id}|${godown}|${batch}`;
    const w = want.get(k) ?? { item: t.item, godown, batch, qty: 0 };
    w.qty += num(l.qty) * lineFactor(l); // 7M: alternate unit
    want.set(k, w);
  }
  const out: string[] = [];
  for (const w of want.values()) {
    const t = tracking.get(w.item.id);
    const have = w.batch
      ? (t?.batches.find((b) => b.batch.toUpperCase() === w.batch)?.byGodown[w.godown] ?? 0)
      : (t?.byGodown[w.godown] ?? 0);
    if (w.qty > have + EPS) {
      out.push(`${w.item.name}${w.batch ? ` (batch ${w.batch})` : ''}: need ${roundQty(w.qty)} ${w.item.unit}, ${roundQty(Math.max(have, 0))} in stock.`);
    }
  }
  return out;
}

/** Engine input for a Manufacturing Journal draft. */
export const mfgInput = (v: ManufacturingVoucher): StockVoucherInput => stockVoucherInputs([v])[0];
/** Engine input for a Stock Journal draft. */
export const sjInput = (j: StockJournal): StockVoucherInput => stockVoucherInputs([], [j])[0];

/* ── Physical stock ───────────────────────────────────────────── */

export interface PhysicalDraftLine {
  id: string;
  item_id: string;
  godown_id?: string;
  batch_no?: string;
  /** Counted quantity, in `unit` when typed in an alternate unit (7S), else the base unit. */
  counted: number;
  unit?: string;
  unit_factor?: number;
  /** 7.167: serials found, for a serial-tracked item (the count is their number). */
  serials?: string[];
}

const skey = (s: string) => s.trim().toUpperCase();
/** Trimmed serials of a draft line, first spelling of each kept. */
export function countedSerials(l: Pick<PhysicalDraftLine, 'serials'>): string[] {
  const seen = new Set<string>();
  return (l.serials ?? []).map((x) => String(x ?? '').trim()).filter((x) => x && !seen.has(skey(x)) && !!seen.add(skey(x)));
}

/**
 * Book quantity, difference and unit cost for counted lines on `date` (closing of that day, the
 * voucher's saved copy left out). A line without a godown counts the item company-wide; a batch
 * line counts that batch (in the godown when given).
 */
export function physicalLines(drafts: readonly PhysicalDraftLine[], date: string, inputs: StockInputs, excludeId?: string): PhysicalStockLine[] {
  const base = { ...inputs, asOf: date || undefined, vouchers: (inputs.vouchers ?? []).filter((v) => v.id !== excludeId) };
  const tracking = computeTracking(base);
  const positions = new Map(computeStock(base).map((p) => [p.item.id, p]));
  const serialItems = new Set(inputs.items.filter((i) => i.track_stock && i.track_serials).map((i) => i.id));
  return drafts.filter((d) => d.item_id).map((d) => {
    const t = tracking.get(d.item_id);
    if (serialItems.has(d.item_id)) return serialCountLine(d, t, positions.get(d.item_id)?.avgCost ?? 0);
    const batch = d.batch_no?.trim() ?? '';
    let book = 0;
    if (t) {
      if (t.item.track_batches && batch) {
        const b = t.batches.find((x) => x.batch.toUpperCase() === batch.toUpperCase());
        book = d.godown_id ? (b?.byGodown[d.godown_id] ?? 0) : (b?.qty ?? 0);
      } else book = d.godown_id ? (t.byGodown[d.godown_id] ?? 0) : t.qty;
    }
    // 7S: a count typed in an alternate unit is stored in base units (and the typed figure kept for display).
    const f = lineFactor(d);
    const typed = roundQty(Math.max(num(d.counted), 0));
    const counted = roundQty(typed * f);
    const rate = positions.get(d.item_id)?.avgCost ?? 0;
    return {
      id: d.id, item_id: d.item_id, ...(d.godown_id ? { godown_id: d.godown_id } : {}), ...(batch ? { batch_no: batch } : {}),
      counted, book_qty: roundQty(book), diff: roundQty(counted - book), rate: round2(rate),
      ...(f !== 1 ? { unit: d.unit, unit_factor: f, counted_typed: typed } : {}),
    };
  });
}

/**
 * 7.167: a serial count. Book = serials in stock at the end of the day in the line's godown (every godown when none);
 * shortages are the book serials not found (with the godown each was in), excesses the serials found that the books do
 * not hold there. Base unit only (one serial per unit).
 */
function serialCountLine(d: PhysicalDraftLine, t: ItemTracking | undefined, rate: number): PhysicalStockLine {
  const found = countedSerials(d);
  const inStock = (t?.serials ?? []).filter((s) => s.inStock && (!d.godown_id || (s.godown || MAIN_GODOWN_ID) === d.godown_id));
  const have = new Set(found.map(skey));
  const book = new Set(inStock.map((s) => skey(s.serial)));
  const short = inStock.filter((s) => !have.has(skey(s.serial))).sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
  const excess = found.filter((s) => !book.has(skey(s)));
  return {
    id: d.id, item_id: d.item_id, ...(d.godown_id ? { godown_id: d.godown_id } : {}),
    counted: found.length, book_qty: inStock.length, diff: found.length - inStock.length, rate: round2(rate),
    serials: found, serials_short: short.map((s) => s.serial), serials_excess: excess,
    ...(!d.godown_id && short.length ? { serials_short_godowns: short.map((s) => s.godown || MAIN_GODOWN_ID) } : {}),
  };
}

/** Units short / in excess on a line: a serial count moves its missing and extra serials even when they net to nil. */
export function physicalMoves(l: PhysicalStockLine): { short: number; excess: number } {
  if (l.serials_short || l.serials_excess) return { short: l.serials_short?.length ?? 0, excess: l.serials_excess?.length ?? 0 };
  return { short: l.diff < -EPS ? -l.diff : 0, excess: l.diff > EPS ? l.diff : 0 };
}

export interface PhysicalSummary {
  shortageQty: number;
  shortageValue: number;
  excessQty: number;
  excessValue: number;
}

export function physicalSummary(lines: readonly PhysicalStockLine[]): PhysicalSummary {
  const s = { shortageQty: 0, shortageValue: 0, excessQty: 0, excessValue: 0 };
  for (const l of lines) {
    const m = physicalMoves(l);
    s.shortageQty += m.short;
    s.shortageValue += m.short * num(l.rate);
    s.excessQty += m.excess;
    s.excessValue += m.excess * num(l.rate);
  }
  return { shortageQty: roundQty(s.shortageQty), shortageValue: round2(s.shortageValue), excessQty: roundQty(s.excessQty), excessValue: round2(s.excessValue) };
}

/** Lines whose book quantity has changed since the count was saved (a back-dated bill or sale). */
export function physicalDrift(v: PhysicalStockVoucher, inputs: StockInputs): { line: PhysicalStockLine; bookNow: number }[] {
  const now = physicalLines(v.lines.map((l) => ({ ...l, counted: l.counted_typed ?? l.counted })), v.date, inputs, v.id);
  return v.lines
    .map((line, i) => ({ line, bookNow: now[i]?.book_qty ?? 0 }))
    .filter((r, i) => Math.abs(r.bookNow - r.line.book_qty) > EPS || serialDrift(r.line, now[i]));
}

function serialDrift(a: PhysicalStockLine, b: PhysicalStockLine | undefined): boolean {
  const k = (l?: string[]) => (l ?? []).map(skey).sort().join('|');
  return !!(a.serials_short || a.serials_excess) && (k(a.serials_short) !== k(b?.serials_short) || k(a.serials_excess) !== k(b?.serials_excess));
}

export function validatePhysical(v: { date: string; lines: readonly PhysicalDraftLine[] }, items: readonly StockItem[]): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!v.date) return 'Choose the date of the count.';
  const lines = v.lines.filter((l) => l.item_id);
  if (lines.length === 0) return 'Add at least one counted item.';
  const seen = new Set<string>();
  for (const l of lines) {
    const item = trackedItem(byId, l.item_id);
    if (!item) return 'Choose a stock item that tracks stock.';
    if (item.track_serials) {
      // 7.167: serial items are counted by serial, in the base unit, one line per godown.
      if (item.track_batches) return `${item.name} tracks batches and serials — count it with a stock adjustment.`;
      if (lineFactor(l) !== 1) return `${item.name}: count serials in ${item.unit || 'the base unit'}.`;
      const list = (l.serials ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
      const dup = list.find((x, i) => list.findIndex((y) => skey(y) === skey(x)) !== i);
      if (dup) return `Serial ${dup} is listed twice.`;
      const k = `${l.item_id}|${l.godown_id ?? ''}`;
      if (seen.has(k)) return `${item.name} is counted twice for the same godown.`;
      seen.add(k);
      for (const x of list) {
        const sk = `${l.item_id}|#${skey(x)}`;
        if (seen.has(sk)) return `Serial ${x} is counted on two lines.`;
        seen.add(sk);
      }
      continue;
    }
    if (num(l.counted) < 0) return `${item.name}: the count cannot be negative.`;
    const k = `${l.item_id}|${l.godown_id ?? ''}|${(l.batch_no ?? '').toUpperCase()}`;
    if (seen.has(k)) return `${item.name} is counted twice for the same godown / batch.`;
    seen.add(k);
  }
  return '';
}

/* ================================================================
   Storage (browser; same synchronous storage API as every module)
   ================================================================ */

const now = () => new Date().toISOString();
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** 7S: serial lines checked against live stock on the voucher date (its saved copy left out); throws the first issue. */
function assertSerials(inputs: StockInputs, ownId: string | undefined, date: string, consume: readonly SerialLine[], produce: readonly SerialLine[], multiGodown = true): void {
  if (!touchesSerials([...consume, ...produce], inputs.items)) return;
  const others = { ...inputs, vouchers: (inputs.vouchers ?? []).filter((v) => v.id !== ownId) };
  const issues = voucherSerialIssues({ consume, produce, day: date, input: others, multiGodown });
  if (issues.length) throw new Error(issues[0]);
}
/**
 * 7.167: a serial count's moves checked like any voucher — a missing serial must not be needed by a later entry (sold
 * or moved after the count), a serial found beyond the books must not be in stock elsewhere (move it by transfer).
 */
function assertSerialCount(inputs: StockInputs, ownId: string | undefined, date: string, lines: readonly PhysicalStockLine[]): void {
  const counts = lines.filter((l) => l.serials_short || l.serials_excess);
  if (!counts.length) return;
  const out = (g: boolean) => counts.filter((l) => !!l.godown_id === g && l.serials_short?.length)
    .map((l) => ({ item_id: l.item_id, qty: l.serials_short!.length, serials: l.serials_short, godown_id: l.godown_id }));
  const excess = counts.filter((l) => l.serials_excess?.length).map((l) => ({ item_id: l.item_id, qty: l.serials_excess!.length, serials: l.serials_excess }));
  assertSerials(inputs, ownId, date, out(true), excess);
  assertSerials(inputs, ownId, date, out(false), [], false);
}
const lockOf = (r: { id: string; date: string; number: string }) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });
const tag = (state: string) => (state === 'overridden' ? ' (period lock overridden)' : '');

export const bomsDb = {
  all: (): Bom[] => getTable<Bom>(BOMS_TABLE),
  forItem: (itemId: string): Bom[] => bomsForItem(bomsDb.all(), itemId),

  /** Insert or update; the first BOM of an item (or one marked default) becomes its default. */
  save(input: Omit<Bom, 'id'> & { id?: string }, items: readonly StockItem[]): Bom {
    requireAccess('master.edit');
    const rows = bomsDb.all();
    const existing = input.id ? rows.find((b) => b.id === input.id) : undefined;
    const others = rows.filter((b) => b.id !== existing?.id);
    const err = validateBom(input, items, others);
    if (err) throw new Error(err);
    if (others.some((b) => b.item_id === input.item_id && b.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
      throw new Error(`This item already has a BOM named "${input.name.trim()}".`);
    }
    const siblings = others.filter((b) => b.item_id === input.item_id);
    const isDefault = !!input.is_default || siblings.length === 0 || !siblings.some((b) => b.is_default);
    const record: Bom = {
      ...existing,
      ...input,
      id: existing?.id ?? input.id ?? generateId(),
      name: input.name.trim(),
      batch_qty: num(input.batch_qty),
      components: input.components.filter((c) => c.item_id && num(c.qty) > 0),
      outputs: (input.outputs ?? []).filter((o) => o.item_id && num(o.qty) > 0),
      is_default: isDefault,
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    const next = (existing ? rows.map((b) => (b.id === record.id ? record : b)) : [...rows, record])
      .map((b) => (isDefault && b.item_id === record.item_id && b.id !== record.id && b.is_default ? { ...b, is_default: false } : b));
    setTable(BOMS_TABLE, next);
    const item = items.find((i) => i.id === record.item_id)?.name ?? 'item';
    audit.record({
      entity: 'bom', entity_id: record.id, action: existing ? 'update' : 'create', doc_number: record.name,
      summary: `${existing ? 'Edited' : 'Created'} BOM "${record.name}" for ${item}: ${plural(record.components.length, 'component')}`,
    });
    return record;
  },

  remove(id: string): void {
    requireAccess('master.edit');
    const rows = bomsDb.all();
    const b = rows.find((x) => x.id === id);
    if (!b) return;
    let next = rows.filter((x) => x.id !== id);
    if (b.is_default) {
      const heir = next.find((x) => x.item_id === b.item_id);
      if (heir) next = next.map((x) => (x.id === heir.id ? { ...x, is_default: true } : x));
    }
    setTable(BOMS_TABLE, next);
    audit.record({ entity: 'bom', entity_id: id, action: 'delete', doc_number: b.name, summary: `Deleted BOM "${b.name}"` });
  },
};

function saveVoucher<T extends { id: string; number: string; date: string; created_at?: string; updated_at?: string }>(
  table: string, prefix: string, entity: 'manufacturing' | 'stock_journal' | 'physical_stock', label: string,
  input: Omit<T, 'id' | 'number'> & { id?: string; number?: string }, describe: (r: T) => string,
): T {
  requireAccess('books.edit');
  const rows = getTable<T>(table);
  const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
  if (existing) assertUnlocked(lockOf(existing), 'edit');
  // A deleted latest number is never reissued (series high-water mark); an edit that moves the date into
  // another FY takes a number from that FY's series.
  const kept = (input.number ?? '').trim() || existing?.number || '';
  const number = kept && numberFitsFy(kept, input.date) ? kept : nextSeriesNumberFor(prefix, input.date, rows.map((r) => r.number));
  const id = existing?.id ?? input.id ?? generateId();
  const state = assertUnlocked(lockOf({ id, date: input.date, number }), existing ? 'edit' : 'create');
  if (rows.some((r) => r.id !== id && r.number.toUpperCase() === number.toUpperCase())) throw new Error(`${label} number ${number} is already used.`);
  const record = { ...existing, ...input, id, number, created_at: existing?.created_at ?? now(), updated_at: now() } as T;
  setTable(table, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
  recordSeries(number);
  audit.record({
    entity, entity_id: id, action: existing ? 'update' : 'create', doc_number: number,
    summary: `${existing ? 'Edited' : 'Created'} ${label.toLowerCase()} ${number}: ${describe(record)}${tag(state)}`,
  });
  return record;
}

function removeVoucher<T extends { id: string; number: string; date: string }>(
  table: string, entity: 'manufacturing' | 'stock_journal' | 'physical_stock', label: string, id: string,
): void {
  requireAccess('books.edit');
  const rows = getTable<T>(table);
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  const state = assertUnlocked(lockOf(r), 'delete');
  setTable(table, rows.filter((x) => x.id !== id));
  audit.record({ entity, entity_id: id, action: 'delete', doc_number: r.number, summary: `Deleted ${label.toLowerCase()} ${r.number}${tag(state)}` });
}

export const manufacturingDb = {
  all: (): ManufacturingVoucher[] => getTable<ManufacturingVoucher>(MFG_TABLE),
  get: (id: string) => manufacturingDb.all().find((v) => v.id === id),
  nextNumber: (date?: string) => nextSeriesNumberFor(MFG_PREFIX, date, manufacturingDb.all().map((v) => v.number)),

  /** Validates, snapshots the cost roll-up on live stock, saves (period lock, audit). */
  save(input: Omit<ManufacturingVoucher, 'id' | 'number'> & { id?: string; number?: string }, items: readonly StockItem[], inputs?: StockInputs): ManufacturingVoucher {
    const err = validateManufacturing(input, items);
    if (err) throw new Error(err);
    const draft = {
      ...input,
      components: input.components.filter((l) => l.item_id && num(l.qty) > 0),
      outputs: (input.outputs ?? []).filter((l) => l.item_id && num(l.qty) > 0),
      costs: (input.costs ?? []).filter((c) => num(c.value) > 0),
    };
    if (inputs) {
      assertSerials(inputs, input.id, input.date, draft.components, [{ item_id: input.item_id, qty: num(input.qty), serials: input.serials, godown_id: input.godown_id }, ...draft.outputs]);
      const vc = previewVoucherCost(inputs, mfgInput({ ...draft, id: input.id ?? '__draft__', number: input.number ?? '' } as ManufacturingVoucher));
      draft.cost_snapshot = costSnapshot(vc, input.item_id, input.qty);
    }
    const name = items.find((i) => i.id === input.item_id)?.name ?? 'item';
    return saveVoucher<ManufacturingVoucher>(MFG_TABLE, MFG_PREFIX, 'manufacturing', 'Manufacturing journal', draft,
      (r) => `${r.qty} × ${name} from ${plural(r.components.length, 'component line')}`);
  },

  remove(id: string): void {
    const v = manufacturingDb.get(id);
    if (v && (v.serials?.length || [...v.components, ...v.outputs].some((l) => l.serials?.length))) assertRemovable({ errors: liveRemovalIssues({ refType: 'manufacturing', refId: id }).errors, warnings: [] });
    removeVoucher<ManufacturingVoucher>(MFG_TABLE, 'manufacturing', 'Manufacturing journal', id);
  },
};

export const stockJournalsDb = {
  all: (): StockJournal[] => getTable<StockJournal>(SJ_TABLE),
  nextNumber: (date?: string) => nextSeriesNumberFor(SJ_PREFIX, date, stockJournalsDb.all().map((v) => v.number)),

  save(input: Omit<StockJournal, 'id' | 'number'> & { id?: string; number?: string }, items: readonly StockItem[], inputs?: StockInputs): StockJournal {
    const err = validateStockJournal(input, items);
    if (err) throw new Error(err);
    const draft = {
      ...input,
      consume: input.consume.filter((l) => l.item_id && num(l.qty) > 0),
      produce: input.produce.filter((l) => l.item_id && num(l.qty) > 0),
      costs: (input.costs ?? []).filter((c) => num(c.value) > 0),
    };
    if (inputs) {
      assertSerials(inputs, input.id, input.date, draft.consume, draft.produce);
      const vc = previewVoucherCost(inputs, sjInput({ ...draft, id: input.id ?? '__draft__', number: input.number ?? '' } as StockJournal));
      draft.cost_snapshot = costSnapshot(vc, undefined, draft.produce.reduce((s, l) => s + num(l.qty) * lineFactor(l), 0));
    }
    return saveVoucher<StockJournal>(SJ_TABLE, SJ_PREFIX, 'stock_journal', 'Stock journal', draft,
      (r) => `${plural(r.consume.length, 'source line')} → ${plural(r.produce.length, 'destination line')}`);
  },

  remove(id: string): void {
    const j = stockJournalsDb.all().find((x) => x.id === id);
    if (j && [...j.consume, ...j.produce].some((l) => l.serials?.length)) assertRemovable({ errors: liveRemovalIssues({ refType: 'stock_journal', refId: id }).errors, warnings: [] });
    removeVoucher<StockJournal>(SJ_TABLE, 'stock_journal', 'Stock journal', id);
  },
};

/**
 * R4-A1: a consume-only Stock Journal (`SJ/FY…`) — shop-floor material written off as scrap when a production order is
 * closed. The normal Stock Journal needs a destination line; this one has none (the engine issues the lines at cost and
 * receives nothing). Same guards as every voucher: role, period lock, series counter, serial check, audit.
 * `production_order_id` is kept on the record like every other additive field.
 */
export function saveConsumeOnlyJournal(
  input: Omit<StockJournal, 'id' | 'number' | 'produce' | 'costs'> & { id?: string; number?: string }, items: readonly StockItem[], inputs?: StockInputs,
): StockJournal {
  if (!input.date) throw new Error('Choose the date.');
  const consume = (input.consume ?? []).filter((l) => l.item_id && num(l.qty) > 0);
  if (consume.length === 0) throw new Error('Nothing to write off.');
  const err = lineShapeErrors(consume, new Map(items.map((i) => [i.id, i])), 'Write-off', true) || serialShapeError(consume, items);
  if (err) throw new Error(err);
  if (inputs) assertSerials(inputs, input.id, input.date, consume, []);
  return saveVoucher<StockJournal>(SJ_TABLE, SJ_PREFIX, 'stock_journal', 'Stock journal', { ...input, consume, produce: [], costs: [] },
    (r) => `${plural(r.consume.length, 'line')} written off (consume only)`);
}

export const physicalStockDb = {
  all: (): PhysicalStockVoucher[] => getTable<PhysicalStockVoucher>(PHYSICAL_TABLE),
  nextNumber: (date?: string) => nextSeriesNumberFor(PHYSICAL_PREFIX, date, physicalStockDb.all().map((v) => v.number)),

  /** Computes book quantity and difference on live stock for the date, then saves. */
  save(
    input: { id?: string; number?: string; date: string; lines: PhysicalDraftLine[]; narration?: string },
    items: readonly StockItem[], inputs: StockInputs,
  ): PhysicalStockVoucher {
    const err = validatePhysical(input, items);
    if (err) throw new Error(err);
    const lines = physicalLines(input.lines, input.date, inputs, input.id);
    assertSerialCount(inputs, input.id, input.date, lines);
    const s = physicalSummary(lines);
    return saveVoucher<PhysicalStockVoucher>(PHYSICAL_TABLE, PHYSICAL_PREFIX, 'physical_stock', 'Physical stock', { ...input, lines },
      () => `${plural(lines.length, 'item')} counted, shortage ${s.shortageQty} (₹${s.shortageValue}), excess ${s.excessQty} (₹${s.excessValue})`);
  },

  remove: (id: string) => removeVoucher<PhysicalStockVoucher>(PHYSICAL_TABLE, 'physical_stock', 'Physical stock', id),
};
