/**
 * R14 PS-C5: the freelancer's GST registration threshold card. Aggregate turnover of the Indian FY (Apr–Mar, local days):
 * taxable + exempt + exports + inter-State supplies at their INR value, net of credit notes, without tax; inward supplies
 * under reverse charge and pure-agent recoveries (Rule 33) never count. Limit by `REGISTRATION_THRESHOLD_RULES` (₹20 lakh, ₹10 lakh in
 * the listed special-category States), warnings at 80 % and 100 %. Crossing it opens a checklist: register → LUT →
 * tax invoices from the registration date. Pure. Working paper — verify with your CA (PS13).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { isRevenueDoc } from '../stats';
import { isExportDoc } from '../trade/exporter';
import { inrValue } from '../fx';
import { round2 } from '../invoice-calc';
import { thresholdRule } from '../prof-rules';
import { recoveryValue } from '../trade/pure-agent'; // QA17 R3: pure-agent recoveries are no supply

/** Indian FY of a local day. */
export function fyOf(day: string): { start: string; end: string } {
  const y = Number(day.slice(0, 4)) - (day.slice(5, 7) < '04' ? 1 : 0);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}

export interface ThresholdCard {
  start: string;
  end: string;
  turnover: number;
  exports: number;
  limit: number;
  pct: number;
  level: 'ok' | 'warn' | 'over';
  /** Day the running total first went above the limit. */
  crossedOn?: string;
}

export function thresholdCard(invoices: readonly Partial<InvoiceRecord>[], today: string, stateCode?: string): ThresholdCard {
  const { start, end } = fyOf(today);
  const rule = thresholdRule(today);
  const limit = rule.specialStates.includes(String(stateCode ?? '')) ? rule.special : rule.limit;
  const rows = invoices
    .filter((i) => i && (isRevenueDoc(i as InvoiceRecord) || (i.doc_type === 'CREDIT_NOTE' && i.status !== 'Draft' && i.status !== 'Cancelled')))
    .map((i) => ({ day: String(i.issue_date ?? '').slice(0, 10), sign: i.doc_type === 'CREDIT_NOTE' ? -1 : 1, value: inrValue((Number(i.taxable_value ?? i.subtotal) || 0) - recoveryValue(i), i), exp: isExportDoc(i as InvoiceRecord) }))
    .filter((r) => r.day >= start && r.day <= end)
    .sort((a, b) => a.day.localeCompare(b.day));
  let run = 0, exports = 0;
  let crossedOn: string | undefined;
  for (const r of rows) {
    run += r.sign * r.value;
    if (r.exp) exports += r.sign * r.value;
    if (!crossedOn && run > limit) crossedOn = r.day;
  }
  const turnover = round2(run);
  const pct = limit ? Math.round((turnover / limit) * 1000) / 10 : 0;
  return { start, end, turnover, exports: round2(exports), limit, pct, level: turnover > limit ? 'over' : pct >= rule.warnPct ? 'warn' : 'ok', ...(crossedOn ? { crossedOn } : {}) };
}
