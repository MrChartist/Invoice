/** AG-D4 subsidised fertiliser: flag the stock items whose sale needs the PoS transaction no. and the farmer ID. */
import { useMemo } from 'react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import type { StockItem } from '../../lib/inventory';
import { flagSubsidised } from '../../lib/agri/ag-subsidy';
import { Hint } from './agd-kit';
import { useRun, wrap, type Done } from './agd-ui';

export default function SubsidyView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const items = useMemo(() => { void tick; return getTable<StockItem>('stock_items').filter((i) => i?.track_stock); }, [tick]);
  return (
    <>
      <h3>{agdT('flagItems')}</h3>
      <div style={wrap}>{items.map((i) => <label key={i.id}><input type="checkbox" checked={!!i.ag_subsidised} onChange={(e) => run(() => flagSubsidised(i.id, e.target.checked))} /> {i.name}</label>)}</div>
      <Hint k="subsidyNote" />
    </>
  );
}
