/**
 * Bulk bad-debt write-off (8G, 8.106). Writing off an invoice's open balance records a payment row
 * flagged `write_off` (method "Written off") through `localDb.payments.record`, so the period lock,
 * approvals, the invoice's paid / status and the audit log behave exactly like a receipt. It is not
 * money: cash books, payment-mode reports and receipt numbers skip it, and the double-entry ledger
 * posts Dr Other expenses (bad debts) / Cr Sundry debtors. GST already paid is not reversed here —
 * a working paper; verify any GST relief with your CA.
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { audit } from './audit';
import { requireAccess } from './access';
import { round2 } from './invoice-calc';
import { localDb } from './localDb';
import { lockState } from './period-lock';
import { amountDue, linkedCredits, type CreditLinkRow } from './amount-due';
import { generateId, getTable, peekTable, setTable } from './storage';
import { withTablesRollback } from './table-txn';
import { getIndianFY } from './invoice-number';
import { saveVoucher } from './ledger/vouchers';
import { A } from './ledger/accounts';
import { toCsv } from './csv';

export const WRITE_OFF_METHOD = 'Written off';

export const isWriteOff = (p: Pick<Payment, 'write_off' | 'method'> | null | undefined): boolean => !!p?.write_off;

const WRITABLE = new Set(['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY']);

/** Live credit notes (incl. financial notes) linked to each bill: invoice id → amount (`amount-due.ts`). */
export function creditsByBill(): Map<string, number> {
  return linkedCredits(peekTable<CreditLinkRow>('doc_links'), peekTable<InvoiceRecord>('invoices'));
}

/**
 * QA5 F2: what a write-off settles — the true amount due (receipts, TDS, linked credit notes and FCNs applied),
 * the same `amountDue` the receivables and the dialog show, never the gross `total − paid`.
 */
export function writeOffAmount(inv: Pick<InvoiceRecord, 'id' | 'status'> & Partial<InvoiceRecord>, credits: ReadonlyMap<string, number> = creditsByBill()): number {
  return round2(amountDue(inv as InvoiceRecord, credits.get(inv.id)));
}

/** Why an invoice cannot be written off ('' = it can). Pass `credits` (`creditsByBill`) when checking many bills. */
export function writeOffBlock(inv: Pick<InvoiceRecord, 'id' | 'doc_type' | 'status'> & Partial<InvoiceRecord>, credits?: ReadonlyMap<string, number>): '' | 'type' | 'status' | 'nothing' {
  if (!WRITABLE.has(inv.doc_type)) return 'type';
  if (inv.status === 'Draft' || inv.status === 'Cancelled' || inv.status === 'Paid') return inv.status === 'Paid' ? 'nothing' : 'status';
  if (!(writeOffAmount(inv, credits) > 0.004)) return 'nothing';
  return '';
}

export interface WriteOffResult {
  done: { id: string; number: string; amount: number }[];
  skipped: { id: string; number: string; reason: string }[];
  total: number;
}

/** Writes off the open balance of each invoice (one payment row each), then one summary audit row. Owner only (R2-A3). */
export function bulkWriteOff(ids: readonly string[], opts: { date: string; reason: string }): WriteOffResult {
  requireAccess('payment.record');
  // R2-A3 (6): writing off a bill is as final as deleting an issued one.
  requireAccess('doc.deleteIssued');
  const out: WriteOffResult = { done: [], skipped: [], total: 0 };
  for (const id of ids) {
    const inv = localDb.invoices.getById(id);
    if (!inv) continue;
    // Fresh credits per bill: an earlier write-off in this run never changes another bill's credits.
    const credits = creditsByBill();
    const block = writeOffBlock(inv, credits);
    if (block) {
      out.skipped.push({ id, number: inv.invoice_number, reason: block });
      continue;
    }
    const amount = writeOffAmount(inv, credits);
    try {
      localDb.payments.record({ invoiceId: id, amount, method: WRITE_OFF_METHOD, date: opts.date, note: opts.reason || 'Bad debt written off', writeOff: true });
      out.done.push({ id, number: inv.invoice_number, amount });
      out.total = round2(out.total + amount);
    } catch (err) {
      out.skipped.push({ id, number: inv.invoice_number, reason: (err as Error).message });
    }
  }
  if (out.done.length) {
    try {
      audit.record({
        entity: 'payment',
        entity_id: out.done.map((d) => d.id).join(','),
        action: 'create',
        doc_number: out.done.map((d) => d.number).join(', ').slice(0, 200),
        summary: `Bulk write-off of ${out.done.length} invoice(s), ₹${out.total.toFixed(2)}${opts.reason ? `: ${opts.reason}` : ''}`,
      });
    } catch {
      /* logging never breaks a write-off */
    }
  }
  return out;
}

/* ── R2-A3: single write-off, register, recovery ───────────────────────────────────────────────────
 * Built on the 8G `write_off` payment flag. A write-off is reversed (owner only) by removing its row.
 * Recovery of money from a written-off bill:
 *   same FY     the write-off row is reduced by the amount and the money is recorded as a normal receipt
 *               (the bill's books are as if that part was never written off);
 *   earlier FY  the closed year is left alone: a Receipt voucher Dr Cash / Bank, Cr "Bad debts recovered"
 *               (other income) is posted through `ledger/vouchers.ts`;
 *   same FY, bill or write-off inside the period lock (QA5 F11)
 *               posted like an earlier FY (voucher dated the day the money came in), so the locked month is
 *               never rewritten.
 * Both are logged in `write_off_recoveries` so the register shows what was recovered. Working papers —
 * GST on bad debts is not reversed (there is no output-tax relief for bad debts); income-tax treatment
 * (Sec 36(1)(vii) / 41(4)) — verify with your CA.
 */

export const WRITE_OFF_RECOVERIES_TABLE = 'write_off_recoveries';

export interface WriteOffRecovery {
  id: string;
  invoice_id: string;
  invoice_number: string;
  party_name: string;
  amount: number;
  /** Local day the money came in. */
  date: string;
  /** FY label of the recovery (e.g. 26-27). */
  fy: string;
  /** `locked_period`: same FY, but the bill / write-off date is inside the period lock (posted like `prior_fy`). */
  mode: 'same_fy' | 'prior_fy' | 'locked_period';
  /** same_fy: the receipt row recorded; prior_fy / locked_period: the Receipt voucher. */
  receipt_id?: string;
  voucher_id?: string;
  method?: string;
  created_at: string;
}

/** Write off one bill (owner, reason and date required; the date must be in an open period). */
export function writeOffBill(id: string, opts: { date: string; reason: string }): WriteOffResult {
  if (!opts.reason?.trim()) throw new Error('Give a reason for the write-off.');
  const r = bulkWriteOff([id], opts);
  if (!r.done.length && r.skipped.length) throw new Error(r.skipped[0].reason === 'nothing' ? 'Nothing is open on this bill.' : r.skipped[0].reason);
  return r;
}

/** Undo a write-off (owner only): its payment row is removed and the bill is open again. */
export function reverseWriteOff(paymentId: string): void {
  requireAccess('doc.deleteIssued');
  const row = localDb.payments.getAll().find((p) => p.id === paymentId);
  if (!row || !row.write_off) throw new Error('That is not a write-off.');
  localDb.payments.remove(paymentId);
}

export interface WriteOffRegisterRow {
  invoiceId: string;
  number: string;
  party: string;
  partyKey: string;
  /** Latest write-off date. */
  date: string;
  reason: string;
  /** Written off in total (what is written off now + what was recovered in the same FY). */
  writtenOff: number;
  recovered: number;
  /** Still written off and not recovered. */
  net: number;
  paymentIds: string[];
}

/** Pure: the write-off register from payment rows, the invoices and the recoveries log. */
export function writeOffRegister(invoices: readonly InvoiceRecord[], payments: readonly Payment[], recoveries: readonly WriteOffRecovery[]): WriteOffRegisterRow[] {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const rows = new Map<string, WriteOffRegisterRow>();
  const row = (invoiceId: string, fallbackNumber = '', fallbackParty = '') => {
    let r = rows.get(invoiceId);
    if (!r) {
      const inv = byId.get(invoiceId);
      r = {
        invoiceId, number: inv?.invoice_number ?? fallbackNumber, party: inv?.client?.name ?? fallbackParty,
        partyKey: inv?.client?.id || `name:${(inv?.client?.name ?? fallbackParty).trim().toLowerCase()}`,
        date: '', reason: '', writtenOff: 0, recovered: 0, net: 0, paymentIds: [],
      };
      rows.set(invoiceId, r);
    }
    return r;
  };
  for (const p of payments) {
    if (!p.write_off) continue;
    const r = row(p.invoice_id);
    r.writtenOff = round2(r.writtenOff + (Number(p.amount) || 0));
    r.paymentIds.push(p.id);
    if (p.date >= r.date) {
      r.date = p.date;
      r.reason = p.note ?? '';
    }
  }
  for (const rec of recoveries) {
    const r = row(rec.invoice_id, rec.invoice_number, rec.party_name);
    r.recovered = round2(r.recovered + rec.amount);
    // A same-FY recovery reduced the write-off row itself: add it back to what was written off.
    if (rec.mode === 'same_fy') r.writtenOff = round2(r.writtenOff + rec.amount);
    if (!r.date) r.date = rec.date;
  }
  for (const r of rows.values()) r.net = round2(r.writtenOff - r.recovered);
  return [...rows.values()].sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
}

export function registerTotals(rows: readonly WriteOffRegisterRow[]): { writtenOff: number; recovered: number; net: number } {
  return rows.reduce((t, r) => ({ writtenOff: round2(t.writtenOff + r.writtenOff), recovered: round2(t.recovered + r.recovered), net: round2(t.net + r.net) }), { writtenOff: 0, recovered: 0, net: 0 });
}

export function loadRecoveries(): WriteOffRecovery[] {
  return getTable<WriteOffRecovery>(WRITE_OFF_RECOVERIES_TABLE).filter((r) => r && typeof r.id === 'string');
}

/** What can still be recovered on a bill: written off − recovered. */
export function recoverable(invoiceId: string): number {
  const reg = writeOffRegister(localDb.invoices.getAll(), localDb.payments.getAll(), loadRecoveries()).find((r) => r.invoiceId === invoiceId);
  return reg ? Math.max(reg.net, 0) : 0;
}

export interface RecoveryInput {
  invoiceId: string;
  amount: number;
  date: string;
  method: string;
  reference?: string;
}

/** Record money received against a written-off bill ("Record as bad debt recovered"). All or nothing. */
export function recordRecovery(input: RecoveryInput): WriteOffRecovery {
  requireAccess('doc.deleteIssued');
  const inv = localDb.invoices.getById(input.invoiceId);
  if (!inv) throw new Error('The bill no longer exists.');
  const amount = round2(Number(input.amount) || 0);
  if (!(amount > 0)) throw new Error('Enter the amount recovered.');
  const open = recoverable(input.invoiceId);
  if (amount > open + 0.005) throw new Error(`Only ${open.toFixed(2)} of ${inv.invoice_number} is written off and not yet recovered.`);
  const rows = localDb.payments.getAll().filter((p) => p.invoice_id === inv.id && p.write_off).sort((a, b) => b.date.localeCompare(a.date));
  const fy = getIndianFY(input.date).label;
  const sameFy = rows.find((p) => getIndianFY(p.date).label === fy);
  const base = { id: generateId(), invoice_id: inv.id, invoice_number: inv.invoice_number, party_name: inv.client?.name ?? '', amount, date: input.date, fy, method: input.method, created_at: new Date().toISOString() };
  // QA5 F11: the same-FY path rewrites the write-off row and records the receipt against the bill, both checked
  // against the BILL's date. When that is inside the period lock, the recovery is posted as a Receipt voucher
  // dated the day the money came in (Dr Cash / Bank, Cr Bad debts recovered): only the new receipt's date matters.
  const billLocked = lockState(inv) === 'locked' || (!!sameFy && lockState({ id: inv.id, issue_date: sameFy.date, invoice_number: inv.invoice_number }) === 'locked');
  return withTablesRollback(['transactions', 'invoices', 'vouchers', 'series_counters', WRITE_OFF_RECOVERIES_TABLE], () => {
    let rec: WriteOffRecovery;
    if (sameFy && !billLocked && sameFy.amount >= amount - 0.005) {
      localDb.payments.remove(sameFy.id);
      const left = round2(sameFy.amount - amount);
      if (left > 0.004) localDb.payments.record({ invoiceId: inv.id, amount: left, method: WRITE_OFF_METHOD, date: sameFy.date, note: sameFy.note, writeOff: true });
      const receipt = localDb.payments.record({ invoiceId: inv.id, amount, method: input.method, date: input.date, reference: input.reference, note: `Bad debt recovered (${inv.invoice_number})` });
      rec = { ...base, mode: 'same_fy', receipt_id: receipt.id };
    } else {
      const cashAcc = /cash/i.test(input.method) ? A.cash : A.bank;
      const paise = Math.round(amount * 100);
      const v = saveVoucher({
        type: 'RECEIPT', date: input.date,
        narration: `Bad debt recovered: ${inv.invoice_number} (${inv.client?.name ?? ''}), written off ${sameFy && billLocked ? 'in a locked period' : 'in an earlier year'}${input.reference ? ` · ${input.reference}` : ''}`,
        lines: [{ account_id: cashAcc, dr: paise, cr: 0 }, { account_id: A.badDebtsRecovered, dr: 0, cr: paise }],
      });
      rec = { ...base, mode: sameFy && billLocked ? 'locked_period' : 'prior_fy', voucher_id: v.id };
    }
    setTable(WRITE_OFF_RECOVERIES_TABLE, [...loadRecoveries(), rec]);
    try {
      audit.record({ entity: 'payment', entity_id: inv.id, action: 'create', doc_number: inv.invoice_number, summary: `Bad debt recovered on ${inv.invoice_number}: ₹${amount.toFixed(2)} (${rec.mode === 'same_fy' ? 'same year: write-off reduced' : rec.mode === 'locked_period' ? 'write-off in a locked period: Bad debts recovered' : 'earlier year: Bad debts recovered'})` });
    } catch {
      /* logging never blocks */
    }
    return rec;
  });
}

/** CSV of the register. */
export function writeOffRegisterCsv(rows: readonly WriteOffRegisterRow[]): string {
  const head = ['Party', 'Bill', 'Written off on', 'Reason', 'Written off', 'Recovered', 'Net written off'];
  const body = rows.map((r) => [r.party, r.number, r.date, r.reason, r.writtenOff.toFixed(2), r.recovered.toFixed(2), r.net.toFixed(2)]);
  return toCsv([head, ...body]);
}
