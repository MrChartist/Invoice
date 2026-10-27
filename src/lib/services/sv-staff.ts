/**
 * SV-A3 service staff (table `service_staff`, `master.edit`, audited "Service staff") and commission plans (table
 * `commission_plans`, `master.edit`, audited "Commission plan"). Staff are the people who serve clients — names, roles,
 * hours, a commission plan — not the confidential payroll employee row (an optional `employee_id` links the two).
 * Deletes reach the recycle bin through the edit observer.
 */
import './sv-registry';
import type { CommissionPlan, CommissionRule, ServiceStaff } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { SV_TABLES } from './sv-shared';

const rows = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');
export const loadStaff = (): ServiceStaff[] => rows<ServiceStaff>(SV_TABLES.staff);
export const loadPlans = (): CommissionPlan[] => rows<CommissionPlan>(SV_TABLES.plans);
/** Bookable, active staff (the day-view columns). */
export const bookableStaff = (all = loadStaff()): ServiceStaff[] => all.filter((s) => s.active !== false && s.bookable !== false);

/** First name, for the paper ("Haircut — Priya") with `service_settings.print_staff` on. */
export const firstName = (name: string | undefined): string => String(name ?? '').trim().split(/\s+/)[0] ?? '';

export type StaffInput = Omit<ServiceStaff, 'id' | 'created_at'> & { id?: string };

export function saveStaff(i: StaffInput): ServiceStaff {
  requireAccess('master.edit');
  const name = i.name.trim();
  if (!name) throw new Error('Enter the staff member\'s name.');
  const all = loadStaff();
  if (all.some((s) => s.id !== i.id && s.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`${name} is already on the staff list.`);
  if (i.employment === 'freelance' && i.employee_id) throw new Error('A freelancer is not on the payroll; remove the employee link.');
  const prev = i.id ? all.find((s) => s.id === i.id) : undefined;
  const row: ServiceStaff = { ...prev, ...i, id: prev?.id ?? generateId(), name, created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.staff, prev ? all.map((s) => (s.id === row.id ? row : s)) : [...all, row]);
  return row;
}

/** Delete a staff member (the row goes to the recycle bin; their bills keep the name snapshot). */
export function deleteStaff(id: string): void {
  requireAccess('master.edit');
  setTable(SV_TABLES.staff, loadStaff().filter((s) => s.id !== id));
}

const validRule = (r: CommissionRule) => (r.item_id || r.category || r.kind) && ((Number(r.pct) || 0) > 0 || (Number(r.per_unit) || 0) > 0);

export type PlanInput = Omit<CommissionPlan, 'id' | 'created_at'> & { id?: string };

export function savePlan(i: PlanInput): CommissionPlan {
  requireAccess('master.edit');
  const name = i.name.trim();
  if (!name) throw new Error('Name the commission plan.');
  const rules = i.rules.filter(validRule).map((r) => ({ ...r, ...(r.pct ? { pct: Math.min(100, Number(r.pct)) } : {}), ...(r.per_unit ? { per_unit: Number(r.per_unit) } : {}) }));
  if (!rules.length) throw new Error('Add at least one rule with a % or a fixed amount.');
  if (i.slab && !(i.slab.target > 0 && i.slab.pct >= 0)) throw new Error('Give the slab a target above zero.');
  const all = loadPlans();
  const prev = i.id ? all.find((p) => p.id === i.id) : undefined;
  const row: CommissionPlan = { ...prev, ...i, name, rules, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.plans, prev ? all.map((p) => (p.id === row.id ? row : p)) : [...all, row]);
  return row;
}

export function deletePlan(id: string): void {
  requireAccess('master.edit');
  if (loadStaff().some((s) => s.plan_id === id)) throw new Error('Staff still use this plan. Give them another plan first.');
  setTable(SV_TABLES.plans, loadPlans().filter((p) => p.id !== id));
}
