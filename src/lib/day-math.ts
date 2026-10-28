/**
 * R16-A3: shared calendar-day maths (one tested definition instead of a copy per module). Every input is a bare
 * `YYYY-MM-DD` read as a LOCAL day (`parseDay`, Critical Rule 8), and day counts are taken on the calendar, so they
 * never drift by a DST hour. Financial years are Indian (1 Apr – 31 Mar, Critical Rule 4).
 *
 * A lazy module: `src/lib/dates.ts` is first paint, so these helpers live here and must not be imported from a
 * first-paint module (scripts/check-bundle-size.mjs fails the build if this file reaches the initial chunk).
 */
import { localDayOf, parseDay } from './dates';

const DAY = 86_400_000;
const utcOf = (d: string | Date): number => {
  const x = parseDay(d);
  return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
};

/** Whole calendar days from `a` to `b` (negative when `b` is earlier). */
export function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((utcOf(b) - utcOf(a)) / DAY);
}

/** `day` moved by `n` calendar days. */
export function addDays(day: string | Date, n: number): string {
  const x = parseDay(day);
  return localDayOf(new Date(x.getFullYear(), x.getMonth(), x.getDate() + n));
}

/** Last day of `day`'s month. */
export function monthEnd(day: string | Date): string {
  const x = parseDay(day);
  return localDayOf(new Date(x.getFullYear(), x.getMonth() + 1, 0));
}

/**
 * `day` moved by `n` calendar months. With `clamp` (the default) a day past the target month's end becomes its
 * last day (31 Jan + 1 month = 28 / 29 Feb); without it the date rolls over as `Date` does (31 Jan + 1 = 3 Mar).
 */
export function addMonths(day: string | Date, n: number, { clamp = true }: { clamp?: boolean } = {}): string {
  const x = parseDay(day);
  if (!clamp) return localDayOf(new Date(x.getFullYear(), x.getMonth() + n, x.getDate()));
  const last = new Date(x.getFullYear(), x.getMonth() + n + 1, 0).getDate();
  return localDayOf(new Date(x.getFullYear(), x.getMonth() + n, Math.min(x.getDate(), last)));
}

/** Start year of the Indian financial year holding `day` (2025 for 1 Apr 2025 … 31 Mar 2026). */
export function fyStartYear(day: string | Date): number {
  const x = parseDay(day);
  return x.getMonth() >= 3 ? x.getFullYear() : x.getFullYear() - 1;
}

/** First and last day of the Indian financial year holding `day`. */
export function fyBounds(day: string | Date): { start: string; end: string } {
  const y = fyStartYear(day);
  return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
}
