/**
 * SV-A2 appointment dialog: client (saved or walk-in), date / start from the free slots, staff, room / chair / bay,
 * services from the catalogue (price, minutes, tax class), source and a note that is never printed; birthday /
 * anniversary on a saved client. An overlap is a warning, never a block. An existing appointment moves along the
 * status flow, bills, sends a `wa.me` confirmation (nothing is sent by the app) or is deleted (recycle bin).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Appointment, AppointmentService, AppointmentSource, AppointmentStatus, ServiceSettings, ServiceStaff, SvClass } from '../../types/services-r10';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { NEXT_STATUS, appointmentText, deleteAppointment, monthDay, noShowCount, saveAppointment, setAppointmentStatus, waLink } from '../../lib/services/sv-appointments';
import { durationOf, overlaps, slotsFor } from '../../lib/services/sv-slots';
import { SV_CLASSES } from '../../lib/services/sv-tax';
import { formatCurrency, formatDate } from '../../lib/utils';
import { getTable } from '../../lib/storage';
import { loadAdvances, openAdvancesFor } from '../../lib/advances';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { svT, type SvKey } from '../../i18n/areas/services-r10a';
import controls from '../../styles/controls.module.css';
import styles from './services.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
const SOURCES: AppointmentSource[] = ['call', 'walk-in', 'whatsapp', 'online-typed'];

export function AppointmentDialog({ appt, preset, staff, settings, all, billed, onClose, onDone, onBill, notify }: {
  appt?: Appointment;
  preset?: Partial<Appointment>;
  staff: readonly ServiceStaff[];
  settings: ServiceSettings;
  all: readonly Appointment[];
  billed: boolean;
  onClose: () => void;
  onDone: () => void;
  onBill: (a: Appointment) => void;
  notify: Notify;
}) {
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), []);
  const catalog = useMemo(() => localDb.items.getAll().filter((i) => i.name?.trim()), []);
  const init = appt ?? preset ?? {};
  const [f, setF] = useState({
    client_id: init.client_id ?? '', client_name: init.client_name ?? '', phone: init.phone ?? '', date: init.date ?? '', start: init.start ?? '',
    staff_id: init.staff_id ?? '', resource_id: init.resource_id ?? '', source: (init.source ?? 'call') as AppointmentSource, notes: init.notes ?? '',
    advance_id: init.advance_id ?? '',
  });
  const [services, setServices] = useState<AppointmentService[]>(() => init.services ?? []);
  const client = clients.find((c) => c.id === f.client_id);
  const [dob, setDob] = useState(() => monthDay(client?.dob));
  const [ann, setAnn] = useState(() => monthDay(client?.anniversary));
  const [reason, setReason] = useState('');
  // SV-A follow-up: the deposit is one of the client's open advance receipts (ADV/…); applied on the bill as usual.
  const deposits = useMemo(() => (client ? openAdvancesFor(client, loadAdvances(), getTable<Payment>('transactions'), getTable<InvoiceRecord>('invoices')) : []), [client]);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const minutes = durationOf(services, settings.slot_step ?? 15);
  const slots = useMemo(() => {
    const list = f.date ? slotsFor(settings, f.date, minutes, staff.find((s) => s.id === f.staff_id)) : [];
    return f.start && !list.includes(f.start) ? [f.start, ...list] : list;
  }, [settings, f.date, f.start, f.staff_id, minutes, staff]);
  const clash = f.date && f.start ? overlaps({ id: appt?.id ?? '', date: f.date, start: f.start, minutes, staff_id: f.staff_id || undefined, resource_id: f.resource_id || undefined }, all) : [];
  const shows = f.client_name.trim() ? noShowCount(all, { id: f.client_id || undefined, name: f.client_name }) : 0;

  const pickClient = (name: string) => {
    const c = clients.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    set({ client_name: name, client_id: c?.id ?? '', ...(c?.phone ? { phone: c.phone } : {}) });
    setDob(monthDay(c?.dob));
    setAnn(monthDay(c?.anniversary));
  };
  const setSvc = (i: number, p: Partial<AppointmentService>) => setServices((list) => list.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const pickService = (i: number, name: string) => {
    const it = catalog.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    setSvc(i, it ? { name: it.name, item_id: it.id, price: Number(it.rate) || 0, tax_rate: it.tax_rate, hsn: it.hsn, ...(it.sv_class ? { sv_class: it.sv_class } : {}) } : { name });
  };

  const save = () => {
    try {
      saveAppointment({ ...appt, ...f, advance_id: (client && f.advance_id) || undefined, client_id: f.client_id || undefined, staff_id: f.staff_id || undefined, resource_id: f.resource_id || undefined, phone: f.phone || undefined, notes: f.notes || undefined, services, minutes });
      if (client && (dob !== monthDay(client.dob) || ann !== monthDay(client.anniversary))) localDb.clients.upsert({ ...client, dob: dob || undefined, anniversary: ann || undefined });
      notify(clash.length ? svT('overlap', { list: clash.map((c) => `${c.start} ${c.client_name}`).join(', ') }) : svT('saved'), clash.length ? 'info' : undefined);
      onDone();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const move = (s: AppointmentStatus) => {
    try {
      setAppointmentStatus(appt!.id, s, reason);
      onDone();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };
  const staffName = staff.find((s) => s.id === f.staff_id)?.name ?? '';
  const business = localDb.settings.activeProfile()?.companyName ?? '';
  const wa = appt ? waLink(f.phone, appointmentText('confirm', appt, { messages: settings.messages, business, staff: staffName, date: formatDate(appt.date) })) : '';
  const field = (k: SvKey, node: ReactNode) => <label className={controls.field}><span className={controls.label}>{svT(k)}</span>{node}</label>;

  return (
    <Modal open onClose={onClose} size="lg" title={appt ? `${appt.client_name} · ${svT(`s.${billed ? 'billed' : appt.status}`)}${appt.token ? ` · ${svT('token', { n: appt.token })}` : ''}` : svT('new')}
      footer={<>
        {appt && !billed && <button type="button" className={controls.btnGhost} onClick={() => { try { deleteAppointment(appt.id); notify(svT('deleted')); onDone(); } catch (e) { notify((e as Error).message, 'error'); } }}>{svT('del')}</button>}
        <button type="button" className={controls.btnOutline} onClick={onClose}>{svT('close')}</button>
        {!billed && <button type="button" className={controls.btnPrimary} onClick={save} data-appt-save>{svT('save')}</button>}
      </>}>
      <div className={styles.form}>
        {field('client', <><input className={controls.input} list="sv-clients" value={f.client_name} onChange={(e) => pickClient(e.target.value)} data-appt-client /><datalist id="sv-clients">{clients.map((c) => <option key={c.id} value={c.name} />)}</datalist></>)}
        {field('phone', <input className={controls.input} type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />)}
        {field('date', <DateField className={controls.input} value={f.date} onChange={(e) => set({ date: e.target.value })} />)}
        {field('start', <SelectField className={controls.select} value={f.start} onChange={(e) => set({ start: e.target.value })} data-appt-start><option value="">-</option>{slots.map((s) => <option key={s}>{s}</option>)}</SelectField>)}
        {field('staff', <SelectField className={controls.select} value={f.staff_id} onChange={(e) => set({ staff_id: e.target.value })} data-appt-staff><option value="">{svT('unassigned')}</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</SelectField>)}
        {!!settings.resources?.length && field('resource', <SelectField className={controls.select} value={f.resource_id} onChange={(e) => set({ resource_id: e.target.value })}><option value="">-</option>{settings.resources.filter((r) => r.active !== false).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</SelectField>)}
        {field('source', <SelectField className={controls.select} value={f.source} onChange={(e) => set({ source: e.target.value as AppointmentSource })}>{SOURCES.map((s) => <option key={s} value={s}>{svT(`src.${s}`)}</option>)}</SelectField>)}
        {client && (deposits.length > 0 || !!f.advance_id) && field('deposit', <SelectField className={controls.select} value={f.advance_id} onChange={(e) => set({ advance_id: e.target.value })} data-appt-deposit><option value="">{svT('noDeposit')}</option>{f.advance_id && !deposits.some((d) => d.advance.id === f.advance_id) && <option value={f.advance_id}>{f.advance_id}</option>}{deposits.map((d) => <option key={d.advance.id} value={d.advance.id}>{svT('depositOpen', { n: d.advance.number, amount: formatCurrency(d.balance.open) })}</option>)}</SelectField>)}
        {client && field('dob', <input className={controls.input} placeholder="MM-DD" value={dob} onChange={(e) => setDob(e.target.value)} />)}
        {client && field('anniversary', <input className={controls.input} placeholder="MM-DD" value={ann} onChange={(e) => setAnn(e.target.value)} />)}
      </div>
      <datalist id="sv-items">{catalog.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <table className={styles.lines}>
        <thead><tr><th>{svT('service')}</th><th>{svT('minutes')}</th><th>{svT('price')}</th><th>{svT('cls')}</th><th>{svT('staff')}</th><th /></tr></thead>
        <tbody>
          {services.map((s, i) => (
            <tr key={i}>
              <td><input className={controls.input} list="sv-items" value={s.name} onChange={(e) => pickService(i, e.target.value)} aria-label={svT('service')} data-appt-service={i} /></td>
              <td><input className={controls.input} type="number" min={0} step={5} value={s.minutes} onChange={(e) => setSvc(i, { minutes: Number(e.target.value) })} aria-label={svT('minutes')} /></td>
              <td><input className={controls.input} type="number" min={0} value={s.price} onChange={(e) => setSvc(i, { price: Number(e.target.value) })} aria-label={svT('price')} /></td>
              <td><SelectField className={controls.select} value={s.sv_class ?? ''} onChange={(e) => setSvc(i, { sv_class: (e.target.value || undefined) as SvClass | undefined })} aria-label={svT('cls')}><option value="">-</option>{SV_CLASSES.map((c) => <option key={c} value={c}>{svT(`cl.${c}`)}</option>)}</SelectField></td>
              <td><SelectField className={controls.select} value={s.staff_id ?? ''} onChange={(e) => setSvc(i, { staff_id: e.target.value || undefined })} aria-label={svT('staff')}><option value="">-</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField></td>
              <td><button type="button" className={controls.btnGhost} onClick={() => setServices((l) => l.filter((_x, k) => k !== i))} aria-label={svT('del')}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setServices((l) => [...l, { name: '', minutes: 30, price: 0 }])} data-appt-add-service>+ {svT('addService')}</button>
      {field('notes', <textarea className={controls.textarea} rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />)}
      {!!clash.length && <p className={controls.hint} role="alert">{svT('overlap', { list: clash.map((c) => `${c.start} ${c.client_name}`).join(', ') })}</p>}
      {shows > 0 && <p className={controls.hint}>{svT('noShows', { n: shows })}</p>}
      {appt && !billed && (
        <div className={styles.actions}>
          {NEXT_STATUS[appt.status].filter((s) => s !== 'billed').map((s) => (
            <button key={s} type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => move(s)} data-appt-status={s}>{svT(`s.${s}`)}</button>
          ))}
          {(appt.status === 'arrived' || appt.status === 'in_service' || appt.status === 'done') && <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => onBill(appt)} data-appt-bill>{svT('bill')}</button>}
          {wa && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={wa} target="_blank" rel="noreferrer">{svT('confirmWa')}</a>}
          <input className={controls.input} placeholder={svT('reason')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={svT('reason')} />
        </div>
      )}
    </Modal>
  );
}
