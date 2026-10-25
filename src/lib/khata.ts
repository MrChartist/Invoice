/**
 * Daily khata loop (8A) — the pure half: balance-first party list, FIFO allocation of a quick
 * receipt, the WhatsApp statement, party-level reminders and their queue, and the party-balance
 * snapshot printed on a bill. No storage, no React, no browser APIs (tested in `tests/khata.test.ts`);
 * `khata-actions.ts` wires it to the data layer.
 *
 * Every balance here comes from `buildReceivables` (invoices + receipts + credit notes + advances +
 * bill-wise opening bills), so the Clients list, Receivables, statements and reminders always agree.
 * Nothing is sent by the app: it only builds `wa.me` and `upi://` links the user taps.
 */
import type { Client, InvoiceRecord, PartyBalanceSnapshot, SenderProfile } from '../types/invoice';
import { round2 } from './invoice-calc';
import { buildLedger, buildReceivables, partyKeyOf, type Bill, type BuildInput, type PartyReceivable, type ReceivablesReport } from './receivables';
import { normalizePhone, upiLink } from './share';
import { formatCurrency, formatDate } from './utils';
import { isoDay, localDayOf } from './dates';
import { billAmount, canCarryPartyBalance } from './party-balance';
import { fillTemplate, stageForDays, type ReminderChannel, type ReminderRecord, type ReminderStage } from './reminders';

const EPS = 0.005;
const inr = (n: number) => formatCurrency(Math.abs(n), 'INR');

/* ── Balance-first party list ─────────────────────────────────── */

/** "To collect" (they owe us), "Advance" (we hold their money) or "Settled". */
export type BalanceKind = 'collect' | 'advance' | 'settled';

export function balanceKind(net: number): BalanceKind {
  return net > EPS ? 'collect' : net < -EPS ? 'advance' : 'settled';
}

export interface KhataRow {
  key: string;
  name: string;
  client?: Client;
  party?: PartyReceivable;
  /** Party ledger balance: positive = to collect, negative = advance. */
  net: number;
  kind: BalanceKind;
  /** Σ outstanding of bills past their due date (never more than `net`). */
  overdue: number;
  oldestOverdueDays: number;
  openBills: number;
}

/** Σ outstanding of the party's overdue bills, capped at what the party owes overall. */
export function overdueOf(party: PartyReceivable | undefined): number {
  if (!party) return 0;
  const raw = party.bills.filter((b) => b.daysOverdue > 0).reduce((s, b) => s + b.outstanding, 0);
  return round2(Math.max(0, Math.min(raw, party.net)));
}

/** The client key used by receivables: id, else `name:<lower-cased name>`. */
export function clientKey(c: Pick<Client, 'id' | 'name'>): string {
  return c.id || `name:${(c.name ?? '').trim().toLowerCase()}`;
}

/** One row per client master entry, with its balance from the receivables report (INR). */
export function khataRows(clients: readonly Client[], report: ReceivablesReport): KhataRow[] {
  const byKey = new Map(report.parties.map((p) => [p.key, p]));
  return clients.map((c) => {
    const party = byKey.get(clientKey(c)) ?? byKey.get(`name:${(c.name ?? '').trim().toLowerCase()}`);
    const net = party?.net ?? 0;
    const overdue = overdueOf(party);
    return {
      key: party?.key ?? clientKey(c),
      name: c.name,
      client: c,
      party,
      net,
      kind: balanceKind(net),
      overdue,
      oldestOverdueDays: overdue > 0 ? party?.oldestOverdueDays ?? 0 : 0,
      openBills: party?.bills.length ?? 0,
    };
  });
}

export interface KhataTotals {
  /** Σ of positive balances ("You'll get"). */
  youGet: number;
  /** Σ of advances held ("You'll give"). */
  youGive: number;
  overdue: number;
  overdueParties: number;
}

export function khataTotals(rows: readonly KhataRow[]): KhataTotals {
  let youGet = 0;
  let youGive = 0;
  let overdue = 0;
  let overdueParties = 0;
  for (const r of rows) {
    if (r.kind === 'collect') youGet += r.net;
    else if (r.kind === 'advance') youGive += -r.net;
    if (r.overdue > EPS) {
      overdue += r.overdue;
      overdueParties++;
    }
  }
  return { youGet: round2(youGet), youGive: round2(youGive), overdue: round2(overdue), overdueParties };
}

export type KhataSort = 'balance' | 'name' | 'overdue';

/** Balance: biggest "to collect" first, settled in the middle, biggest advance last. */
export function sortKhataRows(rows: readonly KhataRow[], sort: KhataSort = 'balance'): KhataRow[] {
  const byName = (a: KhataRow, b: KhataRow) => (a.name || '').localeCompare(b.name || '');
  const list = [...rows];
  if (sort === 'name') return list.sort(byName);
  if (sort === 'overdue') return list.sort((a, b) => b.overdue - a.overdue || b.oldestOverdueDays - a.oldestOverdueDays || b.net - a.net || byName(a, b));
  return list.sort((a, b) => b.net - a.net || byName(a, b));
}

/* ── Quick receipt: FIFO allocation ───────────────────────────── */

export interface OpenBillRef {
  id: string;
  ref: string;
  due: string;
  outstanding: number;
}

export interface QuickAllocation {
  bill_id: string;
  ref: string;
  amount: number;
}

export interface FifoResult {
  allocations: QuickAllocation[];
  /** Whatever is left after the open bills: credited to the party on account. */
  onAccount: number;
}

/** Open bills of a party as allocation targets (oldest due first, as `buildReceivables` sorts them). */
export function openBillRefs(party: PartyReceivable | undefined): OpenBillRef[] {
  return (party?.bills ?? []).map((b: Bill) => ({ id: b.invoiceId, ref: b.number, due: b.dueDate, outstanding: b.outstanding }));
}

/**
 * Split `amount` over the open bills, oldest due date first (ties: as listed), each bill at most its
 * outstanding. The rest goes on account. Amounts are rupees rounded to paise.
 */
export function fifoAllocate(bills: readonly OpenBillRef[], amount: number): FifoResult {
  let left = round2(Math.max(Number(amount) || 0, 0));
  const ordered = bills.map((b, i) => ({ b, i })).sort((x, y) => (x.b.due < y.b.due ? -1 : x.b.due > y.b.due ? 1 : x.i - y.i));
  const allocations: QuickAllocation[] = [];
  for (const { b } of ordered) {
    if (left <= EPS) break;
    const take = round2(Math.min(left, Math.max(b.outstanding, 0)));
    if (take <= EPS) continue;
    allocations.push({ bill_id: b.id, ref: b.ref, amount: take });
    left = round2(left - take);
  }
  return { allocations, onAccount: left > EPS ? left : 0 };
}

/** Problems with an edited allocation (empty = fine). */
export function quickReceiptIssues(amount: number, allocations: readonly QuickAllocation[], bills: readonly OpenBillRef[]): string[] {
  const errors: string[] = [];
  const total = round2(Number(amount) || 0);
  if (!(total > 0)) errors.push('Enter an amount above zero.');
  const byId = new Map(bills.map((b) => [b.id, b]));
  let sum = 0;
  for (const a of allocations) {
    if (!(a.amount > 0)) continue;
    const b = byId.get(a.bill_id);
    if (!b) errors.push(`${a.ref || a.bill_id} is not an open bill of this party.`);
    else if (round2(a.amount) > round2(b.outstanding) + EPS) errors.push(`${b.ref}: only ${inr(b.outstanding)} is due.`);
    sum += a.amount;
  }
  if (round2(sum) > total + EPS) errors.push('The bills add up to more than the amount received.');
  return errors;
}

/* ── UPI and the WhatsApp statement ───────────────────────────── */

type Payee = Pick<SenderProfile, 'companyName' | 'upiId' | 'companyPhone'> | null | undefined;

/** `upi://pay` for a party's balance, or null without a valid UPI ID / amount. */
export function partyUpiLink(sender: Payee, amount: number, partyName: string): string | null {
  if (!sender?.upiId || !(amount > EPS)) return null;
  return upiLink({ pa: sender.upiId, pn: sender.companyName, amount, note: `Balance - ${partyName}`.slice(0, 80) });
}

export interface WhatsAppStatementInput {
  sender: Payee;
  party: PartyReceivable;
  today?: Date;
  /** Bills listed (oldest first); the rest are summed in one line. */
  maxBills?: number;
}

/**
 * Plain-text statement for WhatsApp: open bills, credits / advances, the net due and a `upi://`
 * link for exactly that amount. WhatsApp `*bold*` markers only; everything else is plain text.
 */
export function buildWhatsAppStatement(input: WhatsAppStatementInput): string {
  const { sender, party } = input;
  const today = input.today ?? new Date();
  const max = input.maxBills ?? 8;
  const lines: string[] = [];
  lines.push(`*Statement – ${sender?.companyName?.trim() || 'Account statement'}*`);
  lines.push(`${party.name} · as of ${formatDate(localDayOf(today))}`);
  lines.push('');
  if (party.bills.length) {
    lines.push('Open bills:');
    for (const b of party.bills.slice(0, max)) {
      const tail = b.daysOverdue > 0 ? `${b.daysOverdue} days overdue` : `due ${formatDate(b.dueDate)}`;
      lines.push(`• ${b.number} (${formatDate(b.issueDate)}): ${inr(b.outstanding)} – ${tail}`);
    }
    const rest = party.bills.slice(max);
    if (rest.length) lines.push(`• ${rest.length} more bill${rest.length === 1 ? '' : 's'}: ${inr(rest.reduce((s, b) => s + b.outstanding, 0))}`);
  }
  const credits = round2(party.creditNotes + party.advances);
  if (credits > EPS && party.bills.length) lines.push(`Less credits / advances: ${inr(credits)}`);
  lines.push('');
  if (party.net > EPS) {
    const overdue = overdueOf(party);
    lines.push(`*Net due: ${inr(party.net)}*${overdue > EPS ? ` (overdue ${inr(overdue)})` : ''}`);
    const link = partyUpiLink(sender, party.net, party.name);
    if (link) {
      lines.push(`Pay by UPI: ${link}`);
      lines.push(`UPI ID: ${sender!.upiId}`);
    }
    lines.push('Kindly arrange the payment. Thank you!');
  } else if (party.net < -EPS) {
    lines.push(`*Advance with us: ${inr(party.net)}* – nothing to pay. Thank you!`);
  } else {
    lines.push('*No balance due.* Thank you!');
  }
  if (sender?.companyPhone?.trim()) lines.push(`Ph: ${sender.companyPhone.trim()}`);
  return lines.join('\n');
}

/* ── Party-level reminders ────────────────────────────────────── */

export type PartyReminderLang = 'en' | 'hinglish' | 'hi';
/** `overdue`: chase what is past due. `balance`: the monthly "here is your balance" message. */
export type PartyReminderKind = 'overdue' | 'balance';

const PARTY_T: Record<PartyReminderLang, Record<PartyReminderKind, string> & { upi: string; upiId: string; there: string }> = {
  en: {
    overdue:
      'Hi {client},\n\nA friendly reminder from {business}: {amount} is overdue on your account (oldest bill {oldest_ref} of {oldest_date}, {days} days overdue).\nTotal balance: {net}\n{upi_line}\nIf you have already paid, please share the reference. Thank you!\n{phone}',
    balance: 'Hi {client},\n\nYour account balance with {business} as of {date} is {net}.\n{upi_line}\nThank you!\n{phone}',
    upi: 'Pay by UPI: {link}',
    upiId: 'UPI ID: {id}',
    there: 'there',
  },
  hinglish: {
    overdue:
      'Namaste {client} ji,\n\n{business} ki taraf se yaad dilana tha: aapke khate mein {amount} overdue hai (sabse purana bill {oldest_ref}, {oldest_date}, {days} din se baaki).\nKul baaki: {net}\n{upi_line}\nAgar payment ho chuka hai to reference bhej dijiye. Dhanyavaad!\n{phone}',
    balance: 'Namaste {client} ji,\n\n{date} tak {business} ke saath aapka baaki {net} hai.\n{upi_line}\nDhanyavaad!\n{phone}',
    upi: 'UPI se payment: {link}',
    upiId: 'UPI ID: {id}',
    there: '',
  },
  hi: {
    overdue:
      'नमस्ते {client} जी,\n\n{business} की ओर से याद दिलाना था: आपके खाते में {amount} बकाया है (सबसे पुराना बिल {oldest_ref}, {oldest_date}, {days} दिन से बाकी)।\nकुल बाकी: {net}\n{upi_line}\nअगर भुगतान हो चुका है तो कृपया रेफ़रेंस भेज दें। धन्यवाद!\n{phone}',
    balance: 'नमस्ते {client} जी,\n\n{date} तक {business} के साथ आपका बकाया {net} है।\n{upi_line}\nधन्यवाद!\n{phone}',
    upi: 'UPI से भुगतान: {link}',
    upiId: 'UPI ID: {id}',
    there: '',
  },
};

export interface PartyReminderInput {
  party: PartyReceivable;
  sender: Payee;
  kind?: PartyReminderKind;
  lang?: PartyReminderLang;
  today?: Date;
}

export interface PartyReminder {
  body: string;
  /** What the message asks for: the overdue part (`overdue`) or the whole balance (`balance`). */
  amount: number;
  overdue: number;
  oldest: Bill | null;
  upi: string | null;
}

/** The oldest overdue bill (most days late; ties: earliest due). */
export function oldestOverdueBill(party: PartyReceivable): Bill | null {
  let best: Bill | null = null;
  for (const b of party.bills) if (b.daysOverdue > 0 && (!best || b.daysOverdue > best.daysOverdue)) best = b;
  return best;
}

function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * One WhatsApp message per party: total overdue + oldest bill + a UPI link for the amount asked
 * (`overdue`), or the plain balance (`balance`). English, Hinglish or Hindi.
 */
export function buildPartyReminder(input: PartyReminderInput): PartyReminder {
  const { party, sender } = input;
  const lang = input.lang ?? 'en';
  const today = input.today ?? new Date();
  const overdue = overdueOf(party);
  const oldest = oldestOverdueBill(party);
  const kind: PartyReminderKind = input.kind === 'balance' || !oldest || overdue <= EPS ? 'balance' : 'overdue';
  const amount = kind === 'overdue' ? overdue : round2(Math.max(party.net, 0));
  const t = PARTY_T[lang];
  const upi = partyUpiLink(sender, amount, party.name);
  const upiLine = upi
    ? `${fillTemplate(t.upi, { link: upi })}\n${fillTemplate(t.upiId, { id: sender!.upiId! })}\n`
    : sender?.upiId
      ? `${fillTemplate(t.upiId, { id: sender.upiId })}\n`
      : '';
  const vars: Record<string, string> = {
    client: party.name?.trim() || t.there,
    business: sender?.companyName?.trim() || '',
    amount: inr(amount),
    net: party.net < -EPS ? `${inr(party.net)} Cr` : inr(party.net),
    oldest_ref: oldest?.number ?? '',
    oldest_date: oldest ? formatDate(oldest.issueDate) : '',
    days: String(oldest?.daysOverdue ?? 0),
    date: formatDate(localDayOf(today)),
    upi_line: upiLine,
    phone: sender?.companyPhone?.trim() ? `Ph: ${sender.companyPhone.trim()}` : '',
  };
  return { body: tidy(fillTemplate(t[kind], vars)), amount, overdue, oldest, upi };
}

/* ── Party reminder log (the existing `reminders` table, additive party_key) ── */

export function partyReminderRows(log: readonly ReminderRecord[], partyKey: string): ReminderRecord[] {
  return log.filter((r) => r.party_key === partyKey && r.channel !== 'snooze');
}

export function lastPartyReminder(log: readonly ReminderRecord[], partyKey: string): ReminderRecord | null {
  const rows = partyReminderRows(log, partyKey);
  return rows.length ? rows.reduce((a, b) => (a.sent_at >= b.sent_at ? a : b)) : null;
}

/** Resume day (YYYY-MM-DD) of the party's latest snooze, or null. */
export function partySnoozedUntil(log: readonly ReminderRecord[], partyKey: string): string | null {
  const days = log.filter((r) => r.party_key === partyKey && r.channel === 'snooze' && r.note).map((r) => r.note as string).sort();
  return days.length ? days[days.length - 1] : null;
}

/** Reminder stage for a party, from its oldest overdue bill (the log's `tone`). */
export function partyStage(party: PartyReceivable): ReminderStage {
  const oldest = oldestOverdueBill(party);
  return (oldest ? stageForDays(-oldest.daysOverdue) : null) ?? 'upcoming';
}

export function makePartyLogEntry(
  id: string,
  partyKey: string,
  channel: ReminderChannel,
  tone: ReminderStage,
  now: Date = new Date(),
  note = '',
): ReminderRecord {
  return { id, invoice_id: '', party_key: partyKey, channel, tone, sent_at: now.toISOString(), note };
}

/** A snooze row that keeps the party out of the queue for `days` days. */
export function makePartySnooze(id: string, partyKey: string, days: number, today: Date = new Date()): ReminderRecord {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Math.max(1, Math.round(days)));
  return makePartyLogEntry(id, partyKey, 'snooze', 'upcoming', today, localDayOf(d));
}

/* ── "Remind all overdue" / monthly balance queue ─────────────── */

export interface QueueItem {
  party: PartyReceivable;
  client?: Client;
  /** Digits-only international number for wa.me, or null (WhatsApp then asks for the contact). */
  phone: string | null;
  amount: number;
  overdue: number;
  oldestDays: number;
  lastSentAt: string | null;
}

export interface QueueResult {
  items: QueueItem[];
  /** Left out: snoozed parties, and parties already reminded inside the cool-down. */
  snoozed: number;
  recent: number;
}

export interface QueueOptions {
  kind?: PartyReminderKind;
  today?: Date;
  /** Days between two reminders to the same party (default 3; the monthly balance uses 20). */
  cooldownDays?: number;
}

const dayNumber = (day: string) => {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Math.round(new Date(y, (m || 1) - 1, d || 1).getTime() / 86400000);
};

/** Parties to message, most urgent first; one tap each in the stepper (browsers need a gesture per window). */
export function partyReminderQueue(
  report: ReceivablesReport,
  clients: readonly Client[],
  log: readonly ReminderRecord[],
  opts: QueueOptions = {},
): QueueResult {
  const kind = opts.kind ?? 'overdue';
  const today = opts.today ?? new Date();
  const todayN = dayNumber(localDayOf(today));
  const cooldown = opts.cooldownDays ?? (kind === 'balance' ? 20 : 3);
  const byId = new Map(clients.filter((c) => c.id).map((c) => [c.id as string, c]));
  const byName = new Map(clients.map((c) => [(c.name ?? '').trim().toLowerCase(), c]));
  let snoozed = 0;
  let recent = 0;
  const items: QueueItem[] = [];
  for (const party of report.parties) {
    const overdue = overdueOf(party);
    if (kind === 'overdue' ? overdue <= EPS : party.net <= EPS) continue;
    const until = partySnoozedUntil(log, party.key);
    if (until && dayNumber(until) > todayN) {
      snoozed++;
      continue;
    }
    const last = lastPartyReminder(log, party.key);
    if (last && todayN - dayNumber(isoDay(last.sent_at)) < cooldown) {
      recent++;
      continue;
    }
    const client = (party.clientId ? byId.get(party.clientId) : undefined) ?? byName.get(party.name.trim().toLowerCase());
    items.push({
      party,
      client,
      phone: normalizePhone(client?.phone),
      amount: kind === 'overdue' ? overdue : round2(party.net),
      overdue,
      oldestDays: overdue > EPS ? party.oldestOverdueDays : 0,
      lastSentAt: last?.sent_at ?? null,
    });
  }
  items.sort((a, b) =>
    kind === 'overdue'
      ? b.oldestDays - a.oldestDays || b.amount - a.amount || a.party.name.localeCompare(b.party.name)
      : b.amount - a.amount || a.party.name.localeCompare(b.party.name));
  return { items, snoozed, recent };
}

/* ── Party balance snapshot on a bill (8.5) ───────────────────── */

export interface SnapshotOptions {
  /** Paid at the counter with this bill (POS tenders); defaults to the record's `amount_paid`. */
  paid?: number;
  today?: Date;
}

/**
 * The party's balance up to the bill date without this bill, plus this bill — frozen on the record
 * at its first issue. Undefined for documents that cannot carry it and for walk-in customers who are
 * neither in the client master nor in the ledger.
 */
export function computePartyBalanceSnapshot(record: InvoiceRecord, input: BuildInput, opts: SnapshotOptions = {}): PartyBalanceSnapshot | undefined {
  if (!canCarryPartyBalance(record) || !record.client?.name?.trim()) return undefined;
  const today = opts.today ?? new Date();
  const clients = input.clients ?? [];
  const others: BuildInput = {
    ...input,
    invoices: input.invoices.filter((i) => i.id !== record.id),
    payments: input.payments.filter((p) => !record.id || p.invoice_id !== record.id),
  };
  const report = buildReceivables(others, { now: today });
  const key = partyKeyOf(record.client, clients);
  const party = report.parties.find((p) => p.key === key);
  // A walk-in name (no client id, not in the master, no ledger) gets no line at all.
  const known = party || record.client.id || clients.some((c) => clientKey(c) === key);
  if (!known) return undefined;
  const upTo = isoDay(record.issue_date) || localDayOf(today);
  const previous = party ? buildLedger(party, '', upTo).closing : 0;
  const paidRaw = opts.paid ?? record.amount_paid;
  const paid = round2(Math.max(Number(paidRaw) || 0, 0));
  return { previous: round2(previous), bill: billAmount(record), ...(paid > EPS ? { paid } : {}), as_of: localDayOf(today) };
}
