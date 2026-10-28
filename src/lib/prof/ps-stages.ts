/**
 * R14 PS-B4 architects and interior designers: stage fees on project cost (pure). An engagement with model `milestone`
 * may carry `stage = { fee_pct, cost_basis, revisions, stages, extra_pct?, property }`. A stage bill is
 *   fee % × the project cost on the bill date × (1 + extra %) × the stage's cumulative % − already billed,
 * rounded to the rupee. A cost revision re-prices every later bill (the next stage catches up on earlier ones); a
 * downward revision that makes the next bill negative suggests a credit note for the excess — never automatic.
 * "Already billed" = live stage invoices of the engagement less their credit notes (`progress-billing.ts` helper).
 * The stage template is an editable example (COA scale is recommendatory — PS30). Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PsStagePlan } from '../../types/prof-r14';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { stageCredits, type LinkLike } from '../progress-billing';
import { ruleAt } from '../tax-rules';
import { requireAccess } from '../access';
import { generateId, getTable } from '../storage';
import { localDb } from '../localDb';
import { buildBillDraft } from '../timesheets';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { DESIGN_STAGE_EXAMPLE } from '../prof-rules';
import { propertyPos } from './ps-property-pos';

export interface StageDef {
  id: string;
  label: string;
  /** Cumulative % of the fee due when this stage is done (0–100, rising). */
  cum_pct: number;
}

export type StagePlan = PsStagePlan;

/** The editable example stages (copies; never a rule). */
export const exampleStages = (date?: string): StageDef[] => ruleAt(DESIGN_STAGE_EXAMPLE, date).map((s) => ({ ...s }));

export function validatePlan(p: StagePlan): string {
  if (!(num(p.fee_pct) > 0 && num(p.fee_pct) <= 100)) return 'Type the fee as a % of the project cost.';
  if (!p.revisions.length || p.revisions.some((r) => !(num(r.cost) > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))) return 'Type the project cost and its date.';
  if (!p.stages.length) return 'Add the stages.';
  let prev = 0;
  for (const s of p.stages) {
    if (!(num(s.cum_pct) > prev) || num(s.cum_pct) > 100) return 'Stage percentages are cumulative: each above the last, the last at most 100.';
    prev = num(s.cum_pct);
  }
  return '';
}

/** Project cost in force on `date` (the latest revision on or before it; the first one before any). */
export function costOn(p: Pick<StagePlan, 'revisions'>, date: string): number {
  const rows = [...p.revisions].sort((a, b) => a.date.localeCompare(b.date));
  let cost = num(rows[0]?.cost);
  for (const r of rows) if (r.date <= date) cost = num(r.cost);
  return round2(cost);
}

/** The whole fee on `date`: cost × fee % × (1 + extra %). */
export const feeOn = (p: StagePlan, date: string): number => round2((costOn(p, date) * num(p.fee_pct)) / 100 * (1 + num(p.extra_pct) / 100));

export interface StageBill {
  stage: StageDef;
  cost: number;
  fee: number;
  /** Cumulative fee due to this stage (rounded to the rupee). */
  cumulative: number;
  billed: number;
  /** This bill (≥ 0). */
  amount: number;
  /** A downward revision: the excess billed — suggest a credit note for it. */
  credit: number;
}

/** The bill for stage `stageId` on `date`, given what is already billed on the engagement. */
export function stageBill(p: StagePlan, stageId: string, date: string, billed: number): StageBill {
  const stage = p.stages.find((s) => s.id === stageId);
  if (!stage) throw new Error('Pick the stage.');
  const fee = feeOn(p, date);
  const cumulative = Math.round((fee * num(stage.cum_pct)) / 100);
  const due = round2(cumulative - round2(billed));
  return { stage, cost: costOn(p, date), fee, cumulative, billed: round2(billed), amount: Math.max(due, 0), credit: due < 0 ? -due : 0 };
}

/** Annexure rows: every stage's cumulative fee on `date` (A5 prints them beside the bill). */
export function stageSchedule(p: StagePlan, date: string): { id: string; label: string; cum_pct: number; cumulative: number }[] {
  const fee = feeOn(p, date);
  return p.stages.map((s) => ({ id: s.id, label: s.label, cum_pct: num(s.cum_pct), cumulative: Math.round((fee * num(s.cum_pct)) / 100) }));
}

type BillLike = { id: string; doc_type: string; status?: string; taxable_value?: number; ps?: unknown };
const engOf = (i: BillLike) => (i.ps as { engagement?: { id?: string }; kind?: string } | undefined);
const BILLS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/** Taxable value billed on an engagement's stage bills, less their live credit notes. */
export function billedOnEngagement(engagementId: string, invoices: readonly BillLike[], links: readonly LinkLike[]): number {
  const stages = invoices.filter((i) => BILLS.has(i.doc_type) && i.status !== 'Cancelled' && i.status !== 'Draft' && engOf(i)?.engagement?.id === engagementId);
  const credits = stageCredits(new Set(stages.map((s) => s.id)), invoices as never, links);
  return round2(stages.reduce((s, i) => s + num(i.taxable_value), 0) - credits.reduce((s, c) => s + num(c.taxable_value), 0));
}

/** The `ps.stage` snapshot printed on the fee note (PS-A5 paper): stage n of N, cost, fee %, stage %, billed before. */
export function stageSnap(p: StagePlan, stageId: string, date: string, billedBefore: number): { no: number; of: number; label: string; project_cost: number; fee_pct: number; stage_pct: number; billed_before: number } {
  const k = p.stages.findIndex((s) => s.id === stageId);
  const s = p.stages[k];
  if (!s) throw new Error('Pick the stage.');
  return { no: k + 1, of: p.stages.length, label: s.label, project_cost: costOn(p, date), fee_pct: num(p.fee_pct), stage_pct: num(s.cum_pct), billed_before: round2(billedBefore) };
}

/** The engagement fields a stage bill needs (PS-A's `Engagement` with PS-B's `stage`). */
export interface StageEngagement {
  id: string;
  number: string;
  model: string;
  client_id: string;
  title?: string;
  stage?: StagePlan;
}

/**
 * Raise the draft fee note for stage `stageId` on `date`: one line "Professional fees — stage n of N: label" for this
 * bill, the place of supply from the property (PS6, suggested once — the user may change it on the draft), the `ps`
 * snapshot (`kind: 'stage'`, engagement, stage computation). Refused when nothing is due (a downward revision suggests a
 * credit note instead — never raised automatically).
 */
export function createStageBill(e: StageEngagement, stageId: string, date: string, opts: { sac?: string; gstRate?: number } = {}): InvoiceRecord {
  requireAccess('doc.create');
  const plan = e.stage;
  if (!plan) throw new Error('Set up the stage plan first.');
  const err = validatePlan(plan);
  if (err) throw new Error(err);
  const client = localDb.clients.getById(e.client_id);
  if (!client) throw new Error('The client of this engagement is no longer in your client list.');
  const billed = billedOnEngagement(e.id, localDb.invoices.getAll() as never, getTable<LinkLike>('doc_links'));
  const b = stageBill(plan, stageId, date, billed);
  if (b.credit > 0) throw new Error(`The revised cost makes ₹${b.credit} already billed too much: raise a credit note for it.`);
  if (!(b.amount > 0)) throw new Error('Nothing is due for this stage.');
  const snap = stageSnap(plan, stageId, date, billed);
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const item = { id: generateId(), type: 'Service', name: `Professional fees — stage ${snap.no} of ${snap.of}: ${snap.label}`, description: `${num(plan.fee_pct)}% of project cost ₹${snap.project_cost} × ${snap.stage_pct}% cumulative, less ₹${snap.billed_before} billed`, hsn: opts.sac ?? '998321', unit: 'OTH', quantity: 1, rate: b.amount, tax_rate: opts.gstRate ?? 18, discount_percent: 0, amount: b.amount };
  let rec = buildBillDraft({ ...base, id: generateId(), issue_date: date }, client, [item], sender);
  const pos = propertyPos(plan.property, client).pos;
  if (pos && pos !== rec.place_of_supply) {
    const gst_mode = deriveGstMode({ senderStateCode: senderStateCode(sender), placeOfSupply: pos, senderHasGstin: Boolean(sender?.companyGstin?.trim()), taxEnabled: true });
    const t = calculateInvoice(calcInputFromRecord({ ...rec, place_of_supply: pos, gst_mode }));
    rec = { ...rec, place_of_supply: pos, gst_mode, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due };
  }
  // QA17 R6: the property's place of supply also feeds PS-C's Sec 2(6) check (13(4)): a foreign client's Indian house
  // is not an export, whatever the supply type says.
  const ps = { kind: 'stage', engagement: { id: e.id, number: e.number, model: e.model }, basis: `Stage ${snap.no} of ${snap.of} on project cost`, stage: snap, ...(pos ? { export: { pos_class: 'property' as const, property_state: pos } } : {}), lines: { [item.id]: { stage: `Stage ${snap.no} of ${snap.of} — ${snap.label}` } } };
  rec = { ...rec, ps } as InvoiceRecord;
  rec.invoice_number = localDb.invoices.nextNumber(rec.issue_date, rec.doc_type, sender?.invoicePrefix || undefined);
  return localDb.invoices.save(rec);
}
