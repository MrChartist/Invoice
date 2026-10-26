/**
 * R8 pack gate: with the trading packs off nothing changes for existing companies — no R8 tab is listed (its URL still
 * opens it), the bell and the page loaders read no R8 table, and the editor's lot picker is not mounted.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, setReadTrace, setTable } from '../src/lib/storage.ts';
import { TR_TABLES } from '../src/lib/trade/tr-shared.ts';
import { buildContext, collectNotifications } from '../src/lib/notifications.ts';
import { loadBooksData } from '../src/lib/books.ts';
import { activePacks, visiblePackTabs } from '../src/lib/industry-packs.ts';
import { DISTRIBUTION_TABS } from '../src/pages/page-tabs.ts';
import { readChecklistInputs } from '../src/lib/checklist-steps.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ business_type: 'wholesale' } as never);
});

const traced = (fn: () => void): string[] => {
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    fn();
  } finally {
    setReadTrace(prev);
  }
  return Object.values(TR_TABLES).filter((t) => seen.has(DB_PREFIX + t) || seen.has(t));
};

test('packs off: no R8 tab listed, no R8 table read by the bell, the books, the invoice list or the checklist', () => {
  for (const t of Object.values(TR_TABLES)) setTable(t, [{ id: 'x' }]);
  const s = localDb.settings.get();
  assert.deepEqual(activePacks(s), []);
  const ids = visiblePackTabs(DISTRIBUTION_TABS, s).map((t) => t.id);
  for (const id of ['claims', 'packaging', 'mandi', 'brokers', 'agency'] as const) assert.ok(!ids.includes(id), id);
  assert.ok(visiblePackTabs(DISTRIBUTION_TABS, s, 'agency').some((t) => t.id === 'agency'), 'opened by URL');
  assert.deepEqual(traced(() => { collectNotifications(buildContext(new Date('2026-06-01T10:00:00'))); loadBooksData(); localDb.invoices.getAll(); readChecklistInputs(); }), []);
});

test('pack on: the checklist reads its first table', () => {
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: ['agency'] });
  assert.ok(traced(() => readChecklistInputs()).includes('arrivals'));
});

test('the editor mounts the lot picker only with the agency pack on, lazily', () => {
  const text = readFileSync(new URL('../src/components/creator/ItemsTable.tsx', import.meta.url), 'utf8');
  assert.match(text, /const LotPicker = lazy\(\(\) => import\('\.\.\/trade\/LotPicker'\)\)/);
  assert.match(text, /\{agencyOn && .*<LotPicker /);
});
