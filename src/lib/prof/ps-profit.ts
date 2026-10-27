/**
 * PS-A4 profitability per matter / client / engagement over a period: fees billed (fee notes issued in the period, their
 * time and fee lines) − staff cost (hours of time dated in the period × the timekeeper's cost rate on the day) −
 * unrecovered costs (re-billable costs written off in the period) = contribution, and the margin %. Cost rates are
 * management data and never print. Pure.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { ServiceStaff } from '../../types/services-r10';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { round2 } from '../invoice-calc';
import { rebillCost } from '../timesheets';
import { docBilling } from './ps-writedown';
import { entryCost } from './ps-staff';

export type ProfitDim = 'matter' | 'client' | 'engagement';
export interface ProfitRow { key: string; fees: number; cost: number; unrecovered: number; contribution: number; margin: number | null }

export function profitability(i: {
  from: string; to: string; by: ProfitDim; prefs: TimePrefs;
  invoices: readonly InvoiceRecord[]; entries: readonly TimeEntry[]; costs: readonly PurchaseRecord[]; staff: ReadonlyMap<string, ServiceStaff>;
  /** Engagement of a matter (for `engagement`). */
  engOf?: (matterId: string | undefined) => string | undefined;
}): ProfitRow[] {
  const byId = new Map(i.entries.map((e) => [e.id, e]));
  const key = (cc: string | undefined, client: string | undefined) => (i.by === 'matter' ? cc ?? '' : i.by === 'engagement' ? i.engOf?.(cc) ?? '' : client ?? '');
  const map = new Map<string, ProfitRow>();
  const row = (k: string) => {
    const r = map.get(k) ?? { key: k, fees: 0, cost: 0, unrecovered: 0, contribution: 0, margin: null };
    map.set(k, r);
    return r;
  };
  const inP = (d: string | undefined) => !!d && d >= i.from && d <= i.to;
  for (const inv of i.invoices) {
    if (!inP(inv.issue_date)) continue;
    const b = docBilling(inv, byId, i.prefs);
    if (!b) continue;
    if (!b.entries.length) { row(i.by === 'engagement' ? inv.ps?.engagement?.id ?? '' : i.by === 'matter' ? inv.ps?.matter?.id ?? inv.cost_centre_id ?? '' : inv.client?.id ?? '').fees += b.billed; continue; }
    for (const s of b.entries) { const e = byId.get(s.id)!; row(key(e.cost_centre_id, e.client_id || e.client_name)).fees += s.billed; }
  }
  for (const e of i.entries) if (inP(e.date)) row(key(e.cost_centre_id, e.client_id || e.client_name)).cost += entryCost(e, i.staff);
  for (const p of i.costs) if (p.ps?.wo && inP(p.ps.wo.date)) row(key(p.cost_centre_id, p.billable_to_client_id)).unrecovered += rebillCost(p);
  return [...map.values()].map((r) => {
    const fees = round2(r.fees);
    const contribution = round2(fees - r.cost - r.unrecovered);
    return { ...r, fees, cost: round2(r.cost), unrecovered: round2(r.unrecovered), contribution, margin: fees > 0 ? round2((contribution / fees) * 100) : null };
  }).sort((a, b) => a.contribution - b.contribution);
}
