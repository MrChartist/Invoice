/**
 * Calendar-day helpers shared by every module.
 *
 * Why this exists: `new Date('2026-04-01')` is midnight UTC, which is still
 * 31 March in the Americas. Anything that then reads `getDate()` / formats in
 * local time files a 1 April document under the previous day (and the previous
 * financial year). A stored `YYYY-MM-DD` is a calendar day, not an instant.
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_PREFIX_RE = /^(\d{4})-(\d{2})-(\d{2})/;
/** Has a clock time AND an explicit zone (Z or +hh:mm), i.e. it is a real instant. */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})$/i;

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse a bare `YYYY-MM-DD` as a LOCAL calendar day; anything else falls back to `new Date(x)`. */
export function parseDay(value: string | Date): Date {
  if (value instanceof Date) return value;
  const m = DAY_RE.exec(String(value ?? '').trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

/** Local calendar day of a Date as `YYYY-MM-DD` ('' for an invalid Date). */
export function localDayOf(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Normalise any date-ish value to the user's local `YYYY-MM-DD` ('' if unusable).
 *  - bare days and zone-less timestamps keep their written day;
 *  - real instants (`...Z`, `...+05:30`) are converted to the LOCAL day, so a
 *    receipt stamped 19:30Z on 31 Mar is a 1 April receipt in India.
 */
export function isoDay(value: unknown): string {
  if (value instanceof Date) return localDayOf(value);
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s) return '';
  if (INSTANT_RE.test(s)) return localDayOf(new Date(s));
  const m = DAY_PREFIX_RE.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return localDayOf(new Date(s));
}

/** `YYYY-MM-DD` shifted by whole days (calendar arithmetic, DST-proof). */
export function shiftDay(day: string, days: number): string {
  const m = DAY_PREFIX_RE.exec(day);
  if (!m) return day;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
