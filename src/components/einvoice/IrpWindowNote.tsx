import { useState } from 'react';
import { Clock } from 'lucide-react';
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';
import { aatoFor, irpWindow, needsIrn, type IrpWindow } from '../../lib/gst-guards';
import { localDb } from '../../lib/localDb';
import { todayIso } from '../../lib/tax-rules';
import { formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { ggT } from '../../i18n/areas/gst-guards';
import controls from '../../styles/controls.module.css';
import styles from '../gst-reports/gst-guards.module.css';

/** The IRP window of a document from live settings (null when none applies). */
function windowOf(invoice: InvoiceRecord, today = todayIso()): IrpWindow | null {
  const s = localDb.settings.get();
  const active = s.profiles.find((p) => p.id === s.activeProfileId) ?? null;
  return irpWindow(invoice, aatoFor(invoice, s.profiles, active), today);
}

/** Compact pill for lists (bulk e-invoice): "12d left" / "window closed". */
export function IrpWindowPill({ invoice, hasIrn, today }: { invoice: InvoiceRecord; hasIrn?: boolean; today?: string }) {
  useT();
  if (hasIrn || !needsIrn(invoice)) return null;
  const w = windowOf(invoice, today);
  if (!w) return null;
  const cls = w.stage === 'closed' || w.stage === 'day27' ? styles.pillBad : w.stage === 'day20' ? styles.pillWarn : styles.pill;
  return (
    <span className={cls} title={ggT('irpLastDay', { date: formatDate(w.deadline) })}>
      <Clock size={11} aria-hidden="true" /> {w.stage === 'closed' ? ggT('irpPillClosed') : ggT('irpPillLeft', { n: w.daysLeft + 1 })}
    </span>
  );
}

/** Profile editor for the AATO that decides the e-invoice mandate and the IRP window. */
export function AatoField({ profileGstin, onSaved }: { profileGstin?: string; onSaved?: () => void }) {
  useT();
  const pick = (s: ReturnType<typeof localDb.settings.get>): SenderProfile | undefined => {
    const g = (profileGstin ?? '').trim().toUpperCase();
    return (g && s.profiles.find((p) => (p.companyGstin ?? '').trim().toUpperCase() === g)) || s.profiles.find((p) => p.id === s.activeProfileId) || s.profiles[0];
  };
  const [value, setValue] = useState(() => String(pick(localDb.settings.get())?.einvoice_aato ?? ''));
  const [msg, setMsg] = useState('');
  const save = () => {
    const s = localDb.settings.get();
    const prof = pick(s);
    if (!prof) return;
    const n = Number(value.replace(/[^0-9.]/g, ''));
    try {
      localDb.settings.save({ ...s, profiles: s.profiles.map((p) => (p.id === prof.id ? { ...p, einvoice_aato: n > 0 ? n : undefined } : p)) });
      setMsg(ggT('aatoSaved', { name: prof.companyName || prof.companyGstin || '—' }));
      onSaved?.();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <label className={controls.field} style={{ flex: '1 1 14rem' }}>
          <span className={controls.label}>{ggT('aatoLabel')}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" placeholder="100000000" value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={save}>{ggT('aatoSave')}</button>
      </div>
      <span className={controls.hint}>{ggT('aatoHint')}</span>
      {msg && <span className={controls.hint} role="status">{msg}</span>}
    </div>
  );
}

/** Banner for the e-Invoice dialog: countdown to the last IRP reporting day, or the AATO field when it is unknown. */
export function IrpWindowNote({ invoice, hasIrn }: { invoice: InvoiceRecord; hasIrn: boolean }) {
  useT();
  const [rev, setRev] = useState(0);
  if (hasIrn || !needsIrn(invoice)) return null;
  const w = rev >= 0 ? windowOf(invoice) : null;
  const s = localDb.settings.get();
  const aato = aatoFor(invoice, s.profiles, s.profiles.find((p) => p.id === s.activeProfileId) ?? null);
  if (!w) {
    if (aato) return null;
    return (
      <div className={styles.noteInfo}>
        <AatoField profileGstin={invoice.sender?.companyGstin} onSaved={() => setRev((n) => n + 1)} />
      </div>
    );
  }
  const text = w.stage === 'closed'
    ? ggT('irpClosed', { date: formatDate(w.deadline) })
    : w.daysLeft === 0
      ? ggT('irpToday', { date: formatDate(w.deadline) })
      : ggT('irpLeft', { n: w.daysLeft, date: formatDate(w.deadline), day: w.day, days: w.days });
  return (
    <p className={w.stage === 'closed' || w.stage === 'day27' ? styles.noteBad : styles.note} role={w.stage === 'open' ? undefined : 'alert'}>
      <Clock size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {text} {ggT('irpSource')}
    </p>
  );
}
