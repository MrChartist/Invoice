/**
 * MF-D5 live wiring of the inventories split (lazy: imported only by the Statutory desk's `inventories` view, the
 * annual-accounts pack and the year-end screen): positions from the inventory engine (`loadPositions`, the same input
 * as `loadStockValuer`), classes from the BOMs, WIP-godown quantities on the day from `computeTracking` (`asOf`), and
 * the year-end WIP statement from the production orders. Stock readers convert alternate units through the engine
 * (`lineFactor`), never here.
 */
import { loadPositions } from '../inventory';
import { bomsDb } from '../manufacturing';
import { godownsDb } from '../godowns';
import { computeTracking, liveTrackingInputs } from '../stock-tracking';
import { isPackOn } from '../industry-packs';
import { localDb } from '../localDb';
import { loadOrderDocs, orderProgress, productionOrdersDb } from '../production/orders';
import { liveMemoConversion } from './mf-conversion';
import { anyExplicitClass, classOf, defaultClasses, inventorySplit, noteRows, valueAt, wipStatement, type InventorySplit } from './mf-inventories';

/** The split is shown when the `shopfloor` pack is on or any item carries a class. */
export function splitWanted(): boolean {
  return isPackOn(localDb.settings.get(), 'shopfloor' as never) || anyExplicitClass(loadPositions().map((p) => p.item));
}

/** WIP-godown base quantity per item at the end of `date`. */
function wipQtyOn(date: string): (itemId: string) => number {
  const wip = new Set(godownsDb.list().filter((g) => g.kind === 'wip').map((g) => g.id));
  if (!wip.size) return () => 0;
  const tracking = computeTracking({ ...liveTrackingInputs(), asOf: date });
  return (id) => Object.entries(tracking.get(id)?.byGodown ?? {}).reduce((s, [g, q]) => s + (wip.has(g) ? q : 0), 0);
}

/** Memo conversion (D5) on open orders at `date`: per order and the total, in paise; unabsorbed overhead (period cost). */
export function liveMemo(date: string): { byOrder: Map<string, number>; total: number; unabsorbed: number } {
  if (!isPackOn(localDb.settings.get(), 'shopfloor' as never)) return { byOrder: new Map(), total: 0, unabsorbed: 0 };
  const m = liveMemoConversion(date);
  return { byOrder: new Map(m.rows.map((r) => [r.order_id, Math.round(r.memo * 100)])), total: Math.round(m.total * 100), unabsorbed: Math.round(m.unabsorbed * 100) };
}

/** The split on `date` with an optional memo conversion (paise; working only). */
export function liveSplit(date: string, memoConversion = liveMemo(date).total): InventorySplit {
  const positions = loadPositions();
  const defaults = defaultClasses(positions.map((p) => p.item), bomsDb.all());
  return inventorySplit(positions, date, (i) => classOf(i, defaults), wipQtyOn(date), memoConversion);
}

/** Note rows for the annual pack (empty when the split is not wanted). */
export function liveNoteRows(cur: string, prev: string): { label: string; cur: number; prev: number }[] {
  if (!splitWanted()) return [];
  return noteRows(liveSplit(cur, 0), liveSplit(prev, 0));
}

/** Year-end WIP statement on `date` (material at the item's average value on that day). */
export function liveWipStatement(date: string, memoConversion?: (orderId: string) => number) {
  if (!memoConversion) {
    const m = liveMemo(date).byOrder;
    memoConversion = (id) => m.get(id) ?? 0;
  }
  const positions = new Map(loadPositions().map((p) => [p.item.id, p]));
  const docs = loadOrderDocs();
  const orders = productionOrdersDb.all();
  const avg = (id: string) => {
    const p = positions.get(id);
    if (!p) return 0;
    const v = valueAt(p, date);
    return v.qty > 0 ? v.value / v.qty : 0;
  };
  return wipStatement(orders, (id) => orderProgress(orders.find((o) => o.id === id)!, docs), avg, (id) => positions.get(id)?.item.name ?? id, memoConversion);
}
