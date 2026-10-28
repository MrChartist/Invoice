/**
 * R18-B1 bills view: a period's run (bill date, due date) with its plan (documents by kind, units already billed or
 * without a member), "Run period" (one batch), B4 "Special levy" (a one-off run shared by a basis), the runs (counts,
 * total, status, "Undo run" with a reason) and each run's documents (open, share one at a time — no bulk sender).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import { hsbT } from '../../i18n/areas/society-r18b';
import { localDb } from '../../lib/localDb';
import { addDaysInput, formatCurrency, todayInput } from '../../lib/utils';
import { invoiceSummaryText, whatsappLink } from '../../lib/share';
import { BASES, HEAD_KINDS, periodOf, periodRange } from '../../lib/society/hs-tariff';
import { issueRun, loadRuns, planRun, societySettings, undoRun } from '../../lib/society/hs-issue-io';
import type { HsBasis, HsHeadKind, SocietyRun } from '../../types/society-r18';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, type HsViewProps } from './hs-ui';
import { numIn, row } from './hs-form';
import RegimeChip from './parts/RegimeChip';

const LEVY_BASES = BASES.filter((b) => ['per_unit', 'area_carpet', 'area_super', 'undivided_pct'].includes(b));

export default function BillsView({ notify }: HsViewProps) {
  useT();
  const s = useMemo(() => societySettings(), []);
  const day = (p: string) => { const r = periodRange(p); return r ? `${r.from.slice(0, 8)}${String(Math.min(28, Math.max(1, s.bill_day ?? 1))).padStart(2, '0')}` : todayInput(); };
  const [p, setP] = useState(() => periodOf(todayInput(), s.cycle));
  const [date, setDate] = useState(() => day(p));
  const [due, setDue] = useState(() => addDaysInput(s.due_days ?? 15, day(p)));
  const [levy, setLevy] = useState<SocietyRun['levy'] | null>(null);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState('');
  const [tick, setTick] = useState(0);
  const pick = (v: string) => { setP(v); if (periodRange(v)) { setDate(day(v)); setDue(addDaysInput(s.due_days ?? 15, day(v))); } };
  const input = { period: levy ? date.slice(0, 7) : p, date, due, ...(levy ? { levy } : {}) };
  const plan = useMemo(() => { void tick; return periodRange(input.period) ? planRun(input, '') : null; }, [tick, input.period, date, due, levy]); // eslint-disable-line react-hooks/exhaustive-deps
  const runs = useMemo(() => { void tick; return loadRuns().sort((a, b) => b.date.localeCompare(a.date) || b.updated_at.localeCompare(a.updated_at)); }, [tick]);
  const docs = useMemo(() => (open ? localDb.invoices.getAll().filter((i) => i.hs?.run_id === open) : []), [open, tick]);
  const act = (fn: () => string) => { try { notify(fn()); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const n = (r: string) => plan?.skipped.filter((x) => x.reason === r).map((x) => x.code) ?? [];
  const lv = (o: Partial<NonNullable<SocietyRun['levy']>>) => setLevy((x) => ({ ...x!, ...o }));
  return (
    <section data-hs-bills>
      <div style={row}>
        <F label={hsbT('period')}><input className={controls.input} value={p} onChange={(e) => pick(e.target.value.trim())} placeholder="2026-10 / 2026-Q3" data-hs-run-period disabled={!!levy} /></F>
        <F label={hsbT('billDate')}><input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} data-hs-bill-date /></F>
        <F label={hsbT('due')}><input type="date" className={controls.input} value={due} onChange={(e) => setDue(e.target.value)} data-hs-due /></F>
        <label className={controls.check}><input type="checkbox" checked={!!levy} onChange={(e) => setLevy(e.target.checked ? { name: '', kind: 'major_repair', basis: 'area_carpet', total: 0 } : null)} /> {hsbT('levy')}</label>
      </div>
      {levy && (
        <div style={row} data-hs-levy>
          <F label={hsbT('levyName')}><input className={controls.input} value={levy.name} onChange={(e) => lv({ name: e.target.value })} /></F>
          <F label={hsT('kind')}><select className={controls.select} value={levy.kind} onChange={(e) => lv({ kind: e.target.value as HsHeadKind })}>{HEAD_KINDS.map((k) => <option key={k} value={k}>{hsList('kinds', HEAD_KINDS, k)}</option>)}</select></F>
          <F label={hsT('basis')}><select className={controls.select} value={levy.basis} onChange={(e) => lv({ basis: e.target.value as HsBasis })}>{LEVY_BASES.map((b) => <option key={b} value={b}>{hsList('bases', BASES, b)}</option>)}</select></F>
          <F label={hsT('total')}><input type="number" min={0} className={controls.input} value={levy.total || ''} onChange={(e) => lv({ total: numIn(e.target.value) ?? 0 })} /></F>
        </div>
      )}
      {plan && (
        <p className={controls.hint} data-hs-planned={plan.bills.length} data-hs-already={n('billed').length}>
          {hsbT('planned', { n: plan.bills.length, b: plan.counts.bos, t: plan.counts.tax, p: plan.counts.plain, o: plan.counts.outsider })}
          {n('billed').length > 0 && ` ${hsbT('billed', { n: n('billed').length })}`}
          {n('owner').length > 0 && ` ${hsbT('noOwner', { n: n('owner').join(', ') })}`}
          {plan.commercial.length > 0 && ` ${hsbT('commercial', { u: plan.commercial.join(', ') })}`}
        </p>
      )}
      <div style={row}>
        <button type="button" className={controls.btnPrimary} disabled={!plan?.bills.length || (!!levy && !(levy.name.trim() && levy.total > 0))} data-hs-run
          onClick={() => act(() => { const r = issueRun(input); return [hsbT('issued', { n: r.invoices.length }), r.held ? hsbT('held', { n: r.held }) : '', n('billed').length ? hsbT('billed', { n: n('billed').length }) : ''].filter(Boolean).join(' '); })}>{levy ? hsbT('runLevy') : hsbT('run')}</button>
        <F label={hsbT('reason')}><input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} data-hs-reason /></F>
      </div>
      {runs.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-hs-runs>
            <caption style={{ textAlign: 'left', fontWeight: 600 }}>{hsbT('runs')}</caption>
            <thead><tr><th>{hsbT('period')}</th><th>{hsbT('billDate')}</th><th>{hsbT('docs')}</th><th className={surface.numeric}>{hsT('total')}</th><th>{hsbT('status')}</th><th /></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-hs-run-row={r.period}>
                  <td>{r.levy?.name ?? r.period}</td><td>{r.date}</td>
                  <td>{r.counts.bos + r.counts.tax + r.counts.plain + r.counts.outsider} ({r.counts.bos} / {r.counts.tax} / {r.counts.plain} / {r.counts.outsider})</td>
                  <td className={surface.numeric}>{formatCurrency(Object.values(r.totals).reduce((t, x) => t + x, 0))}</td>
                  <td>{r.undone ? `${hsbT('undone')} — ${r.undone.reason}` : hsbT('done')}</td>
                  <td>
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(open === r.id ? '' : r.id)}>{hsT('open')}</button>
                    {!r.undone && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} data-hs-undo onClick={() => act(() => { undoRun(r.id, reason); return hsbT('undone'); })}>{hsbT('undo')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {docs.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-hs-run-docs>
            <tbody>
              {docs.map((i) => (
                <tr key={i.id} data-hs-doc={i.hs?.unit?.code}>
                  <td>{i.hs?.unit?.code}</td><td><Link to={`/invoice/${i.id}`}>{i.invoice_number || i.status}</Link></td><td><RegimeChip regime={i.hs?.regime} /></td>
                  <td className={surface.numeric}>{formatCurrency(i.total ?? 0)}</td>
                  <td>{i.status !== 'Cancelled' && <a href={whatsappLink(i.client?.phone, invoiceSummaryText(i))} target="_blank" rel="noreferrer">{hsbT('share')}</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
