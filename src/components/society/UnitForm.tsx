/**
 * R18-A2 unit form: wing, code (suggested from the wing), use, carpet / super area, undivided %, construction cost; the
 * owner (a client: picked by name from the list, or created with the typed name and phone), occupancy and tenant
 * (recorded, never billed); the number of parking slots; the unit's own amounts for `typed` heads (property tax as
 * assessed). Saving writes the unit and re-links its members (`Client.hs`).
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { hsList, hsT } from '../../i18n/areas/society-r18a';
import type { Client } from '../../types/invoice';
import type { HsHead, HsOccupancy, HsUnitUse, SocietyUnit } from '../../types/society-r18';
import { OCCUPANCIES, suggestCode, UNIT_USES, validateUnit } from '../../lib/society/hs-units';
import { addMember, deleteUnit, saveUnit } from '../../lib/society/hs-units-save';
import controls from '../../styles/controls.module.css';
import { Field as F, type Notify } from './hs-ui';
import { numIn, row } from './hs-form';

type Draft = Omit<SocietyUnit, 'id' | 'updated_at'>;

export default function UnitForm({ unit, units, clients, heads, notify, onDone }: { unit?: SocietyUnit; units: readonly SocietyUnit[]; clients: readonly Client[]; heads: readonly HsHead[]; notify: Notify; onDone: () => void }) {
  useT();
  const nameOf = (id?: string) => clients.find((c) => c.id === id);
  const [u, setU] = useState<Draft>(() => unit ?? { code: suggestCode(units), use: 'residential', occupancy: 'owner', parking: [], status: 'active' });
  const [owner, setOwner] = useState(nameOf(unit?.owner_id)?.name ?? '');
  const [tenant, setTenant] = useState(nameOf(unit?.tenant_id)?.name ?? '');
  const set = (p: Partial<Draft>) => setU((x) => ({ ...x, ...p }));
  const run = (fn: () => void) => { try { fn(); notify(hsT('saved')); onDone(); } catch (e) { notify((e as Error).message, 'error'); } };
  const save = () => run(() => {
    const err = validateUnit({ ...u, id: unit?.id ?? '' }, units); // before a member is created
    if (err) throw new Error(err);
    saveUnit({ ...u, id: unit?.id, owner_id: owner.trim() ? addMember(owner) : undefined, tenant_id: u.occupancy === 'tenant' && tenant.trim() ? addMember(tenant) : undefined });
  });
  const num = (k: 'carpet_area' | 'super_area' | 'undivided_pct' | 'construction_cost', label: string) => (
    <F label={label}><input type="number" min={0} step="any" className={controls.input} value={u[k] ?? ''} onChange={(e) => set({ [k]: numIn(e.target.value) })} /></F>
  );
  const slots = u.parking.length;
  return (
    <section data-hs-unit-form>
      <datalist id="hs-members">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <div style={row}>
        <F label={hsT('wing')}><input className={controls.input} value={u.wing ?? ''} onChange={(e) => set({ wing: e.target.value, ...(unit ? {} : { code: suggestCode(units, e.target.value) }) })} data-hs-unit-field="wing" /></F>
        <F label={hsT('code')}><input className={controls.input} value={u.code} onChange={(e) => set({ code: e.target.value })} data-hs-unit-field="code" /></F>
        <F label={hsT('use')}>
          <select className={controls.select} value={u.use} onChange={(e) => set({ use: e.target.value as HsUnitUse })}>
            {UNIT_USES.map((x) => <option key={x} value={x}>{hsList('uses', UNIT_USES, x)}</option>)}
          </select>
        </F>
        {num('carpet_area', hsT('carpet'))}
        {num('super_area', hsT('super'))}
        {num('undivided_pct', hsT('undivided'))}
        {num('construction_cost', hsT('cost'))}
        <F label={hsT('parking')}><input type="number" min={0} max={20} className={controls.input} value={slots} onChange={(e) => { const n = Math.min(20, Math.max(0, Math.floor(Number(e.target.value) || 0))); set({ parking: Array.from({ length: n }, (_, i) => u.parking[i] ?? { slot: `P${i + 1}`, kind: 'covered' }) }); }} data-hs-unit-field="parking" /></F>
      </div>
      <div style={row}>
        <F label={hsT('owner')}><input className={controls.input} list="hs-members" value={owner} onChange={(e) => setOwner(e.target.value)} data-hs-unit-field="owner" /></F>
        <F label={hsT('occupancy')}>
          <select className={controls.select} value={u.occupancy} onChange={(e) => set({ occupancy: e.target.value as HsOccupancy })} data-hs-unit-field="occupancy">
            {OCCUPANCIES.map((x) => <option key={x} value={x}>{hsList('occs', OCCUPANCIES, x)}</option>)}
          </select>
        </F>
        {u.occupancy === 'tenant' && <F label={hsT('tenant')}><input className={controls.input} list="hs-members" value={tenant} onChange={(e) => setTenant(e.target.value)} data-hs-unit-field="tenant" /></F>}
        {heads.some((h) => h.basis === 'per_inlet') && <F label={hsT('inlets')}><input type="number" min={0} max={50} className={controls.input} value={u.inlets ?? ''} onChange={(e) => set({ inlets: numIn(e.target.value) })} data-hs-unit-field="inlets" /></F>}
        {heads.some((h) => h.basis === 'per_lifted_unit') && <label className={controls.label}><input type="checkbox" checked={!!u.lifted} onChange={(e) => set({ lifted: e.target.checked || undefined })} data-hs-unit-field="lifted" /> {hsT('lifted')}</label>}
        <label className={controls.label}><input type="checkbox" checked={u.status === 'closed'} onChange={(e) => set({ status: e.target.checked ? 'closed' : 'active' })} data-hs-unit-field="closed" /> {hsT('closed')}</label>
        {heads.filter((h) => h.basis === 'typed' && h.active !== false).map((h) => (
          <F key={h.id} label={`${h.name} (${hsT('typed')})`}><input type="number" min={0} step="0.01" className={controls.input} value={u.typed?.[h.id] ?? ''} onChange={(e) => set({ typed: { ...u.typed, [h.id]: numIn(e.target.value) ?? 0 } })} data-hs-typed-head={h.kind} /></F>
        ))}
      </div>
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-hs-save-unit>{hsT('save')}</button>
        <button type="button" className={controls.btnGhost} onClick={onDone}>{hsT('cancel')}</button>
        {unit && <button type="button" className={controls.btnDanger} onClick={() => { if (!window.confirm(hsT('delAsk', { c: unit.code }))) return; try { deleteUnit(unit.id); notify(hsT('deleted')); onDone(); } catch (e) { notify((e as Error).message, 'error'); } }} data-hs-delete-unit>{hsT('del')}</button>}
      </div>
    </section>
  );
}
