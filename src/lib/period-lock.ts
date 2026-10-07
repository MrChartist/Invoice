/**
 * Period lock — Tally's "books beginning" / a filed GST month.
 *
 * `settings.lock_until` (YYYY-MM-DD, additive field in `mrchartist_inv_settings`)
 * freezes every document dated ON OR BEFORE that day: it cannot be created,
 * edited, cancelled, reinstated, deleted, paid, or have a payment removed.
 *
 * Enforcement lives in the data layer (`localDb`) — not in the UI — so no
 * screen, importer or recurring run can bypass it. The only way past it is a
 * short-lived, in-memory override that is granted after the PIN is verified and
 * is itself written to the audit log.
 *
 * This module must not import `localDb` (localDb imports it). It reads the
 * settings blob directly.
 */

import { verifyPin } from './auth';
import { audit } from './audit';
import { isoDay } from './dates';
import { SINGLETON_KEYS, getJson } from './storage';

export type LockAction = 'create' | 'edit' | 'cancel' | 'reinstate' | 'delete' | 'pay' | 'unpay' | 'settings';

const ACTION_VERB: Record<LockAction, string> = {
  create: 'created',
  edit: 'edited',
  cancel: 'cancelled',
  reinstate: 'reinstated',
  delete: 'deleted',
  pay: 'paid (no payment can be recorded)',
  unpay: 'changed (its payments cannot be removed)',
  settings: 'changed',
};

export class PeriodLockedError extends Error {
  readonly code = 'PERIOD_LOCKED';
  readonly lockUntil: string;
  readonly docDate: string;
  readonly docNumber?: string;
  readonly action: LockAction;
  constructor(opts: { lockUntil: string; docDate: string; docNumber?: string; action: LockAction; message?: string }) {
    super(opts.message ?? lockMessage(opts.lockUntil, opts.action, opts.docDate, opts.docNumber));
    this.name = 'PeriodLockedError';
    this.lockUntil = opts.lockUntil;
    this.docDate = opts.docDate;
    this.docNumber = opts.docNumber;
    this.action = opts.action;
  }
}

export function isPeriodLockedError(err: unknown): err is PeriodLockedError {
  return err instanceof PeriodLockedError || (err as { code?: string } | null)?.code === 'PERIOD_LOCKED';
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "31 Mar 2026" — locale-independent so messages and tests are stable. */
export function prettyDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : day;
}

export function lockMessage(lockUntil: string, action: LockAction, docDate: string, docNumber?: string): string {
  if (action === 'settings') {
    return `Books are locked up to ${prettyDay(lockUntil)}. Enter your PIN to move the lock date earlier or remove it.`;
  }
  const what = docNumber ? `${docNumber} is dated ${prettyDay(docDate)}` : `A document dated ${prettyDay(docDate)}`;
  return (
    `Books are locked up to ${prettyDay(lockUntil)}. ${what}, so it cannot be ${ACTION_VERB[action]}. ` +
    'Unlock it with your PIN in the editor, or move the lock date in Settings → Defaults.'
  );
}

/** A valid `YYYY-MM-DD` or '' (no lock). */
export function normalizeLockDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!DAY.test(v)) return '';
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? '' : v;
}

/** The current lock date, or '' when the books are open. */
export function getLockUntil(): string {
  const raw = getJson<{ lock_until?: unknown } | null>(SINGLETON_KEYS.settings, null);
  return normalizeLockDate(raw?.lock_until);
}

/** Pure: is `date` on or before `lockUntil`? */
export function isDateLocked(date: unknown, lockUntil: string = getLockUntil()): boolean {
  if (!lockUntil) return false;
  const day = isoDay(date);
  return day !== '' && day <= lockUntil;
}

/* ── Overrides (PIN-guarded, in-memory, short-lived) ─────────────── */

export const OVERRIDE_TTL_MS = 10 * 60_000;
const SETTINGS_SCOPE = '*settings';
const overrides = new Map<string, number>();

export function hasOverride(scope: string, now: number = Date.now()): boolean {
  const until = overrides.get(scope);
  if (until === undefined) return false;
  if (until <= now) {
    overrides.delete(scope);
    return false;
  }
  return true;
}

export function overrideRemainingMs(scope: string, now: number = Date.now()): number {
  return hasOverride(scope, now) ? (overrides.get(scope) as number) - now : 0;
}

export function revokeOverride(scope: string): void {
  overrides.delete(scope);
}

export function clearOverrides(): void {
  overrides.clear();
}

export const SETTINGS_OVERRIDE = SETTINGS_SCOPE;

export interface GrantOptions {
  /** Document id, or `SETTINGS_OVERRIDE` to lower / clear the lock date. */
  scope: string;
  /** Shown in the audit log. */
  docNumber?: string;
  now?: number;
  /** Test seam; defaults to the real PIN check (which counts toward lockout). */
  verify?: (pin: string) => Promise<boolean>;
}

/**
 * Verify the PIN and open a 10-minute window in which `scope` may be changed.
 * Returns false (and grants nothing) on a wrong PIN. Always audited.
 */
export async function grantOverride(pin: string, opts: GrantOptions): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const ok = await (opts.verify ?? ((p: string) => verifyPin(p)))(pin);
  if (!ok) return false;
  overrides.set(opts.scope, now + OVERRIDE_TTL_MS);
  const isSettings = opts.scope === SETTINGS_SCOPE;
  audit.record({
    entity: isSettings ? 'settings' : 'invoice',
    entity_id: isSettings ? 'lock_until' : opts.scope,
    action: 'override',
    doc_number: opts.docNumber,
    summary: isSettings
      ? 'Period lock: PIN verified to change the lock date'
      : `Period lock overridden with PIN for ${opts.docNumber ?? 'a document'} (valid 10 min)`,
  });
  return true;
}

/* ── Checks ──────────────────────────────────────────────────── */

export interface LockSubject {
  id?: string;
  issue_date?: string;
  invoice_number?: string;
}

export type LockState = 'open' | 'overridden' | 'locked';

export function lockState(doc: LockSubject, lockUntil: string = getLockUntil(), now: number = Date.now()): LockState {
  if (!isDateLocked(doc.issue_date, lockUntil)) return 'open';
  return doc.id && hasOverride(doc.id, now) ? 'overridden' : 'locked';
}

/** True when `doc` is frozen right now (a PIN override counts as unlocked). */
export function isLocked(doc: LockSubject | null | undefined): boolean {
  return !!doc && lockState(doc) === 'locked';
}

/**
 * Throws `PeriodLockedError` when `doc` is frozen. Returns 'overridden' when it
 * is frozen but a PIN override is active (callers tag their audit row with it).
 */
export function assertUnlocked(doc: LockSubject, action: LockAction): 'open' | 'overridden' {
  const lockUntil = getLockUntil();
  const state = lockState(doc, lockUntil);
  if (state === 'locked') {
    throw new PeriodLockedError({
      lockUntil,
      docDate: isoDay(doc.issue_date),
      docNumber: doc.invoice_number,
      action,
    });
  }
  return state;
}

/** Splits rows into those that may be written and those inside the lock. */
export function partitionByLock<T extends { issue_date?: string }>(rows: T[]): { open: T[]; locked: T[] } {
  const lockUntil = getLockUntil();
  if (!lockUntil) return { open: rows, locked: [] };
  const open: T[] = [];
  const locked: T[] = [];
  for (const r of rows) (isDateLocked(r.issue_date, lockUntil) ? locked : open).push(r);
  return { open, locked };
}
