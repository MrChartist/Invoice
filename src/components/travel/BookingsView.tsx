/**
 * R15-B2 bookings view: every component of every trip with filters (unconfirmed, unbilled, supplier unpaid, travelling
 * in the next 7 days); the same table, with an add form, inside an open trip file. Billed is derived from `line_ref`.
 * C adds two actions here (Cancel, Ticket — one lazy import each).
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { tvList, tvT } from '../../i18n/areas/travel-r15b';
import type { TravelBooking, TvComponent } from '../../types/travel-r15';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { readPurchase } from '../../lib/purchase-normalize';
import { shiftDay } from '../../lib/dates';
import { formatCurrency, todayInput } from '../../lib/utils';
import { TV_COMPONENTS, costInr, isBilled, liveLines, loadBookings, removeBooking, saveBooking } from '../../lib/travel/tv-bookings';
import { loadTrips } from '../../lib/travel/tv-trips';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, ListSelect } from './tv-ui';
import { runWith, type TvViewProps } from './tv-run';
import { cvT } from '../../i18n/areas/travel-r15c';

// R15-C: Cancel (C3) and Ticket (C1) actions, one lazy import each
const CancelDialog = lazy(() => import('./CancelDialog'));
const TicketRows = lazy(() => import('./TicketRows'));

const FILTERS = ['all', 'unconfirmed', 'unbilled', 'unpaid', 'next7'] as const;
const BSTS = ['held', 'confirmed', 'cancelled'] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;

export default function BookingsView({ notify }: TvViewProps) {
  useT();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  return (
    <>
      <div style={{ marginBottom: '0.75rem' }}><Field label={tvT('status')}><ListSelect list="filters" ids={FILTERS} value={filter} onChange={setFilter} attr="data-tv-filter" /></Field></div>
      <BookingTable filter={filter} notify={notify} />
    </>
  );
}

export function BookingTable({ tripId, filter = 'all', notify, onChanged }: { tripId?: string; filter?: (typeof FILTERS)[number]; notify: TvViewProps['notify']; onChanged?: () => void }) {
  const run = runWith(notify);
  const [tick, setTick] = useState(0);
  const d = useMemo(() => {
    void tick;
    const bills = getTable<{ id?: string }>('purchases');
    const unpaid = new Set(bills.map((b) => readPurchase(b)).filter((c) => c && c.total - c.paid > 0.5).map((c) => c!.id));
    return { rows: loadBookings(tripId), live: liveLines(localDb.invoices.getAll()), unpaid, codes: new Map(loadTrips().map((t) => [t.id, t.tv.code])), vendors: getTable<{ id: string; name: string }>('vendors') };
  }, [tripId, tick]);
  const changed = () => { setTick((t) => t + 1); onChanged?.(); };
  const today = todayInput();
  const rows = d.rows.filter((b) => filter === 'all'
    || (filter === 'unconfirmed' && b.status === 'held')
    || (filter === 'unbilled' && b.status !== 'cancelled' && !isBilled(b, d.live))
    || (filter === 'unpaid' && !!b.bill_id && d.unpaid.has(b.bill_id))
    || (filter === 'next7' && b.start >= today && b.start <= shiftDay(today, 7))).sort((a, b) => a.start.localeCompare(b.start));
  const set = (b: TravelBooking, p: Partial<TravelBooking>) => { if (run(() => saveBooking({ ...b, ...p }))) changed(); };
  const [act, setAct] = useState<{ k: 'cancel' | 'ticket'; ids: string[] } | null>(null);
  const targets = d.rows.filter((b) => act?.ids.includes(b.id));
  const done = () => { setAct(null); changed(); };
  return (
    <>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-tv-bookings>
          <thead><tr><th>{tvT('from')}</th>{!tripId && <th>{tvT('trip')}</th>}<th>{tvT('component')}</th><th>{tvT('supplier')}</th><th>{tvT('ref')}</th><th className={surface.numeric}>{tvT('cost')}</th><th className={surface.numeric}>{tvT('sell')}</th><th>{tvT('status')}</th><th /></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} data-tv-booking={b.component}>
                <td>{b.start}</td>{!tripId && <td>{d.codes.get(b.trip_id) ?? '—'}</td>}<td>{tvList('comps', TV_COMPONENTS, b.component)}</td>
                <td>{d.vendors.find((v) => v.id === b.vendor_id)?.name ?? '—'}</td><td>{b.ref ?? ''}</td>
                <td className={surface.numeric}>{formatCurrency(costInr(b))}</td><td className={surface.numeric}>{b.pure_agent ? '≈ ' : ''}{formatCurrency(b.sell)}</td>
                <td>{tvList('bsts', BSTS, b.status)}{isBilled(b, d.live) ? ` · ${tvT('billed')}` : ''}</td>
                <td className={surface.rowActions}>
                  {b.status === 'held' && <button type="button" className={sm} onClick={() => set(b, { status: 'confirmed' })}>{tvT('confirm')}</button>}
                  {!isBilled(b, d.live) && <button type="button" className={sm} onClick={() => { if (run(() => { removeBooking(b.id, d.live); return true; })) changed(); }}>{tvT('remove')}</button>}
                  {b.component === 'air' && b.status !== 'cancelled' && !isBilled(b, d.live) && <button type="button" className={sm} onClick={() => setAct({ k: 'ticket', ids: [b.id] })} data-tv-ticket={b.id}>{cvT('ticket')}</button>}
                  {b.status !== 'cancelled' && <button type="button" className={sm} onClick={() => setAct({ k: 'cancel', ids: [b.id] })} data-tv-cancel-open={b.id}>{tvT('cancellation')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tripId && d.rows.some((b) => b.status !== 'cancelled') && <button type="button" className={sm} style={{ marginTop: '0.5rem' }} onClick={() => setAct({ k: 'cancel', ids: d.rows.filter((b) => b.status !== 'cancelled').map((b) => b.id) })} data-tv-cancel-trip>{cvT('cancelTrip')}</button>}
      {act && targets.length > 0 && <Suspense fallback={null}>{act.k === 'cancel' ? <CancelDialog key={act.ids.join()} targets={targets} notify={notify} onDone={done} /> : <TicketRows key={act.ids[0]} booking={targets[0]} notify={notify} onDone={done} />}</Suspense>}
      {tripId && <BookingForm tripId={tripId} vendors={d.vendors} onAdd={(b) => { if (run(() => saveBooking(b))) changed(); }} />}
    </>
  );
}

function BookingForm({ tripId, vendors, onAdd }: { tripId: string; vendors: { id: string; name: string }[]; onAdd: (b: Omit<TravelBooking, 'id' | 'created_at'>) => void }) {
  const blank = () => ({ component: 'hotel' as TvComponent, vendor_id: '', ref: '', start: todayInput(), cost: '', cost_currency: 'INR', fx: '1', sell: '', pure_agent: false, status: 'confirmed' as TravelBooking['status'] });
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const num = (k: 'cost' | 'sell' | 'fx', attr: string) => <Field label={tvT(k)}><input className={controls.input} inputMode="decimal" value={f[k]} onChange={(e) => set({ [k]: e.target.value })} {...{ [attr]: '' }} /></Field>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.75rem' }} data-tv-booking-form>
      <Field label={tvT('component')}><ListSelect list="comps" ids={TV_COMPONENTS} value={f.component} onChange={(component) => set({ component })} attr="data-tv-b-comp" /></Field>
      <Field label={tvT('supplier')}>
        <select className={controls.select} value={f.vendor_id} onChange={(e) => set({ vendor_id: e.target.value })}>
          <option value="">—</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      <Field label={tvT('ref')}><input className={controls.input} value={f.ref} onChange={(e) => set({ ref: e.target.value })} /></Field>
      <Field label={tvT('from')}><input type="date" className={controls.input} value={f.start} onChange={(e) => set({ start: e.target.value })} /></Field>
      {num('cost', 'data-tv-b-cost')}
      <Field label="₹ / FX"><input className={controls.input} value={f.cost_currency} maxLength={3} onChange={(e) => set({ cost_currency: e.target.value.toUpperCase() })} /></Field>
      {f.cost_currency !== 'INR' && num('fx', 'data-tv-b-fx')}
      {num('sell', 'data-tv-b-sell')}
      <Field label={tvT('status')}><ListSelect list="bsts" ids={BSTS} value={f.status} onChange={(status) => set({ status })} /></Field>
      <label className={controls.check}><input type="checkbox" checked={f.pure_agent} onChange={(e) => set({ pure_agent: e.target.checked })} /> {tvT('pureAgent')}</label>
      <button type="button" className={controls.btnPrimary} data-tv-b-add onClick={() => {
        onAdd({ trip_id: tripId, component: f.component, start: f.start, cost: Number(f.cost) || 0, sell: Number(f.sell) || 0, status: f.status, ...(f.vendor_id ? { vendor_id: f.vendor_id } : {}), ...(f.ref.trim() ? { ref: f.ref.trim() } : {}), ...(f.cost_currency !== 'INR' ? { cost_currency: f.cost_currency, fx: Number(f.fx) || 1 } : {}), ...(f.pure_agent ? { pure_agent: true } : {}) });
        setF(blank());
      }}>{tvT('add')}</button>
    </div>
  );
}
