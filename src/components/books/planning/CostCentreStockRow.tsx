import { useMemo } from 'react';
import { defineArea } from '../../../i18n/area';
import { loadCostCentreStock, type CentreStock } from '../../../lib/ledger/cost-centre-stock';
import type { CostCentre } from '../../../lib/cost-centres';
import { money } from '../ledger/format';
import surface from '../../../styles/surface.module.css';

const ccsT = defineArea(
  { opening: 'Stock at the centre’s godowns: start (memo)', closing: 'Stock at the centre’s godowns: end (memo)' } as const,
  { opening: 'केंद्र के गोदामों में स्टॉक: आरंभ (मेमो)', closing: 'केंद्र के गोदामों में स्टॉक: अंत (मेमो)' },
);

/**
 * 7.167: Books → Projects memo rows (loaded lazily, only once a godown carries a cost centre): opening and closing stock
 * lying in each centre's godowns, valued by the stock engine (`cost-centre-stock.ts`). A memo only — the Project P&L stays
 * ledger-based. A rolled-up parent column takes its children's godowns.
 */
export default function CostCentreStockRow({ columns, centres, period, cellClass }: {
  columns: readonly { key: string }[]; centres: readonly CostCentre[]; period: { start: string; end: string }; cellClass?: string;
}) {
  const stock = useMemo(() => loadCostCentreStock(period), [period]);
  if (!stock.size) return null;
  const shown = new Set(columns.map((c) => c.key));
  const parentOf = new Map(centres.map((c) => [c.id, c.parent_id]));
  const byCol = new Map<string, CentreStock>();
  for (const [cc, v] of stock) {
    const p = parentOf.get(cc);
    const key = shown.has(cc) ? cc : p && shown.has(p) ? p : cc;
    const row = byCol.get(key) ?? { opening: 0, closing: 0 };
    byCol.set(key, { opening: row.opening + v.opening, closing: row.closing + v.closing });
  }
  const line = (pick: keyof CentreStock) => {
    const total = [...stock.values()].reduce((s, v) => s + v[pick], 0);
    return (
      <tr data-cc-stock={pick}>
        <td className={cellClass}>{ccsT(pick)}</td>
        {columns.map((c) => <td key={c.key} className={surface.numeric}>{byCol.get(c.key) ? money(byCol.get(c.key)![pick]) : '-'}</td>)}
        <td className={surface.numeric}>{money(total)}</td>
      </tr>
    );
  };
  return <>{line('opening')}{line('closing')}</>;
}
