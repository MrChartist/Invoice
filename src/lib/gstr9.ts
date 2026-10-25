/**
 * GSTR-9 annual return — offline WORKING PAPER (roadmap 5.2).
 *
 * Built by running the existing monthly GSTR-1 / GSTR-3B builders (`buildGstReport`) for
 * each of the 12 months of an Indian financial year and adding them up, plus one pass over
 * the purchase bills for the splits GSTR-9 asks for and GSTR-3B does not carry (inputs /
 * capital goods / input services, RCM registered vs unregistered, reversal rule by rule,
 * inward HSN). Nothing is filed: the output is for preparing the return on the portal with
 * your CA. Pure: no storage, no DOM.
 *
 * Mapping (statutory form GSTR-9, Notification 39/2018-CT as amended):
 *  - Pt II Table 4 (tax payable): 4A B2C = B2CL + B2CS + B2CL credit/debit notes (net, as
 *    the form asks); 4B B2B regular (not reverse charge); 4C exports with payment; 4D SEZ
 *    with payment; 4E deemed exports; 4F advances = GSTR-1 Table 11A − 11B for the year; 4G inward reverse
 *    charge = 3B 3.1(d); 4I/4J credit/debit notes on 4B-4E; 4K/4L in-year amendments (revised − original).
 *  - Table 5 (no tax payable): 5A exports without payment; 5B SEZ without payment; 5C
 *    outward supplies where the recipient pays (reverse charge); 5D exempt (the app has no
 *    separate "exempt" flag: 0), 5E nil rated, 5F non-GST, all from GSTR-1 Table 8 (already
 *    net of notes); 5H/5I notes on 5A-5C; 5J/5K in-year amendments (revised − original).
 *  - Pt III Table 6: 6A = 3B 4A (all four heads, summed over the months); 6B from 3B 4A(5),
 *    split into inputs / capital goods / input services by the bill lines (SAC 99xxxx =
 *    services) or the expense category, else all inputs; capital goods only when a bill
 *    carries `capital_goods: true` (the bill form has no such flag yet); 6C/6D reverse
 *    charge from unregistered / registered suppliers (by a valid supplier GSTIN); 6E import
 *    of goods; 6F import of services; 6G-6H, 6K-6M not modelled (0).
 *  - Table 7 reversals by reason: Rule 37 -> 7A, Rule 42 -> 7C, Rule 43 -> 7D, Sec 17(5)
 *    (blocked credit in full, plus partial reversals) -> 7E, anything else -> 7H.
 *  - Table 8: 8A (ITC as per GSTR-2B) is a MANUAL input — the 2B matcher is a separate
 *    feature; 8B = 6B (+ 6H, 0); 8C not modelled (0); 8D = 8A - (8B + 8C); 8F = ineligible
 *    credit (3B 4D(2)); 8G = IGST on all imports of goods; 8H = 6E; 8I/8J = 8G - 8H.
 *  - Pt IV Table 9 (tax paid): payable = monthly 3B liability incl. reverse charge; paid
 *    through ITC / cash re-run month by month with the Sec 49 set-off order, carrying
 *    unused credit into the next month (the electronic credit ledger), so it can differ
 *    from adding up stand-alone monthly 3B papers. Interest / late fee / penalty: 0.
 *  - Pt V (Tables 10-14, amendments in the next FY): not modelled, shown as 0.
 *  - Pt VI Table 17 / 18: HSN summary of outward (sum of the monthly GSTR-1 Table 12) and
 *    inward supplies (from bill lines that carry an HSN; bills without lines are left out).
 *  - Comparison "as per GSTR-1 vs GSTR-3B vs books" per head.
 *  - GSTR-9 is optional for a registered person whose aggregate turnover in the FY is up to
 *    ₹2 crore (Notification 47/2019-CT and the later FY-wise notifications). The turnover
 *    used is the one the filer entered on the GST page, else the FY total worked out here.
 */

import type { InvoiceRecord } from '../types/invoice';
import type { AdvanceMovement } from './advance-tax';
import {
  buildGstReport,
  computeSetOff,
  normalizePurchase,
  periodLabel,
  toUqc,
  type Gstr1Report,
  type Gstr3bReport,
  type HsnRow,
  type ItcHeads,
  type ReportPeriod,
} from './gst-reports';
import { checkGstin } from './gstin';
import { stateByCode } from './india-states';
import { num, round2 } from './invoice-calc';
import { ecoReporting } from './tax-rules';
import { readPurchase, readPurchaseLines } from './purchase-normalize';
import { toCsv, type CsvCell } from './gstr-json';

/* ───────────────────────── Types ───────────────────────── */

export interface Gstr9Heads {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr9Row extends Gstr9Heads {
  /** Form row id, e.g. "4B". */
  id: string;
  label: string;
  /** False for rows that carry tax only (Tables 6-8) — the taxable column is not printed. */
  hasTaxable: boolean;
  /** Sub-totals and totals. */
  total?: boolean;
  /** Why a row is zero / how it was worked out. */
  note?: string;
}

export interface Gstr9PaidRow {
  id: string;
  label: string;
  payable: number;
  cash: number;
  itc: { igst: number; cgst: number; sgst: number; cess: number };
  note?: string;
}

export interface Gstr9HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  taxable: number;
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr9CompareRow {
  /** What is compared, e.g. "Outward tax" / "Turnover" / "ITC availed". */
  item: string;
  head: 'Taxable' | 'IGST' | 'CGST' | 'SGST' | 'Cess' | 'Total';
  gstr1: number | null;
  gstr3b: number | null;
  books: number | null;
  /** gstr1 - gstr3b (null when either is not available). */
  diff13: number | null;
  /** gstr3b - books. */
  diff3Books: number | null;
}

export interface Gstr9Month {
  period: ReportPeriod;
  label: string;
  gstr1: Gstr1Report;
  gstr3b: Gstr3bReport;
}

export interface Gstr9Turnover {
  /** Total turnover worked out here (Table 5N). */
  computed: number;
  /** Turnover entered by the filer (0 = not entered). */
  entered: number;
  /** The figure used for the threshold. */
  used: number;
  /** True when GSTR-9 is optional (aggregate turnover up to ₹2 crore). */
  optional: boolean;
}

/** The books' GST summary for the FY (books.ts `gstSummary`) — passed in so this module stays pure. */
export interface Gstr9BooksSummary {
  outputIgst: number;
  outputCgst: number;
  outputSgst: number;
  outputCess?: number;
  itc: number;
}

export interface Gstr9Options {
  /** Calendar year in which the FY starts (FY 25-26 -> 2025). */
  fyStart: number;
  gstin?: string;
  filerStateCode?: string;
  links?: readonly { from_id: string; to_id: string; relation: string }[];
  /** Aggregate turnover of the FY entered by the filer (₹). 0 / absent = use the computed figure. */
  turnover?: number;
  /** Preceding-FY turnover (HSN digit rule in the monthly builds). */
  lastFyTurnover?: number;
  /** Books summary for the comparison; omit to leave the books column empty. */
  books?: Gstr9BooksSummary | null;
  /** Table 8A — ITC as per GSTR-2B, entered by hand. */
  itc2b?: Partial<Pick<ItcHeads, 'igst' | 'cgst' | 'sgst' | 'cess'>> | null;
  /** Advance movements (`advanceTaxEvents`, 5.3): Table 11 in each month and 4F for the year. */
  advances?: readonly AdvanceMovement[];
}

export interface Gstr9Report {
  fyStart: number;
  fyLabel: string;
  gstin: string;
  months: Gstr9Month[];
  table4: Gstr9Row[];
  table5: Gstr9Row[];
  table6: Gstr9Row[];
  table7: Gstr9Row[];
  table8: Gstr9Row[];
  table9: Gstr9PaidRow[];
  /** Pt V, Tables 10-14 (amendments / next-FY adjustments): not modelled, all zero. */
  partV: Gstr9Row[];
  table17: Gstr9HsnRow[];
  table18: Gstr9HsnRow[];
  comparison: Gstr9CompareRow[];
  turnover: Gstr9Turnover;
  /** Documents included across the year. */
  documents: number;
  /** Purchase bills read for Table 6-8 / 18. */
  bills: number;
  /** Bills with no HSN-coded lines (left out of Table 18). */
  billsWithoutHsn: number;
  notes: string[];
}

/** GSTR-9 is optional up to this aggregate turnover (₹2 crore). */
export const GSTR9_OPTIONAL_LIMIT = 2_00_00_000;

export const GSTR9_DISCLAIMER =
  'Working paper prepared offline from your invoices and purchase bills — not a filed return and not validated against the GST portal. Verify with your CA before filing.';

/* ───────────────────────── Helpers ───────────────────────── */

const zero = (): Gstr9Heads => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

function addTo(t: Gstr9Heads, s: Partial<Gstr9Heads>, f = 1): void {
  t.taxable = round2(t.taxable + f * num(s.taxable));
  t.igst = round2(t.igst + f * num(s.igst));
  t.cgst = round2(t.cgst + f * num(s.cgst));
  t.sgst = round2(t.sgst + f * num(s.sgst));
  t.cess = round2(t.cess + f * num(s.cess));
}

function sumHeads(...parts: Gstr9Heads[]): Gstr9Heads {
  const t = zero();
  for (const p of parts) addTo(t, p);
  return t;
}

const row = (id: string, label: string, h: Gstr9Heads, extra: Partial<Gstr9Row> = {}): Gstr9Row => ({
  id,
  label,
  hasTaxable: true,
  ...h,
  ...extra,
});

const taxRow = (id: string, label: string, h: Gstr9Heads, extra: Partial<Gstr9Row> = {}): Gstr9Row =>
  row(id, label, { ...h, taxable: 0 }, { hasTaxable: false, ...extra });

/** A DocRow-like (GSTR-1 section row) as heads. */
const docHeads = (d: { taxable: number; igst: number; cgst: number; sgst: number; cess?: number }): Gstr9Heads => ({
  taxable: d.taxable,
  igst: d.igst,
  cgst: d.cgst,
  sgst: d.sgst,
  cess: d.cess ?? 0,
});

function monthsOf(fyStart: number): ReportPeriod[] {
  return [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((month) => ({ kind: 'month' as const, fyStart, month }));
}

function inFy(date: string, fyStart: number): boolean {
  const d = String(date).slice(0, 10);
  return d >= `${fyStart}-04-01` && d <= `${fyStart + 1}-03-31`;
}

/** Expense categories that are services (input services in 6B) when a bill has no SAC-coded lines. */
const SERVICE_CATEGORIES = new Set([
  'rent', 'salaries', 'software & subscriptions', 'professional fees', 'travel', 'utilities', 'marketing', 'bank charges',
]);

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});

/** Share (0-1) of a bill's value that is input services, from its lines or its category. */
function servicesShare(raw: unknown, category: string): number {
  const lines = readPurchaseLines(raw);
  const coded = lines.filter((l) => l.hsn);
  const value = (l: { quantity: number; unitCost: number }) => Math.max(num(l.quantity) * num(l.unitCost), 0);
  const total = coded.reduce((s, l) => s + value(l), 0);
  if (coded.length && total > 0) {
    return coded.filter((l) => l.hsn.replace(/\D/g, '').startsWith('99')).reduce((s, l) => s + value(l), 0) / total;
  }
  return SERVICE_CATEGORIES.has(category.trim().toLowerCase()) ? 1 : 0;
}

function hsnKey(h: { hsn: string; uqc: string; rate: number }): string {
  return `${h.hsn}|${h.uqc}|${h.rate}`;
}

function sortHsn(rows: Iterable<Gstr9HsnRow>): Gstr9HsnRow[] {
  return [...rows].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate || a.uqc.localeCompare(b.uqc));
}

/* ───────────────────────── Builder ───────────────────────── */

export function buildGstr9(invoices: InvoiceRecord[], rawPurchases: unknown[], opts: Gstr9Options): Gstr9Report {
  const fyStart = opts.fyStart;
  const gstin = (opts.gstin ?? '').trim().toUpperCase();
  const months: Gstr9Month[] = monthsOf(fyStart).map((period) => {
    const rep = buildGstReport(invoices, rawPurchases, {
      period,
      gstin,
      filerStateCode: opts.filerStateCode,
      links: opts.links,
      turnover: opts.lastFyTurnover,
      advances: opts.advances,
    });
    return { period, label: periodLabel(period), gstr1: rep.gstr1, gstr3b: rep.gstr3b };
  });

  /* ── Table 4 / 5 from GSTR-1 ── */
  const t4 = {
    A: zero(), B: zero(), C: zero(), D: zero(), E: zero(), F: zero(), G: zero(), I: zero(), J: zero(), K: zero(), L: zero(),
  };
  const t5 = { A: zero(), B: zero(), C: zero(), D: zero(), E: zero(), F: zero(), H: zero(), I: zero(), J: zero(), K: zero() };
  const t5C1 = zero();
  let documents = 0;

  for (const m of months) {
    const g = m.gstr1;
    documents += g.counts.included;
    for (const d of g.b2b) {
      const h = docHeads(d);
      if (d.rchrg === 'Y') addTo(t5.C, { taxable: h.taxable });
      else if (d.invTyp === 'SEWP') addTo(t4.D, h);
      else if (d.invTyp === 'SEWOP') addTo(t5.B, h);
      else if (d.invTyp === 'DE') addTo(t4.E, h);
      else addTo(t4.B, h);
    }
    for (const d of g.b2cl) addTo(t4.A, docHeads(d));
    for (const r of g.b2cs) addTo(t4.A, { taxable: r.txval, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess });
    for (const d of g.exp) {
      if (d.expType === 'WPAY') addTo(t4.C, docHeads(d));
      else addTo(t5.A, docHeads(d));
    }
    for (const n of g.cdnr) {
      const h = docHeads(n);
      const noTax = n.rchrg === 'Y' || n.invTyp === 'SEWOP';
      if (noTax) addTo(n.noteType === 'C' ? t5.H : t5.I, n.rchrg === 'Y' ? { taxable: h.taxable } : h);
      else addTo(n.noteType === 'C' ? t4.I : t4.J, h);
    }
    for (const n of g.cdnur) {
      const h = docHeads(n);
      if (n.unregType === 'B2CL') addTo(t4.A, h, n.noteType === 'C' ? -1 : 1);
      else if (n.unregType === 'EXPWOP') addTo(n.noteType === 'C' ? t5.H : t5.I, h);
      else addTo(n.noteType === 'C' ? t4.I : t4.J, h);
    }
    // 5C1: supplies through an e-commerce operator that pays the tax u/s 9(5) (GSTR-1 Table 14(b), value only).
    for (const e of g.eco?.pay95 ?? []) addTo(t5C1, { taxable: e.value });
    for (const n of g.nil) {
      addTo(t5.D, { taxable: n.exempt });
      addTo(t5.E, { taxable: n.nil });
      addTo(t5.F, { taxable: n.nonGst });
    }
    addTo(t4.G, docHeads(m.gstr3b.outward.inwardRcm));
    // 4F: advances taxed in the year less those adjusted / refunded (GSTR-1 Table 11A − 11B).
    for (const r of g.at ?? []) addTo(t4.F, { taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess });
    for (const r of g.txpd ?? []) addTo(t4.F, { taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess }, -1);
    // 4K / 4L and 5J / 5K: in-year amendments, revised − original (the same deltas GSTR-3B took), so
    // 4N agrees with the tax paid in Table 9. An increase goes to the (+) row, a decrease to the (−) row.
    for (const e of g.amendments?.effects ?? []) {
      const p = e.taxPayable;
      const net = p.taxable + p.igst + p.cgst + p.sgst + p.cess;
      if (net > 0) addTo(t4.K, p);
      else if (net < 0) addTo(t4.L, p, -1);
      if (e.noTax.taxable > 0) addTo(t5.J, { taxable: e.noTax.taxable });
      else if (e.noTax.taxable < 0) addTo(t5.K, { taxable: -e.noTax.taxable });
    }
  }

  const t4H = sumHeads(t4.A, t4.B, t4.C, t4.D, t4.E, t4.F, t4.G);
  const t4M = zero();
  addTo(t4M, t4.I, -1);
  addTo(t4M, t4.J);
  // 4M = −I + J + K − L (K: amendments that add, L: amendments that reduce).
  addTo(t4M, t4.K);
  addTo(t4M, t4.L, -1);
  const t4N = sumHeads(t4H, t4M);

  const table4: Gstr9Row[] = [
    row('4A', 'Supplies made to un-registered persons (B2C), net of credit/debit notes', t4.A),
    row('4B', 'Supplies made to registered persons (B2B)', t4.B),
    row('4C', 'Zero rated supply (export) on payment of tax (except supplies to SEZs)', t4.C),
    row('4D', 'Supply to SEZs on payment of tax', t4.D),
    row('4E', 'Deemed exports', t4.E),
    row('4F', 'Advances on which tax has been paid but invoice has not been issued', t4.F, { note: 'GSTR-1 Table 11A − 11B over the year (advances received less adjusted / refunded).' }),
    row('4G', 'Inward supplies on which tax is to be paid on reverse charge basis', t4.G, { note: 'GSTR-3B 3.1(d), from purchase bills.' }),
    row('4H', 'Sub-total (A to G above)', t4H, { total: true }),
    row('4I', 'Credit notes issued in respect of transactions specified in (B) to (E) above (-)', t4.I),
    row('4J', 'Debit notes issued in respect of transactions specified in (B) to (E) above (+)', t4.J),
    row('4K', 'Supplies / tax declared through amendments (+)', t4.K, { note: 'In-year amendments (GSTR-1 9A / 9C / 10): revised − original where it increased.' }),
    row('4L', 'Supplies / tax reduced through amendments (-)', t4.L, { note: 'In-year amendments: revised − original where it decreased.' }),
    row('4M', 'Sub-total (I to L above)', t4M, { total: true }),
    row('4N', 'Supplies and advances on which tax is to be paid (H + M above)', t4N, { total: true }),
  ];

  const t5G = sumHeads(t5.A, t5.B, t5.C, t5C1, t5.D, t5.E, t5.F);
  const t5L = zero();
  addTo(t5L, t5.H, -1);
  addTo(t5L, t5.I);
  // 5L = −H + I + J − K.
  addTo(t5L, t5.J);
  addTo(t5L, t5.K, -1);
  const t5M = sumHeads(t5G, t5L);
  const t5N = zero();
  addTo(t5N, { taxable: t4N.taxable + t5M.taxable - t4.G.taxable });

  const table5: Gstr9Row[] = [
    row('5A', 'Zero rated supply (export) without payment of tax', t5.A),
    row('5B', 'Supply to SEZs without payment of tax', t5.B),
    row('5C', 'Supplies on which tax is to be paid by the recipient on reverse charge basis', t5.C),
    // Only shown when there are such supplies, so papers without e-commerce keep their shape.
    ...(t5C1.taxable !== 0
      ? [row('5C1', 'Supplies on which tax is to be paid by e-commerce operators as per section 9(5)', t5C1, {
          note: ecoReporting(`${fyStart}-04-01`).gstr9Row5C1
            ? 'GSTR-1 Table 14(b) over the year (value only; the operator pays the tax).'
            : 'GSTR-1 Table 14(b) over the year. Row 5C1 is on the form from FY 2024-25; for this year ask your CA where to report it.',
        })]
      : []),
    row('5D', 'Exempted', t5.D, { note: 'The app does not separate exempt from nil-rated lines; both are in 5E.' }),
    row('5E', 'Nil rated', t5.E),
    row('5F', 'Non-GST supply', t5.F),
    row('5G', 'Sub-total (A to F above)', t5G, { total: true }),
    row('5H', 'Credit notes issued in respect of transactions specified in A to F above (-)', t5.H),
    row('5I', 'Debit notes issued in respect of transactions specified in A to F above (+)', t5.I),
    row('5J', 'Supplies declared through amendments (+)', t5.J, { note: 'In-year amendments of zero-rated / reverse-charge / nil lines (increase).' }),
    row('5K', 'Supplies reduced through amendments (-)', t5.K, { note: 'In-year amendments of zero-rated / reverse-charge / nil lines (decrease).' }),
    row('5L', 'Sub-total (H to K above)', t5L, { total: true }),
    row('5M', 'Turnover on which tax is not to be paid (G + L above)', t5M, { total: true }),
    row('5N', 'Total turnover (including advances) (4N + 5M - 4G above)', t5N, { total: true }),
  ];

  /* ── Table 6 / 7 / 8 from the bills ── */
  const s6A = zero();
  const s3bRev = zero();
  const s3bInelig = zero();
  for (const m of months) {
    const itc = m.gstr3b.itc;
    for (const h of [itc.importGoods, itc.importServices, itc.availableRcm, itc.availableOther]) addTo(s6A, h);
    addTo(s3bRev, itc.reversedRules);
    addTo(s3bRev, itc.reversedOther);
    addTo(s3bInelig, itc.ineligible);
  }

  const filerSt =
    checkGstin(gstin).stateCode ??
    stateByCode(opts.filerStateCode)?.code ??
    checkGstin(
      (invoices ?? []).find((i) => i && inFy(String(i.issue_date), fyStart) && i.sender?.companyGstin)?.sender?.companyGstin ?? '',
    ).stateCode ??
    '';

  const b6 = { inputs: zero(), capital: zero(), services: zero(), C: zero(), D: zero(), E: zero(), F: zero() };
  const r7 = { A: zero(), B: zero(), C: zero(), D: zero(), E: zero(), F: zero(), G: zero(), H: zero() };
  const t8F = zero();
  const t8G = zero();
  const inward = new Map<string, Gstr9HsnRow>();
  let bills = 0;
  let billsWithoutHsn = 0;

  for (const raw of rawPurchases ?? []) {
    const p = normalizePurchase(raw, filerSt);
    if (!p || !inFy(p.date, fyStart)) continue;
    const core = readPurchase(raw);
    bills++;
    const heads: Gstr9Heads = { taxable: 0, igst: p.igst, cgst: p.cgst, sgst: p.sgst, cess: p.cess ?? 0 };
    const tax = round2(p.igst + p.cgst + p.sgst + (p.cess ?? 0));
    const blocked = !p.itcEligible && p.itcReversalReason === 'SEC_17_5';
    const claimed = p.itcEligible || blocked;

    if (p.importType === 'GOODS') {
      addTo(t8G, { igst: p.igst });
      if (tax > 0 && claimed) addTo(b6.E, heads);
    } else if (p.importType === 'SERVICES') {
      if (claimed) addTo(b6.F, heads);
    } else if (p.reverseCharge) {
      if (claimed) addTo(checkGstin(p.supplierGstin).valid ? b6.D : b6.C, heads);
    } else if (tax > 0 && claimed) {
      const r = asRec(raw);
      if (r.capital_goods === true || r.is_capital_goods === true) addTo(b6.capital, heads);
      else {
        const share = servicesShare(raw, core?.category ?? '');
        if (share > 0) addTo(b6.services, heads, share);
        if (share < 1) addTo(b6.inputs, heads, 1 - share);
      }
    }
    // Ineligible (not blocked under 17(5)) credit never reaches Table 6.
    if (!p.itcEligible && !blocked && tax > 0) addTo(t8F, heads);
    if (blocked && tax > 0) addTo(r7.E, heads);
    if (p.itcReversed > 0 && tax > 0 && p.itcEligible) {
      const ratio = Math.min(p.itcReversed, tax) / tax;
      const part = { igst: p.igst * ratio, cgst: p.cgst * ratio, sgst: p.sgst * ratio };
      const reason = p.itcReversalReason;
      const bucket =
        reason === 'RULE_37' ? r7.A : reason === 'RULE_42' ? r7.C : reason === 'RULE_43' ? r7.D : reason === 'SEC_17_5' ? r7.E : r7.H;
      addTo(bucket, part);
    }

    // Table 18 — inward HSN from coded lines; the bill's actual tax is spread by line value x rate.
    const rawLines = Array.isArray(asRec(raw).lines) ? (asRec(raw).lines as unknown[]) : Array.isArray(asRec(raw).items) ? (asRec(raw).items as unknown[]) : [];
    const lines = readPurchaseLines(raw).map((l, i) => {
      const lr = asRec(rawLines[i]);
      return {
        ...l,
        rate: num(lr.tax_rate ?? lr.gst_rate),
        unit: typeof lr.unit === 'string' ? lr.unit : '',
        taxable: round2(Math.max(num(l.quantity) * num(l.unitCost), 0)),
      };
    });
    const coded = lines.filter((l) => l.hsn && l.taxable > 0);
    if (!coded.length) {
      billsWithoutHsn++;
      continue;
    }
    const weight = coded.reduce((s, l) => s + l.taxable * l.rate, 0);
    for (const l of coded) {
      const share = weight > 0 ? (l.taxable * l.rate) / weight : 0;
      const uqc = toUqc(l.unit, l.hsn);
      const key = hsnKey({ hsn: l.hsn, uqc, rate: l.rate });
      const h = inward.get(key) ?? { hsn: l.hsn, description: l.name, uqc, qty: 0, taxable: 0, rate: l.rate, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      h.qty = round2(h.qty + (uqc === 'NA' ? 0 : num(l.quantity)));
      h.taxable = round2(h.taxable + l.taxable);
      h.igst = round2(h.igst + p.igst * share);
      h.cgst = round2(h.cgst + p.cgst * share);
      h.sgst = round2(h.sgst + p.sgst * share);
      inward.set(key, h);
    }
  }

  const t6B = sumHeads(b6.inputs, b6.capital, b6.services);
  const t6G = zero();
  const t6H = zero();
  const t6I = sumHeads(t6B, b6.C, b6.D, b6.E, b6.F, t6G, t6H);
  const t6J = sumHeads(t6I);
  addTo(t6J, s6A, -1);
  const t6N = zero();
  const t6O = sumHeads(t6I, t6N);

  const table6: Gstr9Row[] = [
    taxRow('6A', 'Total amount of input tax credit availed through FORM GSTR-3B (sum total of Table 4A)', s6A, { total: true }),
    taxRow('6B(i)', 'Inward supplies (other than imports and inward supplies liable to reverse charge) - Inputs', b6.inputs),
    taxRow('6B(ii)', '… - Capital goods', b6.capital, { note: 'Only bills marked capital_goods: the bill form has no such flag yet.' }),
    taxRow('6B(iii)', '… - Input services', b6.services, { note: 'By SAC (99xxxx) lines, else by expense category.' }),
    taxRow('6C', 'Inward supplies received from unregistered persons liable to reverse charge', b6.C),
    taxRow('6D', 'Inward supplies received from registered persons liable to reverse charge', b6.D),
    taxRow('6E', 'Import of goods (including supplies from SEZs)', b6.E),
    taxRow('6F', 'Import of services (excluding inward supplies from SEZs)', b6.F),
    taxRow('6G', 'Input tax credit received from ISD', t6G, { note: 'ISD is not modelled.' }),
    taxRow('6H', 'Amount of ITC reclaimed (other than B above) under the provisions of the Act', t6H, { note: 'Not modelled.' }),
    taxRow('6I', 'Sub-total (B to H above)', t6I, { total: true }),
    taxRow('6J', 'Difference (I - A above)', t6J, { total: true }),
    taxRow('6K', 'Transition credit through TRAN-I (including revisions if any)', zero(), { note: 'Not applicable / not modelled.' }),
    taxRow('6L', 'Transition credit through TRAN-II', zero(), { note: 'Not applicable / not modelled.' }),
    taxRow('6M', 'Any other ITC availed but not specified above', zero()),
    taxRow('6N', 'Sub-total (K to M above)', t6N, { total: true }),
    taxRow('6O', 'Total ITC availed (I + N above)', t6O, { total: true }),
  ];

  const t7I = sumHeads(r7.A, r7.B, r7.C, r7.D, r7.E, r7.F, r7.G, r7.H);
  const t7J = sumHeads(t6O);
  addTo(t7J, t7I, -1);
  const table7: Gstr9Row[] = [
    taxRow('7A', 'As per Rule 37', r7.A),
    taxRow('7B', 'As per Rule 39', r7.B, { note: 'ISD is not modelled.' }),
    taxRow('7C', 'As per Rule 42', r7.C),
    taxRow('7D', 'As per Rule 43', r7.D),
    taxRow('7E', 'As per section 17(5)', r7.E, { note: 'Blocked credit in full plus partial 17(5) reversals.' }),
    taxRow('7F', 'Reversal of TRAN-I credit', r7.F),
    taxRow('7G', 'Reversal of TRAN-II credit', r7.G),
    taxRow('7H', 'Other reversal (please specify)', r7.H, { note: 'Rule 38 and "other" reversal reasons.' }),
    taxRow('7I', 'Total ITC reversed (sum of A to H above)', t7I, { total: true }),
    taxRow('7J', 'Net ITC available for utilization (6O - 7I)', t7J, { total: true }),
  ];

  const t8A: Gstr9Heads = {
    taxable: 0,
    igst: round2(num(opts.itc2b?.igst)),
    cgst: round2(num(opts.itc2b?.cgst)),
    sgst: round2(num(opts.itc2b?.sgst)),
    cess: round2(num(opts.itc2b?.cess)),
  };
  const t8B = sumHeads(t6B, t6H);
  const t8C = zero();
  const t8D = sumHeads(t8A);
  addTo(t8D, t8B, -1);
  addTo(t8D, t8C, -1);
  const t8E = zero();
  const t8H = sumHeads(b6.E);
  const t8I = sumHeads(t8G);
  addTo(t8I, t8H, -1);
  const t8J = sumHeads(t8I);
  const t8K = sumHeads(t8E, t8F, t8J);
  const table8: Gstr9Row[] = [
    taxRow('8A', 'ITC as per GSTR-2B (Table 3 & 5 thereof)', t8A, { note: 'Enter from GSTR-2B (the 2B matcher is a separate feature).' }),
    taxRow('8B', 'ITC as per sum total of 6(B) and 6(H) above', t8B),
    taxRow('8C', 'ITC on inward supplies (other than imports and RCM) received during the FY but availed in the next FY', t8C, { note: 'Not modelled.' }),
    taxRow('8D', 'Difference [A - (B + C)]', t8D, { total: true }),
    taxRow('8E', 'ITC available but not availed', t8E, { note: 'Not modelled.' }),
    taxRow('8F', 'ITC available but ineligible', t8F, { note: 'Bills marked ITC not eligible (other than Sec 17(5)).' }),
    taxRow('8G', 'IGST paid on import of goods (including supplies from SEZ)', t8G),
    taxRow('8H', 'IGST credit availed on import of goods (as per 6(E) above)', t8H),
    taxRow('8I', 'Difference (G - H)', t8I, { total: true }),
    taxRow('8J', 'ITC available but not availed on import of goods (equal to I)', t8J),
    taxRow('8K', 'Total ITC to be lapsed in current financial year (E + F + J)', t8K, { total: true }),
  ];

  /* ── Table 9: tax paid, re-run month by month with the credit ledger carried forward ── */
  const pay = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const cash = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const used = {
    igst: { igst: 0, cgst: 0, sgst: 0 },
    cgst: { igst: 0, cgst: 0, sgst: 0 },
    sgst: { igst: 0, cgst: 0, sgst: 0 },
  };
  let carry = { igst: 0, cgst: 0, sgst: 0 };
  let cessItc = 0;
  for (const m of months) {
    const p = m.gstr3b.payment;
    const net = m.gstr3b.itc.net;
    const so = computeSetOff(
      p.liability,
      { igst: net.igst + carry.igst, cgst: net.cgst + carry.cgst, sgst: net.sgst + carry.sgst },
      p.rcLiability,
    );
    carry = so.itcCarry;
    for (const k of ['igst', 'cgst', 'sgst'] as const) {
      pay[k] = round2(pay[k] + p.liability[k] + p.rcLiability[k]);
      cash[k] = round2(cash[k] + so.cash[k]);
    }
    // WP-6: cess credit (cess on purchase bills) pays cess only; `cess` is the cash part, `cessLiability` the whole.
    const cessUsed = num(p.cessItcUsed);
    pay.cess = round2(pay.cess + num(p.cess) + cessUsed);
    cash.cess = round2(cash.cess + num(p.cess));
    cessItc = round2(cessItc + cessUsed);
    used.igst.igst = round2(used.igst.igst + so.itcUsed.igst.igst);
    used.igst.cgst = round2(used.igst.cgst + so.itcUsed.igst.cgst);
    used.igst.sgst = round2(used.igst.sgst + so.itcUsed.igst.sgst);
    used.cgst.cgst = round2(used.cgst.cgst + so.itcUsed.cgst.cgst);
    used.cgst.igst = round2(used.cgst.igst + so.itcUsed.cgst.igst);
    used.sgst.sgst = round2(used.sgst.sgst + so.itcUsed.sgst.sgst);
    used.sgst.igst = round2(used.sgst.igst + so.itcUsed.sgst.igst);
  }
  const noItc = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const table9: Gstr9PaidRow[] = [
    // Row = liability head; itc.<credit head> = credit of that head used against it.
    { id: '9-IGST', label: 'Integrated Tax', payable: pay.igst, cash: cash.igst, itc: { igst: used.igst.igst, cgst: used.cgst.igst, sgst: used.sgst.igst, cess: 0 } },
    { id: '9-CGST', label: 'Central Tax', payable: pay.cgst, cash: cash.cgst, itc: { igst: used.igst.cgst, cgst: used.cgst.cgst, sgst: 0, cess: 0 } },
    { id: '9-SGST', label: 'State / UT Tax', payable: pay.sgst, cash: cash.sgst, itc: { igst: used.igst.sgst, cgst: 0, sgst: used.sgst.sgst, cess: 0 } },
    { id: '9-CESS', label: 'Cess', payable: pay.cess, cash: cash.cess, itc: { ...noItc, cess: cessItc }, note: 'Cess credit (cess on purchase bills) pays cess only, month by month; not carried forward across months here.' },
    { id: '9-INT', label: 'Interest', payable: 0, cash: 0, itc: { ...noItc }, note: 'Not tracked; see the Compliance tab estimates.' },
    { id: '9-LATE', label: 'Late fee', payable: 0, cash: 0, itc: { ...noItc }, note: 'Not tracked; see the Compliance tab estimates.' },
    { id: '9-PEN', label: 'Penalty', payable: 0, cash: 0, itc: { ...noItc } },
    { id: '9-OTH', label: 'Other', payable: 0, cash: 0, itc: { ...noItc } },
  ];

  const amendNote = 'Amendments / next-FY adjustments are not modelled: enter them on the portal if any.';
  const partV: Gstr9Row[] = [
    row('10', 'Supplies / tax declared through amendments (+) (net of debit notes)', zero(), { note: amendNote }),
    row('11', 'Supplies / tax reduced through amendments (-) (net of credit notes)', zero(), { note: amendNote }),
    taxRow('12', 'Reversal of ITC availed during previous financial year', zero(), { note: amendNote }),
    taxRow('13', 'ITC availed for the previous financial year', zero(), { note: amendNote }),
    taxRow('14', 'Differential tax paid on account of declaration in 10 & 11 above', zero(), { note: amendNote }),
  ];

  /* ── Table 17: outward HSN = sum of the monthly GSTR-1 Table 12 ── */
  const outward = new Map<string, Gstr9HsnRow>();
  for (const m of months) {
    for (const h of m.gstr1.hsn as HsnRow[]) {
      const key = hsnKey(h);
      const t = outward.get(key) ?? { hsn: h.hsn, description: h.description, uqc: h.uqc, qty: 0, taxable: 0, rate: h.rate, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      t.qty = round2(t.qty + h.qty);
      t.taxable = round2(t.taxable + h.taxable);
      t.igst = round2(t.igst + h.igst);
      t.cgst = round2(t.cgst + h.cgst);
      t.sgst = round2(t.sgst + h.sgst);
      t.cess = round2(t.cess + h.cess);
      outward.set(key, t);
    }
  }

  /* ── Comparison: GSTR-1 vs GSTR-3B vs books ── */
  const g3Out = zero();
  let g3Turnover = 0;
  for (const m of months) {
    const o = m.gstr3b.outward;
    addTo(g3Out, o.taxable);
    addTo(g3Out, o.zeroRated);
    g3Turnover = round2(
      g3Turnover + o.taxable.taxable + o.zeroRated.taxable + o.nilExempt.inter + o.nilExempt.intra + o.nonGst + m.gstr3b.outwardRcmTaxable + (m.gstr3b.ecoSupplies95 ?? 0),
    );
  }
  const g1Out = sumHeads(t4N);
  addTo(g1Out, t4.G, -1);
  const books = opts.books ?? null;
  const cmp = (item: string, head: Gstr9CompareRow['head'], a: number | null, b: number | null, c: number | null): Gstr9CompareRow => ({
    item,
    head,
    gstr1: a,
    gstr3b: b,
    books: c,
    diff13: a === null || b === null ? null : round2(a - b),
    diff3Books: b === null || c === null ? null : round2(b - c),
  });
  const s6Atotal = round2(s6A.igst + s6A.cgst + s6A.sgst + s6A.cess);
  const comparison: Gstr9CompareRow[] = [
    cmp('Total turnover (excl. inward RCM)', 'Taxable', t5N.taxable, g3Turnover, null),
    cmp('Outward tax', 'IGST', g1Out.igst, g3Out.igst, books ? round2(books.outputIgst) : null),
    cmp('Outward tax', 'CGST', g1Out.cgst, g3Out.cgst, books ? round2(books.outputCgst) : null),
    cmp('Outward tax', 'SGST', g1Out.sgst, g3Out.sgst, books ? round2(books.outputSgst) : null),
    cmp('Outward tax', 'Cess', g1Out.cess, g3Out.cess, books ? round2(num(books.outputCess)) : null),
    // ITC: GSTR-1 has none; "as per bills" (6I) vs 3B (6A) vs books.
    cmp('ITC availed (bills 6I vs 3B 6A)', 'Total', round2(t6I.igst + t6I.cgst + t6I.sgst + t6I.cess), s6Atotal, books ? round2(books.itc) : null),
  ];

  const entered = Math.max(num(opts.turnover), 0);
  const computed = t5N.taxable;
  const usedTurnover = entered > 0 ? entered : computed;
  const turnover: Gstr9Turnover = { computed, entered, used: usedTurnover, optional: usedTurnover <= GSTR9_OPTIONAL_LIMIT };

  const notes = [
    GSTR9_DISCLAIMER,
    turnover.optional
      ? `Aggregate turnover ${entered > 0 ? 'entered' : 'worked out'} (₹${usedTurnover.toFixed(2)}) is up to ₹2 crore: filing GSTR-9 is optional for this FY (check the FY's notification).`
      : `Aggregate turnover ${entered > 0 ? 'entered' : 'worked out'} (₹${usedTurnover.toFixed(2)}) is above ₹2 crore: GSTR-9 is mandatory (and GSTR-9C above ₹5 crore).`,
    'Built from the 12 monthly GSTR-1 / GSTR-3B working papers of this app, not from what was actually filed on the portal; amend for any differences in the filed returns.',
    'Advances (4F) are the net of GSTR-1 Table 11A and 11B for the year. Amendments made in the year are in 4K/4L and 5J/5K (revised − original); Part V (amendments of this year’s supplies made next year), ISD, TRAN credit and 8C/8E are not modelled and shown as 0.',
    'Table 9 re-runs the monthly set-off carrying unused ITC into the next month; a month whose credit notes exceed its sales is not carried back.',
    'Books compare tax heads only and do not filter by GSTIN.',
  ];

  return {
    fyStart,
    fyLabel: periodLabel({ kind: 'fy', fyStart }),
    gstin,
    months,
    table4,
    table5,
    table6,
    table7,
    table8,
    table9,
    partV,
    table17: sortHsn(outward.values()),
    table18: sortHsn(inward.values()),
    comparison,
    turnover,
    documents,
    bills,
    billsWithoutHsn,
    notes,
  };
}

/* ───────────────────────── Exports ───────────────────────── */

const headsOut = (r: Gstr9Row) => ({
  ...(r.hasTaxable ? { txval: round2(r.taxable) } : {}),
  iamt: round2(r.igst),
  camt: round2(r.cgst),
  samt: round2(r.sgst),
  csamt: round2(r.cess),
});

/**
 * JSON-like working paper. Keys are readable (table / row ids), NOT the portal's GSTR-9
 * offline-tool schema, which this app does not claim to reproduce.
 */
export function gstr9WorkingPaper(r: Gstr9Report): Record<string, unknown> {
  const table = (rows: Gstr9Row[]) => Object.fromEntries(rows.map((x) => [x.id, { desc: x.label, ...headsOut(x), ...(x.note ? { note: x.note } : {}) }]));
  const hsn = (rows: Gstr9HsnRow[]) =>
    rows.map((h) => ({ hsn_sc: h.hsn, desc: h.description, uqc: h.uqc, qty: h.qty, txval: h.taxable, rt: h.rate, iamt: h.igst, camt: h.cgst, samt: h.sgst, csamt: h.cess }));
  return {
    kind: 'GSTR-9 working paper (not the portal schema)',
    disclaimer: GSTR9_DISCLAIMER,
    gstin: r.gstin,
    fy: r.fyLabel,
    fp: `03${r.fyStart + 1}`,
    turnover: r.turnover,
    pt_ii: { table4: table(r.table4), table5: table(r.table5) },
    pt_iii: { table6: table(r.table6), table7: table(r.table7), table8: table(r.table8) },
    pt_iv: {
      table9: r.table9.map((x) => ({ desc: x.label, txpyble: x.payable, txpaid_cash: x.cash, tax_paid_itc_iamt: x.itc.igst, tax_paid_itc_camt: x.itc.cgst, tax_paid_itc_samt: x.itc.sgst, tax_paid_itc_csamt: x.itc.cess, ...(x.note ? { note: x.note } : {}) })),
    },
    pt_v: table(r.partV),
    pt_vi: { table17: hsn(r.table17), table18: hsn(r.table18) },
    comparison: r.comparison,
    notes: r.notes,
  };
}

/** One CSV, one block per table (blank line between), formula-guarded cells. */
export function gstr9Csv(r: Gstr9Report): string {
  const block = (title: string, rows: Gstr9Row[]): CsvCell[][] => [
    [title],
    ['Row', 'Description', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess', 'Note'],
    ...rows.map((x): CsvCell[] => [x.id, x.label, x.hasTaxable ? x.taxable : '', x.igst, x.cgst, x.sgst, x.cess, x.note ?? '']),
    [],
  ];
  const hsn = (title: string, rows: Gstr9HsnRow[]): CsvCell[][] => [
    [title],
    ['HSN/SAC', 'Description', 'UQC', 'Quantity', 'Taxable value', 'Rate %', 'IGST', 'CGST', 'SGST', 'Cess'],
    ...rows.map((h): CsvCell[] => [h.hsn, h.description, h.uqc, h.qty, h.taxable, h.rate, h.igst, h.cgst, h.sgst, h.cess]),
    [],
  ];
  const rows: CsvCell[][] = [
    [`GSTR-9 working paper ${r.fyLabel}`, r.gstin ? `GSTIN ${r.gstin}` : 'All GSTINs', GSTR9_DISCLAIMER],
    [],
    ...block('Table 4 - Outward supplies on which tax is payable', r.table4),
    ...block('Table 5 - Outward supplies on which tax is not payable', r.table5),
    ...block('Table 6 - ITC availed', r.table6),
    ...block('Table 7 - ITC reversed and ineligible', r.table7),
    ...block('Table 8 - Other ITC information', r.table8),
    ['Table 9 - Tax paid'],
    ['Description', 'Tax payable', 'Paid in cash', 'Paid through ITC - IGST', 'Paid through ITC - CGST', 'Paid through ITC - SGST', 'Paid through ITC - Cess', 'Note'],
    ...r.table9.map((x): CsvCell[] => [x.label, x.payable, x.cash, x.itc.igst, x.itc.cgst, x.itc.sgst, x.itc.cess, x.note ?? '']),
    [],
    ...block('Part V - Tables 10-14 (not modelled)', r.partV),
    ...hsn('Table 17 - HSN summary of outward supplies', r.table17),
    ...hsn('Table 18 - HSN summary of inward supplies', r.table18),
    ['Comparison - GSTR-1 vs GSTR-3B vs books'],
    ['Item', 'Head', 'GSTR-1', 'GSTR-3B', 'Books', 'GSTR-1 minus 3B', '3B minus books'],
    ...r.comparison.map((c): CsvCell[] => [c.item, c.head, c.gstr1 ?? '', c.gstr3b ?? '', c.books ?? '', c.diff13 ?? '', c.diff3Books ?? '']),
    [],
    ['Notes'],
    ...r.notes.map((n): CsvCell[] => [n]),
  ];
  return toCsv(rows);
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const inr = (n: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Standalone printable HTML (own stylesheet), every value escaped — follows `buildSummaryHtml`. */
export function buildGstr9Html(r: Gstr9Report, filerName = ''): string {
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '-' : inr(v));
  const table = (title: string, rows: Gstr9Row[]) => `<h2>${esc(title)}</h2>
<table><thead><tr><th>Row</th><th>Description</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>
${rows
  .map(
    (x) =>
      `<tr${x.total ? ' class="b"' : ''}><td>${esc(x.id)}</td><td>${esc(x.label)}${x.note ? `<div class="m">${esc(x.note)}</div>` : ''}</td><td class="n">${x.hasTaxable ? n(x.taxable) : ''}</td><td class="n">${n(x.igst)}</td><td class="n">${n(x.cgst)}</td><td class="n">${n(x.sgst)}</td><td class="n">${n(x.cess)}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`;
  const hsn = (title: string, rows: Gstr9HsnRow[]) => `<h2>${esc(title)}</h2>
<table><thead><tr><th>HSN/SAC</th><th>Description</th><th>UQC</th><th class="n">Qty</th><th class="n">Taxable</th><th class="n">Rate %</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Cess</th></tr></thead><tbody>
${rows.length ? rows.map((h) => `<tr><td>${esc(h.hsn)}</td><td>${esc(h.description)}</td><td>${esc(h.uqc)}</td><td class="n">${esc(h.qty)}</td><td class="n">${n(h.taxable)}</td><td class="n">${esc(h.rate)}</td><td class="n">${n(h.igst)}</td><td class="n">${n(h.cgst)}</td><td class="n">${n(h.sgst)}</td><td class="n">${n(h.cess)}</td></tr>`).join('\n') : '<tr><td colspan="10">No rows</td></tr>'}
</tbody></table>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GSTR-9 working paper - ${esc(r.fyLabel)}</title>
<style>
body{font:12px/1.45 system-ui,sans-serif;color:black;margin:24px;max-width:1000px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:22px 0 6px;border-bottom:2px solid black;padding-bottom:3px}
p.m,div.m{color:dimgray;margin:2px 0;font-size:11px}table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid lightgray;padding:3px 6px;text-align:left;vertical-align:top}th{font-size:10px;text-transform:uppercase;color:dimgray}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}tr.b td{font-weight:700;border-top:1px solid black}
.w{margin:16px 0;padding:8px 10px;border:1px solid gray;font-size:12px}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}
</style></head><body>
<h1>GSTR-9 working paper - ${esc(r.fyLabel)}</h1>
<p class="m">${esc(filerName)} ${r.gstin ? 'GSTIN ' + esc(r.gstin) : 'All GSTINs'} · ${esc(r.documents)} documents, ${esc(r.bills)} purchase bills · Turnover used ₹${esc(inr(r.turnover.used))} (${r.turnover.optional ? 'GSTR-9 optional: up to ₹2 crore' : 'GSTR-9 mandatory'})</p>
<div class="w"><strong>Verify with your CA before filing.</strong> ${esc(GSTR9_DISCLAIMER)}</div>
${table('Pt II - Table 4: Outward supplies on which tax is payable', r.table4)}
${table('Pt II - Table 5: Outward supplies on which tax is not payable', r.table5)}
${table('Pt III - Table 6: ITC availed', r.table6)}
${table('Pt III - Table 7: ITC reversed and ineligible', r.table7)}
${table('Pt III - Table 8: Other ITC information', r.table8)}
<h2>Pt IV - Table 9: Tax paid</h2>
<table><thead><tr><th>Description</th><th class="n">Payable</th><th class="n">Cash</th><th class="n">ITC IGST</th><th class="n">ITC CGST</th><th class="n">ITC SGST</th><th class="n">ITC Cess</th></tr></thead><tbody>
${r.table9.map((x) => `<tr><td>${esc(x.label)}${x.note ? `<div class="m">${esc(x.note)}</div>` : ''}</td><td class="n">${n(x.payable)}</td><td class="n">${n(x.cash)}</td><td class="n">${n(x.itc.igst)}</td><td class="n">${n(x.itc.cgst)}</td><td class="n">${n(x.itc.sgst)}</td><td class="n">${n(x.itc.cess)}</td></tr>`).join('\n')}
</tbody></table>
${table('Pt V - Tables 10-14 (not modelled)', r.partV)}
${hsn('Pt VI - Table 17: HSN summary of outward supplies', r.table17)}
${hsn('Pt VI - Table 18: HSN summary of inward supplies', r.table18)}
<h2>Differences - GSTR-1 vs GSTR-3B vs books</h2>
<table><thead><tr><th>Item</th><th>Head</th><th class="n">GSTR-1</th><th class="n">GSTR-3B</th><th class="n">Books</th><th class="n">1 - 3B</th><th class="n">3B - books</th></tr></thead><tbody>
${r.comparison.map((c) => `<tr><td>${esc(c.item)}</td><td>${esc(c.head)}</td><td class="n">${n(c.gstr1)}</td><td class="n">${n(c.gstr3b)}</td><td class="n">${n(c.books)}</td><td class="n">${n(c.diff13)}</td><td class="n">${n(c.diff3Books)}</td></tr>`).join('\n')}
</tbody></table>
<h2>Notes</h2>
<ul>${r.notes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
</body></html>`;
}
