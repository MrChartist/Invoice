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
import { ruleAt, type Versioned } from './tax-rules';
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

/* ── PS-C: INTERMEDIARY_POS_RULES, EDF_RULES, REGISTRATION_THRESHOLD_RULES, PURPOSE_CODE_EXAMPLES ─────────────── */

/**
 * Place of supply of intermediary services (PS4). `supplier`: Sec 13(8)(b) IGST — location of the supplier, so never an
 * export. `recipient`: Sec 13(8)(b) omitted by Sec 157 of the Finance Act 2026 (assent 30 Mar 2026) — Sec 13(2), an
 * export when Sec 2(6) is met. Read by the export check and the R8 indent note (TR21), by invoice date.
 */
export const INTERMEDIARY_POS_RULES: readonly PsRule<'supplier' | 'recipient'>[] = [
  { from: '2017-07-01', value: 'supplier', source: 'Sec 13(8)(b) IGST Act', verified: true },
  { from: '2026-03-30', value: 'recipient', source: 'Sec 157 Finance Act 2026 (Sec 13(8)(b) omitted) — verify the date (PS4)', verified: false },
];
export const intermediaryPos = (date?: string) => ruleAt(INTERMEDIARY_POS_RULES, date);

/** EDF for services (PS16): `null` before the 2026 regulations (SOFTEX; rows are history only). */
export interface EdfRule {
  /** Days after the end of the invoice month. */
  days: number;
  /** Services other than software may file on or before the date of receipt (Reg 3(2)(b)). */
  byReceipt: boolean;
  /** Invoices up to this value (₹) may be closed on the exporter's declaration (Reg 4(2)). */
  smallValue: number;
}
export const EDF_RULES: readonly PsRule<EdfRule | null>[] = [
  { from: '2000-01-01', value: null, source: 'SOFTEX (FEMA 23(R)/2015-RB) — history only', verified: true },
  { from: '2026-10-01', value: { days: 30, byReceipt: true, smallValue: 1000000 }, source: 'FEMA 23(R)/2026-RB Reg 3(2), 4(2) — verify (PS16)', verified: false },
];
export const edfRule = (date?: string) => ruleAt(EDF_RULES, date);

/** Aggregate-turnover threshold for a services supplier (PS13); exports count. */
export interface ThresholdRule {
  limit: number;
  /** Lower limit and the States it applies to (two-digit GST codes). */
  special: number;
  specialStates: readonly string[];
  /** Warn at this % of the limit. */
  warnPct: number;
}
export const REGISTRATION_THRESHOLD_RULES: readonly PsRule<ThresholdRule>[] = [
  {
    from: '2017-07-01',
    value: { limit: 2000000, special: 1000000, specialStates: ['13', '14', '15', '16'], warnPct: 80 },
    source: 'Sec 22 CGST Act (₹20 lakh; ₹10 lakh in Nagaland, Manipur, Mizoram, Tripura); N 10/2017-IT — verify (PS13)',
    verified: false,
  },
];
export const thresholdRule = (date?: string) => ruleAt(REGISTRATION_THRESHOLD_RULES, date);

/** RBI purpose codes for services — an editable example list, not a rule (PS39). Default by `prof_kind`. */
export const PURPOSE_CODE_EXAMPLES: readonly PsRule<readonly (readonly [code: string, label: string])[]>[] = [
  {
    from: '2000-01-01',
    value: [
      ['P0802', 'Software consultancy / implementation'],
      ['P0803', 'Data processing'],
      ['P0807', 'Off-site software exports'],
      ['P1004', 'Legal services'],
      ['P1005', 'Accounting, auditing, book-keeping'],
      ['P1006', 'Business and management consultancy'],
      ['P1007', 'Advertising, trade fair'],
      ['P1009', 'Architectural services'],
      ['P1019', 'Engineering services'],
    ],
    source: 'RBI purpose codes for services — an example list, the bank decides (PS39)',
    verified: false,
  },
];
export const purposeCodes = (date?: string) => ruleAt(PURPOSE_CODE_EXAMPLES, date);
export const PURPOSE_BY_KIND: Readonly<Partial<Record<ProfKind, string>>> = {
  ca: 'P1005', legal: 'P1004', design: 'P1009', consulting: 'P1006', agency: 'P1007', freelancer: 'P0802', other: 'P1006',
};


/* ── PS-D: PARTNER_REMUNERATION_RULES, PARTNER_INTEREST_CAP_RULES, PRESUMPTIVE_PROF_RULES,
       PRESUMPTIVE_ADVANCE_TAX_RULES, UDIN_FORMAT_RULES (fill here) ─────────────────────────────────────────────── */
