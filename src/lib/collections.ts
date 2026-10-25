/**
 * Collections follow-ups (Round 2, R2-A4 — Zoho expected payment date, Odoo follow-up, Xero "commit to a
 * payment date", Wave communication history): a follow-up log per party with an optional promise-to-pay
 * and next action.
 *
 * Table `collection_notes` (rows, dated, backed up and synced). A promise is KEPT when the money received
 * from the party between the day it was made and the promised date reaches the promised amount; BROKEN when
 * the date has passed without that; OPEN otherwise. While a promise is open, reminders skip the bills it
 * covers (all the party's bills for an "on account" promise) until the promised date; after a broken promise
 * the next reminder suggests at least the firm stage. A later note on the same party supersedes the earlier
 * next action.
 *
 * Pure helpers first (dates are local days, Critical Rule 8); the small storage API at the end. Light on
 * imports: the notification bell loads it.
 */
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { currentActor, requireAccess } from './access';
import { isoDay, localDayOf } from './dates';

export const COLLECTION_NOTES_TABLE = 'collection_notes';

export type FollowUpKind = 'call' | 'visit' | 'whatsapp' | 'note';
export const FOLLOW_UP_KINDS: readonly FollowUpKind[] = ['call', 'visit', 'whatsapp', 'note'];

export interface PromiseToPay {
  amount: number;
  /** Local day the money is promised by. */
  date: string;
  /** Bills it covers; absent / empty = "on account" (the whole balance). */
  invoice_ids?: string[];
}

export interface CollectionNote {
  id: string;
  /** Party key as in receivables: client id, else `name:<lower-cased name>`. */
  party_key: string;
  party_name?: string;
  kind: FollowUpKind;
  outcome: string;
  /** Local day the follow-up happened (the period lock / sync date). */
  date: string;
  promise?: PromiseToPay;
  next_action?: { date: string; user_id?: string; user_name?: string; done?: boolean };
  created_at: string;
  created_by?: string;
}

/** Money received from a party (receipts and advances; never credit notes or write-offs). */
export interface PartyReceipt {
  party_key: string;
  date: string;
  amount: number;
}

const EPS = 0.005;
const nameKey = (name: string | undefined) => `name:${(name ?? '').trim().toLowerCase()}`;

/** Party key of a document's client, matched to the master by name like `buildReceivables` (`partyKeyOf`). */
export function partyKeyFor(client: Pick<Client, 'id' | 'name'> | undefined, idByName?: ReadonlyMap<string, string>): string {
  if (client?.id) return client.id;
  const nk = nameKey(client?.name);
  return idByName?.get(nk) ?? nk;
}

export function idByNameOf(clients: readonly Client[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of clients) if (c.id && !m.has(nameKey(c.name))) m.set(nameKey(c.name), c.id);
  return m;
}

/** Receipts per party from the payment rows (advance adjustments and write-offs are not money received now). */
export function receiptsByParty(
  invoices: readonly InvoiceRecord[],
  payments: readonly (Payment & { client_id?: string; client_name?: string })[],
  clients: readonly Client[] = [],
): PartyReceipt[] {
  const idByName = idByNameOf(clients);
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const out: PartyReceipt[] = [];
  for (const p of payments) {
    const amount = round2(Number(p.amount) || 0);
    if (!(amount > 0) || p.advance_id || p.write_off) continue;
    const inv = p.invoice_id ? byId.get(p.invoice_id) : undefined;
    const key = inv ? partyKeyFor(inv.client, idByName) : p.client_id || p.client_name ? partyKeyFor({ id: p.client_id, name: p.client_name ?? '' }, idByName) : '';
    if (key) out.push({ party_key: key, date: isoDay(p.date), amount });
  }
  return out;
}

export type PromiseState = 'open' | 'kept' | 'broken';

export interface PromiseProgress {
  state: PromiseState;
  /** Received from the party between the promise and its date. */
  received: number;
  /** Broken but something was paid. */
  partly: boolean;
}

/** State of a note's promise on `today` (local day). */
export function promiseProgress(note: CollectionNote, receipts: readonly PartyReceipt[], today: string): PromiseProgress | null {
  const p = note.promise;
  if (!p || !(p.amount > 0) || !p.date) return null;
  const from = note.date || isoDay(note.created_at);
  let received = 0;
  for (const r of receipts) if (r.party_key === note.party_key && r.date >= from && r.date <= p.date) received += r.amount;
  received = round2(received);
  if (received >= p.amount - EPS) return { state: 'kept', received, partly: false };
  if (today > p.date) return { state: 'broken', received, partly: received > EPS };
  return { state: 'open', received, partly: false };
}

/** Open promises on `today`: party → the promised date and the bills covered (empty set = all). */
export function openPromises(notes: readonly CollectionNote[], receipts: readonly PartyReceipt[], today: string): Map<string, { until: string; invoiceIds: Set<string> | null }> {
  const out = new Map<string, { until: string; invoiceIds: Set<string> | null }>();
  for (const n of notes) {
    const pr = promiseProgress(n, receipts, today);
    if (!pr || pr.state !== 'open') continue;
    const cur = out.get(n.party_key);
    const ids = n.promise?.invoice_ids?.length ? new Set(n.promise.invoice_ids) : null;
    if (!cur) out.set(n.party_key, { until: n.promise!.date, invoiceIds: ids });
    else {
      cur.until = cur.until > n.promise!.date ? cur.until : n.promise!.date;
      cur.invoiceIds = cur.invoiceIds && ids ? new Set([...cur.invoiceIds, ...ids]) : null;
    }
  }
  return out;
}

/** Is the invoice covered by an open promise (reminders wait until the promise date)? */
export function isHeldByPromise(holds: ReturnType<typeof openPromises>, invoiceId: string, partyKey: string): boolean {
  const h = holds.get(partyKey);
  return !!h && (!h.invoiceIds || h.invoiceIds.has(invoiceId));
}

/** Parties whose latest promise (within `days`) was broken — their next reminder is firm. */
export function brokenPromiseParties(notes: readonly CollectionNote[], receipts: readonly PartyReceipt[], today: string, days = 90): Set<string> {
  const latest = new Map<string, CollectionNote>();
  for (const n of notes) {
    if (!n.promise) continue;
    const cur = latest.get(n.party_key);
    if (!cur || n.promise.date > cur.promise!.date) latest.set(n.party_key, n);
  }
  const out = new Set<string>();
  const since = shiftDay(today, -days);
  for (const [k, n] of latest) if (n.promise!.date >= since && promiseProgress(n, receipts, today)?.state === 'broken') out.add(k);
  return out;
}

/** Kept / broken promise counts of a party (open ones are not counted). Feeds the payment score (R2-A7). */
export function promiseCounts(partyKey: string, notes: readonly CollectionNote[], receipts: readonly PartyReceipt[], today: string, from = ''): { kept: number; broken: number } {
  let kept = 0;
  let broken = 0;
  for (const n of notes) {
    if (n.party_key !== partyKey || !n.promise || (from && n.promise.date < from)) continue;
    const s = promiseProgress(n, receipts, today)?.state;
    if (s === 'kept') kept++;
    else if (s === 'broken') broken++;
  }
  return { kept, broken };
}

export interface FollowUpRow {
  note: CollectionNote;
  progress?: PromiseProgress | null;
}

export interface FollowUpLists {
  /** Next actions due today. */
  today: FollowUpRow[];
  /** Next actions whose date has passed. */
  overdue: FollowUpRow[];
  /** Open promises due today (or already due and still open today). */
  promisesDue: FollowUpRow[];
  broken: FollowUpRow[];
  /** Kept promises whose date fell in the last 30 days. */
  kept: FollowUpRow[];
}

/** The Follow-ups tab: today / overdue actions, promises due, broken, recently kept (local days). */
export function followUpsDue(notes: readonly CollectionNote[], receipts: readonly PartyReceipt[], today: string): FollowUpLists {
  const out: FollowUpLists = { today: [], overdue: [], promisesDue: [], broken: [], kept: [] };
  // A later note on the same party supersedes earlier next actions.
  const latestAt = new Map<string, string>();
  for (const n of notes) {
    const at = `${n.date}|${n.created_at}`;
    if ((latestAt.get(n.party_key) ?? '') < at) latestAt.set(n.party_key, at);
  }
  const keptFrom = shiftDay(today, -30);
  for (const n of notes) {
    const na = n.next_action;
    if (na?.date && !na.done && latestAt.get(n.party_key) === `${n.date}|${n.created_at}`) {
      if (na.date === today) out.today.push({ note: n });
      else if (na.date < today) out.overdue.push({ note: n });
    }
    const progress = promiseProgress(n, receipts, today);
    if (!progress) continue;
    if (progress.state === 'open' && n.promise!.date <= today) out.promisesDue.push({ note: n, progress });
    else if (progress.state === 'broken') out.broken.push({ note: n, progress });
    else if (progress.state === 'kept' && n.promise!.date >= keptFrom) out.kept.push({ note: n, progress });
  }
  const byDate = (a: FollowUpRow, b: FollowUpRow) =>
    (a.note.next_action?.date ?? a.note.promise?.date ?? '').localeCompare(b.note.next_action?.date ?? b.note.promise?.date ?? '');
  for (const list of Object.values(out) as FollowUpRow[][]) list.sort(byDate);
  return out;
}

/** Notification bell counts: promises due today and broken ones (newly broken in the last 7 days). */
export function promiseNotices(notes: readonly CollectionNote[], receipts: readonly PartyReceipt[], today: string): { due: CollectionNote[]; broken: CollectionNote[] } {
  const due: CollectionNote[] = [];
  const broken: CollectionNote[] = [];
  const since = shiftDay(today, -7);
  for (const n of notes) {
    const pr = promiseProgress(n, receipts, today);
    if (!pr) continue;
    if (pr.state === 'open' && n.promise!.date === today) due.push(n);
    else if (pr.state === 'broken' && n.promise!.date >= since) broken.push(n);
  }
  return { due, broken };
}

export type TimelineKind = 'reminder' | 'followup' | 'promise' | 'receipt';
export interface TimelineItem {
  date: string;
  kind: TimelineKind;
  text: string;
  amount?: number;
}

/** Party timeline (statement screen): reminders sent, follow-ups, promises and receipts, newest first. */
export function partyTimeline(
  partyKey: string,
  input: { notes: readonly CollectionNote[]; receipts: readonly PartyReceipt[]; reminders: readonly { invoice_id: string; party_key?: string; channel: string; tone: string; sent_at: string }[]; invoiceIds?: ReadonlySet<string> },
): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const r of input.reminders) {
    if (r.channel === 'snooze') continue;
    if (r.party_key !== partyKey && !(r.invoice_id && input.invoiceIds?.has(r.invoice_id))) continue;
    out.push({ date: isoDay(r.sent_at), kind: 'reminder', text: `${r.tone.replace(/_/g, ' ')} · ${r.channel}` });
  }
  for (const n of input.notes) {
    if (n.party_key !== partyKey) continue;
    out.push({ date: n.date, kind: 'followup', text: `${n.kind}: ${n.outcome}`.trim() });
    if (n.promise) out.push({ date: n.date, kind: 'promise', text: `promised by ${n.promise.date}`, amount: n.promise.amount });
  }
  for (const r of input.receipts) if (r.party_key === partyKey) out.push({ date: r.date, kind: 'receipt', text: 'received', amount: r.amount });
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return localDayOf(new Date(y, (m || 1) - 1, (d || 1) + days));
}

/** Problems with a follow-up before it is saved (empty = fine). */
export function followUpIssues(input: Pick<CollectionNote, 'party_key' | 'kind' | 'outcome' | 'promise' | 'next_action' | 'date'>): string[] {
  const out: string[] = [];
  if (!input.party_key) out.push('Pick a party.');
  if (!FOLLOW_UP_KINDS.includes(input.kind)) out.push('Pick how you followed up.');
  if (!input.outcome?.trim() && !input.promise && !input.next_action) out.push('Write what happened, or add a promise or next action.');
  if (input.promise) {
    if (!(input.promise.amount > 0)) out.push('Enter the promised amount.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.promise.date ?? '')) out.push('Enter the promised date.');
    else if (input.promise.date < input.date) out.push('The promised date cannot be before today.');
  }
  if (input.next_action && !/^\d{4}-\d{2}-\d{2}$/.test(input.next_action.date ?? '')) out.push('Enter the next action date.');
  return out;
}

/* ── Storage ───────────────────────────────────────────────────── */

export function loadCollectionNotes(): CollectionNote[] {
  return getTable<CollectionNote>(COLLECTION_NOTES_TABLE).filter((n) => n && typeof n.id === 'string' && typeof n.party_key === 'string');
}

export type FollowUpInput = Omit<CollectionNote, 'id' | 'created_at' | 'created_by' | 'date'> & { date?: string };

/** Log a follow-up (clerk or owner: `payment.record`). */
export function saveFollowUp(input: FollowUpInput): CollectionNote {
  requireAccess('payment.record');
  const date = input.date || localDayOf(new Date());
  const row: CollectionNote = {
    ...input,
    outcome: (input.outcome ?? '').trim(),
    date,
    id: generateId(),
    created_at: new Date().toISOString(),
    created_by: currentActor()?.name ?? '',
  };
  if (row.promise) row.promise = { ...row.promise, amount: round2(row.promise.amount), ...(row.promise.invoice_ids?.length ? {} : { invoice_ids: undefined }) };
  const issues = followUpIssues(row);
  if (issues.length) throw new Error(issues.join(' '));
  setTable(COLLECTION_NOTES_TABLE, [...loadCollectionNotes(), row]);
  return row;
}

/** Tick a note's next action as done. */
export function markActionDone(id: string): void {
  requireAccess('payment.record');
  const rows = loadCollectionNotes();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0 || !rows[i].next_action) return;
  rows[i] = { ...rows[i], next_action: { ...rows[i].next_action!, done: true } };
  setTable(COLLECTION_NOTES_TABLE, rows);
}
