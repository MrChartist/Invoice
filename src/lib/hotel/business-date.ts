/**
 * R7-A6 business date: the hotel's "today", stored in `hotel_settings.business_date`. It moves only through the night
 * audit — never from the device clock — so an audit run at 2 AM still posts "yesterday". Pure helpers (local days).
 */
import { shiftDay } from '../dates';
import { todayIso } from '../tax-rules';

export const nextDay = (day: string): string => shiftDay(day, 1);

/** Nights from `from` (inclusive) to `to` (exclusive). */
export function nightsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to && out.length < 400; d = nextDay(d)) out.push(d);
  return out;
}

/**
 * Nights the next audit must close: just the business date normally; when it is older than yesterday (the audit was
 * missed), every night from it up to yesterday (catch-up). Empty when the business date is already ahead of today.
 */
export function auditNights(businessDate: string, today: string = todayIso()): string[] {
  if (!businessDate || businessDate > today) return [];
  const yesterday = shiftDay(today, -1);
  return businessDate < yesterday ? nightsBetween(businessDate, today) : [businessDate];
}

/** D7: 31 March — the audit offers interim invoices for in-house guests. */
export const isYearEnd = (day: string): boolean => day.slice(5) === '03-31';
