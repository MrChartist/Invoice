/**
 * R15-A1: the code-splitting config is pinned. vendor-react / vendor-ui keep their names (long-term caching), every
 * first-paint app module lands in ONE `app-initial` ($initial) group, and no group can capture the PDF stack.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const groupsSrc = cfg.slice(cfg.indexOf('groups: ['), cfg.indexOf('\n          ],', cfg.indexOf('groups: [')));
const groups = [...groupsSrc.matchAll(/\{\s*name:\s*'([^']+)'([^}]*)\}/g)].map((m) => {
  const body = m[2];
  const test = body.match(/test:\s*\/(.+?)\/,\s*priority/)?.[1];
  return {
    name: m[1],
    priority: Number(body.match(/priority:\s*(\d+)/)?.[1]),
    tags: body.match(/tags:\s*\[([^\]]*)\]/)?.[1],
    test: test ? new RegExp(test) : undefined,
  };
});

test('Vite 8 rolldown options with codeSplitting.groups, no manualChunks / rollupOptions', () => {
  assert.match(cfg, /rolldownOptions:/);
  assert.match(cfg, /codeSplitting:\s*\{/);
  assert.doesNotMatch(cfg, /manualChunks\s*\(/);
  assert.doesNotMatch(cfg, /rollupOptions\s*:/);
});

test('the three groups, their priorities and the $initial tag', () => {
  assert.deepEqual(groups.map((g) => [g.name, g.priority]), [['vendor-react', 30], ['vendor-ui', 30], ['app-initial', 20]]);
  assert.equal(groups[2].tags?.trim(), "'$initial'");
  assert.equal(groups[2].test, undefined, 'app-initial is selected by tag only');
});

test('vendor tests still match their packages; no group can capture the PDF stack', () => {
  const [react, ui] = groups;
  assert.ok(react.test?.test('/x/node_modules/react-dom/index.js'));
  assert.ok(react.test?.test('C:\\x\\node_modules\\scheduler\\index.js'));
  assert.ok(ui.test?.test('/x/node_modules/lucide-react/dist/x.js'));
  for (const g of groups) {
    for (const id of ['/x/node_modules/jspdf/dist/jspdf.es.min.js', '/x/node_modules/html-to-image/es/index.js']) {
      assert.ok(!g.test?.test(id), `${g.name} must not capture ${id}`);
    }
  }
});

test('bundle-size script: entry 100 kB, initial 185 kB, ≤ 5 initial files', () => {
  const s = readFileSync(new URL('../scripts/check-bundle-size.mjs', import.meta.url), 'utf8');
  assert.match(s, /BUDGET_INITIAL_GZ_KB', 185\)/);
  assert.match(s, /BUDGET_ENTRY_GZ_KB', 100\)/);
  assert.match(s, /BUDGET_INITIAL_FILES', 5\)/);
  assert.match(s, /BUDGET_TOTAL_GZ_KB', 3500\)/);
});
