/**
 * GSTR-9C working paper — the rate-wise and expense-wise tables (7R, 7.127):
 *  - Table 9 (rate-wise tax payable): outward supplies by rate from the twelve monthly GSTR-1 HSN summaries behind
 *    the GSTR-9 build (credit / debit notes netted there), reverse-charge inward supplies by rate from the bills
 *    (3.1(d) — reverse charge and import of services), interest / late fee / penalty typed on the tab, against the
 *    tax payable declared in GSTR-9 Table 9 (9P) → unreconciled (9Q). Rows 9A–9K follow the pre-2021 form
 *    (5 / 12 / 18 / 28% with their RC rows, 3%, 0.25%, 0.1%) plus an "other rates" row for anything else.
 *  - Table 14 (ITC availed on expenses): purchase bills of the FY grouped into the form's expense heads (14A–14Q)
 *    by import / capital-goods flags and the bill's category, with value, total ITC on them and the eligible ITC
 *    availed (net of reversals), against ITC claimed in GSTR-9 Table 7J → unreconciled (14T).
 * Bills are read with the shared `readPurchase` / `splitLumpTax` (Critical Rule 9 — contract test row).
 * Working paper — the heads mapping is a convenience; verify every figure with your CA.
 */

import { num, round2 } from './invoice-calc';
import type { Gstr9Report } from './gstr9';
import { isVoidStatus, readPurchase, splitLumpTax } from './purchase-normalize';
import { checkGstin } from './gstin';
import { isLiveNote, noteCess, noteItc } from './purchase-returns-gst';
import type { PurchaseReturn } from '../types/purchases';

export interface RateHeads {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

export interface Gstr9cRateRow extends RateHeads {
  id: string;
  label: string;
  total?: boolean;
}

const zero = (): RateHeads => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 });
const add = (t: RateHeads, h: Partial<RateHeads>, f = 1) => {
  t.taxable = round2(t.taxable + f * num(h.taxable));
  t.cgst = round2(t.cgst + f * num(h.cgst));
  t.sgst = round2(t.sgst + f * num(h.sgst));
  t.igst = round2(t.igst + f * num(h.igst));
  t.cess = round2(t.cess + f * num(h.cess));
};
const inFy = (day: string, fyStart: number) => day >= `${fyStart}-04-01` && day <= `${fyStart + 1}-03-31`;
const rec = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

const RATE_ROWS: readonly { rate: number; id: string; rcId?: string }[] = [
  { rate: 5, id: '9A', rcId: '9B' },
  { rate: 12, id: '9C', rcId: '9D' },
  { rate: 18, id: '9E', rcId: '9F' },
  { rate: 28, id: '9G', rcId: '9H' },
  { rate: 3, id: '9I' },
  { rate: 0.25, id: '9J' },
  { rate: 0.1, id: '9K' },
];

export interface Gstr9cTable9Extra {
  interest?: Partial<RateHeads>;
  lateFee?: Partial<RateHeads>;
  penalty?: Partial<RateHeads>;
  others?: Partial<RateHeads>;
}

/** Rate-wise Table 9 of GSTR-9C for the FY behind `g9`. `rawPurchases` = the `purchases` table. */
export function gstr9cRateWise(g9: Gstr9Report, rawPurchases: readonly unknown[], filerStateCode: string, extra: Gstr9cTable9Extra = {}): { rows: Gstr9cRateRow[]; unreconciled: RateHeads } {
  const out = new Map<string, RateHeads>();
  const bucket = (id: string) => out.get(id) ?? (out.set(id, zero()), out.get(id)!);
  const rowFor = (rate: number, rc: boolean) => {
    const r = RATE_ROWS.find((x) => Math.abs(x.rate - rate) < 0.001);
    if (!r) return rc ? '9-ORC' : '9-OTH';
    return rc ? r.rcId ?? '9-ORC' : r.id;
  };
  for (const m of g9.months) for (const h of m.gstr1.hsn) if (h.rate > 0) add(bucket(rowFor(h.rate, false)), h);
  for (const raw of rawPurchases ?? []) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status) || !inFy(c.date, g9.fyStart)) continue;
    if (!(c.reverseCharge || c.importType === 'SERVICES')) continue;
    const g = splitLumpTax(c, raw, filerStateCode);
    if (!(g.tax > 0) || !(g.taxable > 0)) continue;
    const rate = Math.round((g.tax / g.taxable) * 10000) / 100;
    add(bucket(rowFor(rate, true)), { taxable: g.taxable, cgst: g.cgst, sgst: g.sgst, igst: g.igst, cess: c.cess });
  }
  const rows: Gstr9cRateRow[] = [];
  const label = (rate: number, rc: boolean) => `${rate}%${rc ? ' (reverse charge)' : ''}`;
  for (const r of RATE_ROWS) {
    rows.push({ id: r.id, label: label(r.rate, false), ...(out.get(r.id) ?? zero()) });
    if (r.rcId) rows.push({ id: r.rcId, label: label(r.rate, true), ...(out.get(r.rcId) ?? zero()) });
  }
  if (out.has('9-OTH')) rows.push({ id: '9-OTH', label: 'Other rates', ...out.get('9-OTH')! });
  if (out.has('9-ORC')) rows.push({ id: '9-ORC', label: 'Other rates (reverse charge)', ...out.get('9-ORC')! });
  const fixed: [string, string, Partial<RateHeads> | undefined][] = [['9L', 'Interest', extra.interest], ['9M', 'Late fee', extra.lateFee], ['9N', 'Penalty', extra.penalty], ['9O', 'Others', extra.others]];
  for (const [id, lab, h] of fixed) {
    const t = zero();
    if (h) add(t, h);
    rows.push({ id, label: lab, ...t });
  }
  const total = zero();
  for (const r of rows) add(total, r);
  total.taxable = 0;
  rows.push({ id: '9-TOT', label: 'Total amount to be paid as per tables above', ...total, total: true });
  const paid = (id: string) => g9.table9.find((x) => x.id === id)?.payable ?? 0;
  const p: RateHeads = { taxable: 0, cgst: round2(paid('9-CGST')), sgst: round2(paid('9-SGST')), igst: round2(paid('9-IGST')), cess: round2(paid('9-CESS')) };
  rows.push({ id: '9P', label: 'Total amount paid as declared in the annual return (GSTR-9 Table 9)', ...p, total: true });
  const unreconciled = zero();
  add(unreconciled, total);
  add(unreconciled, p, -1);
  unreconciled.taxable = 0;
  rows.push({ id: '9Q', label: 'Unreconciled payment of amount', ...unreconciled, total: true });
  return { rows, unreconciled };
}

/**
 * PENDING 40 (7.131): the books column of rate-wise Table 9. `byRate` = the books' sales register by line rate for
 * the FY (sales less credit notes, e.g. `taxByRate(salesDocs(...))`), `booksTotal` = output tax booked by head
 * (`gstSummary`). Each outward rate row (9A, 9C, 9E, 9G, 9I–9K, other) gets the books figure; reverse-charge rows
 * take the documents' own figure (the bills are the books there); tax booked but not on any document line by rate
 * (legacy single-tax rows, foreign-currency documents) is `notByRate`. `diff` = books − documents, by row id.
 */
export function gstr9cBooksColumn(
  rows: readonly Gstr9cRateRow[],
  byRate: readonly ({ rate: number } & RateHeads)[],
  booksTotal: Omit<RateHeads, 'taxable'>,
): { books: Map<string, RateHeads>; diff: Map<string, number>; notByRate: RateHeads } {
  const books = new Map<string, RateHeads>();
  const rowFor = (rate: number) => RATE_ROWS.find((x) => Math.abs(x.rate - rate) < 0.001)?.id ?? '9-OTH';
  const rc = new Set(['9-ORC', ...RATE_ROWS.flatMap((x) => (x.rcId ? [x.rcId] : []))]);
  for (const r of rows) if (rc.has(r.id)) books.set(r.id, { taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst, cess: r.cess });
  const byRow = zero();
  for (const b of byRate) {
    if (!(b.rate > 0)) continue;
    const id = rowFor(b.rate);
    if (!rows.some((r) => r.id === id)) continue; // a rate with no row of its own stays in `notByRate`
    const t = books.get(id) ?? zero();
    add(t, b);
    add(byRow, b);
    books.set(id, t);
  }
  const notByRate = zero();
  add(notByRate, booksTotal);
  add(notByRate, byRow, -1);
  notByRate.taxable = 0;
  const tax = (h?: Partial<RateHeads>) => round2(num(h?.cgst) + num(h?.sgst) + num(h?.igst) + num(h?.cess));
  const diff = new Map<string, number>();
  for (const r of rows) if (/^9[A-K]$|^9-O(TH|RC)$/.test(r.id)) diff.set(r.id, round2(tax(books.get(r.id)) - tax(r)));
  return { books, diff, notByRate };
}

export interface Gstr9cExpenseRow {
  id: string;
  label: string;
  /** Value of the expenses (taxable value of the bills). */
  value: number;
  /** GST + cess on them. */
  itc: number;
  /** ITC availed: eligible, net of reversals. */
  eligible: number;
  total?: boolean;
}

const HEADS: readonly { id: string; label: string; match?: RegExp }[] = [
  { id: '14A', label: 'Purchases', match: /^purchases?$|stock|raw material|goods/ },
  { id: '14B', label: 'Freight / carriage', match: /freight|carriage|courier|transport|logistic|shipping/ },
  { id: '14C', label: 'Power and fuel', match: /power|fuel|electric|diesel|petrol|utilit/ },
  { id: '14D', label: 'Imported material' },
  { id: '14E', label: 'Rent and insurance', match: /rent|insurance|lease/ },
  { id: '14F', label: 'Goods lost, stolen, destroyed, written off or disposed of by way of gift or free samples', match: /lost|stolen|destroy|written off|gift|free sample/ },
  { id: '14G', label: 'Royalties', match: /royalt/ },
  { id: '14H', label: 'Employees’ cost (salaries, wages, bonus etc.)', match: /salar|wage|bonus|staff|employee|payroll/ },
  { id: '14I', label: 'Conveyance charges', match: /travel|conveyance|cab|taxi|vehicle hire/ },
  { id: '14J', label: 'Bank charges', match: /bank/ },
  { id: '14K', label: 'Entertainment charges', match: /entertain|meal|food|restaurant|hospitality/ },
  { id: '14L', label: 'Stationery expenses (including postage etc.)', match: /stationer|postage|printing|office supplies/ },
  { id: '14M', label: 'Repair and maintenance', match: /repair|maintenance|amc|service charges/ },
  { id: '14N', label: 'Other miscellaneous expenses' },
  { id: '14O', label: 'Capital goods' },
  { id: '14P', label: 'Any other expense 1 (professional / legal / software)', match: /professional|legal|consult|audit|software|subscription|marketing|advertis/ },
  { id: '14Q', label: 'Any other expense 2' },
];

/** Form head for a bill: imports → 14D, capital goods → 14O, else by category keywords, else 14N. */
export function expenseHeadOf(raw: unknown, category: string, importType: string): string {
  const r = rec(raw);
  if (importType === 'GOODS') return '14D';
  if (r.capital_goods === true || r.is_capital_goods === true) return '14O';
  const cat = category.trim().toLowerCase();
  return HEADS.find((h) => h.match && h.match.test(cat))?.id ?? '14N';
}

/**
 * Table 14 of GSTR-9C. Supplier notes of the FY (`notes`) reduce the head of the bill they are against (value,
 * ITC and eligible ITC, cess included).
 */
export function gstr9cTable14(g9: Gstr9Report, rawPurchases: readonly unknown[], filerStateCode: string, notes: readonly PurchaseReturn[] = []): { rows: Gstr9cExpenseRow[]; unreconciled: number } {
  const acc = new Map<string, { value: number; itc: number; eligible: number }>();
  const bump = (id: string, value: number, itc: number, eligible: number) => {
    const t = acc.get(id) ?? { value: 0, itc: 0, eligible: 0 };
    t.value = round2(t.value + value);
    t.itc = round2(t.itc + itc);
    t.eligible = round2(t.eligible + eligible);
    acc.set(id, t);
  };
  const headOfBill = new Map<string, string>();
  for (const raw of rawPurchases ?? []) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status)) continue;
    const head = expenseHeadOf(raw, c.category, c.importType);
    headOfBill.set(c.id, head);
    if (!inFy(c.date, g9.fyStart)) continue;
    const g = splitLumpTax(c, raw, filerStateCode);
    const itc = round2(g.tax + c.cess);
    const eligible = c.itcEligible ? Math.max(round2(itc - Math.min(c.itcReversed, itc)), 0) : 0;
    bump(head, g.taxable, itc, eligible);
  }
  for (const n of notes ?? []) {
    if (!isLiveNote(n) || !inFy(n.date, g9.fyStart)) continue;
    const head = (n.purchase_id && headOfBill.get(n.purchase_id)) || (n.import_type === 'GOODS' ? '14D' : expenseHeadOf({}, String(n.category ?? ''), ''));
    const itc = round2(num(n.cgst) + num(n.sgst) + num(n.igst) + noteCess(n));
    bump(head, -Math.max(num(n.taxable), 0), -itc, -noteItc(n).total);
  }
  const rows: Gstr9cExpenseRow[] = HEADS.map((h) => ({ id: h.id, label: h.label, ...(acc.get(h.id) ?? { value: 0, itc: 0, eligible: 0 }) }));
  const totalEligible = round2(rows.reduce((t, r) => t + r.eligible, 0));
  rows.push({ id: '14R', label: 'Total ITC booked / availed on expenses', value: round2(rows.reduce((t, r) => t + r.value, 0)), itc: round2(rows.reduce((t, r) => t + r.itc, 0)), eligible: totalEligible, total: true });
  const t7J = g9.table7.find((r) => r.id === '7J');
  const claimed = round2(num(t7J?.igst) + num(t7J?.cgst) + num(t7J?.sgst) + num(t7J?.cess));
  rows.push({ id: '14S', label: 'ITC claimed in the annual return (GSTR-9 Table 7J)', value: 0, itc: 0, eligible: claimed, total: true });
  const unreconciled = round2(totalEligible - claimed);
  rows.push({ id: '14T', label: 'Unreconciled ITC (R − S)', value: 0, itc: 0, eligible: unreconciled, total: true });
  return { rows, unreconciled };
}

/** ITC given back by supplier notes of the FY (eligible bills only, cess included) — the 9C Table 12 split. */
export function notesItcForFy(notes: readonly PurchaseReturn[] | undefined, fyStart: number): number {
  let t = 0;
  for (const n of notes ?? []) if (isLiveNote(n) && inFy(n.date, fyStart)) t += noteItc(n).total;
  return round2(t);
}

/** Bills with a supplier GSTIN that is not valid but ITC claimed — listed under the 9C tables as a check. */
export function invalidGstinItcBills(rawPurchases: readonly unknown[], fyStart: number): string[] {
  const out: string[] = [];
  for (const raw of rawPurchases ?? []) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status) || !inFy(c.date, fyStart) || !c.itcEligible || c.reverseCharge || c.importType) continue;
    if (c.tax > 0 && !checkGstin(c.partyGstin).valid) out.push(c.number || c.id);
  }
  return out;
}
