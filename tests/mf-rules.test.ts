/**
 * Round 13 rule file and first-paint guard: `mfg-rules.ts` is reached only by Round 13 modules (never by `tax-rules.ts`,
 * `shop-mode.ts` or the shell), re-exports nothing from the other rule files, and every row carries a date, a source and
 * `verified`, append-only in date order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/mfg-rules.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 13 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts', 'components/templates/paper-helpers.ts']) {
    assert.ok(!/from '[^']*(mfg-rules|mfg\/mf-)/.test(src(f)), `${f} stays free of Round 13 code`);
  }
  assert.ok(!/from '[^']*(trading-rules|retail-rules|trade-rules)'/.test(src('lib/mfg-rules.ts')), 'values that live elsewhere stay there');
});

test('the rule file is imported only by Round 13 modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    if (!/from '[./]*mfg-rules'/.test(src(f))) continue;
    assert.match(f, /^lib\/mfg\//, `${f} imports mfg-rules`);
  }
});

test('every rule row has a date, a source and `verified`, in date order', () => {
  let n = 0;
  for (const v of Object.values(rules)) {
    if (!Array.isArray(v)) continue;
    v.forEach((r: { from: string; source?: string; verified?: boolean }, i) => {
      n++;
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      assert.equal(typeof r.verified, 'boolean');
      if (i) assert.ok(r.from > v[i - 1].from, 'append-only, in date order');
    });
  }
  assert.ok(n >= 3);
});
