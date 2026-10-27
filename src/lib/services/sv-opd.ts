/**
 * SV-B1 OPD visits (table `clinic_visits`, `doc.create`, audited "OPD visit", dated `date`, numbered `OPD/FY…`): a daily
 * token per doctor, new / follow-up (follow-up when the last billed visit to the same doctor is within the doctor's
 * `follow_up_days`: the follow-up fee), status `waiting → with_doctor → done → billed`, created from an appointment on
 * arrival or directly. *Bill* makes a draft (tax invoice / Bill of Supply by profile) with the consultation line
 * (health care, exempt), the doctor on the line through the doctor's staff link, and the record snapshot `sv.visit`
 * (UHID, doctor, registration no., token) that the paper prints — a later edit of the doctor never changes a bill.
 * Working papers — verify with your CA (SV1, SV7).
 */
import './sv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { Doctor } from '../../types/retail-r9';
import type { Appointment, ClinicVisit } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { HEALTH_CLASS_RULES } from '../service-rules';
import { ruleAt } from '../tax-rules';
import { doctorsDb } from '../retail/rt-pharmacy-rx';
import { loadStaff } from './sv-staff';
import { clinicDraft, clinicLine, dayDiff, liveInvoice, patientClient, uhidOf } from './sv-patients';
import { SV_SERIES, SV_TABLES } from './sv-shared';

export const OPD = SV_SERIES.visits;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const loadVisits = (): ClinicVisit[] => getTable<ClinicVisit>(SV_TABLES.visits).filter((v) => !!v && typeof v.id === 'string');

/** Next token of the day for a doctor (tokens restart daily, per doctor). */
export const nextOpdToken = (all: readonly ClinicVisit[], date: string, doctorId?: string): number =>
  1 + all.filter((v) => v.date === date && (v.doctor_id ?? '') === (doctorId ?? '')).reduce((m, v) => Math.max(m, v.token || 0), 0);

/** New or follow-up: the last billed visit of the patient to this doctor within `follow_up_days`. */
export function visitKind(all: readonly ClinicVisit[], invoices: readonly InvoiceRecord[], patientId: string | undefined, doctor: Pick<Doctor, 'id' | 'follow_up_days'> | undefined, date: string): ClinicVisit['kind'] {
  const days = Number(doctor?.follow_up_days) || 0;
  if (!patientId || !doctor || days <= 0) return 'new';
  const last = all.filter((v) => v.patient_id === patientId && v.doctor_id === doctor.id && v.date <= date && liveInvoice(v.invoice_id, invoices)?.status !== 'Draft' && !!liveInvoice(v.invoice_id, invoices))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return last && dayDiff(last.date, date) <= days ? 'follow-up' : 'new';
}

/** The consultation fee of a visit kind. */
export const feeFor = (d: Pick<Doctor, 'consult_fee' | 'follow_up_fee'> | undefined, kind: ClinicVisit['kind']): number =>
  Number(kind === 'follow-up' ? d?.follow_up_fee ?? d?.consult_fee : d?.consult_fee) || 0;

export interface VisitInput {
  date: string;
  patient_id?: string;
  patient_name: string;
  doctor_id?: string;
  appointment_id?: string;
  referrer?: ClinicVisit['referrer'];
  vitals?: string;
}

/** Register a visit: number, token, kind and fee. */
export function saveVisit(i: VisitInput, invoices: readonly InvoiceRecord[] = getTable<InvoiceRecord>('invoices')): ClinicVisit {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Choose the visit date.');
  if (!i.patient_name.trim()) throw new Error('Choose the patient.');
  const all = loadVisits();
  if (i.appointment_id && all.some((v) => v.appointment_id === i.appointment_id)) throw new Error('This appointment already has a visit.');
  const doctor = i.doctor_id ? doctorsDb.get(i.doctor_id) : undefined;
  const kind = visitKind(all, invoices, i.patient_id, doctor, i.date);
  const client = i.patient_id ? patientClient(i.patient_id, i.patient_name) : undefined;
  const number = nextSeriesNumberFor(OPD, i.date, all.map((v) => v.number));
  const row: ClinicVisit = {
    id: generateId(), number, date: i.date, patient_id: i.patient_id, patient_name: i.patient_name.trim(), uhid: uhidOf(client) || undefined,
    doctor_id: doctor?.id, doctor_name: doctor?.name, token: nextOpdToken(all, i.date, doctor?.id), kind, fee: feeFor(doctor, kind),
    status: 'waiting', ...(i.appointment_id ? { appointment_id: i.appointment_id } : {}), ...(i.referrer?.name ? { referrer: i.referrer } : {}), ...(i.vitals?.trim() ? { vitals: i.vitals.trim() } : {}),
    created_at: new Date().toISOString(),
  };
  return withTablesRollback([SV_TABLES.visits, 'series_counters'], () => {
    setTable(SV_TABLES.visits, [...all, row]);
    recordSeries(number);
    return row;
  });
}

/** On arrival: the appointment's visit (client, date, the doctor whose staff link matches). */
export function visitFromAppointment(a: Appointment): ClinicVisit {
  const doctor = doctorsDb.all().find((d) => d.staff_id && d.staff_id === a.staff_id);
  return saveVisit({ date: a.date, patient_id: a.client_id, patient_name: a.client_name, doctor_id: doctor?.id, appointment_id: a.id });
}

export function updateVisit(id: string, patch: Partial<Pick<ClinicVisit, 'status' | 'vitals' | 'fee' | 'kind' | 'referrer'>>): ClinicVisit {
  requireAccess('doc.create');
  const all = loadVisits();
  const v = all.find((x) => x.id === id);
  if (!v) throw new Error('Visit not found.');
  if (v.status === 'billed' && patch.status && patch.status !== 'billed') throw new Error(`Visit ${v.number} is billed.`);
  const row: ClinicVisit = { ...v, ...patch, updated_at: new Date().toISOString() };
  setTable(SV_TABLES.visits, all.map((x) => (x.id === id ? row : x)));
  return row;
}

/** Data-layer delete (recycle bin); a billed visit is kept (cancel its bill instead). Its number stays used. */
export function deleteVisit(id: string): void {
  requireAccess('doc.create');
  const v = loadVisits().find((x) => x.id === id);
  if (v && liveInvoice(v.invoice_id)) throw new Error(`Visit ${v.number} has a bill. Cancel the bill instead.`);
  setTable(SV_TABLES.visits, loadVisits().filter((x) => x.id !== id));
}

/** The doctor's line staff (SV-A3 link) for `line.sv.staff_id`. */
export function doctorStaff(d: Pick<Doctor, 'staff_id' | 'name'> | undefined): { staff_id?: string; staff_name?: string } {
  const s = d?.staff_id ? loadStaff().find((x) => x.id === d.staff_id) : undefined;
  return s ? { staff_id: s.id, staff_name: s.name } : {};
}

/** Bill a visit: the consultation line (+ `extra` lines from the item list) on a draft; the visit becomes billed. */
export function billVisit(id: string, extra: InvoiceItem[] = [], date?: string): InvoiceRecord {
  requireAccess('doc.create');
  const v = loadVisits().find((x) => x.id === id);
  if (!v) throw new Error('Visit not found.');
  if (liveInvoice(v.invoice_id)) throw new Error(`Visit ${v.number} is already billed.`);
  const day = date || v.date;
  const doctor = v.doctor_id ? doctorsDb.get(v.doctor_id) : undefined;
  const consult = clinicLine(`Consultation${v.kind === 'follow-up' ? ' (follow-up)' : ''}${v.doctor_name ? ` — Dr ${v.doctor_name.replace(/^dr\.?\s+/i, '')}` : ''}`, v.fee, { date: day, hsn: ruleAt(HEALTH_CLASS_RULES, day).consultSac, ...doctorStaff(doctor) });
  const lines = [...(v.fee > 0 ? [consult] : []), ...extra];
  if (!lines.length) throw new Error('Nothing to bill: set the doctor\'s fee or add a service.');
  return withTablesRollback([SV_TABLES.visits, 'invoices', 'series_counters'], () => {
    const visit = { id: v.id, number: v.number, ...(v.uhid ? { uhid: v.uhid } : {}), ...(doctor ? { doctor_id: doctor.id, doctor_name: doctor.name, ...(doctor.reg_no ? { doctor_reg: `${doctor.council ? `${doctor.council} ` : ''}${doctor.reg_no}` } : {}) } : {}), token: v.token };
    const inv = clinicDraft(patientClient(v.patient_id, v.patient_name), lines, day, { visit, ...(v.referrer?.name ? { referrer: v.referrer } : {}) });
    setTable(SV_TABLES.visits, loadVisits().map((x) => (x.id === v.id ? { ...x, status: 'billed' as const, invoice_id: inv.id, updated_at: new Date().toISOString() } : x)));
    return inv;
  });
}
