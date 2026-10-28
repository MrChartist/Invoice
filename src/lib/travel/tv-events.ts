/**
 * R15-D3 events (pure above "Storage"): an event file is a trip file with `kind: 'event'` and `CostCentre.tv.event`
 * (venue, city, State, dates, guests, budget heads). The budget sheet rolls the event's bookings (venue, catering,
 * decor, artist, AV, manpower, other …) and the supplier bills tagged to them into approved / booked / billed / paid per
 * head (a head is a component id; a component without a head shows with approved 0), flags the heads over budget, and
 * adds the client's receipts and open advances (5.3). Vendor TDS hints by component and date (no new section logic;
 * the user picks the section on the bill, TV23): contract work (venue, catering, decor, sound / light, transport) →
 * contractor limb; artists / anchors → professional limb; manpower → contractor limb from 1 Apr 2026 (A4's dated row),
 * no hint before. Working papers — verify with your CA (TV21–TV23).
 */
import './tv-registry';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { TravelBooking, TvComponent, TvEvent } from '../../types/travel-r15';
import type { AdvanceRecord } from '../../types/advances';
import { ruleAt } from '../tax-rules';
import { round2 } from '../invoice-calc';
import { MANPOWER_WORK_RULES } from '../tds-rules';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { advanceBalance } from '../advance-tax';
import { EVENT_RULES } from '../travel-rules';
import { costInr } from './tv-bookings';
import { saveTrip, type Trip } from './tv-trips';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACT_2025 = '2026-04-01';
const CONTRACT = new Set<TvComponent>(['venue', 'catering', 'decor', 'av', 'transfer', 'bus']);

export const eventRule = (date?: string) => ruleAt(EVENT_RULES, date);

/** The TDS limb to hint for a vendor of `component` on a bill dated `date` (null = no hint). */
export function vendorTdsHint(component: TvComponent | undefined, date: string): { limb: 'contractor' | 'professional'; label: string } | null {
  const act = date >= ACT_2025;
  if (component === 'artist') return { limb: 'professional', label: act ? 'Sec 393(1) Table Sl. 6(iii) (old 194J)' : '194J' };
  if (component === 'manpower') {
    const m = ruleAt(MANPOWER_WORK_RULES, date);
    return m ? { limb: 'contractor', label: m } : null;
  }
  if (component && CONTRACT.has(component)) return { limb: 'contractor', label: act ? 'Sec 393(1) Table Sl. 6(i) (old 194C)' : '194C' };
  return null;
}

/** Event particulars cleaned (blank optionals dropped; budget heads with a name and a non-negative amount). */
export function cleanEvent(e: TvEvent): TvEvent {
  const s = (v?: string) => v?.trim() || undefined;
  const out: TvEvent = {};
  for (const k of ['venue', 'city', 'state'] as const) if (s(e[k])) out[k] = s(e[k]);
  for (const k of ['date_from', 'date_to'] as const) if (e[k] && DAY.test(e[k]!)) out[k] = e[k];
  if (Number(e.guests) > 0) out.guests = Math.round(Number(e.guests));
  const seen = new Set<string>();
  const budget = (e.budget ?? []).filter((b) => b.head?.trim() && !seen.has(b.head.trim()) && seen.add(b.head.trim())).map((b) => ({ head: b.head.trim(), approved: round2(Math.max(Number(b.approved) || 0, 0)) }));
  if (budget.length) out.budget = budget;
  return out;
}

export interface BudgetRow { head: string; approved: number; booked: number; billed: number; paid: number; over: boolean }
export interface EventSheet { rows: BudgetRow[]; approved: number; booked: number; billed: number; paid: number; over: string[] }

/** The budget sheet of one event from its bookings and the supplier bills tagged to it (purchase contract). */
export function eventBudget(event: TvEvent | undefined, bookings: readonly TravelBooking[], bills: readonly unknown[]): EventSheet {
  const by = new Map<string, BudgetRow>();
  const row = (head: string) => by.get(head) ?? by.set(head, { head, approved: 0, booked: 0, billed: 0, paid: 0, over: false }).get(head)!;
  for (const b of event?.budget ?? []) row(b.head).approved = round2(row(b.head).approved + b.approved);
  const headOf = new Map<string, string>();
  for (const b of bookings) {
    if (b.status === 'cancelled') continue;
    headOf.set(b.id, b.component);
    const r = row(b.component);
    r.booked = round2(r.booked + costInr(b));
  }
  for (const x of bills) {
    const c = readPurchase(x);
    if (!c || isVoidStatus(c.status)) continue;
    const r = row(headOf.get(String((x as { tv?: { booking_id?: string } }).tv?.booking_id)) ?? 'other');
    r.billed = round2(r.billed + c.total);
    r.paid = round2(r.paid + Math.min(c.paid, c.total));
  }
  const rows = [...by.values()];
  for (const r of rows) r.over = Math.max(r.booked, r.billed) > r.approved + 0.005;
  const sum = (k: 'approved' | 'booked' | 'billed' | 'paid') => round2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, approved: sum('approved'), booked: sum('booked'), billed: sum('billed'), paid: sum('paid'), over: rows.filter((r) => r.over).map((r) => r.head) };
}

/** The client's side of an event: invoiced and received on the event's live invoices, and the client's open advances. */
export function eventMoney(tripId: string, clientId: string | undefined, invoices: readonly InvoiceRecord[], payments: readonly Payment[], advances: readonly AdvanceRecord[]): { invoiced: number; received: number; advances: number } {
  let invoiced = 0, received = 0;
  for (const i of invoices) {
    if (i.cost_centre_id !== tripId || /^(draft|cancelled)$/i.test(String(i.status))) continue;
    invoiced += Number(i.total) || 0;
    received += Number(i.amount_paid) || 0;
  }
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const adv = clientId ? advances.filter((a) => a.client?.id === clientId).reduce((s, a) => s + advanceBalance(a, payments, byId).open, 0) : 0;
  return { invoiced: round2(invoiced), received: round2(received), advances: round2(adv) };
}

// ── Storage ──────────────────────────────────────────────────────

/** Save the event particulars on the event file (`doc.create`, through `saveTrip`). */
export function saveEvent(trip: Trip, event: TvEvent): Trip {
  return saveTrip({ id: trip.id, name: trip.name, client_id: trip.client_id, tv: { ...trip.tv, kind: 'event', event: cleanEvent(event) } });
}
