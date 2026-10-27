/**
 * Round 9 pack gate: an existing kirana company (no `retail_kind`, no packs) sees exactly what it saw — no retail pack
 * tab is listed (the URL still opens it), PACK_OF_TYPE implies no retail pack, the retail desks are lazy chunks, and the
 * Inventory / Receivables / POS / editor hosts load the RT-A strips only through `lazy(() => import(…))`.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, setReadTrace } from '../src/lib/storage.ts';
import { PACK_OF_TYPE, activePacks, visibleTabs } from '../src/lib/industry-packs.ts';
import { INVENTORY_PACK_TABS } from '../src/pages/page-tabs.ts';
import { RT_TABLES } from '../src/lib/retail/rt-shared.ts';
import { liveDocTrackingIssues, liveMrpIssues } from '../src/lib/stock-tracking.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'kirana' } as never);
});
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('an existing kirana company: no retail pack, no desk tab listed (opened by URL still shows)', () => {
  const s = localDb.settings.get();
  assert.deepEqual(activePacks(s), []);
  assert.equal(PACK_OF_TYPE.kirana, undefined, 'kirana implies no pack');
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, s).map((t) => t.id), []);
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, s, 'devices').map((t) => t.id), ['devices'], 'its URL still opens it');
  localDb.settings.save({ ...s, industry_packs: ['pharmacy', 'jewellery'] });
  assert.deepEqual(visibleTabs(INVENTORY_PACK_TABS, localDb.settings.get()).map((t) => t.id), ['pharmacy', 'jewellery']);
  assert.deepEqual(INVENTORY_PACK_TABS.map((t) => [t.id, t.pack]), [['pharmacy', 'pharmacy'], ['apparel', 'apparel'], ['devices', 'electronics'], ['jewellery', 'jewellery']]);
});

test('with every retail check off, the stock checks read no Round 9 table', () => {
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    const doc = { doc_type: 'INVOICE' as const, status: 'Sent' as const, issue_date: '2026-07-01', items: [{ id: 'l', name: 'Soap', quantity: 1, rate: 50, tax_rate: 18, amount: 50 }] as never };
    liveDocTrackingIssues(doc);
    assert.deepEqual(liveMrpIssues(doc), { errors: [], warnings: [], confirm: [] });
  } finally {
    setReadTrace(prev);
  }
  for (const t of Object.values(RT_TABLES)) assert.ok(!seen.has(DB_PREFIX + t) && !seen.has(t), `${t} not read`);
});

test('hosts mount the Round 9 screens lazily', () => {
  const inv = src('pages/Inventory.tsx');
  for (const d of ['PharmacyDesk', 'ApparelDesk', 'DevicesDesk', 'JewelleryDesk']) assert.match(inv, new RegExp(`lazy\\(\\(\\) => import\\('\\.\\./components/retail-r9/${d}'\\)`), d);
  // RT-A's own parts come from one lazy hub chunk (each chunk name costs first-paint bytes).
  for (const [f, part] of [['pages/Inventory.tsx', 'ShortBookTab'], ['pages/Inventory.tsx', 'RelabelQueue'], ['pages/Receivables.tsx', 'DeliveriesTab'], ['pages/Pos.tsx', 'PosRetailStrip'], ['pages/Settings.tsx', 'RetailChecks'], ['components/creator/SummaryPanel.tsx', 'DeliveryStrip']]) {
    assert.match(src(f), new RegExp(`lazy\\(\\(\\) => import\\('[./]+(components/)?retail-r9/rt-a-hub'\\)\\.then\\(\\(m\\) => \\(\\{ default: m\\.${part} \\}\\)\\)\\)`), `${f}: ${part}`);
  }
  for (const f of ['pages/Inventory.tsx', 'pages/Receivables.tsx', 'pages/Pos.tsx', 'components/creator/SummaryPanel.tsx']) {
    assert.ok(!/^import .*retail-r9\//m.test(src(f).replace(/^import type .*$/gm, '')), `${f} has no static import of a retail-r9 component`);
  }
  for (const d of ['PharmacyDesk', 'ApparelDesk', 'DevicesDesk', 'JewelleryDesk']) assert.ok(src(`components/retail-r9/${d}.tsx`).includes('export { default }') || src(`components/retail-r9/${d}.tsx`).includes('export default'), d);
});
