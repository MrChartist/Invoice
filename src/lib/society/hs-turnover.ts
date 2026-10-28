/**
 * R18-B3 (pure; family `f-society`): the FY-to-date aggregate turnover against the registration threshold (exempt
 * maintenance and non-member income included, pure-agent dues left out — HS4), the units above the ₹7,500 limit in a
 * period, the Circular 109 Q2 both-conditions position (a hint, never a block) and the inward-RCM hint on security
 * services bought by a registered society from a supplier that is not a body corporate (HS15; the rule row is passed in
 * from `manpower-rules.ts`). Working papers — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import { REG_THRESHOLD_RULES } from '../society-rules';
import type { InvoiceRecord } from '../../types/invoice';
import type {} from '../../types/services-r10';
import { periodBills } from './hs-run';

const SIGN: Record<string, number> = { TAX_INVOICE: 1, BILL_OF_SUPPLY: 1, INVOICE: 1, DEBIT_NOTE: 1, CREDIT_NOTE: -1 };

/** Turnover of the documents dated `from`–`to` (live, issued): exempt (Bills of Supply, exempt lines) and taxable value. */
export function fyTurnover(invoices: readonly InvoiceRecord[], from: string, to: string, recovery: (i: InvoiceRecord) => number): { exempt: number; taxable: number; total: number } {
  const t = { exempt: 0, taxable: 0, total: 0 };
  for (const i of invoices) {
    const s = SIGN[i.doc_type ?? 'INVOICE'], d = String(i.issue_date ?? '');
    if (!s || i.status === 'Cancelled' || i.status === 'Draft' || d < from || d > to) continue;
    const v = (Number(i.taxable_value) || 0) - recovery(i);
    const ex = i.doc_type === 'BILL_OF_SUPPLY' ? v : (i.items ?? []).filter((l) => l.sv?.exempt).reduce((n, l) => n + (Number(l.amount) || 0), 0);
    t.exempt = round2(t.exempt + s * ex);
    t.taxable = round2(t.taxable + s * (v - ex));
  }
  t.total = round2(t.exempt + t.taxable);
  return t;
}

/** The registration threshold of a State on a date (special-category rows first, HS4). */
export function regThreshold(state: string | undefined, date: string): number {
  let hit = 0, own = 0;
  for (const r of REG_THRESHOLD_RULES) if (r.from <= date) { if (!r.state) hit = r.value; else if (r.state === state) own = r.value; }
  return own || hit;
}

/** Units whose live main bill of the period was above limit × months. */
export const unitsAbove = (invoices: readonly InvoiceRecord[], period: string): string[] =>
  periodBills(invoices, period).filter((i) => !i.hs?.levy && i.hs?.test && i.hs.test.counted > i.hs.test.limit * i.hs.test.months).map((i) => i.hs!.unit!.code);

/** Circular 109 Q2: GST only when the turnover is at or above the threshold AND a unit is above the limit. */
export const position = (turnover: number, threshold: number, above: number) => ({ big: turnover >= threshold, above: above > 0, hint: turnover >= threshold && above > 0 });

/**
 * Inward RCM hint (HS15): a registered society's bill from a supplier of security services (`sac` prefix of the rule)
 * not marked reverse charge, whose PAN is not a company's (4th letter `C`; unknown → hinted).
 */
export function rcmHint(bill: { lines?: readonly { hsn?: string }[]; reverse_charge?: boolean }, vendor: { gstin?: string; pan?: string } | undefined, registered: boolean, rule: { sac: string } | null): boolean {
  const pan = (vendor?.pan || vendor?.gstin?.slice(2, 12) || '').toUpperCase();
  return !!rule && registered && !bill.reverse_charge && pan[3] !== 'C' && (bill.lines ?? []).some((l) => String(l.hsn ?? '').startsWith(rule.sac));
}
