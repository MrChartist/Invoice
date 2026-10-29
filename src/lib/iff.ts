/**
 * IFF — Invoice Furnishing Facility for QRMP filers (7O, 7.98): in months 1 and 2 of a quarter a QRMP taxpayer
 * may upload B2B invoices and credit / debit notes to registered persons (and their amendments) so the buyers
 * get the credit in their GSTR-2B. This builds that working paper from the month's GSTR-1 build:
 *
 *  - JSON: the GSTR-1 sections `b2b`, `cdnr`, `b2ba`, `cdnra` only (same layout as `buildGstr1Json`; NOT verified
 *    against the current offline tool — import there and let it validate);
 *  - checks: the month must be month 1 or 2 of the FY quarter (`NOT_IFF_MONTH`), and the taxable value of the
 *    month's B2B invoices + notes must stay within `IFF_MONTHLY_LIMIT` (`OVER_LIMIT`).
 *
 * Pure. Working paper — verify with your CA. The ₹50 lakh limit (Notification 82/2020-CT, Rule 59(2) as
 * understood) is UNVERIFIED and date-keyed below; append new versions, never edit an old one.
 */

import { buildGstr1Json } from './gstr-json';
import type { Gstr1Report, ReportPeriod } from './gst-reports';
import { round2 } from './invoice-calc';
import { ruleAt, type Versioned } from './tax-rules';

export const IFF_LIMIT_RULES: readonly Versioned<number | null>[] = [
  { from: '2017-07-01', value: null, source: 'No IFF before the QRMP scheme' },
  { from: '2021-01-01', value: 5_000_000, source: 'Rule 59(2) / Notification 82/2020-CT (₹50 lakh a month): verify' },
];

export function iffMonthlyLimit(periodStart?: string): number | null {
  return ruleAt(IFF_LIMIT_RULES, periodStart);
}

export const IFF_DISCLAIMER = 'IFF working paper (QRMP months 1–2): B2B invoices and notes to registered buyers only. JSON layout not validated against the GST offline tool: import it there and verify with your CA.';

export interface IffCheck {
  /** B2B + CDNR taxable value of the month (notes: credit −, debit +). */
  value: number;
  limit: number | null;
  invoices: number;
  notes: number;
  /** NOT_A_MONTH, NOT_IFF_MONTH (month 3 of the quarter: file GSTR-1), OVER_LIMIT, NO_SCHEME (before QRMP), EMPTY. */
  warnings: string[];
}

/** Month 1 or 2 of an Indian-FY quarter (Apr / May, Jul / Aug, Oct / Nov, Jan / Feb). */
export function isIffMonth(period: ReportPeriod): boolean {
  return period.kind === 'month' && ((period.month ?? 4) - 4 + 12) % 3 !== 2;
}

export function iffCheck(g1: Pick<Gstr1Report, 'b2b' | 'cdnr'>, period: ReportPeriod, periodStart: string): IffCheck {
  const warnings: string[] = [];
  if (period.kind !== 'month') warnings.push('NOT_A_MONTH');
  else if (!isIffMonth(period)) warnings.push('NOT_IFF_MONTH');
  const limit = iffMonthlyLimit(periodStart);
  if (limit === null) warnings.push('NO_SCHEME');
  let value = 0;
  for (const d of g1.b2b) value += d.taxable;
  for (const n of g1.cdnr) value += (n.noteType === 'C' ? -1 : 1) * n.taxable;
  value = round2(value);
  if (limit !== null && value > limit) warnings.push('OVER_LIMIT');
  if (!g1.b2b.length && !g1.cdnr.length) warnings.push('EMPTY');
  return { value, limit, invoices: g1.b2b.length, notes: g1.cdnr.length, warnings };
}

/** IFF JSON: the GSTR-1 build's B2B / CDNR (and their amendment) sections, no turnover fields. */
export function buildIffJson(g1: Gstr1Report): Record<string, unknown> {
  const full = buildGstr1Json(g1);
  const out: Record<string, unknown> = { gstin: full.gstin, fp: full.fp, version: full.version, hash: full.hash };
  for (const k of ['b2b', 'cdnr', 'b2ba', 'cdnra']) if (full[k] !== undefined) out[k] = full[k];
  return out;
}
