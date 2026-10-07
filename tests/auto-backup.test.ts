import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeAge,
  filesToDelete,
  isBackupFile,
  parseConfig,
  shouldBackup,
  shouldNudge,
} from '../src/lib/auto-backup.ts';

const NOW = new Date('2026-10-07T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

test('shouldBackup: never backed up (or garbage) is always due', () => {
  for (const f of ['daily', 'weekly', 'on-close'] as const) {
    assert.equal(shouldBackup(null, NOW, f), true);
    assert.equal(shouldBackup('not-a-date', NOW, f), true);
  }
});

test('shouldBackup: daily / weekly thresholds', () => {
  assert.equal(shouldBackup(ago(23 * H), NOW, 'daily'), false);
  assert.equal(shouldBackup(ago(24 * H), NOW, 'daily'), true);
  assert.equal(shouldBackup(ago(6 * D), NOW, 'weekly'), false);
  assert.equal(shouldBackup(ago(7 * D), NOW, 'weekly'), true);
});

test('shouldBackup: on-close debounces, and a future timestamp never fires', () => {
  assert.equal(shouldBackup(ago(60_000), NOW, 'on-close'), false);
  assert.equal(shouldBackup(ago(10 * 60_000), NOW, 'on-close'), true);
  assert.equal(shouldBackup(new Date(NOW.getTime() + D).toISOString(), NOW, 'daily'), false);
});

test('shouldNudge: needs data, >7 days, respects snooze', () => {
  assert.equal(shouldNudge({ lastIso: null, now: NOW, hasData: false }), false);
  assert.equal(shouldNudge({ lastIso: null, now: NOW, hasData: true }), true);
  assert.equal(shouldNudge({ lastIso: ago(7 * D), now: NOW, hasData: true }), false);
  assert.equal(shouldNudge({ lastIso: ago(8 * D), now: NOW, hasData: true }), true);
  const until = new Date(NOW.getTime() + D).toISOString();
  assert.equal(shouldNudge({ lastIso: ago(30 * D), now: NOW, hasData: true, snoozeUntilIso: until }), false);
  const past = new Date(NOW.getTime() - H).toISOString();
  assert.equal(shouldNudge({ lastIso: ago(30 * D), now: NOW, hasData: true, snoozeUntilIso: past }), true);
});

test('isBackupFile: only our own dated files', () => {
  assert.equal(isBackupFile('mrchartist-invoice-backup-2026-10-07.json'), true);
  assert.equal(isBackupFile('mrchartist-invoice-backup-2026-10-07 (1).json'), true);
  assert.equal(isBackupFile('notes.json'), false);
  assert.equal(isBackupFile('mrchartist-invoice-backup-latest.json'), false);
});

test('filesToDelete: keeps newest N, never touches foreign files', () => {
  const names = [
    'mrchartist-invoice-backup-2026-10-01.json',
    'mrchartist-invoice-backup-2026-10-05.json',
    'holiday.jpg',
    'mrchartist-invoice-backup-2026-09-30.json',
    'mrchartist-invoice-backup-2026-10-07.json',
    'mrchartist-invoice-backup-2026-10-03.json',
  ];
  assert.deepEqual(filesToDelete(names, 3), [
    'mrchartist-invoice-backup-2026-10-01.json',
    'mrchartist-invoice-backup-2026-09-30.json',
  ]);
  assert.deepEqual(filesToDelete(names, 10), []);
  assert.equal(filesToDelete(names, 0).length, 4); // clamps to keep at least 1
  assert.deepEqual(filesToDelete([], 5), []);
});

test('parseConfig: defaults, clamping and bad input', () => {
  assert.deepEqual(parseConfig(null), { enabled: false, frequency: 'daily', retention: 7 });
  assert.deepEqual(parseConfig('{oops'), { enabled: false, frequency: 'daily', retention: 7 });
  assert.deepEqual(parseConfig('{"enabled":true,"frequency":"weekly","retention":14}'), {
    enabled: true,
    frequency: 'weekly',
    retention: 14,
  });
  assert.equal(parseConfig('{"frequency":"hourly"}').frequency, 'daily');
  assert.equal(parseConfig('{"retention":0}').retention, 1);
  assert.equal(parseConfig('{"retention":9999}').retention, 60);
});

test('describeAge', () => {
  assert.equal(describeAge(null, NOW), 'never');
  assert.equal(describeAge(ago(10_000), NOW), 'just now');
  assert.equal(describeAge(ago(5 * 60_000), NOW), '5 min ago');
  assert.equal(describeAge(ago(H), NOW), '1 hour ago');
  assert.equal(describeAge(ago(3 * D), NOW), '3 days ago');
});
