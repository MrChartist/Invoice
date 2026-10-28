/** R3-B2: the project form's draft and its save (kept out of the component file for fast refresh). */
import { saveCostCentre, type CostCentre, type ProjectStatus } from '../../lib/cost-centres';

export interface ProjectDraft {
  id?: string;
  name: string;
  client_id: string;
  budget_hours: string;
  fee_budget: string;
  start: string;
  due: string;
  status: ProjectStatus;
  rate: string;
}

export const draftOf = (p?: CostCentre): ProjectDraft => ({
  id: p?.id,
  name: p?.name ?? '',
  client_id: p?.client_id ?? '',
  budget_hours: p?.budget_minutes ? String(Math.round((p.budget_minutes / 60) * 100) / 100) : '',
  fee_budget: p?.fee_budget ? String(p.fee_budget) : '',
  start: p?.start ?? '',
  due: p?.due ?? '',
  status: p?.status ?? 'active',
  rate: p?.hourly_rate ? String(p.hourly_rate) : '',
});

/** Save a project draft as a cost centre of kind 'project' (validation errors throw). */
export function saveProjectDraft(d: ProjectDraft, prev?: CostCentre): CostCentre {
  const hours = Number(d.budget_hours) || 0;
  return saveCostCentre({
    ...(prev ?? {}),
    id: d.id,
    name: d.name,
    kind: 'project',
    active: prev ? prev.active : true,
    client_id: d.client_id || undefined,
    budget_minutes: hours > 0 ? Math.round(hours * 60) : undefined,
    fee_budget: Number(d.fee_budget) > 0 ? Number(d.fee_budget) : undefined,
    start: d.start || undefined,
    due: d.due || undefined,
    status: d.status,
    hourly_rate: Number(d.rate) > 0 ? Number(d.rate) : undefined,
  });
}

