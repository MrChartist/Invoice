import { useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { godownsDb } from '../../lib/godowns';
import { godownInUse, type TrackingMap } from '../../lib/stock-tracking';
import { MAIN_GODOWN_ID, type Godown } from '../../types/stock';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './inventory.module.css';

/**
 * Add, rename or delete godowns (6.10). Main always exists; creating a second godown turns on
 * godown pickers on bills and invoices, per-godown stock and transfer vouchers.
 */
export function GodownsModal({ open, godowns, tracking, transfersUse, onClose, onChanged }: {
  open: boolean;
  godowns: Godown[];
  tracking: TrackingMap;
  /** Godown ids named on any transfer. */
  transfersUse: Set<string>;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState<{ id?: string; name: string; address: string } | null>(null);
  const [error, setError] = useState('');

  const save = () => {
    if (!editing) return;
    try {
      godownsDb.save({ id: editing.id, name: editing.name, address: editing.address });
      onChanged(editing.id ? 'Godown renamed' : `Godown ${editing.name.trim()} added`);
      setEditing(null);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = (g: Godown) => {
    try {
      godownsDb.remove(g.id, godownInUse(tracking, g.id) || transfersUse.has(g.id));
      onChanged(`Godown ${g.name} deleted`);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Godowns"
      subtitle="Stock locations. Costing stays company-wide; transfers move quantity only."
      footer={<button type="button" className={controls.btnOutline} onClick={onClose}>Done</button>}
    >
      <div className={styles.form}>
        <table className={surface.table}>
          <thead><tr><th>Name</th><th>Address</th><th><span className={surface.srOnly}>Actions</span></th></tr></thead>
          <tbody>
            {godowns.map((g) => (
              <tr key={g.id}>
                <td>{g.name}{g.id === MAIN_GODOWN_ID && <span className={styles.muted}> (default)</span>}</td>
                <td className={styles.muted}>{g.address || '—'}</td>
                <td>
                  <span className={surface.rowActions}>
                    <button type="button" className={controls.btnIcon} aria-label={`Rename ${g.name}`} onClick={() => setEditing({ id: g.id, name: g.name, address: g.address ?? '' })}>
                      <Edit3 size={16} />
                    </button>
                    {g.id !== MAIN_GODOWN_ID && (
                      <button type="button" className={controls.btnDanger} aria-label={`Delete ${g.name}`} onClick={() => remove(g)}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {editing ? (
          <form className={styles.form} onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="gd-name">Godown name</label>
                <input id="gd-name" className={controls.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="gd-addr">Address (optional)</label>
                <input id="gd-addr" className={controls.input} value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              </div>
            </div>
            <div className={surface.pageActions}>
              <button type="button" className={controls.btnOutline} onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
              <button type="submit" className={controls.btnPrimary}>{editing.id ? 'Save' : 'Add godown'}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ name: '', address: '' })}>
            <Plus size={14} aria-hidden="true" /> Add godown
          </button>
        )}
        {error && <span className={controls.error} role="alert">{error}</span>}
      </div>
    </Modal>
  );
}
