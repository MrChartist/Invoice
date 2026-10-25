/**
 * Owner-only management of the extra local users (roadmap 6.21): add a clerk or viewer with their
 * own PIN, change a role, reset a forgotten PIN, remove a user. Loaded with the Settings chunk only.
 *
 * PINs are hashed exactly like the owner's (PBKDF2-SHA-256, see crypto.ts) and kept in the
 * device-local `mrchartist_inv_auth_users` key, which never travels in a backup. Every change is
 * written to the audit log (never the PIN). Convenience access control, not security: see access.ts.
 */

import { requireAccess, type Role } from './access';
import { audit } from './audit';
import { OWNER_ID, announceUserChange, clearGuard, getCurrentUser, isValidPinFormat, listUsers, nameKey, readUsers, writeUsers, type StoredUser, type UserSummary } from './auth';
import { hashPin } from './crypto';
import { generateId } from './storage';

export type AssignableRole = Exclude<Role, 'owner'>;
export const ASSIGNABLE_ROLES: readonly AssignableRole[] = ['clerk', 'viewer'];
export const MAX_USERS = 20;
export const MAX_NAME = 40;

export type UserResult =
  | { ok: true; user: UserSummary }
  | { ok: false; reason: 'invalid-name' | 'duplicate-name' | 'invalid-pin' | 'invalid-role' | 'not-found' | 'owner' | 'too-many' };

export const USER_ERRORS: Record<Exclude<UserResult, { ok: true }>['reason'], string> = {
  'invalid-name': `Enter a name (up to ${MAX_NAME} characters).`,
  'duplicate-name': 'Another user already has that name.',
  'invalid-pin': 'The PIN must be 4 to 6 digits.',
  'invalid-role': 'Choose Clerk or Viewer.',
  'not-found': 'That user no longer exists.',
  owner: 'The owner cannot be changed here.',
  'too-many': `Up to ${MAX_USERS} users per device.`,
};

const isAssignable = (r: unknown): r is AssignableRole => r === 'clerk' || r === 'viewer';
const summary = (u: StoredUser): UserSummary => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt });

function log(action: 'create' | 'update' | 'delete', text: string): void {
  audit.record({ entity: 'settings', entity_id: 'users', action, summary: text });
  // Every open tab re-checks who is signed in: a removed user's tab locks, a new role applies at once.
  announceUserChange();
}

/** Add a clerk or viewer. Owner only (throws AccessDeniedError otherwise). */
export async function addUser(name: string, role: AssignableRole, pin: string): Promise<UserResult> {
  requireAccess('security.manage');
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > MAX_NAME) return { ok: false, reason: 'invalid-name' };
  if (!isAssignable(role)) return { ok: false, reason: 'invalid-role' };
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'invalid-pin' };
  if (listUsers().some((u) => nameKey(u.name) === nameKey(clean))) return { ok: false, reason: 'duplicate-name' };
  if (readUsers().length >= MAX_USERS) return { ok: false, reason: 'too-many' };
  const hashed = await hashPin(pin);
  const user: StoredUser = { id: generateId(), name: clean, role, createdAt: new Date().toISOString(), v: 2, ...hashed };
  // Re-read after the slow hash so a user added meanwhile (another tab) is kept.
  writeUsers([...readUsers(), user]);
  log('create', `User added: ${clean} (${role})`);
  return { ok: true, user: summary(user) };
}

/** Switch a user between clerk and viewer. Owner only. */
export function setUserRole(id: string, role: AssignableRole): UserResult {
  requireAccess('security.manage');
  if (id === OWNER_ID) return { ok: false, reason: 'owner' };
  if (!isAssignable(role)) return { ok: false, reason: 'invalid-role' };
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return { ok: false, reason: 'not-found' };
  if (u.role === role) return { ok: true, user: summary(u) };
  const next = { ...u, role };
  writeUsers(users.map((x) => (x.id === id ? next : x)));
  log('update', `User role changed: ${u.name} ${u.role} → ${role}`);
  return { ok: true, user: summary(next) };
}

/** Set a new PIN for a user who forgot theirs (also lifts their lockout). Owner only. */
export async function resetUserPin(id: string, pin: string): Promise<UserResult> {
  requireAccess('security.manage');
  if (id === OWNER_ID) return { ok: false, reason: 'owner' };
  if (!isValidPinFormat(pin)) return { ok: false, reason: 'invalid-pin' };
  if (!readUsers().some((x) => x.id === id)) return { ok: false, reason: 'not-found' };
  const hashed = await hashPin(pin);
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return { ok: false, reason: 'not-found' };
  const next: StoredUser = { ...u, v: 2, ...hashed };
  writeUsers(users.map((x) => (x.id === id ? next : x)));
  clearGuard(id);
  log('update', `PIN reset by the owner for ${u.name}`);
  return { ok: true, user: summary(next) };
}

/** Remove a user. Their open tabs lock at once (user-change broadcast / storage event). Owner only. */
export function removeUser(id: string): UserResult {
  requireAccess('security.manage');
  if (id === OWNER_ID || getCurrentUser()?.id === id) return { ok: false, reason: 'owner' };
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return { ok: false, reason: 'not-found' };
  writeUsers(users.filter((x) => x.id !== id));
  clearGuard(id);
  log('delete', `User removed: ${u.name} (${u.role})`);
  return { ok: true, user: summary(u) };
}
