/**
 * R7-C1 hotel GST desk: the rule readers (re-exported from `hotel-rules.ts`, never re-implemented), the restaurant
 * rate by specified-premises status, the room / F&B lines of an invoice and the desk's guards. Pure; a WORKING PAPER —
 * verify with your CA (docs/CA_REVIEW.md §7, HT1–HT6, HT14–HT16).
 *
 * Lines: SAC 996311 (or the hotel's `sac_room`) is accommodation; 99633x (or `sac_fnb`) is restaurant service. A room
 * line's quantity is its unit-nights, so its per-unit-per-day value is taxable ÷ quantity (after discounts, before GST
 * — F3 / D2). The rate is decided on the invoice date (D6).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { calcInputFromRecord, calculateInvoice, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { isNonGstFinancialNote } from '../financial-note';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { ACCOMMODATION_RATE_RULES, HOTEL_RESTAURANT_RATE_RULES, accommodationBand, bandForInclusive, ruleAt } from './hotel-rules';

export {
  ACCOMMODATION_RATE_RULES, HOTEL_RESTAURANT_RATE_RULES, SPECIFIED_PREMISES_RULES, FORM_C_HOURS_RULES,
  accommodationBand, bandForInclusive, formCRule, ruleAt, type BandResult,
} from './hotel-rules';

/** Indian grouping, 2 decimals, no symbol (strings carry the ₹). */
export const rupees = (n: number): string => round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Indian FY (start year) of a local day `YYYY-MM-DD`. */
export const fyOfDay = (day: string): number => (+day.slice(5, 7) >= 4 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);
/** `2026-27`. */
export const fyName = (fy: number): string => `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
export const fyStartOf = (name: string): number => +String(name).slice(0, 4);
export const fyRange = (fy: number) => ({ from: `${fy}-04-01`, to: `${fy + 1}-03-31` });

/** F5: 18% with ITC in specified premises, else 5% without ITC (rule in force on `date`). */
export function restaurantRate(status: { specified: boolean }, date: string): { rate: number; itc: boolean } {
  const r = ruleAt(HOTEL_RESTAURANT_RATE_RULES, date);
  return status.specified ? r.specified : r.other;
}

export interface Sacs { room: string; fnb: string }
export const DEFAULT_SACS: Sacs = { room: '996311', fnb: '996331' };

export interface HotelLine {
  kind: 'room' | 'fnb';
  qty: number;
  taxable: number;
  rate: number;
  /** Per-unit value (taxable ÷ quantity). */
  unit: number;
}

/** Room and F&B lines of a document (taxable after discounts, rate as charged). */
export function hotelLines(inv: InvoiceRecord, sac: Sacs = DEFAULT_SACS): HotelLine[] {
  return calculateInvoice(calcInputFromRecord(inv)).lines.flatMap((l) => {
    const hsn = String(l.hsn ?? '').replace(/\s/g, '');
    const kind = hsn.startsWith('996311') || hsn === sac.room ? 'room' : hsn.startsWith('99633') || hsn === sac.fnb ? 'fnb' : null;
    if (!kind) return [];
    const qty = Math.abs(Number(l.quantity)) || 1;
    return [{ kind, qty, taxable: l.taxable, rate: l.nominal_rate ?? l.tax_rate, unit: round2(l.taxable / qty) }];
  });
}

/** A GST document the desk reads: revenue documents (+1) and GST credit notes (−1); composition / BoS left out (D17). */
export function docSign(inv: InvoiceRecord): number {
  if (inv.doc_type === 'BILL_OF_SUPPLY' || inv.sender?.gst_scheme === 'composition') return 0;
  if (isRevenueDoc(inv)) return 1;
  return inv.doc_type === 'CREDIT_NOTE' && inv.status !== 'Draft' && inv.status !== 'Cancelled' && !isNonGstFinancialNote(inv) ? -1 : 0;
}

/** 'high' when charged at the top band's rate (else 'low'); a rate no band has falls back to the value test. */
export function lineBand(l: Pick<HotelLine, 'rate' | 'unit'>, date: string): 'low' | 'high' {
  const { bands } = ruleAt(ACCOMMODATION_RATE_RULES, date);
  if (!bands.some((b) => b.rate === l.rate)) return accommodationBand(l.unit, date).band;
  return l.rate === bands[bands.length - 1].rate ? 'high' : 'low';
}

/** No-ITC turnover of a line (D12): a room line at a no-ITC (non-exempt) band rate, or F&B at the "other" rate. */
export function noItcValue(l: HotelLine, date: string): number {
  if (l.kind === 'room') {
    const b = ruleAt(ACCOMMODATION_RATE_RULES, date).bands.find((x) => x.rate === l.rate);
    return b && !b.itc && !b.exempt ? l.taxable : 0;
  }
  const r = ruleAt(HOTEL_RESTAURANT_RATE_RULES, date);
  return !r.other.itc && l.rate === r.other.rate && l.rate !== r.specified.rate ? l.taxable : 0;
}

export interface Guard {
  kind: 'band' | 'fnb' | 'igst' | 'itc';
  number: string;
  date: string;
  expect?: number;
  got?: number;
  amount?: number;
}

const inRange = (d: string | undefined, from: string, to: string) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to;

/**
 * The desk's guards for invoices dated `from`…`to`: a room line whose rate disagrees with its band (an extra-bed /
 * person line may ride at the rate of a room line that passes), F&B whose rate disagrees with `restaurantRate`, an
 * IGST hotel invoice (F6: place of supply = the property; F&B judged by the invoice's own premises, QA9 H4), and ITC claimed on bills while every room-night of the
 * period sits in a no-ITC band (one row, with the ITC total).
 */
export function hotelGuards(invoices: readonly InvoiceRecord[], purchases: readonly unknown[], specified: (fy: number, inv: InvoiceRecord) => boolean, from: string, to: string, sac: Sacs = DEFAULT_SACS): Guard[] {
  const out: Guard[] = [];
  let rooms = 0;
  let noItcRooms = 0;
  for (const inv of invoices) {
    const date = String(inv.issue_date ?? '').slice(0, 10);
    if (!inRange(date, from, to) || docSign(inv) !== 1) continue;
    const lines = hotelLines(inv, sac);
    if (!lines.length) continue;
    const g = { number: inv.invoice_number, date };
    if (inv.gst_mode === 'IGST') out.push({ kind: 'igst', ...g });
    const room = lines.filter((l) => l.kind === 'room');
    const ok = room.filter((l) => l.rate === accommodationBand(l.unit, date).rate).map((l) => l.rate);
    for (const l of room) {
      const expect = accommodationBand(l.unit, date).rate;
      rooms++;
      if (noItcValue(l, date)) noItcRooms++;
      // An extra bed / person line rides at a passing room line's higher rate (D2: one unit-day value).
      // QA9 H2: a tax-inclusive night in the band gap is charged at the higher band on a value below the limit — the
      // app's own check-out (hotel_band high / mixed) passes when that rate is the inclusive solve of its gross.
      const gap = inv.hotel_band !== 'low' && !!inv.hotel_band && bandForInclusive(round2(l.unit * (1 + l.rate / 100)), date).rate === l.rate;
      if (l.rate !== expect && !(ok.includes(l.rate) && l.rate > expect) && !gap) out.push({ kind: 'band', ...g, expect, got: l.rate, amount: l.unit });
    }
    const fnb = restaurantRate({ specified: specified(fyOfDay(date), inv) }, date).rate;
    for (const l of lines) if (l.kind === 'fnb' && l.rate !== fnb) out.push({ kind: 'fnb', ...g, expect: fnb, got: l.rate });
  }
  if (rooms > 0 && noItcRooms === rooms) {
    let itc = 0;
    for (const raw of purchases) {
      const p = readPurchase(raw);
      if (!p || isVoidStatus(p.status) || !p.itcEligible || p.reverseCharge || !inRange(p.date, from, to)) continue;
      itc += Math.max(0, p.tax - p.itcReversed);
    }
    if (itc > 0) out.push({ kind: 'itc', number: '', date: to, amount: round2(itc) });
  }
  return out;
}
