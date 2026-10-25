/**
 * Recurring bills / expenses (8.43): rent, SaaS subscriptions, AMC payable … Zoho Books "recurring
 * bills". A schedule in table `recurring_bills` uses the same date rules as recurring invoices
 * (`recurring.ts`: weekly … yearly, every N days, month-end clamping, catch-up capped at 12) but it
 * only ever writes a **draft** into `purchase_drafts` — never a posted bill — because the supplier's
 * own bill number, date and amount must be checked first. Drafts are out of the books until posted.
 *
 * Idempotent: a draft (or a posted bill) carrying `recurring_bill_id` + `recurring_date` is never
 * drafted twice. Runs when the bell's lazy provider loads and when the Expenses inbox opens.
 */

import type { PurchaseLine, PurchaseRecord } from '../types/purchases';
import { requireAccess } from './access';
import { audit } from './audit';
import { dueRunsDetailed, firstOccurrenceOnOrAfter, applyTokens, addDays, type Frequency, type RecurringSchedule } from './recurring';
import { computePurchaseTotals, purchasesDb, balanceOf } from './purchases';
import { draftsDb, type PurchaseDraft } from './purchase-drafts';
import { generateId, getTable, setTable } from './storage';

export const RECURRING_BILLS_TABLE = 'recurring_bills';
const HISTORY_KEEP = 24;

export interface RecurringBill {
  id: string;
  name: string;
  kind: 'PURCHASE' | 'EXPENSE';
  vendor_id?: string;
  vendor_name: string;
  vendor_gstin?: string;
  category: string;
  place_of_supply?: string;
  lines: PurchaseLine[];
  itc_eligible: boolean;
  notes?: string;
  cost_centre_id?: string;
  branch_id?: string;
  /** Due date of each drafted bill = occurrence + N days. */
  due_in_days: number;
  frequency: Frequency;
  interval: number;
  start_date: string;
  end_date?: string;
  max_runs?: number;
  next_run: string;
  last_run?: string;
  run_count: number;
  skipped_count?: number;
  active: boolean;
  history: { date: string; draft_id: string }[];
  created_at?: string;
  updated_at?: string;
}

/** The recurring.ts date rules read only these fields; the cast keeps one implementation. */
const asSchedule = (s: RecurringBill) => s as unknown as RecurringSchedule;

export function recurringBillsAll(): RecurringBill[] {
  return getTable<RecurringBill>(RECURRING_BILLS_TABLE).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.lines));
}

/** Pure: totals of a schedule's lines (CGST + SGST unless the place of supply is another state). */
export function recurringBillTotals(s: Pick<RecurringBill, 'lines' | 'place_of_supply'>, businessState: string) {
  return computePurchaseTotals(s.lines, { placeOfSupply: s.place_of_supply || businessState, businessState });
}

/** Pure: the draft bill for one occurrence. */
export function buildRecurringDraft(s: RecurringBill, occurrence: string, businessState: string): Omit<PurchaseRecord, 'id'> & { draft: PurchaseDraft['draft'] } {
  const lines = s.lines.map((l) => ({ ...l, id: generateId(), name: applyTokens(l.name, occurrence) }));
  const t = computePurchaseTotals(lines, { placeOfSupply: s.place_of_supply || businessState, businessState });
  return {
    kind: s.kind,
    vendor_id: s.vendor_id,
    vendor_name: s.vendor_name,
    vendor_gstin: s.vendor_gstin,
    bill_number: '',
    date: occurrence,
    due_date: s.due_in_days > 0 ? addDays(occurrence, s.due_in_days) : undefined,
    place_of_supply: s.place_of_supply || businessState || undefined,
    category: s.category,
    lines,
    taxable: t.taxable,
    cgst: t.cgst,
    sgst: t.sgst,
    igst: t.igst,
    itc_eligible: s.itc_eligible && t.tax > 0,
    total: t.total,
    amount_paid: 0,
    notes: applyTokens(s.notes, occurrence) || undefined,
    cost_centre_id: s.cost_centre_id,
    branch_id: s.branch_id,
    recurring_bill_id: s.id,
    recurring_date: occurrence,
    draft: { source: 'recurring', created_at: new Date().toISOString(), review: s.kind === 'PURCHASE' ? ['billNo'] : undefined },
  };
}

export function saveRecurringBill(input: Omit<RecurringBill, 'id' | 'next_run' | 'run_count' | 'history'> & Partial<Pick<RecurringBill, 'id' | 'next_run' | 'run_count' | 'history'>>, today: string): RecurringBill {
  requireAccess('books.edit');
  if (!input.name.trim()) throw new Error('Give the schedule a name.');
  if (!input.vendor_name.trim()) throw new Error('Choose the supplier.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) throw new Error('Choose the first date.');
  if (!input.lines.length || input.lines.some((l) => !l.name.trim() || !(Number(l.rate) > 0))) throw new Error('Each line needs a name and an amount.');
  const rows = recurringBillsAll();
  const prev = input.id ? rows.find((r) => r.id === input.id) : undefined;
  const startChanged = !prev || prev.start_date !== input.start_date || prev.frequency !== input.frequency || prev.interval !== input.interval;
  const row: RecurringBill = {
    ...prev,
    ...input,
    id: prev?.id ?? generateId(),
    name: input.name.trim().slice(0, 80),
    interval: Math.max(1, Math.floor(Number(input.interval) || 1)),
    due_in_days: Math.max(0, Math.floor(Number(input.due_in_days) || 0)),
    next_run: startChanged ? firstOccurrenceOnOrAfter(input as never, prev ? today : input.start_date) : prev!.next_run,
    run_count: prev?.run_count ?? 0,
    history: prev?.history ?? [],
    created_at: prev?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  setTable(RECURRING_BILLS_TABLE, prev ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
  try {
    audit.record({ entity: 'purchase', entity_id: row.id, action: prev ? 'update' : 'create', summary: `${prev ? 'Edited' : 'Created'} recurring bill "${row.name}" for ${row.vendor_name}` });
  } catch {
    /* logging never blocks */
  }
  return row;
}

export function setRecurringBillActive(id: string, active: boolean, today: string): void {
  requireAccess('books.edit');
  setTable(
    RECURRING_BILLS_TABLE,
    recurringBillsAll().map((r) => (r.id === id ? { ...r, active, ...(active ? { next_run: firstOccurrenceOnOrAfter(asSchedule(r), today) } : {}), updated_at: new Date().toISOString() } : r)),
  );
}

export function removeRecurringBill(id: string): void {
  requireAccess('books.edit');
  setTable(RECURRING_BILLS_TABLE, recurringBillsAll().filter((r) => r.id !== id));
}

export interface BillRunReport {
  drafted: PurchaseDraft[];
  skipped: number;
}

/** Draft every occurrence due on or before `today` (idempotent). Never posts a bill. */
export function runDueBillSchedules(today: string, businessState: string): BillRunReport {
  const report: BillRunReport = { drafted: [], skipped: 0 };
  const schedules = recurringBillsAll();
  if (!schedules.some((s) => s.active && s.next_run <= today)) return report;
  requireAccess('books.edit');
  const taken = new Set<string>();
  for (const r of [...draftsDb.all(), ...purchasesDb.all()]) if (r.recurring_bill_id && r.recurring_date) taken.add(`${r.recurring_bill_id}|${r.recurring_date}`);
  const next = schedules.map((s) => {
    const due = dueRunsDetailed(asSchedule(s), today);
    if (!due.dates.length) return s;
    const history = [...s.history];
    for (const day of due.dates) {
      if (taken.has(`${s.id}|${day}`)) continue;
      const draft = draftsDb.save(buildRecurringDraft(s, day, businessState));
      taken.add(`${s.id}|${day}`);
      history.push({ date: day, draft_id: draft.id });
      report.drafted.push(draft);
    }
    report.skipped += due.skipped;
    return {
      ...s,
      next_run: due.nextRun,
      last_run: due.dates[due.dates.length - 1],
      run_count: s.run_count + due.dates.length,
      skipped_count: (s.skipped_count ?? 0) + due.skipped,
      history: history.slice(-HISTORY_KEEP),
      updated_at: new Date().toISOString(),
    };
  });
  setTable(RECURRING_BILLS_TABLE, next);
  return report;
}

export interface DueSoon {
  bills: { id: string; vendor: string; number: string; due: string; balance: number }[];
  upcoming: { id: string; name: string; date: string; amount: number }[];
}

/** Pure: unpaid bills due within `days` (overdue included) and recurring bills that will be drafted then. */
export function billsDueSoon(purchases: readonly PurchaseRecord[], schedules: readonly RecurringBill[], today: string, businessState: string, days = 7): DueSoon {
  const until = addDays(today, days);
  const bills = purchases
    .filter((p) => p && p.status !== 'draft' && p.due_date && p.due_date <= until && balanceOf(p) > 0.004)
    .map((p) => ({ id: p.id, vendor: p.vendor_name, number: p.bill_number, due: p.due_date!, balance: balanceOf(p) }))
    .sort((a, b) => a.due.localeCompare(b.due));
  const upcoming = schedules
    .filter((s) => s.active && s.next_run >= today && s.next_run <= until && !(s.end_date && s.next_run > s.end_date))
    .map((s) => ({ id: s.id, name: s.name, date: s.next_run, amount: recurringBillTotals(s, businessState).total }));
  return { bills, upcoming };
}
