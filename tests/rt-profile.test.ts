/** RT-A1 retail profile: the six shops' modules / packs / landing / switches, the checklist steps, existing kirana. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PRESETS, RETAIL_KINDS, RETAIL_PROFILES, applyRetailKind, isRetailKind } from '../src/lib/shop-presets.ts';
import { applyRetailSwitches, retailSwitchesFor } from '../src/lib/retail/rt-profile.ts';
import { readRetailSettings, saveRetailSettings } from '../src/lib/retail/rt-settings.ts';
import { readPharmaSettings } from '../src/lib/pharma-gate.ts';
import { PACK_IDS, activePacks } from '../src/lib/industry-packs.ts';
import { allSteps, type ChecklistCtx, type ChecklistFactsV3 } from '../src/lib/checklist-steps.ts';
import { getTable } from '../src/lib/storage.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('each shop: modules, packs, landing, template, due days; registered adds gst', () => {
  assert.deepEqual([...RETAIL_KINDS], ['grocery', 'pharmacy', 'apparel', 'electronics', 'jewellery', 'general']);
  const g = applyRetailKind('grocery');
  assert.deepEqual(g, { business_type: 'kirana', modules: ['pos', 'purchases', 'inventory', 'reports'], retail_kind: 'grocery', industry_packs: [] });
  assert.deepEqual(applyRetailKind('grocery', { registered: true }).modules, [...PRESETS.kirana, 'gst']);
  assert.deepEqual(applyRetailKind('pharmacy').modules, [...PRESETS.kirana, 'accounts', 'banking']);
  assert.deepEqual(applyRetailKind('pharmacy').industry_packs, ['pharmacy']);
  assert.deepEqual(applyRetailKind('apparel').modules, [...PRESETS.kirana, 'accounts']);
  assert.deepEqual(applyRetailKind('electronics', { registered: true }).modules, [...PRESETS.kirana, 'accounts', 'banking', 'tds', 'gst']);
  assert.deepEqual(applyRetailKind('jewellery').industry_packs, ['jewellery']);
  assert.equal(RETAIL_PROFILES.jewellery.landing, '/inventory?tab=jewellery&view=rates');
  for (const k of RETAIL_KINDS) {
    assert.equal(RETAIL_PROFILES[k].defaultDueDays, 0, k);
    assert.ok(applyRetailKind(k).modules.includes('inventory'), `${k} keeps /inventory (PACK_ROUTES unchanged)`);
    if (k !== 'jewellery') assert.equal(RETAIL_PROFILES[k].landing, '/pos', k);
  }
  assert.equal(RETAIL_PROFILES.pharmacy.templateId, 'gst_tax_invoice');
  assert.equal(RETAIL_PROFILES.grocery.templateId, 'retail_receipt');
  assert.ok(isRetailKind('general') && !isRetailKind('kirana'));
  for (const p of ['pharmacy', 'apparel', 'electronics', 'jewellery']) assert.ok((PACK_IDS as readonly string[]).includes(p));
});

test('switches per shop (only ever turned on); pharmacy turns on the 7U pharma switches', () => {
  assert.deepEqual(retailSwitchesFor('grocery'), { mrp_guard: 'warn', delivery: { enabled: true }, short_book: { enabled: true }, free_qty: true });
  assert.deepEqual(retailSwitchesFor('general'), { mrp_guard: 'warn' });
  assert.equal(retailSwitchesFor('pharmacy').mrp_guard, 'block');
  assert.deepEqual(retailSwitchesFor('jewellery'), { cash_guard: 'block', require_pan: true }, 'jewellery: MRP guard off, cash guard block, PAN');
  assert.deepEqual(retailSwitchesFor('electronics'), { cash_guard: 'warn' });
  assert.equal(retailSwitchesFor('grocery', { mrp_guard: 'block' }).mrp_guard, 'block', 'a stricter setting is kept');
  assert.equal(retailSwitchesFor('electronics', { cash_guard: 'block' }).cash_guard, 'block');
  applyRetailSwitches('pharmacy');
  assert.equal(readRetailSettings().mrp_guard, 'block');
  const ph = readPharmaSettings();
  assert.ok(ph.enabled && ph.block_expired && ph.block_above_mrp);
  assert.ok(getTable<{ summary: string }>('audit_log').some((a) => /Retail checks: MRP guard off → MRP guard block/.test(a.summary)), 'audited');
});

test('existing kirana company (no retail_kind): unchanged settings, no packs, only "Pick your shop" added', () => {
  localDb.settings.save({ ...localDb.settings.get(), business_type: 'kirana', modules: [...PRESETS.kirana] });
  const s = localDb.settings.get();
  assert.equal(s.retail_kind, undefined);
  assert.deepEqual(activePacks(s), []);
  assert.deepEqual(readRetailSettings(), {}, 'every retail check off');
  saveRetailSettings({ mrp_guard: 'warn' });
  assert.equal(readRetailSettings().mrp_guard, 'warn');
});

const none: ChecklistFactsV3 = { profileReady: false, clients: 0, items: 0, invoices: 0, messagesSent: 0, payments: 0 };
const ctx = (retailKind?: string, packs: string[] = []): ChecklistCtx => ({ businessType: 'kirana', packs: packs as never, modules: new Set(['pos', 'inventory']) as never, role: 'owner', ...(retailKind ? { retailKind } : {}) });
const keys = (c: ChecklistCtx, f: ChecklistFactsV3 = none) => allSteps(f, c).filter((s) => !s.done).map((s) => s.key);

test('checklist steps by shop', () => {
  assert.ok(keys(ctx()).includes('retailProfile'));
  assert.ok(!keys(ctx('grocery')).includes('retailProfile'));
  assert.ok(keys(ctx('pharmacy', ['pharmacy'])).includes('drugLicence') && keys(ctx('pharmacy', ['pharmacy'])).includes('doctor'));
  assert.ok(keys(ctx('apparel', ['apparel'])).includes('variantGrid'));
  assert.ok(keys(ctx('electronics', ['electronics'])).includes('serialItem'));
  assert.ok(keys(ctx('jewellery', ['jewellery'])).includes('metalRate') && keys(ctx('jewellery', ['jewellery'])).includes('jewelTag'));
  assert.ok(keys(ctx('grocery')).includes('scaleOrBarcode'));
  assert.ok(!keys(ctx('grocery', [])).some((k) => k.startsWith('packFirst')), 'no pack-first step for retail packs');
  assert.ok(!keys(ctx('pharmacy', ['pharmacy']), { ...none, drugLicences: 1, doctors: 2 }).includes('doctor'), 'done by data');
});
