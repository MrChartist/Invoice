import { useMemo, useState } from 'react';
import { BookmarkPlus } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { addShipToAddressBook, addressToShipTo, attentionText, contactToAttention } from '../../lib/contacts';
import { masterOf } from './party-defaults';
import type {} from '../../types/contacts';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import controls from '../../styles/controls.module.css';
import styles from './clients.module.css';
import { SelectField } from '../ui/SelectField';

/**
 * R2-B4 in the editor: "Kind attn." contact picker and a ship-to picker from the party's address book,
 * plus "Save this ship-to to the party". Shown only when the party has a master record.
 */
export function PartyBookPickers() {
  useT(); // re-render on a language switch (5.4)
  const client = useInvoiceStore((s) => s.client);
  const shipTo = useInvoiceStore((s) => s.ship_to);
  const attention = useInvoiceStore((s) => s.attention);
  const patch = useInvoiceStore((s) => s.patch);
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState('');
  const master = useMemo(() => (client.name.trim() ? masterOf(client) : undefined), [client, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!master) return null;
  const contacts = master.contacts ?? [];
  const addresses = master.addresses ?? [];
  const canSave = !!shipTo?.address?.trim();
  if (!contacts.length && !addresses.length && !canSave && !attention) return null;

  const currentContact = attention ? contacts.find((c) => c.name === attention.name)?.id ?? '__snap' : '';
  const saveShip = () => {
    if (!shipTo) return;
    try {
      const { addresses: next, added } = addShipToAddressBook(master, shipTo);
      if (added) {
        localDb.clients.upsert({ ...master, addresses: next });
        setTick((t) => t + 1);
        setNote(s2T('c.shipSaved', { name: master.name }));
      } else setNote(s2T('c.shipExists'));
    } catch (err) {
      setNote((err as Error).message);
    }
  };

  return (
    <div className={styles.block} data-party-book>
      {(contacts.length > 0 || attention) && (
        <label className={controls.field}>
          <span className={controls.label}>{s2T('c.pickContact')}</span>
          <SelectField className={controls.select} value={currentContact} data-attention-pick
            onChange={(e) => {
              const c = contacts.find((x) => x.id === e.target.value);
              if (e.target.value === '__snap') return;
              patch({ attention: c ? contactToAttention(c) : undefined });
            }}>
            <option value="">{s2T('c.noContact')}</option>
            {currentContact === '__snap' && attention && <option value="__snap">{attentionText(attention)}</option>}
            {contacts.map((c) => <option key={c.id} value={c.id}>{[c.name, c.role].filter(Boolean).join(', ')}</option>)}
          </SelectField>
        </label>
      )}
      {addresses.length > 0 && (
        <label className={controls.field}>
          <span className={controls.label}>{s2T('c.pickShip')}</span>
          <SelectField className={controls.select} value="" data-ship-pick
            onChange={(e) => {
              const a = addresses.find((x) => x.id === e.target.value);
              if (a) patch({ ship_to: addressToShipTo(a, master) });
            }}>
            <option value="">-</option>
            {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}{a.city ? `: ${a.city}` : ''}</option>)}
          </SelectField>
        </label>
      )}
      {canSave && (
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={saveShip}>
          <BookmarkPlus size={14} aria-hidden="true" /> {s2T('c.saveShip')}
        </button>
      )}
      {note && <p className={styles.empty} role="status">{note}</p>}
    </div>
  );
}
