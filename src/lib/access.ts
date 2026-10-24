/**
 * Local user roles on a shared device (roadmap 6.21): owner / clerk / viewer.
 *
 * CONVENIENCE ACCESS CONTROL, NOT SECURITY. Everything runs in this browser: anyone with the
 * device and the browser's developer tools can read or change the stored data, or bypass these
 * checks. They stop a colleague from deleting an issued invoice or erasing the books by mistake;
 * vault mode (src/lib/vault.ts) and separate OS accounts are the real protection.
 *
 * This module imports nothing, so the data layer (localDb, backup, period-lock, audit) can ask
 * `can()` / `requireAccess()` without import cycles. `auth.ts` registers who is signed in through
 * `setActorProvider()`; with no provider, or nobody signed in, every check passes (single-user
 * installs, tests, and boot code that runs before the PIN screen behave exactly as before).
 */

export type Role = 'owner' | 'clerk' | 'viewer';

export const ROLES: readonly Role[] = ['owner', 'clerk', 'viewer'];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  clerk: 'Clerk',
  viewer: 'Viewer',
};

export const ROLE_HINTS: Record<Role, string> = {
  owner: 'Everything, including settings, users, backups, erase and the period lock.',
  clerk: 'Creates and edits documents, payments, purchases and expenses. Cannot delete issued documents, change settings or restore / erase data.',
  viewer: 'Read-only: can view, print, download PDFs and export reports.',
};

/** Everything a screen or the data layer may ask about. */
export type AccessAction =
  /** Create a new invoice / quotation / credit note … (the editor's "New"). */
  | 'doc.create'
  /** Edit a saved document, change its status, convert it. */
  | 'doc.edit'
  /** Delete a draft (never issued). */
  | 'doc.deleteDraft'
  /** Delete an issued document (anything that is not a draft). */
  | 'doc.deleteIssued'
  /** Record / remove a payment against a document. */
  | 'payment.record'
  /** Clients, catalogue items, vendors, stock — the masters. */
  | 'master.edit'
  /** Purchases, expenses, vouchers, time entries, recurring schedules. */
  | 'books.edit'
  /** Business profiles, defaults, design studio, period-lock date. */
  | 'settings.manage'
  /** Users, PIN rules for others, vault mode, idle timeout. */
  | 'security.manage'
  /** Download / auto-save a FULL backup (every table). */
  | 'data.backup'
  /** Restore a backup over this device's data. */
  | 'data.restore'
  /** Erase every table on this device. */
  | 'data.erase'
  /** Unlock a period-locked document or move the lock date earlier. */
  | 'period.override'
  /** View screens, print / download a document PDF. */
  | 'view'
  /** Export reports (CSV / Excel / GST papers). */
  | 'report.export';

const CLERK: ReadonlySet<AccessAction> = new Set<AccessAction>([
  'doc.create',
  'doc.edit',
  'doc.deleteDraft',
  'payment.record',
  'master.edit',
  'books.edit',
  'view',
  'report.export',
]);

const VIEWER: ReadonlySet<AccessAction> = new Set<AccessAction>(['view', 'report.export']);

/** Pure role matrix. */
export function roleCan(role: Role | null | undefined, action: AccessAction): boolean {
  if (role === 'owner') return true;
  if (role === 'clerk') return CLERK.has(action);
  if (role === 'viewer') return VIEWER.has(action);
  return false;
}

export function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'clerk' || value === 'viewer';
}

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

let provider: (() => Actor | null) | null = null;

/** Called once by auth.ts. Tests may pass their own. */
export function setActorProvider(fn: (() => Actor | null) | null): void {
  provider = fn;
}

/** Who is signed in to this tab, or null (no PIN set up, locked, or no provider). */
export function currentActor(): Actor | null {
  try {
    return provider ? provider() : null;
  } catch {
    return null;
  }
}

/** The current role. Nobody signed in counts as the owner (see the module comment). */
export function currentRole(): Role {
  return currentActor()?.role ?? 'owner';
}

/** May the signed-in user do `action`? */
export function can(action: AccessAction): boolean {
  return roleCan(currentRole(), action);
}

const DENIED_TEXT: Partial<Record<AccessAction, string>> = {
  'doc.create': 'create documents',
  'doc.edit': 'edit documents',
  'doc.deleteDraft': 'delete documents',
  'doc.deleteIssued': 'delete issued documents',
  'payment.record': 'record or remove payments',
  'master.edit': 'change clients, items or vendors',
  'books.edit': 'change purchases, expenses or the books',
  'settings.manage': 'change settings',
  'security.manage': 'manage users or security',
  'data.backup': 'download a full backup',
  'data.restore': 'restore a backup',
  'data.erase': 'erase data',
  'period.override': 'override the period lock',
};

export function deniedMessage(action: AccessAction, role: Role = currentRole()): string {
  const what = DENIED_TEXT[action] ?? 'do that';
  return `Your role (${ROLE_LABELS[role]}) cannot ${what}. Ask the owner.`;
}

export class AccessDeniedError extends Error {
  readonly code = 'ACCESS_DENIED';
  readonly action: AccessAction;
  readonly role: Role;
  constructor(action: AccessAction, role: Role) {
    super(deniedMessage(action, role));
    this.name = 'AccessDeniedError';
    this.action = action;
    this.role = role;
  }
}

export function isAccessDeniedError(err: unknown): err is AccessDeniedError {
  return err instanceof AccessDeniedError || (err as { code?: string } | null)?.code === 'ACCESS_DENIED';
}

/** Throws `AccessDeniedError` unless the signed-in user may do `action`. Used by the data layer. */
export function requireAccess(action: AccessAction): void {
  const role = currentRole();
  if (!roleCan(role, action)) throw new AccessDeniedError(action, role);
}
