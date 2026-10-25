/**
 * Regression tests for the independent security review (roles 6.21, backups, sync, parsers).
 * Each test was a passing proof-of-concept against the vulnerable code; it now asserts the fix.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import { FakeDir } from './helpers/fake-dir.ts';
import { SINGLETON_KEYS, getTable, readRaw, setTable, writeRaw } from '../src/lib/storage.ts';
import { login, logout, unlock, getCurrentUser, isAuthenticated, readUsers, writeUsers, listUsers, resetAllData, resetNeedsOwnerName, setIdleTimeout, getIdleTimeout } from '../src/lib/auth.ts';
import { addUser, removeUser } from '../src/lib/users.ts';
import { AccessDeniedError, can, currentRole, isSignedOut, requireAccess, setActorProvider } from '../src/lib/access.ts';
import { buildBackup, buildEncryptedBackup, buildScheduledBackup, exportPlainBackup, restoreBackup, saveSafetySnapshot } from '../src/lib/backup.ts';
import { backupPayload, downloadBackupNow, runAutoBackup } from '../src/lib/auto-backup.ts';
import { saveConfig } from '../src/lib/auto-backup-schedule.ts';
import { createOrJoinGroup, openGroup } from '../src/lib/sync-files.ts';
import { loadConflicts, resolveConflict, runSync, changesPaymentDetails } from '../src/lib/sync-engine.ts';
import { MAX_TABLE_CELLS, MAX_TABLE_COLUMNS, TableLimitError, parseCsv, parseTable } from '../src/lib/csv.ts';
import { readXlsx, sheetToTable } from '../src/lib/xlsx.ts';
import { writeZip } from '../src/lib/zip.ts';
import { parseBankStatement } from '../src/lib/bank-recon.ts';
import { getCurrentUser as actorProvider } from '../src/lib/auth.ts';

const OWNER_PIN = '482915';
const viewer = () => ({ id: 'u2', name: 'Viewer', role: 'viewer' as const });
const clerk = () => ({ id: 'u3', name: 'Clerk', role: 'clerk' as const });

/** Put auth.ts's provider back after a test swapped in its own actor. */
const restoreProvider = () => setActorProvider(actorProvider, { signInRequired: () => readRaw(SINGLETON_KEYS.auth) !== null });

beforeEach(() => {
  logout();
  resetStorage();
  restoreProvider();
});

async function ownerWithViewer(): Promise<string> {
  assert.ok(await login('Owner', OWNER_PIN));
  const r = await addUser('Vik', 'viewer', '739164');
  assert.ok(r.ok);
  return r.user.id;
}

/* ── M1: a removed user's tab must not become the owner ──────────── */

test('M1: a removed user is signed out (viewer role, app must lock), never the owner', async () => {
  const vid = await ownerWithViewer();
  logout();
  assert.ok((await unlock('739164', Date.now(), vid)).ok);
  assert.equal(currentRole(), 'viewer');
  // The owner removes Vik in another tab (same localStorage; Vik's tab keeps its session id).
  writeUsers(readUsers().filter((u) => u.id !== vid));
  assert.equal(getCurrentUser(), null);
  assert.equal(isAuthenticated(), false, 'App re-checks this on storage / broadcast / focus / idle tick and locks');
  assert.equal(isSignedOut(), true);
  assert.equal(currentRole(), 'viewer', 'never escalates to owner');
  for (const a of ['data.erase', 'data.restore', 'data.backup', 'security.manage', 'settings.manage'] as const) assert.equal(can(a), false, a);
  assert.throws(() => restoreBackup({}), AccessDeniedError);
});

test('M1: locked device with a PIN set up is signed out; no PIN (single-user / tests) still acts as owner', async () => {
  assert.equal(currentRole(), 'owner', 'no credential: unchanged behaviour');
  assert.equal(isSignedOut(), false);
  assert.ok(await login('Owner', OWNER_PIN));
  assert.equal(currentRole(), 'owner');
  logout();
  assert.equal(isSignedOut(), true);
  assert.equal(currentRole(), 'viewer');
  setActorProvider(null);
  assert.equal(currentRole(), 'owner', 'no provider: unchanged behaviour');
});

test('M1: removeUser / role changes broadcast a user change (other tabs re-check)', async () => {
  const vid = await ownerWithViewer();
  const seen: string[] = [];
  const ch = new BroadcastChannel('mrchartist-inv-users');
  ch.onmessage = (e) => seen.push(String(e.data));
  try {
    assert.ok(removeUser(vid).ok);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.includes('changed'));
    assert.equal(listUsers().length, 1);
  } finally {
    ch.close();
  }
});

/* ── M2 / L6: full backups are owner-only ───────────────────────── */

test('M2: viewer and clerk cannot build or export a full backup; scheduled runs still can', async () => {
  setTable('clients', [{ id: 'c1', name: 'Acme' }]);
  for (const who of [viewer, clerk]) {
    setActorProvider(who);
    assert.throws(() => buildBackup(), AccessDeniedError);
    assert.throws(() => exportPlainBackup(), AccessDeniedError);
    await assert.rejects(() => buildEncryptedBackup('a long passphrase'), AccessDeniedError);
    await assert.rejects(() => backupPayload(new Date(), null), AccessDeniedError);
    assert.throws(() => saveConfig({ enabled: true, frequency: 'daily', retention: 7 }), AccessDeniedError);
    const dl = await downloadBackupNow();
    assert.equal(dl.ok, false);
    const run = await runAutoBackup({ interactive: true });
    assert.equal(run.ok, false);
    assert.equal((run as { reason?: string }).reason, 'denied');
    // Unattended runs the owner configured keep working whoever is signed in.
    assert.ok(buildScheduledBackup().data['mrchartist_inv_clients'].includes('Acme'));
    assert.ok((await backupPayload(new Date(), null, { scheduled: true })).text.includes('Acme'));
  }
  restoreProvider();
  assert.ok(buildBackup().data['mrchartist_inv_clients'].includes('Acme'), 'the owner (no PIN here) can');
});

/* ── L3: a refused restore must not replace the owner's undo copy ── */

test('L3: saveSafetySnapshot checks the role before touching the undo copy', async () => {
  setTable('clients', [{ id: 'c1', name: 'Acme' }]);
  setActorProvider(viewer);
  await assert.rejects(() => saveSafetySnapshot('restore'), AccessDeniedError);
  await assert.rejects(() => saveSafetySnapshot('wipe'), AccessDeniedError);
  setActorProvider(clerk);
  await assert.rejects(() => saveSafetySnapshot('restore'), AccessDeniedError);
});

/* ── L6: library-level gates ────────────────────────────────────── */

test('L6: setIdleTimeout is owner-only', () => {
  setActorProvider(clerk);
  assert.throws(() => setIdleTimeout(0), AccessDeniedError);
  assert.equal(getIdleTimeout(), 30);
  restoreProvider();
  setIdleTimeout(5);
  assert.equal(getIdleTimeout(), 5);
});

/* ── L2: forgot-PIN reset with other users needs the owner's name ── */

test('L2: forgot-PIN reset asks for the owner name when other users exist', async () => {
  await ownerWithViewer();
  logout();
  assert.equal(resetNeedsOwnerName(), true);
  assert.equal(resetAllData('DELETE ALL MY DATA'), false);
  assert.equal(resetAllData('DELETE ALL MY DATA', { ownerName: 'Vik' }), false);
  assert.equal(listUsers().length, 2, 'nothing erased');
  assert.equal(resetAllData('DELETE ALL MY DATA', { ownerName: '  owner ' }), true);
  assert.deepEqual(listUsers(), []);
});

/* ── M3: folder sync cannot redirect payments silently ───────────── */

test('M3: a payment-detail change from another device is held for the owner, not auto-applied', async () => {
  const GROUP = 'evil-group';
  const root = new FakeDir('Usb');
  const key = (await createOrJoinGroup(await openGroup(root, GROUP, true), GROUP, 'shared-sync-pass', { iter: 210_000 })).key;
  const V = { id: 'vvvvvvvv-0000-4000-8000-000000000001', name: 'Victim', data: {} as Record<string, string> };
  const X = { id: 'xxxxxxxx-0000-4000-8000-000000000002', name: 'Attacker', data: {} as Record<string, string> };
  const on = async <T>(d: typeof V, fn: () => T | Promise<T>) => {
    resetStorage();
    loadStorage(d.data);
    try {
      return await fn();
    } finally {
      d.data = dumpStorage();
    }
  };
  const sync = (d: typeof V) => on(d, () => runSync({ root, group: GROUP, key, device: { id: d.id, name: d.name }, retryDelayMs: 0, attempts: 1 }));
  const settings = (upi: string, name = 'Victim Co') => JSON.stringify({ profiles: [{ id: 'p1', companyName: name, upiId: upi }], activeProfileId: 'p1' });

  await on(V, () => {
    setTable('clients', [{ id: 'c1', name: 'Acme' }]);
    writeRaw(SINGLETON_KEYS.settings, settings('victim@bank'));
  });
  await sync(V);
  await sync(X);
  await on(X, () => writeRaw(SINGLETON_KEYS.settings, settings('attacker@bank')));
  await sync(X);
  await sync(V);
  await on(V, () => {
    assert.ok(readRaw(SINGLETON_KEYS.settings)!.includes('victim@bank'), 'payment details unchanged');
    const c = loadConflicts().find((x) => x.kind === 'single');
    assert.equal(c && c.kind === 'single' && c.reason, 'payment', 'listed for the owner to review');
  });
  // A viewer cannot accept it; the owner can.
  await on(V, async () => {
    const c = loadConflicts().find((x) => x.kind === 'single')!;
    setActorProvider(viewer);
    assert.equal((await resolveConflict(c.id, 'theirs', { id: V.id, name: V.name })).ok, false);
    restoreProvider();
    assert.equal((await resolveConflict(c.id, 'theirs', { id: V.id, name: V.name })).ok, true);
    assert.ok(readRaw(SINGLETON_KEYS.settings)!.includes('attacker@bank'));
  });
  // Other settings still sync as before.
  assert.equal(changesPaymentDetails(settings('a@b'), settings('a@b', 'Renamed Co')), false);
  assert.equal(changesPaymentDetails(settings('a@b'), settings('x@y')), true);
  await on(V, () => assert.equal(getTable('clients').length, 1));
});

/* ── L1: parser amplification ───────────────────────────────────── */

test('L1: CSV wider than the column cap fails with a readable error instead of padding', () => {
  const N = 4000;
  const text = Array(N).fill('h').join(',') + '\n' + 'x\n'.repeat(N);
  assert.throws(() => parseTable(text), (e: unknown) => e instanceof TableLimitError && /4,000 columns/.test((e as Error).message));
  // Up to the cap still works, and trailing blank columns never count.
  const ok = parseTable(Array(MAX_TABLE_COLUMNS).fill('h').join(',') + ',,,\n' + 'x\n');
  assert.equal(ok.headers.length, MAX_TABLE_COLUMNS);
  // Total cells are capped while scanning.
  assert.throws(() => parseCsv(','.repeat(MAX_TABLE_CELLS + 1)), TableLimitError);
  assert.match(parseBankStatement(','.repeat(MAX_TABLE_CELLS + 1)).warnings[0], /too large/);
});

test('L1: xlsx with a cell in column XFD on every row is refused, not padded to 16,384 columns', async () => {
  let rows = '';
  for (let i = 1; i <= 3000; i++) rows += `<row r="${i}"><c r="XFD${i}" t="inlineStr"><is><t>a</t></is></c></row>`;
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  const wb = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const zip = await writeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: rels },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ], { compress: true });
  await assert.rejects(() => readXlsx(zip), (e: unknown) => e instanceof TableLimitError && /column XFD/.test((e as Error).message));
  // sheetToTable applies the same caps to rows built elsewhere.
  assert.throws(() => sheetToTable({ name: 'S', rows: [Array(MAX_TABLE_COLUMNS + 1).fill('h')] }), TableLimitError);
});

test('requireAccess sanity: the owner (no PIN) may do everything checked above', () => {
  requireAccess('data.backup');
  requireAccess('security.manage');
  requireAccess('settings.manage');
});
