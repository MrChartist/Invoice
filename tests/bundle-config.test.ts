/**
 * R15-A1 / R16-A: the code-splitting config is pinned. vendor-react / vendor-ui keep their names (long-term caching),
 * the language packs come first (R16-A1), every first-paint app module lands in ONE `app-initial` ($initial) group,
 * the R16-A2 family and lazy-leaves groups are "safe" (graph maths tested here), and no group can capture the PDF stack.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI_LEAF, createGraph, familyRe, initialSet, isLeaf, leafGroup, safeFamilyGroup, safeSet } from '../scripts/vite-safe-groups.mjs';
import { preloadTrim } from '../scripts/vite-preload-trim.mjs';

const cfg = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
type Group = { name: string | ((id: string, ctx?: unknown) => string | null); test?: RegExp; tags?: string[]; priority?: number; maxModuleSize?: number };
const config = (await import('../vite.config.ts')).default as {
  build: { rolldownOptions: { output: { codeSplitting: { groups: Group[] } } } };
  css: { modules: { generateScopedName: (name: string, file: string, css: string) => string } };
};
const groups = config.build.rolldownOptions.output.codeSplitting.groups;
const PDF = ['/x/node_modules/jspdf/dist/jspdf.es.min.js', '/x/node_modules/html-to-image/es/index.js'];

test('Vite 8 rolldown options with codeSplitting.groups, no manualChunks / rollupOptions', () => {
  assert.match(cfg, /rolldownOptions:/);
  assert.match(cfg, /codeSplitting:\s*\{/);
  assert.doesNotMatch(cfg, /manualChunks\s*\(/);
  assert.doesNotMatch(cfg, /rollupOptions\s*:/);
  assert.match(cfg, /plugins: \[react\(\), cspMeta\(\), hiSplit\(\), graphPlugin\(graph\), preload\.plugin\]/, 'the Hindi split, the graph and the preload-trim plugins are wired');
});

test('the groups, in order, with their priorities', () => {
  const families = [...cfg.matchAll(/safeFamilyGroup\(graph, '(f-[a-z]+)', familyRe\([^)]*\), (\d+)\)/g)].map((m) => [m[1], Number(m[2])]);
  assert.deepEqual(families.map(([n]) => n), ['f-hotel', 'f-trade', 'f-retail', 'f-services', 'f-cn', 'f-agri', 'f-mfg', 'f-prof', 'f-travel', 'f-manpower', 'f-society', 'f-logistics', 'f-keys']); // R17-A: f-manpower; R18-A: f-society; R19-A: f-logistics; R20-A: f-keys
  assert.ok(families.every(([, p]) => p === 12), 'families at priority 12');
  assert.match(cfg, /leafGroup\(graph, 'lazy-leaves', 9, \{ maxModuleSize: 3000 \}\)/);
  assert.match(cfg, /leafGroup\(graph, 'lazy-leaves-ui', 8, \{ maxModuleSize: 1500, test: UI_LEAF \}\)/, 'PERF-5');
  const names = groups.map((g) => (typeof g.name === 'string' ? g.name : g.name.name));
  assert.deepEqual(names.slice(0, 4), ['vendor-react', 'vendor-ui', 'langChunkName', 'app-initial']);
  assert.deepEqual(groups.map((g) => g.priority), [30, 30, 25, 20, ...families.map(() => 12), 9, 8]);
  assert.deepEqual(groups[3].tags, ['$initial']);
  assert.equal(groups[3].test, undefined, 'app-initial is selected by tag only');
  assert.equal(groups.at(-2)?.maxModuleSize, 3000);
  assert.equal(groups.at(-1)?.maxModuleSize, 1500);
});

test('every group has a filter (test, tags or a name function); none can capture the PDF stack', () => {
  for (const g of groups) {
    assert.ok(g.test || g.tags?.length || typeof g.name === 'function', `${String(g.name)} has no filter`);
    for (const id of PDF) {
      assert.ok(!g.test?.test(id), `${String(g.name)} test must not capture ${id}`);
      if (typeof g.name === 'function') assert.equal(g.name(id, { getModuleInfo: () => null }), null, `${g.name.name} must not capture ${id}`);
    }
  }
});

test('vendor tests still match their packages', () => {
  const [react, ui] = groups;
  assert.ok(react.test?.test('/x/node_modules/react-dom/index.js'));
  assert.ok(react.test?.test('C:\\x\\node_modules\\scheduler\\index.js'));
  assert.ok(ui.test?.test('/x/node_modules/lucide-react/dist/x.js'));
  assert.ok(ui.test?.test('/x/node_modules/zustand/esm/react.mjs'));
  assert.ok(ui.test?.test('/x/node_modules/clsx/dist/clsx.mjs'));
});

test('PERF-4: qrcode.react is not a first-paint vendor (only lazy templates / POS / statements import it)', () => {
  const [react, ui] = groups;
  const qr = '/x/node_modules/qrcode.react/lib/esm/index.js';
  assert.ok(!ui.test?.test(qr) && !react.test?.test(qr), 'qrcode.react must stay out of vendor-ui / vendor-react (−5.6 kB gz first paint)');
});

test('PERF-5: 7-character file hashes, first-paint files trimmed from the dynamic-import preload lists', () => {
  for (const k of ['entryFileNames', 'chunkFileNames']) assert.match(cfg, new RegExp(`${k}: 'assets/\\[name\\]-\\[hash:7\\]\\.js'`));
  assert.match(cfg, /assetFileNames: 'assets\/\[name\]-\[hash:7\]\[extname\]'/);
  assert.match(cfg, /modulePreload: \{ resolveDependencies: preload\.resolveDependencies \}/);
  const { plugin, resolveDependencies, firstPaint } = preloadTrim();
  type Chunk = { type: 'chunk'; fileName: string; isEntry: boolean; imports: string[] };
  const chunk = (fileName: string, imports: string[] = [], isEntry = false): Chunk => ({ type: 'chunk', fileName, isEntry, imports });
  const bundle: Record<string, Chunk | { type: 'asset'; fileName: string }> = {
    'assets/index-a.js': chunk('assets/index-a.js', ['assets/rolldown-runtime-b.js', 'assets/vendor-react-c.js'], true),
    'assets/rolldown-runtime-b.js': chunk('assets/rolldown-runtime-b.js'),
    'assets/vendor-react-c.js': chunk('assets/vendor-react-c.js', ['assets/rolldown-runtime-b.js']),
    'assets/Lazy-d.js': chunk('assets/Lazy-d.js', ['assets/index-a.js', 'assets/shared-e.js']),
    'assets/shared-e.js': chunk('assets/shared-e.js', ['assets/vendor-react-c.js']),
    'assets/index-a.css': { type: 'asset', fileName: 'assets/index-a.css' },
  };
  const gen = plugin.generateBundle as { order: string; handler: (o: unknown, b: typeof bundle) => void };
  assert.equal(gen.order, 'pre', 'runs before Vite writes the preload lists');
  gen.handler({}, bundle);
  assert.deepEqual([...firstPaint].sort(), ['assets/index-a.js', 'assets/rolldown-runtime-b.js', 'assets/vendor-react-c.js']);
  const deps = ['assets/Lazy-d.js', 'assets/index-a.js', 'assets/shared-e.js', 'assets/vendor-react-c.js', 'assets/rolldown-runtime-b.js'];
  assert.deepEqual(resolveDependencies('assets/Lazy-d.js', deps, { hostId: 'assets/x.js', hostType: 'js' }), ['assets/Lazy-d.js', 'assets/shared-e.js']);
  assert.deepEqual(resolveDependencies('assets/index-a.js', deps, { hostId: 'index.html', hostType: 'html' }), deps, 'the HTML modulepreload links are untouched');
});

test('PERF-5: CSS-module class names are `_<local>_<6-char file hash>` (no line number)', () => {
  const name = config.css.modules.generateScopedName;
  const a = '.row { color: red }\n.head { color: blue }';
  const b = '.row { color: green }';
  assert.match(name('row', '/x/a.module.css', a), /^_row_[A-Za-z0-9_-]{6}$/);
  assert.equal(name('row', '/x/a.module.css', a).slice(-6), name('head', '/x/a.module.css', a).slice(-6), 'one hash per file (compresses)');
  assert.notEqual(name('row', '/x/a.module.css', a), name('row', '/x/b.module.css', b), 'same local name in two files stays apart');
});

test('bundle-size script: entry 100 kB, initial 185 kB, ≤ 5 initial files, core 3,300, Hindi 400, regional 25, leak 36', () => {
  const s = readFileSync(new URL('../scripts/check-bundle-size.mjs', import.meta.url), 'utf8');
  assert.match(s, /BUDGET_INITIAL_GZ_KB', 185\)/);
  assert.match(s, /BUDGET_ENTRY_GZ_KB', 100\)/);
  assert.match(s, /BUDGET_INITIAL_FILES', 5\)/);
  assert.match(s, /BUDGET_TOTAL_GZ_KB', 3300\)/);
  assert.match(s, /BUDGET_LANG_HI_GZ_KB', 400\)/);
  assert.match(s, /BUDGET_LANG_REGIONAL_GZ_KB', 25\)/);
  assert.match(s, /BUDGET_HI_LEAK_GZ_KB', 36\)/);
  assert.match(s, /HI_LEAK_PER_CHUNK_KB = 1;/);
  assert.match(s, /LEAVES_MAX_KB = 20;/);
});

// ── safe-group graph maths ────────────────────────────────────────────────────────────────────────────
const P = '/app/';
const VENDOR = /node_modules[\\/]react[\\/]/;
function graphOf(edges: Record<string, string[]>, entries: string[]) {
  const g = createGraph({ vendor: [VENDOR], root: P });
  for (const [id, deps] of Object.entries(edges)) g.imports.set(P + id, deps.map((d) => (d.startsWith('/') ? d : P + d)));
  for (const e of entries) g.entries.add(P + e);
  return g;
}
const FAM = familyRe('trade', 'trading-rules', 'trade-r8');

test('R17-A: familyRe leaves the named basenames out of the family', () => {
  const re = familyRe('manpower', 'manpower-rules', 'manpower-r17', 'mp-registry');
  assert.ok(re.test('/x/src/lib/manpower/mp-regime.ts') && re.test('/x/src/lib/manpower-rules.ts') && re.test('/x/src/i18n/areas/manpower-r17a.ts'));
  assert.ok(!re.test('/x/src/lib/manpower/mp-registry.ts') && !re.test('/x/src/i18n/areas/manpower-r17a-pick.ts'));
  assert.ok(re.test('/x/src/lib/manpower/mp-registry-x.ts'), 'only the exact basename');
});
test('R18-A: the f-society family captures the engines, rules and areas; not the registry or the -pick areas', () => {
  const re = familyRe('society', 'society-rules', 'society-r18', 'hs-registry');
  assert.ok(re.test('/x/src/lib/society/hs-bill.ts') && re.test('/x/src/lib/society-rules.ts') && re.test('/x/src/i18n/areas/society-r18a.ts'));
  assert.ok(!re.test('/x/src/lib/society/hs-registry.ts') && !re.test('/x/src/i18n/areas/society-r18a-pick.ts'));
});
test('R19-A: the f-logistics family captures the engines, rules and areas; not the registry or the -pick areas', () => {
  const re = familyRe('logistics', 'logistics-rules', 'logistics-r19', 'lg-registry');
  assert.ok(re.test('/x/src/lib/logistics/lg-job.ts') && re.test('/x/src/lib/logistics-rules.ts') && re.test('/x/src/i18n/areas/logistics-r19a.ts'));
  assert.ok(!re.test('/x/src/lib/logistics/lg-registry.ts') && !re.test('/x/src/i18n/areas/logistics-r19a-pick.ts'));
});
test('R20-A: the f-keys family captures the key engine, registry and labels (the first-paint stub stays in app-initial); not components', () => {
  const re = familyRe('keys', null, 'keys-r20');
  assert.ok(re.test('/x/src/lib/keys/engine.ts') && re.test('/x/src/lib/keys/registry.ts') && re.test('/x/src/i18n/areas/keys-r20a.ts'));
  assert.ok(!re.test('/x/src/components/keys/KeysHost.tsx'), 'components import CSS modules: their own chunks');
  assert.ok(!re.test('/x/src/lib/pos-keys.ts') && !re.test('/x/src/components/creator/line-keys.ts'));
});
const fam = (id: string) => FAM.test(id);

test('$initial = static closure of the entries', () => {
  const g = graphOf({ 'src/main.tsx': ['src/lib/utils.ts'], 'src/lib/utils.ts': [], 'src/lib/books.ts': ['src/lib/utils.ts'] }, ['src/main.tsx']);
  assert.deepEqual([...initialSet(g)].sort(), [P + 'src/lib/utils.ts', P + 'src/main.tsx']);
});

test('a family module is safe only if everything it imports is first paint, vendor or a safe family module', () => {
  const g = graphOf({
    'src/main.tsx': ['src/lib/utils.ts'],
    'src/lib/utils.ts': [],
    'src/lib/books.ts': [],
    'src/lib/trade/a.ts': ['src/lib/utils.ts', '/x/node_modules/react/index.js', 'src/lib/trade/b.ts'],
    'src/lib/trade/b.ts': ['src/lib/trading-rules.ts'],
    'src/lib/trading-rules.ts': [],
    'src/lib/trade/c.ts': ['src/lib/books.ts'], // imports shared lazy code: would drag Books in
    'src/lib/trade/d.ts': ['src/lib/trade/c.ts'], // depends on an unsafe family module
    'src/i18n/areas/trade-r8a.ts': ['src/lib/utils.ts'],
    'src/i18n/areas/trade-r8-pick.ts': [], // the wizard's area: never a family member
  }, ['src/main.tsx']);
  const safe = [...safeSet(g, fam)].map((id) => id.slice(P.length)).sort();
  assert.deepEqual(safe, ['src/i18n/areas/trade-r8a.ts', 'src/lib/trade/a.ts', 'src/lib/trade/b.ts', 'src/lib/trading-rules.ts']);
});

test('cycles: a strongly connected component passes only as a whole', () => {
  const g = graphOf({
    'src/main.tsx': [],
    'src/lib/shared.ts': [],
    'src/lib/trade/x.ts': ['src/lib/trade/y.ts'],
    'src/lib/trade/y.ts': ['src/lib/trade/x.ts'],
    'src/lib/trade/p.ts': ['src/lib/trade/q.ts'],
    'src/lib/trade/q.ts': ['src/lib/trade/p.ts', 'src/lib/shared.ts'], // one member drags lazy code: both out
    'src/lib/trade/r.ts': ['src/lib/trade/p.ts'],
  }, ['src/main.tsx']);
  const safe = [...safeSet(g, fam)].map((id) => id.slice(P.length)).sort();
  assert.deepEqual(safe, ['src/lib/trade/x.ts', 'src/lib/trade/y.ts']);
});

test('group name functions: the family name for safe members, lazy-leaves for small lib leaves, else null', () => {
  const g = graphOf({
    'src/main.tsx': ['src/lib/utils.ts'],
    'src/lib/utils.ts': [],
    'src/lib/books.ts': [],
    'src/lib/leaf.ts': ['src/lib/utils.ts'],
    'src/lib/notleaf.ts': ['src/lib/books.ts'],
    'src/components/X.tsx': ['src/lib/utils.ts'],
    'src/lib/trade/a.ts': [],
  }, ['src/main.tsx']);
  const f = safeFamilyGroup(g, 'f-trade', FAM, 12);
  const l = leafGroup(g, 'lazy-leaves', 9, { maxModuleSize: 3000 });
  assert.equal(f.name(P + 'src/lib/trade/a.ts'), 'f-trade');
  assert.equal(f.name(P + 'src/lib/leaf.ts'), null);
  assert.equal(l.name(P + 'src/lib/leaf.ts'), 'lazy-leaves');
  assert.equal(l.name(P + 'src/lib/notleaf.ts'), null, 'imports lazy code');
  assert.equal(l.name(P + 'src/lib/utils.ts'), null, 'first paint');
  assert.equal(l.name(P + 'src/components/X.tsx'), null, 'src/lib only');
  assert.ok(isLeaf(g, P + 'src/lib/books.ts'), 'no imports at all is a leaf');
  assert.equal(l.maxModuleSize, 3000);
  assert.equal(g.families.get('f-trade'), FAM, 'recorded for build-meta/chunks.json');
});

test('PERF-5: lazy-leaves-ui takes small script leaves outside src/lib, never a stylesheet', () => {
  const g = graphOf({
    'src/main.tsx': ['src/lib/utils.ts'],
    'src/lib/utils.ts': [],
    'src/lib/leaf.ts': ['src/lib/utils.ts'],
    'src/components/X.tsx': ['src/lib/utils.ts'],
    'src/components/Y.tsx': ['src/components/y.module.css'],
    'src/components/y.module.css': [],
    'src/store/pick.ts': [],
    'src/hooks/useX.ts': [],
    'src/i18n/areas/nodes.ts': ['src/lib/utils.ts'],
    'src/pages/Page.tsx': [],
  }, ['src/main.tsx']);
  const u = leafGroup(g, 'lazy-leaves-ui', 8, { maxModuleSize: 1500, test: UI_LEAF });
  for (const id of ['src/components/X.tsx', 'src/store/pick.ts', 'src/hooks/useX.ts', 'src/i18n/areas/nodes.ts']) assert.equal(u.name(P + id), 'lazy-leaves-ui', id);
  assert.equal(u.name(P + 'src/components/Y.tsx'), null, 'imports a lazy CSS module');
  assert.equal(u.name(P + 'src/components/y.module.css'), null, 'a stylesheet never joins');
  assert.equal(u.name(P + 'src/lib/leaf.ts'), null, 'src/lib leaves stay in lazy-leaves');
  assert.equal(u.name(P + 'src/pages/Page.tsx'), null, 'routes stay their own chunks');
  assert.equal(u.maxModuleSize, 1500);
});
