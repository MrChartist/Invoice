import { Plus, Trash2 } from 'lucide-react';
import type { ContactPerson } from '../../types/contacts';
import { newRowId, setPrimary } from '../../lib/contacts';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './clients.module.css';

/** R2-B4: contact persons of a party (name, role, phone, e-mail, primary, statements / reminders). */
export function ContactsEditor({ value, onChange }: { value: ContactPerson[]; onChange: (next: ContactPerson[]) => void }) {
  useT(); // re-render on a language switch (5.4)
  const set = (id: string, patch: Partial<ContactPerson>) => onChange(value.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const add = () => onChange([...value, { id: newRowId('ct'), name: '', ...(value.length ? {} : { primary: true }) }]);
  return (
    <fieldset className={styles.block} data-contacts-editor>
      <div className={styles.head}>
        <legend className={controls.label}>{s2T('c.contacts')}</legend>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={add}>
          <Plus size={14} aria-hidden="true" /> {s2T('c.addContact')}
        </button>
      </div>
      {value.map((c, i) => (
        <div key={c.id} className={styles.row}>
          <input className={controls.input} value={c.name} onChange={(e) => set(c.id, { name: e.target.value })} placeholder={s2T('c.name')} aria-label={`${s2T('c.name')} ${i + 1}`} data-contact-name />
          <input className={controls.input} value={c.role ?? ''} onChange={(e) => set(c.id, { role: e.target.value })} placeholder={s2T('c.role')} aria-label={`${s2T('c.role')} ${i + 1}`} />
          <input className={controls.input} type="tel" value={c.phone ?? ''} onChange={(e) => set(c.id, { phone: e.target.value })} placeholder={s2T('c.phone')} aria-label={`${s2T('c.phone')} ${i + 1}`} />
          <input className={controls.input} type="email" value={c.email ?? ''} onChange={(e) => set(c.id, { email: e.target.value })} placeholder={s2T('c.email')} aria-label={`${s2T('c.email')} ${i + 1}`} />
          <div className={styles.flags}>
            <label>
              <input type="radio" name="contact-primary" checked={!!c.primary} onChange={() => onChange(setPrimary(value, c.id))} /> {s2T('c.primary')}
            </label>
            <label>
              <input type="checkbox" checked={!!c.statements} onChange={(e) => set(c.id, { statements: e.target.checked || undefined })} /> {s2T('c.statements')}
            </label>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm} ${styles.removeBtn}`} onClick={() => onChange(value.filter((x) => x.id !== c.id))} aria-label={`${s2T('remove')} ${c.name || i + 1}`}>
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </fieldset>
  );
}
