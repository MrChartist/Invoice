import { useCallback, useEffect, useState } from 'react';
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

/** Light/dark theme. `index.html` applies the saved class before paint; this keeps it in sync. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#06080a' : '#f4f5f0');
  }, [theme]);

  const set = useCallback((next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* non-fatal: the choice just will not persist */
    }
  }, []);

  const toggle = useCallback(() => set(theme === 'dark' ? 'light' : 'dark'), [set, theme]);

  return { theme, setTheme: set, toggle };
}
