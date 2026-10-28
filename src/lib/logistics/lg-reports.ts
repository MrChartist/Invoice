/**
 * R19-D4 logistics reports (pure; family `f-logistics`; CSV from the Reports view): margin by lane / client /
 * salesperson / month (revenue = the job's live bills in ₹ without Rule 33 recoveries; cost = bills tagged to the job,
 * taxable value, without disbursements on the client's behalf — the recoveries sit outside both, LG11) and disbursements
 * ageing (unrecovered, oldest first: 0–30 / 31–60 / 61–90 / 90+ days). The deposits position is C's customs view.
 * Agent balances come from `lg-agents.ts`. The TDS-on-receipts view was cut (PRD §3 cut 3). Working papers — verify
 * with your CA (LG11, LG34).
 */
import { round2 } from '../invoice-calc';
import type { InvoiceRecord } from '../../types/invoice';
import type {} from '../../types/trade-r8';
import type { PurchaseRecord } from '../../types/purchases';
import type { LgJob } from '../../types/logistics-r19';
import { liveBills } from './lg-doc';
import { recoveredByJob } from './lg-alerts';

export const MARGIN_BY = ['lane', 'client', 'salesperson', 'month'] as const;
export type MarginBy = (typeof MARGIN_BY)[number];
export interface MarginRow { key: string; jobs: number; revenue: number; cost: number; margin: number; pct: number }

const line = (i: InvoiceRecord) => i.items.filter((x) => x.charge_head_id !== 'rule33').reduce((s, x) => s + x.quantity * x.rate * (1 - (x.discount_percent ?? 0) / 100), 0) * (i.currency && i.currency !== 'INR' ? i.exchange_rate ?? 0 : 1);

/** Revenue and cost per job id. */
export function jobPnl(invoices: readonly InvoiceRecord[], purchases: readonly PurchaseRecord[]): Map<string, { revenue: number; cost: number }> {
  const m = new Map<string, { revenue: number; cost: number }>();
  const at = (id: string) => m.get(id) ?? (m.set(id, { revenue: 0, cost: 0 }), m.get(id)!);
  for (const i of liveBills(invoices)) if (i.lg?.job_id) at(i.lg.job_id).revenue = round2(at(i.lg.job_id).revenue + line(i));
  for (const p of purchases) if (p.lg?.job_id && !p.lg.on_behalf && p.status !== 'draft') at(p.lg.job_id).cost = round2(at(p.lg.job_id).cost + p.taxable);
  return m;
}

export function marginBy(by: MarginBy, jobs: readonly LgJob[], pnl: ReadonlyMap<string, { revenue: number; cost: number }>, clientName: (id: string) => string): MarginRow[] {
  const key = (j: LgJob) => (by === 'lane' ? `${j.origin} → ${j.destination}` : by === 'client' ? clientName(j.client_id) : by === 'salesperson' ? j.salesperson || '—' : j.date.slice(0, 7));
  const rows = new Map<string, MarginRow>();
  for (const j of jobs) {
    const p = pnl.get(j.id) ?? { revenue: 0, cost: 0 }, k = key(j), r = rows.get(k) ?? { key: k, jobs: 0, revenue: 0, cost: 0, margin: 0, pct: 0 };
    r.jobs++; r.revenue = round2(r.revenue + p.revenue); r.cost = round2(r.cost + p.cost); r.margin = round2(r.revenue - r.cost); r.pct = r.revenue ? round2((r.margin / r.revenue) * 100) : 0;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => b.margin - a.margin);
}

const age = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
/** Unrecovered disbursements per job by age (recoveries settle the oldest first). */
export function disbAgeing(jobs: readonly LgJob[], invoices: readonly InvoiceRecord[], purchases: readonly PurchaseRecord[], today: string): { job: string; b: [number, number, number, number]; total: number }[] {
  const rec = recoveredByJob(invoices);
  return jobs.flatMap((j) => {
    let left = rec.get(j.id) ?? 0;
    const b: [number, number, number, number] = [0, 0, 0, 0];
    for (const p of purchases.filter((x) => x.lg?.on_behalf && x.lg.job_id === j.id).sort((x, y) => x.date.localeCompare(y.date))) {
      const open = round2(p.total - Math.min(left, p.total));
      left = round2(Math.max(0, left - p.total));
      const d = age(p.date, today), k = d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3;
      b[k] = round2(b[k] + open);
    }
    const total = round2(b[0] + b[1] + b[2] + b[3]);
    return total > 0.004 ? [{ job: j.number, b, total }] : [];
  });
}
