/**
 * SV-B1 sender profile: clinic registrations (lazy, clinic pack only) — CEA / state registration and its validity
 * (bell 60 days before), the doctor's council registration (single-doctor clinics), NABL (labs), PCPNDT (imaging).
 * Printed in the bill header when set (`svRegText`); snapshotted with the profile like every sender field.
 */
import type { SenderProfile } from '../../types/invoice';
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';
import controls from '../../styles/controls.module.css';

const rT = defineArea(
  { title: 'Clinic registrations (printed when set)', cea: 'Clinical establishment / state registration no.', valid: 'Valid till', council: "Doctor's council registration (single-doctor clinic)", nabl: 'NABL no. (labs)', pcpndt: 'PCPNDT no. (imaging)' } as const,
  { title: 'क्लिनिक रजिस्ट्रेशन (भरने पर छपते हैं)', cea: 'क्लिनिकल एस्टैब्लिशमेंट / राज्य रजिस्ट्रेशन नं.', valid: 'वैध तक', council: 'डॉक्टर का काउंसिल रजिस्ट्रेशन (एक-डॉक्टर क्लिनिक)', nabl: 'NABL नं. (लैब)', pcpndt: 'PCPNDT नं. (इमेजिंग)' },
);
type Regs = NonNullable<SenderProfile['sv_regs']>;

export default function ClinicRegsPanel({ profile, onChange }: { profile: SenderProfile; onChange: (patch: Partial<SenderProfile>) => void }) {
  useT();
  const r = profile.sv_regs ?? {};
  const set = (k: keyof Regs, v: string) => {
    const next: Regs = { ...r, [k]: v.trim() || undefined };
    onChange({ sv_regs: Object.values(next).some(Boolean) ? next : undefined });
  };
  const field = (k: keyof Regs, type = 'text') => (
    <label className={controls.field} key={k}>
      <span className={controls.label}>{rT(k === 'cea_valid' ? 'valid' : k)}</span>
      <input className={controls.input} type={type} value={r[k] ?? ''} onChange={(e) => set(k, e.target.value)} data-sv-reg={k} />
    </label>
  );
  return (
    <fieldset>
      <legend>{rT('title')}</legend>
      <div className={controls.row}>{field('cea')}{field('cea_valid', 'date')}</div>
      <div className={controls.row}>{field('council')}{field('nabl')}{field('pcpndt')}</div>
    </fieldset>
  );
}
