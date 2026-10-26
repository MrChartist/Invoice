/**
 * R5-B statutory values (GTA, GST TDS u/s 51, BOCW labour cess, works-contract GST) — date-keyed `Versioned` rows in
 * the same shape as `tax-rules.ts`. They live in their own file (like `gst-penalties.ts` / `payroll-rules.ts`) because
 * `tax-rules.ts` is in the first-paint bundle and only the lazy transport / works chunks read these.
 * Append new rows; never overwrite an old one. Every value is as understood — VERIFY WITH YOUR CA.
 */
import { ruleAt, type Versioned } from './tax-rules';
import type { GtaOption } from '../types/transport-works-r5';

export interface GtaRate {
  /** GST rate (%) on the freight. */
  rate: number;
  /** Input tax credit allowed to the GTA under this option. */
  itc: boolean;
  /** Tax paid by the recipient (reverse charge). */
  rcm: boolean;
}

/**
 * GTA rates by option (Notification 11/2017-CT(R) entry 9(iii) as amended; 03/2022-CT(R) from 18 Jul 2022; the
 * 22 Sep 2025 rate change moved the with-ITC option from 12% to 18%). `fcm_18` reads "12% with ITC" before that.
 * Verify the notification and dates with your CA (§7 Q1/Q2 of the Round 5 PRD).
 */
export const GTA_RATE_RULES: readonly Versioned<Record<GtaOption, GtaRate> & { sac: string }>[] = [
  { from: '2017-07-01', value: { rcm: { rate: 5, itc: false, rcm: true }, fcm_5: { rate: 5, itc: false, rcm: false }, fcm_18: { rate: 12, itc: true, rcm: false }, sac: '996791' }, source: 'N 11/2017-CT(R) entry 9(iii) / 13/2017-CT(R) entry 1; 03/2022-CT(R) — verify' },
  { from: '2025-09-22', value: { rcm: { rate: 5, itc: false, rcm: true }, fcm_5: { rate: 5, itc: false, rcm: false }, fcm_18: { rate: 18, itc: true, rcm: false }, sac: '996791' }, source: 'GST rate rationalisation from 22 Sep 2025 (N 15/2025-CT(R) as understood) — verify' },
];

export const gtaRate = (option: GtaOption, date?: string): GtaRate => ruleAt(GTA_RATE_RULES, date)[option];
export const gtaSac = (date?: string): string => ruleAt(GTA_RATE_RULES, date).sac;

/** Annexure V (forward charge) / VI (back to RCM) window for the NEXT financial year: month-day range inside the current one. */
export const GTA_OPTION_WINDOW_RULES: readonly Versioned<{ start: string; end: string }>[] = [
  { from: '2017-07-01', value: { start: '01-01', end: '03-31' }, source: 'Annexure V / VI by 31 Mar of the preceding FY (N 03/2022-CT(R) as understood) — verify' },
];

/** Is `day` inside the option window (filing for the next FY)? */
export function inGtaWindow(day: string): boolean {
  const w = ruleAt(GTA_OPTION_WINDOW_RULES, day);
  const md = day.slice(5, 10);
  return md >= w.start && md <= w.end;
}

/** Recipient kinds that pay GST on GTA freight under reverse charge (notified list) — verify the current list. */
export type GtaRecipientKind = 'factory' | 'society' | 'cooperative' | 'registered' | 'body_corporate' | 'partnership' | 'casual' | 'unregistered';

export const GTA_RCM_RECIPIENT_KINDS: readonly Versioned<readonly GtaRecipientKind[]>[] = [
  { from: '2017-07-01', value: ['factory', 'society', 'cooperative', 'registered', 'body_corporate', 'partnership', 'casual'], source: 'N 13/2017-CT(R) entry 1 — verify (composition-registered recipients: §7 Q2)' },
];

/** GST TDS u/s 51: rate on the value excluding GST, and the contract-value threshold. */
export const GST_TDS_51_RULES: readonly Versioned<{ rate: number; threshold: number } | null>[] = [
  { from: '2017-07-01', value: null },
  { from: '2018-10-01', value: { rate: 2, threshold: 250000 }, source: 'Sec 51 CGST Act; N 50/2018-CT (from 1 Oct 2018) — verify' },
];

/** BOCW labour cess (Building and Other Construction Workers Welfare Cess Act 1996): % of the cost of construction. */
export const LABOUR_CESS_RULES: readonly Versioned<number>[] = [
  { from: '2017-07-01', value: 1, source: 'BOCW Cess Act 1996, Sec 3 (1%), state-agnostic default — verify the state practice' },
];

/** Default GST rate for works-contract BOQ lines (general / government works). */
export const WORKS_CONTRACT_RATE_RULES: readonly Versioned<{ general: number; government: number }>[] = [
  { from: '2017-07-01', value: { general: 18, government: 12 }, source: 'N 11/2017-CT(R) entry 3(ii) / 3(iv) — verify' },
  { from: '2025-09-22', value: { general: 18, government: 18 }, source: 'Rate change from 22 Sep 2025 as understood — verify (§7 Q6)' },
];
