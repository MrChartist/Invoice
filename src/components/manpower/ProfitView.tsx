/**
 * R17-C2 site P&L view (`view=profit&month=`): per site — billed (service month; arrears debit notes in, credit notes
 * out), wages and relievers and employer PF / ESI from the finalised run (by duties), site-tagged purchase bills,
 * margin and margin %. Reads one month only; nothing posts.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mcList, mcT } from '../../i18n/areas/manpower-r17c';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { loadSites, siteLabel } from '../../lib/manpower/mp-sites';
import { loadMusters } from '../../lib/manpower/mp-muster';
import { siteProfit } from '../../lib/manpower/mp-profit';
import { readRunForMonth } from '../../lib/manpower/mp-payroll-io';
import { siteBills } from '../../lib/manpower/mp-sites-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, type MpViewProps } from './mp-ui';

const K = ['billed', 'wages', 'relief', 'statutory', 'bills', 'margin'] as const;

export default function ProfitView(_: MpViewProps) {
  useT();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || todayInput().slice(0, 7);
  const d = useMemo(() => {
    const run = readRunForMonth(month);
    return { run, rows: siteProfit({ month, sites: loadSites(), invoices: localDb.invoices.getAll(), musters: loadMusters(month), lines: run?.lines ?? null, bills: siteBills(month) }) };
  }, [month]);
  return (
    <section data-mp-profit>
      <Field label={mpT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => e.target.value && setParams({ tab: 'deploy', view: 'profit', month: e.target.value }, { replace: true })} /></Field>
      {!d.run && <p className={controls.hint} role="note">{mcT('noRun', { m: month })}</p>}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{mpT('site')}</th>{K.map((k, i) => <th key={k} className={surface.numeric}>{mcList('pl', i)}</th>)}<th className={surface.numeric}>{mcList('pl', 6)}</th></tr></thead>
          <tbody>
            {d.rows.map((r) => <tr key={r.site.id} data-mp-profit-site={r.site.mp.code}><td>{siteLabel(r.site)}</td>{K.map((k) => <td key={k} className={surface.numeric} data-k={k}>{formatCurrency(r[k])}</td>)}<td className={surface.numeric}>{r.pct === null ? '-' : `${r.pct} %`}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
