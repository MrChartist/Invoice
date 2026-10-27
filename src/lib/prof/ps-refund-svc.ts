/**
 * R14 PS-C3: Rule 89(4) refund working paper for export of services under LUT (PS14). Turnover of zero-rated supply of
 * services for the period = payments received in the period for services exported + advances received earlier for
 * services completed in the period − advances received in the period for services not completed in it (Rule 89(4)(C));
 * on the payment rows that is: money receipts dated in the period + advance adjustments on services invoices issued in
 * the period whose advance came in on or before its end. The maths is the existing `rule894Refund`; "Save as draft
 * claim" writes ONE draft row of the existing refund register (`gst-cash-refunds.ts`, category EXPORT_LUT_ITC), updated
 * in place on a second save. Nothing is filed. Working paper — verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { AdvanceRecord } from '../../types/advances';
import type { Heads } from '../gst-setoff';
import { exportInvoices, isServicesExport } from '../trade/export-register';
import { receiptInr } from '../fx-gain';
import { inrValue } from '../fx';
import { round2 } from '../invoice-calc';
import { movedNoCash } from '../no-cash';
import { isRevenueDoc } from '../stats';
import { loadRefunds, rule894Refund, saveRefund, type GstRefundClaim, type Rule894Result } from '../gst-cash-refunds';
import type { BrcRow } from './ps-brc';

export interface RefundSvcInput {
  from: string;
  to: string;
  invoices: readonly Partial<InvoiceRecord>[];
  payments: readonly Partial<Payment>[];
  advances: readonly Pick<AdvanceRecord, 'id' | 'date'>[];
  netItc: Heads;
  /** Typed adjusted total turnover; absent = domestic taxable turnover of the period + the zero-rated figure. */
  adjustedTotalTurnover?: number;
}
export interface RefundSvcPaper {
  received: number;
  advancesEarlier: number;
  advancesNow: number;
  zeroRated: number;
  domestic: number;
  adjustedTotalTurnover: number;
  result: Rule894Result;
  /** Invoices the zero-rated figure came from. */
  invoiceIds: string[];
}

const inPeriod = (d: unknown, from: string, to: string) => { const s = String(d ?? '').slice(0, 10); return s >= from && s <= to; };

export function refundSvcPaper(i: RefundSvcInput): RefundSvcPaper {
  const lut = new Map((exportInvoices(i.invoices) as InvoiceRecord[]).filter((v) => v.supply_type === 'EXPORT_LUT' && isServicesExport(v)).map((v) => [v.id, v]));
  const advDate = new Map(i.advances.map((a) => [a.id, a.date]));
  let received = 0, advancesEarlier = 0, advancesNow = 0;
  const ids = new Set<string>();
  for (const p of i.payments) {
    const inv = p?.invoice_id ? lut.get(p.invoice_id) : undefined;
    if (!inv || !(Number(p.amount) > 0)) continue;
    const inr = receiptInr({ amount: Number(p.amount), realised_rate: p.realised_rate }, inv);
    if (p.advance_id) {
      const ad = advDate.get(p.advance_id) ?? '';
      if (!inPeriod(inv.issue_date, i.from, i.to) || !ad || ad > i.to) continue;
      if (ad < i.from) advancesEarlier += inr;
      else advancesNow += inr;
    } else if (!movedNoCash(p) && inPeriod(p.date, i.from, i.to)) received += inr;
    else continue;
    ids.add(inv.id);
  }
  const zeroRated = round2(received + advancesEarlier + advancesNow);
  const domestic = round2(i.invoices.filter((v) => v && !lut.has(String(v.id)) && isRevenueDoc(v as InvoiceRecord) && v.doc_type !== 'CREDIT_NOTE' && v.supply_type !== 'EXPORT_LUT' && v.supply_type !== 'EXPORT_WITH_PAYMENT' && inPeriod(v.issue_date, i.from, i.to))
    .reduce((s, v) => s + inrValue(Number(v.taxable_value) || 0, v), 0));
  const att = i.adjustedTotalTurnover !== undefined && i.adjustedTotalTurnover > 0 ? round2(i.adjustedTotalTurnover) : round2(domestic + zeroRated);
  return {
    received: round2(received), advancesEarlier: round2(advancesEarlier), advancesNow: round2(advancesNow), zeroRated, domestic, adjustedTotalTurnover: att,
    result: rule894Refund({ zeroRatedTurnover: zeroRated, adjustedTotalTurnover: att, netItc: i.netItc }),
    invoiceIds: [...ids],
  };
}

export const STATEMENT_HEADER = ['Invoice no.', 'Invoice date', 'Currency', 'Value (FC)', 'Value (₹)', 'FIRA / e-FIRC', 'e-BRC no.', 'e-BRC date', 'Realised (FC)', 'Realised (₹)'];

/** Statement rows (Rule 89(2)(c) annexure style) for the invoices behind the figure. */
export function statementSheet(rows: readonly BrcRow[], ids: readonly string[]): (string | number)[][] {
  const want = new Set(ids);
  return [STATEMENT_HEADER, ...rows.filter((r) => want.has(r.invoiceId)).map((r) => [r.number, r.date, r.currency, r.fcy, r.valueInr, r.fira.join('; '), r.ebrc.map((e) => e.no).join('; '), r.ebrc.map((e) => e.date ?? '').join('; '), r.realisedFcy, r.realisedInr])];
}

const MARK = 'R14 services export statement';

/** Write (or update) the one draft claim of the refund register for this period. */
export function saveDraftClaim(from: string, to: string, paper: RefundSvcPaper, gstin?: string): GstRefundClaim {
  const prev = loadRefunds().find((r) => r.category === 'EXPORT_LUT_ITC' && r.status === 'DRAFT' && r.period_from === from && r.period_to === to && (r.notes ?? '').startsWith(MARK));
  return saveRefund({ id: prev?.id, gstin, category: 'EXPORT_LUT_ITC', period_from: from, period_to: to, relevant_date: to, claimed: paper.result.byHead, notes: `${MARK}: zero-rated ₹${paper.zeroRated} of ₹${paper.adjustedTotalTurnover}` });
}
