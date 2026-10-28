/**
 * Transfer requests between stores (R4-B4, `TRQ/FY<yy-yy>/<seq>`): request → (approve) → dispatch into an in-transit
 * godown → receive (with shortages) → close.
 *
 *  - Dispatch saves a NORMAL stock transfer (`STR/FY…`) from the supplying godown to the receiving store's in-transit
 *    godown (`kind: 'transit'`, "In transit → Mall", created on first use with `parent_id` = the receiving godown, so a
 *    branch view counts goods on the way as the receiving branch's). Tagged `request_id`, `leg: 'out'`. Batch items go
 *    first-expiry-first, serial items by serial.
 *  - Receive saves an STR from transit to the receiving godown (`leg: 'in'`) for what arrived. Goods reported short or
 *    damaged stay in transit (an "exception") until written off (consume-only stock journal tagged `request_id`),
 *    claimed from the transporter (a note — still in transit) or found (received later).
 *  - Dispatched / received / written off / in transit and the status are DERIVED from those vouchers, so deleting an
 *    STR through its own guards simply recomputes the request. Stock in transit is the company's and counts in closing
 *    stock. Transfers never post to Books or the ledger (costing is company-wide).
 *  - Same GSTIN: the dispatch prints a Rule 55 delivery challan and offers own-use e-Way JSON (`transfer-challan.ts`,
 *    `eway-transfer.ts`). Different GSTINs: the dispatch STR takes the Sec 25(4) tax invoice + bill path
 *    (`branch-transfer.ts`) from the transfer list instead. Working papers — verify with your CA.
 *
 * Pure above the "Storage" divider (tests/transfer-requests.test.ts).
 */
import type { StockJournal, VoucherStockLine } from '../../types/manufacturing';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer, type StockTransferLine } from '../../types/stock';
import type { TransferException, TransferRequest, TransferRequestLine, TransferRequestLog, TransferRequestStatus } from '../../types/stores-r4';
import { num } from '../invoice-calc';
import { lineFactor } from '../units';
import type { StockInputs, StockItem } from '../inventory';
import { computeTracking, fefoAllocate, serialsInStock, transferIssues, type TrackingMap } from '../stock-tracking';
import { generateId, peekTable, setTable } from '../storage';
import { currentActor, requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { audit } from '../audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { godownsDb, transfersDb } from '../godowns';
import { SJ_TABLE, saveConsumeOnlyJournal } from '../manufacturing';
import { shiftDay } from '../dates';

export const REQUESTS_TABLE = 'transfer_requests';
export const REQUEST_PREFIX = 'TRQ';
export const TRANSIT_PREFIX = 'In transit → ';
export const TRANSFER_CA_NOTE = 'Same-GSTIN branch transfer: not a supply; goods move on a delivery challan (Rule 55) with an e-Way bill where required (sub-type "For own use", value at cost). Working paper — verify with your CA.';

const EPS = 1e-6;
const rq = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const bkey = (b: string | undefined) => (b ?? '').trim().toUpperCase();
const add = (m: Map<string, number>, k: string, q: number) => m.set(k, rq((m.get(k) ?? 0) + q));

/* ── Progress (derived) ───────────────────────────────────────── */

export interface HeldBatch {
  batch: string;
  qty: number;
}

export interface RequestProgress {
  dispatches: StockTransfer[];
  receipts: StockTransfer[];
  writeOffs: StockJournal[];
  /** Base units per item id. */
  requested: Map<string, number>;
  dispatched: Map<string, number>;
  received: Map<string, number>;
  writtenOff: Map<string, number>;
  /** Dispatched − received − written off (still in the transit godown). */
  inTransit: Map<string, number>;
  transitBatches: Map<string, HeldBatch[]>;
  transitSerials: Map<string, string[]>;
  /** Date of the first dispatch (age of goods in transit). */
  firstDispatch?: string;
}

export interface RequestDocs {
  transfers: readonly StockTransfer[];
  journals: readonly StockJournal[];
}

/** Everything the request's dispatches, receipts and write-offs add up to. Pure. */
export function requestProgress(req: Pick<TransferRequest, 'id' | 'lines'>, docs: RequestDocs): RequestProgress {
  const mine = docs.transfers.filter((t) => t?.request_id === req.id).sort((a, b) => a.date.localeCompare(b.date) || a.transfer_number.localeCompare(b.transfer_number, undefined, { numeric: true }));
  const dispatches = mine.filter((t) => t.leg === 'out');
  const receipts = mine.filter((t) => t.leg === 'in');
  const writeOffs = docs.journals.filter((j) => j?.request_id === req.id);
  const requested = new Map<string, number>();
  for (const l of req.lines ?? []) if (l.item_id) add(requested, l.item_id, num(l.qty) * lineFactor(l));
  const dispatched = new Map<string, number>();
  const received = new Map<string, number>();
  const writtenOff = new Map<string, number>();
  const batches = new Map<string, Map<string, HeldBatch>>();
  const serials = new Map<string, Set<string>>();
  const move = (itemId: string, q: number, batch?: string, list?: readonly string[]) => {
    if (batch?.trim()) {
      const m = batches.get(itemId) ?? new Map<string, HeldBatch>();
      const b = m.get(bkey(batch)) ?? { batch: batch.trim(), qty: 0 };
      b.qty = rq(b.qty + q);
      m.set(bkey(batch), b);
      batches.set(itemId, m);
    }
    if (list?.length) {
      const s = serials.get(itemId) ?? new Set<string>();
      for (const x of list) {
        if (q > 0) s.add(x.trim());
        else s.delete(x.trim());
      }
      serials.set(itemId, s);
    }
  };
  for (const t of dispatches) for (const l of t.lines ?? []) {
    const q = num(l.qty) * lineFactor(l);
    if (!l.item_id || !(q > 0)) continue;
    add(dispatched, l.item_id, q);
    move(l.item_id, q, l.batch_no, l.serials);
  }
  for (const t of receipts) for (const l of t.lines ?? []) {
    const q = num(l.qty) * lineFactor(l);
    if (!l.item_id || !(q > 0)) continue;
    add(received, l.item_id, q);
    move(l.item_id, -q, l.batch_no, l.serials);
  }
  for (const j of writeOffs) for (const l of j.consume ?? []) {
    const q = num(l.qty) * lineFactor(l);
    if (!l.item_id || !(q > 0)) continue;
    add(writtenOff, l.item_id, q);
    move(l.item_id, -q, l.batch_no, l.serials);
  }
  const inTransit = new Map<string, number>();
  for (const [id, d] of dispatched) {
    const h = rq(d - (received.get(id) ?? 0) - (writtenOff.get(id) ?? 0));
    if (h > EPS) inTransit.set(id, h);
  }
  const transitBatches = new Map<string, HeldBatch[]>();
  for (const [id, m] of batches) {
    const list = [...m.values()].filter((b) => b.qty > EPS);
    if (list.length) transitBatches.set(id, list);
  }
  const transitSerials = new Map<string, string[]>();
  for (const [id, s] of serials) if (s.size) transitSerials.set(id, [...s]);
  return { dispatches, receipts, writeOffs, requested, dispatched, received, writtenOff, inTransit, transitBatches, transitSerials, firstDispatch: dispatches[0]?.date };
}

const sumMap = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);

/** Effective status: stored milestones (approved / rejected / closed) and the derived flow. */
export function requestStatus(req: Pick<TransferRequest, 'status'>, p: RequestProgress): TransferRequestStatus {
  if (req.status === 'rejected' || req.status === 'closed') return req.status;
  const dispatched = sumMap(p.dispatched);
  if (dispatched <= EPS) return req.status === 'approved' ? 'approved' : 'requested';
  const transit = sumMap(p.inTransit);
  const full = [...p.requested].every(([id, q]) => (p.dispatched.get(id) ?? 0) + EPS >= q);
  if (transit <= EPS && full) return 'received';
  return full ? 'dispatched' : 'partly_dispatched';
}

/** Still to dispatch per item (requested − dispatched, base units). */
export function remainingToDispatch(p: RequestProgress): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, q] of p.requested) {
    const r = rq(q - (p.dispatched.get(id) ?? 0));
    if (r > EPS) out.set(id, r);
  }
  return out;
}

/** Quantity in transit not tied to an open / claimed exception (what a receipt can still take). */
export function unaccounted(p: RequestProgress, exceptions: readonly TransferException[] = []): Map<string, number> {
  const out = new Map(p.inTransit);
  for (const e of exceptions) if (e.status === 'open' || e.status === 'claimed') out.set(e.item_id, rq((out.get(e.item_id) ?? 0) - num(e.qty)));
  for (const [k, v] of out) if (v <= EPS) out.delete(k);
  return out;
}

/**
 * Dispatch lines for `want` (base units per item; default everything still to send) from `from`: batch items split
 * first-expiry-first, serial items take the first serials in stock there. A shortfall stays on an unbatched line (the
 * transfer check then refuses it).
 */
export function buildDispatchLines(
  want: ReadonlyMap<string, number>, items: readonly StockItem[], tracking: TrackingMap, date: string, from: string, newId: () => string = generateId,
): StockTransferLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: StockTransferLine[] = [];
  for (const [itemId, raw] of want) {
    const q = rq(raw);
    const item = byId.get(itemId);
    if (!item || !(q > EPS)) continue;
    const t = tracking.get(item.id);
    if (item.track_batches) {
      const { lines, short } = fefoAllocate(t, date, q, from);
      for (const b of lines) out.push({ id: newId(), item_id: item.id, qty: b.qty, batch_no: b.batch });
      if (short > EPS || !lines.length) out.push({ id: newId(), item_id: item.id, qty: lines.length ? short : q });
    } else if (item.track_serials) {
      const n = Math.floor(q + EPS);
      out.push({ id: newId(), item_id: item.id, qty: n || q, serials: serialsInStock(t, from).slice(0, n) });
    } else out.push({ id: newId(), item_id: item.id, qty: q });
  }
  return out;
}

/**
 * QA6 F9: batch quantities held in transit by open / claimed exceptions (item → batch key → qty). A receipt must not
 * take them, or the batch left in transit is not the one the shortage names.
 */
export function heldBatches(exceptions: readonly TransferException[] = []): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of exceptions) {
    if ((e.status !== 'open' && e.status !== 'claimed') || !e.batch_no) continue;
    const m = out.get(e.item_id) ?? new Map<string, number>();
    m.set(bkey(e.batch_no), rq((m.get(bkey(e.batch_no)) ?? 0) + num(e.qty)));
    out.set(e.item_id, m);
  }
  return out;
}

/**
 * Lines taking `want` (base units per item) out of what is in transit for the request: batches oldest first, serials
 * kept, never the batch quantities `held` by open shortages (F9).
 */
export function transitLines(p: RequestProgress, want: ReadonlyMap<string, number>, newId: () => string = generateId, skip?: ReadonlyMap<string, number>, held?: ReadonlyMap<string, ReadonlyMap<string, number>>): StockTransferLine[] {
  const out: StockTransferLine[] = [];
  for (const [itemId, raw] of want) {
    let rest = rq(Math.min(raw, p.inTransit.get(itemId) ?? 0));
    if (!(rest > EPS)) continue;
    // `skip`: units of this item already taken by earlier lines (so two calls do not pick the same batch twice).
    let skipped = skip?.get(itemId) ?? 0;
    const hold = held?.get(itemId);
    for (const b of p.transitBatches.get(itemId) ?? []) {
      let avail = rq(b.qty - Math.min(hold?.get(bkey(b.batch)) ?? 0, b.qty));
      const s = Math.min(skipped, avail);
      avail = rq(avail - s);
      skipped = rq(skipped - s);
      const take = rq(Math.min(rest, avail));
      if (take > EPS) out.push({ id: newId(), item_id: itemId, qty: take, batch_no: b.batch });
      rest = rq(rest - take);
      if (rest <= EPS) break;
    }
    if (rest > EPS) {
      const serials = (p.transitSerials.get(itemId) ?? []).slice(skip?.get(itemId) ?? 0);
      out.push({ id: newId(), item_id: itemId, qty: rest, ...(serials.length ? { serials: serials.slice(0, Math.round(rest)) } : {}) });
    }
  }
  return out;
}

/** Problems with a receipt (per item: received + short + damaged must fit what is in transit). */
export function receiveIssues(p: RequestProgress, exceptions: readonly TransferException[], lines: readonly ReceiveLine[], nameOf: (id: string) => string): string[] {
  const room = unaccounted(p, exceptions);
  const errors: string[] = [];
  let any = false;
  for (const l of lines) {
    const total = rq(num(l.received) + num(l.short) + num(l.damaged));
    if ([l.received, l.short, l.damaged].some((x) => num(x) < 0)) errors.push(`${nameOf(l.item_id)}: quantities cannot be negative.`);
    if (total > EPS) any = true;
    if (total > (room.get(l.item_id) ?? 0) + EPS) errors.push(`${nameOf(l.item_id)}: only ${room.get(l.item_id) ?? 0} is in transit for this request.`);
  }
  if (!any && !errors.length) errors.push('Enter what was received (or reported short / damaged).');
  return errors;
}

export interface ReceiveLine {
  item_id: string;
  received: number;
  short?: number;
  damaged?: number;
}

/* ── Views ────────────────────────────────────────────────────── */

export interface TransitRow {
  request: TransferRequest;
  item_id: string;
  qty: number;
  value: number;
  /** Days since the first dispatch. */
  age: number;
}

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

/** Goods in transit per request and item, valued at `costOf` (unit cost) × qty, with their age on `today`. */
export function inTransitRows(requests: readonly TransferRequest[], docs: RequestDocs, costOf: (itemId: string) => number, today: string): TransitRow[] {
  const out: TransitRow[] = [];
  for (const r of requests) {
    if (r.status === 'rejected') continue;
    const p = requestProgress(r, docs);
    for (const [item_id, qty] of p.inTransit) out.push({ request: r, item_id, qty, value: Math.round(qty * num(costOf(item_id)) * 100) / 100, age: p.firstDispatch ? Math.max(daysBetween(p.firstDispatch, today), 0) : 0 });
  }
  return out.sort((a, b) => b.age - a.age);
}

/** Value in transit per receiving godown (sum of the rows). */
export function transitValueBy(rows: readonly TransitRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.request.to_godown, Math.round(((out.get(r.request.to_godown) ?? 0) + r.value) * 100) / 100);
  return out;
}

/** Fill rate per receiving godown: received ÷ requested for requests dated in the last `days` (default 90). */
export function fillRates(requests: readonly TransferRequest[], docs: RequestDocs, today: string, days = 90): { godown: string; requested: number; received: number; rate: number }[] {
  const from = shiftDay(today, -days);
  const by = new Map<string, { requested: number; received: number }>();
  for (const r of requests) {
    if (r.status === 'rejected' || r.date < from || r.date > today) continue;
    const p = requestProgress(r, docs);
    const row = by.get(r.to_godown) ?? { requested: 0, received: 0 };
    row.requested += sumMap(p.requested);
    for (const [id, q] of p.received) row.received += Math.min(q, p.requested.get(id) ?? q);
    by.set(r.to_godown, row);
  }
  return [...by.entries()].map(([godown, v]) => ({ godown, requested: rq(v.requested), received: rq(v.received), rate: v.requested > 0 ? Math.round((v.received / v.requested) * 1000) / 10 : 0 }));
}

/** Pending (not yet dispatched) and in-transit quantity per destination godown × item — the replenishment run nets these. */
export function openQtyByStore(requests: readonly TransferRequest[], docs: RequestDocs): { pending: Map<string, number>; transit: Map<string, number> } {
  const pending = new Map<string, number>();
  const transit = new Map<string, number>();
  for (const r of requests) {
    if (r.status === 'rejected' || r.status === 'closed') continue;
    const p = requestProgress(r, docs);
    for (const [id, q] of remainingToDispatch(p)) add(pending, `${r.to_godown}|${id}`, q);
    for (const [id, q] of p.inTransit) add(transit, `${r.to_godown}|${id}`, q);
  }
  return { pending, transit };
}

/** Bell notices: goods in transit longer than `days`, requests past their needed-by date. Pure. */
export function transferNotices(requests: readonly TransferRequest[], docs: RequestDocs, today: string, days: number, at: string): { id: string; severity: 'warning' | 'info'; title: string; detail: string; href: string; cta: string; at: string }[] {
  const out: { id: string; severity: 'warning' | 'info'; title: string; detail: string; href: string; cta: string; at: string }[] = [];
  const aged: string[] = [];
  const late: string[] = [];
  for (const r of requests) {
    if (r.status === 'rejected' || r.status === 'closed') continue;
    const p = requestProgress(r, docs);
    const st = requestStatus(r, p);
    if (p.inTransit.size && p.firstDispatch && daysBetween(p.firstDispatch, today) > days) aged.push(r.number);
    if (r.needed_by && r.needed_by < today && (st === 'requested' || st === 'approved' || st === 'partly_dispatched')) late.push(r.number);
  }
  if (aged.length) out.push({ id: `trq-transit:${aged.sort().join(',')}`, severity: 'warning', title: `${aged.length} transfer${aged.length === 1 ? ' has' : 's have'} goods in transit for more than ${days} days`, detail: aged.slice(0, 3).join(', '), href: '/inventory?tab=transfers&view=transit', cta: 'In transit', at });
  if (late.length) out.push({ id: `trq-late:${late.sort().join(',')}`, severity: 'info', title: `${late.length} transfer request${late.length === 1 ? ' is' : 's are'} past the needed-by date`, detail: late.slice(0, 3).join(', '), href: '/inventory?tab=transfers&view=requests', cta: 'Requests', at });
  return out;
}

/* ================================================================
   Storage
   ================================================================ */

export const loadRequestDocs = (): RequestDocs => ({ transfers: peekTable<StockTransfer>('stock_transfers'), journals: peekTable<StockJournal>(SJ_TABLE) });

export const transitGodownFor = (list: readonly Godown[], toGodown: string): Godown | undefined => list.find((g) => g.kind === 'transit' && (g.parent_id || MAIN_GODOWN_ID) === toGodown);

/** The in-transit godown of a receiving godown ("In transit → Mall", kind 'transit', inside it), created on first use. */
export function ensureTransitGodown(toGodown: string): Godown {
  const list = godownsDb.list();
  const found = transitGodownFor(list, toGodown);
  if (found) return found;
  const dest = list.find((g) => g.id === toGodown);
  let name = `${TRANSIT_PREFIX}${dest?.name ?? 'store'}`;
  for (let n = 2; list.some((g) => g.name.trim().toLowerCase() === name.toLowerCase()); n++) name = `${TRANSIT_PREFIX}${dest?.name ?? 'store'} ${n}`;
  return godownsDb.save({ name, kind: 'transit', ...(toGodown !== MAIN_GODOWN_ID ? { parent_id: toGodown } : {}) });
}

const lockOf = (r: { id: string; date: string; number: string }) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });
const by = () => currentActor()?.name;
const logRow = (action: TransferRequestLog['action'], note?: string): TransferRequestLog => ({ at: new Date().toISOString(), ...(by() ? { by: by() } : {}), action, ...(note ? { note } : {}) });

function logAudit(r: Pick<TransferRequest, 'id' | 'number'>, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'stock_transfer', entity_id: r.id, action, doc_number: r.number, summary });
  } catch {
    /* logging never breaks a save */
  }
}

export const requestsStore = {
  all: (): TransferRequest[] => peekTable<TransferRequest>(REQUESTS_TABLE).filter((r) => r && typeof r.id === 'string').map((r) => ({ ...r })),
  get: (id: string): TransferRequest | undefined => requestsStore.all().find((r) => r.id === id),
  put(r: TransferRequest): void {
    const rows = requestsStore.all();
    setTable(REQUESTS_TABLE, rows.some((x) => x.id === r.id) ? rows.map((x) => (x.id === r.id ? r : x)) : [...rows, r]);
  },
};

function mustGet(id: string): TransferRequest {
  const r = requestsStore.get(id);
  if (!r) throw new Error('This transfer request no longer exists.');
  return r;
}

/** Persist with the derived status and one more log row. */
function persist(r: TransferRequest, row: TransferRequestLog | null): TransferRequest {
  const base = { ...r, ...(row ? { log: [...(r.log ?? []), row] } : {}), updated_at: new Date().toISOString() };
  const next: TransferRequest = { ...base, status: requestStatus(base, requestProgress(base, loadRequestDocs())) };
  requestsStore.put(next);
  return next;
}

export interface RequestInput {
  id?: string;
  date: string;
  from_godown: string;
  to_godown: string;
  lines: TransferRequestLine[];
  needed_by?: string;
  notes?: string;
}

export function validateRequest(x: RequestInput): string {
  if (!x.date) return 'Choose the request date.';
  if (!x.from_godown || !x.to_godown) return 'Choose the supplying and the requesting godown.';
  if (x.from_godown === x.to_godown) return 'The two godowns must be different.';
  if (!(x.lines ?? []).some((l) => l.item_id && num(l.qty) > 0)) return 'Add at least one item with a quantity.';
  if (x.needed_by && x.needed_by < x.date) return 'The needed-by date is before the request date.';
  return '';
}

export const transferRequestsDb = {
  all: requestsStore.all,
  get: requestsStore.get,
  nextNumber: (date?: string): string => nextSeriesNumberFor(REQUEST_PREFIX, date, requestsStore.all().map((r) => r.number)),

  /** Create, or edit one nothing was dispatched against yet (doc.create, period lock on the date, TRQ series, audited). */
  save(x: RequestInput): TransferRequest {
    requireAccess('doc.create');
    const err = validateRequest(x);
    if (err) throw new Error(err);
    const rows = requestsStore.all();
    const existing = x.id ? rows.find((r) => r.id === x.id) : undefined;
    if (existing) {
      if (requestProgress(existing, loadRequestDocs()).dispatches.length) throw new Error(`${existing.number} has been dispatched against: it can no longer be edited.`);
      assertUnlocked(lockOf(existing), 'edit');
    }
    const number = existing && numberFitsFy(existing.number, x.date) ? existing.number : transferRequestsDb.nextNumber(x.date);
    const id = existing?.id ?? generateId();
    const state = assertUnlocked(lockOf({ id, date: x.date, number }), existing ? 'edit' : 'create');
    const lines = x.lines.filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ id: l.id || generateId(), item_id: l.item_id, qty: num(l.qty), ...(l.unit && lineFactor(l) !== 1 ? { unit: l.unit, unit_factor: lineFactor(l) } : {}) }));
    const r: TransferRequest = {
      ...(existing ?? { status: 'requested' as const, log: [], dispatch_ids: [], receipt_ids: [], ...(by() ? { requested_by: by() } : {}), created_at: new Date().toISOString() }),
      id, number, date: x.date, from_godown: x.from_godown, to_godown: x.to_godown, lines,
      ...(x.needed_by ? { needed_by: x.needed_by } : {}),
      ...(x.notes?.trim() ? { notes: x.notes.trim() } : {}),
    } as TransferRequest;
    if (!x.needed_by) delete r.needed_by;
    const saved = withTablesRollback([REQUESTS_TABLE, 'series_counters'], () => {
      const out = persist(r, logRow(existing ? 'edit' : 'request'));
      recordSeries(number);
      return out;
    });
    logAudit(saved, existing ? 'update' : 'create', `${existing ? 'Edited' : 'Raised'} transfer request ${number}: ${lines.length} line(s)${state === 'overridden' ? ' (period lock overridden)' : ''}`);
    return saved;
  },

  /** Optional approval (owner / approver). */
  approve(id: string): TransferRequest {
    requireAccess('doc.approve');
    const r = mustGet(id);
    if (r.status !== 'requested') throw new Error(`${r.number} is ${r.status.replace('_', ' ')}: only a new request can be approved.`);
    const saved = persist({ ...r, status: 'approved', ...(by() ? { approved_by: by() } : {}) }, logRow('approve'));
    logAudit(saved, 'update', `Approved transfer request ${r.number}`);
    return saved;
  },

  reject(id: string, note?: string): TransferRequest {
    requireAccess('doc.approve');
    const r = mustGet(id);
    if (requestProgress(r, loadRequestDocs()).dispatches.length) throw new Error(`${r.number} has been dispatched against: it cannot be rejected.`);
    const saved = persist({ ...r, status: 'rejected' }, logRow('reject', note));
    logAudit(saved, 'update', `Rejected transfer request ${r.number}${note ? `: ${note}` : ''}`);
    return saved;
  },

  /** Dispatch: a normal STR from the supplying godown into the receiving store's in-transit godown (`leg: 'out'`). */
  dispatch(id: string, x: { date: string; lines: StockTransferLine[]; notes?: string; from?: string }, inputs: StockInputs): { request: TransferRequest; transfer: StockTransfer } {
    requireAccess('books.edit');
    const r = mustGet(id);
    if (r.status === 'rejected' || r.status === 'closed') throw new Error(`${r.number} is ${r.status}.`);
    const lines = x.lines.filter((l) => l.item_id && num(l.qty) > 0);
    if (!lines.length) throw new Error('Nothing to dispatch.');
    const out = withTablesRollback([REQUESTS_TABLE, 'stock_transfers', 'godowns', 'series_counters'], () => {
      const transit = ensureTransitGodown(r.to_godown);
      const from = x.from || r.from_godown;
      const draft = { id: '', date: x.date, from_godown: from, to_godown: transit.id, lines };
      const problems = transferIssues(draft, { ...inputs, transfers: [...(inputs.transfers ?? [])] });
      if (problems.length) throw new Error(problems[0]);
      const t = transfersDb.save({ date: x.date, from_godown: from, to_godown: transit.id, lines, request_id: r.id, leg: 'out', notes: x.notes || `Dispatch against ${r.number}` });
      const request = persist({ ...mustGet(id), dispatch_ids: [...(r.dispatch_ids ?? []), t.id] }, logRow('dispatch', t.transfer_number));
      return { request, transfer: t };
    });
    logAudit(out.request, 'update', `Dispatched ${out.transfer.transfer_number} against transfer request ${r.number}`);
    return out;
  },

  /**
   * Receive: an STR from transit to the requesting godown for what arrived (`leg: 'in'`); short / damaged quantities
   * stay in transit as open exceptions.
   */
  receive(id: string, x: { date: string; lines: ReceiveLine[]; note?: string }, items: readonly StockItem[], inputs: StockInputs): { request: TransferRequest; transfer?: StockTransfer } {
    requireAccess('books.edit');
    const r = mustGet(id);
    if (r.status === 'rejected' || r.status === 'closed') throw new Error(`${r.number} is ${r.status}.`);
    const docs = loadRequestDocs();
    const p = requestProgress(r, docs);
    const nameOf = (i: string) => items.find((it) => it.id === i)?.name ?? 'Item';
    const issues = receiveIssues(p, r.exceptions ?? [], x.lines, nameOf);
    if (issues.length) throw new Error(issues[0]);
    const transit = transitGodownFor(godownsDb.list(), r.to_godown);
    if (!transit) throw new Error('Nothing has been dispatched yet.');
    const want = new Map<string, number>();
    for (const l of x.lines) if (num(l.received) > EPS) add(want, l.item_id, num(l.received));
    const held = heldBatches(r.exceptions);
    const lines = transitLines(p, want, generateId, undefined, held);
    const taken = new Map(want);
    return withTablesRollback([REQUESTS_TABLE, 'stock_transfers', 'series_counters'], () => {
      let t: StockTransfer | undefined;
      if (lines.length) {
        const problems = transferIssues({ id: '', date: x.date, from_godown: transit.id, to_godown: r.to_godown, lines }, inputs);
        if (problems.length) throw new Error(problems[0]);
        t = transfersDb.save({ date: x.date, from_godown: transit.id, to_godown: r.to_godown, lines, request_id: r.id, leg: 'in', notes: x.note || `Received against ${r.number}` });
      }
      const exceptions: TransferException[] = [...(r.exceptions ?? [])];
      for (const l of x.lines) {
        for (const kind of ['short', 'damaged'] as const) {
          const q = rq(num(l[kind]));
          if (!(q > EPS)) continue;
          const pick = transitLines(p, new Map([[l.item_id, q]]), generateId, taken, held)[0];
          add(taken, l.item_id, q);
          exceptions.push({ id: generateId(), date: x.date, item_id: l.item_id, qty: q, kind, ...(t ? { receipt_id: t.id } : {}), ...(pick?.batch_no ? { batch_no: pick.batch_no } : {}), status: 'open', ...(x.note ? { note: x.note } : {}) });
        }
      }
      const request = persist({ ...mustGet(id), exceptions, receipt_ids: [...(r.receipt_ids ?? []), ...(t ? [t.id] : [])] }, logRow('receive', [t?.transfer_number, exceptions.length > (r.exceptions?.length ?? 0) ? `${exceptions.length - (r.exceptions?.length ?? 0)} short / damaged` : ''].filter(Boolean).join(' · ')));
      logAudit(request, 'update', `Received against transfer request ${r.number}${t ? ` (${t.transfer_number})` : ''}`);
      return { request, transfer: t };
    });
  },

  /** Write off a short / damaged quantity: a consume-only stock journal from the transit godown (`request_id`). */
  writeOff(id: string, exceptionId: string, date: string, items: readonly StockItem[], inputs: StockInputs): TransferRequest {
    requireAccess('books.edit');
    const r = mustGet(id);
    const e = (r.exceptions ?? []).find((x) => x.id === exceptionId);
    if (!e || (e.status !== 'open' && e.status !== 'claimed')) throw new Error('This shortage is already resolved.');
    const transit = transitGodownFor(godownsDb.list(), r.to_godown);
    if (!transit) throw new Error('The in-transit godown no longer exists.');
    const p = requestProgress(r, loadRequestDocs());
    const picked = e.batch_no && (p.transitBatches.get(e.item_id) ?? []).some((b) => bkey(b.batch) === bkey(e.batch_no) && b.qty + EPS >= e.qty)
      ? [{ id: generateId(), item_id: e.item_id, qty: e.qty, batch_no: e.batch_no }]
      : transitLines(p, new Map([[e.item_id, e.qty]]));
    const consume: VoucherStockLine[] = picked.map((l) => ({ ...l, godown_id: transit.id }));
    return withTablesRollback([REQUESTS_TABLE, SJ_TABLE, 'series_counters'], () => {
      const j = saveConsumeOnlyJournal({ date, consume, request_id: r.id, narration: `Goods ${e.kind} in transit written off — ${r.number}${e.note ? ` (${e.note})` : ''}. Check ITC reversal (Sec 17(5)(h)) with your CA.` }, items, inputs);
      const exceptions = (r.exceptions ?? []).map((x) => (x.id === e.id ? { ...x, status: 'written_off' as const, ref: j.number } : x));
      const saved = persist({ ...mustGet(id), exceptions, writeoff_ids: [...(r.writeoff_ids ?? []), j.id] }, logRow('write_off', j.number));
      logAudit(saved, 'update', `Wrote off ${e.qty} ${e.kind} in transit on ${r.number} (${j.number})`);
      return saved;
    });
  },

  /** Claim from the transporter: a note; the goods stay in transit until written off or found. */
  claim(id: string, exceptionId: string, note: string): TransferRequest {
    requireAccess('books.edit');
    const r = mustGet(id);
    const e = (r.exceptions ?? []).find((x) => x.id === exceptionId);
    if (!e || e.status !== 'open') throw new Error('Only an open shortage can be claimed.');
    const exceptions = (r.exceptions ?? []).map((x) => (x.id === e.id ? { ...x, status: 'claimed' as const, ref: note.trim() || 'Claim raised', note: note.trim() || x.note } : x));
    return persist({ ...r, exceptions }, logRow('claim', note.trim()));
  },

  /** Found: the short quantity arrived after all — received from transit now. */
  found(id: string, exceptionId: string, date: string, inputs: StockInputs): TransferRequest {
    requireAccess('books.edit');
    const r = mustGet(id);
    const e = (r.exceptions ?? []).find((x) => x.id === exceptionId);
    if (!e || (e.status !== 'open' && e.status !== 'claimed')) throw new Error('This shortage is already resolved.');
    const transit = transitGodownFor(godownsDb.list(), r.to_godown);
    if (!transit) throw new Error('The in-transit godown no longer exists.');
    const p = requestProgress(r, loadRequestDocs());
    const lines = e.batch_no ? [{ id: generateId(), item_id: e.item_id, qty: e.qty, batch_no: e.batch_no }] : transitLines(p, new Map([[e.item_id, e.qty]]));
    return withTablesRollback([REQUESTS_TABLE, 'stock_transfers', 'series_counters'], () => {
      const problems = transferIssues({ id: '', date, from_godown: transit.id, to_godown: r.to_godown, lines }, inputs);
      if (problems.length) throw new Error(problems[0]);
      const t = transfersDb.save({ date, from_godown: transit.id, to_godown: r.to_godown, lines, request_id: r.id, leg: 'in', notes: `Found: ${e.kind} goods received late — ${r.number}` });
      const exceptions = (r.exceptions ?? []).map((x) => (x.id === e.id ? { ...x, status: 'found' as const, ref: t.transfer_number } : x));
      return persist({ ...mustGet(id), exceptions, receipt_ids: [...(r.receipt_ids ?? []), t.id] }, logRow('receive', `${t.transfer_number} (found)`));
    });
  },

  /** Close: refused while goods are still in transit. What was never dispatched is simply not sent. */
  close(id: string, note?: string): TransferRequest {
    requireAccess('books.edit');
    const r = mustGet(id);
    const p = requestProgress(r, loadRequestDocs());
    if (p.inTransit.size) throw new Error(`${r.number} still has goods in transit: receive, write off or find them first.`);
    const saved = persist({ ...r, status: 'closed' }, logRow('close', note));
    logAudit(saved, 'update', `Closed transfer request ${r.number}`);
    return saved;
  },

  /** Delete a request nothing was dispatched against (else reject / close). */
  remove(id: string): void {
    requireAccess('doc.create');
    const r = requestsStore.get(id);
    if (!r) return;
    if (requestProgress(r, loadRequestDocs()).dispatches.length) throw new Error(`${r.number} has been dispatched against: close it instead.`);
    const state = assertUnlocked(lockOf(r), 'delete');
    setTable(REQUESTS_TABLE, requestsStore.all().filter((x) => x.id !== id));
    logAudit(r, 'delete', `Deleted transfer request ${r.number}${state === 'overridden' ? ' (period lock overridden)' : ''}`);
  },
};

/** Live tracking for dispatch drafts (FEFO / serial picks). */
export const liveTracking = (inputs: StockInputs, asOf?: string): TrackingMap => computeTracking({ ...inputs, asOf });
