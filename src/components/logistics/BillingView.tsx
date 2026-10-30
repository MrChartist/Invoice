/**
 * R19-B1 / B2 / B4 billing view (`billing`): one FY's jobs (not cancelled) with their billing state and documents; a
 * job's charge sheet (head, quantity, rate, currency) with the place-of-supply / rate chip of each line (its reason and
 * the ITC note on hover — shown here, never printed); ₹ rates for the foreign currencies on the sheet (typed, else the
 * currency master on the bill date); "Bill job" and "Bill delivered jobs" for a month (one batch). Share and the job
 * page's own tab were left out at the B cap. Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { t, useT } from '../../i18n';
import { lgList, lgT } from '../../i18n/areas/logistics-r19a';
import { lgbT } from '../../i18n/areas/logistics-r19b';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { formatCurrency, todayInput } from '../../lib/utils';
import { LG_STATUSES } from '../../lib/logistics/lg-job';
import { loadJobs } from '../../lib/logistics/lg-save';
import { lgDefaultsFor } from '../../lib/logistics/lg-settings';
import { billedHeads, billState, chargeSheet, jobDocs } from '../../lib/logistics/lg-bill';
import { lgRegime, regimeChip } from '../../lib/logistics/lg-regime';
import { billJob, billMonth, saveCharges, type BillResult } from '../../lib/logistics/lg-issue-io';
import { regimeCtx } from '../../lib/logistics/lg-tax-io';
import type { LgCharge } from '../../types/logistics-r19';
import PendingNote from '../ui/PendingNote';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, Pick, type LgViewProps } from './lg-ui';
import { numIn, row } from './lg-form';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

const STATES = ['unbilled', 'part', 'billed'] as const;

export default function BillingView({ notify }: LgViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState('');
  const [lines, setLines] = useState<LgCharge[]>([]);
  const [date, setDate] = useState(todayInput);
  const [month, setMonth] = useState(() => todayInput().slice(0, 7));
  const [fx, setFx] = useState<Record<string, number>>({});
  const [show, setShow] = useState('');
  const d = useMemo(() => {
    void tick;
    const s = lgDefaultsFor(), docs = localDb.invoices.getAll(), fy = getIndianFY(todayInput()).label;
    const jobs = loadJobs().filter((j) => j.status !== 'cancelled' && getIndianFY(j.date).label === fy).sort((a, b) => b.number.localeCompare(a.number));
    return { s, docs, jobs, name: new Map(localDb.clients.getAll().map((c) => [c.id ?? '', c.name])) };
  }, [tick]);
  const heads = d.s.heads ?? [];
  const job = d.jobs.find((j) => j.id === open);
  const ctx = useMemo(() => (job ? regimeCtx(date, { ...localDb.clients.getById(job.client_id) }, localDb.settings.activeProfile() ?? null) : null), [job, date]);
  const billed = job ? billedHeads(d.docs, job.id) : new Set<string>();
  const curs = [...new Set(lines.map((l) => (l.currency || 'INR').toUpperCase()).filter((c) => c !== 'INR'))];
  const pick = (id: string) => { setOpen(id); const j = d.jobs.find((x) => x.id === id); setLines(j ? chargeSheet(j, heads) : []); };
  const setL = (i: number, p: Partial<LgCharge>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const report = (r: BillResult) => {
    const msg = [lgbT('made', { n: r.invoices.length }), ...r.skipped.length ? [lgbT('skipped', { h: r.skipped.join(', ') })] : [], ...r.errors, ...r.hints].join(' ');
    notify(msg, r.invoices.length ? 'success' : r.errors.length ? 'error' : 'info');
    setTick((x) => x + 1);
  };
  const act = (fn: () => void) => { try { fn(); } catch (e) { notify((e as Error).message, 'error'); } };
  const shown = d.jobs.map((j) => ({ j, st: billState(chargeSheet(j, heads), billedHeads(d.docs, j.id)), docs: jobDocs(d.docs, j.id) })).filter((x) => !show || x.st === show);
  return (
    <section data-lg-billing>
      <div style={row}>
        <Field label={lgbT('billDate')}><DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} data-lg-bill-date /></Field>
        <Field label={lgbT('month')}><DateField mode="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <button type="button" className={controls.btnOutline} onClick={() => act(() => report(billMonth(month, { date, fx })))} data-lg-bill-month>{lgbT('billMonth')}</button>
        <Pick label={lgT('status')} value={show} ids={STATES} name={(x) => lgbT('states').split(',')[STATES.indexOf(x as 'part')]} blank={lgT('all')} onChange={setShow} />
      </div>
      {job && (
        <div className={surface.panel} data-lg-sheet={job.number}>
          <h3>{job.number}</h3>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr>{(['head', 'qty', 'rate', 'currency', 'amount', 'regime'] as const).map((k) => <th key={k}>{lgbT(k)}</th>)}<th /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const h = heads.find((x) => x.id === l.head_id);
                  const g = h && ctx ? lgRegime(h, job, ctx) : null;
                  return (
                    <tr key={i} data-lg-line={h?.kind ?? ''}>
                      <td><SelectField className={controls.select} aria-label={lgbT('head')} value={l.head_id} onChange={(e) => { const x = heads.find((y) => y.id === e.target.value); setL(i, { head_id: e.target.value, rate: x?.rate ?? l.rate, currency: x?.currency || 'INR' }); }}>{heads.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField></td>
                      {(['qty', 'rate'] as const).map((k) => <td key={k}><input type="number" min={0} step="any" className={controls.input} style={{ width: '6rem' }} aria-label={lgbT(k)} value={l[k] || ''} onChange={(e) => setL(i, { [k]: numIn(e.target.value) ?? 0 })} data-lg-charge={`${i}${k}`} /></td>)}
                      <td><input className={controls.input} style={{ width: '4rem' }} aria-label={lgbT('currency')} value={l.currency} onChange={(e) => setL(i, { currency: e.target.value.toUpperCase().slice(0, 3) })} /></td>
                      <td>{formatCurrency(l.qty * l.rate, l.currency || 'INR')}</td>
                      <td>{g && <span className={surface.badge} title={[g.reason, g.itc_note, g.ca].filter(Boolean).join(' · ')}>{regimeChip(g)}</span>}{billed.has(l.head_id) && ` ${lgbT('states').split(',')[2]}`}</td>
                      <td><button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={row}>
            {curs.map((c) => <Field key={c} label={lgbT('fxRate', { c })}><input type="number" min={0} step="any" className={controls.input} style={{ width: '6rem' }} value={fx[c] ?? ''} onChange={(e) => setFx({ ...fx, [c]: numIn(e.target.value) ?? 0 })} data-lg-fx={c} /></Field>)}
            <button type="button" className={controls.btnGhost} disabled={!heads.length} onClick={() => setLines([...lines, { head_id: heads[0].id, qty: 1, rate: heads[0].rate ?? 0, currency: heads[0].currency || 'INR', amount: 0 }])}>{lgbT('addLine')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => act(() => { saveCharges(job, lines); notify(lgT('saved')); setTick((x) => x + 1); })} data-lg-save-charges>{t('common.save')}</button>
            <button type="button" className={controls.btnPrimary} onClick={() => act(() => { saveCharges(job, lines); report(billJob(job.id, { date, fx })); })} data-lg-bill-job>{lgbT('billJob')}</button>
          </div>
        </div>
      )}
      {shown.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr>{(['job', 'client', 'status'] as const).map((k) => <th key={k}>{lgT(k)}</th>)}<th>{lgbT('billing')}</th><th>{lgbT('docs')}</th><th /></tr></thead>
            <tbody>
              {shown.map(({ j, st, docs }) => (
                <tr key={j.id} data-lg-bill-row={j.number}>
                  <td>{j.number}</td>
                  <td>{d.name.get(j.client_id) ?? j.client_id}</td>
                  <td>{lgList('statuses', LG_STATUSES, j.status)}</td>
                  <td><span className={surface.badge}>{lgbT('states').split(',')[STATES.indexOf(st)]}</span></td>
                  <td>{docs.map((x) => <Link key={x.id} to={`/invoice/${x.id}`} style={{ marginRight: '0.5rem' }}>{x.invoice_number} · {formatCurrency(x.total, x.currency)}</Link>)}</td>
                  <td><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => pick(j.id)} data-lg-open-sheet>{lgT('open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={controls.hint}>{lgT('none')}</p>}
      <PendingNote area="logistics" />
    </section>
  );
}
