/**
 * GSTR-4 (composition annual return) Tables 7, 8 and 9 — the part `buildGstr4` (composition-returns.ts) leaves out —
 * plus CMP-08 / GSTR-4 interest and late-fee ESTIMATES (rates date-keyed in gst-penalties.ts).
 *
 *  - Table 7 TDS / TCS credit received: TCS an e-commerce operator collected u/s 52 is ESTIMATED from the year's
 *    documents marked "operator collects TCS" (net value × the Sec 52 rate on the document date, `ecoTcsRate`);
 *    the actual figures come from the operator's GSTR-8 / the deductor's GSTR-7 on the portal. Rows the user
 *    types in (from the portal) are listed as entered.
 *  - Table 8 tax, interest and late fee payable and paid: tax payable = the four CMP-08s (composition tax +
 *    reverse charge); interest payable = Sec 50 interest on each CMP-08 paid after its due date (the filed date
 *    from the Compliance tab, else not late); late fee payable = GSTR-4 late fee for the filing date entered here
 *    (else the as-of day once the due date has passed). "Paid" columns are typed in.
 *  - Table 9 refund claimed from the electronic cash ledger: typed in.
 * Typed-in values live in the `gstr4_manual` table, one row per FY × GSTIN (`id` = `${fyStart}|${GSTIN}`).
 * Working paper — the portal computes the filed figures. Verify with your CA.
 */

import type { InvoiceRecord } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, round2 } from './invoice-calc';
import { inrValue } from './fx';
import { ecoOf } from './eco';
import { inPeriod, periodRange, type ReportPeriod } from './gst-reports';
import { isNonGstFinancialNote } from './financial-note';
import { buildCmp08, buildGstr4, type CompositionOptions, type Gstr4Report } from './composition-returns';
import { compositionDueDays, ecoTcsRate } from './tax-rules';
import { gstInterest, gstr4LateFee, lateDays } from './gst-penalties';
import type { FiledReturn, ReturnDue } from './compliance';
import { getTable, setTable } from './storage';

export const GSTR4_MANUAL_TABLE = 'gstr4_manual';

export type Head4 = 'igst' | 'cgst' | 'sgst' | 'cess';
export type Heads4 = Record<Head4, number>;
export const HEADS4: readonly Head4[] = ['igst', 'cgst', 'sgst', 'cess'];
const zero4 = (): Heads4 => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

export interface TdsTcsEntry {
  id: string;
  kind: 'TDS' | 'TCS';
  /** GSTIN of the deductor (TDS, Sec 51) or the e-commerce operator (TCS, Sec 52). */
  gstin: string;
  /** Gross value on which tax was deducted / collected. */
  gross: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface RefundEntry {
  tax: number;
  interest: number;
  penalty: number;
  fee: number;
  other: number;
}

/** Typed-in GSTR-4 values for one FY × GSTIN (table `gstr4_manual`). */
export interface Gstr4Manual {
  id: string;
  fy_start: number;
  gstin: string;
  tds_tcs?: TdsTcsEntry[];
  tax_paid?: Partial<Heads4>;
  interest_paid?: Partial<Heads4>;
  late_fee_paid?: Partial<Heads4>;
  refund?: Partial<Record<Head4, Partial<RefundEntry>>>;
  /** Debit entry numbers of the refund claim (free text). */
  refund_debit_entries?: string;
  /** Day the GSTR-4 was (or will be) filed — drives the late-fee estimate. */
  filed_on?: string;
  updated_at?: string;
}

export const gstr4ManualId = (fyStart: number, gstin: string) => `${fyStart}|${(gstin ?? '').trim().toUpperCase()}`;

export function loadGstr4Manual(fyStart: number, gstin: string): Gstr4Manual {
  const id = gstr4ManualId(fyStart, gstin);
  const row = getTable<Gstr4Manual>(GSTR4_MANUAL_TABLE).find((r) => r && r.id === id);
  return row ?? { id, fy_start: fyStart, gstin: (gstin ?? '').trim().toUpperCase() };
}

export function saveGstr4Manual(row: Gstr4Manual, now = new Date()): void {
  const rows = getTable<Gstr4Manual>(GSTR4_MANUAL_TABLE).filter((r) => r && r.id !== row.id);
  setTable(GSTR4_MANUAL_TABLE, [...rows, { ...row, updated_at: now.toISOString() }]);
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/* ───────────────────────── Table 7 ───────────────────────── */

export interface TcsEstimateRow {
  etin: string;
  /** Net value of supplies through the operator (credit notes netted). */
  gross: number;
  igst: number;
  cgst: number;
  sgst: number;
  documents: number;
}

/**
 * TCS u/s 52 an operator should have collected on the composition profile's supplies through it in `period`.
 * Composition supplies are intra-state, so the TCS is split half CGST / half SGST (IGST for an inter-state one).
 */
export function estimateEcoTcs(invoices: readonly InvoiceRecord[], period: ReportPeriod, gstin = ''): TcsEstimateRow[] {
  const want = gstin.trim().toUpperCase();
  const map = new Map<string, TcsEstimateRow>();
  for (const rec of invoices ?? []) {
    if (!rec || rec.sender?.gst_scheme !== 'composition' || rec.status === 'Draft' || rec.status === 'Cancelled') continue;
    if (!['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(rec.doc_type)) continue;
    if (isNonGstFinancialNote(rec)) continue; // QA5 F3: a no-GST financial note is not a supply
    const g = (rec.sender?.companyGstin ?? '').trim().toUpperCase();
    if (want && g && g !== want) continue;
    if (!inPeriod(rec.issue_date, period)) continue;
    const eco = ecoOf(rec);
    if (!eco || eco.section !== 'TCS_52') continue;
    const date = String(rec.issue_date).slice(0, 10);
    const calc = calculateInvoice(calcInputFromRecord(rec, { gst_mode: 'NONE', amount_paid: 0, tcs_enabled: false, tds_enabled: false }));
    const sign = rec.doc_type === 'CREDIT_NOTE' ? -1 : 1;
    const value = sign * inrValue(round2(calc.taxable_value), rec);
    const tcs = round2((value * ecoTcsRate(date)) / 100);
    const inter = !!rec.place_of_supply && !!rec.sender?.stateCode && rec.place_of_supply !== rec.sender.stateCode;
    const r = map.get(eco.gstin) ?? { etin: eco.gstin, gross: 0, igst: 0, cgst: 0, sgst: 0, documents: 0 };
    r.gross = round2(r.gross + value);
    if (inter) r.igst = round2(r.igst + tcs);
    else {
      r.cgst = round2(r.cgst + tcs / 2);
      r.sgst = round2(r.sgst + tcs / 2);
    }
    r.documents++;
    map.set(eco.gstin, r);
  }
  return [...map.values()].sort((a, b) => a.etin.localeCompare(b.etin));
}

/* ───────────────────────── Interest / late fee ───────────────────────── */

export interface Cmp08Interest {
  quarter: 1 | 2 | 3 | 4;
  due: string;
  /** Filed / paid on (from the Compliance tab), '' when not marked. */
  paidOn: string;
  days: number;
  payable: Heads4;
  interest: Heads4;
}

/** Sec 50 interest on each CMP-08 of the FY paid after its due date (estimate, by head). */
export function cmp08Interest(g4: Gstr4Report, filed: readonly FiledReturn[] = [], asOf = ''): Cmp08Interest[] {
  const gstin = g4.gstin;
  return g4.quarters.map((q, i) => {
    const quarter = (i + 1) as 1 | 2 | 3 | 4;
    const { from, to } = periodRange(q.period);
    const ny = Number(to.slice(0, 4)) + (to.slice(5, 7) === '12' ? 1 : 0);
    const nm = (Number(to.slice(5, 7)) % 12) + 1;
    const due = `${ny}-${String(nm).padStart(2, '0')}-${String(compositionDueDays(from).cmp08).padStart(2, '0')}`;
    const mark = filed.find(
      (f) => f && !!f.filed_on && f.form === 'CMP08' && f.period_key === `${g4.fyStart}-Q${quarter}` && (!f.gstin || !gstin || f.gstin.toUpperCase() === gstin),
    );
    // Not marked filed: late only once the as-of day is past the due date.
    const paidOn = mark?.filed_on ?? '';
    const effective = paidOn || (asOf && asOf > due ? asOf : '');
    const payable: Heads4 = { igst: q.payable.igst, cgst: q.payable.cgst, sgst: q.payable.sgst, cess: q.payable.cess };
    const interest = zero4();
    if (effective) for (const h of HEADS4) interest[h] = gstInterest(payable[h], due, effective, from);
    return { quarter, due, paidOn, days: effective ? lateDays(due, effective) : 0, payable, interest };
  });
}

/** GSTR-4 due date of the FY (`compositionDueDays`). */
export function gstr4Due(fyStart: number): string {
  return `${fyStart + 1}-${compositionDueDays(`${fyStart}-04-01`).gstr4}`;
}

/* ───────────────────────── Tables 7-9 ───────────────────────── */

export interface Gstr4Table8Row {
  head: Head4;
  taxPayable: number;
  taxPaid: number;
  interestPayable: number;
  interestPaid: number;
  lateFeePayable: number;
  lateFeePaid: number;
}

export interface Gstr4Annual {
  fyStart: number;
  gstin: string;
  /** Table 7: typed-in TDS / TCS rows plus the TCS estimate from the documents. */
  table7: { entered: TdsTcsEntry[]; tcsEstimate: TcsEstimateRow[] };
  table8: Gstr4Table8Row[];
  table9: { head: Head4; refund: RefundEntry }[];
  refundDebitEntries: string;
  interest: Cmp08Interest[];
  lateFee: { due: string; filedOn: string; days: number; total: number; nil: boolean };
  notes: string[];
}

export interface Gstr4AnnualOptions extends CompositionOptions {
  /** Compliance filed marks (CMP-08 payment dates). */
  filed?: readonly FiledReturn[];
  /** Day used for unfiled returns past their due date (normally today). '' = treat as on time. */
  asOf?: string;
}

export function buildGstr4Annual(
  invoices: InvoiceRecord[],
  rawPurchases: unknown[],
  fyStart: number,
  manual: Gstr4Manual | null,
  opts: Gstr4AnnualOptions = {},
): Gstr4Annual {
  const g4 = buildGstr4(invoices, rawPurchases, fyStart, opts);
  const m = manual ?? { id: gstr4ManualId(fyStart, g4.gstin), fy_start: fyStart, gstin: g4.gstin };
  const interest = cmp08Interest(g4, opts.filed ?? [], opts.asOf ?? '');
  const due = gstr4Due(fyStart);
  const filedOn = (m.filed_on ?? '').slice(0, 10) || (opts.asOf && opts.asOf > due ? opts.asOf : '');
  const nil = g4.totals.turnover === 0 && g4.totals.payable === 0;
  const lateTotal = filedOn ? gstr4LateFee(due, filedOn, fyStart, nil) : 0;
  const half = round2(lateTotal / 2);
  const lateByHead: Heads4 = { igst: 0, cgst: half, sgst: round2(lateTotal - half), cess: 0 };

  const table8 = HEADS4.map((head): Gstr4Table8Row => ({
    head,
    taxPayable: round2(interest.reduce((s, q) => s + q.payable[head], 0)),
    taxPaid: round2(n(m.tax_paid?.[head])),
    interestPayable: round2(interest.reduce((s, q) => s + q.interest[head], 0)),
    interestPaid: round2(n(m.interest_paid?.[head])),
    lateFeePayable: lateByHead[head],
    lateFeePaid: round2(n(m.late_fee_paid?.[head])),
  }));
  const table9 = HEADS4.map((head) => {
    const r = m.refund?.[head] ?? {};
    return { head, refund: { tax: n(r.tax), interest: n(r.interest), penalty: n(r.penalty), fee: n(r.fee), other: n(r.other) } };
  });
  const entered = (m.tds_tcs ?? []).filter(Boolean).map((e) => ({ ...e, gross: n(e.gross), igst: n(e.igst), cgst: n(e.cgst), sgst: n(e.sgst) }));
  const tcsEstimate = estimateEcoTcs(invoices, { kind: 'fy', fyStart }, opts.gstin);

  const notes = [
    'Table 7: the TCS estimate is worked out from documents marked "operator collects TCS (Sec 52)"; the credit you may claim is what the operator / deductor filed in GSTR-8 / GSTR-7 (auto-filled on the portal).',
    'Table 8: interest is Sec 50 interest (18% p.a.) on each CMP-08 paid after its due date (dates from the Compliance tab); late fee is the GSTR-4 late fee for the filing date. Waivers and extensions are not modelled.',
    'Working paper: verify with your CA before filing.',
  ];
  return {
    fyStart,
    gstin: g4.gstin,
    table7: { entered, tcsEstimate },
    table8,
    table9,
    refundDebitEntries: m.refund_debit_entries ?? '',
    interest,
    lateFee: { due, filedOn, days: filedOn ? lateDays(due, filedOn) : 0, total: lateTotal, nil },
    notes,
  };
}

/** GSTR-4 Tables 7-9 as CSV rows. */
export function gstr4AnnualRows(a: Gstr4Annual): (string | number)[][] {
  const H = (h: Head4) => h.toUpperCase();
  return [
    ['Table', 'Description', 'GSTIN', 'Gross value', 'IGST', 'CGST', 'SGST'],
    ...a.table7.entered.map((e): (string | number)[] => ['7', `${e.kind} credit (entered)`, e.gstin, e.gross, e.igst, e.cgst, e.sgst]),
    ...a.table7.tcsEstimate.map((e): (string | number)[] => ['7', 'TCS u/s 52 (estimate from documents)', e.etin, e.gross, e.igst, e.cgst, e.sgst]),
    [],
    ['Table', 'Head', 'Tax payable', 'Tax paid', 'Interest payable (estimate)', 'Interest paid', 'Late fee payable (estimate)', 'Late fee paid'],
    ...a.table8.map((r): (string | number)[] => ['8', H(r.head), r.taxPayable, r.taxPaid, r.interestPayable, r.interestPaid, r.lateFeePayable, r.lateFeePaid]),
    [],
    ['Table', 'Head', 'Tax', 'Interest', 'Penalty', 'Fee', 'Other', 'Debit entry nos.'],
    ...a.table9.map((r): (string | number)[] => ['9', H(r.head), r.refund.tax, r.refund.interest, r.refund.penalty, r.refund.fee, r.refund.other, a.refundDebitEntries]),
    [],
    ...a.notes.map((x): (string | number)[] => ['Note', x]),
  ];
}

/**
 * Inputs for the Compliance tab's estimate of a composition return: the quarter's CMP-08 payable (interest base)
 * and whether a GSTR-4 is nil.
 */
export function compositionLateInputs(
  r: Pick<ReturnDue, 'form' | 'from'>,
  invoices: InvoiceRecord[],
  purchases: unknown[],
  opts: CompositionOptions,
): { cashTax: number; nil: boolean } {
  const fyStart = Number(r.from.slice(5, 7)) >= 4 ? Number(r.from.slice(0, 4)) : Number(r.from.slice(0, 4)) - 1;
  if (r.form === 'CMP08') {
    const m = Number(r.from.slice(5, 7));
    const quarter = (Math.floor(((m - 4 + 12) % 12) / 3) + 1) as 1 | 2 | 3 | 4;
    return { cashTax: buildCmp08(invoices, purchases, { kind: 'quarter', fyStart, quarter }, opts).payable.total, nil: false };
  }
  const g4 = buildGstr4(invoices, purchases, fyStart, opts);
  return { cashTax: 0, nil: g4.totals.turnover === 0 && g4.totals.payable === 0 };
}
