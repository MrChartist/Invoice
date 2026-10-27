/** MF-A4 item form row (lazy; mounted by the stock item form only with the `shopfloor` pack): supplier lead days and make days. */
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';
import controls from '../../styles/controls.module.css';

export interface LeadFields { lead_days?: number; make_days?: number }

const lT = defineArea(
  { lead: 'Lead time (days, buying)', make: 'Make days (blank = from the routing)' } as const,
  { lead: 'लीड समय (दिन, ख़रीद)', make: 'बनाने के दिन (ख़ाली = रूटिंग से)' },
);

export default function LeadTimeRow({ value, onChange }: { value: LeadFields; onChange: (v: LeadFields) => void }) {
  useT();
  const field = (k: keyof LeadFields) => (
    <label className={controls.field} style={{ maxWidth: 220 }}>
      <span className={controls.label}>{lT(k === 'lead_days' ? 'lead' : 'make')}</span>
      <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={value[k] ?? ''} onChange={(e) => onChange({ ...value, [k]: e.target.value === '' ? undefined : Math.max(Math.round(Number(e.target.value) || 0), 0) })} data-mf-lead={k} />
    </label>
  );
  return <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{field('lead_days')}{field('make_days')}</div>;
}
