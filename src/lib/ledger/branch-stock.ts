/**
 * Per-godown closing-stock valuation for branch statements (7S, roadmap 7.84).
 *
 * The inventory engine costs each item company-wide (one FIFO / weighted-average cost across godowns, as in
 * Tally). A branch's stock is therefore valued as
 *
 *   value_b(d) = Σ items  max(qty in the branch's godowns at the end of d, 0) × unit cost of the item at d
 *
 * where the branch's godowns are those `branchOfGodown` (branch-transfer.ts) assigns to it (its `godown_id` and the godowns inside),
 * the quantity follows every godown move (transfers, job work, vouchers) and the unit cost is the engine's running
 * value ÷ running quantity on that day. The opening part (`openingIn`) is the opening stock placed in those godowns.
 *
 * "No branch" (`UNASSIGNED`) takes the rest — company valuation (already net of closing-stock journals and the
 * Stock-in-hand ledger opening) minus every branch — so the branches and "No branch" always add up to the company
 * figure, exactly like the branch-wise trial balances. Typed (manual) closing stock cannot be split by godown:
 * branch views then show no report-time stock, as before.
 *
 * Pure apart from `loadBranchStockValuer` (live reads).
 */
import type { StockEvent, StockPosition } from '../inventory';
import { collectEvents, liveInputs, loadPositions } from '../inventory';
import { loadBranches, UNASSIGNED, type Branch } from '../branch';
import { getTable } from '../storage';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer } from '../../types/stock';
import type { StockValuer } from './closing-stock';
import { loadStockValuer } from './index';

const paise = (rupees: number) => Math.round((Number.isFinite(rupees) ? rupees : 0) * 100);

interface DatedNum {
  date: string;
  n: number;
}

function lastAt(rows: readonly DatedNum[], date: string): number {
  let lo = 0;
  let hi = rows.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date <= date) {
      found = rows[mid].n;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Running totals by end of day (rows in date order, same-day rows merged). */
function running(rows: readonly { date: string; delta: number }[]): DatedNum[] {
  const out: DatedNum[] = [];
  let acc = 0;
  for (const r of rows) {
    acc += r.delta;
    const last = out[out.length - 1];
    if (last && last.date === r.date) last.n = acc;
    else out.push({ date: r.date, n: acc });
  }
  return out;
}

/** The branch owning a godown, directly or through a parent (same rule as `branchOfGodown` in branch-transfer.ts). */
function ownerOf(godownId: string, branches: readonly Branch[], godowns: readonly Godown[]): Branch | undefined {
  const seen = new Set<string>();
  let id: string | undefined = godownId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const hit = branches.find((b) => b.godown_id === id);
    if (hit) return hit;
    id = godowns.find((g) => g.id === id)?.parent_id;
  }
  return undefined;
}

/** Godown ids that belong to a branch (its godown and every godown inside it). */
export function branchGodownIds(branchId: string, branches: readonly Branch[], godowns: readonly Godown[]): Set<string> {
  const all = [{ id: MAIN_GODOWN_ID, name: 'Main' } as Godown, ...godowns.filter((g) => g.id !== MAIN_GODOWN_ID)];
  return new Set(all.filter((g) => ownerOf(g.id, branches, godowns)?.id === branchId).map((g) => g.id));
}

/**
 * Valuer of the stock lying in a set of godowns: quantity there × the item's company-wide unit cost that day.
 * `events` must come from `collectEvents(…, includeTransfers: true)` over the same inputs as `positions`.
 */
export function godownSetValuer(positions: readonly StockPosition[], events: ReadonlyMap<string, readonly StockEvent[]>, godowns: ReadonlySet<string>, label: string): StockValuer {
  const items = positions
    .filter((p) => p.item.track_stock && godowns.size)
    .map((p) => {
      const evs = (events.get(p.item.id) ?? []).filter((e) => godowns.has(e.godown));
      if (!evs.length) return null;
      const qty = running(evs.map((e) => ({ date: e.date, delta: e.qty })));
      const openings = running(evs.filter((e) => e.kind === 'opening' && e.qty > 0).map((e) => ({ date: e.date, delta: e.qty * (e.rate ?? 0) })));
      const unit: DatedNum[] = [];
      for (const r of p.ledger) {
        const u = r.balance > 0 ? Math.max(r.value, 0) / r.balance : 0;
        const last = unit[unit.length - 1];
        if (last && last.date === r.date) last.n = u;
        else unit.push({ date: r.date, n: u });
      }
      return { qty, openings, unit };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return {
    mode: 'inventory',
    label,
    value: (date) => items.reduce((s, it) => s + paise(Math.max(lastAt(it.qty, date), 0) * lastAt(it.unit, date)), 0),
    openingIn: (date) => items.reduce((s, it) => s + paise(lastAt(it.openings, date)), 0),
  };
}

export interface BranchStockContext {
  positions: readonly StockPosition[];
  events: ReadonlyMap<string, readonly StockEvent[]>;
  branches: readonly Branch[];
  godowns: readonly Godown[];
  /** The company valuer (`loadStockValuer()`), net of journals / ledger opening. */
  company: StockValuer | undefined;
}

/** Closing-stock valuer for one branch, or for "No branch" (the rest). Undefined when stock is not valued from the inventory. */
export function branchStockValuer(branchId: string, ctx: BranchStockContext): StockValuer | undefined {
  if (!branchId || ctx.company?.mode !== 'inventory') return undefined;
  const label = `${ctx.company.label}, by godown`;
  if (branchId !== UNASSIGNED) return godownSetValuer(ctx.positions, ctx.events, branchGodownIds(branchId, ctx.branches, ctx.godowns), label);
  const parts = ctx.branches.map((b) => godownSetValuer(ctx.positions, ctx.events, branchGodownIds(b.id, ctx.branches, ctx.godowns), label));
  const company = ctx.company;
  return {
    mode: 'inventory',
    label: `${label} (not in a branch godown)`,
    value: (d) => company.value(d) - parts.reduce((s, p) => s + p.value(d), 0),
    openingIn: (d) => company.openingIn(d) - parts.reduce((s, p) => s + p.openingIn(d), 0),
  };
}

/** Live branch valuer (Books / Gateway branch views). Positions may be passed to reuse a costing run. */
export function loadBranchStockValuer(branchId: string, positions?: () => StockPosition[], company?: StockValuer): StockValuer | undefined {
  const branches = loadBranches();
  if (!branchId || !branches.length) return undefined;
  const get = positions ?? (() => loadPositions());
  const base = company ?? loadStockValuer(undefined, get);
  if (base?.mode !== 'inventory') return undefined;
  const input = liveInputs();
  const events = collectEvents({ ...input, transfers: getTable<StockTransfer>('stock_transfers'), includeTransfers: true });
  return branchStockValuer(branchId, { positions: get(), events, branches, godowns: getTable<Godown>('godowns'), company: base });
}
