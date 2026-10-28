/**
 * R15-D3 view `events`: event files (trip files of kind `event`) — the event particulars (venue, city, State, dates,
 * guests, budget heads), the budget sheet (approved, booked, billed by vendors, paid; heads over budget in the
 * destructive token), the client's invoiced / received / open advances, the margin, the Sec 12(7)(a) place of supply and
 * each vendor's TDS limb (hint). The vendor-advance column is cut 1 (PRD §3). Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { tvList, tvT } from '../../i18n/areas/travel-r15b';
import { tvdT } from '../../i18n/areas/travel-r15d';
import type { TvComponent, TvEvent } from '../../types/travel-r15';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { INDIAN_STATES } from '../../lib/india-states';
import { ADVANCES_TABLE } from '../../lib/advance-tax';
import type { AdvanceRecord } from '../../types/advances';
import { loadTrips, tripLabel, type Trip } from '../../lib/travel/tv-trips';
import { TV_COMPONENTS, loadBookings } from '../../lib/travel/tv-bookings';
import { eventBudget, eventMoney, saveEvent, vendorTdsHint } from '../../lib/travel/tv-events';
import { eventPos } from '../../lib/travel/tv-pos';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './tv-ui';
import { pct, runWith, type TvViewProps } from './tv-run';

const money = (n: number) => formatCurrency(n);
const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;
const comp = (h: string) => ((TV_COMPONENTS as readonly string[]).includes(h) ? tvList('comps', TV_COMPONENTS, h) : h);

export default function EventsView({ notify }: TvViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState('');
  const data = useMemo(() => {
    void tick;
    return { events: loadTrips().filter((t) => t.tv.kind === 'event'), bookings: loadBookings(), bills: getTable<{ tv?: { trip_id?: string } }>('purchases').filter((p) => p?.tv?.trip_id), invoices: localDb.invoices.getAll(), clients: localDb.clients.getAll() };
  }, [tick]);
  const sel = data.events.find((t) => t.id === open) ?? data.events[0];
  if (!sel) return <p className={controls.hint}>{tvdT('noEvents')}</p>;
  const bk = data.bookings.filter((b) => b.trip_id === sel.id);
  const bills = data.bills.filter((b) => b.tv?.trip_id === sel.id);
  const sheet = eventBudget(sel.tv.event, bk, bills);
  const m = eventMoney(sel.id, sel.client_id, data.invoices, localDb.payments.getAll(), getTable<AdvanceRecord>(ADVANCES_TABLE));
  // Margin = invoiced to the client − cost per head (the vendors' bills, else the booked cost).
  const margin = m.invoiced - sheet.rows.reduce((s, r) => s + (r.billed || r.booked), 0);
  const client = data.clients.find((x) => x.id === sel.client_id);
  const pos = eventPos(client, sel.tv.event?.state);
  const vendors = new Map(getTable<{ id: string; name: string }>('vendors').map((v) => [v.id, v.name]));
  return (
    <section data-tv-events>
      <div style={row}>
        <Field label={tvT('event')}>
          <select className={controls.select} value={sel.id} onChange={(e) => setOpen(e.target.value)} data-tv-event-pick>
            {data.events.map((t) => <option key={t.id} value={t.id}>{tripLabel(t)}</option>)}
          </select>
        </Field>
      </div>
      <EventForm key={sel.id + tick} trip={sel} notify={notify} onSaved={() => setTick((x) => x + 1)} />
      <p className={controls.hint} data-tv-event-pos={pos.key}>{tvdT('posHead')}: {tvdT(`pos.${pos.key}`)}{pos.state && pos.state !== '96' ? ` · ${INDIAN_STATES.find((s) => s.code === pos.state)?.name ?? pos.state}` : ''}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-tv-budget>
          <thead><tr><th>{tvdT('head')}</th><th className={surface.numeric}>{tvdT('approved')}</th><th className={surface.numeric}>{tvdT('booked')}</th><th className={surface.numeric}>{tvdT('billedV')}</th><th className={surface.numeric}>{tvdT('paid')}</th></tr></thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.head} data-tv-head={r.head} data-over={r.over ? '1' : undefined} style={r.over ? { color: 'var(--destructive)' } : undefined}>
                <td>{comp(r.head)}{r.over ? ` · ${tvdT('over')}` : ''}</td><td className={surface.numeric}>{money(r.approved)}</td><td className={surface.numeric}>{money(r.booked)}</td><td className={surface.numeric}>{money(r.billed)}</td><td className={surface.numeric}>{money(r.paid)}</td>
              </tr>
            ))}
            <tr><th>{tvT('total')}</th>{([sheet.approved, sheet.booked, sheet.billed, sheet.paid]).map((n, i) => <th key={i} className={surface.numeric}>{money(n)}</th>)}</tr>
          </tbody>
        </table>
      </div>
      <p className={controls.hint} data-tv-event-money>{tvdT('invoiced')}: {money(m.invoiced)} · {tvdT('received')}: {money(m.received)} · {tvdT('advances')}: {money(m.advances)} · {tvT('margin')}: {money(margin)} ({pct(m.invoiced > 0 ? (margin / m.invoiced) * 100 : null)})</p>
      {bk.length > 0 && (
        <ul data-tv-vendor-tds>
          {bk.filter((b) => b.status !== 'cancelled').map((b) => {
            const h = vendorTdsHint(b.component, b.start || todayInput());
            return <li key={b.id}>{comp(b.component)} · {vendors.get(b.vendor_id ?? '') ?? '—'} · {h ? tvdT('tdsHint', { label: h.label }) : '—'}</li>;
          })}
        </ul>
      )}
    </section>
  );
}

function EventForm({ trip, notify, onSaved }: { trip: Trip; notify: TvViewProps['notify']; onSaved: () => void }) {
  const [e, setE] = useState<TvEvent>(() => ({ ...trip.tv.event, budget: [...(trip.tv.event?.budget ?? [])] }));
  const set = (p: Partial<TvEvent>) => setE((x) => ({ ...x, ...p }));
  const [head, setHead] = useState<TvComponent>('venue');
  const [amt, setAmt] = useState('');
  const txt = (k: 'venue' | 'city', attr: string) => <Field label={tvdT(k)}><input className={controls.input} value={e[k] ?? ''} onChange={(x) => set({ [k]: x.target.value })} {...{ [attr]: '' }} /></Field>;
  const save = (next: TvEvent) => { if (runWith(notify)(() => saveEvent(trip, next))) onSaved(); };
  return (
    <details className={surface.card} style={{ marginBottom: '0.75rem' }} open={!trip.tv.event} data-tv-event-form>
      <summary>{tripLabel(trip)}</summary>
      <div style={row}>
        {txt('venue', 'data-tv-ev-venue')}{txt('city', 'data-tv-ev-city')}
        <Field label={tvdT('state')}>
          <select className={controls.select} value={e.state ?? ''} onChange={(x) => set({ state: x.target.value })} data-tv-ev-state>
            <option value="">—</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            <option value="96">{tvdT('abroad')}</option>
          </select>
        </Field>
        <Field label={tvT('from')}><input type="date" className={controls.input} value={e.date_from ?? ''} onChange={(x) => set({ date_from: x.target.value })} /></Field>
        <Field label={tvT('to')}><input type="date" className={controls.input} value={e.date_to ?? ''} onChange={(x) => set({ date_to: x.target.value })} /></Field>
        <Field label={tvdT('guests')}><input className={controls.input} inputMode="numeric" value={e.guests ?? ''} onChange={(x) => set({ guests: Number(x.target.value) || undefined })} /></Field>
        <button type="button" className={controls.btnPrimary} onClick={() => save(e)} data-tv-ev-save>{tvT('save')}</button>
      </div>
      <div style={row}>
        <Field label={tvdT('head')}>
          <select className={controls.select} value={head} onChange={(x) => setHead(x.target.value as TvComponent)} data-tv-ev-head>
            {TV_COMPONENTS.map((k) => <option key={k} value={k}>{comp(k)}</option>)}
          </select>
        </Field>
        <Field label={tvdT('approved')}><input className={controls.input} inputMode="decimal" value={amt} onChange={(x) => setAmt(x.target.value)} data-tv-ev-amt /></Field>
        <button type="button" className={controls.btnOutline} onClick={() => { const next = { ...e, budget: [...(e.budget ?? []).filter((b) => b.head !== head), { head, approved: Number(amt) || 0 }] }; setE(next); setAmt(''); save(next); }} data-tv-ev-add>{tvdT('addHead')}</button>
      </div>
    </details>
  );
}
