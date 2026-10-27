/**
 * SV-D3 motor insurance claims on a workshop job, through SV-A5's `payer_claims` (kind `motor`, `CLM/FY…`). The surveyor
 * approves each line's value; the owner pays the **depreciation** on approved parts (by part category; metal by vehicle
 * age — `workshop_settings.depreciation` over `MOTOR_DEPRECIATION_DEFAULTS`, insurer practice, not statute), the
 * compulsory / voluntary **excess** and every line not covered. `motorSplit` turns that into SV-A5's per-line approval,
 * so `splitForPayer` divides each line exactly and the two invoices add up to the job. Cashless → two invoices (insurer
 * in its own name and GSTIN — Circular 217/11/2024); reimbursement → one invoice to the owner unless the insurer is set
 * to `sv_insurer_invoice: 'insurer'` (`claimSplits` in sv-estimates). Working papers — verify with your CA (SV22).
 */
import './sv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ServiceJob } from '../../types/retail-r9';
import type { DepreciationRow, PayerClaim, SvClaimPart, WorkshopSettings } from '../../types/services-r10';
import { ruleAt } from '../tax-rules';
import { MOTOR_DEPRECIATION_DEFAULTS } from '../service-rules';
import { num, round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { billClaim, claimOutstanding, saveClaim, type SplitApproval } from './sv-claims';
import { loadJobs } from '../retail/rt-service-jobs';
import { patchJob } from './sv-jobs-workshop';

export type PartCategory = DepreciationRow['category'];
export const PART_CATEGORIES: readonly PartCategory[] = ['metal', 'plastic', 'rubber', 'fibre', 'glass', 'paint', 'other'];

/** Depreciation % on an approved part (the user's table first, then the defaults). */
export function depreciationPct(cat: PartCategory, ageMonths: number, s: Pick<WorkshopSettings, 'depreciation'>, date?: string): number {
  const own = s.depreciation?.find((r) => r.category === cat);
  if (own) return num(own.pct);
  const d = ruleAt(MOTOR_DEPRECIATION_DEFAULTS, date);
  return cat === 'metal' ? (d.metal.find(([m]) => ageMonths <= m)?.[1] ?? 0) : d.pct[cat];
}

export interface MotorApproval {
  /** Surveyor-approved TAXABLE value per line id (absent / 0 = not covered). */
  approved: Readonly<Record<string, number>>;
  /** Part category per line id (parts only). */
  category?: Readonly<Record<string, PartCategory>>;
  /** Compulsory + voluntary excess (taxable value the owner pays). */
  excess?: number;
  ageMonths: number;
}

const value = (l: InvoiceItem) => round2(num(l.quantity) * num(l.rate) * (1 - num(l.discount_percent) / 100));

/** Pure: the per-line approval after depreciation and excess, with why the owner pays each remainder. */
export function motorSplit(lines: readonly InvoiceItem[], a: MotorApproval, s: Pick<WorkshopSettings, 'depreciation'>, date?: string): SplitApproval & { depreciation: number; excess: number } {
  const perLine: Record<string, number> = {};
  const parts: Record<string, SvClaimPart> = {};
  let dep = 0;
  for (const l of lines) {
    const ap = Math.min(value(l), Math.max(0, num(a.approved[l.id])));
    const cat = a.category?.[l.id];
    const d = l.type === 'Product' && cat ? round2((ap * depreciationPct(cat, a.ageMonths, s, date)) / 100) : 0;
    dep = round2(dep + d);
    perLine[l.id] = round2(ap - d);
    parts[l.id] = ap <= 0 ? 'non_covered' : d > 0 ? 'depreciation' : 'disallowed';
  }
  let left = round2(Math.max(0, num(a.excess)));
  const excess = left;
  for (const l of [...lines].sort((x, y) => (x.type === y.type ? 0 : x.type === 'Service' ? -1 : 1))) {
    if (left <= 0) break;
    const take = Math.min(left, perLine[l.id]);
    if (take > 0) {
      perLine[l.id] = round2(perLine[l.id] - take);
      left = round2(left - take);
      if (parts[l.id] !== 'depreciation') parts[l.id] = 'excess';
    }
  }
  return { perLine, parts, depreciation: dep, excess: round2(excess - left) };
}

export type MotorClaimInput = Pick<PayerClaim, 'date' | 'payer_id' | 'payer_name' | 'policy_no' | 'claim_no' | 'surveyor' | 'survey_date' | 'mode' | 'estimate' | 'approved' | 'salvage'>;

/** Job → *Insurance claim*: a `payer_claims` row (kind motor) linked both ways. */
export function openMotorClaim(job: ServiceJob, i: MotorClaimInput): PayerClaim {
  if (job.claim_id) throw new Error(`${job.number} already has a claim.`);
  const c = saveClaim({ ...i, kind: 'motor', beneficiary_id: job.client_id, beneficiary_name: job.customer, reference: i.surveyor, source: { kind: 'job', id: job.id }, status: num(i.approved) > 0 ? 'approved' : i.survey_date ? 'survey' : 'intimated', notes: i.salvage ? `Salvage: ${i.salvage}` : undefined });
  patchJob(job.id, { claim_id: c.id }, true);
  return c;
}

/** Split the job's draft bill: per line (`motor`) or per head (`approved` total incl. GST, SV25). */
export function billMotorClaim(jobId: string, a: { motor?: MotorApproval; approved?: number }, s: Pick<WorkshopSettings, 'depreciation'>, date: string): { payer?: InvoiceRecord; beneficiary?: InvoiceRecord } {
  const job = loadJobs().find((j) => j.id === jobId);
  const bill = job?.invoice_id ? localDb.invoices.getById(job.invoice_id) : undefined;
  if (!job?.claim_id || !bill) throw new Error('Bill the job first (a draft), then split it.');
  const split: SplitApproval = a.motor ? motorSplit(bill.items, a.motor, s, date) : { approved: num(a.approved), total: num(bill.total) };
  return billClaim(job.claim_id, bill.items, split, date, bill);
}

/** Claims desk counts: survey pending, approval pending, delivered but unpaid, short-paid. */
export function motorBuckets(claims: readonly PayerClaim[], jobs: readonly Pick<ServiceJob, 'claim_id' | 'status'>[], invoices: readonly InvoiceRecord[], today: string): { survey: number; approval: number; unpaid: number; short: number } {
  const m = claims.filter((c) => c.kind === 'motor');
  const delivered = new Set(jobs.filter((j) => j.status === 'delivered').map((j) => j.claim_id));
  return {
    survey: m.filter((c) => c.status === 'intimated').length,
    approval: m.filter((c) => c.status === 'survey').length,
    unpaid: m.filter((c) => delivered.has(c.id) && claimOutstanding(c, invoices, today).due > 0).length,
    short: m.filter((c) => c.status === 'short_paid').length,
  };
}
