/**
 * R15-B2 trip / event files: a trip IS a project cost centre (R3-B2) with `CostCentre.tv` (code, kind, scope,
 * destination, dates, passengers by name only, regime, currency, status) — the R14 matter precedent. No new table:
 * budgets, cost-centre P&L and reports work unchanged. The code is the agency's own (`<YY><MM>-<seq>` suggested,
 * editable, unique per company); no series. Pure above "Storage".
 */
import type { TripInfo, TripStatus } from '../../types/travel-r15';
import { loadCostCentres, saveCostCentre, type CostCentre } from '../cost-centres';
import { requireAccess } from '../access';
import { TV_REGIMES } from './tv-settings';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const TRIP_STATUSES: readonly TripStatus[] = ['enquiry', 'confirmed', 'travelled', 'closed', 'cancelled'];
export type Trip = CostCentre & { tv: TripInfo };

export const isTrip = (c: Pick<CostCentre, 'tv'> | undefined): c is Trip => !!c?.tv?.code;
export const tripLabel = (c: Pick<CostCentre, 'name' | 'tv'>): string => (c.tv?.code ? `${c.tv.code}: ${c.name}` : c.name);

/** `<YY><MM>-<seq>` of the start month: the next free sequence (3 digits). */
export function suggestTripCode(start: string, centres: readonly Pick<CostCentre, 'tv'>[]): string {
  const p = `${start.slice(2, 4)}${start.slice(5, 7)}-`;
  let max = 0;
  for (const c of centres) if (c.tv?.code?.startsWith(p)) max = Math.max(max, Number(c.tv.code.slice(p.length)) || 0);
  return `${p}${String(max + 1).padStart(3, '0')}`;
}

/** Problems with trip fields (empty = may be saved). */
export function validateTrip(t: TripInfo, id: string | undefined, centres: readonly CostCentre[]): string {
  const code = t.code?.trim();
  if (!code) return 'Give the trip a code.';
  if (centres.some((c) => c.id !== id && c.tv?.code?.trim().toLowerCase() === code.toLowerCase())) return `Trip code ${code} is already used.`;
  if (!TV_REGIMES.includes(t.regime)) return 'Choose the GST regime.';
  if (t.start && !DAY.test(t.start)) return 'Enter the start date.';
  if (t.end && (!DAY.test(t.end) || (t.start && t.end < t.start))) return 'The end date is before the start date.';
  if (t.pax.some((p) => !p.name?.trim())) return 'Every passenger needs a name.';
  return '';
}

/** Pure: the trip fields cleaned (blank optionals dropped; names only — never passport data). */
export function cleanTrip(t: TripInfo): TripInfo {
  const s = (v?: string) => v?.trim() || undefined;
  const out: TripInfo = {
    code: t.code.trim().toUpperCase(), kind: t.kind === 'event' ? 'event' : 'trip', scope: t.scope ?? 'domestic', regime: t.regime,
    status: TRIP_STATUSES.includes(t.status) ? t.status : 'enquiry',
    pax: t.pax.map((p) => ({ name: p.name.trim(), type: p.type === 'child' || p.type === 'infant' ? p.type : 'adult' })),
  };
  for (const k of ['destination', 'start', 'end', 'currency'] as const) if (s(t[k])) out[k] = s(t[k]);
  if (t.event) out.event = t.event;
  return out;
}

// ── Storage ──────────────────────────────────────────────────────

export const loadTrips = (all: readonly CostCentre[] = loadCostCentres()): Trip[] => all.filter(isTrip);

export interface TripInput { id?: string; name: string; client_id?: string; tv: TripInfo }

/** Open / edit a trip or event file (`doc.create`). */
export function saveTrip(i: TripInput): Trip {
  requireAccess('doc.create');
  const all = loadCostCentres();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  const tv = cleanTrip(i.tv);
  const err = validateTrip(tv, prev?.id, all);
  if (err) throw new Error(err);
  return saveCostCentre({
    ...(prev ?? { active: true }),
    id: prev?.id,
    name: i.name,
    kind: 'project',
    client_id: i.client_id || undefined,
    ...(tv.start ? { start: tv.start } : {}),
    ...(tv.end ? { due: tv.end } : {}),
    status: tv.status === 'closed' || tv.status === 'cancelled' ? 'done' : 'active',
    tv,
  }) as Trip;
}
