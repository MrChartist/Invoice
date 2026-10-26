/**
 * R5-B5: RA bill deductions — retention, mobilisation-advance recovery, income-tax TDS (194C), GST TDS u/s 51, BOCW
 * labour cess, security deposit, liquidated damages, other.
 *
 *  - The BOQ's deduction set gives the defaults; each RA bill stores a snapshot `ra_deductions` and `ra_net_payable`.
 *  - The invoice `total`, GST and GSTR-1 are UNCHANGED (GST is on the full value, retention included). IT TDS uses the
 *    invoice's own `tds_*` fields, so receivables and the 26AS reconciler already see it.
 *  - Retention: % of the value before GST (or incl. GST), capped at a % of the contract value over all RA bills.
 *  - Advance recovery: % of each bill until the linked advance is recovered; optional start after x% of work done.
 *  - GST TDS: 2% (1% + 1% intra-state / 2% IGST inter-state) on the value excluding GST, only for a recipient flagged
 *    as a Sec 51 deductor and a contract above ₹2.5 lakh (date-keyed `GST_TDS_51_RULES`).
 *  - Labour cess: 1% (date-keyed) of the value before GST.
 * Pure. Working paper — verify with your CA (§7 Q6 / Q7 of the Round 5 PRD).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { DeductionRule, RaDeduction, RaDeductionKind } from '../../types/transport-works-r5';
import { num, pctOf, round2 } from '../invoice-calc';
import { ruleAt, tdsSections } from '../tax-rules';
import { GST_TDS_51_RULES, LABOUR_CESS_RULES } from '../transport-works-rules';
import { sectionText } from '../ita2025';
import { receivableTotal, type RcmFields } from '../rcm';

export const DEDUCTION_LABELS: Record<RaDeductionKind, string> = {
  retention: 'Retention',
  advance_recovery: 'Mobilisation advance recovery',
  it_tds: 'Income-tax TDS',
  gst_tds: 'GST TDS u/s 51',
  labour_cess: 'Labour cess (BOCW)',
  security_deposit: 'Security deposit',
  ld: 'Liquidated damages',
  other: 'Other deduction',
};

export interface DeductionContext {
  /** Contract value (BOQ taxable). */
  contractValue: number;
  /** Taxable value billed on earlier live RA bills of this BOQ. */
  previousGross: number;
  /** Retention already deducted on earlier live RA bills. */
  previousRetention: number;
  /** Mobilisation advance (gross) and what earlier bills / adjustments recovered. */
  advance?: { amount: number; recovered: number };
  /** The recipient deducts GST TDS u/s 51. */
  gstTdsDeductor: boolean;
  /** Intra-state supply (CGST + SGST) vs inter-state (IGST). */
  intraState: boolean;
}

const pct = (rule: DeductionRule, fallback: number) => (num(rule.rate) > 0 ? num(rule.rate) : fallback);

/** Default IT TDS rate for a 194C code on a date (individual / HUF 1%, others 2%). */
export const itTdsRate = (section: string | undefined, date: string): number => tdsSections(date).find((s) => s.section === (section || '194C-2'))?.rate ?? 2;

/** Pure: the deductions of one RA bill (`bill` is the computed stage invoice). */
export function computeDeductions(bill: Pick<InvoiceRecord, 'taxable_value' | 'total' | 'issue_date'>, rules: readonly DeductionRule[], ctx: DeductionContext): RaDeduction[] {
  const out: RaDeduction[] = [];
  const taxable = round2(num(bill.taxable_value));
  const date = bill.issue_date;
  for (const r of rules) {
    const label = r.label?.trim() || DEDUCTION_LABELS[r.kind];
    switch (r.kind) {
      case 'retention': {
        const base = r.basis === 'gross' ? round2(num(bill.total)) : taxable;
        let amount = pctOf(base, pct(r, 0));
        if (num(r.cap_pct) > 0) amount = Math.min(amount, Math.max(round2(pctOf(ctx.contractValue, num(r.cap_pct)) - ctx.previousRetention), 0));
        if (amount > 0) out.push({ kind: 'retention', label: `${label} ${pct(r, 0)}%`, base, rate: pct(r, 0), amount: round2(amount) });
        break;
      }
      case 'advance_recovery': {
        if (!ctx.advance) break;
        const left = round2(ctx.advance.amount - ctx.advance.recovered);
        if (!(left > 0)) break;
        const start = pctOf(ctx.contractValue, num(r.start_after_pct));
        const base = round2(Math.max(Math.min(taxable, ctx.previousGross + taxable - start), 0));
        const amount = round2(Math.min(pctOf(base, pct(r, 0)), left));
        if (amount > 0) out.push({ kind: 'advance_recovery', label: `${label} ${pct(r, 0)}%`, base, rate: pct(r, 0), amount });
        break;
      }
      case 'it_tds': {
        const rate = pct(r, itTdsRate(r.section, date));
        const amount = pctOf(taxable, rate);
        if (amount > 0) out.push({ kind: 'it_tds', label: `${label} u/s ${sectionText(r.section || '194C-2', date)} ${rate}%`, base: taxable, rate, amount });
        break;
      }
      case 'gst_tds': {
        const rule = ruleAt(GST_TDS_51_RULES, date);
        if (!rule || !ctx.gstTdsDeductor || !(ctx.contractValue > rule.threshold)) break;
        const rate = pct(r, rule.rate);
        const amount = ctx.intraState ? round2(pctOf(taxable, rate / 2) * 2) : pctOf(taxable, rate);
        if (amount > 0) out.push({ kind: 'gst_tds', label: `${label} ${ctx.intraState ? `(CGST ${rate / 2}% + SGST ${rate / 2}%)` : `(IGST ${rate}%)`}`, base: taxable, rate, amount });
        break;
      }
      case 'labour_cess': {
        const rate = pct(r, ruleAt(LABOUR_CESS_RULES, date));
        const amount = pctOf(taxable, rate);
        if (amount > 0) out.push({ kind: 'labour_cess', label: `${label} ${rate}%`, base: taxable, rate, amount });
        break;
      }
      default: {
        const amount = num(r.amount) > 0 ? round2(num(r.amount)) : pctOf(taxable, num(r.rate));
        if (amount > 0) out.push({ kind: r.kind, label, base: taxable, ...(num(r.rate) > 0 ? { rate: num(r.rate) } : {}), amount });
      }
    }
  }
  return out;
}

/** Net payable = what the customer owes on the document (total; RCM tax excluded) − every deduction. */
export function netPayable(inv: RcmFields, deds: readonly RaDeduction[]): number {
  return round2(receivableTotal(inv) - deds.reduce((s, d) => s + d.amount, 0));
}

/** The RA bill with its deductions applied (IT TDS through the invoice's own TDS fields; totals unchanged). */
export function withDeductions<T extends InvoiceRecord>(inv: T, deds: readonly RaDeduction[], rules: readonly DeductionRule[]): T {
  const it = deds.find((d) => d.kind === 'it_tds');
  const itRule = rules.find((r) => r.kind === 'it_tds');
  return {
    ...inv,
    ra_deductions: deds.map((d) => ({ ...d })),
    ra_net_payable: netPayable(inv, deds),
    ...(it ? { tds_enabled: true, tds_section: itRule?.section || '194C-2', tds_rate: it.rate, tds_amount: it.amount, tds_on_taxable: true } : {}),
  };
}

export const deductionTotal = (deds: readonly RaDeduction[] | undefined) => round2((deds ?? []).reduce((s, d) => s + num(d.amount), 0));
