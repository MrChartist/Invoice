/**
 * SV-A follow-up (lazy; Pos.tsx mounts it only with a service pack on and lines on the bill): a staff picker per POS
 * line (`sv.staff_id` / `staff_name`, plus the printed-name snapshot `sv.staff_print` while "staff names on the bill"
 * is on) and, with tips set to pass-through, one tip for a staff member (a 0% non-GST line — SV70).
 */
import { useEffect, useMemo, useState } from 'react';
import type { InvoiceItem } from '../../types/invoice';
import { bookableStaff } from '../../lib/services/sv-staff';
import { readServiceSettings } from '../../lib/services/sv-settings';
import { isTipLine, linesWithoutStaff, setTip, withStaff } from '../../lib/services/sv-pos';
import { useT } from '../../i18n';
import { svT } from '../../i18n/areas/services-r10a';
import controls from '../../styles/controls.module.css';

export default function PosStaff({ items, setItems, onBlock }: { items: InvoiceItem[]; setItems: (f: (prev: InvoiceItem[]) => InvoiceItem[]) => void; onBlock?: (errors: string[]) => void }) {
  useT();
  const staff = useMemo(() => bookableStaff(), []);
  const settings = useMemo(() => readServiceSettings(), []);
  const tipNow = items.find(isTipLine);
  const [tip, setTipF] = useState({ staff: tipNow?.sv?.staff_id ?? '', amount: tipNow ? String(tipNow.rate) : '' });
  // PENDING #21: with "Staff required on service lines" on, a service line without staff blocks the save.
  const missing = settings.staff_required && staff.length ? linesWithoutStaff(items).map((l, i) => l.name || `#${i + 1}`) : [];
  const block = missing.length ? svT('staffMissing', { lines: missing.join(', ') }) : '';
  useEffect(() => { onBlock?.(block ? [block] : []); }, [block, onBlock]);
  useEffect(() => () => onBlock?.([]), [onBlock]);
  if (!staff.length) return null;
  const put = (id: string, staffId: string) => setItems((prev) => prev.map((l) => (l.id === id ? withStaff(l, staff.find((s) => s.id === staffId), !!settings.print_staff) : l)));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', alignItems: 'center' }} data-pos-staff>
      <span className={controls.hint}>{svT('posStaff')}:</span>
      {items.filter((l) => !isTipLine(l) && !l.free_of && !l.modifier_of).map((l, i) => (
        <select key={l.id} className={controls.ghost} value={l.sv?.staff_id ?? ''} onChange={(e) => put(l.id, e.target.value)} aria-label={`${svT('staff')}: ${l.name || i + 1}`} data-pos-staff-line={i}>
          <option value="">{l.name || `#${i + 1}`}: -</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{l.name || `#${i + 1}`}: {s.name}</option>)}
        </select>
      ))}
      {settings.tips === 'pass-through' && (
        <>
          <select className={controls.ghost} value={tip.staff} onChange={(e) => setTipF({ ...tip, staff: e.target.value })} aria-label={`${svT('tip')}: ${svT('staff')}`} data-pos-tip-staff>
            <option value="">{svT('tip')}: -</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{svT('tip')}: {s.name}</option>)}
          </select>
          <input className={controls.input} style={{ maxWidth: '6rem' }} type="number" min={0} step="any" inputMode="decimal" value={tip.amount} onChange={(e) => setTipF({ ...tip, amount: e.target.value })} aria-label={svT('tip')} data-pos-tip-amount />
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setItems((prev) => setTip(prev, staff.find((s) => s.id === tip.staff), Number(tip.amount)))} data-pos-tip-add>{svT('addTip')}</button>
        </>
      )}
    </div>
  );
}
