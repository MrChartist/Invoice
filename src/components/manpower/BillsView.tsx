/**
 * R17-B3 / B4 bills view (`view=bills&month=`): sites × month — muster status, billed (the invoices naming the muster),
 * unbilled value; "Bill" per site and "Bill all locked" make draft invoices (one per site or client + bill group and
 * regime) and report the list. Billing settings (owner): billing days, bill date, service charge, cost-plus %, the
 * extra-duty attendance type, "Print expected TDS".
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { mbT } from '../../i18n/areas/manpower-r17b';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import { loadSites, siteLabel } from '../../lib/manpower/mp-sites';
import { loadMusters, musterOf } from '../../lib/manpower/mp-muster';
import { billsOf } from '../../lib/manpower/mp-bill';
import { billMonth, planUnbilled } from '../../lib/manpower/mp-draft-io';
import { readManpowerSettings, saveManpowerSettings } from '../../lib/manpower/mp-settings';
import type { ManpowerSettings } from '../../types/manpower-r17';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, type MpViewProps } from './mp-ui';

const bar = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', margin: '0.5rem 0' } as const;
const CP = ['pf_pct', 'esi_pct', 'bonus_pct', 'leave_pct', 'relieving_pct', 'uniform_per_head'] as const;

function Settings({ notify }: MpViewProps) {
  const [s, setS] = useState<ManpowerSettings>(readManpowerSettings);
  const n = (v: string) => (v === '' ? undefined : Number(v));
  return (
    <details data-mp-bill-settings>
      <summary className={controls.label}>{mbT('set')}</summary>
      <div style={bar}>
        <Field label={mbT('days')}>
          <select className={controls.select} value={String(s.billing_days ?? 'calendar')} onChange={(e) => setS({ ...s, billing_days: e.target.value === 'calendar' ? 'calendar' : (Number(e.target.value) as 26 | 30) })}>
            <option value="calendar">{mbT('cal')}</option><option value="26">26</option><option value="30">30</option>
          </select>
        </Field>
        <Field label={mbT('date')}>
          <select className={controls.select} value={s.bill_date ?? 'month_end'} onChange={(e) => setS({ ...s, bill_date: e.target.value as ManpowerSettings['bill_date'] })}>
            <option value="month_end">{mbT('end')}</option><option value="next_1">{mbT('next')}</option>
          </select>
        </Field>
        <Field label={`${mpT('serviceCharge')} %`}><input type="number" min={0} max={100} className={controls.input} value={s.service_charge_pct ?? ''} onChange={(e) => setS({ ...s, service_charge_pct: n(e.target.value) })} /></Field>
        <Field label={mbT('extra')}><input className={controls.input} value={s.extra_duty_type_id ?? ''} onChange={(e) => setS({ ...s, extra_duty_type_id: e.target.value.trim() || undefined })} /></Field>
        <label className={controls.check}><input type="checkbox" checked={!!s.print_tds} onChange={(e) => setS({ ...s, print_tds: e.target.checked })} data-mp-print-tds /> {mbT('printTds')}</label>
      </div>
      <div style={bar}>
        <span className={controls.hint}>{mbT('cp')}</span>
        {CP.map((k) => <input key={k} type="number" min={0} aria-label={k} className={controls.input} style={{ width: '5rem' }} value={s.costplus?.[k] ?? ''} onChange={(e) => setS({ ...s, costplus: { ...s.costplus, [k]: n(e.target.value) } })} />)}
        <button type="button" className={controls.btnOutline} onClick={() => { try { saveManpowerSettings(s); notify(mbT('saveSet')); } catch (e) { notify((e as Error).message, 'error'); } }}>{mbT('saveSet')}</button>
      </div>
    </details>
  );
}

export default function BillsView({ notify }: MpViewProps) {
  useT();
  const [params, setParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const month = params.get('month') || todayInput().slice(0, 7);
  const data = useMemo(() => {
    void tick;
    let plans: ReturnType<typeof planUnbilled> = [];
    try { plans = planUnbilled(month); } catch { /* shown as nothing to bill */ }
    return { sites: loadSites(), musters: loadMusters(month), invoices: localDb.invoices.getAll(), plans, clients: localDb.clients.getAll() };
  }, [month, tick]);
  const bill = (ids?: string[], again = false) => {
    try {
      const r = billMonth(month, ids, again);
      notify([mbT('made', { n: r.invoices.length }), r.skipped.length ? mbT('already', { s: r.skipped.join(', ') }) : '', ...r.hints].filter(Boolean).join(' '), r.invoices.length ? 'success' : 'info');
      setTick((t) => t + 1);
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  return (
    <section data-mp-bills>
      <div style={bar}>
        <Field label={mpT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => e.target.value && setParams({ tab: 'deploy', view: 'bills', month: e.target.value }, { replace: true })} data-mp-bills-month /></Field>
        <button type="button" className={controls.btnPrimary} onClick={() => bill()} data-mp-bill-all>{mbT('billAll')}</button>
      </div>
      {can('settings.manage') && <Settings notify={notify} />}
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{mpT('site')}</th><th>{mpT('client')}</th><th>{mpT('muster')}</th><th className={surface.numeric}>{mbT('billed')}</th><th className={surface.numeric}>{mbT('unbilled')}</th><th /></tr></thead>
          <tbody>
            {data.sites.map((s) => {
              const m = musterOf(data.musters, s.id, month);
              const inv = m ? billsOf(data.invoices, m.id) : [];
              const plan = data.plans.reduce((t, p) => t + (p.sites.length === 1 ? (p.sites[0].id === s.id ? p.taxable : 0) : p.items.filter((l) => l.cost_centre_id === s.id).reduce((a, l) => a + l.amount, 0)), 0);
              return (
                <tr key={s.id} data-mp-bill-site={s.mp.code}>
                  <td><Link to={`/time?tab=deploy&view=muster&site=${s.id}&month=${month}`}>{siteLabel(s)}</Link></td>
                  <td>{data.clients.find((c) => c.id === s.client_id)?.name ?? '—'}</td>
                  <td>{!m ? mbT('none') : m.status === 'locked' ? mbT('locked') : mbT('lockFirst')}</td>
                  <td className={surface.numeric}>{inv.map((i) => <Link key={i.id} to={`/invoice/${i.id}`} style={{ display: 'block' }} data-mp-bill-link>{i.invoice_number || mbT('draft')} {formatCurrency(i.taxable_value ?? 0)}</Link>)}</td>
                  <td className={surface.numeric}>{!inv.length && plan ? formatCurrency(plan) : ''}</td>
                  <td className={surface.rowActions}>{m?.status === 'locked' && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => (!inv.length || window.confirm(mbT('already', { s: inv.map((i) => i.invoice_number || mbT('draft')).join(', ') }))) && bill([s.id], inv.length > 0)} data-mp-bill={s.mp.code}>{inv.length ? mbT('again') : mbT('bill')}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
