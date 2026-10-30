/** PS-A4 Utilisation: timekeepers' capacity and dated rates (R10 staff), and billable ÷ available hours against the target. */
import { useMemo, useState } from 'react';
import type { ServiceStaff } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { timeDb } from '../../lib/timesheets';
import { loadStaff } from '../../lib/services/sv-staff';
import { addTimekeeper, rateAt, saveStaffPs } from '../../lib/prof/ps-staff';
import { leaveDaysFrom, utilisation } from '../../lib/prof/ps-utilisation';
import { loadWorkTypes } from '../../lib/rate-cards';
import { downloadText, toCsv } from '../../lib/download';
import { todayInput } from '../../lib/utils';
import { pwT } from '../../i18n/areas/prof-r14a-wip';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { pct, runWith, type PsDeskProps } from './ps-run';
import { usePeriod } from './use-period';
import { TypedInput } from '../ui/TypedInput';

interface Draft { id?: string; name: string; cap: string; std: string; cost: string; target: string; from: string }
const draftOf = (s?: ServiceStaff): Draft => {
  const r = s ? rateAt(s, todayInput()) : undefined;
  return { id: s?.id, name: s?.name ?? '', cap: String(s?.ps?.capacity_hours_week ?? ''), std: String(r?.standard_rate ?? ''), cost: String(r?.cost_rate ?? ''), target: String(s?.ps?.target_pct ?? ''), from: r?.from ?? todayInput() };
};

export default function UtilisationView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const { from, to, inputs } = usePeriod();
  const [tick, setTick] = useState(0);
  const [d, setD] = useState<Draft | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const staff = useMemo(() => loadStaff(), [tick]);
  const rows = useMemo(() => utilisation(staff, timeDb.all(), { from, to, leaveDays: leaveDaysFrom(getTable('attendance'), from, to) }), [staff, from, to]);
  const wt = useMemo(() => new Map(loadWorkTypes().map((w) => [w.id, w.name])), []);
  const save = () => {
    if (!d) return;
    const ps = { capacity_hours_week: Number(d.cap) || undefined, target_pct: Number(d.target) || undefined, rates: [{ from: d.from, standard_rate: Number(d.std) || 0, cost_rate: Number(d.cost) || 0 }] };
    const prev = staff.find((s) => s.id === d.id);
    const r = run(() => (prev ? saveStaffPs(prev.id, { ...prev.ps, ...ps, rates: [...(prev.ps?.rates ?? []).filter((x) => x.from !== d.from), ...ps.rates] }) : addTimekeeper(d.name.trim(), ps)), psT('saved'));
    if (r) { setD(null); setTick((x) => x + 1); }
  };
  const head = [psT('staff'), pwT('available'), pwT('billable'), pwT('nonBill'), pwT('util'), pwT('targetPct')];
  const csv = rows.map((r) => [r.name, r.available, r.billable, Object.entries(r.nonBillable).map(([k, h]) => `${wt.get(k) ?? '-'} ${h}`).join('; '), pct(r.pct), r.target ?? '']);
  const num = (k: keyof Draft, label: string) => <Field label={label}><TypedInput type={k === 'from' ? 'date' : 'number'} min={0} className={controls.input} value={d?.[k] ?? ''} onChange={(e) => d && setD({ ...d, [k]: e.target.value })} data-staff-ps={k} /></Field>;
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={controls.row3}>{inputs}</div>
        <div className={controls.row}>
          <button type="button" className={controls.btnPrimary} onClick={() => setD(draftOf())} data-new-timekeeper>{pwT('newStaff')}</button>
          <button type="button" className={controls.btnGhost} onClick={() => downloadText('utilisation.csv', toCsv([head, ...csv]), 'text/csv')}>{psT('csv')}</button>
        </div>
        {d && (
          <div className={controls.row3} data-timekeeper-form>
            {!d.id && <Field label={pwT('name')}><input className={controls.input} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} data-staff-ps="name" /></Field>}
            {num('cap', pwT('capacity'))}{num('std', pwT('stdRate'))}{num('cost', pwT('costRate'))}{num('target', pwT('targetPct'))}{num('from', pwT('rateFrom'))}
            <button type="button" className={controls.btnPrimary} onClick={save} data-save-timekeeper>{psT('save')}</button>
          </div>
        )}
        <div className={surface.tableWrap}>
          <table className={surface.table} data-utilisation>
            <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} data-util-row={r.name}>
                  {csv[i].slice(0, 4).map((c, j) => <td key={j} className={j ? surface.numeric : undefined}>{c}</td>)}
                  <td><span style={{ display: 'inline-block', width: 80, height: 8, background: 'var(--sep)', verticalAlign: 'middle' }}><span style={{ display: 'block', height: 8, width: `${Math.min(r.pct ?? 0, 100)}%`, background: r.under ? 'var(--sys-orange-ink)' : 'var(--tint)' }} /></span> {csv[i][4]}</td>
                  <td>{csv[i][5]}</td>
                  <td><button type="button" className={controls.btnGhost} onClick={() => setD(draftOf(staff.find((s) => s.id === r.id)))}>{psT('open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={controls.hint}>{pwT('private')}</p>
      </div>
    </div>
  );
}
