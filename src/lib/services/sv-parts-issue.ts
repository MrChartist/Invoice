/**
 * SV-D2 parts issued to a job before billing: an ordinary stock transfer (`STR/FY…`, quantity only, no value / GST)
 * from the main godown to the `wip`-kind godown "Jobs in progress" (non-saleable), listed on the job (`parts_issue`).
 * Returning unused parts is the reverse transfer; billing moves what is still issued back first, so the sale takes it
 * out of stock exactly once. Company stock totals never change by an issue or a return. Working paper — verify with
 * your CA (SV24).
 */
import './sv-registry';
import type { ServiceJob } from '../../types/retail-r9';
import { MAIN_GODOWN_ID, type Godown, type StockTransfer } from '../../types/stock';
import { godownsDb, transfersDb } from '../godowns';
import { generateId } from '../storage';
import { num, round2 } from '../invoice-calc';
import { loadJobs } from '../retail/rt-service-jobs';
import { patchJob } from './sv-jobs-workshop';

export const WIP_NAME = 'Jobs in progress';

/** The "Jobs in progress" godown (created on first use). */
export function wipGodown(): Godown {
  return godownsDb.list().find((g) => g.kind === 'wip' && g.name === WIP_NAME) ?? godownsDb.save({ name: WIP_NAME, kind: 'wip' });
}

export interface PartQty { item_id: string; qty: number; batch_no?: string }

/** Net quantity per item still sitting in WIP for a job (issues minus returns). */
export function issuedNet(job: Pick<ServiceJob, 'parts_issue'>, transfers: readonly StockTransfer[], wipId: string): Map<string, number> {
  const ids = new Set(job.parts_issue ?? []);
  const out = new Map<string, number>();
  for (const t of transfers) {
    if (!ids.has(t.id)) continue;
    const sign = t.to_godown === wipId ? 1 : t.from_godown === wipId ? -1 : 0;
    for (const l of t.lines) out.set(l.item_id, round2((out.get(l.item_id) ?? 0) + sign * num(l.qty) * (num(l.unit_factor) || 1)));
  }
  return out;
}

function move(job: ServiceJob, lines: readonly PartQty[], date: string, back: boolean, note: string): StockTransfer {
  const wip = wipGodown().id;
  const t = transfersDb.save({ date, from_godown: back ? wip : MAIN_GODOWN_ID, to_godown: back ? MAIN_GODOWN_ID : wip, lines: lines.filter((l) => num(l.qty) > 0).map((l) => ({ id: generateId(), item_id: l.item_id, qty: num(l.qty), ...(l.batch_no ? { batch_no: l.batch_no } : {}) })), notes: `${note}: job ${job.number}` });
  const fresh = loadJobs().find((j) => j.id === job.id) ?? job;
  patchJob(job.id, { parts_issue: [...(fresh.parts_issue ?? []), t.id] }, true);
  return t;
}

/** Issue parts to the job (main → Jobs in progress). */
export const issueParts = (job: ServiceJob, lines: readonly PartQty[], date: string): StockTransfer => move(job, lines, date, false, 'Parts issued');

/** Return unused parts (Jobs in progress → main); never more than is issued. */
export function returnParts(job: ServiceJob, lines: readonly PartQty[], date: string): StockTransfer {
  const net = issuedNet(loadJobs().find((j) => j.id === job.id) ?? job, transfersDb.all(), wipGodown().id);
  const bad = lines.find((l) => num(l.qty) > (net.get(l.item_id) ?? 0) + 1e-9);
  if (bad) throw new Error('Return no more than was issued to the job.');
  return move(job, lines, date, true, 'Parts returned');
}

/** Before billing: move everything still issued back to main (the sale then takes it out). Undefined when nothing is. */
export function settleForBill(job: ServiceJob, date: string): StockTransfer | undefined {
  const fresh = loadJobs().find((j) => j.id === job.id) ?? job;
  if (!fresh.parts_issue?.length) return undefined;
  const lines = [...issuedNet(fresh, transfersDb.all(), wipGodown().id)].filter(([, q]) => q > 0).map(([item_id, qty]) => ({ item_id, qty }));
  return lines.length ? move(job, lines, date, true, 'Billed') : undefined;
}
