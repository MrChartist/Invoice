/**
 * R2-C6 display preferences: parse / clamp / defaults, device-local storage, and the pre-paint
 * script `public/theme-init.js` producing exactly the classes `displayClasses` does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  DEFAULT_DISPLAY_PREFS,
  DISPLAY_CLASSES,
  DISPLAY_PREFS_KEY,
  applyDisplayPrefs,
  clampTextScale,
  displayClasses,
  loadDisplayPrefs,
  normalizeDisplayPrefs,
  rootFontPx,
  saveDisplayPrefs,
} from '../src/lib/display-prefs.ts';
import { DB_PREFIX } from '../src/lib/storage.ts';

const memStore = () => {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
};

test('clamp: 90–130 in steps of 10, junk → 100', () => {
  assert.equal(clampTextScale(130), 130);
  assert.equal(clampTextScale(200), 130);
  assert.equal(clampTextScale(50), 90);
  assert.equal(clampTextScale(114), 110);
  assert.equal(clampTextScale(116), 120);
  assert.equal(clampTextScale('120'), 120);
  assert.equal(clampTextScale('abc'), 100);
  assert.equal(clampTextScale(undefined), 100);
  assert.equal(clampTextScale(NaN), 100);
  assert.equal(rootFontPx({ text_scale: 130 }), 20.8);
  assert.equal(rootFontPx({ text_scale: 100 }), 16);
});

test('normalise: defaults for anything missing or malformed', () => {
  assert.deepEqual(normalizeDisplayPrefs(null), DEFAULT_DISPLAY_PREFS);
  assert.deepEqual(normalizeDisplayPrefs('x'), DEFAULT_DISPLAY_PREFS);
  assert.deepEqual(normalizeDisplayPrefs([1]), DEFAULT_DISPLAY_PREFS);
  const p = normalizeDisplayPrefs({ text_scale: 125, high_contrast: 'yes', motion: 'fast', underline_links: true });
  assert.equal(p.text_scale, 130);
  assert.equal(p.high_contrast, false, 'only a real boolean turns it on');
  assert.equal(p.motion, 'system');
  assert.equal(p.underline_links, true);
  assert.deepEqual(displayClasses(DEFAULT_DISPLAY_PREFS), [], 'defaults add no class');
});

test('device-local key outside the backed-up prefix; defaults remove it; bad JSON is ignored', () => {
  assert.ok(!DISPLAY_PREFS_KEY.startsWith(DB_PREFIX), 'never collected by a backup or folder sync');
  const s = memStore();
  saveDisplayPrefs({ ...DEFAULT_DISPLAY_PREFS, text_scale: 120, focus_always: true }, s);
  assert.deepEqual(loadDisplayPrefs(s), { ...DEFAULT_DISPLAY_PREFS, text_scale: 120, focus_always: true });
  saveDisplayPrefs(DEFAULT_DISPLAY_PREFS, s);
  assert.equal(s.m.has(DISPLAY_PREFS_KEY), false);
  s.m.set(DISPLAY_PREFS_KEY, '{oops');
  assert.deepEqual(loadDisplayPrefs(s), DEFAULT_DISPLAY_PREFS);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  assert.deepEqual(loadDisplayPrefs(throwing), DEFAULT_DISPLAY_PREFS);
  assert.doesNotThrow(() => saveDisplayPrefs({ ...DEFAULT_DISPLAY_PREFS, high_contrast: true }, throwing));
});

test('applyDisplayPrefs swaps the classes on <html>', () => {
  const set = new Set<string>(['dark', 'a11y-text-90']);
  const root = { classList: { add: (c: string) => void set.add(c), remove: (c: string) => void set.delete(c) } as unknown as DOMTokenList };
  applyDisplayPrefs({ ...DEFAULT_DISPLAY_PREFS, text_scale: 130, motion: 'reduce' }, root);
  assert.deepEqual([...set].sort(), ['a11y-motion-reduce', 'a11y-text-130', 'dark']);
  for (const c of displayClasses({ text_scale: 120, high_contrast: true, motion: 'full', underline_links: true, large_targets: true, focus_always: true })) {
    assert.ok(DISPLAY_CLASSES.includes(c), `${c} is removable`);
  }
});

/** Run public/theme-init.js against a stub document and return the classes it added. */
function runThemeInit(stored: string | null): string[] {
  const src = readFileSync(join(import.meta.dirname, '../public/theme-init.js'), 'utf8');
  const classes = new Set<string>();
  const ctx = {
    localStorage: { getItem: (k: string) => (k === DISPLAY_PREFS_KEY ? stored : k === 'theme' ? 'light' : null) },
    window: { matchMedia: () => ({ matches: false }) },
    document: {
      documentElement: { classList: { add: (c: string) => void classes.add(c) }, lang: 'en' },
      querySelector: () => null,
    },
    JSON,
    Math,
    Number,
    isFinite,
  };
  vm.runInNewContext(src, ctx);
  return [...classes].sort();
}

test('theme-init.js (pre-paint, CSP-safe external file) adds the same classes as displayClasses', () => {
  const cases: unknown[] = [
    null,
    { text_scale: 130 },
    { text_scale: 90, high_contrast: true, motion: 'reduce' },
    { text_scale: 116, motion: 'full', underline_links: true, large_targets: true, focus_always: true },
    { text_scale: 'abc', high_contrast: 'yes' },
    { text_scale: 999 },
  ];
  for (const c of cases) {
    const raw = c === null ? null : JSON.stringify(c);
    assert.deepEqual(runThemeInit(raw), displayClasses(normalizeDisplayPrefs(c)).sort(), JSON.stringify(c));
  }
  assert.deepEqual(runThemeInit('{broken'), [], 'corrupt JSON is ignored');
});
