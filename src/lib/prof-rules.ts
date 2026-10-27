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

/* ── PS-B: LEGAL_SERVICES_RULES, DISB_DEFAULTS, DESIGN_STAGE_EXAMPLE (fill here) ──────────────────────────────── */

/* ── PS-C: INTERMEDIARY_POS_RULES, EDF_RULES, REGISTRATION_THRESHOLD_RULES, PURPOSE_CODE_EXAMPLES (fill here) ─── */

/* ── PS-D: PARTNER_REMUNERATION_RULES, PARTNER_INTEREST_CAP_RULES, PRESUMPTIVE_PROF_RULES,
       PRESUMPTIVE_ADVANCE_TAX_RULES, UDIN_FORMAT_RULES (fill here) ─────────────────────────────────────────────── */
