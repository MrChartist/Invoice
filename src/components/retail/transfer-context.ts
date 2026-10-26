import type { StockInputs, StockItem } from '../../lib/inventory';
import { computeStock } from '../../lib/inventory';
import type { Godown } from '../../types/stock';
import { godownName } from '../../lib/godowns';
import { localDb } from '../../lib/localDb';

/** What the transfer request / in-transit tabs receive from the Transfers tab (R4-B4). */
export interface TransferCtx {
  godowns: Godown[];
  items: StockItem[];
  inputs: StockInputs;
  changed: (message: string) => void;
  error: (message: string) => void;
}

export const nameOfGodown = (ctx: Pick<TransferCtx, 'godowns'>, id: string) => godownName(ctx.godowns, id);

/** Unit cost per item (the stock engine's average cost) — values goods in transit, challans and e-Way JSON at cost. */
export function costIndex(inputs: StockInputs): (itemId: string) => number {
  const m = new Map(computeStock(inputs).map((p) => [p.item.id, p.avgCost > 0 ? p.avgCost : Number(p.item.opening_rate) || 0]));
  return (id) => m.get(id) ?? 0;
}

export function businessOf() {
  const p = localDb.settings.activeProfile();
  return { name: p?.companyName ?? '', gstin: p?.companyGstin, address: p?.companyAddress, stateCode: p?.stateCode };
}
