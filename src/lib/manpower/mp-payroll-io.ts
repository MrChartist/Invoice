/**
 * Round 17 bridge to the payroll store — the only Round 17 module that imports it (PRD B2). A: the site's deployed
 * employees and "Deploy" (sets `Employee.cost_centre_id` through the store's own save). B appends the attendance push,
 * C the finalised-run read, each in its own block.
 */
import type { Employee } from '../../types/payroll';
import { loadEmployees, saveEmployee } from '../payroll/store';

/* ── R17-A2 ── */

/** Active employees whose home cost centre is the site. */
export const deployedAt = (siteId: string, all: readonly Employee[] = loadEmployees()): Employee[] => all.filter((e) => e.active && e.cost_centre_id === siteId);

/** Active employees not at the site (the Deploy picker). */
export const deployable = (siteId: string): Employee[] => loadEmployees().filter((e) => e.active && e.cost_centre_id !== siteId);

/** Deploy an employee to a site (and post): the payroll store's save (rights, validation, audit) unchanged. */
export function deploy(empId: string, siteId: string, postId?: string): Employee {
  const e = loadEmployees().find((x) => x.id === empId);
  if (!e) throw new Error('Employee not found.');
  return saveEmployee({ ...e, cost_centre_id: siteId, mp: { ...e.mp, post_id: postId || undefined } });
}

/* ── R17-B ── */

/* ── R17-C ── */
