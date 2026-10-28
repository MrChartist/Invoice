/**
 * R18-A3 tariff engine (pure; family `f-society`): charge heads × apportionment bases → a unit's charges for a billing
 * period, State defaults and the State hints. Amounts are a month's and a cycle multiplies them; each head is rounded to
 * the paisa. State values come only from `society-rules.ts` rows (data, never code branches); checks are hints citing
 * the CA id, never blocks. Working papers — verify with your CA (HS19, HS26–HS28, HS33, HS34).
 */
import { round2 } from '../invoice-calc';
import { pendingStateRule, SOCIETY_SAC_RULES, stateRuleAt, type StateSocietyRule } from '../society-rules';

export { pendingStateRule };
import { ruleAt } from '../tax-rules';
import type { HsBasis, HsCycle, HsHead, HsHeadKind, HsHeadRow, SocietyUnit } from '../../types/society-r18';

export const HEAD_KINDS: readonly HsHeadKind[] = ['service', 'sinking', 'repair', 'major_repair', 'statutory', 'service_supply', 'parking', 'non_occupancy', 'education', 'election', 'insurance', 'lease_rent', 'outsider', 'other'];
export const BASES: readonly HsBasis[] = ['per_unit', 'area_carpet', 'area_super', 'undivided_pct', 'cost_pct_pa', 'per_slot', 'per_inlet', 'per_lifted_unit', 'pct_of_head', 'typed', 'fixed_member'];
export const CYCLES: readonly HsCycle[] = ['monthly', 'quarterly', 'half_yearly'];
export const CYCLE_MONTHS: Readonly<Record<HsCycle, number>> = { monthly: 1, quarterly: 3, half_yearly: 6 };

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/**
 * A billing period → its first / last day and months. `YYYY-MM`; `YYYY-Qn` / `YYYY-Hn` are Indian-FY quarters / halves
 * of the FY that starts in April of YYYY (`2026-Q1` = Apr–Jun 2026, `2026-H2` = Oct 2026 – Mar 2027). Null if malformed.
 */
export function periodRange(period: string): { from: string; to: string; months: number } | null {
  const m = /^(\d{4})-(?:(0[1-9]|1[0-2])|Q([1-4])|H([12]))$/.exec(period);
  if (!m) return null;
  const y = Number(m[1]);
  const months = m[2] ? 1 : m[3] ? 3 : 6;
  const startIdx = m[2] ? Number(m[2]) - 1 : 3 + (Number(m[3] ?? m[4]) - 1) * months; // months after Jan of y
  const sy = y + Math.floor(startIdx / 12), sm = (startIdx % 12) + 1;
  const endIdx = startIdx + months - 1;
  const ey = y + Math.floor(endIdx / 12), em = (endIdx % 12) + 1;
  return { from: `${sy}-${pad(sm)}-01`, to: `${ey}-${pad(em)}-${pad(lastDay(ey, em))}`, months };
}

/** The period of a cycle that holds a day (`2026-11-05`: monthly `2026-11`, quarterly `2026-Q3`, half-yearly `2026-H2`). */
export function periodOf(day: string, cycle: HsCycle = 'monthly'): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  if (cycle === 'monthly') return day.slice(0, 7);
  const fy = m >= 4 ? y : y - 1;
  const idx = (m + 8) % 12; // months since April
  return cycle === 'quarterly' ? `${fy}-Q${Math.floor(idx / 3) + 1}` : `${fy}-H${idx < 6 ? 1 : 2}`;
}

/** The member heads are counted towards ₹7,500 (B2); `statutory` is pass-through and `outsider` non-member income. */
export const isMemberHead = (k: HsHeadKind): boolean => k !== 'statutory' && k !== 'outsider';

/** Default SAC of a head kind on a date (member heads 999598, non-member income 997212, none for statutory dues). */
export function sacFor(kind: HsHeadKind, date: string): string {
  if (kind === 'statutory') return '';
  const s = ruleAt(SOCIETY_SAC_RULES, date);
  return kind === 'outsider' ? s.outsider : s.member;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const money = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Is the head live in the period (active, and its from / to overlap the period)? */
export const headLive = (h: HsHead, from: string, to: string): boolean => h.active !== false && (!h.from || h.from <= to) && (!h.to || h.to >= from);

export interface UnitChargeOpts {
  /** `fixed_member` heads charge once per member: false for a member's second unit (B decides; default true). */
  member?: boolean;
  /** Printed area unit in the basis text. */
  areaUnit?: 'sqft' | 'sqm';
}

/**
 * A unit's charges for a period (pure): per live head with a non-zero amount `{ head_id, name, kind, basis, amount }`
 * — the month's amount × the period's months, paise-rounded per head. Non-occupancy (`pct_of_head`) is charged only
 * on a let unit (`occupancy = 'tenant'`), as a % of the unit's `service` heads.
 */
export function unitCharges(unit: SocietyUnit, heads: readonly HsHead[], period: string, opts: UnitChargeOpts = {}): HsHeadRow[] {
  const r = periodRange(period);
  if (!r) return [];
  const au = opts.areaUnit === 'sqm' ? 'sq m' : 'sq ft';
  const live = heads.filter((h) => headLive(h, r.from, r.to));
  const out: HsHeadRow[] = [];
  const monthly = (h: HsHead): [number, string] => {
    const rate = num(h.rate);
    switch (h.basis) {
      case 'per_unit': return [rate, `₹${money(rate)} per unit`];
      case 'area_carpet': return [rate * num(unit.carpet_area), `${money(num(unit.carpet_area))} ${au} carpet × ₹${money(rate)}`];
      case 'area_super': return [rate * num(unit.super_area), `${money(num(unit.super_area))} ${au} super × ₹${money(rate)}`];
      case 'undivided_pct': return [(rate * num(unit.undivided_pct)) / 100, `${money(num(unit.undivided_pct))} % of ₹${money(rate)}`];
      case 'cost_pct_pa': return [(num(unit.construction_cost) * rate) / 100 / 12, `${money(rate)} % a year of ₹${money(num(unit.construction_cost))}`];
      case 'per_slot': {
        const slots = unit.parking ?? [];
        const amt = slots.reduce((t, s) => t + num(h.slot_rates?.[s.kind] ?? rate), 0);
        return [amt, `${slots.length} slot${slots.length === 1 ? '' : 's'}`];
      }
      case 'per_inlet': return [rate * num(unit.inlets), `${num(unit.inlets)} inlet(s) × ₹${money(rate)}`];
      case 'per_lifted_unit': return [unit.lifted ? rate : 0, 'per unit in a lifted building'];
      case 'pct_of_head': {
        if (unit.occupancy !== 'tenant') return [0, ''];
        const base = live.filter((x) => x.kind === 'service' && x.id !== h.id).reduce((t, x) => t + monthly(x)[0], 0);
        return [(base * rate) / 100, `${money(rate)} % of service charges (let out)`];
      }
      case 'typed': return [num(unit.typed?.[h.id]), 'as assessed for the unit'];
      case 'fixed_member': return [opts.member === false ? 0 : rate, `₹${money(rate)} per member`];
      default: return [0, ''];
    }
  };
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
    if (r.kind === 'statutory') t.statutory += r.amount;
    else if (r.kind === 'outsider') t.outsider += r.amount;
    else t.member += r.amount;
    t.total += r.amount;
  }
  return { member: round2(t.member), statutory: round2(t.statutory), outsider: round2(t.outsider), total: round2(t.total) };
}

/** The State rule in force on a date (`society_settings.confirmed` lists States whose bill rows the user confirmed). */
export const stateRule = (state: string | undefined, date: string, confirmed?: readonly string[]): StateSocietyRule | null => stateRuleAt(state, date, confirmed)?.value ?? null;

/** The kinds "Apply State defaults" creates when the tariff has none (the MH tariff of the PRD's user story). */
const DEFAULT_KINDS: readonly [HsHeadKind, string][] = [['service', 'Service charges'], ['sinking', 'Sinking fund'], ['repair', 'Repair and maintenance fund'], ['statutory', 'Property tax'], ['parking', 'Parking charges'], ['non_occupancy', 'Non-occupancy charges'], ['education', 'Education and training fund']];
const FALLBACK_BASIS: Partial<Record<HsHeadKind, HsBasis>> = { service: 'per_unit', sinking: 'cost_pct_pa', repair: 'cost_pct_pa', major_repair: 'cost_pct_pa', statutory: 'typed', parking: 'per_slot', non_occupancy: 'pct_of_head', education: 'fixed_member', election: 'fixed_member' };

/** The State's default rate of a kind (fund minimum, non-occupancy cap, education), else undefined. */
function stateRate(kind: HsHeadKind, rule: StateSocietyRule | null): number | undefined {
  if (!rule) return undefined;
  if (kind === 'sinking') return rule.fund_min?.sinking;
  if (kind === 'repair') return rule.fund_min?.repair;
  if (kind === 'non_occupancy') return rule.noc_pct ?? undefined;
  if (kind === 'education') return rule.education_per_month ?? undefined;
  return undefined;
}

/**
 * "Apply State defaults" (pure): with no heads, the default tariff with the State's bases and rates; otherwise the heads
 * as typed, with a zero rate filled from the State where it has one. A basis the user chose is never changed.
 */
export function applyStateDefaults(heads: readonly HsHead[], rule: StateSocietyRule | null, date: string, newId: () => string): HsHead[] {
  if (!heads.length) {
    return DEFAULT_KINDS.map(([kind, name]) => ({ id: newId(), name, kind, basis: rule?.default_bases[kind] ?? FALLBACK_BASIS[kind] ?? 'per_unit', rate: stateRate(kind, rule) ?? 0, sac: sacFor(kind, date) || undefined, active: true }));
  }
  return heads.map((h) => (num(h.rate) === 0 && stateRate(h.kind, rule) !== undefined ? { ...h, rate: stateRate(h.kind, rule)! } : h));
}

/** A head for "Add head" (pure): the State's basis for the kind, the default SAC. */
export const newHead = (kind: HsHeadKind, name: string, rule: StateSocietyRule | null, date: string, id: string): HsHead => ({ id, name, kind, basis: rule?.default_bases[kind] ?? FALLBACK_BASIS[kind] ?? 'per_unit', rate: stateRate(kind, rule) ?? 0, sac: sacFor(kind, date) || undefined, active: true });

export type TariffHintCode = 'sinkingLow' | 'repairLow' | 'nocHigh' | 'proposed';
export interface TariffHint { code: TariffHintCode; ca: string; value?: number; limit?: number }

/**
 * State hints on a tariff (never blocks): sinking / repair below the State minimum (% a year of cost, HS27),
 * non-occupancy above the State cap (HS19); `proposed` when the State's rows are a bill awaiting confirmation (HS33).
 */
export function tariffHints(heads: readonly HsHead[], rule: StateSocietyRule | null, proposed = false): TariffHint[] {
  const out: TariffHint[] = [];
  if (proposed) out.push({ code: 'proposed', ca: 'HS33' });
  if (!rule) return out;
  for (const h of heads.filter((x) => x.active !== false)) {
    if (rule.fund_min && h.basis === 'cost_pct_pa' && (h.kind === 'sinking' || h.kind === 'repair')) {
      const min = rule.fund_min[h.kind];
      if (num(h.rate) < min) out.push({ code: h.kind === 'sinking' ? 'sinkingLow' : 'repairLow', ca: 'HS27', value: num(h.rate), limit: min });
    }
    if (rule.noc_pct != null && h.kind === 'non_occupancy' && h.basis === 'pct_of_head' && num(h.rate) > rule.noc_pct) out.push({ code: 'nocHigh', ca: 'HS19', value: num(h.rate), limit: rule.noc_pct });
  }
  return out;
}
