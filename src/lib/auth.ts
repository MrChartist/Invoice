/**
 * Local-only PIN gate for the Invoice Creator. No backend — everything stays on
 * this device.
 *
 * Storage layout (the `mrchartist_inv_auth` key is unchanged for existing users):
 *   mrchartist_inv_auth        credential record  {name, createdAt, v:2, kdf, iter, salt, hash}
 *                              (legacy: {name, pin, createdAt} — upgraded on first successful unlock)
 *   mrchartist_inv_auth_guard  failed-attempt counter + lockout deadline
 *   mrchartist_inv_idle_min    auto-lock timeout in minutes (0 = never)
 *   sessionStorage             the "unlocked" flag — cleared on tab close and by logout()
 *
 * logout() now only LOCKS the app (clears the session). It no longer deletes the
 * credential, which previously let anyone with access to the browser re-register
 * a new PIN simply by logging out.
 */

import { DB_PREFIX, SINGLETON_KEYS, readRaw, removeRaw, writeRaw } from './storage';
import { constantTimeEqualStrings, hashPin, verifyPinHash, type PinHash } from './crypto';

export const AUTH_KEY = SINGLETON_KEYS.auth;
export const GUARD_KEY = `${DB_PREFIX}auth_guard`;
export const IDLE_KEY = `${DB_PREFIX}idle_min`;
export const SESSION_KEY = `${DB_PREFIX}session`;
export const IDLE_CHANGED_EVENT = 'mrchartist:idle-changed';

/** Keys that describe THIS device's security state and must never travel in a backup. */
export const DEVICE_LOCAL_KEYS: readonly string[] = [AUTH_KEY, GUARD_KEY, IDLE_KEY, SESSION_KEY, `${DB_PREFIX}last_backup`];

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

function writeRecord(rec: StoredRecord): void {
  writeRaw(AUTH_KEY, JSON.stringify(rec));
}

/* ── session (unlocked flag) ──────────────────────────────────── */

let memorySession = false;

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function startSession(): void {
  memorySession = true;
  try {
    sessionStore()?.setItem(SESSION_KEY, '1');
  } catch {
    /* in-memory flag still holds for this page load */
  }
}

function endSession(): void {
  memorySession = false;
  try {
    sessionStore()?.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** True when a credential exists AND this tab has been unlocked. */
export function isAuthenticated(): boolean {
  if (!readRecord()) return false;
  if (memorySession) return true;
  try {
    return sessionStore()?.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** The account holder (name only — secrets are never returned). Available while locked, for the login screen. */
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

/* ── lockout (persisted, exponential) ─────────────────────────── */

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

function readGuard(): GuardState {
  try {
    const raw = readRaw(GUARD_KEY);
    if (!raw) return { ...FRESH_GUARD };
    const g = JSON.parse(raw) as Partial<GuardState>;
    return {
      fails: Number.isFinite(g.fails) ? Math.max(0, g.fails as number) : 0,
      level: Number.isFinite(g.level) ? Math.max(0, g.level as number) : 0,
      lockedUntil: Number.isFinite(g.lockedUntil) ? (g.lockedUntil as number) : 0,
    };
  } catch {
    return { ...FRESH_GUARD };
  }
}

function writeGuard(state: GuardState): void {
  try {
    if (state.fails === 0 && state.level === 0 && state.lockedUntil === 0) removeRaw(GUARD_KEY);
    else writeRaw(GUARD_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — the in-page attempt still fails */
  }
}

/** Milliseconds left on the current lockout (0 when attempts are allowed). */
export function getLockoutRemaining(now: number = Date.now()): number {
  const { lockedUntil } = readGuard();
  return Math.max(0, lockedUntil - now);
}

export function getAttemptsLeft(): number {
  return Math.max(0, MAX_FREE_ATTEMPTS - readGuard().fails);
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

async function checkPin(rec: StoredRecord, pin: string): Promise<boolean> {
  if (rec.hash && rec.salt && rec.iter && rec.kdf) {
    return verifyPinHash(pin, { kdf: rec.kdf, iter: rec.iter, salt: rec.salt, hash: rec.hash });
  }
  // Legacy plaintext record.
  return typeof rec.pin === 'string' && constantTimeEqualStrings(rec.pin, pin);
}

/** Replaces a legacy plaintext record with a hashed one. */
async function upgradeRecord(rec: StoredRecord, pin: string): Promise<void> {
  const hashed = await hashPin(pin);
  writeRecord({ name: rec.name, createdAt: rec.createdAt, v: 2, ...hashed });
}

/**
 * Verifies a PIN with lockout accounting. A correct PIN resets the counter and
 * transparently upgrades a legacy plaintext record to a hashed one.
 * Does NOT start a session — see {@link unlock}.
 */
export async function checkPinWithGuard(pin: string, now: number = Date.now()): Promise<UnlockResult> {
  const rec = readRecord();
  const guard = readGuard();
  if (guard.lockedUntil > now) {
    return { ok: false, locked: true, retryInMs: guard.lockedUntil - now, attemptsLeft: 0 };
  }
  if (!rec) return { ok: false, locked: false, retryInMs: 0, attemptsLeft: MAX_FREE_ATTEMPTS };

  if (await checkPin(rec, pin)) {
    writeGuard({ ...FRESH_GUARD });
    if (!rec.hash) {
      try {
        await upgradeRecord(rec, pin);
      } catch {
        /* keep the legacy record; it will be upgraded next time */
      }
    }
    return { ok: true, locked: false, retryInMs: 0, attemptsLeft: MAX_FREE_ATTEMPTS };
  }

  const next = registerFailure(guard, now);
  writeGuard(next);
  const retryInMs = Math.max(0, next.lockedUntil - now);
  return { ok: false, locked: retryInMs > 0, retryInMs, attemptsLeft: retryInMs > 0 ? 0 : MAX_FREE_ATTEMPTS - next.fails };
}

/** Verify the PIN and, if correct, start the session. This is what the login form calls. */
export async function unlock(pin: string, now: number = Date.now()): Promise<UnlockResult> {
  const result = await checkPinWithGuard(pin, now);
  if (result.ok) startSession();
  return result;
}

/** Verify PIN for the existing user (counts toward lockout; does not start a session). */
export async function verifyPin(pin: string, now: number = Date.now()): Promise<boolean> {
  return (await checkPinWithGuard(pin, now)).ok;
}

/**
 * Register the first user and start a session. If an account already exists this
 * behaves like {@link unlock} (the name is ignored) — it can never overwrite an
 * existing PIN. Returns false on invalid input or a wrong PIN.
 */
export async function login(name: string, pin: string): Promise<boolean> {
  if (readRecord()) return (await unlock(pin)).ok;
  if (!name.trim() || !isValidPinFormat(pin)) return false;
  const hashed = await hashPin(pin);
  writeRecord({ name: name.trim(), createdAt: new Date().toISOString(), v: 2, ...hashed });
  writeGuard({ ...FRESH_GUARD });
  startSession();
  return true;
}

/** Lock the app. Data and the PIN are kept. */
export function logout(): void {
  endSession();
}

export type ChangePinResult =
  | { ok: true }
  | { ok: false; reason: 'locked' | 'wrong-pin' | 'invalid-format' | 'same-pin' | 'no-account'; retryInMs?: number };

/** Change the PIN after verifying the old one (counts toward lockout). */
export async function changePin(oldPin: string, newPin: string, now: number = Date.now()): Promise<ChangePinResult> {
  const rec = readRecord();
  if (!rec) return { ok: false, reason: 'no-account' };
  if (!isValidPinFormat(newPin)) return { ok: false, reason: 'invalid-format' };
  if (oldPin === newPin) return { ok: false, reason: 'same-pin' };
  const check = await checkPinWithGuard(oldPin, now);
  if (check.locked) return { ok: false, reason: 'locked', retryInMs: check.retryInMs };
  if (!check.ok) return { ok: false, reason: 'wrong-pin' };
  const hashed = await hashPin(newPin);
  writeRecord({ name: rec.name, createdAt: rec.createdAt, v: 2, ...hashed });
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
 * Recovery path for a forgotten PIN. The data is local-only, so there is no
 * server reset: the only way back in is to erase every `mrchartist_inv_*` key
 * (invoices, clients, profiles, PIN, lockout) and start fresh. Requires the
 * exact confirmation phrase. Returns false (and erases nothing) otherwise.
 */
export function resetAllData(confirmation: string): boolean {
  if (!isResetPhrase(confirmation)) return false;
  endSession();
  try {
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
