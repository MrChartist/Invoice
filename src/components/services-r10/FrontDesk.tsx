/**
 * SV-A2 / A3 shared front desk (Time → Appointments, Time → Staff & commission), one lazy chunk:
 *  - appointments: day view (a column per staff, a row per slot; click a free slot to book, drag a booking to move
 *    it — an overlap is a warning, never a block), week view per staff, walk-in queue with tokens and "Now serving",
 *    tomorrow's `wa.me` reminders and this week's birthdays; *Bill* opens the POS (or a draft invoice) with the services
 *    as lines and the staff on each; desk settings (hours, slot, resources, messages, tax switches);
 *  - commission: staff, commission plans and the monthly statement with its payout (payroll adjustment or journal).
 * Keyboard: Alt + ← / → day, N new appointment. Working papers — verify with your CA.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { InvoiceRecord } from '../../types/invoice';
import type { Appointment, ServiceSettings } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { openBroadcast } from '../../lib/cross-tab';
import { SERVING_CHANNEL, isHello, servingMessage } from '../../lib/pos-serving';
import { localDb } from '../../lib/localDb';
import { enabledModules } from '../../lib/shop-mode';
import { shiftDay } from '../../lib/dates';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { appointmentDraft, appointmentText, billedMap, birthdaysIn, fillMessage, loadAppointments, saveAppointment, setQueue, shownStatus, tomorrowList, waLink } from '../../lib/services/sv-appointments';
import { fromMin, overlaps, slotsFor, toMin, weekdayOf } from '../../lib/services/sv-slots';
import { DEFAULT_MESSAGES, hoursOf, readServiceSettings, saveServiceSettings } from '../../lib/services/sv-settings';
import { bookableStaff, loadStaff } from '../../lib/services/sv-staff';
import { compositionNote } from '../../lib/services/sv-tax';
import { useT } from '../../i18n';
import { svT, type SvKey } from '../../i18n/areas/services-r10a';
import { Modal } from '../ui/Modal';
import { AppointmentDialog } from './AppointmentDialog';
import { CommissionDesk } from './CommissionDesk';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './services.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';
import { TimeField } from '../ui/TimeField';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
const VIEWS = ['day', 'week', 'queue', 'birthdays'] as const;
type View = (typeof VIEWS)[number];

export default function FrontDesk({ tab, view, notify }: { tab: 'appointments' | 'commission'; view?: string; notify: Notify }) {
  useT();
  return tab === 'commission' ? <CommissionDesk view={view} notify={notify} /> : <Appointments view={(VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'day'} notify={notify} />;
}

function Appointments({ view, notify }: { view: View; notify: Notify }) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const [day, setDay] = useState(todayInput());
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState<{ appt?: Appointment; preset?: Partial<Appointment> } | null>(null);
  const [setup, setSetup] = useState(false);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  /* eslint-disable react-hooks/exhaustive-deps */
  const all = useMemo(() => loadAppointments(), [tick]);
  const settings = useMemo(() => readServiceSettings(), [tick]);
  const staffAll = useMemo(() => loadStaff(), [tick]);
  const billed = useMemo(() => billedMap(getTable<InvoiceRecord>('invoices')), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const staff = bookableStaff(staffAll);
  const today = todayInput();
  const posOn = enabledModules(localDb.settings.get())?.has('pos') ?? true;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[aria-modal]'))) return;
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setDay((d) => shiftDay(d, e.key === 'ArrowLeft' ? -1 : 1));
      } else if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        setDialog({ preset: { date: day } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day]);

  const bill = (a: Appointment) => {
    try {
      if (posOn) navigate(`/pos?appt=${encodeURIComponent(a.id)}`);
      else navigate(`/invoice/${appointmentDraft(a, staffAll, today).id}`);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const status = (a: Appointment) => shownStatus(a, billed);
  const dayList = all.filter((a) => a.date === day).sort((a, b) => a.start.localeCompare(b.start));
  const live = dayList.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show');
  const value = live.reduce((s, a) => s + a.services.reduce((x, v) => x + (Number(v.price) || 0), 0), 0);
  const staffName = (id?: string) => staffAll.find((s) => s.id === id)?.name ?? '';
  const business = localDb.settings.activeProfile()?.companyName ?? '';

  const chip = (a: Appointment) => (
    <button key={a.id} type="button" className={styles.chip} data-status={status(a)} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)}
      onClick={(e) => { e.stopPropagation(); setDialog({ appt: a }); }} data-appt-chip={a.client_name}>
      <strong>{a.start}</strong> {a.client_name}{a.token ? ` #${a.token}` : ''} · {a.services.map((s) => s.name).join(', ') || '-'} · {svT(`s.${status(a)}`)}
    </button>
  );

  const drop = (id: string, start: string, staffId: string) => {
    const a = all.find((x) => x.id === id);
    if (!a || status(a) === 'billed') return;
    try {
      const row = saveAppointment({ ...a, start, staff_id: staffId || undefined });
      const c = overlaps(row, loadAppointments());
      notify(c.length ? svT('overlap', { list: c.map((x) => `${x.start} ${x.client_name}`).join(', ') }) : svT('saved'), c.length ? 'info' : undefined);
      refresh();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const step = settings.slot_step ?? 15;
  const rows = slotsFor(settings, day, step);
  const cols: { id: string; name: string }[] = [
    ...(!staff.length || dayList.some((a) => !a.staff_id || !staff.some((s) => s.id === a.staff_id)) ? [{ id: '', name: svT('unassigned') }] : []),
    ...staff.filter((s) => !filter || s.id === filter),
  ];
  const inCell = (col: string, slot: string) => dayList.filter((a) => (col ? a.staff_id === col : !a.staff_id || !staff.some((s) => s.id === a.staff_id)) && toMin(a.start) >= toMin(slot) && toMin(a.start) < toMin(slot) + step);
  const viewBtn = (v: View) => (
    <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? controls.segmentBtnActive : controls.segmentBtn}
      onClick={() => setParams((p) => { p.set('tab', 'appointments'); p.set('view', v); return p; }, { replace: true })}>{svT(`v.${v}`)}</button>
  );

  const weekStart = shiftDay(day, -weekdayOf(day));
  const queue = all.filter((a) => a.date === today && a.token).sort((a, b) => (a.token ?? 0) - (b.token ?? 0));
  const serving = queue.filter((a) => a.queue === 'called').at(-1);
  const servingToken = serving?.token ?? null;
  // PENDING 12: the POS customer display shows the queue's "Now serving" line (same-browser BroadcastChannel); it is
  // sent while the queue view is open, again when a display (re)opens and asks (`hello`).
  useEffect(() => {
    if (view !== 'queue') return;
    const ch = openBroadcast(SERVING_CHANNEL);
    if (!ch) return;
    const send = () => ch.postMessage(servingMessage(servingToken));
    ch.onmessage = (e: MessageEvent) => { if (isHello(e.data)) send(); };
    send();
    return () => ch.close();
  }, [view, servingToken]);

  return (
    <section className={surface.card} data-front-desk>
      <div className={surface.cardBody}>
        <div className={controls.segment} role="tablist">{VIEWS.map(viewBtn)}</div>
        <div className={styles.bar}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setDay(shiftDay(day, view === 'week' ? -7 : -1))} aria-label={svT('prev')}>‹</button>
          <DateField className={controls.input} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={svT('date')} style={{ maxWidth: '11rem' }} />
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setDay(shiftDay(day, view === 'week' ? 7 : 1))} aria-label={svT('next')}>›</button>
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setDay(today)}>{svT('today')}</button>
          <SelectField className={controls.select} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={svT('staff')} style={{ maxWidth: '12rem' }}>
            <option value="">{svT('allStaff')}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectField>
          <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setDialog({ preset: { date: day, staff_id: filter || undefined } })} data-appt-new>+ {svT('new')}</button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setDialog({ preset: { date: today, source: 'walk-in', start: fromMin(Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / step) * step) } })}>+ {svT('walkIn')}</button>
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setSetup(true)}>{svT('settings')}</button>
        </div>

        {!settings.composition_note_seen && (() => {
          const n = compositionNote(getTable<InvoiceRecord>('invoices'), localDb.settings.activeProfile(), today); // SV13: one-time notice
          return n && (
            <p className={controls.hint} role="note" data-sv-composition>
              {svT('compNote', { c: n.composition, r: n.regular })}{' '}
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { try { saveServiceSettings({ composition_note_seen: true }); refresh(); } catch (e) { notify((e as Error).message, 'error'); } }}>{svT('dismiss')}</button>
            </p>
          );
        })()}
        {view === 'day' && (
          <>
            <p className={styles.muted}>{svT('totals', { n: live.length, value: formatCurrency(value) })}{!staff.length ? ` · ${svT('noStaff')}` : ''}</p>
            {hoursOf(settings, weekdayOf(day)).closed ? <p className={controls.hint}>{svT('closed')}</p> : (
              <div className={styles.gridWrap}>
                <table className={styles.grid} data-day-grid>
                  <thead><tr><th />{cols.map((c) => <th key={c.id || '_'}>{c.name}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((slot) => (
                      <tr key={slot}>
                        <td>{slot}</td>
                        {cols.map((c) => (
                          <td key={c.id || '_'} className={styles.cell} data-slot={`${c.name}@${slot}`}
                            onClick={() => setDialog({ preset: { date: day, start: slot, staff_id: c.id || undefined } })}
                            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData('text/plain'), slot, c.id); }}>
                            {inCell(c.id, slot).map(chip)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {view === 'week' && (
          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <thead><tr><th />{Array.from({ length: 7 }, (_x, i) => shiftDay(weekStart, i)).map((d) => <th key={d}>{formatDate(d)}</th>)}</tr></thead>
              <tbody>
                {cols.map((c) => (
                  <tr key={c.id || '_'}>
                    <td>{c.name}</td>
                    {Array.from({ length: 7 }, (_x, i) => shiftDay(weekStart, i)).map((d) => (
                      <td key={d}>{all.filter((a) => a.date === d && (c.id ? a.staff_id === c.id : !a.staff_id)).sort((a, b) => a.start.localeCompare(b.start)).map(chip)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'queue' && (
          <>
            <p className={styles.now} data-now-serving>{serving ? svT('nowServing', { n: serving.token! }) : '-'}</p>
            {serving && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => window.print()}>{svT('printNow')}</button>}
            {!queue.length ? <p className={controls.hint}>{svT('noQueue')}</p> : (
              <ul className={styles.list}>
                {queue.map((a) => (
                  <li key={a.id}>
                    <strong>{svT('token', { n: a.token! })}</strong> {a.client_name} · {svT(a.queue === 'called' ? 'call' : a.queue === 'served' ? 'served' : 'waiting')}
                    {a.queue !== 'served' && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { setQueue(a.id, a.queue === 'called' ? 'served' : 'called'); refresh(); }}>{svT(a.queue === 'called' ? 'served' : 'call')}</button>}
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setDialog({ appt: a })}>{svT('edit')}</button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {view === 'birthdays' && (
          <>
            <h3>{svT('tomorrow')}</h3>
            {!tomorrowList(all, today).length ? <p className={controls.hint}>{svT('noTomorrow')}</p> : (
              <ul className={styles.list}>
                {tomorrowList(all, today).map((a) => {
                  const link = waLink(a.phone, appointmentText('reminder', a, { messages: settings.messages, business, staff: staffName(a.staff_id), date: formatDate(a.date) }));
                  return <li key={a.id}><strong>{a.start}</strong> {a.client_name} · {staffName(a.staff_id)} {link && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={link} target="_blank" rel="noreferrer">{svT('remindWa')}</a>}</li>;
                })}
              </ul>
            )}
            <h3>{svT('birthdays')}</h3>
            {(() => {
              const list = birthdaysIn(localDb.clients.getAll(), today, 7);
              if (!list.length) return <p className={controls.hint}>{svT('noBirthdays')}</p>;
              return (
                <ul className={styles.list}>
                  {list.map((b) => {
                    const link = waLink(b.client.phone, fillMessage(settings.messages?.birthday || DEFAULT_MESSAGES.birthday, { name: b.client.name, business }));
                    return <li key={`${b.client.id}-${b.kind}`}>{formatDate(b.day)} · {b.client.name}{b.kind === 'anniversary' ? ` (${svT('anniv')})` : ''} {link && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={link} target="_blank" rel="noreferrer">{svT('greetWa')}</a>}</li>;
                  })}
                </ul>
              );
            })()}
          </>
        )}
      </div>
      {dialog && (
        <AppointmentDialog appt={dialog.appt} preset={dialog.preset} staff={staff} settings={settings} all={all} billed={!!dialog.appt && status(dialog.appt) === 'billed'} notify={notify}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} onBill={(a) => { setDialog(null); bill(a); }} />
      )}
      {setup && <DeskSettings settings={settings} onClose={() => setSetup(false)} onSaved={() => { setSetup(false); refresh(); notify(svT('saved')); }} notify={notify} />}
    </section>
  );
}

const DAYS = [0, 1, 2, 3, 4, 5, 6];
const dayLabel = (i: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2024, 0, 1 + i));

function DeskSettings({ settings, onClose, onSaved, notify }: { settings: ServiceSettings; onClose: () => void; onSaved: () => void; notify: Notify }) {
  const h0 = hoursOf(settings, 0);
  const [s, setS] = useState({
    open: h0.open, close: h0.close, closed: DAYS.filter((d) => hoursOf(settings, d).closed), step: (settings.slot_step ?? 15) as number,
    resources: (settings.resources ?? []).map((r) => r.name).join(', '),
    confirm: settings.messages?.confirm ?? '', reminder: settings.messages?.reminder ?? '', birthday: settings.messages?.birthday ?? '',
    rule46a: !!settings.rule46a, itc_caution: settings.itc_caution !== false, no_itc_as_exempt: settings.no_itc_as_exempt !== false, staff_required: !!settings.staff_required,
    print_staff: !!settings.print_staff, tips: settings.tips === 'pass-through',
  });
  const set = (p: Partial<typeof s>) => setS((x) => ({ ...x, ...p }));
  const save = () => {
    try {
      const keep = settings.resources ?? [];
      saveServiceSettings({
        slot_step: s.step as ServiceSettings['slot_step'],
        hours: DAYS.map((d) => ({ open: s.open, close: s.close, ...(s.closed.includes(d) ? { closed: true } : {}) })),
        resources: s.resources.split(',').map((n) => n.trim()).filter(Boolean).map((name) => keep.find((r) => r.name === name) ?? { id: '', name, kind: 'other' as const }),
        messages: { confirm: s.confirm, reminder: s.reminder, birthday: s.birthday },
        rule46a: s.rule46a, itc_caution: s.itc_caution, no_itc_as_exempt: s.no_itc_as_exempt, staff_required: s.staff_required,
        print_staff: s.print_staff, tips: s.tips ? 'pass-through' : 'off',
      });
      onSaved();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const check = (k: 'rule46a' | 'itc_caution' | 'no_itc_as_exempt' | 'staff_required' | 'print_staff' | 'tips', label: SvKey) => (
    <label className={controls.check}><input type="checkbox" checked={s[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {svT(label)}</label>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={svT('settings')} footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{svT('close')}</button><button type="button" className={controls.btnPrimary} onClick={save}>{svT('save')}</button></>}>
      <div className={styles.form}>
        <label className={controls.field}><span className={controls.label}>{svT('open')}</span><TimeField className={controls.input} value={s.open} onChange={(e) => set({ open: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{svT('closeAt')}</span><TimeField className={controls.input} value={s.close} onChange={(e) => set({ close: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{svT('step')}</span><SelectField className={controls.select} value={s.step} onChange={(e) => set({ step: Number(e.target.value) })}>{[5, 10, 15, 30].map((n) => <option key={n} value={n}>{n}</option>)}</SelectField></label>
      </div>
      <p className={controls.label}>{svT('closedDays')}</p>
      <div className={styles.actions}>{DAYS.map((d) => <label key={d} className={controls.check}><input type="checkbox" checked={s.closed.includes(d)} onChange={(e) => set({ closed: e.target.checked ? [...s.closed, d] : s.closed.filter((x) => x !== d) })} /> {dayLabel(d)}</label>)}</div>
      <label className={controls.field}><span className={controls.label}>{svT('resources')}</span><input className={controls.input} value={s.resources} onChange={(e) => set({ resources: e.target.value })} /></label>
      <p className={controls.label}>{svT('messages')}</p>
      {(['confirm', 'reminder', 'birthday'] as const).map((k) => (
        <label key={k} className={controls.field}><span className={controls.label}>{svT(`msg.${k}`)}</span><textarea className={controls.textarea} rows={2} placeholder={DEFAULT_MESSAGES[k]} value={s[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>
      ))}
      {check('rule46a', 'rule46a')}
      {check('itc_caution', 'itcCaution')}
      {check('no_itc_as_exempt', 'noItcExempt')}
      {check('staff_required', 'staffRequired')}
      {check('print_staff', 'printStaff')}
      {check('tips', 'tipsOn')}
    </Modal>
  );
}

