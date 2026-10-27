/** PS-A4 Year-end unbilled work: the working paper by matter, the expected write-down, and the optional dated accrual. */
import { useMemo, useState } from 'react';
import type { TimeEntry } from '../../types/time';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { clientKey, currentLiveInvoiceIds, readTimePrefs, timeDb } from '../../lib/timesheets';
import { loadEngagements } from '../../lib/prof/ps-engagements';
import { billingRealisation } from '../../lib/prof/ps-realisation';
import { accrualOn, postAccrual, yearEndPaper } from '../../lib/prof/ps-yearend';
import { readProfSettings, saveProfSettings } from '../../lib/prof/ps-settings';
import { shiftDay } from '../../lib/dates';
import { getIndianFY } from '../../lib/invoice-number';
import { can } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';

export default function YearEndWipView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const [closing, setClosing] = useState(() => `${getIndianFY(todayInput()).startYear}-03-31`);
  const [over, setOver] = useState<Record<string, number>>({});
  const [accrue, setAccrue] = useState(() => readProfSettings().wip?.accrue_from ?? '');
  const paper = useMemo(() => {
    const prefs = readTimePrefs();
    const all = timeDb.all();
    const byId = new Map<string, TimeEntry>(all.map((e) => [e.id, e]));
    const live = currentLiveInvoiceIds();
    const invoices = localDb.invoices.getAll().filter((i) => live.has(i.id) && i.doc_type === 'INVOICE');
    const since = shiftDay(closing, -365);
    const history = invoices.filter((i) => i.issue_date > since && i.issue_date <= closing);
    const cache = new Map<string, number | null>();
    const realisationOf = (k: string) => {
      if (!cache.has(k)) cache.set(k, billingRealisation(history.filter((i) => clientKey({ client_id: i.client?.id, client_name: i.client?.name }) === k || i.client?.id === k), (id) => byId.get(id), prefs));
      return cache.get(k) ?? null;
    };
    return yearEndPaper({ closing, prefs, entries: all, costs: purchasesDb.all(), invoices, centres: loadCostCentres(), engagements: loadEngagements(), realisationOf, overrides: over });
  }, [closing, over]);
  const on = accrualOn(readProfSettings().wip?.accrue_from, closing);
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row3}>
          <Field label={pwT('closing')}><input type="date" className={controls.input} value={closing} onChange={(e) => setClosing(e.target.value)} data-ye-closing /></Field>
          {can('settings.manage') && <Field label={pwT('accrueFrom')}><input type="date" className={controls.input} value={accrue} onChange={(e) => setAccrue(e.target.value)} onBlur={() => run(() => saveProfSettings({ wip: { ...readProfSettings().wip, accrue_from: accrue || undefined } }), psT('saved'))} /></Field>}
        </div>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-yearend>
            <thead><tr><th>{psT('matter')}</th><th className={surface.numeric}>{psT('standard')}</th><th>{pwT('expected')}</th><th className={surface.numeric}>{pwT('net')}</th><th>{pwT('method')}</th></tr></thead>
            <tbody>
              {paper.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td><td className={surface.numeric}>{formatCurrency(r.standard)}</td>
                  <td><input type="number" min={0} max={150} className={controls.input} aria-label={pwT('expected')} value={Math.round(r.realisation * 100)} onChange={(e) => setOver({ ...over, [r.key]: Number(e.target.value) / 100 })} /></td>
                  <td className={surface.numeric}>{formatCurrency(r.net)}</td><td>{pwT(r.method)}</td>
                </tr>
              ))}
              <tr><th>{psT('total')}</th><th className={surface.numeric}>{formatCurrency(paper.standard)}</th><th /><th className={surface.numeric}>{formatCurrency(paper.net)}</th><th /></tr>
            </tbody>
          </table>
        </div>
        <div className={controls.row}>
          <button type="button" className={controls.btnOutline} onClick={() => window.print()}>{psT('print')}</button>
          {on && <button type="button" className={controls.btnOutline} onClick={() => void postAccrual(paper.net, closing).then((n) => notify(pwT('posted', { n }))).catch((e: Error) => notify(e.message, 'error'))}>{pwT('post')}</button>}
        </div>
        <p className={controls.hint}>{pwT('note')}</p>
      </div>
    </div>
  );
}
