/**
 * RT-C3 alteration slips (table `alteration_jobs`, `doc.create`, dated `date`, numbered `ALT/FY…` through
 * `series-counters.ts`, never reused after a delete). A slip has a token, a due day, a tailor (a `vendors` row) and a
 * charge (0 = a free alteration, part of the sale). Status: received → with tailor → ready → delivered, or cancelled.
 * A charged alteration is a separate service line (SAC / rate from `retail-rules.ts` `ALTERATION_RULES`, default
 * 998821 at 5%, unverified); *Make tailor bill* raises a purchase-bill DRAFT ("Tailoring charges", no GST: an
 * unregistered tailor, no RCM by default) for the tailor's delivered jobs in a period. Working paper — verify with your
 * CA (RT3).
 */
import './rt-registry';
import type { AlterationJob, AlterationStatus } from '../../types/retail-r9';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PurchaseLine } from '../../types/purchases';
import { ALTERATION_RULES, type AlterationRule } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { RT_SERIES, RT_TABLES } from './rt-shared';
import { draftsDb } from '../purchase-drafts';

export const ALTERATION_TABLE = RT_TABLES.alterationJobs;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Pure ── */

export const ALTERATION_FLOW: readonly AlterationStatus[] = ['received', 'with_tailor', 'ready', 'delivered'];

/** The next status of the flow (undefined after delivered / cancelled). */
export const nextStatus = (s: AlterationStatus): AlterationStatus | undefined => (s === 'delivered' || s === 'cancelled' ? undefined : ALTERATION_FLOW[ALTERATION_FLOW.indexOf(s) + 1]);

/** A move is one step forward, or a cancel of a job not yet delivered. */
export const canMove = (from: AlterationStatus, to: AlterationStatus): boolean => (to === 'cancelled' ? from !== 'delivered' && from !== 'cancelled' : nextStatus(from) === to);

export const alterationRule = (date?: string): AlterationRule => ruleAt(ALTERATION_RULES, date);

/** Next `ALT/FY…/n` number for the date (series high-water marks count: a deleted number is never reused). */
export const nextAlterationNumber = (date: string, jobs: readonly Pick<AlterationJob, 'number'>[]): string => nextSeriesNumberFor(RT_SERIES.alterations, date, jobs.map((j) => j.number));

/** The service line that charges an alteration (null for a free one): one unit at the charge, SAC + rate from the rule. */
export function chargeLine(job: Pick<AlterationJob, 'number' | 'garment' | 'charge'>, date: string, id: string): InvoiceItem | null {
  const charge = round2(num(job.charge));
  if (charge <= 0) return null;
  const r = alterationRule(date);
  return { id, name: `Alteration — ${job.garment}`, description: job.number, type: 'Service', hsn: r.sac, unit: 'NOS', quantity: 1, rate: charge, tax_rate: r.rate, discount_percent: 0, amount: charge };
}

/** Jobs whose charge is on a (not cancelled) bill: a line that names the slip number. */
export function billedJobs(jobs: readonly AlterationJob[], invoices: readonly InvoiceRecord[]): Set<string> {
  const nums = new Map(jobs.filter((j) => j.charge > 0).map((j) => [j.number, j.id]));
  const out = new Set<string>();
  if (!nums.size) return out;
  for (const inv of invoices) {
    if (!inv || inv.status === 'Cancelled') continue;
    for (const l of inv.items ?? []) {
      const id = nums.get(String(l.description ?? '').trim());
      if (id) out.add(id);
    }
  }
  return out;
}

/**
 * QA10 R16: a slip's tailor bill still exists (the draft, or the bill it was posted as — same id). A stamp whose draft was
 * discarded / bill deleted no longer bills the slip: it can be billed again and deleted.
 */
export function tailorBilled(j: Pick<AlterationJob, 'tailor_bill_id'>, bills: { drafts: readonly { id: string }[]; purchases: readonly { id: string }[] } = liveBills()): boolean {
  const id = j.tailor_bill_id;
  return !!id && (bills.drafts.some((d) => d?.id === id) || bills.purchases.some((p) => p?.id === id));
}
const liveBills = () => ({ drafts: getTable<{ id: string }>('purchase_drafts'), purchases: getTable<{ id: string }>('purchases') });

/** The tailor's delivered, unpaid jobs delivered in [from, to], as bill lines at the tailor's rates (no GST). */
export function tailorJobs(jobs: readonly AlterationJob[], tailorId: string, from: string, to: string): AlterationJob[] {
  const bills = jobs.some((j) => j.tailor_bill_id) ? liveBills() : { drafts: [], purchases: [] };
  return jobs.filter((j) => j.tailor_id === tailorId && j.status === 'delivered' && !tailorBilled(j, bills) && num(j.tailor_rate) > 0 && (j.delivered_on ?? j.due) >= from && (j.delivered_on ?? j.due) <= to);
}

export function tailorBillLines(jobs: readonly AlterationJob[], newId: () => string): PurchaseLine[] {
  return jobs.map((j) => ({ id: newId(), name: `${j.number} — ${j.garment}`, quantity: 1, rate: round2(num(j.tailor_rate)), tax_rate: 0, unit: 'NOS', hsn: alterationRule(j.date).sac }));
}

/** Due today or earlier and not ready yet (the POS header count). */
export const dueJobs = (jobs: readonly AlterationJob[], today: string): AlterationJob[] => jobs.filter((j) => (j.status === 'received' || j.status === 'with_tailor') && j.due <= today);

/** `wa.me` link for "ready for pickup" (undefined without a phone); the user taps it, nothing is sent. */
export function readyLink(job: Pick<AlterationJob, 'phone'>, message: string): string | undefined {
  const d = String(job.phone ?? '').replace(/\D/g, '');
  return d.length < 10 ? undefined : `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(message)}`;
}

/* ── Storage ── */

export const loadAlterations = (): AlterationJob[] => getTable<AlterationJob>(ALTERATION_TABLE).filter((r) => r && typeof r.id === 'string');

export interface AlterationInput {
  date: string;
  customer: string;
  phone?: string;
  invoice_id?: string;
  invoice_number?: string;
  garment: string;
  notes?: string;
  tailor_id?: string;
  tailor_name?: string;
  due: string;
  charge?: number;
  tailor_rate?: number;
}

/** Create a slip (numbered `ALT/FY…`). `doc.create`; the period lock applies to its date. */
export function addAlteration(input: AlterationInput): AlterationJob {
  requireAccess('doc.create');
  if (!DAY.test(input.date) || !DAY.test(input.due)) throw new Error('Choose the date and the due day.');
  if (input.due < input.date) throw new Error('The due day is before the slip date.');
  if (!input.customer.trim()) throw new Error('Type the customer\'s name.');
  if (!input.garment.trim()) throw new Error('Describe the garment.');
  if (num(input.charge) < 0 || num(input.tailor_rate) < 0) throw new Error('Amounts cannot be negative.');
  const all = loadAlterations();
  const number = nextAlterationNumber(input.date, all);
  assertUnlocked({ issue_date: input.date, invoice_number: number }, 'create');
  const job: AlterationJob = {
    id: generateId(), number, date: input.date, customer: input.customer.trim(), garment: input.garment.trim(), due: input.due,
    charge: round2(num(input.charge)), tailor_rate: round2(num(input.tailor_rate)), status: 'received', created_at: new Date().toISOString(),
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}), ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    ...(input.invoice_id ? { invoice_id: input.invoice_id, invoice_number: input.invoice_number } : {}),
    ...(input.tailor_id ? { tailor_id: input.tailor_id, tailor_name: input.tailor_name } : {}),
  };
  setTable(ALTERATION_TABLE, [...all, job]);
  recordSeries(number);
  return job;
}

/** Move a slip along its flow (or cancel it). */
export function moveAlteration(id: string, to: AlterationStatus, day: string): AlterationJob {
  requireAccess('doc.create');
  const all = loadAlterations();
  const job = all.find((j) => j.id === id);
  if (!job) throw new Error('Alteration slip not found.');
  if (!canMove(job.status, to)) throw new Error(`A slip that is ${job.status.replace('_', ' ')} cannot move to ${to.replace('_', ' ')}.`);
  const next: AlterationJob = { ...job, status: to, updated_at: new Date().toISOString(), ...(to === 'ready' ? { ready_on: day } : {}), ...(to === 'delivered' ? { delivered_on: day } : {}) };
  setTable(ALTERATION_TABLE, all.map((j) => (j.id === id ? next : j)));
  return next;
}

/** Delete a slip (to the recycle bin through the watched table); its number stays used. */
export function deleteAlteration(id: string): void {
  requireAccess('doc.create');
  const all = loadAlterations();
  const job = all.find((j) => j.id === id);
  if (!job) return;
  if (tailorBilled(job)) throw new Error('The tailor has been billed for this slip; delete the tailor bill first.');
  assertUnlocked({ id, issue_date: job.date, invoice_number: job.number }, 'delete');
  setTable(ALTERATION_TABLE, all.filter((j) => j.id !== id));
}

/**
 * *Make tailor bill*: a purchase-bill draft ("Tailoring charges", no GST / ITC; review it under Expenses → Drafts) for
 * the tailor's delivered jobs in [from, to]; the jobs are stamped with the draft's id. Returns the draft id and count.
 */
export async function makeTailorBill(tailor: { id: string; name: string }, from: string, to: string): Promise<{ id: string; n: number; total: number }> {
  requireAccess('books.edit');
  const all = loadAlterations();
  const jobs = tailorJobs(all, tailor.id, from, to);
  if (!jobs.length) throw new Error('No delivered, unbilled jobs for this tailor in the period.');
  const lines = tailorBillLines(jobs, generateId);
  const total = round2(lines.reduce((s, l) => s + l.rate * l.quantity, 0));
  const draft = draftsDb.save({
    kind: 'EXPENSE', vendor_id: tailor.id, vendor_name: tailor.name, bill_number: `${RT_SERIES.alterations} ${from} – ${to}`, date: to, category: 'Tailoring charges',
    lines, taxable: total, cgst: 0, sgst: 0, igst: 0, total, amount_paid: 0, itc_eligible: false,
    notes: 'Tailor\'s alteration jobs (draft) — no GST charged by an unregistered tailor; verify with your CA (RT3).',
    draft: { source: 'manual', created_at: new Date().toISOString() },
  });
  const ids = new Set(jobs.map((j) => j.id));
  const now = new Date().toISOString();
  setTable(ALTERATION_TABLE, all.map((j) => (ids.has(j.id) ? { ...j, tailor_bill_id: draft.id, updated_at: now } : j)));
  return { id: draft.id, n: jobs.length, total };
}
