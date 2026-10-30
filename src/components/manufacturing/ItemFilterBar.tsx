import { useMemo } from 'react';
import { stockCategoriesDb, stockGroupsDb, treeRows } from '../../lib/stock-groups';
import type { ItemFilter } from '../../lib/stock-filters';
import { s7T } from '../../i18n/areas/inventory-7s';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';
import { SelectField } from '../ui/SelectField';

/** 7S (7.66): stock group / category filter for Reorder, Ageing and Movement. Renders nothing until a group or category exists. */
export function ItemFilterBar({ value, onChange, idPrefix }: { value: ItemFilter; onChange: (f: ItemFilter) => void; idPrefix: string }) {
  const groups = useMemo(() => stockGroupsDb.all(), []);
  const categories = useMemo(() => stockCategoriesDb.all(), []);
  if (!groups.length && !categories.length) return null;
  return (
    <div className={styles.filters}>
      {groups.length > 0 && (
        <SelectField id={`${idPrefix}-group`} className={controls.select} aria-label={s7T('groupFilter')} value={value.group} onChange={(e) => onChange({ ...value, group: e.target.value })}>
          <option value="">{s7T('allGroups')}</option>
          {treeRows(groups).map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
          <option value="-">{s7T('primary')}</option>
        </SelectField>
      )}
      {categories.length > 0 && (
        <SelectField id={`${idPrefix}-cat`} className={controls.select} aria-label={s7T('categoryFilter')} value={value.category} onChange={(e) => onChange({ ...value, category: e.target.value })}>
          <option value="">{s7T('allCategories')}</option>
          {treeRows(categories).map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
          <option value="-">{s7T('notCategorised')}</option>
        </SelectField>
      )}
    </div>
  );
}
