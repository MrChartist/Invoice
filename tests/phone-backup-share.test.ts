/**
 * 8.20 "Share backup" end to end (Web Share Level 2 mocked): owner only, encrypted unless the user
 * explicitly asks otherwise, never readable in vault mode, `.txt` fallback for Android Chrome, and the
 * "last backup" time moves only when the file was actually shared.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { fakeIdb, installFakeIdb } from './helpers/fake-idb.ts';
import { DB_PREFIX, enableVault, initStorage, resetStorageBackend, setTable } from '../src/lib/storage.ts';
import { resetIdbConnection } from '../src/lib/idb-kv.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { decryptBackup, isEncryptedBackup } from '../src/lib/backup.ts';
import { getLastBackup } from '../src/lib/auto-backup-schedule.ts';
import { forgetDeviceData, setBackupPassphrase } from '../src/lib/auto-backup.ts';
import { shareBackupNow } from '../src/lib/backup-share.ts';

const shared: File[] = [];
let accept = (f: File) => /\.(json|txt)$/.test(f.name);
let outcome: 'ok' | 'abort' = 'ok';
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    canShare: ({ files }: { files?: File[] }) => !!files?.length && files.every((f) => accept(f)),
    share: async ({ files }: { files?: File[] }) => {
      if (outcome === 'abort') throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      shared.push(...(files ?? []));
    },
  },
});

const viewer = () => ({ id: 'u2', name: 'Viewer', role: 'viewer' as const });
const PASS = 'correct horse battery';

beforeEach(async () => {
  setActorProvider(null);
  resetStorageBackend();
  resetIdbConnection();
  fakeIdb.reset();
  installFakeIdb();
  resetStorage();
  await forgetDeviceData();
  shared.length = 0;
  accept = (f) => /\.(json|txt)$/.test(f.name);
  outcome = 'ok';
  assert.equal((await initStorage({ timeoutMs: 500 })).backend, 'idb');
  setTable('clients', [{ id: 'c1', name: 'Acme Secret Traders' }]);
});

test('a clerk / viewer cannot share a full backup', async () => {
  setActorProvider(viewer);
  const r = await shareBackupNow({ passphrase: PASS });
  assert.equal(r.ok, false);
  assert.equal((r as { reason: string }).reason, 'denied');
  assert.equal(shared.length, 0);
});

test('no passphrase: refused until one is set; a typed passphrase shares an encrypted file that restores', async () => {
  const none = await shareBackupNow();
  assert.equal((none as { reason: string }).reason, 'needs-passphrase');
  const r = await shareBackupNow({ passphrase: PASS });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(shared.length, 1);
  const text = await shared[0].text();
  assert.ok(isEncryptedBackup(text) && !text.includes('Acme'), 'encrypted, nothing readable');
  assert.match(shared[0].name, /\.encrypted\.json$/);
  const back = await decryptBackup(text, PASS);
  assert.ok(back.data[`${DB_PREFIX}clients`].includes('Acme'));
  assert.ok(getLastBackup(), 'counts as a backup');
});

test('the stored backup key is used without asking; Android-style .json refusal falls back to .txt', async () => {
  assert.deepEqual(await setBackupPassphrase(PASS), { ok: true });
  accept = (f) => f.name.endsWith('.txt') && f.type === 'text/plain';
  const r = await shareBackupNow();
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(shared[0].name, /\.encrypted\.txt$/);
  assert.ok(!(await shared[0].text()).includes('Acme'));
});

test('cancelling the share sheet does not count as a backup', async () => {
  outcome = 'abort';
  const r = await shareBackupNow({ passphrase: PASS });
  assert.equal((r as { reason: string }).reason, 'cancelled');
  assert.equal(getLastBackup(), null);
});

test('readable file only on request, and never in vault mode', async () => {
  const plain = await shareBackupNow({ allowPlain: true });
  assert.ok(plain.ok);
  assert.ok((await shared[0].text()).includes('Acme'), 'the user asked for a readable file');
  shared.length = 0;
  await enableVault('vault passphrase 123');
  const refused = await shareBackupNow({ allowPlain: true });
  assert.equal((refused as { reason: string }).reason, 'vault');
  assert.equal(shared.length, 0);
  const enc = await shareBackupNow({ passphrase: PASS });
  assert.ok(enc.ok);
  assert.ok(!(await shared[0].text()).includes('Acme'), 'vault mode: encrypted only');
});
