/**
 * Daily khata loop (8A) — the data-layer half: loading the party ledger, "₹ Given" credit entries,
 * the party reminder log and the bill's balance snapshot. Pure maths lives in `khata.ts`; the quick
 * receipt is `savePartyReceipt` in `bill-allocation.ts` (the existing all-or-nothing receipt path).
 */
import type { Client, InvoiceRecord, PartyBalanceSnapshot, SenderProfile } from '../types/invoice';
import type { AdvanceRecord } from '../types/advances';
import { localDb } from './localDb';
import { getTable, peekTable, setTable, generateId } from './storage';
import { buildReceivables, posRefunds, type BuildInput, type ReceiptRow, type ReceivablesReport } from './receivables';
import type { PosReturn } from './pos-returns';
import type { CreditLinkRow } from './amount-due';
import { loadReceivableOpeningBills } from './opening-bills';
import { computePartyBalanceSnapshot, type SnapshotOptions } from './khata';
import { billAmount, nextPartyBalanceSnapshot } from './party-balance';
import { REMINDERS_TABLE, type ReminderRecord } from './reminders';
import { blankItem, clientToParty, makeDraft } from '../store/invoice-defaults';
import { calcInputFromRecord, calculateInvoice, round2 } from './invoice-calc';
import { addDaysInput } from './utils';
import { localDayOf } from './dates';

/** Everything `buildReceivables` needs, read from storage (INR opening bills and advances included). */
export function loadReceivablesInput(): BuildInput {
  const clients = localDb.clients.getAll();
  return {
    invoices: localDb.invoices.getAll(),
    payments: localDb.payments.getAll() as ReceiptRow[],
    clients,
    advances: getTable<AdvanceRecord>('advances'),
    // Credit notes allocated to the invoice they were raised against (src/lib/amount-due.ts).
    links: getTable<CreditLinkRow>('doc_links'),
    openingBills: loadReceivableOpeningBills(clients),
    // POS refunds / exchanges pay a credit note back (QA-3 F2).
    refunds: posRefunds(getTable<PosReturn>('pos_returns')),
  };
}

export function loadKhataReport(now: Date = new Date()): { input: BuildInput; report: ReceivablesReport } {
  const input = loadReceivablesInput();
  return { input, report: buildReceivables(input, { now }) };
}

/** The balance snapshot for a bill being issued (8.5); see `nextPartyBalanceSnapshot`. */
export function partyBalanceSnapshotFor(record: InvoiceRecord, opts: SnapshotOptions = {}): PartyBalanceSnapshot | undefined {
  return computePartyBalanceSnapshot(record, sharedReceivablesInput(), opts);
}

/**
 * PERF-1 (save path): `loadReceivablesInput` over the SHARED parsed tables — no row copies. Only for
 * readers that never change the rows (`buildReceivables` builds its own report objects).
 */
function sharedReceivablesInput(): BuildInput {
  const clients = peekTable<Client>('clients') as Client[];
  return {
    invoices: peekTable<InvoiceRecord>('invoices') as InvoiceRecord[],
    payments: peekTable<ReceiptRow>('transactions') as ReceiptRow[],
    clients,
    advances: peekTable<AdvanceRecord>('advances') as AdvanceRecord[],
    links: peekTable<CreditLinkRow>('doc_links') as CreditLinkRow[],
    openingBills: loadReceivableOpeningBills(clients),
    refunds: posRefunds(peekTable<PosReturn>('pos_returns') as PosReturn[]),
  };
}

/**
 * R6-C5 (8.7): the snapshot for a document issued OUTSIDE the editor (a recurring run, a batch run, a late-fee or a
 * converted document issued directly, `issueDraft`). Same rule as the editor's save (`nextPartyBalanceSnapshot`):
 * a draft takes none, an issued document keeps the one it has, a document being issued now takes a fresh one.
 * `cache` (party key → snapshot) gives every document of a party in one run the same "previous balance" — the
 * balance before the run — so a batch never counts its own earlier bills as "previous" (R2-B1, one per party).
 */
export function withIssueSnapshot(record: InvoiceRecord, stored?: InvoiceRecord, cache?: Map<string, PartyBalanceSnapshot | null>): InvoiceRecord {
  const key = cache ? (record.client?.id || record.client?.name?.trim().toLowerCase() || '') : '';
  const snap = nextPartyBalanceSnapshot(record, stored, () => {
    if (cache && key && cache.has(key)) {
      const hit = cache.get(key);
      return hit ? { ...hit, bill: billAmount(record) } : undefined;
    }
    const fresh = partyBalanceSnapshotFor(record);
    if (cache && key) cache.set(key, fresh ?? null);
    return fresh;
  });
  if (snap) return { ...record, party_balance_snapshot: snap };
  if (!record.party_balance_snapshot) return record;
  const { party_balance_snapshot: _drop, ...rest } = record;
  void _drop;
  return rest as InvoiceRecord;
}

/**
 * R6-C5: issue a stored draft without opening the editor (status Sent; an unnumbered recurring / batch draft takes its
 * number in `localDb`), freezing its party-balance snapshot at this moment. Roles, period lock, approval and audit
 * are `localDb.invoices.save`'s.
 */
export function issueDraft(id: string): InvoiceRecord {
  const stored = localDb.invoices.getById(id);
  if (!stored) throw new Error('Document not found.');
  if (stored.status !== 'Draft') return stored;
  return localDb.invoices.save(withIssueSnapshot({ ...stored, status: 'Sent' }, stored));
}

/* ── "₹ Given" (credit without items) ─────────────────────────── */

/**
 * How "₹ Given" works for this profile (8.2, documented in docs/features/khata.md):
 *  - `bos`: a composition dealer — a one-line **Bill of Supply** (no tax, Rule 49 declaration).
 *  - `plain`: no GSTIN on the profile — a one-line invoice with GST off (no tax document is implied).
 *  - `editor`: a regular GST registrant — the invoice editor opens with the party filled in, because
 *    a taxable supply needs a proper tax invoice (HSN, rate, place of supply); the app never invents
 *    a non-GST "credit memo" for a registrant.
 */
export type GivenMode = 'bos' | 'plain' | 'editor';

export function givenModeFor(sender: Pick<SenderProfile, 'gst_scheme' | 'companyGstin'> | null | undefined): GivenMode {
  if (sender?.gst_scheme === 'composition') return 'bos';
  if (!sender?.companyGstin?.trim()) return 'plain';
  return 'editor';
}

export interface CreditGivenInput {
  client: Client;
  /** Rupees, > 0. */
  amount: number;
  /** Line text, e.g. "Groceries" (defaults to "Goods on credit"). */
  note?: string;
  /** Local day (YYYY-MM-DD), default today. */
  date?: string;
}

/**
 * Save a one-line credit entry for a composition / non-GST profile through `localDb.invoices.save`
 * (roles, period lock, numbering, audit), with the party balance snapshot. Refuses for a GST
 * registrant (use the editor).
 */
export function recordCreditGiven(input: CreditGivenInput): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile();
  const mode = givenModeFor(sender);
  if (mode === 'editor') throw new Error('A GST-registered profile issues a tax invoice: open the invoice editor.');
  const amount = round2(Number(input.amount) || 0);
  if (!(amount > 0)) throw new Error('Enter an amount above zero.');
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : localDayOf(new Date());
  const draft = makeDraft({ settings, sender, docType: mode === 'bos' ? 'BILL_OF_SUPPLY' : 'INVOICE', templateId: localDb.template.get() });
  const { custom_fields: _cf, ...party } = clientToParty(input.client);
  void _cf;
  const days = Number(input.client.credit_days);
  const item = { ...blankItem(0), name: input.note?.trim() || 'Goods on credit', type: 'Goods' as const, quantity: 1, rate: amount, tax_rate: 0, amount };
  const base: InvoiceRecord = {
    ...draft,
    issue_date: date,
    due_date: addDaysInput(days > 0 ? Math.round(days) : Number(settings.defaultDueDays ?? 14) || 0, date),
    client: { ...draft.client, ...party, ...(input.client.id ? { id: input.client.id } : {}) },
    items: [item],
    gst_mode: 'NONE',
    tax_rate: 0,
    currency: 'INR',
    status: 'Sent',
    notes: draft.notes,
  };
  const totals = calculateInvoice(calcInputFromRecord(base));
  const record: InvoiceRecord = {
    ...base,
    subtotal: totals.subtotal, discount_amount: totals.discount_amount, taxable_value: totals.taxable_value,
    cgst_amount: totals.cgst_amount, sgst_amount: totals.sgst_amount, igst_amount: totals.igst_amount,
    tax_amount: totals.tax_amount, round_off: totals.round_off, total: totals.total, balance_due: totals.balance_due,
    cess_amount: totals.cess_amount, tcs_amount: totals.tcs_amount, tds_amount: totals.tds_amount,
  };
  const snap = partyBalanceSnapshotFor(record);
  if (snap) record.party_balance_snapshot = snap;
  return localDb.invoices.save(record);
}

/* ── Party reminder log ───────────────────────────────────────── */

export function loadReminderLog(): ReminderRecord[] {
  return getTable<ReminderRecord>(REMINDERS_TABLE);
}

/** Append rows to the existing `reminders` table (party rows carry `party_key`). */
export function appendReminders(rows: ReminderRecord[]): void {
  if (!rows.length) return;
  setTable(REMINDERS_TABLE, [...getTable<ReminderRecord>(REMINDERS_TABLE), ...rows]);
}

export const newId = generateId;
