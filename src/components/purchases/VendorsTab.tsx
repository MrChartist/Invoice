import { useMemo, useState } from 'react';
import { Pencil, Plus, Search, Store, Trash2 } from 'lucide-react';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { INDIAN_STATES, stateByCode } from '../../lib/india-states';
import { searchVendors, validateVendor, vendorBalances, vendorsDb } from '../../lib/vendors';
import { formatCurrency } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { GstinInput } from '../ui/GstinInput';
import { Modal } from '../ui/Modal';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import tabStyles from './VendorsTab.module.css';

export interface VendorsTabProps {
  vendors: Vendor[];
  purchases: PurchaseRecord[];
  onChanged: (message?: string, tone?: 'success' | 'error') => void;
}

export function VendorsTab({ vendors, purchases, onChanged }: VendorsTabProps) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);

  const balances = useMemo(() => vendorBalances(purchases), [purchases]);
  const rows = useMemo(() => searchVendors(vendors, query), [vendors, query]);

  return (
    <section className={surface.card}>
      <div className={tabStyles.toolbar}>
        <label className={tabStyles.search}>
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, GSTIN or phone"
            aria-label="Search vendors"
          />
        </label>
        <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
          <Plus size={16} /> Add vendor
        </button>
      </div>

      {vendors.length === 0 ? (
        <EmptyState icon={Store} title="No vendors yet" text="Add the suppliers you buy from to track what you owe each of them." />
      ) : rows.length === 0 ? (
        <EmptyState icon={Search} title="No matches" text="Try a different search." />
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>Vendor</th>
                <th className={tabStyles.hideSm}>GSTIN</th>
                <th className={tabStyles.hideSm}>State</th>
                <th className={`${surface.numeric} ${tabStyles.hideSm}`}>Bills</th>
                <th className={surface.numeric}>Outstanding</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const b = balances.get(v.id);
                return (
                  <tr key={v.id}>
                    <td>
                      <div className={tabStyles.name}>
                        <Avatar name={v.name} size={28} square />
                        <div>
                          <div>{v.name}</div>
                          {(v.phone || v.email) && <div className={tabStyles.sub}>{v.phone || v.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className={`${surface.mono} ${tabStyles.hideSm}`}>{v.gstin || '—'}</td>
                    <td className={tabStyles.hideSm}>{stateByCode(v.state_code)?.name ?? '—'}</td>
                    <td className={`${surface.numeric} ${tabStyles.hideSm}`}>{b?.bills ?? 0}</td>
                    <td className={surface.numeric}>{formatCurrency(b?.outstanding ?? 0)}</td>
                    <td>
                      <div className={surface.rowActions}>
                        <button type="button" className={controls.btnIcon} title="Edit" aria-label={`Edit ${v.name}`} onClick={() => setEditing(v)}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className={controls.btnDanger} title="Delete" aria-label={`Delete ${v.name}`} onClick={() => setDeleting(v)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add vendor' : 'Edit vendor'}
        size="md"
      >
        {editing !== null && (
          <VendorForm
            key={editing === 'new' ? 'new' : editing.id}
            vendor={editing === 'new' ? undefined : editing}
            onClose={() => setEditing(null)}
            onSaved={(m) => onChanged(m)}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        destructive
        title="Delete this vendor?"
        message={`${deleting?.name ?? ''} will be removed from your vendor list. Existing bills keep the vendor's name and GSTIN.`}
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) {
            vendorsDb.remove(deleting.id);
            onChanged(`${deleting.name} deleted`);
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function VendorForm({ vendor, onClose, onSaved }: { vendor?: Vendor; onClose: () => void; onSaved: (m: string) => void }) {
  const [draft, setDraft] = useState<Vendor>(vendor ?? { id: '', name: '' });
  const [error, setError] = useState('');
  const set = (patch: Partial<Vendor>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const problem = validateVendor(draft);
    if (problem) return setError(problem);
    try {
      const saved = vendorsDb.save({ ...draft, id: vendor?.id });
      onSaved(vendor ? `${saved.name} updated` : `${saved.name} added`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={controls.field}>
        <label className={controls.label} htmlFor="v-name">Vendor name</label>
        <input id="v-name" className={controls.input} value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-gstin">GSTIN</label>
          <GstinInput id="v-gstin" value={draft.gstin ?? ''} onChange={(gstin) => set({ gstin })} onStateCode={(state_code) => set({ state_code })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-state">State</label>
          <select id="v-state" className={controls.select} value={draft.state_code ?? ''} onChange={(e) => set({ state_code: e.target.value })}>
            <option value="">Not specified</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-phone">Phone</label>
          <input id="v-phone" type="tel" className={controls.input} value={draft.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="v-email">Email</label>
          <input id="v-email" type="email" className={controls.input} value={draft.email ?? ''} onChange={(e) => set({ email: e.target.value })} />
        </div>
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="v-addr">Address</label>
        <textarea id="v-addr" className={controls.textarea} value={draft.address ?? ''} onChange={(e) => set({ address: e.target.value })} />
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="v-notes">Notes</label>
        <textarea id="v-notes" className={controls.textarea} value={draft.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} />
      </div>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{vendor ? 'Save changes' : 'Add vendor'}</button>
      </div>
    </form>
  );
}
