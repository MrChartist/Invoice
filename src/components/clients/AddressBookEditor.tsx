import { Plus, Trash2 } from 'lucide-react';
import type { PartyAddress } from '../../types/contacts';
import { newRowId, setDefaultShipTo } from '../../lib/contacts';
import { INDIAN_STATES } from '../../lib/india-states';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './clients.module.css';
import { SelectField } from '../ui/SelectField';

/** R2-B4: delivery address book of a party (label, address, city, PIN, state, unit GSTIN, default ship-to). */
export function AddressBookEditor({ value, onChange }: { value: PartyAddress[]; onChange: (next: PartyAddress[]) => void }) {
  useT(); // re-render on a language switch (5.4)
  const set = (id: string, patch: Partial<PartyAddress>) => onChange(value.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  return (
    <fieldset className={styles.block} data-address-book>
      <div className={styles.head}>
        <legend className={controls.label}>{s2T('c.addresses')}</legend>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onChange([...value, { id: newRowId('ad'), label: '' }])}>
          <Plus size={14} aria-hidden="true" /> {s2T('c.addAddress')}
        </button>
      </div>
      {value.map((a, i) => (
        <div key={a.id} className={styles.row}>
          <input className={controls.input} value={a.label} onChange={(e) => set(a.id, { label: e.target.value })} placeholder={s2T('c.label')} aria-label={`${s2T('c.label')} ${i + 1}`} />
          <textarea className={`${controls.textarea} ${styles.wide}`} rows={2} value={a.address ?? ''} onChange={(e) => set(a.id, { address: e.target.value })} placeholder={s2T('c.address')} aria-label={`${s2T('c.address')} ${i + 1}`} />
          <input className={controls.input} value={a.city ?? ''} onChange={(e) => set(a.id, { city: e.target.value })} placeholder={s2T('c.city')} aria-label={`${s2T('c.city')} ${i + 1}`} />
          <input className={controls.input} inputMode="numeric" maxLength={6} value={a.zip ?? ''} onChange={(e) => set(a.id, { zip: e.target.value.replace(/\D/g, '') })} placeholder={s2T('c.pin')} aria-label={`${s2T('c.pin')} ${i + 1}`} />
          <SelectField className={controls.select} value={a.state_code ?? ''} onChange={(e) => set(a.id, { state_code: e.target.value || undefined })} aria-label={`${s2T('c.state')} ${i + 1}`}>
            <option value="">{s2T('c.state')}</option>
            {INDIAN_STATES.map((st) => <option key={st.code} value={st.code}>{st.code} : {st.name}</option>)}
          </SelectField>
          <input className={`${controls.input} ${controls.inputMono}`} value={a.gstin ?? ''} maxLength={15} onChange={(e) => set(a.id, { gstin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder={s2T('c.gstin')} aria-label={`${s2T('c.gstin')} ${i + 1}`} />
          <div className={styles.flags}>
            <label>
              <input type="checkbox" checked={!!a.default_ship_to} onChange={(e) => onChange(setDefaultShipTo(value, e.target.checked ? a.id : undefined))} /> {s2T('c.defaultShip')}
            </label>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm} ${styles.removeBtn}`} onClick={() => onChange(value.filter((x) => x.id !== a.id))} aria-label={`${s2T('remove')} ${a.label || i + 1}`}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </fieldset>
  );
}
