/**
 * 5.4 Hindi-first i18n: catalogue parity, t() fallback / interpolation, device-local language
 * persistence (never in a backup), and the Hindi amount in words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const { en: enShell } = await import('../src/i18n/en.ts');
const { enPages } = await import('../src/i18n/en-pages.ts');
const en = { ...enShell, ...enPages };
const { hi } = await import('../src/i18n/hi.ts');
const i18n = await import('../src/i18n/index.ts');
const { LANG_KEY, DEVICE_LOCAL_KEYS, isLocalOnlyKey } = await import('../src/lib/storage.ts');
const { buildBackup, parseBackup } = await import('../src/lib/backup.ts');
const { amountInWordsHi, hindiNumberWords } = await import('../src/lib/amount-in-words-hi.ts');

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('catalogues: Hindi has exactly the English keys', () => {
  const enKeys = Object.keys(en).sort();
  const hiKeys = Object.keys(hi).sort();
  assert.deepEqual(hiKeys.filter((k) => !(k in en)), [], 'keys in hi that English does not have');
  assert.deepEqual(enKeys.filter((k) => !(k in hi)), [], 'keys missing from hi');
});

test('catalogues: every Hindi string is non-empty and keeps the same {placeholders}', () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const h = hi[key];
    assert.ok(typeof h === 'string' && h.trim().length > 0, `empty Hindi string for ${key}`);
    assert.deepEqual(placeholders(h), placeholders(en[key]), `placeholder mismatch for ${key}`);
  }
});

test('catalogues: Hindi strings are actually Hindi where English has words', () => {
  // Codes such as "UPI", "GST", "PIN" may stay Latin; anything long must contain Devanagari.
  const words = (s: string) => s.replace(/\{\w+\}/g, '').replace(/[^A-Za-z]+/g, ' ').trim();
  const latinOnly = Object.entries(hi).filter(([k, v]) => words(en[k as keyof typeof en]).length > 12 && !/[ऀ-ॿ]/.test(v));
  assert.deepEqual(latinOnly.map(([k]) => k), []);
});

test('catalogues: the shell and page English catalogues do not overlap', () => {
  const both = Object.keys(enShell).filter((k) => k in enPages);
  assert.deepEqual(both, []);
});

test('every module that uses a page key imports en-pages (so English never shows a raw key)', () => {
  const srcDir = new URL('../src/', import.meta.url).pathname;
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.tsx?$/.test(n) ? [join(d, n)] : []));
  const pageKeys = Object.keys(enPages);
  const offenders: string[] = [];
  for (const file of walk(srcDir)) {
    if (file.includes('/i18n/')) continue;
    const text = readFileSync(file, 'utf8');
    const uses = pageKeys.some((k) => text.includes(`'${k}'`));
    if (uses && !/i18n\/en-pages'/.test(text)) offenders.push(file.slice(srcDir.length));
  }
  assert.deepEqual(offenders, []);
});

test('the Hindi catalogue is a lazy chunk: nothing in the shell imports it statically', () => {
  const index = readFileSync(new URL('../src/i18n/index.ts', import.meta.url), 'utf8');
  assert.match(index, /import\('\.\/hi'\)/);
  assert.doesNotMatch(index, /from '\.\/hi'/);
});

test('t(): English by default, interpolates, leaves unknown placeholders alone', () => {
  i18n.resetI18nForTests();
  assert.equal(i18n.getLanguage(), 'en');
  assert.equal(i18n.t('nav.dashboard'), 'Dashboard');
  assert.equal(i18n.t('dash.lateMany', { n: 3 }), '3 days overdue');
  assert.equal(i18n.interpolate('Hi {name}, {missing}', { name: 'Asha' }), 'Hi Asha, {missing}');
  assert.equal(i18n.t('dash.collected', { pct: 0 }), '0% collected');
});

test('t(): a key missing from the active catalogue falls back to English, never the raw key', () => {
  i18n.setCatalogueForTests('hi', { 'nav.dashboard': 'डैशबोर्ड' });
  assert.equal(i18n.t('nav.dashboard'), 'डैशबोर्ड');
  assert.equal(i18n.t('nav.invoices'), 'Invoices');
  assert.equal(i18n.t('dash.lateMany', { n: 2 }), '2 days overdue');
  i18n.resetI18nForTests();
});

test('tMaybe / hasMessage: statuses translate, free text passes through', () => {
  i18n.setCatalogueForTests('hi', hi);
  assert.equal(i18n.tMaybe('status.', 'Paid'), 'भुगतान प्राप्त');
  assert.equal(i18n.tMaybe('status.', 'Accepted'), 'Accepted');
  assert.equal(i18n.hasMessage('status.Paid'), true);
  assert.equal(i18n.hasMessage('status.Nope'), false);
  i18n.resetI18nForTests();
});

test('tNodes keeps each language its own word order around a node', () => {
  i18n.setCatalogueForTests('hi', hi);
  const el = i18n.tNodes('common.typeToConfirm', { word: 'ERASE' }) as { props: { children: unknown[] } };
  assert.deepEqual(el.props.children, ['पुष्टि के लिए ', 'ERASE', ' टाइप करें']);
  i18n.resetI18nForTests();
});

test('setLanguage: lazy-loads Hindi, persists on this device, and initI18n restores it', async () => {
  store.clear();
  i18n.resetI18nForTests();
  await i18n.setLanguage('hi');
  assert.equal(i18n.getLanguage(), 'hi');
  assert.equal(i18n.t('nav.newInvoice'), 'नया इनवॉइस');
  assert.equal(store.get(LANG_KEY), 'hi');

  i18n.resetI18nForTests();
  assert.equal(i18n.t('nav.newInvoice'), 'New invoice');
  await i18n.initI18n();
  assert.equal(i18n.getLanguage(), 'hi');
  assert.equal(i18n.t('nav.newInvoice'), 'नया इनवॉइस');

  await i18n.setLanguage('en');
  assert.equal(store.get(LANG_KEY), 'en');
  assert.equal(i18n.t('nav.newInvoice'), 'New invoice');
});

test('readStoredLanguage: junk or a blocked store means English', () => {
  store.set(LANG_KEY, 'fr');
  assert.equal(i18n.readStoredLanguage(), 'en');
  store.set(LANG_KEY, 'hi');
  assert.equal(i18n.readStoredLanguage(), 'hi');
  store.delete(LANG_KEY);
  assert.equal(i18n.readStoredLanguage(), 'en');
});

test('the language key is device-local: kept in localStorage and never in a backup', () => {
  assert.equal(LANG_KEY, 'mrchartist_inv_lang');
  assert.ok(DEVICE_LOCAL_KEYS.includes(LANG_KEY));
  assert.equal(isLocalOnlyKey(LANG_KEY), true);

  store.clear();
  store.set('mrchartist_inv_invoices', '[]');
  store.set(LANG_KEY, 'hi');
  const backup = buildBackup(new Date('2026-10-01T00:00:00Z'));
  assert.ok(!JSON.stringify(backup).includes(LANG_KEY), 'buildBackup must not carry the language');

  const { data } = parseBackup(JSON.stringify({ mrchartist_inv_invoices: '[]', [LANG_KEY]: 'hi' }));
  assert.deepEqual(Object.keys(data), ['mrchartist_inv_invoices'], 'a backup carrying it must not restore it');
});

test('dateLocale: Hindi month names with Latin digits', () => {
  assert.equal(i18n.dateLocale('en'), 'en-IN');
  assert.equal(i18n.dateLocale('hi'), 'hi-IN-u-nu-latn');
  const s = new Date(2026, 9, 25).toLocaleDateString(i18n.dateLocale('hi'), { day: 'numeric', month: 'long' });
  assert.match(s, /25/);
});

// ── Amount in words (Hindi) ──────────────────────────────────────────

test('amountInWordsHi: edge cases', () => {
  assert.equal(amountInWordsHi(0), 'शून्य');
  assert.equal(amountInWordsHi(1), 'रुपये एक मात्र');
  assert.equal(amountInWordsHi(100), 'रुपये एक सौ मात्र');
  assert.equal(amountInWordsHi(100000), 'रुपये एक लाख मात्र');
  assert.equal(amountInWordsHi(123456789.05), 'रुपये बारह करोड़ चौंतीस लाख छप्पन हज़ार सात सौ नवासी और पाँच पैसे मात्र');
});

test('amountInWordsHi: paise, rounding, negatives, big crores, other currencies', () => {
  assert.equal(amountInWordsHi(0.5), 'रुपये शून्य और पचास पैसे मात्र');
  assert.equal(amountInWordsHi(19.999), 'रुपये बीस मात्र');
  assert.equal(amountInWordsHi(99999.995), 'रुपये एक लाख मात्र');
  assert.equal(amountInWordsHi(-250), 'ऋण रुपये दो सौ पचास मात्र');
  assert.equal(amountInWordsHi(1180), 'रुपये एक हज़ार एक सौ अस्सी मात्र');
  assert.equal(amountInWordsHi(1_20_00_00_000), 'रुपये एक सौ बीस करोड़ मात्र');
  assert.equal(amountInWordsHi(12.75, 'USD'), 'अमेरिकी डॉलर बारह और पचहत्तर सेंट मात्र');
  assert.equal(amountInWordsHi(Number.NaN), 'शून्य');
});

test('hindiNumberWords: the irregular 1-99 table is complete and in order', () => {
  const sample: Record<number, string> = { 11: 'ग्यारह', 29: 'उनतीस', 45: 'पैंतालीस', 59: 'उनसठ', 67: 'सड़सठ', 79: 'उन्यासी', 89: 'नवासी', 99: 'निन्यानवे' };
  for (const [n, w] of Object.entries(sample)) assert.equal(hindiNumberWords(Number(n)), w);
  const words = Array.from({ length: 99 }, (_, i) => hindiNumberWords(i + 1));
  assert.equal(new Set(words).size, 99, 'every number 1-99 has its own word');
  assert.equal(hindiNumberWords(1001), 'एक हज़ार एक');
  assert.equal(hindiNumberWords(10_00_000), 'दस लाख');
});
