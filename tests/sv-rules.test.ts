/**
 * Round 10 rule file and first-paint guard: `service-rules.ts` is reached only by lazy service modules (never by
 * `tax-rules.ts`, `shop-mode.ts` or the shell), and every row carries a date, a source and `verified`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/service-rules.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 10 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts']) {
    assert.ok(!/from '[^']*(service-rules|services\/sv-)/.test(src(f)), `${f} stays free of Round 10 code`);
  }
});

test('the rule file is imported only by service modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    if (!/from '[./]*service-rules'/.test(src(f))) continue;
    assert.match(f, /^lib\/services\//, `${f} imports service-rules`);
  }
});

test('every rule row has a date, a source and `verified`, in date order', () => {
  let n = 0;
  for (const v of Object.values(rules)) {
    if (!Array.isArray(v) || !v.length || typeof v[0] !== 'object' || !('from' in v[0])) continue;
    const rows = v as { from: string; source?: string; verified?: boolean }[];
    rows.forEach((r, i) => {
      n++;
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      assert.equal(typeof r.verified, 'boolean');
      if (i) assert.ok(r.from > rows[i - 1].from, 'append-only, in date order');
    });
  }
  assert.ok(n >= 5);
});
