/**
 * CN-C1 projects (table `realty_projects`, `master.edit`, audited; deletes reach the recycle bin through the edit
 * observer): RERA registration and validity, the RERA 70% account (a bank account flagged `rera_project_id`), city
 * class (affordable test), GST scheme, towers and the completion certificate date. A project is also a cost centre
 * (kind `project`) so purchases tagged to it feed the 80% test and the project P&L. Table names of CN-C live here.
 */
import './cn-registry';
import type { RealtyProject } from '../../types/construction-r11';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { bankAccountsDb } from '../bank-accounts';
import { loadCostCentres, saveCostCentre } from '../cost-centres';

export const RT = {
  projects: 'realty_projects',
  units: 'realty_units',
  bookings: 'realty_bookings',
  plans: 'payment_plans',
  certs: 'stage_certificates',
  rera: 'rera_withdrawals',
} as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const rows = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');
/** Insert or replace a row by id (one table write: the edit observer audits it). */
export function upsert<T extends { id: string }>(t: string, row: T): T {
  const all = rows<T>(t);
  setTable(t, all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}
/** Data-layer delete (the row goes to the recycle bin). */
export const removeRow = (t: string, id: string) => setTable(t, rows<{ id: string }>(t).filter((r) => r.id !== id));

export const loadProjects = () => rows<RealtyProject>(RT.projects);

export type ProjectInput = Omit<RealtyProject, 'id' | 'created_at' | 'towers'> & { id?: string; towers: { id?: string; name: string; floors: number; completion_pct?: number }[] };

export function saveProject(p: ProjectInput): RealtyProject {
  requireAccess('master.edit');
  const name = p.name.trim();
  if (!name) throw new Error('Enter the project name.');
  for (const d of [p.cc_date, p.oc_date, p.rera_valid_till, p.started_on]) if (d && !DAY.test(d)) throw new Error('Enter dates as YYYY-MM-DD.');
  const prev = p.id ? loadProjects().find((x) => x.id === p.id) : undefined;
  let cc = p.cost_centre_id || prev?.cost_centre_id;
  if (!cc) cc = (loadCostCentres().find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? saveCostCentre({ name, kind: 'project', active: true } as never)).id;
  const row: RealtyProject = {
    ...prev, ...p, id: prev?.id ?? generateId(), name, cost_centre_id: cc,
    towers: p.towers.filter((t) => t.name.trim()).map((t) => ({ ...t, id: t.id || generateId(), name: t.name.trim(), floors: Math.max(0, Math.round(t.floors) || 0) })),
    created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}),
  };
  upsert(RT.projects, row);
  // CN-C4: the RERA account carries the project id (one project per account).
  for (const a of bankAccountsDb.all()) {
    const want = a.id === row.rera_account_id;
    if (want !== (a.rera_project_id === row.id)) bankAccountsDb.save({ ...a, rera_project_id: want ? row.id : undefined });
  }
  return row;
}

/** Delete a project with no units (they must go first). */
export function deleteProject(id: string): void {
  requireAccess('master.edit');
  if (rows<{ project_id: string }>(RT.units).some((u) => u.project_id === id)) throw new Error('Delete the project\'s units first.');
  removeRow(RT.projects, id);
}
