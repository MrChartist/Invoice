/**
 * MF-C3-4: the job-charges class suggested on the Job Work In service invoice (we are the job worker). The class comes
 * from the HSN chapters of the principal's goods received against the order: chapters 50–63 → `jw_textile` (MF2),
 * chapters 48 / 49 → `jw_print_ch48_49` (MF3), anything else → `jw_other` (MF5). The rate is the dated
 * `TEXTILE_CLASS_RULES` row on the invoice date. A suggestion only: the typed rate always wins — verify with your CA.
 * Pure; loaded only by the lazy job-work tab.
 */
import { num } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { TEXTILE_CLASS_RULES } from '../mfg-rules';
import type { PrincipalMovement } from '../../types/job-work';

export const JW_CHARGE_CLASSES = ['jw_textile', 'jw_print_ch48_49', 'jw_other'] as const;
export type JwChargeClass = (typeof JW_CHARGE_CLASSES)[number];

const chapterOf = (hsn: string | undefined): number => {
  const d = String(hsn ?? '').replace(/\D/g, '');
  return d.length >= 2 ? Number(d.slice(0, 2)) : 0;
};

/** The class for a set of HSN codes: textile wins over print, print over the residual class. */
export function jobChargesClass(hsns: readonly (string | undefined)[]): JwChargeClass {
  const ch = hsns.map(chapterOf).filter((c) => c > 0);
  if (ch.some((c) => c >= 50 && c <= 63)) return 'jw_textile';
  if (ch.some((c) => c === 48 || c === 49)) return 'jw_print_ch48_49';
  return 'jw_other';
}

/** The class suggested for an order from its principal receipts (HSN of each received line). */
export function orderChargesClass(principal: readonly PrincipalMovement[], orderId: string): JwChargeClass {
  return jobChargesClass(principal.filter((r) => r.order_id === orderId && r.kind === 'receipt').flatMap((r) => r.lines.map((l) => l.hsn)));
}

/** The class rate on `date` and its CA reference. */
export function chargesClassRate(cls: JwChargeClass, date: string): { rate: number; ca: string } {
  const v = ruleAt(TEXTILE_CLASS_RULES[cls], date.slice(0, 10));
  return { rate: num(v.rate), ca: v.ca };
}
