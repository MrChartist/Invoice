/** Display formats of the date / month / time fields (kept out of the select shell, which first paint carries). */
import { dateLocale, getLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/utils';

let fmt: Intl.DateTimeFormat | undefined;
let fmtLang = '';
const fmtMonth = new Map<string, Intl.DateTimeFormat>();

/** "30 Oct 2026" (English, the app's `formatDate`) or the same order in the interface language. */
export function showDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  const lang = getLanguage();
  if (lang === 'en') return formatDate(iso);
  if (fmtLang !== lang) {
    fmt = new Intl.DateTimeFormat(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    fmtLang = lang;
  }
  return fmt!.format(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** "Oct 2026". */
export function showMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym || '');
  if (!m) return ym || '';
  const loc = dateLocale(getLanguage());
  let f = fmtMonth.get(loc);
  if (!f) fmtMonth.set(loc, (f = new Intl.DateTimeFormat(loc, { month: 'short', year: 'numeric', timeZone: 'UTC' })));
  return f.format(Date.UTC(+m[1], +m[2] - 1, 1));
}

/** True when the interface language writes times with am / pm. */
export const hour12 = () => new Intl.DateTimeFormat(dateLocale(getLanguage()), { hour: 'numeric' }).resolvedOptions().hour12 ?? true;

/** "9:30 am" / "21:30". */
export function showTime(hm: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(hm || '');
  if (!m) return hm || '';
  if (!hour12()) return `${m[1]}:${m[2]}`;
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'am' : 'pm'}`;
}
