/**
 * Offline insights (8G, 8.108 — Zoho / Xero "business insights", computed on the device). Deterministic
 * and pure: the same data and `today` always give the same cards. Every card compares this month (to
 * date) with the average of the three full months before it and links to the report that explains it.
 * Rupee documents only (foreign ones without a rate are left out). Indicators, not statements.
 */

import type { InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { isRevenueDoc } from './stats';
import { receivableTotal } from './rcm';
import { isVoidStatus, readPurchase } from './purchase-normalize';
import { documentMargin, type UnitCost } from './margin';

export type InsightId = 'revenue' | 'topCustomers' | 'expenseSpike' | 'dso' | 'slowPayers' | 'margin' | 'stockRisk' | 'gstTrend';
export type InsightTone = 'good' | 'warn' | 'info';

export interface Insight {
  id: InsightId;
  tone: InsightTone;
  /** Headline figure (rupees, days or percent — see `unit`). */
  value: number;
  unit: 'inr' | 'days' | 'pct' | 'count';
  /** Comparison figure (3-month average / earlier value), when there is one. */
  baseline?: number;
  /** Change vs baseline in percent (null when the baseline is 0). */
  changePct?: number | null;
  /** Names / rows behind the card (top customers, spiking heads, slower payers, items at risk). */
  rows: { label: string; value: number; extra?: number }[];
  href: string;
}

export interface StockRow {
  name: string;
  qty: number;
  reorder: number;
}

export interface InsightInput {
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
  purchases: readonly unknown[];
  vendors?: readonly unknown[];
  costs?: ReadonlyMap<string, UnitCost>;
  stock?: readonly StockRow[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthKey = (d: string) => d.slice(0, 7);
const inr = (i: Pick<InvoiceRecord, 'currency'> | undefined) => !i || (i.currency || 'INR').toUpperCase() === 'INR';

/** "2026-10" for `today` and the three months before it. */
export function monthWindow(today: string): { current: string; previous: string[]; dayOfMonth: number; daysInMonth: number } {
  const [y, m, d] = today.split('-').map(Number);
  const previous = [1, 2, 3].map((k) => {
    const dt = new Date(y, m - 1 - k, 1);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
  });
  return { current: `${y}-${pad(m)}`, previous, dayOfMonth: d, daysInMonth: new Date(y, m, 0).getDate() };
}

const pctChange = (now: number, base: number): number | null => (base > 0 ? round2(((now - base) / base) * 100) : null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function shift(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

const party = (i: InvoiceRecord) => (i.client?.name || i.client?.company || 'Unknown').trim();

/** Receivable outstanding on `day`: issued revenue documents up to then, less payments dated up to then. */
function outstandingAt(sales: readonly InvoiceRecord[], payments: readonly Payment[], day: string): number {
  const paidBy = new Map<string, number>();
  for (const p of payments) if (isoDay(p.date) <= day) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + num(p.amount));
  let total = 0;
  for (const i of sales) {
    if (isoDay(i.issue_date) > day) continue;
    total += Math.max(receivableTotal(i) - (paidBy.get(i.id) ?? 0), 0);
  }
  return round2(total);
}

function salesBetween(sales: readonly InvoiceRecord[], from: string, to: string): number {
  return sales.reduce((s, i) => {
    const d = isoDay(i.issue_date);
    return d >= from && d <= to ? s + receivableTotal(i) : s;
  }, 0);
}

/** DSO on `day` over the 90 days before it (null without sales). */
export function dsoAt(sales: readonly InvoiceRecord[], payments: readonly Payment[], day: string): number | null {
  const s = salesBetween(sales, shift(day, -89), day);
  if (s <= 0) return null;
  return Math.round((outstandingAt(sales, payments, day) / s) * 90 * 10) / 10;
}

export function buildInsights(input: InsightInput, today: string): Insight[] {
  const w = monthWindow(today);
  const sales = input.invoices.filter((i) => i && isRevenueDoc(i) && inr(i) && isoDay(i.issue_date));
  const salesById = new Map(sales.map((i) => [i.id, i]));
  const byMonth = (key: string) => sales.filter((i) => monthKey(isoDay(i.issue_date)) === key && isoDay(i.issue_date) <= today);
  const out: Insight[] = [];

  // 1. Revenue: this month to date, projected to month end, vs the 3-month average.
  const revNow = round2(byMonth(w.current).reduce((s, i) => s + num(i.taxable_value || i.total), 0));
  const revBase = round2(avg(w.previous.map((k) => byMonth(k).reduce((s, i) => s + num(i.taxable_value || i.total), 0))));
  const projected = w.dayOfMonth > 0 ? round2((revNow / w.dayOfMonth) * w.daysInMonth) : revNow;
  const revChange = pctChange(projected, revBase);
  out.push({ id: 'revenue', tone: revChange === null ? 'info' : revChange >= 0 ? 'good' : revChange <= -15 ? 'warn' : 'info', value: revNow, unit: 'inr', baseline: revBase, changePct: revChange, rows: [{ label: 'projected', value: projected }], href: '/reports?tab=monthly' });

  // 2. Top customers this month.
  const custNow = new Map<string, number>();
  for (const i of byMonth(w.current)) custNow.set(party(i), (custNow.get(party(i)) ?? 0) + num(i.total));
  const top = [...custNow.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  const monthTotal = [...custNow.values()].reduce((s, v) => s + v, 0);
  out.push({ id: 'topCustomers', tone: top.length && monthTotal > 0 && top[0][1] / monthTotal > 0.5 ? 'warn' : 'info', value: round2(top[0]?.[1] ?? 0), unit: 'inr', rows: top.map(([label, v]) => ({ label, value: round2(v), extra: monthTotal > 0 ? round2((v / monthTotal) * 100) : 0 })), href: '/reports?tab=top' });

  // 3. Expense heads spiking (≥ 1.5 × their 3-month average and ≥ ₹1,000 more).
  const heads = new Map<string, Map<string, number>>();
  for (const raw of input.purchases) {
    const b = readPurchase(raw, input.vendors ?? []);
    if (!b || isVoidStatus(b.status) || b.date > today) continue;
    const k = monthKey(b.date);
    if (k !== w.current && !w.previous.includes(k)) continue;
    const cat = (b.category || (b.isExpense ? 'Other expenses' : 'Purchases')).trim();
    const m = heads.get(cat) ?? new Map<string, number>();
    m.set(k, (m.get(k) ?? 0) + b.taxable);
    heads.set(cat, m);
  }
  const spikes: Insight['rows'] = [];
  for (const [cat, m] of heads) {
    const now = m.get(w.current) ?? 0;
    const base = avg(w.previous.map((k) => m.get(k) ?? 0));
    if (now >= base * 1.5 && now - base >= 1000) spikes.push({ label: cat, value: round2(now), extra: round2(base) });
  }
  spikes.sort((a, b) => b.value - (b.extra ?? 0) - (a.value - (a.extra ?? 0)) || a.label.localeCompare(b.label));
  out.push({ id: 'expenseSpike', tone: spikes.length ? 'warn' : 'good', value: spikes.length, unit: 'count', rows: spikes.slice(0, 3), href: '/reports?tab=expenses' });

  // 4. DSO today vs 30 days ago.
  const pays = input.payments.filter((p) => p && !p.advance_id && salesById.has(p.invoice_id));
  const dsoNow = dsoAt(sales, pays, today);
  const dsoThen = dsoAt(sales, pays, shift(today, -30));
  out.push({ id: 'dso', tone: dsoNow === null || dsoThen === null ? 'info' : dsoNow > dsoThen + 3 ? 'warn' : dsoNow < dsoThen - 3 ? 'good' : 'info', value: dsoNow ?? 0, unit: 'days', baseline: dsoThen ?? undefined, changePct: dsoNow !== null && dsoThen !== null ? pctChange(dsoNow, dsoThen) : null, rows: [], href: '/receivables?tab=collections' });

  // 5. Customers paying slower: weighted days-to-pay in the last 90 days vs the 9 months before (≥ 7 days slower).
  const recentFrom = shift(today, -89);
  const olderFrom = shift(today, -364);
  const lag = new Map<string, { r: number; rw: number; o: number; ow: number }>();
  for (const p of pays) {
    const inv = salesById.get(p.invoice_id)!;
    const d = isoDay(p.date);
    if (!d || d > today || d < olderFrom) continue;
    const days = Math.max(daysBetween(isoDay(inv.issue_date), d), 0);
    const a = num(p.amount);
    const e = lag.get(party(inv)) ?? { r: 0, rw: 0, o: 0, ow: 0 };
    if (d >= recentFrom) {
      e.r += days * a;
      e.rw += a;
    } else {
      e.o += days * a;
      e.ow += a;
    }
    lag.set(party(inv), e);
  }
  const slower: Insight['rows'] = [];
  for (const [name, e] of lag) {
    if (!e.rw || !e.ow) continue;
    const now = e.r / e.rw;
    const before = e.o / e.ow;
    if (now - before >= 7) slower.push({ label: name, value: Math.round(now), extra: Math.round(before) });
  }
  slower.sort((a, b) => b.value - (b.extra ?? 0) - (a.value - (a.extra ?? 0)) || a.label.localeCompare(b.label));
  out.push({ id: 'slowPayers', tone: slower.length ? 'warn' : 'good', value: slower.length, unit: 'count', rows: slower.slice(0, 3), href: '/receivables?tab=aging' });

  // 6. Margin erosion: gross margin % (costed lines) this month vs the 3-month average (≥ 3 points down).
  if (input.costs && input.costs.size) {
    const marginOf = (docs: InvoiceRecord[]) => documentMargin(docs.flatMap((i) => (i.items ?? []) as InvoiceItem[]), input.costs!).pct;
    const now = marginOf(byMonth(w.current));
    const bases = w.previous.map((k) => marginOf(byMonth(k))).filter((x): x is number => x !== null);
    const base = bases.length ? round2(avg(bases)) : null;
    if (now !== null) out.push({ id: 'margin', tone: base !== null && now <= base - 3 ? 'warn' : 'info', value: now, unit: 'pct', baseline: base ?? undefined, changePct: base !== null ? round2(now - base) : null, rows: [], href: '/reports?tab=profit' });
  }

  // 7. Stock at risk: at / below reorder level, or under a week of cover at the last 30 days' sales rate.
  if (input.stock?.length) {
    const sold = new Map<string, number>();
    const from = shift(today, -29);
    for (const i of sales) {
      const d = isoDay(i.issue_date);
      if (d < from || d > today) continue;
      for (const l of i.items ?? []) {
        const k = String(l.name ?? '').trim().toLowerCase();
        if (k) sold.set(k, (sold.get(k) ?? 0) + num(l.quantity) * (num(l.unit_factor) || 1));
      }
    }
    const risk: Insight['rows'] = [];
    for (const s of input.stock) {
      const rate = (sold.get(s.name.trim().toLowerCase()) ?? 0) / 30;
      const cover = rate > 0 ? s.qty / rate : Infinity;
      if ((s.reorder > 0 && s.qty <= s.reorder) || cover < 7) risk.push({ label: s.name, value: round2(s.qty), extra: Number.isFinite(cover) ? Math.floor(cover) : undefined });
    }
    risk.sort((a, b) => (a.extra ?? 1e9) - (b.extra ?? 1e9) || a.value - b.value || a.label.localeCompare(b.label));
    out.push({ id: 'stockRisk', tone: risk.length ? 'warn' : 'good', value: risk.length, unit: 'count', rows: risk.slice(0, 3), href: '/inventory' });
  }

  // 8. GST payable trend: output tax − input tax on bills, this month (to date) vs the 3-month average.
  const gstOf = (key: string) => {
    const outTax = byMonth(key).reduce((s, i) => s + num(i.cgst_amount) + num(i.sgst_amount) + num(i.igst_amount), 0);
    let itc = 0;
    for (const raw of input.purchases) {
      const b = readPurchase(raw, input.vendors ?? []);
      if (b && !isVoidStatus(b.status) && monthKey(b.date) === key && b.date <= today) itc += b.cgst + b.sgst + b.igst;
    }
    return round2(outTax - itc);
  };
  const gstNow = gstOf(w.current);
  const gstBase = round2(avg(w.previous.map(gstOf)));
  const gstChange = pctChange(gstNow, gstBase);
  out.push({ id: 'gstTrend', tone: gstChange !== null && gstChange >= 25 ? 'warn' : 'info', value: gstNow, unit: 'inr', baseline: gstBase, changePct: gstChange, rows: [], href: '/gst-reports' });

  return out;
}
