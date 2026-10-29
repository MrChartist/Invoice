/**
 * Cost-centre closing stock (7.167, PENDING 43): the stock lying in the godowns tagged to a cost centre
 * (`Godown.cost_centre_id`, set on the godown form or by a works site), valued like a branch's stock
 * (`godownSetValuer`: quantity there × the item's company-wide unit cost that day).
 *
 * A godown without its own tag takes its parent's (a rack inside a project store). The Project P&L shows the opening
 * (day before the period) and closing figures as memo rows: it stays ledger-based and keeps tying to the P&L, so the
 * stock change per centre is information, not a posting. Amounts in PAISE. Working papers — verify with your CA.
 *
 * Pure apart from `loadCostCentreStock` (live reads).
 */
import type { StockEvent, StockPosition } from '../inventory';
import { collectEvents, liveInputs, loadPositions } from '../inventory';
import { getTable } from '../storage';
import type { Godown, StockTransfer } from '../../types/stock';
import { godownSetValuer } from './branch-stock';

export interface CentreStock {
  /** Value at the end of the day before the period starts. */
  opening: number;
  /** Value at the end of the period. */
  closing: number;
}

/** The cost centre of a godown: its own tag, else the nearest parent's. */
export function centreOfGodown(id: string, godowns: readonly Godown[]): string | undefined {
  const seen = new Set<string>();
  let g = godowns.find((x) => x.id === id);
  while (g && !seen.has(g.id)) {
    if (g.cost_centre_id) return g.cost_centre_id;
    seen.add(g.id);
    g = g.parent_id ? godowns.find((x) => x.id === g!.parent_id) : undefined;
  }
  return undefined;
}

/** Godown ids per cost centre (tagged godowns and the godowns inside them). */
export function centreGodowns(godowns: readonly Godown[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const g of godowns) {
    const cc = centreOfGodown(g.id, godowns);
    if (cc) out.set(cc, (out.get(cc) ?? new Set<string>()).add(g.id));
  }
  return out;
}

/** Local day before `iso` (YYYY-MM-DD, from its parts, never a UTC parse of the string). */
export function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function costCentreStock(
  positions: readonly StockPosition[], events: ReadonlyMap<string, readonly StockEvent[]>, godowns: readonly Godown[],
  period: { start: string; end: string },
): Map<string, CentreStock> {
  const out = new Map<string, CentreStock>();
  for (const [cc, ids] of centreGodowns(godowns)) {
    const v = godownSetValuer(positions, events, ids, cc);
    const row = { opening: v.value(dayBefore(period.start)), closing: v.value(period.end) };
    if (row.opening || row.closing) out.set(cc, row);
  }
  return out;
}

export function loadCostCentreStock(period: { start: string; end: string }): Map<string, CentreStock> {
  const godowns = getTable<Godown>('godowns');
  if (!godowns.some((g) => g.cost_centre_id)) return new Map();
  const input = liveInputs();
  const events = collectEvents({ ...input, transfers: getTable<StockTransfer>('stock_transfers'), includeTransfers: true });
  return costCentreStock(loadPositions(), events, godowns, period);
}
