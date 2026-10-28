/**
 * Round 11 rule file and first-paint guard: `construction-rules.ts` is reached only by lazy construction modules (never
 * by `tax-rules.ts`, `shop-mode.ts`, the shell or a first-paint module), re-exports nothing from
 * `transport-works-rules.ts`, and every row carries a date, a source and `verified`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/construction-rules.ts';
import { LABOUR_CESS_RULES } from '../src/lib/transport-works-rules.ts';
import { ruleAt } from '../src/lib/tax-rules.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 11 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx']) {
    assert.ok(!/from '[^']*(construction-rules|construction\/cn-|construction-r11)/.test(src(f)), `${f} stays free of Round 11 code`);
  }
  assert.ok(!/from '[^']*transport-works-rules'/.test(src('lib/construction-rules.ts')), 're-exports nothing from transport-works-rules');
});

test('the rule file is imported only by construction modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    if (!/from '[./]*construction-rules'/.test(src(f))) continue;
    assert.match(f, /^lib\/construction\//, `${f} imports construction-rules`);
  }
});

test('every rule row has a date, a source and `verified`; labour cess row of 21 Nov 2025 appended', () => {
  for (const v of Object.values(rules)) {
    if (!Array.isArray(v) || !v.length || typeof v[0] !== 'object' || !('from' in v[0])) continue;
    for (const r of v as { from: string; source?: string; verified?: boolean }[]) {
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      assert.equal(typeof r.verified, 'boolean');
    }
  }
  assert.equal(LABOUR_CESS_RULES.at(-1)!.from, '2025-11-21');
  assert.equal(ruleAt(LABOUR_CESS_RULES, '2026-01-01'), 1);
  assert.match(LABOUR_CESS_RULES.at(-1)!.source!, /Social Security/);
});
