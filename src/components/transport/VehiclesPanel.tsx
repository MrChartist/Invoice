/** R5-B3: vehicle master — own / hired, documents with expiry, mileage range; a hired lorry's owner and 194C(6). */
import { useMemo, useState } from 'react';
import { Car, Plus } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { Vehicle, VehicleDocKind } from '../../types/transport-works-r5';
import { VEHICLE_DOC_KINDS, docAlerts, loadVehicles, removeVehicle, saveVehicle } from '../../lib/transport/vehicles';
import { vendorsDb } from '../../lib/vendors';
import { B, errText, today, type PanelProps } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './transport.module.css';

const blank = () => ({ id: '', reg: '', own: true, type: '', cap: '', owner: '', min: '', max: '', docs: {} as Partial<Record<VehicleDocKind, string>>, declOn: '', declN: '', declPan: '' });

export function VehiclesPanel({ notify, refresh, tick }: PanelProps) {
  const vehicles = useMemo(() => loadVehicles(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendors = useMemo(() => vendorsDb.all().sort((a, b) => a.name.localeCompare(b.name)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const alerts = docAlerts(vehicles, today());
  const [f, setF] = useState<ReturnType<typeof blank> | null>(null);
  const open = (v?: Vehicle) => {
    const owner = vendors.find((x) => x.id === v?.owner_id);
    setF(v ? {
      id: v.id, reg: v.reg_no, own: v.own, type: v.type ?? '', cap: String(v.capacity_kg ?? ''), owner: v.owner_id ?? '',
      min: String(v.km_per_litre?.min ?? ''), max: String(v.km_per_litre?.max ?? ''), docs: Object.fromEntries(v.docs.map((d) => [d.kind, d.expires_on])),
      declOn: owner?.transporter_194c6?.declared_on ?? '', declN: String(owner?.transporter_194c6?.vehicles_owned ?? ''), declPan: owner?.transporter_194c6?.pan ?? owner?.pan ?? '',
    } : blank());
  };
  const save = () => {
    if (!f) return;
    try {
      saveVehicle({
        id: f.id || undefined, reg_no: f.reg, own: f.own, type: f.type || undefined, capacity_kg: Number(f.cap) || undefined,
        ...(f.own ? {} : { owner_id: f.owner || undefined }),
        docs: Object.entries(f.docs).filter(([, d]) => d).map(([kind, d]) => ({ kind: kind as VehicleDocKind, expires_on: d! })),
        ...(Number(f.min) > 0 ? { km_per_litre: { min: Number(f.min), max: Number(f.max) || Number(f.min) } } : {}),
      });
      const owner = vendors.find((x) => x.id === f.owner);
      if (!f.own && owner && f.declOn) vendorsDb.save({ ...owner, transporter_194c6: { declared_on: f.declOn, vehicles_owned: Number(f.declN) || 0, pan: f.declPan.trim().toUpperCase() } });
      notify(twT('vehicleSaved'));
      setF(null);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const del = (id: string) => {
    try {
      removeVehicle(id);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const txt = (k: 'reg' | 'type' | 'cap' | 'min' | 'max' | 'declOn' | 'declN' | 'declPan', label: string, type = 'text') => f && (
    <F l={label}><input className={controls.input} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-veh-field={k} /></F>
  );
  return (
    <div className={styles.stack}>
      {alerts.length > 0 && <ul className={styles.warn}>{alerts.map((a) => <li key={`${a.vehicle.id}${a.doc.kind}`}>{a.vehicle.reg_no}: {twT(`doc.${a.doc.kind}`)} {a.expired ? twT('expired') : twT('expires')} {a.doc.expires_on}</li>)}</ul>}
      {f ? (
        <div className={styles.box}>
          <div className={styles.grid}>
            {txt('reg', twT('regNo'))}
            <label className={controls.check}><input type="checkbox" checked={f.own} onChange={(e) => setF({ ...f, own: e.target.checked })} /> {twT('ownVehicle')}</label>
            {txt('type', twT('vehicleType'))}{txt('cap', twT('capacityKg'), 'number')}
            {txt('min', twT('kmplMin'), 'number')}{txt('max', twT('kmplMax'), 'number')}
            {!f.own && (
              <F l={twT('owner')}>
                <select className={controls.select} value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })}><option value="">—</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></F>
            )}
            {!f.own && f.owner && <>{txt('declOn', twT('decl194c6On'), 'date')}{txt('declN', twT('declVehicles'), 'number')}{txt('declPan', 'PAN')}</>}
            {VEHICLE_DOC_KINDS.map((k) => (
              <label key={k} className={controls.field}><span className={controls.label}>{twT(`doc.${k}`)}</span><input className={controls.input} type="date" value={f.docs[k] ?? ''} onChange={(e) => setF({ ...f, docs: { ...f.docs, [k]: e.target.value } })} /></label>
            ))}
          </div>
          {!f.own && <p className={styles.note}>{twT('decl194c6Hint')}</p>}
          <div className={styles.toolbar}>
            <button type="button" className={B.p} onClick={save} data-veh-save>{twT('save')}</button>
            <button type="button" className={B.g} onClick={() => setF(null)}>{twT('cancel')}</button>
          </div>
        </div>
      ) : (
        <div className={styles.toolbar}><button type="button" className={B.p} onClick={() => open()} data-veh-new><Plus size={16} aria-hidden="true" /> {twT('vehicleNew')}</button></div>
      )}
      {vehicles.length === 0 ? <p className={styles.note}><Car size={14} aria-hidden="true" /> {twT('vehicleEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{twT('regNo')}</th><th>{twT('vehicleType')}</th><th>{twT('ownVehicle')}</th><th>{twT('nextExpiry')}</th><th /></tr></thead>
            <tbody>
              {vehicles.map((v) => {
                const next = [...v.docs].sort((a, b) => a.expires_on.localeCompare(b.expires_on))[0];
                return (
                  <tr key={v.id}>
                    <td className={surface.mono}>{v.reg_no}</td><td>{v.type ?? '—'}</td><td>{v.own ? twT('yes') : vendors.find((x) => x.id === v.owner_id)?.name ?? twT('hired')}</td>
                    <td>{next ? `${twT(`doc.${next.kind}`)} ${next.expires_on}` : '—'}</td>
                    <td className={surface.rowActions}>
                      <button type="button" className={B.gs} onClick={() => open(v)}>{twT('edit')}</button>
                      <button type="button" className={B.gs} onClick={() => del(v.id)}>{twT('remove')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
