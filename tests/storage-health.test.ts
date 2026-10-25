import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { LOCAL_QUOTA_CHARS, assessStorage, measureStorage, type StorageInput } from '../src/lib/storage-health.ts';

beforeEach(() => resetStorage());

const NOW = new Date('2026-10-20T10:00:00Z');
const base: StorageInput = {
  usedChars: 100_000, tables: [{ key: 'mrchartist_inv_invoices', chars: 90_000 }], embeddedImageChars: 0, invoicesWithImages: 0,
  persisted: true, iosSafari: false, standalone: false, lastBackupIso: '2026-10-19T10:00:00Z', now: NOW,
};
const ids = (i: StorageInput) => assessStorage(i).findings.map((f) => f.id);

test('healthy device: no findings, level ok', () => {
  const h = assessStorage(base);
  assert.equal(h.level, 'ok');
  assert.deepEqual(h.findings, []);
  assert.deepEqual(h.biggest, [{ name: 'invoices', chars: 90_000 }]);
});

test('fill thresholds: warn at 75%, critical at 90%', () => {
  assert.equal(assessStorage({ ...base, usedChars: LOCAL_QUOTA_CHARS * 0.8 }).level, 'warn');
  const full = assessStorage({ ...base, usedChars: LOCAL_QUOTA_CHARS * 0.95 });
  assert.equal(full.level, 'critical');
  assert.equal(full.pct, 95);
});

test('Safari outside the Home Screen is critical; unpersisted elsewhere is a warning', () => {
  assert.deepEqual(ids({ ...base, iosSafari: true }), ['safari']);
  assert.deepEqual(ids({ ...base, iosSafari: true, standalone: true }), []);
  assert.deepEqual(ids({ ...base, persisted: false }), ['persist']);
});

test('stale or missing backups are flagged only when there is data', () => {
  assert.deepEqual(ids({ ...base, lastBackupIso: '2026-10-01T00:00:00Z' }), ['backup']);
  assert.deepEqual(ids({ ...base, lastBackupIso: null }), ['backup']);
  assert.deepEqual(ids({ ...base, lastBackupIso: null, tables: [] }), []);
});

test('measureStorage attributes logo/signature images embedded in invoice snapshots', () => {
  const logo = 'data:image/png;base64,' + 'A'.repeat(1000);
  localStorage.setItem('mrchartist_inv_invoices', JSON.stringify([
    { id: '1', sender: { logo } },
    { id: '2', sender: { logo, signature: logo } },
    { id: '3', sender: {} },
  ]));
  const m = measureStorage();
  assert.equal(m.invoicesWithImages, 2);
  assert.equal(m.embeddedImageChars, logo.length * 3);
  assert.ok(m.usedChars > m.embeddedImageChars);
  const h = assessStorage({ ...base, ...m, quotaChars: 20_000 });
  assert.ok(h.findings.some((f) => f.id === 'logos'));
});
