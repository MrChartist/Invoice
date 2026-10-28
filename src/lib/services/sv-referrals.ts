/**
 * SV-B4 referring doctors and visiting consultants.
 *  - Referral report (by doctor and period): patients, visits / orders / admissions and bill value from the documents'
 *    `sv.referrer` snapshot; CSV. No payout field on the referral report.
 *  - Visiting consultant fee-share: the doctor's `share` (% of the lines they did, or ₹ per visit) through the SV-A3
 *    commission engine with a fee-share plan; the payout goes through `staff_payouts` (SV-A3: a journal with opt-in TDS
 *    194J for a freelance doctor, threshold and rate from the TDS engine), so it is never posted twice.
 *  - Referral payments (only with `clinic_settings.record_referral_payments` on, default off): a journal to the ledger
 *    "Referral fees — disallowable (Sec 37)" with a permanent caution; benefits in kind above ₹20,000 a year to one doctor
 *    prompt a 194R reminder (a warning only). Working papers — verify with your CA (SV8).
 */
import './sv-registry';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { Doctor } from '../../types/retail-r9';
import type { Admission, ClinicVisit, CommissionPlan, LabOrder, ServiceStaff, StaffPayout } from '../../types/services-r10';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { isoDay } from '../dates';
import { getIndianFY } from '../invoice-number';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { loadVouchers, saveVoucher } from '../ledger/vouchers';
import { REFERRAL_CAUTION_RULES } from '../service-rules';
import { ruleAt } from '../tax-rules';
import { commissionFor, type Statement } from './sv-commission';
import { postPayout } from './sv-payouts';

export interface ReferralRow { key: string; name: string; patients: number; documents: number; value: number }
type Ref = { referrer?: { doctor_id?: string; name?: string } };
const keyOf = (r: Ref['referrer']) => r?.doctor_id || (r?.name ?? '').trim().toLowerCase();

/** Referral report: by referring doctor, documents dated in [from, to]; bill value from live revenue documents. */
export function referralReport(d: { invoices: readonly InvoiceRecord[]; visits: readonly ClinicVisit[]; orders: readonly LabOrder[]; admissions: readonly Admission[] }, from: string, to: string): ReferralRow[] {
  const by = new Map<string, ReferralRow & { pts: Set<string> }>();
  const touch = (r: Ref['referrer'], patient: string) => {
    const k = keyOf(r);
    if (!k) return undefined;
    const row = by.get(k) ?? { key: k, name: r!.name || k, patients: 0, documents: 0, value: 0, pts: new Set<string>() };
    row.pts.add(patient);
    by.set(k, row);
    return row;
  };
  const inRange = (day: string) => day >= from && day <= to;
  const docs: [Ref['referrer'], string, string][] = [
    ...d.visits.map((v) => [v.referrer, v.date, v.patient_id || v.patient_name] as [Ref['referrer'], string, string]),
    ...d.orders.map((o) => [o.referrer, o.date, o.patient_id || o.patient_name] as [Ref['referrer'], string, string]),
    ...d.admissions.map((a) => [a.referrer, a.admit_date, a.patient_id || a.patient_name] as [Ref['referrer'], string, string]),
  ];
  for (const [r, day, pt] of docs) {
    const row = inRange(day) ? touch(r, pt) : undefined;
    if (row) row.documents += 1;
  }
  for (const inv of d.invoices) {
    const day = isoDay(inv?.issue_date);
    if (!inv || !isRevenueDoc(inv) || !inRange(day)) continue;
    const row = touch(inv.sv?.referrer, inv.client?.id || inv.client?.name || '');
    if (row) row.value = round2(row.value + num(inv.total));
  }
  return [...by.values()].map(({ pts, ...r }) => ({ ...r, patients: pts.size })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

export const referralCsvRows = (rows: readonly ReferralRow[]): (string | number)[][] => [['Referring doctor', 'Patients', 'Visits / orders / admissions', 'Bill value'], ...rows.map((r) => [r.name, r.patients, r.documents, r.value])];

/** Fee-share statement of a visiting consultant for a month (lines carrying the doctor's staff link). */
export function feeShare(doctor: Pick<Doctor, 'staff_id' | 'share'>, month: string, invoices: readonly InvoiceRecord[], payments: readonly Payment[] = []): Statement {
  const empty: Statement = { lines: [], base: 0, serviceBase: 0, commission: 0, uplift: 0, tips: 0, total: 0 };
  if (!doctor.staff_id || !(num(doctor.share?.pct) > 0 || num(doctor.share?.per_visit) > 0)) return empty;
  const pct = num(doctor.share?.pct);
  const plan: CommissionPlan = { id: 'fee-share', name: 'Fee share', basis: 'invoice', rules: [{ kind: 'service', pct }, { kind: 'product', pct: 0 }], created_at: '' };
  const st = commissionFor({ id: doctor.staff_id, plan_id: plan.id }, month, { invoices, payments, plans: [plan] });
  if (pct > 0) return st;
  // ₹ per visit: one per bill (a credit note takes one back).
  const bills = new Map<string, number>();
  for (const l of st.lines) if (!l.tip) bills.set(l.invoice_id, Math.sign(l.base) || 1);
  const per = num(doctor.share?.per_visit);
  const lines = st.lines.map((l) => (l.tip ? l : { ...l, rate: `₹${per} / visit`, amount: 0 }));
  const seen = new Set<string>();
  for (const l of lines) if (!l.tip && !seen.has(l.invoice_id)) { seen.add(l.invoice_id); l.amount = round2(per * (bills.get(l.invoice_id) ?? 1)); }
  const total = round2(lines.reduce((s, l) => s + (l.tip ? 0 : l.amount), 0));
  return { ...st, lines, commission: total, uplift: 0, total: round2(total + st.tips) };
}

/** Pay a consultant's month through `staff_payouts` (journal; opt-in TDS 194J for a freelance doctor). */
export function payFeeShare(staff: ServiceStaff, month: string, st: Statement, date: string, tds: boolean): StaffPayout {
  return postPayout({ ...staff, role: 'doctor', tds_section: staff.tds_section || '194J' }, month, st, { date, payrollOn: false, tds });
}

/** SV8 rule of a date (ledger name, caution text, 194R limit). */
export const referralRule = (date: string) => ruleAt(REFERRAL_CAUTION_RULES, date);

function referralAccount(name: string): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = 6297;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group: 'INDIRECT_EXPENSES' }).id;
}

const REF_CLASS = 'Referral fee (disallowable)';
const BENEFIT_CLASS = 'Referral benefit (disallowable)';

/** Referral payments / benefits booked to a doctor in the FY of `date` (from the journals' class and party). */
export function referralBooked(doctorName: string, date: string, kind: 'cash' | 'benefit' | 'all' = 'all'): number {
  const fy = getIndianFY(date).label;
  const want = kind === 'cash' ? [REF_CLASS] : kind === 'benefit' ? [BENEFIT_CLASS] : [REF_CLASS, BENEFIT_CLASS];
  return round2(loadVouchers().filter((v) => want.includes(v.voucher_class ?? '') && getIndianFY(v.date).label === fy)
    .reduce((s, v) => s + v.lines.filter((l) => l.party === doctorName).reduce((x, l) => x + num(l.cr), 0) / 100, 0));
}

/** True when benefits in kind to the doctor in the FY pass the 194R limit (a reminder; nothing is deducted). */
export const needs194R = (doctorName: string, date: string, adding = 0): boolean => referralBooked(doctorName, date, 'benefit') + num(adding) > referralRule(date).benefitLimit;

/** Book a referral payment / benefit (switch on only): Dr the disallowable ledger, Cr the doctor (Sundry creditors). */
export function bookReferral(doctor: Pick<Doctor, 'name'>, amount: number, date: string, kind: 'cash' | 'benefit', switchOn: boolean): { voucher: string; remind194R: boolean } {
  requireAccess('books.edit');
  if (!switchOn) throw new Error('Referral payments are not recorded (Clinic settings). Verify with your CA.');
  const paise = Math.round(num(amount) * 100);
  if (!(paise > 0)) throw new Error('Enter the amount.');
  const rule = referralRule(date);
  const remind194R = kind === 'benefit' && needs194R(doctor.name, date, amount);
  const v = saveVoucher({
    type: 'JOURNAL', date,
    narration: `${kind === 'benefit' ? 'Referral benefit in kind' : 'Referral payment'} to ${doctor.name} — ${rule.caution}`,
    lines: [{ account_id: referralAccount(rule.ledger), dr: paise, cr: 0 }, { account_id: A.creditors, dr: 0, cr: paise, party: doctor.name }],
    voucher_class: kind === 'benefit' ? BENEFIT_CLASS : REF_CLASS,
  });
  return { voucher: v.number, remind194R };
}
