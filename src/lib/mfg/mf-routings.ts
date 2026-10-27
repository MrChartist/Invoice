/**
 * MF-A2 routings (table `routings`, `master.edit`, audited): the operations an item goes through — work centre, set-up,
 * run time per unit (or units per hour), batch size for batch operations (ovens, coating), move time, inspection, piece
 * rate. One default routing per item. Release of a production order copies the default routing onto the order
 * (`ProductionOrder.mf.ops`, a snapshot) with planned hours = (set-up + run) ÷ efficiency; a routing changed later never
 * changes a released order. Standard conversion per unit = Σ planned hours × machine-hour rate ÷ planned qty.
 * Pure helpers above the storage divider.
 */
import './mf-registry';
import type { MfOrderOp, Routing, RoutingOp, WorkCentre } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import { num, round2 } from '../invoice-calc';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { impliedPacks } from '../shop-mode';
import { localDb } from '../localDb';
import { parseTable, toCsv } from '../csv';
import { machineHourRate } from './mf-centres';
import { MF_TABLES } from './mf-shared';

/** Run minutes for `qty` units: per batch (ceil(qty ÷ batch) × minutes per batch) or per unit / units per hour. */
export function runMinutes(op: Pick<RoutingOp, 'run_min_per_unit' | 'run_units_per_hour' | 'batch_size'>, qty: number): number {
  const q = Math.max(num(qty), 0);
  if (num(op.batch_size) > 0) return Math.ceil(q / num(op.batch_size)) * Math.max(num(op.run_min_per_unit), 0);
  const per = num(op.run_min_per_unit) > 0 ? num(op.run_min_per_unit) : num(op.run_units_per_hour) > 0 ? 60 / num(op.run_units_per_hour) : 0;
  return q * per;
}

/** Planned hours of an operation for `qty` units on its centre: (set-up + run) ÷ efficiency, 2 decimals. */
export function plannedHours(op: Pick<RoutingOp, 'setup_min' | 'run_min_per_unit' | 'run_units_per_hour' | 'batch_size'>, qty: number, centre?: Pick<WorkCentre, 'efficiency_pct'>): number {
  const eff = num(centre?.efficiency_pct, 100) > 0 ? num(centre?.efficiency_pct, 100) / 100 : 1;
  return round2((Math.max(num(op.setup_min), 0) + runMinutes(op, qty)) / 60 / eff);
}

/** The order's operations for a planned quantity (snapshot copied at release). */
export function opsForQty(r: Pick<Routing, 'ops'>, qty: number, centres: readonly WorkCentre[]): MfOrderOp[] {
  const byId = new Map(centres.map((c) => [c.id, c]));
  return [...r.ops].sort((a, b) => a.seq - b.seq).map((op) => {
    const c = byId.get(op.work_centre_id);
    return { ...op, planned_hours: plannedHours(op, qty, c), rate: c ? machineHourRate(c) : 0 };
  });
}

/** Standard conversion per finished unit from the operations: Σ planned hours × rate ÷ qty (2 decimals). */
export function standardConversion(ops: readonly Pick<MfOrderOp, 'planned_hours' | 'rate'>[], qty: number): number {
  return num(qty) > 0 ? round2(ops.reduce((s, o) => s + num(o.planned_hours) * num(o.rate), 0) / num(qty)) : 0;
}

/** Refusal text, or '' when the routing may be saved. */
export function validateRouting(r: Partial<Routing>, centres: readonly Pick<WorkCentre, 'id'>[]): string {
  if (!r.item_id) return 'Pick the item this routing makes.';
  if (!r.name?.trim()) return 'Name the routing.';
  if (!r.ops?.length) return 'Add at least one operation.';
  const seqs = new Set<number>();
  for (const op of r.ops) {
    if (!op.name?.trim()) return 'Name every operation.';
    if (!centres.some((c) => c.id === op.work_centre_id)) return `Operation ${op.name}: pick a work centre.`;
    for (const k of ['setup_min', 'run_min_per_unit', 'run_units_per_hour', 'batch_size', 'move_min', 'piece_rate'] as const) if (num(op[k]) < 0) return `Operation ${op.name}: times and rates cannot be negative.`;
    if (!Number.isInteger(op.seq) || op.seq <= 0) return `Operation ${op.name}: the sequence is a whole number.`;
    if (seqs.has(op.seq)) return `Sequence ${op.seq} is used twice.`;
    seqs.add(op.seq);
  }
  return '';
}

/* ── CSV / XLSX (one row per operation) ───────────────────────── */

const HEAD = ['Item', 'Routing', 'Seq', 'Operation', 'Work centre', 'Setup min', 'Run min per unit', 'Units per hour', 'Batch size', 'Move min', 'Inspection', 'Piece rate'];

/** One row per operation (item and centre by name). */
export function routingsCsv(rows: readonly Routing[], itemName: (id: string) => string, centres: readonly WorkCentre[]): string {
  const cn = (id: string) => centres.find((c) => c.id === id)?.name ?? '';
  return toCsv([HEAD, ...rows.flatMap((r) => r.ops.map((o) => [itemName(r.item_id), r.name, o.seq, o.name, cn(o.work_centre_id), o.setup_min, o.run_min_per_unit ?? '', o.run_units_per_hour ?? '', o.batch_size ?? '', o.move_min ?? '', o.inspection ? 'yes' : '', o.piece_rate ?? '']))]);
}

/** Parse a CSV (or an XLSX converted to CSV) back into routings; unknown items / centres are reported, not created. */
export function routingsFromCsv(text: string, itemId: (name: string) => string | undefined, centres: readonly WorkCentre[]): { routings: Omit<Routing, 'id'>[]; errors: string[] } {
  const t = parseTable(text);
  const col = (h: string) => t.headers.findIndex((x) => x.trim().toLowerCase() === h.toLowerCase());
  const at = HEAD.map(col);
  const errors: string[] = [];
  const by = new Map<string, Omit<Routing, 'id'>>();
  t.rows.forEach((row, i) => {
    const cell = (k: number) => (at[k] >= 0 ? (row[at[k]] ?? '').trim() : '');
    const item = itemId(cell(0));
    const centre = centres.find((c) => c.name.toLowerCase() === cell(4).toLowerCase());
    if (!item || !centre) return errors.push(`Row ${i + 2}: ${!item ? `item "${cell(0)}"` : `work centre "${cell(4)}"`} not found.`);
    const key = `${item}|${cell(1)}`;
    const r = by.get(key) ?? { item_id: item, name: cell(1) || 'Routing', is_default: true, ops: [] };
    const n = (k: number) => (cell(k) === '' ? undefined : num(cell(k)));
    r.ops.push({ id: generateId(), seq: num(cell(2)) || r.ops.length * 10 + 10, name: cell(3) || 'Operation', work_centre_id: centre.id, setup_min: n(5) ?? 0, run_min_per_unit: n(6), run_units_per_hour: n(7), batch_size: n(8), move_min: n(9), inspection: /^(y|yes|1|true)$/i.test(cell(10)) || undefined, piece_rate: n(11) });
    by.set(key, r);
  });
  return { routings: [...by.values()], errors };
}

/* ── Storage ───────────────────────────────────────────────────── */

const T = MF_TABLES.routings;
export const loadRoutings = (): Routing[] => getTable<Routing>(T).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.ops));

/** The item's default routing (else its only one). */
export function defaultRoutingOf(itemId: string, rows: readonly Routing[] = peekTable<Routing>(T)): Routing | undefined {
  const mine = rows.filter((r) => r?.item_id === itemId && Array.isArray(r.ops));
  return mine.find((r) => r.is_default) ?? (mine.length === 1 ? mine[0] : undefined);
}

/** Save a routing (master.edit). Marking it default clears the item's other default. */
export function saveRouting(input: Omit<Routing, 'id'> & { id?: string }): Routing {
  requireAccess('master.edit');
  const centres = peekTable<WorkCentre>(MF_TABLES.centres);
  const bad = validateRouting(input, centres);
  if (bad) throw new Error(bad);
  const all = loadRoutings();
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const now = new Date().toISOString();
  const first = !all.some((r) => r.item_id === input.item_id && r.id !== prev?.id);
  const row: Routing = {
    ...prev, ...input, id: prev?.id ?? generateId(), name: input.name.trim().slice(0, 60), is_default: input.is_default || first,
    ops: [...input.ops].sort((a, b) => a.seq - b.seq).map((o) => ({ ...o, id: o.id || generateId(), name: o.name.trim().slice(0, 60), setup_min: num(o.setup_min) })),
    created_at: prev?.created_at ?? now, updated_at: now,
  };
  const rest = all.map((r) => (r.id === row.id ? row : row.is_default && r.item_id === row.item_id && r.is_default ? { ...r, is_default: false } : r));
  setTable(T, prev ? rest : [...rest, row]);
  return row;
}

/** Delete a routing (recycle bin); released orders keep their own copy of the operations. */
export function removeRouting(id: string): void {
  requireAccess('master.edit');
  setTable(T, loadRoutings().filter((r) => r.id !== id));
}

/** True when the company has the shop-floor pack on (read once per call; no table is read otherwise). */
export const shopfloorOn = (): boolean => impliedPacks(localDb.settings.get()).includes('shopfloor');

/**
 * The operations a release copies onto the order: the item's default routing for the planned quantity, only while the
 * `shopfloor` pack is on (else `undefined`, and the order is released exactly as before).
 */
export function opsForRelease(order: Pick<ProductionOrder, 'item_id' | 'planned_qty'>): MfOrderOp[] | undefined {
  if (!shopfloorOn()) return undefined;
  const r = defaultRoutingOf(order.item_id);
  return r?.ops.length ? opsForQty(r, num(order.planned_qty), peekTable<WorkCentre>(MF_TABLES.centres)) : undefined;
}

/**
 * A5 / A2: the Material Out prefill for an `outside` operation (job work): the centre's vendor, the order's item and the
 * quantity, as the `mfout` query the job-work tab reads (`vendor~item~qty~process`).
 */
export function outsideSendHref(op: Pick<RoutingOp, 'name' | 'work_centre_id'>, order: Pick<ProductionOrder, 'item_id' | 'planned_qty'>, centres: readonly WorkCentre[], qty = num(order.planned_qty)): string | null {
  const c = centres.find((x) => x.id === op.work_centre_id);
  if (c?.kind !== 'outside') return null;
  const v = [c.vendor_id ?? '', order.item_id, String(qty), op.name].map(encodeURIComponent).join('~');
  return `/manufacturing?tab=jobwork&jw=out&mfout=${v}`;
}

/** A4: manufacturing lead days of an item = its default routing's hours for `qty` ÷ the slowest centre's daily hours, rounded up. */
export function makeDaysOf(itemId: string, qty = 1): number {
  const r = defaultRoutingOf(itemId);
  if (!r?.ops.length) return 0;
  const centres = peekTable<WorkCentre>(MF_TABLES.centres);
  const ops = opsForQty(r, qty, centres);
  const daily = ops.map((o) => centres.find((c) => c.id === o.work_centre_id)).map((c) => (c ? c.shifts.reduce((s, x) => s + num(x.hours), 0) * Math.max(num(c.capacity_units, 1), 1) : 0)).filter((h) => h > 0);
  const hours = ops.reduce((s, o) => s + o.planned_hours, 0);
  return daily.length ? Math.ceil(hours / Math.min(...daily)) : 0;
}
