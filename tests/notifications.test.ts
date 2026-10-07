import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_PROVIDERS,
  applyState,
  backupProvider,
  collectNotifications,
  dayDiff,
  dismiss,
  dueSoonProvider,
  markAllRead,
  markRead,
  missingGstinProvider,
  overdueProvider,
  profileProvider,
  pruneState,
  registerNotificationProvider,
  snooze,
  staleDraftProvider,
  storageProvider,
  unreadCount,
  type NotificationContext,
} from '../src/lib/notifications.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const NOW = new Date(2026, 5, 15, 10, 0, 0); // 15 Jun 2026, local

function inv(over: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id: Math.random().toString(36).slice(2),
    invoice_number: 'INV/FY26-27/0001',
    doc_type: 'INVOICE',
    status: 'Sent',
    issue_date: '2026-06-01',
    due_date: '2026-07-30',
    total: 1000,
    amount_paid: 0,
    balance_due: 1000,
    client: { id: 'c1', name: 'Acme', email: '', address: '', city: '', zip: '', gstin: '27AAAAA0000A1Z5' },
    ...over,
  } as InvoiceRecord;
}

const fullProfile = {
  companyName: 'MrChartist', companyGstin: '27X', accountNumber: '123', ifsc: 'HDFC0001', upiId: 'a@upi',
} as never;

function ctx(over: Partial<NotificationContext> = {}): NotificationContext {
  return {
    now: NOW,
    invoices: [],
    clients: [],
    profile: fullProfile,
    lastBackup: new Date(2026, 5, 10).toISOString(),
    storageUsedBytes: 100,
    storageQuotaBytes: 5 * 1024 * 1024,
    ...over,
  };
}

test('dayDiff counts calendar days', () => {
  assert.equal(dayDiff(new Date(2026, 5, 15, 23), new Date(2026, 5, 16, 1)), 1);
  assert.equal(dayDiff(new Date(2026, 5, 15), new Date(2026, 5, 12)), -3);
});

test('overdue: grouped with total; none when nothing late', () => {
  assert.equal(overdueProvider(ctx({ invoices: [inv({})] })).length, 0);
  const n = overdueProvider(
    ctx({
      invoices: [
        inv({ due_date: '2026-06-01', balance_due: 500 }),
        inv({ due_date: '2026-05-01', balance_due: 250.5 }),
        inv({ due_date: '2026-05-01', status: 'Paid', balance_due: 0 }),
        inv({ due_date: '2026-05-01', status: 'Draft' }),
      ],
    }),
  );
  assert.equal(n.length, 1);
  assert.equal(n[0].severity, 'critical');
  assert.match(n[0].title, /^2 invoices overdue/);
  assert.match(n[0].detail, /750\.50/);
});

test('due soon: boundary is today..+3 days inclusive', () => {
  const mk = (due: string) => dueSoonProvider(ctx({ invoices: [inv({ due_date: due })] })).length;
  assert.equal(mk('2026-06-15'), 1); // today
  assert.equal(mk('2026-06-18'), 1); // +3
  assert.equal(mk('2026-06-19'), 0); // +4
  assert.equal(mk('2026-06-14'), 0); // overdue belongs to the other provider
  assert.equal(dueSoonProvider(ctx({ invoices: [inv({ due_date: '2026-06-16', status: 'Draft' })] })).length, 0);
});

test('stale drafts: older than 7 days only', () => {
  const mk = (iso: string) =>
    staleDraftProvider(ctx({ invoices: [inv({ status: 'Draft', created_at: iso })] })).length;
  assert.equal(mk(new Date(2026, 5, 7, 9).toISOString()), 1); // 8 days + 1h
  assert.equal(mk(new Date(2026, 5, 9, 10).toISOString()), 0); // 6 days
  assert.equal(mk(new Date(2026, 5, 8, 10).toISOString()), 0); // exactly 7 days
});

test('backup: never / stale / fresh', () => {
  assert.equal(backupProvider(ctx({ lastBackup: null })).length, 0, 'empty app needs no backup');
  const never = backupProvider(ctx({ lastBackup: null, invoices: [inv({})] }));
  assert.equal(never[0].id, 'backup:never');
  const day = 86400000;
  assert.equal(backupProvider(ctx({ lastBackup: new Date(NOW.getTime() - 13 * day).toISOString() })).length, 0);
  const stale = backupProvider(ctx({ lastBackup: new Date(NOW.getTime() - 14 * day).toISOString() }));
  assert.equal(stale[0].id, 'backup:stale');
  assert.match(stale[0].title, /14 days/);
});

test('storage: threshold above 80% only; critical at 95%', () => {
  const q = 1000;
  assert.equal(storageProvider(ctx({ storageUsedBytes: 800, storageQuotaBytes: q })).length, 0);
  const warn = storageProvider(ctx({ storageUsedBytes: 850, storageQuotaBytes: q }));
  assert.equal(warn[0].severity, 'warning');
  assert.equal(storageProvider(ctx({ storageUsedBytes: 960, storageQuotaBytes: q }))[0].severity, 'critical');
});

test('profile: lists exactly what is missing', () => {
  assert.equal(profileProvider(ctx()).length, 0);
  const n = profileProvider(ctx({ profile: { companyName: 'X', companyGstin: '', accountNumber: '', ifsc: '', upiId: '' } as never }));
  assert.match(n[0].detail, /GSTIN, bank details, UPI ID/);
  assert.equal(profileProvider(ctx({ profile: null })).length, 1);
});

test('missing client GSTIN: only large, sent invoices; live client GSTIN suppresses', () => {
  const noGstin = { id: 'c9', name: 'Beta', email: '', address: '', city: '', zip: '' };
  const big = inv({ total: 60000, client: noGstin });
  assert.equal(missingGstinProvider(ctx({ invoices: [big] })).length, 1);
  assert.equal(missingGstinProvider(ctx({ invoices: [inv({ total: 49999, client: noGstin })] })).length, 0);
  assert.equal(missingGstinProvider(ctx({ invoices: [{ ...big, status: 'Draft' }] })).length, 0);
  assert.equal(
    missingGstinProvider(ctx({ invoices: [big], clients: [{ ...noGstin, gstin: '29ABCDE1234F1Z5' }] })).length,
    0,
  );
  // two invoices, one client → one notification
  assert.equal(missingGstinProvider(ctx({ invoices: [big, { ...big, id: 'z' }] })).length, 1);
});

test('collect: dedupes ids, survives throwing providers, sorts by severity', () => {
  const dup = () => [
    { id: 'x', severity: 'info' as const, title: 'a', detail: '', at: NOW.toISOString() },
    { id: 'x', severity: 'critical' as const, title: 'dup', detail: '', at: NOW.toISOString() },
  ];
  const boom = () => {
    throw new Error('nope');
  };
  const crit = () => [{ id: 'y', severity: 'critical' as const, title: 'c', detail: '', at: NOW.toISOString() }];
  const out = collectNotifications(ctx(), [dup, boom, crit]);
  assert.deepEqual(out.map((n) => n.id), ['y', 'x']);
  assert.equal(out[1].title, 'a');
});

test('registerNotificationProvider adds and unregisters', () => {
  const off = registerNotificationProvider(() => [
    { id: 'custom:1', severity: 'info', title: 'hi', detail: '', at: NOW.toISOString() },
  ]);
  assert.ok(collectNotifications(ctx()).some((n) => n.id === 'custom:1'));
  off();
  assert.ok(!collectNotifications(ctx()).some((n) => n.id === 'custom:1'));
  assert.ok(BUILTIN_PROVIDERS.length >= 7);
});

test('state: read, snooze 1/7 days, dismiss, prune — fixed clock', () => {
  const list = [
    { id: 'a', severity: 'info' as const, title: 'a', detail: '', at: NOW.toISOString() },
    { id: 'b', severity: 'info' as const, title: 'b', detail: '', at: NOW.toISOString() },
    { id: 'c', severity: 'info' as const, title: 'c', detail: '', at: NOW.toISOString() },
  ];
  let st = markRead([], 'a', NOW);
  assert.equal(unreadCount(applyState(list, st, NOW)), 2);
  st = snooze(st, 'b', 1, NOW);
  st = snooze(st, 'c', 7, NOW);
  assert.deepEqual(applyState(list, st, NOW).map((n) => n.id), ['a']);

  const in23h = new Date(NOW.getTime() + 23 * 3600000);
  assert.deepEqual(applyState(list, st, in23h).map((n) => n.id), ['a']);
  const in25h = new Date(NOW.getTime() + 25 * 3600000);
  assert.deepEqual(applyState(list, st, in25h).map((n) => n.id), ['a', 'b']);
  const in8d = new Date(NOW.getTime() + 8 * 86400000);
  assert.deepEqual(applyState(list, st, in8d).map((n) => n.id), ['a', 'b', 'c']);

  st = dismiss(st, 'c');
  assert.deepEqual(applyState(list, st, in8d).map((n) => n.id), ['a', 'b']);

  const pruned = pruneState(st, ['a', 'c'], in8d);
  assert.deepEqual(pruned.map((s) => s.id).sort(), ['a', 'c']);

  const all = markAllRead([], ['a', 'b'], NOW);
  assert.equal(unreadCount(applyState(list, all, NOW)), 1);
  assert.equal(all.length, 2);
});
