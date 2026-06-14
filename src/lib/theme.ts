/**
 * Theme & accent management for the Invoice Creator.
 * Drives the design tokens defined in index.css (.dark class + --primary family).
 * Everything is persisted to localStorage — no server, fully local-first.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'mrchartist_inv_theme';
const ACCENT_KEY = 'mrchartist_inv_accent';

/** Accent presets. Each overrides the --primary family of tokens. */
export interface AccentPreset {
  id: string;
  name: string;
  primary: string;
  hover: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'orange', name: 'Signature Orange', primary: '#f07020', hover: '#d96418' },
  { id: 'blue', name: 'Ocean Blue', primary: '#2563eb', hover: '#1d4ed8' },
  { id: 'violet', name: 'Royal Violet', primary: '#7c3aed', hover: '#6d28d9' },
  { id: 'emerald', name: 'Emerald', primary: '#059669', hover: '#047857' },
  { id: 'rose', name: 'Rose', primary: '#e11d48', hover: '#be123c' },
  { id: 'teal', name: 'Teal', primary: '#0d9488', hover: '#0f766e' },
  { id: 'amber', name: 'Amber', primary: '#d97706', hover: '#b45309' },
  { id: 'slate', name: 'Graphite', primary: '#475569', hover: '#334155' },
];

/** Append an 8-bit alpha (00-ff) to a 6-digit hex color. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

// ─── Theme mode ──────────────────────────────────────────────────

export function getThemeMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/** Resolve 'system' to the concrete theme the OS prefers. */
export function resolveTheme(mode: ThemeMode = getThemeMode()): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/** Apply the resolved theme to the document root. */
export function applyTheme(mode: ThemeMode = getThemeMode()): void {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

export function setThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

// ─── Accent color ────────────────────────────────────────────────

export function getAccentId(): string {
  return localStorage.getItem(ACCENT_KEY) || 'orange';
}

export function getAccent(): AccentPreset {
  return ACCENT_PRESETS.find((a) => a.id === getAccentId()) || ACCENT_PRESETS[0];
}

/** Override the --primary token family with the chosen accent. */
export function applyAccent(id: string = getAccentId()): void {
  const accent = ACCENT_PRESETS.find((a) => a.id === id);
  const root = document.documentElement;
  if (!accent || id === 'orange') {
    // 'orange' is the CSS default — clear overrides so light/dark base tokens win.
    ['--primary', '--primary-hover', '--primary-glow', '--primary-light', '--ring', '--shadow-glow']
      .forEach((p) => root.style.removeProperty(p));
    return;
  }
  root.style.setProperty('--primary', accent.primary);
  root.style.setProperty('--primary-hover', accent.hover);
  root.style.setProperty('--primary-glow', withAlpha(accent.primary, 0.15));
  root.style.setProperty('--primary-light', withAlpha(accent.primary, 0.1));
  root.style.setProperty('--ring', accent.primary);
  root.style.setProperty('--shadow-glow', `0 0 20px ${withAlpha(accent.primary, 0.18)}`);
}

export function setAccent(id: string): void {
  localStorage.setItem(ACCENT_KEY, id);
  applyAccent(id);
}

// ─── Boot ────────────────────────────────────────────────────────

/** Initialise theme + accent and start listening for OS theme changes. */
export function initTheme(): void {
  applyTheme();
  applyAccent();
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getThemeMode() === 'system') applyTheme('system');
  };
  if (mql.addEventListener) mql.addEventListener('change', onChange);
  else mql.addListener(onChange);
}
