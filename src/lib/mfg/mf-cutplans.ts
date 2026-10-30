/**
 * MF-C1 cut plans `CUT/FY…` (table `cut_plans`, the lot number; `doc.create`, audited, recycle bin on delete):
 *   pieces cut = Σ plies × marker ratio (by size) · laid = Σ plies × marker length
 *   consumption per piece = (fabric issued − end bits returned) ÷ pieces · variance = used − standard × pieces
 * Stock goes through R4-A (no new stock source): fabric issued = an STR to the order's WIP godown, end bits back = the
 * return, cut waste = a stock journal tagged with the order (fabric metres → the waste item's kg). Cut pieces are not
 * stock until finished (WIP); bundles (`mf-bundles.ts`) track them. Pure above "Storage".
 */
import './mf-registry';
import type { StockItem, StockInputs } from '../inventory';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { productionOrdersDb, ORDERS_TABLE } from '../production/orders';
import { SJ_TABLE, stockJournalsDb } from '../manufacturing';
import { MF_SERIES, MF_TABLES } from './mf-shared';
import type { CutPlan, MfLay } from '../../types/mfg-r13';

export const CUT = MF_SERIES.cutPlans;
const T = MF_TABLES.cutPlans;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/** Pieces by size from the lays. */
export function piecesFromLays(lays: readonly MfLay[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lays) for (const [s, r] of Object.entries(l.marker_ratio ?? {})) if (num(r) > 0) out[s] = (out[s] ?? 0) + Math.floor(num(l.plies)) * Math.floor(num(r));
  return out;
}

export const piecesTotal = (cut: Record<string, number> | undefined): number => Object.values(cut ?? {}).reduce((s, q) => s + Math.max(num(q), 0), 0);
export const laidMetres = (lays: readonly MfLay[]): number => r3(lays.reduce((s, l) => s + num(l.plies) * num(l.marker_length_m), 0));

export interface Consumption {
  pieces: number;
  laid_m: number;
  used_m: number;
  per_piece_m: number;
  standard_m: number;
  variance_m: number;
  variance_pct: number;
}

/** Consumption against the style's standard metres per piece. */
export function consumption(p: Pick<CutPlan, 'lays' | 'cut' | 'fabric_issued_m' | 'end_bits_m'>, perPieceStd: number): Consumption {
  const pieces = piecesTotal(p.cut);
  const used = r3(Math.max(num(p.fabric_issued_m) - num(p.end_bits_m), 0));
  const standard = r3(pieces * num(perPieceStd));
  return {
    pieces, laid_m: laidMetres(p.lays ?? []), used_m: used, per_piece_m: pieces > 0 ? r3(used / pieces) : 0, standard_m: standard,
    variance_m: r3(used - standard), variance_pct: standard > 0 ? round2(((used - standard) / standard) * 100) : 0,
  };
}

/**
 * Lays for an order's size quantities: plies = ⌈remaining ÷ marker capacity⌉ (≤ `maxPlies`), ratio = ⌊size qty ÷ plies⌋,
 * repeated on what is left (largest common ratio first). Never cuts more than ordered; the user edits the result.
 */
export function suggestLays(order: Record<string, number>, maxPieces: number, maxPlies = 100): MfLay[] {
  const left: Record<string, number> = Object.fromEntries(Object.entries(order).map(([s, q]) => [s, Math.max(Math.floor(num(q)), 0)]));
  const cap = Math.max(Math.floor(num(maxPieces)), 1);
  const lays: MfLay[] = [];
  for (let guard = 0; guard < 60; guard++) {
    const total = Object.values(left).reduce((s, q) => s + q, 0);
    if (total <= 0) break;
    let plies = Math.min(Math.ceil(total / cap), Math.max(Math.floor(maxPlies), 1));
    if (!Object.values(left).some((q) => q >= plies)) plies = Math.max(...Object.values(left));
    const ratio: Record<string, number> = {};
    for (const [s, q] of Object.entries(left)) if (Math.floor(q / plies) > 0) ratio[s] = Math.floor(q / plies);
    // Too many pieces for one marker (plies capped): drop from the largest ratio.
    for (let n = Object.values(ratio).reduce((a, b) => a + b, 0); n > cap; n--) {
      const big = Object.entries(ratio).sort((a, b) => b[1] - a[1])[0][0];
      if (--ratio[big] <= 0) delete ratio[big];
    }
    if (!Object.keys(ratio).length) break;
    for (const [s, r] of Object.entries(ratio)) left[s] -= r * plies;
    lays.push({ plies, marker_ratio: ratio, marker_length_m: 0 });
  }
  return lays;
}

/** Problems with a cut plan ('' = fine). */
export function validateCutPlan(p: Partial<CutPlan>): string {
  if (!DAY.test(p.date ?? '')) return 'Choose the cutting date.';
  if (!p.style_id) return 'Choose the style.';
  if (!p.fabric_item_id) return 'Choose the fabric.';
  if (!(p.lays ?? []).length || (p.lays ?? []).some((l) => !(num(l.plies) > 0) || !Object.values(l.marker_ratio ?? {}).some((r) => num(r) > 0) || num(l.marker_length_m) < 0)) return 'Every lay needs plies, a marker ratio and its length.';
  if (num(p.fabric_issued_m) < 0 || num(p.end_bits_m) < 0 || num(p.cut_waste_kg) < 0) return 'Fabric and waste cannot be negative.';
  if (num(p.end_bits_m) > num(p.fabric_issued_m)) return 'End bits cannot exceed the fabric issued.';
  if (!(piecesTotal(p.cut) > 0)) return 'Nothing is cut.';
  return '';
}

/* ════════════════════════ Storage ════════════════════════ */

export const loadCutPlans = (): CutPlan[] => getTable<CutPlan>(T).filter((p) => p && typeof p.id === 'string');
export const cutPlanOf = (id: string): CutPlan | undefined => loadCutPlans().find((p) => p.id === id);
const lockOf = (p: Pick<CutPlan, 'id' | 'date' | 'number'>) => ({ id: p.id, issue_date: p.date, invoice_number: p.number });
export const putPlan = (p: CutPlan): void => setTable(T, loadCutPlans().some((x) => x.id === p.id) ? loadCutPlans().map((x) => (x.id === p.id ? p : x)) : [...loadCutPlans(), p]);

/** Save (numbered `CUT/FY…` on first save; the number is never reused). `cut` defaults to Σ plies × ratio. */
export function saveCutPlan(input: Omit<CutPlan, 'id' | 'number' | 'cut'> & { id?: string; cut?: Record<string, number> }): CutPlan {
  requireAccess('doc.create');
  const prev = input.id ? cutPlanOf(input.id) : undefined;
  const cut = input.cut && piecesTotal(input.cut) > 0 ? input.cut : piecesFromLays(input.lays ?? []);
  const draft = { ...input, cut };
  const err = validateCutPlan(draft);
  if (err) throw new Error(err);
  if (prev) assertUnlocked(lockOf(prev), 'edit');
  const number = prev && numberFitsFy(prev.number, input.date) ? prev.number : nextSeriesNumberFor(CUT, input.date, loadCutPlans().map((p) => p.number));
  const now = new Date().toISOString();
  const row: CutPlan = { ...prev, ...draft, id: prev?.id ?? generateId(), number, fabric_issued_m: r3(num(input.fabric_issued_m)), created_at: prev?.created_at ?? now, updated_at: now };
  assertUnlocked(lockOf(row), prev ? 'edit' : 'create');
  return withTablesRollback([T, 'series_counters'], () => {
    putPlan(row);
    recordSeries(number);
    return row;
  });
}

/** Delete a lot nothing was booked against (its stock documents and moved bundles stay; delete those first). */
export function removeCutPlan(id: string): void {
  requireAccess('doc.create');
  const p = cutPlanOf(id);
  if (!p) return;
  if (p.docs?.issue_id || p.docs?.return_id || p.docs?.waste_id) throw new Error(`${p.number} has fabric issued / returned or waste written: those stay, delete them first.`);
  if ((p.bundles ?? []).some((b) => b.history.length)) throw new Error(`${p.number}: bundles have been worked on.`);
  assertUnlocked(lockOf(p), 'delete');
  setTable(T, loadCutPlans().filter((x) => x.id !== id));
}

const needOrder = (p: CutPlan) => {
  if (!p.order_id) throw new Error(`${p.number}: link a production order to move fabric (R4-A issue / return).`);
  return p.order_id;
};

/** Issue the fabric to the order's shop floor (R4-A issue: STR to the WIP godown); remembers the transfer. */
export function issueCutFabric(id: string, x: { date: string; from?: string; qty?: number; batch_no?: string }, items: readonly StockItem[], inputs: StockInputs): CutPlan {
  const p = cutPlanOf(id);
  if (!p) throw new Error('Cut plan not found.');
  const qty = r3(num(x.qty ?? p.fabric_issued_m));
  if (!(qty > 0)) throw new Error('Enter the fabric issued.');
  return withTablesRollback([T, ORDERS_TABLE, 'stock_transfers', 'series_counters'], () => {
    const { transfer } = productionOrdersDb.issue(needOrder(p), { date: x.date, from: x.from ?? 'main', lines: [{ id: generateId(), item_id: p.fabric_item_id, qty, ...(x.batch_no ? { batch_no: x.batch_no } : {}) }], notes: `Fabric for ${p.number}` }, items, inputs);
    const row = { ...p, fabric_issued_m: qty, docs: { ...p.docs, issue_id: transfer.id }, updated_at: new Date().toISOString() };
    putPlan(row);
    return row;
  });
}

/** End bits back to the store (R4-A return of the fabric item only). */
export function returnEndBits(id: string, x: { date: string; to?: string }, inputs: StockInputs): CutPlan {
  const p = cutPlanOf(id);
  if (!p) throw new Error('Cut plan not found.');
  const qty = r3(num(p.end_bits_m));
  if (!(qty > 0)) throw new Error('Enter the end bits returned first.');
  return withTablesRollback([T, ORDERS_TABLE, 'stock_transfers', 'series_counters'], () => {
    const t = productionOrdersDb.returnUnused(needOrder(p), { date: x.date, to: x.to, lines: [{ id: generateId(), item_id: p.fabric_item_id, qty, ...(p.fabric_batch ? { batch_no: p.fabric_batch } : {}) }] }, inputs);
    const row = { ...p, docs: { ...p.docs, return_id: t.id }, updated_at: new Date().toISOString() };
    putPlan(row);
    return row;
  });
}

/**
 * Cut waste to stock: a stock journal tagged with the order — `waste_m` metres of fabric consumed from the WIP godown
 * produce `cut_waste_kg` of the waste item (B3 class `textile_waste`) at `rate` ₹ / kg (its scrap rate).
 */
export function writeCutWaste(id: string, x: { date: string; waste_m: number; rate?: number }, items: readonly StockItem[], inputs: StockInputs): CutPlan {
  requireAccess('books.edit');
  const p = cutPlanOf(id);
  if (!p) throw new Error('Cut plan not found.');
  const orderId = needOrder(p);
  const o = productionOrdersDb.get(orderId);
  if (!o?.wip_godown_id) throw new Error('Release the production order first.');
  if (!p.waste_item_id || !(num(p.cut_waste_kg) > 0)) throw new Error('Enter the cut waste (kg) and its waste item.');
  if (!(num(x.waste_m) > 0)) throw new Error('Enter the fabric metres that became waste.');
  if (p.docs?.waste_id) throw new Error(`${p.number}: the waste is already in stock.`);
  return withTablesRollback([T, SJ_TABLE, 'series_counters'], () => {
    const j = stockJournalsDb.save({
      date: x.date, consume: [{ id: generateId(), item_id: p.fabric_item_id, qty: r3(num(x.waste_m)), godown_id: o.wip_godown_id }],
      produce: [{ id: generateId(), item_id: p.waste_item_id!, qty: r3(num(p.cut_waste_kg)), rate: Math.max(num(x.rate), 0) }],
      costs: [], production_order_id: orderId, narration: `Cut waste of ${p.number}`,
    } as Parameters<typeof stockJournalsDb.save>[0], items, inputs);
    const row = { ...p, docs: { ...p.docs, waste_id: j.id }, updated_at: new Date().toISOString() };
    putPlan(row);
    return row;
  });
}
