/**
 * Sales & purchase reports (Zoho / Vyapar style) — pure, read-only.
 *
 * Everything is derived from the same documents Dashboard, Books and the GST reports read, with
 * the SAME definition of what counts, so the numbers reconcile exactly for any period:
 *
 *   sum(customer.total)          == stats.summarize(period docs).billed   (gross of GST, net of credit notes)
 *   sum(customer.income)         == books.profitAndLoss(period).income    (taxable + charges + round-off)
 *   sum(tax-by-rate cgst+sgst+igst) == books.gstSummary(period).outputTotal
 *   sum(payment modes)           == cash + bank receipts in the Books cash book
 *   sum(expense rows)            == books.profitAndLoss(period).totalExpenses (accrual)
 *
 * Rules shared with Books: sales = INVOICE / TAX_INVOICE that are not Draft / Cancelled;
 * credit notes (live) are netted off on their own issue date; quotations / proformas / challans
 * never count. Only INR documents are summed (amounts in different currencies are never added);
 * `excludedForeign` says how many were left out.
 *
 * Dates are ISO `YYYY-MM-DD` strings compared lexically — never `new Date('YYYY-MM-DD')`.
 */

import {
  calcInputFromRecord,
  calculateInvoice,
  num,
  round2,
  type CalcLine,
} from './invoice-calc';
import { isoDay, localDayOf } from './dates';
import { toCsv } from './csv';
import {
  inPeriod,
  monthLabel,
  monthsIn,
  normalizePurchase,
  purchaseCost,
  purchaseItc,
  type Period,
} from './books';
import type { StockPosition } from './inventory';
import type { InvoiceRecord, Payment } from '../types/invoice';

/* ════════════════════════════════════════════════════════════════
   Documents
   ════════════════════════════════════════════════════════════════ */

export interface SalesLine {
  name: string;
  hsn: string;
  unit: string;
  /** Signed: negative on a credit note. */
  quantity: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  /** cgst + sgst + igst (cess excluded). */
  tax: number;
  /** GST slab actually charged (0 for exempt / nil / export under LUT). */
  rate: number;
}

export interface SalesDoc {
  id: string;
  number: string;
  date: string;
  /** +1 sale, -1 credit note. */
  sign: 1 | -1;
  customerKey: string;
  customerName: string;
  clientId?: string;
  /** Key the Receivables page uses for this party (`/receivables?tab=statements&party=`). */
  partyKey: string;
  /** Signed amounts (credit notes are negative). */
  taxable: number;
  /** GST + cess. */
  tax: number;
  /** Everything else in the total: shipping, other charges, TCS, round-off. */
  other: number;
  total: number;
  /** Books "income": taxable + shipping + other charges + round-off (no GST / cess / TCS). */
  income: number;
  lines: SalesLine[];
}

const SALES_TYPES = new Set(['INVOICE', 'TAX_INVOICE']);
const isLive = (i: InvoiceRecord) => i.status !== 'Draft' && i.status !== 'Cancelled';
export const isSaleDoc = (i: InvoiceRecord) => isLive(i) && SALES_TYPES.has(i.doc_type ?? 'INVOICE');
export const isCreditNoteDoc = (i: InvoiceRecord) => isLive(i) && i.doc_type === 'CREDIT_NOTE';

function norm(s: unknown): string {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function customerOf(inv: InvoiceRecord): { key: string; name: string; id?: string; partyKey: string } {
  const c = inv.client;
  const name = String(c?.company || c?.name || '').trim() || 'Walk-in / cash sale';
  const id = c?.id ? String(c.id) : undefined;
  // Name is the stable identity: a client edited after invoicing keeps one row per real customer
  // only if both the id and the name agree, so group by id when present, else by name.
  const partyKey = id ?? `name:${String(c?.name ?? '').trim().toLowerCase()}`;
  return { key: id ? `id:${id}` : `n:${norm(name)}`, name, id, partyKey };
}

/** Same arithmetic as books.invoiceAmounts (kept in lock-step by tests/sales-reports.test.ts). */
function amountsOf(inv: InvoiceRecord) {
  const total = Math.abs(num(inv.total));
  const tax = Math.abs(num(inv.tax_amount));
  const cess = Math.abs(num(inv.cess_amount));
  const tcs = Math.abs(num(inv.tcs_amount));
  const hasTaxable = Number.isFinite(num(inv.taxable_value, NaN));
  const taxable = hasTaxable ? Math.abs(num(inv.taxable_value)) : Math.max(total - tax, 0);
  const charges = num(inv.shipping) + num(inv.other_charges);
  const income = hasTaxable ? round2(taxable + charges + num(inv.round_off)) : round2(Math.max(total - tax - cess - tcs, 0));
  return { total: round2(total), taxable: round2(taxable), tax: round2(tax), cess: round2(cess), income };
}

function toSalesLine(l: CalcLine, sign: number): SalesLine {
  return {
    name: String(l.name ?? '').trim(),
    hsn: String(l.hsn ?? '').trim(),
    unit: String(l.unit ?? '').trim(),
    quantity: sign * num(l.quantity),
    taxable: sign * l.taxable,
    cgst: sign * l.cgst,
    sgst: sign * l.sgst,
    igst: sign * l.igst,
    cess: sign * num(l.cess),
    tax: sign * round2(l.cgst + l.sgst + l.igst),
    rate: num(l.tax_rate),
  };
}

/** Lines of a document, re-derived with the shared calculator and trued up to the stored totals. */
function linesOf(inv: InvoiceRecord, sign: 1 | -1, amounts: ReturnType<typeof amountsOf>): SalesLine[] {
  let lines: SalesLine[] = [];
  try {
    const calc = calculateInvoice(calcInputFromRecord(inv, { amount_paid: 0 }));
    lines = calc.lines.map((l) => toSalesLine(l, sign));
  } catch {
    lines = [];
  }
  const wantTaxable = sign * amounts.taxable;
  const wantTax = sign * round2(Math.max(num(inv.cgst_amount) + num(inv.sgst_amount) + num(inv.igst_amount), amounts.tax));
  if (lines.length === 0) {
    return [
      {
        name: '(no line items)', hsn: '', unit: '', quantity: 0, taxable: wantTaxable,
        cgst: 0, sgst: 0, igst: wantTax, cess: sign * amounts.cess, tax: wantTax, rate: 0,
      },
    ];
  }
  // True up rounding / legacy differences so lines always sum to the document.
  const dTaxable = round2(wantTaxable - lines.reduce((t, l) => t + l.taxable, 0));
  const dTax = round2(wantTax - lines.reduce((t, l) => t + l.tax, 0));
  if (dTaxable !== 0 || dTax !== 0) {
    let big = 0;
    lines.forEach((l, i) => {
      if (Math.abs(l.taxable) > Math.abs(lines[big].taxable)) big = i;
    });
    const b = { ...lines[big] };
    b.taxable = round2(b.taxable + dTaxable);
    b.tax = round2(b.tax + dTax);
    if (dTax !== 0) {
      if (inv.gst_mode === 'CGST_SGST') {
        b.cgst = round2(b.cgst + dTax / 2);
        b.sgst = round2(b.sgst + dTax - round2(dTax / 2));
      } else {
        b.igst = round2(b.igst + dTax);
      }
    }
    lines[big] = b;
  }
  return lines;
}

export interface DocsResult {
  docs: SalesDoc[];
  /** Live sales / credit notes in a currency other than INR (not summed). */
  excludedForeign: number;
}

/** Every live sale and credit note (any date), INR only, with signed amounts. */
export function salesDocs(invoices: readonly InvoiceRecord[], currency = 'INR'): DocsResult {
  const want = currency.toUpperCase();
  const docs: SalesDoc[] = [];
  let excludedForeign = 0;
  for (const inv of invoices) {
    const sale = isSaleDoc(inv);
    if (!sale && !isCreditNoteDoc(inv)) continue;
    if ((inv.currency || 'INR').toUpperCase() !== want) {
      excludedForeign++;
      continue;
    }
    const date = isoDay(inv.issue_date);
    if (!date) continue;
    const sign: 1 | -1 = sale ? 1 : -1;
    const a = amountsOf(inv);
    const who = customerOf(inv);
    const taxAll = round2(a.tax + a.cess);
    docs.push({
      id: inv.id,
      number: inv.invoice_number || '',
      date,
      sign,
      customerKey: who.key,
      customerName: who.name,
      clientId: who.id,
      partyKey: who.partyKey,
      taxable: sign * a.taxable,
      tax: sign * taxAll,
      other: sign * round2(a.total - a.taxable - taxAll),
      total: sign * a.total,
      income: sign * a.income,
      lines: linesOf(inv, sign, a),
    });
  }
  return { docs, excludedForeign };
}

export function docsInPeriod(docs: readonly SalesDoc[], period: Period): SalesDoc[] {
  return docs.filter((d) => inPeriod(d.date, period));
}

const sum = (xs: readonly number[]) => round2(xs.reduce((t, x) => t + x, 0));

/* ════════════════════════════════════════════════════════════════
   Period helpers
   ════════════════════════════════════════════════════════════════ */

/** Same calendar dates one year earlier (29 Feb -> 28 Feb). */
export function shiftYear(iso: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = +m[1] + years;
  let d = +m[3];
  const last = new Date(Date.UTC(y, +m[2], 0)).getUTCDate();
  if (d > last) d = last;
  return `${y}-${m[2]}-${String(d).padStart(2, '0')}`;
}

export function previousYear(period: Period): Period {
  return { start: shiftYear(period.start, -1), end: shiftYear(period.end, -1) };
}

/* ════════════════════════════════════════════════════════════════
   Sales by customer
   ════════════════════════════════════════════════════════════════ */

export interface CustomerRow {
  key: string;
  name: string;
  clientId?: string;
  partyKey: string;
  /** Invoices in the period. */
  count: number;
  creditNotes: number;
  /** Net of credit notes. */
  taxable: number;
  tax: number;
  total: number;
  income: number;
  /** Credit notes (positive amount). */
  credited: number;
  /** total / count (0 when no invoices). */
  avg: number;
  /** % of all customers' net taxable value. */
  share: number;
  lastDate: string;
  /** Id of the most recent invoice in the period ('' when none) — drill-through target. */
  lastId: string;
}

export interface CustomerReport {
  rows: CustomerRow[];
  totals: { count: number; creditNotes: number; taxable: number; tax: number; total: number; income: number; credited: number };
}

export function salesByCustomer(docs: readonly SalesDoc[], period: Period): CustomerReport {
  const map = new Map<string, CustomerRow>();
  for (const d of docsInPeriod(docs, period)) {
    const r =
      map.get(d.customerKey) ??
      ({
        key: d.customerKey, name: d.customerName, clientId: d.clientId, partyKey: d.partyKey, count: 0, creditNotes: 0,
        taxable: 0, tax: 0, total: 0, income: 0, credited: 0, avg: 0, share: 0, lastDate: '', lastId: '',
      } as CustomerRow);
    r.taxable = round2(r.taxable + d.taxable);
    r.tax = round2(r.tax + d.tax);
    r.total = round2(r.total + d.total);
    r.income = round2(r.income + d.income);
    if (d.sign === 1) {
      r.count++;
      if (d.date > r.lastDate) {
        r.lastDate = d.date;
        r.lastId = d.id;
      }
    } else {
      r.creditNotes++;
      r.credited = round2(r.credited - d.total);
    }
    if (!r.clientId && d.clientId) r.clientId = d.clientId;
    map.set(d.customerKey, r);
  }
  const rows = [...map.values()];
  const totalTaxable = sum(rows.map((r) => r.taxable));
  for (const r of rows) {
    r.avg = r.count > 0 ? round2(r.total / r.count) : 0;
    r.share = totalTaxable > 0 ? round2((r.taxable / totalTaxable) * 100) : 0;
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return {
    rows,
    totals: {
      count: rows.reduce((t, r) => t + r.count, 0),
      creditNotes: rows.reduce((t, r) => t + r.creditNotes, 0),
      taxable: totalTaxable,
      tax: sum(rows.map((r) => r.tax)),
      total: sum(rows.map((r) => r.total)),
      income: sum(rows.map((r) => r.income)),
      credited: sum(rows.map((r) => r.credited)),
    },
  };
}

/* ── Top customers + concentration ───────────────────────────── */

export type ConcentrationLevel = 'none' | 'healthy' | 'moderate' | 'high';

export interface Concentration {
  top: (CustomerRow & { cumulativeShare: number })[];
  customers: number;
  top1Share: number;
  top3Share: number;
  top5Share: number;
  level: ConcentrationLevel;
  /** Human sentence for the warning banner ('' when healthy). */
  warning: string;
}

/** Top-3 share thresholds: >= 50% moderate, >= 70% high (or a single customer). */
export const CONCENTRATION_MODERATE = 50;
export const CONCENTRATION_HIGH = 70;

export function concentration(report: CustomerReport, topN = 10): Concentration {
  const ranked = report.rows.filter((r) => r.taxable > 0).sort((a, b) => b.taxable - a.taxable || a.name.localeCompare(b.name));
  const base = sum(ranked.map((r) => r.taxable));
  let cum = 0;
  const top = ranked.slice(0, topN).map((r) => {
    cum = round2(cum + r.taxable);
    return { ...r, cumulativeShare: base > 0 ? round2((cum / base) * 100) : 0 };
  });
  const share = (n: number) => (base > 0 ? round2((sum(ranked.slice(0, n).map((r) => r.taxable)) / base) * 100) : 0);
  const top3Share = share(3);
  let level: ConcentrationLevel = 'none';
  if (ranked.length > 0) {
    level = top3Share >= CONCENTRATION_HIGH || ranked.length === 1 ? 'high' : top3Share >= CONCENTRATION_MODERATE ? 'moderate' : 'healthy';
    // With three or fewer customers the top-3 share is trivially 100% — say so plainly instead.
  }
  let warning = '';
  if (level === 'high' || level === 'moderate') {
    warning =
      ranked.length <= 3
        ? `Only ${ranked.length} customer${ranked.length === 1 ? '' : 's'} bought in this period — all revenue depends on ${ranked.length === 1 ? 'one account' : 'them'}.`
        : `Your top 3 customers account for ${top3Share.toFixed(1)}% of sales (${ranked.slice(0, 3).map((r) => r.name).join(', ')}). Losing one would hurt.`;
  }
  return { top, customers: ranked.length, top1Share: share(1), top3Share, top5Share: share(5), level, warning };
}

/* ════════════════════════════════════════════════════════════════
   Sales by item / HSN
   ════════════════════════════════════════════════════════════════ */

export type ItemGrouping = 'item' | 'hsn';

export interface ItemRow {
  key: string;
  name: string;
  hsn: string;
  unit: string;
  /** Net of credit notes. */
  quantity: number;
  taxable: number;
  tax: number;
  /** taxable / quantity (0 without quantity). */
  avgRate: number;
  /** Invoices the item appears on. */
  docs: number;
  share: number;
}

export function salesByItem(docs: readonly SalesDoc[], period: Period, by: ItemGrouping = 'item'): { rows: ItemRow[]; totals: { quantity: number; taxable: number; tax: number } } {
  const map = new Map<string, ItemRow & { _docs: Set<string> }>();
  for (const d of docsInPeriod(docs, period)) {
    for (const l of d.lines) {
      const hsn = l.hsn || '';
      const key = by === 'hsn' ? `h:${hsn || '-'}` : `n:${norm(l.name)}|${hsn}`;
      const r =
        map.get(key) ??
        ({
          key, name: by === 'hsn' ? (hsn ? `HSN / SAC ${hsn}` : 'No HSN / SAC') : l.name || '(unnamed)',
          hsn, unit: l.unit, quantity: 0, taxable: 0, tax: 0, avgRate: 0, docs: 0, share: 0, _docs: new Set<string>(),
        } as ItemRow & { _docs: Set<string> });
      r.quantity = round2(r.quantity + l.quantity);
      r.taxable = round2(r.taxable + l.taxable);
      r.tax = round2(r.tax + l.tax + l.cess);
      if (d.sign === 1) r._docs.add(d.id);
      if (!r.unit && l.unit) r.unit = l.unit;
      map.set(key, r);
    }
  }
  const all = [...map.values()];
  const totalTaxable = sum(all.map((r) => r.taxable));
  const rows: ItemRow[] = all.map(({ _docs, ...r }) => ({
    ...r,
    docs: _docs.size,
    avgRate: r.quantity > 0 ? round2(r.taxable / r.quantity) : 0,
    share: totalTaxable > 0 ? round2((r.taxable / totalTaxable) * 100) : 0,
    ...(by === 'hsn' ? { unit: '' } : {}),
  }));
  rows.sort((a, b) => b.taxable - a.taxable || a.name.localeCompare(b.name));
  return { rows, totals: { quantity: sum(rows.map((r) => r.quantity)), taxable: totalTaxable, tax: sum(rows.map((r) => r.tax)) } };
}

/* ════════════════════════════════════════════════════════════════
   Sales by month with year-on-year
   ════════════════════════════════════════════════════════════════ */

export interface MonthRow {
  /** YYYY-MM of the current period. */
  month: string;
  label: string;
  /** Same month one year earlier. */
  prevMonth: string;
  prevLabel: string;
  count: number;
  taxable: number;
  total: number;
  prevCount: number;
  prevTaxable: number;
  prevTotal: number;
  /** % change of taxable value vs last year; null when last year had none or the month has not started yet. */
  change: number | null;
  /** The month starts after today — nothing can have happened yet, so there is no change to show. */
  future: boolean;
}

export interface MonthlyReport {
  rows: MonthRow[];
  period: Period;
  prevPeriod: Period;
  totals: {
    count: number; taxable: number; total: number; prevCount: number; prevTaxable: number; prevTotal: number;
    /** Like-for-like: only months that have started are compared (year to date vs the same months last year). */
    change: number | null;
    /** The same like-for-like comparison on billed (incl. GST) values. */
    changeTotal: number | null;
  };
}

function clipMonth(month: string, period: Period): Period {
  const from = `${month}-01`;
  const to = `${month}-31`;
  return { start: from < period.start ? period.start : from, end: to > period.end ? period.end : to };
}

function fold(docs: readonly SalesDoc[], p: Period) {
  let count = 0;
  let taxable = 0;
  let total = 0;
  for (const d of docs) {
    if (!inPeriod(d.date, p)) continue;
    if (d.sign === 1) count++;
    taxable += d.taxable;
    total += d.total;
  }
  return { count, taxable: round2(taxable), total: round2(total) };
}

export function pctChange(now: number, before: number): number | null {
  return before > 0 ? round2(((now - before) / before) * 100) : null;
}

/** Month-by-month net sales for the period beside the same months a year earlier (previous FY for an FY period). */
export function salesByMonth(docs: readonly SalesDoc[], period: Period, today: string = localDayOf(new Date())): MonthlyReport {
  const prevPeriod = previousYear(period);
  const rows: MonthRow[] = monthsIn(period).map((month) => {
    const [y, m] = month.split('-');
    const prevMonth = `${+y - 1}-${m}`;
    const cur = fold(docs, clipMonth(month, period));
    const prev = fold(docs, clipMonth(prevMonth, prevPeriod));
    const future = `${month}-01` > today;
    return {
      month, label: monthLabel(month), prevMonth, prevLabel: monthLabel(prevMonth),
      count: cur.count, taxable: cur.taxable, total: cur.total,
      prevCount: prev.count, prevTaxable: prev.taxable, prevTotal: prev.total,
      change: future ? null : pctChange(cur.taxable, prev.taxable),
      future,
    };
  });
  const t = {
    count: rows.reduce((a, r) => a + r.count, 0),
    taxable: sum(rows.map((r) => r.taxable)),
    total: sum(rows.map((r) => r.total)),
    prevCount: rows.reduce((a, r) => a + r.prevCount, 0),
    prevTaxable: sum(rows.map((r) => r.prevTaxable)),
    prevTotal: sum(rows.map((r) => r.prevTotal)),
  };
  const started = rows.filter((r) => !r.future);
  const like = (k: 'taxable' | 'total', pk: 'prevTaxable' | 'prevTotal') => pctChange(sum(started.map((r) => r[k])), sum(started.map((r) => r[pk])));
  return { rows, period, prevPeriod, totals: { ...t, change: like('taxable', 'prevTaxable'), changeTotal: like('total', 'prevTotal') } };
}

/* ════════════════════════════════════════════════════════════════
   Tax collected by rate
   ════════════════════════════════════════════════════════════════ */

export interface TaxRateRow {
  rate: number;
  label: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  /** cgst + sgst + igst. */
  tax: number;
  docs: number;
}

export function taxByRate(docs: readonly SalesDoc[], period: Period): { rows: TaxRateRow[]; totals: Omit<TaxRateRow, 'rate' | 'label' | 'docs'> } {
  const map = new Map<number, TaxRateRow & { _docs: Set<string> }>();
  for (const d of docsInPeriod(docs, period)) {
    for (const l of d.lines) {
      const rate = round2(l.rate);
      const r =
        map.get(rate) ??
        ({
          rate, label: rate === 0 ? 'Nil / exempt / export (0%)' : `GST ${rate}%`, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, tax: 0, docs: 0, _docs: new Set<string>(),
        } as TaxRateRow & { _docs: Set<string> });
      r.taxable = round2(r.taxable + l.taxable);
      r.cgst = round2(r.cgst + l.cgst);
      r.sgst = round2(r.sgst + l.sgst);
      r.igst = round2(r.igst + l.igst);
      r.cess = round2(r.cess + l.cess);
      r.tax = round2(r.tax + l.tax);
      r._docs.add(d.id);
      map.set(rate, r);
    }
  }
  const rows = [...map.values()].map(({ _docs, ...r }) => ({ ...r, docs: _docs.size })).sort((a, b) => a.rate - b.rate);
  return {
    rows,
    totals: {
      taxable: sum(rows.map((r) => r.taxable)),
      cgst: sum(rows.map((r) => r.cgst)),
      sgst: sum(rows.map((r) => r.sgst)),
      igst: sum(rows.map((r) => r.igst)),
      cess: sum(rows.map((r) => r.cess)),
      tax: sum(rows.map((r) => r.tax)),
    },
  };
}

/* ════════════════════════════════════════════════════════════════
   Payment-mode split (money received)
   ════════════════════════════════════════════════════════════════ */

export interface PaymentModeRow {
  method: string;
  count: number;
  amount: number;
  share: number;
}

const METHOD_CANON: Record<string, string> = {
  upi: 'UPI', cash: 'Cash', cheque: 'Cheque', check: 'Cheque', chq: 'Cheque', card: 'Card',
  neft: 'NEFT', imps: 'IMPS', rtgs: 'RTGS', 'bank transfer': 'Bank transfer', banktransfer: 'Bank transfer', 'net banking': 'Bank transfer',
};

export function canonicalMethod(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Unspecified';
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  return METHOD_CANON[key] ?? (s.charAt(0).toUpperCase() + s.slice(1));
}

/**
 * Receipts dated in the period, grouped by method. Receipts against a non-INR invoice are left out
 * (they are not rupees). Unlinked receipts (invoice deleted) are still money received and are kept.
 */
export function paymentModes(payments: readonly Payment[], invoices: readonly InvoiceRecord[], period: Period): { rows: PaymentModeRow[]; total: number; count: number } {
  const foreign = new Set(invoices.filter((i) => (i.currency || 'INR').toUpperCase() !== 'INR').map((i) => i.id));
  const map = new Map<string, PaymentModeRow>();
  for (const p of payments) {
    const date = isoDay(p.date);
    const amount = round2(Math.abs(num(p.amount)));
    if (!date || amount === 0 || !inPeriod(date, period) || foreign.has(p.invoice_id)) continue;
    const method = canonicalMethod(p.method);
    const r = map.get(method) ?? { method, count: 0, amount: 0, share: 0 };
    r.count++;
    r.amount = round2(r.amount + amount);
    map.set(method, r);
  }
  const rows = [...map.values()];
  const total = sum(rows.map((r) => r.amount));
  for (const r of rows) r.share = total > 0 ? round2((r.amount / total) * 100) : 0;
  rows.sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method));
  return { rows, total, count: rows.reduce((t, r) => t + r.count, 0) };
}

/* ════════════════════════════════════════════════════════════════
   Expenses by category / vendor
   ════════════════════════════════════════════════════════════════ */

export interface ExpenseCategoryRow {
  key: string;
  category: string;
  /** Purchases are direct costs, quick expenses are indirect. */
  direct: boolean;
  count: number;
  taxable: number;
  gst: number;
  /** GST claimed back as input tax credit (not a cost). */
  itc: number;
  /** What hits the P&L: taxable + GST that cannot be claimed. */
  cost: number;
  share: number;
}

export interface ExpenseVendorRow {
  vendor: string;
  count: number;
  taxable: number;
  gst: number;
  itc: number;
  cost: number;
  share: number;
}

export interface ExpenseReport {
  categories: ExpenseCategoryRow[];
  vendors: ExpenseVendorRow[];
  totals: { count: number; taxable: number; gst: number; itc: number; cost: number };
}

export function expenseReport(purchases: readonly unknown[], vendors: readonly unknown[], period: Period): ExpenseReport {
  const cats = new Map<string, ExpenseCategoryRow>();
  const vend = new Map<string, ExpenseVendorRow>();
  for (const raw of purchases) {
    const p = normalizePurchase(raw as never, vendors as never);
    if (!p || !inPeriod(p.date, period)) continue;
    const itc = purchaseItc(p);
    const cost = purchaseCost(p);
    const category = p.category || (p.isExpense ? 'Other expenses' : 'Purchases');
    const ck = `${p.isExpense ? 'i' : 'd'}|${category}`;
    const c = cats.get(ck) ?? { key: ck, category, direct: !p.isExpense, count: 0, taxable: 0, gst: 0, itc: 0, cost: 0, share: 0 };
    c.count++;
    c.taxable = round2(c.taxable + p.taxable);
    c.gst = round2(c.gst + p.gst);
    c.itc = round2(c.itc + itc);
    c.cost = round2(c.cost + cost);
    cats.set(ck, c);
    const v = vend.get(p.party) ?? { vendor: p.party, count: 0, taxable: 0, gst: 0, itc: 0, cost: 0, share: 0 };
    v.count++;
    v.taxable = round2(v.taxable + p.taxable);
    v.gst = round2(v.gst + p.gst);
    v.itc = round2(v.itc + itc);
    v.cost = round2(v.cost + cost);
    vend.set(p.party, v);
  }
  const categories = [...cats.values()];
  const vendorRows = [...vend.values()];
  const totalCost = sum(categories.map((c) => c.cost));
  for (const c of categories) c.share = totalCost > 0 ? round2((c.cost / totalCost) * 100) : 0;
  for (const v of vendorRows) v.share = totalCost > 0 ? round2((v.cost / totalCost) * 100) : 0;
  categories.sort((a, b) => b.cost - a.cost || a.category.localeCompare(b.category));
  vendorRows.sort((a, b) => b.cost - a.cost || a.vendor.localeCompare(b.vendor));
  return {
    categories,
    vendors: vendorRows,
    totals: {
      count: categories.reduce((t, c) => t + c.count, 0),
      taxable: sum(categories.map((c) => c.taxable)),
      gst: sum(categories.map((c) => c.gst)),
      itc: sum(categories.map((c) => c.itc)),
      cost: totalCost,
    },
  };
}

/* ════════════════════════════════════════════════════════════════
   Profitability by item (only where stock cost exists)
   ════════════════════════════════════════════════════════════════ */

export interface ProfitRow {
  name: string;
  unit: string;
  quantity: number;
  /** Net taxable sales of the item in the period (from the sales report). */
  revenue: number;
  /** Cost of goods sold from the stock ledger in the period. */
  cogs: number;
  profit: number;
  /** profit / revenue, percent (0 without revenue). */
  margin: number;
}

/**
 * Margin per tracked stock item in the period: sales taxable value (matched by item name, case-insensitive)
 * less the ledger's cost of goods sold, with sales returns netted. Items without stock tracking have no cost
 * and are not listed. `[]` when there are no positions.
 */
export function profitByItem(docs: readonly SalesDoc[], positions: readonly StockPosition[], period: Period): { rows: ProfitRow[]; totals: { revenue: number; cogs: number; profit: number; margin: number } } {
  const sold = new Map<string, { revenue: number; quantity: number }>();
  for (const d of docsInPeriod(docs, period)) {
    for (const l of d.lines) {
      const k = norm(l.name);
      const s = sold.get(k) ?? { revenue: 0, quantity: 0 };
      s.revenue = round2(s.revenue + l.taxable);
      s.quantity = round2(s.quantity + l.quantity);
      sold.set(k, s);
    }
  }
  const rows: ProfitRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock) continue;
    let cogs = 0;
    let qty = 0;
    for (const row of p.ledger) {
      if (!row.date || !inPeriod(row.date, period)) continue;
      if (row.kind === 'sale') {
        cogs += row.amount;
        qty += row.qtyOut;
      } else if (row.kind === 'return') {
        cogs -= row.amount;
        qty -= row.qtyIn;
      }
    }
    cogs = round2(cogs);
    const s = sold.get(norm(p.item.name));
    if (!s && cogs === 0) continue;
    const revenue = s?.revenue ?? 0;
    const profit = round2(revenue - cogs);
    rows.push({
      name: p.item.name,
      unit: p.item.unit,
      quantity: round2(s?.quantity ?? qty),
      revenue,
      cogs,
      profit,
      margin: revenue > 0 ? round2((profit / revenue) * 100) : 0,
    });
  }
  rows.sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
  const revenue = sum(rows.map((r) => r.revenue));
  const cogs = sum(rows.map((r) => r.cogs));
  const profit = round2(revenue - cogs);
  return { rows, totals: { revenue, cogs, profit, margin: revenue > 0 ? round2((profit / revenue) * 100) : 0 } };
}

/* ════════════════════════════════════════════════════════════════
   Sorting + CSV helpers (used by every tab)
   ════════════════════════════════════════════════════════════════ */

export type SortDir = 'asc' | 'desc';

/** Stable sort by a key getter; strings compare naturally (numeric-aware, case-insensitive). */
export function sortRows<T>(rows: readonly T[], get: (r: T) => string | number | null | undefined, dir: SortDir): T[] {
  const mult = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: get(r) }))
    .sort((a, b) => {
      const av = a.v;
      const bv = b.v;
      if (av === bv) return a.i - b.i;
      if (av === null || av === undefined || av === '') return 1; // blanks last in either direction
      if (bv === null || bv === undefined || bv === '') return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult || a.i - b.i;
      return String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' }) * mult || a.i - b.i;
    })
    .map((x) => x.r);
}

export function customersCsv(rep: CustomerReport, period: Period): string {
  return toCsv([
    [`Sales by customer ${period.start} to ${period.end} (net of credit notes, INR)`],
    ['Customer', 'Invoices', 'Credit notes', 'Taxable value', 'GST + cess', 'Total', 'Avg invoice', 'Share of taxable %', 'Last invoice'],
    ...rep.rows.map((r) => [r.name, r.count, r.creditNotes, r.taxable, r.tax, r.total, r.avg, r.share, r.lastDate]),
    ['Total', rep.totals.count, rep.totals.creditNotes, rep.totals.taxable, rep.totals.tax, rep.totals.total, '', 100, ''],
  ]);
}

export function itemsCsv(rep: ReturnType<typeof salesByItem>, by: ItemGrouping, period: Period): string {
  return toCsv([
    [`Sales by ${by === 'hsn' ? 'HSN / SAC' : 'item / service'} ${period.start} to ${period.end}`],
    ['Item', 'HSN / SAC', 'Unit', 'Quantity', 'Taxable value', 'GST + cess', 'Avg rate', 'Invoices', 'Share %'],
    ...rep.rows.map((r) => [r.name, r.hsn, r.unit, r.quantity, r.taxable, r.tax, r.avgRate, r.docs, r.share]),
    ['Total', '', '', rep.totals.quantity, rep.totals.taxable, rep.totals.tax, '', '', 100],
  ]);
}

export function monthlyCsv(rep: MonthlyReport): string {
  return toCsv([
    [`Sales by month ${rep.period.start} to ${rep.period.end} vs ${rep.prevPeriod.start} to ${rep.prevPeriod.end}`],
    ['Month', 'Invoices', 'Taxable value', 'Total', 'Last year month', 'Last year invoices', 'Last year taxable', 'Last year total', 'Change in taxable %'],
    ...rep.rows.map((r) => [r.label, r.count, r.taxable, r.total, r.prevLabel, r.prevCount, r.prevTaxable, r.prevTotal, r.change ?? '']),
    ['Total', rep.totals.count, rep.totals.taxable, rep.totals.total, '', rep.totals.prevCount, rep.totals.prevTaxable, rep.totals.prevTotal, rep.totals.change ?? ''],
  ]);
}

export function topCustomersCsv(c: Concentration): string {
  return toCsv([
    ['Rank', 'Customer', 'Taxable value', 'Share %', 'Cumulative share %'],
    ...c.top.map((r, i) => [i + 1, r.name, r.taxable, r.share, r.cumulativeShare]),
    [],
    ['Top 1 share %', c.top1Share],
    ['Top 3 share %', c.top3Share],
    ['Top 5 share %', c.top5Share],
    ['Concentration', c.level],
  ]);
}

export function taxRateCsv(rep: ReturnType<typeof taxByRate>, period: Period): string {
  return toCsv([
    [`Tax collected by rate ${period.start} to ${period.end} (net of credit notes)`],
    ['Rate', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Cess', 'Total GST', 'Documents'],
    ...rep.rows.map((r) => [r.label, r.taxable, r.cgst, r.sgst, r.igst, r.cess, r.tax, r.docs]),
    ['Total', rep.totals.taxable, rep.totals.cgst, rep.totals.sgst, rep.totals.igst, rep.totals.cess, rep.totals.tax, ''],
  ]);
}

export function paymentModesCsv(rep: ReturnType<typeof paymentModes>, period: Period): string {
  return toCsv([
    [`Payment modes ${period.start} to ${period.end}`],
    ['Mode', 'Receipts', 'Amount', 'Share %'],
    ...rep.rows.map((r) => [r.method, r.count, r.amount, r.share]),
    ['Total', rep.count, rep.total, 100],
  ]);
}

export function expensesCsv(rep: ExpenseReport, by: 'category' | 'vendor', period: Period): string {
  const head = ['Taxable value', 'GST', 'ITC claimed', 'Cost to P&L', 'Share %'];
  return toCsv([
    [`Expenses by ${by} ${period.start} to ${period.end}`],
    [by === 'category' ? 'Category' : 'Vendor', ...(by === 'category' ? ['Type'] : []), 'Bills', ...head],
    ...(by === 'category'
      ? rep.categories.map((c) => [c.category, c.direct ? 'Direct' : 'Indirect', c.count, c.taxable, c.gst, c.itc, c.cost, c.share])
      : rep.vendors.map((v) => [v.vendor, v.count, v.taxable, v.gst, v.itc, v.cost, v.share])),
    ['Total', ...(by === 'category' ? [''] : []), rep.totals.count, rep.totals.taxable, rep.totals.gst, rep.totals.itc, rep.totals.cost, 100],
  ]);
}

export function profitCsv(rep: ReturnType<typeof profitByItem>, period: Period): string {
  return toCsv([
    [`Profitability by item ${period.start} to ${period.end} (tracked stock items only)`],
    ['Item', 'Unit', 'Quantity', 'Sales (taxable)', 'Cost of goods sold', 'Profit', 'Margin %'],
    ...rep.rows.map((r) => [r.name, r.unit, r.quantity, r.revenue, r.cogs, r.profit, r.margin]),
    ['Total', '', '', rep.totals.revenue, rep.totals.cogs, rep.totals.profit, rep.totals.margin],
  ]);
}
