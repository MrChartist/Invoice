import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import type { UnitMaster } from '../../lib/units';
import type { TreeRow } from '../../lib/stock-groups';
import { imT } from '../../i18n/areas/inventory-masters';
import controls from '../../styles/controls.module.css';
import styles from './masters.module.css';
import inv from './inventory.module.css';

export interface MastersDraft {
  group_id: string;
  category_id: string;
  alt: { unit: string; factor: string }[];
  costs: { from: string; rate: string }[];
  prices: { from: string; rate: string }[];
}

/** Item form section (WP-8): stock group / category, alternate units, standard cost and selling price lists. */
export function MastersFields({ draft, onChange, baseUnit, trackStock, serialItem, units, compounds, groups, categories }: {
  draft: MastersDraft;
  onChange: (next: MastersDraft) => void;
  baseUnit: string;
  trackStock: boolean;
  serialItem: boolean;
  units: string[];
  compounds: UnitMaster[];
  groups: TreeRow[];
  categories: TreeRow[];
}) {
  const uid = useId();
  const set = <K extends keyof MastersDraft>(k: K, v: MastersDraft[K]) => onChange({ ...draft, [k]: v });
  // A compound unit whose second unit is this item's base unit is a ready-made alternate ("1 BOX = 12 NOS").
  const presets = compounds.filter((c) => (c.second ?? '').toUpperCase() === baseUnit.toUpperCase());

  const priceRows = (k: 'costs' | 'prices', label: string) => (
    <div className={styles.rows}>
      <span className={controls.label}>{label}</span>
      {draft[k].map((e, i) => (
        <div key={i} className={styles.pairRow}>
          <input type="date" className={controls.input} value={e.from} aria-label={`${label} · ${imT('from')}`}
            onChange={(ev) => set(k, draft[k].map((x, j) => (j === i ? { ...x, from: ev.target.value } : x)))} />
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={e.rate} placeholder={imT('rate')} aria-label={`${label} · ${imT('rate')}`}
            onChange={(ev) => set(k, draft[k].map((x, j) => (j === i ? { ...x, rate: ev.target.value } : x)))} />
          <button type="button" className={controls.btnIcon} aria-label={imT('removeRow')} onClick={() => set(k, draft[k].filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => set(k, [...draft[k], { from: '', rate: '' }])}>
        <Plus size={14} aria-hidden="true" /> {imT('addPrice')}
      </button>
    </div>
  );

  return (
    <>
      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-grp`}>{imT('group')}</label>
          <select id={`${uid}-grp`} className={controls.select} value={draft.group_id} onChange={(e) => set('group_id', e.target.value)}>
            <option value="">{imT('primary')}</option>
            {groups.map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor={`${uid}-cat`}>{imT('category')}</label>
          <select id={`${uid}-cat`} className={controls.select} value={draft.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">{imT('notCategorised')}</option>
            {categories.map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
          </select>
        </div>
      </div>

      {trackStock && (
        <>
          <p className={inv.sectionLabel}>{imT('altUnits')}</p>
          {serialItem ? <p className={styles.muted}>{imT('altSerialNote')}</p> : (
            <div className={styles.rows}>
              <p className={styles.muted}>{imT('altHint', { unit: baseUnit })}</p>
              {draft.alt.map((a, i) => (
                <div key={i} className={styles.pairRow}>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor={`${uid}-au${i}`}>{imT('altUnit')}</label>
                    <select id={`${uid}-au${i}`} className={controls.select} value={a.unit} onChange={(e) => set('alt', draft.alt.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}>
                      <option value="" />
                      {[...new Set([...units, a.unit].filter(Boolean))].filter((u) => u.toUpperCase() !== baseUnit.toUpperCase()).map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor={`${uid}-af${i}`}>{imT('altFactor', { unit: baseUnit })}</label>
                    <input id={`${uid}-af${i}`} className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={a.factor} onChange={(e) => set('alt', draft.alt.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} />
                  </div>
                  <button type="button" className={controls.btnIcon} aria-label={imT('removeRow')} onClick={() => set('alt', draft.alt.filter((_, j) => j !== i))}><X size={14} /></button>
                </div>
              ))}
              <div className={styles.toolbar}>
                <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set('alt', [...draft.alt, { unit: '', factor: '' }])}>
                  <Plus size={14} aria-hidden="true" /> {imT('addAlt')}
                </button>
                {presets.length > 0 && (
                  <select className={controls.select} value="" aria-label={imT('fromCompound')}
                    onChange={(e) => {
                      const c = presets.find((x) => x.id === e.target.value);
                      if (c?.first) set('alt', [...draft.alt.filter((x) => x.unit.toUpperCase() !== c.first?.toUpperCase()), { unit: c.first, factor: String(c.factor ?? '') }]);
                    }}>
                    <option value="">{imT('fromCompound')}</option>
                    {presets.map((c) => <option key={c.id} value={c.id}>{imT('compoundRow', { first: c.first ?? '', factor: c.factor ?? 0, second: c.second ?? '' })}</option>)}
                  </select>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <p className={inv.sectionLabel}>{imT('priceLists')}</p>
      <p className={styles.muted}>{imT('priceHint')}</p>
      <div className={controls.row}>
        {priceRows('costs', imT('standardCost'))}
        {priceRows('prices', imT('sellingPrice'))}
      </div>
    </>
  );
}
