/**
 * SV-D2 estimates, approvals and the job bill. An estimate is an ordinary QUOTATION (record `sv.job`) linked to the job
 * (`quote_ids`); supplementary estimates are further quotations. Each approval is logged on the job (who, how, when).
 * *Bill job* puts the lines of every approved estimate on ONE invoice: parts at their own HSN / rate, labour (hours × rate
 * per vehicle class, SAC by asset kind, 18%) and sublet work (cost + markup) as separate lines — separately priced,
 * separate supplies (SV20). Covered labour on an AMC job is not charged; parts are. Parts still issued to the job go
 * back to main first (`settleForBill`), the job's advance is adjusted, and the asset gets its next service. A job with a
 * claim that needs two invoices is billed as a DRAFT for the claims desk to split (SV-A5 / SV-D3).
 * Working papers — verify with your CA (SV20, SV21, SV23, SV24).
 */
import './sv-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ServiceJob } from '../../types/retail-r9';
import type { JobApproval, LabourOp, ServiceAsset, VehicleClass, WorkshopSettings } from '../../types/services-r10';
import { ruleAt } from '../tax-rules';
import { REPAIR_SAC_RULES } from '../service-rules';
import { num, round2 } from '../invoice-calc';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { blankClient, blankItem, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { addMonthsIso } from '../amc';
import { applyAdvance, advanceBalance, invoiceOpen, loadAdvances } from '../advances';
import { jobLines, loadJobs } from '../retail/rt-service-jobs';
import { patchJob } from './sv-jobs-workshop';
import { loadAssets, readWorkshopSettings, saveAsset } from './sv-assets';
import { settleForBill } from './sv-parts-issue';
import { nextService } from './sv-reminders';
import { loadClaims } from './sv-claims';
import { loadLabourOps } from './sv-labour';

const DOC_LINKS_TABLE = 'doc_links';

/** SAC of repair labour by asset kind on a date (an op's own SAC wins). */
export const repairSac = (kind: 'vehicle' | 'appliance' | string, date?: string): string => {
  const r = ruleAt(REPAIR_SAC_RULES, date);
  return kind === 'vehicle' ? r.vehicle : kind === 'appliance' ? r.appliance : r.other;
};

/** Hours of an op for a class (`all` as the fallback) and the hourly rate for the class. */
export const opHours = (op: Pick<LabourOp, 'hours'>, cls?: VehicleClass): number => num(op.hours?.[cls ?? 'all'] ?? op.hours?.all);
export const labourRate = (s: Pick<WorkshopSettings, 'labour_rate'>, cls?: VehicleClass): number => num(s.labour_rate?.[cls ?? 'all'] ?? s.labour_rate?.all);

const line = (p: Partial<InvoiceItem>): InvoiceItem => {
  const l = { ...blankItem(18), ...p };
  return { ...l, amount: round2(num(l.quantity) * num(l.rate)) };
};

/** A labour line: hours × class rate (unit HRS), or the op's flat price; 18%, SAC by asset kind. */
export function labourLine(op: LabourOp, ctx: { cls?: VehicleClass; kind: string; settings: WorkshopSettings; date?: string; staffId?: string }): InvoiceItem {
  const flat = num(op.price) > 0;
  return line({ name: op.name, description: op.code, type: 'Service', hsn: op.sac || repairSac(ctx.kind, ctx.date), unit: flat ? 'NOS' : 'HRS', quantity: flat ? 1 : opHours(op, ctx.cls), rate: flat ? num(op.price) : labourRate(ctx.settings, ctx.cls), sv: { labour_op_id: op.id, ...(ctx.staffId ? { staff_id: ctx.staffId } : {}) } });
}

/** A part / consumable line from a stock item (its own HSN and rate). */
export const partLine = (it: { name: string; hsn?: string; tax_rate?: number; sale_rate?: number; unit?: string }, qty: number, rate?: number): InvoiceItem =>
  line({ name: it.name, type: 'Product', hsn: it.hsn ?? '', unit: it.unit || 'NOS', quantity: num(qty), rate: num(rate ?? it.sale_rate), tax_rate: num(it.tax_rate) });

/** Sublet / outside work re-billed at cost + markup (part of our supply at the labour SAC; SV24). */
export const subletLine = (what: string, cost: number, markupPct: number, kind: string, date?: string): InvoiceItem =>
  line({ name: `Outside work: ${what}`, type: 'Service', hsn: repairSac(kind, date), quantity: 1, rate: round2(num(cost) * (1 + num(markupPct) / 100)) });

const recordOf = (job: ServiceJob, asset: ServiceAsset | undefined) => ({ id: job.id, number: job.number, ...(asset?.reg_no || asset?.serial ? { asset: asset.reg_no || asset.serial } : {}), ...(job.odometer_in ? { odometer: job.odometer_in } : {}) });

function draft(job: ServiceJob, items: InvoiceItem[], date: string, docType: 'QUOTATION' | 'INVOICE'): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = { ...makeDraft({ settings, sender, docType, templateId: localDb.template.get() }), issue_date: date };
  const client = (job.client_id ? localDb.clients.getById(job.client_id) : undefined) ?? { ...blankClient(), name: job.customer, phone: job.phone ?? '' };
  const asset = loadAssets().find((a) => a.id === job.asset_id);
  return { ...buildBillDraft(base, client, items, sender), sv: { job: recordOf(job, asset) }, notes: `Job ${job.number}${asset ? ` · ${[asset.reg_no || asset.serial, asset.make, asset.model].filter(Boolean).join(' ')}` : ''}${job.odometer_in ? ` · ${job.odometer_in} km` : ''}` };
}

/** Save an estimate (a QUOTATION, status Sent) for the job; the job moves on to *estimate sent* when it can. */
export function makeEstimate(jobId: string, items: InvoiceItem[], date: string): InvoiceRecord {
  requireAccess('doc.create');
  const job = loadJobs().find((j) => j.id === jobId);
  if (!job) throw new Error('Job card not found.');
  if (!items.length) throw new Error('Add parts or labour.');
  return withTablesRollback(['invoices', 'series_counters', 'service_jobs'], () => {
    const q = localDb.invoices.save({ ...draft(job, items, date, 'QUOTATION'), status: 'Sent' });
    patchJob(job.id, { quote_ids: [...(job.quote_ids ?? []), q.id], ...(job.status === 'diagnosed' ? { status: 'estimate_sent' as const, history: [...job.history, { status: 'estimate_sent' as const, date }] } : {}) });
    return q;
  });
}

/** Log an approval of one of the job's estimates (signature / phone / WhatsApp / in person). */
export function approveEstimate(jobId: string, a: Omit<JobApproval, 'at'> & { at?: string }): ServiceJob {
  const job = loadJobs().find((j) => j.id === jobId);
  if (!job?.quote_ids?.includes(a.quote_id)) throw new Error('Pick an estimate of this job.');
  if (!a.by.trim()) throw new Error('Who approved it?');
  const next = patchJob(jobId, { approvals: [...(job.approvals ?? []), { ...a, by: a.by.trim(), at: a.at ?? new Date().toISOString() }] });
  try { localDb.invoices.setQuoteStatus(a.quote_id, 'Accepted'); } catch { /* a locked quote keeps its status */ }
  return next;
}

/** Bill lines of a job: the approved estimates' lines (fresh ids); AMC-covered labour dropped. RT-D4 lines otherwise. */
export function billLinesOf(job: ServiceJob, invoices: readonly InvoiceRecord[], date: string): InvoiceItem[] {
  const ok = new Set((job.approvals ?? []).map((a) => a.quote_id));
  const quoted = invoices.filter((i) => ok.has(i.id) && i.status !== 'Cancelled').flatMap((q) => q.items.map((l) => ({ ...l, id: generateId() })));
  const lines = quoted.length ? quoted : jobLines(job, date);
  return job.amc_id ? lines.filter((l) => l.type === 'Product') : lines;
}

/** True when the job's claim is billed in two parts (cashless, or an insurer that wants its own invoice). */
export function claimSplits(job: Pick<ServiceJob, 'claim_id'>): boolean {
  const c = job.claim_id ? loadClaims().find((x) => x.id === job.claim_id) : undefined;
  if (!c || c.status === 'rejected') return false;
  return c.mode !== 'reimbursement' || (c.payer_id ? localDb.clients.getById(c.payer_id)?.sv_insurer_invoice === 'insurer' : false);
}

/** Bill the job (see the module note). Returns the invoice (a draft when the claims desk splits it). */
export function billWorkshopJob(jobId: string, date: string): InvoiceRecord {
  requireAccess('doc.create');
  const job = loadJobs().find((j) => j.id === jobId);
  if (!job) throw new Error('Job card not found.');
  if (job.invoice_id || job.billed_on) throw new Error(`${job.number} is already billed.`);
  const items = billLinesOf(job, getTable<InvoiceRecord>('invoices'), date);
  if (!items.length) throw new Error('Nothing to bill: log an estimate approval, or add parts / labour.');
  const settings = readWorkshopSettings();
  const split = claimSplits(job);
  const claim = job.claim_id ? loadClaims().find((x) => x.id === job.claim_id) : undefined;
  const warranty = num(settings.parts_warranty_months) > 0 && items.some((l) => l.type === 'Product') ? `Parts warranty until ${addMonthsIso(date, num(settings.parts_warranty_months))}.` : '';
  return withTablesRollback(['invoices', 'series_counters', 'service_jobs', 'stock_transfers', 'doc_links', 'service_assets', 'transactions', 'advances'], () => {
    settleForBill(job, date);
    const d = draft(job, items, date, 'INVOICE');
    const notes = [d.notes, job.amc_id && 'AMC visit: covered labour not charged.', !split && claim && `Claim with ${claim.payer_name}${claim.claim_no ? ` (claim no. ${claim.claim_no})` : ''}: for the owner's information.`, warranty].filter(Boolean).join('\n');
    let saved = localDb.invoices.save({ ...d, notes, status: split ? 'Draft' : 'Sent' });
    if (!split && job.advance_id) {
      const adv = loadAdvances().find((a) => a.id === job.advance_id);
      const amt = adv ? round2(Math.min(advanceBalance(adv, localDb.payments.getAll(), localDb.invoices.getAll()).open, invoiceOpen(saved))) : 0;
      if (adv && amt > 0) applyAdvance({ advanceId: adv.id, invoiceId: saved.id, amount: amt, date: date >= adv.date ? date : adv.date });
      saved = localDb.invoices.getById(saved.id) ?? saved;
    }
    const at = new Date().toISOString();
    setTable(DOC_LINKS_TABLE, [...getTable(DOC_LINKS_TABLE), ...(job.approvals ?? []).map((a) => a.quote_id).filter((q, i, all) => all.indexOf(q) === i).map((q) => ({ id: generateId(), from_id: q, to_id: saved.id, relation: 'converted', created_at: at }))]);
    patchJob(job.id, { invoice_id: saved.id, invoice_number: saved.invoice_number, billed_on: date });
    const asset = loadAssets().find((a) => a.id === job.asset_id);
    if (asset) {
      const opIds = new Set(items.map((l) => l.sv?.labour_op_id).filter(Boolean));
      const n = nextService(asset, loadLabourOps().filter((o) => opIds.has(o.id)), settings, date);
      if (n.date || n.km) saveAsset({ ...asset, ...(n.date ? { next_service_date: n.date } : {}), ...(n.km ? { next_service_km: n.km } : {}) });
    }
    return saved;
  });
}

