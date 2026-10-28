/**
 * Job work (P1-9, Phase 7M — Tally "Job Work Out / In"):
 *  - Job Work Out order (`job_work_orders`, `JWO/FY…`): what a job worker is to process, optional BOM.
 *  - Material Out (`job_work_out`, `JWC/FY…`): the delivery challan under CGST Rule 55 (Sec 143) moving inputs
 *    / capital goods to the job worker's godown. Still our stock: it counts in the stock summary.
 *  - Material In (`job_work_in`, `JWR/FY…`): processed goods, scrap and unprocessed inputs back; inputs consumed
 *    at the job worker (typed or exploded from the BOM); losses; goods supplied from his premises (Table 5C).
 *  - Return clocks (Sec 143(1)(a), (3), (4)): inputs within one year, capital goods within three years of being
 *    sent (moulds, dies, jigs, fixtures and tools: no limit), extendable by the Commissioner. A challan line still
 *    open past its clock is a deemed supply on the day it was sent out — flagged, never posted.
 *  - Job Work In side (`job_work_principal`, `JWP/FY…`): the principal's material received and returned. Not our
 *    stock (register only); our job charges are billed as a service invoice (`jobChargesLine`).
 *
 * Stock effects come from `events-job-work.ts` (registered once in inventory.ts). Every save / delete checks the
 * role (`books.edit`), the period lock and writes an audit row. Above the "Storage" divider everything is pure.
 * Working papers: verify the GST treatment with your CA.
 */

import type {
  JobWorkGoodsKind, JobWorkLine, JobWorkOrder, MaterialIn, MaterialOut, PrincipalMovement,
} from '../types/job-work';
import type { Bom } from '../types/manufacturing';
import type { Godown } from '../types/stock';
import type { InvoiceItem } from '../types/invoice';
import { liveInputs, type StockInputs, type StockItem } from './inventory';
import { collectEvents } from './inventory';
import { serialInIssues, serialLineShape, serialOutIssues, serialShapeError, touchesSerials } from './serial-vouchers';
import { assertRemovable, liveRemovalIssues } from './stock-timeline';
import { num, round2 } from './invoice-calc';
import { shiftDay } from './dates';
import { lineFactor } from './units';
import { JOB_WORK_TABLES } from './events-job-work';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { godownsDb } from './godowns';

export { JOB_WORK_TABLES };
export const JOB_WORK_PREFIX = { order: 'JWO', out: 'JWC', in: 'JWR', principal: 'JWP' } as const;
/** Days before a return clock runs out when a challan line is flagged "due soon". */
export const DUE_SOON_DAYS = 30;
const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const day = (d: unknown) => String(d ?? '').slice(0, 10);

/* ── Return clocks (Sec 143) ──────────────────────────────────── */

/** Years a job worker may keep goods of this kind (null = no limit). */
export function returnYears(kind: JobWorkGoodsKind | undefined): number | null {
  if (kind === 'mould_tool') return null;
  return kind === 'capital_goods' ? 3 : 1;
}

/** The same day `years` later (29 Feb → 28 Feb), as a bare local day. */
export function addYears(date: string, years: number): string {
  const [y, m, d] = day(date).split('-').map(Number);
  if (!y || !m || !d) return '';
  const leap = (n: number) => (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0;
  const dd = m === 2 && d === 29 && !leap(y + years) ? 28 : d;
  return `${y + years}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Last day the goods may come back: one day before the anniversary of the challan date (inputs 1 year, capital
 * goods 3 years), or a later Commissioner's extension. '' = no limit (moulds, dies, jigs, fixtures, tools).
 */
export function returnDeadline(sentOn: string, kind: JobWorkGoodsKind | undefined, extendedUntil?: string): string {
  const years = returnYears(kind);
  if (years === null || !day(sentOn)) return '';
  const base = shiftDay(addYears(sentOn, years), -1);
  return extendedUntil && day(extendedUntil) > base ? day(extendedUntil) : base;
}

/** Whole days from `from` to `to` (both bare days); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  return Math.round((t(day(to)) - t(day(from))) / 86400000);
}

/* ── Challan balances ─────────────────────────────────────────── */

export type ClockStatus = 'settled' | 'open' | 'due_soon' | 'expired' | 'no_limit';

export interface ChallanLineBalance {
  outId: string;
  number: string;
  date: string;
  party: string;
  godown: string;
  lineId: string;
  item_id: string;
  kind: JobWorkGoodsKind;
  /** Base units. */
  sent: number;
  consumed: number;
  returned: number;
  supplied: number;
  lost: number;
  pending: number;
  /** Taxable value of the pending quantity (challan rate). */
  pendingValue: number;
  deadline: string;
  daysLeft: number | null;
  status: ClockStatus;
  /** Some of it came back (or was consumed) after the clock ran out. */
  late: boolean;
}

export interface ChallanBalances {
  lines: ChallanLineBalance[];
  /** Material In quantities with no open challan line to settle (base units). */
  unmatched: { inId: string; number: string; item_id: string; qty: number }[];
  /** Which Material In settled which challan line, how much (base units) and how (ITC-04 Table 5). */
  settlements: Settlement[];
}

type SettleKind = 'consumed' | 'returned' | 'supplied' | 'lost';

export interface Settlement {
  inId: string;
  outId: string;
  outLineId: string;
  item_id: string;
  qty: number;
  what: SettleKind;
  /** MF-C3: a loss line tagged `mf.scrap_at_jw` — waste / scrap kept or sold by the job worker (Sec 143(5)); still a loss. */
  scrap_at_jw?: true;
}

/**
 * Every Material Out line with what has come back against it. A Material In line settles the challan line it
 * names (`out_line_id`), else the oldest open line of the same item at the same job worker's godown (FIFO).
 */
export function challanBalances(outs: readonly MaterialOut[], ins: readonly MaterialIn[], today: string, opts: { excludeInId?: string } = {}): ChallanBalances {
  const rows: (ChallanLineBalance & { rate: number })[] = [];
  const sortedOuts = [...outs].filter((o) => o?.id && day(o.date)).sort((a, b) => day(a.date).localeCompare(day(b.date)) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  for (const o of sortedOuts) {
    for (const l of o.lines ?? []) {
      const f = lineFactor(l);
      const sent = num(l.qty) * f;
      if (!l.item_id || !(sent > 0)) continue;
      const kind = l.goods_kind ?? 'input';
      rows.push({
        outId: o.id, number: o.number, date: day(o.date), party: o.party_name, godown: o.job_worker_godown, lineId: l.id, item_id: l.item_id,
        kind, sent, consumed: 0, returned: 0, supplied: 0, lost: 0, pending: sent, pendingValue: 0,
        deadline: returnDeadline(o.date, kind, o.extended_until), daysLeft: null, status: 'open', late: false, rate: num(l.rate) / f,
      });
    }
  }
  const byLine = new Map(rows.map((r) => [r.lineId, r]));
  const unmatched: ChallanBalances['unmatched'] = [];
  const settlements: Settlement[] = [];
  const sortedIns = [...ins].filter((v) => v?.id && v.id !== opts.excludeInId && day(v.date)).sort((a, b) => day(a.date).localeCompare(day(b.date)) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  for (const v of sortedIns) {
    const lines: [JobWorkLine, SettleKind][] = [
      ...(v.consumed ?? []).map((l) => [l, 'consumed'] as [JobWorkLine, SettleKind]),
      ...(v.received ?? []).filter((l) => l.kind === 'returned').map((l) => [l, 'returned'] as [JobWorkLine, SettleKind]),
      ...(v.supplied ?? []).map((l) => [l, 'supplied'] as [JobWorkLine, SettleKind]),
      ...(v.losses ?? []).map((l) => [l, 'lost'] as [JobWorkLine, SettleKind]),
    ];
    for (const [l, what] of lines) {
      let rest = num(l?.qty) * lineFactor(l);
      if (!l?.item_id || !(rest > 0)) continue;
      const take = (r: ChallanLineBalance) => {
        const q = Math.min(rest, Math.max(r.pending, 0));
        if (q <= EPS) return;
        r[what] += q;
        r.pending -= q;
        rest -= q;
        settlements.push({ inId: v.id, outId: r.outId, outLineId: r.lineId, item_id: r.item_id, qty: roundQty(q), what, ...(what === 'lost' && (l as { mf?: { scrap_at_jw?: boolean } }).mf?.scrap_at_jw ? { scrap_at_jw: true as const } : {}) });
        if (r.deadline && day(v.date) > r.deadline) r.late = true;
      };
      const named = l.out_line_id ? byLine.get(l.out_line_id) : undefined;
      if (named && named.item_id === l.item_id) take(named);
      for (const r of rows) {
        if (rest <= EPS) break;
        if (r.item_id === l.item_id && r.godown === v.job_worker_godown && r.date <= day(v.date)) take(r);
      }
      if (rest > EPS) unmatched.push({ inId: v.id, number: v.number, item_id: l.item_id, qty: roundQty(rest) });
    }
  }
  const lines = rows.map(({ rate, ...r }) => {
    const pending = roundQty(Math.max(r.pending, 0));
    const daysLeft = r.deadline ? daysBetween(today, r.deadline) : null;
    const status: ClockStatus = pending <= EPS ? 'settled'
      : !r.deadline ? 'no_limit'
      : (daysLeft ?? 0) < 0 ? 'expired'
      : (daysLeft ?? 0) <= DUE_SOON_DAYS ? 'due_soon' : 'open';
    return {
      ...r, sent: roundQty(r.sent), consumed: roundQty(r.consumed), returned: roundQty(r.returned), supplied: roundQty(r.supplied),
      lost: roundQty(r.lost), pending, pendingValue: round2(pending * rate), daysLeft, status,
    };
  });
  return { lines, unmatched, settlements };
}

export interface JobWorkAlert {
  level: 'warning' | 'danger';
  line: ChallanLineBalance;
  /** English text (the screen translates from the fields). */
  message: string;
}

/**
 * Clock alerts: lines due within `DUE_SOON_DAYS` (warning) and lines past their clock (danger: deemed supply on the
 * day the goods were sent out — Sec 143(3) / (4); raise an invoice and pay the tax with interest; verify with your CA).
 */
export function jobWorkAlerts(b: ChallanBalances): JobWorkAlert[] {
  const out: JobWorkAlert[] = [];
  for (const l of b.lines) {
    if (l.status === 'expired') {
      out.push({ level: 'danger', line: l, message: `${l.number}: ${l.pending} still with ${l.party} past ${l.deadline} — deemed supply on ${l.date} (Sec 143). Verify with your CA.` });
    } else if (l.status === 'due_soon') {
      out.push({ level: 'warning', line: l, message: `${l.number}: ${l.pending} due back from ${l.party} by ${l.deadline} (${l.daysLeft} days).` });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? (a.line.deadline < b.line.deadline ? -1 : 1) : a.level === 'danger' ? -1 : 1));
}

/** Pending quantity per item at each job worker's godown (base units): "our stock with third party". */
export function stockWithJobWorkers(b: ChallanBalances): { godown: string; party: string; item_id: string; pending: number; value: number }[] {
  const m = new Map<string, { godown: string; party: string; item_id: string; pending: number; value: number }>();
  for (const l of b.lines) {
    if (l.pending <= EPS) continue;
    const k = `${l.godown}|${l.item_id}`;
    const r = m.get(k) ?? { godown: l.godown, party: l.party, item_id: l.item_id, pending: 0, value: 0 };
    r.pending = roundQty(r.pending + l.pending);
    r.value = round2(r.value + l.pendingValue);
    m.set(k, r);
  }
  return [...m.values()];
}

/* ── BOM consumption (optional) ──────────────────────────────── */

/** Inputs a finished quantity consumes per the BOM (scrap % grossed up), in base units. */
export function bomConsumption(bom: Pick<Bom, 'batch_qty' | 'components'>, finishedQty: number, newId: () => string = generateId): JobWorkLine[] {
  const per = num(bom.batch_qty) > 0 ? num(finishedQty) / num(bom.batch_qty) : num(finishedQty);
  return (bom.components ?? [])
    .map((c) => ({ id: newId(), item_id: c.item_id, qty: roundQty(num(c.qty) * per * (1 + Math.max(num(c.scrap_pct), 0) / 100)) }))
    .filter((l) => l.item_id && l.qty > 0);
}

/* ── Validation ───────────────────────────────────────────────── */

const tracked = (items: readonly StockItem[], id: string) => items.find((i) => i.id === id && i.track_stock);

export function validateOrder(o: Pick<JobWorkOrder, 'date' | 'direction' | 'party_name' | 'finished_item_id' | 'finished_qty'>): string {
  if (!day(o.date)) return 'Choose the order date.';
  if (!o.party_name?.trim()) return o.direction === 'in' ? 'Enter the principal.' : 'Choose the job worker.';
  if (o.finished_item_id && !(num(o.finished_qty) > 0)) return 'Enter the quantity to be processed.';
  return '';
}

export function validateMaterialOut(o: Pick<MaterialOut, 'date' | 'party_name' | 'job_worker_godown' | 'lines'>, items: readonly StockItem[], godowns: readonly Godown[]): string {
  if (!day(o.date)) return 'Choose the challan date.';
  if (!o.party_name?.trim()) return 'Choose the job worker.';
  const g = godowns.find((x) => x.id === o.job_worker_godown);
  if (!g) return "Choose the job worker's godown.";
  if (!g.job_worker) return `${g.name} is not a job worker's godown.`;
  const lines = (o.lines ?? []).filter((l) => l.item_id);
  if (!lines.length) return 'Add at least one item to send.';
  for (const l of lines) {
    const it = tracked(items, l.item_id);
    if (!it) return 'Every line needs a stock item that tracks stock.';
    if (!(num(l.qty) > 0)) return `${it.name}: enter a quantity above zero.`;
    if ((l.godown_id || 'main') === o.job_worker_godown) return `${it.name}: send it from one of your own godowns.`;
    if (it.track_batches && !l.batch_no?.trim()) return `${it.name}: choose the batch.`;
    const serialErr = serialLineShape(l, it); // 7S: serial items go by serial
    if (serialErr) return serialErr;
  }
  return serialShapeError(lines, items);
}

/** Problems with a Material In against the open challans (its own saved copy left out). */
export function validateMaterialIn(v: Pick<MaterialIn, 'id' | 'date' | 'party_name' | 'job_worker_godown' | 'consumed' | 'received' | 'losses' | 'supplied' | 'charges'>, items: readonly StockItem[], outs: readonly MaterialOut[], ins: readonly MaterialIn[], today: string): string {
  if (!day(v.date)) return 'Choose the date received.';
  if (!v.party_name?.trim() || !v.job_worker_godown) return 'Choose the job worker.';
  const all = [...(v.consumed ?? []), ...(v.received ?? []), ...(v.losses ?? []), ...(v.supplied ?? [])].filter((l) => l.item_id);
  if (!all.length) return 'Add what came back, was consumed or was supplied.';
  for (const l of all) {
    const it = tracked(items, l.item_id);
    if (!it) return 'Every line needs a stock item that tracks stock.';
    if (!(num(l.qty) > 0)) return `${it.name}: enter a quantity above zero.`;
    const serialErr = serialLineShape(l, it); // 7S
    if (serialErr) return serialErr;
  }
  const processed = (v.received ?? []).filter((l) => l.item_id && l.kind === 'processed');
  if (processed.length && !(v.consumed ?? []).some((l) => l.item_id)) return 'Enter the inputs consumed for the processed goods (or fill them from the BOM).';
  if ((v.consumed ?? []).some((l) => l.item_id) && !processed.length) return 'Inputs were consumed: add the processed goods received (or record them as a loss).';
  if (num(v.charges) < 0) return 'Job work charges cannot be negative.';
  const probe = challanBalances(outs, [...ins.filter((x) => x.id !== v.id), { ...(v as MaterialIn), id: v.id || '__draft__', number: '(this entry)' }], today);
  const over = probe.unmatched.find((u) => u.inId === (v.id || '__draft__'));
  if (over) {
    const name = items.find((i) => i.id === over.item_id)?.name ?? 'An item';
    return `${name}: ${over.qty} more than is pending with this job worker on that date.`;
  }
  return '';
}

/**
 * 7S: serial stock checks for a Material Out (serials in the source godown on the challan date) or a Material In
 * (consumed / returned / supplied / lost serials at the job worker's godown; processed goods and scrap under new
 * serials). `input` must leave the document's saved copy out. [] when no line is serial-tracked.
 */
export function jobWorkSerialIssues(doc: { kind: 'out'; value: Pick<MaterialOut, 'date' | 'job_worker_godown' | 'lines'> } | { kind: 'in'; value: Pick<MaterialIn, 'date' | 'job_worker_godown' | 'consumed' | 'received' | 'losses' | 'supplied'> }, input: StockInputs): string[] {
  const d = day(doc.value.date);
  if (doc.kind === 'out') {
    const lines = doc.value.lines ?? [];
    if (!touchesSerials(lines, input.items)) return [];
    const events = collectEvents({ ...input, includeTransfers: true });
    return serialOutIssues(lines, d, events, input.items, (l) => l.godown_id || 'main');
  }
  const v = doc.value;
  const leaving = [...(v.consumed ?? []), ...(v.losses ?? []), ...(v.supplied ?? []), ...(v.received ?? []).filter((l) => l.kind === 'returned')];
  const made = (v.received ?? []).filter((l) => l.kind !== 'returned');
  if (!touchesSerials([...leaving, ...made], input.items)) return [];
  const shape = serialShapeError([...leaving, ...made], input.items);
  if (shape) return [shape];
  const events = collectEvents({ ...input, includeTransfers: true });
  return [...serialOutIssues(leaving, d, events, input.items, () => v.job_worker_godown || 'main'), ...serialInIssues(made, d, events, input.items)];
}

/** Live inputs without one job-work document (for the serial checks on save). */
function inputsWithout(id: string | undefined): StockInputs {
  const base = liveInputs();
  const docs = base.jobWorkDocs;
  return { ...base, jobWorkDocs: docs ? { ...docs, outs: docs.outs.filter((o) => o.id !== id), ins: docs.ins.filter((i) => i.id !== id) } : docs };
}

/* ── Job Work In side (principal's goods) ─────────────────────── */

export interface PrincipalBalance {
  party: string;
  order_id?: string;
  name: string;
  unit?: string;
  received: number;
  returned: number;
  pending: number;
}

/** The principal's goods still with us, per party (or order) and item name (case-insensitive). */
export function principalBalances(rows: readonly PrincipalMovement[]): PrincipalBalance[] {
  const m = new Map<string, PrincipalBalance>();
  for (const r of rows) {
    for (const l of r?.lines ?? []) {
      const name = String(l?.name ?? '').trim();
      if (!name || !(num(l.qty) > 0)) continue;
      const k = `${r.order_id ?? r.party_name.trim().toLowerCase()}|${name.toLowerCase()}`;
      const b = m.get(k) ?? { party: r.party_name, ...(r.order_id ? { order_id: r.order_id } : {}), name, ...(l.unit ? { unit: l.unit } : {}), received: 0, returned: 0, pending: 0 };
      if (r.kind === 'receipt') b.received = roundQty(b.received + num(l.qty));
      else b.returned = roundQty(b.returned + num(l.qty));
      b.pending = roundQty(b.received - b.returned);
      m.set(k, b);
    }
  }
  return [...m.values()];
}

/** SAC 9988 "manufacturing services on physical inputs owned by others"; the rate depends on the goods. */
export const JOB_WORK_SAC = '9988';

/**
 * A service line for our job charges to the principal. GST on job work depends on the goods and the principal
 * (5% / 12% / 18% …): the line carries `taxRate` as given — verify with your CA.
 */
export function jobChargesLine(o: Pick<JobWorkOrder, 'process' | 'rate' | 'number'>, qty: number, taxRate: number): InvoiceItem {
  const q = Math.max(num(qty), 0) || 1;
  const rate = Math.max(num(o.rate), 0);
  return {
    id: generateId(), name: `Job work charges${o.process ? ` — ${o.process}` : ''}${o.number ? ` (${o.number})` : ''}`,
    type: 'Service', hsn: JOB_WORK_SAC, unit: 'NOS', quantity: q, rate, tax_rate: taxRate, amount: round2(q * rate),
  } as InvoiceItem;
}

/* ================================================================
   Storage (browser; same synchronous storage API as every module)
   ================================================================ */

const now = () => new Date().toISOString();
const lockOf = (r: { id: string; date: string; number: string }) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });
const tag = (state: string) => (state === 'overridden' ? ' (period lock overridden)' : '');
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

type Numbered = { id: string; number: string; date: string; created_at?: string; updated_at?: string };

function saveDoc<T extends Numbered>(table: string, prefix: string, label: string, input: Omit<T, 'id' | 'number'> & { id?: string; number?: string }, describe: (r: T) => string): T {
  requireAccess('books.edit');
  const rows = getTable<T>(table);
  const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
  if (existing) assertUnlocked(lockOf(existing), 'edit');
  // Series high-water mark: a deleted latest number is never issued again; a date moved into another FY renumbers.
  const kept = (input.number ?? '').trim() || existing?.number || '';
  const number = kept && numberFitsFy(kept, input.date) ? kept : nextSeriesNumberFor(prefix, input.date, rows.map((r) => r.number));
  const id = existing?.id ?? input.id ?? generateId();
  const state = assertUnlocked(lockOf({ id, date: input.date, number }), existing ? 'edit' : 'create');
  if (rows.some((r) => r.id !== id && r.number.toUpperCase() === number.toUpperCase())) throw new Error(`${label} number ${number} is already used.`);
  const record = { ...existing, ...input, id, number, created_at: existing?.created_at ?? now(), updated_at: now() } as T;
  setTable(table, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
  recordSeries(number);
  audit.record({
    entity: 'job_work', entity_id: id, action: existing ? 'update' : 'create', doc_number: number,
    summary: `${existing ? 'Edited' : 'Created'} ${label.toLowerCase()} ${number}: ${describe(record)}${tag(state)}`,
  });
  return record;
}

function removeDoc<T extends Numbered>(table: string, label: string, id: string): T | undefined {
  requireAccess('books.edit');
  const rows = getTable<T>(table);
  const r = rows.find((x) => x.id === id);
  if (!r) return undefined;
  const state = assertUnlocked(lockOf(r), 'delete');
  setTable(table, rows.filter((x) => x.id !== id));
  audit.record({ entity: 'job_work', entity_id: id, action: 'delete', doc_number: r.number, summary: `Deleted ${label.toLowerCase()} ${r.number}${tag(state)}` });
  return r;
}

const cleanLines = <L extends JobWorkLine>(ls: readonly L[] | undefined): L[] => (ls ?? []).filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ ...l, qty: num(l.qty) }));

export const jobWorkOrdersDb = {
  all: (): JobWorkOrder[] => getTable<JobWorkOrder>(JOB_WORK_TABLES.orders),
  nextNumber: (date?: string) => nextSeriesNumberFor(JOB_WORK_PREFIX.order, date, jobWorkOrdersDb.all().map((r) => r.number)),
  save(input: Omit<JobWorkOrder, 'id' | 'number'> & { id?: string; number?: string }): JobWorkOrder {
    const err = validateOrder(input);
    if (err) throw new Error(err);
    return saveDoc<JobWorkOrder>(JOB_WORK_TABLES.orders, JOB_WORK_PREFIX.order, input.direction === 'in' ? 'Job work in order' : 'Job work out order',
      { ...input, party_name: input.party_name.trim() }, (r) => `${r.party_name}${r.process ? ` · ${r.process}` : ''}`);
  },
  remove(id: string): void {
    const refs = [...materialOutDb.all(), ...materialInDb.all(), ...principalDb.all()].filter((d) => d.order_id === id);
    if (refs.length) throw new Error(`This order is used by ${refs.map((d) => d.number).slice(0, 3).join(', ')}, so it cannot be deleted.`);
    removeDoc<JobWorkOrder>(JOB_WORK_TABLES.orders, 'Job work order', id);
  },
};

export const materialOutDb = {
  all: (): MaterialOut[] => getTable<MaterialOut>(JOB_WORK_TABLES.out),
  nextNumber: (date?: string) => nextSeriesNumberFor(JOB_WORK_PREFIX.out, date, materialOutDb.all().map((r) => r.number)),
  save(input: Omit<MaterialOut, 'id' | 'number'> & { id?: string; number?: string }, items: readonly StockItem[], godowns: readonly Godown[]): MaterialOut {
    const err = validateMaterialOut(input, items, godowns);
    if (err) throw new Error(err);
    const draft = { ...input, party_name: input.party_name.trim(), lines: cleanLines(input.lines) };
    if (touchesSerials(draft.lines, items)) {
      const issue = jobWorkSerialIssues({ kind: 'out', value: draft }, inputsWithout(input.id))[0];
      if (issue) throw new Error(issue);
    }
    if (input.id) {
      // An edit must not leave Material In entries settling more than is now sent.
      const others = materialOutDb.all().filter((o) => o.id !== input.id);
      const probe = challanBalances([...others, { ...(draft as MaterialOut), id: input.id, number: input.number ?? '' }], materialInDb.all(), day(input.date));
      if (probe.unmatched.length) throw new Error('Material already received against this challan is more than it would now send. Change the Material In entries first.');
    }
    return saveDoc<MaterialOut>(JOB_WORK_TABLES.out, JOB_WORK_PREFIX.out, 'Material out', draft,
      (r) => `${plural(r.lines.length, 'line')} to ${r.party_name}`);
  },
  remove(id: string): void {
    const ins = materialInDb.all();
    const probe = challanBalances(materialOutDb.all().filter((o) => o.id !== id), ins, '9999-12-31');
    if (probe.unmatched.length) throw new Error('Material has already come back against this challan. Delete those Material In entries first.');
    if (materialOutDb.all().find((o) => o.id === id)?.lines.some((l) => l.serials?.length)) {
      assertRemovable({ errors: liveRemovalIssues({ refType: 'job_work_out', refId: id }).errors, warnings: [] });
    }
    removeDoc<MaterialOut>(JOB_WORK_TABLES.out, 'Material out', id);
  },
};

export const materialInDb = {
  all: (): MaterialIn[] => getTable<MaterialIn>(JOB_WORK_TABLES.in),
  nextNumber: (date?: string) => nextSeriesNumberFor(JOB_WORK_PREFIX.in, date, materialInDb.all().map((r) => r.number)),
  save(input: Omit<MaterialIn, 'id' | 'number'> & { id?: string; number?: string }, items: readonly StockItem[]): MaterialIn {
    const draft = {
      ...input, party_name: input.party_name.trim(),
      consumed: cleanLines(input.consumed), received: cleanLines(input.received),
      ...(input.losses?.length ? { losses: cleanLines(input.losses) } : {}),
      ...(input.supplied?.length ? { supplied: cleanLines(input.supplied) } : {}),
      ...(num(input.charges) > 0 ? { charges: round2(num(input.charges)) } : { charges: undefined }),
    };
    const err = validateMaterialIn({ ...draft, id: input.id ?? '' }, items, materialOutDb.all(), materialInDb.all(), day(input.date));
    if (err) throw new Error(err);
    if (touchesSerials([...draft.consumed, ...draft.received, ...(draft.losses ?? []), ...(draft.supplied ?? [])], items)) {
      const issue = jobWorkSerialIssues({ kind: 'in', value: draft }, inputsWithout(input.id))[0];
      if (issue) throw new Error(issue);
    }
    return saveDoc<MaterialIn>(JOB_WORK_TABLES.in, JOB_WORK_PREFIX.in, 'Material in', draft,
      (r) => `${plural(r.received.length, 'line')} received from ${r.party_name}${r.charges ? `, charges ₹${r.charges}` : ''}`);
  },
  remove(id: string): void {
    const v = materialInDb.all().find((x) => x.id === id);
    if (v && [...v.consumed, ...v.received, ...(v.losses ?? []), ...(v.supplied ?? [])].some((l) => l.serials?.length)) {
      assertRemovable({ errors: liveRemovalIssues({ refType: 'job_work_in', refId: id }).errors, warnings: [] });
    }
    removeDoc<MaterialIn>(JOB_WORK_TABLES.in, 'Material in', id);
  },
};

export const principalDb = {
  all: (): PrincipalMovement[] => getTable<PrincipalMovement>(JOB_WORK_TABLES.principal),
  nextNumber: (date?: string) => nextSeriesNumberFor(JOB_WORK_PREFIX.principal, date, principalDb.all().map((r) => r.number)),
  save(input: Omit<PrincipalMovement, 'id' | 'number'> & { id?: string; number?: string }): PrincipalMovement {
    if (!day(input.date)) throw new Error('Choose the date.');
    if (!input.party_name?.trim()) throw new Error('Enter the principal.');
    const lines = (input.lines ?? []).filter((l) => l.name?.trim() && num(l.qty) > 0).map((l) => ({ ...l, name: l.name.trim(), qty: num(l.qty) }));
    if (!lines.length) throw new Error('Add at least one line.');
    if (input.kind === 'return') {
      const others = principalDb.all().filter((r) => r.id !== input.id);
      const bal = principalBalances([...others, { ...(input as PrincipalMovement), id: input.id ?? '__draft__', number: '', lines }]);
      const neg = bal.find((b) => b.pending < -EPS);
      if (neg) throw new Error(`${neg.name}: more is sent back than was received from ${neg.party}.`);
    }
    return saveDoc<PrincipalMovement>(JOB_WORK_TABLES.principal, JOB_WORK_PREFIX.principal, input.kind === 'receipt' ? "Principal's material received" : "Principal's material returned",
      { ...input, party_name: input.party_name.trim(), lines }, (r) => `${plural(r.lines.length, 'line')} · ${r.party_name}`);
  },
  remove: (id: string) => void removeDoc<PrincipalMovement>(JOB_WORK_TABLES.principal, "Principal's material entry", id),
};

/** Job workers' godowns (flagged `job_worker`). */
export function jobWorkerGodowns(list: readonly Godown[]): Godown[] {
  return list.filter((g) => g.job_worker);
}

/** The pure part of `ensureJobWorkerGodown`: an existing godown for this job worker, by vendor id or name. */
export function findJobWorkerGodown(list: readonly Godown[], party: { vendor_id?: string; name: string }): Godown | undefined {
  const jw = jobWorkerGodowns(list);
  const name = `${party.name.trim()} (job worker)`.toLowerCase();
  return (party.vendor_id ? jw.find((g) => g.vendor_id === party.vendor_id) : undefined) ?? jw.find((g) => g.name.trim().toLowerCase() === name);
}

/** The job worker's godown, created ("<name> (job worker)", flagged `job_worker`) the first time goods go there. */
export function ensureJobWorkerGodown(party: { vendor_id?: string; name: string }): Godown {
  const found = findJobWorkerGodown(godownsDb.list(), party);
  if (found) return found;
  requireAccess('books.edit');
  return godownsDb.save({ name: `${party.name.trim()} (job worker)`, job_worker: true, ...(party.vendor_id ? { vendor_id: party.vendor_id } : {}) });
}

/** Live challan balances and alerts (today = local day). */
export function liveChallanBalances(today: string): ChallanBalances {
  return challanBalances(materialOutDb.all(), materialInDb.all(), today);
}
