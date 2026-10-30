/**
 * R7-A2 rate plans (masters, `master.edit`): meal plan, per-room-type rates, weekend days / uplift, seasons (later rows
 * win), min stay, tax-inclusive flag, audience and the B6 policy. Rates are tax-exclusive unless `tax_inclusive`.
 */
import type { RatePlan, Reservation } from '../../types/hotel-r7';
import { generateId } from '../storage';
import { hotelDb, persistStarters, usingStarter } from './hotel-store';
import { usedIds } from './rooms';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function ratePlanError(p: RatePlan, all: readonly RatePlan[]): string {
  if (!p.name.trim() || !p.code.trim()) return 'Every rate plan needs a name and a code.';
  if (all.some((x) => x.id !== p.id && x.code.trim().toUpperCase() === p.code.trim().toUpperCase())) return `Code ${p.code} is used twice.`;
  if (!p.rates.length) return `${p.code}: add a rate for at least one room type.`;
  for (const r of p.rates) {
    if ([r.single, r.double, r.extra_adult, r.extra_child, r.extra_bed, r.weekend_single ?? 0, r.weekend_double ?? 0].some((v) => !(Number(v) >= 0))) return `${p.code}: rates cannot be negative.`;
  }
  for (const s of p.seasons ?? []) {
    if (!DAY.test(s.from) || !DAY.test(s.to) || s.to < s.from) return `${p.code}: season ${s.name || ''} needs from ≤ to dates.`;
    if (s.kind === 'override' && !(Number(s.value) >= 0)) return `${p.code}: a season price cannot be negative.`;
  }
  if (p.policy?.charge === 'pct' && !(Number(p.policy.pct) > 0 && Number(p.policy.pct) <= 100)) return `${p.code}: the cancellation % must be 1–100.`;
  return '';
}

/** Plans a booking may use for this party (public plans, plus the party's own corporate / agent plan). */
export const plansFor = (plans: readonly RatePlan[], clientId?: string): RatePlan[] =>
  plans.filter((p) => p.active !== false && (!p.client_id || p.client_id === clientId));

export function saveRatePlans(rows: RatePlan[], reservations: readonly Reservation[] = hotelDb.reservations()): void {
  for (const p of rows) {
    const e = ratePlanError(p, rows);
    if (e) throw new Error(e);
  }
  const used = usedIds(reservations);
  const gone = hotelDb.ratePlans().find((p) => used.has(p.id) && !rows.some((x) => x.id === p.id));
  if (gone) throw new Error(`${gone.code} is used by a booking: make it inactive instead.`);
  if (usingStarter()) persistStarters();
  hotelDb.saveRatePlans(rows.map((p) => ({ ...p, id: p.id || generateId(), name: p.name.trim(), code: p.code.trim().toUpperCase() })));
}
