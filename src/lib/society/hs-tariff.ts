/**
 * R18-A3 tariff engine (pure; family `f-society`): charge heads × apportionment bases → a unit's charges for a billing
 * period, State defaults and the State hints. Amounts are a month's and a cycle multiplies them; each head is rounded to
 * the paisa. State values come only from `society-rules.ts` rows (data, never code branches); checks are hints citing
 * the CA id, never blocks. Working papers — verify with your CA (HS19, HS26–HS28, HS33, HS34).
 */
import { round2 } from '../invoice-calc';
import { pendingStateRule, SOCIETY_SAC_RULES, stateRuleAt, type StateSocietyRule } from '../society-rules';
import { ruleAt } from '../tax-rules';
import type { HsBasis, HsCycle, HsHead, HsHeadKind, HsHeadRow, SocietyUnit } from '../../types/society-r18';

export { pendingStateRule };

export const HEAD_KINDS: readonly HsHeadKind[] = ['service', 'sinking', 'repair', 'major_repair', 'statutory', 'service_supply', 'parking', 'non_occupancy', 'education', 'election', 'insurance', 'lease_rent', 'outsider', 'other'];
export const BASES: readonly HsBasis[] = ['per_unit', 'area_carpet', 'area_super', 'undivided_pct', 'cost_pct_pa', 'per_slot', 'pct_of_head', 'typed', 'fixed_member'];
export const CYCLES: readonly HsCycle[] = ['monthly', 'quarterly', 'half_yearly'];

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A billing period → its first / last day and months. `YYYY-MM`; `YYYY-Qn` / `YYYY-Hn` are Indian-FY quarters / halves
 * of the FY that starts in April of YYYY (`2026-Q1` = Apr–Jun 2026, `2026-H2` = Oct 2026 – Mar 2027). Null if malformed.
 */
export function periodRange(period: string): { from: string; to: string; months: number } | null {
  const m = /^(\d{4})-(?:(0[1-9]|1[0-2])|Q([1-4])|H([12]))$/.exec(period);
  if (!m) return null;
  const months = m[2] ? 1 : m[3] ? 3 : 6;
  const start = m[2] ? Number(m[2]) - 1 : 3 + (Number(m[3] ?? m[4]) - 1) * months; // months after January of the year
  const at = (i: number) => [Number(m[1]) + Math.floor(i / 12), (i % 12) + 1];
  const [sy, sm] = at(start), [ey, em] = at(start + months - 1);
  return { from: `${sy}-${pad(sm)}-01`, to: `${ey}-${pad(em)}-${pad(new Date(ey, em, 0).getDate())}`, months };
}

/** The period of a cycle that holds a day (`2026-11-05`: monthly `2026-11`, quarterly `2026-Q3`, half-yearly `2026-H2`). */
export function periodOf(day: string, cycle: HsCycle = 'monthly'): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const fy = m >= 4 ? y : y - 1, idx = (m + 8) % 12; // months since April
  return cycle === 'monthly' ? day.slice(0, 7) : cycle === 'quarterly' ? `${fy}-Q${Math.floor(idx / 3) + 1}` : `${fy}-H${idx < 6 ? 1 : 2}`;
}

/** Default SAC of a head kind on a date (member heads 999598, non-member income 997212, none for statutory dues). */
export function sacFor(kind: HsHeadKind, date: string): string | undefined {
  const s = ruleAt(SOCIETY_SAC_RULES, date);
  return kind === 'statutory' ? undefined : kind === 'outsider' ? s.outsider : s.member;
}

const num = (v: unknown) => (typeof v === 'number' && v > 0 && Number.isFinite(v) ? v : 0);
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * A unit's charges for a period (pure): per live head with a non-zero amount `{ head_id, name, kind, basis, amount }`
 * — the month's amount × the period's months, paise-rounded per head. Non-occupancy (`pct_of_head`) is charged only
 * on a let unit (`occupancy = 'tenant'`), as a % of the unit's `service` heads. `member: false` (a member's second unit,
 * decided by B) leaves out `fixed_member` heads.
 */
export function unitCharges(unit: SocietyUnit, heads: readonly HsHead[], period: string, opts: { member?: boolean; areaUnit?: 'sqft' | 'sqm' } = {}): HsHeadRow[] {
  const r = periodRange(period);
  if (!r) return [];
  const au = opts.areaUnit === 'sqm' ? 'sq m' : 'sq ft';
  const live = heads.filter((h) => h.active !== false && (!h.from || h.from <= r.to) && (!h.to || h.to >= r.from));
  const monthly = (h: HsHead): [number, string] => {
    const rate = num(h.rate);
    switch (h.basis) {
      case 'per_unit': return [rate, 'per unit'];
      case 'area_carpet': return [rate * num(unit.carpet_area), `${num(unit.carpet_area)} ${au} × ${money(rate)}`];
      case 'area_super': return [rate * num(unit.super_area), `${num(unit.super_area)} ${au} (super) × ${money(rate)}`];
      case 'undivided_pct': return [(rate * num(unit.undivided_pct)) / 100, `${num(unit.undivided_pct)} % of ${money(rate)}`];
      case 'cost_pct_pa': return [(num(unit.construction_cost) * rate) / 1200, `${rate} % a year of cost`];
      case 'per_slot': return [(unit.parking ?? []).reduce((t, s) => t + num(h.slot_rates?.[s.kind] ?? rate), 0), `${unit.parking?.length ?? 0} slot(s)`];
      case 'pct_of_head': return unit.occupancy === 'tenant' ? [(live.filter((x) => x.kind === 'service' && x !== h).reduce((t, x) => t + monthly(x)[0], 0) * rate) / 100, `${rate} % of service (let out)`] : [0, ''];
      case 'typed': return [num(unit.typed?.[h.id]), 'as assessed'];
      case 'fixed_member': return [opts.member === false ? 0 : rate, 'per member'];
      default: return [0, ''];
    }
  };
  const out: HsHeadRow[] = [];
  for (const h of live) {
    const [m, basis] = monthly(h);
    const amount = round2(m * r.months);
    if (amount > 0) out.push({ head_id: h.id, name: h.name, kind: h.kind, basis: r.months > 1 ? `${basis} × ${r.months} months` : basis, amount });
  }
  return out;
}

/** Totals of a unit's rows: member heads (counted in B2), statutory pass-through, non-member income and the whole. */
export function chargeTotals(rows: readonly HsHeadRow[]): { member: number; statutory: number; outsider: number; total: number } {
  const t = { member: 0, statutory: 0, outsider: 0, total: 0 };
  for (const r of rows) {
    const k = r.kind === 'statutory' || r.kind === 'outsider' ? r.kind : 'member';
    t[k] = round2(t[k] + r.amount);
    t.total = round2(t.total + r.amount);
  }
  return t;
}

/** The State rule in force on a date (`society_settings.confirmed` lists States whose bill rows the user confirmed). */
export const stateRule = (state: string | undefined, date: string, confirmed?: readonly string[]): StateSocietyRule | null => stateRuleAt(state, date, confirmed)?.value ?? null;

/** The kinds "Apply State defaults" creates when the tariff has none (the MH tariff of the PRD's user story). */
const DEFAULT_KINDS: readonly [HsHeadKind, string][] = [['service', 'Service charges'], ['sinking', 'Sinking fund'], ['repair', 'Repair fund'], ['statutory', 'Property tax'], ['parking', 'Parking'], ['non_occupancy', 'Non-occupancy'], ['education', 'Education']];
const FALLBACK: Partial<Record<HsHeadKind, HsBasis>> = { sinking: 'cost_pct_pa', repair: 'cost_pct_pa', major_repair: 'cost_pct_pa', statutory: 'typed', parking: 'per_slot', non_occupancy: 'pct_of_head', education: 'fixed_member', election: 'fixed_member' };

/** The State's default rate of a kind (fund minimum, non-occupancy cap, education), else undefined. */
const stateRate = (kind: HsHeadKind, rule: StateSocietyRule | null): number | undefined =>
  (kind === 'sinking' || kind === 'repair' ? rule?.fund_min?.[kind] : kind === 'non_occupancy' ? rule?.noc_pct : kind === 'education' ? rule?.education_per_month : undefined) ?? undefined;

/** A head of a kind (pure): the State's basis for it (else the usual one), its default rate and SAC. */
export const newHead = (kind: HsHeadKind, name: string, rule: StateSocietyRule | null, date: string, id: string): HsHead => ({ id, name, kind, basis: rule?.default_bases[kind] ?? FALLBACK[kind] ?? 'per_unit', rate: stateRate(kind, rule) ?? 0, sac: sacFor(kind, date), active: true });

/**
 * "Apply State defaults" (pure): with no heads, the default tariff with the State's bases and rates; otherwise the heads
 * as typed, with a zero rate filled from the State where it has one. A basis the user chose is never changed.
 */
export function applyStateDefaults(heads: readonly HsHead[], rule: StateSocietyRule | null, date: string, newId: () => string): HsHead[] {
  if (!heads.length) return DEFAULT_KINDS.map(([kind, name]) => newHead(kind, name, rule, date, newId()));
  return heads.map((h) => (!num(h.rate) && stateRate(h.kind, rule) !== undefined ? { ...h, rate: stateRate(h.kind, rule)! } : h));
}

export type TariffHintCode = 'fundLow' | 'nocHigh' | 'proposed';
export interface TariffHint { code: TariffHintCode; ca: string; head?: string; value?: number; limit?: number }

/**
 * State hints on a tariff (never blocks): sinking / repair below the State minimum (% a year of cost, HS27),
 * non-occupancy above the State cap (HS19); `proposed` when the State's rows are a bill awaiting confirmation (HS33).
 */
export function tariffHints(heads: readonly HsHead[], rule: StateSocietyRule | null, proposed = false): TariffHint[] {
  const out: TariffHint[] = proposed ? [{ code: 'proposed', ca: 'HS33' }] : [];
  for (const h of heads) {
    if (h.active === false || !rule) continue;
    const v = num(h.rate);
    if ((h.kind === 'sinking' || h.kind === 'repair') && h.basis === 'cost_pct_pa' && rule.fund_min && v < rule.fund_min[h.kind]) out.push({ code: 'fundLow', ca: 'HS27', head: h.name, value: v, limit: rule.fund_min[h.kind] });
    if (h.kind === 'non_occupancy' && h.basis === 'pct_of_head' && rule.noc_pct != null && v > rule.noc_pct) out.push({ code: 'nocHigh', ca: 'HS19', head: h.name, value: v, limit: rule.noc_pct });
  }
  return out;
}
