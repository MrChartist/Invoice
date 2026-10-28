/**
 * R18-A2 unit form: code (suggested from the wing), wing, floor, use, carpet / super area, undivided %, construction
 * cost, inlets, lifted; the owner (a client; "New member" adds one), joint owners, occupancy and tenant (recorded, never
 * billed); parking slots; the unit's own amounts for `typed` heads (property tax as assessed). Saving writes the unit
 * and re-links its members (`Client.hs`).
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import type { Client } from '../../types/invoice';
import type { HsHead, HsOccupancy, HsSlotKind, HsUnitUse, SocietyUnit } from '../../types/society-r18';
import { OCCUPANCIES, SLOT_KINDS, suggestCode, UNIT_USES } from '../../lib/society/hs-units';
import { addMember, deleteUnit, saveUnit } from '../../lib/society/hs-units-save';
import controls from '../../styles/controls.module.css';
import { Field as F, numIn, row, type Notify } from './hs-ui';

type Draft = Omit<SocietyUnit, 'id' | 'updated_at'>;

export default function UnitForm({ unit, units, clients, heads, notify, onDone }: { unit?: SocietyUnit; units: readonly SocietyUnit[]; clients: readonly Client[]; heads: readonly HsHead[]; notify: Notify; onDone: () => void }) {
  useT();
  const [u, setU] = useState<Draft>(() => unit ?? { code: suggestCode(units), use: 'residential', occupancy: 'owner', parking: [], status: 'active' });
  const [people, setPeople] = useState<readonly Client[]>(clients);
  const [nm, setNm] = useState<{ for: 'owner' | 'tenant'; name: string; phone: string } | null>(null);
  const set = (p: Partial<Draft>) => setU((x) => ({ ...x, ...p }));
  const run = (fn: () => void) => { try { fn(); } catch (e) { notify((e as Error).message, 'error'); } };
  const save = () => run(() => { saveUnit({ ...u, id: unit?.id }); notify(hsT('saved')); onDone(); });
  const typedHeads = heads.filter((h) => h.basis === 'typed' && h.active !== false);
  const num = (k: 'carpet_area' | 'super_area' | 'undivided_pct' | 'construction_cost' | 'inlets', label: string) => (
    <F label={label}><input type="number" min={0} step="any" className={controls.input} value={u[k] ?? ''} onChange={(e) => set({ [k]: numIn(e.target.value) })} data-hs-unit-field={k} /></F>
  );
  const person = (k: 'owner_id' | 'tenant_id', label: string) => (
    <F label={label}>
      <select className={controls.select} value={u[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} data-hs-unit-field={k}>
        <option value="">{hsT('pick')}</option>
        {people.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
      </select>
    </F>
  );
  const addPerson = () => run(() => {
    if (!nm) return;
    const id = addMember(nm.name, nm.phone);
    setPeople([...people.filter((c) => c.id !== id), { id, name: nm.name.trim(), phone: nm.phone, email: '', address: '', city: '', zip: '' }]);
    set(nm.for === 'owner' ? { owner_id: id } : { tenant_id: id });
    setNm(null);
  });
  return (
    <section data-hs-unit-form>
      <div style={row}>
        <F label={hsT('wing')}><input className={controls.input} value={u.wing ?? ''} onChange={(e) => set({ wing: e.target.value, ...(unit ? {} : { code: suggestCode(units, e.target.value) }) })} data-hs-unit-field="wing" /></F>
        <F label={hsT('code')}><input className={controls.input} value={u.code} onChange={(e) => set({ code: e.target.value })} data-hs-unit-field="code" /></F>
        <F label={hsT('floor')}><input className={controls.input} value={u.floor ?? ''} onChange={(e) => set({ floor: e.target.value })} /></F>
        <F label={hsT('use')}>
          <select className={controls.select} value={u.use} onChange={(e) => set({ use: e.target.value as HsUnitUse })} data-hs-unit-field="use">
            {UNIT_USES.map((x) => <option key={x} value={x}>{hsList('uses', UNIT_USES, x)}</option>)}
          </select>
        </F>
        {num('carpet_area', hsT('carpet'))}
        {num('super_area', hsT('super'))}
        {num('undivided_pct', hsT('undivided'))}
        {num('construction_cost', hsT('cost'))}
        {num('inlets', hsT('inlets'))}
        <label className={controls.check}><input type="checkbox" checked={!!u.lifted} onChange={(e) => set({ lifted: e.target.checked })} /> {hsT('lifted')}</label>
      </div>
      <div style={row}>
        {person('owner_id', hsT('owner'))}
        <F label={hsT('occupancy')}>
          <select className={controls.select} value={u.occupancy} onChange={(e) => set({ occupancy: e.target.value as HsOccupancy })} data-hs-unit-field="occupancy">
            {OCCUPANCIES.map((x) => <option key={x} value={x}>{hsList('occs', OCCUPANCIES, x)}</option>)}
          </select>
        </F>
        {u.occupancy === 'tenant' && person('tenant_id', hsT('tenant'))}
        <button type="button" className={controls.btnOutline} onClick={() => setNm({ for: 'owner', name: '', phone: '' })} data-hs-new-member>{hsT('newMember')}</button>
      </div>
      {nm && (
        <fieldset style={row} data-hs-member-form>
          <F label={hsT('name')}><input className={controls.input} value={nm.name} onChange={(e) => setNm({ ...nm, name: e.target.value })} data-hs-member-name /></F>
          <F label={hsT('phone')}><input className={controls.input} value={nm.phone} onChange={(e) => setNm({ ...nm, phone: e.target.value })} data-hs-member-phone /></F>
          <F label={hsT('member')}>
            <select className={controls.select} value={nm.for} onChange={(e) => setNm({ ...nm, for: e.target.value as 'owner' | 'tenant' })}>
              <option value="owner">{hsT('owner')}</option>
              <option value="tenant">{hsT('tenant')}</option>
            </select>
          </F>
          <button type="button" className={controls.btnPrimary} disabled={!nm.name.trim()} onClick={addPerson} data-hs-add-member>{hsT('addMember')}</button>
        </fieldset>
      )}
      <fieldset style={row} data-hs-slots>
        <legend className={controls.label}>{hsT('parking')}</legend>
        {u.parking.map((s, i) => (
          <span key={i} style={{ display: 'inline-flex', gap: '0.25rem' }}>
            <input className={controls.input} aria-label={hsT('slot')} value={s.slot} onChange={(e) => set({ parking: u.parking.map((x, k) => (k === i ? { ...x, slot: e.target.value } : x)) })} style={{ width: '6rem' }} />
            <select className={controls.select} aria-label={hsT('parking')} value={s.kind} onChange={(e) => set({ parking: u.parking.map((x, k) => (k === i ? { ...x, kind: e.target.value as HsSlotKind } : x)) })}>
              {SLOT_KINDS.map((k) => <option key={k} value={k}>{hsList('slots', SLOT_KINDS, k)}</option>)}
            </select>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set({ parking: u.parking.filter((_, k) => k !== i) })}>{hsT('remove')}</button>
          </span>
        ))}
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => set({ parking: [...u.parking, { slot: `P${u.parking.length + 1}`, kind: 'covered' }] })} data-hs-add-slot>{hsT('addSlot')}</button>
      </fieldset>
      {typedHeads.length > 0 && (
        <fieldset style={row} data-hs-typed>
          <legend className={controls.label}>{hsT('typed')}</legend>
          {typedHeads.map((h) => (
            <F key={h.id} label={h.name}><input type="number" min={0} step="0.01" className={controls.input} value={u.typed?.[h.id] ?? ''} onChange={(e) => set({ typed: { ...(u.typed ?? {}), [h.id]: numIn(e.target.value) ?? 0 } })} data-hs-typed-head={h.kind} /></F>
          ))}
        </fieldset>
      )}
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-hs-save-unit>{hsT('save')}</button>
        {unit && <button type="button" className={controls.btnOutline} onClick={() => run(() => { deleteUnit(unit.id); notify(hsT('deleted')); onDone(); })}>{hsT('del')}</button>}
        <button type="button" className={controls.btnGhost} onClick={() => onDone()}>{hsT('cancel')}</button>
      </div>
    </section>
  );
}
