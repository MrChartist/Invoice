/**
 * MF-C2 lots and bundles: a cut plan (the lot, `CUT/FY…`) splits its cut pieces into bundles `<lot>/<no>` (size, colour,
 * shade, pieces; stored inside the lot row). A bundle ticket's QR carries the id; a scan records an operation against
 * it (good = its live pieces unless edited, rejects leave the bundle with a reason). Lot status: pieces by operation and
 * place, WIP by size, finished, rejected. Finished bundles are reported as R4-A output journals — one per variant child
 * (size × colour), tagged with the order — so the stock engine sees ordinary manufacturing journals. Pure above "Storage".
 */
import type { StockItem, StockInputs } from '../inventory';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { num } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { bomsDb, manufacturingDb, MFG_TABLE } from '../manufacturing';
import { buildOutputVoucher, loadOrderDocs, orderProgress, productionOrdersDb, ORDERS_TABLE } from '../production/orders';
import { childFor } from './mf-styles';
import { cutPlanOf, loadCutPlans as getPlans, putPlan } from './mf-cutplans';
import type { CutPlan, MfBundle, MfBundleStep } from './mf-c-pending';

export const DEFAULT_BUNDLE_SIZE = 12;
export const bundleId = (lot: string, no: number) => `${lot}/${no}`;
export const livePieces = (b: Pick<MfBundle, 'pieces' | 'rejected'>) => Math.max(num(b.pieces) - num(b.rejected), 0);

/** `<lot>/<no>` → its parts (the lot itself contains slashes: `CUT/FY26-27/0014/7`). */
export function parseBundleId(code: string): { lot: string; no: number } | null {
  const m = /^(.+)\/(\d+)$/.exec(String(code ?? '').trim().toUpperCase());
  return m && /^CUT\/FY\d{2}-\d{2}\/\d+$/.test(m[1]) ? { lot: m[1], no: parseInt(m[2], 10) } : null;
}

/** Bundles of `size` pieces (the last of a size smaller), sizes in `order` (else the cut's order). */
export function makeBundles(p: Pick<CutPlan, 'cut' | 'colour'>, size = DEFAULT_BUNDLE_SIZE, order?: readonly string[], shade?: string): MfBundle[] {
  const per = Math.max(Math.floor(num(size)), 1);
  const sizes = [...(order ?? []).filter((s) => num(p.cut[s]) > 0), ...Object.keys(p.cut).filter((s) => !order?.includes(s))];
  const out: MfBundle[] = [];
  for (const s of sizes) {
    for (let left = Math.floor(num(p.cut[s])); left > 0; left -= per) {
      out.push({ no: out.length + 1, size: s, colour: p.colour, ...(shade ? { shade } : {}), pieces: Math.min(per, left), at: { where: 'floor' }, history: [] });
    }
  }
  return out;
}

export interface BundleStepInput {
  date: string;
  op?: string;
  op_id?: string;
  /** Good pieces (default: the bundle's live pieces). */
  good?: number;
  rejected?: number;
  reason?: string;
  by?: string;
  jc_entry_id?: string;
  /** The last operation: the bundle is finished. */
  last?: boolean;
}

/** Record an operation on bundle `no` (returns the new lot; refuses more pieces than the bundle holds). */
export function recordStep(p: CutPlan, no: number, x: BundleStepInput): CutPlan {
  const b = (p.bundles ?? []).find((y) => y.no === no);
  if (!b) throw new Error(`Bundle ${bundleId(p.number, no)} not found.`);
  if (b.at.where === 'finished' || b.at.where === 'rejected') throw new Error(`Bundle ${bundleId(p.number, no)} is ${b.at.where}.`);
  const live = livePieces(b);
  const rejected = Math.max(Math.floor(num(x.rejected)), 0);
  const good = x.good === undefined ? live - rejected : Math.max(Math.floor(num(x.good)), 0);
  if (good + rejected > live) throw new Error(`Bundle ${bundleId(p.number, no)} holds ${live} pieces.`);
  if (rejected && !x.reason?.trim()) throw new Error('Give the reason for the rejected pieces.');
  const step: MfBundleStep = { date: x.date, ...(x.op_id ? { op_id: x.op_id } : {}), ...(x.op ? { op: x.op } : {}), good, rejected, ...(x.reason ? { reason: x.reason.trim() } : {}), ...(x.by ? { by: x.by } : {}), ...(x.jc_entry_id ? { jc_entry_id: x.jc_entry_id } : {}) };
  const nextRej = num(b.rejected) + rejected;
  const gone = num(b.pieces) - nextRej <= 0;
  const next: MfBundle = { ...b, rejected: nextRej, history: [...b.history, step], at: { ...(x.op_id ? { op_id: x.op_id } : {}), ...(x.op ? { op: x.op } : {}), where: gone ? 'rejected' : x.last ? 'finished' : 'floor' } };
  return { ...p, bundles: (p.bundles ?? []).map((y) => (y.no === no ? next : y)) };
}

/** Bundles handed to a fabricator on a Material Out challan / back from him (C3). */
export function moveBundles(p: CutPlan, nos: readonly number[], at: MfBundle['at']): CutPlan {
  const set = new Set(nos);
  return { ...p, bundles: (p.bundles ?? []).map((b) => (set.has(b.no) ? { ...b, at } : b)) };
}

export interface LotStatus {
  cut: number;
  bundled: number;
  byPlace: Record<string, number>;
  byOp: Record<string, number>;
  wipBySize: Record<string, number>;
  finishedBySize: Record<string, number>;
  rejected: number;
  /** Cut − finished − rejected: pieces still on the way. */
  open: number;
}

export function lotStatus(p: Pick<CutPlan, 'cut' | 'bundles'>): LotStatus {
  const s: LotStatus = { cut: Object.values(p.cut ?? {}).reduce((a, q) => a + num(q), 0), bundled: 0, byPlace: {}, byOp: {}, wipBySize: {}, finishedBySize: {}, rejected: 0, open: 0 };
  const add = (m: Record<string, number>, k: string, q: number) => { if (q) m[k] = (m[k] ?? 0) + q; };
  for (const b of p.bundles ?? []) {
    const live = livePieces(b);
    s.bundled += num(b.pieces);
    s.rejected += num(b.rejected);
    add(s.byPlace, b.at.where, live);
    if (b.at.where === 'finished') add(s.finishedBySize, b.size, live);
    else if (live) {
      add(s.wipBySize, b.size, live);
      add(s.byOp, b.at.op ?? '—', live);
    }
  }
  s.open = s.cut - Object.values(s.finishedBySize).reduce((a, q) => a + q, 0) - s.rejected;
  return s;
}

/** Finished, not yet reported pieces by variant child (size × colour of the lot). */
export function finishedByVariant(p: CutPlan, parent: StockItem, all: readonly StockItem[]): { item_id: string; size: string; qty: number; nos: number[] }[] {
  const by = new Map<string, { item_id: string; size: string; qty: number; nos: number[] }>();
  for (const b of p.bundles ?? []) {
    if (b.at.where !== 'finished' || b.reported) continue;
    const child = childFor(parent, all, b.size, b.colour);
    if (!child) throw new Error(`${parent.name}: no variant for ${b.size} / ${b.colour}.`);
    const r = by.get(child.id) ?? { item_id: child.id, size: b.size, qty: 0, nos: [] };
    r.qty += livePieces(b);
    r.nos.push(b.no);
    by.set(child.id, r);
  }
  return [...by.values()].filter((r) => r.qty > 0);
}

/* ════════════════════════ Storage ════════════════════════ */

/** Generate (or regenerate, while no bundle was worked on) the lot's bundles. */
export function saveBundles(id: string, size: number, order?: readonly string[], shade?: string): CutPlan {
  requireAccess('doc.create');
  const p = cutPlanOf(id);
  if (!p) throw new Error('Cut plan not found.');
  if ((p.bundles ?? []).some((b) => b.history.length || b.at.where !== 'floor')) throw new Error(`${p.number}: bundles are already being worked on.`);
  const row = { ...p, bundle_size: Math.max(Math.floor(num(size)), 1), bundles: makeBundles(p, size, order, shade), updated_at: new Date().toISOString() };
  putPlan(row);
  return row;
}

/** A scanned / picked bundle: record the step and save. */
export function scanStep(code: string, x: BundleStepInput): { plan: CutPlan; bundle: MfBundle } {
  requireAccess('doc.create');
  const id = parseBundleId(code);
  if (!id) throw new Error(`${code}: not a bundle ticket.`);
  const p = getPlans().find((q) => q.number.toUpperCase() === id.lot);
  if (!p) throw new Error(`Lot ${id.lot} not found.`);
  const plan = { ...recordStep(p, id.no, x), updated_at: new Date().toISOString() };
  putPlan(plan);
  return { plan, bundle: plan.bundles!.find((b) => b.no === id.no)! };
}

/** Report the lot's finished bundles as output: one R4-A manufacturing journal per variant child, tagged with the order. */
export function reportFinished(id: string, date: string, items: readonly StockItem[], inputs: StockInputs): string[] {
  requireAccess('books.edit');
  const p = cutPlanOf(id);
  if (!p?.order_id) throw new Error('Link the lot to a production order first.');
  const order = productionOrdersDb.get(p.order_id);
  const parent = items.find((i) => i.id === p.style_id);
  if (!order || !parent) throw new Error('Order or style not found.');
  const rows = finishedByVariant(p, parent, items);
  if (!rows.length) throw new Error('No finished bundles to report.');
  const bom = bomsDb.all().find((b) => b.id === order.bom_id);
  return withTablesRollback([MFG_TABLE, 'cut_plans', ORDERS_TABLE, 'series_counters'], () => {
    const ids: string[] = [];
    let plan = p;
    for (const r of rows) {
      const draft = buildOutputVoucher(order, orderProgress(order, loadOrderDocs()), bom, { qty: r.qty, date }, generateId);
      const v = manufacturingDb.save({ ...draft, item_id: r.item_id, narration: `${draft.narration} — ${p.number} ${r.size}` }, items, inputs);
      ids.push(v.id);
      const nos = new Set(r.nos);
      plan = { ...plan, bundles: (plan.bundles ?? []).map((b) => (nos.has(b.no) ? { ...b, reported: v.id } : b)) };
    }
    putPlan({ ...plan, updated_at: new Date().toISOString() });
    return ids;
  });
}
