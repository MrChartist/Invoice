/**
 * R14 PS-B2 small lazy rows: the client's legal-services status, the vendor's "advocate" tick and the work type's billing
 * unit. One chunk.
 */
import { useT } from '../../i18n';
import { psbT } from '../../i18n/areas/prof-r14b';
import { psOfParty, workUnitOf, type PsPartyB, type WorkUnit } from '../../lib/prof/ps-legal';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

type PsHolder = { ps?: unknown };
const merge = (p: PsHolder, patch: Partial<PsPartyB>) => ({ ps: { ...((p.ps as object | undefined) ?? {}), ...patch } });

/** Client form: business entity, individual, government or an advocate; small business (entry 45). */
export function ClientLegalRow({ value, onChange }: { value: PsHolder; onChange: (p: { ps: Record<string, unknown> }) => void }) {
  useT();
  const ps = psOfParty(value);
  return (
    <div className={controls.row} data-ps-client-legal>
      <label className={controls.field}>
        <span className={controls.label}>{psbT('legalStatus')}</span>
        <SelectField className={controls.select} value={ps.entity ?? ''} onChange={(e) => onChange(merge(value, { entity: (e.target.value || undefined) as PsPartyB['entity'] }))}>
          <option value="">{psbT('e.')}</option>
          {(['business', 'individual', 'government', 'advocate'] as const).map((k) => <option key={k} value={k}>{psbT(`e.${k}`)}</option>)}
        </SelectField>
      </label>
      <label className={controls.check}><input type="checkbox" checked={!!ps.small_business} onChange={(e) => onChange(merge(value, { small_business: e.target.checked || undefined }))} /> {psbT('small')}</label>
    </div>
  );
}

/** Vendor form: the supplier is an advocate / firm of advocates (inward RCM on legal services). */
export function VendorAdvocateRow({ value, onChange }: { value: PsHolder; onChange: (p: { ps: Record<string, unknown> }) => void }) {
  useT();
  return <label className={controls.check} data-ps-vendor-advocate><input type="checkbox" checked={!!psOfParty(value).advocate} onChange={(e) => onChange(merge(value, { advocate: e.target.checked || undefined }))} /> {psbT('vAdvocate')}</label>;
}

/** Work types table cell: bills per hour / appearance / item. */
export function WorkUnitSelect({ value, label, disabled, onChange }: { value: PsHolder; label: string; disabled?: boolean; onChange: (ps: Record<string, unknown>) => void }) {
  useT();
  return (
    <SelectField className={controls.select} value={workUnitOf(value)} disabled={disabled} aria-label={`${psbT('unit')} ${label}`} onChange={(e) => onChange({ ...((value.ps as object | undefined) ?? {}), unit: e.target.value === 'hour' ? undefined : (e.target.value as WorkUnit) })}>
      {(['hour', 'appearance', 'item'] as const).map((u) => <option key={u} value={u}>{psbT(`u.${u}`)}</option>)}
    </SelectField>
  );
}
