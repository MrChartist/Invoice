/**
 * R19 sample rows of the logistics profile (Demo company only, R6-B4). Dispatched by the Demo company's pack
 * `logistics`; one block per package (§6 of docs/prd/round-19.md). Pure: the job and the agent go through
 * `DemoExtras.tables`; the charge heads are returned as `logisticsSettings` and written by `fillDemo` (only while the
 * Demo company is open, only when absent). The job's client is the dataset's first client (a profile adds no clients).
 */
import type { DemoExtras } from '../demo-data';
import type { LgJob, LogisticsSettings } from '../../types/logistics-r19';
import { getIndianFY } from '../invoice-number';
import { defaultHeads } from '../logistics/lg-heads';
import type { ProfileContext } from './profiles';

export function logisticsExtras(ctx: ProfileContext): DemoExtras & { logisticsSettings: LogisticsSettings } {
  const { today, base } = ctx;
  const at = `${today}T09:00:00.000Z`;
  // R19-A: "Demo Seabird Logistics" — job 0001 (export, air, BOM → SIN, 5 cartons 120 × 100 × 50 cm → 500 kg chargeable), an overseas agent.
  const job: LgJob = { id: 'demo-lg-job-1', number: `JOB/FY${getIndianFY(today).label}/0001`, date: today, status: 'booked', dir: 'export', mode: 'air', incoterm: 'FCA', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: base.clients[0]?.id ?? '', refs: { hawb: 'SBL-0001' }, pkgs: 5, gross_kg: 480, chargeable_kg: 500, dims: [{ l: 120, w: 100, h: 50, n: 5 }], updated_at: at, demo: true };
  const agent = { id: 'demo-lg-agent', name: 'Demo Agent Pte Ltd', lg: { kind: 'agent', foreign: true }, created_at: at, demo: true };
  const heads = defaultHeads(today).map((h) => (h.kind === 'freight_air' ? { ...h, rate: 2 } : h));
  return { tables: { lg_jobs: [job] as never[], vendors: [agent] as never[] }, logisticsSettings: { heads, default_currency: 'USD', weight_unit: 'kg' } };
}
