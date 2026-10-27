/**
 * SV-B1 patients and the clinic settings object. A patient is an ordinary client with an additive `patient` object
 * (UHID, age / sex, guardian, referring doctor, an allergies note that is never printed); the UHID falls back to the
 * R5-C `roll_no`, so fee-pack patients need no migration. Patients are written to the clients table directly (two
 * patients may share a name, so the name-merging `upsert` is not used); the clients table is audited and its deletes
 * reach the recycle bin. Also the shared clinic bill draft (OPD, admission, lab): a tax invoice, or a Bill of Supply for
 * an unregistered clinic, with the Rule 46A switch snapshotted. Patient data stays on the device (DPDP Act 2023).
 */
import './sv-registry';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ClinicRoom, ClinicSettings, PatientInfo, SvClass, SvRecord } from '../../types/services-r10';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { localDb } from '../localDb';
import { blankClient, blankItem, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { getIndianFY } from '../invoice-number';
import { serviceClassAt } from '../service-rules';
import { readServiceSettings } from './sv-settings';
import { SV_OBJECTS } from './sv-shared';

export const CLINIC_SETTINGS_KEY = `${DB_PREFIX}${SV_OBJECTS.clinicSettings}`;
const KINDS = ['general', 'private', 'icu', 'ccu', 'iccu', 'nicu'] as const;

/** Pure: clean a stored clinic settings object. */
export function cleanClinicSettings(raw: unknown): ClinicSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ClinicSettings = {};
  if (typeof r.uhid_prefix === 'string' && r.uhid_prefix.trim()) out.uhid_prefix = r.uhid_prefix.trim().slice(0, 8);
  if (Array.isArray(r.rooms)) {
    const rooms = (r.rooms as ClinicRoom[]).filter((x) => x && String(x.name ?? '').trim()).map((x) => ({ id: String(x.id || generateId()), name: String(x.name).trim(), kind: KINDS.includes(x.kind) ? x.kind : 'general', rate: Math.max(0, Number(x.rate) || 0) }));
    if (rooms.length) out.rooms = rooms;
  }
  if (r.room_day === '24h' || r.room_day === 'midnight') out.room_day = r.room_day;
  if (Number(r.deposit_alert) > 0) out.deposit_alert = Number(r.deposit_alert);
  if (typeof r.record_referral_payments === 'boolean') out.record_referral_payments = r.record_referral_payments;
  if (r.rate_names && typeof r.rate_names === 'object') out.rate_names = Object.fromEntries(Object.entries(r.rate_names as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim()]));
  for (const k of ['rate_lang', 'rates_printed', 'updated_at'] as const) if (typeof r[k] === 'string' && (r[k] as string).trim()) out[k] = (r[k] as string).trim();
  return out;
}

export const readClinicSettings = (): ClinicSettings => cleanClinicSettings(getJson<unknown>(CLINIC_SETTINGS_KEY, null));

/** Owner only: merge `patch` into the clinic settings (audited). */
export function saveClinicSettings(patch: Partial<ClinicSettings>): ClinicSettings {
  requireAccess('settings.manage');
  const next = cleanClinicSettings({ ...readClinicSettings(), ...patch, updated_at: new Date().toISOString() });
  setJson(CLINIC_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: SV_OBJECTS.clinicSettings, action: 'update', summary: `Clinic settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
/** Whole days from `a` to `b` (local `YYYY-MM-DD`). */
export const dayDiff = (a: string, b: string): number => Math.round((utc(b) - utc(a)) / 864e5);

/** UHID of a client (the R5-C roll no. when no UHID was given). */
export const uhidOf = (c: Pick<Client, 'patient' | 'roll_no'> | undefined): string => c?.patient?.uhid || c?.roll_no || '';

/** Pure: next UHID `<prefix><yy>-<seq>` (4 digits; the FY's first year). Never reuses a taken one. */
export function nextUhid(clients: readonly Client[], prefix: string, date: string): string {
  const yy = String(getIndianFY(date).startYear).slice(2);
  const head = `${prefix}${yy}-`;
  const taken = new Set(clients.map((c) => uhidOf(c).toUpperCase()).filter(Boolean));
  let n = 0;
  for (const u of taken) if (u.startsWith(head.toUpperCase())) n = Math.max(n, Number(u.slice(head.length)) || 0);
  let id = '';
  do id = `${head}${String(++n).padStart(4, '0')}`;
  while (taken.has(id.toUpperCase()));
  return id;
}

/** Age in whole years on `day` (from a full `dob`, else the recorded age moved on by the years since). */
export function ageOn(c: Pick<Client, 'dob' | 'patient'>, day: string): number | undefined {
  const full = /^\d{4}-\d{2}-\d{2}$/.test(c.dob ?? '') ? c.dob! : '';
  const from = full || c.patient?.age_on;
  if (!from) return c.patient?.age;
  const years = Number(day.slice(0, 4)) - Number(from.slice(0, 4)) - (day.slice(5) < from.slice(5) ? 1 : 0);
  return full ? Math.max(0, years) : (c.patient?.age ?? 0) + Math.max(0, years);
}

/** Patients: clients with a patient object or a UHID / roll no. */
export const loadPatients = (): Client[] => localDb.clients.getAll().filter((c) => c && (c.patient || uhidOf(c)));

/** Search by UHID, phone or name. */
export function findPatients(all: readonly Client[], q: string): Client[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...all];
  const digits = s.replace(/\D/g, '');
  return all.filter((c) => uhidOf(c).toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || (digits.length >= 4 && String(c.phone ?? '').replace(/\D/g, '').includes(digits)));
}

export type PatientInput = { id?: string; name: string; phone?: string; dob?: string; patient: PatientInfo };

/** Register or edit a patient (UHID generated when blank; unique). */
export function savePatient(i: PatientInput, day: string): Client {
  requireAccess('master.edit');
  const name = i.name.trim();
  if (!name) throw new Error('Enter the patient\'s name.');
  const all = localDb.clients.getAll();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  const uhid = i.patient.uhid?.trim() || uhidOf(prev) || nextUhid(all, readClinicSettings().uhid_prefix ?? '', day);
  if (all.some((c) => c.id !== prev?.id && uhidOf(c).toUpperCase() === uhid.toUpperCase())) throw new Error(`UHID ${uhid} is already used.`);
  const patient: PatientInfo = { ...prev?.patient, ...i.patient, uhid, ...(i.patient.age != null && !prev?.patient?.age_on ? { age_on: day } : {}) };
  const row: Client = { ...(prev ?? blankClient()), name, ...(i.phone !== undefined ? { phone: i.phone } : {}), ...(i.dob ? { dob: i.dob } : {}), patient, id: prev?.id ?? generateId(), ...(prev ? {} : { created_at: new Date().toISOString() }) } as Client;
  setTable('clients', prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  return row;
}

/** A clinic service line: class rate by date (exempt health care unless a cosmetic / room class says otherwise). */
export function clinicLine(name: string, rate: number, opts: { qty?: number; cls?: SvClass; hsn?: string; date: string; staff_id?: string; staff_name?: string; taxRate?: number; goods?: boolean }): InvoiceItem {
  const cls = opts.cls ?? 'health_exempt';
  const c = serviceClassAt(cls, opts.date);
  const tax = opts.taxRate ?? c.rate;
  const qty = opts.qty ?? 1;
  return {
    ...blankItem(tax),
    type: opts.goods ? 'Goods' : 'Service',
    name,
    hsn: opts.hsn || c.sac,
    unit: 'NOS',
    quantity: qty,
    rate,
    amount: Math.round(qty * rate * 100) / 100,
    sv: { cls, ...(tax === 0 && c.exempt ? { exempt: c.exempt } : {}), ...(opts.staff_id ? { staff_id: opts.staff_id, staff_name: opts.staff_name } : {}) },
  };
}

/** A saved draft bill for a patient (tax invoice; Bill of Supply without a GSTIN: lines untaxed). */
export function clinicDraft(client: Client, items: InvoiceItem[], date: string, sv: SvRecord, reuse?: InvoiceRecord): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const bos = !sender?.companyGstin?.trim();
  const base = reuse ?? { ...makeDraft({ settings, sender, docType: bos ? 'BILL_OF_SUPPLY' : 'INVOICE', templateId: localDb.template.get() }), id: generateId() };
  const lines = bos ? items.map((l) => ({ ...l, tax_rate: 0 })) : items;
  const draft = buildBillDraft({ ...base, issue_date: date, due_date: date }, client, lines, sender);
  const rule46a = !bos && readServiceSettings().rule46a === true;
  return localDb.invoices.save({ ...draft, ...(bos ? { gst_mode: 'NONE' as const } : {}), sv: { ...reuse?.sv, ...sv, ...(rule46a ? { rule46a } : {}) }, invoice_number: reuse?.invoice_number || localDb.invoices.nextNumber(date, draft.doc_type, sender?.invoicePrefix || undefined) });
}

/** The client of a patient id (else a walk-in client with the name). */
export const patientClient = (id: string | undefined, name: string): Client => (id ? localDb.clients.getById(id) : undefined) ?? { ...blankClient(), name };

/** Live (issued, not cancelled) invoice by id — "billed" is derived from it. */
export const liveInvoice = (id: string | undefined, invoices: readonly InvoiceRecord[] = getTable<InvoiceRecord>('invoices')): InvoiceRecord | undefined => {
  const inv = id ? invoices.find((i) => i.id === id) : undefined;
  return inv && inv.status !== 'Cancelled' ? inv : undefined;
};
