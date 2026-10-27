/**
 * Round 14 rule file and first-paint guard: `prof-rules.ts` is reached only by Round 14 modules (never by `tax-rules.ts`,
 * `shop-mode.ts` or the shell), re-exports nothing from the other rule files, and every row carries a date, a source and
 * `verified`, append-only in date order. The record key `ps` is the round's only first-paint token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/prof-rules.ts';
import { R14_RECORD_KEYS, R9_RECORD_KEYS } from '../src/store/invoice-defaults.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 14 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts', 'components/templates/paper-helpers.ts']) {
    assert.ok(!/from '[^']*(prof-rules|prof\/ps-)/.test(src(f)), `${f} stays free of Round 14 code`);
  }
  assert.ok(!/from '[^']*(trading-rules|retail-rules|trade-rules|mfg-rules|tds-rules)'/.test(src('lib/prof-rules.ts')), 'values that live elsewhere stay there');
});

test('the rule file is imported only by Round 14 modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    if (!/from '[./]*prof-rules'/.test(src(f))) continue;
    assert.match(f, /^lib\/prof\//, `${f} imports prof-rules`);
  }
});

test('every rule row has a date, a source and `verified`, in date order', () => {
  let n = 0;
  for (const v of Object.values(rules).filter(Array.isArray)) {
    v.forEach((r: { from: string; source?: string; verified?: boolean }, i) => {
      n++;
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      assert.equal(typeof r.verified, 'boolean');
      if (i) assert.ok(r.from > v[i - 1].from, 'append-only, in date order');
    });
  }
  assert.ok(n >= 2);
});

test('one record key `ps`, spread into the record keys; no line key', () => {
  assert.deepEqual([...R14_RECORD_KEYS], ['ps']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('ps'));
  assert.ok(!/R14_LINE_KEYS/.test(src('store/invoice-defaults.ts')));
});
