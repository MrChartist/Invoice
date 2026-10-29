/**
 * Per-user payroll access (7T): the owner may let a named, trusted clerk (or viewer) see payroll by
 * granting `payroll.view` on that user. Payroll stays owner-only by default. A clerk with the grant
 * can also run payroll (they already have `books.edit`); a viewer with it can only look.
 *
 * Convenience access control, not security (see access.ts): anyone with the device and developer
 * tools can read the stored salaries. The grant lives on the device-local user record
 * (`mrchartist_inv_auth_users`), never in a backup, and every change is audited.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { OWNER_ID, announceUserChange, readUsers, writeUsers } from '../auth';
import { PayrollError } from './store';

export const PAYROLL_GRANT = 'payroll.view';

export interface PayrollGrantee {
  id: string;
  name: string;
  role: 'clerk' | 'viewer';
  granted: boolean;
}

/** The device's clerks / viewers and whether each may see payroll. */
export function payrollGrantees(): PayrollGrantee[] {
  return readUsers().map((u) => ({ id: u.id, name: u.name, role: u.role, granted: !!u.grants?.includes(PAYROLL_GRANT) }));
}

/** Grant or withdraw payroll access for one user. Owner only (`security.manage`); audited. */
export function setPayrollGrant(userId: string, granted: boolean): PayrollGrantee {
  requireAccess('security.manage');
  if (userId === OWNER_ID) throw new PayrollError('The owner always sees payroll.');
  const users = readUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new PayrollError('That user no longer exists.');
  const has = !!u.grants?.includes(PAYROLL_GRANT);
  if (has !== granted) {
    const rest = (u.grants ?? []).filter((g) => g !== PAYROLL_GRANT);
    const grants = granted ? [...rest, PAYROLL_GRANT] : rest;
    const next = { ...u, ...(grants.length ? { grants } : {}) };
    if (!grants.length) delete next.grants;
    writeUsers(users.map((x) => (x.id === userId ? next : x)));
    audit.record({
      entity: 'settings',
      entity_id: 'users',
      action: 'update',
      summary: granted
        ? `Payroll access granted to ${u.name} (${u.role}): salaries, payslips and statutory returns become visible to this user`
        : `Payroll access withdrawn from ${u.name} (${u.role})`,
    });
    // Every open tab re-checks who is signed in, so the change applies at once.
    announceUserChange();
  }
  return { id: u.id, name: u.name, role: u.role, granted };
}
