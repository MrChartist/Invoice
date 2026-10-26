/** TR-C3 trading sample data: built per trading pack, loaded only into the marked Demo company, fully removable. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { buildDemoDataset, demoProfileFor, demoStatus, loadDemoData, removeDemoData, DEMO_EXTRA_TABLES } from '../src/lib/demo-data.ts';
import { demoExtras } from '../src/lib/demo/profiles.ts';
import { localDb } from '../src/lib/localDb.ts';
import { writeRegistry } from '../src/lib/company-registry.ts';
import { getTable } from '../src/lib/storage.ts';
import { buildLedger, loadLedgerInput, trialBalance } from '../src/lib/ledger/index.ts';
import { agencySales, loadArrivals, lotBalances } from '../src/lib/trade/tr-arrivals.ts';
import { loadPattis } from '../src/lib/trade/tr-patti.ts';
import { loadPositions } from '../src/lib/inventory.ts';

const TODAY = '2026-10-07';
beforeEach(() => resetStorage());

const openDemoDb = () => {
  writeRegistry({ active: 'demo1', list: [{ id: 'default', name: 'Main business', created: '' }, { id: 'demo1', name: 'Demo', created: '', demo: true }] });
  localDb.settings.save({ ...localDb.settings.get(), demo_company: true });
};

test('a wholesale company with trading packs gets the trading profile; the agent rows need the agency pack', async () => {
  assert.equal(demoProfileFor({ business_type: 'wholesale', industry_packs: ['agency', 'commodity'] }), 'trading');
  const base = buildDemoDataset(TODAY);
  assert.deepEqual(await demoExtras('trading', { today: TODAY, base, packs: [] }), {});
  const dist = await demoExtras('trading', { today: TODAY, base, packs: ['distributor'] });
  assert.deepEqual(Object.keys(dist.tables ?? {}).sort(), ['packaging_moves', 'packaging_types', 'party_rates', 'schemes'], 'R8-A distributor rows');
  assert.ok(Object.values(dist.tables!).every((rows) => rows!.every((r) => r.demo === true)));
  const ex = await demoExtras('trading', { today: TODAY, base, packs: ['agency', 'commodity'] });
  const agency = ex.invoices!.filter((i) => i.agency); // R8-B adds the commodity sale (no agency lines)
  assert.equal(agency.length, 2);
  assert.ok(agency.every((i) => i.items.every((l) => l.arrival_id === 'demo-arrival-1')));
  assert.equal(ex.tables?.arrivals?.length, 1);
  assert.equal(ex.tables?.indents?.length, 2);
  assert.equal(ex.tables?.sale_pattis?.length, 1);
});

test('agent dataset loads only into the Demo company, balances, keeps stock clean and is removed completely', async () => {
  const extras = await demoExtras('trading', { today: TODAY, base: buildDemoDataset(TODAY), packs: ['agency', 'commodity'] });
  const refused = loadDemoData({ today: TODAY, confirm: true, extras });
  assert.equal(refused.ok, false, 'never into a company that is not the marked Demo company');
  assert.equal(getTable('arrivals').length, 0);
  openDemoDb();
  const series = getTable('series_counters');
  assert.ok(loadDemoData({ today: TODAY, confirm: true, extras }).ok);
  const [lot] = lotBalances(loadArrivals(), agencySales(localDb.invoices.getAll()));
  assert.deepEqual([lot.sold, lot.balance], [25, 15]);
  const p = loadPattis()[0];
  assert.equal(p.status, 'draft');
  assert.equal(p.gross, 61_500);
  assert.equal(p.net_payable, 61_500 - 1537.5 - 200, 'hamali on the 50 bags sold (80 × 25 / 40)');
  const tb = trialBalance(buildLedger(loadLedgerInput(undefined, TODAY)), { start: '2000-01-01', end: TODAY });
  assert.ok(Math.abs(tb.totals.debit - tb.totals.credit) < 0.01);
  assert.ok(loadPositions().every((x) => !x.isNegative));
  assert.deepEqual(getTable('series_counters'), series, 'no real series number reserved');
  removeDemoData();
  assert.equal(demoStatus().loaded, false);
  for (const t of DEMO_EXTRA_TABLES) assert.equal(getTable<{ demo?: boolean }>(t).filter((r) => r.demo).length, 0, t);
});
