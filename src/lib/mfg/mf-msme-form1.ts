/**
 * MF-D3 MSME Form-1 working paper (MCA; companies only — constitution from the annual-accounts entity, else the name):
 * per half-year (Apr–Sep due 31 Oct, Oct–Mar due 30 Apr — `MSME_FORM1_RULES`), every bill of a micro / small supplier
 * still unpaid at the half-year end more than 45 days after acceptance (the bill date stands in): supplier, PAN, Udyam,
 * bill, amount due, date due, days, amount unpaid at the half-year end, and the reason for delay typed per row (kept in
 * `mfg_settings.form1_reasons`). Bills are read through `msme.msmeBills` (the payables side, unchanged). CSV / XLSX
 * through the caller. Nothing is filed. Pure. Working paper — verify MF23 (form, penalty) with your CA.
 */
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { PurchasePayment } from '../purchases';
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { shiftDay } from '../dates';
import { daysBetween, msmeBills, traderExcluded } from '../msme';
import { MSME_FORM1_RULES } from './mf-d-rules';

export interface Form1Half {
  /** 'H1-2026' = Apr–Sep 2026; 'H2-2026' = Oct 2026 – Mar 2027. */
  id: string;
  from: string;
  to: string;
  /** Filing due date. */
  due: string;
  label: string;
}

/** The half-year containing `day`. */
export function form1Half(day: string): Form1Half {
  const rule = ruleAt(MSME_FORM1_RULES, day);
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7);
  const [h1, h2] = rule.halves;
  if (m >= 4 && m <= 9) return { id: `H1-${y}`, from: `${y}-${h1.from}`, to: `${y}-${h1.to}`, due: `${y}-${h1.due}`, label: `Apr–Sep ${y}` };
  const start = m >= 10 ? y : y - 1;
  return { id: `H2-${start}`, from: `${start}-${h2.from}`, to: `${start + 1}-${h2.to}`, due: `${start + 1}-${h2.due}`, label: `Oct ${start} – Mar ${start + 1}` };
}

/** The half-year before `h`. */
export const previousHalf = (h: Form1Half): Form1Half => form1Half(shiftDay(h.from, -1));

/** Company by the annual-accounts entity type, else by the name ("… Private Limited", "… Pvt Ltd", "… Limited"). */
export function isCompany(entity: string | undefined, name: string | undefined): boolean {
  if (entity) return entity === 'company';
  return /\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?)\s*$/i.test(String(name ?? '').trim());
}

export interface Form1Row {
  bill_id: string;
  supplier: string;
  pan: string;
  udyam: string;
  category: 'MICRO' | 'SMALL';
  bill: string;
  date: string;
  /** Acceptance + 45 days (the outer limit; the agreed limit may be shorter). */
  dateDue: string;
  amount: number;
  /** Unpaid at the half-year end. */
  unpaid: number;
  /** Days from acceptance to the half-year end. */
  days: number;
  /** Flagged as a trader (MF21) — listed, with a note. */
  trader: boolean;
  reason: string;
}

/** Form-1 rows for half-year `h`: unpaid at `h.to` and outstanding beyond 45 days from acceptance. */
export function form1Rows(
  purchases: readonly PurchaseRecord[], vendors: readonly Vendor[], payments: readonly PurchasePayment[], h: Form1Half, reasons: Readonly<Record<string, string>> = {},
): Form1Row[] {
  const days = ruleAt(MSME_FORM1_RULES, h.to).days;
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const billById = new Map(purchases.map((p) => [p.id, p]));
  const out: Form1Row[] = [];
  for (const b of msmeBills(purchases, vendors, payments, h.to)) {
    const age = daysBetween(b.date, h.to);
    if (!(b.unpaid > 0.005) || age <= days) continue;
    const v = vendorById.get(billById.get(b.id)?.vendor_id ?? '');
    out.push({
      bill_id: b.id, supplier: b.vendorName, pan: (v?.pan ?? '').toUpperCase(), udyam: v?.msme_udyam ?? '', category: b.category,
      bill: b.billNumber, date: b.date, dateDue: shiftDay(b.date, days), amount: b.total, unpaid: round2(b.unpaid), days: age,
      trader: traderExcluded(v), reason: reasons[b.id] ?? '',
    });
  }
  return out.sort((a, b) => a.supplier.localeCompare(b.supplier) || a.date.localeCompare(b.date));
}

/** The sheet (CSV / XLSX rows). */
export function form1Sheet(rows: readonly Form1Row[], h: Form1Half): (string | number)[][] {
  return [
    [`MSME Form-1 working paper — ${h.label} (file by ${h.due}) — verify with your CA (MF23)`],
    ['Supplier', 'PAN', 'Udyam', 'Category', 'Bill', 'Bill date', 'Date due (45 days)', 'Amount', `Unpaid at ${h.to}`, 'Days', 'Reason for delay', 'Note'],
    ...rows.map((r) => [r.supplier, r.pan, r.udyam, r.category, r.bill, r.date, r.dateDue, r.amount, r.unpaid, r.days, r.reason, r.trader ? 'Flagged trader (MF21)' : '']),
  ];
}

/** Filing reminders for the compliance calendar: the next due dates on or after `today` (lazy row group). */
export function form1Dues(today: string, count = 2): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  let h = previousHalf(form1Half(today));
  for (let i = 0; i < 4 && out.length < count; i++) {
    if (h.due >= today) out.push({ date: h.due, label: `MSME Form-1 (${h.label})` });
    h = form1Half(shiftDay(h.to, 1));
  }
  return out;
}
