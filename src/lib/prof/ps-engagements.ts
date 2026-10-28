/**
 * PS-A2 engagements (table `engagements`, ENG/FY…, dated by `start`, numbered, `doc.create`, audited): who the client
 * is, which matters it covers, the billing model (hourly, fixed, milestone, retainer, capped, success, blended), the
 * letter (a quotation with proposal sections, R2-B3) and its acceptance (8G) → `active`. A success fee (and a milestone
 * on a share of recovery) in a `legal` or `ca` profile warns with the professional-conduct rule and needs the owner's
 * reason (audited, PS26); a name recorded with an unwaived conflict warns on every new engagement. Never blocks
 * otherwise. Pure above "Storage".
 */
import './ps-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { ConflictCheck, Engagement, EngagementModel, ProfKind } from '../../types/prof-r14';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { shiftDay } from '../dates';
import { localDb } from '../localDb';
import { SUCCESS_FEE_PROMPT_RULES } from '../prof-rules';
import { PS_SERIES, PS_TABLES } from './ps-shared';
import { conflictWarnings, loadChecks } from './ps-conflicts';

export const MODELS: readonly EngagementModel[] = ['hourly', 'fixed', 'milestone', 'retainer', 'capped', 'success', 'blended'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The professional-conduct warning for a success / percentage-of-recovery fee, or '' (PS26). */
export function successPrompt(kind: ProfKind | undefined, e: Pick<Engagement, 'model' | 'milestones' | 'start'>): string {
  const pct = e.model === 'success' || (e.model === 'milestone' && (e.milestones ?? []).some((m) => /recover|success|result|award/i.test(`${m.label} ${m.event ?? ''}`)));
  return pct && kind ? ruleAt(SUCCESS_FEE_PROMPT_RULES, e.start)[kind] ?? '' : '';
}

/** Problems with an engagement (empty = may be saved). */
export function validateEngagement(e: Omit<Engagement, 'id' | 'number' | 'created_at'>): string {
  if (!e.client_id) return 'Choose the client.';
  if (!e.title?.trim()) return 'Give the engagement a title.';
  if (!MODELS.includes(e.model)) return 'Choose the billing model.';
  if (!DAY.test(e.start ?? '')) return 'Enter the start date.';
  if (e.end && e.end < e.start) return 'The end date is before the start date.';
  const pos = (v: unknown) => num(v) > 0;
  if (e.model === 'fixed' && !pos(e.fee)) return 'Enter the fixed fee.';
  if (e.model === 'capped' && !pos(e.cap)) return 'Enter the cap.';
  if (e.model === 'blended' && !pos(e.blended_rate)) return 'Enter the blended hourly rate.';
  if (e.model === 'retainer' && !e.retainer_id && !pos(e.fee)) return 'Link an hour-block retainer or enter the monthly fee.';
  if (e.model === 'success' && (!e.success?.event?.trim() || !(pos(e.success.pct) || pos(e.success.amount)))) return 'Describe the success event and the % or amount.';
  if (e.model === 'milestone') {
    const ms = e.milestones ?? [];
    if (!ms.length) return 'Add the milestones.';
    if (ms.some((m) => !m.label?.trim() || !(pos(m.pct) || pos(m.amount)))) return 'Every milestone needs a label and a % or an amount.';
    if (ms.some((m) => pos(m.pct)) && !pos(e.fee)) return 'Enter the total fee the milestone percentages share.';
    if (ms.reduce((s, m) => s + num(m.pct), 0) > 100.0001) return 'The milestone percentages add up to more than 100%.';
  }
  return '';
}

/** A milestone's amount: its own, else its share of the fee. */
export const milestoneAmount = (e: Pick<Engagement, 'fee'>, m: { pct?: number; amount?: number }): number => round2(num(m.amount) > 0 ? num(m.amount) : (num(e.fee) * num(m.pct)) / 100);

/** Pure: the engagement after its letter (quotation) was accepted (8G acceptance on the quote). */
export function acceptedFromQuote(e: Engagement, quote: Pick<InvoiceRecord, 'acceptance'> | undefined): Engagement | null {
  if (!quote?.acceptance || e.accepted_at || !['draft', 'sent'].includes(e.status)) return null;
  return { ...e, accepted_at: quote.acceptance.signed_at, status: 'active' };
}

/** Engagements whose renewal (or end) falls within `days` of `today`. */
export const renewalsDue = (all: readonly Engagement[], today: string, days = 30): Engagement[] =>
  all.filter((e) => e.status !== 'closed' && (e.renew_on ?? e.end) && (e.renew_on ?? e.end)! <= shiftDay(today, days)).sort((a, b) => (a.renew_on ?? a.end)!.localeCompare((b.renew_on ?? b.end)!));

/** The open engagement covering a matter (active first). */
export function engagementOf(matterId: string | undefined, all: readonly Engagement[]): Engagement | undefined {
  if (!matterId) return undefined;
  const open = all.filter((e) => e.status !== 'closed' && e.matter_ids.includes(matterId));
  return open.find((e) => e.status === 'active') ?? open[0];
}

// ── Storage ──────────────────────────────────────────────────────

export const loadEngagements = (): Engagement[] => getTable<Engagement>(PS_TABLES.engagements).filter((r) => r && typeof r.id === 'string');
const lockOf = (e: Pick<Engagement, 'id' | 'start' | 'number'>) => ({ id: e.id, issue_date: e.start, invoice_number: e.number });

export type EngagementInput = Omit<Engagement, 'id' | 'number' | 'created_at' | 'updated_at'> & { id?: string };

/**
 * Save an engagement (`doc.create`; period lock on its start). Returns the row and the warnings to show (an unwaived
 * conflict on the client or a matter party). A success-type fee in a legal / CA profile needs `ethics_reason` from the
 * owner (audited).
 */
export function saveEngagement(i: EngagementInput, ctx: { kind?: ProfKind; checks?: readonly ConflictCheck[]; partyNames?: readonly string[] } = {}): { row: Engagement; warnings: string[] } {
  requireAccess('doc.create');
  const err = validateEngagement(i);
  if (err) throw new Error(err);
  const all = loadEngagements();
  const prev = i.id ? all.find((e) => e.id === i.id) : undefined;
  const kind = ctx.kind ?? localDb.settings.get().prof_kind;
  const prompt = successPrompt(kind, i);
  if (prompt && !i.ethics_reason?.trim()) throw new Error(`${prompt} Record the owner's reason to continue.`);
  if (prompt && i.ethics_reason !== prev?.ethics_reason) requireAccess('settings.manage');
  const number = prev?.number ?? nextSeriesNumberFor(PS_SERIES.engagements, i.start, all.map((e) => e.number));
  const id = prev?.id ?? generateId();
  assertUnlocked(lockOf({ id, start: i.start, number }), prev ? 'edit' : 'create');
  const now = new Date().toISOString();
  const row: Engagement = {
    ...prev, ...i, id, number, title: i.title.trim(), currency: i.currency || 'INR', matter_ids: [...new Set(i.matter_ids)],
    ...(i.milestones ? { milestones: i.milestones.map((m) => ({ ...m, id: m.id || generateId() })) } : {}),
    created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}),
  };
  setTable(PS_TABLES.engagements, prev ? all.map((e) => (e.id === id ? row : e)) : [...all, row]);
  if (!prev) recordSeries(number);
  if (prompt && i.ethics_reason !== prev?.ethics_reason) audit.record({ entity: 'invoice', entity_id: id, action: 'update', summary: `Engagement ${number}: ${row.model} fee kept by the owner — ${i.ethics_reason}` });
  const client = localDb.clients.getById(i.client_id)?.name ?? '';
  const warnings = prev ? [] : conflictWarnings([client, ...(ctx.partyNames ?? [])], ctx.checks ?? loadChecks()).map((c) => `Conflict recorded on ${c.date} for ${c.terms.join(', ')} (not waived).`);
  return { row, warnings };
}

/** Write accepted letters through (desk load): letter quotes that carry an acceptance make their engagement active. */
export function syncAcceptances(invoices: readonly InvoiceRecord[]): number {
  const all = loadEngagements();
  const quotes = new Map(invoices.map((q) => [q.id, q]));
  let n = 0;
  const next = all.map((e) => {
    const up = e.letter_quote_id ? acceptedFromQuote(e, quotes.get(e.letter_quote_id)) : null;
    if (up) n++;
    return up ?? e;
  });
  if (n) setTable(PS_TABLES.engagements, next);
  return n;
}

/** Delete an engagement not yet billed (the row goes to the recycle bin; its ENG number stays used). */
export function deleteEngagement(id: string, invoices: readonly InvoiceRecord[] = localDb.invoices.getAll()): void {
  requireAccess('doc.create');
  const all = loadEngagements();
  const e = all.find((x) => x.id === id);
  if (!e) return;
  if (invoices.some((inv) => inv.ps?.engagement?.id === id && inv.status !== 'Cancelled')) throw new Error(`Engagement ${e.number} has fee notes: close it instead.`);
  assertUnlocked(lockOf(e), 'delete');
  setTable(PS_TABLES.engagements, all.filter((x) => x.id !== id));
}
