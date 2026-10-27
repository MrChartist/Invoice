/**
 * SV-C3 coaching refund (SV18, MoE guidelines 2024 as reported — verify): a student who leaves midway gets back the
 * fees paid for the UNUSED period pro rata (by days, or by started months), on the refundable heads only (per-instalment
 * heads such as tuition, hostel and mess; once-heads such as registration or material, and heads marked `no_refund`,
 * are kept). Due within 10 days of the request. *Refund* makes GST credit notes against the instalment bills (tax
 * reversed on the taxable part only) and records the request on the student's enrolment (`Enrolment.refund`).
 */
import './sv-registry';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { FeeHead, FeePlan } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { ruleAt } from '../tax-rules';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { withTablesRollback } from '../table-txn';
import { instalmentLines } from '../institutions/fee-plans';
import { applyConcessions } from '../institutions/enrolments';
import { COACHING_REFUND_RULES, type CoachingRefundRule } from '../service-rules';
import { addMonths, daysBetween } from './sv-members';
import { valueNote } from './sv-memberships';

export const refundableHead = (h: FeeHead) => !h.no_refund && h.frequency === 'per_instalment';

/** Started periods from `from` up to `day` (a started month counts in full). */
function periods(from: string, day: string, basis: CoachingRefundRule['basis']): number {
  if (day < from) return 0;
  if (basis === 'days') return daysBetween(from, day) + 1;
  let n = 0;
  while (addMonths(from, n).day <= day) n++;
  return n;
}

export interface RefundCalc {
  used: number;
  total: number;
  /** Refund (taxable): paid − course × used ÷ total, never below zero. */
  amount: number;
  due: string;
  basis: CoachingRefundRule['basis'];
}

/** Pure: the refund of a course `from`…`to` left on `leave` (the last day attended), requested on `request`. */
export function coachingRefund(i: { from: string; to: string; leave: string; request: string; course: number; paid: number; basis?: CoachingRefundRule['basis'] }, rule = ruleAt(COACHING_REFUND_RULES, i.request)): RefundCalc {
  const basis = i.basis ?? rule.basis;
  const total = Math.max(1, periods(i.from, i.to, basis));
  const used = Math.min(total, periods(i.from, i.leave, basis));
  return { used, total, amount: round2(Math.max(0, num(i.paid) - (num(i.course) * used) / total)), due: shiftDay(i.request, rule.dueDays), basis };
}

const refundNames = (plan: FeePlan) => new Set(plan.heads.filter(refundableHead).map((h) => h.name));

/** The student's live fee bills on the plan (no late fees, no notes) and the course / paid totals of refundable heads. */
export function refundBasis(student: Client, plan: FeePlan, invoices: readonly InvoiceRecord[]): { bills: InvoiceRecord[]; course: number; paid: number } {
  const e = (student.enrolments ?? []).find((x) => x.plan_id === plan.id);
  const names = refundNames(plan);
  const course = round2(plan.instalments.reduce((s, _x, i) => s + applyConcessions(instalmentLines(plan, i).filter((l) => names.has(l.head.name)), e?.concessions).reduce((t, l) => t + l.amount - l.discount, 0), 0));
  const bills = invoices.filter((i) => i.fee_plan_id === plan.id && i.client?.id === student.id && !i.late_fee_for && i.doc_type !== 'CREDIT_NOTE' && i.status !== 'Draft' && i.status !== 'Cancelled');
  const paid = round2(bills.reduce((s, b) => s + calculateInvoice(calcInputFromRecord(b)).lines.filter((c) => names.has(b.items.find((l) => l.id === c.id)?.name ?? '')).reduce((t, c) => t + num(c.taxable), 0), 0));
  return { bills, course, paid };
}

/** Make the refund: credit notes spread over the bills by their refundable value; the request goes on the enrolment. */
export function issueCoachingRefund(studentId: string, plan: FeePlan, i: { from: string; to: string; leave: string; request: string; basis?: CoachingRefundRule['basis'] }): { calc: RefundCalc; notes: InvoiceRecord[] } {
  requireAccess('doc.create');
  const s = localDb.clients.getById(studentId);
  const e = s?.enrolments?.find((x) => x.plan_id === plan.id);
  if (!s || !e) throw new Error('The student is not on this fee plan.');
  if (e.refund) throw new Error('A refund is already recorded.');
  const b = refundBasis(s, plan, localDb.invoices.getAll());
  const calc = coachingRefund({ ...i, course: b.course, paid: b.paid });
  const names = refundNames(plan);
  return withTablesRollback(['invoices', 'doc_links', 'series_counters', 'clients'], () => {
    const notes: InvoiceRecord[] = [];
    let left = calc.amount;
    b.bills.forEach((bill, k) => {
      const base = calculateInvoice(calcInputFromRecord(bill)).lines.filter((c) => names.has(bill.items.find((l) => l.id === c.id)?.name ?? '')).reduce((t, c) => t + num(c.taxable), 0);
      const v = k === b.bills.length - 1 ? left : round2(Math.min(left, (calc.amount * base) / (b.paid || 1)));
      left = round2(left - v);
      if (v > 0.004) notes.push(valueNote(bill, v, i.request, `Refund on leaving ${i.leave} (${calc.total - calc.used} of ${calc.total} ${calc.basis} unused)`, (l) => names.has(l.name)));
    });
    const now = localDb.clients.getById(studentId)!;
    localDb.clients.upsert({ ...now, enrolments: (now.enrolments ?? []).map((x) => (x.plan_id === plan.id ? { ...x, refund: { requested: i.request, leave: i.leave, due: calc.due, amount: calc.amount, note_ids: notes.map((n) => n.id) } } : x)) });
    return { calc, notes };
  });
}

/** Mark the refund paid (the money itself is a payment voucher / bank entry the user records). */
export function markRefundPaid(studentId: string, planId: string, date: string): void {
  requireAccess('doc.create');
  const s = localDb.clients.getById(studentId);
  if (s) localDb.clients.upsert({ ...s, enrolments: (s.enrolments ?? []).map((x) => (x.plan_id === planId && x.refund ? { ...x, refund: { ...x.refund, paid_on: date } } : x)) });
}
