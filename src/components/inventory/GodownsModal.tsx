import { useState } from 'react';
import { skT } from '../../i18n/areas/stock-depth';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { godownTree, godownsDb, liveGodownReferences } from '../../lib/godowns';
import { descendantIds } from '../../lib/stock-groups';
import { imT } from '../../i18n/areas/inventory-masters';
import { depthClass } from './tree-indent';
import { godownInUse, type TrackingMap } from '../../lib/stock-tracking';
import { MAIN_GODOWN_ID, type Godown } from '../../types/stock';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import { getTable, setTable } from '../../lib/storage';
import { defineArea } from '../../i18n/area';
import controls from '../../styles/controls.module.css';

// R4-B5: replenishment source (inline labels).
const replT = defineArea(
  { label: 'Refill from (replenishment)', none: 'Not refilled from a godown', hint: 'Reorder → Replenish fills this store from that godown first and buys only the rest.', transit: 'In transit' } as const,
  { label: 'यहाँ से भरें (पुनःपूर्ति)', none: 'किसी गोदाम से नहीं', hint: 'रीऑर्डर → पुनःपूर्ति पहले उस गोदाम से भरती है, बाकी ही ख़रीदती है।', transit: 'रास्ते में' },
);
import surface from '../../styles/surface.module.css';
import styles from './inventory.module.css';
import { errText } from '../../i18n/lib-msg';
import { CostCentreSelect } from '../cost-centres/CostCentreSelect';
import { loadCostCentres } from '../../lib/cost-centres';

// 7.167: a godown may belong to a cost centre (its stock shows on that centre's column of the Project P&L).
const ccT = defineArea(
  { label: 'Cost centre (stock held for)', hint: 'Books → Projects shows the stock in this godown under that cost centre (memo).' } as const,
  { label: 'कॉस्ट सेंटर (किसके लिए रखा स्टॉक)', hint: 'बहीखाता → प्रोजेक्ट इस गोदाम का स्टॉक उस कॉस्ट सेंटर में दिखाता है (मेमो)।' },
);

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
  useT(); // re-render on a language switch (5.4)
  const [editing, setEditing] = useState<{ id?: string; name: string; address: string; parent_id: string; kind?: Godown['kind'] | ''; replenish_from?: string; cost_centre_id?: string } | null>(null);
  const [centres] = useState(() => loadCostCentres());
  // WP-8: godowns may sit inside another godown (warehouse → store room); shown as a tree.
  const tree = godownTree(godowns);
  const blocked = editing?.id ? descendantIds(editing.id, godowns) : new Set<string>();
  const [error, setError] = useState('');

  const save = () => {
    if (!editing) return;
    try {
      const saved = godownsDb.save({ id: editing.id, name: editing.name, address: editing.address, parent_id: editing.parent_id || undefined, kind: editing.kind ?? '' });
      // R4-B5: the godown this store is refilled from first (Main is implicit: stored only when it carries a field).
      if ((saved.replenish_from ?? '') !== (editing.replenish_from ?? '') || (saved.cost_centre_id ?? '') !== (editing.cost_centre_id ?? '')) {
        const rows = getTable<Godown>('godowns');
        const next = { ...saved, ...(editing.replenish_from ? { replenish_from: editing.replenish_from } : {}), ...(editing.cost_centre_id ? { cost_centre_id: editing.cost_centre_id } : {}) };
        if (!editing.replenish_from) delete next.replenish_from;
        if (!editing.cost_centre_id) delete next.cost_centre_id;
        setTable('godowns', rows.some((g) => g.id === saved.id) ? rows.map((g) => (g.id === saved.id ? next : g)) : [...rows, next]);
      }
      onChanged(editing.id ? invT('godownRenamed') : invT('godownAdded', { name: editing.name.trim() }));
      setEditing(null);
      setError('');
    } catch (err) {
      setError(errText(err));
    }
  };

  const remove = (g: Godown) => {
    try {
      // Anything that names it counts: drafts, quotations, cancelled documents, untracked lines,
      // recurring templates and the default-godown setting too.
      const refs = liveGodownReferences(g.id);
      if (refs.length) throw new Error(`${g.name} is still used by ${refs.join(', ')}, so it cannot be deleted.`);
      godownsDb.remove(g.id, godownInUse(tracking, g.id) || transfersUse.has(g.id));
      onChanged(invT('godownDeleted', { name: g.name }));
      setError('');
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={invT('godowns')}
      subtitle={invT('godownsSub')}
      footer={<button type="button" className={controls.btnOutline} onClick={onClose}>{invT('done')}</button>}
    >
      <div className={styles.form}>
        <table className={surface.table}>
          <thead><tr><th>{invT('thName')}</th><th>{invT('thAddress')}</th><th><span className={surface.srOnly}>{invT('thActions')}</span></th></tr></thead>
          <tbody>
            {tree.map(({ node, depth }) => ({ g: godowns.find((x) => x.id === node.id) ?? { id: node.id, name: node.name }, depth })).map(({ g, depth }) => (
              <tr key={g.id}>
                <td><span className={depthClass(depth)}>{g.name}</span>{g.id === MAIN_GODOWN_ID && <span className={styles.muted}>{invT('defaultTag')}</span>}{g.kind && <span className={styles.muted}> · {g.kind === 'transit' ? replT('transit') : skT(g.kind === 'van' ? 'kindVan' : 'kindExpiry')}</span>}</td>
                <td className={styles.muted}>{g.address || '—'}</td>
                <td>
                  <span className={surface.rowActions}>
                    <button type="button" className={controls.btnIcon} aria-label={invT('rename', { name: g.name })} onClick={() => setEditing({ id: g.id, name: g.name, address: g.address ?? '', parent_id: g.parent_id ?? '', kind: g.kind ?? '', replenish_from: g.replenish_from ?? getTable<Godown>('godowns').find((x) => x.id === g.id)?.replenish_from ?? '', cost_centre_id: g.cost_centre_id ?? getTable<Godown>('godowns').find((x) => x.id === g.id)?.cost_centre_id })}>
                      <Edit3 size={16} />
                    </button>
                    {g.id !== MAIN_GODOWN_ID && (
                      <button type="button" className={controls.btnDanger} aria-label={invT('deleteNamed', { name: g.name })} onClick={() => remove(g)}>
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
                <label className={controls.label} htmlFor="gd-name">{invT('godownName')}</label>
                <input id="gd-name" className={controls.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="gd-addr">{invT('addressOptional')}</label>
                <input id="gd-addr" className={controls.input} value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              </div>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="gd-parent">{imT('godownParent')}</label>
              <select id="gd-parent" className={controls.select} value={editing.parent_id} onChange={(e) => setEditing({ ...editing, parent_id: e.target.value })}>
                <option value="">{imT('topLevel')}</option>
                {tree.filter((r) => !blocked.has(r.node.id)).map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="gd-kind">{skT('godownKind')}</label>
              <select id="gd-kind" className={controls.select} value={editing.kind ?? ''} onChange={(e) => setEditing({ ...editing, kind: e.target.value as Godown['kind'] | '' })} disabled={editing.id === MAIN_GODOWN_ID}>
                <option value="">{skT('kindNormal')}</option>
                <option value="van">{skT('kindVan')}</option>
                <option value="expiry">{skT('kindExpiry')}</option>
              </select>
            </div>
            {editing.kind !== 'transit' && (
              <div className={controls.field}>
                <label className={controls.label} htmlFor="gd-replenish">{replT('label')}</label>
                <select id="gd-replenish" className={controls.select} value={editing.replenish_from ?? ''} onChange={(e) => setEditing({ ...editing, replenish_from: e.target.value })}>
                  <option value="">{replT('none')}</option>
                  {godowns.filter((x) => x.id !== editing.id && !x.kind).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <span className={controls.hint}>{replT('hint')}</span>
              </div>
            )}
            <CostCentreSelect id="gd-cc" label={ccT('label')} hint={ccT('hint')} centres={centres} value={editing.cost_centre_id} onChange={(cost_centre_id) => setEditing({ ...editing, cost_centre_id })} />
            <div className={surface.pageActions}>
              <button type="button" className={controls.btnOutline} onClick={() => { setEditing(null); setError(''); }}>{invT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary}>{editing.id ? invT('save') : invT('addGodown')}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ name: '', address: '', parent_id: '' })}>
            <Plus size={14} aria-hidden="true" /> {invT('addGodown')}
          </button>
        )}
        {error && <span className={controls.error} role="alert">{error}</span>}
      </div>
    </Modal>
  );
}
