/**
 * R19-B3 bridge to the books: supplier bills tagged to jobs read through the shared `readPurchase` /
 * `readPurchaseLines` (Critical Rule 9; `tests/purchase-contract.test.ts`), documents converted to rupees by `fx.ts`
 * and pure-agent recoveries measured by `trade/pure-agent.ts` `recoveryValue` — then the pure job P&L (`lg-costing.ts`).
 * Reads only; the accrual journals were cut (PRD §3 cut 2). Working papers — verify with your CA (LG34).
 */
import type { PurchaseRecord } from '../../types/purchases';
import type { LgJob } from '../../types/logistics-r19';
import { getTable } from '../storage';
import { localDb } from '../localDb';
import { inrValue } from '../fx';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { recoveryValue } from '../trade/pure-agent';
import { pnlRows, type CostBill, type JobPnl } from './lg-costing';

/** The bills tagged to a job, as the costing reads them. */
export function costBills(raw: readonly unknown[]): CostBill[] {
  const out: CostBill[] = [];
  for (const r of raw) {
    const lg = (r as PurchaseRecord | null)?.lg;
    const c = lg ? readPurchase(r) : null;
    if (c) out.push({ id: c.id, taxable: c.taxable, tax: c.tax, itc: c.itcEligible, void: isVoidStatus(c.status), lg, lines: readPurchaseLines(r).map((l) => ({ id: l.lineId, value: l.quantity * l.unitCost })) });
  }
  return out;
}

/** Every job's P&L from the stored documents and bills. */
export const jobPnls = (jobs: readonly LgJob[], alertPct?: number): JobPnl[] =>
  pnlRows(jobs, localDb.invoices.getAll(), costBills(getTable('purchases')), { inr: inrValue, recovery: recoveryValue }, alertPct);
