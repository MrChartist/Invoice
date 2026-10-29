/**
 * Point-in-time stock checks (data-integrity review, 2026-10).
 *
 * Every balance in inventory is derived from a dated event list (`collectEvents`). Checking a
 * document against the END state of that list is wrong in both directions: a back-dated sale can
 * take a serial that only arrived later, and a sale / transfer / deletion can pull stock out from
 * under a LATER document that already relied on it. The rule here is the one a ledger uses:
 *
 *   a document may take `q` units of a dimension (item × godown, batch or serial) on day D only if
 *   the balance at the end of day D is at least `q` AND the lowest running balance from D onwards
 *   stays at least `q` — i.e. no later outgoing event depends on those units.
 *
 * Removing a record (purchase bill, transfer, credit note) is checked the same way: it must not
 * make a running balance go below zero where it did not before.
 *
 * Pure; imports only the inventory engine (no godowns / stock-tracking, so `godowns.ts` and
 * `purchases.ts` can use it without an import cycle).
 */
import { collectEvents, liveInputs, type StockEvent, type StockInputs, type StockItem } from './inventory';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer } from '../types/stock';
import { getTable } from './storage';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const skey = (s: string) => s.trim().toUpperCase();

/** A day: everything dated on or before it counts as "before" (same-day order does not matter). */
export interface DayWindow {
  /** Balance at the end of the day. */
  at: number;
  /** Lowest running balance from the end of that day onwards (never above `at`). */
  lowest: number;
  /** Events after the day with the running balance after each. */
  later: { ev: StockEvent; bal: number }[];
  /** Events on or before the day that matched (delta ≠ 0), oldest first. */
  before: StockEvent[];
}

/** Running balance of `delta` over `events` (already in date order) around the end of `day`. */
export function dayWindow(events: readonly StockEvent[], day: string, delta: (ev: StockEvent) => number): DayWindow {
  let bal = 0;
  const before: StockEvent[] = [];
  const later: { ev: StockEvent; bal: number }[] = [];
  for (const ev of events) {
    const d = delta(ev);
    if (!d) continue;
    bal = roundQty(bal + d);
    if (ev.date <= day) before.push(ev);
    else later.push({ ev, bal });
  }
  const at = before.reduce((s, ev) => roundQty(s + delta(ev)), 0);
  const lowest = later.reduce((m, r) => Math.min(m, r.bal), at);
  return { at, lowest, later, before };
}

/** First later event that leaves less than `need` units (the document that depends on them). */
export function firstShortAfter(w: DayWindow, need: number): StockEvent | undefined {
  return w.later.find((r) => r.bal < need - EPS)?.ev;
}

/** +1 / -1 for an event that names `serial` (company-wide: transfers net out; or in one godown). */
export function serialDelta(serial: string, godown?: string): (ev: StockEvent) => number {
  const k = skey(serial);
  return (ev) => {
    if (!ev.serials?.some((s) => skey(s) === k)) return 0;
    if (godown === undefined ? ev.kind === 'transfer' : ev.godown !== godown) return 0;
    return ev.qty > 0 ? 1 : -1;
  };
}

/** Units of a batch (in one godown, or company-wide). */
export function batchDelta(batch: string, godown?: string): (ev: StockEvent) => number {
  const k = skey(batch);
  return (ev) => {
    if (skey(ev.batch ?? '') !== k) return 0;
    if (godown === undefined ? ev.kind === 'transfer' : ev.godown !== godown) return 0;
    return ev.qty;
  };
}

/** Units in one godown (or company-wide). */
export function godownDelta(godown?: string): (ev: StockEvent) => number {
  return (ev) => (godown === undefined ? (ev.kind === 'transfer' ? 0 : ev.qty) : ev.godown === godown ? ev.qty : 0);
}

/** "INV/FY26-27/0004 (2026-05-02)" for a message. */
export function eventLabel(ev: StockEvent | undefined): string {
  if (!ev) return 'a later entry';
  return `${ev.refNumber || (ev.kind === 'adjustment' ? 'a stock adjustment' : 'a later entry')} (${ev.date})`;
}

/* ── Removing a record ───────────────────────────────────────── */

export interface RemovalIssues {
  /** Serials a later document already sold / moved: the removal is refused. */
  errors: string[];
  /** Quantities / batches that would go below zero: allowed only after an explicit confirmation. */
  warnings: string[];
}

export interface RemovalRef {
  /** 7S adds the stock vouchers and job-work documents (serial removal checks). */
  refType: 'purchase' | 'transfer' | 'invoice' | 'manufacturing' | 'stock_journal' | 'job_work_out' | 'job_work_in';
  refId: string;
}

/**
 * What removing a purchase bill, a stock transfer or a goods-returning credit note would break:
 * a running balance (godown quantity, batch or serial) that goes below zero only because the
 * record's units are gone — i.e. a later sale, transfer or adjustment used them.
 */
export function removalIssues(
  input: StockInputs, ref: RemovalRef, multi: boolean, godownName: (id: string) => string = (id) => (id === MAIN_GODOWN_ID ? 'Main' : id),
): RemovalIssues {
  const out: RemovalIssues = { errors: [], warnings: [] };
  const events = collectEvents({ ...input, includeTransfers: true });
  const items = new Map(input.items.map((i) => [i.id, i]));
  const isRef = (ev: StockEvent) => ev.refType === ref.refType && ev.refId === ref.refId;
  for (const [itemId, list] of events) {
    const removed = list.filter(isRef);
    if (!removed.length) continue;
    const item = items.get(itemId) as StockItem;
    const rest = list.filter((ev) => !isRef(ev));
    const checks = new Map<string, { delta: (ev: StockEvent) => number; serial: boolean; what: string }>();
    for (const ev of removed) {
      const g = multi ? ev.godown : undefined;
      if (!checks.has(`q|${g ?? ''}`)) {
        checks.set(`q|${g ?? ''}`, { delta: godownDelta(g), serial: false, what: multi ? `stock in ${godownName(ev.godown)}` : 'stock' });
      }
      if (item.track_batches && ev.batch) {
        checks.set(`b|${skey(ev.batch)}|${g ?? ''}`, { delta: batchDelta(ev.batch, g), serial: false, what: `batch ${ev.batch}` });
      }
      if (item.track_serials) {
        for (const s of ev.serials ?? []) {
          checks.set(`s|${skey(s)}`, { delta: serialDelta(s), serial: true, what: `serial ${s.trim()}` });
          if (multi) checks.set(`s|${skey(s)}|${ev.godown}`, { delta: serialDelta(s, ev.godown), serial: true, what: `serial ${s.trim()} in ${godownName(ev.godown)}` });
        }
      }
    }
    for (const c of checks.values()) {
      const minBefore = lowestRunning(list, c.delta).min;
      const after = lowestRunning(rest, c.delta, Math.min(minBefore, 0));
      if (!(after.min < -EPS && after.min < minBefore - EPS)) continue;
      const msg = `${item.name}: ${eventLabel(after.first)} uses ${c.what} that this entry provides, ${c.serial ? 'remove or change that entry first' : `it would go ${roundQty(after.min)} below zero`}.`;
      (c.serial ? out.errors : out.warnings).push(msg);
    }
  }
  return out;
}

/** Lowest running balance, and the first event that takes it below `floor`. */
function lowestRunning(events: readonly StockEvent[], delta: (ev: StockEvent) => number, floor = 0): { min: number; first?: StockEvent } {
  let bal = 0;
  let min = 0;
  let first: StockEvent | undefined;
  for (const ev of events) {
    const d = delta(ev);
    if (!d) continue;
    bal = roundQty(bal + d);
    if (bal < min) min = bal;
    if (!first && bal < floor - EPS) first = ev;
  }
  return { min, first };
}

/** Readable error for code paths that refuse a removal (`removalIssues`). */
export class StockDependencyError extends Error {
  readonly code = 'STOCK_DEPENDENCY';
  /** True when only warnings were found: the caller may retry with an explicit confirmation. */
  readonly confirmable: boolean;
  readonly issues: RemovalIssues;
  constructor(issues: RemovalIssues) {
    const list = issues.errors.length ? issues.errors : issues.warnings;
    super(list.join(' '));
    this.name = 'StockDependencyError';
    this.confirmable = issues.errors.length === 0;
    this.issues = issues;
  }
}

export function isStockDependencyError(err: unknown): err is StockDependencyError {
  return (err as { code?: string } | null)?.code === 'STOCK_DEPENDENCY';
}

/** Throw unless the removal is clean, or only warns and the user confirmed. */
export function assertRemovable(issues: RemovalIssues, confirmed = false): void {
  if (issues.errors.length || (issues.warnings.length && !confirmed)) throw new StockDependencyError(issues);
}

/* ── Live data ───────────────────────────────────────────────── */

/**
 * `removalIssues` over the stored data. Cheap when nothing is stock-tracked (no events are built).
 * Table names are spelled out (not imported from godowns.ts) to keep this module cycle-free.
 */
export function liveRemovalIssues(ref: RemovalRef): RemovalIssues {
  const base = liveInputs();
  if (!base.items.some((i) => i.track_stock)) return { errors: [], warnings: [] };
  const godowns = getTable<Godown>('godowns').filter((g) => g && g.id !== MAIN_GODOWN_ID && g.name?.trim());
  const names = new Map(getTable<Godown>('godowns').map((g) => [g.id, g.name]));
  const name = (id: string) => names.get(id) || (id === MAIN_GODOWN_ID ? 'Main' : 'another godown');
  return removalIssues({ ...base, transfers: getTable<StockTransfer>('stock_transfers') }, ref, godowns.length > 0, name);
}
