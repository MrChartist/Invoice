/**
 * R15-B2 / B3 trips view: trip and event files (cost centres with `tv`) with sell, cost, margin %, unbilled, supplier
 * unpaid and a status filter; a new-file form; the open file's costing per component, its bookings and "Bill"; the
 * trip margin report of a month (only that month's trips are read) and the bills of 5 % trips that claim ITC.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n';
import { tvList, tvT } from '../../i18n/areas/travel-r15b';
import type { TripInfo, TripStatus, TvRegime } from '../../types/travel-r15';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import { loadCostCentres } from '../../lib/cost-centres';
import { TRIP_STATUSES, loadTrips, saveTrip, suggestTripCode, tripLabel, type Trip } from '../../lib/travel/tv-trips';
import { TV_COMPONENTS, liveLines, loadBookings } from '../../lib/travel/tv-bookings';
import { tripCosting, tripMargins } from '../../lib/travel/tv-costing';
import { itcOverrides } from '../../lib/travel/tv-itc';
import { billTrip } from '../../lib/travel/tv-bill';
import { TV_REGIMES, readTravelSettings, saveTravelSettings } from '../../lib/travel/tv-settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field, ListSelect, pct, runWith, type TvViewProps } from './tv-ui';
import { BookingTable } from './BookingsView';

const SCOPES = ['domestic', 'outbound', 'inbound'] as const;
const money = (n: number) => formatCurrency(n);
const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;

export default function TripsView({ notify }: TvViewProps) {
  useT();
  const go = useNavigate();
  const run = runWith(notify);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<TripStatus | ''>('');
  const [open, setOpen] = useState('');
  const [month, setMonth] = useState(todayInput().slice(0, 7));
  const settings = useMemo(() => readTravelSettings(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => {
    const trips = loadTrips();
    const bookings = loadBookings();
    const bills = getTable<{ tv?: { trip_id?: string } }>('purchases').filter((p) => p?.tv?.trip_id);
    return { trips, bookings, bills, live: liveLines(localDb.invoices.getAll()), clients: localDb.clients.getAll() };
  }, [tick]);
  const refresh = () => setTick((t) => t + 1);
  const costing = (t: Trip) => tripCosting(data.bookings.filter((b) => b.trip_id === t.id), data.bills.filter((b) => b.tv?.trip_id === t.id), data.live);
  const shown = data.trips.filter((t) => !status || t.tv.status === status);
  const sel = data.trips.find((t) => t.id === open);
  const margins = useMemo(() => tripMargins(data.trips, data.bookings, data.bills, data.live, `${month}-01`, `${month}-31`), [data, month]);
  const overrides = useMemo(() => itcOverrides(data.bills, `${month}-01`, `${month}-31`), [data, month]);
  const bill = (id: string) => {
    const inv = run(() => billTrip(id));
    if (inv) {
      notify(tvT('made', { n: inv.invoice_number || '' }));
      go(`/invoice/${inv.id}`);
    }
  };
  return (
    <>
      {can('settings.manage') && (
        <div style={row}>
          <Field label={tvT('regimeDefault')}>
            <ListSelect list="regs" ids={TV_REGIMES} value={settings.regime_default ?? 'to18'} onChange={(r) => { run(() => saveTravelSettings({ regime_default: r, regime_ok: true })); refresh(); }} attr="data-tv-regime-default" />
          </Field>
        </div>
      )}
      <TripForm regime={settings.regime_default ?? 'to18'} clients={data.clients} notify={notify} onSaved={(t) => { refresh(); setOpen(t.id); }} />
      <div style={row}>
        <Field label={tvT('status')}>
          <select className={controls.select} value={status} onChange={(e) => setStatus(e.target.value as TripStatus | '')}>
            <option value="">—</option>
            {TRIP_STATUSES.map((s) => <option key={s} value={s}>{tvList('sts', TRIP_STATUSES, s)}</option>)}
          </select>
        </Field>
      </div>
      {shown.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-tv-trips>
            <thead><tr><th>{tvT('trip')}</th><th>{tvT('from')}</th><th>{tvT('status')}</th><th className={surface.numeric}>{tvT('sell')}</th><th className={surface.numeric}>{tvT('cost')}</th><th className={surface.numeric}>{tvT('margin')}</th><th className={surface.numeric}>{tvT('unbilled')}</th><th className={surface.numeric}>{tvT('unpaid')}</th><th /></tr></thead>
            <tbody>
              {shown.map((t) => {
                const c = costing(t);
                return (
                  <tr key={t.id} data-tv-trip={t.tv.code}>
                    <td>{tripLabel(t)}</td><td>{t.tv.start ?? '—'}</td><td>{tvList('sts', TRIP_STATUSES, t.tv.status)}</td>
                    <td className={surface.numeric}>{money(c.sell)}</td><td className={surface.numeric}>{money(c.cost)}</td><td className={surface.numeric} data-tv-margin>{pct(c.pct)}</td>
                    <td className={surface.numeric}>{c.unbilled}</td><td className={surface.numeric}>{money(c.unpaid)}</td>
                    <td className={surface.rowActions}>
                      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(open === t.id ? '' : t.id)}>{tvT('open')}</button>
                      <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => bill(t.id)} data-tv-bill={t.tv.code}>{tvT('bill')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className={controls.hint}>{tvT('none')}</p>}
      {sel && <TripFile trip={sel} c={costing(sel)} notify={notify} onChanged={refresh} />}
      <h3>{tvT('margins')}</h3>
      <div style={row}><Field label={tvT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-tv-margins>
          <thead><tr><th>{tvT('trip')}</th><th className={surface.numeric}>{tvT('sell')}</th><th className={surface.numeric}>{tvT('cost')}</th><th className={surface.numeric}>{tvT('loss')}</th><th className={surface.numeric}>{tvT('commission')}</th><th className={surface.numeric}>{tvT('margin')}</th></tr></thead>
          <tbody>
            {margins.map(({ trip, c }) => <tr key={trip.id}><td>{tripLabel(trip)}</td><td className={surface.numeric}>{money(c.sell)}</td><td className={surface.numeric}>{money(c.cost)}</td><td className={surface.numeric}>{money(c.loss)}</td><td className={surface.numeric}>{money(c.commission)}</td><td className={surface.numeric}>{money(c.margin)}</td></tr>)}
            <tr><th>{tvT('total')}</th>{(['sell', 'cost', 'loss', 'commission', 'margin'] as const).map((k) => <th key={k} className={surface.numeric}>{money(margins.reduce((s, m) => s + m.c[k], 0))}</th>)}</tr>
          </tbody>
        </table>
      </div>
      {overrides.length > 0 && (
        <>
          <h3>{tvT('itcList')}</h3>
          <ul data-tv-itc-overrides>{overrides.map((o) => <li key={o.id}>{o.date} · {o.number} · {data.trips.find((t) => t.id === o.trip_id)?.tv.code ?? '—'} · {money(o.tax)} · {tvT('reason')}: {o.reason || '—'}</li>)}</ul>
        </>
      )}
    </>
  );
}

function TripForm({ regime, clients, notify, onSaved }: { regime: TvRegime; clients: { id?: string; name: string }[]; notify: TvViewProps['notify']; onSaved: (t: Trip) => void }) {
  const blank = () => ({ name: '', client_id: '', code: '', event: false, scope: 'domestic' as TripInfo['scope'], destination: '', start: todayInput(), end: '', pax: '', regime, status: 'confirmed' as TripStatus });
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const save = () => {
    const t = runWith(notify)(() => saveTrip({
      name: f.name, client_id: f.client_id,
      tv: { code: f.code || suggestTripCode(f.start || todayInput(), loadCostCentres()), kind: f.event ? 'event' : 'trip', scope: f.scope, destination: f.destination, start: f.start, end: f.end, regime: f.regime, status: f.status, pax: f.pax.split(',').map((n) => n.trim()).filter(Boolean).map((name) => ({ name, type: 'adult' as const })) },
    }));
    if (t) {
      setF(blank());
      onSaved(t);
    }
  };
  return (
    <details className={surface.card} style={{ marginBottom: '0.75rem' }} data-tv-new-trip>
      <summary>{tvT('newTrip')}</summary>
      <div style={row}>
        <Field label={tvT('name')}><input className={controls.input} value={f.name} onChange={(e) => set({ name: e.target.value })} data-tv-trip-name /></Field>
        <Field label={tvT('client')}>
          <select className={controls.select} value={f.client_id} onChange={(e) => set({ client_id: e.target.value })} data-tv-trip-client>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
          </select>
        </Field>
        <Field label={tvT('code')}><input className={controls.input} value={f.code} placeholder={suggestTripCode(f.start || todayInput(), loadCostCentres())} onChange={(e) => set({ code: e.target.value })} /></Field>
        <Field label={tvT('scope')}><ListSelect list="scopes" ids={SCOPES} value={f.scope} onChange={(scope) => set({ scope })} /></Field>
        <Field label={tvT('destination')}><input className={controls.input} value={f.destination} onChange={(e) => set({ destination: e.target.value })} data-tv-trip-dest /></Field>
        <Field label={tvT('from')}><input type="date" className={controls.input} value={f.start} onChange={(e) => set({ start: e.target.value })} /></Field>
        <Field label={tvT('to')}><input type="date" className={controls.input} value={f.end} onChange={(e) => set({ end: e.target.value })} /></Field>
        <Field label={tvT('paxNames')}><input className={controls.input} value={f.pax} onChange={(e) => set({ pax: e.target.value })} data-tv-trip-pax /></Field>
        <Field label={tvT('regime')}><ListSelect list="regs" ids={TV_REGIMES} value={f.regime} onChange={(r) => set({ regime: r })} attr="data-tv-trip-regime" /></Field>
        <label className={controls.check}><input type="checkbox" checked={f.event} onChange={(e) => set({ event: e.target.checked })} /> {tvT('event')}</label>
        <button type="button" className={controls.btnPrimary} onClick={save} data-tv-trip-save>{tvT('save')}</button>
      </div>
    </details>
  );
}

function TripFile({ trip, c, notify, onChanged }: { trip: Trip; c: ReturnType<typeof tripCosting>; notify: TvViewProps['notify']; onChanged: () => void }) {
  return (
    <section className={surface.card} style={{ margin: '0.75rem 0' }} data-tv-file={trip.tv.code}>
      <h3>{tripLabel(trip)} · {trip.tv.pax.length} {tvT('pax')}</h3>
      <table className={surface.table} data-tv-costing>
        <thead><tr><th>{tvT('component')}</th><th className={surface.numeric}>{tvT('cost')}</th><th className={surface.numeric}>{tvT('sell')}</th><th className={surface.numeric}>{tvT('margin')}</th></tr></thead>
        <tbody>
          {c.rows.map((r) => <tr key={r.component}><td>{tvList('comps', TV_COMPONENTS, r.component)}</td><td className={surface.numeric}>{money(r.cost)}</td><td className={surface.numeric}>{money(r.sell)}</td><td className={surface.numeric}>{money(r.margin)}</td></tr>)}
          <tr><th>{tvT('total')}</th><th className={surface.numeric}>{money(c.cost)}</th><th className={surface.numeric}>{money(c.sell)}</th><th className={surface.numeric} data-tv-file-margin>{money(c.margin)} · {pct(c.pct)}</th></tr>
        </tbody>
      </table>
      {c.unconfirmed > 0 && <p className={controls.hint}>{tvT('unconfirmed')}: {c.unconfirmed}</p>}
      {trip.tv.regime === 'to5' && <p className={controls.hint} data-tv-itc-note>{tvT('itcBlocked')}</p>}
      <BookingTable tripId={trip.id} notify={notify} onChanged={onChanged} />
    </section>
  );
}
