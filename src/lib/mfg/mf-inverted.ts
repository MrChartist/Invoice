/**
 * MF-C5 Rule 89(5) inverted-duty working paper (`RULE_89_5_RULES`, date-keyed by the period end):
 *   maximum refund = (turnover of inverted rated supply × net ITC ÷ adjusted total turnover)
 *                    − tax payable on that supply [× net ITC ÷ ITC availed on inputs and input services, from 5 Jul 2022]
 * Net ITC = ITC on INPUTS (goods) only — input services and capital goods excluded (VKC Footsteps, SC 2021). Outputs come
 * from the period's sales documents (taxable value by line and rate; credit notes subtract; financial notes skipped),
 * inputs from the period's bills through `readPurchase` / `readPurchaseLines` (SAC 99… lines = services, expense bills
 * and `itc_use: 'common_capital'` = excluded). The user picks the inverted output rates and may exclude documents. The
 * result can pre-fill a DRAFT refund claim (category `INVERTED_DUTY`) in the existing register. Verify with your CA (MF26).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { readPurchase, readPurchaseLines } from '../purchase-normalize';
import { isRevenueDoc } from '../stats';
import { isNonGstFinancialNote } from '../financial-note';
import { ruleAt } from '../tax-rules';
import { RULE_89_5_RULES } from '../mfg-rules';
import { saveRefund, type GstRefundClaim } from '../gst-cash-refunds';

/** Pre-fill a DRAFT refund claim (category `INVERTED_DUTY`) in the existing register; split CGST / SGST — edit the heads there. */
export function prefillInvertedClaim(x: { from: string; to: string; refund: number; gstin?: string; notes?: string }): GstRefundClaim {
  const half = round2(num(x.refund) / 2);
  return saveRefund({ category: 'INVERTED_DUTY', period_from: x.from, period_to: x.to, relevant_date: x.to, ...(x.gstin ? { gstin: x.gstin } : {}), claimed: { igst: 0, cgst: half, sgst: round2(num(x.refund) - half), cess: 0 }, notes: `${x.notes ?? 'Rule 89(5) working paper'}: split by head as your credit ledger allows. Verify with your CA (MF26).` });
}

export interface IdLine {
  /** Document id (exclusion is by document). */
  doc_id: string;
  doc: string;
  date: string;
  rate: number;
  taxable: number;
  tax: number;
  /** Input side: an input service / capital good (not in net ITC). */
  service?: boolean;
  capital?: boolean;
  itc?: boolean;
  /** Output side: zero-rated (export / SEZ under LUT — no tax at its nominal rate): in ATT, never inverted turnover (QA15 M4). */
  zero?: boolean;
}

const inP = (d: string, from: string, to: string) => d >= from && d <= to;

/** Outward lines of the period (signed: credit notes negative). */
export function outwardLines(invoices: readonly InvoiceRecord[], from: string, to: string): IdLine[] {
  const out: IdLine[] = [];
  for (const inv of invoices) {
    const d = String(inv.issue_date ?? '').slice(0, 10);
    if (!inP(d, from, to) || inv.status === 'Cancelled' || inv.status === 'Draft' || isNonGstFinancialNote(inv)) continue;
    const sign = inv.doc_type === 'CREDIT_NOTE' ? -1 : isRevenueDoc(inv) && inv.doc_type !== 'BILL_OF_SUPPLY' ? 1 : 0;
    if (!sign) continue;
    for (const l of calculateInvoice(calcInputFromRecord(inv)).lines) out.push({ doc_id: inv.id, doc: inv.invoice_number ?? '', date: d, rate: num(l.nominal_rate ?? l.tax_rate), taxable: sign * l.taxable, tax: sign * l.tax, ...(num(l.nominal_rate) > 0 && !(num(l.tax_rate) > 0) ? { zero: true } : {}) });
  }
  return out;
}

/** Inward lines of the period with ITC (tax spread pro rata over the bill's lines). */
export function inwardLines(purchases: readonly unknown[], from: string, to: string): IdLine[] {
  const out: IdLine[] = [];
  for (const raw of purchases) {
    const c = readPurchase(raw);
    if (!c || !inP(c.date, from, to) || c.status === 'void' || !c.itcEligible) continue;
    const capital = (raw as { itc_use?: string }).itc_use === 'common_capital' || /capital|fixed asset/i.test(c.category);
    const lines = readPurchaseLines(raw);
    const base = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitCost), 0) || 1;
    for (const l of lines) {
      const share = (num(l.quantity) * num(l.unitCost)) / base;
      out.push({ doc_id: c.id, doc: c.number, date: c.date, rate: num(l.taxRate), taxable: round2(c.taxable * share), tax: round2((c.tax - c.itcReversed) * share), service: c.isExpense || /^99/.test(l.hsn ?? ''), capital, itc: true });
    }
  }
  return out;
}

export interface Rule895Result {
  invertedTurnover: number;
  att: number;
  netItc: number;
  itcAvailed: number;
  taxPayable: number;
  refund: number;
  /** The two terms of the formula. */
  first: number;
  second: number;
  notes: string[];
}

/** The formula over the chosen inverted output rates, documents in `exclude` left out. */
export function rule895(outs: readonly IdLine[], ins: readonly IdLine[], invertedRates: readonly number[], periodTo: string, exclude: ReadonlySet<string> = new Set()): Rule895Result {
  const rule = ruleAt(RULE_89_5_RULES, periodTo);
  const o = outs.filter((l) => !exclude.has(l.doc_id));
  const i = ins.filter((l) => !exclude.has(l.doc_id));
  // QA15 M4: zero-rated lines (LUT exports, Rule 89(4)) are not inverted rated supply; a credit note on a nil / exempt
  // supply (rate 0) does not reduce the adjusted total turnover.
  const inv = o.filter((l) => !l.zero && invertedRates.includes(l.rate));
  const invertedTurnover = round2(inv.reduce((s, l) => s + l.taxable, 0));
  const taxPayable = round2(inv.reduce((s, l) => s + l.tax, 0));
  const att = round2(o.filter((l) => l.rate > 0).reduce((s, l) => s + l.taxable, 0));
  const netItc = round2(i.filter((l) => !l.capital && (rule.inputServices || !l.service)).reduce((s, l) => s + l.tax, 0));
  const itcAvailed = round2(i.filter((l) => !l.capital).reduce((s, l) => s + l.tax, 0));
  const notes: string[] = [];
  if (!(att > 0)) return { invertedTurnover, att, netItc, itcAvailed, taxPayable, refund: 0, first: 0, second: 0, notes: ['Adjusted total turnover is nil: no refund can be worked out.'] };
  const first = round2((invertedTurnover * netItc) / att);
  const second = round2(rule.ratioOnTax && itcAvailed > 0 ? (taxPayable * netItc) / itcAvailed : taxPayable);
  const refund = round2(Math.max(first - second, 0));
  if (!refund) notes.push('No refund: the tax payable on the inverted supply covers its share of input credit.');
  const higher = i.filter((l) => !l.service && !l.capital && invertedRates.some((r) => l.rate > r)).length;
  if (!higher) notes.push('No input is taxed above the chosen output rates: the structure may not be inverted.');
  notes.push(`Net ITC is inputs only (input services and capital goods out). ${rule.ratioOnTax ? 'Tax payable scaled by net ITC ÷ ITC availed (N 14/2022-CT).' : 'Tax payable deducted in full (before 5 Jul 2022).'} Working paper: verify with your CA (${rule.ca}).`);
  return { invertedTurnover, att, netItc, itcAvailed, taxPayable, refund, first, second, notes };
}

/** Output rates that sit below some input-goods rate (the default pick). */
export function suggestInvertedRates(outs: readonly IdLine[], ins: readonly IdLine[]): number[] {
  const top = Math.max(0, ...ins.filter((l) => !l.service && !l.capital).map((l) => l.rate));
  return [...new Set(outs.filter((l) => !l.zero && l.rate > 0 && l.rate < top).map((l) => l.rate))].sort((a, b) => a - b);
}
