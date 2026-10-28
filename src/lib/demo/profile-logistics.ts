/**
 * R19 sample rows of the logistics profile (Demo company only, R6-B4). Dispatched by the Demo company's pack
 * `logistics`; one block per package (§6 of docs/prd/round-19.md). Pure: the job goes through `DemoExtras.tables`; the charge heads are returned as `logisticsSettings` and written by `fillDemo` (only while the
 * Demo company is open, only when absent). The job's client is the dataset's first client (a profile adds no clients).
 */
import type { DemoExtras } from '../demo-data';
import type { LgJob, LogisticsSettings } from '../../types/logistics-r19';
import { getIndianFY } from '../invoice-number';
import { defaultHeads } from '../logistics/lg-heads';
import type { ProfileContext } from './profiles';

export function logisticsExtras(ctx: ProfileContext): DemoExtras & { logisticsSettings: LogisticsSettings } {
  const { today, base } = ctx;
  // R19-A: "Demo Seabird Logistics" — job 0001 (export, air, BOM → SIN, 5 cartons 120 × 100 × 50 cm → 500 kg chargeable); D adds the agent.
  const job: LgJob = { id: 'demo-lg-job-1', number: `JOB/FY${getIndianFY(today).label}/0001`, date: today, status: 'booked', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: base.clients[0]?.id ?? '', refs: {}, gross_kg: 480, chargeable_kg: 500, dims: [{ l: 120, w: 100, h: 50, n: 5 }], updated_at: today, demo: true };
  const heads = defaultHeads(today).map((h) => (h.kind === 'freight_air' ? { ...h, rate: 2 } : h));
  // R19-C: import job 0002 (sea FCL, 1 × 40HC, NSA → BOM) with the bill of entry; its deposit and duty disbursement are typed on the Customs view.
  const imp: LgJob = { id: 'demo-lg-job-2', number: `JOB/FY${getIndianFY(today).label}/0002`, date: today, status: 'arrived', dir: 'import', mode: 'sea_fcl', origin: 'NSA', destination: 'BOM', client_id: base.clients[0]?.id ?? '', refs: { boe_no: '7654321', boe_date: today }, containers: [{ no: 'MSCU1234566', size: '40HC' }], auth: { ref: 'Authorisation letter', date: today }, updated_at: today, demo: true };
  return { tables: { lg_jobs: [job, imp] as never[] }, logisticsSettings: { heads } };
}
