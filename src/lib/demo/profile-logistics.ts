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
  const job: LgJob = { id: 'demo-lg-job-1', number: `JOB/FY${getIndianFY(today).label}/0001`, date: today, status: 'booked', dir: 'export', mode: 'air', origin: 'BOM', destination: 'SIN', dest_country: 'SG', client_id: base.clients[0]?.id ?? '', refs: {}, gross_kg: 480, chargeable_kg: 500, dims: [{ l: 120, w: 100, h: 50, n: 5 }], updated_at: today, demo: true,
    // R19-B: its charge sheet (Billing → Bill job makes the freight and local-charges documents; type the ₹ rate for USD)
    charges: [['freight_air', 500, 2, 'USD'], ['origin', 1, 5000], ['documentation', 1, 2000], ['clearance', 1, 3500], ['port', 1, 1800]].map(([k, qty, rate, currency = 'INR']) => ({ head_id: `lg-${k}`, qty: +qty, rate: +rate, currency: `${currency}`, amount: +qty * +rate })) };
  const heads = defaultHeads(today).map((h) => (h.kind === 'freight_air' ? { ...h, rate: 2 } : h));
  return { tables: { lg_jobs: [job] as never[] }, logisticsSettings: { heads } };
}
