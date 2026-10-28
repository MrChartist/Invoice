/**
 * Housing-society statutory and State values (Round 18), keyed by the date they take effect — the `Versioned` /
 * `ruleAt` shape of `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy Round 18 modules
 * (`src/lib/society/*`) — never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell (`tests/hs-rules.test.ts`
 * checks the import graph). Values that already live elsewhere stay there and are read through bridges: TDS sections and
 * rates (`tds-rules.ts`), Act labels (`ita2025.ts`), GST slabs (`tax-rules.ts`), the security RCM row
 * (`manpower-rules.ts`).
 *
 * **State co-operative / apartment rules are data rows keyed by State code and date, never code branches**
 * (`STATE_SOCIETY_RULES`, read with `stateRuleAt`). A row is `verified: true` only when its value was read in a primary
 * text in Round 18 (PRD §2.4; the source then says "Read (R18)"). A draft, a bill not yet in force or a recommendation
 * is never a rule row with legal effect: a bill's rows carry `in_force: false` and apply only after the user confirms.
 * Sources are short citations; the full source list is PRD §2.8 and docs/CA_REVIEW.md §18. One section per package.
 */
import type { Versioned } from './tax-rules';
import type { HsBasis, HsHeadKind } from '../types/society-r18';

/** A dated society rule row: `source` plus whether the value was read in a primary text this round. */
export type HsRule<T> = Versioned<T> & { verified: boolean };

/* ── R18-A: GST rate and SAC of member heads (HS9, HS10), State rule sets (HS19, HS26–HS36, HS44) ─────────────── */

/** Heading 9995 "Services of membership organisations": the GST rate of taxable member heads (HS10). */
export const SOCIETY_GST_RATE_RULES: readonly HsRule<number>[] = [
  { from: '2017-07-01', value: 18, source: 'N 11/2017-CT(R) Sl. 33. Read (R18) (HS10)', verified: true },
  { from: '2025-09-22', value: 18, source: 'N 16/2025-CT(R): no change reported (S, HS10)', verified: false },
];

/** Default SACs: member heads (home owners' associations, 999598) and non-member income (997212, HS9). */
export interface SocietySac { member: string; outsider: string }

export const SOCIETY_SAC_RULES: readonly HsRule<SocietySac>[] = [
  { from: '2017-07-01', value: { member: '999598', outsider: '997212' }, source: 'N 11/2017-CT(R) annexure. Read (R18) (HS10)', verified: true },
];

/** One State's money rules for societies (`null` = not prescribed / not read — the user types it). */
export interface StateSocietyRule {
  /** Interest on delayed payment: the cap in % a year, simple (HS26). */
  interest_cap_pct: number | null;
  /** Non-occupancy charges: the cap in % of service charges (HS19). */
  noc_pct: number | null;
  /** Minimum sinking / repair fund in % a year of the construction cost (HS27). */
  fund_min: { sinking: number; repair: number } | null;
  /** Education contribution, ₹ per member per month (HS29). */
  education_per_month: number | null;
  /** The basis each head kind takes by default ("Apply State defaults", HS28). */
  default_bases: Partial<Record<HsHeadKind, HsBasis>>;
  /** Months after the FY end the audited accounts are due (TN 3, KA 6; `null` = typed, HS31). */
  audit_due_months: number | null;
  /** Register prints (D3): `form_j` = MH Form J / I register; `members` = a register of members. */
  registers: 'form_j' | 'members';
}

/** A State row: the State's two-digit GST code, the date it takes effect, and whether it is in force (a bill is not). */
export type StateSocietyRow = HsRule<StateSocietyRule> & { state: string; in_force?: boolean };

const none: StateSocietyRule = { interest_cap_pct: null, noc_pct: null, fund_min: null, education_per_month: null, default_bases: {}, audit_due_months: null, registers: 'members' };
const area = (b: HsBasis): StateSocietyRule['default_bases'] => ({ service: b, sinking: b, repair: b, insurance: b });

/** Rows by State, in date order within a State (PRD §2.4 rows 23–40). Other States: none — the user types (HS36). */
export const STATE_SOCIETY_RULES: readonly StateSocietyRow[] = [
  // Maharashtra (27): model bye-law 72, then the MCS (Amendment) Rules 2026 housing chapter (Rules 106C-1 … 106C-14).
  { state: '27', from: '2014-01-01', value: { ...none, interest_cap_pct: 21, default_bases: { service: 'per_unit' }, registers: 'form_j' }, source: 'MH model bye-law 72 (S, HS26)', verified: false },
  { state: '27', from: '2026-06-22', value: { ...none, interest_cap_pct: 12, noc_pct: 10, fund_min: { sinking: 0.25, repair: 0.75 }, education_per_month: 10, default_bases: { service: 'per_unit', sinking: 'cost_pct_pa', repair: 'cost_pct_pa', major_repair: 'cost_pct_pa', statutory: 'typed', parking: 'per_slot', non_occupancy: 'pct_of_head', education: 'fixed_member', insurance: 'area_carpet', lease_rent: 'area_carpet' }, registers: 'form_j' }, source: 'MCS (Amendment) Rules 2026 (S, HS26)', verified: false },
  // Karnataka (29): the Apartment (Ownership and Management) Bill 2026 — commencement by notification, not confirmed.
  { state: '29', from: '2026-01-01', in_force: false, value: { ...none, default_bases: area('area_super'), audit_due_months: 6 }, source: 'KA LA Bill 14 of 2026. Read (R18); not in force (HS33)', verified: true },
  // Tamil Nadu (33): the Apartment Ownership Act 2022 (commencement 6 Mar 2024 as reported).
  { state: '33', from: '2024-03-06', value: { ...none, default_bases: { ...area('undivided_pct'), statutory: 'typed' }, audit_due_months: 3 }, source: 'TN Act 44 of 2022. Read (R18) (HS34)', verified: true },
  // Delhi (07): DCS Act 2003 / Rules 2007 — interest rates reported only on a forum and a blog: none held.
  { state: '07', from: '2007-01-01', value: none, source: 'DCS Rules 2007 (S, HS35)', verified: false },
];

/** A State's rule on a date: the latest row from on or before it; a row not in force applies only when `confirmed`. */
export function stateRuleAt(state: string | undefined, date: string, confirmed: readonly string[] = []): StateSocietyRow | null {
  let hit: StateSocietyRow | null = null;
  for (const r of STATE_SOCIETY_RULES) if (r.state === state && r.from <= date && (r.in_force !== false || confirmed.includes(r.state))) hit = r;
  return hit;
}

/** A State row waiting for the user's confirmation (the KA Bill): "proposed — confirm it is in force". */
export const pendingStateRule = (state: string | undefined, date: string, confirmed: readonly string[] = []): StateSocietyRow | undefined =>
  STATE_SOCIETY_RULES.find((r) => r.state === state && r.in_force === false && r.from <= date && !confirmed.includes(r.state));

/* ── R18-B: RWA_LIMIT_RULES, RWA_VALUATION_RULES, REG_THRESHOLD_RULES (B2, B3) ─────────────────────────────── */

/* ── R18-D: INCOME_TAX_SOCIETY_RULES (D4) ───────────────────────────────────────────────────────────────────── */
