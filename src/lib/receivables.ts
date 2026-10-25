/**
 * Receivables — Tally-style party ledger and outstanding reports.
 *
 * Pure functions only (no React, no storage, no browser APIs) so everything
 * here is covered by node:test. Inputs are the persisted `invoices`,
 * `transactions` (payments) and `clients` tables.
 *
 * Accounting model (sales ledger, per party):
 *   Debit   = invoices issued
 *   Credit  = payments received + credit notes issued
 *   Balance = debit - credit  (positive = party owes us; negative = we owe
 *             them / they have paid in advance)
 *
 * Consistency guarantees, verified in tests/receivables.test.ts:
 *   party.net === ledger closing balance over the full history
 *   party.net === Σ open bills - credit notes (not allocated to a linked bill) - advances
 */

import type { Client, DocumentType, InvoiceRecord, Payment, SenderProfile } from '../types/invoice';
import { round2, num } from './invoice-calc';
import { agingBucket } from './invoice-status';
import { daysOverdue, formatMoney, formatDate } from './utils';
import { amountInWords } from './amount-in-words';
import { isoDay } from './dates';
import { csvCell, toCsv } from './csv';
import type { AdvanceRecord } from '../types/advances';
import { advanceMovements } from './advance-tax';
import { receivableTotal } from './rcm';
import { linkedCredits, type CreditLinkRow } from './amount-due';
import { effectiveDueDate } from './payment-schedule';

/** 8.100: ageing follows the earliest unpaid instalment of a payment schedule (else the due date). */
const dueOf = (inv: InvoiceRecord): string => effectiveDueDate(inv);

/* ── Types ────────────────────────────────────────────────────── */

/** A payment row. `client_id` / `client_name` are optional additive fields that
 *  let a receipt exist without an invoice (an on-account advance). */
export type ReceiptRow = Payment & { client_id?: string; client_name?: string; currency?: string };

export const AGING_BUCKETS = ['Not due', '1–30 days', '31–60 days', '61–90 days', '90+ days'] as const;
export type AgingBucketLabel = (typeof AGING_BUCKETS)[number];

export type LedgerEntryKind = 'invoice' | 'payment' | 'credit_note' | 'advance' | 'opening';

/**
 * A bill-wise opening outstanding (WP-1 `opening_bills`, `src/lib/opening-bills.ts`): owed when the
 * books began, never a document (no GST / revenue). INR only. A Dr bill ages like an invoice and is
 * settled by payment rows whose `invoice_id` is the bill id; a Cr bill is an opening credit
 * (advance) of the party.
 */
export interface OpeningBillInput {
  id: string;
  party_id?: string;
  party_name: string;
  ref_no: string;
  date: string;
  due_date: string;
  /** Rupees, > 0. */
  amount: number;
  dr_cr: 'Dr' | 'Cr';
  /** The part of a typed opening balance not split into bills (Tally "On Account"). */
  on_account?: boolean;
}

export interface LedgerEntry {
  /** yyyy-mm-dd */
  date: string;
  kind: LedgerEntryKind;
  /** Voucher / document number or payment reference. */
  ref: string;
  particulars: string;
  debit: number;
  credit: number;
  /** Running balance after this entry. */
  balance: number;
  invoiceId?: string;
  /** True when derived from invoice.amount_paid / Paid status with no payment row. */
  derived?: boolean;
}

export interface Bill {
  invoiceId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  total: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucketLabel;
  /** Additive (WP-1): an opening bill, not an invoice (`invoiceId` is the opening bill id). */
  opening?: boolean;
  /** Additive: linked credit notes allocated to this bill (`BuildInput.links`); outstanding is net of it. */
  credited?: number;
}

export interface PartyReceivable {
  key: string;
  clientId?: string;
  name: string;
  /** Open bills, oldest due date first. */
  bills: Bill[];
  /** Σ open bills. */
  gross: number;
  creditNotes: number;
  /** Advances + overpayments + on-account receipts. */
  advances: number;
  /** gross - creditNotes - advances. Negative = party is in credit. */
  net: number;
  /** Aging of bills only (credits are shown separately, as Tally does). */
  buckets: Record<AgingBucketLabel, number>;
  oldestOverdueDays: number;
  /** Chronological, all-time, with running balance. */
  entries: LedgerEntry[];
}

export interface ReceivablesReport {
  currency: string;
  parties: PartyReceivable[];
  totals: {
    gross: number;
    creditNotes: number;
    advances: number;
    net: number;
    buckets: Record<AgingBucketLabel, number>;
    overdue: number;
    billCount: number;
  };
}

export interface BuildOptions {
  /** Only documents in this currency. Default 'INR'. */
  currency?: string;
  now?: Date;
}

export interface BuildInput {
  invoices: InvoiceRecord[];
  payments: ReceiptRow[];
  clients?: Client[];
  /**
   * Advance receipts (5.3, INR only). The advance is the credit (dated when received); the payment
   * row with `advance_id` that applies it settles the bill but adds no second credit; a refund is a
   * debit. Unadjusted balances count in `advances`.
   */
  advances?: AdvanceRecord[];
  /** Additive (WP-1): bill-wise opening outstandings (INR), see `OpeningBillInput`. */
  openingBills?: OpeningBillInput[];
  /**
   * Additive: `doc_links` rows. A live credit note linked to an invoice of the same party is
   * allocated to that bill (bill-wise, as Tally does): it lowers the bill's outstanding instead of
   * sitting as an unallocated credit, and a bill it settles (status Paid) gets no invented receipt.
   * Only the unallocated part counts in `creditNotes`. Ledger entries and `net` are unchanged.
   */
  links?: CreditLinkRow[];
}

export interface Ledger {
  partyKey: string;
  name: string;
  from: string;
  to: string;
  opening: number;
  entries: LedgerEntry[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/* ── Helpers ──────────────────────────────────────────────────── */

const REVENUE_TYPES: DocumentType[] = ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY'];

/** Documents that move the sales ledger: live invoices and credit notes. */
export function isLedgerDoc(inv: Pick<InvoiceRecord, 'doc_type' | 'status'>): boolean {
  if (inv.status === 'Draft' || inv.status === 'Cancelled') return false;
  const t = inv.doc_type || 'INVOICE';
  return REVENUE_TYPES.includes(t) || t === 'CREDIT_NOTE';
}

export function isCreditNote(inv: Pick<InvoiceRecord, 'doc_type'>): boolean {
  return inv.doc_type === 'CREDIT_NOTE';
}

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Normalises 'yyyy-mm-dd', ISO timestamps and parsable text to a local yyyy-mm-dd. */
export function dateKey(value: string | undefined | null): string {
  if (!value) return '';
  return isoDay(value);
}

function nameKey(name: string | undefined): string {
  return `name:${(name ?? '').trim().toLowerCase()}`;
}

/** Stable party key: client id when known, otherwise the case-folded name. */
export function partyKeyOf(
  client: { id?: string; name?: string } | undefined,
  clients: Client[] = [],
): string {
  if (client?.id) return client.id;
  const nk = nameKey(client?.name);
  const hit = clients.find((c) => c.id && nameKey(c.name) === nk);
  return hit?.id ?? nk;
}

function emptyBuckets(): Record<AgingBucketLabel, number> {
  return { 'Not due': 0, '1–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 };
}

const KIND_ORDER: Record<LedgerEntryKind, number> = { opening: -1, invoice: 0, credit_note: 1, payment: 2, advance: 2 };

function sortEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.date !== b.e.date) return a.e.date < b.e.date ? -1 : 1;
      return KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || a.i - b.i;
    })
    .map((x) => x.e);
}

function withRunning(entries: LedgerEntry[], opening = 0): LedgerEntry[] {
  let bal = opening;
  return entries.map((e) => {
    bal = round2(bal + e.debit - e.credit);
    return { ...e, balance: bal };
  });
}

/** Distinct currencies present on ledger documents, most common first. */
export function currenciesIn(invoices: InvoiceRecord[]): string[] {
  const count = new Map<string, number>();
  for (const inv of invoices) {
    if (!isLedgerDoc(inv)) continue;
    const c = (inv.currency || 'INR').toUpperCase();
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/* ── Core build ───────────────────────────────────────────────── */

export function buildReceivables(input: BuildInput, opts: BuildOptions = {}): ReceivablesReport {
  const now = opts.now ?? new Date();
  const currency = (opts.currency ?? 'INR').toUpperCase();
  const clients = input.clients ?? [];
  // Indexed once: a per-invoice scan of the client list made this O(invoices x clients).
  const idByName = new Map<string, string>();
  const clientById = new Map<string, Client>();
  for (const c of clients) {
    if (!c.id) continue;
    clientById.set(c.id, c);
    const k = nameKey(c.name);
    if (!idByName.has(k)) idByName.set(k, c.id);
  }
  const keyOf = (c: { id?: string; name?: string } | undefined): string =>
    c?.id ?? idByName.get(nameKey(c?.name)) ?? nameKey(c?.name);

  const docs = input.invoices.filter(
    (i) => isLedgerDoc(i) && (i.currency || 'INR').toUpperCase() === currency,
  );
  const docById = new Map(docs.map((d) => [d.id, d]));

  // Live credit notes linked to a live invoice of the same party are allocated to that bill.
  const allocLinks = (input.links ?? []).filter((l) => {
    if (l.relation !== 'credit_note') return false;
    const note = docById.get(l.to_id);
    const bill = docById.get(l.from_id);
    return !!note && !!bill && isCreditNote(note) && !isCreditNote(bill) && keyOf(note.client) === keyOf(bill.client);
  });
  const creditOf = linkedCredits(allocLinks, docs);
  const allocatedNotes = new Set(allocLinks.map((l) => l.to_id));

  interface Acc {
    key: string;
    clientId?: string;
    name: string;
    entries: LedgerEntry[];
    bills: Bill[];
    creditNotes: number;
    advances: number;
  }
  const accs = new Map<string, Acc>();
  const acc = (key: string, name: string, clientId?: string): Acc => {
    let a = accs.get(key);
    if (!a) {
      a = { key, clientId, name: name || 'Unknown party', entries: [], bills: [], creditNotes: 0, advances: 0 };
      accs.set(key, a);
    } else if (!a.clientId && clientId) a.clientId = clientId;
    return a;
  };

  // Opening bills (WP-1): INR only, keyed like invoices (client id, else the name).
  const openingBills = currency === 'INR' ? (input.openingBills ?? []).filter((b) => b && b.amount > 0 && b.date) : [];
  const openingById = new Map(openingBills.map((b) => [b.id, b]));

  // Payments grouped by invoice; invoice-less receipts are on-account advances.
  const paidByInvoice = new Map<string, ReceiptRow[]>();
  const onAccount: ReceiptRow[] = [];
  for (const p of input.payments) {
    if (!(num(p.amount) > 0)) continue;
    if (p.invoice_id && (docById.has(p.invoice_id) || openingById.has(p.invoice_id))) {
      const list = paidByInvoice.get(p.invoice_id) ?? [];
      list.push(p);
      paidByInvoice.set(p.invoice_id, list);
    } else if (
      !p.invoice_id &&
      (p.client_id || p.client_name) &&
      (p.currency || 'INR').toUpperCase() === currency
    ) {
      onAccount.push(p);
    }
    // Payments pointing at a draft / cancelled / unknown document are ignored.
  }

  for (const inv of docs) {
    const key = keyOf(inv.client);
    const a = acc(key, inv.client?.name ?? '', inv.client?.id);
    // Outward reverse charge: only the taxable value is receivable (src/lib/rcm.ts).
    const total = round2(receivableTotal(inv));
    const issue = dateKey(inv.issue_date) || dateKey(inv.created_at);

    if (isCreditNote(inv)) {
      a.entries.push({
        date: issue, kind: 'credit_note', ref: inv.invoice_number,
        particulars: 'Credit Note', debit: 0, credit: total, balance: 0, invoiceId: inv.id,
      });
      // An allocated note is settled against its bill below (only an unallocated rest stays a credit).
      if (!allocatedNotes.has(inv.id)) a.creditNotes = round2(a.creditNotes + total);
      continue;
    }

    a.entries.push({
      date: issue, kind: 'invoice', ref: inv.invoice_number,
      particulars: inv.po_number ? `Sales Invoice (PO ${inv.po_number})` : 'Sales Invoice',
      debit: total, credit: 0, balance: 0, invoiceId: inv.id,
    });

    let paid = 0;
    for (const p of paidByInvoice.get(inv.id) ?? []) {
      const amt = round2(num(p.amount));
      paid = round2(paid + amt);
      if (p.advance_id) {
        // The money arrived with the advance (already a credit): show the adjustment, move nothing.
        a.entries.push({
          date: dateKey(p.date) || issue, kind: 'advance', ref: p.reference || inv.invoice_number,
          particulars: `Advance ${p.reference || ''} adjusted against ${inv.invoice_number} (${formatMoney(amt, currency)})`.replace(/\s+/g, ' '),
          debit: 0, credit: 0, balance: 0, invoiceId: inv.id,
        });
        continue;
      }
      a.entries.push({
        date: dateKey(p.date) || issue, kind: 'payment',
        ref: p.reference || inv.invoice_number,
        particulars: `Receipt – ${p.method || 'Payment'} (against ${inv.invoice_number})`,
        debit: 0, credit: amt, balance: 0, invoiceId: inv.id,
      });
    }
    // TDS the customer withholds is settled with the tax office, never paid to us: it
    // clears that part of the invoice (as Tally does with a TDS journal) so the party
    // is not chased for it and the dashboard's outstanding (total - TDS - paid) agrees.
    const tds = round2(Math.min(Math.max(num(inv.tds_amount), 0), total));
    if (tds > 0) {
      a.entries.push({
        date: issue, kind: 'payment', ref: inv.invoice_number,
        particulars: `TDS withheld by customer (${inv.invoice_number})`,
        debit: 0, credit: tds, balance: 0, invoiceId: inv.id, derived: true,
      });
      paid = round2(paid + tds);
    }
    // Legacy rows: amount_paid or a Paid status with no matching payment rows. A Paid bill is
    // settled by receipts AND its linked credit notes: the credited part is never a receipt.
    const credited = creditOf.get(inv.id) ?? 0;
    const claimed = inv.status === 'Paid'
      ? round2(Math.max(total - credited, num(inv.amount_paid) + tds))
      : round2(num(inv.amount_paid) + tds);
    const missing = round2(claimed - paid);
    if (missing > 0.004) {
      a.entries.push({
        date: dateKey(inv.updated_at) || issue, kind: 'payment', ref: inv.invoice_number,
        particulars: `Receipt – recorded on invoice (${inv.invoice_number})`,
        debit: 0, credit: missing, balance: 0, invoiceId: inv.id, derived: true,
      });
      paid = round2(paid + missing);
    }

    const open = round2(Math.max(total - paid, 0));
    // Linked credit notes settle what receipts left open; any rest is an unallocated credit.
    const alloc = round2(Math.min(credited, open));
    if (credited - alloc > 0.004) a.creditNotes = round2(a.creditNotes + credited - alloc);
    const outstanding = round2(open - alloc);
    const excess = round2(Math.max(paid - total, 0));
    if (excess > 0) a.advances = round2(a.advances + excess);
    if (outstanding > 0.004) {
      a.bills.push({
        invoiceId: inv.id, number: inv.invoice_number,
        issueDate: issue, dueDate: dateKey(dueOf(inv)) || issue,
        total, paid, outstanding,
        daysOverdue: daysOverdue(dueOf(inv), now),
        bucket: agingBucket(dueOf(inv), now) as AgingBucketLabel,
        ...(alloc > 0 ? { credited: alloc } : {}),
      });
    }
  }

  for (const b of openingBills) {
    const key = keyOf({ id: b.party_id, name: b.party_name });
    const a = acc(key, b.party_name, b.party_id);
    const amount = round2(b.amount);
    const label = b.on_account ? 'Opening balance – on account' : `Opening bill ${b.ref_no}`;
    if (b.dr_cr === 'Cr') {
      a.entries.push({ date: b.date, kind: 'opening', ref: b.ref_no, particulars: `${label} (credit)`, debit: 0, credit: amount, balance: 0 });
      a.advances = round2(a.advances + amount);
      continue;
    }
    a.entries.push({ date: b.date, kind: 'opening', ref: b.ref_no, particulars: label, debit: amount, credit: 0, balance: 0, invoiceId: b.id });
    let paid = 0;
    for (const p of paidByInvoice.get(b.id) ?? []) {
      const amt = round2(num(p.amount));
      paid = round2(paid + amt);
      a.entries.push({
        date: dateKey(p.date) || b.date, kind: 'payment', ref: p.reference || b.ref_no,
        particulars: `Receipt – ${p.method || 'Payment'} (against ${b.ref_no})`,
        debit: 0, credit: amt, balance: 0, invoiceId: b.id,
      });
    }
    const outstanding = round2(Math.max(amount - paid, 0));
    const excess = round2(Math.max(paid - amount, 0));
    if (excess > 0) a.advances = round2(a.advances + excess);
    if (outstanding > 0.004) {
      const due = b.due_date || b.date;
      a.bills.push({
        invoiceId: b.id, number: b.ref_no, issueDate: b.date, dueDate: due,
        total: amount, paid, outstanding,
        daysOverdue: daysOverdue(due, now),
        bucket: agingBucket(due, now) as AgingBucketLabel,
        opening: true,
      });
    }
  }

  for (const p of onAccount) {
    const known = p.client_id ? clientById.get(p.client_id) : undefined;
    const name = p.client_name ?? known?.name ?? '';
    const key = keyOf({ id: p.client_id, name });
    const a = acc(key, name, p.client_id);
    const amt = round2(num(p.amount));
    a.entries.push({
      date: dateKey(p.date), kind: 'advance', ref: p.reference || 'On account',
      particulars: `Advance receipt – ${p.method || 'Payment'}${p.note ? ` (${p.note})` : ''}`,
      debit: 0, credit: amt, balance: 0,
    });
    a.advances = round2(a.advances + amt);
  }

  // Advance receipts (5.3): received = credit, refund = debit, unadjusted balance = advance.
  if (currency === 'INR' && input.advances?.length) {
    const unadjusted = new Map<string, number>();
    for (const m of advanceMovements(input.advances, input.payments, input.invoices)) {
      const adv = input.advances.find((x) => x.id === m.advanceId);
      const key = keyOf({ id: adv?.client?.id, name: adv?.client?.name });
      const a = acc(key, adv?.client?.name ?? m.party, adv?.client?.id);
      if (m.kind === 'received') {
        a.entries.push({
          date: m.date, kind: 'advance', ref: m.number,
          particulars: `Advance receipt – ${m.method || 'Payment'}${m.ref ? ` (${m.ref})` : ''}`,
          debit: 0, credit: m.gross, balance: 0,
        });
      } else if (m.kind === 'refunded') {
        a.entries.push({
          date: m.date, kind: 'advance', ref: m.ref || m.number,
          particulars: `Refund of advance ${m.number}`, debit: m.gross, credit: 0, balance: 0,
        });
      }
      const sign = m.kind === 'received' ? 1 : -1;
      unadjusted.set(key, round2((unadjusted.get(key) ?? 0) + sign * m.gross));
    }
    for (const [key, open] of unadjusted) {
      const a = accs.get(key);
      if (a && open > 0.004) a.advances = round2(a.advances + open);
    }
  }

  const totals: ReceivablesReport['totals'] = {
    gross: 0, creditNotes: 0, advances: 0, net: 0, buckets: emptyBuckets(), overdue: 0, billCount: 0,
  };

  const parties: PartyReceivable[] = [...accs.values()].map((a) => {
    const bills = [...a.bills].sort((x, y) => (x.dueDate < y.dueDate ? -1 : x.dueDate > y.dueDate ? 1 : 0));
    const buckets = emptyBuckets();
    let gross = 0;
    for (const b of bills) {
      buckets[b.bucket] = round2(buckets[b.bucket] + b.outstanding);
      gross = round2(gross + b.outstanding);
    }
    return {
      key: a.key, clientId: a.clientId, name: a.name, bills, gross,
      creditNotes: a.creditNotes, advances: a.advances,
      net: round2(gross - a.creditNotes - a.advances),
      buckets,
      oldestOverdueDays: bills.reduce((m, b) => Math.max(m, b.daysOverdue), 0),
      entries: withRunning(sortEntries(a.entries)),
    };
  });

  for (const p of parties) {
    totals.gross = round2(totals.gross + p.gross);
    totals.creditNotes = round2(totals.creditNotes + p.creditNotes);
    totals.advances = round2(totals.advances + p.advances);
    totals.net = round2(totals.net + p.net);
    totals.billCount += p.bills.length;
    for (const b of AGING_BUCKETS) totals.buckets[b] = round2(totals.buckets[b] + p.buckets[b]);
  }
  totals.overdue = round2(totals.gross - totals.buckets['Not due']);

  parties.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
  return { currency, parties, totals };
}

/* ── Ledger for a date range ──────────────────────────────────── */

/**
 * Statement for one party. Everything dated before `from` rolls into the
 * opening balance; entries dated from..to (inclusive) are listed with a
 * running balance. Empty `from` / `to` mean unbounded.
 */
export function buildLedger(party: PartyReceivable, from = '', to = ''): Ledger {
  let opening = 0;
  const inRange: LedgerEntry[] = [];
  for (const e of party.entries) {
    if (from && e.date < from) opening = round2(opening + e.debit - e.credit);
    else if (!to || e.date <= to) inRange.push(e);
  }
  const entries = withRunning(inRange, opening);
  const totalDebit = round2(entries.reduce((s, e) => s + e.debit, 0));
  const totalCredit = round2(entries.reduce((s, e) => s + e.credit, 0));
  return {
    partyKey: party.key, name: party.name, from, to, opening, entries,
    totalDebit, totalCredit, closing: round2(opening + totalDebit - totalCredit),
  };
}

/* ── Rankings ─────────────────────────────────────────────────── */

/** Parties that owe money, largest first. */
export function topDebtors(report: ReceivablesReport, limit = 5): PartyReceivable[] {
  return report.parties.filter((p) => p.net > 0).sort((a, b) => b.net - a.net).slice(0, limit);
}

/** Share (0-100) of a party's net within everything owed to us. */
export function debtorShare(report: ReceivablesReport, party: PartyReceivable): number {
  const owed = report.parties.reduce((s, p) => s + Math.max(p.net, 0), 0);
  return owed > 0 ? round2((Math.max(party.net, 0) / owed) * 100) : 0;
}

/* ── Collections ──────────────────────────────────────────────── */

export interface MonthRow {
  /** yyyy-mm */
  month: string;
  billed: number;
  credited: number;
  received: number;
  /** received / (billed - credited) in percent; null when nothing was billed. */
  efficiency: number | null;
}

/** Last `months` calendar months ending at `now`'s month (oldest first). */
export function monthlyCollections(report: ReceivablesReport, months = 12, now: Date = new Date()): MonthRow[] {
  const rows: MonthRow[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    rows.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      billed: 0, credited: 0, received: 0, efficiency: null,
    });
  }
  const idx = new Map(rows.map((r) => [r.month, r]));
  for (const p of report.parties) {
    for (const e of p.entries) {
      const r = idx.get(e.date.slice(0, 7));
      if (!r) continue;
      if (e.kind === 'invoice') r.billed = round2(r.billed + e.debit);
      else if (e.kind === 'credit_note') r.credited = round2(r.credited + e.credit);
      else if (e.kind !== 'opening') r.received = round2(r.received + e.credit);
    }
  }
  for (const r of rows) {
    const net = r.billed - r.credited;
    r.efficiency = net > 0 ? round2((r.received / net) * 100) : null;
  }
  return rows;
}

/** Overall collection efficiency (%) across month rows. */
export function overallEfficiency(rows: MonthRow[]): number | null {
  const net = rows.reduce((s, r) => s + r.billed - r.credited, 0);
  const rec = rows.reduce((s, r) => s + r.received, 0);
  return net > 0 ? round2((rec / net) * 100) : null;
}

/**
 * Days Sales Outstanding over a trailing window:
 *   DSO = (net receivables / net credit sales in window) × window days,
 * rounded to one decimal. Null when there were no sales in the window.
 */
export function computeDso(report: ReceivablesReport, windowDays = 90, now: Date = new Date()): number | null {
  const end = localIso(now);
  const start = localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - windowDays + 1));
  let sales = 0;
  for (const p of report.parties) {
    for (const e of p.entries) {
      if (e.date < start || e.date > end) continue;
      if (e.kind === 'invoice') sales += e.debit;
      else if (e.kind === 'credit_note') sales -= e.credit;
    }
  }
  if (sales <= 0) return null;
  const receivables = Math.max(report.totals.net, 0);
  return Math.round((receivables / sales) * windowDays * 10) / 10;
}

/* ── Export: CSV ──────────────────────────────────────────────── */

export { csvCell, toCsv };

export function statementCsv(ledger: Ledger): string {
  const rows: (string | number)[][] = [
    ['Date', 'Voucher', 'Particulars', 'Debit', 'Credit', 'Balance (Dr+/Cr-)'],
    [ledger.from, '', 'Opening balance', '', '', ledger.opening],
  ];
  for (const e of ledger.entries) {
    rows.push([e.date, e.ref, e.particulars, e.debit || '', e.credit || '', e.balance]);
  }
  rows.push(['', '', 'Total', ledger.totalDebit, ledger.totalCredit, '']);
  rows.push([ledger.to, '', 'Closing balance', '', '', ledger.closing]);
  return toCsv(rows);
}

export function agingCsv(report: ReceivablesReport): string {
  const rows: (string | number)[][] = [
    ['Party', ...AGING_BUCKETS, 'Bills total', 'Credit notes', 'Advances', 'Net outstanding'],
  ];
  for (const p of report.parties) {
    rows.push([p.name, ...AGING_BUCKETS.map((b) => p.buckets[b]), p.gross, p.creditNotes, p.advances, p.net]);
  }
  const t = report.totals;
  rows.push(['Total', ...AGING_BUCKETS.map((b) => t.buckets[b]), t.gross, t.creditNotes, t.advances, t.net]);
  return toCsv(rows);
}

/* ── Export: plain-text statement (WhatsApp / email) ──────────── */

export interface StatementTextInput {
  sender: Pick<SenderProfile, 'companyName' | 'upiId' | 'bankName' | 'accountNumber' | 'ifsc'> | null;
  party: PartyReceivable;
  ledger: Ledger;
  currency?: string;
  /** Max ledger lines to list (most recent). */
  maxLines?: number;
}

export function buildStatementText(input: StatementTextInput): string {
  const { sender, party, ledger } = input;
  const cur = input.currency ?? 'INR';
  const sym = cur === 'INR' ? '₹' : `${cur} `;
  const m = (n: number) => `${sym}${formatMoney(Math.abs(n), cur)}`;
  const dir = (n: number) => (n > 0.004 ? ' Dr' : n < -0.004 ? ' Cr' : '');
  const max = input.maxLines ?? 10;

  const lines: string[] = [];
  lines.push(`*Statement of Account – ${sender?.companyName || 'Statement'}*`);
  lines.push(`Party: ${party.name}`);
  const period = ledger.from || ledger.to
    ? `${ledger.from ? formatDate(ledger.from) : 'Beginning'} to ${ledger.to ? formatDate(ledger.to) : 'date'}`
    : 'All transactions';
  lines.push(`Period: ${period}`);
  lines.push('');
  lines.push(`Opening balance: ${m(ledger.opening)}${dir(ledger.opening)}`);
  lines.push(`Billed: ${m(ledger.totalDebit)}`);
  lines.push(`Received / credited: ${m(ledger.totalCredit)}`);
  lines.push(`*Closing balance: ${m(ledger.closing)}${dir(ledger.closing)}*`);

  if (ledger.entries.length) {
    lines.push('');
    lines.push('Recent entries:');
    for (const e of ledger.entries.slice(-max)) {
      const amt = e.debit > 0 ? `+${m(e.debit)}` : `-${m(e.credit)}`;
      lines.push(`• ${formatDate(e.date)} ${e.ref} ${amt}`);
    }
  }

  if (party.bills.length) {
    lines.push('');
    lines.push('Open bills:');
    for (const b of party.bills) {
      const tail = b.daysOverdue > 0 ? `${b.daysOverdue} days overdue` : `due ${formatDate(b.dueDate)}`;
      lines.push(`• ${b.number}: ${m(b.outstanding)} (${tail})`);
    }
  }

  lines.push('');
  if (party.net > 0.004) {
    const overdue = party.bills.filter((b) => b.daysOverdue > 0).reduce((s, b) => s + b.outstanding, 0);
    lines.push(`Amount payable: *${m(party.net)}*${overdue > 0 ? ` (overdue: ${m(overdue)})` : ''}`);
    if (sender?.upiId) lines.push(`UPI: ${sender.upiId}`);
    if (sender?.accountNumber) {
      lines.push(
        `Bank: ${sender.bankName || ''} A/c ${sender.accountNumber}${sender.ifsc ? ` IFSC ${sender.ifsc}` : ''}`
          .replace(/\s+/g, ' ').trim(),
      );
    }
    lines.push('Kindly arrange payment at the earliest. Thank you.');
  } else if (party.net < -0.004) {
    lines.push(`Credit balance in your favour: ${m(party.net)}`);
  } else {
    lines.push('No amount is outstanding. Thank you!');
  }
  return lines.join('\n');
}

/** Short axis/tile label: 12,50,000 -> "12.5L", 3,20,00,000 -> "3.2Cr" (INR); 1.2K / 3.4M otherwise. */
export function compactMoney(n: number, currency = 'INR'): string {
  const abs = Math.abs(n);
  const trim = (v: number) => String(Math.round(v * 100) / 100);
  const sign = n < 0 ? '-' : '';
  if (currency.toUpperCase() === 'INR') {
    if (abs >= 1e7) return `${sign}${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${sign}${trim(abs / 1e5)}L`;
  } else {
    if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}B`;
    if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  }
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}K`;
  return `${sign}${trim(abs)}`;
}

/** Rounds a chart maximum up to 1/2/5 × 10^n so axis ticks land on tidy numbers. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const f = value / pow;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return step * pow;
}

/** Closing balance in words, e.g. "Rupees Ten Thousand Only (Dr)". */
export function closingInWords(closing: number, currency = 'INR'): string {
  if (Math.abs(closing) < 0.005) return 'Nil';
  return `${amountInWords(Math.abs(closing), currency)} (${closing > 0 ? 'Dr' : 'Cr'})`;
}
