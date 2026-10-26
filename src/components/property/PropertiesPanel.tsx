/** R5-C5 properties and units (use: commercial / residential dwelling / other). */
import { useState } from 'react';
import type { Property, PropertyUnit } from '../../types/institutions-r5';
import { INDIAN_STATES } from '../../lib/india-states';
import { UNIT_USES, deleteProperty, saveProperty } from '../../lib/property/properties';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, S, T } from '../institutions/Views';
import { attempt, num, opts, type Notify } from '../institutions/ui';

type Draft = Omit<Property, 'id' | 'units'> & { id?: string; units: (Omit<PropertyUnit, 'id'> & { id?: string })[] };
const blank = (): Draft => ({ name: '', address: '', state: '', units: [{ name: '', use: 'commercial' }] });

export function PropertiesPanel({ props, notify, refresh }: { props: readonly Property[]; notify: Notify; refresh: () => void }) {
  const [p, setP] = useState<Draft>(blank);
  const unit = (i: number, x: Partial<PropertyUnit>) => setP({ ...p, units: p.units.map((u, k) => (k === i ? { ...u, ...x } : u)) });
  return (
    <div className={styles.stack}>
      {props.map((x) => (
        <div key={x.id} className={styles.line}>
          <strong>{x.name}</strong><span className={styles.note}>{x.units.map((u) => `${u.name} (${iT(`use.${u.use}`)})`).join(', ')}</span>
          <B sm l={iT('edit')} on={() => setP(x)} />
          <B g sm l={iT('remove')} on={() => attempt(notify, () => { deleteProperty(x.id); refresh(); })} />
        </div>
      ))}
      <div className={styles.toolbar}>
        <T l={iT('property')} v={p.name} on={(name) => setP({ ...p, name })} d="property-name" />
        <T l={iT('address')} v={p.address} on={(address) => setP({ ...p, address })} />
        <S l={iT('state')} v={p.state} o={[['', '—'], ...INDIAN_STATES.map((s) => [s.code, s.name] as const)]} on={(state) => setP({ ...p, state })} />
      </div>
      {p.units.map((u, i) => (
        <div key={i} className={styles.toolbar}>
          <T l={iT('unit')} v={u.name} on={(name) => unit(i, { name })} d="unit-name" />
          <T l={iT('area')} v={u.area} on={(v) => unit(i, { area: num(v) || undefined })} />
          <S l={iT('use')} v={u.use} o={opts(UNIT_USES, 'use.')} on={(v) => unit(i, { use: v as PropertyUnit['use'] })} />
        </div>
      ))}
      <div className={styles.line}>
        <B sm l={iT('addUnit')} on={() => setP({ ...p, units: [...p.units, { name: '', use: 'commercial' }] })} />
        <B p l={iT('save')} d="property-save" on={() => attempt(notify, () => { saveProperty(p); setP(blank()); refresh(); }, iT('saved'))} />
      </div>
    </div>
  );
}
