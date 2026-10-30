/** R5-B3: one trip sheet — LRs carried, expenses, driver advances, lorry hire (194C / 194C(6)), close and settle. */
import { useMemo, useState } from 'react';
import { ChevronLeft, HandCoins } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { Trip } from '../../types/transport-works-r5';
import type { TripPnl } from '../../lib/transport/trip-pnl';
import { TRIP_EXPENSE_KINDS, addTripExpense, closeTrip, giveDriverAdvance, recordLorryHire, reopenTrip, tripAdvances, tripExpenses } from '../../lib/transport/trips';
import { loadLrs } from '../../lib/transport/consignment-notes';
import { loadVehicles } from '../../lib/transport/vehicles';
import { purchasesDb } from '../../lib/purchases';
import { vendorsDb } from '../../lib/vendors';
import { sectionText } from '../../lib/ita2025';
import { B, errText, fmtMoney, today, type PanelProps } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import styles from './transport.module.css';

export function TripSheet({ trip, pnl, notify, refresh, tick, onBack }: PanelProps & { trip: Trip; pnl?: TripPnl; onBack: () => void }) {
  const lrs = useMemo(() => loadLrs().filter((l) => trip.lr_ids.includes(l.id)), [trip, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const vehicle = loadVehicles().find((v) => v.id === trip.vehicle_id);
  const expenses = tripExpenses(trip.id);
  const adv = tripAdvances(trip);
  const hire = trip.hire_bill_id ? purchasesDb.get(trip.hire_bill_id) : undefined;
  const [f, setF] = useState({ day: today(), kind: 'Diesel', amount: '', litres: '', adv: '', method: 'Cash', vendor: vehicle?.owner_id ?? '', hire: '', billNo: '', endKm: '', spent: '', returned: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const run = (fn: () => unknown, msg: string) => {
    try {
      fn();
      notify(msg);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const open = trip.status === 'open';
  const field = (k: keyof typeof f, label: string, type = 'number') => (
    <F l={label}><input className={controls.input} type={type} value={f[k]} onChange={set(k)} /></F>
  );
  const spentDefault = Math.min(expenses.reduce((s, e) => s + e.amount, 0), adv.given);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <button type="button" className={B.gs} onClick={onBack}><ChevronLeft size={14} aria-hidden="true" /> {twT('back')}</button>
        <strong>{trip.number} · {vehicle?.reg_no ?? '-'}{trip.driver ? ` · ${trip.driver}` : ''} · {twT(`ts.${trip.status}`)}</strong>
      </div>
      {pnl && <p className={styles.note}>{twT('freight')} {fmtMoney(pnl.freight)} − {twT('expenses')} {fmtMoney(pnl.expenses)} − {twT('hire')} {fmtMoney(pnl.hire)} = <strong className={pnl.margin < 0 ? styles.bad : styles.good}>{fmtMoney(pnl.margin)}</strong>{pnl.kmpl !== null ? ` · ${pnl.km} km / ${pnl.litres} l = ${pnl.kmpl} ${twT('kmpl')}` : ''}</p>}
      <p className={styles.note}>{twT('lrsCarried')}: {lrs.map((l) => l.number).join(', ') || '-'}</p>
      <section className={styles.box}>
        <h4>{twT('expenses')}</h4>
        <ul className={styles.note}>{expenses.map((e) => <li key={e.id}>{e.date} · {e.category} · {fmtMoney(e.amount)}</li>)}</ul>
        {open && (
          <div className={styles.lineRow}>
            {field('day', twT('date'), 'date')}
            <F l={twT('kind')}><select className={controls.select} value={f.kind} onChange={set('kind')}>{TRIP_EXPENSE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></F>
            {field('amount', twT('amount'))}{f.kind === 'Diesel' && field('litres', twT('litres'))}
            <button type="button" className={B.o} onClick={() => run(() => addTripExpense(trip.id, { date: f.day, kind: f.kind, amount: Number(f.amount), litres: Number(f.litres) || undefined }), twT('expenseAdded'))}>{twT('add')}</button>
          </div>
        )}
      </section>
      <section className={styles.box}>
        <h4><HandCoins size={14} aria-hidden="true" /> {twT('driverAdvance')}: {fmtMoney(adv.given)}{adv.settled ? ` · ${twT('settled')} ${fmtMoney(adv.settled)}` : ''}</h4>
        {open && (
          <div className={styles.lineRow}>
            {field('adv', twT('amount'))}{field('method', twT('method'), 'text')}
            <button type="button" className={B.o} onClick={() => run(() => giveDriverAdvance(trip.id, { date: f.day, amount: Number(f.adv), method: f.method }), twT('advanceGiven'))}>{twT('giveAdvance')}</button>
          </div>
        )}
      </section>
      {vehicle && !vehicle.own && (
        <section className={styles.box}>
          <h4>{twT('hire')}</h4>
          {hire ? <p className={styles.note}>{hire.vendor_name} · {fmtMoney(hire.total)} · {hire.tds_reason === 'T' ? twT('tds194c6Nil') : hire.tds_amount ? `TDS ${sectionText(hire.tds_section, hire.date)} ${fmtMoney(hire.tds_amount)}` : twT('noTds')}</p> : (
            <div className={styles.lineRow}>
              <F l={twT('owner')}><select className={controls.select} value={f.vendor} onChange={set('vendor')}><option value="">-</option>{vendorsDb.all().map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></F>
              {field('hire', twT('amount'))}{field('billNo', twT('billNo'), 'text')}
              <button type="button" className={B.o} onClick={() => run(() => recordLorryHire(trip.id, { date: f.day, vendorId: f.vendor, amount: Number(f.hire), billNumber: f.billNo }), twT('hireSaved'))}>{twT('add')}</button>
            </div>
          )}
        </section>
      )}
      {open ? (
        <section className={styles.box}>
          <h4>{twT('closeTrip')}</h4>
          <div className={styles.lineRow}>
            {field('endKm', twT('endKm'))}
            <F l={twT('spentFromAdvance')}><input className={controls.input} type="number" placeholder={String(spentDefault)} value={f.spent} onChange={set('spent')} /></F>
            {field('returned', twT('returned'))}
            <button type="button" className={B.p} onClick={() => run(() => closeTrip(trip.id, { date: f.day, end_km: f.endKm ? Number(f.endKm) : undefined, spent: f.spent === '' ? spentDefault : Number(f.spent), returned: Number(f.returned) || 0 }), twT('tripClosed'))}>{twT('closeTrip')}</button>
          </div>
        </section>
      ) : trip.status === 'closed' && <div className={styles.toolbar}><button type="button" className={B.g} onClick={() => run(() => reopenTrip(trip.id), twT('tripReopened'))}>{twT('reopen')}</button></div>}
    </div>
  );
}
