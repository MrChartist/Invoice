/**
 * Stock tracking dimensions: batches with MFG / expiry and FEFO (6.6), godowns with transfer
 * vouchers (6.10) and serial / IMEI numbers with warranty (6.11).
 *
 * Like the rest of inventory, nothing here is stored: every balance is derived on read from the
 * same events `collectEvents` builds for costing (opening, manual moves, invoice / credit-note /
 * challan lines, purchase lines), plus stock transfers. Costing stays company-wide and is computed
 * by `computeStock`, which never sees transfers; this module only counts units per dimension.
 *
 * All tracking is opt-in per stock item (`track_batches`, `track_serials`) and godown pickers
 * appear only once a second godown exists, so a simple user never sees any of it.
 *
 * Everything above the "Live data" divider is pure and unit-tested.
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import { pharmaGate, readPharmaSettings, saleLimitGate } from './pharma-gate';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer, type StockTransferLine } from '../types/stock';
import type { AppNotification } from './notifications';
import { num, round2 } from './invoice-calc';
import { shiftDay } from './dates';
import {
  buildItemIndex, cleanSerials, collectEvents, invoiceEffect, liveInputs, loadSettings,
  type MoveKind, type StockEvent, type StockInputs, type StockItem,
} from './inventory';
import { getTable } from './storage';
import { lineFactor } from './units';
import { creditNoteReturnsGoods } from './credit-restock';
import { GODOWNS_TABLE, TRANSFERS_TABLE, godownList, godownName, nonSaleableGodowns } from './godowns';
import { batchDelta, dayWindow, eventLabel, firstShortAfter, godownDelta, serialDelta } from './stock-timeline';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/** Case-insensitive identity of a serial / IMEI (display keeps what the user typed). */
export const serialKey = (s: string) => s.trim().toUpperCase();

/** One serial / IMEI per line (also splits on commas); trimmed, blanks dropped. */
export function parseSerials(text: string): string[] {
  return text.split(/[\n,;\t]+/).map((s) => s.trim()).filter(Boolean);
}

/** Serials that appear more than once in `list` (case-insensitive). */
export function duplicateSerials(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of list) {
    const k = serialKey(s);
    if (seen.has(k)) dup.add(s.trim());
    seen.add(k);
  }
  return [...dup];
}

/** A batch has expired once its expiry day is before `day` (it may still be sold ON its expiry day). */
export function isExpired(expiry: string | undefined, day: string): boolean {
  return !!expiry && expiry < day;
}

/** `YYYY-MM-DD` plus whole months, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonthsDay(day: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + Math.trunc(months);
  const y = Math.floor(total / 12);
  const mo = total - y * 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(Number(m[3]), last);
  return `${String(y).padStart(4, '0')}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Last day covered by a warranty of `months` from `saleDay` (sold 10 May 2026, 12 months → 9 May 2027). */
export function warrantyUntil(saleDay: string, months: number): string {
  if (!(num(months) > 0) || !saleDay) return '';
  return shiftDay(addMonthsDay(saleDay, num(months)), -1);
}

/* ── Derived state ───────────────────────────────────────────── */

export interface BatchInfo {
  batch: string;
  mfg?: string;
  expiry?: string;
  mrp?: number;
  /** First day stock came in on this batch (tie-break after expiry). */
  firstIn: string;
  qty: number;
  byGodown: Record<string, number>;
}

export interface SerialRef {
  kind: MoveKind;
  date: string;
  /** +1 stock in, -1 stock out. */
  dir: 1 | -1;
  godown: string;
  refType?: string;
  refId?: string;
  refNumber?: string;
  party?: string;
  warrantyMonths?: number;
}

export interface SerialState {
  serial: string;
  itemId: string;
  inStock: boolean;
  /** Godown it is in (or last left from). */
  godown: string;
  history: SerialRef[];
}

export interface ItemTracking {
  item: StockItem;
  qty: number;
  byGodown: Record<string, number>;
  /** Batch-tracked items; includes an '' bucket for unbatched stock. */
  batches: BatchInfo[];
  /** Serial-tracked items. */
  serials: SerialState[];
}

export type TrackingMap = Map<string, ItemTracking>;

function addTo(rec: Record<string, number>, key: string, q: number) {
  rec[key] = roundQty((rec[key] ?? 0) + q);
}

/** Per tracked item: units per godown, per batch (and godown), and the state of every serial. */
export function computeTracking(input: StockInputs): TrackingMap {
  const events = collectEvents({ ...input, includeTransfers: true });
  const out: TrackingMap = new Map();
  for (const item of input.items) {
    if (!item.track_stock) continue;
    const t: ItemTracking = { item, qty: 0, byGodown: {}, batches: [], serials: [] };
    const batches = new Map<string, BatchInfo>();
    const serials = new Map<string, SerialState>();
    for (const ev of events.get(item.id) ?? []) {
      runEvent(t, ev, batches, serials, !!item.track_batches, !!item.track_serials);
    }
    t.qty = roundQty(Object.values(t.byGodown).reduce((s, q) => s + q, 0));
    t.batches = [...batches.values()];
    t.serials = [...serials.values()];
    out.set(item.id, t);
  }
  return out;
}

function runEvent(
  t: ItemTracking, ev: StockEvent, batches: Map<string, BatchInfo>, serials: Map<string, SerialState>,
  trackBatches: boolean, trackSerials: boolean,
) {
  addTo(t.byGodown, ev.godown, ev.qty);
  if (trackBatches) {
    const key = ev.batch?.trim() ?? '';
    let b = batches.get(key.toUpperCase());
    if (!b) {
      b = { batch: key, firstIn: ev.qty > 0 ? ev.date : '', qty: 0, byGodown: {} };
      batches.set(key.toUpperCase(), b);
    }
    if (ev.qty > 0 && ev.kind !== 'transfer') {
      if (!b.firstIn || (ev.date && ev.date < b.firstIn)) b.firstIn = ev.date;
      // First recorded dates win; a later receipt of the same batch fills only what is missing.
      if (!b.expiry && ev.expiry) b.expiry = ev.expiry;
      if (!b.mfg && ev.mfg) b.mfg = ev.mfg;
      if (!b.mrp && ev.mrp) b.mrp = ev.mrp;
    }
    b.qty = roundQty(b.qty + ev.qty);
    addTo(b.byGodown, ev.godown, ev.qty);
  }
  if (trackSerials && ev.serials?.length) {
    for (const raw of ev.serials) {
      const k = serialKey(raw);
      let s = serials.get(k);
      if (!s) {
        s = { serial: raw.trim(), itemId: t.item.id, inStock: false, godown: ev.godown, history: [] };
        serials.set(k, s);
      }
      s.history.push({
        kind: ev.kind, date: ev.date, dir: ev.qty > 0 ? 1 : -1, godown: ev.godown, refType: ev.refType,
        refId: ev.refId, refNumber: ev.refNumber, party: ev.party, warrantyMonths: ev.warrantyMonths,
      });
      if (ev.kind === 'transfer') {
        // Both legs share a day and the "in" leg sorts first: only the destination matters.
        if (ev.qty > 0) s.godown = ev.godown;
        continue;
      }
      s.inStock = ev.qty > 0;
      s.godown = ev.godown;
    }
  }
}

/* ── Batches / FEFO ──────────────────────────────────────────── */

export interface BatchOption {
  batch: string;
  expiry?: string;
  mfg?: string;
  mrp?: number;
  /** Units available (in `godown` when one was given). */
  qty: number;
  expired: boolean;
}

/**
 * Batches with stock, in FEFO order: earliest expiry first, batches without an expiry after
 * them, then oldest receipt. `godown` limits to stock in that godown (omit = all godowns).
 * Expired batches are listed (flagged) after the sellable ones; unbatched stock is left out.
 */
export function batchOptions(t: ItemTracking | undefined, day: string, godown?: string): BatchOption[] {
  if (!t) return [];
  const rows: (BatchOption & { firstIn: string })[] = [];
  for (const b of t.batches) {
    if (!b.batch) continue;
    const qty = godown ? (b.byGodown[godown] ?? 0) : b.qty;
    if (qty <= EPS) continue;
    rows.push({
      batch: b.batch, expiry: b.expiry, mfg: b.mfg, mrp: b.mrp, qty: roundQty(qty),
      expired: isExpired(b.expiry, day), firstIn: b.firstIn,
    });
  }
  rows.sort((a, b) =>
    Number(a.expired) - Number(b.expired)
    || (a.expiry && b.expiry ? a.expiry.localeCompare(b.expiry) : a.expiry ? -1 : b.expiry ? 1 : 0)
    || a.firstIn.localeCompare(b.firstIn)
    || a.batch.localeCompare(b.batch));
  return rows.map(({ firstIn: _f, ...r }) => { void _f; return r; });
}

/** The FEFO suggestion: the first unexpired batch with stock, or undefined. */
export function fefoBatch(t: ItemTracking | undefined, day: string, godown?: string): BatchOption | undefined {
  return batchOptions(t, day, godown).find((b) => !b.expired);
}

/** Split `qty` across unexpired batches in FEFO order; `short` is what no batch can cover. */
export function fefoAllocate(
  t: ItemTracking | undefined, day: string, qty: number, godown?: string,
): { lines: BatchOption[]; short: number } {
  let rest = num(qty);
  const lines: BatchOption[] = [];
  for (const b of batchOptions(t, day, godown)) {
    if (rest <= EPS || b.expired) break;
    const take = Math.min(rest, b.qty);
    lines.push({ ...b, qty: roundQty(take) });
    rest -= take;
  }
  return { lines, short: roundQty(Math.max(rest, 0)) };
}

/** Invoice lines for a FEFO split of `line` (first keeps its id; quantities follow the batches). */
export function splitLineByFefo(line: InvoiceItem, t: ItemTracking | undefined, day: string, newId: () => string): InvoiceItem[] {
  // Batches hold base units; a line typed in an alternate unit (WP-8) is split back into its own unit.
  const f = lineFactor(line);
  const { lines, short } = fefoAllocate(t, day, num(line.quantity) * f, line.godown_id || undefined);
  if (lines.length === 0) return [line];
  const out = lines.map((b, i) => withBatch({ ...line, id: i === 0 ? line.id : newId(), quantity: roundQty(b.qty / f) }, b));
  if (short > EPS) out[out.length - 1] = { ...out[out.length - 1], quantity: roundQty(out[out.length - 1].quantity + short / f) };
  return out.map((l) => ({ ...l, amount: round2(num(l.quantity) * num(l.rate)) }));
}

/** A line stamped with a batch and its date snapshot (cleared fields are removed). */
export function withBatch(line: InvoiceItem, b: Pick<BatchOption, 'batch' | 'expiry' | 'mfg'> | undefined): InvoiceItem {
  const next: InvoiceItem = { ...line };
  delete next.batch_no;
  delete next.batch_expiry;
  delete next.batch_mfg;
  if (!b?.batch) return next;
  next.batch_no = b.batch;
  if (b.expiry) next.batch_expiry = b.expiry;
  if (b.mfg) next.batch_mfg = b.mfg;
  return next;
}

/* ── Serials ─────────────────────────────────────────────────── */

/** Serials in stock (in `godown` when given), sorted. */
export function serialsInStock(t: ItemTracking | undefined, godown?: string): string[] {
  if (!t) return [];
  return t.serials
    .filter((s) => s.inStock && (!godown || s.godown === godown))
    .map((s) => s.serial)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** Serials currently sold (out of stock), sorted — what a credit note can take back. */
export function serialsSold(t: ItemTracking | undefined): string[] {
  if (!t) return [];
  return t.serials.filter((s) => !s.inStock).map((s) => s.serial).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/* ── Godowns ─────────────────────────────────────────────────── */

export interface GodownRow {
  item: StockItem;
  byGodown: Record<string, number>;
  total: number;
}

/** Units per godown for every tracked item (godowns with no movement are absent / 0). */
export function godownSummary(tracking: TrackingMap): GodownRow[] {
  return [...tracking.values()]
    .map((t) => ({ item: t.item, byGodown: t.byGodown, total: t.qty }))
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** True when any stock event, bill line or invoice line uses `godownId`. */
export function godownInUse(tracking: TrackingMap, godownId: string): boolean {
  for (const t of tracking.values()) if (Object.prototype.hasOwnProperty.call(t.byGodown, godownId)) return true;
  return false;
}

/* ── Validation ──────────────────────────────────────────────── */

export interface TrackingIssues {
  /** Must be fixed before the document can be issued. */
  errors: string[];
  /** Expired batches on an outgoing document: the user must confirm to sell them. */
  expired: string[];
  /** Informational (batch running short). */
  warnings: string[];
}

/**
 * Documents that take goods out for batch / serial / godown purposes: every type the stock engine
 * treats as a sale (`invoiceEffect`: invoice, tax invoice, Bill of Supply, a row with no type) plus
 * delivery challans (checked whether or not challans move stock).
 */
export function isOutgoingDoc(docType: string | undefined): boolean {
  return invoiceEffect(docType, 'Sent', true) === 'out';
}

type DocInput = Pick<InvoiceRecord, 'doc_type' | 'items' | 'issue_date'> & Partial<Pick<InvoiceRecord, 'id' | 'status' | 'goods_returned' | 'notes'>>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Batch / serial / godown checks for a document about to be issued. Outgoing documents
 * (invoice, tax invoice, delivery challan) must name in-stock serials (count = quantity, never
 * one already sold) and a batch for batch-tracked items; expired batches are reported
 * separately so the editor can ask for confirmation. Credit notes may only take back serials
 * that are currently sold. The document's own saved copy is left out of the balances.
 */
export function docTrackingIssues(doc: DocInput, input: StockInputs, multiGodown = false): TrackingIssues {
  const issues: TrackingIssues = { errors: [], expired: [], warnings: [] };
  const docType = doc.doc_type;
  const outgoing = isOutgoingDoc(docType);
  // Only a credit note that returns goods takes serials / batches back (same rule as the stock engine).
  const incoming = docType === 'CREDIT_NOTE' && creditNoteReturnsGoods(doc, input.links);
  if (!outgoing && !incoming) return issues;
  if (doc.status === 'Draft' || doc.status === 'Cancelled') return issues;

  const tracked = input.items.filter((i) => i.track_stock && (i.track_batches || i.track_serials || multiGodown));
  if (tracked.length === 0) return issues;
  const index = buildItemIndex(input.items.filter((i) => i.track_stock));
  const tracking = computeTracking({ ...input, excludeInvoiceId: doc.id });
  // Point-in-time checks run on the dated events (stock-timeline.ts): availability at the end of
  // the document's day AND no later document depending on the same units.
  const events = collectEvents({ ...input, includeTransfers: true, excludeInvoiceId: doc.id });
  // Serials taken out by the challan this invoice was made from belong to this sale.
  const sourceRefs = new Set(
    doc.id ? (input.links ?? []).filter((l) => l.relation === 'converted' && l.to_id === doc.id).map((l) => l.from_id) : [],
  );
  const day = doc.issue_date || '';
  const seen = new Map<string, string>();
  const batchUse = new Map<string, number>();

  for (const line of doc.items ?? []) {
    const item = index.find(line.name, line.hsn);
    const q = num(line.quantity) * lineFactor(line); // base units (WP-8 alternate units)
    if (!item || q <= 0) continue;
    const t = tracking.get(item.id);
    const godown = line.godown_id || MAIN_GODOWN_ID;
    const label = item.name;

    if (item.track_serials) {
      const list = cleanSerials(line.serials) ?? [];
      if (outgoing || list.length) {
        if (!Number.isInteger(q)) issues.errors.push(`${label}: serial-tracked items are sold in whole units.`);
        else if (list.length !== q) issues.errors.push(`${label}: pick ${plural(q, 'serial number')} (${list.length} picked).`);
      }
      for (const s of list) {
        const k = serialKey(s);
        if (seen.has(k)) {
          issues.errors.push(`Serial ${s} appears twice on this document.`);
          continue;
        }
        seen.set(k, label);
        const evs = events.get(item.id) ?? [];
        const w = dayWindow(evs, day, serialDelta(s));
        if (outgoing) {
          if (w.before.length === 0 && w.later.length === 0) {
            issues.errors.push(`${label}: serial ${s} was never received into stock.`);
          } else if (w.at < 1) {
            const last = [...w.before].reverse().find((ev) => ev.qty < 0);
            const firstIn = w.later.find((r) => r.ev.qty > 0)?.ev;
            if (last?.refId && sourceRefs.has(last.refId)) continue;
            if (!last && firstIn) issues.errors.push(`${label}: serial ${s} is not in stock on ${day} (it was received on ${firstIn.date}).`);
            else issues.errors.push(`${label}: serial ${s} is not in stock${last?.refNumber ? ` (sold on ${last.refNumber})` : ''}.`);
          } else if (w.lowest < 1) {
            issues.errors.push(`${label}: serial ${s} is sold or moved later on ${eventLabel(firstShortAfter(w, 1))}, so it cannot leave stock on ${day}.`);
          } else if (multiGodown) {
            const g = dayWindow(evs, day, serialDelta(s, godown));
            if (g.at < 1) issues.errors.push(`${label}: serial ${s} is in another godown — transfer it first or change the line's godown.`);
            else if (g.lowest < 1) issues.errors.push(`${label}: serial ${s} leaves this godown later on ${eventLabel(firstShortAfter(g, 1))}.`);
          }
        } else if (w.at >= 1) {
          issues.errors.push(`${label}: serial ${s} is already in stock, so it cannot be returned.`);
        } else if (w.before.length === 0) {
          issues.errors.push(`${label}: serial ${s} was never sold.`);
        } else if (w.later.some((r) => r.bal + 1 > 1)) {
          issues.errors.push(`${label}: serial ${s} comes back into stock again on ${eventLabel(w.later.find((r) => r.bal + 1 > 1)?.ev)}.`);
        }
      }
    }

    if (item.track_batches && outgoing) {
      const options = batchOptions(t, day, multiGodown ? godown : undefined);
      const batch = line.batch_no?.trim();
      if (!batch) {
        if (options.length) {
          const fefo = options.find((o) => !o.expired);
          issues.errors.push(`${label}: choose a batch${fefo ? ` (first to expire: ${fefo.batch})` : ''}.`);
        }
      } else {
        const info = t?.batches.find((b) => b.batch.toUpperCase() === batch.toUpperCase());
        const expiry = info?.expiry ?? line.batch_expiry;
        if (isExpired(expiry, day)) issues.expired.push(`${label}: batch ${batch} expired on ${expiry}.`);
        const key = `${item.id}|${batch.toUpperCase()}|${multiGodown ? godown : ''}`;
        const used = (batchUse.get(key) ?? 0) + q;
        batchUse.set(key, used);
        // As of the sale date, and never below what later documents already take from the batch.
        const w = dayWindow(events.get(item.id) ?? [], day, batchDelta(batch, multiGodown ? godown : undefined));
        const have = Math.min(w.at, w.lowest);
        if (used > have + EPS) {
          const later = w.lowest < w.at - EPS ? ` on ${day} (later documents use the rest)` : '';
          issues.warnings.push(`${label}: only ${roundQty(Math.max(have, 0))} ${item.unit} left in batch ${batch}${later}.`);
        }
      }
    }
  }
  return issues;
}

/** Stock checks for a transfer: available in the source godown, batch named and stocked, serials in place. */
export function transferIssues(
  tr: Pick<StockTransfer, 'id' | 'date' | 'from_godown' | 'to_godown' | 'lines'>,
  input: StockInputs,
): string[] {
  const errors: string[] = [];
  const others = { ...input, transfers: (input.transfers ?? []).filter((x) => x.id !== tr.id) };
  const tracking = computeTracking(others);
  // As of the transfer date AND never below what later documents take from the source godown.
  const events = collectEvents({ ...others, includeTransfers: true });
  const day = tr.date || '9999-12-31';
  const want = new Map<string, number>();
  const seen = new Set<string>();
  for (const l of tr.lines ?? []) {
    const t = tracking.get(l.item_id);
    const q = num(l.qty) * lineFactor(l); // 7M: alternate unit
    if (!t || q <= 0) continue;
    const label = t.item.name;
    const key = `${l.item_id}|${t.item.track_batches ? (l.batch_no ?? '').toUpperCase() : ''}`;
    const total = (want.get(key) ?? 0) + q;
    want.set(key, total);
    if (t.item.track_batches) {
      const batch = l.batch_no?.trim();
      if (!batch) errors.push(`${label}: choose the batch to transfer.`);
      else {
        const w = dayWindow(events.get(l.item_id) ?? [], day, batchDelta(batch, tr.from_godown));
        const have = Math.min(w.at, w.lowest);
        if (total > have + EPS) errors.push(`${label}: only ${roundQty(Math.max(have, 0))} ${t.item.unit} of batch ${batch} in the source godown${w.lowest < w.at - EPS ? ' (later documents use the rest)' : ''}.`);
      }
    } else {
      const w = dayWindow(events.get(l.item_id) ?? [], day, godownDelta(tr.from_godown));
      const have = Math.min(w.at, w.lowest);
      if (total > have + EPS) errors.push(`${label}: only ${roundQty(Math.max(have, 0))} ${t.item.unit} in the source godown${w.lowest < w.at - EPS ? ` (later documents use the rest, e.g. ${eventLabel(firstShortAfter(w, total))})` : ''}.`);
    }
    if (t.item.track_serials) {
      const list = cleanSerials(l.serials) ?? [];
      if (list.length !== q) errors.push(`${label}: list ${plural(q, 'serial number')} (${list.length} given).`);
      for (const s of list) {
        const k = serialKey(s);
        if (seen.has(k)) errors.push(`Serial ${s} appears twice on this transfer.`);
        seen.add(k);
        const w = dayWindow(events.get(l.item_id) ?? [], day, serialDelta(s, tr.from_godown));
        if (w.at < 1) errors.push(`${label}: serial ${s} is not in stock in the source godown.`);
        else if (w.lowest < 1) errors.push(`${label}: serial ${s} leaves the source godown later on ${eventLabel(firstShortAfter(w, 1))}.`);
      }
    }
  }
  return errors;
}

/**
 * Checks for the tracked lines of a purchase bill: batch-tracked items need a batch number (and an
 * expiry not before MFG); serial-tracked items list exactly one new serial per unit. `input` should
 * leave the bill being edited out of `purchases`.
 */
export function billTrackingIssues(
  lines: readonly { name: string; hsn?: string; quantity: number; batch_no?: string; mfg_date?: string; expiry_date?: string; serials?: string[] }[],
  input: StockInputs,
  /** Bill date: when given, a serial is checked as of that day and against later receipts. */
  date?: string,
): string[] {
  const errors: string[] = [];
  const index = buildItemIndex(input.items.filter((i) => i.track_stock));
  let tracking: TrackingMap | null = null;
  let events: Map<string, StockEvent[]> | null = null;
  const seen = new Set<string>();
  for (const l of lines) {
    const item = index.find(l.name, l.hsn);
    const q = num(l.quantity);
    if (!item || q <= 0) continue;
    if (item.track_batches) {
      if (!l.batch_no?.trim()) errors.push(`${item.name}: enter the batch number.`);
      if (l.mfg_date && l.expiry_date && l.expiry_date < l.mfg_date) errors.push(`${item.name}: expiry is before the MFG date.`);
    }
    if (item.track_serials) {
      const list = cleanSerials(l.serials) ?? [];
      if (!Number.isInteger(q) || list.length !== q) errors.push(`${item.name}: list ${plural(q, 'serial number')}, one per line (${list.length} listed).`);
      tracking ??= computeTracking(input);
      const t = tracking.get(item.id);
      for (const s of list) {
        const k = serialKey(s);
        if (seen.has(k)) errors.push(`Serial ${s} is listed twice on this bill.`);
        seen.add(k);
        if (date) {
          events ??= collectEvents({ ...input, includeTransfers: true });
          const w = dayWindow(events.get(item.id) ?? [], date, serialDelta(s));
          const again = w.later.find((r) => r.bal + 1 > 1)?.ev;
          if (w.at >= 1) errors.push(`${item.name}: serial ${s} is already in stock.`);
          else if (again) errors.push(`${item.name}: serial ${s} is received again later on ${eventLabel(again)}.`);
        } else if (t?.serials.some((x) => x.inStock && serialKey(x.serial) === k)) errors.push(`${item.name}: serial ${s} is already in stock.`);
      }
    }
  }
  return errors;
}

/** A blank transfer line. */
export function blankTransferLine(id: string, itemId = ''): StockTransferLine {
  return { id, item_id: itemId, qty: 1 };
}

/* ── Expiry alerts ───────────────────────────────────────────── */

export interface ExpiryRow {
  item: StockItem;
  batch: string;
  expiry: string;
  qty: number;
  /** Negative once expired. */
  daysLeft: number;
  byGodown: Record<string, number>;
}

function dayNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
}

/** Batches with stock that have expired or expire within `days` days of `today`, soonest first. */
export function expiringBatches(tracking: TrackingMap, today: string, days: number): ExpiryRow[] {
  const limit = shiftDay(today, Math.max(0, Math.round(num(days))));
  const rows: ExpiryRow[] = [];
  for (const t of tracking.values()) {
    if (!t.item.track_batches) continue;
    for (const b of t.batches) {
      if (!b.batch || !b.expiry || b.qty <= EPS || b.expiry > limit) continue;
      rows.push({
        item: t.item, batch: b.batch, expiry: b.expiry, qty: roundQty(b.qty),
        daysLeft: Math.round(dayNumber(b.expiry) - dayNumber(today)), byGodown: b.byGodown,
      });
    }
  }
  return rows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.item.name.localeCompare(b.item.name));
}

/** Bell notices: one critical for expired stock, one warning for stock expiring within the window. */
export function expiryNotices(rows: ExpiryRow[], today: string, days: number, at: string): AppNotification[] {
  const expired = rows.filter((r) => r.daysLeft < 0);
  const soon = rows.filter((r) => r.daysLeft >= 0);
  const out: AppNotification[] = [];
  const names = (list: ExpiryRow[]) => {
    const shown = list.slice(0, 3).map((r) => `${r.item.name} (${r.batch})`).join(', ');
    return list.length > 3 ? `${shown} and ${list.length - 3} more` : shown;
  };
  if (expired.length) {
    out.push({
      id: `stock-expired:${expired.length}:${expired[0].expiry}:${today}`,
      severity: 'critical',
      title: `${plural(expired.length, 'batch', 'batches')} past expiry still in stock`,
      detail: `${names(expired)}. Expired stock cannot be sold — write it off with a stock adjustment or return it to the supplier.`,
      href: '/inventory?tab=batches',
      cta: 'Review batches',
      at,
    });
  }
  if (soon.length) {
    out.push({
      id: `stock-expiring:${soon.length}:${soon[0].expiry}:${days}`,
      severity: 'warning',
      title: `${plural(soon.length, 'batch', 'batches')} expiring within ${days} days`,
      detail: `${names(soon)}. Sell these first (FEFO picks them automatically).`,
      href: '/inventory?tab=batches',
      cta: 'Review batches',
      at,
    });
  }
  return out;
}

/* ── Serial lookup ───────────────────────────────────────────── */

export type WarrantyStatus = 'none' | 'active' | 'expired';

export interface SerialLookupResult {
  serial: string;
  item: StockItem;
  inStock: boolean;
  godown: string;
  /** Last receipt (purchase bill, opening or adjustment). */
  received?: SerialRef;
  /** Current sale (absent while in stock). */
  sale?: SerialRef;
  /** Last return (credit note) if any. */
  returned?: SerialRef;
  warrantyMonths: number;
  warrantyUntil: string;
  warranty: WarrantyStatus;
  history: SerialRef[];
}

/** Find serials matching `query` (exact match first, then partial), with purchase, sale and warranty. */
export function lookupSerial(tracking: TrackingMap, query: string, today: string, limit = 20): SerialLookupResult[] {
  const q = serialKey(query);
  if (!q) return [];
  const exact: SerialLookupResult[] = [];
  const partial: SerialLookupResult[] = [];
  for (const t of tracking.values()) {
    for (const s of t.serials) {
      const k = serialKey(s.serial);
      if (!k.includes(q)) continue;
      (k === q ? exact : partial).push(describeSerial(t, s, today));
    }
  }
  return [...exact, ...partial.sort((a, b) => a.serial.localeCompare(b.serial))].slice(0, limit);
}

function describeSerial(t: ItemTracking, s: SerialState, today: string): SerialLookupResult {
  const lastOf = (pred: (h: SerialRef) => boolean) => [...s.history].reverse().find(pred);
  const received = lastOf((h) => h.dir === 1 && (h.kind === 'purchase' || h.kind === 'opening' || h.kind === 'adjustment'));
  const sale = s.inStock ? undefined : lastOf((h) => h.dir === -1 && h.kind === 'sale');
  const returned = lastOf((h) => h.kind === 'return');
  const months = num(sale?.warrantyMonths ?? 0);
  const until = sale ? warrantyUntil(sale.date, months) : '';
  return {
    serial: s.serial, item: t.item, inStock: s.inStock, godown: s.godown, received, sale, returned,
    warrantyMonths: months, warrantyUntil: until,
    warranty: !until ? 'none' : until >= today ? 'active' : 'expired',
    history: s.history,
  };
}

/* ================================================================
   Live data (browser; reads storage)
   ================================================================ */

/** Everything `computeTracking` needs, from storage (transfers included). */
export function liveTrackingInputs(): StockInputs {
  return { ...liveInputs(), transfers: getTable<StockTransfer>(TRANSFERS_TABLE), includeTransfers: true };
}

export function loadTracking(overrides: Partial<StockInputs> = {}): TrackingMap {
  return computeTracking({ ...liveTrackingInputs(), ...overrides });
}

/** What the invoice editor needs to show batch / serial / godown pickers on its lines. */
export interface EditorStockContext {
  find: (name: string, hsn?: string) => StockItem | undefined;
  tracking: TrackingMap;
  godowns: Godown[];
  multi: boolean;
  defaultGodown: string;
  /** Sale date, for FEFO and expiry. */
  day: string;
  outgoing: boolean;
  incoming: boolean;
  /** New or draft document: new batch lines may be pre-filled with the FEFO batch (issued ones are left alone). */
  autoFefo: boolean;
}

/**
 * Live picker context for a document, its own saved copy left out of the balances. Null when
 * there is nothing to pick (no item tracks batches / serials and only one godown exists), or the
 * document type never moves stock.
 */
export function editorStockContext(doc: { id?: string; doc_type: string; issue_date: string; status?: string; goods_returned?: boolean }): EditorStockContext | null {
  const outgoing = isOutgoingDoc(doc.doc_type);
  const incoming = doc.doc_type === 'CREDIT_NOTE' && doc.goods_returned !== false;
  if (!outgoing && !incoming) return null;
  try {
    const godowns = godownList(getTable<Godown>(GODOWNS_TABLE));
    const input = liveTrackingInputs();
    const items = input.items.filter((i) => i.track_stock);
    const multi = godowns.length > 1;
    if (!multi && !items.some((i) => i.track_batches || i.track_serials)) return null;
    const settings = loadSettings();
    const index = buildItemIndex(items);
    return {
      find: (name, hsn) => index.find(name, hsn),
      tracking: computeTracking({ ...input, excludeInvoiceId: doc.id || undefined }),
      godowns,
      multi,
      defaultGodown: godowns.some((g) => g.id === settings.defaultGodown) ? (settings.defaultGodown as string) : MAIN_GODOWN_ID,
      day: doc.issue_date,
      outgoing,
      incoming,
      autoFefo: outgoing && (!doc.id || doc.status === 'Draft'),
    };
  } catch {
    return null;
  }
}

/** Issue checks for the document open in the editor, from live data. */
export function liveDocTrackingIssues(doc: DocInput): TrackingIssues {
  try {
    const godowns = godownList(getTable<Godown>(GODOWNS_TABLE));
    const multi = godowns.length > 1;
    const issues = pharmaGate(docTrackingIssues(doc, liveTrackingInputs(), multi), doc); // 7U pharma pack (off by default)
    if (doc.status === 'Draft' || doc.status === 'Cancelled') return issues;
    // 8F: no sale from an expiry godown; optional batch-MRP ceiling (tracking computed only when that is on).
    const pharma = readPharmaSettings();
    let tracking: TrackingMap | null = null;
    const mrpOf = pharma.enabled && pharma.block_above_mrp
      ? (l: { name: string; batch_no?: string }) => {
          tracking ??= computeTracking(liveTrackingInputs());
          const it = buildItemIndex(liveTrackingInputs().items.filter((i) => i.track_stock)).find(l.name);
          const batches = (it && tracking.get(it.id)?.batches) || [];
          const b = l.batch_no ? batches.find((x) => x.batch.toUpperCase() === l.batch_no!.toUpperCase()) : batches.length === 1 ? batches[0] : undefined;
          return b?.mrp;
        }
      : undefined;
    return saleLimitGate(issues, doc, { nonSaleable: nonSaleableGodowns(godowns), godownName: (id) => godownName(godowns, id), mrpOf, settings: pharma });
  } catch {
    return { errors: [], expired: [], warnings: [] };
  }
}
