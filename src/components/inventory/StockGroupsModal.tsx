import { useMemo, useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  descendantIds, itemsUnder, stockCategoriesDb, stockGroupsDb, treeRows, type StockTreeNode, type TreeKind,
} from '../../lib/stock-groups';
import type { StockItem } from '../../lib/inventory';
import { useT } from '../../i18n';
import { imT } from '../../i18n/areas/inventory-masters';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';
import { depthClass } from './tree-indent';

/** Stock groups and stock categories (WP-8): two nested trees, add / rename / move / delete. */
export function StockGroupsModal({ open, items, onClose, onChanged }: {
  open: boolean;
  items: StockItem[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  const [kind, setKind] = useState<TreeKind>('group');
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<{ id?: string; name: string; parent_id: string } | null>(null);
  const [error, setError] = useState('');
  const db = kind === 'group' ? stockGroupsDb : stockCategoriesDb;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => db.all(), [db, version, open]);
  const rows = useMemo(() => treeRows(list), [list]);
  const blocked = editing?.id ? descendantIds(editing.id, list) : new Set<string>();

  const switchKind = (k: TreeKind) => {
    setKind(k);
    setEditing(null);
    setError('');
  };

  const save = () => {
    if (!editing) return;
    try {
      db.save({ id: editing.id, name: editing.name, parent_id: editing.parent_id || undefined });
      setEditing(null);
      setError('');
      setVersion((v) => v + 1);
      onChanged(imT('saved'));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = (n: StockTreeNode) => {
    try {
      db.remove(n.id, items);
      setError('');
      setVersion((v) => v + 1);
      onChanged(imT('deleted', { name: n.name }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={imT('groupsTitle')}
      subtitle={imT('groupsSub')}
      footer={<button type="button" className={controls.btnOutline} onClick={onClose}>{imT('done')}</button>}
    >
      <div className={styles.rows}>
        <div className={controls.segment} role="tablist" aria-label={imT('groupsTitle')}>
          {(['group', 'category'] as TreeKind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => switchKind(k)}>
              {k === 'group' ? imT('tabGroups') : imT('tabCategories')}
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className={styles.muted}>{kind === 'group' ? imT('noGroups') : imT('noCategories')}</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{imT('thName')}</th><th className={surface.numeric}>{imT('thItems')}</th><th><span className={surface.srOnly}>{imT('thActions')}</span></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.node.id}>
                    <td><span className={depthClass(r.depth)}>{r.node.name}</span></td>
                    <td className={surface.numeric}>{itemsUnder(r.node.id, list, items, kind).length}</td>
                    <td>
                      <span className={surface.rowActions}>
                        <button type="button" className={controls.btnIcon} aria-label={imT('edit', { name: r.node.name })} onClick={() => setEditing({ id: r.node.id, name: r.node.name, parent_id: r.node.parent_id ?? '' })}>
                          <Edit3 size={16} />
                        </button>
                        <button type="button" className={controls.btnDanger} aria-label={imT('remove', { name: r.node.name })} onClick={() => remove(r.node)}>
                          <Trash2 size={16} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editing ? (
          <form className={styles.rows} onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sg-name">{imT('name')}</label>
                <input id="sg-name" className={controls.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="sg-parent">{imT('under')}</label>
                <select id="sg-parent" className={controls.select} value={editing.parent_id} onChange={(e) => setEditing({ ...editing, parent_id: e.target.value })}>
                  <option value="">{kind === 'group' ? imT('primary') : imT('notCategorised')}</option>
                  {rows.filter((r) => !blocked.has(r.node.id)).map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
                </select>
              </div>
            </div>
            <div className={surface.pageActions}>
              <button type="button" className={controls.btnOutline} onClick={() => { setEditing(null); setError(''); }}>{imT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary}>{imT('save')}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => setEditing({ name: '', parent_id: '' })}>
            <Plus size={14} aria-hidden="true" /> {kind === 'group' ? imT('addGroup') : imT('addCategory')}
          </button>
        )}
        {error && <span className={controls.error} role="alert">{error}</span>}
      </div>
    </Modal>
  );
}
