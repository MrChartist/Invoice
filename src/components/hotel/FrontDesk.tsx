/**
 * R7-A front desk (`/tables?tab=frontdesk`, sub-view in `&view=`): board, calendar, reservations, housekeeping, night
 * audit, guest register and setup, with the booking and check-in dialogs. One lazy chunk that `Tables.tsx` loads only
 * for this tab (the restaurant floor is not mounted with it). The views live in one module on purpose: per-chunk
 * overhead would cost more than the R7-A bundle share allows. R7-B / R7-C add their views through `EXTRA_VIEWS`.
 * Forms are data-driven (`Fields`) to keep the bundle small.
 */
import { Suspense, useCallback, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Building2, CalendarDays, ClipboardList, Clock, KeyRound } from 'lucide-react';
import { Page } from '../ui/Page';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import { useT } from '../../i18n';
import { hT, type HKey } from '../../i18n/areas/hotel-frontdesk-r7';
import type { Guest, HotelSettings, IdType, RatePlan, Reservation, Room, RoomLine, RoomType } from '../../types/hotel-r7';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { generateId, vaultEnabled } from '../../lib/storage';
import { formatMoney as money, cn } from '../../lib/utils';
import { shiftDay } from '../../lib/dates';
import { todayIso } from '../../lib/tax-rules';
import { hotelDb, usingStarter } from '../../lib/hotel/hotel-store';
import { freeRooms, isLiveLine, isLiveRes, lineDates, oooOn } from '../../lib/hotel/availability';
import { auditNights, isYearEnd, nightsBetween } from '../../lib/hotel/business-date';
import { yearEndInterims } from '../../lib/hotel/checkout-save';
import { bT } from '../../i18n/areas/hotel-billing-r7';
import { advanceRate, arrivalsOn, closeReservation, departuresOn, inHouseOn, priceLine, reservationValue, saveReservation, searchReservations, takeAdvance } from '../../lib/hotel/reservations';
import { NeedsConfirm, checkIn, folioToBill, markCheckedOut, walkIn } from '../../lib/hotel/checkin';
import { FORM_C_FIELDS, ID_TYPES, guestRegister, isIndian, matchGuest, shownId, type GuestInput } from '../../lib/hotel/guests';
import { HK_STATUSES, byFloor, occupiedRooms, readyForCheckIn, setHk, setOoo } from '../../lib/hotel/housekeeping';
import { preCheck, runAudit, type LineRef } from '../../lib/hotel/night-audit';
import { plansFor, saveRatePlans } from '../../lib/hotel/rate-plans';
import { saveRoomTypes, saveRooms } from '../../lib/hotel/rooms';
import { stayTotal } from '../../lib/hotel/pricing';
import { B, csvDownload, errText, printHtml } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './hotel.module.css';
import FormCView from './FormCView';
import ReportsView from './ReportsView';
import { escHtml as esc } from '../../lib/html-esc';
import FolioView from './FolioView'; // R7-B: in this chunk (a lazy view chunk cost ~2.8 kB gz of split overhead)
import { SelectField } from '../ui/SelectField';
import { TypedInput } from '../ui/TypedInput';

/* ── Small kit ─────────────────────────────────────────────────── */

export type Rec = Record<string, unknown>;
type Opt = readonly (string | readonly [string, string])[];
/** [field, label (area key, else the field name), n(umber) | d(ate) | t(ime) | c(heckbox) | select options]. */
export type Spec = readonly [string, string, ('n' | 'd' | 't' | 'c' | Opt)?];
const lab = (l: string) => (Object.hasOwn(hT.en, l) ? hT(l as HKey) : l.replace(/_/g, ' '));
const table = (head: string[], rows: unknown[][]) => `<table border="1" cellpadding="4"><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;

export function Fields({ v, set, spec, off }: { v: Rec; set: (p: Rec) => void; spec: readonly Spec[]; off?: boolean }) {
  return (
    <>
      {spec.map(([k, l, t]) => t === 'c' ? (
        <label key={k} className={controls.check}><input type="checkbox" checked={!!v[k]} disabled={off} onChange={(e) => set({ [k]: e.target.checked })} /> {lab(l)}</label>
      ) : (
        <label key={k} className={controls.field}>
          <span className={controls.label}>{lab(l)}</span>
          {Array.isArray(t) ? (
            <SelectField className={controls.select} value={String(v[k] ?? '')} disabled={off} onChange={(e) => set({ [k]: e.target.value })} data-f={k}>
              {(t as Opt).map((o) => (typeof o === 'string' ? <option key={o} value={o}>{lab(o)}</option> : <option key={o[0]} value={o[0]}>{o[1]}</option>))}
            </SelectField>
          ) : (
            <TypedInput className={controls.input} type={t === 'n' ? 'number' : t === 'd' ? 'date' : t === 't' ? 'time' : 'text'} value={String(v[k] ?? '')} disabled={off}
              onChange={(e) => set({ [k]: t === 'n' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value })} data-f={k} />
          )}
        </label>
      ))}
    </>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className={styles.grid}>{children}</div>;
export const Row = ({ children }: { children: ReactNode }) => <div className={styles.row}>{children}</div>;
export const Tbl = ({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) => rows.length ? (
  <div className={surface.tableWrap}><table className={surface.table}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
) : <p className={styles.note}>{hT('empty')}</p>;

/* ── Shell ─────────────────────────────────────────────────────── */

const VIEWS = ['board', 'calendar', 'reservations', 'folios', 'housekeeping', 'audit', 'guests', 'formc', 'reports', 'setup'] as const;
type Dialog = { res?: string; preset?: Partial<Reservation> & { room?: Room } } | { ci?: string; line?: string; walk?: true };

export interface Ctx {
  tick: number;
  day: string;
  refresh: () => void;
  notify: (m: string, tone?: 'success' | 'error') => void;
  open: (d: Dialog) => void;
  go: (view: string, extra?: Record<string, string>) => void;
  run: (fn: () => unknown, ok?: string) => void;
}
/** R7-B / R7-C views (all in this chunk: one chunk for the pack): `folios`, `formc`, `reports`. */
/** R7-B2: the Tables / POS "Room" button loads through this chunk, so the hotel libs stay in one chunk. */
export { default as RoomPicker } from './RoomPicker';
const EXTRA_VIEWS: Partial<Record<string, ComponentType<{ ctx: Ctx }>>> = {
  folios: FolioView, // R7-B
  formc: FormCView, // R7-C2
  reports: ReportsView, // R7-C3
};

export default function FrontDesk() {
  useT();
  const [params, setParams] = useSearchParams();
  const v = params.get('view') ?? '';
  const view = (VIEWS as readonly string[]).includes(v) ? v : 'board';
  const { notify, toastNode } = useToast();
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const day = useMemo(() => hotelDb.settings().business_date, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (next: string, extra?: Record<string, string>) => setParams({ tab: 'frontdesk', view: next, ...extra }, { replace: true });
  const run = (fn: () => unknown, ok = hT('saved')) => {
    try {
      fn();
      notify(ok);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const ctx: Ctx = { tick, day, refresh, notify, open: setDialog, go, run };
  const Extra = EXTRA_VIEWS[view];
  return (
    <Page data-front-desk-view={view} title={hT('tab.frontdesk')} subtitle={hT('bizDate', { d: day })}
      actions={<Link className={controls.btnOutline} to="/tables"><Building2 size={16} aria-hidden="true" /> {hT('restaurant')}</Link>}>
      <div className={styles.stack}>
        {!isPackOn(localDb.settings.get(), 'hotel') && <p className={styles.warn}>{hT('packOff')}</p>}
        <div className={styles.row} role="tablist">
          {VIEWS.map((x) => <button key={x} type="button" role="tab" aria-selected={view === x} className={view === x ? styles.viewOn : styles.view} onClick={() => go(x)} data-hotel-view={x}>{hT(`view.${x}`)}</button>)}
        </div>
        {view === 'board' || view === 'housekeeping' ? <Board ctx={ctx} hk={view === 'housekeeping'} />
          : view === 'calendar' ? <Calendar ctx={ctx} />
          : view === 'reservations' ? <Bookings ctx={ctx} />
          : view === 'audit' ? <Audit ctx={ctx} />
          : view === 'guests' ? <Register ctx={ctx} />
          : view === 'setup' ? <Setup ctx={ctx} />
          : Extra ? <Suspense fallback={null}><Extra ctx={ctx} /></Suspense> : <p className={styles.note}>{hT('later')}</p>}
        {dialog && ('ci' in dialog || 'walk' in dialog
          ? <CheckIn ctx={ctx} d={dialog as { ci?: string; line?: string }} close={() => setDialog(null)} />
          : <Booking ctx={ctx} d={dialog as { res?: string; preset?: Partial<Reservation> & { room?: Room } }} close={() => setDialog(null)} />)}
        <p className={styles.note}>{hT('workingPaper')}</p>
      </div>
      {toastNode}
    </Page>
  );
}

/* ── Board (and A5 housekeeping: status buttons on the tiles) ──── */

function Board({ ctx, hk }: { ctx: Ctx; hk: boolean }) {
  const { day } = ctx;
  const d = useMemo(() => ({ rooms: hotelDb.rooms(), types: hotelDb.roomTypes(), res: hotelDb.reservations() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [ooo, setO] = useState<Rec | null>(null);
  const occ = occupiedRooms(d.res);
  const lines = d.res.flatMap((r) => r.lines.map((l) => ({ r, l, ...lineDates(r, l) })));
  const vacant = d.rooms.filter((r) => !occ.has(r.id) && !oooOn(r, day));
  const counts: [HKey, number][] = [
    ['arrivals', lines.filter((x) => x.l.status === 'booked' && isLiveRes(x.r) && x.arrival <= day && day < x.departure).length],
    ['inHouse', lines.filter((x) => x.l.status === 'checked_in').length],
    ['dueOuts', lines.filter((x) => x.l.status === 'checked_in' && x.departure <= day).length],
    ['vacantClean', vacant.filter((r) => r.hk_status !== 'dirty').length],
    ['vacantDirty', vacant.filter((r) => r.hk_status === 'dirty').length],
    ['ooo', d.rooms.filter((r) => oooOn(r, day)).length],
  ];
  return (
    <div className={styles.stack} data-hotel-board>
      {usingStarter() && <p className={styles.warn}>{hT('starter')}</p>}
      {!hk && <>
        <div className={styles.counts}>{counts.map(([k, n]) => <div key={k} className={styles.count}><strong>{n}</strong>{hT(k)}</div>)}</div>
        <Row>
          <button type="button" className={B.p} onClick={() => ctx.open({ walk: true })} data-walk-in><KeyRound size={16} aria-hidden="true" /> {hT('walkIn')}</button>
          <button type="button" className={B.o} onClick={() => ctx.open({ preset: { arrival: day } })} data-new-booking><CalendarDays size={16} aria-hidden="true" /> {hT('newBooking')}</button>
          <button type="button" className={B.o} onClick={() => ctx.go('reservations')}>{hT('checkIn')} / {hT('checkOut')}</button>
        </Row>
      </>}
      {ooo && <Row>
        <Fields v={ooo} set={(p) => setO({ ...ooo, ...p })} spec={[['from', 'from', 'd'], ['to', 'to', 'd'], ['reason', 'reason']]} />
        <button type="button" className={B.p} onClick={() => ctx.run(() => { setOoo(String(ooo.id), ooo as never); setO(null); })}>{hT('save')}</button>
      </Row>}
      {byFloor(d.rooms).map(([floor, list]) => (
        <div key={floor} className={styles.tiles}>
          {list.map((room) => {
            const res = occ.get(room.id);
            const line = res?.lines.find((l) => l.room_id === room.id && l.status === 'checked_in');
            const st = oooOn(room, day) ? 'ooo' : room.hk_status ?? 'clean';
            const body = <>
              <b>{room.number}</b>
              <span>{d.types.find((t) => t.id === room.room_type_id)?.code} · {hT(`hk.${st}`)}</span>
              {res && line && <span>{res.guest.name.split(' ').pop()} · {nightsBetween(day, lineDates(res, line).departure).length}</span>}
              {line?.form_c && !line.form_c.filed_at && <span className={styles.warn} data-formc-chip>{hT('view.formc')} {Math.round((Date.parse(line.form_c.due_at) - Date.now()) / 3_600_000)}h</span>}
            </>;
            return hk ? (
              <div key={room.id} className={cn(styles.tile, styles[st], res && styles.occ)} data-hk-room={room.number}>
                {body}
                {room.ooo ? <button type="button" className={B.gs} onClick={() => ctx.run(() => setOoo(room.id, null))}>{hT('hk.clean')}</button> : <Row>
                  <SelectField className={controls.select} value={st} onChange={(e) => ctx.run(() => setHk([room.id], e.target.value as 'clean'))} aria-label={hT('status')} data-hk-set>
                    {HK_STATUSES.filter((s) => s !== 'ooo').map((s) => <option key={s} value={s}>{hT(`hk.${s}`)}</option>)}
                  </SelectField>
                  <button type="button" className={B.gs} onClick={() => setO({ id: room.id, from: day, to: day, reason: '' })} aria-label={hT('ooo')}><Ban size={14} aria-hidden="true" /></button>
                </Row>}
              </div>
            ) : (
              <button key={room.id} type="button" className={cn(styles.tile, styles[st], res && styles.occ)} data-room-tile={room.number}
                onClick={() => ctx.open(res ? { res: res.id } : { preset: { arrival: day, room } })}>{body}</button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Calendar (A3): rooms × 14 days (7 on a phone) ─────────────── */

function Calendar({ ctx }: { ctx: Ctx }) {
  const span = window.matchMedia?.('(max-width: 640px)').matches ? 7 : 14;
  const [start, setStart] = useState(ctx.day);
  const d = useMemo(() => ({ rooms: hotelDb.rooms(), res: hotelDb.reservations() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = shiftDay(start, span);
  const days = nightsBetween(start, end);
  const col = (x: string) => days.indexOf(x) + 2;
  return (
    <div className={styles.stack} data-hotel-calendar>
      <Row>{([[-span, 'prev'], [0, 'today'], [span, 'next']] as const).map(([n, k]) => <button key={k} type="button" className={B.os} onClick={() => setStart(n ? shiftDay(start, n) : ctx.day)}>{hT(k)}</button>)}</Row>
      <div className={styles.calWrap}>
        <div className={styles.cal} style={{ gridTemplateColumns: `4rem repeat(${span}, minmax(2.75rem, 1fr))` }}>
          <div className={styles.head}>{hT('room')}</div>
          {days.map((x) => <div key={x} className={styles.head}>{x.slice(8)}/{x.slice(5, 7)}</div>)}
          {d.rooms.map((room, i) => [
            <div key={room.id} className={styles.head} style={{ gridRow: i + 2, gridColumn: 1 }}>{room.number}</div>,
            ...days.map((x) => <button key={room.id + x} type="button" className={styles.cell} style={{ gridRow: i + 2, gridColumn: col(x) }} disabled={oooOn(room, x)} aria-label={`${room.number} ${x}`} onClick={() => ctx.open({ preset: { arrival: x, room } })} />),
            ...d.res.flatMap((r) => r.lines.filter((l) => isLiveLine(l) && l.room_id === room.id).map((l) => {
              const ld = lineDates(r, l);
              const a = ld.arrival < start ? start : ld.arrival;
              const b = ld.departure > end ? end : ld.departure;
              return a < b && <button key={l.id} type="button" className={styles.bar} data-status={l.status === 'checked_in' ? 'checked_in' : r.status} title={r.number}
                style={{ gridRow: i + 2, gridColumn: `${col(a)} / span ${nightsBetween(a, b).length}` }} onClick={() => ctx.open({ res: r.id })}>{r.guest.name}</button>;
            })),
          ])}
        </div>
      </div>
    </div>
  );
}

/* ── Reservations list (A3) ────────────────────────────────────── */

function Bookings({ ctx }: { ctx: Ctx }) {
  const [f, setF] = useState<Rec>({ list: 'arrivals', date: ctx.day, q: '' });
  const d = useMemo(() => ({ all: hotelDb.reservations(), rooms: hotelDb.rooms() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const date = String(f.date || ctx.day);
  const base = f.list === 'arrivals' ? arrivalsOn(d.all, date) : f.list === 'dueOuts' ? departuresOn(d.all, date) : f.list === 'inHouse' ? inHouseOn(d.all, date) : [...d.all].reverse();
  const no = (l: RoomLine) => d.rooms.find((x) => x.id === l.room_id)?.number ?? '-';
  return (
    <div className={styles.stack} data-hotel-reservations>
      <Row>
        <Fields v={f} set={(p) => setF({ ...f, ...p })} spec={[['list', 'status', [['arrivals', hT('arrivals')], ['dueOuts', hT('dueOuts')], ['inHouse', hT('inHouse')], ['all', '*']]], ['date', 'today', 'd'], ['q', 'search']]} />
        <button type="button" className={B.p} onClick={() => ctx.open({ preset: { arrival: date } })}><CalendarDays size={16} aria-hidden="true" /> {hT('newBooking')}</button>
      </Row>
      <Tbl head={[hT('booking'), hT('guest'), hT('arrival'), hT('departure'), hT('rooms'), hT('status'), hT('total'), '']} rows={searchReservations(base, String(f.q)).slice(0, 200).map((r) => [
        <button type="button" className={B.gs} onClick={() => ctx.open({ res: r.id })}>{r.number}</button>, r.guest.name, r.arrival, r.departure, r.lines.map(no).join(', '),
        hT(`st.${r.status}`), money(reservationValue(r)),
        <>
          {isLiveRes(r) && r.lines.filter((l) => l.status === 'booked').map((l) => <button key={l.id} type="button" className={B.os} onClick={() => ctx.open({ ci: r.id, line: l.id })} data-check-in={r.number}>{hT('checkIn')}</button>)}
          {r.lines.filter((l) => l.status === 'checked_in').map((l) => <CheckOutBtn key={l.id} ctx={ctx} res={r} lineId={l.id} cls={B.gs} room={no(l)} />)}
        </>,
      ])} />
    </div>
  );
}

/**
 * PENDING 9: check-out from the Reservations list / night audit. A line with unbilled nights or folio lines opens its
 * folio's check-out (the billing path: posts the missing nights, saves the invoices, then closes the line); a comp or
 * billed line only changes status.
 */
function CheckOutBtn({ ctx, res, lineId, cls, room }: { ctx: Ctx; res: Reservation; lineId: string; cls: string; room?: string }) {
  const line = res.lines.find((l) => l.id === lineId);
  const folio = line ? folioToBill(res, line) : '';
  return folio
    ? <button type="button" className={cls} onClick={() => ctx.go('folios', { folio, checkout: '1' })} data-bill-folio={res.number}>{hT('billOut')}{room ? ` ${room}` : ''}</button>
    : <button type="button" className={cls} onClick={() => ctx.run(() => markCheckedOut(res.id, lineId))}>{hT('checkOut')}{room ? ` ${room}` : ''}</button>;
}

/* ── Booking dialog (A3) ───────────────────────────────────────── */

const SOURCES = ['walk_in', 'phone', 'direct', 'company', 'agent', 'ota'].map((s) => [s, hT(`src.${s}` as HKey)] as const);
type LineDraft = Partial<RoomLine> & Pick<RoomLine, 'room_type_id' | 'rate_plan_id' | 'adults' | 'children' | 'extra_beds'>;

function Booking({ ctx, d, close }: { ctx: Ctx; d: { res?: string; preset?: Partial<Reservation> & { room?: Room } }; close: () => void }) {
  const m = useMemo(() => ({ types: hotelDb.roomTypes(), plans: hotelDb.ratePlans(), rooms: hotelDb.rooms(), all: hotelDb.reservations(), clients: localDb.clients.getAll() }), []);
  const prev = m.all.find((r) => r.id === d.res);
  const [f, setF] = useState<Rec>(() => prev
    ? { ...prev, ...prev.guest, ...prev.ota, ota: undefined, bill: prev.bill_to?.client_id ?? '' }
    : { source: 'phone', nationality: 'IN', status: 'confirmed', guarantee: 'none', arrival: d.preset?.arrival ?? ctx.day, departure: shiftDay(d.preset?.arrival ?? ctx.day, 1), collect: 'hotel_collect', bill: '' });
  const [lines, setLines] = useState<LineDraft[]>(() => prev?.lines ?? [{ room_type_id: d.preset?.room?.room_type_id ?? m.types[0]?.id ?? '', room_id: d.preset?.room?.id, rate_plan_id: plansFor(m.plans)[0]?.id ?? '', adults: 2, children: 0, extra_beds: 0 }]);
  const [x, setX] = useState<Rec>({ method: 'UPI' });
  const live = !prev || isLiveRes(prev);
  const arrival = String(f.arrival);
  const departure = String(f.departure);
  const price = (l: LineDraft) => {
    try {
      return stayTotal(priceLine(l, l.arrival || arrival, l.departure || departure, m, !!x.reprice, prev?.lines.find((p) => p.id === l.id)));
    } catch {
      return 0;
    }
  };
  const save = () => ctx.run(() => {
    const c = m.clients.find((y) => y.id === f.bill);
    const r = saveReservation({
      ...(prev ?? {}), id: prev?.id, booked_on: prev?.booked_on ?? ctx.day, source: f.source as Reservation['source'], arrival, departure,
      status: f.status as Reservation['status'], guarantee: f.guarantee as Reservation['guarantee'], notes: f.notes as string,
      guest: { ...prev?.guest, name: String(f.name ?? ''), phone: f.phone as string, email: f.email as string, nationality: f.nationality as string },
      bill_to: c?.id ? { client_id: c.id, name: c.company || c.name } : undefined,
      ota: f.source === 'ota' ? { name: String(f.otaName ?? f.name ?? ''), ref: f.ref as string, gstin: f.gstin as string, collect: f.collect as 'ota_collect' } : undefined,
      lines: lines as RoomLine[],
    }, { reprice: !!x.reprice });
    ctx.notify(r.warnings.join(' ') || r.res.number);
    close();
  });
  const plans = plansFor(m.plans, String(f.bill || ''));
  return (
    <Modal open size="lg" onClose={close} title={prev ? `${prev.number} · ${hT(`st.${prev.status}`)}` : hT('newBooking')}
      footer={<>{live && <button type="button" className={B.p} onClick={save} data-res-save>{hT('save')}</button>}<button type="button" className={B.o} onClick={close}>{hT('close')}</button></>}>
      <div className={styles.stack}>
        <Grid>
          <Fields v={f} set={(p) => setF({ ...f, ...p })} off={!live} spec={[
            ['name', 'guest'], ['phone', 'phone'], ['email', 'email'], ['nationality', 'nationality'], ['source', 'source', SOURCES],
            ...(f.source === 'ota' ? [['otaName', 'otaName'], ['ref', 'otaRef'], ['gstin', 'otaGstin'], ['collect', 'collect', ['ota_collect', 'hotel_collect']]] as Spec[] : []),
            ['bill', 'billTo', [['', '-'], ...m.clients.filter((c) => c.id).map((c) => [c.id!, c.company || c.name] as const)]],
            ['arrival', 'arrival', 'd'], ['departure', 'departure', 'd'], ['guarantee', 'guarantee', ['none', 'advance', 'company', 'card_noted']],
            ...(f.status === 'tentative' || f.status === 'confirmed' ? [['status', 'status', [['tentative', hT('st.tentative')], ['confirmed', hT('st.confirmed')]]]] as Spec[] : []),
            ['notes', 'notes'],
          ]} />
        </Grid>
        {lines.map((l, i) => {
          const free = freeRooms(l.room_type_id, l.arrival || arrival, l.departure || departure, { rooms: m.rooms, reservations: m.all, exceptResId: prev?.id });
          const own = m.rooms.filter((r) => r.id === l.room_id && !free.includes(r));
          return (
            <div key={l.id ?? i} className={styles.lines}>
              <Fields v={{ ...l, comp: !!l.comp }} off={!live} set={(p) => setLines(lines.map((y, j) => (j === i ? { ...y, ...p, ...('comp' in p ? { comp: p.comp ? 'complimentary' as const : undefined } : {}), ...('room_type_id' in p ? { room_id: undefined } : {}) } : y)))} spec={[
                ['room_type_id', 'roomType', m.types.map((t) => [t.id, t.name] as const)],
                ['room_id', 'room', [['', hT('anyRoom')], ...[...free, ...own].map((r) => [r.id, r.number] as const)]],
                ['rate_plan_id', 'plan', plans.map((p) => [p.id, `${p.code} · ${p.meal_plan}`] as const)],
                ['adults', 'adults', 'n'], ['children', 'children', 'n'], ['extra_beds', 'extraBeds', 'n'], ['comp', 'comp', 'c'],
              ]} />
              <span>{money(price(l))}</span>
              {prev && l.id && l.status === 'booked' && live && <button type="button" className={B.os} onClick={() => ctx.open({ ci: prev.id, line: l.id })}>{hT('checkIn')}</button>}
            </div>
          );
        })}
        {live && <Row>
          <button type="button" className={B.os} onClick={() => setLines([...lines, { ...lines[0], id: undefined, room_id: undefined, status: undefined, nightly: undefined }])}>{hT('add')}</button>
          <strong>{hT('total')}: {money(lines.reduce((s, l) => s + price(l), 0))}</strong>
          {prev && <Fields v={x} set={(p) => setX({ ...x, ...p })} spec={[['reprice', 'reprice', 'c']]} />}
        </Row>}
        {prev && live && <div className={styles.box}>
          <Row>
            <Fields v={x} set={(p) => setX({ ...x, ...p })} spec={[['amount', 'amount', 'n'], ['method', 'method', ['UPI', 'Cash', 'Card', 'Bank transfer']], ['reason', 'reason']]} />
            <button type="button" className={B.o} disabled={!(Number(x.amount) > 0)} onClick={() => ctx.run(() => takeAdvance(prev.id, { amount: Number(x.amount), method: String(x.method) }))}>{hT('takeAdvance')}</button>
            <a className={B.o} target="_blank" rel="noopener noreferrer" href={`https://wa.me/${String(prev.guest.phone ?? '').replace(/\D/g, '').replace(/^(\d{10})$/, '91$1')}?text=${encodeURIComponent(`${prev.number}: ${prev.guest.name}, ${prev.arrival} → ${prev.departure}, ${money(reservationValue(prev))}`)}`}>{hT('share')}</a>
            {prev.status !== 'checked_in' && (['cancelled', 'no_show'] as const).map((k) => (
              <button key={k} type="button" className={B.g} onClick={() => ctx.run(() => { closeReservation(prev.id, k, String(x.reason ?? '')); close(); })}>{hT(k === 'cancelled' ? 'cancelBooking' : 'noShow')}</button>
            ))}
          </Row>
          <p className={styles.note}>{hT('advanceGst', { r: advanceRate(prev) })}</p>
        </div>}
      </div>
    </Modal>
  );
}

/* ── Check-in / walk-in (A4) ───────────────────────────────────── */

const GUEST_SPEC: Spec[] = [['name', 'name'], ['phone', 'phone'], ['email', 'email'], ['address', 'address'], ['nationality', 'nationality'], ['dob', 'dob', 'd'], ['idType', 'idType', ID_TYPES], ['idNo', 'idNo']];
type GuestDraft = Rec & { name?: string };
const toGuest = (g: GuestDraft, masked: boolean): GuestInput => ({
  ...(g as unknown as Guest), storeMasked: masked,
  id_doc: g.idNo ? { type: (g.idType || 'aadhaar') as IdType, number: String(g.idNo), masked: !!g.masked } : undefined,
  foreign: Object.fromEntries(FORM_C_FIELDS.map((k) => [k, g[k] as string])),
});

function CheckIn({ ctx, d, close }: { ctx: Ctx; d: { ci?: string; line?: string }; close: () => void }) {
  const m = useMemo(() => ({ rooms: hotelDb.rooms(), types: hotelDb.roomTypes(), plans: hotelDb.ratePlans(), all: hotelDb.reservations(), guests: hotelDb.guests(), s: hotelDb.settings() }), []);
  const res = m.all.find((r) => r.id === d.ci);
  const line = res?.lines.find((l) => l.id === d.line);
  const [w, setW] = useState<Rec>({ type: m.types[0]?.id, plan: plansFor(m.plans)[0]?.id, adults: 1, children: 0, nights: 1, masked: true, room: line?.room_id ?? '' });
  const [guests, setGuests] = useState<GuestDraft[]>([{ name: res?.guest.name, phone: res?.guest.phone, nationality: res?.guest.nationality || 'IN', idType: 'aadhaar' }]);
  const [confirm, setConfirm] = useState('');
  const arrival = line && res ? lineDates(res, line).arrival : m.s.business_date;
  const departure = line && res ? lineDates(res, line).departure : shiftDay(arrival, Math.max(1, Number(w.nights) || 1));
  const rooms = freeRooms(line?.room_type_id ?? String(w.type), arrival, departure, { rooms: m.rooms, reservations: m.all, exceptResId: res?.id })
    .filter((r) => !occupiedRooms(m.all).has(r.id)).sort((a, b) => +readyForCheckIn(b) - +readyForCheckIn(a));
  const go = (force = false) => {
    try {
      const gs = guests.map((g) => toGuest(g, !!w.masked));
      const roomId = String(w.room || rooms[0]?.id || '');
      const out = res && line ? checkIn({ resId: res.id, lineId: line.id, roomId, guests: gs, force }) : walkIn({
        booking: { guest: { name: gs[0].name, phone: gs[0].phone, nationality: gs[0].nationality }, departure, guarantee: 'none', lines: [{ room_type_id: String(w.type), room_id: roomId, rate_plan_id: String(w.plan), adults: Number(w.adults) || 1, children: Number(w.children) || 0, extra_beds: 0 }] },
        roomId, guests: gs, force,
      });
      const no = m.rooms.find((r) => r.id === roomId)?.number;
      const rows = hotelDb.guests().filter((g) => out.line.guest_ids?.includes(g.id)).map((g) => [g.name, g.phone, g.nationality, shownId(g)]);
      if (window.confirm(`${hT('regCard')}?`)) printHtml(`<h2>${esc(localDb.settings.activeProfile()?.companyName)} · ${hT('regCard')}</h2><p>${esc(out.res.number)} · ${hT('room')} ${esc(no)} · ${esc(arrival)} → ${esc(departure)} · ${money(out.line.nightly[0]?.total ?? 0)}</p>${table([hT('name'), hT('phone'), hT('nationality'), hT('idNo')], rows)}<p>${esc(m.s.terms)}</p><p><br>${hT('signature')}: ________________</p>`, `${out.res.number}-card`);
      ctx.notify(out.formCIncomplete ? hT('formCLater') : hT('saved'), out.formCIncomplete ? 'error' : 'success');
      ctx.refresh();
      close();
    } catch (e) {
      if (e instanceof NeedsConfirm) setConfirm(e.message);
      else ctx.notify(errText(e), 'error');
    }
  };
  const setG = (i: number, p: Rec) => {
    let g = { ...guests[i], ...p };
    const hit = !g.id && (p.phone || p.passport_no) ? matchGuest(m.guests, { phone: String(p.phone ?? ''), passport: String(p.passport_no ?? '') }) : undefined;
    if (hit) {
      g = { ...g, ...hit, ...hit.foreign, idType: hit.id_doc?.type, idNo: hit.id_doc?.number, masked: hit.id_doc?.masked };
      ctx.notify(hit.name);
    }
    setGuests(guests.map((x, j) => (j === i ? g : x)));
  };
  return (
    <Modal open size="lg" onClose={close} title={res ? `${hT('checkIn')} ${res.number}` : hT('walkIn')}
      footer={<>
        {confirm && <button type="button" className={B.o} onClick={() => go(true)}>{hT('forceRoom')}</button>}
        <button type="button" className={B.p} onClick={() => go()} data-check-in-go><KeyRound size={16} aria-hidden="true" /> {hT('checkIn')}</button>
        <button type="button" className={B.o} onClick={close}>{hT('close')}</button>
      </>}>
      <div className={styles.stack}>
        <Grid>
          <Fields v={w} set={(p) => setW({ ...w, ...p })} spec={[
            ...(res ? [] : [['type', 'roomType', m.types.map((t) => [t.id, t.name] as const)], ['plan', 'plan', plansFor(m.plans).map((p) => [p.id, p.code] as const)], ['adults', 'adults', 'n'], ['children', 'children', 'n'], ['nights', 'nights', 'n']] as Spec[]),
            ['room', 'room', rooms.map((r) => [r.id, `${r.number} · ${hT(`hk.${r.hk_status ?? 'clean'}`)}`] as const)], ['masked', 'storeMasked', 'c'],
          ]} />
        </Grid>
        {confirm && <p className={styles.warn}>{confirm}</p>}
        {guests.map((g, i) => (
          <fieldset key={i} className={styles.box}>
            <Grid><Fields v={g} set={(p) => setG(i, p)} spec={GUEST_SPEC} /></Grid>
            {!isIndian(String(g.nationality ?? '')) && <><p className={styles.warn}>{hT('foreign')}</p><Grid><Fields v={g} set={(p) => setG(i, p)} spec={FORM_C_FIELDS.map((k) => [k, k, /(_on|issued|expiry)$/.test(k) ? 'd' : undefined] as Spec)} /></Grid></>}
          </fieldset>
        ))}
        <Row><button type="button" className={B.os} onClick={() => setGuests([...guests, { nationality: 'IN', idType: 'aadhaar' }])}>{hT('addGuest')}</button></Row>
        {!vaultEnabled() && <p className={styles.note}>{hT('vaultTip')}</p>}
      </div>
    </Modal>
  );
}

/* ── Guest register (A4) ───────────────────────────────────────── */

function Register({ ctx }: { ctx: Ctx }) {
  const [f, setF] = useState<Rec>({ from: shiftDay(ctx.day, -30), to: ctx.day });
  const rooms = hotelDb.rooms();
  const head = [hT('name'), hT('nationality'), hT('idNo'), hT('room'), hT('booking'), hT('arrival'), hT('departure'), hT('phone')];
  const rows = guestRegister(hotelDb.reservations(), hotelDb.guests(), (id) => rooms.find((r) => r.id === id)?.number ?? '', String(f.from), String(f.to))
    .map((r) => [r.guest.name, r.guest.nationality ?? '', shownId(r.guest), r.room, r.res.number, r.arrival, r.departure, r.guest.phone ?? '']);
  return (
    <div className={styles.stack} data-hotel-guests>
      <Row>
        <Fields v={f} set={(p) => setF({ ...f, ...p })} spec={[['from', 'from', 'd'], ['to', 'to', 'd']]} />
        <button type="button" className={B.o} onClick={() => printHtml(`<h2>${hT('view.guests')} ${esc(f.from)} – ${esc(f.to)}</h2>${table(head, rows)}`, 'guest-register')}><ClipboardList size={16} aria-hidden="true" /> {hT('print')}</button>
        <button type="button" className={B.o} onClick={() => csvDownload('guest-register.csv', [head, ...rows])}>{hT('csv')}</button>
      </Row>
      <Tbl head={head} rows={rows} />
      <p className={styles.note}>{hT('vaultTip')}</p>
    </div>
  );
}

/* ── Night audit (A6) ──────────────────────────────────────────── */

function Audit({ ctx }: { ctx: Ctx }) {
  const nights = auditNights(ctx.day, todayIso());
  const d = useMemo(() => ({ res: hotelDb.reservations(), guests: hotelDb.guests(), audits: hotelDb.audits().slice(-15).reverse() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // QA9 H10: 31 March interim invoices are offered while the business date is 31 March (before the roll), dated 31 March.
  const yearEnd = isYearEnd(ctx.day) && hotelDb.settings().interim_year_end && d.res.some((r) => r.lines.some((l) => l.status === 'checked_in'));
  const pc = nights.length ? preCheck(nights[0], d.res, d.guests) : null;
  const go = () => {
    if (nights.length > 1 && !window.confirm(hT('catchUp', { n: nights.length, list: nights.join(', ') }))) return;
    const r = runAudit();
    if (r.done.length) ctx.notify(hT('auditDone', { d: r.done.map((x) => x.audit.business_date).join(', ') }));
    if (r.stopped) ctx.notify(hT('stopped', { d: r.stopped.night, reason: r.stopped.reason }), 'error');
    ctx.refresh();
  };
  const list = (k: HKey, rows: LineRef[], fix?: (x: LineRef) => ReactNode) => rows.length > 0 && (
    <div className={styles.box}><strong>{hT(k)}</strong>{rows.map((x) => <Row key={x.lineId}>{x.res.number} · {x.res.guest.name}{fix?.(x)}</Row>)}</div>
  );
  const head = [hT('today'), hT('available'), hT('occupied'), hT('occupancy'), hT('revenue'), 'ADR', 'RevPAR', hT('ledger'), hT('advances')];
  const rows = d.audits.map((a) => [a.business_date, a.stats.available, a.stats.occupied, `${a.stats.occupancy}%`, a.stats.room_revenue, a.stats.adr, a.stats.revpar, a.guest_ledger, a.advances_held]);
  return (
    <div className={styles.stack} data-hotel-audit>
      {pc && <>
        {list('dueOuts', pc.dueOuts, (x) => <>
          <CheckOutBtn ctx={ctx} res={x.res} lineId={x.lineId} cls={B.os} />
          <button type="button" className={B.gs} onClick={() => ctx.open({ res: x.res.id })}>{hT('extend')}</button>
        </>)}
        {list('arrivals', pc.arrivals, (x) => <>
          <button type="button" className={B.os} onClick={() => ctx.open({ ci: x.res.id, line: x.lineId })}>{hT('checkIn')}</button>
          <button type="button" className={B.gs} onClick={() => ctx.run(() => closeReservation(x.res.id, 'no_show'))}>{hT('noShow')}</button>
        </>)}
        {list('late', pc.late)}
        {list('formCWarn', pc.formC)}
      </>}
      <Row>
        <button type="button" className={B.p} disabled={!nights.length || !!(pc && (pc.dueOuts.length || pc.arrivals.length))} onClick={go} data-run-audit>
          <Clock size={16} aria-hidden="true" /> {hT('runAudit')}{nights.length > 1 ? ` (${nights.length})` : ''}
        </button>
        {!nights.length && <span className={styles.note}>{hT('noNights')}</span>}
        <button type="button" className={B.os} onClick={() => csvDownload('night-audits.csv', [head, ...rows])}>{hT('csv')}</button>
        <button type="button" className={B.os} onClick={() => printHtml(`<h2>${hT('view.audit')}</h2>${table(head, rows)}`, 'night-audits')}>{hT('print')}</button>
      </Row>
      {yearEnd && <Row><span className={styles.warn}>{hT('yearEnd')}</span>
        <button type="button" className={B.o} onClick={() => ctx.run(() => yearEndInterims(ctx.day))} data-year-end-interims>{bT('yearEndGo')}</button></Row>}
      <Tbl head={head} rows={rows} />
    </div>
  );
}

/* ── Setup (A2) ────────────────────────────────────────────────── */

const TYPE_SPEC: Spec[] = [['name', 'name'], ['code', 'code'], ['base_occupancy', 'baseOcc', 'n'], ['max_occupancy', 'maxOcc', 'n'], ['max_extra_beds', 'maxBeds', 'n'], ['sac', 'sac']];
const RATE_SPEC: Spec[] = [['single', 'single', 'n'], ['double', 'double', 'n'], ['extra_adult', 'exAdult', 'n'], ['extra_child', 'exChild', 'n'], ['extra_bed', 'exBed', 'n'], ['weekend_single', 'wkSingle', 'n'], ['weekend_double', 'wkDouble', 'n']];
const SEASON_SPEC: Spec[] = [['name', 'season'], ['from', 'from', 'd'], ['to', 'to', 'd'], ['kind', 'kind', ['pct', 'amount', 'override']], ['value', 'value', 'n']];

function Setup({ ctx }: { ctx: Ctx }) {
  const init = useMemo(() => ({ types: hotelDb.roomTypes(), rooms: hotelDb.rooms(), plans: hotelDb.ratePlans(), s: hotelDb.settings(), clients: localDb.clients.getAll() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [types, setTypes] = useState<RoomType[]>(init.types);
  const [rooms, setRooms] = useState<Room[]>(init.rooms);
  const [s, setS] = useState<HotelSettings>(init.s);
  const [plan, setPlan] = useState<(RatePlan & Rec) | null>(null);
  const [range, setRange] = useState<Rec>({});
  const upd = <T,>(list: T[], i: number, p: Rec) => list.map((x, j) => (j === i ? { ...x, ...p } : x));
  const addRange = () => {
    const [a, b = a] = String(range.r ?? '').split('-').map((n) => parseInt(n, 10));
    if (!(a > 0)) return;
    const have = new Set(rooms.map((r) => r.number));
    const add: Room[] = [];
    for (let n = a; n <= Math.min(b, a + 199); n++) if (!have.has(String(n))) add.push({ id: generateId(), number: String(n), room_type_id: types[0]?.id ?? '', floor: String(n).slice(0, -2), active: true, hk_status: 'clean' });
    setRooms([...rooms, ...add]);
  };
  const editPlan = (p: RatePlan) => setPlan({ ...p, weekend: (p.weekend_days ?? [5, 6]).join(','), ...p.policy, rates: types.map((t) => p.rates.find((r) => r.room_type_id === t.id) ?? { room_type_id: t.id, single: 0, double: 0, extra_adult: 0, extra_child: 0, extra_bed: 0 }) });
  const savePlan = () => plan && ctx.run(() => {
    const { weekend, free_until_hours, charge, pct, no_show, ...p } = plan;
    const out = { ...p, weekend_days: String(weekend).split(',').map(Number).filter((n) => n >= 0 && n < 7), policy: { free_until_hours: Number(free_until_hours) || 0, charge: (charge || 'none') as 'none', pct: pct as number, no_show: (no_show || 'first_night') as 'none' } } as RatePlan;
    saveRatePlans([...init.plans.filter((x) => x.id !== out.id), out]);
    setPlan(null);
  });
  return (
    <div className={styles.stack} data-hotel-setup>
      <strong>{hT('roomTypes')}</strong>
      {types.map((t, i) => <div key={t.id} className={styles.lines}><Fields v={t as unknown as Rec} set={(p) => setTypes(upd(types, i, p))} spec={TYPE_SPEC} /><button type="button" className={B.gs} onClick={() => setTypes(types.filter((_, j) => j !== i))}>{hT('remove')}</button></div>)}
      <Row>
        <button type="button" className={B.os} onClick={() => setTypes([...types, { id: generateId(), name: '', code: '', base_occupancy: 2, max_occupancy: 3, max_extra_beds: 1, sac: s.sac_room }])}>{hT('add')}</button>
        <button type="button" className={B.p} onClick={() => ctx.run(() => saveRoomTypes(types))} data-types-save>{hT('save')}</button>
      </Row>
      <strong>{hT('rooms')}</strong>
      {rooms.map((r, i) => <div key={r.id} className={styles.lines}><Fields v={r as unknown as Rec} set={(p) => setRooms(upd(rooms, i, p))} spec={[['number', 'room'], ['room_type_id', 'roomType', types.map((t) => [t.id, t.name] as const)], ['floor', 'floor'], ['active', 'active', 'c']]} /><button type="button" className={B.gs} onClick={() => setRooms(rooms.filter((_, j) => j !== i))}>{hT('remove')}</button></div>)}
      <Row>
        <Fields v={range} set={setRange} spec={[['r', 'addRooms']]} />
        <button type="button" className={B.os} onClick={addRange}>{hT('add')}</button>
        <button type="button" className={B.p} onClick={() => ctx.run(() => saveRooms(rooms))} data-rooms-save>{hT('save')}</button>
      </Row>
      <strong>{hT('plans')}</strong>
      {plan ? (
        <div className={styles.box} data-rate-plan-form>
          <Grid><Fields v={plan} set={(p) => setPlan({ ...plan, ...p })} spec={[
            ['name', 'name'], ['code', 'code'], ['meal_plan', 'mealPlan', ['EP', 'CP', 'MAP', 'AP']], ['audience', 'audience', ['public', 'corporate', 'agent', 'ota']],
            ['client_id', 'billTo', [['', '-'], ...init.clients.filter((c) => c.id).map((c) => [c.id!, c.company || c.name] as const)]],
            ['min_stay', 'minStay', 'n'], ['meal_per_adult', 'mealPerAdult', 'n'], ['weekend', 'weekend'], ['weekend_pct', 'weekendPct', 'n'],
            ['free_until_hours', 'freeHours', 'n'], ['charge', 'charge', ['none', 'first_night', 'pct', 'full']], ['pct', 'pct', 'n'], ['no_show', 'noShowCharge', ['first_night', 'full', 'none']],
            ['tax_inclusive', 'taxInclusive', 'c'], ['meals_separate', 'mealsSeparate', 'c'], ['active', 'active', 'c'],
          ]} /></Grid>
          {plan.rates.map((r, i) => <div key={r.room_type_id} className={styles.lines}><strong>{types.find((t) => t.id === r.room_type_id)?.name}</strong><Fields v={r as unknown as Rec} set={(p) => setPlan({ ...plan, rates: upd(plan.rates, i, p) })} spec={RATE_SPEC} /></div>)}
          {(plan.seasons ?? []).map((x, i) => <div key={i} className={styles.lines}><Fields v={x as unknown as Rec} set={(p) => setPlan({ ...plan, seasons: upd(plan.seasons ?? [], i, p) })} spec={SEASON_SPEC} /></div>)}
          <Row>
            <button type="button" className={B.os} onClick={() => setPlan({ ...plan, seasons: [...(plan.seasons ?? []), { name: '', from: '', to: '', kind: 'pct', value: 0 }] })}>{hT('season')} +</button>
            <button type="button" className={B.p} onClick={savePlan} data-plan-save>{hT('save')}</button>
            <button type="button" className={B.g} onClick={() => setPlan(null)}>{hT('close')}</button>
          </Row>
        </div>
      ) : (
        <Row>
          {init.plans.map((p) => <button key={p.id} type="button" className={B.os} onClick={() => editPlan(p)} data-plan-edit={p.code}>{p.code} · {p.meal_plan}</button>)}
          <button type="button" className={B.os} onClick={() => editPlan({ id: generateId(), name: '', code: '', meal_plan: 'EP', audience: 'public', rates: [], active: true })}>+</button>
        </Row>
      )}
      {can('settings.manage') && <>
        <strong>{hT('settings')}</strong>
        <Grid><Fields v={s as unknown as Rec} set={(p) => setS({ ...s, ...p })} spec={[
          ['checkin_time', 'checkinTime', 't'], ['checkout_time', 'checkoutTime', 't'], ['sac_room', 'sac'], ['sac_fnb', 'sacFnb'], ['interim_days', 'interimDays', 'n'],
          ['terms', 'terms'], ['interim_year_end', 'interimYearEnd', 'c'], ['hk_dirty_on_audit', 'hkOnAudit', 'c'],
        ]} /></Grid>
        <Row><button type="button" className={B.p} onClick={() => ctx.run(() => hotelDb.saveSettings({ ...s, business_date: hotelDb.settings().business_date }))}>{hT('save')}</button></Row>
      </>}
    </div>
  );
}

// R7-C: the GST → Hotel tab and the bell reach the pack's compliance code through this chunk (one chunk per pack, the
// R5-C `r5c-screens` pattern) via `hotel-lazy.ts`: `hotelChunk().then((m) => m.HotelGstTab)`.
export { default as HotelGstTab } from './HotelGstTab';
// eslint-disable-next-line react-refresh/only-export-components
export { registerHotelAlerts } from '../../lib/hotel/hotel-alerts';
// eslint-disable-next-line react-refresh/only-export-components
export { exemptLike } from '../../lib/hotel/band-report'; // R7-C1 (D12) → GST → Common credit
