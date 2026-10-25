/**
 * Closing stock for the ledger statements (WP-2, P0-3). Stock is a REPORT-TIME line, never a stored
 * voucher: `postings.ts` stays untouched and nothing is written twice.
 *
 * A `StockValuer` answers two questions for any date:
 *   value(d)     stock-in-hand at the END of `d`, in paise (the inventory engine's FIFO / weighted
 *                average valuation, or the closing-stock figure the user typed);
 *   openingIn(d) the part of that stock that came in as OPENING stock (item-master opening quantity,
 *                dated "opening" moves, or the typed opening figure) on or before `d`.
 *
 * Statements then use, the way Tally does with "Integrate accounts and inventory":
 *   Trading account   opening stock = value(start − 1) + openings inside the period;
 *                     closing stock = value(end)  →  gross profit moves by (closing − opening)
 *   Balance sheet     Inventories += value(asOf);  "Difference in opening balances" (capital) is
 *                     credited with openingIn(asOf), so the sheet still ties.
 * The opening stock never becomes profit; every other change in stock value does (purchases are
 * expensed in full by the postings, so closing stock is what turns them into cost of goods sold).
 *
 * Pure except `loadClosingStockConfig` / `saveClosingStockConfig` (one JSON key, company data, in
 * backups; saving needs `books.edit`, respects the period lock and is audited). Working papers — verify with your CA.
 */

import type { StockPosition } from '../inventory';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { assertUnlocked, getLockUntil } from '../period-lock';
import { getJson, setJson, DB_PREFIX } from '../storage';
import { formatMoney } from '../utils';
import type { ManualVoucher } from './vouchers';

/** Voucher class of the year-end wizard's closing-stock journal (re-exported by `year-end.ts`). */
export const CLOSING_STOCK_CLASS = 'Year-end closing stock';
/** Stock-in-hand account id (`A.stock` in `accounts.ts`; repeated here to keep this module dependency-free). */
const STOCK_ACCOUNT = 'stock';

export type ClosingStockMode = 'inventory' | 'manual' | 'none';

export interface ClosingStockEntry {
  /** YYYY-MM-DD: the value applies from the end of this day until the next entry. */
  date: string;
  /** Integer paise. */
  value: number;
}

export interface ClosingStockConfig {
  /** Absent = automatic: the inventory engine when any item tracks stock, else none. */
  mode?: ClosingStockMode;
  /** Manual mode: stock at the start of the books (paise), shown as opening stock. */
  opening?: number;
  /** Manual mode: date-wise closing stock values typed by the user. */
  entries?: ClosingStockEntry[];
}

export interface StockValuer {
  mode: Exclude<ClosingStockMode, 'none'>;
  /** Short description for report notes ("Inventory, FIFO", "Typed closing stock"). */
  label: string;
  value(date: string): number;
  openingIn(date: string): number;
  /** Closing-stock journals this valuation is netted against (`netOfStockJournals`), for a warning. */
  netted?: readonly StockJournalPosting[];
}

export const CLOSING_STOCK_KEY = `${DB_PREFIX}closing_stock`;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const paise = (rupees: number) => Math.round((Number.isFinite(rupees) ? rupees : 0) * 100);

/** Tolerant read of the stored config (bad rows dropped, entries sorted by date). */
export function normalizeClosingStockConfig(raw: unknown): ClosingStockConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = o.mode === 'inventory' || o.mode === 'manual' || o.mode === 'none' ? o.mode : undefined;
  const entries = (Array.isArray(o.entries) ? o.entries : [])
    .map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : {}))
    .filter((e) => typeof e.date === 'string' && ISO.test(e.date) && Number.isFinite(Number(e.value)))
    .map((e) => ({ date: e.date as string, value: Math.round(Number(e.value)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // One value per date: the last one typed wins.
  const byDate = new Map(entries.map((e) => [e.date, e]));
  const opening = Number(o.opening);
  return { ...(mode ? { mode } : {}), ...(Number.isFinite(opening) && opening ? { opening: Math.round(opening) } : {}), entries: [...byDate.values()] };
}

export function loadClosingStockConfig(): ClosingStockConfig {
  return normalizeClosingStockConfig(getJson<unknown>(CLOSING_STOCK_KEY, {}));
}

/**
 * Save the closing-stock source (security review M1). It changes every statement, so it is a books
 * edit (`books.edit`, like the year-end wizard's switch) and respects the period lock:
 *  - a typed entry added, changed or removed on a locked day is refused;
 *  - the typed opening, or the mode, changes the statements of every period since the books began,
 *    so either is refused while any period is locked (a PIN override on scope `closing_stock` lets
 *    the owner through, audited as such).
 * Audited. Returns the stored config.
 */
export function saveClosingStockConfig(cfg: ClosingStockConfig): ClosingStockConfig {
  requireAccess('books.edit');
  const clean = normalizeClosingStockConfig(cfg);
  const prev = loadClosingStockConfig();
  const subject = (date: string) => ({ id: CLOSING_STOCK_SCOPE, issue_date: date, invoice_number: 'Closing stock' });
  let overridden = false;
  const check = (date: string) => {
    if (assertUnlocked(subject(date), 'settings') === 'overridden') overridden = true;
  };
  const before = new Map((prev.entries ?? []).map((e) => [e.date, e.value]));
  const after = new Map((clean.entries ?? []).map((e) => [e.date, e.value]));
  const changedDays = [...new Set([...before.keys(), ...after.keys()])].filter((d) => before.get(d) !== after.get(d));
  for (const d of changedDays) check(d);
  const lockUntil = getLockUntil();
  const modeChanged = (prev.mode ?? '') !== (clean.mode ?? '');
  const openingChanged = (prev.opening ?? 0) !== (clean.opening ?? 0);
  if (lockUntil && (modeChanged || openingChanged)) check(lockUntil);
  if (!modeChanged && !openingChanged && !changedDays.length) return prev;
  setJson(CLOSING_STOCK_KEY, clean);
  const parts = [
    modeChanged ? `source ${clean.mode ?? 'automatic'} (was ${prev.mode ?? 'automatic'})` : '',
    openingChanged ? `opening ₹${formatMoney((clean.opening ?? 0) / 100)} (was ₹${formatMoney((prev.opening ?? 0) / 100)})` : '',
    changedDays.length ? `${changedDays.length} closing figure${changedDays.length === 1 ? '' : 's'} (${changedDays.join(', ')})` : '',
  ].filter(Boolean);
  try {
    audit.record({
      entity: 'settings',
      entity_id: 'closing_stock',
      action: 'update',
      summary: `Closing stock changed: ${parts.join('; ')}${overridden ? ' (period lock overridden)' : ''}`,
    });
  } catch {
    /* logging never blocks */
  }
  return clean;
}

/** Period-lock override scope for the closing-stock settings. */
export const CLOSING_STOCK_SCOPE = 'closing_stock';

/** Last row at or before `date` in a date-sorted list ('' sorts first = opening). */
function lastAtOrBefore<T extends { date: string }>(rows: readonly T[], date: string): T | undefined {
  let lo = 0;
  let hi = rows.length - 1;
  let found: T | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) {
      found = rows[mid];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * Valuer over the inventory engine's positions (`computeStock` — read only). Each item's ledger
 * rows carry the running value after every movement, in date order, so one costing run answers
 * every date. A negative item value (negative stock) counts as nil, as in the stock summary.
 */
export function inventoryValuer(positions: readonly StockPosition[], method: string = 'WEIGHTED_AVG'): StockValuer {
  const items = positions
    .filter((p) => p.item.track_stock && p.ledger.length)
    .map((p) => {
      const rows = p.ledger.map((r) => ({ date: r.date, value: r.value }));
      // Defensive: the engine emits rows in date order; keep it stable if a caller hands unsorted rows.
      const sorted = rows.every((r, i) => i === 0 || rows[i - 1].date <= r.date) ? rows : [...rows].sort((a, b) => a.date.localeCompare(b.date));
      const openings: { date: string; total: number }[] = [];
      let acc = 0;
      for (const r of p.ledger) {
        if (r.kind !== 'opening' || !r.qtyIn) continue;
        acc += r.amount;
        openings.push({ date: r.date, total: acc });
      }
      openings.sort((a, b) => a.date.localeCompare(b.date));
      return { rows: sorted, openings };
    });
  return {
    mode: 'inventory',
    label: method === 'FIFO' ? 'FIFO' : 'Weighted average',
    value: (date) => items.reduce((s, it) => s + Math.max(paise(lastAtOrBefore(it.rows, date)?.value ?? 0), 0), 0),
    openingIn: (date) => items.reduce((s, it) => s + paise(lastAtOrBefore(it.openings, date)?.total ?? 0), 0),
  };
}

/** Valuer over typed figures: the latest entry on or before the date, else the opening figure. */
export function manualValuer(cfg: ClosingStockConfig): StockValuer {
  const entries = normalizeClosingStockConfig(cfg).entries ?? [];
  const opening = Math.round(cfg.opening ?? 0);
  return {
    mode: 'manual',
    label: 'Typed closing stock',
    value: (date) => lastAtOrBefore(entries, date)?.value ?? opening,
    openingIn: () => opening,
  };
}

/** Resolve the configured mode. `positions` is only read in inventory mode (lazy: pass a thunk). */
export function stockValuerFor(
  cfg: ClosingStockConfig,
  positions: () => readonly StockPosition[],
  method?: string,
): StockValuer | undefined {
  const mode = effectiveMode(cfg, positions);
  if (mode === 'manual') return manualValuer(cfg);
  if (mode === 'inventory') return inventoryValuer(positions(), method);
  return undefined;
}

export function effectiveMode(cfg: ClosingStockConfig, positions: () => readonly StockPosition[]): ClosingStockMode {
  if (cfg.mode) return cfg.mode;
  return positions().some((p) => p.item.track_stock) ? 'inventory' : 'none';
}

/** Stock movement a statement window adds to profit: closing − opening, with openings excluded. */
export function stockChange(stock: StockValuer | undefined, end: string, dayBeforeStart: string): { opening: number; closing: number } {
  if (!stock) return { opening: 0, closing: 0 };
  const openingsInside = stock.openingIn(end) - stock.openingIn(dayBeforeStart);
  return { opening: stock.value(dayBeforeStart) + openingsInside, closing: stock.value(end) };
}

/* ── Posted closing-stock journals vs report-time valuation (no double count) ─────────────────── */

export interface StockJournalPosting {
  /** Manual voucher id of the journal. */
  id: string;
  /** Voucher number (`-R` suffix for the automatic reversal). */
  number: string;
  /** Day the journal (or its automatic reversal) moves Stock-in-hand. */
  date: string;
  /** Debit-positive paise on Stock-in-hand from this entry. */
  delta: number;
  /** Branch the journal is tagged to (WP-9), when it is: netted off that branch's own valuation. */
  branch_id?: string;
}

const ONLY_STOCK: ReadonlySet<string> = new Set([STOCK_ACCOUNT]);

/**
 * A manual journal that books closing stock into an Inventories ledger: only the year-end wizard's
 * class (review L5 — a narration that merely mentions "closing stock" is an ordinary journal).
 * `stockIds` are the Inventories ledgers (Stock-in-hand and the user's own stock ledgers), the same
 * set `stockLedgerOpening` reads.
 */
export function isClosingStockJournal(v: Pick<ManualVoucher, 'type' | 'voucher_class' | 'lines'>, stockIds: ReadonlySet<string> = ONLY_STOCK): boolean {
  if (v.type !== 'JOURNAL' || v.voucher_class !== CLOSING_STOCK_CLASS) return false;
  return v.lines.some((l) => stockIds.has(l.account_id));
}

/**
 * Stock-in-hand movements of the closing-stock journals that are in the books on `today` (optional /
 * memo / future post-dated vouchers are not), plus their automatic reversals (`reverse_on`).
 */
export function stockJournalPostings(manual: readonly ManualVoucher[], today: string, stockIds: ReadonlySet<string> = ONLY_STOCK): StockJournalPosting[] {
  const out: StockJournalPosting[] = [];
  for (const v of manual) {
    if (!isClosingStockJournal(v, stockIds)) continue;
    if (v.variant === 'MEMO' || v.variant === 'OPTIONAL' || (v.post_dated && v.date > today)) continue;
    const delta = v.lines.reduce((s, l) => s + (stockIds.has(l.account_id) ? l.dr - l.cr : 0), 0);
    if (!delta) continue;
    const branch = v.branch_id ? { branch_id: v.branch_id } : {};
    out.push({ id: v.id, number: v.number, date: v.date, delta, ...branch });
    if (v.reverse_on && v.reverse_on > v.date) out.push({ id: v.id, number: `${v.number}-R`, date: v.reverse_on, delta: -delta, ...branch });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Report-time valuation NET of what closing-stock journals already put into Stock-in-hand.
 *
 * A journal Dr Stock-in-hand | Cr Purchases on 31 March already carries the closing stock in the
 * ledger (and its 1 April reversal carries the opening stock as a purchase). Adding the valuation on
 * top would count the stock twice, so on any date the report-time line is
 *   value(d) − (Stock-in-hand carried by those journals at the end of d).
 * Gross profit, the balance sheet and cash flow then hold the valuation exactly once, whichever way
 * the stock got in. With no such journal the valuer is returned unchanged.
 */
export function netOfStockJournals(stock: StockValuer | undefined, postings: readonly StockJournalPosting[]): StockValuer | undefined {
  if (!stock || !postings.length) return stock;
  const sorted = [...postings].sort((a, b) => a.date.localeCompare(b.date));
  const carried = (date: string) => {
    let s = 0;
    for (const p of sorted) {
      if (p.date > date) break;
      s += p.delta;
    }
    return s;
  };
  return {
    mode: stock.mode,
    label: `${stock.label}, net of closing-stock journals`,
    value: (date) => stock.value(date) - carried(date),
    openingIn: (date) => stock.openingIn(date),
    netted: sorted.filter((p) => p.delta > 0),
  };
}

/**
 * Report-time valuation NET of the Stock-in-hand OPENING balance typed in the ledger (or brought in
 * by a Tally import). Item-master openings already sit in the valuation, so a Stock-in-hand ledger
 * opening on top would put the opening stock on the balance sheet twice. From `openingDate` (the
 * opening voucher's day, the day before the books begin) both the value and the opening part are
 * reduced by the overlap — the ledger opening, capped at the opening stock the valuation itself
 * carries — so Inventories = ledger opening + (value − overlap) holds the opening stock once, and the
 * "difference in opening balances" credit shrinks by what the ledger opening already balanced.
 * Profit (closing − opening) is unchanged. A ledger opening with no item / typed opening behind it
 * still stands on its own. With no such opening the valuer is returned unchanged.
 */
export function netOfStockOpening(stock: StockValuer | undefined, ledgerOpening: number, openingDate: string): StockValuer | undefined {
  if (!stock || !(ledgerOpening > 0)) return stock;
  const carried = (date: string) => (date >= openingDate ? Math.min(ledgerOpening, Math.max(stock.openingIn(date), 0)) : 0);
  return {
    ...stock,
    value: (date) => stock.value(date) - carried(date),
    openingIn: (date) => stock.openingIn(date) - carried(date),
  };
}
