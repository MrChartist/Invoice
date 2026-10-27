/**
 * Round 12 rule file and first-paint guard: `agri-rules.ts` is reached only by lazy agri modules (never by
 * `tax-rules.ts`, `shop-mode.ts` or the shell), re-exports nothing from `trading-rules.ts`, and every row carries a date,
 * a source and `verified`, append-only in date order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/agri-rules.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 12 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts']) {
    assert.ok(!/from '[^']*(agri-rules|agri\/ag-)/.test(src(f)), `${f} stays free of Round 12 code`);
  }
  assert.ok(!/from '[^']*trading-rules'/.test(src('lib/agri-rules.ts')), 'RCM / 194Q / TCS stay in trading-rules.ts');
});

test('the rule file is imported only by agri modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    if (!/from '[./]*agri-rules'/.test(src(f))) continue;
    assert.match(f, /^lib\/agri\//, `${f} imports agri-rules`);
  }
});

test('every rule row has a date, a source and `verified`, in date order', () => {
  let n = 0;
  const check = (rows: readonly { from: string; source?: string; verified?: boolean }[]) => rows.forEach((r, i) => {
    n++;
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.source?.trim());
    assert.equal(typeof r.verified, 'boolean');
    if (i) assert.ok(r.from > rows[i - 1].from, 'append-only, in date order');
  });
  for (const v of Object.values(rules)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object' && 'from' in v[0]) check(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const rows of Object.values(v)) if (Array.isArray(rows)) check(rows);
  }
  assert.ok(n >= 50);
  assert.equal(Object.keys(rules.AGRI_CLASS_RULES).length, 42, 'every class of the PRD');
  assert.ok(Object.values(rules.AGRI_CLASS_RULES).flat().filter((r) => r.from === '2025-09-22').every((r) => !r.verified), '22 Sep 2025 rows unverified until AG4');
});
