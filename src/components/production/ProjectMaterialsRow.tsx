import { useMemo } from 'react';
import { getTable } from '../../lib/storage';
import { computeStockDetailed } from '../../lib/inventory';
import { liveTrackingInputs } from '../../lib/stock-tracking';
import { materialsByCostCentre } from '../../lib/production/costing';
import { productionOrdersDb } from '../../lib/production/orders';
import type { ManufacturingVoucher, StockJournal } from '../../types/manufacturing';
import { pT } from '../../i18n/areas/production-r4';
import { money } from '../manufacturing/context';
import surface from '../../styles/surface.module.css';

/**
 * R4-A2: Books → Projects memo row (loaded lazily): materials consumed by production orders tagged with each cost
 * centre in the period, from stock. A memo only — nothing posts, the project P&L stays ledger-based.
 */
export default function ProjectMaterialsRow({ columns, period, cellClass }: { columns: readonly { key: string }[]; period: { start: string; end: string }; cellClass?: string }) {
  const memo = useMemo(() => {
    const inputs = liveTrackingInputs();
    return materialsByCostCentre(productionOrdersDb.all(), {
      mfg: getTable<ManufacturingVoucher>('manufacturing_vouchers'), journals: getTable<StockJournal>('stock_journals'), computation: computeStockDetailed(inputs),
    }, period);
  }, [period]);
  if (!memo.size) return null;
  const total = [...memo.values()].reduce((s, v) => s + v, 0);
  return (
    <tr>
      <td className={cellClass}>{pT('materialsMemo')}</td>
      {columns.map((c) => <td key={c.key} className={surface.numeric}>{memo.get(c.key) ? money(memo.get(c.key) ?? 0) : '-'}</td>)}
      <td className={surface.numeric}>{money(total)}</td>
    </tr>
  );
}
