/** R5-B3: trip sheets with their P&L (per trip, per vehicle, per month); "New trip" and the open trip sheet. */
import { useMemo, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import { loadTrips, saveTrip } from '../../lib/transport/trips';
import { loadVehicles } from '../../lib/transport/vehicles';
import { effectiveStatus, loadLrs } from '../../lib/transport/consignment-notes';
import { rollup, tripPnl } from '../../lib/transport/trip-pnl';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { TripSheet } from './TripSheet';
import { B, csvDownload, errText, fmtMoney, today, type PanelProps } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './transport.module.css';

export function TripsPanel({ notify, refresh, tick }: PanelProps) {
  const trips = useMemo(() => [...loadTrips()].sort((a, b) => b.start_date.localeCompare(a.start_date)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const vehicles = useMemo(() => loadVehicles(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const lrs = useMemo(() => loadLrs(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pnl = useMemo(() => tripPnl({ trips, vehicles, lrs, invoices, purchases: peekTable('purchases') }), [trips, vehicles, lrs, invoices]);
  const [by, setBy] = useState<'trip' | 'vehicle' | 'month'>('trip');
  const [open, setOpen] = useState('');
  const [f, setF] = useState<{ vehicle: string; driver: string; start: string; km: string; route: string; lrs: string[] } | null>(null);
  const free = lrs.filter((l) => !l.trip_id && effectiveStatus(l, invoices) === 'booked');
  const create = () => {
    if (!f) return;
    try {
      const t = saveTrip({ vehicle_id: f.vehicle, driver: f.driver, start_date: f.start, start_km: f.km ? Number(f.km) : undefined, route: f.route, lr_ids: f.lrs });
      notify(twT('tripSaved', { no: t.number }));
      setF(null);
      setOpen(t.id);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const trip = trips.find((t) => t.id === open);
  if (trip) return <TripSheet trip={trip} pnl={pnl.find((p) => p.trip.id === trip.id)} notify={notify} refresh={refresh} tick={tick} onBack={() => setOpen('')} />;
  const roll = by === 'trip' ? null : rollup(pnl, by);
  return (
    <div className={styles.stack}>
      {f ? (
        <div className={styles.box}>
          <div className={styles.grid}>
            <F l={twT('vehicle')}>
              <select className={controls.select} value={f.vehicle} onChange={(e) => setF({ ...f, vehicle: e.target.value })}><option value="">-</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_no}{v.own ? '' : ` (${twT('hired')})`}</option>)}</select></F>
            <F l={twT('driver')}><input className={controls.input} value={f.driver} onChange={(e) => setF({ ...f, driver: e.target.value })} /></F>
            <F l={twT('startDate')}><input className={controls.input} type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></F>
            <F l={twT('startKm')}><input className={controls.input} type="number" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></F>
            <F l={twT('route')}><input className={controls.input} value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })} /></F>
          </div>
          {free.length > 0 && <fieldset className={styles.toolbar}><legend>{twT('lrsCarried')}</legend>{free.map((l) => (
            <label key={l.id} className={controls.check}><input type="checkbox" checked={f.lrs.includes(l.id)} onChange={(e) => setF({ ...f, lrs: e.target.checked ? [...f.lrs, l.id] : f.lrs.filter((x) => x !== l.id) })} /> {l.number}</label>
          ))}</fieldset>}
          <div className={styles.toolbar}>
            <button type="button" className={B.p} onClick={create}>{twT('save')}</button>
            <button type="button" className={B.g} onClick={() => setF(null)}>{twT('cancel')}</button>
          </div>
        </div>
      ) : (
        <div className={styles.toolbar}>
          <button type="button" className={B.p} onClick={() => setF({ vehicle: vehicles[0]?.id ?? '', driver: '', start: today(), km: '', route: '', lrs: [] })} disabled={!vehicles.length}><Plus size={16} aria-hidden="true" /> {twT('tripNew')}</button>
          <div className={controls.segment} role="tablist">
            {(['trip', 'vehicle', 'month'] as const).map((b) => <button key={b} type="button" role="tab" aria-selected={by === b} className={by === b ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setBy(b)}>{twT(`by.${b}`)}</button>)}
          </div>
          <button type="button" className={B.o} onClick={() => csvDownload(`trip_pnl_${today()}.csv`, [['Trip', 'Vehicle', 'Start', 'Freight', 'Expenses', 'Lorry hire', 'Margin', 'Km', 'Litres', 'Km/l'], ...pnl.map((p) => [p.trip.number, p.vehicle?.reg_no ?? '', p.trip.start_date, p.freight, p.expenses, p.hire, p.margin, p.km, p.litres, p.kmpl ?? ''])])}>CSV</button>
        </div>
      )}
      {!vehicles.length && <p className={styles.note}>{twT('vehicleFirst')}</p>}
      {roll ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{twT(`by.${by}`)}</th><th className={surface.numeric}>{twT('trips')}</th><th className={surface.numeric}>{twT('freight')}</th><th className={surface.numeric}>{twT('expenses')}</th><th className={surface.numeric}>{twT('hire')}</th><th className={surface.numeric}>{twT('margin')}</th></tr></thead>
            <tbody>{roll.map((r) => <tr key={r.key}><td>{r.key}</td><td className={surface.numeric}>{r.trips}</td><td className={surface.numeric}>{fmtMoney(r.freight)}</td><td className={surface.numeric}>{fmtMoney(r.expenses)}</td><td className={surface.numeric}>{fmtMoney(r.hire)}</td><td className={surface.numeric}>{fmtMoney(r.margin)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : pnl.length === 0 ? <p className={styles.note}><MapPin size={14} aria-hidden="true" /> {twT('tripEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{twT('trip')}</th><th>{twT('vehicle')}</th><th>{twT('startDate')}</th><th>{twT('status')}</th><th className={surface.numeric}>{twT('freight')}</th><th className={surface.numeric}>{twT('expenses')}</th><th className={surface.numeric}>{twT('hire')}</th><th className={surface.numeric}>{twT('margin')}</th><th>{twT('kmpl')}</th></tr></thead>
            <tbody>
              {pnl.map((p) => (
                <tr key={p.trip.id}>
                  <td><button type="button" className={B.gs} onClick={() => setOpen(p.trip.id)}>{p.trip.number}</button></td>
                  <td>{p.vehicle?.reg_no ?? '-'}</td><td>{p.trip.start_date}</td><td>{twT(`ts.${p.trip.status}`)}</td>
                  <td className={surface.numeric}>{fmtMoney(p.freight)}</td><td className={surface.numeric}>{fmtMoney(p.expenses)}</td><td className={surface.numeric}>{fmtMoney(p.hire)}</td>
                  <td className={`${surface.numeric} ${p.margin < 0 ? styles.bad : styles.good}`}>{fmtMoney(p.margin)}</td>
                  <td className={p.mileageFlag ? styles.bad : undefined}>{p.kmpl ?? '-'}{p.mileageFlag ? ` (${twT(`mileage.${p.mileageFlag}`)})` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
