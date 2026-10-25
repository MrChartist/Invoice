/**
 * GST return preparation — GSTR-1 sections and a GSTR-3B summary.
 *
 * Pure logic only (no React, no storage, no browser APIs) so it is unit-tested
 * in Node. Inputs are the persisted `invoices` rows and, defensively, whatever
 * is in the `purchases` table. Nothing here files a return: the output is a
 * working paper to be verified by a CA / checked against the GST portal.
 *
 * Key assumptions (also surfaced on the page):
 *  - Period filter uses the document's issue date.
 *  - Only INVOICE / TAX_INVOICE / CREDIT_NOTE that are not Draft/Cancelled are
 *    reported. Quotations, proformas and delivery challans are never tax docs.
 *  - Credit notes are stored as positive amounts and are netted (negative) in
 *    aggregated tables (B2CS, nil, HSN, 3B).
 *  - Per-line taxable value / tax is recomputed from the items with the
 *    invoice's own settings so rate-wise splits are exact.
 *  - Cess is carried through per rate row / HSN row / 3B; it is paid in cash (no ITC set-off).
 *  - Supply type drives placement: EXPORT_* -> exp (WPAY/WOPAY); SEZ_* -> b2b with inv_typ
 *    SEWP/SEWOP; both are zero-rated (3B 3.1(b)) and keep their nominal rate in the rate rows.
 *  - Taxable freight / other charges (`charges_taxable`) are one more line at the principal
 *    (highest) rate under the principal line's HSN, with no quantity.
 *  - Foreign-currency documents are reported in INR at their `exchange_rate` (src/lib/fx.ts);
 *    one without a rate is flagged (FX_RATE_MISSING) and reported at face value.
 *  - Bills of Supply (5.9) from a regular taxpayer carry no tax: their lines go to Table 8 in the column
 *    of `exempt_kind` (default exempt) and to GSTR-3B 3.1(c) (3.1(e) for non-GST); the BOS series is
 *    listed under "Invoices for outward supply" in Table 13. Documents whose sender snapshot is a
 *    composition profile are left out entirely: composition dealers file CMP-08 / GSTR-4 instead.
 *  - Amendments (5.9): a document with `amends.original` is reported AS FILED in its own period (the
 *    original never changes) and, in the period of `amends.amended_on`, in B2BA / B2CLA / CDNRA / CDNURA
 *    (or as revised B2CSA rows); GSTR-3B of that period takes the difference (revised − original).
 *    Export amendments go to EXPA (invoices) / CDNURA with EXPWP / EXPWOP (notes).
 *  - E-commerce (src/lib/eco.ts): a document with `eco_gstin` is a supply made through an e-commerce operator.
 *    Sec 52 (TCS): reported as usual with the operator GSTIN (`etin`; B2CS rows split by it) and per operator in
 *    Table 14(a). Sec 9(5) (the operator pays the tax): value only, in Table 14(b) and GSTR-3B 3.1.1(ii) — not in
 *    B2B / B2CL / B2CS / Table 8 / HSN / 3.1 (a CA-judgment item, see gst-reports.md).
 *  - Table 13: delivery challans are listed only when their Rule 55 purpose qualifies (`challan_purpose`).
 */

import type { InvoiceRecord, GstMode } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, isIgstZeroRated, isZeroRated, num, round2 } from './invoice-calc';
import { docCurrency, inrTotals, inrValue, missingFxRate } from './fx';
import { checkGstin } from './gstin';
import { stateByCode, stateByName } from './india-states';
import { isNonSupplyCategory, isVoidStatus, readPurchase, splitLumpTax } from './purchase-normalize';
import { b2clThreshold, b2clThresholdLabel, ecoReporting, gstSetOffOrder, hsnMinDigits, hsnTableSplit, type GstSetOffOrder } from './tax-rules';
import { checkEcoGstin, ecoOf } from './eco';
import type { EcoSection } from '../types/invoice';
import type { AdvanceMovement } from './advance-tax';
import type { PurchaseReturn } from '../types/purchases';
import { itcAdjustmentsFromNotes } from './purchase-returns-gst';
import { lineFactor, uqcFor, type UnitMaster } from './units';
import type { ItemIndex } from './inventory';

/* ───────────────────────── Period ───────────────────────── */

export type PeriodKind = 'month' | 'quarter' | 'fy';

export interface ReportPeriod {
  kind: PeriodKind;
  /** Calendar year in which the Indian FY starts (FY 25-26 -> 2025). */
  fyStart: number;
  /** Calendar month 1-12 (kind === 'month'). */
  month?: number;
  /** FY quarter 1-4, Q1 = Apr-Jun (kind === 'quarter'). */
  quarter?: 1 | 2 | 3 | 4;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar year of a calendar month inside the FY starting `fyStart`. */
function yearOfMonth(fyStart: number, month: number): number {
  return month >= 4 ? fyStart : fyStart + 1;
}

/** Inclusive ISO date range [from, to] of the period. */
export function periodRange(p: ReportPeriod): { from: string; to: string } {
  if (p.kind === 'month') {
    const m = p.month ?? 4;
    const y = yearOfMonth(p.fyStart, m);
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(daysIn(y, m))}` };
  }
  if (p.kind === 'quarter') {
    const q = p.quarter ?? 1;
    const startM = 4 + (q - 1) * 3;
    const sm = ((startM - 1) % 12) + 1;
    const em = ((startM + 2 - 1) % 12) + 1;
    const sy = yearOfMonth(p.fyStart, sm);
    const ey = yearOfMonth(p.fyStart, em);
    return { from: `${sy}-${pad(sm)}-01`, to: `${ey}-${pad(em)}-${pad(daysIn(ey, em))}` };
  }
  return { from: `${p.fyStart}-04-01`, to: `${p.fyStart + 1}-03-31` };
}

/** GSTN "return period": MMYYYY of the last month covered by the period. */
export function periodFp(p: ReportPeriod): string {
  const { to } = periodRange(p);
  return `${to.slice(5, 7)}${to.slice(0, 4)}`;
}

export function periodLabel(p: ReportPeriod): string {
  const fy = `FY ${String(p.fyStart).slice(2)}-${String(p.fyStart + 1).slice(2)}`;
  if (p.kind === 'fy') return fy;
  if (p.kind === 'quarter') {
    const q = p.quarter ?? 1;
    const names = ['Apr-Jun', 'Jul-Sep', 'Oct-Dec', 'Jan-Mar'];
    return `Q${q} ${fy} (${names[q - 1]})`;
  }
  const m = p.month ?? 4;
  return `${MONTH_NAMES[m - 1]} ${yearOfMonth(p.fyStart, m)}`;
}

/** The period of the given kind that contains `date` (ISO string or Date). */
export function periodForDate(kind: PeriodKind, date: string | Date): ReportPeriod {
  const iso =
    typeof date === 'string'
      ? date.slice(0, 10)
      : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const y = parseInt(iso.slice(0, 4), 10);
  const m = parseInt(iso.slice(5, 7), 10);
  const fyStart = m >= 4 ? y : y - 1;
  if (kind === 'month') return { kind, fyStart, month: m };
  if (kind === 'quarter') {
    const idx = (m - 4 + 12) % 12;
    return { kind, fyStart, quarter: (Math.floor(idx / 3) + 1) as 1 | 2 | 3 | 4 };
  }
  return { kind, fyStart };
}

export function inPeriod(date: string | undefined, p: ReportPeriod): boolean {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  const { from, to } = periodRange(p);
  return d >= from && d <= to;
}

/** 2025-04-09 -> 09-04-2025 (GSTN date format). */
export function toGstnDate(iso: string): string {
  const d = String(iso).slice(0, 10);
  return `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
}

/* ───────────────────────── Types ───────────────────────── */

/** @deprecated B2CL threshold is date-dependent — use `b2clThreshold(date)` from `tax-rules`. Kept for the pre-Aug-2024 value. */
export const B2CL_THRESHOLD = 250000;

export type Severity = 'error' | 'warning' | 'info';

export interface ReconIssue {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  invoiceId?: string;
  invoiceNumber?: string;
  /** In-app route that lets the user fix it. */
  link?: string;
  linkLabel?: string;
}

export interface RateRow {
  rate: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface DocRow {
  invoiceId: string;
  number: string;
  date: string; // ISO
  /** Document value (grand total). */
  value: number;
  pos: string;
  rchrg: 'Y' | 'N';
  partyName: string;
  ctin: string;
  items: RateRow[];
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** Additive: cess across the document. */
  cess?: number;
  /** Additive: GSTN invoice type (R regular, SEWP/SEWOP SEZ, DE deemed export). */
  invTyp?: 'R' | 'SEWP' | 'SEWOP' | 'DE';
  /** Additive: GSTIN of the e-commerce operator (Sec 52) the supply was made through. */
  etin?: string;
}

export interface B2csRow {
  supply: 'INTRA' | 'INTER';
  pos: string;
  rate: number;
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** Additive: e-commerce operator GSTIN (B2CS type "E"); absent = type "OE". */
  etin?: string;
}

/** GSTR-1 Table 14: supplies made through one e-commerce operator (net of credit / debit notes). */
export interface EcoRow {
  etin: string;
  /** Net taxable value of supplies. */
  value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** Documents behind the row. */
  count: number;
}

export interface EcoTables {
  /** 14(a): operator collects TCS u/s 52 (supplier pays the tax shown). */
  tcs: EcoRow[];
  /** 14(b): operator pays the tax u/s 9(5) — value only (tax columns zero). */
  pay95: EcoRow[];
}

export interface ExportRow extends DocRow {
  expType: 'WPAY' | 'WOPAY';
  /** Additive: shipping bill port code, number and date (ISO), from the invoice. */
  sbpcode?: string;
  sbnum?: string;
  sbdt?: string;
}

export interface CdnRow extends DocRow {
  /** C = credit note (reduces liability), D = debit note (adds to it). */
  noteType: 'C' | 'D';
  /** CDNUR only. */
  unregType?: 'B2CL' | 'EXPWP' | 'EXPWOP';
}

export type NilSupplyType = 'INTRB2B' | 'INTRAB2B' | 'INTRB2C' | 'INTRAB2C';

export interface NilRow {
  type: NilSupplyType;
  nil: number;
  exempt: number;
  nonGst: number;
}

export interface HsnRow {
  hsn: string;
  description: string;
  uqc: string;
  qty: number;
  value: number;
  taxable: number;
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface DocIssueRow {
  docType: string;
  series: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
  netIssued: number;
}

/** GSTR-1 Table 11A (advances received, `at`) / 11B (advances adjusted, `txpd`): one row per POS × rate. */
export interface AdvanceTableRow {
  pos: string;
  supply: 'INTRA' | 'INTER';
  rate: number;
  /** Rupees received / adjusted, tax inclusive. */
  gross: number;
  /** Gross less tax — the JSON `ad_amt`. */
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** Vouchers / adjustments behind the row. */
  count: number;
}

export interface Gstr1Report {
  period: ReportPeriod;
  gstin: string;
  fp: string;
  b2b: DocRow[];
  b2cl: DocRow[];
  b2cs: B2csRow[];
  cdnr: CdnRow[];
  cdnur: CdnRow[];
  exp: ExportRow[];
  nil: NilRow[];
  /** Table 12, all supplies (the pre-2025 single table). */
  hsn: HsnRow[];
  /** Table 12 split (HSN Phase-III): supplies to registered recipients (B2B, CDNR)... */
  hsnB2b: HsnRow[];
  /** ...and to unregistered recipients (B2CL, B2CS, exports, CDNUR). Notes are netted with their sign. */
  hsnB2c: HsnRow[];
  /** True when the period is reported with the split tables (`hsnTableSplit` in tax-rules). */
  hsnSplit: boolean;
  /** Minimum HSN/SAC digits applied in the reconciliation (from the preceding-FY turnover). */
  hsnMinDigits: number;
  docIssue: DocIssueRow[];
  /** Additive (5.9): amendments of documents reported in an earlier, filed period (made in this period). */
  amendments?: Gstr1Amendments;
  /** Table 11A(1)/(2): advances received in the period on which tax is due (5.3). Absent when none. */
  at?: AdvanceTableRow[];
  /** Table 11B(1)/(2): advances adjusted (and refunded) in the period. Absent when none. */
  txpd?: AdvanceTableRow[];
  /** Additive: Table 14 — supplies made through e-commerce operators. Absent when none. */
  eco?: EcoTables;
  /** Totals across every outward document table (net of credit notes; advances not included). */
  totals: { taxable: number; igst: number; cgst: number; sgst: number; value: number; cess?: number };
  counts: { included: number; drafts: number; cancelled: number; notTaxDocs: number; composition?: number };
}

/** An amended document row: the revised values plus the number / date it was originally reported with. */
export interface AmendDocRow extends DocRow {
  origNumber: string;
  /** ISO date of the original. */
  origDate: string;
  /** Return period (MMYYYY) the original was reported in. */
  origPeriod: string;
  reason?: string;
}

export interface AmendCdnRow extends AmendDocRow {
  noteType: 'C' | 'D';
  unregType?: 'B2CL' | 'EXPWP' | 'EXPWOP';
}

/** Revised B2CS row for an earlier month (`omon` = MMYYYY of that month): REPLACES what was filed for it. */
export interface B2csaRow extends B2csRow {
  omon: string;
}

/** Amended export invoice (EXPA). */
export interface AmendExpRow extends AmendDocRow {
  expType: 'WPAY' | 'WOPAY';
  sbpcode?: string;
  sbnum?: string;
  sbdt?: string;
}

export interface Gstr1Amendments {
  /** Additive: amended export invoices (Table 9A, EXPA). Absent when none. */
  expa?: AmendExpRow[];
  b2ba: AmendDocRow[];
  b2cla: AmendDocRow[];
  cdnra: AmendCdnRow[];
  cdnura: AmendCdnRow[];
  b2csa: B2csaRow[];
  /**
   * Additive: revised − original of each amendment made in the period (sign-aware), the same deltas
   * GSTR-3B takes. `taxPayable` = supplies on which the supplier pays tax (GSTR-9 4K / 4L);
   * `noTax` = taxable value of zero-rated-without-payment, reverse-charge and nil / exempt lines (5J / 5K).
   */
  effects?: AmendEffect[];
}

export interface AmendEffect {
  number: string;
  taxPayable: Gstr3bTaxRow;
  noTax: { taxable: number };
}

export interface ItcHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Gstr3bTaxRow {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface SetOffResult {
  liability: { igst: number; cgst: number; sgst: number };
  rcLiability: { igst: number; cgst: number; sgst: number };
  /** ITC consumed: [credit head][liability head]. */
  itcUsed: {
    igst: { igst: number; cgst: number; sgst: number };
    cgst: { cgst: number; igst: number };
    sgst: { sgst: number; igst: number };
  };
  /** Tax payable in cash (liability after ITC + whole reverse-charge liability). */
  cash: { igst: number; cgst: number; sgst: number };
  /** ITC left after set-off (carried forward). */
  itcCarry: { igst: number; cgst: number; sgst: number };
  /** Additive: cess payable in cash — cess liability less cess credit (WP-6: cess on purchase bills). */
  cess?: number;
  /** Additive (WP-6): cess liability before credit, cess credit used (cess pays cess only) and cess credit carried. */
  cessLiability?: number;
  cessItcUsed?: number;
  cessItcCarry?: number;
}

export interface Gstr3bReport {
  /** 3.1 */
  outward: {
    taxable: Gstr3bTaxRow; // (a)
    zeroRated: Gstr3bTaxRow; // (b)
    nilExempt: { inter: number; intra: number }; // (c) value only
    inwardRcm: Gstr3bTaxRow; // (d)
    nonGst: number; // (e)
  };
  /** 3.2 inter-state supplies to unregistered persons, by place of supply. */
  interStateUnreg: { pos: string; taxable: number; igst: number }[];
  /** 4 */
  itc: {
    importGoods: ItcHeads; // 4A(1)
    importServices: ItcHeads; // 4A(2)
    availableRcm: ItcHeads; // 4A(3)
    availableOther: ItcHeads; // 4A(5)
    /** Rules 38, 42 & 43 and Sec 17(5) — permanent reversals. */
    reversedRules: ItcHeads; // 4B(1)
    reversedOther: ItcHeads; // 4B(2)
    net: ItcHeads; // 4C
    ineligible: ItcHeads; // 4D(2)
    /**
     * Additive (7O, 7.91): 4C before the floor at zero — present only when a head is negative (reversals in
     * 4B(2) / supplier notes exceed the period's ITC). `net` stays floored so the set-off never uses a
     * negative credit; the 3B tab shows this figure and flags it for the CA.
     */
    netSigned?: ItcHeads;
    /** Additive (7R, 7.122): 4A(4) — eligible credit distributed to us by an Input Service Distributor. Absent when none. */
    isd?: ItcHeads;
  };
  /** 5 — inward supplies from composition / exempt / nil suppliers (value). */
  inwardExempt: { inter: number; intra: number };
  /** 6.1 */
  payment: SetOffResult;
  /** Net negative liability (credit notes exceeding sales) that cannot be adjusted this period. */
  unadjustedCredit: { igst: number; cgst: number; sgst: number };
  purchasesConsidered: number;
  /** Outward reverse-charge invoices (tax payable by the recipient, so not in 3.1). */
  outwardRcmTaxable: number;
  /** Advances (5.3): tax on advances received (+) and adjusted / refunded (−), already inside 3.1(a). Absent when none. */
  advances?: { received: Gstr3bTaxRow; adjusted: Gstr3bTaxRow };
  /**
   * Additive: Table 3.1.1 (ii) — taxable value of supplies made through an e-commerce operator that pays the tax
   * u/s 9(5) (net of notes). Not in any 3.1 row. Absent when none. 3.1.1 (i) is the operator's own row (always 0 here).
   */
  ecoSupplies95?: number;
}

export interface GstReport {
  gstr1: Gstr1Report;
  gstr3b: Gstr3bReport;
  issues: ReconIssue[];
}

export interface BuildOptions {
  period: ReportPeriod;
  /** Filer GSTIN. If set, invoices whose sender snapshot has a different GSTIN are skipped. */
  gstin?: string;
  /** Fallback state code of the filer when an invoice has no sender snapshot. */
  filerStateCode?: string;
  /** `doc_links` rows: a note linked to its original invoice is classified by that invoice. */
  links?: readonly { from_id: string; to_id: string; relation: string }[];
  /** Preceding-FY aggregate turnover (₹, the JSON `gt`): picks the 4- or 6-digit HSN rule. 0 / absent = up to ₹5 crore. */
  turnover?: number;
  /** Advance movements (`advanceTaxEvents` in advance-tax.ts) for GSTR-1 Table 11 and 3B 3.1(a). */
  advances?: readonly AdvanceMovement[];
  /** Additive (WP-3): `purchase_returns` rows — supplier notes dated in the period reduce ITC (`itcAdjustmentsFromNotes`). */
  purchaseNotes?: readonly PurchaseReturn[];
  /**
   * Additive (WP-8): the units master (`unitsDb.stored()`): a unit with a UQC of its own reports as that
   * UQC in the HSN summary (built-in mapping otherwise).
   */
  units?: readonly UnitMaster[];
  /**
   * Additive (WP-8): stock items by name (`buildItemIndex`). An invoice line typed in an alternate unit
   * (2 BOX, `unit_factor` 12) is summarised in the item's base unit — 24 at the UQC of NOS — so one HSN
   * row carries one UQC per item, as the stock records do. Without it (or when the line names no item)
   * the line reports as typed (2 at the UQC of BOX). Working paper: verify with your CA.
   */
  items?: ItemIndex;
  /**
   * Additive (7R, 7.122): ISD credit received by our unit(s) (`isdInwardRows` in isd.ts). Rows dated in the period
   * (and of the filer GSTIN, when both are set) go to 4A(4) — ineligible ones to 4D(2) — and into 4C.
   */
  isdInward?: readonly { date: string; gstin?: string; igst: number; cgst: number; sgst: number; cess: number; eligible: boolean }[];
}

/**
 * Table 11A / 11B rows for the period: taxed advance movements dated in it (filer GSTIN filter as
 * for invoices), grouped by place of supply × rate. Refunds of an advance (Rule 51) are reported
 * in 11B with adjustments — an assumption to confirm with your CA.
 */
export function advanceTables(opts: BuildOptions): { at: AdvanceTableRow[]; txpd: AdvanceTableRow[] } {
  const want = (opts.gstin ?? '').trim().toUpperCase();
  const at = new Map<string, AdvanceTableRow>();
  const txpd = new Map<string, AdvanceTableRow>();
  for (const m of opts.advances ?? []) {
    if (!m.taxed || !inPeriod(m.date, opts.period)) continue;
    if (want && m.senderGstin && m.senderGstin !== want) continue;
    const target = m.kind === 'received' ? at : txpd;
    const key = `${m.pos}|${m.rate}|${m.supply}`;
    const r = target.get(key) ?? { pos: m.pos, supply: m.supply, rate: m.rate, gross: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, count: 0 };
    r.gross = round2(r.gross + m.gross);
    r.taxable = round2(r.taxable + m.taxable);
    r.igst = round2(r.igst + m.igst);
    r.cgst = round2(r.cgst + m.cgst);
    r.sgst = round2(r.sgst + m.sgst);
    r.count++;
    target.set(key, r);
  }
  const sort = (rows: Iterable<AdvanceTableRow>) => [...rows].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  return { at: sort(at.values()), txpd: sort(txpd.values()) };
}

/* ───────────────────────── Prepared documents ───────────────────────── */

interface PLine {
  rate: number;
  hsn: string;
  uqc: string;
  desc: string;
  qty: number;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  lineTotal: number;
}

export interface PDoc {
  rec: InvoiceRecord;
  sign: 1 | -1;
  isNote: boolean;
  noteType: 'C' | 'D';
  number: string;
  date: string;
  pos: string;
  supply: 'INTRA' | 'INTER';
  registered: boolean;
  ctin: string;
  isExport: boolean;
  /** Zero-rated supply: export or SEZ (GSTR-3B 3.1(b)). */
  zeroRated: boolean;
  invTyp: 'R' | 'SEWP' | 'SEWOP' | 'DE';
  rcm: boolean;
  senderGstin: string;
  value: number;
  lines: PLine[];
  /** Additive: Table 8 column for an untaxed Bill of Supply (absent for other documents: nil-rated). */
  exemptKind?: 'NIL' | 'EXEMPT' | 'NON_GST';
  /** Additive: e-commerce operator GSTIN and section (src/lib/eco.ts). */
  etin?: string;
  ecoSection?: EcoSection;
}

/** Supply through an e-commerce operator that pays the tax u/s 9(5): value only (Table 14(b), 3B 3.1.1(ii)). */
export const isEco95 = (d: Pick<PDoc, 'ecoSection' | 'isExport'>) => d.ecoSection === 'PAY_9_5' && !d.isExport;

/** Documents GSTR-1 reports. A Bill of Supply (5.9) is a tax document with no tax: Table 8 + Table 13. */
const TAX_DOC_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

/** The sender snapshot is a composition profile: no GSTR-1 / 3B (CMP-08 / GSTR-4 instead). */
export function isCompositionDoc(rec: Pick<InvoiceRecord, 'sender'>): boolean {
  return rec?.sender?.gst_scheme === 'composition';
}

/**
 * The document as it was reported in its own period: the frozen `amends.original` when the document was
 * amended later (keeping its id so links still resolve), else the record itself.
 */
export function asFiled(rec: InvoiceRecord): InvoiceRecord {
  const o = rec?.amends?.original;
  return o ? ({ ...(o as InvoiceRecord), id: rec.id, amends: undefined } as InvoiceRecord) : rec;
}

const UQC: Record<string, string> = {
  NOS: 'NOS', PCS: 'PCS', KG: 'KGS', KGS: 'KGS', LTR: 'LTR', MTR: 'MTR', SQF: 'SQF', SET: 'SET', BOX: 'BOX',
  HRS: 'OTH', DAY: 'OTH', MONTH: 'OTH', LOT: 'OTH',
};

export function toUqc(unit: string | undefined, hsn: string): string {
  if (hsn.startsWith('99')) return 'NA'; // SAC — services carry no quantity
  const u = (unit ?? '').trim().toUpperCase();
  return UQC[u] ?? (u ? 'OTH' : 'NOS');
}

/**
 * UQC and quantity of an outward line for the HSN summary (WP-8): an alternate-unit line converts to
 * the item's base unit when `items` resolves it; the units master's UQC wins over the built-in map;
 * SAC lines stay NA.
 */
export function hsnLineQty(
  l: { name: string; hsn: string; unit: string; quantity: number; unit_factor?: number },
  opts: Pick<BuildOptions, 'units' | 'items'>,
): { uqc: string; qty: number } {
  const f = lineFactor(l);
  const base = f !== 1 ? opts.items?.find(l.name, l.hsn)?.unit?.trim() : undefined;
  const unit = base || l.unit;
  const qty = base ? Math.round(l.quantity * f * 1000) / 1000 : l.quantity;
  if (l.hsn.startsWith('99')) return { uqc: 'NA', qty };
  return { uqc: uqcFor(unit, opts.units ?? [], (u) => toUqc(u, l.hsn)), qty };
}

function filerState(gstin: string, fallback?: string): string {
  return checkGstin(gstin).stateCode ?? stateByCode(fallback)?.code ?? '';
}

/** The app's own "Other Country (Export)" code is 99; GSTN calls it 96. Both mean an export. */
const FOREIGN_POS = new Set(['96', '99']);

function recipientState(rec: InvoiceRecord): { pos: string; missing: boolean } {
  if (FOREIGN_POS.has((rec.place_of_supply ?? '').trim())) return { pos: '96', missing: false }; // Other Countries
  const direct = stateByCode(rec.place_of_supply)?.code;
  if (direct) return { pos: direct, missing: false };
  const c = rec.client ?? ({} as InvoiceRecord['client']);
  const viaClient =
    stateByCode(c.state_code)?.code ?? checkGstin(c.gstin).stateCode ?? stateByName(c.state)?.code ?? '';
  return { pos: viaClient, missing: true };
}

function effectiveMode(mode: GstMode | undefined, from: string, pos: string): GstMode {
  if (mode === 'CGST_SGST' || mode === 'IGST' || mode === 'NONE') return mode;
  // SINGLE / undefined (legacy): decide the split from the states, else IGST.
  if (from && pos) return from === pos ? 'CGST_SGST' : 'IGST';
  return mode === 'SINGLE' ? 'IGST' : 'NONE';
}

function prepare(rec: InvoiceRecord, opts: BuildOptions, issues: ReconIssue[]): PDoc {
  const isNote = rec.doc_type === 'CREDIT_NOTE' || rec.doc_type === 'DEBIT_NOTE';
  const noteType: 'C' | 'D' = rec.doc_type === 'DEBIT_NOTE' ? 'D' : 'C';
  const sender = rec.sender;
  const senderGstin = (sender?.companyGstin ?? opts.gstin ?? '').trim().toUpperCase();
  const from = filerState(senderGstin, sender?.stateCode ?? opts.filerStateCode);
  const { pos: posRaw, missing } = recipientState(rec);
  const label = rec.invoice_number || rec.id;

  const push = (severity: Severity, code: string, message: string, link?: string, linkLabel?: string) =>
    issues.push({
      id: `${code}:${rec.id}`,
      severity,
      code,
      message: `${label}: ${message}`,
      invoiceId: rec.id,
      invoiceNumber: rec.invoice_number,
      link: link ?? `/invoice/${rec.id}`,
      linkLabel: linkLabel ?? 'Open invoice',
    });

  const st = rec.supply_type;
  const isSez = st === 'SEZ_WITH_PAYMENT' || st === 'SEZ_WITHOUT_PAYMENT';
  const isExport =
    posRaw === '96' ||
    st === 'EXPORT_LUT' ||
    st === 'EXPORT_WITH_PAYMENT' ||
    (!!rec.currency && rec.currency !== 'INR' && !posRaw);
  const zeroRated = isExport || isSez || isZeroRated(st) || isIgstZeroRated(st);
  const invTyp: PDoc['invTyp'] =
    st === 'SEZ_WITH_PAYMENT' ? 'SEWP' : st === 'SEZ_WITHOUT_PAYMENT' ? 'SEWOP' : st === 'DEEMED_EXPORT' ? 'DE' : 'R';
  const pos = posRaw || from;
  if (missing && !isExport) {
    push(
      'error',
      'POS_MISSING',
      posRaw
        ? `place of supply not set; assumed ${posRaw} from the client record.`
        : 'place of supply is missing and could not be inferred; assumed the filer state.',
    );
  }
  if (missingFxRate(rec)) {
    push('error', 'FX_RATE_MISSING', `amounts are in ${docCurrency(rec)} but the invoice has no exchange rate; GST returns need INR values. Reported at face value — add the CBIC / shipping-bill rate on the invoice.`);
  }
  if (isExport && !isNote && (st === 'EXPORT_LUT' || st === 'EXPORT_WITH_PAYMENT') && !(rec.shipping_bill_no && rec.shipping_bill_date && rec.port_code)) {
    push('info', 'EXP_SHIPPING_BILL', 'export of goods without shipping-bill details (port code, number, date); add them on the invoice or amend the EXP entry once the shipping bill is filed.');
  }

  const mode = effectiveMode(rec.gst_mode, from, pos);
  // Full record in: supply type, tax-inclusive pricing, cess, TCS and round mode all change the split.
  const docCalc = calculateInvoice(calcInputFromRecord(rec, { gst_mode: mode, amount_paid: 0 }));
  // Every figure below is in rupees (foreign documents at their exchange rate).
  const calc = inrTotals(docCalc, rec);

  const supply: 'INTRA' | 'INTER' =
    mode === 'CGST_SGST' ? 'INTRA' : mode === 'IGST' ? 'INTER' : from && pos && from !== pos ? 'INTER' : 'INTRA';
  if (mode === 'CGST_SGST' && from && pos && from !== pos && !isExport) {
    push('warning', 'MODE_MISMATCH', `charged CGST+SGST but place of supply (${pos}) differs from your state (${from}); IGST may apply.`);
  }
  if (mode === 'IGST' && from && pos && from === pos) {
    push('warning', 'MODE_MISMATCH', `charged IGST but place of supply equals your state (${from}); CGST+SGST may apply.`);
  }

  const gstinRaw = (rec.client?.gstin ?? '').trim().toUpperCase();
  const chk = checkGstin(gstinRaw);
  if (gstinRaw && !chk.valid) {
    push('error', 'GSTIN_INVALID', `client GSTIN "${gstinRaw}" is invalid (${chk.message}); treated as unregistered.`, '/clients', 'Fix client');
  }
  const registered = chk.valid;
  if (registered && chk.stateCode && pos && chk.stateCode !== pos && !isExport) {
    push('info', 'POS_VS_GSTIN', `place of supply ${pos} differs from client GSTIN state ${chk.stateCode}; correct only for ship-to / bill-to cases.`);
  }

  const recorded = num(rec.total, NaN);
  // GSTR-1 invoice value of an outward reverse-charge document includes the tax shown on it (as on
  // documents saved before `rcm_tax_excluded`), even though the supplier's total leaves it out.
  const rcmBack = docCalc.rcm_tax;
  const value = Number.isFinite(recorded) && recorded > 0 ? inrValue(round2(recorded + rcmBack), rec) : round2(calc.total + calc.rcm_tax);
  if (Number.isFinite(recorded) && Math.abs(recorded - docCalc.total) > 1.01) {
    push('warning', 'TOTAL_MISMATCH', `stored total ${recorded} differs from recomputed ${docCalc.total}; the report uses the recomputed tax split.`);
  }

  const toPLine = (l: (typeof calc.lines)[number]): PLine => {
    const hq = hsnLineQty(l, opts);
    return {
      // Zero-rated supplies keep the slab they were priced at (GSTR-1 reports txval against it).
      rate: mode === 'NONE' ? 0 : zeroRated ? l.nominal_rate : l.tax_rate,
      hsn: l.hsn,
      uqc: hq.uqc,
      desc: l.name,
      qty: hq.qty,
      taxable: l.taxable,
      igst: l.igst,
      cgst: l.cgst,
      sgst: l.sgst,
      cess: l.cess,
      lineTotal: l.total,
    };
  };
  const lines: PLine[] = calc.lines.map(toPLine);
  // Taxable freight / other charges: part of the principal supply's value, so no quantity of its own.
  if (calc.charges_line) lines.push({ ...toPLine(calc.charges_line), qty: 0 });

  if (lines.some((l) => l.taxable > 0 && !l.hsn)) {
    push('warning', 'HSN_MISSING', 'one or more line items have no HSN/SAC code (mandatory in the HSN summary).');
  }
  const minDigits = hsnMinDigits(opts.turnover ?? 0, String(rec.issue_date).slice(0, 10));
  const short = [...new Set(lines.filter((l) => senderGstin && l.hsn && l.hsn.replace(/\D/g, '').length < minDigits).map((l) => l.hsn))];
  if (short.length) {
    push('warning', 'HSN_DIGITS', `HSN/SAC ${short.join(', ')} has fewer than the ${minDigits} digits required for your last-FY turnover (4 up to ₹5 crore, 6 above).`);
  }
  if (!senderGstin && lines.some((l) => l.igst + l.cgst + l.sgst > 0)) {
    push('warning', 'NO_FILER_GSTIN', 'tax is charged but the sender profile has no GSTIN.', '/settings', 'Open settings');
  }
  if (!rec.invoice_number) push('warning', 'NO_NUMBER', 'document has no number.');
  const eco = ecoOf(rec);
  if (eco) {
    const chk = checkEcoGstin(eco.gstin);
    if (!chk.valid) push('error', 'ECO_GSTIN_INVALID', `${chk.message}; Table 14 and the e-commerce GSTIN column will be rejected.`);
    else if (eco.section === 'TCS_52' && !chk.tcsRegistration) push('info', 'ECO_NOT_TCS', `e-commerce operator GSTIN ${eco.gstin} is not a TCS registration ("C" in place 14). Check it against the operator's GSTR-8 / statement.`);
    if (eco.section === 'PAY_9_5') {
      if (isExport) push('warning', 'ECO_95_EXPORT', 'marked "operator pays tax u/s 9(5)" but it is an export; reported as an export (Sec 9(5) covers notified domestic services).');
      else if (calc.lines.some((l) => l.igst + l.cgst + l.sgst + l.cess > 0)) {
        push('warning', 'ECO_95_TAXED', 'the e-commerce operator pays the tax u/s 9(5), but tax was charged on this document. Only the value is reported (Table 14(b), 3B 3.1.1(ii)); tax you collected must still be deposited — check with your CA.');
      }
    }
    const rules = ecoReporting(String(rec.issue_date).slice(0, 10));
    if (!rules.gstr1Table14) push('info', 'ECO_BEFORE_TABLE14', 'supplies through e-commerce operators were reported only with the ECO GSTIN column (B2B / B2CL / B2CS) before GSTR-1 Table 14 — Table 14 here is for reference.');
  }
  const bos = rec.doc_type === 'BILL_OF_SUPPLY';
  if (bos && calc.lines.some((l) => l.nominal_rate > 0 && l.taxable !== 0)) {
    push('warning', 'BOS_TAXED_LINES', 'Bill of Supply has lines with a GST rate; no tax was charged, so they are reported as exempt in Table 8. Use a tax invoice for taxable supplies (Rule 46).');
  }

  return {
    rec,
    // A credit note reduces liability; a debit note adds to it like an invoice.
    sign: noteType === 'C' && isNote ? -1 : 1,
    isNote,
    noteType,
    number: rec.invoice_number,
    date: String(rec.issue_date).slice(0, 10),
    pos,
    supply,
    registered,
    ctin: registered ? gstinRaw : '',
    isExport,
    zeroRated,
    invTyp,
    rcm: !!rec.reverse_charge,
    senderGstin,
    value,
    lines,
    ...(bos ? { exemptKind: rec.exempt_kind ?? 'EXEMPT' } : {}),
    ...(eco ? { etin: eco.gstin, ecoSection: eco.section } : {}),
  };
}

const taxOf = (l: PLine) => l.igst + l.cgst + l.sgst;
/** A nil / exempt / non-GST line: no rate, no tax and no cess. */
const isNilLine = (l: PLine) => l.rate <= 0 && taxOf(l) === 0 && l.cess === 0;

/**
 * Rate-wise rows of a document. Nil lines go to Table 8 — except on a zero-rated document (export /
 * SEZ): a line priced at a nominal 0% is still a zero-rated supply, reported in EXP / SEZ (B2B) at
 * rate 0, exactly as GSTR-3B 3.1(b) and GSTR-9 5A count it.
 */
function rateRows(lines: PLine[], zeroRated = false): RateRow[] {
  const map = new Map<number, RateRow>();
  for (const l of lines) {
    if (isNilLine(l) && !(zeroRated && l.taxable !== 0)) continue; // nil lines go to table 8
    const r = map.get(l.rate) ?? { rate: l.rate, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    r.txval = round2(r.txval + l.taxable);
    r.igst = round2(r.igst + l.igst);
    r.cgst = round2(r.cgst + l.cgst);
    r.sgst = round2(r.sgst + l.sgst);
    r.cess = round2(r.cess + l.cess);
    map.set(l.rate, r);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

/** GSTR-1 EXP shipping-bill fields from the invoice (only those that are set). */
function shippingBillOf(rec: InvoiceRecord): Pick<ExportRow, 'sbpcode' | 'sbnum' | 'sbdt'> {
  const out: Pick<ExportRow, 'sbpcode' | 'sbnum' | 'sbdt'> = {};
  const port = String(rec.port_code ?? '').trim().toUpperCase();
  const no = String(rec.shipping_bill_no ?? '').trim();
  const dt = String(rec.shipping_bill_date ?? '').slice(0, 10);
  if (port) out.sbpcode = port;
  if (no) out.sbnum = no;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) out.sbdt = dt;
  return out;
}

function docRow(d: PDoc, items: RateRow[]): DocRow {
  const sum = (k: 'txval' | 'igst' | 'cgst' | 'sgst' | 'cess') => round2(items.reduce((s, r) => s + r[k], 0));
  return {
    invoiceId: d.rec.id,
    number: d.number,
    date: d.date,
    value: d.value,
    pos: d.pos,
    rchrg: d.rcm ? 'Y' : 'N',
    partyName: d.rec.client?.company || d.rec.client?.name || '',
    ctin: d.ctin,
    items,
    taxable: sum('txval'),
    igst: sum('igst'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    cess: sum('cess'),
    invTyp: d.invTyp,
    ...(d.etin && d.ecoSection === 'TCS_52' ? { etin: d.etin } : {}),
  };
}

/* ───────────────────────── GSTR-1 ───────────────────────── */

function parseSeries(s: string): { prefix: string; n: number; width: number } | null {
  const m = /^(.*?)(\d+)$/.exec((s ?? '').trim());
  if (!m) return null;
  return { prefix: m[1], n: parseInt(m[2], 10), width: m[2].length };
}

/** Table 13 document types the app issues besides invoices / notes (Rule 50 receipt, Rule 51 refund vouchers). */
export const RECEIPT_VOUCHER_DOC = 'Receipt Voucher';
export const REFUND_VOUCHER_DOC = 'Refund Voucher';

/**
 * Table 13 rows for delivery challans by Rule 55 purpose (`challan_purpose`): doc 9 job work, 10 supply on
 * approval, 11 liquid gas, 12 other than by way of supply. A challan sent ahead of the invoice of the same supply
 * (`ANTICIPATION`) or with no purpose is NOT listed (the invoice is what is reported). Names follow the offline
 * tool's document types as best known — verify with your CA.
 */
export const CHALLAN_DOC_TYPES: Readonly<Record<'JOB_WORK' | 'APPROVAL' | 'LIQUID_GAS' | 'OTHER_THAN_SUPPLY', { num: number; name: string }>> = {
  JOB_WORK: { num: 9, name: 'Delivery Challan for job work' },
  APPROVAL: { num: 10, name: 'Delivery Challan for supply on approval' },
  LIQUID_GAS: { num: 11, name: 'Delivery Challan in case of liquid gas' },
  OTHER_THAN_SUPPLY: { num: 12, name: 'Delivery Challan in cases other than by way of supply (excluding at S no. 9 to 11)' },
};

/** Table 13 document type of a challan, or null when it is not listed. */
export function challanDocType(rec: Pick<InvoiceRecord, 'doc_type' | 'challan_purpose'>): string | null {
  if (rec.doc_type !== 'DELIVERY_CHALLAN' || !rec.challan_purpose || rec.challan_purpose === 'ANTICIPATION') return null;
  return CHALLAN_DOC_TYPES[rec.challan_purpose]?.name ?? null;
}

/**
 * GSTR-1 Table 13. Invoices / Bills of Supply, debit notes and credit notes come from the documents;
 * receipt vouchers (advances, ADV/…) and refund vouchers (RFV/…) from the period's advance movements
 * — every voucher issued counts, taxed or not. Delivery challans (doc 9–12) are listed only when the
 * challan carries a qualifying Rule 55 purpose (`challanDocType`). One DCH series shared by several
 * purposes is split by purpose: a number used by a challan of another purpose (or one not listed) is not
 * a gap. Verify with your CA.
 */
function buildDocIssue(all: InvoiceRecord[], vouchers: readonly AdvanceMovement[] = []): DocIssueRow[] {
  interface Bucket { docType: string; prefix: string; width: number; nums: Set<number>; cancelled: Set<number>; challan?: boolean }
  const buckets = new Map<string, Bucket>();
  // Every non-draft challan number by series prefix: shared-series numbers of other purposes are not gaps.
  const challanNums = new Map<string, Set<number>>();
  for (const rec of all) {
    if (rec.doc_type !== 'DELIVERY_CHALLAN' || rec.status === 'Draft') continue;
    const s = parseSeries(rec.invoice_number);
    if (!s) continue;
    const set = challanNums.get(s.prefix) ?? new Set<number>();
    set.add(s.n);
    challanNums.set(s.prefix, set);
  }
  const addNumber = (docType: string, number: string, cancelled = false) => {
    const s = parseSeries(number);
    if (!s) return;
    const key = `${docType}|${s.prefix}`;
    const b = buckets.get(key) ?? { docType, prefix: s.prefix, width: s.width, nums: new Set<number>(), cancelled: new Set<number>() };
    b.nums.add(s.n);
    b.width = Math.max(b.width, s.width);
    if (cancelled) b.cancelled.add(s.n);
    buckets.set(key, b);
  };
  for (const m of vouchers) {
    if (m.kind === 'received') addNumber(RECEIPT_VOUCHER_DOC, m.number);
    else if (m.kind === 'refunded' && m.ref) addNumber(REFUND_VOUCHER_DOC, m.ref);
  }
  for (const rec of all) {
    const challanType = challanDocType(rec);
    if (challanType) {
      if (rec.status === 'Draft') continue;
      const s = parseSeries(rec.invoice_number);
      if (!s) continue;
      const key = `${challanType}|${s.prefix}`;
      const b = buckets.get(key) ?? { docType: challanType, prefix: s.prefix, width: s.width, nums: new Set<number>(), cancelled: new Set<number>(), challan: true };
      b.nums.add(s.n);
      b.width = Math.max(b.width, s.width);
      if (rec.status === 'Cancelled') b.cancelled.add(s.n);
      buckets.set(key, b);
      continue;
    }
    if (!TAX_DOC_TYPES.has(rec.doc_type)) continue;
    // A draft was never issued. Left out of the range, it is counted as a gap (cancelled) when it sits
    // between issued numbers, and does not stretch the "to" number when it is the latest one.
    if (rec.status === 'Draft') continue;
    const s = parseSeries(rec.invoice_number);
    if (!s) continue;
    // Bills of Supply are listed under "Invoices for outward supply" as their own (BOS) series — Table 13 has
    // no separate document type for them (verify with your CA).
    const docType = rec.doc_type === 'CREDIT_NOTE' ? 'Credit Note' : rec.doc_type === 'DEBIT_NOTE' ? 'Debit Note' : 'Invoices for outward supply';
    const key = `${docType}|${s.prefix}`;
    const b = buckets.get(key) ?? { docType, prefix: s.prefix, width: s.width, nums: new Set<number>(), cancelled: new Set<number>() };
    b.nums.add(s.n);
    b.width = Math.max(b.width, s.width);
    if (rec.status === 'Cancelled') b.cancelled.add(s.n);
    buckets.set(key, b);
  }
  const rows: DocIssueRow[] = [];
  for (const b of buckets.values()) {
    const sorted = [...b.nums].sort((x, y) => x - y);
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    let total = hi - lo + 1;
    let gaps = total - sorted.length;
    if (b.challan) {
      // Shared challan series: numbers of other purposes are neither issued in this row nor cancelled.
      const used = challanNums.get(b.prefix) ?? new Set<number>();
      let others = 0;
      for (let n = lo; n <= hi; n++) if (!b.nums.has(n) && used.has(n)) others++;
      total -= others;
      gaps -= others;
    }
    const cancelled = b.cancelled.size + gaps;
    const fmt = (n: number) => `${b.prefix}${String(n).padStart(b.width, '0')}`;
    rows.push({
      docType: b.docType,
      series: b.prefix.replace(/[/\-\s]+$/, '') || '(no prefix)',
      from: fmt(lo),
      to: fmt(hi),
      total,
      cancelled,
      netIssued: total - cancelled,
    });
  }
  return rows.sort((a, b) => a.docType.localeCompare(b.docType) || a.series.localeCompare(b.series));
}

type Acc = { txval: number; igst: number; cgst: number; sgst: number; cess: number };
function addLine(target: Acc, l: PLine, sign: number) {
  target.txval = round2(target.txval + sign * l.taxable);
  target.igst = round2(target.igst + sign * l.igst);
  target.cgst = round2(target.cgst + sign * l.cgst);
  target.sgst = round2(target.sgst + sign * l.sgst);
  target.cess = round2(target.cess + sign * l.cess);
}

function addHsn(map: Map<string, HsnRow>, l: PLine, sign: number) {
  const hsn = l.hsn || 'NA';
  const key = `${hsn}|${l.uqc}|${l.rate}`;
  const h =
    map.get(key) ??
    { hsn, description: l.desc, uqc: l.uqc, qty: 0, value: 0, taxable: 0, rate: l.rate, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  h.qty = round2(h.qty + sign * (l.uqc === 'NA' ? 0 : l.qty));
  h.value = round2(h.value + sign * l.lineTotal);
  h.taxable = round2(h.taxable + sign * l.taxable);
  h.igst = round2(h.igst + sign * l.igst);
  h.cgst = round2(h.cgst + sign * l.cgst);
  h.sgst = round2(h.sgst + sign * l.sgst);
  h.cess = round2(h.cess + sign * l.cess);
  map.set(key, h);
}

const sortHsn = (map: Map<string, HsnRow>) => [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);

export interface PreparedGstr1 {
  docs: PDoc[];
  gstr1: Gstr1Report;
  /**
   * Additive (5.9): GSTR-3B effect of the amendments made in this period — each amended document's revised
   * version, and its original with the sign flipped (so 3B takes the difference).
   */
  amendDeltas?: PDoc[];
}

export function buildGstr1(invoices: InvoiceRecord[], opts: BuildOptions, issues: ReconIssue[] = []): PreparedGstr1 {
  const wantGstin = (opts.gstin ?? '').trim().toUpperCase();
  const counts = { included: 0, drafts: 0, cancelled: 0, notTaxDocs: 0, composition: 0 };
  const sameFiler = (r: InvoiceRecord) => {
    const sg = (r.sender?.companyGstin ?? '').trim().toUpperCase();
    return !(wantGstin && sg && sg !== wantGstin);
  };
  // Every document is reported here as it was FILED in its own period (an amended one by its frozen original).
  const filed = (invoices ?? []).filter(Boolean).map(asFiled);
  const inScope = filed.filter((r) => inPeriod(r.issue_date, opts.period) && sameFiler(r));

  const docs: PDoc[] = [];
  for (const rec of inScope) {
    if (!TAX_DOC_TYPES.has(rec.doc_type)) {
      counts.notTaxDocs++;
      continue;
    }
    if (isCompositionDoc(rec)) {
      counts.composition++;
      continue;
    }
    if (rec.status === 'Draft') {
      counts.drafts++;
      continue;
    }
    if (rec.status === 'Cancelled') {
      counts.cancelled++;
      continue;
    }
    counts.included++;
    docs.push(prepare(rec, opts, issues));
  }

  const b2b: DocRow[] = [];
  const b2cl: DocRow[] = [];
  const cdnr: CdnRow[] = [];
  const cdnur: CdnRow[] = [];
  const exp: ExportRow[] = [];
  const b2csMap = new Map<string, B2csRow>();
  const nilMap = new Map<NilSupplyType, NilRow>();
  const hsnMap = new Map<string, HsnRow>();
  const hsnB2bMap = new Map<string, HsnRow>();
  const hsnB2cMap = new Map<string, HsnRow>();
  const totals = { taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0, cess: 0 };

  const nilKey = (d: PDoc): NilSupplyType =>
    d.supply === 'INTER' ? (d.registered ? 'INTRB2B' : 'INTRB2C') : d.registered ? 'INTRAB2B' : 'INTRAB2C';

  // A note follows the invoice it amends: B2CL only if that invoice was B2CL (its value and date
  // decide), so a small credit against a large invoice is reported in CDNUR, not netted into B2CS.
  const byId = new Map(filed.map((r) => [r.id, r]));
  const originalOf = (d: PDoc): InvoiceRecord | undefined => {
    const link = opts.links?.find((l) => l.to_id === d.rec.id && (l.relation === 'credit_note' || l.relation === 'debit_note'));
    return link ? byId.get(link.from_id) : undefined;
  };
  const largeB2c = (d: PDoc): boolean => {
    const orig = d.isNote ? originalOf(d) : undefined;
    if (orig) return inrValue(Number(orig.total) || 0, orig) > b2clThreshold(String(orig.issue_date).slice(0, 10));
    return d.value > b2clThreshold(d.date);
  };

  const ecoTcs = new Map<string, EcoRow>();
  const eco95 = new Map<string, EcoRow>();
  const addEco = (map: Map<string, EcoRow>, d: PDoc, withTax: boolean) => {
    const r = map.get(d.etin!) ?? { etin: d.etin!, value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, count: 0 };
    for (const l of d.lines) {
      r.value = round2(r.value + d.sign * l.taxable);
      if (!withTax) continue;
      r.igst = round2(r.igst + d.sign * l.igst);
      r.cgst = round2(r.cgst + d.sign * l.cgst);
      r.sgst = round2(r.sgst + d.sign * l.sgst);
      r.cess = round2(r.cess + d.sign * l.cess);
    }
    r.count++;
    map.set(d.etin!, r);
  };

  for (const d of docs) {
    // Sec 9(5): the operator is liable — the supplier reports the value in Table 14(b) only.
    if (isEco95(d) && d.etin) {
      addEco(eco95, d, false);
      continue;
    }
    if (d.etin && !d.isExport) addEco(ecoTcs, d, true);
    const items = rateRows(d.lines, d.zeroRated);
    const row = docRow(d, items);
    const label = d.number || d.rec.id;

    // ── Section routing (taxable lines only; nil lines go to table 8) ──
    if (d.isExport) {
      if (d.isNote) cdnur.push({ ...row, noteType: d.noteType, unregType: row.igst > 0 ? 'EXPWP' : 'EXPWOP' });
      else exp.push({ ...row, expType: row.igst > 0 ? 'WPAY' : 'WOPAY', ...shippingBillOf(d.rec) });
    } else if (d.registered) {
      if (items.length > 0) {
        if (d.isNote) cdnr.push({ ...row, noteType: d.noteType });
        else b2b.push(row);
      }
    } else if (d.supply === 'INTER' && largeB2c(d)) {
      if (items.length > 0) {
        if (d.isNote) cdnur.push({ ...row, noteType: d.noteType, unregType: 'B2CL' });
        else b2cl.push(row);
      }
      if (!d.isNote) {
        issues.push({
          id: `B2CL_REVIEW:${d.rec.id}`,
          severity: 'warning',
          code: 'B2CL_REVIEW',
          message: `${label}: inter-state sale of ${d.value.toFixed(2)} to an unregistered buyer (above ${b2clThresholdLabel(d.date)}) is reported as B2CL. If the buyer has a GSTIN, add it so this moves to B2B.`,
          invoiceId: d.rec.id,
          invoiceNumber: d.number,
          link: '/clients',
          linkLabel: 'Add client GSTIN',
        });
      }
    } else {
      for (const l of d.lines) {
        if (isNilLine(l)) continue;
        const key = `${d.supply}|${d.pos}|${l.rate}|${row.etin ?? ''}`;
        const r = b2csMap.get(key) ?? { supply: d.supply, pos: d.pos, rate: l.rate, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, ...(row.etin ? { etin: row.etin } : {}) };
        addLine(r, l, d.sign);
        b2csMap.set(key, r);
      }
    }

    // ── Net totals, nil table, HSN table (sign-aware) ──
    totals.value = round2(totals.value + d.sign * d.value);
    for (const l of d.lines) {
      totals.taxable = round2(totals.taxable + d.sign * l.taxable);
      totals.igst = round2(totals.igst + d.sign * l.igst);
      totals.cgst = round2(totals.cgst + d.sign * l.cgst);
      totals.sgst = round2(totals.sgst + d.sign * l.sgst);
      totals.cess = round2(totals.cess + d.sign * l.cess);

      const isNil = isNilLine(l) && l.taxable !== 0;
      if (isNil && !d.zeroRated) {
        const k = nilKey(d);
        const n = nilMap.get(k) ?? { type: k, nil: 0, exempt: 0, nonGst: 0 };
        // No GSTIN on the sender means the supply is outside GST altogether; a Bill of Supply names its column.
        if (!d.senderGstin || d.exemptKind === 'NON_GST') n.nonGst = round2(n.nonGst + d.sign * l.taxable);
        else if (d.exemptKind === 'EXEMPT') n.exempt = round2(n.exempt + d.sign * l.taxable);
        else n.nil = round2(n.nil + d.sign * l.taxable);
        nilMap.set(k, n);
      }

      if (!d.senderGstin && taxOf(l) === 0 && l.cess === 0) continue; // outside GST — not in the HSN summary
      addHsn(hsnMap, l, d.sign);
      // Table 12 split: by whether the recipient is registered (a note follows its recipient too).
      addHsn(d.registered ? hsnB2bMap : hsnB2cMap, l, d.sign);
    }
  }

  const byDate = <T extends { date: string; number: string }>(a: T, b: T) =>
    a.date.localeCompare(b.date) || a.number.localeCompare(b.number);
  b2b.sort(byDate);
  b2cl.sort(byDate);
  cdnr.sort(byDate);
  cdnur.sort(byDate);
  exp.sort(byDate);

  const adv = advanceTables(opts);
  const gstr1: Gstr1Report = {
    period: opts.period,
    gstin: wantGstin,
    fp: periodFp(opts.period),
    b2b,
    b2cl,
    b2cs: [...b2csMap.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate || (a.etin ?? '').localeCompare(b.etin ?? '')),
    cdnr,
    cdnur,
    exp,
    nil: [...nilMap.values()].sort((a, b) => a.type.localeCompare(b.type)),
    hsn: sortHsn(hsnMap),
    hsnB2b: sortHsn(hsnB2bMap),
    hsnB2c: sortHsn(hsnB2cMap),
    hsnSplit: hsnTableSplit(periodRange(opts.period).from),
    hsnMinDigits: hsnMinDigits(opts.turnover ?? 0, periodRange(opts.period).to),
    docIssue: buildDocIssue(
      inScope.filter((r) => !isCompositionDoc(r)),
      (opts.advances ?? []).filter(
        (m) => inPeriod(m.date, opts.period) && (!wantGstin || !m.senderGstin || m.senderGstin === wantGstin),
      ),
    ),
    ...(adv.at.length ? { at: adv.at } : {}),
    ...(adv.txpd.length ? { txpd: adv.txpd } : {}),
    ...(ecoTcs.size || eco95.size
      ? { eco: { tcs: [...ecoTcs.values()].sort((a, b) => a.etin.localeCompare(b.etin)), pay95: [...eco95.values()].sort((a, b) => a.etin.localeCompare(b.etin)) } }
      : {}),
    // `cess` only appears when there is some, so reports without cess keep their exact shape.
    totals: totals.cess === 0 ? { taxable: totals.taxable, igst: totals.igst, cgst: totals.cgst, sgst: totals.sgst, value: totals.value } : totals,
    // `composition` only appears when some were left out, so existing report shapes stay exact.
    counts: counts.composition ? counts : { included: counts.included, drafts: counts.drafts, cancelled: counts.cancelled, notTaxDocs: counts.notTaxDocs },
  };

  const amend = buildAmendments(invoices ?? [], opts, issues, sameFiler, largeB2c);
  if (amend.count > 0) gstr1.amendments = amend.tables;
  return { docs, gstr1, ...(amend.deltas.length ? { amendDeltas: amend.deltas } : {}) };
}

/* ───────────────────────── Amendments (5.9) ───────────────────────── */

/** Operator GSTIN a B2CS / B2CSA row is split by (Sec 52 only), else ''. */
const tcsEtin = (d: PDoc) => (d.etin && d.ecoSection === 'TCS_52' ? d.etin : '');

/** Revised − original of one amendment, split into tax-payable supplies and supplies without tax. */
function amendEffect(number: string, cur: PDoc, orig: PDoc): AmendEffect {
  const taxPayable: Gstr3bTaxRow = { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const noTax = { taxable: 0 };
  const take = (d: PDoc, f: number) => {
    for (const l of d.lines) {
      const s = f * d.sign;
      if (d.rcm || isEco95(d) || isNilLine(l) || (d.zeroRated && taxOf(l) === 0)) {
        noTax.taxable = round2(noTax.taxable + s * l.taxable);
        continue;
      }
      taxPayable.taxable = round2(taxPayable.taxable + s * l.taxable);
      taxPayable.igst = round2(taxPayable.igst + s * l.igst);
      taxPayable.cgst = round2(taxPayable.cgst + s * l.cgst);
      taxPayable.sgst = round2(taxPayable.sgst + s * l.sgst);
      taxPayable.cess = round2(taxPayable.cess + s * l.cess);
    }
  };
  take(cur, 1);
  take(orig, -1);
  return { number, taxPayable, noTax };
}

/**
 * GSTR-1 amendment tables for the amendments MADE in `opts.period` (by `amends.amended_on`):
 *  - revised version registered → B2BA (invoice / BOS) or CDNRA (note);
 *  - unregistered, inter-state above the B2CL threshold → B2CLA, or CDNURA for a note;
 *  - other B2C → B2CSA: the original month's B2CS rows recomputed with every amendment made up to the end
 *    of this period (GSTN replaces the filed row with the revised one);
 *  - exports: EXPA is not generated (flagged).
 * A cancelled or draft revised version is not reported (flagged). Key layouts follow the offline tool as
 * best known — not verified against the current schema; verify with your CA.
 */
function buildAmendments(
  invoices: InvoiceRecord[],
  opts: BuildOptions,
  issues: ReconIssue[],
  sameFiler: (r: InvoiceRecord) => boolean,
  largeB2c: (d: PDoc) => boolean,
): { count: number; tables: Gstr1Amendments; deltas: PDoc[] } {
  const tables: Gstr1Amendments = { b2ba: [], b2cla: [], cdnra: [], cdnura: [], b2csa: [] };
  const deltas: PDoc[] = [];
  const effects: AmendEffect[] = [];
  const periodEnd = periodRange(opts.period).to;
  const amended = invoices.filter(
    (r) => r?.amends && inPeriod(r.amends.amended_on, opts.period) && TAX_DOC_TYPES.has(r.doc_type) && !isCompositionDoc(r) && sameFiler(r),
  );
  const isB2cs = (d: PDoc) => !d.isExport && !isEco95(d) && !d.registered && !(d.supply === 'INTER' && largeB2c(d));
  const section = (d: PDoc) => (isEco95(d) ? 'ECO 9(5)' : d.isExport ? 'EXP' : d.registered ? 'B2B' : isB2cs(d) ? 'B2CS' : 'B2CL');
  const omons = new Set<string>();
  let count = 0;

  for (const rec of amended) {
    const a = rec.amends!;
    const label = rec.invoice_number || rec.id;
    const flag = (severity: Severity, code: string, message: string) =>
      issues.push({ id: `${code}:${rec.id}`, severity, code, message: `${label}: ${message}`, invoiceId: rec.id, invoiceNumber: rec.invoice_number, link: `/invoice/${rec.id}`, linkLabel: 'Open document' });
    if (rec.status === 'Draft' || rec.status === 'Cancelled') {
      flag('warning', 'AMEND_NOT_LIVE', `amended version is ${rec.status.toLowerCase()}, so no amendment is reported. A filed document cannot be withdrawn by amendment — raise a credit note instead.`);
      continue;
    }
    if (inPeriod(a.original_date, opts.period)) {
      flag('warning', 'AMEND_SAME_PERIOD', 'is amended in the same period it was issued in. An amendment is only needed once the original return is filed — here it is reported both as filed and as amended.');
    }
    const cur = prepare(rec, opts, issues);
    const orig = a.original ? prepare(asFiled(rec), opts, []) : null;
    if (!orig) flag('warning', 'AMEND_NO_ORIGINAL', 'the copy of the original as filed is missing; only the revised values are reported and GSTR-3B is not adjusted.');
    const base = docRow(cur, rateRows(cur.lines, cur.zeroRated));
    const row: AmendDocRow = {
      ...base,
      origNumber: a.original_number,
      origDate: a.original_date,
      origPeriod: a.period || periodFp(periodForDate('month', a.original_date)),
      ...(a.reason ? { reason: a.reason } : {}),
    };
    count++;
    if (orig && section(orig) !== section(cur)) {
      flag('info', 'AMEND_SECTION_CHANGED', `originally reported in ${section(orig)}, now ${section(cur)}. Check with your CA how the portal expects this move to be reported.`);
    }
    if (isEco95(cur)) {
      flag('warning', 'AMEND_ECO_95', 'supplies on which the e-commerce operator pays tax u/s 9(5) are amended in GSTR-1 Table 14A(b), which is not generated — amend it on the portal. GSTR-3B 3.1.1(ii) of this period takes the difference.');
    } else if (cur.isExport) {
      // Table 9A: EXPA for an export invoice, CDNURA (EXPWP / EXPWOP) for a note on one.
      if (cur.isNote) tables.cdnura.push({ ...row, noteType: cur.noteType, unregType: row.igst > 0 ? 'EXPWP' : 'EXPWOP' });
      else (tables.expa ??= []).push({ ...row, expType: row.igst > 0 ? 'WPAY' : 'WOPAY', ...shippingBillOf(rec) });
    } else if (cur.registered) {
      if (cur.isNote) tables.cdnra.push({ ...row, noteType: cur.noteType });
      else tables.b2ba.push(row);
    } else if (!isB2cs(cur)) {
      if (cur.isNote) tables.cdnura.push({ ...row, noteType: cur.noteType, unregType: 'B2CL' });
      else tables.b2cla.push(row);
    }
    if (isB2cs(cur) || (orig && isB2cs(orig))) omons.add(a.original_date.slice(0, 7));

    deltas.push(cur);
    if (orig) deltas.push({ ...orig, sign: (orig.sign === 1 ? -1 : 1) as 1 | -1 });
    if (orig) effects.push(amendEffect(label, cur, orig));
  }

  // B2CSA: revised B2CS rows of each original month touched by an amendment of this period.
  for (const ym of omons) {
    const month = periodForDate('month', `${ym}-01`);
    const touched = new Set<string>();
    const revised = new Map<string, B2csaRow>();
    const omon = periodFp(month);
    for (const r of invoices) {
      if (!r || !TAX_DOC_TYPES.has(r.doc_type) || isCompositionDoc(r) || !sameFiler(r)) continue;
      const asFiledRec = asFiled(r);
      if (!inPeriod(asFiledRec.issue_date, month)) continue;
      const amendedByNow = !!r.amends && r.amends.amended_on.slice(0, 10) <= periodEnd;
      const version = amendedByNow ? r : asFiledRec;
      if (version.status === 'Draft' || version.status === 'Cancelled') continue;
      const d = prepare(version, opts, []);
      const thisPeriod = !!r.amends && inPeriod(r.amends.amended_on, opts.period);
      if (thisPeriod) {
        // Keys of both versions are revised (a supply that left B2CS revises its old row down to zero).
        const keyOf = (pd: PDoc, l: PLine) => `${pd.supply}|${pd.pos}|${l.rate}|${tcsEtin(pd)}`;
        const o = prepare(asFiledRec, opts, []);
        if (isB2cs(o)) for (const l of o.lines) if (!isNilLine(l)) touched.add(keyOf(o, l));
        if (isB2cs(d)) for (const l of d.lines) if (!isNilLine(l)) touched.add(keyOf(d, l));
      }
      if (!isB2cs(d)) continue;
      for (const l of d.lines) {
        if (isNilLine(l)) continue;
        const key = `${d.supply}|${d.pos}|${l.rate}|${tcsEtin(d)}`;
        const row = revised.get(key) ?? { omon, supply: d.supply, pos: d.pos, rate: l.rate, txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, ...(tcsEtin(d) ? { etin: tcsEtin(d) } : {}) };
        addLine(row, l, d.sign);
        revised.set(key, row);
      }
    }
    for (const key of touched) {
      const [supply, pos, rate, etin] = key.split('|');
      tables.b2csa.push(revised.get(key) ?? { omon, supply: supply as 'INTRA' | 'INTER', pos, rate: Number(rate), txval: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, ...(etin ? { etin } : {}) });
    }
  }
  const byDate = <T extends { date: string; number: string }>(x: T, y: T) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number);
  tables.expa?.sort(byDate);
  tables.b2ba.sort(byDate);
  tables.b2cla.sort(byDate);
  tables.cdnra.sort(byDate);
  tables.cdnura.sort(byDate);
  tables.b2csa.sort((x, y) => x.omon.localeCompare(y.omon) || x.pos.localeCompare(y.pos) || x.rate - y.rate);
  if (effects.length) tables.effects = effects;
  return { count, tables, deltas };
}

/* ───────────────────────── Purchases (defensive) ───────────────────────── */

export interface NormalizedPurchase {
  id: string;
  number: string;
  date: string;
  supplierName: string;
  supplierGstin: string;
  supplierState: string;
  reverseCharge: boolean;
  itcEligible: boolean;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  /** Additive (WP-6): compensation cess on the bill (`cess_amount`), 0 when none. */
  cess?: number;
  /** ITC reversed against this bill (amount, spread pro-rata over the heads). */
  itcReversed: number;
  /** RULE_42 / RULE_43 / RULE_37 / SEC_17_5 / OTHER, or ''. */
  itcReversalReason: string;
  importType: '' | 'GOODS' | 'SERVICES';
  /** Additive: the bill's category is not a supply at all (salaries, taxes … — `isNonSupplyCategory`). */
  nonSupply?: boolean;
}

/**
 * Reads a purchase row through the shared purchases reader. Returns null for
 * rows that must not count (drafts, cancelled, no usable date).
 * `itc_eligible === false` marks ineligible ITC; anything else is eligible.
 * With an explicit cgst/sgst/igst split (what the purchases module writes) that
 * split is used as-is; otherwise a lump `tax_amount` (or taxable x rate) is split
 * by supplier state vs the filer's state.
 */
export function normalizePurchase(raw: unknown, filerStateCode: string): NormalizedPurchase | null {
  const c = readPurchase(raw);
  if (!c || isVoidStatus(c.status)) return null;
  const supState =
    checkGstin(c.partyGstin).stateCode ?? stateByCode(c.vendorStateCode || c.placeOfSupply)?.code ?? '';

  const { igst, cgst, sgst, taxable } = splitLumpTax(c, raw, filerStateCode, supState);

  return {
    id: c.id || `${c.date}:${c.number}`,
    number: c.number,
    date: c.date,
    supplierName: c.partyName,
    supplierGstin: c.partyGstin,
    supplierState: supState,
    reverseCharge: c.reverseCharge,
    itcEligible: c.itcEligible,
    taxable: round2(taxable),
    igst: round2(igst),
    cgst: round2(cgst),
    sgst: round2(sgst),
    ...(c.cess > 0 ? { cess: c.cess } : {}),
    itcReversed: c.itcReversed,
    itcReversalReason: c.itcReversalReason,
    importType: c.importType,
    ...(isNonSupplyCategory(c.category) ? { nonSupply: true } : {}),
  };
}

/** Reversal reasons reported in 3B 4B(1) (permanent); everything else goes to 4B(2). */
const RULE_REVERSALS = new Set(['RULE_38', 'RULE_42', 'RULE_43', 'SEC_17_5']);

/* ───────────────────────── GSTR-3B ───────────────────────── */

const zeroHeads = (): ItcHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
const zeroRow = (): Gstr3bTaxRow => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

/**
 * Table 6.1 set-off, following Sec 49 / 49A and Rule 88A (Notification 16/2019-CT):
 *  1. IGST credit settles IGST first. What is left must be used up against CGST and SGST
 *     "in any order" before any CGST / SGST credit is touched, so it goes FIRST to the part of
 *     each head that the head's own credit cannot cover (that is what minimises cash: CGST
 *     credit can never pay SGST and vice versa), CGST shortfall before SGST shortfall, and only
 *     then to the rest of the CGST / SGST liability.
 *  2. CGST credit then settles CGST, then IGST (never SGST).
 *  3. SGST credit then settles SGST, then IGST (never CGST).
 * Reverse-charge tax can only be paid in cash, so it bypasses ITC entirely. The cash figures are
 * a working paper: the portal's own set-off screen is what is filed (verify with your CA).
 */
export function computeSetOff(
  liability: { igst: number; cgst: number; sgst: number },
  credit: { igst: number; cgst: number; sgst: number },
  rcLiability: { igst: number; cgst: number; sgst: number } = { igst: 0, cgst: 0, sgst: 0 },
  /** Date-keyed utilisation order (`gstSetOffOrder(periodStart)` in tax-rules.ts); default = Rule 88A. */
  order: GstSetOffOrder = { igstFirst: true, igstRemainder: 'any' },
): SetOffResult {
  const L = { igst: Math.max(round2(liability.igst), 0), cgst: Math.max(round2(liability.cgst), 0), sgst: Math.max(round2(liability.sgst), 0) };
  const C = { igst: Math.max(round2(credit.igst), 0), cgst: Math.max(round2(credit.cgst), 0), sgst: Math.max(round2(credit.sgst), 0) };
  const rem = { ...L };
  const avail = { ...C };
  const used = {
    igst: { igst: 0, cgst: 0, sgst: 0 },
    cgst: { cgst: 0, igst: 0 },
    sgst: { sgst: 0, igst: 0 },
  };
  const take = (credHead: 'igst' | 'cgst' | 'sgst', liabHead: 'igst' | 'cgst' | 'sgst') => {
    const amt = Math.min(avail[credHead], rem[liabHead]);
    if (amt <= 0) return;
    avail[credHead] = round2(avail[credHead] - amt);
    rem[liabHead] = round2(rem[liabHead] - amt);
    (used[credHead] as Record<string, number>)[liabHead] = round2(((used[credHead] as Record<string, number>)[liabHead] ?? 0) + amt);
  };
  if (!order.igstFirst) {
    // Original Sec 49(5) (periods before 1 Feb 2019): each head's own credit first, then the cross-utilisation.
    take('igst', 'igst');
    take('cgst', 'cgst');
    take('sgst', 'sgst');
    take('igst', 'cgst');
    take('igst', 'sgst');
    take('cgst', 'igst');
    take('sgst', 'igst');
    return result();
  }
  take('igst', 'igst');
  // Leftover IGST covers the shortfall each head's own credit leaves, then whatever remains.
  const takeUpTo = (liabHead: 'cgst' | 'sgst', cap: number) => {
    const amt = Math.min(avail.igst, rem[liabHead], Math.max(round2(cap), 0));
    if (amt <= 0) return;
    avail.igst = round2(avail.igst - amt);
    rem[liabHead] = round2(rem[liabHead] - amt);
    used.igst[liabHead] = round2(used.igst[liabHead] + amt);
  };
  // Rule 88A ("any order"): pick the split that minimises cash. Before it, Sec 49(5)(a) said CGST, then SGST.
  if (order.igstRemainder === 'any') {
    takeUpTo('cgst', L.cgst - C.cgst);
    takeUpTo('sgst', L.sgst - C.sgst);
  }
  take('igst', 'cgst');
  take('igst', 'sgst');
  take('cgst', 'cgst');
  take('cgst', 'igst');
  take('sgst', 'sgst');
  take('sgst', 'igst');
  return result();

  function result(): SetOffResult {
    return {
    liability: L,
    rcLiability: { igst: round2(rcLiability.igst), cgst: round2(rcLiability.cgst), sgst: round2(rcLiability.sgst) },
    itcUsed: used,
    cash: {
      igst: round2(rem.igst + rcLiability.igst),
      cgst: round2(rem.cgst + rcLiability.cgst),
      sgst: round2(rem.sgst + rcLiability.sgst),
    },
    itcCarry: { igst: avail.igst, cgst: avail.cgst, sgst: avail.sgst },
    };
  }
}

export function buildGstr3b(
  docs: PDoc[],
  purchases: NormalizedPurchase[],
  opts: BuildOptions,
  filerStateCode: string,
): Gstr3bReport {
  const taxable = zeroRow();
  const zero = zeroRow();
  const nil = { inter: 0, intra: 0 };
  let nonGst = 0;
  let outwardRcmTaxable = 0;
  let eco95 = 0;
  let hasEco95 = false;
  const unregInter = new Map<string, { pos: string; taxable: number; igst: number }>();

  for (const d of docs) {
    if (isEco95(d)) {
      // 3.1.1(ii): the operator pays the tax u/s 9(5); the supplier reports the value only, outside 3.1.
      hasEco95 = true;
      for (const l of d.lines) eco95 = round2(eco95 + d.sign * l.taxable);
      continue;
    }
    for (const l of d.lines) {
      const s = d.sign;
      if (d.rcm && !d.zeroRated) {
        outwardRcmTaxable = round2(outwardRcmTaxable + s * l.taxable);
        continue;
      }
      if (d.zeroRated) {
        // 3.1(b): exports and SEZ supplies (with or without IGST payment).
        zero.taxable = round2(zero.taxable + s * l.taxable);
        zero.igst = round2(zero.igst + s * l.igst);
        zero.cess = round2(zero.cess + s * l.cess);
        continue;
      }
      if (isNilLine(l)) {
        if (!d.senderGstin || d.exemptKind === 'NON_GST') nonGst = round2(nonGst + s * l.taxable);
        else if (d.supply === 'INTER') nil.inter = round2(nil.inter + s * l.taxable);
        else nil.intra = round2(nil.intra + s * l.taxable);
        continue;
      }
      taxable.taxable = round2(taxable.taxable + s * l.taxable);
      taxable.igst = round2(taxable.igst + s * l.igst);
      taxable.cgst = round2(taxable.cgst + s * l.cgst);
      taxable.sgst = round2(taxable.sgst + s * l.sgst);
      taxable.cess = round2(taxable.cess + s * l.cess);
      if (!d.registered && d.supply === 'INTER') {
        const u = unregInter.get(d.pos) ?? { pos: d.pos, taxable: 0, igst: 0 };
        u.taxable = round2(u.taxable + s * l.taxable);
        u.igst = round2(u.igst + s * l.igst);
        unregInter.set(d.pos, u);
      }
    }
  }

  // Advances (5.3): tax on service advances is due in the period received (Table 11A) and comes
  // off in the period adjusted (11B). The portal folds GSTR-1 Table 11 into 3.1(a), so do we.
  const adv = advanceTables(opts);
  let advances: Gstr3bReport['advances'];
  if (adv.at.length || adv.txpd.length) {
    const sumRows = (rows: AdvanceTableRow[]): Gstr3bTaxRow => rows.reduce<Gstr3bTaxRow>((acc, r) => ({
      taxable: round2(acc.taxable + r.taxable), igst: round2(acc.igst + r.igst), cgst: round2(acc.cgst + r.cgst),
      sgst: round2(acc.sgst + r.sgst), cess: round2(acc.cess + r.cess),
    }), zeroRow());
    advances = { received: sumRows(adv.at), adjusted: sumRows(adv.txpd) };
    for (const k of ['taxable', 'igst', 'cgst', 'sgst', 'cess'] as const) {
      taxable[k] = round2(taxable[k] + advances.received[k] - advances.adjusted[k]);
    }
  }

  const rcm = zeroRow();
  const impGoods = zeroHeads();
  const impServices = zeroHeads();
  const reversedRules = zeroHeads();
  const availRcm = zeroHeads();
  const availOther = zeroHeads();
  const reversed = zeroHeads();
  const ineligible = zeroHeads();
  const inwardExempt = { inter: 0, intra: 0 };

  const add = (h: ItcHeads, p: { igst: number; cgst: number; sgst: number; cess?: number }, f = 1) => {
    h.igst = round2(h.igst + f * p.igst);
    h.cgst = round2(h.cgst + f * p.cgst);
    h.sgst = round2(h.sgst + f * p.sgst);
    h.cess = round2(h.cess + f * (p.cess ?? 0));
  };

  for (const p of purchases) {
    const tax = round2(p.igst + p.cgst + p.sgst + (p.cess ?? 0));
    // Sec 17(5) blocked credit: shown in 4A (as GSTR-2B auto-fills it) and reversed in full in 4B(1).
    const blocked = !p.itcEligible && p.itcReversalReason === 'SEC_17_5';
    const claim = (bucket: ItcHeads) => {
      if (p.itcEligible || blocked) add(bucket, p);
      if (blocked) add(reversedRules, p);
      else if (!p.itcEligible) add(ineligible, p);
    };
    if (p.importType === 'GOODS') {
      // IGST paid at customs on the Bill of Entry: no 3.1 liability, ITC in 4A(1).
      if (tax > 0) claim(impGoods);
    } else if (p.importType === 'SERVICES') {
      // Import of services is always reverse charge: liability in 3.1(d), ITC in 4A(2).
      rcm.taxable = round2(rcm.taxable + p.taxable);
      add(rcm, p);
      rcm.cess = round2(rcm.cess + (p.cess ?? 0));
      claim(impServices);
    } else if (p.reverseCharge) {
      rcm.taxable = round2(rcm.taxable + p.taxable);
      add(rcm, p);
      rcm.cess = round2(rcm.cess + (p.cess ?? 0));
      claim(availRcm);
    } else if (tax === 0) {
      // Salaries, taxes and other non-supplies are not inward supplies at all: never in Table 5.
      if (p.nonSupply) continue;
      const inter = p.supplierState && filerStateCode ? p.supplierState !== filerStateCode : false;
      if (inter) inwardExempt.inter = round2(inwardExempt.inter + p.taxable);
      else inwardExempt.intra = round2(inwardExempt.intra + p.taxable);
    } else {
      claim(availOther);
    }
    if (p.itcReversed > 0 && tax > 0 && p.itcEligible) {
      const ratio = Math.min(p.itcReversed, tax) / tax;
      add(RULE_REVERSALS.has(p.itcReversalReason) ? reversedRules : reversed, { igst: p.igst * ratio, cgst: p.cgst * ratio, sgst: p.sgst * ratio, cess: (p.cess ?? 0) * ratio });
    }
  }

  // 7R (7.122): ISD credit received (4A(4)); ineligible ISD credit is shown in 4D(2).
  const isd = zeroHeads();
  let hasIsd = false;
  const filerG = (opts.gstin ?? '').trim().toUpperCase();
  for (const r of opts.isdInward ?? []) {
    if (!inPeriod(r.date, opts.period) || (filerG && r.gstin && r.gstin.toUpperCase() !== filerG)) continue;
    hasIsd = true;
    add(r.eligible ? isd : ineligible, r);
  }
  const signedHead = (k: 'igst' | 'cgst' | 'sgst' | 'cess') =>
    round2(impGoods[k] + impServices[k] + availRcm[k] + isd[k] + availOther[k] - reversedRules[k] - reversed[k]);
  const netSigned: ItcHeads = { igst: signedHead('igst'), cgst: signedHead('cgst'), sgst: signedHead('sgst'), cess: signedHead('cess') };
  const net: ItcHeads = { igst: Math.max(netSigned.igst, 0), cgst: Math.max(netSigned.cgst, 0), sgst: Math.max(netSigned.sgst, 0), cess: Math.max(netSigned.cess, 0) };
  const negativeNet = netSigned.igst < 0 || netSigned.cgst < 0 || netSigned.sgst < 0 || netSigned.cess < 0;

  const liab = {
    igst: round2(taxable.igst + zero.igst),
    cgst: round2(taxable.cgst + zero.cgst),
    sgst: round2(taxable.sgst + zero.sgst),
  };
  const unadjusted = {
    igst: Math.max(round2(-liab.igst), 0),
    cgst: Math.max(round2(-liab.cgst), 0),
    sgst: Math.max(round2(-liab.sgst), 0),
  };
  const payment = computeSetOff(liab, net, { igst: rcm.igst, cgst: rcm.cgst, sgst: rcm.sgst }, gstSetOffOrder(periodRange(opts.period).from));
  // Cess is settled only with cess credit (Sec 11(2) Compensation Cess Act); reverse-charge cess is cash only.
  const cessLiab = Math.max(round2(taxable.cess + zero.cess), 0);
  const cessUsed = Math.min(cessLiab, net.cess);
  payment.cess = round2(cessLiab - cessUsed + Math.max(rcm.cess, 0));
  if (net.cess > 0 || rcm.cess > 0) {
    payment.cessLiability = cessLiab;
    payment.cessItcUsed = round2(cessUsed);
    payment.cessItcCarry = round2(net.cess - cessUsed);
  }

  return {
    outward: { taxable, zeroRated: zero, nilExempt: nil, inwardRcm: rcm, nonGst },
    interStateUnreg: [...unregInter.values()].sort((a, b) => a.pos.localeCompare(b.pos)),
    itc: {
      importGoods: impGoods,
      importServices: impServices,
      availableRcm: availRcm,
      availableOther: availOther,
      reversedRules,
      reversedOther: reversed,
      net,
      ineligible,
      ...(negativeNet ? { netSigned } : {}),
      ...(hasIsd ? { isd } : {}),
    },
    inwardExempt,
    payment,
    unadjustedCredit: unadjusted,
    purchasesConsidered: purchases.length,
    outwardRcmTaxable,
    ...(advances ? { advances } : {}),
    ...(hasEco95 ? { ecoSupplies95: eco95 } : {}),
  };
}

/* ───────────────────────── Orchestrator ───────────────────────── */

export function buildGstReport(
  invoices: InvoiceRecord[],
  rawPurchases: unknown[],
  opts: BuildOptions,
): GstReport {
  const issues: ReconIssue[] = [];
  const { docs, gstr1, amendDeltas } = buildGstr1(invoices, opts, issues);

  // Filer state: explicit GSTIN, else first included document's sender, else fallback.
  const filerSt =
    filerState(opts.gstin ?? '', opts.filerStateCode) ||
    filerState(docs.find((d) => d.senderGstin)?.senderGstin ?? '', opts.filerStateCode);

  const purchases: NormalizedPurchase[] = [];
  let skipped = 0;
  for (const raw of rawPurchases ?? []) {
    const p = normalizePurchase(raw, filerSt);
    if (!p) {
      skipped++;
      continue;
    }
    if (!inPeriod(p.date, opts.period)) continue;
    purchases.push(p);
    const claimed = p.itcEligible && p.igst + p.cgst + p.sgst > 0;
    if (claimed && !p.reverseCharge && !p.importType && !checkGstin(p.supplierGstin).valid) {
      issues.push({
        id: `ITC_NO_GSTIN:${p.id}`,
        severity: p.supplierGstin ? 'error' : 'warning',
        code: 'ITC_NO_GSTIN',
        message: `Purchase ${p.number || p.id}: ITC is claimed but the supplier GSTIN is ${p.supplierGstin ? 'invalid' : 'missing'}; it will not match GSTR-2B.`,
        link: '/purchases',
        linkLabel: 'Open purchases',
      });
    }
  }
  // WP-3: purchase returns / supplier credit notes in the period reduce ITC (negative rows, same tables as their bills).
  purchases.push(...itcAdjustmentsFromNotes(opts.purchaseNotes ?? [], (d) => inPeriod(d, opts.period)));
  if (purchases.length === 0) {
    issues.push({
      id: 'NO_PURCHASES',
      severity: 'info',
      code: 'NO_PURCHASES',
      message: 'No purchase bills found in this period, so GSTR-3B shows no input tax credit. Add purchases to claim ITC.',
      link: '/purchases',
      linkLabel: 'Open purchases',
    });
  }

  const c = gstr1.counts;
  if (c.drafts > 0) {
    issues.push({ id: 'DRAFTS', severity: 'info', code: 'DRAFTS', message: `${c.drafts} draft document(s) in this period were excluded. Send or finalise them if they are real sales.`, link: '/transactions', linkLabel: 'Open ledger' });
  }
  if (c.composition) {
    issues.push({ id: 'COMPOSITION_DOCS', severity: 'info', code: 'COMPOSITION_DOCS', message: `${c.composition} document(s) issued under a composition profile are left out: composition dealers file CMP-08 and GSTR-4, not GSTR-1 / GSTR-3B.`, link: '/gst-reports?tab=composition', linkLabel: 'Open composition returns' });
  }
  if (c.cancelled > 0) {
    issues.push({ id: 'CANCELLED', severity: 'info', code: 'CANCELLED', message: `${c.cancelled} cancelled document(s) are excluded from tax tables and counted in the document summary.` });
  }
  for (const r of gstr1.docIssue) {
    const gaps = r.cancelled; // includes cancelled + drafts + missing; flag only when sequence has holes
    if (gaps > 0 && r.total > 0) {
      issues.push({
        id: `SERIES:${r.docType}:${r.series}`,
        severity: 'info',
        code: 'SERIES_CANCELLED',
        message: `${r.series}: ${gaps} of ${r.total} numbers (${r.from} to ${r.to}) are cancelled, draft or missing and are reported as cancelled.`,
      });
    }
  }
  void skipped;

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  // Amendments made in this period change this period's 3B by their difference (revised − original).
  return { gstr1, gstr3b: buildGstr3b(amendDeltas ? [...docs, ...amendDeltas] : docs, purchases, opts, filerSt), issues };
}
