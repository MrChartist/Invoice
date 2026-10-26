/**
 * R7-B1 routing rules: which folio window a charge kind lands on. `windowFor` (room-post.ts) reads
 * `Reservation.routing` first, so the night audit, posted charges and charge-to-room all route the same way.
 * Default with a company / agent bill-to: room-type kinds (room, extra bed / person, meal plan) → window 2 (the
 * company's), everything else → window 1 (the guest). Windows run 1..4.
 */
import type { FolioLineKind, Reservation } from '../../types/hotel-r7';
import { ROOM_KINDS } from './room-post';

export const WINDOWS = [1, 2, 3, 4] as const;
export const LINE_KINDS: readonly FolioLineKind[] = ['room', 'extra_bed', 'extra_person', 'meal_plan', 'fnb', 'laundry', 'minibar', 'transport', 'misc', 'cancellation', 'no_show', 'allowance'];
/** Kinds a clerk posts by hand (room-type kinds come from the night audit). */
export const POST_KINDS: readonly FolioLineKind[] = ['fnb', 'laundry', 'minibar', 'transport', 'misc', 'allowance', 'extra_bed', 'extra_person'];

/** The default rules for a booking: company kinds to window 2 when someone else pays, else none (all → window 1). */
export function defaultRouting(res: Pick<Reservation, 'bill_to'>): NonNullable<Reservation['routing']> {
  return res.bill_to ? [{ kinds: [...ROOM_KINDS], window: 2 }] : [];
}

/** Clean user rules: windows 1..4, each kind in one rule only (the first wins), empty rules dropped. */
export function cleanRouting(rules: NonNullable<Reservation['routing']>): NonNullable<Reservation['routing']> {
  const seen = new Set<FolioLineKind>();
  return rules
    .map((r) => ({ window: Math.min(Math.max(Math.round(r.window) || 1, 1), 4), kinds: r.kinds.filter((k) => LINE_KINDS.includes(k) && !seen.has(k) && (seen.add(k), true)) }))
    .filter((r) => r.kinds.length);
}
