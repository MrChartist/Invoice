/**
 * R5-C4 Sec 11 application tracker (informational — an ESTIMATE, verify with your CA, §7 Q10): for a FY, total income
 * (income ledgers; corpus donations credit a fund ledger and stay out), amount applied (expenses other than
 * depreciation, plus capital expenditure on fixed assets) and amounts the user marks as accumulated (Form 10 working
 * note), against the date-keyed share (85% believed).
 */
import type { Ledger } from '../ledger/postings';
import { groupOf } from '../ledger/accounts';
import { round2 } from '../invoice-calc';
import { NPO_APPLICATION_RULES, fyFrom, ruleAt } from '../r5c-rules';

export interface Application {
  income: number;
  applied: number;
  accumulated: number;
  pct: number;
  threshold: number;
  /** Still to apply or accumulate to reach the threshold (0 when met). */
  shortfall: number;
}

export function applicationFor(ledger: Ledger, fy: number, accumulated = 0): Application {
  const start = fyFrom(fy);
  const end = `${fy + 1}-03-31`;
  let income = 0;
  let applied = 0;
  for (const v of ledger.vouchers) {
    if (v.date < start || v.date > end) continue;
    for (const l of v.lines) {
      const a = ledger.byId.get(l.account);
      if (!a) continue;
      const nature = groupOf(a.group).nature;
      if (nature === 'income') income += l.cr - l.dr;
      else if (nature === 'expense' && a.group !== 'DEPRECIATION') applied += l.dr - l.cr;
      else if (a.group === 'FIXED_ASSETS') applied += l.dr; // additions only (depreciation is not application)
    }
  }
  const threshold = ruleAt(NPO_APPLICATION_RULES, end).pct;
  const inc = round2(income / 100);
  const app = round2(applied / 100);
  const acc = round2(Math.max(accumulated, 0));
  return { income: inc, applied: app, accumulated: acc, pct: inc > 0 ? Math.round(((app + acc) / inc) * 1000) / 10 : 0, threshold, shortfall: Math.max(0, round2((inc * threshold) / 100 - app - acc)) };
}
