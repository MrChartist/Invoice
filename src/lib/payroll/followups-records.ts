/**
 * Payroll follow-ups (7T) — tolerant readers for `payroll_relief89` (Form 10E workings) and
 * `actuarial_valuations` (the actuary's gratuity / leave figures). Malformed rows are skipped.
 * No writes here (see `followups-store.ts`).
 */

import { num, round2 } from '../invoice-calc';
import { getTable } from '../storage';
import type { ActuarialValuation, Relief89Record, Relief89Year, TaxRegime } from '../../types/payroll';
import { PAYROLL_TABLES, day, obj, opt, str } from './records';

const n2 = (v: unknown) => round2(num(v));
const regime = (v: unknown): TaxRegime => (v === 'old' ? 'old' : 'new');
const fyYear = (v: unknown): number | null => {
  const n = Math.trunc(num(v));
  return n >= 1990 && n <= 2200 ? n : null;
};

export function normalizeRelief89(rows: unknown[]): Relief89Record[] {
  const out: Relief89Record[] = [];
  for (const r of rows) {
    const o = obj(r);
    const fy = fyYear(o?.fy);
    if (!o || !str(o.id) || !str(o.employee_id) || fy === null) continue;
    const years: Relief89Year[] = Array.isArray(o.years)
      ? (o.years as unknown[]).map(obj).flatMap((y) => {
          const yfy = fyYear(y?.fy);
          return y && yfy !== null && yfy < fy ? [{ fy: yfy, regime: regime(y.regime), income: n2(y.income), arrears: Math.max(0, n2(y.arrears)) }] : [];
        })
      : [];
    out.push({
      id: str(o.id),
      employee_id: str(o.employee_id),
      fy,
      regime: regime(o.regime),
      income_with: n2(o.income_with),
      years,
      relief: Math.max(0, n2(o.relief)),
      apply_tds: o.apply_tds === true,
      ...(opt(o.note) ? { note: opt(o.note) } : {}),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
    });
  }
  return out;
}

export function normalizeActuarial(rows: unknown[]): ActuarialValuation[] {
  const out: ActuarialValuation[] = [];
  for (const r of rows) {
    const o = obj(r);
    const date = day(o?.date);
    if (!o || !str(o.id) || !date) continue;
    const optNum = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(num(v)) ? undefined : n2(v));
    const assets = optNum(o.plan_assets);
    const disc = optNum(o.discount_rate);
    const esc = optNum(o.salary_escalation);
    out.push({
      id: str(o.id),
      number: str(o.number),
      kind: o.kind === 'leave' ? 'leave' : 'gratuity',
      standard: o.standard === 'indas19' ? 'indas19' : 'as15',
      date,
      actuary: str(o.actuary),
      ...(opt(o.report_ref) ? { report_ref: opt(o.report_ref) } : {}),
      ...(disc !== undefined ? { discount_rate: disc } : {}),
      ...(esc !== undefined ? { salary_escalation: esc } : {}),
      opening: n2(o.opening),
      current_service_cost: n2(o.current_service_cost),
      interest_cost: n2(o.interest_cost),
      past_service_cost: n2(o.past_service_cost),
      benefits_paid: n2(o.benefits_paid),
      actuarial_loss: n2(o.actuarial_loss),
      closing: n2(o.closing),
      ...(assets !== undefined ? { plan_assets: assets } : {}),
      book_balance: n2(o.book_balance),
      ...(opt(o.voucher_id) ? { voucher_id: opt(o.voucher_id) } : {}),
      ...(opt(o.voucher_number) ? { voucher_number: opt(o.voucher_number) } : {}),
      ...(opt(o.note) ? { note: opt(o.note) } : {}),
      created_at: str(o.created_at),
      ...(str(o.updated_at) ? { updated_at: str(o.updated_at) } : {}),
    });
  }
  return out;
}

export const loadRelief89 = () => normalizeRelief89(getTable<unknown>(PAYROLL_TABLES.relief89));
export const loadActuarial = () => normalizeActuarial(getTable<unknown>(PAYROLL_TABLES.actuarial));
