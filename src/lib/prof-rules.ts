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

