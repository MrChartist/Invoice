import { useMemo } from 'react';
import { getTable } from '../../lib/storage';
import { computeStockDetailed } from '../../lib/inventory';
import { liveTrackingInputs } from '../../lib/stock-tracking';
import { siteCostByCentre } from '../../lib/works/sites';
import type { StockJournal } from '../../types/manufacturing';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import { fmtMoney } from '../transport/shared';
import surface from '../../styles/surface.module.css';

/**
 * R5-B6: Books → Projects memo row (loaded lazily, only once a stock journal carries a cost centre): stock consumed at
 * works sites per project in the period, valued by the stock engine. A memo only — the project P&L stays ledger-based.
 */
export default function SiteMaterialsRow({ columns, period, cellClass }: { columns: readonly { key: string }[]; period: { start: string; end: string }; cellClass?: string }) {
  const memo = useMemo(() => siteCostByCentre(getTable<StockJournal>('stock_journals'), computeStockDetailed(liveTrackingInputs()), period), [period]);
  if (!memo.size) return null;
  const total = [...memo.values()].reduce((s, v) => s + v, 0);
  return (
    <tr data-site-materials>
      <td className={cellClass}>{twT('siteMaterialsMemo')}</td>
      {columns.map((c) => <td key={c.key} className={surface.numeric}>{memo.get(c.key) ? fmtMoney(memo.get(c.key) ?? 0) : '—'}</td>)}
      <td className={surface.numeric}>{fmtMoney(total)}</td>
    </tr>
  );
}
