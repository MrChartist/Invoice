/**
 * Round 21 rule file and the `f-fuel` family: `fuel-rules.ts` is reached only by Round 21 modules (never by
 * `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell); every row carries a date, a source and `verified`
 * (true exactly for the MDG rows read in a primary text this round, PRD §2.4 R13–R17); append-only in date order per
 * key. Engines in `src/lib/fuel/` import only first-paint modules, the rule file, the Round 21 areas and each other;
 * bridges are exactly `fu-*-io.ts` (≤ 4). After a build, `f-fuel` holds every pure engine and the rule file, never the
 * registry. The record key `fu` is the round's only token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/fuel-rules.ts';
import { R21_RECORD_KEYS, R9_RECORD_KEYS } from '../src/store/invoice-defaults.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const LIB = readdirSync(new URL('../src/lib/fuel/', import.meta.url)).filter((f) => f.endsWith('.ts'));
/** First-paint modules an engine may import (`build-meta/chunks.json` initial set). */
const FIXED = ['storage', 'access', 'audit', 'audit-edits', 'tax-rules', 'dates', 'localDb', 'utils', 'invoice-calc', 'period-lock', 'fuel-rules'];

test('nothing first-paint imports the rule file or a Round 21 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/tds-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts', 'components/templates/paper-helpers.ts', 'components/templates/parts/FuelLines.tsx', 'lib/no-cash.ts', 'lib/ita2025.ts', 'lib/dates.ts', 'lib/eway.ts']) {
    assert.ok(!/from '[^']*(fuel-rules|fuel\/fu-)/.test(src(f)), `${f} stays free of Round 21 code`);
  }
  assert.ok(!/from '[^']*(tds-rules|ita2025|r5c-rules)'/.test(src('lib/fuel-rules.ts')), 'values that live elsewhere stay there');
});

test('the rule file is imported only by Round 21 modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) if (/from '[./]*fuel-rules'/.test(src(f))) assert.match(f, /^lib\/fuel\//, `${f} imports fuel-rules`);
});

test('engines import only first-paint / family modules; bridges are exactly fu-*-io.ts (≤ 4); f-fuel after a build', () => {
  const bridges = LIB.filter((f) => /^fu-[a-z-]+-io\.ts$/.test(f));
  assert.ok(bridges.length <= 4, bridges.join());
  for (const f of LIB.filter((x) => !bridges.includes(x))) {
    for (const m of src(`lib/fuel/${f}`).matchAll(/^import (?!type )[^'\n]*'([^']+)'/gm)) {
      const p = m[1];
      const ok = /^\.\/fu-[a-z-]+$/.test(p) ? !p.endsWith('-io') : /^\.\.\/\.\.\/i18n\/areas\/fuel-r21[a-d]$/.test(p) || FIXED.includes(p.replace(/^\.\.\//, ''));
      assert.ok(ok, `${f} imports ${p}`);
    }
  }
  const meta = new URL('../build-meta/chunks.json', import.meta.url);
  if (!existsSync(meta)) return; // checked after `vite build`
  const j = JSON.parse(readFileSync(meta, 'utf8')) as { families: Record<string, string>; chunks: Record<string, { name: string; modules: string[] }> };
  const fam = Object.values(j.chunks).find((c) => c.name === 'f-fuel');
  if (!j.families['f-fuel'] || !fam) return; // a build from before R21
  // Writers import the registry (a leaf outside the family), so they are not captured; every pure engine is.
  for (const f of LIB.filter((x) => !bridges.includes(x) && x !== 'fu-registry.ts' && !src(`lib/fuel/${x}`).includes("import './fu-registry'"))) assert.ok(fam.modules.includes(`src/lib/fuel/${f}`), `${f} in f-fuel`);
  assert.ok(!fam.modules.includes('src/lib/fuel/fu-registry.ts'), 'the registry stays out (sync / recycle bin load it)');
  assert.ok(fam.modules.includes('src/lib/fuel-rules.ts'));
  assert.ok(fam.modules.includes('src/i18n/areas/fuel-r21a.ts'));
});

test('every rule row has a date, a source and `verified`; verified rows are exactly the MDG rows read this round', () => {
  const verified: string[] = [];
  for (const [name, v] of Object.entries(rules).filter(([, x]) => Array.isArray(x))) {
    (v as readonly { from: string; source?: string; verified?: boolean; key?: string }[]).forEach((r, i, a) => {
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      assert.match(r.source ?? '', /\(FU\d+/, `${name}: the CA item`);
      if (r.verified) {
        assert.match(r.source ?? '', /Read \(R21\)/, 'a verified row names the text read');
        verified.push(name);
      } else {
        assert.equal(r.verified, false);
        assert.doesNotMatch(r.source ?? '', /Read \(R21\)/, `${name}: an unverified row does not claim a reading`);
      }
      const prev = a.slice(0, i).filter((x) => x.key === r.key).at(-1);
      if (prev) assert.ok(r.from > prev.from, 'append-only, in date order');
    });
  }
  assert.deepEqual(verified.sort(), ['MDG_DAILY_RECORDS_RULES', 'MDG_DENSITY_RULES', 'MDG_NOZZLE_TEST_RULES', 'MDG_RECORDS_RULES', 'MDG_VARIATION_RULES'], 'PRD §2.4 R13–R17');
  for (const n of ['FUEL_GST_STATUS_RULES', 'EWAY_FUEL_EXEMPT_RULES', 'LUBE_HINT_RULES', 'WM_REVERIFY_RULES'] as const) assert.ok(rules[n].every((r) => !r.verified), `${n}: hints only`);
});

test('date lookup: MS / HSD / CNG non-GST from 1 Jul 2017; lubricants have no row; MDG density ± 3.0 from the 2022 text', () => {
  assert.equal(rules.fuKeyedAt(rules.FUEL_GST_STATUS_RULES, 'hsd', '2017-06-30'), null);
  assert.equal(rules.fuKeyedAt(rules.FUEL_GST_STATUS_RULES, 'hsd', '2026-10-29')?.value, 'non_gst');
  for (const p of ['ms', 'ms_branded', 'hsd_branded', 'cng']) assert.ok(rules.fuKeyedAt(rules.FUEL_GST_STATUS_RULES, p, '2026-10-29'), p);
  for (const p of ['lube', 'auto_lpg', 'other']) assert.equal(rules.fuKeyedAt(rules.FUEL_GST_STATUS_RULES, p, '2026-10-29'), null, p);
  assert.equal(rules.fuAt(rules.MDG_DENSITY_RULES, '2022-11-29'), null);
  assert.equal(rules.fuAt(rules.MDG_DENSITY_RULES, '2026-10-29')?.value.tol, 3);
  assert.deepEqual(rules.fuAt(rules.MDG_VARIATION_RULES, '2026-10-29')?.value, { band_pct: 4, ms: [0.75, 0.6], hsd: [0.25, 0.2], avg_kl: 600 });
});

test('one record key `fu`, spread into the record keys; no line key', () => {
  assert.deepEqual([...R21_RECORD_KEYS], ['fu']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('fu'));
  assert.ok(!/R21_LINE_KEYS/.test(src('store/invoice-defaults.ts')));
});
