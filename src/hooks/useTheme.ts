import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { THEME_KEY } from '../lib/storage';

export type Theme = 'light' | 'dark';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage blocked — fall back to the system preference */
  }
  return systemPrefersDark() ? 'dark' : 'light';
}

// One shared store so every useTheme() consumer (top bar, Settings → Defaults, …) stays in sync.
let current: Theme = typeof window === 'undefined' ? 'light' : readTheme();
const listeners = new Set<() => void>();

/** Browser chrome colour = --bg-grouped (src/styles/ios.css); public/theme-init.js writes the same two at first paint. */
const THEME_COLOR = { light: '#f2f2f7', dark: '#000000' } as const;

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light);
}

function setShared(next: Theme) {
  if (next === current) return;
  current = next;
  apply(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* non-fatal: the choice just will not persist */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Light/dark theme. `index.html` applies the saved class before paint; this keeps it in sync. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current, () => 'light' as Theme);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const set = useCallback((next: Theme) => setShared(next), []);
  const toggle = useCallback(() => setShared(current === 'dark' ? 'light' : 'dark'), []);

  return { theme, setTheme: set, toggle };
}
