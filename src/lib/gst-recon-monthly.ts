/**
 * Month-wise "GSTR-1 vs GSTR-3B vs Books" reconciliation (WP-6, P1-16) — TallyPrime's "Reconciliation of Returns"
 * idea, offline. For each month of an FY:
 *  - GSTR-1 tax: the tax of the GSTR-1 sections (B2B / B2CL / B2CS / EXP ± CDNR / CDNUR, Table 11 advances,
 *    in-month amendment differences), reverse-charge outward supplies left out (the recipient pays);
 *  - GSTR-3B tax: 3.1(a) + 3.1(b);
 *  - Books tax: output GST + cess as booked (`books.ts` `gstSummary`, passed in by the caller);
 *  - ITC: 3B 4C net vs the books' input credit.
 * Differences are expected for amendments of earlier months, advances and documents the books date differently;
 * the table only points at them. Working paper — verify with your CA.
 */

import { buildGstReport, periodLabel, periodRange, type BuildOptions, type Gstr1Report, type Gstr3bReport, type ReportPeriod } from './gst-reports';
import { round2 } from './invoice-calc';
import type { InvoiceRecord } from '../types/invoice';

type T = { igst: number; cgst: number; sgst: number; cess?: number };
const tax = (r: T) => r.igst + r.cgst + r.sgst + (r.cess ?? 0);

/** Output tax reported by a month's GSTR-1 (sign: credit notes negative). */
export function gstr1Tax(g: Gstr1Report): number {
  let t = 0;
  for (const d of g.b2b) if (d.rchrg !== 'Y') t += tax(d);
  for (const d of g.b2cl) t += tax(d);
  for (const r of g.b2cs) t += tax(r);
  for (const d of g.exp) t += tax(d);
  for (const n of g.cdnr) if (n.rchrg !== 'Y') t += (n.noteType === 'C' ? -1 : 1) * tax(n);
  for (const n of g.cdnur) t += (n.noteType === 'C' ? -1 : 1) * tax(n);
  for (const r of g.at ?? []) t += tax(r);
  for (const r of g.txpd ?? []) t -= tax(r);
  for (const e of g.amendments?.effects ?? []) t += tax(e.taxPayable);
  return round2(t);
}

/** Output tax of a month's GSTR-3B (3.1(a) + (b)). */
export function gstr3bTax(b: Gstr3bReport): number {
  return round2(tax(b.outward.taxable) + tax(b.outward.zeroRated));
}

export function gstr3bItc(b: Gstr3bReport): number {
  return round2(tax(b.itc.net));
}

export interface BooksMonth {
  /** Output GST + cess booked in the month (net of credit notes). */
  tax: number;
  /** Input tax credit booked in the month. */
  itc: number;
}

export interface ReconMonthRow {
  period: ReportPeriod;
  label: string;
  from: string;
  to: string;
  g1: number;
  g3b: number;
  books: number | null;
  diff13: number;
  diff3Books: number | null;
  itc3b: number;
  itcBooks: number | null;
  /** All differences within ₹1. */
  ok: boolean;
}

export interface ReconMonthlyOptions extends Omit<BuildOptions, 'period'> {
  fyStart: number;
  /** Books figures for a month (`gstSummary` adapter); omit to leave the books columns empty. */
  books?: (from: string, to: string) => BooksMonth;
  /** Stop after this day (months starting later are left out); default: the whole FY. */
  upTo?: string;
}

export const RECON_TOLERANCE = 1;

export function reconMonthly(invoices: InvoiceRecord[], rawPurchases: unknown[], o: ReconMonthlyOptions): ReconMonthRow[] {
  const { fyStart, books, upTo, ...build } = o;
  const out: ReconMonthRow[] = [];
  for (const month of [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]) {
    const period: ReportPeriod = { kind: 'month', fyStart, month };
    const { from, to } = periodRange(period);
    if (upTo && from > upTo) break;
    const rep = buildGstReport(invoices, rawPurchases, { ...build, period });
    const g1 = gstr1Tax(rep.gstr1);
    const g3b = gstr3bTax(rep.gstr3b);
    const b = books ? books(from, to) : null;
    const diff13 = round2(g1 - g3b);
    const diff3Books = b ? round2(g3b - b.tax) : null;
    const itc3b = gstr3bItc(rep.gstr3b);
    const itcBooks = b ? round2(b.itc) : null;
    const ok = Math.abs(diff13) <= RECON_TOLERANCE
      && (diff3Books === null || Math.abs(diff3Books) <= RECON_TOLERANCE)
      && (itcBooks === null || Math.abs(itc3b - itcBooks) <= RECON_TOLERANCE);
    out.push({ period, label: periodLabel(period), from, to, g1, g3b, books: b ? round2(b.tax) : null, diff13, diff3Books, itc3b, itcBooks, ok });
  }
  return out;
}
