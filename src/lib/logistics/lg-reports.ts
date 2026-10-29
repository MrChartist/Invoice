/**
 * R19-D4 disbursements ageing by job (pure; family `f-logistics`; CSV from the Reports view): C's unrecovered
 * disbursements (`lg-disb.ts` `unrecovered`) in C's buckets (`ageBuckets`: 0–30 / 31–60 / 61–90 / 90+ days), one row
 * per job. The margin rows come from B's job costing (`lg-books-io.ts` `jobPnls` → `lg-costing.ts` `groupPnl`), agent
 * balances from `lg-agents.ts`; the deposits position is C's customs view; the TDS-on-receipts view was cut (PRD §3
 * cut 3). Working papers — verify with your CA (LG11).
 */
import type { LgJob } from '../../types/logistics-r19';
import { ageBuckets, sumOf, unrecovered, type LgDisbRow } from './lg-disb';

export function disbAgeing(jobs: readonly LgJob[], rows: readonly LgDisbRow[]): { job: string; b: number[]; total: number }[] {
  const open = unrecovered(rows);
  return jobs.flatMap((j) => {
    const mine = open.filter((r) => r.job_id === j.id), total = sumOf(mine);
    return total > 0.004 ? [{ job: j.number, b: ageBuckets(mine), total }] : [];
  });
}
