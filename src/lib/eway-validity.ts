/**
 * R3-C5 e-Way Bill validity (Rule 138(10) CGST Rules) — WORKING PAPER, verify with your CA.
 *
 * Date-keyed, append-only rule table (same shape as `tax-rules.ts`, kept out of the first-paint
 * bundle like `gst-penalties.ts`): add a new row with its effective date, never edit an old one.
 *  - From 1 Jan 2021 (as understood): one day for every 200 km or part of it; over-dimensional cargo
 *    and multimodal shipments with a ship leg: one day for every 20 km or part of it.
 *  - Before 1 Jan 2021: 100 km per day (20 km for over-dimensional cargo).
 * Day boundary (as understood, Explanation to Rule 138(10)): the period is counted from generation,
 * and a "day" expires at midnight of the day following the date of generation — so N days expire at
 * 23:59:59 local time on generation date + N. Shown as an assumption on every screen.
 * Extension: within a window around expiry (believed 8 hours before / after) on the portal only.
 * A typed or imported `eway_valid_upto` always wins over the computed value.
 * Pure: local days only (never `new Date('YYYY-MM-DD')`, AGENTS.md rule 8).
 */

import type { EwayCargo } from '../types/docs-r3';

export interface EwayValidityRule {
  /** Effective from (local day, inclusive). */
  from: string;
  /** km per day: normal cargo. */
  normalKm: number;
  /** km per day: over-dimensional cargo. */
  odcKm: number;
  /** km per day: multimodal shipment with at least one leg by ship. */
  multimodalShipKm: number;
}

/** Append-only. Verify with your CA. */
export const EWAY_VALIDITY_RULES: readonly EwayValidityRule[] = [
  { from: '2018-04-01', normalKm: 100, odcKm: 20, multimodalShipKm: 100 },
  { from: '2021-01-01', normalKm: 200, odcKm: 20, multimodalShipKm: 20 },
];

export interface EwayExtensionRule {
  from: string;
  /** Hours before and after expiry in which the portal allows an extension. */
  hours: number;
}

/** Append-only. Believed 8 hours before / after expiry — verify with your CA. */
export const EWAY_EXTENSION_RULES: readonly EwayExtensionRule[] = [{ from: '2018-04-01', hours: 8 }];

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** `YYYY-MM-DD` of a Date in local time. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function byDate<T extends { from: string }>(rules: readonly T[], day: string): T {
  let pick = rules[0];
  for (const r of rules) if (r.from <= day) pick = r;
  return pick;
}

export const validityRule = (day: string): EwayValidityRule => byDate(EWAY_VALIDITY_RULES, day);
export const extensionHours = (day: string): number => byDate(EWAY_EXTENSION_RULES, day).hours;

/** km per day for a cargo type on a date. */
export function kmPerDay(cargo: EwayCargo | undefined, day: string): number {
  const r = validityRule(day);
  return cargo === 'odc' ? r.odcKm : cargo === 'multimodal_ship' ? r.multimodalShipKm : r.normalKm;
}

/** Days of validity: one per `kmPerDay` or part of it, at least one. */
export function validityDays(distanceKm: number, cargo: EwayCargo | undefined, day: string): number {
  const km = Math.max(0, Number(distanceKm) || 0);
  return Math.max(1, Math.ceil(km / kmPerDay(cargo, day)));
}

/**
 * Parse a stored date or date-time as LOCAL time. 'YYYY-MM-DD' alone → that day (time = `endOfDay`
 * ? 23:59:59 : 00:00). 'YYYY-MM-DD HH:MM[:SS]' / ISO with 'T' → that time. Null when unreadable.
 */
export function parseLocal(value: string | undefined, endOfDay = false): Date | null {
  const s = String(value ?? '').trim();
  const m = DAY.exec(s);
  if (!m) return null;
  const t = /[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.slice(10));
  const d = t
    ? new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2], +(t[3] ?? 0))
    : endOfDay ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : new Date(+m[1], +m[2] - 1, +m[3]);
  // Z / offset ISO strings (written by toISOString) are real instants: read them as such.
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const inst = Date.parse(s);
    return Number.isNaN(inst) ? null : new Date(inst);
  }
  return d.getMonth() === +m[2] - 1 ? d : null;
}

export interface ComputedValidity {
  days: number;
  /** End of the last valid day (23:59:59 local). */
  expiresAt: Date;
  /** Last valid local day. */
  day: string;
}

/** Validity from the generation date-time, distance and cargo type (see the module comment). */
export function computeValidity(generatedAt: Date, distanceKm: number, cargo?: EwayCargo): ComputedValidity {
  const genDay = localDay(generatedAt);
  const days = validityDays(distanceKm, cargo, genDay);
  const end = new Date(generatedAt.getFullYear(), generatedAt.getMonth(), generatedAt.getDate() + days, 23, 59, 59);
  return { days, expiresAt: end, day: localDay(end) };
}

export interface ValidityMetaLike {
  eway_no?: string;
  eway_date?: string;
  eway_generated_at?: string;
  eway_valid_upto?: string;
  eway_cargo?: EwayCargo;
  eway_distance_km?: number;
  distance?: number;
}

export interface EffectiveValidity {
  source: 'typed' | 'computed' | 'none';
  expiresAt: Date | null;
  /** Typed / imported valid-upto day, when present. */
  typedDay?: string;
  /** Computed last valid day, when the generation date is known. */
  computedDay?: string;
  computedDays?: number;
  /** Both exist and name different days (the UI shows both). */
  differs: boolean;
}

/** The validity to act on: typed / imported `eway_valid_upto` wins; else the computed one. */
export function effectiveValidity(m: ValidityMetaLike): EffectiveValidity {
  const gen = parseLocal(m.eway_generated_at) ?? parseLocal(m.eway_date);
  const distance = Number(m.eway_distance_km ?? m.distance) || 0;
  const computed = gen ? computeValidity(gen, distance, m.eway_cargo) : null;
  const typed = parseLocal(m.eway_valid_upto, true);
  const typedDay = typed ? localDay(typed) : undefined;
  const base = {
    ...(typedDay ? { typedDay } : {}),
    ...(computed ? { computedDay: computed.day, computedDays: computed.days } : {}),
    differs: !!typedDay && !!computed && typedDay !== computed.day,
  };
  if (typed) return { source: 'typed', expiresAt: typed, ...base };
  if (computed) return { source: 'computed', expiresAt: computed.expiresAt, ...base };
  return { source: 'none', expiresAt: null, ...base };
}

/** Whole hours left until `expiresAt` (negative once expired). */
export function hoursLeft(expiresAt: Date, now: Date): number {
  return Math.floor((expiresAt.getTime() - now.getTime()) / 3_600_000);
}

/** True while `now` is inside the extension window around `expiresAt`. */
export function inExtensionWindow(expiresAt: Date, now: Date): boolean {
  const h = extensionHours(localDay(expiresAt)) * 3_600_000;
  const t = now.getTime() - expiresAt.getTime();
  return t >= -h && t <= h;
}
