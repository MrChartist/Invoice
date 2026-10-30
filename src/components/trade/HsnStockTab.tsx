/** Inventory → HSN stock (TR-C4): closing quantity and value by HSN × godown as on a date; CSV. */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { formatCurrency } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { hsnStockCsv, hsnStockTotal } from '../../lib/trade/tr-hsn-stock';
import { loadHsnStock } from '../../lib/trade/tr-stock-live';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { DateField } from '../ui/DateField';

export default function HsnStockTab({ today }: { today: string }) {
  useT();
  const [asOf, setAsOf] = useState(today);
  const { rows, godownName } = useMemo(() => loadHsnStock(/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : today), [asOf, today]);
  return (
    <section className={own.stack} data-hsn-stock>
      <div className={own.row}>
        <label className={controls.field}><span className={controls.label}>{trT('asOf')}</span><DateField className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <div><button type="button" className={controls.btnOutline} disabled={!rows.length} onClick={() => downloadText(`hsn-stock-${asOf}.csv`, hsnStockCsv(rows, godownName), 'text/csv')}>{trT('csv')}</button></div>
      </div>
      <div className={own.tableWrap}>
        <table className={own.table}>
          <thead><tr><th>{trT('hsn')}</th><th>{trT('godown')}</th><th>{trT('uqc')}</th><th className={own.num}>{trT('qty')}</th><th className={own.num}>{trT('value')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.hsn}|${r.godown}|${r.unit}`}><td>{r.hsn || trT('noHsn')}</td><td>{godownName(r.godown)}</td><td>{r.unit}</td><td className={own.num}>{r.qty}</td><td className={own.num}>{formatCurrency(r.value)}</td></tr>
            ))}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={4} /><td className={own.num}>{formatCurrency(hsnStockTotal(rows))}</td></tr></tfoot>}
        </table>
        {!rows.length && <p className={own.muted}>{trT('none')}</p>}
      </div>
    </section>
  );
}
