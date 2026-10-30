/**
 * PS-A4 "Who" on the time form and the timer (lazy; mounted only while the `practice` pack is on): the timekeeper from the
 * R10 staff list (`TimeEntry.staff_id`), defaulting to the row whose local-user hint matches (a hint only). Reports the
 * timekeeper's standard rate on the day, one more rate-card level after the task.
 */
import { useEffect, useMemo } from 'react';
import { loadStaff } from '../../lib/services/sv-staff';
import { defaultStaffFor, rateAt } from '../../lib/prof/ps-staff';
import { currentActor } from '../../lib/access';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export default function WhoRow({ value, date, onChange }: { value?: string; date: string; onChange: (staffId: string | undefined, standardRate: number | undefined) => void }) {
  const staff = useMemo(() => loadStaff().filter((s) => s.active !== false), []);
  const pick = (id: string | undefined) => onChange(id, rateAt(staff.find((s) => s.id === id), date)?.standard_rate);
  useEffect(() => {
    const d = value ? undefined : defaultStaffFor(currentActor()?.id, staff);
    pick(value ?? d?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  if (!staff.length) return null;
  return (
    <label className={controls.field}>
      <span className={controls.label}>{psT('who')}</span>
      <SelectField className={controls.select} value={value ?? ''} onChange={(e) => pick(e.target.value || undefined)} data-time-who>
        <option value="">{psT('none')}</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </SelectField>
    </label>
  );
}
