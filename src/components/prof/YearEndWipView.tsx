/**
 * PS-A4 Year-end unbilled work: the working paper by matter, the expected write-down, and the optional dated accrual.
 * R16-B4: for a matter whose engagement bills in a foreign currency and for open foreign invoices, a memo at the
 * closing-date rate of the currency master (`atClosing`); never a journal (PF14, PS37).
 */
import { useMemo, useState } from 'react';
import type { TimeEntry } from '../../types/time';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { clientKey, currentLiveInvoiceIds, readTimePrefs, timeDb } from '../../lib/timesheets';
import { engagementOf, loadEngagements } from '../../lib/prof/ps-engagements';
import { atClosing, inrPerUnit } from '../../lib/prof/ps-fx-rates';
import { loadRates } from '../../lib/currency-rates';
import { revalueReceivables } from '../../lib/fx-gain';
import { r16bT } from '../../i18n/areas/prof-r16b';
import { useT } from '../../i18n';
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
  const { lang } = useT(); // QA19 U4: re-render when the Hindi arrives; `fx` holds a label
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
  const fx = useMemo(() => {
    const rates = loadRates();
    const engs = loadEngagements();
    const rows = new Map(paper.rows.flatMap((r) => {
      const c = (engagementOf(r.key, engs)?.currency || 'INR').toUpperCase();
      const v = c === 'INR' ? null : atClosing(r.net, c, closing, rates);
      return c === 'INR' ? [] : [[r.key, `${c} → ${v === null ? r16bT('noRate') : formatCurrency(v)}`] as const];
    }));
    const cur = new Set(localDb.invoices.getAll().map((i) => (i.currency || 'INR').toUpperCase()).filter((c) => c !== 'INR'));
    const rev = cur.size ? revalueReceivables(localDb.invoices.getAll(), localDb.payments.getAll(), Object.fromEntries([...cur].map((c) => [c, inrPerUnit(c, closing, rates)?.rate])), closing) : null;
    return { rows, inv: rev?.rows ?? [] };
  }, [paper, closing, lang]);
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
            <thead><tr><th>{psT('matter')}</th><th className={surface.numeric}>{psT('standard')}</th><th>{pwT('expected')}</th><th className={surface.numeric}>{pwT('net')}</th><th>{pwT('method')}</th>{fx.rows.size > 0 && <th>{r16bT('atClosing')}</th>}</tr></thead>
            <tbody>
              {paper.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td><td className={surface.numeric}>{formatCurrency(r.standard)}</td>
                  <td><input type="number" min={0} max={150} className={controls.input} aria-label={pwT('expected')} value={Math.round(r.realisation * 100)} onChange={(e) => setOver({ ...over, [r.key]: Number(e.target.value) / 100 })} /></td>
                  <td className={surface.numeric}>{formatCurrency(r.net)}</td><td>{pwT(r.method)}</td>{fx.rows.size > 0 && <td data-ye-fx>{fx.rows.get(r.key) ?? ''}</td>}
                </tr>
              ))}
              <tr><th>{psT('total')}</th><th className={surface.numeric}>{formatCurrency(paper.standard)}</th><th /><th className={surface.numeric}>{formatCurrency(paper.net)}</th><th />{fx.rows.size > 0 && <th />}</tr>
            </tbody>
          </table>
        </div>
        {fx.inv.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table} data-ye-fxinv>
              <caption>{r16bT('openFx')}</caption>
              <thead><tr><th>{psT('date')}</th><th /><th className={surface.numeric}>{psT('amount')}</th><th className={surface.numeric}>{r16bT('atInv')}</th><th className={surface.numeric}>{r16bT('atClosing')}</th><th className={surface.numeric}>{r16bT('diff')}</th></tr></thead>
              <tbody>{fx.inv.map((r) => <tr key={r.invoiceId}><td>{r.issueDate}</td><td>{r.invoiceNumber} · {r.party}</td><td className={surface.numeric}>{formatCurrency(r.openForeign, r.currency)}</td><td className={surface.numeric}>{formatCurrency(r.bookInr)}</td><td className={surface.numeric}>{r.closingInr === null ? r16bT('noRate') : formatCurrency(r.closingInr)}</td><td className={surface.numeric}>{r.unrealised === null ? '' : formatCurrency(r.unrealised)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {(fx.rows.size > 0 || fx.inv.length > 0) && <p className={controls.hint}>{r16bT('fxNote')}</p>}
        <div className={controls.row}>
          <button type="button" className={controls.btnOutline} onClick={() => window.print()}>{psT('print')}</button>
          {on && <button type="button" className={controls.btnOutline} onClick={() => void postAccrual(paper.net, closing).then((n) => notify(pwT('posted', { n }))).catch((e: Error) => notify(e.message, 'error'))}>{pwT('post')}</button>}
        </div>
        <p className={controls.hint}>{pwT('note')}</p>
      </div>
    </div>
  );
}
