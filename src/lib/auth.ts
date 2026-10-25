/**
 * Local-only PIN gate for the Invoice Creator. No backend — everything stays on
 * this device.
 *
 * Storage layout (the `mrchartist_inv_auth` key is unchanged for existing users):
 *   mrchartist_inv_auth        credential record  {name, createdAt, v:2, kdf, iter, salt, hash}
 *                              (legacy: {name, pin, createdAt} — upgraded on first successful unlock)
 *   mrchartist_inv_auth_guard  failed-attempt counter + lockout deadline (the owner's)
 *   mrchartist_inv_auth_users  extra local users (6.21): [{id, name, role, createdAt, v:2, kdf, iter, salt, hash}]
 *   mrchartist_inv_auth_guard_users  per-user lockout counters for those users {id: GuardState}
 *   mrchartist_inv_idle_min    auto-lock timeout in minutes (0 = never)
 *   sessionStorage             who unlocked this tab: '1' = the owner (also what older builds wrote),
 *                              'u:<id>' = another local user — cleared on tab close and by logout()
 *
 * Roles (6.21): the account in `mrchartist_inv_auth` is the OWNER. The owner may add clerks and
 * viewers with their own PINs (users.ts, loaded with Settings). This is convenience access control
 * on a shared device, not security — see access.ts.
 *
 * logout() only LOCKS the app (clears the session). It never deletes the credential, which
 * previously let anyone with access to the browser re-register a new PIN simply by logging out.
 */

import { DB_PREFIX, DEVICE_LOCAL_KEYS, SINGLETON_KEYS, collectAppData, readRaw, removeRaw, writeRaw } from './storage';
import { constantTimeEqualStrings, hashPin, PBKDF2_ITERATIONS, verifyPinHash, type PinHash } from './crypto';
import { requireAccess, setActorProvider, type Actor, type Role } from './access';
import type { UserRights } from './rights';

export const AUTH_KEY = SINGLETON_KEYS.auth;
export const GUARD_KEY = `${DB_PREFIX}auth_guard`;
export const IDLE_KEY = `${DB_PREFIX}idle_min`;
export const SESSION_KEY = `${DB_PREFIX}session`;
export const USERS_KEY = `${DB_PREFIX}auth_users`;
export const USER_GUARDS_KEY = `${DB_PREFIX}auth_guard_users`;
export const IDLE_CHANGED_EVENT = 'mrchartist:idle-changed';
/** Id of the owner (the account in `mrchartist_inv_auth`). */
export const OWNER_ID = 'owner';

/** Keys that describe THIS device's state and must never travel in a backup (defined in storage.ts). */
export { DEVICE_LOCAL_KEYS };

export const RESET_PHRASE = 'DELETE ALL MY DATA';
export const MAX_FREE_ATTEMPTS = 5;
export const BASE_LOCKOUT_MS = 30_000;
export const MAX_LOCKOUT_MS = 60 * 60_000;
export const DEFAULT_IDLE_MINUTES = 30;
export const IDLE_CHOICES = [0, 1, 5, 15, 30, 60, 120] as const;

export interface AuthUser {
  name: string;
  createdAt: string;
  /** Legacy plaintext PIN. Only present on records that predate hashing; never populated by this module. */
  pin?: string;
}

interface StoredRecord extends Partial<PinHash> {
  name: string;
  createdAt: string;
  v?: number;
  pin?: string;
}

/* ── low-level record access ──────────────────────────────────── */

function readRecord(): StoredRecord | null {
  try {
    const raw = readRaw(AUTH_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as StoredRecord;
    if (!rec || typeof rec.name !== 'string' || !rec.name) return null;
    if (!rec.hash && !rec.pin) return null;
    return rec;
  } catch {
    return null;
  }
}

/** Writes the owner record with a fresh hash, keeping any additive fields already on it. */
function writeOwnerHash(base: StoredRecord, hashed: PinHash): void {
  const next: StoredRecord = { ...base, v: 2, ...hashed };
  delete next.pin;
  writeRaw(AUTH_KEY, JSON.stringify(next));
}

/* ── extra local users (6.21) ─────────────────────────────────── */

/** A clerk / viewer. The owner lives in `mrchartist_inv_auth` and is never in this list. */
export interface StoredUser extends PinHash {
  id: string;
  name: string;
  role: Exclude<Role, 'owner'>;
  createdAt: string;
  v: 2;
  /** Additive (7T): actions the owner granted on top of the role (only `GRANTABLE_ACTIONS` count). */
  grants?: string[];
  /** Additive (8H): finer rights that narrow the role (`rights.ts`). */
  rights?: UserRights;
}

/** What the login screen and Settings may see about a user (never secrets). */
export interface UserSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
  /** Additive (7T): owner's per-user grants (e.g. `payroll.view`). */
  grants?: string[];
  /** Additive (8H): finer rights (`rights.ts`). */
  rights?: UserRights;
}

const cleanGrants = (g: unknown): string[] | undefined => {
  const list = Array.isArray(g) ? [...new Set(g.filter((x): x is string => typeof x === 'string' && !!x))] : [];
  return list.length ? list : undefined;
};

/** @internal Valid extra users, as stored. Used by users.ts. */
export function readUsers(): StoredUser[] {
  try {
    const raw = readRaw(USERS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: StoredUser[] = [];
    const seen = new Set<string>([OWNER_ID]);
    for (const u of list as Array<Partial<StoredUser> | null>) {
      if (!u || typeof u.id !== 'string' || !u.id || seen.has(u.id)) continue;
      if (typeof u.name !== 'string' || !u.name.trim()) continue;
      if (!u.hash || !u.salt || !u.iter || !u.kdf) continue;
      seen.add(u.id);
      // Anything but 'clerk' reads as the least privileged role (an "owner" here is never honoured).
      const grants = cleanGrants(u.grants);
      const row: StoredUser = { ...(u as StoredUser), role: u.role === 'clerk' ? 'clerk' : 'viewer' };
      if (grants) row.grants = grants;
      else delete row.grants;
      // Finer rights (8H) are validated when saved (user-rights.ts); here only their shape is checked.
      if (!u.rights || typeof u.rights !== 'object' || Array.isArray(u.rights)) delete row.rights;
      out.push(row);
    }
    return out;
  } catch {
    return [];
  }
}

/** @internal */
export function writeUsers(list: StoredUser[]): void {
  if (list.length === 0) removeRaw(USERS_KEY);
  else writeRaw(USERS_KEY, JSON.stringify(list));
}

/** Owner first, then the other users in the order they were added. Empty before the first account exists. */
export function listUsers(): UserSummary[] {
  const owner = readRecord();
  if (!owner) return [];
  return [
    { id: OWNER_ID, name: owner.name, role: 'owner', createdAt: owner.createdAt },
    ...readUsers().map((u) => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt, ...(u.grants ? { grants: u.grants } : {}), ...(u.rights ? { rights: u.rights } : {}) })),
  ];
}

/** Lower-case, single-spaced, trimmed — how user names are compared. */
export const nameKey = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Case- and spacing-insensitive lookup, for a login screen where the name is typed. */
export function findUserByName(name: string): UserSummary | null {
  const key = nameKey(name);
  if (!key) return null;
  return listUsers().find((u) => nameKey(u.name) === key) ?? null;
}

function findUser(id: string): UserSummary | null {
  return listUsers().find((u) => u.id === id) ?? null;
}

/* ── session (who unlocked this tab) ──────────────────────────── */

/** The unlocked user's id for this page load (backs up sessionStorage when it is unavailable). */
let memorySession: string | null = null;

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function startSession(userId: string = OWNER_ID): void {
  memorySession = userId;
  try {
    // '1' for the owner keeps sessions written by older builds (and by this one) interchangeable.
    sessionStore()?.setItem(SESSION_KEY, userId === OWNER_ID ? '1' : `u:${userId}`);
  } catch {
    /* in-memory flag still holds for this page load */
  }
}

function endSession(): void {
  memorySession = null;
  try {
    sessionStore()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function sessionUserId(): string | null {
  if (memorySession) return memorySession;
  try {
    const raw = sessionStore()?.getItem(SESSION_KEY);
    if (raw === '1') return OWNER_ID;
    if (raw && raw.startsWith('u:') && raw.length > 2) return raw.slice(2);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * The user signed in to this tab, or null. The session holds only the user id; the name and role
 * are read from the user list each time, so a role change or removal applies at once.
 */
export function getCurrentUser(): Actor | null {
  const id = sessionUserId();
  if (!id) return null;
  const u = findUser(id);
  return u ? { id: u.id, name: u.name, role: u.role, ...(u.grants ? { grants: u.grants } : {}), ...(u.rights ? { rights: u.rights } : {}) } : null;
}

// The data layer asks access.ts who is acting; this is the answer. Once a PIN is set up, a tab whose
// user cannot be resolved (locked, or removed in another tab) is signed out: never the owner (M1).
setActorProvider(getCurrentUser, { signInRequired: () => readRecord() !== null });

/** True when a credential exists AND this tab has been unlocked by a user that still exists. */
export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

/** The account holder / owner (name only — secrets are never returned). Available while locked, for the login screen. */
export function getUser(): AuthUser | null {
  const rec = readRecord();
  return rec ? { name: rec.name, createdAt: rec.createdAt } : null;
}

/* ── PIN rules ────────────────────────────────────────────────── */

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export type PinStrength = 'weak' | 'ok' | 'strong';

const COMMON_PINS = new Set([
  '0000', '1111', '2222', '1234', '4321', '1212', '2580', '0852', '1004', '2000', '2001', '6969', '1122', '1313', '4444', '7777',
  '123456', '654321', '000000', '111111', '121212', '112233', '123123', '123321', '159753', '696969', '102030',
]);

/** Gentle strength check — the UI warns about 'weak' PINs but does not block them. */
export function pinStrength(pin: string): { level: PinStrength; warning?: string } {
  if (pin.length < 4) return { level: 'weak' };
  if (/^(\d)\1+$/.test(pin)) return { level: 'weak', warning: 'All the same digit is easy to guess.' };
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) {
    return { level: 'weak', warning: 'A straight run of digits is easy to guess.' };
  }
  if (COMMON_PINS.has(pin)) return { level: 'weak', warning: 'This is one of the most common PINs.' };
  const half = pin.length / 2;
  if (Number.isInteger(half) && pin.slice(0, half) === pin.slice(half)) {
    return { level: 'weak', warning: 'A repeating pattern is easy to guess.' };
  }
  if (new Set(digits).size <= 2) return { level: 'ok', warning: 'Using more distinct digits makes it harder to guess.' };
  return { level: pin.length >= 6 ? 'strong' : 'ok' };
}

/* ── lockout (persisted, exponential, per user) ───────────────── */

export interface GuardState {
  /** Consecutive failures since the last success or lockout. */
  fails: number;
  /** How many lockouts have happened since the last success (drives the doubling). */
  level: number;
  /** Epoch ms until which attempts are refused. */
  lockedUntil: number;
}

const FRESH_GUARD: GuardState = { fails: 0, level: 0, lockedUntil: 0 };

export function lockoutDuration(level: number): number {
  return Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** Math.max(0, level));
}

/** Pure transition: apply one failed attempt at time `now`. */
export function registerFailure(state: GuardState, now: number): GuardState {
  const fails = state.fails + 1;
  if (fails >= MAX_FREE_ATTEMPTS) {
    return { fails: 0, level: state.level + 1, lockedUntil: now + lockoutDuration(state.level) };
  }
  return { ...state, fails };
}

function parseGuard(g: Partial<GuardState> | null | undefined): GuardState {
  if (!g || typeof g !== 'object') return { ...FRESH_GUARD };
  return {
    fails: Number.isFinite(g.fails) ? Math.max(0, g.fails as number) : 0,
    level: Number.isFinite(g.level) ? Math.max(0, g.level as number) : 0,
    lockedUntil: Number.isFinite(g.lockedUntil) ? (g.lockedUntil as number) : 0,
  };
}

const isFresh = (g: GuardState) => g.fails === 0 && g.level === 0 && g.lockedUntil === 0;

function readUserGuards(): Record<string, GuardState> {
  try {
    const raw = readRaw(USER_GUARDS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, Partial<GuardState>> | null) : {};
    if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
    return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, parseGuard(v)]));
  } catch {
    return {};
  }
}

/**
 * Lockout is counted PER USER: the owner keeps the original `auth_guard` key, other users share
 * one map. So a clerk mistyping cannot lock the owner out (nor the reverse).
 */
function readGuard(userId: string = OWNER_ID): GuardState {
  if (userId !== OWNER_ID) return readUserGuards()[userId] ?? { ...FRESH_GUARD };
  try {
    const raw = readRaw(GUARD_KEY);
    return raw ? parseGuard(JSON.parse(raw) as Partial<GuardState>) : { ...FRESH_GUARD };
  } catch {
    return { ...FRESH_GUARD };
  }
}

function writeGuard(state: GuardState, userId: string = OWNER_ID): void {
  try {
    if (userId !== OWNER_ID) {
      const map = readUserGuards();
      if (isFresh(state)) delete map[userId];
      else map[userId] = state;
      if (Object.keys(map).length) writeRaw(USER_GUARDS_KEY, JSON.stringify(map));
      else removeRaw(USER_GUARDS_KEY);
      return;
    }
    if (isFresh(state)) removeRaw(GUARD_KEY);
    else writeRaw(GUARD_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the in-page attempt still fails */
  }
}

/** @internal Clears a user's lockout (used when the owner resets that user's PIN or removes them). */
export function clearGuard(userId: string): void {
  writeGuard({ ...FRESH_GUARD }, userId);
}

/** Milliseconds left on `userId`'s current lockout (the owner's by default; 0 when attempts are allowed). */
export function getLockoutRemaining(now: number = Date.now(), userId: string = OWNER_ID): number {
  const { lockedUntil } = readGuard(userId);
  return Math.max(0, lockedUntil - now);
}

export function getAttemptsLeft(userId: string = OWNER_ID): number {
  return Math.max(0, MAX_FREE_ATTEMPTS - readGuard(userId).fails);
}

/* ── verification ─────────────────────────────────────────────── */

export interface UnlockResult {
  ok: boolean;
  /** Refused because of an active lockout (the PIN was not even checked). */
  locked: boolean;
  /** Milliseconds until another attempt is allowed. */
  retryInMs: number;
  /** Free attempts remaining before the next lockout. */
  attemptsLeft: number;
}

type Credential = { kind: 'owner'; rec: StoredRecord } | { kind: 'user'; user: StoredUser };

function credentialFor(userId: string): Credential | null {
  const rec = readRecord();
  if (!rec) return null;
  if (userId === OWNER_ID) return { kind: 'owner', rec };
  const user = readUsers().find((u) => u.id === userId);
  return user ? { kind: 'user', user } : null;
}

async function checkPin(cred: Credential, pin: string): Promise<boolean> {
  const rec: Partial<PinHash> & { pin?: string } = cred.kind === 'owner' ? cred.rec : cred.user;
  if (rec.hash && rec.salt && rec.iter && rec.kdf) {
    return verifyPinHash(pin, { kdf: rec.kdf, iter: rec.iter, salt: rec.salt, hash: rec.hash });
  }
  // Legacy plaintext owner record.
  return typeof rec.pin === 'string' && constantTimeEqualStrings(rec.pin, pin);
}

/** Writes a new hash for the credential (owner record or one user). */
function storeHash(cred: Credential, hashed: PinHash): void {
  if (cred.kind === 'owner') {
    writeOwnerHash(readRecord() ?? cred.rec, hashed);
    return;
  }
  writeUsers(readUsers().map((u) => (u.id === cred.user.id ? { ...u, v: 2, ...hashed } : u)));
}

/**
 * Verifies `userId`'s PIN (the owner by default) with that user's lockout accounting. A correct
 * PIN resets the counter and transparently upgrades a legacy plaintext record to a hashed one.
 * Does NOT start a session — see {@link unlock}.
 */
export async function checkPinWithGuard(pin: string, now: number = Date.now(), userId: string = OWNER_ID): Promise<UnlockResult> {
  const cred = credentialFor(userId);
  const guard = readGuard(userId);
  if (guard.lockedUntil > now) {
    return { ok: false, locked: true, retryInMs: guard.lockedUntil - now, attemptsLeft: 0 };
  }
  if (!cred) return { ok: false, locked: false, retryInMs: 0, attemptsLeft: MAX_FREE_ATTEMPTS };

  // Count the attempt as a failure BEFORE the slow hash: attempts racing in parallel (other tabs)
  // each see the previous failure, so they cannot slip past the lockout. Success undoes it.
  const next = registerFailure(guard, now);
  writeGuard(next, userId);

  if (await checkPin(cred, pin)) {
    writeGuard({ ...FRESH_GUARD }, userId);
    // Legacy plaintext, or a hash made with fewer iterations than today's default: re-hash now
    // that the PIN is known.
    const rec = cred.kind === 'owner' ? cred.rec : cred.user;
    if (!rec.hash || (rec.iter ?? 0) < PBKDF2_ITERATIONS) {
      try {
        storeHash(cred, await hashPin(pin));
      } catch {
        /* keep the legacy record; it will be upgraded next time */
      }
    }
    return { ok: true, locked: false, retryInMs: 0, attemptsLeft: MAX_FREE_ATTEMPTS };
  }

  const retryInMs = Math.max(0, next.lockedUntil - now);
  return { ok: false, locked: retryInMs > 0, retryInMs, attemptsLeft: retryInMs > 0 ? 0 : MAX_FREE_ATTEMPTS - next.fails };
}

/** Verify `userId`'s PIN (the owner by default) and, if correct, start that user's session. This is what the login form calls. */
export async function unlock(pin: string, now: number = Date.now(), userId: string = OWNER_ID): Promise<UnlockResult> {
  const result = await checkPinWithGuard(pin, now, userId);
  if (result.ok) startSession(userId);
  return result;
}

/**
 * Verify the PIN of whoever is signed in to this tab (the owner when nobody is). Counts toward
 * that user's lockout; does not start a session.
 */
export async function verifyPin(pin: string, now: number = Date.now()): Promise<boolean> {
  return (await checkPinWithGuard(pin, now, getCurrentUser()?.id ?? OWNER_ID)).ok;
}

/**
 * Register the first user (the owner) and start a session. If an account already exists this
 * behaves like {@link unlock} for the owner (the name is ignored) — it can never overwrite an
 * existing PIN. Returns false on invalid input or a wrong PIN.
 */
export async function login(name: string, pin: string): Promise<boolean> {
  if (readRecord()) return (await unlock(pin)).ok;
  if (!name.trim() || !isValidPinFormat(pin)) return false;
  const hashed = await hashPin(pin);
  writeRaw(AUTH_KEY, JSON.stringify({ name: name.trim(), createdAt: new Date().toISOString(), v: 2, ...hashed }));
  writeGuard({ ...FRESH_GUARD });
  // A fresh owner never inherits users (or their lockouts) left behind by an earlier account.
  removeRaw(USERS_KEY);
  removeRaw(USER_GUARDS_KEY);
  startSession(OWNER_ID);
  return true;
}

/** Lock the app. Data and the PINs are kept. */
const LOCK_CHANNEL = 'mrchartist-inv-lock';

/** Lock this tab and tell every other open tab of the app to lock too. */
export function logout(): void {
  endSession();
  try {
    const ch = new BroadcastChannel(LOCK_CHANNEL);
    ch.postMessage('lock');
    ch.close();
  } catch {
    /* no BroadcastChannel (old browser / tests): only this tab locks */
  }
}

/** Call `onLock` when another tab locks the app (manual lock or idle lock). Returns an unsubscribe. */
export function onRemoteLock(onLock: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(LOCK_CHANNEL);
  ch.onmessage = (e) => {
    if (e.data === 'lock') {
      endSession();
      onLock();
    }
  };
  return () => ch.close();
}

/* ── who-is-signed-in changes (other tabs) ─────────────────────── */

const USERS_CHANNEL = 'mrchartist-inv-users';
/** Same-tab event fired by {@link announceUserChange}. */
export const USERS_CHANGED_EVENT = 'mrchartist:users-changed';
/** localStorage keys whose change (in another tab) can end or change this tab's session. */
const AUTH_KEYS = new Set<string>([AUTH_KEY, USERS_KEY, SESSION_KEY]);

/**
 * Tell every open tab that the user list changed (user added / removed, role changed, PIN reset), so
 * each one re-checks who is signed in: a removed user's tab locks, a changed role applies at once.
 */
export function announceUserChange(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(USERS_CHANGED_EVENT));
  } catch {
    /* non-browser */
  }
  try {
    const ch = new BroadcastChannel(USERS_CHANNEL);
    ch.postMessage('changed');
    ch.close();
  } catch {
    /* no BroadcastChannel: the storage event and the focus check still cover other tabs */
  }
}

/**
 * Call `check` whenever this tab's session may have changed underneath it: a `storage` event on the
 * credential / user list / session keys, a user-change broadcast, and the window regaining focus.
 * The caller re-reads `isAuthenticated()` / `getCurrentUser()`. Returns an unsubscribe.
 */
export function onAuthChange(check: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || AUTH_KEYS.has(e.key)) check();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('focus', check);
  window.addEventListener(USERS_CHANGED_EVENT, check);
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel(USERS_CHANNEL);
    ch.onmessage = () => check();
  } catch {
    ch = null;
  }
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', check);
    window.removeEventListener(USERS_CHANGED_EVENT, check);
    ch?.close();
  };
}

export type ChangePinResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'wrong-pin' | 'invalid-format' | 'same-pin' | 'no-account'; retryInMs?: number };

/** Change the signed-in user's own PIN (the owner's when nobody is) after verifying the old one (counts toward lockout). */
export async function changePin(oldPin: string, newPin: string, now: number = Date.now()): Promise<ChangePinResult> {
  const userId = getCurrentUser()?.id ?? OWNER_ID;
  const cred = credentialFor(userId);
  if (!cred) return { ok: false, reason: 'no-account' };
  if (!isValidPinFormat(newPin)) return { ok: false, reason: 'invalid-format' };
  if (oldPin === newPin) return { ok: false, reason: 'same-pin' };
  const check = await checkPinWithGuard(oldPin, now, userId);
  if (check.locked) return { ok: false, reason: 'locked', retryInMs: check.retryInMs };
  if (!check.ok) return { ok: false, reason: 'wrong-pin' };
  storeHash(cred, await hashPin(newPin));
  return { ok: true };
}

/* ── idle auto-lock ───────────────────────────────────────────── */

export function getIdleTimeout(): number {
  const raw = readRaw(IDLE_KEY);
  if (raw === null) return DEFAULT_IDLE_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 24 * 60 ? Math.floor(n) : DEFAULT_IDLE_MINUTES;
}

/** Minutes of inactivity before locking; 0 disables. */
export function setIdleTimeout(minutes: number): void {
  requireAccess('security.manage'); // roles (6.21): the owner decides how soon a shared device locks
  const n = Number.isFinite(minutes) ? Math.min(24 * 60, Math.max(0, Math.floor(minutes))) : DEFAULT_IDLE_MINUTES;
  writeRaw(IDLE_KEY, String(n));
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(IDLE_CHANGED_EVENT));
  } catch {
    /* non-browser */
  }
}

/** Pure check used by IdleLock (and tests). */
export function isIdleExpired(lastActivity: number, now: number, minutes: number): boolean {
  return minutes > 0 && now - lastActivity >= minutes * 60_000;
}

/* ── forgot PIN: wipe everything ──────────────────────────────── */

export function isResetPhrase(input: string): boolean {
  return input.trim().replace(/\s+/g, ' ').toUpperCase() === RESET_PHRASE;
}

/**
 * Forgot-PIN with other users on the device (6.21): anyone at the PIN screen can reach the reset, so
 * besides the phrase it asks for the owner's name, typed — the person resetting must at least know
 * whose books they are erasing (and that every clerk / viewer goes too). Not a secret: a deliberate
 * extra step against a mistaken or casual wipe.
 */
export function resetNeedsOwnerName(): boolean {
  return readUsers().length > 0;
}

/**
 * Recovery path for a forgotten PIN. The data is local-only, so there is no
 * server reset: the only way back in is to erase every `mrchartist_inv_*` key
 * (invoices, clients, profiles, PIN, lockout, every other local user) and start fresh.
 * Requires the exact confirmation phrase, plus the owner's name when other users
 * exist ({@link resetNeedsOwnerName}). Returns false (and erases nothing) otherwise.
 */
export function resetAllData(confirmation: string, opts: { ownerName?: string } = {}): boolean {
  if (!isResetPhrase(confirmation)) return false;
  if (resetNeedsOwnerName()) {
    const owner = readRecord()?.name ?? '';
    if (!owner || nameKey(opts.ownerName ?? '') !== nameKey(owner)) return false;
  }
  endSession();
  try {
    // Data tables (the IndexedDB-backed cache, or localStorage); the caller flushes before reloading.
    for (const k of Object.keys(collectAppData())) removeRaw(k);
    if (typeof localStorage !== 'undefined') {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(DB_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    }
  } catch {
    return false;
  }
  return true;
}
