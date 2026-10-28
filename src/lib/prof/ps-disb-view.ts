/**
 * R16-B1: the view model of WIP → Disbursements (`/time?tab=wip&view=disb`): unrecovered disbursements filtered by
 * client / matter with the 0–30 / 31–60 / 61–90 / 90+ buckets, and the written-off ones (for Reverse). Pure over the
 * engine of `ps-disb.ts` (purchases are read there through `readPurchase`). Working paper — verify with your CA.
 */
import type { PsWriteOff } from '../../types/prof-r14';
import { round2 } from '../invoice-calc';
import { ageBuckets, psOfPurchase, unrecoveredDisbursements, type DisbRow } from './ps-disb';

export interface DisbFilter { client?: string; matter?: string }

const pass = (r: Pick<DisbRow, 'clientId' | 'matterId'>, f: DisbFilter) => (!f.client || r.clientId === f.client) && (!f.matter || r.matterId === f.matter);

/** The rows that pass the filter, their buckets and total. */
export function disbView(rows: readonly DisbRow[], f: DisbFilter = {}): { rows: DisbRow[]; buckets: number[]; total: number } {
  const list = rows.filter((r) => pass(r, f));
  return { rows: list, buckets: ageBuckets(list), total: round2(list.reduce((s, r) => s + r.amount, 0)) };
}

/** Written-off disbursements (still unbilled), newest write-off first, with the stamp. */
export function writtenOff(purchases: readonly unknown[], billed: (id: string, rebilledIn?: string) => boolean, today: string, f: DisbFilter = {}): (DisbRow & { wo: PsWriteOff })[] {
  const stamps = new Map<string, PsWriteOff>();
  const open = purchases.flatMap((p) => {
    const { wo, ...ps } = psOfPurchase(p);
    if (!wo || !ps.disb) return [];
    stamps.set((p as { id: string }).id, wo as PsWriteOff);
    return [{ ...(p as object), ps }];
  });
  return unrecoveredDisbursements(open, billed, today).filter((r) => pass(r, f)).map((r) => ({ ...r, wo: stamps.get(r.id)! })).sort((a, b) => b.wo.date.localeCompare(a.wo.date));
}
