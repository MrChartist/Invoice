/**
 * R5-C pack gate: with the fees / non-profit / leases packs off, existing companies see no change — no R5-C tab is
 * listed, the bell provider reads no R5-C table, the page data loaders never touch one, and nothing first-paint (or
 * any page) imports the package statically: every screen comes through the lazy door (`r5c-lazy.ts`).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupR5c } from './helpers/r5c.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, setReadTrace } from '../src/lib/storage.ts';
import { R5C_TABLES } from '../src/lib/institutions/r5c.ts';
import { registerR5cAlerts } from '../src/lib/institutions/r5c-alerts.ts';
import { buildContext, collectNotifications } from '../src/lib/notifications.ts';
import { PACK_TABS, activePacks, visibleTabs } from '../src/lib/industry-packs.ts';
import { GST_TABS, PACK_GST_TABS } from '../src/lib/gst-tabs.ts';
import { loadBooksData } from '../src/lib/books.ts';
import { savePlan } from '../src/lib/institutions/fee-plans.ts';
import { recurringDb } from '../src/lib/recurring.ts';

beforeEach(() => setupR5c());

const traced = (fn: () => void): string[] => {
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    fn();
  } finally {
    setReadTrace(prev);
  }
  return R5C_TABLES.filter((t) => seen.has(DB_PREFIX + t) || seen.has(t));
};
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('no pack: no R5-C tab is listed (the URL still opens it), no table is read by the bell or the page loaders', () => {
  savePlan({ name: 'P', year_label: '', heads: [{ name: 'T', amount: 100, tax: 'exempt', frequency: 'once' }], instalments: [{ label: 'I', due_date: '2026-06-01', share: 100 }] });
  localDb.settings.save({ ...localDb.settings.get(), industry_packs: [] });
  const s = localDb.settings.get();
  assert.deepEqual(activePacks(s), []);
  const tabs = [{ id: 'schedules' }, { id: 'fees', pack: 'fees' as const }, { id: 'leases', pack: 'leases' as const }];
  assert.deepEqual(visibleTabs(tabs, s).map((t) => t.id), ['schedules']);
  assert.deepEqual(visibleTabs(tabs, s, 'fees').map((t) => t.id), ['schedules', 'fees'], 'opened by URL');
  assert.deepEqual(PACK_GST_TABS['common-credit'], ['fees', 'nonprofit', 'leases', 'hotel', 'clinic', 'salon', 'fitness']); // + R7-C1 (D12); + R10 (SV-A4)
  registerR5cAlerts();
  let out: ReturnType<typeof collectNotifications> = [];
  assert.deepEqual(traced(() => { out = collectNotifications(buildContext(new Date('2026-06-01T10:00:00'))); }), []);
  assert.ok(!out.some((n) => /^(fee|npo|lease):/.test(n.id)));
  assert.deepEqual(traced(() => { loadBooksData(); recurringDb.getAll(); localDb.invoices.getAll(); }), []);
  // Existing business types imply none of the three packs.
  for (const t of ['kirana', 'services', 'full', undefined]) assert.deepEqual(activePacks({ business_type: t }), []);
});

test('pack on: the same provider reads its tables and raises notices', () => {
  savePlan({ name: 'P', year_label: '', heads: [{ name: 'T', amount: 100, tax: 'exempt', frequency: 'once' }], instalments: [{ label: 'I', due_date: '2026-06-02', share: 100 }] });
  registerR5cAlerts();
  assert.ok(traced(() => collectNotifications(buildContext(new Date('2026-06-01T10:00:00')))).includes('fee_plans'));
});

test('no first-paint module or page imports the package statically; hosts go through the lazy door', () => {
  for (const f of ['main.tsx', 'App.tsx', 'layouts/DashboardLayout.tsx', 'pages/Dashboard.tsx', 'store/useInvoiceStore.ts', 'components/command/NotificationBell.tsx',
    'pages/Recurring.tsx', 'pages/Receivables.tsx', 'pages/Books.tsx', 'pages/GstReports.tsx', 'components/settings/ProfileEditor.tsx']) {
    const code = src(f).replace(/^import type [^;]*;/gm, '');
    assert.ok(!/^import [^;]*(institutions\/|nonprofit\/|property\/|r5c)/m.test(code), f);
  }
  for (const f of ['pages/Recurring.tsx', 'pages/Receivables.tsx', 'pages/Books.tsx', 'pages/GstReports.tsx', 'components/settings/ProfileEditor.tsx']) {
    assert.match(src(f), /import\('\.\.\/(components\/)?institutions\/r5c-lazy'\)/, f);
  }
  assert.match(src('components/command/NotificationBell.tsx'), /function ensureR5cAlerts[\s\S]*?industry_packs[\s\S]*?import\('\.\.\/institutions\/r5c-lazy'\)/);
  // Every new page tab is pack-filtered (R6-B1: the tab lists moved to src/pages/page-tabs.ts).
  assert.match(src('pages/page-tabs.ts'), /id: 'fees'[^\n]*pack: 'fees'/);
  assert.match(src('pages/page-tabs.ts'), /id: 'leases'[^\n]*pack: 'leases'/);
  assert.match(src('pages/page-tabs.ts'), /id: 'donations'[^\n]*pack: 'nonprofit'/);
  assert.match(src('pages/page-tabs.ts'), /id: 'funds'[^\n]*pack: 'nonprofit'/);
  assert.ok(GST_TABS.some((t) => t.id === 'common-credit'));
  assert.match(src('components/settings/ProfileEditor.tsx'), /isPackOn\(localDb\.settings\.get\(\), 'nonprofit'\) && <Suspense/);
});

test('Ctrl+K rows for the package', () => {
  const rows = PACK_TABS.filter((t) => ['fees', 'nonprofit', 'leases'].includes(t.pack)).map((t) => t.path);
  assert.deepEqual(rows, ['/recurring?tab=fees', '/recurring?tab=leases', '/receivables?tab=donations', '/books?tab=funds', '/gst-reports?tab=common-credit',
    '/recurring?tab=fees&view=batches', '/recurring?tab=fees&view=attendance', '/recurring?tab=fees&view=refunds']); // R10 (SV-C views, rows by SV-A)
});
