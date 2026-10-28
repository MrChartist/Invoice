/**
 * R17-C1 / C3 compliance view (`view=compliance&site=&month=`): the site's people from its muster with their PF / ESI
 * shares of the month's finalised run (apportioned by duties); PF TRRN / ESI challan, status, the client's hold on the
 * month's bills (nothing posts); the annexure (UAN last four, no bank details) for the client; minimum-wage revisions
 * with shortfalls and the Labour Code hints (warnings only).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mcList, mcT } from '../../i18n/areas/manpower-r17c';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { generateId } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { escHtml as esc } from '../../lib/html-esc';
import { loadSites, siteLabel } from '../../lib/manpower/mp-sites';
import { loadMusters, loadStaff, musterOf } from '../../lib/manpower/mp-muster';
import { SHARE_KEYS, holdOf, siteShares, sumShares, type Amounts } from '../../lib/manpower/mp-compliance';
import { loadCompliance, saveCompliance, type CompPatch } from '../../lib/manpower/mp-comp-save';
import { labourHints, shortfalls } from '../../lib/manpower/mp-wage-check';
import { readRunForMonth } from '../../lib/manpower/mp-payroll-io';
import { readManpowerSettings, saveManpowerSettings } from '../../lib/manpower/mp-settings';
import type { WageRevision } from '../../types/manpower-r17';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, type MpViewProps } from './mp-ui';

const bar = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.5rem 0' } as const;
const STS = ['pending', 'proved', 'waived'] as const;
const REV = ['from', 'post_name', 'zone', 'skill', 'wage_day', 'wage_month', 'ref'] as const;
const n2 = (v: string) => (v === '' ? undefined : Number(v));

function Revisions({ notify, onSaved }: MpViewProps & { onSaved: () => void }) {
  const [rows, setRows] = useState<WageRevision[]>(() => readManpowerSettings().wage_revisions ?? []);
  const [d, setD] = useState<Partial<Record<(typeof REV)[number], string>>>({ from: todayInput().slice(0, 8) + '01' });
  const add = () => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.from ?? '') || !d.ref?.trim()) throw new Error(`${mcList('rev', 0)} / ${mcList('rev', 6)}?`);
      const r: WageRevision = { id: generateId(), from: d.from!, ref: d.ref.trim() };
      for (const k of ['post_name', 'zone', 'skill'] as const) if (d[k]?.trim()) r[k] = d[k]!.trim();
      for (const k of ['wage_day', 'wage_month'] as const) if (n2(d[k] ?? '')) r[k] = n2(d[k]!);
      const next = [...rows, r];
      saveManpowerSettings({ wage_revisions: next });
      setRows(next);
      onSaved();
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  return (
    <div data-mp-revisions>
      {rows.map((r) => <p key={r.id} className={controls.hint} data-mp-rev={r.id}>{r.from} · {[r.post_name, r.zone, r.skill].filter(Boolean).join(' / ') || '*'} · ₹{r.wage_day ?? r.wage_month} · {r.ref}</p>)}
      {can('settings.manage') && (
        <div style={bar}>
          {REV.map((k, i) => <Field key={k} label={mcList('rev', i)}><input className={controls.input} style={{ width: i ? '7rem' : undefined }} type={i === 0 ? 'date' : i === 4 || i === 5 ? 'number' : 'text'} value={d[k] ?? ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} data-mp-rev-field={k} /></Field>)}
          <button type="button" className={controls.btnOutline} onClick={add} data-mp-rev-add>{mcT('add')}</button>
        </div>
      )}
    </div>
  );
}

function annexHtml(title: string, shares: ReturnType<typeof siteShares>, t: Amounts, refs: string): string {
  const cell = (v: string | number) => `<td>${esc(String(v))}</td>`;
  const head = mcT('cols').split(',').map((h) => `<th>${esc(h)}</th>`).join('');
  const row = (a: string[], x: Amounts) => `<tr>${a.map(cell).join('')}${SHARE_KEYS.map((k) => cell(x[k].toFixed(2))).join('')}</tr>`;
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:12px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:3px;text-align:right}td:nth-child(-n+3),th:nth-child(-n+3){text-align:left}</style><h3>${esc(title)}</h3><p>${esc(refs)}</p><table><tr>${head}</tr>${shares.map((s) => row([s.name, s.code, s.uan, String(s.duties)], s)).join('')}${row([mcT('total'), '', '', String(shares.reduce((a, s) => a + s.duties, 0))], t)}</table><p>${esc(mcT('annex'))}</p>`;
}

export default function ComplianceView({ notify }: MpViewProps) {
  useT();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const sites = useMemo(() => loadSites(), []);
  const month = params.get('month') || todayInput().slice(0, 7);
  const site = sites.find((s) => s.id === params.get('site')) ?? sites[0];
  const data = useMemo(() => {
    void tick;
    const musters = loadMusters(month);
    const run = readRunForMonth(month);
    const comp = site && loadCompliance(month).find((c) => c.site_id === site.id);
    return { musters, run, comp, staff: loadStaff(), invoices: localDb.invoices.getAll().filter((i) => i.mp?.month === month && i.mp.site?.id === site?.id && i.doc_type !== 'CREDIT_NOTE' && i.status !== 'Cancelled') };
  }, [month, site, tick]);
  const [p, setP] = useState<CompPatch | null>(null);
  if (!site) return <p className={controls.hint}>{mpT('none')}</p>;
  const m = musterOf(data.musters, site.id, month);
  const shares = m && data.run ? siteShares(m, data.musters, data.run.lines) : [];
  const t = sumShares(shares);
  const cur: CompPatch = { pf: {}, esi: {}, status: 'pending', ...data.comp, ...p };
  const set = (x: CompPatch) => setP({ ...p, ...x });
  const go = (q: Record<string, string>) => { setP(null); setParams({ tab: 'deploy', view: 'compliance', site: site.id, month, ...q }, { replace: true }); };
  const save = () => { try { saveCompliance(site.id, month, cur, t); setP(null); setTick((k) => k + 1); notify(mcT('saved')); } catch (e) { notify((e as Error).message, 'error'); } };
  const ms = readManpowerSettings();
  const short = m && data.run ? shortfalls(site, m, data.musters, data.run.lines, ms.wage_revisions ?? []) : [];
  const hints = data.run ? labourHints({ month, lines: data.run.lines, staff: data.staff, sites: [site], musters: data.musters, licences: ms.licences ?? [] }) : [];
  const print = () => void import('../../lib/voucher-print').then(({ printHtmlDocument }) => printHtmlDocument(annexHtml(`${siteLabel(site)} · ${month}`, shares, t, `${mcT('trrn')}: ${cur.pf?.trrn ?? '—'} · ${mcT('chal')}: ${cur.esi?.challan ?? '—'}`), () => notify('Pop-up blocked', 'error')));
  return (
    <section data-mp-compliance={data.comp?.status ?? 'none'}>
      <div style={bar}>
        <Field label={mpT('site')}><select className={controls.select} value={site.id} onChange={(e) => go({ site: e.target.value })} data-mp-comp-site>{sites.map((s) => <option key={s.id} value={s.id}>{siteLabel(s)}</option>)}</select></Field>
        <Field label={mpT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => e.target.value && go({ month: e.target.value })} /></Field>
      </div>
      {!data.run ? <p className={controls.hint} role="note">{mcT('noRun', { m: month })}</p> : !m ? <p className={controls.hint}>{mcT('noMuster')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-mp-comp-table>
            <thead><tr>{mcT('cols').split(',').map((h, i) => <th key={h} className={i > 2 ? surface.numeric : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {shares.map((s, i) => <tr key={i} data-mp-comp-row={s.code}><td>{s.name}{s.relief ? ` (${mpT('reliever')})` : ''}</td><td>{s.code}</td><td>{s.uan}</td><td className={surface.numeric}>{s.duties}</td>{SHARE_KEYS.map((k) => <td key={k} className={surface.numeric}>{s[k].toFixed(2)}</td>)}</tr>)}
              <tr data-mp-comp-total><th colSpan={4}>{mcT('total')}</th>{SHARE_KEYS.map((k) => <th key={k} className={surface.numeric} data-k={k}>{t[k].toFixed(2)}</th>)}</tr>
            </tbody>
          </table>
        </div>
      )}
      <div style={bar}>
        <Field label={mcT('trrn')}><input className={controls.input} value={cur.pf?.trrn ?? ''} onChange={(e) => set({ pf: { ...cur.pf, trrn: e.target.value } })} data-mp-comp-trrn /></Field>
        <Field label={mcT('paid')}><input type="date" className={controls.input} value={cur.pf?.paid_on ?? ''} onChange={(e) => set({ pf: { ...cur.pf, paid_on: e.target.value || undefined } })} /></Field>
        <Field label={mcT('chal')}><input className={controls.input} value={cur.esi?.challan ?? ''} onChange={(e) => set({ esi: { ...cur.esi, challan: e.target.value } })} data-mp-comp-challan /></Field>
        <Field label={mcT('paid')}><input type="date" className={controls.input} value={cur.esi?.paid_on ?? ''} onChange={(e) => set({ esi: { ...cur.esi, paid_on: e.target.value || undefined } })} /></Field>
        <Field label={mpT('status')}><select className={controls.select} value={cur.status} onChange={(e) => set({ status: e.target.value as CompPatch['status'] })} data-mp-comp-status>{STS.map((s, i) => <option key={s} value={s}>{mcList('sts', i)}</option>)}</select></Field>
        <Field label={mcT('holdPct')}><input type="number" min={0} max={100} className={controls.input} style={{ width: '5rem' }} value={cur.hold?.pct ?? ''} onChange={(e) => set({ hold: { ...cur.hold, pct: n2(e.target.value) } })} data-mp-comp-hold /></Field>
        <Field label={mcT('holdAmt')}><input type="number" min={0} className={controls.input} style={{ width: '7rem' }} value={cur.hold?.amount ?? ''} onChange={(e) => set({ hold: { ...cur.hold, amount: n2(e.target.value) } })} /></Field>
        <button type="button" className={controls.btnPrimary} onClick={save} data-mp-comp-save>{mpT('save')}</button>
        {shares.length > 0 && <button type="button" className={controls.btnOutline} onClick={print} data-mp-comp-print>{mcT('print')}</button>}
      </div>
      {data.invoices.map((i) => <p key={i.id} className={controls.hint} data-mp-comp-bill>{i.invoice_number || mpT('open')} {formatCurrency(i.total)}{cur.hold?.pct || cur.hold?.amount ? ` · ${mcT('held', { h: formatCurrency(holdOf(cur.hold, i.total)) })}` : ''}</p>)}
      <h4 className={controls.label}>{mcT('mw')}</h4>
      <Revisions notify={notify} onSaved={() => setTick((k) => k + 1)} />
      {data.run && (short.length ? short.map((s, i) => <p key={i} className={controls.hint} role="note" data-mp-short={s.employee_id}>{mcT('short', { n: s.name, p: s.post, a: s.paid, b: s.min, c: formatCurrency(s.arrears) })}</p>) : <p className={controls.hint}>{mcT('ok')}</p>)}
      {hints.map((h, i) => <p key={i} className={controls.hint} role="note" data-mp-hint={h.k}>{mcT(`h.${h.k}`, { w: h.who })} ({h.ca})</p>)}
    </section>
  );
}
