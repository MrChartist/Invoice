/**
 * Pharma pack (7U) — Dashboard → Business tiles: switch on, expiry rules, Schedule H / H1 / X flags on
 * stock items, the Schedule H1 register (CSV) and near-expiry stock.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import {
  DRUG_SCHEDULES, h1Register, h1RegisterCsv, liveScheduleIndex, nearExpiryStock, readPharmaSettings, savePharmaSettings, setDrugSchedule,
  type DrugSchedule, type PharmaSettings,
} from '../../lib/pharma';
import { loadTracking } from '../../lib/stock-tracking';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { localDb } from '../../lib/localDb';
import { cn, formatDate, todayInput } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { x7T } from '../../i18n/areas/extras-7u';
import { phT } from '../../i18n/areas/pharma-ops';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from './x7u.module.css';

type Notify = (m: string, tone?: 'success' | 'error' | 'info') => void;

export function PharmaPanel({ notify, icon }: { notify: Notify; icon?: ReactNode }) {
  useT();
  const { can } = useCan();
  const [tick, setTick] = useState(0);
  const [s, setS] = useState<PharmaSettings>(() => readPharmaSettings());
  const items = useMemo(() => getTable<{ id: string; name: string; track_batches?: boolean; drug_schedule?: string }>('stock_items'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = todayInput();
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [withX, setWithX] = useState(true);
  const [filter, setFilter] = useState('');
  const index = useMemo(() => liveScheduleIndex(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => h1Register(localDb.invoices.getAll() as InvoiceRecord[], index, { from, to }, withX ? ['H1', 'X'] : ['H1']), [index, from, to, withX]);
  const expiring = useMemo(() => {
    if (!s.enabled) return [];
    try {
      return nearExpiryStock(loadTracking(), today, s.near_expiry_days || 90);
    } catch {
      return [];
    }
  }, [s.enabled, s.near_expiry_days, today, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: PharmaSettings) => {
    try {
      savePharmaSettings(next);
      setS(readPharmaSettings());
      notify(x7T('pharmaSaved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const flag = (id: string, sch: DrugSchedule | '') => {
    try {
      setDrugSchedule(id, sch);
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const shown = items.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 40);
  const manage = can('settings.manage');

  return (
    <section className={surface.card} aria-label={x7T('pharmaTitle')} data-x7u="pharma">
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{icon} {x7T('pharmaTitle')}</span></div>
      <div className={cn(surface.cardBody, own.form)}>
        <label className={controls.check}><input type="checkbox" checked={s.enabled} disabled={!manage} onChange={(e) => save({ ...s, enabled: e.target.checked })} /> {x7T('pharmaOn')}</label>
        {s.enabled && (
          <>
            <label className={controls.check}><input type="checkbox" checked={s.block_expired} disabled={!manage} onChange={(e) => save({ ...s, block_expired: e.target.checked })} /> {x7T('blockExpired')}</label>
            <div className={own.row}>
              <label className={controls.field}><span className={controls.label}>{x7T('nearDays')}</span>
                <input className={cn(controls.input, controls.inputNumeric)} inputMode="numeric" disabled={!manage} value={String(s.near_expiry_days)} onChange={(e) => setS({ ...s, near_expiry_days: Number(e.target.value.replace(/\D/g, '')) || 0 })} onBlur={() => save(s)} /></label>
            </div>
            <label className={controls.check}><input type="checkbox" checked={s.block_near_expiry} disabled={!manage} onChange={(e) => save({ ...s, block_near_expiry: e.target.checked })} /> {x7T('blockNear')}</label>
            <label className={controls.check}><input type="checkbox" checked={!!s.block_above_mrp} disabled={!manage} onChange={(e) => save({ ...s, block_above_mrp: e.target.checked })} data-block-mrp /> {phT('blockMrp')}</label>
            <p className={own.muted}>{x7T('licenceHint')}</p>

            <p className={own.sub}>{x7T('schedules')}</p>
            {items.length === 0 ? <p className={own.muted}>{x7T('noStockItems')}</p> : (
              <>
                <input className={controls.input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={x7T('searchItem')} aria-label={x7T('searchItem')} />
                <ul className={own.list}>
                  {shown.map((i) => (
                    <li key={i.id} className={own.item}>
                      <span>{i.name}</span>
                      <select className={cn(controls.select, own.auto)} value={i.drug_schedule ?? ''} disabled={!can('master.edit')} onChange={(e) => flag(i.id, e.target.value as DrugSchedule | '')} aria-label={x7T('scheduleOf', { name: i.name })}>
                        <option value="">{x7T('noSchedule')}</option>
                        {DRUG_SCHEDULES.map((x) => <option key={x} value={x}>{x7T('scheduleX', { s: x })}</option>)}
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p className={own.sub}>{x7T('h1Register')}</p>
            <div className={own.row}>
              <label className={controls.field}><span className={controls.label}>{x7T('from')}</span>
                <input className={controls.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className={controls.field}><span className={controls.label}>{x7T('to')}</span>
                <input className={controls.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <label className={controls.check}><input type="checkbox" checked={withX} onChange={(e) => setWithX(e.target.checked)} /> {x7T('includeX')}</label>
            </div>
            {rows.length === 0 ? <p className={own.muted}>{x7T('noH1')}</p> : (
              <div className={surface.tableWrap}>
                <table className={surface.table} data-h1-register>
                  <thead><tr><th>{x7T('date')}</th><th>{x7T('billNo')}</th><th>{x7T('patient')}</th><th>{x7T('prescriber')}</th><th>{x7T('drug')}</th><th>{x7T('batch')}</th><th className={surface.numeric}>{x7T('qty')}</th></tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={`${r.number}-${i}`}>
                        <td>{formatDate(r.date)}</td><td>{r.number}</td>
                        <td>{r.patient || '-'}</td>
                        <td>{r.prescriber ? `${r.prescriber}${r.prescriber_reg ? ` (${r.prescriber_reg})` : ''}` : <span className={own.warn}>{x7T('missingRx')}</span>}</td>
                        <td>{r.drug} · {r.schedule}</td><td>{r.batch}</td><td className={surface.numeric}>{r.qty} {r.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className={own.tools}>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!rows.length} onClick={() => downloadText(`schedule-h1-register-${from}-${to}.csv`, h1RegisterCsv(rows, { from, to }), 'text/csv')}><Download size={14} /> CSV</button>
            </div>

            <p className={own.sub}>{x7T('nearExpiry', { n: String(s.near_expiry_days) })}</p>
            {expiring.length === 0 ? <p className={own.muted}>{x7T('noneExpiring')}</p> : (
              <ul className={own.list}>
                {expiring.slice(0, 40).map((r) => (
                  <li key={`${r.item}-${r.batch}`} className={own.item}>
                    <span>{r.item} · {r.batch}</span>
                    <span className={r.expired ? own.warn : undefined}>{r.expired ? x7T('expiredOn', { date: formatDate(r.expiry) }) : x7T('expiresOn', { date: formatDate(r.expiry) })} · {r.qty} {r.unit}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={own.muted}>{x7T('pharmaCa')}</p>
          </>
        )}
      </div>
    </section>
  );
}
