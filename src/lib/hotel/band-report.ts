/**
 * R7-C1 band report and the common-credit input (D12 / HT4): room-nights and value per band per month from hotel
 * invoices (room lines; quantity = unit-nights), the no-ITC turnover (5% rooms and 5% F&B) and the ITC-band turnover.
 * The no-ITC turnover is treated as **exempt-like** in the R5-C2 Rule 42 / 43 working. Credit notes count negative.
 * Complimentary / house-use rooms are never invoiced, so they are never here (D14). Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import { calcInputFromRecord, calculateInvoice, round2 } from '../invoice-calc';
import { DEFAULT_SACS, docSign, hotelLines, lineBand, noItcValue, type Sacs } from './hotel-gst';

export interface BandCell { nights: number; value: number }
export interface BandRow {
  month: string;
  low: BandCell;
  high: BandCell;
  /** F&B value (any rate). */
  fnb: number;
  /** No-ITC turnover (exempt-like in Rule 42 / 43). */
  noItc: number;
  /** Hotel turnover with ITC (rooms and F&B). */
  withItc: number;
}

const cell = (): BandCell => ({ nights: 0, value: 0 });

export function bandReport(invoices: readonly InvoiceRecord[], from: string, to: string, sac: Sacs = DEFAULT_SACS): BandRow[] {
  const rows = new Map<string, BandRow>();
  for (const inv of invoices) {
    const date = String(inv.issue_date ?? '').slice(0, 10);
    const sign = docSign(inv);
    if (!sign || date < from || date > to) continue;
    for (const l of hotelLines(inv, sac)) {
      const month = date.slice(0, 7);
      const r = rows.get(month) ?? { month, low: cell(), high: cell(), fnb: 0, noItc: 0, withItc: 0 };
      rows.set(month, r);
      const no = noItcValue(l, date);
      r.noItc = round2(r.noItc + sign * no);
      r.withItc = round2(r.withItc + sign * (no || !l.rate ? 0 : l.taxable));
      if (l.kind === 'fnb') r.fnb = round2(r.fnb + sign * l.taxable);
      else {
        const c = r[lineBand(l, date)];
        c.nights += sign * l.qty;
        c.value = round2(c.value + sign * l.taxable);
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** GSTR-1 HSN / SAC summary rows for heading 9963 (accommodation, food and beverage), by SAC and rate. */
export function hsn9963(invoices: readonly InvoiceRecord[], from: string, to: string): { hsn: string; rate: number; qty: number; taxable: number; tax: number }[] {
  const m = new Map<string, { hsn: string; rate: number; qty: number; taxable: number; tax: number }>();
  for (const inv of invoices) {
    const date = String(inv.issue_date ?? '').slice(0, 10);
    const sign = docSign(inv);
    if (!sign || date < from || date > to) continue;
    for (const l of calculateInvoice(calcInputFromRecord(inv)).lines) {
      const hsn = String(l.hsn ?? '').replace(/\s/g, '');
      if (!hsn.startsWith('9963')) continue;
      const rate = l.nominal_rate ?? l.tax_rate;
      const r = m.get(`${hsn}|${rate}`) ?? { hsn, rate, qty: 0, taxable: 0, tax: 0 };
      r.qty += sign * (Number(l.quantity) || 0);
      r.taxable = round2(r.taxable + sign * l.taxable);
      r.tax = round2(r.tax + sign * l.tax);
      m.set(`${hsn}|${rate}`, r);
    }
  }
  return [...m.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}

/** D12: the exempt-like turnover (E) the common-credit working adds for `from`…`to`. */
export const exemptLike = (invoices: readonly InvoiceRecord[], from: string, to: string, sac?: Sacs): number =>
  round2(bandReport(invoices, from, to, sac).reduce((s, r) => s + r.noItc, 0));
