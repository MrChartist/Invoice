import { useMemo, useState, type ReactNode } from 'react';
import { Check, Plus, RefreshCw } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { useCan } from '../../hooks/useCan';
import { amcDb, amcReminders, contractStatus, renewContract, addDaysIso } from '../../lib/amc';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { amcT } from '../../i18n/areas/extras';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from '../dashboard/tiles.module.css';

/** AMC / service contracts (WP-9): reminders, visit log, renewal and a quick "new contract" form. */
export function AmcPanel({ notify, icon }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void; icon?: ReactNode }) {
  useT();
  const { can } = useCan();
  const today = todayInput();
  const [tick, setTick] = useState(0);
  const contracts = useMemo(() => amcDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reminders = amcReminders(contracts, today);
  const live = contracts.filter((c) => !c.cancelled && contractStatus(c, today).state !== 'expired');
  const [form, setForm] = useState({ client_name: '', title: '', start: today, months: 12, value: 0, visits_per_year: 4 });
  const edit = can('master.edit');

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      notify(ok);
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const save = () =>
    run(() => {
      const [y, m, d] = form.start.split('-').map(Number);
      const endDate = new Date(y, m - 1 + Math.max(form.months, 1), d, 12);
      const end = addDaysIso(`${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`, -1);
      amcDb.save({ client_name: form.client_name, title: form.title, start: form.start, end, value: form.value, visits_per_year: form.visits_per_year, renew_notice_days: 30 });
      setForm({ ...form, client_name: '', title: '', value: 0 });
    }, amcT('saved'));

  return (
    <section className={surface.card} aria-label={amcT('title')}>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{icon} {amcT('title')}</span><span className={controls.hint}>{amcT('activeCount', { n: String(live.length) })}</span></div>
      <div className={cn(surface.cardBody, own.form)}>
        {reminders.length === 0 ? <p className={controls.hint}>{amcT('nothingDue')}</p> : (
          <ul className={own.list}>
            {reminders.map((r) => (
              <li key={r.id}>
                <span>{r.text} · {formatDate(r.date)}</span>
                {edit && r.kind === 'visit' && (
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => amcDb.recordVisit(r.contract_id, { date: today }), amcT('visitDone'))}>
                    <Check size={14} /> {amcT('markVisit')}
                  </button>
                )}
                {edit && r.kind === 'renewal' && (
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => renewContract(r.contract_id), amcT('renewed'))}>
                    <RefreshCw size={14} /> {amcT('renew')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {live.length > 0 && (
          <ul className={own.list}>
            {live.slice(0, 6).map((c) => {
              const s = contractStatus(c, today);
              return (
                <li key={c.id}>
                  <span>{c.client_name} : {c.title} <small>{amcT('contractLine', { end: formatDate(c.end), done: String(s.done), total: String(s.schedule.length) })}</small></span>
                  <strong>{formatCurrency(c.value)}</strong>
                </li>
              );
            })}
          </ul>
        )}
        {edit && (
          <details>
            <summary>{amcT('add')}</summary>
            <div className={own.form}>
              <input className={controls.input} value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} placeholder={amcT('customer')} aria-label={amcT('customer')} />
              <input className={controls.input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={amcT('contractTitle')} aria-label={amcT('contractTitle')} />
              <div className={controls.row}>
                <label className={controls.field}><span className={controls.label}>{amcT('start')}</span><input type="date" className={controls.input} value={form.start} onChange={(e) => e.target.value && setForm({ ...form, start: e.target.value })} /></label>
                <label className={controls.field}><span className={controls.label}>{amcT('months')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={form.months} onChange={(v) => setForm({ ...form, months: v })} /></label>
              </div>
              <div className={controls.row}>
                <label className={controls.field}><span className={controls.label}>{amcT('value')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={form.value} onChange={(v) => setForm({ ...form, value: v })} /></label>
                <label className={controls.field}><span className={controls.label}>{amcT('visits')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={form.visits_per_year} onChange={(v) => setForm({ ...form, visits_per_year: v })} /></label>
              </div>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={save}><Plus size={14} /> {amcT('save')}</button>
              <p className={controls.hint}>{amcT('hint')}</p>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
