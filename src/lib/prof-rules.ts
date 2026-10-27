/**
 * Professional-firm statutory values and practice defaults (Round 14), keyed by the date they take effect — the same
 * `Versioned` / `ruleAt` shape as `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy
 * Round 14 screens and engines (`src/lib/prof/*`) — never by `tax-rules.ts`, `shop-mode.ts` or the shell
 * (`tests/ps-rules.test.ts` checks the import graph). Values that already live elsewhere stay there: TDS sections, rates
 * and thresholds (`tds-rules.ts`, PS-D appends 194T), 2025-Act labels (`ita2025.ts`), export realisation
 * (`trade/trade-rules.ts`, PS-C appends the FEMA 2026 rows).
 *
 * One section per package (§6 of docs/prd/round-14.md). Every row carries a `source` and `verified`. Working papers —
 * verify with your CA (docs/CA_REVIEW.md §14).
 */
import type { Versioned } from './tax-rules';
import type { ProfKind } from '../types/prof-r14';

/** A dated professional-firm rule row: `source` plus whether the value was confirmed from an official text. */
export type PsRule<T> = Versioned<T> & { verified: boolean };

/* ── PS-A: practice defaults (WIP, write-downs) and the professional-conduct prompts ──────────────────────────── */

export interface WipDefaults {
  /** Ageing bucket upper bounds in days (the last bucket is "older"). */
  buckets: readonly number[];
  /** Write-up / write-down reasons offered until the firm sets its own. */
  reasons: readonly string[];
  /** Year-end paper: months of history behind the expected write-down. */
  history_months: number;
}

export const WIP_DEFAULTS: readonly PsRule<WipDefaults>[] = [
  { from: '2017-07-01', value: { buckets: [30, 60, 90], reasons: ['Cap', 'Fixed fee', 'Courtesy', 'Inefficiency', 'Junior time', 'Rate override'], history_months: 12 }, source: 'Practice (PS-A3 / A4); editable in the WIP desk', verified: false },
];

/** Success / percentage-of-result fees: the profiles that see a warning with an owner override (PS26). */
export const SUCCESS_FEE_PROMPT_RULES: readonly PsRule<Partial<Record<ProfKind, string>>>[] = [
  {
    from: '1975-01-01',
    value: {
      legal: 'BCI Rules Part VI Ch. II Rule 20: an advocate shall not stipulate a fee contingent on the result of litigation (PS26).',
      ca: 'CA Act 1949 First Schedule Part I clause (10) / Regulation 192: no fee contingent on findings or results except as permitted (PS26).',
    },
    source: 'BCI Rules Rule 20; CA Act First Schedule clause (10), CA Regulations 1988 Reg. 192 (as reported)',
    verified: false,
  },
];

/* ── PS-B: disbursements, legal services, design stages, media ─────────────────────────────────────────────────── */

/* B1 disbursements ─────────────────────────────────────────── */

export type DisbKind = 'court_fee' | 'stamp' | 'govt_fee' | 'filing' | 'notary' | 'travel' | 'courier' | 'other';

/** Kinds paid on the client's behalf by default (pure agent, no GST, no ITC); the rest are part of the fee (PS3). */
export const DISB_DEFAULTS: readonly PsRule<{ on_behalf: readonly DisbKind[] }>[] = [
  { from: '2017-07-01', value: { on_behalf: ['court_fee', 'stamp', 'govt_fee', 'filing'] }, source: 'Rule 33 CGST Rules (pure agent) — practice default', verified: false },
];

/* B2 legal services ────────────────────────────────────────── */

export interface LegalServicesRule {
  /** SAC prefix of legal services (99821x; 99822x accounting, 99823x tax are not legal). */
  sac: string;
  rcm: string;
  exempt: string;
  /** Wording of the small-business limb of entry 45. */
  small: string;
}
export const LEGAL_SERVICES_RULES: readonly PsRule<LegalServicesRule>[] = [
  { from: '2017-07-01', value: { sac: '99821', rcm: 'N 13/2017-CT(R) entry 2', exempt: 'N 12/2017-CT(R) entry 45', small: 'turnover up to ₹20 lakh (₹10 lakh special-category States) in the preceding FY' }, source: 'N 13/2017-CT(R), N 12/2017-CT(R) (PS1)', verified: true },
  { from: '2019-10-01', value: { sac: '99821', rcm: 'N 13/2017-CT(R) entry 2', exempt: 'N 12/2017-CT(R) entry 45', small: 'aggregate turnover up to the registration threshold in the preceding FY' }, source: 'N 21/2019-CT(R) wording (PS1)', verified: false },
];

/* B4 design stages ─────────────────────────────────────────── */

/** An editable EXAMPLE — the Council of Architecture scale is recommendatory; agree the stages with the client (PS30). */
export const DESIGN_STAGE_EXAMPLE: readonly PsRule<readonly { id: string; label: string; cum_pct: number }[]>[] = [
  {
    from: '2017-07-01',
    value: [
      { id: 's1', label: 'Concept design', cum_pct: 10 },
      { id: 's2', label: 'Preliminary drawings and estimate', cum_pct: 30 },
      { id: 's3', label: 'Working drawings and tender', cum_pct: 50 },
      { id: 's4', label: 'Construction stage', cum_pct: 75 },
      { id: 's5', label: 'Completion', cum_pct: 100 },
    ],
    source: 'Example only — not a rule (PS30)',
    verified: false,
  },
];

/* B5 media ─────────────────────────────────────────────────── */

export interface MediaRule {
  /** TDS by the client on an advertising agency's bill. */
  client_tds: string;
  /** Equalisation levy on online advertising in force. */
  levy: boolean;
}
export const MEDIA_RULES: readonly PsRule<MediaRule>[] = [
  { from: '2016-06-01', value: { client_tds: '194C', levy: true }, source: 'Circular 715 (1995), Circular 5/2016; 6% levy from 1 Jun 2016 (PS18, PS38)', verified: false },
  { from: '2025-04-01', value: { client_tds: '194C', levy: false }, source: '6% equalisation levy abolished, Finance Act 2025 (PS38)', verified: true },
];

/* ── PS-C: INTERMEDIARY_POS_RULES, EDF_RULES, REGISTRATION_THRESHOLD_RULES, PURPOSE_CODE_EXAMPLES (fill here) ─── */

/* ── PS-D: PARTNER_REMUNERATION_RULES, PARTNER_INTEREST_CAP_RULES, PRESUMPTIVE_PROF_RULES,
       PRESUMPTIVE_ADVANCE_TAX_RULES, UDIN_FORMAT_RULES (fill here) ─────────────────────────────────────────────── */
