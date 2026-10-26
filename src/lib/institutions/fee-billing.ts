/**
 * R5-C1 billing run: "Bill instalment" for a plan × instalment (× class) builds one Bill of Supply (exempt / nil
 * heads) and / or one tax invoice (taxable heads) per enrolled student with the R2-B1 batch builder, issues them in
 * ONE batch (numbered in each document's own FY series, period lock / approvals intact) and records a `fee_runs`
 * row. Idempotent per (student, plan, instalment, document kind): a student already billed is skipped. Undo goes
 * through `undoBatch` (drafts deleted, issued documents cancelled with a reason). "Add fine" is a separate small
 * document, never added silently.
 */
import type { Client, DocumentType, InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import type { FeePlan, FeeRun } from '../../types/institutions-r5';
import { buildBatchDrafts, issueBatch, partyKey, undoBatch, type BatchDraft } from '../batch-invoices';
import type { RecurringTemplate } from '../recurring';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { FEE_RUNS_TABLE, R5cError, daysFrom, str } from './r5c';
import { fineDue, instalmentLines, splitByTax, type FeeLine } from './fee-plans';
import { applyConcessions, enrolmentOf, type DiscountedLine } from './enrolments';

export interface FeeContext {
  date: string;
  sender: SenderProfile | null;
  templateId: string;
  roundOff?: boolean;
  newId?: () => string;
}

/**
 * The fee document of a student for (plan, instalment, kind), if one is live (not cancelled, not a fine). A Bill of
 * Supply is matched per `exempt_kind` (QA6 F13), or by holding one of `heads` (one bill made before the split).
 */
export function billedDoc(invoices: readonly InvoiceRecord[], studentId: string, planId: string, idx: number, kind: DocumentType, bos?: { exemptKind: string; heads: readonly string[] }): InvoiceRecord | undefined {
  return invoices.find((i) => i.fee_plan_id === planId && i.fee_instalment === idx && i.client?.id === studentId && i.doc_type === kind && i.status !== 'Cancelled' && !i.late_fee_for
    && (!bos || (i.exempt_kind ?? 'EXEMPT') === bos.exemptKind || (i.items ?? []).some((it) => bos.heads.includes(it?.name))));
}

function lineOf(l: DiscountedLine | FeeLine, id: string): InvoiceItem {
  const d = 'discount' in l ? l.discount : 0;
  const rate = Math.max(l.amount - d, 0);
  return {
    id, name: l.head.name, ...('note' in l && l.note ? { description: l.note } : {}), type: 'Service',
    ...(l.head.sac ? { hsn: l.head.sac } : {}), quantity: 1, rate, tax_rate: l.head.tax === 'taxable' ? Number(l.head.gst_rate) || 0 : 0, amount: rate,
  };
}

function template(kind: DocumentType, client: Client, lines: readonly (DiscountedLine | FeeLine)[], notes: string, ctx: FeeContext, extra: Partial<InvoiceRecord>): RecurringTemplate {
  return {
    doc_type: kind, currency: 'INR', template_id: ctx.templateId, client, sender: ctx.sender,
    items: lines.map((l, n) => lineOf(l, `l${n + 1}`)), gst_mode: kind === 'BILL_OF_SUPPLY' ? 'NONE' : 'CGST_SGST', place_of_supply: '',
    reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: ctx.roundOff !== false, notes, terms: '', ...extra,
  } as RecurringTemplate;
}

export interface FeeRunPlan {
  drafts: BatchDraft[];
  /** Students skipped: already billed for this instalment (both kinds), or nothing to bill. */
  skipped: { student: Client; reason: 'billed' | 'empty' }[];
}

/** Pure: the drafts of one run (no number yet). */
export function planFeeRun(plan: FeePlan, idx: number, students: readonly Client[], invoices: readonly InvoiceRecord[], ctx: FeeContext): FeeRunPlan {
  const inst = plan.instalments[idx];
  if (!inst) throw new R5cError('instalment');
  const dueDays = Math.max(0, daysFrom(ctx.date, inst.due_date));
  const out: FeeRunPlan = { drafts: [], skipped: [] };
  for (const s of students) {
    const e = s.id ? enrolmentOf(s, plan.id) : undefined;
    if (!e || !s.id) continue;
    const lines = applyConcessions(instalmentLines(plan, idx), e.concessions).filter((l) => l.amount - l.discount > 0);
    const { tax, byKind } = splitByTax(lines);
    const notes = [`${plan.name}${plan.year_label ? ` (${plan.year_label})` : ''} — ${inst.label}`, s.roll_no ? `Roll no. ${s.roll_no}` : '', s.class_label ? `Class ${s.class_label}` : ''].filter(Boolean).join(' · ');
    const tag = { fee_plan_id: plan.id, fee_instalment: idx } as Partial<InvoiceRecord>;
    const kinds: [DocumentType, (DiscountedLine | FeeLine)[], Partial<InvoiceRecord>][] = [];
    for (const g of byKind) kinds.push(['BILL_OF_SUPPLY', g.lines as DiscountedLine[], { ...tag, exempt_kind: g.kind }]);
    if (tax.length) kinds.push(['TAX_INVOICE', tax as DiscountedLine[], tag]);
    if (!kinds.length) {
      out.skipped.push({ student: s, reason: 'empty' });
      continue;
    }
    let made = 0;
    for (const [kind, ls, extra] of kinds) {
      const bosKey = kind === 'BILL_OF_SUPPLY' ? { exemptKind: String(extra.exempt_kind), heads: ls.map((l) => l.head.name) } : undefined;
      if (billedDoc(invoices, s.id, plan.id, idx, kind, bosKey)) continue;
      // The receipt's "for" line reads roll no. / class from the document's party snapshot.
      const who = { ...(s.roll_no ? { roll_no: s.roll_no } : {}), ...(s.class_label ? { class_label: s.class_label } : {}) };
      out.drafts.push(...buildBatchDrafts(template(kind, s, ls, notes, ctx, extra), [{ key: partyKey(s), client: s }], { date: ctx.date, dueDays, sender: ctx.sender, newId: ctx.newId }).map((d) => ({ ...d, record: { ...d.record, client: { ...d.record.client, ...who } } })));
      made++;
    }
    if (!made) out.skipped.push({ student: s, reason: 'billed' });
  }
  return out;
}

export const loadFeeRuns = (): FeeRun[] => peekTable<FeeRun>(FEE_RUNS_TABLE).filter((r) => r && r.id) as FeeRun[];

/** Issue the run's drafts in one batch and record the run. All or nothing. */
export function issueFeeRun(plan: FeePlan, idx: number, run: FeeRunPlan, date: string): { run: FeeRun; invoices: InvoiceRecord[]; held: number } {
  requireAccess('doc.create');
  if (!run.drafts.length) throw new R5cError('nothing');
  return withTablesRollback([FEE_RUNS_TABLE], () => {
    const res = issueBatch(run.drafts, { sourceId: `fee:${plan.id}:${idx}`, sourceKind: 'recurring', sourceLabel: `${plan.name} — ${plan.instalments[idx]?.label ?? ''}`, date, mode: 'issue', force: true });
    const row: FeeRun = { id: generateId(), plan_id: plan.id, instalment: idx, date, batch_run_id: res.run.id, student_ids: [...new Set(run.drafts.map((d) => str(d.party.client.id)))] };
    setTable(FEE_RUNS_TABLE, [...getTable<FeeRun>(FEE_RUNS_TABLE), row]);
    return { run: row, invoices: res.invoices, held: res.held.length };
  });
}

/** Undo a run: issued documents are cancelled with `reason` (never deleted); the run is marked undone. */
export function undoFeeRun(runId: string, reason: string): { cancelled: number; removed: number } {
  requireAccess('doc.create');
  const run = loadFeeRuns().find((r) => r.id === runId);
  if (!run || run.undone) throw new R5cError('nothing');
  if (!str(reason)) throw new R5cError('reason');
  return withTablesRollback([FEE_RUNS_TABLE], () => {
    const res = undoBatch(run.batch_run_id, { cancelReason: str(reason) });
    setTable(FEE_RUNS_TABLE, getTable<FeeRun>(FEE_RUNS_TABLE).map((r) => (r.id === runId ? { ...r, undone: true } : r)));
    return { cancelled: res.cancelled, removed: res.removed };
  });
}

/**
 * "Add fine": one small document for a late instalment, on click only. Its tax class follows the plan's main
 * (first per-instalment) head — §7 Q8, verify with your CA. Refused when a fine already exists for that document.
 */
export function addFine(plan: FeePlan, idx: number, student: Client, against: InvoiceRecord, ctx: FeeContext, invoices: readonly InvoiceRecord[]): InvoiceRecord {
  requireAccess('doc.create');
  if (invoices.some((i) => i.late_fee_for === against.id && i.status !== 'Cancelled')) throw new R5cError('fineExists');
  const amount = fineDue(plan.fine, plan.instalments[idx]?.due_date ?? against.due_date, ctx.date);
  if (!(amount > 0)) throw new R5cError('noFine');
  const main = plan.heads.find((h) => h.frequency === 'per_instalment') ?? plan.heads[0];
  const head = { ...main, name: `Late fee — ${plan.instalments[idx]?.label ?? ''}`.trim(), amount, frequency: 'once' as const };
  const kind: DocumentType = head.tax === 'taxable' ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY';
  const extra: Partial<InvoiceRecord> = { fee_plan_id: plan.id, fee_instalment: idx, late_fee_for: against.id, ...(kind === 'BILL_OF_SUPPLY' ? { exempt_kind: head.tax === 'nil' ? 'NIL' : 'EXEMPT' } : {}) };
  const drafts = buildBatchDrafts(template(kind, student, [{ head, amount }], `Late fee on ${against.invoice_number}`, ctx, extra), [{ key: partyKey(student), client: student }], { date: ctx.date, dueDays: 0, sender: ctx.sender, newId: ctx.newId });
  return issueBatch(drafts, { sourceId: `fine:${against.id}`, sourceKind: 'invoice', date: ctx.date, mode: 'issue', force: true }).invoices[0];
}
