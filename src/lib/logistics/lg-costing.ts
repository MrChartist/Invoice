/**
 * R19-B3 job costing (pure; family `f-logistics`): revenue = the taxable value of the job's live documents in rupees
 * (credit notes subtract; financial credit notes are left out), without pure-agent recoveries (Rule 33 — outside both
 * sides, LG10 / LG11); cost = the taxable value of the supplier bills tagged to the job (`PurchaseRecord.lg.job_id`, or
 * by line `lg.lines`), with GST that is not taken as credit, never a disbursement on the client's behalf (C1); margin
 * and %. Flags: unbilled (delivered / closed, no live document), uncosted (billed, no cost), below the margin alert.
 * Margins by client / lane / salesperson / month. Bills come in already read (`lg-books-io.ts` → `readPurchase`);
 * money crosses currencies through the callers' `inr`. The accrual journals (PRD §3 cut 2) are not built.
 * Working papers — verify with your CA (LG34).
 */
import { round2 } from '../invoice-calc';
import type { InvoiceRecord } from '../../types/invoice';
import type { LgJob } from '../../types/logistics-r19';

/** One bill as the costing reads it (from `readPurchase` / `readPurchaseLines`). */
export interface CostBill { id: string; taxable: number; tax: number; itc: boolean; void: boolean; lg?: { job_id?: string; lines?: Record<string, string>; on_behalf?: boolean }; lines: { id: string; value: number }[] }

/** A bill's cost by job (₹): taxable + GST not taken as credit, spread over the jobs its lines name. */
export function costAlloc(b: CostBill): Map<string, number> {
  const out = new Map<string, number>();
  if (b.void || !b.lg || b.lg.on_behalf) return out;
  const cost = b.taxable + (b.itc ? 0 : b.tax);
  const map = b.lg.lines ?? {};
  const sum = b.lines.reduce((s, l) => s + l.value, 0);
  let left = cost;
  if (sum > 0) for (const l of b.lines) {
    const job = map[l.id];
    if (!job || job === b.lg.job_id) continue;
    const part = round2((cost * l.value) / sum);
    out.set(job, round2((out.get(job) ?? 0) + part));
    left -= part;
  }
  if (b.lg.job_id && round2(left)) out.set(b.lg.job_id, round2((out.get(b.lg.job_id) ?? 0) + left));
  return out;
}

export interface PnlFns {
  /** ₹ value of an amount on a document (its exchange rate). */
  inr: (amount: number, d: InvoiceRecord) => number;
  /** The document's pure-agent recoveries (Rule 33), in its currency. */
  recovery: (d: InvoiceRecord) => number;
}
export interface JobPnl { job: LgJob; revenue: number; cost: number; margin: number; pct: number | null; docs: number; unbilled: boolean; uncosted: boolean; low: boolean }

/** Every job's P&L: documents and bills are indexed by job once (a job reads only its own). */
export function pnlRows(jobs: readonly LgJob[], docs: readonly InvoiceRecord[], bills: readonly CostBill[], f: PnlFns, alertPct?: number): JobPnl[] {
  const rev = new Map<string, { v: number; n: number }>();
  for (const d of docs) {
    const id = d.lg?.job_id;
    if (!id || d.status === 'Cancelled' || d.note_kind === 'financial') continue;
    const sign = d.doc_type === 'CREDIT_NOTE' ? -1 : 1;
    const r = rev.get(id) ?? { v: 0, n: 0 };
    r.v += sign * (f.inr(Number(d.taxable_value) || 0, d) - f.inr(f.recovery(d), d));
    r.n += sign > 0 ? 1 : 0;
    rev.set(id, r);
  }
  const cost = new Map<string, number>();
  for (const b of bills) for (const [id, v] of costAlloc(b)) cost.set(id, (cost.get(id) ?? 0) + v);
  return jobs.map((job) => {
    const r = rev.get(job.id), c = round2(cost.get(job.id) ?? 0), revenue = round2(r?.v ?? 0), margin = round2(revenue - c);
    const pct = revenue ? Math.round((margin / revenue) * 1000) / 10 : null;
    return { job, revenue, cost: c, margin, pct, docs: r?.n ?? 0, unbilled: !r?.n && (job.status === 'delivered' || job.status === 'closed'), uncosted: !!r?.n && !c, low: alertPct !== undefined && pct !== null && pct < alertPct };
  });
}

export type PnlBy = 'client' | 'lane' | 'salesperson' | 'month';
const keyOf = (j: LgJob, by: PnlBy) => (by === 'client' ? j.client_id : by === 'lane' ? `${j.origin} → ${j.destination}` : by === 'month' ? j.date.slice(0, 7) : j.salesperson ?? '');

/** Margins grouped by client / lane / salesperson / month, largest revenue first. */
export function groupPnl(rows: readonly JobPnl[], by: PnlBy): { key: string; jobs: number; revenue: number; cost: number; margin: number; pct: number | null }[] {
  const m = new Map<string, { key: string; jobs: number; revenue: number; cost: number }>();
  for (const r of rows) {
    const k = keyOf(r.job, by);
    const g = m.get(k) ?? { key: k, jobs: 0, revenue: 0, cost: 0 };
    g.jobs++; g.revenue = round2(g.revenue + r.revenue); g.cost = round2(g.cost + r.cost);
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, margin: round2(g.revenue - g.cost), pct: g.revenue ? Math.round(((g.revenue - g.cost) / g.revenue) * 1000) / 10 : null })).sort((a, b) => b.revenue - a.revenue);
}
