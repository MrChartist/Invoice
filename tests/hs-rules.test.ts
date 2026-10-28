/**
 * Round 18 rule file and the `f-society` family: `society-rules.ts` is reached only by Round 18 modules (never by
 * `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell); every row carries a date, a source and `verified` (true
 * exactly for the rows read in a primary text this round, PRD §2.4); append-only in date order (per State for the State
 * rows, which exist only for 27 / 29 / 33 / 07). Engines in `src/lib/society/` import only first-paint modules, the rule
 * file and each other; bridges are exactly `hs-*-io.ts`. After a build, `f-society` holds every pure engine and the rule
 * file, never the registry. The record key `hs` is the round's only token.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as rules from '../src/lib/society-rules.ts';
import { R18_RECORD_KEYS, R9_RECORD_KEYS } from '../src/store/invoice-defaults.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const LIB = readdirSync(new URL('../src/lib/society/', import.meta.url)).filter((f) => f.endsWith('.ts'));
/** First-paint modules an engine may import (`build-meta/chunks.json` initial set). */
const FIXED = ['storage', 'access', 'audit', 'audit-edits', 'tax-rules', 'dates', 'localDb', 'utils', 'invoice-calc', 'invoice-number', 'period-lock', 'society-rules'];

test('nothing first-paint imports the rule file or a Round 18 module', () => {
  for (const f of ['lib/tax-rules.ts', 'lib/tds-rules.ts', 'lib/shop-mode.ts', 'App.tsx', 'main.tsx', 'lib/storage.ts', 'lib/access.ts', 'lib/audit-edits.ts', 'lib/industry-packs.ts', 'layouts/DashboardLayout.tsx', 'store/invoice-defaults.ts', 'store/useInvoiceStore.ts', 'components/templates/paper-helpers.ts', 'lib/no-cash.ts', 'lib/ita2025.ts']) {
    assert.ok(!/from '[^']*(society-rules|society\/hs-)/.test(src(f)), `${f} stays free of Round 18 code`);
  }
  assert.ok(!/from '[^']*(tds-rules|manpower-rules|r5c-rules|transport-works-rules|ita2025)'/.test(src('lib/society-rules.ts')), 'values that live elsewhere stay there');
});

test('the rule file is imported only by Round 18 modules', () => {
  const files = readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((f) => /\.tsx?$/.test(f));
  for (const f of files) if (/from '[./]*society-rules'/.test(src(f))) assert.match(f, /^lib\/society\//, `${f} imports society-rules`);
});

test('engines import only first-paint / family modules; bridges are exactly hs-*-io.ts (≤ 4)', () => {
  const bridges = LIB.filter((f) => /^hs-[a-z-]+-io\.ts$/.test(f));
  assert.ok(bridges.length <= 4, bridges.join());
  for (const f of LIB.filter((x) => !bridges.includes(x))) {
    for (const m of src(`lib/society/${f}`).matchAll(/^import (?!type )[^'\n]*'([^']+)'/gm)) {
      const p = m[1];
      const ok = /^\.\/hs-[a-z-]+$/.test(p) ? !p.endsWith('-io') : /^\.\.\/\.\.\/i18n\/areas\/society-r18[a-d]$/.test(p) || FIXED.includes(p.replace(/^\.\.\//, '')) || (f === 'hs-units-save.ts' && p === '../table-txn');
      assert.ok(ok, `${f} imports ${p}`);
    }
  }
  const meta = new URL('../build-meta/chunks.json', import.meta.url);
  if (!existsSync(meta)) return; // checked after `vite build`
  const j = JSON.parse(readFileSync(meta, 'utf8')) as { families: Record<string, string>; chunks: Record<string, { name: string; modules: string[] }> };
  const fam = Object.values(j.chunks).find((c) => c.name === 'f-society');
  if (!j.families['f-society'] || !fam) return; // a build from before R18
  // Writers import the registry (a leaf outside the family), so they are not captured; every pure engine is.
  for (const f of LIB.filter((x) => !bridges.includes(x) && x !== 'hs-registry.ts' && !src(`lib/society/${x}`).includes("import './hs-registry'"))) assert.ok(fam.modules.includes(`src/lib/society/${f}`), `${f} in f-society`);
  assert.ok(!fam.modules.includes('src/lib/society/hs-registry.ts'), 'the registry stays out (sync / recycle bin load it)');
  assert.ok(fam.modules.includes('src/lib/society-rules.ts'));
  assert.ok(fam.modules.includes('src/i18n/areas/society-r18a.ts'));
});

test('every rule row has a date, a source and `verified`; verified rows are exactly those read this round', () => {
  const verified: string[] = [];
  for (const [name, v] of Object.entries(rules).filter(([, x]) => Array.isArray(x))) {
    (v as readonly { from: string; source?: string; verified?: boolean; state?: string }[]).forEach((r, i, a) => {
      assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source?.trim());
      if (r.verified) {
        assert.match(r.source ?? '', /Read \(R18\)/, 'a verified row names the text read');
        verified.push(`${name}@${r.state ? `${r.state}:` : ''}${r.from}`);
      } else assert.equal(r.verified, false);
      const prev = a.slice(0, i).filter((x) => x.state === r.state).at(-1);
      if (prev) assert.ok(r.from > prev.from, 'append-only, in date order');
    });
  }
  assert.deepEqual(verified.sort(), ['SOCIETY_GST_RATE_RULES@2017-07-01', 'SOCIETY_SAC_RULES@2017-07-01', 'STATE_SOCIETY_RULES@29:2026-01-01', 'STATE_SOCIETY_RULES@33:2024-03-06']);
  assert.deepEqual([...new Set(rules.STATE_SOCIETY_RULES.map((r) => r.state))].sort(), ['07', '27', '29', '33'], 'State rows only for MH / KA / TN / DL');
  assert.ok(rules.STATE_SOCIETY_RULES.filter((r) => r.state === '29').every((r) => r.in_force === false), 'the KA Bill is not in force until confirmed');
});

test('stateRuleAt: MH 21 → 12 at the row date; KA only once confirmed; TN undivided %; other States none', () => {
  assert.equal(rules.stateRuleAt('27', '2026-06-21')?.value.interest_cap_pct, 21);
  assert.equal(rules.stateRuleAt('27', '2026-06-22')?.value.interest_cap_pct, 12);
  assert.equal(rules.stateRuleAt('29', '2026-11-01'), null);
  assert.equal(rules.pendingStateRule('29', '2026-11-01')?.state, '29');
  assert.equal(rules.stateRuleAt('29', '2026-11-01', ['29'])?.value.audit_due_months, 6);
  assert.equal(rules.pendingStateRule('29', '2026-11-01', ['29']), undefined);
  assert.equal(rules.stateRuleAt('33', '2026-11-01')?.value.default_bases.service, 'undivided_pct');
  assert.equal(rules.stateRuleAt('33', '2024-03-05'), null, 'before commencement');
  assert.equal(rules.stateRuleAt('24', '2026-11-01'), null);
});

test('one record key `hs`, spread into the record keys; no line key', () => {
  assert.deepEqual([...R18_RECORD_KEYS], ['hs']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('hs'));
  assert.ok(!/R18_LINE_KEYS/.test(src('store/invoice-defaults.ts')));
});
