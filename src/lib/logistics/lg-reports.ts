/**
 * R19-D4 disbursements ageing (pure; family `f-logistics`; CSV from the Reports view): unrecovered on-behalf bills per
 * job, recoveries settling the oldest first, 0–30 / 31–60 / 61–90 / 90+ days. The margin rows come from B's job costing
 * (`lg-books-io.ts` `jobPnls` → `lg-costing.ts` `groupPnl`), agent balances from `lg-agents.ts`; the deposits position
 * is C's customs view; the TDS-on-receipts view was cut (PRD §3 cut 3). Working papers — verify with your CA (LG11).
 */
import { round2 } from '../invoice-calc';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { LgJob } from '../../types/logistics-r19';
import { recoveredByJob } from './lg-alerts';

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
