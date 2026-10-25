/**
 * Composition returns (roadmap 5.9): the quarterly CMP-08 statement-cum-challan and the annual GSTR-4.
 *
 * Pure (no storage, no DOM) so it is unit-tested in Node. Inputs: the `invoices` rows and the raw
 * `purchases` rows. Outputs are working papers — not filed returns. Verify with your CA.
 *
 * Rules applied (rates date-keyed in `tax-rules.ts`):
 *  - Outward turnover = every live sales document (Bill of Supply, invoice, debit note; credit notes
 *    negative) whose SENDER SNAPSHOT is a composition profile, dated in the period. Value = taxable value
 *    plus untaxed freight / other charges (rupees for foreign-currency documents).
 *  - Tax = turnover × composition rate of the document's category on its date, half CGST, half SGST.
 *    A trader pays only on taxable supplies from 1 Jan 2018 (lines whose catalogue GST rate is 0 are
 *    treated as exempt and left out of the base; freight follows the taxable lines).
 *  - Reverse charge: purchases flagged reverse charge, and imports of services, are taxed at the normal
 *    rate and paid in cash (CMP-08 Table 3 row 2). A composition dealer cannot claim ITC, so tax shown on
 *    other purchase bills is reported as "not claimable", never as credit.
 *  - Interest, late fee and TDS/TCS credits are not computed.
 */

import type { InvoiceRecord } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { inrValue } from './fx';
import { checkGstin } from './gstin';
import { stateByCode } from './india-states';
import {
  inPeriod,
  normalizePurchase,
  periodFp,
  periodLabel,
  periodRange,
  type NormalizedPurchase,
  type ReportPeriod,
} from './gst-reports';
import { COMPOSITION_TRADER_TAXABLE_ONLY_FROM, compositionRate, type CompositionKind } from './tax-rules';

export interface CompositionIssue {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  invoiceId?: string;
}

export interface CompositionOptions {
  /** Filer GSTIN: documents of other GSTINs are skipped (blank = every composition profile). */
  gstin?: string;
  /** Filer state (for splitting a lump purchase tax). */
  filerStateCode?: string;
  /** Category used when a document's sender snapshot carries none. */
  category?: CompositionKind;
}

export interface RateBase {
  rate: number;
  /** Turnover the rate applies to. */
  base: number;
  cgst: number;
  sgst: number;
}

export interface TaxHeads {
  value: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Cmp08Report {
  period: ReportPeriod;
  /** GSTN return period (MMYYYY of the last month). */
  fp: string;
  label: string;
  gstin: string;
  /** Table 3(1): outward supplies incl. exempt — `value` is all turnover, tax on `taxableBase`. */
  outward: { value: number; exempt: number; taxableBase: number; cgst: number; sgst: number };
  byRate: RateBase[];
  /** Table 3(2): inward supplies attracting reverse charge, incl. import of services. */
  rcm: TaxHeads;
  /** Table 3(3): tax payable = 3(1) + 3(2). */
  payable: { igst: number; cgst: number; sgst: number; cess: number; total: number };
  /** Tax shown on ordinary purchase bills: NOT claimable by a composition dealer (reported, never credited). */
  itcNotClaimable: number;
  counts: { documents: number; drafts: number; cancelled: number; purchases: number };
  issues: CompositionIssue[];
}

const SALES_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DEBIT_NOTE', 'CREDIT_NOTE']);

function senderMatches(rec: InvoiceRecord, gstin: string): boolean {
  if (rec?.sender?.gst_scheme !== 'composition') return false;
  const g = (rec.sender?.companyGstin ?? '').trim().toUpperCase();
  return !gstin || !g || g === gstin;
}

interface DocTurnover {
  value: number;
  exempt: number;
  base: number;
  rate: number | null;
}

/** One document's turnover in rupees (signed: credit notes negative). Exported for tests. */
export function documentTurnover(rec: InvoiceRecord, fallback: CompositionKind = 'trader'): DocTurnover {
  const date = String(rec.issue_date).slice(0, 10);
  const kind = rec.sender?.composition_category ?? fallback;
  // The base is the value of supply WITHOUT tax, so compute untaxed (a wrongly taxed invoice is flagged separately).
  const calc = calculateInvoice(calcInputFromRecord(rec, { gst_mode: 'NONE', amount_paid: 0, tcs_enabled: false, tds_enabled: false }));
  // Exempt supplies stay out of the base for traders (Rule 7 as amended from 1 Jan 2018) and for
  // service providers under Sec 10(2A) / 2/2019-CT(R), whose rate applies to taxable supplies only
  // (supplies exempt under 12/2017-CT(R) stay exempt). Manufacturers and restaurants pay on the whole
  // turnover. CA-judgment item: verify with your CA.
  const taxableOnly = (kind === 'trader' && date >= COMPOSITION_TRADER_TAXABLE_ONLY_FROM) || kind === 'service';
  let exempt = 0;
  let base = 0;
  for (const l of calc.lines) {
    if (taxableOnly && num(l.nominal_rate) <= 0) exempt += l.taxable;
    else base += l.taxable;
  }
  const charges = calc.charges_line ? calc.charges_line.taxable : num(calc.shipping) + num(calc.other_charges);
  // Freight follows the supply it goes with: taxable unless every line is exempt.
  if (taxableOnly && base === 0 && exempt !== 0) exempt += charges;
  else base += charges;
  const sign = rec.doc_type === 'CREDIT_NOTE' ? -1 : 1;
  const value = inrValue(round2(base + exempt), rec);
  const ex = inrValue(round2(exempt), rec);
  return { value: sign * value, exempt: sign * ex, base: sign * round2(value - ex), rate: compositionRate(kind, date) };
}

function addHeads(t: TaxHeads, p: NormalizedPurchase) {
  t.value = round2(t.value + p.taxable);
  t.igst = round2(t.igst + p.igst);
  t.cgst = round2(t.cgst + p.cgst);
  t.sgst = round2(t.sgst + p.sgst);
}

const zeroHeads = (): TaxHeads => ({ value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });

function filerStateOf(opts: CompositionOptions): string {
  return checkGstin(opts.gstin ?? '').stateCode ?? stateByCode(opts.filerStateCode)?.code ?? '';
}

/** Purchases of the period through the shared reader (drafts / cancelled dropped). */
export function periodPurchases(rawPurchases: unknown[], period: ReportPeriod, filerState: string): NormalizedPurchase[] {
  const out: NormalizedPurchase[] = [];
  for (const raw of rawPurchases ?? []) {
    const p = normalizePurchase(raw, filerState);
    if (p && inPeriod(p.date, period)) out.push(p);
  }
  return out;
}

/** CMP-08 for one quarter (any period works; CMP-08 itself is quarterly). */
export function buildCmp08(invoices: InvoiceRecord[], rawPurchases: unknown[], period: ReportPeriod, opts: CompositionOptions = {}): Cmp08Report {
  const gstin = (opts.gstin ?? '').trim().toUpperCase();
  const issues: CompositionIssue[] = [];
  const counts = { documents: 0, drafts: 0, cancelled: 0, purchases: 0 };
  const outward = { value: 0, exempt: 0, taxableBase: 0, cgst: 0, sgst: 0 };
  const rateMap = new Map<number, RateBase>();

  for (const rec of invoices ?? []) {
    if (!rec || !SALES_TYPES.has(rec.doc_type) || !inPeriod(rec.issue_date, period) || !senderMatches(rec, gstin)) continue;
    if (rec.status === 'Draft') {
      counts.drafts++;
      continue;
    }
    if (rec.status === 'Cancelled') {
      counts.cancelled++;
      continue;
    }
    counts.documents++;
    const label = rec.invoice_number || rec.id;
    const t = documentTurnover(rec, opts.category);
    outward.value = round2(outward.value + t.value);
    outward.exempt = round2(outward.exempt + t.exempt);
    if (t.rate === null) {
      issues.push({ severity: 'error', code: 'NO_RATE', message: `${label}: no composition rate for this category on ${rec.issue_date} (the Sec 10(2A) option starts 1 Apr 2019); left out of the tax.`, invoiceId: rec.id });
      continue;
    }
    outward.taxableBase = round2(outward.taxableBase + t.base);
    const r = rateMap.get(t.rate) ?? { rate: t.rate, base: 0, cgst: 0, sgst: 0 };
    r.base = round2(r.base + t.base);
    rateMap.set(t.rate, r);
    if (num(rec.tax_amount) > 0 || num(rec.cgst_amount) + num(rec.sgst_amount) + num(rec.igst_amount) > 0) {
      issues.push({ severity: 'warning', code: 'TAX_COLLECTED', message: `${label}: GST was charged on a composition dealer's document. A composition dealer cannot collect tax (Sec 10(4)); tax collected must still be paid over — reissue it as a Bill of Supply and check with your CA.`, invoiceId: rec.id });
    }
  }

  const byRate = [...rateMap.values()]
    .map((r) => {
      const half = round2((r.base * r.rate) / 200);
      return { ...r, cgst: half, sgst: half };
    })
    .sort((a, b) => a.rate - b.rate);
  outward.cgst = round2(byRate.reduce((s, r) => s + r.cgst, 0));
  outward.sgst = round2(byRate.reduce((s, r) => s + r.sgst, 0));

  const filerState = filerStateOf(opts);
  const rcm = zeroHeads();
  let itcNotClaimable = 0;
  for (const p of periodPurchases(rawPurchases, period, filerState)) {
    counts.purchases++;
    const tax = round2(p.igst + p.cgst + p.sgst);
    if (p.reverseCharge || p.importType === 'SERVICES') addHeads(rcm, p);
    else if (p.importType !== 'GOODS' && tax > 0) itcNotClaimable = round2(itcNotClaimable + tax);
  }
  if (itcNotClaimable > 0) {
    issues.push({ severity: 'info', code: 'ITC_NOT_CLAIMABLE', message: `Purchase bills this period show ${itcNotClaimable.toFixed(2)} of GST. A composition dealer cannot claim input tax credit (Sec 10(4)); it is a cost, not a credit.` });
  }

  const payable = {
    igst: rcm.igst,
    cgst: round2(outward.cgst + rcm.cgst),
    sgst: round2(outward.sgst + rcm.sgst),
    cess: rcm.cess,
    total: 0,
  };
  payable.total = round2(payable.igst + payable.cgst + payable.sgst + payable.cess);
  return { period, fp: periodFp(period), label: periodLabel(period), gstin, outward, byRate, rcm, payable, itcNotClaimable, counts, issues };
}

/* ───────────────────────── GSTR-4 (annual) ───────────────────────── */

export interface Gstr4Report {
  fyStart: number;
  label: string;
  gstin: string;
  /** Table 4: inward supplies. */
  inward: {
    /** 4A registered suppliers, forward charge. */
    registered: TaxHeads;
    /** 4B registered suppliers, reverse charge. */
    registeredRcm: TaxHeads;
    /** 4C unregistered suppliers (reverse charge or not). */
    unregistered: TaxHeads;
    /** 4D import of services. */
    importServices: TaxHeads;
  };
  /** Table 5: the four CMP-08 statements of the year. */
  quarters: Cmp08Report[];
  /** Table 6: outward supplies by composition rate (annual). */
  outwardByRate: RateBase[];
  totals: { turnover: number; exempt: number; compositionTax: number; rcmTax: number; payable: number };
  issues: CompositionIssue[];
}

export function buildGstr4(invoices: InvoiceRecord[], rawPurchases: unknown[], fyStart: number, opts: CompositionOptions = {}): Gstr4Report {
  const gstin = (opts.gstin ?? '').trim().toUpperCase();
  const quarters = ([1, 2, 3, 4] as const).map((q) => buildCmp08(invoices, rawPurchases, { kind: 'quarter', fyStart, quarter: q }, opts));
  const fy: ReportPeriod = { kind: 'fy', fyStart };
  const filerState = filerStateOf(opts);
  const inward = { registered: zeroHeads(), registeredRcm: zeroHeads(), unregistered: zeroHeads(), importServices: zeroHeads() };
  const issues: CompositionIssue[] = [];
  let goodsImports = 0;
  for (const p of periodPurchases(rawPurchases, fy, filerState)) {
    if (p.importType === 'SERVICES') addHeads(inward.importServices, p);
    else if (p.importType === 'GOODS') goodsImports++;
    else if (!checkGstin(p.supplierGstin).valid) addHeads(inward.unregistered, p);
    else if (p.reverseCharge) addHeads(inward.registeredRcm, p);
    else addHeads(inward.registered, p);
  }
  if (goodsImports) issues.push({ severity: 'info', code: 'IMPORT_GOODS', message: `${goodsImports} import-of-goods bill(s) are not part of GSTR-4 Table 4 (IGST is paid at customs).` });

  const rateMap = new Map<number, RateBase>();
  for (const q of quarters) {
    for (const r of q.byRate) {
      const x = rateMap.get(r.rate) ?? { rate: r.rate, base: 0, cgst: 0, sgst: 0 };
      x.base = round2(x.base + r.base);
      x.cgst = round2(x.cgst + r.cgst);
      x.sgst = round2(x.sgst + r.sgst);
      rateMap.set(r.rate, x);
    }
    issues.push(...q.issues.filter((i) => i.code !== 'ITC_NOT_CLAIMABLE'));
  }
  const sum = (pick: (q: Cmp08Report) => number) => round2(quarters.reduce((s, q) => s + pick(q), 0));
  const compositionTax = sum((q) => q.outward.cgst + q.outward.sgst);
  const rcmTax = sum((q) => q.rcm.igst + q.rcm.cgst + q.rcm.sgst + q.rcm.cess);
  return {
    fyStart,
    label: periodLabel(fy),
    gstin,
    inward,
    quarters,
    outwardByRate: [...rateMap.values()].sort((a, b) => a.rate - b.rate),
    totals: {
      turnover: sum((q) => q.outward.value),
      exempt: sum((q) => q.outward.exempt),
      compositionTax,
      rcmTax,
      payable: round2(compositionTax + rcmTax),
    },
    issues,
  };
}

/** CMP-08 as CSV rows (table, description, value, IGST, CGST, SGST, cess). */
export function cmp08Rows(r: Cmp08Report): (string | number)[][] {
  return [
    ['Table', 'Description', 'Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    ['3(1)', 'Outward supplies (including exempt supplies)', r.outward.value, 0, r.outward.cgst, r.outward.sgst, 0],
    ...r.byRate.map((x): (string | number)[] => ['3(1)', `  of which taxed at ${x.rate}%`, x.base, 0, x.cgst, x.sgst, 0]),
    ...(r.outward.exempt ? [['3(1)', '  of which exempt (trader, not taxed)', r.outward.exempt, 0, 0, 0, 0] as (string | number)[]] : []),
    ['3(2)', 'Inward supplies attracting reverse charge incl. import of services', r.rcm.value, r.rcm.igst, r.rcm.cgst, r.rcm.sgst, r.rcm.cess],
    ['3(3)', 'Tax payable (1 + 2)', '', r.payable.igst, r.payable.cgst, r.payable.sgst, r.payable.cess],
    ['3(4)', 'Interest payable (not computed)', '', '', '', '', ''],
  ];
}

/** GSTR-4 as CSV rows. */
export function gstr4Rows(r: Gstr4Report): (string | number)[][] {
  const h = (t: string, d: string, x: TaxHeads): (string | number)[] => [t, d, x.value, x.igst, x.cgst, x.sgst, x.cess];
  return [
    ['Table', 'Description', 'Value', 'IGST', 'CGST', 'SGST', 'Cess'],
    h('4A', 'Inward supplies from registered suppliers (other than reverse charge)', r.inward.registered),
    h('4B', 'Inward supplies from registered suppliers attracting reverse charge', r.inward.registeredRcm),
    h('4C', 'Inward supplies from unregistered suppliers', r.inward.unregistered),
    h('4D', 'Import of services', r.inward.importServices),
    ...r.quarters.map((q): (string | number)[] => ['5', `CMP-08 ${q.label}: turnover ${q.outward.value}`, q.outward.value, q.payable.igst, q.payable.cgst, q.payable.sgst, q.payable.cess]),
    ...r.outwardByRate.map((x): (string | number)[] => ['6', `Outward supplies taxed at ${x.rate}%`, x.base, 0, x.cgst, x.sgst, 0]),
    ['6', 'Exempt outward supplies (trader, not taxed)', r.totals.exempt, 0, 0, 0, 0],
  ];
}

/** Inclusive range label for a period, e.g. for the CSV file name. */
export function rangeOf(p: ReportPeriod): string {
  const { from, to } = periodRange(p);
  return `${from}_${to}`;
}
