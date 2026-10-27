/** R6-B5: Settings → Features — one list of modules, packs and advanced options, read where each setting lives. */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { FEATURE_ROWS, featureState, multiGodown } from '../src/lib/features-catalog.ts';
import { ALL_MODULES } from '../src/lib/shop-mode.ts';
import { PACK_IDS } from '../src/lib/industry-packs.ts';
import { TAB_PAGES } from '../src/lib/palette/tab-index.ts';
import { isMultiGodown } from '../src/lib/godowns.ts';
import { getTable, setTable, setJson, DB_PREFIX, vaultEnabled } from '../src/lib/storage.ts';
import { readPharmaSettings } from '../src/lib/pharma-gate.ts';
import { readApprovalPolicy } from '../src/lib/approval-gate.ts';
import { localDb } from '../src/lib/localDb.ts';
import { applyBusinessType } from '../src/lib/shop-presets.ts';
import { discoverT } from '../src/i18n/areas/discover-r6.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const row = (id: string) => FEATURE_ROWS.find((r) => r.id === id)!;
const on = (id: string) => featureState(row(id));

test('every module of ALL_MODULES, every pack and the 24 advanced options (R11: construction profile; R10: service profile; R12: agri profile) have a row with a title and a "who" line', () => {
  for (const m of ALL_MODULES) assert.ok(row(`mod.${m}`), m);
  for (const p of PACK_IDS) assert.ok(row(`pack.${p}`), p);
  const adv = FEATURE_ROWS.filter((r) => r.section === 'advanced');
  assert.equal(adv.length, 24);
  for (const r of adv) {
    const id = r.id.slice(4);
    assert.ok(Object.hasOwn(discoverT.en, `adv.${id}`) && Object.hasOwn(discoverT.en, `awho.${id}`), `${r.id} text`);
  }
  for (const m of ALL_MODULES) assert.ok(Object.hasOwn(discoverT.en, `mwho.${m}`), m);
  assert.equal(new Set(FEATURE_ROWS.map((r) => r.id)).size, FEATURE_ROWS.length, 'ids are unique');
});

test("every row's deep link resolves to a route and, with ?tab=, to a tab of that page", () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const routes = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1].replace(/\/\*$/, '')));
  routes.add('/');
  for (const r of FEATURE_ROWS) {
    const [path, query = ''] = r.href.split('?');
    assert.ok(routes.has(path), `${r.id}: ${path} is not a route`);
    const tab = new URLSearchParams(query).get('tab');
    if (tab) {
      const page = TAB_PAGES.find((p) => p.route === path);
      assert.ok(page && page.ids.includes(tab), `${r.id}: ${r.href} is not a tab`);
    }
  }
});

test('isOn agrees with the existing readers', () => {
  // Batches / serials: a tracked stock item with the flag.
  assert.equal(on('adv.batches'), false);
  setTable('stock_items', [{ id: 's1', name: 'Syrup', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, track_batches: true }]);
  assert.equal(on('adv.batches'), true);
  assert.equal(on('adv.serials'), false);
  // Godowns: the same count as isMultiGodown (Main is implied; a nameless row does not count).
  for (const rows of [[], [{ id: 'main', name: 'Main' }], [{ id: 'g2', name: '' }], [{ id: 'g2', name: 'Back store' }]]) {
    setTable('godowns', rows);
    assert.equal(multiGodown(), isMultiGodown(getTable('godowns')), JSON.stringify(rows));
    assert.equal(on('adv.godowns'), multiGodown());
  }
  // Branches: the table is non-empty.
  assert.equal(on('adv.branches'), false);
  setTable('branches', [{ id: 'b1', name: 'Pune' }]);
  assert.equal(on('adv.branches'), true);
  // Vault: the storage layer's own flag.
  assert.equal(on('adv.vault'), vaultEnabled());
  // Pharma / approvals: their gate readers.
  assert.equal(on('adv.pharma'), readPharmaSettings().enabled);
  setJson(`${DB_PREFIX}pharma_settings`, { enabled: true });
  assert.equal(on('adv.pharma'), true);
  assert.equal(on('adv.approvals'), readApprovalPolicy().enabled);
  // Credit policy is on by default ("warn") and off only when set to "off".
  assert.equal(on('adv.credit'), true);
  setJson(`${DB_PREFIX}credit_policy`, { mode: 'off' });
  assert.equal(on('adv.credit'), false);
  // Gateway is always there.
  assert.equal(on('adv.gateway'), 'n/a');
});

test('modules follow shop mode (absent = all on); packs follow the business type or the explicit list', () => {
  for (const m of ALL_MODULES) assert.equal(on(`mod.${m}`), true, m);
  localDb.settings.save({ ...localDb.settings.get(), ...applyBusinessType('kirana') });
  assert.equal(on('mod.pos'), true);
  assert.equal(on('mod.payroll'), false);
  assert.equal(on('pack.transport'), false);
  localDb.settings.save({ ...localDb.settings.get(), ...applyBusinessType('transport') });
  assert.equal(on('pack.transport'), true);
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['works'] });
  assert.equal(on('pack.transport'), false);
  assert.equal(on('pack.works'), true);
});

test('composition and e-Invoice read the active business profile', () => {
  const s = localDb.settings.get();
  const p = s.profiles.find((x) => x.id === s.activeProfileId)!;
  assert.equal(on('adv.composition'), false);
  localDb.settings.save({ ...s, profiles: s.profiles.map((x) => (x.id === p.id ? { ...x, gst_scheme: 'composition', einvoice_aato: 60_00_00_000 } : x)) });
  assert.equal(on('adv.composition'), true);
  assert.equal(on('adv.einvoice'), true);
});
