/**
 * R19-A3 charge heads (pure; family `f-logistics`): the kinds, roles and units, the default heads with their SACs
 * (`LG_SAC_RULES`, LG5), roles (duty / CFS / port / DO / insurance pure agent — LG10, LG36, LG37; demurrage own — LG35),
 * the POS rule by kind (`auto`, used by B2) and the mode rate by the document date (`LG_RATE_RULES`, LG6). GTA rates stay
 * in `transport-works-rules.ts` (B reads them through `lg-tax-io.ts`).
 */
import { ruleAt } from '../tax-rules';
import { keyedAt, LG_RATE_RULES, LG_SAC_RULES, type LgRate } from '../logistics-rules';
import type { LgHead, LgHeadKind, LgLeg, LgPosRule, LgRole, LgUnit } from '../../types/logistics-r19';

export const LG_HEAD_KINDS: readonly LgHeadKind[] = ['freight_sea', 'freight_air', 'freight_road', 'freight_rail', 'freight_multimodal', 'courier', 'origin', 'destination', 'documentation', 'clearance', 'forwarding', 'handling', 'storage', 'gta', 'insurance', 'duty', 'cfs', 'port', 'do_charges', 'demurrage', 'commission', 'other'];
export const LG_ROLES: readonly LgRole[] = ['own', 'pure_agent', 'exempt'];
export const LG_UNITS: readonly LgUnit[] = ['per_kg', 'per_cbm', 'per_wm', 'per_container', 'per_shipment', 'per_bill', 'per_pkg', 'per_day', 'pct_of_value', 'typed'];
const PURE: readonly LgHeadKind[] = ['duty', 'cfs', 'port', 'do_charges', 'insurance'];

/** The POS rule a head follows (`auto` → transport for freight / courier / GTA, intermediary for commission, else general). */
export function posRuleOf(h: Pick<LgHead, 'kind' | 'pos_rule'>): Exclude<LgPosRule, 'auto'> {
  if (h.pos_rule && h.pos_rule !== 'auto') return h.pos_rule;
  return /^freight_|^courier$|^gta$/.test(h.kind) ? 'transport' : h.kind === 'commission' ? 'intermediary' : 'general';
}

/** The rate family of a head kind in `LG_RATE_RULES` (null: GTA rows elsewhere, pure agent, or typed). */
const rateKey = (k: LgHeadKind): string | null => (/^freight_(sea|air|multimodal|rail)$/.test(k) || k === 'courier' ? k : ['origin', 'destination', 'documentation', 'clearance', 'forwarding', 'handling', 'storage'].includes(k) ? 'support' : null);

/** The GST rate of a head kind on a date; multimodal: 18 % with an air leg from 22 Sep 2025 (`air_rate`). Null when no row. */
export function lgRateFor(kind: LgHeadKind, date: string, legs: readonly LgLeg[] = []): (LgRate & { source: string }) | null {
  const k = rateKey(kind);
  const r = k ? keyedAt(LG_RATE_RULES, k, date) : null;
  if (!r) return null;
  return { ...r.value, rate: r.value.air_rate !== undefined && legs.includes('air') ? r.value.air_rate : r.value.rate, source: r.source ?? '' };
}

/** The default SAC of a head kind (none for pure-agent recoveries). */
export const sacFor = (kind: LgHeadKind, date: string): string | undefined => (PURE.includes(kind) ? undefined : ruleAt(LG_SAC_RULES, date)[kind]);

const DEFAULTS: readonly [LgHeadKind, string, LgUnit, string?][] = [
  ['freight_air', 'Air freight', 'per_kg', 'USD'], ['freight_sea', 'Ocean freight', 'per_container', 'USD'], ['origin', 'Origin handling (THC)', 'per_shipment'],
  ['documentation', 'Documentation', 'per_bill'], ['clearance', 'Customs clearance', 'per_shipment'], ['cfs', 'CFS charges', 'typed'],
  ['duty', 'Customs duty', 'typed'], ['gta', 'Transportation', 'per_shipment'], ['insurance', 'Insurance', 'typed'], ['storage', 'Storage', 'per_day'],
  ['port', 'Port / terminal charges', 'typed'], ['do_charges', 'DO charges', 'typed'], ['demurrage', 'Demurrage / detention', 'typed'],
];

/** The default heads (PRD §4 A3): ids `lg-<kind>`, SAC by date, pure-agent roles, currency USD for freight. */
export function defaultHeads(date: string): LgHead[] {
  return DEFAULTS.map(([kind, name, unit, currency]) => ({ id: `lg-${kind}`, name, kind, role: PURE.includes(kind) ? 'pure_agent' : 'own', unit, ...(currency ? { currency } : {}), ...(sacFor(kind, date) ? { sac: sacFor(kind, date) } : {}), pos_rule: 'auto', active: true }));
}

/** A head is kept only with a name, a known kind / role / unit and a rate of 0 or more. */
export const headOk = (h: LgHead): boolean => !!h?.id && !!h.name?.trim() && LG_HEAD_KINDS.includes(h.kind) && LG_ROLES.includes(h.role) && LG_UNITS.includes(h.unit) && (h.rate === undefined || h.rate >= 0);
