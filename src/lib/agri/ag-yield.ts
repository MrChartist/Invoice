/**
 * AG-C2 milling batches: a batch is an ordinary production order (R4-A) with `ag.mill` (moisture in / out, the
 * standard outturn and its source). Output is reported through the existing manufacturing journal; this module only
 * READS the order's journals (`production_order_id`) and adds them up:
 *
 *   input           = Σ components consumed (base units via `lineFactor`, then kg when the unit is a weight)
 *   outturn %       = (main + co-products) ÷ input × 100        by-product % = by-products ÷ input × 100
 *   loss            = input − Σ outputs (main, co, by, scrap)
 *   moisture loss   = input × (m_in − m_out) ÷ (100 − m_out)     unexplained = loss − moisture loss
 *   cost per unit   = the engine's own cost snapshot (Σ finished value ÷ Σ main qty), after the by-product credit
 *                     (Σ snapshot deductions) — never recomputed here.
 *
 * A batch over or under its standard by more than the tolerance (`OWN_OUTTURN_STARTERS`, 1 point) is flagged (C5).
 * Pure above "Storage" (tests/ag-yield.test.ts).
 */
import './ag-registry';
import type { MillKind, MillOrderMeta } from '../../types/agri-r12';
import type { ManufacturingVoucher, VoucherOutputLine, VoucherStockLine } from '../../types/manufacturing';
import type { ProductionOrder } from '../../types/production-r4';
import type { StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { lineFactor } from '../units';
import { ruleAt } from '../tax-rules';
import { requireAccess } from '../access';
import { ordersStore } from '../production/orders';
import { kgPer } from '../trade/tr-weight';
import { OWN_OUTTURN_STARTERS } from '../agri-rules';

const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;

/** Physical figures of one or more journals, in kg (or the item unit when it is not a weight). */
export interface YieldFigures {
  input: number;
  main: number;
  co: number;
  by: number;
  scrap: number;
  /** Main product in its own unit (cost per unit). */
  mainQty: number;
  /** Engine cost snapshot totals. */
  finished: number;
  deductions: number;
  components: number;
}

export const ZERO: YieldFigures = { input: 0, main: 0, co: 0, by: 0, scrap: 0, mainQty: 0, finished: 0, deductions: 0, components: 0 };

const unitKg = (items: ReadonlyMap<string, StockItem>, id: string) => kgPer(items.get(id)?.unit) ?? 1;
const lineKg = (items: ReadonlyMap<string, StockItem>, l: VoucherStockLine) => num(l.qty) * lineFactor(l) * unitKg(items, l.item_id);

/** Pure: the figures of one manufacturing journal. */
export function voucherFigures(v: Pick<ManufacturingVoucher, 'item_id' | 'qty' | 'components' | 'outputs' | 'cost_snapshot'>, items: ReadonlyMap<string, StockItem>): YieldFigures {
  const sum = (ls: readonly VoucherOutputLine[], k: VoucherOutputLine['kind']) => ls.filter((l) => l.kind === k).reduce((s, l) => s + lineKg(items, l), 0);
  const outs = v.outputs ?? [];
  return {
    input: r3((v.components ?? []).reduce((s, l) => s + lineKg(items, l), 0)),
    main: r3(num(v.qty) * unitKg(items, v.item_id)),
    co: r3(sum(outs, 'co_product')),
    by: r3(sum(outs, 'by_product')),
    scrap: r3(sum(outs, 'scrap')),
    mainQty: r3(num(v.qty)),
    finished: round2(num(v.cost_snapshot?.finished)),
    deductions: round2(num(v.cost_snapshot?.deductions)),
    components: round2(num(v.cost_snapshot?.components)),
  };
}

export const addFigures = (a: YieldFigures, b: YieldFigures): YieldFigures => ({
  input: r3(a.input + b.input), main: r3(a.main + b.main), co: r3(a.co + b.co), by: r3(a.by + b.by), scrap: r3(a.scrap + b.scrap),
  mainQty: r3(a.mainQty + b.mainQty), finished: round2(a.finished + b.finished), deductions: round2(a.deductions + b.deductions), components: round2(a.components + b.components),
});

/** Moisture loss = input × (m_in − m_out) ÷ (100 − m_out); 0 without both readings or when m_out ≥ m_in. */
export function moistureLoss(input: number, mIn?: number, mOut?: number): number {
  if (mIn === undefined || mOut === undefined || String(mIn) === '' || String(mOut) === '') return 0;
  const a = num(mIn);
  const b = num(mOut);
  if (!(a > b) || b >= 100) return 0;
  return r3((num(input) * (a - b)) / (100 - b));
}

export interface MillYield extends YieldFigures {
  outturnPct: number;
  byPct: number;
  loss: number;
  lossPct: number;
  moistureLoss: number;
  unexplained: number;
  /** Cost per unit of the main product after the by-product credit (engine figures). */
  unitCost: number;
  standard: number;
  /** outturn − standard, points. */
  variance: number;
  flag: 'over' | 'under' | null;
}

/** Pure: percentages, losses and the flag of a batch (or a month) from its figures. */
export function yieldOf(f: YieldFigures, meta: Partial<MillOrderMeta> | undefined, tolerance = ruleAt(OWN_OUTTURN_STARTERS).tolerance_pts, moisture?: number): MillYield {
  const pct = (x: number) => (f.input > 0 ? round2((x * 100) / f.input) : 0);
  const loss = r3(f.input - f.main - f.co - f.by - f.scrap);
  const ml = moisture ?? moistureLoss(f.input, meta?.input_moisture, meta?.output_moisture);
  const outturnPct = pct(f.main + f.co);
  const standard = num(meta?.standard_outturn_pct);
  const variance = standard > 0 && f.input > 0 ? round2(outturnPct - standard) : 0;
  return {
    ...f, outturnPct, byPct: pct(f.by), loss, lossPct: pct(loss), moistureLoss: ml, unexplained: r3(loss - ml),
    unitCost: f.mainQty > 0 ? round2(f.finished / f.mainQty) : 0, standard, variance,
    flag: standard > 0 && f.input > 0 && Math.abs(variance) > tolerance + 1e-9 ? (variance > 0 ? 'over' : 'under') : null,
  };
}

/** Journals of an order (by `production_order_id`), oldest first. */
export const orderVouchers = (orderId: string, mfg: readonly ManufacturingVoucher[]) => mfg.filter((v) => v?.production_order_id === orderId).sort((a, b) => a.date.localeCompare(b.date));

/** Pure: a batch's yield from its journals. */
export function batchYield(order: Pick<ProductionOrder, 'id' | 'ag'>, mfg: readonly ManufacturingVoucher[], items: readonly StockItem[], tolerance?: number): MillYield {
  const byId = new Map(items.map((i) => [i.id, i]));
  const f = orderVouchers(order.id, mfg).reduce((t, v) => addFigures(t, voucherFigures(v, byId)), ZERO);
  return yieldOf(f, order.ag?.mill, tolerance);
}

/** The default mill meta for a new batch: own standard by `mill_kind` (rice when absent). */
export function defaultMillMeta(millKind: MillKind | undefined, date?: string): MillOrderMeta {
  return { standard_outturn_pct: ruleAt(OWN_OUTTURN_STARTERS, date)[millKind ?? 'rice'], std_source: 'own' };
}

/* ================================================================
   Storage
   ================================================================ */

/** Save the mill meta on a production order (books.edit; a closed / cancelled order is refused). */
export function setMillMeta(orderId: string, meta: MillOrderMeta): ProductionOrder {
  requireAccess('books.edit');
  const o = ordersStore.get(orderId);
  if (!o) throw new Error('This production order no longer exists.');
  if (o.status === 'closed' || o.status === 'cancelled') throw new Error(`Production order ${o.number} is ${o.status}.`);
  const std = num(meta.standard_outturn_pct);
  if (!(std > 0 && std <= 100)) throw new Error('The standard outturn must be between 0 and 100 %.');
  for (const m of [meta.input_moisture, meta.output_moisture]) if (m !== undefined && (num(m) < 0 || num(m) >= 100)) throw new Error('Moisture must be a % below 100.');
  const clean: MillOrderMeta = {
    standard_outturn_pct: round2(std), std_source: meta.std_source === 'cmr' ? 'cmr' : 'own',
    ...(meta.input_moisture !== undefined && String(meta.input_moisture) !== '' ? { input_moisture: round2(num(meta.input_moisture)) } : {}),
    ...(meta.output_moisture !== undefined && String(meta.output_moisture) !== '' ? { output_moisture: round2(num(meta.output_moisture)) } : {}),
  };
  const next: ProductionOrder = { ...o, ag: { ...(o.ag ?? {}), mill: clean }, updated_at: new Date().toISOString() };
  ordersStore.put(next);
  return next;
}
