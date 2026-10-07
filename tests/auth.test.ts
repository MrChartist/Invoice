import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? (this.m.get(k) as string) : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session });

const auth = await import('../src/lib/auth.ts');

beforeEach(() => {
  local.clear();
  session.clear();
  auth.logout();
});

const T0 = 1_700_000_000_000;

test('register, lock, unlock; PIN is never stored in plaintext', async () => {
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(await auth.login('Asha', '4821'), true);
  assert.equal(auth.isAuthenticated(), true);
  assert.equal(auth.getUser()?.name, 'Asha');
  const raw = local.getItem('mrchartist_inv_auth') as string;
  assert.ok(!raw.includes('4821'));
  assert.ok(JSON.parse(raw).hash);

  auth.logout();
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(auth.getUser()?.name, 'Asha', 'logout keeps the credential');
  assert.equal((await auth.unlock('0000', T0)).ok, false);
  assert.equal((await auth.unlock('4821', T0)).ok, true);
  assert.equal(auth.isAuthenticated(), true);
});

test('login rejects bad input and cannot overwrite an existing PIN', async () => {
  assert.equal(await auth.login('', '4821'), false);
  assert.equal(await auth.login('A', '12'), false);
  assert.equal(await auth.login('A', 'abcd'), false);
  assert.equal(await auth.login('Asha', '4821'), true);
  auth.logout();
  assert.equal(await auth.login('Mallory', '9999'), false);
  assert.equal(auth.getUser()?.name, 'Asha');
  assert.equal(auth.isAuthenticated(), false);
});

test('legacy plaintext record is accepted once and migrated to a hash', async () => {
  local.setItem('mrchartist_inv_auth', JSON.stringify({ name: 'Old', pin: '2468', createdAt: '2025-01-01T00:00:00Z' }));
  assert.equal(auth.getUser()?.name, 'Old');
  assert.equal(auth.isAuthenticated(), false);
  assert.equal(await auth.verifyPin('1111', T0), false);
  assert.equal((await auth.unlock('2468', T0)).ok, true);
  const rec = JSON.parse(local.getItem('mrchartist_inv_auth') as string);
  assert.equal(rec.pin, undefined);
  assert.ok(rec.hash && rec.salt && rec.iter >= 210_000);
  assert.equal(rec.createdAt, '2025-01-01T00:00:00Z');
  auth.logout();
  assert.equal((await auth.unlock('2468', T0)).ok, true);
});

test('lockout: 5 failures lock for 30s, doubling each time, persisted, reset on success', async () => {
  await auth.login('Asha', '4821');
  auth.logout();
  let t = T0;
  for (let i = 0; i < 4; i++) {
    const r = await auth.unlock('0000', t);
    assert.equal(r.locked, false);
    assert.equal(r.attemptsLeft, 4 - i);
  }
  const fifth = await auth.unlock('0000', t);
  assert.equal(fifth.locked, true);
  assert.equal(fifth.retryInMs, 30_000);
  assert.equal(auth.getLockoutRemaining(t + 10_000), 20_000);

  // Correct PIN is refused during lockout and does not unlock.
  const during = await auth.unlock('4821', t + 10_000);
  assert.equal(during.ok, false);
  assert.equal(during.locked, true);
  assert.equal(auth.isAuthenticated(), false);

  // Survives a "reload": state lives in storage, not memory.
  assert.ok(local.getItem('mrchartist_inv_auth_guard'));

  t += 30_001;
  assert.equal(auth.getLockoutRemaining(t), 0);
  for (let i = 0; i < 4; i++) await auth.unlock('0000', t);
  const second = await auth.unlock('0000', t);
  assert.equal(second.retryInMs, 60_000);

  t += 60_001;
  for (let i = 0; i < 4; i++) await auth.unlock('0000', t);
  assert.equal((await auth.unlock('0000', t)).retryInMs, 120_000);

  t += 120_001;
  assert.equal((await auth.unlock('4821', t)).ok, true);
  assert.equal(local.getItem('mrchartist_inv_auth_guard'), null);
});

test('lockoutDuration is capped', () => {
  assert.equal(auth.lockoutDuration(0), 30_000);
  assert.equal(auth.lockoutDuration(3), 240_000);
  assert.equal(auth.lockoutDuration(40), auth.MAX_LOCKOUT_MS);
});

test('changePin verifies the old PIN, validates the new one, and replaces the hash', async () => {
  await auth.login('Asha', '4821');
  assert.deepEqual(await auth.changePin('0000', '7352', T0), { ok: false, reason: 'wrong-pin' });
  assert.deepEqual(await auth.changePin('4821', '12', T0), { ok: false, reason: 'invalid-format' });
  assert.deepEqual(await auth.changePin('4821', '4821', T0), { ok: false, reason: 'same-pin' });
  assert.deepEqual(await auth.changePin('4821', '7352', T0), { ok: true });
  auth.logout();
  assert.equal((await auth.unlock('4821', T0)).ok, false);
  assert.equal((await auth.unlock('7352', T0)).ok, true);
});

test('changePin counts toward lockout', async () => {
  await auth.login('Asha', '4821');
  for (let i = 0; i < 5; i++) await auth.changePin('0000', '7352', T0);
  assert.deepEqual(await auth.changePin('4821', '7352', T0 + 1000), { ok: false, reason: 'locked', retryInMs: 29_000 });
});

test('idle timeout persists, clamps, and expiry maths', () => {
  assert.equal(auth.getIdleTimeout(), auth.DEFAULT_IDLE_MINUTES);
  auth.setIdleTimeout(15);
  assert.equal(auth.getIdleTimeout(), 15);
  auth.setIdleTimeout(-5);
  assert.equal(auth.getIdleTimeout(), 0);
  auth.setIdleTimeout(NaN);
  assert.equal(auth.getIdleTimeout(), auth.DEFAULT_IDLE_MINUTES);
  assert.equal(auth.isIdleExpired(T0, T0 + 14 * 60_000, 15), false);
  assert.equal(auth.isIdleExpired(T0, T0 + 15 * 60_000, 15), true);
  assert.equal(auth.isIdleExpired(T0, T0 + 99 * 60_000, 0), false);
});

test('forgot PIN: wipes every app key only with the exact phrase', async () => {
  await auth.login('Asha', '4821');
  local.setItem('mrchartist_inv_invoices', '[{"id":1}]');
  local.setItem('theme', 'dark');
  local.setItem('other_site', 'keep');
  assert.equal(auth.resetAllData('delete all'), false);
  assert.ok(local.getItem('mrchartist_inv_invoices'));
  assert.equal(auth.resetAllData('  delete all my   data '), true);
  assert.equal(local.getItem('mrchartist_inv_invoices'), null);
  assert.equal(local.getItem('mrchartist_inv_auth'), null);
  assert.equal(local.getItem('other_site'), 'keep');
  assert.equal(auth.getUser(), null);
  assert.equal(auth.isAuthenticated(), false);
});

test('pinStrength flags trivial PINs but accepts good ones', () => {
  for (const weak of ['0000', '1111', '1234', '4321', '9876', '1212', '123456', '2580']) {
    assert.equal(auth.pinStrength(weak).level, 'weak', weak);
    assert.ok(auth.pinStrength(weak).warning, weak);
  }
  assert.equal(auth.pinStrength('4821').level, 'ok');
  assert.equal(auth.pinStrength('703519').level, 'strong');
  assert.equal(auth.pinStrength('12').level, 'weak');
});
