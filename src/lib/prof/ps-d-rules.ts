/**
 * Round 14 PS-D statutory values (partners' remuneration and interest, 44ADA / Sec 58, UDIN format) — the `// PS-D`
 * section of the round's rule data (PRD §6 `prof-rules.ts`), in its own chunk until PS-A's scaffold lands. Same
 * `Versioned` / `ruleAt` shape as `tax-rules.ts`, plus `verified`: append a new dated row, never edit an old one.
 * Imported only by lazy PS-D engines and screens (never by the shell, `tax-rules.ts` or `shop-mode.ts`). TDS sections,
 * rates and thresholds stay in `tds-rules.ts` (the `194T` rows) and 2025-Act labels in `ita2025.ts`.
 * Working-paper values — verify with your CA (docs/CA_REVIEW.md §14: PS19–PS24, PS29, PS70+).
 */
import type { Versioned } from '../tax-rules';

export interface PsRule<T> extends Versioned<T> {
  /** False until the value is confirmed (the screen then says "verify with your CA"). */
  verified: boolean;
}

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
