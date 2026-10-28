/**
 * RT-B1 prescription at the counter and the doctors master (docs/prd/round-9.md §4 RT-B1; docs/features/retail-r9.md).
 *
 *  - `doctors` (`master.edit`, audited "Doctor"): name, qualification, council registration, clinic, phone. No referral /
 *    commission field — the app books no payment to doctors (RT9). Round 10 SV-B adds clinic fields to `Doctor` by
 *    declaration merging and reuses `doctorsDb` (keep the table name, the exports and the field names).
 *  - `pickDoctor`: the prescriber name / reg. no. snapshot on `rx` (a later edit of the doctor never rewrites a bill).
 *  - `rxIssues`: H1 / X lines without patient + prescriber → warning, or an error with "Require prescription" (the
 *    pharmacy profile's default; existing 7U companies keep the warning). Schedule X also needs the patient's address and
 *    "prescription retained", and a 20F / 21G licence on file (warning). An expired drug licence is a warning, never a
 *    block. Issues are codes; screens translate them.
 *  - `doctorWiseSales`: bills, value and scheduled-drug lines per doctor and period (CSV).
 *
 * Statutory record keeping is the chemist's — verify with your drug inspector / CA (RT7, RT9). Pure above "Storage".
 */
import './rt-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { Doctor, DrugLicence, Pharmacist } from '../../types/retail-r9';
import { num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { toCsv } from '../csv';
import { requireAccess } from '../access';
import { generateId, getJson, getTable, setJson, setTable } from '../storage';
import { PHARMA_SETTINGS_KEY, readPharmaSettings, type PharmaSettings } from '../pharma-gate';
import { localDb } from '../localDb';
import { RT_TABLES } from './rt-shared';

export const DOCTORS_TABLE = RT_TABLES.doctors;
type Rx = NonNullable<InvoiceRecord['rx']>;
type Schedule = 'H' | 'H1' | 'X';
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/* ── Pure ── */

/** The `rx` after picking `doctor` (snapshot of name + registration; the id links the master). */
export function pickDoctor(rx: Rx | undefined, doctor: Pick<Doctor, 'id' | 'name' | 'reg_no' | 'council'> | undefined): Rx {
  const base: Rx = rx ?? { patient: '', prescriber: '' };
  if (!doctor) {
    const next = { ...base };
    delete next.doctor_id;
    return next;
  }
  const reg = [doctor.reg_no?.trim(), doctor.council?.trim()].filter(Boolean).join(', ');
  return { ...base, doctor_id: doctor.id, prescriber: doctor.name.trim(), ...(reg ? { prescriber_reg: reg } : {}) };
}

export type RxIssueCode = 'needRx' | 'xAddress' | 'xRetained' | 'xLicence' | 'licenceExpired';
export interface RxIssue { code: RxIssueCode; items: string[]; error: boolean }

export interface RxCheckSettings {
  require_rx?: boolean;
  licences?: readonly DrugLicence[];
}

/** Lines of `items` by schedule (name → schedule index from `pharma.ts` `scheduleIndex`). */
export function scheduledLines(items: readonly { name: string; quantity?: number }[], index: ReadonlyMap<string, Schedule>): { name: string; schedule: Schedule }[] {
  const out: { name: string; schedule: Schedule }[] = [];
  for (const l of items) {
    const s = index.get(norm(l.name));
    if (s && num(l.quantity) > 0) out.push({ name: l.name, schedule: s });
  }
  return out;
}

/** True when a licence of the given forms is on file and not expired on `day`. */
export const hasLicence = (licences: readonly DrugLicence[] | undefined, forms: readonly string[], day: string): boolean =>
  (licences ?? []).some((l) => forms.includes(l.form) && l.number?.trim() && !(l.valid_to && l.valid_to < day));

/** Licences whose `valid_to` is before `day`. */
export const expiredLicences = (licences: readonly DrugLicence[] | undefined, day: string): DrugLicence[] => (licences ?? []).filter((l) => !!l.valid_to && l.valid_to < day);

/** Prescription checks of a sale (credit notes, quotations and lines with no quantity are not checked). */
export function rxIssues(rec: Pick<InvoiceRecord, 'items' | 'rx' | 'issue_date'> & Partial<Pick<InvoiceRecord, 'doc_type'>>, index: ReadonlyMap<string, Schedule>, s: RxCheckSettings): RxIssue[] {
  if (rec.doc_type && !['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN'].includes(rec.doc_type)) return [];
  const lines = scheduledLines(rec.items, index);
  const out: RxIssue[] = [];
  const day = rec.issue_date;
  if (expiredLicences(s.licences, day).length) out.push({ code: 'licenceExpired', items: expiredLicences(s.licences, day).map((l) => `${l.form}: ${l.number}`), error: false });
  const strict = lines.filter((l) => l.schedule === 'H1' || l.schedule === 'X').map((l) => l.name);
  if (!strict.length) return out;
  const rx = rec.rx;
  if (!rx?.patient?.trim() || !rx?.prescriber?.trim()) out.push({ code: 'needRx', items: strict, error: !!s.require_rx });
  const x = lines.filter((l) => l.schedule === 'X').map((l) => l.name);
  if (x.length) {
    if (!rx?.patient_address?.trim()) out.push({ code: 'xAddress', items: x, error: !!s.require_rx });
    if (!rx?.retained) out.push({ code: 'xRetained', items: x, error: !!s.require_rx });
    if (!hasLicence(s.licences, ['20F', '21G'], day)) out.push({ code: 'xLicence', items: x, error: false });
  }
  return out;
}

export interface DoctorSales {
  key: string;
  doctor_id?: string;
  name: string;
  reg: string;
  bills: number;
  value: number;
  scheduledLines: number;
}

/** Sales by prescribing doctor in a period (revenue bills carrying `rx`), largest value first. */
export function doctorWiseSales(invoices: readonly InvoiceRecord[], doctors: readonly Doctor[], index: ReadonlyMap<string, Schedule>, period: { from: string; to: string }): DoctorSales[] {
  const byId = new Map(doctors.map((d) => [d.id, d]));
  const out = new Map<string, DoctorSales>();
  for (const inv of invoices) {
    if (!inv?.rx || !isRevenueDoc(inv)) continue;
    const day = String(inv.issue_date ?? '');
    if (day < period.from || day > period.to) continue;
    const doc = inv.rx.doctor_id ? byId.get(inv.rx.doctor_id) : undefined;
    const name = doc?.name ?? inv.rx.prescriber?.trim() ?? '';
    if (!name) continue;
    const key = doc ? `id:${doc.id}` : `name:${norm(name)}`;
    const row = out.get(key) ?? { key, ...(doc ? { doctor_id: doc.id } : {}), name, reg: doc?.reg_no ?? inv.rx.prescriber_reg ?? '', bills: 0, value: 0, scheduledLines: 0 };
    row.bills += 1;
    row.value = round2(row.value + num(inv.total));
    row.scheduledLines += scheduledLines(inv.items ?? [], index).length;
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export function doctorSalesCsv(rows: readonly DoctorSales[], period: { from: string; to: string }): string {
  return toCsv([
    [`Doctor-wise sales ${period.from} to ${period.to} — working paper, verify with your CA`],
    ['Doctor', 'Registration', 'Bills', 'Value', 'Scheduled-drug lines'],
    ...rows.map((r) => [r.name, r.reg, r.bills, r.value, r.scheduledLines]),
  ]);
}

/** "20: KA-…, 21: KA-…" — the printed drug-licence line from the licences, else `fallback` (the profile's old text). */
export function licenceLine(licences: readonly DrugLicence[] | undefined, fallback = ''): string {
  const parts = (licences ?? []).filter((l) => l.number?.trim()).map((l) => `${l.form === 'other' ? '' : `${l.form}: `}${l.number.trim()}`);
  return parts.length ? parts.join(', ') : fallback;
}

/** "Name (reg. no.)" of the pharmacist ('' when none). */
export const pharmacistLine = (p: Pharmacist | undefined): string => (p?.name?.trim() ? `${p.name.trim()}${p.reg_no?.trim() ? ` (${p.reg_no.trim()})` : ''}` : '');

/* ── Storage ── */

export const doctorsDb = {
  all: (): Doctor[] => getTable<Doctor>(DOCTORS_TABLE).filter((d) => d && typeof d.id === 'string'),
  get: (id: string): Doctor | undefined => doctorsDb.all().find((d) => d.id === id),
  /** Add or edit (by id); names are unique among active doctors (case-insensitive). */
  save(input: Partial<Doctor> & { name: string }): Doctor {
    requireAccess('master.edit');
    const name = input.name.trim();
    if (!name) throw new Error('Type the doctor\'s name.');
    const all = doctorsDb.all();
    if (all.some((d) => d.id !== input.id && d.active !== false && norm(d.name) === norm(name))) throw new Error(`${name} is already in the list.`);
    const now = new Date().toISOString();
    const prev = input.id ? all.find((d) => d.id === input.id) : undefined;
    const row: Doctor = { ...(prev ?? {}), ...input, id: prev?.id ?? generateId(), name, active: input.active ?? prev?.active ?? true, created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}) };
    setTable(DOCTORS_TABLE, prev ? all.map((d) => (d.id === row.id ? row : d)) : [...all, row]);
    return row;
  },
  /** Delete through the data layer (the watched table copies the row to the recycle bin). */
  remove(id: string): void {
    requireAccess('master.edit');
    setTable(DOCTORS_TABLE, doctorsDb.all().filter((d) => d.id !== id));
  },
};

/** The pharmacy desk's part of `pharma_settings` (licences, pharmacist, require_rx), read raw. */
export function readRxSettings(): Required<Pick<PharmaSettings, 'licences'>> & Pick<PharmaSettings, 'pharmacist' | 'require_rx'> {
  const raw = getJson<Partial<PharmaSettings> | null>(PHARMA_SETTINGS_KEY, null) ?? {};
  return {
    licences: Array.isArray(raw.licences) ? raw.licences.filter((l) => l && typeof l.number === 'string') : [],
    ...(raw.pharmacist?.name ? { pharmacist: raw.pharmacist } : {}),
    require_rx: raw.require_rx === true,
  };
}

/**
 * Owner only: save licences / pharmacist / require_rx (the 7U switches are kept) and write the printed licence line and
 * pharmacist into every business profile, so each new bill's sender snapshot carries them (old bills never change).
 * With no licence left, a profile keeps its own typed licence text.
 */
export function saveRxSettings(patch: Pick<PharmaSettings, 'licences' | 'pharmacist' | 'require_rx'>): void {
  requireAccess('settings.manage');
  const licences = (patch.licences ?? []).map((l) => ({ ...l, number: l.number.trim() })).filter((l) => l.number);
  for (const l of licences) {
    if (l.valid_from && l.valid_to && l.valid_to < l.valid_from) throw new Error(`${l.form}: ${l.number} — "valid to" is before "valid from".`);
  }
  const pharmacist = patch.pharmacist?.name?.trim() ? { name: patch.pharmacist.name.trim(), reg_no: patch.pharmacist.reg_no?.trim() ?? '', ...(patch.pharmacist.council?.trim() ? { council: patch.pharmacist.council.trim() } : {}) } : undefined;
  const raw = getJson<Record<string, unknown> | null>(PHARMA_SETTINGS_KEY, null) ?? { ...readPharmaSettings() };
  const next: Record<string, unknown> = { ...raw, licences, require_rx: !!patch.require_rx };
  if (pharmacist) next.pharmacist = pharmacist;
  else delete next.pharmacist;
  setJson(PHARMA_SETTINGS_KEY, next);
  const s = localDb.settings.get();
  const line = licenceLine(licences);
  const who = pharmacistLine(pharmacist);
  localDb.settings.save({
    ...s,
    profiles: s.profiles.map((p) => {
      const q = { ...p, ...(line ? { drug_licence: line } : {}) };
      if (who) q.pharmacist = who;
      else delete q.pharmacist;
      return q;
    }),
  });
}
