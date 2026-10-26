/** TR-C2 trader statutory rules: TCS 206C(1) / (1F) by date, 194Q buyer test, RCM-goods prompt, composition tracker. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import * as R from '../src/lib/trading-rules.ts';
import { COMPOSITION_LIMIT_RULES } from '../src/lib/tax-rules.ts';
import { TCS_27EQ_CODES } from '../src/lib/tds-rules.ts';
import { actKey, sectionText } from '../src/lib/ita2025.ts';
import { buyer194q, compositionTracker, customer194qDue, precedingFy, presetOfLabel, rcmGoodsMatches, supplierKinds, tcs1fWarning, tcsNoPanRate, tradingTcsPresets } from '../src/lib/trade/tr-statutory.ts';
import { resolveBillTds, suggestTds, TDS_SETTINGS_KEY } from '../src/lib/tds-payables.ts';
import { setJson } from '../src/lib/storage.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const rate = (date: string, goods: string) => tradingTcsPresets(date).find((p) => p.goods === goods)?.rate;

test('206C(1) rates by date: 2017 base, COVID 25% cut, back on 1 Apr 2021, 2% for all from 1 Apr 2026', () => {
  assert.equal(rate('2020-05-13', 'scrap'), 1);
  assert.equal(rate('2020-05-14', 'scrap'), 0.75);
  assert.equal(rate('2020-05-14', 'tendu'), 3.75);
  assert.equal(rate('2021-03-31', 'timber_other'), 1.875);
  assert.equal(rate('2021-04-01', 'timber_other'), 2.5);
  assert.equal(rate('2026-03-31', 'scrap'), 1);
  assert.equal(rate('2026-03-31', 'tendu'), 5);
  assert.equal(rate('2026-04-01', 'scrap'), 2);
  assert.equal(rate('2026-04-01', 'liquor'), 2);
  const timber = tradingTcsPresets('2026-04-01').find((p) => p.goods === 'timber_lease')!;
  assert.equal(timber.verified, false, 'timber from 1 Apr 2026 unverified (TR14)');
  for (const p of tradingTcsPresets('2026-04-01')) {
    const row = TCS_27EQ_CODES.find((c) => c.match.test(p.label));
    assert.ok(row, `27EQ code for ${p.label}`);
    assert.equal(row!.code, p.code, p.label);
  }
});

test('206C(1F): motor vehicle since 2016, luxury goods from 22 Apr 2025, only above ₹10 lakh; declaration suppresses 206C(1)', () => {
  assert.ok(!tradingTcsPresets('2025-04-21').some((p) => p.goods === 'luxury'));
  assert.ok(tradingTcsPresets('2025-04-22').some((p) => p.goods === 'luxury'));
  const mv = tradingTcsPresets('2026-05-01').find((p) => p.goods === 'motor_vehicle')!;
  assert.equal(mv.code, '6CL');
  assert.match(tcs1fWarning(mv, [900000, 50000]), /above ₹10 lakh/);
  assert.equal(tcs1fWarning(mv, [1000001]), '');
  assert.equal(tcs1fWarning(mv, [1000000]) !== '', true, 'exactly ₹10 lakh is not above');
  const decl = tradingTcsPresets('2026-05-01', { declaration: true });
  assert.ok(decl.every((p) => p.section === '206C1F'), 'Form 27C / 127 removes the 206C(1) presets');
  assert.equal(presetOfLabel(mv.label, '2026-05-01')?.goods, 'motor_vehicle');
  assert.equal(tcsNoPanRate(1, '2026-05-01'), 5);
  assert.equal(tcsNoPanRate(5, '2018-05-01'), 10);
});

test('Act 2025 labels for 206C(1) / (1F) by date (stored labels never renamed)', () => {
  assert.equal(actKey('206C(1) scrap 2%'), '206C1');
  assert.equal(actKey('206C(1F) motor vehicle above ₹10 lakh 1%'), '206C1F');
  assert.equal(actKey('206C(1H) sale of goods 0.1%'), '206C1H');
  assert.equal(sectionText('206C(1)', '2026-03-31'), '206C(1)');
  assert.match(sectionText('206C(1)', '2026-04-01'), /^Sec 394\(1\) \[Table: Sl\. No\. 1–5\].*verify with your CA/);
  assert.match(sectionText('206C(1F)', '2026-04-01'), /Sl\. No\. 6/);
});

test('194Q buyer test: refused at or under ₹10 crore, allowed above, unknown allowed with a warning; preceding FY', () => {
  assert.equal(precedingFy('2026-04-01'), '25-26');
  assert.equal(precedingFy('2026-03-31'), '24-25');
  assert.equal(buyer194q('2021-06-30').status, 'not_in_force');
  assert.equal(buyer194q('2026-05-01').status, 'unknown');
  assert.equal(buyer194q('2026-05-01', { '25-26': 100_000_000 }).status, 'below');
  assert.equal(buyer194q('2026-05-01', { '25-26': 100_000_001 }).status, 'applies');
  const prior = [{ date: '2026-04-10', base: 4_900_000, tds: 0, code: '194Q' }];
  assert.ok(suggestTds('194Q', '2026-05-01', 500_000, { pan: 'AAACB2230M' }, prior)!.notes.some((n) => /not entered/.test(n)));
  setJson(TDS_SETTINGS_KEY, { turnover_by_fy: { '25-26': 80_000_000 } });
  const s = suggestTds('194Q', '2026-05-01', 500_000, { pan: 'AAACB2230M' }, prior)!;
  assert.equal(s.refused, true);
  assert.equal(s.amount, 0);
  const r = resolveBillTds({ section: '194Q', on: 'BILL', pan: 'AAACB2230M', rate: 0.1 }, { date: '2026-05-01', taxable: 500_000, prior });
  assert.equal(r.fields.tds_section, undefined, 'a typed rate cannot force a refused 194Q');
  setJson(TDS_SETTINGS_KEY, { turnover_by_fy: { '25-26': 150_000_000 } });
  assert.equal(suggestTds('194Q', '2026-05-01', 500_000, { pan: 'AAACB2230M' }, prior)!.amount, 400);
  assert.equal(customer194qDue(5_000_001, 5_000_000), true);
  assert.equal(customer194qDue(5_000_000, 5_000_000), false);
});

test('RCM notified goods: HSN × supplier kind × date (raw cotton only from 15 Nov 2017)', () => {
  const farmer = supplierKinds({ principal_kind: 'agriculturist', gstin: '' });
  const registered = supplierKinds({ principal_kind: 'registered', gstin: '27AAACB2230M1Z5' });
  assert.equal(rcmGoodsMatches([{ hsn: '52010012' }], farmer, '2017-11-14').length, 0);
  assert.equal(rcmGoodsMatches([{ hsn: '52010012' }], farmer, '2017-11-15')[0].goods, 'Raw cotton');
  assert.equal(rcmGoodsMatches([{ hsn: '2401' }], farmer, '2026-01-01')[0].goods, 'Tobacco leaves');
  assert.equal(rcmGoodsMatches([{ hsn: '2401' }], registered, '2026-01-01').length, 0, 'tobacco from a registered trader: no prompt');
  assert.equal(rcmGoodsMatches([{ hsn: '5004' }], registered, '2026-01-01').length, 1, 'silk yarn from its maker');
  assert.equal(rcmGoodsMatches([{ hsn: '1404' }], farmer, '2026-01-01')[0].goods, 'Bidi wrapper leaves (tendu)');
  assert.equal(rcmGoodsMatches([{ hsn: '1001' }], farmer, '2026-01-01').length, 0);
});

test('composition tracker: limit by date, amber at 80%, red at 100%; limits equal tax-rules', () => {
  assert.deepEqual(compositionTracker(1_000_000, '2026-05-01').level, 'ok');
  assert.equal(compositionTracker(12_000_000, '2026-05-01').level, 'amber');
  assert.equal(compositionTracker(15_000_000, '2026-05-01').level, 'red');
  assert.equal(compositionTracker(6_000_000, '2026-05-01', true).level, 'amber');
  assert.equal(compositionTracker(8_000_000, '2018-05-01').level, 'amber', 'limit ₹1 crore then');
  assert.equal(compositionTracker(1, '2026-05-01').optOutDays, 7);
  assert.deepEqual(R.COMPOSITION_GOODS_LIMIT_RULES.map((r) => [r.from, r.value.goods, r.value.goodsSpecial]), COMPOSITION_LIMIT_RULES.map((r) => [r.from, r.value.goods, r.value.goodsSpecial]));
});

test('every rule row has a source; trading-rules.ts never reaches first paint or tax-rules', () => {
  const lists = [R.TCS_SPECIFIED_GOODS_RULES, R.TCS_1F_RULES.motor_vehicle, R.TCS_1F_RULES.luxury, R.TCS_NO_PAN_RULES, R.BUYER_194Q_TURNOVER_RULES, R.RCM_NOTIFIED_GOODS_RULES, R.COMPOSITION_ALERT_RULES, R.COMPOSITION_GOODS_LIMIT_RULES];
  for (const l of lists) {
    for (const v of l) assert.ok(v.source?.trim(), `row from ${v.from}`);
    assert.deepEqual([...l.map((v) => v.from)], [...l.map((v) => v.from)].sort(), 'oldest first (append-only)');
  }
  // Static import graph from main.tsx: trading-rules / tr-statutory must not be reachable without a dynamic import.
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    let text = '';
    for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
      try {
        text = readFileSync(file + ext, 'utf8');
        file += ext;
        break;
      } catch {
        /* try next */
      }
    }
    for (const m of text.matchAll(/^import\s+(?!type\b)(?:[^'"]*from\s+)?['"](\.[^'"]+)['"]/gm)) walk(new URL(m[1], `file://${file}`).pathname.replace(/\.(ts|tsx)$/, ''));
  };
  walk(new URL('../src/main', import.meta.url).pathname);
  assert.ok(seen.size > 30, `walked ${seen.size} modules`);
  const hits = [...seen].filter((f) => /trading-rules|trade\/tr-/.test(f));
  assert.deepEqual(hits, [], 'reachable from main.tsx');
  assert.ok(!readFileSync(new URL('../src/lib/tax-rules.ts', import.meta.url), 'utf8').includes('trading-rules'));
});
