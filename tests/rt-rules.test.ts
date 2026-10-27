/**
 * Round 9 rule file and first-paint guard: `retail-rules.ts` is reached only by lazy screens and engines (never by
 * `tax-rules.ts`, `shop-mode.ts`, the shell or a first-paint module), and every row carries a source + `verified`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/retail-rules.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('nothing first-paint imports the rule file or a Round 9 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx']) {
    assert.ok(!/retail-rules|retail\/rt-|retail-r9/.test(src(f)), `${f} stays free of Round 9 code`);
  }
});

test('the rule file is imported only by lazy modules (types or retail engines)', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    const text = src(f);
    if (!/from '[./]*retail-rules'/.test(text) && !/from '\.\.\/lib\/retail-rules'/.test(text)) continue;
    assert.ok(/^(lib\/retail\/|types\/retail-r9\.ts|components\/retail-r9\/|lib\/retail-rules\.ts)/.test(f) || /import type/.test(text.split('\n').find((l) => l.includes('retail-rules')) ?? ''), `${f} imports retail-rules`);
  }
});

test('every rule row (each package fills its own section) has a date, a source and `verified`', () => {
  const rows: { from: string; source?: string; verified?: boolean }[] = [];
  for (const v of Object.values(rules)) {
    if (Array.isArray(v)) rows.push(...v);
    else if (v && typeof v === 'object') for (const w of Object.values(v)) if (Array.isArray(w)) rows.push(...w);
  }
  for (const r of rows) {
    assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.source?.trim(), `${r.from}: source`);
    assert.equal(typeof r.verified, 'boolean');
  }
});
