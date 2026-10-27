/**
 * SV-A4 service tax classes (pure, lazy): class → suggested rate / SAC / Table 8 column by document date (never over a
 * typed rate); the Rule 46A decision; the 5%-without-ITC caution on purchase bills; the Rule 42 "exempt-like" no-ITC
 * turnover; the composition notice; the exceptions-report checks. Working papers — verify with your CA (SV2, SV3, SV5,
 * SV11, SV12, SV13).
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ServiceSettings, SvClass, SvExempt } from '../../types/services-r10';
import { COMPOSITION_SERVICE_NOTE_RULES, NO_ITC_CLASSES, SERVICE_CLASS_RULES, serviceClassAt, type ServiceClassRate } from '../service-rules';
import { ruleAt } from '../tax-rules';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { isoDay } from '../dates';

export const SV_CLASSES: readonly SvClass[] = ['health_exempt', 'health_cosmetic', 'hospital_room_low', 'hospital_room_high', 'beauty_9997', 'fitness_9997', 'education_exempt', 'coaching', 'repair_9987', 'charitable_yoga'];

/** The first date a class became "without ITC" ('' if never). */
export const noItcFrom = (cls: SvClass): string => SERVICE_CLASS_RULES.find((r) => r.value[cls].noItc)?.from ?? '';

/**
 * Line patch when a class is picked on a line dated `date`: SAC when blank, the class rate unless the user typed one
 * (`typed`), and `sv.exempt` for a 0% exempt class. The class is snapshotted on the line (`sv.cls`).
 */
export function classPatch(line: Pick<InvoiceItem, 'hsn' | 'tax_rate' | 'sv'>, cls: SvClass | '', date: string, typed = false): Partial<InvoiceItem> {
  const sv = { ...line.sv };
  if (!cls) {
    delete sv.cls;
    delete sv.exempt;
    return { sv: Object.keys(sv).length ? sv : undefined };
  }
  const c: ServiceClassRate = serviceClassAt(cls, date);
  const rate = typed ? num(line.tax_rate) : c.rate;
  sv.cls = cls;
  if (rate === 0 && c.exempt) sv.exempt = c.exempt;
  else delete sv.exempt;
  return { ...(line.hsn?.trim() ? {} : { hsn: c.sac }), ...(typed ? {} : { tax_rate: c.rate }), sv };
}

/** Table 8 column of a 0% line: the line's own `sv.exempt`; '' = nil-rated (unchanged default). */
export const lineExempt = (l: Pick<InvoiceItem, 'sv'>): SvExempt | '' => l.sv?.exempt ?? '';

/**
 * Rule 46A: an "Invoice-cum-Bill of Supply" for a recipient without a GSTIN when the tax invoice carries taxable and
 * exempt / nil lines and the switch was on at save (`sv.rule46a`). Registered recipients get two documents instead.
 */
export function rule46aApplies(inv: Pick<InvoiceRecord, 'doc_type' | 'client' | 'items' | 'sv'>): boolean {
  if (!inv.sv?.rule46a || (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'TAX_INVOICE')) return false;
  if (String(inv.client?.gstin ?? '').trim()) return false;
  const items = (inv.items ?? []).filter((i) => i && (num(i.rate) || num(i.quantity)));
  return items.some((i) => num(i.tax_rate) > 0) && items.some((i) => num(i.tax_rate) === 0);
}

/** Should the editor offer "Split into a tax invoice and a Bill of Supply"? (registered recipient, mixed lines) */
export function offerSplit(inv: Pick<InvoiceRecord, 'doc_type' | 'client' | 'items'>): boolean {
  if (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'TAX_INVOICE') return false;
  const items = inv.items ?? [];
  return !!String(inv.client?.gstin ?? '').trim() && items.some((i) => num(i.tax_rate) > 0) && items.some((i) => num(i.tax_rate) === 0 && !!i.sv?.exempt);
}

const isNoItcLine = (l: InvoiceItem, date: string) => !!l.sv?.cls && NO_ITC_CLASSES.includes(l.sv.cls) && !!serviceClassAt(l.sv.cls, date).noItc;

/** Taxable value of 5%-without-ITC service lines in [from, to] (credit notes net off) — Rule 42 exempt-like turnover. */
export function svExemptLike(invoices: readonly InvoiceRecord[], from: string, to: string, s: Pick<ServiceSettings, 'no_itc_as_exempt'> = {}): number {
  if (s.no_itc_as_exempt === false) return 0;
  let total = 0;
  for (const inv of invoices) {
    const credit = inv?.doc_type === 'CREDIT_NOTE' && inv.status !== 'Draft' && inv.status !== 'Cancelled';
    if (!inv || (!credit && !isRevenueDoc(inv))) continue;
    const day = isoDay(inv.issue_date);
    if (day < from || day > to || !(inv.items ?? []).some((l) => isNoItcLine(l, day))) continue;
    const ids = new Set(inv.items.filter((l) => isNoItcLine(l, day)).map((l) => l.id));
    for (const c of calculateInvoice(calcInputFromRecord(inv)).lines) if (ids.has(c.id)) total += (credit ? -1 : 1) * num(c.taxable);
  }
  return round2(total);
}

/** Has the company sold a no-ITC service class in the FY of `date` (up to that date)? */
export function soldNoItc(invoices: readonly InvoiceRecord[], date: string): boolean {
  const fyStart = `${Number(date.slice(5, 7)) >= 4 ? date.slice(0, 4) : Number(date.slice(0, 4)) - 1}-04-01`;
  return invoices.some((inv) => {
    if (!inv || !isRevenueDoc(inv)) return false;
    const day = isoDay(inv.issue_date);
    return day >= fyStart && day <= date && (inv.items ?? []).some((l) => isNoItcLine(l, day));
  });
}

/** SV12: the caution text for a purchase bill claiming ITC (empty = no caution). */
export function itcCautionFor(bill: { date: string; itc_eligible?: boolean; cgst?: number; sgst?: number; igst?: number; itc_use?: string }, invoices: readonly InvoiceRecord[], s: Pick<ServiceSettings, 'itc_caution'>): boolean {
  if (s.itc_caution === false || !bill.itc_eligible || bill.itc_use === 'taxable_only') return false;
  if (!(num(bill.cgst) + num(bill.sgst) + num(bill.igst) > 0)) return false;
  return soldNoItc(invoices, isoDay(bill.date));
}

/** SV13: a composition service profile selling mostly beauty / fitness classes on or after the 5% date. */
export function compositionNote(invoices: readonly InvoiceRecord[], sender: { gst_scheme?: string; composition_category?: string } | null | undefined, today: string): { composition: number; regular: number } | null {
  const note = ruleAt(COMPOSITION_SERVICE_NOTE_RULES, today);
  if (!note || sender?.gst_scheme !== 'composition') return null;
  let classed = 0;
  let all = 0;
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv)) continue;
    for (const l of inv.items ?? []) {
      all += num(l.amount);
      if (l.sv?.cls === 'beauty_9997' || l.sv?.cls === 'fitness_9997') classed += num(l.amount);
    }
  }
  return all > 0 && classed / all > 0.5 ? note : null;
}

/** Exceptions report rows of one document (`gst-guards.ts`, registered by `sv-hooks.ts`). */
export function svExceptions(inv: InvoiceRecord): { code: 'SV_RATE_OLD' | 'SV_NIL_NOT_EXEMPT'; vars: Record<string, string | number> }[] {
  const out: { code: 'SV_RATE_OLD' | 'SV_NIL_NOT_EXEMPT'; vars: Record<string, string | number> }[] = [];
  const day = isoDay(inv.issue_date);
  for (const l of inv.items ?? []) {
    const cls = l?.sv?.cls;
    if (!cls) continue;
    const c = serviceClassAt(cls, day);
    const rate = num(l.tax_rate);
    if (c.noItc && rate !== c.rate && rate > c.rate) out.push({ code: 'SV_RATE_OLD', vars: { name: l.name, rate, want: c.rate } });
    if (rate === 0 && c.exempt && !l.sv?.exempt) out.push({ code: 'SV_NIL_NOT_EXEMPT', vars: { name: l.name } });
  }
  return out;
}
