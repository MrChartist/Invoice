/** Settings → Items → Package types (R2-C4): saved box sizes and tare weights for packing lists. */
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { packageTypesDb } from '../../lib/packing';
import type { PackageType } from '../../types/books-r2';
import { useT } from '../../i18n';
import { pkT } from '../../i18n/areas/dispatch-r2';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './dispatch.module.css';

type Notify = (msg: string, tone?: 'success' | 'error' | 'info') => void;
const BLANK = { name: '', length_cm: 0, breadth_cm: 0, height_cm: 0, tare_kg: 0 };

export function PackageTypesPanel({ notify }: { notify: Notify }) {
  useT();
  const [types, setTypes] = useState<PackageType[]>(() => packageTypesDb.all());
  const [draft, setDraft] = useState(BLANK);
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const add = () => {
    try {
      const row = packageTypesDb.save(draft);
      setTypes(packageTypesDb.all());
      setDraft(BLANK);
      notify(pkT('typeSaved', { name: row.name }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const remove = (t: PackageType) => {
    try {
      packageTypesDb.remove(t.id);
      setTypes(packageTypesDb.all());
      notify(pkT('typeRemoved', { name: t.name }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className={styles.stack} data-package-types>
      <p className={controls.hint}>{pkT('typesHint')}</p>
      {types.length === 0 ? (
        <p className={styles.muted}>{pkT('noTypes')}</p>
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th scope="col">{pkT('typeName')}</th>
                <th scope="col" className={surface.numeric}>{pkT('length')}</th>
                <th scope="col" className={surface.numeric}>{pkT('breadth')}</th>
                <th scope="col" className={surface.numeric}>{pkT('height')}</th>
                <th scope="col" className={surface.numeric}>{pkT('tare')}</th>
                <th scope="col"><span className={surface.srOnly}>{pkT('delete')}</span></th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className={surface.numeric}>{t.length_cm}</td>
                  <td className={surface.numeric}>{t.breadth_cm}</td>
                  <td className={surface.numeric}>{t.height_cm}</td>
                  <td className={surface.numeric}>{t.tare_kg}</td>
                  <td>
                    <button type="button" className={controls.btnIcon} aria-label={`${pkT('delete')} ${t.name}`} onClick={() => remove(t)}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.row}>
        <label className={controls.field}>
          <span className={controls.label}>{pkT('typeName')}</span>
          <input className={controls.input} value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        {(['length_cm', 'breadth_cm', 'height_cm', 'tare_kg'] as const).map((k) => (
          <label key={k} className={controls.field}>
            <span className={controls.label}>{pkT(k === 'length_cm' ? 'length' : k === 'breadth_cm' ? 'breadth' : k === 'height_cm' ? 'height' : 'tare')}</span>
            <input className={`${controls.input} ${styles.num}`} inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: num(e.target.value) })} />
          </label>
        ))}
        <button type="button" className={controls.btnPrimary} onClick={add} disabled={!draft.name.trim()}>
          <Plus size={14} aria-hidden /> {pkT('addType')}
        </button>
      </div>
    </div>
  );
}

export default PackageTypesPanel;
