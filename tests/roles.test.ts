/**
 * Local user roles on a shared device (roadmap 6.21): owner / clerk / viewer.
 * Convenience access control, not security — these tests pin the behaviour the UI relies on.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, loadStorage, resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const session = new MemoryStorage();
Object.assign(globalThis, { sessionStorage: session });

const access = await import('../src/lib/access.ts');
const auth = await import('../src/lib/auth.ts');
const users = await import('../src/lib/users.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const { audit } = await import('../src/lib/audit.ts');
const { verifyAuditChain } = await import('../src/lib/audit-chain.ts');
const backup = await import('../src/lib/backup.ts');
const { grantOverride, SETTINGS_OVERRIDE, clearOverrides } = await import('../src/lib/period-lock.ts');
const { purchasesDb } = await import('../src/lib/purchases.ts');
const { DEVICE_LOCAL_KEYS } = await import('../src/lib/storage.ts');

const T0 = 1_700_000_000_000;
const OWNER_PIN = '482916';

beforeEach(() => {
  auth.logout();
  resetStorage();
  session.clear();
  clearOverrides();
  installSettings();
});

/** Owner account + a clerk and a viewer; leaves the owner signed in. */
async function setupTeam() {
  assert.equal(await auth.login('Rohit Owner', OWNER_PIN), true);
  const clerk = await users.addUser('Asha Clerk', 'clerk', '271828');
  const viewer = await users.addUser('Vikram Viewer', 'viewer', '314159');
  assert.ok(clerk.ok && viewer.ok);
  return { clerkId: clerk.user.id, viewerId: viewer.user.id };
}

async function signInAs(userId: string, pin: string) {
  auth.logout();
  const r = await auth.unlock(pin, T0, userId);
  assert.equal(r.ok, true, `unlock ${userId}`);
}

function invoice(id: string, status: 'Draft' | 'Sent', number = `INV/FY25-26/${id}`) {
  return {
    id, invoice_number: number, status, doc_type: 'INVOICE', issue_date: '2026-05-10', due_date: '2026-05-24',
    currency: 'INR', items: [], subtotal: 100, tax_amount: 0, total: 100, amount_paid: 0, balance_due: 100,
    client: { name: 'Acme' }, created_at: '2026-05-10T00:00:00Z',
  } as unknown as Parameters<typeof localDb.invoices.save>[0];
}

/* ── role matrix ─────────────────────────────────────────────── */

test('role matrix: owner everything, clerk day-to-day work, viewer read-only', () => {
  const all: Array<import('../src/lib/access.ts').AccessAction> = [
    'doc.create', 'doc.edit', 'doc.deleteDraft', 'doc.deleteIssued', 'payment.record', 'master.edit', 'books.edit',
    'settings.manage', 'security.manage', 'data.backup', 'data.restore', 'data.erase', 'period.override', 'view', 'report.export',
  ];
  for (const a of all) assert.equal(access.roleCan('owner', a), true, `owner ${a}`);
  const clerkYes = new Set(['doc.create', 'doc.edit', 'doc.deleteDraft', 'payment.record', 'master.edit', 'books.edit', 'view', 'report.export']);
  for (const a of all) assert.equal(access.roleCan('clerk', a), clerkYes.has(a), `clerk ${a}`);
  const viewerYes = new Set(['view', 'report.export']);
  for (const a of all) assert.equal(access.roleCan('viewer', a), viewerYes.has(a), `viewer ${a}`);
  assert.equal(access.roleCan(null, 'view'), false, 'no role, no access');
});

test('nobody signed in (single-user install, boot, tests) counts as the owner', () => {
  assert.equal(auth.getCurrentUser(), null);
  assert.equal(access.currentRole(), 'owner');
  assert.equal(access.can('data.erase'), true);
});

/* ── migration of the legacy single PIN ──────────────────────── */

test('a legacy plaintext single-PIN record becomes the owner, with no extra step', async () => {
  loadStorage({ mrchartist_inv_auth: JSON.stringify({ name: 'Old Owner', pin: '2468', createdAt: '2025-01-01T00:00:00Z' }) });
  assert.deepEqual(auth.listUsers().map((u) => [u.id, u.role, u.name]), [['owner', 'owner', 'Old Owner']]);
  assert.equal((await auth.unlock('2468', T0)).ok, true, 'the old PIN unlocks as before');
  assert.deepEqual(auth.getCurrentUser(), { id: 'owner', name: 'Old Owner', role: 'owner' });
  const rec = JSON.parse(dumpStorage().mrchartist_inv_auth);
  assert.equal(rec.pin, undefined, 'plaintext dropped');
  assert.ok(rec.hash);
  assert.equal(session.getItem('mrchartist_inv_session'), '1', 'owner session keeps the old marker');
});

test('a session written by an older build ("1") still unlocks the tab as the owner', async () => {
  assert.equal(await auth.login('Asha', OWNER_PIN), true);
  auth.logout();
  session.setItem('mrchartist_inv_session', '1');
  assert.equal(auth.isAuthenticated(), true);
  assert.equal(auth.getCurrentUser()?.role, 'owner');
});

test('additive fields on the owner record survive a PIN change', async () => {
  assert.equal(await auth.login('Asha', OWNER_PIN), true);
  const raw = JSON.parse(dumpStorage().mrchartist_inv_auth);
  loadStorage({ mrchartist_inv_auth: JSON.stringify({ ...raw, future_field: 7 }) });
  assert.deepEqual(await auth.changePin(OWNER_PIN, '135790', T0), { ok: true });
  const after = JSON.parse(dumpStorage().mrchartist_inv_auth);
  assert.equal(after.future_field, 7);
  auth.logout();
  assert.equal((await auth.unlock('135790', T0)).ok, true);
});

/* ── per-user PINs and lockout ───────────────────────────────── */

test('each user signs in with their own PIN; the session records who and the role', async () => {
  const { clerkId, viewerId } = await setupTeam();
  assert.deepEqual(auth.listUsers().map((u) => u.role), ['owner', 'clerk', 'viewer']);
  auth.logout();
  assert.equal((await auth.unlock('314159', T0, clerkId)).ok, false, "the viewer's PIN does not open the clerk");
  assert.equal((await auth.unlock(OWNER_PIN, T0, clerkId)).ok, false, "nor does the owner's");
  await signInAs(clerkId, '271828');
  assert.deepEqual(auth.getCurrentUser(), { id: clerkId, name: 'Asha Clerk', role: 'clerk' });
  assert.equal(session.getItem('mrchartist_inv_session'), `u:${clerkId}`);
  await signInAs(viewerId, '314159');
  assert.equal(access.currentRole(), 'viewer');
  assert.equal(auth.findUserByName('  vikram   VIEWER ')?.id, viewerId);
  const stored = dumpStorage().mrchartist_inv_auth_users;
  assert.ok(!stored.includes('271828') && !stored.includes('314159'), 'PINs are hashed');
});

test('lockout is per user: a clerk locked out does not lock the owner out', async () => {
  const { clerkId } = await setupTeam();
  auth.logout();
  for (let i = 0; i < 4; i++) assert.equal((await auth.unlock('000000', T0, clerkId)).locked, false);
  const fifth = await auth.unlock('000000', T0, clerkId);
  assert.equal(fifth.locked, true);
  assert.equal((await auth.unlock('271828', T0 + 1000, clerkId)).locked, true, 'the right PIN is refused while locked');
  assert.ok(auth.getLockoutRemaining(T0, clerkId) > 0);
  assert.equal(auth.getLockoutRemaining(T0), 0, 'owner not locked');
  assert.equal(auth.getAttemptsLeft(), 5);
  assert.equal((await auth.unlock(OWNER_PIN, T0)).ok, true, 'owner still gets in');
  // The owner resets the clerk's PIN, which also lifts the lockout.
  assert.ok((await users.resetUserPin(clerkId, '161803')).ok);
  assert.equal(auth.getLockoutRemaining(T0, clerkId), 0);
  await signInAs(clerkId, '161803');
});

test('verifyPin and changePin act on the signed-in user', async () => {
  const { clerkId } = await setupTeam();
  await signInAs(clerkId, '271828');
  assert.equal(await auth.verifyPin(OWNER_PIN, T0), false, "the owner's PIN is not the clerk's");
  assert.equal(await auth.verifyPin('271828', T0), true);
  assert.deepEqual(await auth.changePin('271828', '112358', T0), { ok: true });
  await signInAs(clerkId, '112358');
  auth.logout();
  assert.equal((await auth.unlock(OWNER_PIN, T0)).ok, true, "the owner's PIN is untouched");
});

/* ── user management ─────────────────────────────────────────── */

test('only the owner manages users; names are unique; role changes apply at once; removal ends the session', async () => {
  const { clerkId, viewerId } = await setupTeam();
  assert.deepEqual(await users.addUser('asha clerk', 'viewer', '999111'), { ok: false, reason: 'duplicate-name' });
  assert.deepEqual(await users.addUser('Rohit owner', 'viewer', '999111'), { ok: false, reason: 'duplicate-name' });
  assert.deepEqual(await users.addUser('Neha', 'viewer', '12'), { ok: false, reason: 'invalid-pin' });
  assert.deepEqual(await users.addUser('Neha', 'owner' as never, '1234'), { ok: false, reason: 'invalid-role' });
  assert.deepEqual(users.setUserRole('owner', 'viewer'), { ok: false, reason: 'owner' });

  await signInAs(clerkId, '271828');
  await assert.rejects(() => users.addUser('Mallory', 'clerk', '4444'), access.AccessDeniedError);
  assert.throws(() => users.removeUser(viewerId), access.AccessDeniedError);
  assert.throws(() => users.setUserRole(clerkId, 'clerk'), access.AccessDeniedError, 'a clerk cannot even touch their own role');

  await signInAs('owner', OWNER_PIN);
  assert.ok(users.setUserRole(clerkId, 'viewer').ok);
  await signInAs(clerkId, '271828');
  assert.equal(access.currentRole(), 'viewer', 'the new role is read live');

  await signInAs('owner', OWNER_PIN);
  assert.ok(users.removeUser(clerkId).ok);
  // Simulate the removed user's tab (sessionStorage still says it is them).
  auth.logout();
  session.setItem('mrchartist_inv_session', `u:${clerkId}`);
  assert.equal(auth.isAuthenticated(), false, 'a removed user is signed out');
  assert.equal((await auth.unlock('271828', T0, clerkId)).ok, false);
});

test('registering a fresh owner never inherits users left behind', async () => {
  loadStorage({ mrchartist_inv_auth_users: JSON.stringify([{ id: 'x', name: 'Ghost', role: 'clerk', createdAt: '', v: 2, kdf: 'PBKDF2-SHA256', iter: 1, salt: 'a', hash: 'b' }]) });
  assert.equal(await auth.login('New Owner', OWNER_PIN), true);
  assert.deepEqual(auth.listUsers().map((u) => u.name), ['New Owner']);
});

test('a stored "owner" role in the users list is never honoured', () => {
  loadStorage({
    mrchartist_inv_auth: JSON.stringify({ name: 'O', createdAt: '', pin: '1234' }),
    mrchartist_inv_auth_users: JSON.stringify([{ id: 'x', name: 'Sneaky', role: 'owner', createdAt: '', v: 2, kdf: 'PBKDF2-SHA256', iter: 1, salt: 'a', hash: 'b' }]),
  });
  assert.equal(auth.listUsers()[1].role, 'viewer');
});

/* ── data-layer guards ───────────────────────────────────────── */

test('viewer: documents, payments, purchases and clients are refused by the data layer', async () => {
  const { viewerId } = await setupTeam();
  localDb.invoices.save(invoice('1', 'Sent'));
  const clientId = localDb.clients.upsert({ name: 'Acme' } as never);
  await signInAs(viewerId, '314159');
  assert.throws(() => localDb.invoices.save(invoice('2', 'Draft')), access.AccessDeniedError);
  assert.throws(() => localDb.invoices.save({ ...invoice('1', 'Sent'), total: 1 }), access.AccessDeniedError);
  assert.throws(() => localDb.invoices.setStatus('1', 'Cancelled'), access.AccessDeniedError);
  assert.throws(() => localDb.invoices.remove('1'), access.AccessDeniedError);
  assert.throws(() => localDb.payments.record({ invoiceId: '1', amount: 10, method: 'Cash' }), access.AccessDeniedError);
  assert.throws(() => localDb.clients.remove(clientId), access.AccessDeniedError);
  assert.throws(() => purchasesDb.remove('nope'), access.AccessDeniedError);
  assert.equal(localDb.invoices.getAll().length, 1, 'nothing changed');
  assert.equal(localDb.invoices.getAll()[0].total, 100);
});

test('clerk: may create, edit, pay and delete drafts, but not delete an issued document', async () => {
  const { clerkId } = await setupTeam();
  await signInAs(clerkId, '271828');
  localDb.invoices.save(invoice('d1', 'Draft'));
  localDb.invoices.save(invoice('s1', 'Sent'));
  localDb.payments.record({ invoiceId: 's1', amount: 40, method: 'Cash', date: '2026-05-12' });
  assert.throws(() => localDb.invoices.remove('s1'), (e: unknown) => access.isAccessDeniedError(e) && /delete issued/.test((e as Error).message));
  localDb.invoices.remove('d1');
  assert.deepEqual(localDb.invoices.getAll().map((i) => i.id), ['s1']);
  await signInAs('owner', OWNER_PIN);
  localDb.invoices.remove('s1');
  assert.equal(localDb.invoices.getAll().length, 0, 'the owner can');
});

test('erase, restore and period-lock override are owner-only (clerk and viewer refused, data untouched)', async () => {
  const { clerkId, viewerId } = await setupTeam();
  localDb.invoices.save(invoice('k1', 'Sent'));
  const file = backup.buildBackup();
  for (const [id, pin] of [[clerkId, '271828'], [viewerId, '314159']] as const) {
    await signInAs(id, pin);
    assert.throws(() => backup.wipeAppData(), access.AccessDeniedError);
    assert.throws(() => backup.restoreBackup(file.data), access.AccessDeniedError);
    assert.throws(() => backup.applyBackup(file.data), access.AccessDeniedError);
    await assert.rejects(() => grantOverride(pin, { scope: SETTINGS_OVERRIDE, verify: async () => true }), access.AccessDeniedError);
    assert.equal(localDb.invoices.getAll().length, 1);
  }
  await signInAs('owner', OWNER_PIN);
  assert.equal(await grantOverride(OWNER_PIN, { scope: SETTINGS_OVERRIDE, verify: async () => true }), true);
  backup.restoreBackup(file.data);
  backup.wipeAppData();
  assert.equal(localDb.invoices.getAll().length, 0);
});

/* ── audit ───────────────────────────────────────────────────── */

test('audit rows carry the acting user and the hash chain still verifies', async () => {
  // A row written before roles existed (no `by`) stays valid next to the new ones.
  audit.record({ entity: 'system', entity_id: 'x', action: 'import', summary: 'before anyone signed in' });
  const { clerkId } = await setupTeam();
  localDb.invoices.save(invoice('a1', 'Sent'));
  await signInAs(clerkId, '271828');
  localDb.payments.record({ invoiceId: 'a1', amount: 10, method: 'Cash', date: '2026-05-12' });
  const rows = audit.rows();
  assert.equal(rows[0].by, undefined);
  assert.ok(rows.some((r) => r.summary.startsWith('User added: Asha Clerk') && r.by === 'Rohit Owner'), 'user management is logged with the owner');
  assert.ok(!JSON.stringify(rows).includes('271828'), 'PINs never reach the log');
  assert.equal(rows.find((r) => r.action === 'create' && r.entity === 'invoice')?.by, 'Rohit Owner');
  assert.equal(rows.find((r) => r.action === 'payment_add')?.by, 'Asha Clerk');
  assert.equal(verifyAuditChain(rows).ok, true);
  // Changing who did it breaks the chain: `by` is covered by the hash.
  const forged = rows.map((r) => (r.action === 'payment_add' ? { ...r, by: 'Rohit Owner' } : r));
  assert.equal(verifyAuditChain(forged).ok, false);
});

/* ── backups ─────────────────────────────────────────────────── */

test('users and their lockouts are device-local: never in a backup, kept by erase and restore', async () => {
  const { clerkId } = await setupTeam();
  auth.logout();
  await auth.unlock('000000', T0, clerkId); // leaves a per-user guard entry
  assert.ok(DEVICE_LOCAL_KEYS.includes('mrchartist_inv_auth_users'));
  assert.ok(DEVICE_LOCAL_KEYS.includes('mrchartist_inv_auth_guard_users'));
  const store = dumpStorage();
  assert.ok(store.mrchartist_inv_auth_users && store.mrchartist_inv_auth_guard_users);
  await signInAs('owner', OWNER_PIN);
  const file = backup.buildBackup();
  for (const k of ['mrchartist_inv_auth', 'mrchartist_inv_auth_users', 'mrchartist_inv_auth_guard_users', 'mrchartist_inv_session']) {
    assert.equal(k in file.data, false, `${k} not in the backup`);
  }
  // A crafted backup carrying a users list cannot plant a user on restore.
  const parsed = backup.parseBackup(JSON.stringify({ ...file, data: { ...file.data, mrchartist_inv_auth_users: '[]' } }));
  assert.equal('mrchartist_inv_auth_users' in parsed.data, false);
  backup.restoreBackup(file.data);
  backup.wipeAppData();
  assert.equal(auth.listUsers().length, 3, 'erase keeps the device users');
});

test('forgot-PIN reset (owner path) wipes the users too', async () => {
  await setupTeam();
  auth.logout();
  assert.equal(auth.resetAllData('DELETE ALL MY DATA'), true);
  assert.deepEqual(auth.listUsers(), []);
  assert.equal(dumpStorage().mrchartist_inv_auth_users, undefined);
});
