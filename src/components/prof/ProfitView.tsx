/** PS-A4 Profitability: fees billed − staff cost − unrecovered costs, by matter / client / engagement. */
import { useMemo, useState } from 'react';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { currentLiveInvoiceIds, readTimePrefs, timeDb } from '../../lib/timesheets';
import { engagementOf, loadEngagements } from '../../lib/prof/ps-engagements';
import { profitability, type ProfitDim } from '../../lib/prof/ps-profit';
import { staffMap } from '../../lib/prof/ps-staff';
import { downloadText, toCsv } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { pct } from './ps-run';
import { usePeriod } from './use-period';

export default function ProfitView() {
  const { from, to, inputs } = usePeriod();
  const [by, setBy] = useState<ProfitDim>('matter');
  const engs = useMemo(() => loadEngagements(), []);
  const rows = useMemo(() => {
    const live = currentLiveInvoiceIds();
    return profitability({ from, to, by, prefs: readTimePrefs(), invoices: localDb.invoices.getAll().filter((i) => live.has(i.id) && i.doc_type === 'INVOICE'), entries: timeDb.all(), costs: purchasesDb.all(), staff: staffMap(), engOf: (m) => engagementOf(m, engs)?.id });
  }, [from, to, by, engs]);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of localDb.clients.getAll()) if (c.id) m.set(c.id, c.name);
    for (const c of loadCostCentres()) m.set(c.id, c.ps?.code ? `${c.ps.code} — ${c.name}` : c.name);
    for (const e of engs) m.set(e.id, `${e.number} · ${e.title}`);
    return m;
  }, [engs]);
  const head = [pwT(`by.${by}`), psT('billed'), pwT('cost'), pwT('unrecovered'), pwT('contribution'), pwT('margin')];
  const data = rows.map((r) => [names.get(r.key) ?? (r.key || psT('none')), r.fees, r.cost, r.unrecovered, r.contribution, pct(r.margin)]);
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          {inputs}
          <Field label={pwT('by')}><select className={controls.select} value={by} onChange={(e) => setBy(e.target.value as ProfitDim)}>{(['matter', 'client', 'engagement'] as const).map((d) => <option key={d} value={d}>{pwT(`by.${d}`)}</option>)}</select></Field>
        </div>
        <button type="button" className={controls.btnGhost} onClick={() => downloadText('profitability.csv', toCsv([head, ...data]), 'text/csv')}>{psT('csv')}</button>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-profit>
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{data.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? surface.numeric : undefined}>{typeof c === 'number' ? formatCurrency(c) : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <p className={controls.hint}>{pwT('private')}</p>
      </div>
    </div>
  );
}
