/**
 * R18-D1 funds (pure; family `f-society`): the sinking, repair and major-repair contributions BILLED in a period (live
 * society bills by bill date — bills, not receipts, HS39) move out of income into each fund's reserve by one journal
 * (Dr the sales ledger tagged with the fund / Cr the fund's reserve ledger, tagged too, so the R5-C4 fund statement
 * still shows the contribution as the fund's receipt). Idempotent per fund and period: the journal posts only the
 * difference between what is billed and what the earlier journals of that period moved (a cancelled bill is reversed by
 * a new journal). Minimum check: a FY's sinking / repair billed against the State's % of the construction cost (hint,
 * HS27). Working papers — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import type { InvoiceRecord } from '../../types/invoice';
import type { HsHeadKind, SocietyUnit } from '../../types/society-r18';

export type FundKey = 'sinking' | 'repair' | 'major_repair';
export const FUND_KEYS: readonly FundKey[] = ['sinking', 'repair', 'major_repair'];
export const FUND_NAMES: Readonly<Record<FundKey, string>> = { sinking: 'Sinking fund', repair: 'Repair and maintenance fund', major_repair: 'Major repair fund' };
export const FUND_CLASS = 'Society fund transfer';

export const fundOf = (kind: HsHeadKind): FundKey | undefined => (FUND_KEYS as readonly string[]).includes(kind) ? (kind as FundKey) : undefined;

/** Fund contributions of live society bills dated `from`–`to` (head amounts, by fund). */
export function fundBilled(invoices: readonly InvoiceRecord[], from: string, to: string): Record<FundKey, number> {
  const out: Record<FundKey, number> = { sinking: 0, repair: 0, major_repair: 0 };
  for (const i of invoices) {
    if (!i.hs?.unit || i.status === 'Cancelled' || i.status === 'Draft' || i.doc_type === 'CREDIT_NOTE' || i.issue_date < from || i.issue_date > to) continue;
    for (const h of i.hs.heads ?? []) { const f = fundOf(h.kind); if (f) out[f] = round2(out[f] + h.amount); }
  }
  return out;
}

/** A transfer journal's moves (rupees, + = into the fund): billed less already transferred, per fund. */
export const transferDelta = (billed: Record<FundKey, number>, done: Partial<Record<FundKey, number>>): Record<FundKey, number> =>
  Object.fromEntries(FUND_KEYS.map((k) => [k, round2(billed[k] - (done[k] ?? 0))])) as Record<FundKey, number>;

/** FY minimum (HS27): sinking / repair billed vs `pct` % a year of the units' construction cost. Rows below the minimum. */
export function fundMinimum(billed: Record<FundKey, number>, units: readonly Pick<SocietyUnit, 'construction_cost' | 'status'>[], min: { sinking: number; repair: number } | null, months = 12): { fund: FundKey; billed: number; min: number }[] {
  if (!min) return [];
  const cost = units.filter((u) => u.status === 'active').reduce((t, u) => t + (u.construction_cost ?? 0), 0);
  return (['sinking', 'repair'] as const).map((f) => ({ fund: f, billed: billed[f], min: round2((cost * min[f] * months) / 1200) })).filter((r) => r.billed + 0.004 < r.min);
}
