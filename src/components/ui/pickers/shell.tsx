/**
 * The always-loaded part of the pickers: one lazy popup (calendar, month grid, time wheel, list) for every field, so
 * the calendar / list code loads once, on the first open (docs/theme/IOS-UI.md, Pickers). Keep this file small.
 */
import { lazy, Suspense, type Ref } from 'react';
import { dateLocale, getLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/utils';
import type { PickerChange, PopupSpec } from './types';

const LazyPopup = lazy(() => import('./PickerPopup'));

export function Popup({ spec }: { spec: PopupSpec | null }) {
  return spec ? <Suspense fallback={null}><LazyPopup spec={spec} /></Suspense> : null;
}

/** Warm the popup chunk (focus / hover), so the first open is instant. */
export const preloadPopup = () => void import('./PickerPopup').catch(() => {});

/** The field's visible name, for the sheet title: aria-label, a <label for>, the wrapping <label>, else `fallback`. */
export function nameOf(el: HTMLElement, fallback: string): string {
  const own = el.getAttribute('aria-label');
  if (own) return own;
  const byFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  const text = (byFor ?? el.closest('label'))?.textContent?.trim();
  return text || fallback;
}

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

export const change = (value: string, el: { name?: string; id?: string } | null): PickerChange => {
  const target = { value, name: el?.name ?? '', id: el?.id ?? '' };
  return { target, currentTarget: target };
};

export function setRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: T | null }).current = el;
}

/** Touch (not a mouse) under the phone width: the popup is a bottom sheet and the keyboard stays down. */
export const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
