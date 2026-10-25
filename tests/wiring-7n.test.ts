/**
 * 7N integration gaps: set-off reminders for every regular filer (before the set-off screen is first
 * used), the POS return deep link, Alt+C stock masters, the loyalty editor hook and branch selects.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { registerBusinessAlerts } from '../src/lib/business-alerts.ts';
import { collectNotifications, type NotificationContext } from '../src/lib/notifications.ts';
import { tallyDestinations } from '../src/components/command/tally-destinations.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const ctx = (over: Partial<NotificationContext> = {}): NotificationContext => ({
  now: new Date(2026, 4, 17, 10),
  invoices: [],
  clients: [],
  profile: SELLER,
  lastBackup: new Date(2026, 4, 16).toISOString(),
  storageUsedBytes: 0,
  storageQuotaBytes: 5e6,
  ...over,
});

test('bell: GST set-off reminder for a regular filer before the set-off screen was used; never for composition', () => {
  registerBusinessAlerts();
  const setoff = (c: NotificationContext) => collectNotifications(c).filter((n) => n.id.startsWith('setoff:'));
  const regular = setoff(ctx());
  assert.equal(regular.length, 1, 'regular filer, no set-off / challan rows yet');
  assert.equal(regular[0].href, '/gst-reports?tab=setoff');
  assert.equal(setoff(ctx({ profile: { ...SELLER, gst_scheme: 'composition' } })).length, 0, 'composition dealer');
  assert.equal(setoff(ctx({ profile: { ...SELLER, companyGstin: '' } })).length, 0, 'unregistered');
});

test('palette "POS return / exchange" opens the return dialog (/pos?return=1)', () => {
  assert.ok(tallyDestinations().some((d) => d.href === '/pos?return=1'));
  const pos = readFileSync(new URL('../src/pages/Pos.tsx', import.meta.url), 'utf8');
  assert.match(pos, /params\.get\('return'\) === '1'/);
});

test('wiring: Alt+C stock masters, loyalty in the editor, edit log on stock items, branch selects', () => {
  const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  assert.match(src('components/masters/CreateMasterDialog.tsx'), /'stockItem' \| 'godown'/);
  assert.match(src('components/inventory/TransfersTab.tsx'), /kind: 'godown'/);
  assert.match(src('components/inventory/TransfersTab.tsx'), /kind: 'stockItem'/);
  assert.match(src('components/purchases/LineItemsEditor.tsx'), /kind: 'stockItem'/);
  assert.match(src('components/inventory/ItemFormModal.tsx'), /<EditLogButton recordId=\{item\.id\}/);
  const summary = src('components/creator/SummaryPanel.tsx');
  assert.match(summary, /lazy\(\(\) => import\('\.\.\/loyalty\/EditorLoyalty'\)\)/, 'loyalty loads lazily');
  assert.match(summary, /loyaltyOn &&/, 'only while the programme is on');
  assert.match(src('components/books/ledger/VoucherEditor.tsx'), /<BranchSelect /);
  assert.match(src('components/gateway/VoucherEntry.tsx'), /branch_id: branchId/);
  assert.match(src('pages/Transactions.tsx'), /<BranchFilter /);
  assert.match(src('pages/Expenses.tsx'), /<BranchFilter /);
  assert.match(src('components/books/ledger/LedgerPanel.tsx'), /scopeLedger\(fullLedger/);
  assert.match(src('components/gateway/DisplayReport.tsx'), /branchId \}/);
});
