/**
 * The always-loaded helpers of the pickers (docs/theme/IOS-UI.md, Pickers): display formats, names, refs. The popup
 * itself (calendar, month grid, time wheels, list) is ONE lazy chunk, `PickerPopup.tsx`, mounted by `Popup.tsx`.
 */
import type { Ref } from 'react';
import type { PickerChange } from './types';

/** Warm the popup chunk (focus / hover), so the first open is instant. */
export const preloadPopup = () => void import('./PickerPopup').catch(() => {});

/** The field's visible name, for the sheet title: aria-label, a <label for>, the wrapping <label>, else `fallback`. */
export function nameOf(el: HTMLElement, fallback: string): string {
  const own = el.getAttribute('aria-label');
  if (own) return own;
  const label = (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null) ?? el.closest('label');
  if (!label) return fallback;
  // The label's own words only: a wrapping <label> also holds the control (a select's option texts, a field's value).
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('select, input, textarea, button, [role="listbox"], [data-picker]').forEach((n) => n.remove());
  return copy.textContent?.replace(/\s+/g, ' ').trim() || fallback;
}

export const change = (value: string, el: { name?: string; id?: string } | null): PickerChange => {
  const target = { value, name: el?.name ?? '', id: el?.id ?? '' };
  return { target, currentTarget: target };
};

export function setRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: T | null }).current = el;
}
