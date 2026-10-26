/**
 * R5-C1 dues (defaulters): per student × plan × instalment, what is still owed on its fee documents, days overdue,
 * the guardian's phone and the fine that WOULD be due (shown, never added — "Add fine" creates it on click).
 * Also the clinic-package "sessions left" and the bell notices (instalments due in 3 days / overdue). Pure.
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { FeePlan } from '../../types/institutions-r5';
import { receivableBalance } from '../rcm';
import { round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { daysFrom, str } from './r5c';
import { fineDue } from './fee-plans';
import { enrolmentOf } from './enrolments';

export interface DueRow {
  student: Client;
  plan: FeePlan;
  idx: number;
  label: string;
  due_date: string;
  docs: InvoiceRecord[];
  due: number;
  days: number;
  fine: number;
  /** The document a fine would be raised against (the oldest open one). */
  against?: InvoiceRecord;
  fined: boolean;
}

const live = (i: InvoiceRecord) => i.status !== 'Draft' && i.status !== 'Cancelled';

/** Open fee dues on `today` (fines on the instalment's own documents only). */
export function feeDues(invoices: readonly InvoiceRecord[], clients: readonly Client[], plans: readonly FeePlan[], today: string): DueRow[] {
  const byClient = new Map(clients.map((c) => [c.id, c]));
  const byPlan = new Map(plans.map((p) => [p.id, p]));
  const groups = new Map<string, InvoiceRecord[]>();
  for (const i of invoices) {
    if (!i.fee_plan_id || !live(i) || !byPlan.has(i.fee_plan_id) || !i.client?.id) continue;
    const k = `${i.client.id}|${i.fee_plan_id}|${i.fee_instalment ?? 0}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }
  const out: DueRow[] = [];
  for (const [k, docs] of groups) {
    const [cid, pid, ix] = k.split('|');
    const plan = byPlan.get(pid)!;
    const idx = Number(ix);
    const student = byClient.get(cid) ?? docs[0].client;
    const due = round2(docs.reduce((s, d) => s + Math.max(receivableBalance(d), 0), 0));
    if (due < 0.01) continue;
    const dueDate = plan.instalments[idx]?.due_date || docs[0].due_date;
    const own = docs.filter((d) => !d.late_fee_for);
    const against = own.find((d) => receivableBalance(d) > 0) ?? own[0];
    const fined = docs.some((d) => d.late_fee_for);
    out.push({ student, plan, idx, label: plan.instalments[idx]?.label ?? '', due_date: dueDate, docs, due, days: Math.max(0, daysFrom(dueDate, today)), fine: fined ? 0 : fineDue(plan.fine, dueDate, today), against, fined });
  }
  return out.sort((a, b) => b.days - a.days || a.student.name.localeCompare(b.student.name));
}

/** Ageing bucket of a due row: 0 (not yet due / ≤ 30), 1 (31–60), 2 (61–90), 3 (90+). */
export const ageBucket = (days: number): 0 | 1 | 2 | 3 => (days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3);

export function duesCsv(rows: readonly DueRow[], head: readonly string[]): string {
  return toCsv([[...head], ...rows.map((r) => [r.student.name, str(r.student.roll_no), str(r.student.class_label), r.plan.name, r.label, r.due_date, r.due, r.days, r.fine, str(r.student.guardian?.name), str(r.student.guardian?.phone) || str(r.student.phone)])]);
}

/** Sessions left on a clinic package (once-heads with `sessions`), or null when the plan sells none. */
export function sessionsLeft(c: Pick<Client, 'enrolments'>, plan: FeePlan): { total: number; left: number } | null {
  const total = plan.heads.reduce((s, h) => s + (h.sessions ?? 0), 0);
  if (!total) return null;
  return { total, left: Math.max(0, total - (enrolmentOf(c, plan.id)?.visits?.length ?? 0)) };
}

/** Bell: instalments due within 3 days (enrolled students not yet paid) and the overdue count. */
export function feeNotices(plans: readonly FeePlan[], clients: readonly Client[], invoices: readonly InvoiceRecord[], today: string): { soon: { plan: FeePlan; label: string; date: string; count: number }[]; overdue: number } {
  const soon: { plan: FeePlan; label: string; date: string; count: number }[] = [];
  for (const p of plans) {
    p.instalments.forEach((inst, idx) => {
      const d = daysFrom(today, inst.due_date);
      if (d < 0 || d > 3) return;
      const count = clients.filter((c) => enrolmentOf(c, p.id) && !invoices.some((i) => i.fee_plan_id === p.id && i.fee_instalment === idx && i.client?.id === c.id && live(i) && receivableBalance(i) <= 0.004)).length;
      if (count) soon.push({ plan: p, label: inst.label, date: inst.due_date, count });
    });
  }
  return { soon, overdue: feeDues(invoices, clients, plans, today).filter((r) => r.days > 0).length };
}
