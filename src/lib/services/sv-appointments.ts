/**
 * SV-A2 appointment book (table `appointments`, `doc.create`, audited "Appointment", dated `date`): booking, the status
 * flow, walk-in tokens, `wa.me` texts, the bill prefill (lines with the staff on each, the client, the deposit) and the
 * birthday list. Deletes reach the recycle bin through the edit observer. Billing is derived: an appointment whose
 * services sit on a live bill (lines `sv.appointment_id`) shows *billed*, so the POS / editor need no write-back hook.
 */
import './sv-registry';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { Appointment, AppointmentStatus, ServiceStaff, SvMessages } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { normalizePhone } from '../share';
import { shiftDay } from '../dates';
import { blankClient, blankItem, makeDraft } from '../../store/invoice-defaults';
import { localDb } from '../localDb';
import { buildBillDraft } from '../timesheets';
import { serviceClassAt } from '../service-rules';
import { SV_TABLES } from './sv-shared';
import { DEFAULT_MESSAGES } from './sv-settings';
import { durationOf, nextToken, toMin } from './sv-slots';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const loadAppointments = (): Appointment[] => getTable<Appointment>(SV_TABLES.appointments).filter((a) => !!a && typeof a.id === 'string');

/** Allowed moves of the status flow (`billed` is set by billing; `no_show` / `cancelled` need a reason). */
export const NEXT_STATUS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ['confirmed', 'arrived', 'no_show', 'cancelled'],
  confirmed: ['arrived', 'no_show', 'cancelled'],
  arrived: ['in_service', 'done', 'cancelled'],
  in_service: ['done'],
  done: ['billed'],
  billed: [],
  no_show: ['booked'],
  cancelled: ['booked'],
};

export type AppointmentInput = Omit<Appointment, 'id' | 'created_at' | 'status' | 'minutes'> & { id?: string; status?: AppointmentStatus; minutes?: number };

/** Book or edit an appointment (overlaps are allowed: the desk warns). Walk-ins get the next token of the day. */
export function saveAppointment(i: AppointmentInput): Appointment {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Choose the appointment date.');
  if (!Number.isFinite(toMin(i.start))) throw new Error('Choose the start time.');
  if (!i.client_name.trim()) throw new Error('Enter the client\'s name.');
  const all = loadAppointments();
  const prev = i.id ? all.find((a) => a.id === i.id) : undefined;
  const services = (i.services ?? []).filter((s) => s.name.trim()).map((s) => ({ ...s, minutes: Math.max(0, Math.round(Number(s.minutes) || 0)), price: Number(s.price) || 0 }));
  const row: Appointment = {
    ...prev,
    ...i,
    id: prev?.id ?? generateId(),
    client_name: i.client_name.trim(),
    services,
    minutes: Math.max(5, Math.round(Number(i.minutes) || durationOf(services))),
    status: i.status ?? prev?.status ?? (i.source === 'walk-in' ? 'arrived' : 'booked'),
    ...(i.source === 'walk-in' && !prev?.token ? { token: nextToken(all, i.date), queue: 'waiting' as const } : {}),
    created_at: prev?.created_at ?? new Date().toISOString(),
    ...(prev ? { updated_at: new Date().toISOString() } : {}),
  };
  setTable(SV_TABLES.appointments, prev ? all.map((a) => (a.id === row.id ? row : a)) : [...all, row]);
  return row;
}

/** Move along the status flow. `no_show` / `cancelled` need a reason. */
export function setAppointmentStatus(id: string, status: AppointmentStatus, reason?: string): Appointment {
  requireAccess('doc.create');
  const all = loadAppointments();
  const a = all.find((x) => x.id === id);
  if (!a) throw new Error('Appointment not found.');
  if (a.status !== status && !NEXT_STATUS[a.status].includes(status)) throw new Error(`An appointment that is ${a.status.replace('_', ' ')} cannot become ${status.replace('_', ' ')}.`);
  if ((status === 'no_show' || status === 'cancelled') && !reason?.trim()) throw new Error('Give a reason.');
  const queue = status === 'in_service' ? 'called' : status === 'done' ? 'served' : a.queue;
  const row: Appointment = { ...a, status, ...(reason?.trim() ? { reason: reason.trim() } : {}), ...(queue ? { queue } : {}), updated_at: new Date().toISOString() };
  setTable(SV_TABLES.appointments, all.map((x) => (x.id === id ? row : x)));
  return row;
}

/** Queue: call / serve a walk-in token. */
export function setQueue(id: string, queue: NonNullable<Appointment['queue']>): void {
  requireAccess('doc.create');
  const all = loadAppointments();
  setTable(SV_TABLES.appointments, all.map((x) => (x.id === id ? { ...x, queue, updated_at: new Date().toISOString() } : x)));
}

/** Data-layer delete (the row goes to the recycle bin). */
export function deleteAppointment(id: string): void {
  requireAccess('doc.create');
  setTable(SV_TABLES.appointments, loadAppointments().filter((a) => a.id !== id));
}

const liveBill = (i: InvoiceRecord) => i.status !== 'Draft' && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE';

/** Appointment id → the live bill that carries its lines (or its stored `invoice_id`). */
export function billedMap(invoices: readonly InvoiceRecord[]): Map<string, InvoiceRecord> {
  const out = new Map<string, InvoiceRecord>();
  for (const inv of invoices) {
    if (!inv || !liveBill(inv)) continue;
    for (const l of inv.items ?? []) if (l?.sv?.appointment_id && !out.has(l.sv.appointment_id)) out.set(l.sv.appointment_id, inv);
  }
  return out;
}

/** The status shown: `billed` once a live bill carries the appointment. */
export const shownStatus = (a: Appointment, billed: ReadonlyMap<string, InvoiceRecord>): AppointmentStatus => (billed.has(a.id) || (a.invoice_id && a.status === 'billed') ? 'billed' : a.status);

/** Bill lines for an appointment: each service a line, priced by its snapshot, the staff on each (`sv.staff_id`). */
export function billLines(a: Appointment, staff: readonly Pick<ServiceStaff, 'id' | 'name'>[], date = a.date): InvoiceItem[] {
  const nameOf = (id?: string) => staff.find((s) => s.id === id)?.name;
  return a.services.map((s) => {
    const staffId = s.staff_id || a.staff_id;
    const cls = s.sv_class ? serviceClassAt(s.sv_class, date) : undefined;
    const rate = typeof s.tax_rate === 'number' ? s.tax_rate : cls?.rate ?? 0;
    return {
      ...blankItem(rate),
      name: s.name,
      hsn: s.hsn || cls?.sac || '',
      unit: 'NOS',
      rate: s.price,
      amount: s.price,
      sv: {
        appointment_id: a.id,
        ...(staffId ? { staff_id: staffId, staff_name: nameOf(staffId) } : {}),
        ...(s.sv_class ? { cls: s.sv_class } : {}),
        ...(rate === 0 && cls?.exempt ? { exempt: cls.exempt } : {}),
      },
    };
  });
}

/**
 * Bill in the editor (no POS module): a draft invoice with the appointment's lines and client, saved for the user to
 * review and issue. The appointment shows *billed* once the bill is issued (derived from the lines).
 */
export function appointmentDraft(a: Appointment, staff: readonly Pick<ServiceStaff, 'id' | 'name'>[], date: string): InvoiceRecord {
  requireAccess('doc.create');
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const client: Client = (a.client_id ? localDb.clients.getById(a.client_id) : undefined) ?? { ...blankClient(), name: a.client_name, phone: a.phone ?? '' };
  const draft = buildBillDraft({ ...base, id: generateId(), issue_date: date }, client, billLines(a, staff, date), sender);
  return localDb.invoices.save({ ...draft, invoice_number: localDb.invoices.nextNumber(date, draft.doc_type, sender?.invoicePrefix || undefined) });
}

/** No-shows of a client (by id, else by name). */
export const noShowCount = (all: readonly Appointment[], client: { id?: string; name: string }): number =>
  all.filter((a) => a.status === 'no_show' && (client.id ? a.client_id === client.id : a.client_name.trim().toLowerCase() === client.name.trim().toLowerCase())).length;

/** Fill a message template. */
export const fillMessage = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

/** A `wa.me` link (nothing is sent by the app; the device opens WhatsApp). '' without a usable phone. */
export function waLink(phone: string | undefined, text: string): string {
  const n = normalizePhone(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '';
}

/** Confirmation / reminder text of an appointment. */
export function appointmentText(kind: 'confirm' | 'reminder', a: Appointment, ctx: { messages?: SvMessages; business: string; staff?: string; date: string; fallback?: Partial<SvMessages> }): string {
  const tpl = ctx.messages?.[kind] || ctx.fallback?.[kind] || DEFAULT_MESSAGES[kind];
  return fillMessage(tpl, { name: a.client_name, date: ctx.date, time: a.start, staff: ctx.staff ?? '', business: ctx.business });
}

/** Tomorrow's live appointments (the one-click reminder list; no bulk sending). */
export const tomorrowList = (all: readonly Appointment[], today: string): Appointment[] =>
  all.filter((a) => a.date === shiftDay(today, 1) && (a.status === 'booked' || a.status === 'confirmed')).sort((a, b) => a.start.localeCompare(b.start));

/** `MM-DD` of a stored birthday / anniversary (`MM-DD` or `YYYY-MM-DD`), else ''. */
export const monthDay = (v: string | undefined): string => {
  const m = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  return m ? `${m[1]}-${m[2]}` : '';
};

/** Clients with a birthday or anniversary in the `days` days from `from` (works across the year end). */
export function birthdaysIn(clients: readonly Client[], from: string, days = 7): { client: Client; day: string; kind: 'dob' | 'anniversary' }[] {
  const window = Array.from({ length: days }, (_x, i) => shiftDay(from, i));
  const out: { client: Client; day: string; kind: 'dob' | 'anniversary' }[] = [];
  for (const c of clients) {
    for (const kind of ['dob', 'anniversary'] as const) {
      const md = monthDay(c[kind]);
      const day = md && window.find((d) => d.slice(5) === md);
      if (day) out.push({ client: c, day, kind });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.client.name.localeCompare(b.client.name));
}
