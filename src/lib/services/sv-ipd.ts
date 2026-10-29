/**
 * SV-B2 in-patient running bill (table `admissions`, `doc.create`, audited "Admission", dated `admit_date`, numbered
 * `IPD/FY…`): patient, doctors, a room snapshot (kind, rate per day), deposits (existing advance receipts), running
 * charges (procedures, visits, medicines / consumables from stock with their batch), status `admitted → discharged →
 * billed`. Room-days by midnight census (default) or per started 24 h. Room-rent test (`roomClass`, SV3): ICU / CCU /
 * ICCU / NICU always exempt; another room charging more than ₹5,000 a day (room charge alone, per patient) from
 * 18 Jul 2022 is 5% without ITC, SAC 9993. Medicines, consumables, implants and food on an admission are exempt lines of
 * the composite health care supply (SV4) and keep their HSN / batch so the stock reader moves them out. The interim
 * bill is a print, not a document; the final bill is one draft invoice (Rule 46A title by the switch) or, with a payer
 * claim, the SV-A5 split. Deposits are applied through the existing advance adjustment once the bill is issued; an
 * excess deposit is refunded by the existing refund voucher. Working papers — verify with your CA (SV3, SV4, SV9).
 */
import './sv-registry';
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { AdvanceRecord } from '../../types/advances';
import type { Admission, ClinicRoom, IpdCharge, SvClass } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { num, round2 } from '../invoice-calc';
import { HOSPITAL_ROOM_RULES } from '../service-rules';
import { ruleAt } from '../tax-rules';
import { advanceBalance, applyAdvance, invoiceOpen, loadAdvances } from '../advances';
import { localDb } from '../localDb';
import { esc } from '../voucher-print';
import { fefoBatch, loadTracking } from '../stock-tracking';
import { doctorsDb } from '../retail/rt-pharmacy-rx';
import { billClaim, loadClaims } from './sv-claims';
import { doctorStaff } from './sv-opd';
import { clinicDraft, clinicLine, dayDiff, liveInvoice, patientClient, uhidOf } from './sv-patients';
import { SV_SERIES, SV_TABLES } from './sv-shared';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

export const IPD = SV_SERIES.admissions;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const loadAdmissions = (): Admission[] => getTable<Admission>(SV_TABLES.admissions).filter((a) => !!a && typeof a.id === 'string');

/** Room-days: midnights crossed (midnight census) or started 24 h periods; a same-day stay is one day. */
export function roomDays(admit: string, admitTime: string | undefined, discharge: string, dischargeTime: string | undefined, mode: 'midnight' | '24h' = 'midnight'): number {
  const d = dayDiff(admit, discharge);
  if (mode === 'midnight') return Math.max(1, d);
  const mins = (t?: string) => (/^\d{2}:\d{2}$/.test(t ?? '') ? +t!.slice(0, 2) * 60 + +t!.slice(3) : 0);
  return Math.max(1, Math.ceil((d * 1440 + mins(dischargeTime) - mins(admitTime)) / 1440));
}

/** SV3 room-rent test (pure): the room charge per day alone decides; ICU kinds are always exempt. */
export function roomClass(room: Pick<ClinicRoom, 'kind'>, ratePerDay: number, date: string): { cls: SvClass; rate: number; sac: string } {
  const r = ruleAt(HOSPITAL_ROOM_RULES, date);
  if (!r || r.exemptKinds.includes(room.kind) || num(ratePerDay) <= r.threshold) return { cls: 'hospital_room_low', rate: 0, sac: '9993' };
  return { cls: 'hospital_room_high', rate: r.rate, sac: r.sac };
}

/** The bill lines of an admission up to `until` (discharge, else that day): room-days, then the charges. */
export function admissionLines(a: Admission, until: string, mode: 'midnight' | '24h' = 'midnight'): InvoiceItem[] {
  const end = a.discharge_date || until;
  const lines: InvoiceItem[] = [];
  if (a.room && num(a.room.rate) > 0) {
    const days = roomDays(a.admit_date, a.admit_time, end, a.discharge_time, mode);
    const c = roomClass(a.room, a.room.rate, a.admit_date);
    lines.push(clinicLine(`Room — ${a.room.name} (${days} day${days === 1 ? '' : 's'})`, num(a.room.rate), { qty: days, cls: c.cls, hsn: c.sac, taxRate: c.rate, date: end }));
  }
  for (const ch of a.charges ?? []) {
    const doc = ch.doctor_id ? doctorsDb.get(ch.doctor_id) : undefined;
    const l = clinicLine(ch.name, num(ch.rate), { qty: num(ch.qty) || 1, date: ch.date, hsn: ch.hsn, goods: !!ch.item_id, ...doctorStaff(doc) });
    lines.push(ch.batch_no ? { ...l, batch_no: ch.batch_no } : l);
  }
  return lines;
}

/** Gross of lines (tax at the line rate, before round-off). */
export const linesGross = (lines: readonly InvoiceItem[]): number => round2(lines.reduce((s, l) => s + num(l.quantity) * num(l.rate) * (1 + num(l.tax_rate) / 100), 0));

/** Deposits still open on the admission (advance balance). */
export function depositsOpen(a: Pick<Admission, 'deposits'>, advances: readonly AdvanceRecord[] = loadAdvances(), payments: readonly Payment[] = localDb.payments.getAll(), invoices: readonly InvoiceRecord[] = localDb.invoices.getAll()): number {
  return round2((a.deposits ?? []).reduce((s, id) => {
    const adv = advances.find((x) => x.id === id);
    return s + (adv ? advanceBalance(adv, payments, invoices).open : 0);
  }, 0));
}

export type AdmissionInput = Pick<Admission, 'admit_date' | 'patient_name'> & Partial<Pick<Admission, 'id' | 'admit_time' | 'patient_id' | 'doctor_ids' | 'room' | 'claim_id' | 'deposits' | 'referrer'>>;

/** Admit (new number) or edit the admission's header. */
export function saveAdmission(i: AdmissionInput): Admission {
  requireAccess('doc.create');
  if (!DAY.test(i.admit_date)) throw new Error('Choose the admission date.');
  if (!i.patient_name.trim()) throw new Error('Choose the patient.');
  const all = loadAdmissions();
  const prev = i.id ? all.find((a) => a.id === i.id) : undefined;
  if (prev?.status === 'billed') throw new Error(`Admission ${prev.number} is billed.`);
  if (prev) {
    const row: Admission = { ...prev, ...i, id: prev.id, number: prev.number, updated_at: new Date().toISOString() };
    setTable(SV_TABLES.admissions, all.map((a) => (a.id === row.id ? row : a)));
    return row;
  }
  const number = nextSeriesNumberFor(IPD, i.admit_date, all.map((a) => a.number));
  const uhid = uhidOf(i.patient_id ? patientClient(i.patient_id, i.patient_name) : undefined);
  const row: Admission = { ...i, id: generateId(), number, patient_name: i.patient_name.trim(), ...(uhid ? { uhid } : {}), charges: [], status: 'admitted', created_at: new Date().toISOString() };
  return withTablesRollback([SV_TABLES.admissions, 'series_counters'], () => {
    setTable(SV_TABLES.admissions, [...all, row]);
    recordSeries(number);
    return row;
  });
}

const edit = (id: string, fn: (a: Admission) => Admission): Admission => {
  requireAccess('doc.create');
  const all = loadAdmissions();
  const a = all.find((x) => x.id === id);
  if (!a) throw new Error('Admission not found.');
  if (a.status === 'billed') throw new Error(`Admission ${a.number} is billed.`);
  const row = { ...fn(a), updated_at: new Date().toISOString() };
  setTable(SV_TABLES.admissions, all.map((x) => (x.id === id ? row : x)));
  return row;
};

/** Add a charge to the running list (a stock item gets its FEFO batch unless one is given). */
export function addCharge(id: string, c: Omit<IpdCharge, 'id'>): Admission {
  if (!c.name.trim() || !(num(c.qty) > 0) || num(c.rate) < 0) throw new Error('Give the charge a name, a quantity and a rate.');
  const batch = c.item_id && !c.batch_no ? fefoBatch(loadTracking().get(c.item_id), c.date)?.batch : undefined;
  return edit(id, (a) => ({ ...a, charges: [...(a.charges ?? []), { ...c, ...(batch ? { batch_no: batch } : {}), name: c.name.trim(), id: generateId() }] }));
}
export const removeCharge = (id: string, chargeId: string): Admission => edit(id, (a) => ({ ...a, charges: a.charges.filter((c) => c.id !== chargeId) }));
export const attachDeposit = (id: string, advanceId: string): Admission => edit(id, (a) => ({ ...a, deposits: [...new Set([...(a.deposits ?? []), advanceId])] }));

/** Discharge (date-time); the final bill follows. */
export function discharge(id: string, date: string, time?: string): Admission {
  if (!DAY.test(date)) throw new Error('Choose the discharge date.');
  return edit(id, (a) => {
    if (date < a.admit_date) throw new Error('Discharge cannot be before admission.');
    return { ...a, discharge_date: date, ...(time ? { discharge_time: time } : {}), status: 'discharged' };
  });
}

/** Data-layer delete (recycle bin); a billed admission is kept. Its number stays used. */
export function deleteAdmission(id: string): void {
  requireAccess('doc.create');
  const a = loadAdmissions().find((x) => x.id === id);
  if (a && liveInvoice(a.invoice_id)) throw new Error(`Admission ${a.number} has a bill. Cancel the bill instead.`);
  setTable(SV_TABLES.admissions, loadAdmissions().filter((x) => x.id !== id));
}

/**
 * Final bill (one draft, the Rule 46A title by the switch) — or, with a payer claim, the two SV-A5 bills (the draft
 * becomes the patient's part, so no number is skipped). The admission becomes billed.
 */
export function finalBill(id: string, date: string, mode: 'midnight' | '24h' = 'midnight'): { bill: InvoiceRecord; payer?: InvoiceRecord } {
  requireAccess('doc.create');
  const a = loadAdmissions().find((x) => x.id === id);
  if (!a) throw new Error('Admission not found.');
  if (a.status === 'billed' && liveInvoice(a.invoice_id)) throw new Error(`Admission ${a.number} is already billed.`);
  if (!a.discharge_date) throw new Error('Discharge the patient first (the interim bill is a print).');
  const lines = admissionLines(a, date, mode);
  if (!lines.length) throw new Error('No charges to bill.');
  return withTablesRollback([SV_TABLES.admissions, SV_TABLES.claims, 'invoices', 'series_counters'], () => {
    const sv = { admission: { id: a.id, number: a.number, admit_date: a.admit_date, discharge_date: a.discharge_date }, ...(a.uhid ? { visit: { id: a.id, uhid: a.uhid } } : {}), ...(a.referrer?.name ? { referrer: a.referrer } : {}) };
    const draft = clinicDraft(patientClient(a.patient_id, a.patient_name), lines, date, sv);
    let bill = draft;
    let payer: InvoiceRecord | undefined;
    const claim = a.claim_id ? loadClaims().find((c) => c.id === a.claim_id) : undefined;
    if (claim && claim.approved > 0) {
      const r = billClaim(claim.id, draft.items, { approved: claim.approved, total: num(draft.total) }, date, draft);
      bill = r.beneficiary ?? r.payer ?? draft;
      payer = r.beneficiary ? r.payer : undefined;
    }
    setTable(SV_TABLES.admissions, loadAdmissions().map((x) => (x.id === a.id ? { ...x, status: 'billed' as const, invoice_id: bill.id, updated_at: new Date().toISOString() } : x)));
    return { bill, payer };
  });
}

/** Apply the open deposits to the issued patient bill (existing advance adjustment); returns the amount applied. */
export function applyDeposits(id: string, date?: string): number {
  const a = loadAdmissions().find((x) => x.id === id);
  const inv = a?.invoice_id ? localDb.invoices.getById(a.invoice_id) : undefined;
  if (!a || !inv) throw new Error('Make the final bill first.');
  let applied = 0;
  for (const advId of a.deposits ?? []) {
    const fresh = localDb.invoices.getById(inv.id)!;
    const owed = invoiceOpen(fresh);
    const adv = loadAdvances().find((x) => x.id === advId);
    if (!adv || owed <= 0) continue;
    const amount = Math.min(owed, advanceBalance(adv, localDb.payments.getAll(), localDb.invoices.getAll()).open);
    if (amount > 0) {
      applyAdvance({ advanceId: advId, invoiceId: inv.id, amount, ...(date ? { date } : {}) });
      applied = round2(applied + amount);
    }
  }
  return applied;
}

/** Interim bill (a print, not a document): charges to date less open deposits. */
export function interimHtml(a: Admission, o: { asOn: string; business: string; deposits: number; mode?: 'midnight' | '24h'; money: (n: number) => string }): string {
  const lines = admissionLines(a, o.asOn, o.mode);
  const gross = linesGross(lines);
  const rows = lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="n">${num(l.quantity)}</td><td class="n">${esc(o.money(num(l.rate)))}</td><td class="n">${num(l.tax_rate) ? `${num(l.tax_rate)}%` : 'Exempt'}</td><td class="n">${esc(o.money(round2(num(l.quantity) * num(l.rate) * (1 + num(l.tax_rate) / 100))))}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Interim bill ${esc(a.number)}</title><style>${PRINT_FONT_FACE}body{font:11pt ${PRINT_FONT};margin:14mm}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #999;padding:4px;text-align:left}.n{text-align:right}</style></head><body><h2>${esc(o.business)}</h2><p><strong>Interim bill — not a tax invoice</strong> · ${esc(a.number)} · ${esc(a.patient_name)}${a.uhid ? ` · UHID ${esc(a.uhid)}` : ''} · admitted ${esc(a.admit_date)} · as on ${esc(o.asOn)}</p><table><thead><tr><th>Charge</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">GST</th><th class="n">Amount</th></tr></thead><tbody>${rows}</tbody></table><p class="n">Charges ${esc(o.money(gross))} · Less deposits ${esc(o.money(o.deposits))} · <strong>Balance ${esc(o.money(round2(gross - o.deposits)))}</strong></p></body></html>`;
}

/** Bell rows: admissions open more than 7 days; deposits short of charges by more than the alert limit. */
export function ipdNotices(all: readonly Admission[], today: string, depositAlert: number, deposits: (a: Admission) => number): { kind: 'long' | 'deposit'; a: Admission; gap?: number }[] {
  const out: { kind: 'long' | 'deposit'; a: Admission; gap?: number }[] = [];
  for (const a of all) {
    if (a.status !== 'admitted') continue;
    if (dayDiff(a.admit_date, today) > 7) out.push({ kind: 'long', a });
    if (depositAlert > 0) {
      const gap = round2(linesGross(admissionLines(a, today)) - deposits(a));
      if (gap > depositAlert) out.push({ kind: 'deposit', a, gap });
    }
  }
  return out;
}
