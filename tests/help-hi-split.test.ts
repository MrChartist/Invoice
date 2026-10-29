/**
 * PERF-6 (R21-P1): the Hindi of the help topics, the glossary and the screen tips leaves the English chunks at build
 * time (scripts/vite-hi-split.mjs `splitHelp`) and comes back through `src/lib/help/hi-tables.ts`. The rewrite keeps
 * every Hindi string (keyed by topic id / term / tip id), leaves no Devanagari in the English module, and fails loud;
 * the runtime puts the Hindi back, so a Hindi device (or a Devanagari Help search) still finds topics by Hindi title.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HELP_SPLIT, langChunkName, langPackOf, splitHelp, splitHindi } from '../scripts/vite-hi-split.mjs';
import { withHindi } from '../src/lib/help/hi-tables.ts';
import { GLOSSARY } from '../src/lib/help/glossary.ts';
import { TIPS } from '../src/lib/help/tips.ts';
import { TOPICS as sales } from '../src/lib/help/topics-sales.ts';
import { TOPICS as purchase } from '../src/lib/help/topics-purchase.ts';
import { TOPICS as books } from '../src/lib/help/topics-books.ts';
import { TOPICS as statutory } from '../src/lib/help/topics-statutory.ts';
import { TOPICS as packs } from '../src/lib/help/topics-packs.ts';
import { TOPICS as settings } from '../src/lib/help/topics-settings.ts';
import type { HelpTopic } from '../src/lib/help/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const DEVANAGARI = /[ऀ-ॿ]/;
const TOPIC_FILES: Record<string, readonly HelpTopic[]> = { sales, purchase, books, statutory, packs, settings };

test('topics: every hiTitle moves to a lang-hi-help module keyed by topic id; no Devanagari left', () => {
  for (const [area, topics] of Object.entries(TOPIC_FILES)) {
    const rel = `src/lib/help/topics-${area}.ts`;
    const r = splitHelp(read(rel), rel);
    assert.ok(r, rel);
    assert.doesNotMatch(r.code, DEVANAGARI, `${rel}: Devanagari left in the English module`);
    assert.match(r.code, /export const loadHi = \(\) => import\("virtual:hi\/help\/topics-[a-z]+~[0-9a-f]{8}"\);\n$/);
    const [m] = r.modules;
    assert.equal(m.family, 'help');
    assert.equal(langChunkName('\0' + m.id), 'lang-hi-help');
    assert.equal(langPackOf('\0' + m.id), 'hi');
    assert.deepEqual(m.data, Object.fromEntries(topics.map((x) => [x.id, x.hiTitle])), `${rel}: every Hindi title, by id`);
    assert.equal(splitHelp(read(rel), rel)?.modules[0].id, m.id, 'deterministic id');
  }
});

test('glossary and tips: Hindi definitions / tips move, keyed by term / tip id', () => {
  const g = splitHelp(read('src/lib/help/glossary.ts'), 'src/lib/help/glossary.ts');
  assert.ok(g);
  assert.doesNotMatch(g.code, DEVANAGARI);
  assert.deepEqual(g.modules[0].data, Object.fromEntries(Object.entries(GLOSSARY).map(([k, v]) => [k, [v.hi.def, v.hi.app]])));
  const t = splitHelp(read('src/lib/help/tips.ts'), 'src/lib/help/tips.ts');
  assert.ok(t);
  assert.doesNotMatch(t.code, DEVANAGARI);
  assert.deepEqual(t.modules[0].data, Object.fromEntries(TIPS.map((x) => [x.id, x.hi])));
});

test('the rewrite blanks only the Hindi arguments', () => {
  const code = "export const TOPICS = [t('a', 'A title', 'ए', 'What', 'When', { steps: ['x'] }), t('b:c', `B`, 'बी' + ' सी', 'W', 'W')];";
  const r = splitHelp(code, 'src/lib/help/topics-sales.ts');
  assert.ok(r);
  assert.ok(r.code.startsWith("export const TOPICS = [t('a', 'A title', \"\", 'What', 'When', { steps: ['x'] }), t('b:c', `B`, \"\", 'W', 'W')];"));
  assert.deepEqual(r.modules[0].data, { a: 'ए', 'b:c': 'बी सी' });
  const gl = splitHelp("export const GLOSSARY = { b2b: g('B2B', 'd', 'a', 'डी', 'ए', ['G13']), 'x-y': g('X', 'd', 'a', 'ड', 'ऐ') };", 'src/lib/help/glossary.ts');
  assert.ok(gl?.code.includes("b2b: g('B2B', 'd', 'a', \"\", \"\", ['G13'])"));
  assert.deepEqual(gl?.modules[0].data, { b2b: ['डी', 'ए'], 'x-y': ['ड', 'ऐ'] });
});

test('fails loud: a non-literal Hindi or key, a duplicate key, a listed file with no rows', () => {
  const f = 'src/lib/help/topics-sales.ts';
  assert.throws(() => splitHelp("t('a', 'A', HI, 'w', 'w')", f), /hi-split: src\/lib\/help\/topics-sales\.ts:1: .*string literal/);
  assert.throws(() => splitHelp("t(id, 'A', 'ए', 'w', 'w')", f), /key .* static string/);
  assert.throws(() => splitHelp("t('a', 'A', 'ए', 'w', 'w'); t('a', 'B', 'बी', 'w', 'w')", f), /duplicate key "a"/);
  assert.throws(() => splitHelp('export const TOPICS = [];', f), /no t\(…\) row found/);
  assert.throws(() => splitHelp("export const TIPS = [{ id: 'x', en: 'X', hi: HI }];", 'src/lib/help/tips.ts'), /string literal/);
});

test('only the listed help files are rewritten; they hold no defineArea', () => {
  assert.equal(splitHelp("t('a', 'A', 'ए', 'w', 'w')", 'src/lib/help/registry.ts'), null);
  assert.equal(splitHelp("t('a', 'A', 'ए', 'w', 'w')", 'src/components/help/Term.tsx'), null);
  assert.equal(HELP_SPLIT.length, 3);
  for (const rel of ['src/lib/help/glossary.ts', 'src/lib/help/tips.ts', ...Object.keys(TOPIC_FILES).map((a) => `src/lib/help/topics-${a}.ts`)]) {
    assert.ok(HELP_SPLIT.some((s) => s.re.test(rel)), rel);
    assert.equal(splitHindi(read(rel), rel), null, `${rel}: no defineArea`);
  }
});

test('the plugin rewrites help files before the defineArea split', () => {
  assert.match(read('scripts/vite-hi-split.mjs'), /const r = splitHelp\(code, rel\) \?\? splitHindi\(code, rel\);/);
});

test('withHindi: no loader (dev / tests) = inline Hindi; a loader fills on demand, once, and a failure keeps English', async () => {
  const none = await withHindi(undefined, () => assert.fail('nothing to apply'));
  await none();
  const topics = [{ id: 'a', hiTitle: '' }];
  let loads = 0;
  const fill = await withHindi(async () => {
    loads++;
    return { default: { a: 'ए' } };
  }, (hi) => {
    for (const x of topics) x.hiTitle = hi[x.id] || x.hiTitle;
  });
  assert.equal(topics[0].hiTitle, '', 'English interface: nothing loaded up front');
  await fill();
  await fill();
  assert.equal(topics[0].hiTitle, 'ए');
  assert.equal(loads, 1, 'loaded once');
  let tries = 0;
  const failing = await withHindi(async () => {
    tries++;
    throw new Error('offline');
  }, () => assert.fail('not applied'));
  await failing();
  await failing();
  assert.equal(tries, 2, 'a failed load is retried next time, never cached');
});

test('readers: Help search, palette, glossary term and tips ask for the Hindi (hi-tables) instead of reading it inline', () => {
  assert.match(read('src/lib/help/registry.ts'), /withHindi\(m\.loadHi,/);
  assert.match(read('src/lib/help/registry.ts'), /export async function helpIndex\(\{ hi = false \}/);
  assert.match(read('src/components/help/HelpSearch.tsx'), /helpIndex\(\{ hi: wantHi \}\)/);
  assert.match(read('src/components/command/CommandPalette.tsx'), /loadHelpIndex\(wantHelpHi\)/);
  assert.match(read('src/components/help/Term.tsx'), /withHindi\(m\.loadHi,/);
  assert.match(read('src/components/help/ScreenTip.tsx'), /withHindi\(\(tipsData as \{ loadHi\?: HiTableLoader<string> \}\)\.loadHi,/);
});
