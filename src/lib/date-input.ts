/**
 * Typed date entry for `DateField` / `TimeField` (docs/theme/IOS-UI.md, Pickers). Every result is a bare `YYYY-MM-DD`
 * (or `YYYY-MM`, `HH:MM`) built from numbers, never `new Date(str)` (AGENTS.md rule 8). Day first, always (Indian
 * order): `30/10/2026`, `30-10-26`, `30.10`, `30 oct`, `oct 30 2026`, `2026-10-30`, plus `today`, `yesterday`,
 * `tomorrow`, `+7` / `-3` (days), `+2w`, `+1m`. Small and dependency-free: the field shell holds it.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** `YYYY-MM-DD` of a local Date. */
export const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local Date of a bare `YYYY-MM-DD` (null when it is not a real calendar day). */
export function localDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getMonth() === +m[2] - 1 ? d : null;
}

/** A real day of the calendar, or null (31 Feb, month 13 …). */
function make(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2199 && m >= 1 && m <= 12 && d >= 1)) return null;
  const last = new Date(y, m, 0).getDate();
  return d <= last ? `${y}-${pad(m)}-${pad(d)}` : null;
}

const year = (s: string | undefined, now: Date) => (!s ? now.getFullYear() : s.length <= 2 ? 2000 + +s : +s);
const monthOf = (s: string) => {
  const i = MONTHS.indexOf(s.slice(0, 3).toLowerCase());
  return i < 0 ? 0 : i + 1;
};

/** Keep a day inside [min, max] (bare days compare as strings). */
export function clampDay(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

/**
 * Parse what the user typed; `null` when it is not a date. `today` is injectable for tests. The result is clamped
 * to `min` / `max` when given.
 */
export function parseDateInput(text: string, opts: { today?: Date; min?: string; max?: string } = {}): string | null {
  const now = opts.today ?? new Date();
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let out: string | null = null;
  let m: RegExpExecArray | null;
  const shift = (days: number, months = 0) => dayOf(new Date(now.getFullYear(), now.getMonth() + months, now.getDate() + days));
  if (s === 'today' || s === 't' || s === 'आज') out = shift(0);
  else if (s === 'yesterday' || s === 'y' || s === 'कल') out = shift(-1);
  else if (s === 'tomorrow' || s === 'tm') out = shift(1);
  else if ((m = /^([+-])\s?(\d{1,4})\s?([dwm]?)$/.exec(s))) {
    const n = (m[1] === '-' ? -1 : 1) * +m[2];
    out = m[3] === 'm' ? shiftMonths(now, n) : shift(m[3] === 'w' ? n * 7 : n);
  } else if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s))) out = make(+m[1], +m[2], +m[3]);
  else if ((m = /^(\d{1,2})[-/. ](\d{1,2})(?:[-/. ](\d{2}|\d{4}))?$/.exec(s))) out = make(year(m[3], now), +m[2], +m[1]);
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[-/. ]?([a-z]{3,9})\.?,?(?:[-/. ](\d{2}|\d{4}))?$/.exec(s)) && monthOf(m[2])) out = make(year(m[3], now), monthOf(m[2]), +m[1]);
  else if ((m = /^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{2}|\d{4}))?$/.exec(s)) && monthOf(m[1])) out = make(year(m[3], now), monthOf(m[1]), +m[2]);
  else if ((m = /^(\d{2})(\d{2})(\d{2}|\d{4})$/.exec(s))) out = make(year(m[3], now), +m[2], +m[1]);
  else if ((m = /^(\d{1,2})$/.exec(s))) out = make(now.getFullYear(), now.getMonth() + 1, +m[1]);
  return out && clampDay(out, opts.min, opts.max);
}

function shiftMonths(now: Date, n: number): string {
  const last = new Date(now.getFullYear(), now.getMonth() + n + 1, 0).getDate();
  return dayOf(new Date(now.getFullYear(), now.getMonth() + n, Math.min(now.getDate(), last)));
}

/**
 * Text that is a whole date on its own (ISO, or day / month / four-digit year): committed while typing, so a
 * `fill('2026-10-30')` or a pasted date reaches the form at once. Shorter forms commit on blur / Enter.
 */
export const isWholeDate = (s: string) => /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\s*$/.test(s);

/** Month entry (`YYYY-MM`): `10/2026`, `oct 2026`, `2026-10`, `oct` (this year), `this month`. */
export function parseMonthInput(text: string, opts: { today?: Date; min?: string; max?: string } = {}): string | null {
  const now = opts.today ?? new Date();
  const s = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let m: RegExpExecArray | null;
  let y = 0;
  let mo = 0;
  if (s === 'this month' || s === 'today' || s === 't') [y, mo] = [now.getFullYear(), now.getMonth() + 1];
  else if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s))) [y, mo] = [+m[1], +m[2]];
  else if ((m = /^(\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(s))) [y, mo] = [year(m[2], now), +m[1]];
  else if ((m = /^([a-z]{3,9})\.?,?(?:[-/ ](\d{2}|\d{4}))?$/.exec(s)) && monthOf(m[1])) [y, mo] = [year(m[2], now), monthOf(m[1])];
  if (!(y >= 1900 && y <= 2199 && mo >= 1 && mo <= 12)) return null;
  const out = `${y}-${pad(mo)}`;
  return clampDay(out, opts.min, opts.max);
}

/** Time entry (`HH:MM`, 24h): `9:30`, `930`, `9.30 pm`, `21:30`, `9 am`, `noon`. */
export function parseTimeInput(text: string): string | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '');
  if (s === 'noon') return '12:00';
  if (s === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3][0] === 'p' ? 12 : 0);
  }
  return h <= 23 && min <= 59 ? `${pad(h)}:${pad(min)}` : null;
}
