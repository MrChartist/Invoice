/**
 * MF-C3 ITC-04 depth (working paper beside `itc04.ts`, which is used read-only):
 *  - job-worker reconciliation: per job worker and challan — sent, consumed, returned, lost / waste (of which scrap kept
 *    or sold by the job worker, Sec 143(5)), supplied from his premises, balance with him, oldest open date and the
 *    Sec 143 clock (`challanBalances`);
 *  - scrap at the job worker: a Material In loss line tagged `mf.scrap_at_jw` settles the challan as a loss / waste, so
 *    ITC-04 reports it once in Table 5A / 5B losses and wastes;
 *  - challans with no movement in the period (nothing to report for them — listed so none looks missing).
 * Quantities in base units. Verify with your CA (MF12).
 */
import type { MaterialIn, MaterialOut } from '../../types/job-work';
import { challanBalances, type ClockStatus } from '../job-work';
import { round2 } from '../invoice-calc';

export interface ReconRow {
  party: string;
  outId: string;
  number: string;
  date: string;
  item_id: string;
  sent: number;
  consumed: number;
  returned: number;
  lost: number;
  scrap: number;
  supplied: number;
  balance: number;
  deadline: string;
  status: ClockStatus;
  /** Settled in the period (what ITC-04 Table 5 reports for this line). */
  inPeriod: number;
}

export interface Itc04Extra {
  rows: ReconRow[];
  byParty: { party: string; sent: number; back: number; balance: number; oldest: string; expired: number }[];
  /** Challan lines open at the period start that nothing settled in the period. */
  idle: ReconRow[];
  /** Quantity settled as scrap at the job worker in the period. */
  scrapInPeriod: number;
}

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

export function itc04Extra(outs: readonly MaterialOut[], ins: readonly MaterialIn[], from: string, to: string): Itc04Extra {
  const b = challanBalances(outs, ins, to);
  const inDate = new Map(ins.map((v) => [v.id, v.date.slice(0, 10)]));
  const per = new Map<string, number>();
  const scrap = new Map<string, number>();
  let scrapInPeriod = 0;
  for (const s of b.settlements) {
    const d = inDate.get(s.inId) ?? '';
    if (s.scrap_at_jw) scrap.set(s.outLineId, (scrap.get(s.outLineId) ?? 0) + s.qty);
    if (d < from || d > to) continue;
    per.set(s.outLineId, (per.get(s.outLineId) ?? 0) + s.qty);
    if (s.scrap_at_jw) scrapInPeriod += s.qty;
  }
  const rows: ReconRow[] = b.lines.filter((l) => l.date <= to).map((l) => ({
    party: l.party, outId: l.outId, number: l.number, date: l.date, item_id: l.item_id, sent: l.sent, consumed: l.consumed, returned: l.returned,
    lost: l.lost, scrap: r3(scrap.get(l.lineId) ?? 0), supplied: l.supplied, balance: l.pending, deadline: l.deadline, status: l.status, inPeriod: r3(per.get(l.lineId) ?? 0),
  }));
  const parties = new Map<string, Itc04Extra['byParty'][number]>();
  for (const r of rows) {
    const p = parties.get(r.party) ?? { party: r.party, sent: 0, back: 0, balance: 0, oldest: '', expired: 0 };
    p.sent = r3(p.sent + r.sent);
    p.back = r3(p.back + r.consumed + r.returned + r.lost + r.supplied);
    p.balance = r3(p.balance + r.balance);
    if (r.balance > 0 && (!p.oldest || r.date < p.oldest)) p.oldest = r.date;
    if (r.status === 'expired') p.expired++;
    parties.set(r.party, p);
  }
  const idle = rows.filter((r) => r.date < from && !r.inPeriod && r.balance > 0);
  return { rows, byParty: [...parties.values()].sort((a, c) => a.party.localeCompare(c.party)), idle, scrapInPeriod: round2(scrapInPeriod) };
}
