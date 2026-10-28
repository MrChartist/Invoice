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
 * One section per package. Working papers — verify with your CA (docs/CA_REVIEW.md §18).
 */
import type { Versioned } from './tax-rules';
import type { HsBasis, HsHeadKind } from '../types/society-r18';

/** A dated society rule row: `source` plus whether the value was read in a primary text this round. */
export type HsRule<T> = Versioned<T> & { verified: boolean };

/* ── R18-A: GST rate and SAC of member heads (HS9, HS10), State rule sets (HS19, HS26–HS36, HS44) ─────────────── */

/** Heading 9995 "Services of membership organisations": the GST rate of taxable member heads (HS10). */
export const SOCIETY_GST_RATE_RULES: readonly HsRule<number>[] = [
  { from: '2017-07-01', value: 18, source: 'N 11/2017-CT(R) Sl. 33, Heading 9995 (9 % CGST + 9 % SGST). Read (R18): 2017 text, gstcouncil.gov.in (HS10)', verified: true },
  { from: '2025-09-22', value: 18, source: 'GST 2.0 services amendments (N 16/2025-CT(R)): no change to Heading 9995 reported (secondary summaries; HS10)', verified: false },
];

/** Default SACs: member heads (home owners' associations) and non-member income (renting of non-residential property). */
export interface SocietySac { member: string; outsider: string }

export const SOCIETY_SAC_RULES: readonly HsRule<SocietySac>[] = [
  { from: '2017-07-01', value: { member: '999598', outsider: '997212' }, source: 'Scheme of classification of services, Annexure to N 11/2017-CT(R): 999598 "Home owners associations"; 997212 renting of non-residential property (HS9 — the user may change it). Read (R18): annexure PDF, gstcouncil.gov.in (HS10)', verified: true },
];

/** One State's money rules for societies (all optional: `null` = not prescribed / not read — the user types it). */
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

const MH_BASES: StateSocietyRule['default_bases'] = { service: 'per_unit', sinking: 'cost_pct_pa', repair: 'cost_pct_pa', major_repair: 'cost_pct_pa', statutory: 'typed', service_supply: 'per_inlet', parking: 'per_slot', non_occupancy: 'pct_of_head', education: 'fixed_member', election: 'per_unit', insurance: 'area_carpet', lease_rent: 'area_carpet' };

/** Rows by State, in date order within a State (PRD §2.4 rows 23–40). Other States: none — the user types (HS36). */
export const STATE_SOCIETY_RULES: readonly StateSocietyRow[] = [
  // Maharashtra (27): model bye-law 72, then the MCS (Amendment) Rules 2026 housing chapter (Rules 106C-1 … 106C-14).
  { state: '27', from: '2014-01-01', value: { interest_cap_pct: 21, noc_pct: null, fund_min: null, education_per_month: null, default_bases: { service: 'per_unit' }, audit_due_months: null, registers: 'form_j' }, source: 'MH model bye-law 72: interest up to 21 % p.a. simple (indiancooperative, moneylife — secondary; HS26)', verified: false },
  { state: '27', from: '2026-06-22', value: { interest_cap_pct: 12, noc_pct: 10, fund_min: { sinking: 0.25, repair: 0.75 }, education_per_month: 10, default_bases: MH_BASES, audit_due_months: null, registers: 'form_j' }, source: 'MCS (Amendment) Rules 2026, Rules 106C-7 / 106C-12 (notified 18 Jun, gazetted 22 Jun 2026): interest 12 % simple, non-occupancy 10 % of service charges, sinking ≥ 0.25 % and repair ≥ 0.75 % a year of construction cost, education ₹10 (taxguru, trilegal, KSandK, FPJ — secondary; HS19, HS26–HS29)', verified: false },
  // Karnataka (29): the Apartment (Ownership and Management) Bill 2026 — commencement by notification, not confirmed.
  { state: '29', from: '2026-01-01', in_force: false, value: { interest_cap_pct: null, noc_pct: null, fund_min: null, education_per_month: null, default_bases: { service: 'area_super', sinking: 'area_super', repair: 'area_super', insurance: 'area_super', service_supply: 'area_super' }, audit_due_months: 6, registers: 'members' }, source: 'Karnataka Apartment (Ownership and Management) Bill 2026, LA Bill 14 of 2026, s.2(t), s.9, s.20, s.28. Read (R18): PRS PDF. Commencement by notification — not confirmed; the date is a placeholder until confirmed (HS33)', verified: true },
  // Tamil Nadu (33): the Apartment Ownership Act 2022 (commencement 6 Mar 2024 as reported).
  { state: '33', from: '2024-03-06', value: { interest_cap_pct: null, noc_pct: null, fund_min: null, education_per_month: null, default_bases: { service: 'undivided_pct', sinking: 'undivided_pct', repair: 'undivided_pct', insurance: 'undivided_pct', statutory: 'typed' }, audit_due_months: 3, registers: 'members' }, source: 'TN Apartment Ownership Act 2022 (Act 44 of 2022) s.18, s.20, s.21. Read (R18): PRS PDF; commencement date as reported (JSA — secondary; HS34, HS44)', verified: true },
  // Delhi (07): DCS Act 2003 / Rules 2007 — interest rates reported only on a forum and a blog (9 % / 15 %): not used.
  { state: '07', from: '2007-01-01', value: { interest_cap_pct: null, noc_pct: null, fund_min: null, education_per_month: null, default_bases: {}, audit_due_months: null, registers: 'members' }, source: 'Delhi Co-operative Societies Act 2003 / Rules 2007 (secondary only; no money rules held — HS35)', verified: false },
];

/** A State's rule on a date: the latest row from on or before it; a row not in force applies only when `confirmed`. */
export function stateRuleAt(state: string | undefined, date: string, confirmed: readonly string[] = [], rows: readonly StateSocietyRow[] = STATE_SOCIETY_RULES): StateSocietyRow | null {
  let hit: StateSocietyRow | null = null;
  for (const r of rows) if (r.state === state && r.from <= date.slice(0, 10) && (r.in_force !== false || confirmed.includes(r.state))) hit = r;
  return hit;
}

/** A State row that exists but waits for the user's confirmation (the KA Bill): "proposed — confirm it is in force". */
export const pendingStateRule = (state: string | undefined, date: string, confirmed: readonly string[] = []): StateSocietyRow | null =>
  STATE_SOCIETY_RULES.find((r) => r.state === state && r.in_force === false && r.from <= date.slice(0, 10) && !confirmed.includes(r.state)) ?? null;

/* ── R18-B: RWA_LIMIT_RULES, RWA_VALUATION_RULES, REG_THRESHOLD_RULES (B2, B3) ─────────────────────────────── */

/* ── R18-D: INCOME_TAX_SOCIETY_RULES (D4) ───────────────────────────────────────────────────────────────────── */
