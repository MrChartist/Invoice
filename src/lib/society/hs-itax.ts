/**
 * R18-D4 income-tax working paper (pure; family `f-society`): a FY's mutual receipts (member heads and interest billed
 * to members — not income under mutuality, HS20) against non-mutual income (non-member heads from the bills; bank
 * interest and dividends from the ledger, passed in), and the deduction lines labelled by the FY's date (Sec 80P up to
 * FY 2025-26, Sec 149 of the 2025 Act from 1 Apr 2026, `verified: false`) — only for a co-operative society. Nothing is
 * computed as tax and nothing posts. Working papers — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { INCOME_TAX_SOCIETY_RULES } from '../society-rules';
import type { InvoiceRecord } from '../../types/invoice';

/** Member (mutual) and non-member amounts of the live society bills dated `from`–`to` (pass-through dues out). */
export function mutualSplit(invoices: readonly InvoiceRecord[], from: string, to: string): { mutual: number; outsider: number } {
  let mutual = 0, outsider = 0;
  for (const i of invoices) {
    if (!i.hs?.unit || i.status === 'Cancelled' || i.status === 'Draft' || i.doc_type === 'CREDIT_NOTE' || i.issue_date < from || i.issue_date > to) continue;
    for (const h of i.hs.heads ?? []) if (h.kind === 'outsider') outsider += h.amount; else if (h.kind !== 'statutory') mutual += h.amount;
  }
  return { mutual: round2(mutual), outsider: round2(outsider) };
}

/** The deduction lines of the FY starting `fyStart` (a co-operative society only). */
export const itaxLines = (fyStart: number, cooperative: boolean) => (cooperative ? ruleAt(INCOME_TAX_SOCIETY_RULES, `${fyStart}-04-01`) : null);
