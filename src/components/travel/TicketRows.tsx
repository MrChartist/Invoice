/**
 * R15-C1 ticket rows (lazy): in the editor (through TravelRows) they add pure-agent fare lines with the ticket
 * particulars and re-make the one service line (Rule 32(3) deemed value or the actual fee); on an `air` booking
 * ("Ticket" in the bookings table) they make the booking's draft invoice. The deemed value is shown live; a fee above
 * it warns (TV11). Working papers — verify with your CA.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { cvList, cvT } from '../../i18n/areas/travel-r15c';
import type { TravelBooking, TvTicket } from '../../types/travel-r15';
import { formatCurrency, todayInput } from '../../lib/utils';
import { airlineGst, deemedValue, mergeTickets, validateTicket, type AirMethod } from '../../lib/travel/tv-air-value';
import { billTickets } from '../../lib/travel/tv-air';
import { readTravelSettings } from '../../lib/travel/tv-settings';
import controls from '../../styles/controls.module.css';
import { Field } from './tv-ui';
import type { Notify } from './tv-run';

type Row = Record<'pax' | 'airline' | 'ticket_no' | 'pnr' | 'sector' | 'basic' | 'taxes' | 'airline_gst', string> & { class: 'economy' | 'other'; intl: boolean };
const CLS = ['economy', 'other'] as const;
const METHODS = ['deemed', 'actual'] as const;
const flex = { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'flex-end', marginTop: '0.5rem' } as const;
const blank = (b?: TravelBooking): Row => ({ pax: '', airline: '', ticket_no: '', pnr: b?.ref ?? '', sector: '', basic: '', taxes: '', airline_gst: '', class: 'economy', intl: false });
const ticket = (r: Row, date: string): TvTicket => {
  const t: TvTicket = { ...r, basic: Number(r.basic) || 0, taxes: Number(r.taxes) || 0, airline_gst: Number(r.airline_gst) || 0 };
  if (r.airline_gst === '') t.airline_gst = airlineGst(t, date);
  return t;
};

export default function TicketRows({ booking, notify, onDone }: { booking?: TravelBooking; notify?: Notify; onDone?: () => void }) {
  useT();
  const go = useNavigate();
  const s = useInvoiceStore(useShallow((st) => ({ items: st.items, tv: st.tv, date: st.issue_date })));
  const date = booking ? todayInput() : s.date;
  const [rows, setRows] = useState<Row[]>(() => [blank(booking)]);
  const [fee, setFee] = useState('');
  const [method, setMethod] = useState<AirMethod>(s.tv?.air?.method && !booking ? s.tv.air.method : readTravelSettings().air_value ?? 'deemed');
  const [err, setErr] = useState('');
  const set = (k: number, p: Partial<Row>) => setRows((x) => x.map((r, i) => (i === k ? { ...r, ...p } : r)));
  const tickets = rows.map((r) => ticket(r, date));
  const have = booking ? [] : Object.entries(s.tv?.lines ?? {}).filter(([id]) => s.items.some((l) => l.id === id)).map(([, v]) => v.tkt!).filter(Boolean);
  const value = method === 'deemed' ? deemedValue([...have, ...tickets], date) : Number(fee) || 0;
  const add = () => {
    const e = tickets.map(validateTicket).find(Boolean) ?? '';
    setErr(e);
    if (e) return;
    const o = { method, fee: Number(fee) || 0, date };
    if (booking) {
      try {
        const inv = billTickets(booking.id, tickets, o);
        onDone?.();
        go(`/invoice/${inv.id}`);
      } catch (x) { notify?.((x as Error).message, 'error'); }
      return;
    }
    const m = mergeTickets(s.items.filter((l) => l.name?.trim() || Number(l.rate)), s.tv, tickets, o);
    useInvoiceStore.getState().patch({ items: m.items, tv: m.tv });
    setRows([blank()]);
  };
  const txt = (k: number, f: keyof Row, label: string, num?: boolean, ph?: string) => <input className={controls.input} aria-label={label} placeholder={ph ?? label} inputMode={num ? 'decimal' : undefined} style={{ width: num ? '6rem' : '8rem' }} value={rows[k][f] as string} onChange={(e) => set(k, { [f]: e.target.value })} data-tv-tkt={f} />;
  return (
    <div data-tv-tickets>
      {rows.map((r, k) => (
        <div key={k} style={flex}>
          {txt(k, 'pax', cvT('pax'))}{txt(k, 'airline', cvT('airline'))}{txt(k, 'ticket_no', cvT('tno'))}{txt(k, 'pnr', cvT('pnr'))}{txt(k, 'sector', cvT('sector'))}
          <select className={controls.select} aria-label={cvT('cls')} value={r.class} onChange={(e) => set(k, { class: e.target.value as Row['class'] })}>{CLS.map((c) => <option key={c} value={c}>{cvList('cls', CLS, c)}</option>)}</select>
          <label className={controls.check}><input type="checkbox" checked={r.intl} onChange={(e) => set(k, { intl: e.target.checked })} /> {cvT('intl')}</label>
          {txt(k, 'basic', cvT('basic'), true)}{txt(k, 'taxes', cvT('taxes'), true)}{txt(k, 'airline_gst', cvT('agst'), true, `${cvT('agst')} ${airlineGst(tickets[k], date)}`)}
        </div>
      ))}
      <div style={flex}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setRows((x) => [...x, blank(booking)])}>{cvT('addTicket')}</button>
        <Field label={cvT('fee')}><input className={controls.input} inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} data-tv-tkt-fee /></Field>
        <select className={controls.select} aria-label={cvT('value')} value={method} onChange={(e) => setMethod(e.target.value as AirMethod)} data-tv-tkt-method>{METHODS.map((m) => <option key={m} value={m}>{cvList('methods', METHODS, m)}</option>)}</select>
        <span data-tv-tkt-value>{cvT('value')}: {formatCurrency(value)}</span>
        <button type="button" className={controls.btnPrimary} onClick={add} data-tv-tkt-add>{cvT('toInvoice')}</button>
      </div>
      {method === 'deemed' && Number(fee) > value + 0.005 && <p className={controls.hint} role="note" data-tv-fee-high>{cvT('feeHigh')}</p>}
      {err && <p className={controls.hint} role="alert">{err}</p>}
    </div>
  );
}
