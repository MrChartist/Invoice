/**
 * Payroll TDS (section 192) in the /tds challan list (7P). A payroll "TDS on salary" payment may carry
 * its ITNS 281 challan (BSR code, serial); it is shown in the same challan list as the 26Q challans,
 * read-only and marked section 192 — it is booked (and edited) in Payroll → Payments, so the ledger
 * never posts it twice. Form 26Q papers ignore it (no 26Q deduction links to it); salary TDS goes in
 * Form 24Q (Payroll → Reports). Working papers — verify with your CA / TRACES.
 */

import { can } from '../access';
import { round2 } from '../invoice-calc';
import { getTable } from '../storage';
import type { TdsChallan } from '../tds-payables';
import { PAYROLL_TABLES, normalizePayments } from './records';

export const PAYROLL_CHALLAN_PREFIX = 'prp:';

/** True for a challan row that comes from a payroll TDS payment (read-only in /tds). */
export const isPayrollChallan = (c: Pick<TdsChallan, 'id'>): boolean => c.id.startsWith(PAYROLL_CHALLAN_PREFIX);

/**
 * Payroll TDS (192) payments as challan rows. Review L8: without `payroll.view` the rows of one day
 * are folded into a single "Payroll (n entries)" row with the total (no challan details).
 */
export function payrollTdsChallans(rawPayments: readonly unknown[], detail: boolean = can('payroll.view')): TdsChallan[] {
  const rows = payrollTdsDetail(rawPayments);
  if (detail) return rows;
  const byDay = new Map<string, TdsChallan[]>();
  for (const c of rows) byDay.set(c.date, [...(byDay.get(c.date) ?? []), c]);
  return [...byDay.entries()].map(([date, g]) => ({
    id: `${PAYROLL_CHALLAN_PREFIX}agg:${date}`,
    kind: 'TDS' as const,
    date,
    bsr_code: '',
    challan_no: '',
    amount: round2(g.reduce((s, c) => s + c.amount, 0)),
    minor_head: '200' as const,
    method: g[0].method,
    deduction_keys: [],
    notes: `Section 192 — Payroll (${g.length} ${g.length === 1 ? 'entry' : 'entries'})`,
    created_at: g[0].created_at,
  }));
}

function payrollTdsDetail(rawPayments: readonly unknown[]): TdsChallan[] {
  return normalizePayments([...rawPayments])
    .filter((p) => p.kind === 'tds')
    .map((p) => ({
      id: `${PAYROLL_CHALLAN_PREFIX}${p.id}`,
      kind: 'TDS' as const,
      date: p.date,
      bsr_code: p.bsr_code ?? '',
      challan_no: p.challan_no ?? '',
      amount: p.amount,
      minor_head: '200' as const,
      method: p.paid_from === 'cash' ? 'Cash' : 'Bank transfer',
      deduction_keys: [],
      notes: `Section 192 — TDS on salary (payroll payment ${p.number}${p.period ? `, ${p.period}` : ''})`,
      created_at: p.created_at,
    }));
}

/** Read from storage for the /tds screen (fail-soft). */
export function loadPayrollTdsChallans(): TdsChallan[] {
  try {
    return payrollTdsChallans(getTable<unknown>(PAYROLL_TABLES.payments));
  } catch {
    return [];
  }
}
