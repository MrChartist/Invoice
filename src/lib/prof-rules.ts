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

/* ── PS-D: partners' remuneration and interest (Sec 40(b) / Sec 35), 44ADA / Sec 58, UDIN format ─────────────────────── */

/** The value and its row on `date` (the row carries `verified` / `source`). */
export function psRuleAt<T>(rows: readonly PsRule<T>[], date?: string): PsRule<T> {
  const d = (date || '').slice(0, 10);
  let hit = rows[0];
  for (const r of rows) if (!d || r.from <= d) hit = r;
  return d ? hit : rows[rows.length - 1];
}

/**
 * Sec 40(b)(v) / 2025 Act Sec 35 (as reported): allowable remuneration to working partners, keyed by the FY START —
 * on a book loss or the first `slab` of book profit the higher of `floor` or `firstPct` %; `restPct` % of the rest.
 */
export interface RemunerationLimit { floor: number; slab: number; firstPct: number; restPct: number }

export const PARTNER_REMUNERATION_RULES: readonly PsRule<RemunerationLimit>[] = [
  { from: '2009-04-01', value: { floor: 150000, slab: 300000, firstPct: 90, restPct: 60 }, source: 'Sec 40(b)(v) as amended by Finance (No. 2) Act 2009 (AY 2010-11)', verified: true },
  { from: '2024-04-01', value: { floor: 300000, slab: 600000, firstPct: 90, restPct: 60 }, source: 'Finance (No. 2) Act 2024 (AY 2025-26) — taxadda, taxmann', verified: true },
  { from: '2026-04-01', value: { floor: 300000, slab: 600000, firstPct: 90, restPct: 60 }, source: 'Income-tax Act 2025 Sec 35(e) as reported (PS20) — verify', verified: false },
];

/** Interest on partners' capital allowed under Sec 40(b)(iv), % a year simple. */
export const PARTNER_INTEREST_CAP_RULES: readonly PsRule<number>[] = [
  { from: '1997-04-01', value: 12, source: 'Sec 40(b)(iv) (12 % from AY 1997-98)', verified: true },
  { from: '2026-04-01', value: 12, source: 'Income-tax Act 2025 Sec 35 as reported (PS20) — verify', verified: false },
];

/**
 * 44ADA / 2025 Act Sec 58 (table, Sl. 3 as reported): gross-receipts limit (₹), the raised limit when cash receipts are
 * ≤ `cashPct` % of the total (null = no raised limit), deemed income %. Keyed by the FY start.
 */
export interface PresumptiveLimit { limit: number; raisedLimit: number | null; cashPct: number | null; deemedPct: number; section: string }

export const PRESUMPTIVE_PROF_RULES: readonly PsRule<PresumptiveLimit>[] = [
  { from: '2016-04-01', value: { limit: 5000000, raisedLimit: null, cashPct: null, deemedPct: 50, section: '44ADA' }, source: 'Finance Act 2016 (Sec 44ADA)', verified: true },
  { from: '2023-04-01', value: { limit: 5000000, raisedLimit: 7500000, cashPct: 5, deemedPct: 50, section: '44ADA' }, source: 'Finance Act 2023 (₹75 lakh when cash ≤ 5 %) — taxguru, cleartax', verified: true },
  { from: '2026-04-01', value: { limit: 5000000, raisedLimit: 7500000, cashPct: 5, deemedPct: 50, section: 'Sec 58' }, source: 'Income-tax Act 2025 Sec 58(2) Table Sl. 3 as reported (PS22) — verify', verified: false },
];

/** Advance tax for presumptive professionals: one instalment by `due` (MM-DD of the March in the FY). */
export const PRESUMPTIVE_ADVANCE_TAX_RULES: readonly PsRule<{ due: string; instalments: number }>[] = [
  { from: '2016-04-01', value: { due: '03-15', instalments: 1 }, source: 'Sec 211(1)(b) as recalled (PS22 d)', verified: false },
];

/**
 * UDIN: 18 characters — 2-digit year of generation, 6-digit membership no. (zero-padded), 10 letters / digits (ICAI
 * FAQs as read; ICSI / ICMAI patterns not confirmed — PS29).
 */
export const UDIN_FORMAT_RULES: readonly PsRule<{ length: number; yearDigits: number; memberDigits: number }>[] = [
  { from: '2019-02-01', value: { length: 18, yearDigits: 2, memberDigits: 6 }, source: 'ICAI UDIN FAQs (Jul 2024) — verify (PS29)', verified: false },
];

