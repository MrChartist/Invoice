/**
 * R16-A1: the Hindi build transform (scripts/vite-hi-split.mjs). Fixtures for the rewrite, the fail-loud rule, the
 * family names and the chunk names; a sweep of every `defineArea` call in src/ (all static, none skipped); and the
 * `HI_INLINE` rule: code that reads `someT.hi` directly must name an area whose Hindi stays inline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { HI_INLINE, familyOf, langChunkName, langManifest, langPackOf, splitHindi } from '../scripts/vite-hi-split.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const SRC = walk(join(ROOT, 'src'));

test('rewrites the Hindi object into a loader of a virtual module (object, template, as const, concatenation, quoted keys)', () => {
  const code = [
    "import { defineArea } from '../area';",
    "export const gstT = defineArea({ title: 'GST returns', 'err.x': 'Bad', due: 'Due {date}' } as const,",
    "  { title: `GST रिटर्न`, 'err.x': 'गलत', due: '{date} ' + 'तक' } as const);",
  ].join('\n');
  const r = splitHindi(code, 'src/i18n/areas/gst-views.ts');
  assert.ok(r);
  assert.equal(r.modules.length, 1);
  const [m] = r.modules;
  assert.match(m.id, /^virtual:hi\/gst\/gst-views~[0-9a-f]{8}$/);
  assert.deepEqual(m.data, { title: 'GST रिटर्न', 'err.x': 'गलत', due: '{date} तक' });
  assert.ok(r.code.includes(`() => import(${JSON.stringify(m.id)})`));
  assert.doesNotMatch(r.code, /[\u0900-\u097F]/, 'no Devanagari left in the English module');
  assert.ok(r.code.includes("{ title: 'GST returns', 'err.x': 'Bad', due: 'Due {date}' } as const"), 'English untouched');
  // Deterministic ids (stable chunk hashes between builds).
  assert.equal(splitHindi(code, 'src/i18n/areas/gst-views.ts')?.modules[0].id, m.id);
});

test('several calls in one file (a component) get one module each, under the folder family', () => {
  const code = "const a = defineArea({ t: 'A' } as const, { t: 'ए' });\nconst b = defineArea({ t: 'B' }, { t: 'बी' });";
  const r = splitHindi(code, 'src/components/dashboard/DashboardTiles.tsx');
  assert.equal(r?.modules.length, 2);
  assert.ok(r?.modules.every((m) => m.family === 'dashboard'));
  assert.notEqual(r?.modules[0].id, r?.modules[1].id);
});

test('fails loud on a Hindi argument that is not a static object of string literals', () => {
  const bad = [
    "defineArea({ a: 'A' }, HI_TABLE)",
    "defineArea({ a: 'A' }, { ...base, a: 'ए' })",
    "defineArea({ a: 'A' }, { a: `ए ${n}` })",
    "defineArea({ a: 'A' }, { a: label('x') })",
    "defineArea({ a: 'A' }, { [key]: 'ए' })",
    "defineArea({ a: 'A' })",
  ];
  for (const call of bad) {
    assert.throws(() => splitHindi(`const x = ${call};`, 'src/i18n/areas/books.ts'), /hi-split: src\/i18n\/areas\/books\.ts:1/, call);
  }
});

test('HI_INLINE files and files without defineArea are left alone', () => {
  for (const f of HI_INLINE) assert.equal(splitHindi("const g = defineArea({ a: 'A' }, { a: 'ए' });", f), null, f);
  assert.equal(splitHindi('export const x = 1;', 'src/lib/x.ts'), null);
  assert.equal(splitHindi("// defineArea( in a comment only\nexport const y = 2;", 'src/lib/y.ts'), null);
});

test('family names: area prefix up to the first "-" segment; elsewhere the folder name', () => {
  assert.equal(familyOf('src/i18n/areas/prof-r14a-matters.ts'), 'prof');
  assert.equal(familyOf('src/i18n/areas/gst-views.ts'), 'gst');
  assert.equal(familyOf('src/i18n/areas/books-ledger.ts'), 'books');
  assert.equal(familyOf('src/i18n/areas/extras-7u.ts'), 'extras');
  assert.equal(familyOf('src/i18n/areas/agri-r12a.ts'), 'agri');
  assert.equal(familyOf('src/i18n/areas/bank.ts'), 'bank');
  assert.equal(familyOf('src/components/dashboard/DashboardTiles.tsx'), 'dashboard');
  assert.equal(familyOf('src/pages/Books.tsx'), 'pages');
  assert.equal(familyOf('src/lib/services/sv-hooks.ts'), 'services');
});

test('chunk names and packs: lang-hi-<family>, lang-hi-core (hi.ts), lang-regional; app code is in no pack', () => {
  assert.equal(langChunkName('\0virtual:hi/gst/gst-views~12345678'), 'lang-hi-gst');
  assert.equal(langChunkName('/x/src/i18n/hi.ts'), 'lang-hi-core');
  assert.equal(langChunkName('C:\\x\\src\\i18n\\regional.ts'), 'lang-regional');
  assert.equal(langChunkName('/x/src/i18n/mr.ts'), 'lang-regional');
  assert.equal(langChunkName('/x/src/i18n/index.ts'), null);
  assert.equal(langChunkName('/x/src/i18n/areas/gst.ts'), null, 'the English area module stays in the app');
  assert.equal(langPackOf('\0virtual:hi/gst/gst~1'), 'hi');
  assert.equal(langPackOf('/x/src/i18n/hi.ts'), 'hi');
  assert.equal(langPackOf('/x/src/i18n/kn.ts'), 'regional');
  assert.equal(langPackOf('/x/src/lib/hi.ts'), null);
});

test('lang-manifest: packs from chunk module ids; a chunk mixing pack and app modules fails the build', () => {
  const bundle = {
    'assets/lang-hi-gst-a.js': { type: 'chunk', fileName: 'assets/lang-hi-gst-a.js', modules: { '\0virtual:hi/gst/x~1': {} } },
    'assets/lang-hi-core-b.js': { type: 'chunk', fileName: 'assets/lang-hi-core-b.js', modules: { '/x/src/i18n/hi.ts': {} } },
    'assets/lang-regional-c.js': { type: 'chunk', fileName: 'assets/lang-regional-c.js', modules: { '/x/src/i18n/regional.ts': {}, '/x/src/i18n/mr.ts': {} } },
    'assets/Books-d.js': { type: 'chunk', fileName: 'assets/Books-d.js', modules: { '/x/src/pages/Books.tsx': {} } },
    'assets/x.css': { type: 'asset', fileName: 'assets/x.css' },
  };
  assert.deepEqual(langManifest(bundle), { hi: ['assets/lang-hi-core-b.js', 'assets/lang-hi-gst-a.js'], regional: ['assets/lang-regional-c.js'] });
  const mixed = { 'assets/m.js': { type: 'chunk', fileName: 'assets/m.js', modules: { '\0virtual:hi/gst/x~1': {}, '/x/src/lib/utils.ts': {} } } };
  assert.throws(() => langManifest(mixed), /mixes language-pack modules with app code/);
});

test('every defineArea call in src/ is static: all of them move, none skipped outside HI_INLINE', () => {
  let moved = 0;
  for (const file of SRC) {
    const r = rel(file);
    if (r === 'src/i18n/area.ts') continue;
    const out = splitHindi(readFileSync(file, 'utf8'), r);
    if (out) moved += out.modules.length;
  }
  assert.ok(moved >= 200, `expected 200+ moved calls, got ${moved}`);
});

test('readers of `someT.hi` name an area in HI_INLINE (a bilingual print must keep its Hindi inline)', () => {
  const readers: string[] = [];
  for (const file of SRC) {
    const code = readFileSync(file, 'utf8');
    const names = new Set([...code.matchAll(/\b(\w+T)\.hi\b|\b(\w+T)\.hi\[/g)].map((m) => m[1] ?? m[2]));
    for (const name of names) {
      const imp = new RegExp(String.raw`import\s*\{[^}]*\b${name}\b[^}]*\}\s*from\s*'([^']+)'`).exec(code);
      const area = imp ? rel(resolve(dirname(file), imp[1]) + '.ts') : rel(file);
      readers.push(`${rel(file)} → ${area}`);
      // R20-A: the cheat sheet searches Hindi on an English screen after `keysT.load()` (it reads `.hi` once loaded, and
      // falls back to English until then): a reader that loads the pack itself needs no inline Hindi.
      const loads = SRC.some((f) => new RegExp(String.raw`\b${name}\.load\(`).test(readFileSync(f, 'utf8')));
      assert.ok(HI_INLINE.includes(area) || loads, `${rel(file)} reads ${name}.hi directly: add ${area} to HI_INLINE in scripts/vite-hi-split.mjs`);
    }
  }
  assert.ok(readers.length >= 2, `the Gateway menu and the works paper read .hi (${readers.join('; ')})`);
});
