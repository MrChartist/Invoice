/** R5-A: with the marketplace pack off, no marketplace table is read and nothing first-paint imports the package. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupWorld } from './helpers/marketplace.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, setReadTrace } from '../src/lib/storage.ts';
import { MARKETPLACE_TABLES } from '../src/lib/marketplace/channels.ts';
import { registerMarketplaceAlerts } from '../src/lib/marketplace/marketplace-alerts.ts';
import { buildContext, collectNotifications } from '../src/lib/notifications.ts';

beforeEach(() => { setupWorld(); });

const traced = (fn: () => void): Set<string> => {
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    fn();
  } finally {
    setReadTrace(prev);
  }
  return seen;
};
const mkt = (keys: Set<string>) => MARKETPLACE_TABLES.filter((t) => keys.has(DB_PREFIX + t) || keys.has(t));

test('pack off: the bell provider reads no marketplace table and raises nothing', () => {
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: [] });
  registerMarketplaceAlerts();
  let out: ReturnType<typeof collectNotifications> = [];
  const keys = traced(() => { out = collectNotifications(buildContext(new Date('2026-12-31T10:00:00'))); });
  assert.deepEqual(mkt(keys), []);
  assert.ok(!out.some((n) => n.id.startsWith('mkt:')));
});

test('pack on: the same provider does read them', () => {
  registerMarketplaceAlerts();
  const keys = traced(() => { collectNotifications(buildContext(new Date('2026-12-31T10:00:00'))); });
  assert.ok(mkt(keys).includes('sales_channels'));
});

test('no first-paint module imports the marketplace package statically', () => {
  for (const f of ['src/main.tsx', 'src/App.tsx', 'src/layouts/DashboardLayout.tsx', 'src/pages/Dashboard.tsx', 'src/store/useInvoiceStore.ts', 'src/components/command/NotificationBell.tsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/^import [^;]*(marketplace\/|industry-packs)/m.test(src.replace(/^import type [^;]*;/gm, '')), f);
  }
  const rcv = readFileSync(new URL('../src/pages/Receivables.tsx', import.meta.url), 'utf8');
  assert.match(rcv, /lazy\(\(\) => import\('\.\.\/components\/marketplace\/MarketplaceTab'\)\)/);
  assert.ok(!/^import [^;]*components\/marketplace/m.test(rcv));
});
