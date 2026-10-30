/**
 * PS-D4 44ADA / Sec 58 presumptive working paper (pure). Gross receipts of the profession for the FY on the accrual
 * basis (issued fee notes' taxable value at INR, pure-agent recoveries out, credit notes in; the cash basis shown too),
 * the cash share (receipts by cash ÷ all receipts; rows that moved no money skipped with `movedNoCash`), the limit from
 * `PRESUMPTIVE_PROF_RULES` (₹50 lakh; ₹75 lakh when cash ≤ 5 %; Sec 58 from TY 2026-27), deemed income at 50 %, the
 * profit per the books and the difference; advance tax in one instalment (`PRESUMPTIVE_ADVANCE_TAX_RULES`). The user
 * ticks eligibility; the app never decides (PS22). Nothing is filed. Working paper — verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { EntityType } from '../../types/books-r2';
import { num, round2 } from '../invoice-calc';
import { movedNoCash } from '../advance-tax';
import { isRevenueDoc } from '../stats';
import { feeBase } from './ps-tds-recv';
import { fyBounds } from './ps-partner-run';
import { PRESUMPTIVE_ADVANCE_TAX_RULES, PRESUMPTIVE_PROF_RULES, psRuleAt } from '../prof-rules';

/** The professions of Sec 44AA(1) and those notified (the user ticks one; the list is not a decision). */
export const PRESUMPTIVE_PROFESSIONS = ['legal', 'medical', 'engineering', 'architecture', 'accountancy', 'technical_consultancy', 'interior_decoration', 'film_artist', 'company_secretary', 'information_technology', 'authorised_representative'] as const;

export interface PresumptiveInput {
  fy: number;
  invoices: readonly InvoiceRecord[];
  receipts: readonly Payment[];
  /** Net profit per the books for the FY (₹). */
  bookProfit?: number;
  firmForm?: EntityType;
}

export interface PresumptivePaper {
  fy: number;
  section: string;
  accrual: number;
  cashBasis: number;
  recoveriesOut: number;
  cashReceipts: number;
  cashPct: number;
  limit: number;
  raised: boolean;
  withinLimit: boolean;
  deemedPct: number;
  deemed: number;
  bookProfit?: number;
  difference?: number;
  advanceTaxDue: string;
  verified: boolean;
  notes: string[];
}

const inr = (i: Pick<InvoiceRecord, 'currency' | 'exchange_rate'>, v: number) => ((i.currency || 'INR').toUpperCase() === 'INR' ? v : v * (num(i.exchange_rate) || 1));

export function presumptive(input: PresumptiveInput): PresumptivePaper {
  const { start, end } = fyBounds(input.fy);
  const inFy = (d: unknown) => {
    const s = String(d ?? '').slice(0, 10);
    return s >= start && s <= end;
  };
  let accrual = 0;
  let recoveries = 0;
  for (const i of input.invoices) {
    if (!inFy(i.issue_date)) continue;
    const sign = isRevenueDoc(i) ? 1 : i.doc_type === 'CREDIT_NOTE' && i.status !== 'Draft' && i.status !== 'Cancelled' ? -1 : 0;
    if (!sign) continue;
    const fee = feeBase(i);
    accrual += sign * inr(i, fee);
    recoveries += sign * inr(i, num(i.taxable_value) - fee);
  }
  const byId = new Map(input.invoices.map((i) => [i.id, i]));
  let all = 0;
  let cash = 0;
  for (const p of input.receipts) {
    if (!inFy(p.date) || movedNoCash(p)) continue;
    const inv = byId.get(p.invoice_id);
    const amt = inv ? inr(inv, num(p.amount)) : num(p.amount);
    all += amt;
    if (String(p.method ?? '').trim().toLowerCase() === 'cash') cash += amt;
  }
  const rule = psRuleAt(PRESUMPTIVE_PROF_RULES, start);
  const r = rule.value;
  const cashPct = all > 0 ? round2((cash * 100) / all) : 0;
  const raised = r.raisedLimit !== null && r.cashPct !== null && cashPct <= r.cashPct;
  const limit = raised ? (r.raisedLimit as number) : r.limit;
  const gross = round2(accrual);
  const deemed = round2((gross * r.deemedPct) / 100);
  const adv = psRuleAt(PRESUMPTIVE_ADVANCE_TAX_RULES, start);
  const notes: string[] = [];
  if (input.firmForm === 'llp') notes.push('Not available to an LLP: verify with your CA.');
  if (input.firmForm === 'company') notes.push('Not available to a company: verify with your CA.');
  if (input.firmForm === 'partnership') notes.push('A firm on 44ADA / Sec 58 cannot deduct partners’ remuneration and interest: verify with your CA (PS22, PS24).');
  if (!rule.verified || !adv.verified) notes.push('Some values here are not yet confirmed: verify with your CA.');
  return {
    fy: input.fy, section: r.section, accrual: gross, cashBasis: round2(all), recoveriesOut: round2(recoveries), cashReceipts: round2(cash), cashPct,
    limit, raised, withinLimit: gross <= limit, deemedPct: r.deemedPct, deemed,
    ...(input.bookProfit !== undefined ? { bookProfit: round2(input.bookProfit), difference: round2(deemed - input.bookProfit) } : {}),
    advanceTaxDue: `${input.fy + 1}-${adv.value.due}`, verified: rule.verified && adv.verified, notes,
  };
}
