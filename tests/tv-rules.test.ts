/**
 * Round 15 rule file and first-paint guard: `travel-rules.ts` is reached only by Round 15 modules (never by
 * `tax-rules.ts`, `shop-mode.ts` or the shell), every row carries a date, a source and `verified` (false unless read in a
 * primary text this round), append-only in date order. The record key `tv` is the round's only first-paint token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/travel-rules.ts';
import { R15_RECORD_KEYS, R9_RECORD_KEYS } from '../src/store/invoice-defaults.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 15 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts', 'components/templates/paper-helpers.ts', 'lib/cost-centres.ts']) {
    assert.ok(!/from '[^']*(travel-rules|travel\/tv-)/.test(src(f)), `${f} stays free of Round 15 code`);
  }
  assert.ok(!/from '[^']*(trading-rules|retail-rules|trade-rules|mfg-rules|tds-rules|prof-rules|hotel-rules)'/.test(src('lib/travel-rules.ts')), 'values that live elsewhere stay there');
});

test('the rule file is imported only by Round 15 modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    if (!/from '[./]*travel-rules'/.test(src(f))) continue;
    assert.match(f, /^lib\/travel\//, `${f} imports travel-rules`);
  }
});

test('every rule row has a date, a source and `verified`, in date order; nothing unconfirmed is marked verified', () => {
  let n = 0;
  for (const v of Object.values(rules).filter(Array.isArray)) {
    v.forEach((r: { from: string; source?: string; verified?: boolean }, i) => {
      n++;
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      assert.equal(r.verified, false, 'no primary text read for the B rows (TV8–TV10)');
      if (i) assert.ok(r.from > v[i - 1].from, 'append-only, in date order');
    });
  }
  assert.ok(n >= 2);
});

test('one record key `tv`, spread into the record keys; no line key', () => {
  assert.deepEqual([...R15_RECORD_KEYS], ['tv']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('tv'));
  assert.ok(!/R15_LINE_KEYS/.test(src('store/invoice-defaults.ts')));
});
