/**
 * Accessibility & display preferences (R2-C6): text size, high contrast, motion, link underline,
 * larger tap targets and an always-visible focus ring.
 *
 * Device-local: stored under `mrchartist_display_prefs` in localStorage, OUTSIDE the
 * `mrchartist_inv_` prefix (like `theme` and `mrchartist_report_prefs`), so it is never in a
 * backup, a folder-sync snapshot or another company. Every read / write is wrapped in try / catch.
 *
 * Applied as classes on `<html>` before first paint by `public/theme-init.js` (which repeats the
 * small mapping below in plain ES5 — `tests/display-prefs.test.ts` runs that file and checks it
 * produces the same classes) and again by `applyDisplayPrefs` when the user changes a setting.
 * The classes are honoured by `src/index.css`; printed documents are unaffected (`@media print`).
 */

export const DISPLAY_PREFS_KEY = 'mrchartist_display_prefs';

export type MotionPref = 'system' | 'reduce' | 'full';

export interface DisplayPrefs {
  /** Interface text size in percent of the default (90–130). */
  text_scale: number;
  high_contrast: boolean;
  /** 'system' follows the OS "reduce motion" setting (default). */
  motion: MotionPref;
  underline_links: boolean;
  large_targets: boolean;
  focus_always: boolean;
}

export const TEXT_SCALES: readonly number[] = [90, 100, 110, 120, 130];
export const MOTION_PREFS: readonly MotionPref[] = ['system', 'reduce', 'full'];

export const DEFAULT_DISPLAY_PREFS: DisplayPrefs = {
  text_scale: 100,
  high_contrast: false,
  motion: 'system',
  underline_links: false,
  large_targets: false,
  focus_always: false,
};

/** Nearest supported text size (90–130 in steps of 10); anything unreadable → 100. */
export function clampTextScale(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_DISPLAY_PREFS.text_scale;
  const clamped = Math.min(130, Math.max(90, n));
  return Math.round(clamped / 10) * 10;
}

/** Coerce anything (corrupt storage, an older / newer version) into complete, valid prefs. */
export function normalizeDisplayPrefs(raw: unknown): DisplayPrefs {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const b = (k: keyof DisplayPrefs) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_DISPLAY_PREFS[k] as boolean));
  return {
    text_scale: clampTextScale(o.text_scale),
    high_contrast: b('high_contrast'),
    motion: MOTION_PREFS.includes(o.motion as MotionPref) ? (o.motion as MotionPref) : 'system',
    underline_links: b('underline_links'),
    large_targets: b('large_targets'),
    focus_always: b('focus_always'),
  };
}

/** Every class this module may put on `<html>` (so an update can remove the old ones). */
export const DISPLAY_CLASSES: readonly string[] = [
  ...TEXT_SCALES.filter((s) => s !== 100).map((s) => `a11y-text-${s}`),
  'a11y-contrast',
  'a11y-motion-reduce',
  'a11y-motion-full',
  'a11y-underline',
  'a11y-targets',
  'a11y-focus',
];

/** The `<html>` classes for a set of prefs. Must stay in step with `public/theme-init.js`. */
export function displayClasses(prefs: DisplayPrefs): string[] {
  const out: string[] = [];
  if (prefs.text_scale !== 100) out.push(`a11y-text-${prefs.text_scale}`);
  if (prefs.high_contrast) out.push('a11y-contrast');
  if (prefs.motion === 'reduce') out.push('a11y-motion-reduce');
  if (prefs.motion === 'full') out.push('a11y-motion-full');
  if (prefs.underline_links) out.push('a11y-underline');
  if (prefs.large_targets) out.push('a11y-targets');
  if (prefs.focus_always) out.push('a11y-focus');
  return out;
}

/** Root font size in CSS px for the text scale (the app's type scale is in rem). */
export function rootFontPx(prefs: Pick<DisplayPrefs, 'text_scale'>): number {
  return Math.round(16 * clampTextScale(prefs.text_scale)) / 100;
}

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): KeyStore | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

export function loadDisplayPrefs(s: KeyStore | undefined = store()): DisplayPrefs {
  try {
    const raw = s?.getItem(DISPLAY_PREFS_KEY);
    return normalizeDisplayPrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_DISPLAY_PREFS };
  }
}

/** Save (defaults remove the key, so a fresh device and "reset" look the same). */
export function saveDisplayPrefs(prefs: DisplayPrefs, s: KeyStore | undefined = store()): DisplayPrefs {
  const clean = normalizeDisplayPrefs(prefs);
  try {
    if (displayClasses(clean).length === 0) s?.removeItem(DISPLAY_PREFS_KEY);
    else s?.setItem(DISPLAY_PREFS_KEY, JSON.stringify(clean));
  } catch {
    /* applied for this session only */
  }
  return clean;
}

/** Put the classes on `<html>` (browser only). */
export function applyDisplayPrefs(prefs: DisplayPrefs, root: { classList: DOMTokenList } | undefined = globalThis.document?.documentElement): void {
  if (!root) return;
  for (const c of DISPLAY_CLASSES) root.classList.remove(c);
  for (const c of displayClasses(normalizeDisplayPrefs(prefs))) root.classList.add(c);
}
