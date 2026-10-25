/**
 * Kitchen order tickets (R3-A2). Pure.
 *
 *  - Send KOT prints only what was added since the last ticket: per line, ordered quantity minus the
 *    quantity already sent (Σ the line's KOT quantities, cancellations negative, plus a transfer's
 *    `sent_offset`), grouped by kitchen station (stock group → station map, unmapped → "Kitchen").
 *  - KOT numbers are `K<n>`, restarting each local day across all orders. Not a tax document and not in
 *    `series_counters`.
 *  - Reducing / removing a line below what the kitchen already has needs a reason and prints a
 *    cancellation ticket to the station; `{ line, qty, reason, by, at }` goes into the order log. A
 *    clerk's cancellations above the company cap (default 2 lines or ₹ 500 per order) need the owner's PIN.
 *  - The KOT register (by day / captain / station) and the leakage view (cancellations, moves,
 *    transfers, merges) read `table_orders` only.
 */
import type {
  CancelReason, Kot, KotLine, OrderLine, RestaurantSettings, TableOrder,
} from '../../types/restaurant';
import { num, round2 } from '../invoice-calc';
import { KITCHEN, sentFromKots } from './tables';
import { center, columnsFor, lr, wrap, type ReceiptWidth } from '../escpos';

export const CANCEL_REASONS: readonly CancelReason[] = ['wrong_order', 'customer_cancelled', 'out_of_stock', 'other'];
export const DEFAULT_CANCEL_CAP = { lines: 2, amount: 500 } as const;

/** Quantity of a line the kitchen already has. */
export function sentQty(order: Pick<TableOrder, 'kots' | 'lines'>, lineId: string): number {
  const line = order.lines.find((l) => l.id === lineId);
  return round2(sentFromKots(order, lineId) + num(line?.sent_offset));
}

/** Station of a line: the station mapped to its stock group, else "Kitchen". */
export function stationFor(line: Pick<OrderLine, 'group_id'>, settings: Pick<RestaurantSettings, 'stations'> | null | undefined): string {
  const s = line.group_id ? settings?.stations?.[line.group_id] : undefined;
  return s?.trim() || KITCHEN;
}

/** Lines not yet sent (quantity diff > 0); a modifier child goes to its parent's station. */
export function pendingLines(order: TableOrder): { line: OrderLine; qty: number }[] {
  const out: { line: OrderLine; qty: number }[] = [];
  for (const l of order.lines) {
    const diff = round2(num(l.quantity) - sentQty(order, l.id));
    if (diff > 1e-9) out.push({ line: l, qty: diff });
  }
  return out;
}

export const hasPending = (order: TableOrder): boolean => pendingLines(order).length > 0;

/** Pending lines grouped by station (insertion order of stations; children follow their parent). */
export function byStation(order: TableOrder, settings: Pick<RestaurantSettings, 'stations'> | null | undefined): Map<string, KotLine[]> {
  const parentOf = new Map(order.lines.map((l) => [l.id, l]));
  const map = new Map<string, KotLine[]>();
  for (const { line, qty } of pendingLines(order)) {
    const parent = line.modifier_of ? parentOf.get(line.modifier_of) : undefined;
    const station = stationFor(parent ?? line, settings);
    const kl: KotLine = { line_id: line.id, name: line.modifier_of ? `+ ${line.name}` : line.name, qty: round2(qty) };
    if (line.unit && line.unit !== 'NOS') kl.unit = line.unit;
    if (line.note) kl.note = line.note;
    if (line.seat) kl.seat = line.seat;
    map.set(station, [...(map.get(station) ?? []), kl]);
  }
  return map;
}

/** Highest KOT number used on `day` across every order, + 1. */
export function nextKotNumber(orders: readonly Pick<TableOrder, 'kots'>[], day: string): number {
  let max = 0;
  for (const o of orders) for (const k of o.kots) if (k.day === day) max = Math.max(max, Number(k.number.replace(/\D/g, '')) || 0);
  return max + 1;
}

/** Build the tickets for every pending line (one per station) and append them to the order. */
export function sendKot(
  order: TableOrder,
  allOrders: readonly TableOrder[],
  settings: Pick<RestaurantSettings, 'stations'> | null | undefined,
  ctx: { by: string; at: string; day: string; newId: () => string },
): { order: TableOrder; kots: Kot[] } {
  const groups = byStation(order, settings);
  if (!groups.size) return { order, kots: [] };
  let n = nextKotNumber(allOrders.some((o) => o.id === order.id) ? allOrders : [...allOrders, order], ctx.day);
  const kots: Kot[] = [];
  for (const [station, lines] of groups) {
    kots.push({ id: ctx.newId(), number: `K${n++}`, day: ctx.day, at: ctx.at, by: ctx.by, station, kind: 'new', lines });
  }
  return {
    order: { ...order, kots: [...order.kots, ...kots], log: [...order.log, { at: ctx.at, by: ctx.by, kind: 'kot', note: kots.map((k) => `${k.number} ${k.station}`).join(', ') }] },
    kots,
  };
}

/* ── Cancellations ───────────────────────────────────────────── */

/** True when setting `lineId` to `newQty` takes away quantity the kitchen already has (reason needed). */
export function cancelNeedsReason(order: TableOrder, lineId: string, newQty: number): boolean {
  return Math.max(num(newQty), 0) < sentQty(order, lineId) - 1e-9;
}

/** Cancellations already on the order: lines and value (for the PIN cap). */
export function cancelledSoFar(order: Pick<TableOrder, 'log'>): { lines: number; value: number } {
  const rows = order.log.filter((e) => e.kind === 'cancel');
  return { lines: rows.length, value: round2(rows.reduce((s, e) => s + num(e.value), 0)) };
}

/**
 * Does this cancellation need the owner's PIN? Only for a non-owner, and only when it takes the
 * order past the cap (lines or value).
 */
export function needsOwnerPin(
  role: string,
  order: Pick<TableOrder, 'log'>,
  value: number,
  cap: { lines: number; amount: number } = DEFAULT_CANCEL_CAP,
  lines = 1,
): boolean {
  if (role === 'owner') return false;
  const so = cancelledSoFar(order);
  return so.lines + Math.max(lines, 1) > Math.max(num(cap.lines), 0) || round2(so.value + num(value)) > Math.max(num(cap.amount), 0);
}

export interface ChangeQtyInput {
  lineId: string;
  /** New quantity (0 removes the line). */
  qty: number;
  reason?: CancelReason;
  note?: string;
  by: string;
  at: string;
  day: string;
  newId: () => string;
}

/**
 * Change a line's quantity. Below the sent quantity it needs a reason and returns the cancellation
 * ticket (to the line's station) and a log row. A removed line also removes its modifier children
 * (their sent part is cancelled on the same ticket).
 */
export function changeQty(
  order: TableOrder,
  allOrders: readonly TableOrder[],
  settings: Pick<RestaurantSettings, 'stations'> | null | undefined,
  input: ChangeQtyInput,
): { order: TableOrder; kot?: Kot } {
  const line = order.lines.find((l) => l.id === input.lineId);
  if (!line) throw new Error('This line is no longer on the order.');
  const qty = round2(Math.max(num(input.qty), 0));
  const needs = cancelNeedsReason(order, line.id, qty);
  if (needs && !input.reason) throw new Error('Pick a reason to cancel what the kitchen already has.');
  const ratio = num(line.quantity) > 0 ? qty / num(line.quantity) : 0;
  const children = order.lines.filter((l) => l.modifier_of === line.id);
  const touched = [line, ...children];
  const cancelLines: KotLine[] = [];
  let value = 0;
  const nextQty = new Map<string, number>();
  for (const l of touched) {
    const nq = l.id === line.id ? qty : round2(num(l.quantity) * ratio);
    nextQty.set(l.id, nq);
    const cut = round2(sentQty(order, l.id) - nq);
    if (cut > 1e-9) {
      cancelLines.push({ line_id: l.id, name: l.modifier_of ? `+ ${l.name}` : l.name, qty: cut, ...(l.note ? { note: l.note } : {}) });
      value += cut * num(l.rate);
    }
  }
  const lines = order.lines
    .map((l) => (nextQty.has(l.id) ? { ...l, quantity: nextQty.get(l.id) as number, amount: round2((nextQty.get(l.id) as number) * num(l.rate)) } : l))
    .filter((l) => num(l.quantity) > 1e-9);
  let kot: Kot | undefined;
  const log = [...order.log];
  if (cancelLines.length) {
    const station = stationFor(line, settings);
    const n = nextKotNumber(allOrders.some((o) => o.id === order.id) ? allOrders : [...allOrders, order], input.day);
    kot = { id: input.newId(), number: `K${n}`, day: input.day, at: input.at, by: input.by, station, kind: 'cancel', lines: cancelLines, ...(input.reason ? { reason: input.reason } : {}) };
    log.push({ at: input.at, by: input.by, kind: 'cancel', line: line.name, qty: round2(sentQty(order, line.id) - qty), value: round2(value), reason: input.reason, ...(input.note?.trim() ? { note: input.note.trim() } : {}) });
  }
  // Lines brought to zero leave the order; their KOT history stays (the register keeps every ticket).
  return { order: { ...order, lines, kots: kot ? [...order.kots, kot] : order.kots, log }, ...(kot ? { kot } : {}) };
}

/* ── Ticket text ─────────────────────────────────────────────── */

export interface TicketContext {
  /** "Table 4" / "Token 12" / "Swiggy 12". */
  where: string;
  covers?: number;
  captain?: string;
  /** Local time text, e.g. "8:42 pm". */
  time: string;
  duplicate?: boolean;
}

/** KOT as text lines at 32 / 48 columns. No prices. */
export function ticketLines(kot: Kot, ctx: TicketContext, width: ReceiptWidth): string[] {
  const cols = columnsFor(width);
  const rule = '-'.repeat(cols);
  const L: string[] = [];
  if (ctx.duplicate) L.push(center('*** DUPLICATE ***', cols));
  L.push(center(kot.kind === 'cancel' ? `CANCEL KOT ${kot.number}` : `KOT ${kot.number}`, cols));
  L.push(center(kot.station.toUpperCase(), cols));
  L.push(lr(ctx.where, ctx.time, cols));
  const who = [ctx.covers ? `Covers ${ctx.covers}` : '', ctx.captain ? `Captain ${ctx.captain}` : ''].filter(Boolean).join('  ');
  if (who) L.push(...wrap(who, cols));
  if (kot.kind === 'cancel' && kot.reason) L.push(...wrap(`Reason: ${kot.reason.replace(/_/g, ' ')}`, cols));
  L.push(rule);
  for (const l of kot.lines) {
    const q = `${kot.kind === 'cancel' ? '-' : ''}${num(l.qty)}${l.unit ? ` ${l.unit}` : ''}`;
    const name = wrap(`${l.name}${l.seat ? ` (seat ${l.seat})` : ''}`, Math.max(cols - q.length - 1, 8));
    name.forEach((t, i) => L.push(i === 0 ? lr(t, q, cols) : t));
    if (l.note) for (const t of wrap(`  * ${l.note}`, cols)) L.push(t);
  }
  L.push(rule);
  return L;
}

/* ── Register & leakage ──────────────────────────────────────── */

export interface KotRegisterRow {
  day: string;
  number: string;
  station: string;
  captain: string;
  where: string;
  kind: 'new' | 'cancel';
  items: number;
  qty: number;
  reason?: string;
}

export interface LeakageRow {
  day: string;
  at: string;
  kind: 'cancel' | 'move' | 'transfer' | 'merge' | 'void' | 'reopen';
  by: string;
  where: string;
  line?: string;
  qty?: number;
  value?: number;
  reason?: string;
  from?: string;
  to?: string;
}

export interface KotRegister {
  rows: KotRegisterRow[];
  leakage: LeakageRow[];
  byStation: Record<string, { kots: number; qty: number; cancels: number }>;
  byCaptain: Record<string, { kots: number; cancels: number; cancelValue: number }>;
  totals: { kots: number; cancels: number; cancelValue: number; moves: number };
}

export interface RegisterFilter {
  from: string;
  to: string;
  station?: string;
  captain?: string;
}

export function kotRegister(orders: readonly TableOrder[], filter: RegisterFilter, whereOf: (o: TableOrder) => string = (o) => o.table_id ?? `#${o.token ?? ''}`): KotRegister {
  const reg: KotRegister = { rows: [], leakage: [], byStation: {}, byCaptain: {}, totals: { kots: 0, cancels: 0, cancelValue: 0, moves: 0 } };
  const inRange = (d: string) => d >= filter.from && d <= filter.to;
  for (const o of orders) {
    const where = whereOf(o);
    const seen = new Set<string>();
    for (const k of o.kots) {
      // A merged order carries the source's tickets (the source keeps none); count each ticket once.
      if (seen.has(k.id) || !inRange(k.day)) continue;
      seen.add(k.id);
      if (filter.station && k.station !== filter.station) continue;
      if (filter.captain && k.by !== filter.captain) continue;
      const qty = round2(k.lines.reduce((s, l) => s + num(l.qty), 0));
      reg.rows.push({ day: k.day, number: k.number, station: k.station, captain: k.by, where, kind: k.kind, items: k.lines.length, qty, ...(k.reason ? { reason: k.reason } : {}) });
      const st = (reg.byStation[k.station] ??= { kots: 0, qty: 0, cancels: 0 });
      const cp = (reg.byCaptain[k.by || '—'] ??= { kots: 0, cancels: 0, cancelValue: 0 });
      if (k.kind === 'cancel') {
        st.cancels++;
        cp.cancels++;
      } else {
        st.kots++;
        st.qty = round2(st.qty + qty);
        cp.kots++;
        reg.totals.kots++;
      }
    }
    for (const e of o.log) {
      const day = e.at ? localDayOfIso(e.at) : o.day;
      if (!inRange(day)) continue;
      if (filter.captain && e.by !== filter.captain) continue;
      if (e.kind === 'cancel' || e.kind === 'move' || e.kind === 'transfer' || e.kind === 'merge' || e.kind === 'void' || e.kind === 'reopen') {
        if (e.kind === 'merge' && e.note === 'merged') continue; // logged on both orders: keep the target's row
        reg.leakage.push({
          day, at: e.at, kind: e.kind, by: e.by, where,
          ...(e.line ? { line: e.line } : {}), ...(e.qty !== undefined ? { qty: e.qty } : {}), ...(e.value !== undefined ? { value: e.value } : {}),
          ...(e.reason ? { reason: String(e.reason) } : {}), ...(e.from ? { from: e.from } : {}), ...(e.to ? { to: e.to } : {}),
        });
        if (e.kind === 'cancel') {
          reg.totals.cancels++;
          reg.totals.cancelValue = round2(reg.totals.cancelValue + num(e.value));
          const cp = (reg.byCaptain[e.by || '—'] ??= { kots: 0, cancels: 0, cancelValue: 0 });
          cp.cancelValue = round2(cp.cancelValue + num(e.value));
        } else if (e.kind === 'move' || e.kind === 'transfer' || e.kind === 'merge') reg.totals.moves++;
      }
    }
  }
  reg.rows.sort((a, b) => a.day.localeCompare(b.day) || Number(a.number.slice(1)) - Number(b.number.slice(1)));
  reg.leakage.sort((a, b) => a.at.localeCompare(b.at));
  return reg;
}

/** The local day of an ISO timestamp. */
export function localDayOfIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Rows for CSV / XLSX export of the register and the leakage view. */
export function registerSheet(reg: KotRegister): unknown[][] {
  return [
    ['KOT register'],
    ['Day', 'KOT', 'Station', 'Captain', 'Table / token', 'Kind', 'Items', 'Qty', 'Reason'],
    ...reg.rows.map((r) => [r.day, r.number, r.station, r.captain, r.where, r.kind === 'cancel' ? 'Cancellation' : 'KOT', r.items, r.qty, r.reason ?? '']),
    [],
    ['Leakage (cancellations, moves, transfers, merges)'],
    ['Day', 'Time', 'Kind', 'By', 'Table / token', 'Item', 'Qty', 'Value', 'Reason', 'From', 'To'],
    ...reg.leakage.map((r) => [r.day, r.at, r.kind, r.by, r.where, r.line ?? '', r.qty ?? '', r.value ?? '', r.reason ?? '', r.from ?? '', r.to ?? '']),
    [],
    ['KOTs', reg.totals.kots, 'Cancellations', reg.totals.cancels, 'Cancelled value', reg.totals.cancelValue, 'Moves / transfers / merges', reg.totals.moves],
  ];
}
