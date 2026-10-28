/**
 * Round 19 rule file and the `f-logistics` family: `logistics-rules.ts` is reached only by Round 19 modules (never by
 * `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell); every row carries a date, a source and `verified` (true
 * exactly for the rows read in a primary text this round, PRD §2.4); append-only in date order per key. Engines in
 * `src/lib/logistics/` import only first-paint modules, the rule file, the Round 19 areas and each other; bridges are
 * exactly `lg-*-io.ts` (≤ 4). After a build, `f-logistics` holds every pure engine and the rule file, never the
 * registry. The record key `lg` is the round's only token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/logistics-rules.ts';
import { R19_RECORD_KEYS, R9_RECORD_KEYS } from '../src/store/invoice-defaults.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const LIB = readdirSync(new URL('../src/lib/logistics/', import.meta.url)).filter((f) => f.endsWith('.ts'));
/** First-paint modules an engine may import (`build-meta/chunks.json` initial set). */
const FIXED = ['storage', 'access', 'audit', 'audit-edits', 'tax-rules', 'dates', 'localDb', 'utils', 'invoice-calc', 'invoice-number', 'period-lock', 'series-counters', 'logistics-rules'];

test('nothing first-paint imports the rule file or a Round 19 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/tds-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts', 'components/templates/paper-helpers.ts', 'lib/no-cash.ts', 'lib/ita2025.ts', 'lib/dates.ts']) {
    assert.ok(!/from '[^']*(logistics-rules|logistics\/lg-)/.test(src(f)), `${f} stays free of Round 19 code`);
  }
  assert.ok(!/from '[^']*(tds-rules|transport-works-rules|prof-rules|ita2025|trading-rules)'/.test(src('lib/logistics-rules.ts')), 'values that live elsewhere stay there');
});

test('the rule file is imported only by Round 19 modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) if (/from '[./]*logistics-rules'/.test(src(f))) assert.match(f, /^lib\/logistics\//, `${f} imports logistics-rules`);
});

test('engines import only first-paint / family modules; bridges are exactly lg-*-io.ts (≤ 4)', () => {
  const bridges = LIB.filter((f) => /^lg-[a-z-]+-io\.ts$/.test(f));
  assert.ok(bridges.length <= 4, bridges.join());
  for (const f of LIB.filter((x) => !bridges.includes(x))) {
    for (const m of src(`lib/logistics/${f}`).matchAll(/^import (?!type )[^'\n]*'([^']+)'/gm)) {
      const p = m[1];
      const ok = /^\.\/lg-[a-z-]+$/.test(p) ? !p.endsWith('-io') : /^\.\.\/\.\.\/i18n\/areas\/logistics-r19[a-d]$/.test(p) || FIXED.includes(p.replace(/^\.\.\//, '')) || (f === 'lg-save.ts' && p === '../table-txn');
      assert.ok(ok, `${f} imports ${p}`);
    }
  }
  const meta = new URL('../build-meta/chunks.json', import.meta.url);
  if (!existsSync(meta)) return; // checked after `vite build`
  const j = JSON.parse(readFileSync(meta, 'utf8')) as { families: Record<string, string>; chunks: Record<string, { name: string; modules: string[] }> };
  const fam = Object.values(j.chunks).find((c) => c.name === 'f-logistics');
  if (!j.families['f-logistics'] || !fam) return; // a build from before R19
  // Writers import the registry (a leaf outside the family), so they are not captured; every pure engine is.
  for (const f of LIB.filter((x) => !bridges.includes(x) && x !== 'lg-registry.ts' && !src(`lib/logistics/${x}`).includes("import './lg-registry'"))) assert.ok(fam.modules.includes(`src/lib/logistics/${f}`), `${f} in f-logistics`);
  assert.ok(!fam.modules.includes('src/lib/logistics/lg-registry.ts'), 'the registry stays out (sync / recycle bin load it)');
  assert.ok(fam.modules.includes('src/lib/logistics-rules.ts'));
  assert.ok(fam.modules.includes('src/i18n/areas/logistics-r19a.ts'));
});

test('every rule row has a date, a source and `verified`; verified rows are exactly those read this round', () => {
  const verified: string[] = [];
  for (const [name, v] of Object.entries(rules).filter(([, x]) => Array.isArray(x))) {
    (v as readonly { from: string; source?: string; verified?: boolean; key?: string }[]).forEach((r, i, a) => {
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      if (r.verified) {
        assert.match(r.source ?? '', /Read \(R19\)/, 'a verified row names the text read');
        verified.push(`${name}@${r.key ? `${r.key}:` : ''}${r.from}`);
      } else {
        assert.equal(r.verified, false);
        assert.doesNotMatch(r.source ?? '', /Read \(R19\)/, `${name}: an unverified row does not claim a reading`);
      }
      const prev = a.slice(0, i).filter((x) => x.key === r.key).at(-1);
      if (prev) assert.ok(r.from > prev.from, 'append-only, in date order');
    });
  }
  assert.deepEqual(verified.sort(), [
    'CBLR_RULES@records:2018-05-14',
    'LG_EXEMPT_RULES@agri_produce:2017-07-01', 'LG_EXEMPT_RULES@rice:2017-07-01',
    'LG_POS_RULES@cross_border:2017-07-01', 'LG_POS_RULES@cross_border:2023-10-01', 'LG_POS_RULES@domestic:2017-07-01', 'LG_POS_RULES@export:2019-02-01',
    'LG_RATE_RULES@courier:2017-07-01', 'LG_RATE_RULES@courier:2025-09-22', 'LG_RATE_RULES@freight_air:2018-07-26', 'LG_RATE_RULES@freight_multimodal:2018-07-26', 'LG_RATE_RULES@freight_multimodal:2025-09-22', 'LG_RATE_RULES@freight_rail:2025-09-22', 'LG_RATE_RULES@freight_sea:2017-07-01', 'LG_RATE_RULES@support:2017-07-01',
    'LG_SAC_RULES@2017-07-01',
  ], 'PRD §2.4 rows 1–4, 6–10, 13–15, 17 (SAC), 28; GTA (row 5) stays in transport-works-rules, intermediary (row 16) in prof-rules');
  for (const n of ['OCEAN_RCM_RULES', 'EINV_EXEMPT_RULES']) assert.ok((rules as unknown as Record<string, readonly { verified: boolean }[]>)[n].every((r) => !r.verified), `${n}: hints only`);
});

test('keyedAt: POS 13(9) → 13(2) at 1 Oct 2023; the export proviso from 1 Feb 2019; multimodal 12 % → 5 % / 18 %', () => {
  assert.equal(rules.keyedAt(rules.LG_POS_RULES, 'cross_border', '2023-09-30')?.value.section, 'Sec 13(9) IGST Act');
  assert.equal(rules.keyedAt(rules.LG_POS_RULES, 'cross_border', '2023-10-01')?.value.section, 'Sec 13(2) IGST Act');
  assert.equal(rules.keyedAt(rules.LG_POS_RULES, 'export', '2019-01-31'), null);
  assert.equal(rules.keyedAt(rules.LG_POS_RULES, 'export', '2019-02-01')?.value.pos, 'destination');
  assert.equal(rules.keyedAt(rules.LG_RATE_RULES, 'freight_multimodal', '2025-09-21')?.value.rate, 12);
  assert.deepEqual(rules.keyedAt(rules.LG_RATE_RULES, 'freight_multimodal', '2025-09-22')?.value.air_rate, 18);
  assert.equal(rules.keyedAt(rules.LG_RATE_RULES, 'nope', '2026-01-01'), null);
});

test('one record key `lg`, spread into the record keys; no line key', () => {
  assert.deepEqual([...R19_RECORD_KEYS], ['lg']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('lg'));
  assert.ok(!/R19_LINE_KEYS/.test(src('store/invoice-defaults.ts')));
});
