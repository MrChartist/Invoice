/**
 * Serial-tracked items on stock vouchers (7S, roadmap 7.37 / 7.73): Manufacturing Journal components are consumed
 * by serial and the finished units (and by-products) receive new serials; Stock Journal source / destination lines
 * likewise; job work sends serials to the job worker's godown and gets them back (returned, supplied, consumed,
 * lost) or receives processed goods under new serials.
 *
 * Rules (the same as bills / sales in stock-tracking.ts, checked on the voucher date with `dayWindow`):
 *  - a serial-tracked line is in whole units of the item's base unit and lists exactly one serial per unit;
 *  - an outgoing serial (consumed / sent / returned) must be in stock — in the named godown — at the end of the day
 *    and must not be needed by a later entry (sold or moved later);
 *  - an incoming serial (produced / processed) must not be in stock on that day nor received again later;
 *  - a serial appears once per voucher.
 *
 * Pure: callers pass stock inputs with the voucher's own saved copy left out.
 */
import type { StockEvent, StockInputs, StockItem } from './inventory';
import { collectEvents } from './inventory';
import { num } from './invoice-calc';
import { lineFactor } from './units';
import { dayWindow, eventLabel, firstShortAfter, serialDelta } from './stock-timeline';

/** The fields of a voucher / job-work line the serial rules read. */
export interface SerialLine {
  item_id: string;
  qty: number;
  unit_factor?: number;
  serials?: string[];
  godown_id?: string;
}

const MAIN = 'main';
const key = (s: string) => s.trim().toUpperCase();
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** Trimmed, non-empty serials of a line. */
export function lineSerials(l: Pick<SerialLine, 'serials'>): string[] {
  return (l.serials ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
}

/** Shape of one serial-tracked line: whole base units, one serial per unit. '' when fine or not a serial item. */
export function serialLineShape(l: SerialLine, item: StockItem | undefined): string {
  if (!item?.track_serials) return '';
  if (lineFactor(l) !== 1) return `${item.name}: serial-tracked items are counted in ${item.unit || 'their base unit'} only.`;
  const q = num(l.qty);
  if (!Number.isInteger(q)) return `${item.name}: serial-tracked items move in whole units.`;
  const list = lineSerials(l);
  if (list.length !== q) return `${item.name}: list ${plural(q, 'serial number')}, one per unit (${list.length} given).`;
  return '';
}

/** First shape problem across lines (incl. a serial named twice on the voucher), or ''. */
export function serialShapeError(lines: readonly SerialLine[], items: readonly StockItem[]): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  for (const l of lines) {
    const item = byId.get(l.item_id);
    const err = serialLineShape(l, item);
    if (err) return err;
    if (!item?.track_serials) continue;
    for (const s of lineSerials(l)) {
      const k = `${item.id}|${key(s)}`;
      if (seen.has(k)) return `Serial ${s} appears twice on this voucher.`;
      seen.add(k);
    }
  }
  return '';
}

/** True when any line names a serial-tracked item (lets callers skip building events). */
export function touchesSerials(lines: readonly Pick<SerialLine, 'item_id'>[], items: readonly StockItem[]): boolean {
  const serial = new Set(items.filter((i) => i.track_stock && i.track_serials).map((i) => i.id));
  return serial.size > 0 && lines.some((l) => serial.has(l.item_id));
}

/** Serials leaving stock on `day` from a godown (`godownOf(line)`; undefined = company-wide check only). */
export function serialOutIssues(
  lines: readonly SerialLine[], day: string, events: Map<string, StockEvent[]>, items: readonly StockItem[],
  godownOf?: (l: SerialLine) => string | undefined,
): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const l of lines) {
    const item = byId.get(l.item_id);
    if (!item?.track_serials) continue;
    const evs = events.get(item.id) ?? [];
    for (const s of lineSerials(l)) {
      const w = dayWindow(evs, day, serialDelta(s));
      if (w.before.length === 0 && w.later.length === 0) out.push(`${item.name}: serial ${s} was never received into stock.`);
      else if (w.at < 1) out.push(`${item.name}: serial ${s} is not in stock on ${day}.`);
      else if (w.lowest < 1) out.push(`${item.name}: serial ${s} is sold or moved later on ${eventLabel(firstShortAfter(w, 1))}.`);
      else if (godownOf) {
        const g = godownOf(l);
        if (g === undefined) continue;
        const gw = dayWindow(evs, day, serialDelta(s, g));
        if (gw.at < 1) out.push(`${item.name}: serial ${s} is not in that godown on ${day}.`);
        else if (gw.lowest < 1) out.push(`${item.name}: serial ${s} leaves that godown later on ${eventLabel(firstShortAfter(gw, 1))}.`);
      }
    }
  }
  return out;
}

/** New serials coming into stock on `day` (production / processed goods). */
export function serialInIssues(lines: readonly SerialLine[], day: string, events: Map<string, StockEvent[]>, items: readonly StockItem[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const l of lines) {
    const item = byId.get(l.item_id);
    if (!item?.track_serials) continue;
    const evs = events.get(item.id) ?? [];
    for (const s of lineSerials(l)) {
      const w = dayWindow(evs, day, serialDelta(s));
      const again = w.later.find((r) => r.bal > 1)?.ev;
      if (w.at >= 1) out.push(`${item.name}: serial ${s} is already in stock.`);
      else if (again) out.push(`${item.name}: serial ${s} is received again later on ${eventLabel(again)}.`);
    }
  }
  return out;
}

/**
 * Stock checks for a voucher's serial lines on `day`: `consume` lines leave their godown (Main when none),
 * `produce` lines bring new serials. `input` must leave the voucher's saved copy out. [] when nothing is serial.
 */
export function voucherSerialIssues(x: {
  consume: readonly SerialLine[]; produce: readonly SerialLine[]; day: string; input: StockInputs; multiGodown?: boolean;
}): string[] {
  if (!touchesSerials([...x.consume, ...x.produce], x.input.items)) return [];
  const shape = serialShapeError([...x.consume, ...x.produce], x.input.items);
  if (shape) return [shape];
  const events = collectEvents({ ...x.input, includeTransfers: true });
  return [
    ...serialOutIssues(x.consume, x.day, events, x.input.items, x.multiGodown ? (l) => l.godown_id || MAIN : undefined),
    ...serialInIssues(x.produce, x.day, events, x.input.items),
  ];
}

/** Serials of an item in stock in one godown at the end of `day` (for pickers), sorted. */
export function serialsAvailable(itemId: string, day: string, godown: string | undefined, events: Map<string, StockEvent[]>): string[] {
  const seen = new Map<string, string>();
  for (const ev of events.get(itemId) ?? []) for (const s of ev.serials ?? []) if (!seen.has(key(s))) seen.set(key(s), s.trim());
  const evs = events.get(itemId) ?? [];
  return [...seen.values()]
    .filter((s) => {
      const w = dayWindow(evs, day, serialDelta(s, godown));
      return w.at >= 1 && w.lowest >= 1;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}
