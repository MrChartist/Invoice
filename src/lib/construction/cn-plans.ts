/**
 * CN-C3 payment plans (table `payment_plans`, `master.edit`) — construction-linked (CLP), time-linked, down payment,
 * subvention; stage % must sum to 100 — and stage certificates (table `stage_certificates`, `doc.create`, dated
 * `certified_on`): the engineer / architect certifies "4th slab" of a tower, which opens the demand run. Audited.
 */
import './cn-registry';
import type { PaymentPlan, PlanStage, StageCertificate } from '../../types/construction-r11';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { RT, removeRow, rows, upsert } from './cn-realty-projects';

export const loadPlans = () => rows<PaymentPlan>(RT.plans);
export const loadCerts = () => rows<StageCertificate>(RT.certs);

export const planTotal = (stages: readonly Pick<PlanStage, 'pct'>[]): number => round2(stages.reduce((s, x) => s + num(x.pct), 0));

/** Pure: "Booking 10, Agreement 10, Plinth 15 …" → stages (CLP triggers: booking / agreement / stage). */
export function parseStages(text: string): PlanStage[] {
  return text.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^(.*?)[\s:=]+(\d+(?:\.\d+)?)\s*%?$/.exec(s);
    const label = (m ? m[1] : s).trim();
    const trigger: PlanStage['trigger'] = /^booking/i.test(label) ? 'booking' : /^agreement/i.test(label) ? 'agreement' : 'stage';
    return { id: generateId(), label, pct: m ? num(m[2]) : 0, due_days: 15, trigger };
  });
}

export function savePlan(p: Omit<PaymentPlan, 'id'> & { id?: string }): PaymentPlan {
  requireAccess('master.edit');
  if (!p.name.trim()) throw new Error('Name the plan.');
  if (Math.abs(planTotal(p.stages) - 100) > 0.001) throw new Error(`Stages add up to ${planTotal(p.stages)}%, not 100%.`);
  return upsert(RT.plans, { ...p, id: p.id || generateId(), name: p.name.trim() });
}

export function deletePlan(id: string): void {
  requireAccess('master.edit');
  if (rows<{ plan_id: string; status: string }>(RT.bookings).some((b) => b.plan_id === id && b.status !== 'cancelled')) throw new Error('A live booking uses this plan.');
  removeRow(RT.plans, id);
}

const key = (s: string) => s.trim().toLowerCase();
/** The stage of `plan` a certificate covers (by id, else by the same label). */
export const stageOf = (plan: PaymentPlan | undefined, c: Pick<StageCertificate, 'stage_id' | 'stage_label'>): PlanStage | undefined =>
  plan?.stages.find((s) => s.id === c.stage_id) ?? plan?.stages.find((s) => key(s.label) === key(c.stage_label));

export function certifyStage(c: Omit<StageCertificate, 'id'>): StageCertificate {
  requireAccess('doc.create');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.certified_on)) throw new Error('Enter the certificate date.');
  if (!c.stage_label.trim() || !c.tower_id) throw new Error('Choose the tower and the stage.');
  if (loadCerts().some((x) => x.tower_id === c.tower_id && key(x.stage_label) === key(c.stage_label))) throw new Error(`${c.stage_label} is already certified for this tower.`);
  return upsert(RT.certs, { ...c, id: generateId() });
}

export function deleteCert(id: string): void {
  requireAccess('doc.create');
  removeRow(RT.certs, id);
}
