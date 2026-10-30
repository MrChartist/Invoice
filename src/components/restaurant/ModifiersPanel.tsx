import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import type { InvoiceItem } from '../../types/invoice';
import type { ModifierGroup } from '../../types/restaurant';
import { generateId } from '../../lib/storage';
import { validateGroup } from '../../lib/restaurant/modifiers';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';
import { SelectField } from '../ui/SelectField';

export interface ModifiersPanelProps {
  groups: readonly ModifierGroup[];
  catalog: readonly InvoiceItem[];
  stockGroups: readonly { id: string; name: string }[];
  onSave: (rows: ModifierGroup[]) => void;
}

const blank = (): ModifierGroup => ({ id: generateId(), name: '', min: 0, max: 1, options: [{ id: generateId(), name: '', price: 0 }], item_ids: [], group_ids: [] });

/** Settings → Tables → Modifiers (R3-A4): groups, min / max, options, what they apply to. */
export function ModifiersPanel({ groups, catalog, stockGroups, onSave }: ModifiersPanelProps) {
  useT();
  const [rows, setRows] = useState<ModifierGroup[]>(() => groups.map((g) => ({ ...g, options: [...g.options] })));
  const [error, setError] = useState('');
  const patch = (id: string, fn: (g: ModifierGroup) => ModifierGroup) => setRows((r) => r.map((g) => (g.id === id ? fn(g) : g)));
  const toggleIn = (list: string[] | undefined, id: string) => (list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id]);
  const save = () => {
    for (const g of rows) {
      const e = validateGroup(g);
      if (e.length) return setError(`${g.name || '-'}: ${e[0]}`);
    }
    setError('');
    onSave(rows);
  };
  return (
    <div className={styles.settingsGrid}>
      {rows.map((g) => (
        <div key={g.id} className={styles.groupCard} data-mod-group={g.name}>
          <div className={styles.editRow}>
            <label className={controls.field}><span className={controls.label}>{rT('modName')}</span><input className={controls.input} value={g.name} onChange={(e) => patch(g.id, (x) => ({ ...x, name: e.target.value }))} /></label>
            <label className={cn(controls.field, styles.narrow)}><span className={controls.label}>{rT('modMin')}</span><NumberInput className={controls.input} value={g.min} blankZero={false} onChange={(v) => patch(g.id, (x) => ({ ...x, min: Math.max(Math.floor(v), 0) }))} /></label>
            <label className={cn(controls.field, styles.narrow)}><span className={controls.label}>{rT('modMax')}</span><NumberInput className={controls.input} value={g.max} blankZero={false} onChange={(v) => patch(g.id, (x) => ({ ...x, max: Math.max(Math.floor(v), 0) }))} /></label>
            <button type="button" className={controls.btnDanger} onClick={() => setRows((r) => r.filter((x) => x.id !== g.id))} aria-label={rT('deleteGroup')}><Trash2 size={14} /></button>
          </div>
          {g.options.map((o) => (
            <div key={o.id} className={styles.editRow}>
              <label className={controls.field}><span className={controls.label}>{rT('optName')}</span><input className={controls.input} value={o.name} onChange={(e) => patch(g.id, (x) => ({ ...x, options: x.options.map((y) => (y.id === o.id ? { ...y, name: e.target.value } : y)) }))} /></label>
              <label className={cn(controls.field, styles.narrow)}><span className={controls.label}>{rT('optPrice')}</span><NumberInput className={controls.input} value={o.price} onChange={(v) => patch(g.id, (x) => ({ ...x, options: x.options.map((y) => (y.id === o.id ? { ...y, price: Math.max(v, 0) } : y)) }))} /></label>
              <label className={controls.field}>
                <span className={controls.label}>{rT('optItem')}</span>
                <SelectField className={controls.select} value={o.item_id ?? ''} onChange={(e) => patch(g.id, (x) => ({ ...x, options: x.options.map((y) => (y.id === o.id ? { ...y, item_id: e.target.value || undefined } : y)) }))}>
                  <option value="">{rT('none')}</option>
                  {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectField>
              </label>
              <button type="button" className={controls.btnIcon} onClick={() => patch(g.id, (x) => ({ ...x, options: x.options.filter((y) => y.id !== o.id) }))} aria-label={rT('cancel')}><Trash2 size={14} /></button>
            </div>
          ))}
          <div><button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => patch(g.id, (x) => ({ ...x, options: [...x.options, { id: generateId(), name: '', price: 0 }] }))}><Plus size={14} /> {rT('addOption')}</button></div>
          <span className={controls.label}>{rT('appliesItems')}</span>
          <div className={styles.checks}>
            {catalog.map((c) => (
              <label key={c.id} className={controls.check}><input type="checkbox" checked={!!g.item_ids?.includes(c.id)} onChange={() => patch(g.id, (x) => ({ ...x, item_ids: toggleIn(x.item_ids, c.id) }))} /> {c.name}</label>
            ))}
          </div>
          {stockGroups.length > 0 && (
            <>
              <span className={controls.label}>{rT('appliesGroups')}</span>
              <div className={styles.checks}>
                {stockGroups.map((s) => (
                  <label key={s.id} className={controls.check}><input type="checkbox" checked={!!g.group_ids?.includes(s.id)} onChange={() => patch(g.id, (x) => ({ ...x, group_ids: toggleIn(x.group_ids, s.id) }))} /> {s.name}</label>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
      <div className={styles.actions}>
        <button type="button" className={controls.btnOutline} onClick={() => setRows((r) => [...r, blank()])}><Plus size={16} /> {rT('addGroup')}</button>
        <button type="button" className={controls.btnPrimary} onClick={save}>{rT('save')}</button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
