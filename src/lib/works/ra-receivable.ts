/**
 * R5-B5: receipts against an RA bill. The payment dialog pre-fills cash = net payable less money received, and the
 * deduction rows are recorded by kind:
 *  - advance recovery → an advance adjustment (`applyAdvance`, the existing path), tagged `ra_kind`;
 *  - income-tax TDS → already on the invoice (no row);
 *  - GST TDS → a receipt row (method "GST TDS (Sec 51)") into the "RA deductions clearing" account and a journal
 *    Dr "GST TDS receivable" | Cr clearing; the A5 credit panel (`kind="tds"`, mounted in the Works tab) later moves
 *    it to the cash ledger (2360);
 *  - labour cess → the same with "Labour cess deducted" (expense, or a recoverable — chosen on the BOQ);
 *  - retention / security deposit → stay held; "Release" records the later receipt tagged with the kind.
 * Every row goes through the data layer (roles, period lock, receipt numbers, audit). A deduction receipt carries its
 * journal id (`ra_journal_id`); `removeDeductionRow` removes both at once. Accounts are created by their fixed names
 * (§6). Verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { RaDeductionKind } from '../../types/transport-works-r5';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { chartOf, loadUserAccounts, saveUserAccount, type PrimaryGroupId } from '../ledger/accounts';
import { deleteVoucher, loadVouchers, rupeesToPaise, saveVoucher } from '../ledger/vouchers';
import { assertUnlocked } from '../period-lock';
import { bankAccountsDb } from '../bank-accounts';
import { bankLedgerId } from '../bank-ledgers';
import { applyAdvance } from '../advances';
import { raDueSplit } from './ra-due';

export const GST_TDS_RECEIVABLE_ACCOUNT = 'GST TDS receivable';
export const LABOUR_CESS_ACCOUNT = 'Labour cess deducted';
export const GST_TDS_METHOD = 'GST TDS (Sec 51)';
export const CESS_METHOD = 'Labour cess deducted';
export const DEDUCTION_CLEARING = 'RA deductions clearing';

const norm = (s: string) => s.trim().toLowerCase();

function ensureAccount(name: string, group: PrimaryGroupId, startCode: number): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = startCode;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group }).id;
}

/** "GST TDS receivable" (same name, group and code as A5 reads / creates it). */
export const ensureGstTdsReceivableAccount = () => ensureAccount(GST_TDS_RECEIVABLE_ACCOUNT, 'DUTIES_TAXES', 2373);
/** "Labour cess deducted": an expense of the contractor (default) or a recoverable (other current assets). */
export const ensureLabourCessAccount = (mode: 'expense' | 'recoverable' = 'expense') => ensureAccount(LABOUR_CESS_ACCOUNT, mode === 'recoverable' ? 'OTHER_CA' : 'INDIRECT_EXPENSES', mode === 'recoverable' ? 3702 : 6197);

type Pay = Pick<Payment, 'id' | 'invoice_id' | 'amount' | 'ra_kind' | 'advance_id' | 'write_off'>;

export interface ReceiptPlan {
  /** Cash to receive now (net payable less money already received, capped at the due-now balance). */
  cash: number;
  /** Deduction rows still to record, by kind (GST TDS, cess, advance recovery). */
  rows: { kind: RaDeductionKind; label: string; amount: number }[];
  held: ReturnType<typeof raDueSplit>['held'];
}

/** Pure: what the payment dialog pre-fills for an RA bill. */
export function receiptPlan(inv: InvoiceRecord, payments: readonly Pay[], outstanding: number): ReceiptPlan {
  const split = raDueSplit(inv, payments, outstanding);
  const rows = split.held.filter((h) => h.kind === 'gst_tds' || h.kind === 'labour_cess' || h.kind === 'advance_recovery').map((h) => ({ kind: h.kind as RaDeductionKind, label: h.label, amount: h.amount }));
  return { cash: round2(Math.max(split.dueNow, 0)), rows, held: split.held.filter((h) => !rows.some((r) => r.kind === h.kind)) };
}

function tag(ids: readonly string[], kind: RaDeductionKind, journalId?: string): void {
  const want = new Set(ids);
  setTable('transactions', getTable<Payment>('transactions').map((p) => (want.has(p.id) ? { ...p, ra_kind: kind, ...(journalId ? { ra_journal_id: journalId } : {}) } : p)));
}

/** "RA deductions clearing": a clearing bank account (never a real bank; hidden from cheque / BRS pickers). */
export function ensureDeductionClearing(): string {
  const found = bankAccountsDb.all().find((a) => a.name.toLowerCase() === DEDUCTION_CLEARING.toLowerCase());
  if (found) return (found.clearing ? found : bankAccountsDb.save({ ...found, clearing: true })).id;
  return bankAccountsDb.save({ id: generateId(), name: DEDUCTION_CLEARING, active: true, clearing: true }).id;
}

/**
 * GST TDS / labour cess deducted by the client: a receipt row (method "GST TDS (Sec 51)" / "Labour cess deducted")
 * into the deductions clearing account, and one journal Dr "GST TDS receivable" / "Labour cess deducted" | Cr the
 * clearing account — so the receipt settles the bill like any other (TDS on the invoice included) and the clearing
 * account nets to zero.
 */
export function recordDeductionRow(invoiceId: string, kind: 'gst_tds' | 'labour_cess', opts: { date: string; amount?: number }): Payment {
  requireAccess('payment.record');
  const inv = localDb.invoices.getById(invoiceId);
  if (!inv) throw new Error('RA bill not found.');
  const d = (inv.ra_deductions ?? []).filter((x) => x.kind === kind);
  if (!d.length) throw new Error('This deduction is not on the RA bill.');
  const already = getTable<Payment>('transactions').filter((p) => p.invoice_id === invoiceId && p.ra_kind === kind).reduce((s, p) => s + num(p.amount), 0);
  const amount = round2(opts.amount ?? d.reduce((s, x) => s + x.amount, 0) - already);
  if (!(amount > 0)) throw new Error('Nothing is left to record for this deduction.');
  return withTablesRollback(['vouchers', 'transactions', 'invoices', 'accounts', 'bank_accounts', 'series_counters'], () => {
    const clearing = ensureDeductionClearing();
    const account = kind === 'gst_tds' ? ensureGstTdsReceivableAccount() : ensureLabourCessAccount(localDb.invoices.getById(inv.boq_id ?? '')?.boq_terms?.cess_mode);
    const p = rupeesToPaise(amount);
    const label = kind === 'gst_tds' ? 'GST TDS u/s 51' : 'Labour cess';
    const v = saveVoucher({
      type: 'JOURNAL', date: opts.date, voucher_class: 'RA deduction',
      narration: `${label} deducted by ${inv.client?.name ?? ''} from ${inv.invoice_number}${inv.ra_no ? ` (RA ${inv.ra_no})` : ''}`,
      lines: [{ account_id: account, dr: p, cr: 0 }, { account_id: bankLedgerId(clearing), dr: 0, cr: p }],
    });
    const pay = localDb.payments.record({ invoiceId, amount, method: kind === 'gst_tds' ? GST_TDS_METHOD : CESS_METHOD, date: opts.date, bankAccountId: clearing, reference: inv.invoice_number, note: `${label} — journal ${v.number}` });
    tag([pay.id], kind, v.id);
    return { ...pay, ra_kind: kind, ra_journal_id: v.id };
  });
}

/**
 * Remove a GST TDS / cess deduction receipt together with its journal, all or nothing: role, the period lock of the
 * bill ('unpay') and of the journal ('delete'), the recycle bin and the audit trail all run through the data-layer calls
 * (`localDb.payments.remove`, `deleteVoucher`), so the books stay balanced and the clearing account at zero.
 */
export function removeDeductionRow(paymentId: string): void {
  requireAccess('payment.record');
  const pay = getTable<Payment>('transactions').find((p) => p.id === paymentId);
  if (!pay) return;
  const journal = pay.ra_journal_id && loadVouchers().find((v) => v.id === pay.ra_journal_id);
  withTablesRollback(['transactions', 'invoices', 'vouchers', 'series_counters', 'recycle_bin'], () => {
    if (journal) {
      requireAccess('books.edit');
      assertUnlocked({ id: journal.id, issue_date: journal.date, invoice_number: journal.number }, 'delete');
    }
    localDb.payments.remove(paymentId);
    if (journal) deleteVoucher(journal.id);
  });
}

/** Advance recovery: the existing advance adjustment, tagged as the RA deduction. */
export function recoverAdvance(invoiceId: string, opts: { date: string; amount?: number }): Payment {
  const inv = localDb.invoices.getById(invoiceId);
  if (!inv) throw new Error('RA bill not found.');
  const advanceId = localDb.invoices.getById(inv.boq_id ?? '')?.boq_terms?.advance_id;
  if (!advanceId) throw new Error('No mobilisation advance is linked to the BOQ.');
  const due = round2((inv.ra_deductions ?? []).filter((d) => d.kind === 'advance_recovery').reduce((s, d) => s + d.amount, 0));
  return withTablesRollback(['transactions', 'invoices'], () => {
    const p = applyAdvance({ advanceId, invoiceId, amount: round2(opts.amount ?? due), date: opts.date });
    tag([p.id], 'advance_recovery');
    return { ...p, ra_kind: 'advance_recovery' };
  });
}

/** Release of retention / security deposit: the later receipt, tagged with the held kind. */
export function releaseHeld(invoiceId: string, kind: 'retention' | 'security_deposit', opts: { date: string; amount: number; method: string; bankAccountId?: string; reference?: string }): Payment {
  return withTablesRollback(['transactions', 'invoices'], () => {
    const p = localDb.payments.record({ invoiceId, amount: opts.amount, method: opts.method, date: opts.date, reference: opts.reference, bankAccountId: opts.bankAccountId, note: kind === 'retention' ? 'Retention released' : 'Security deposit released' });
    tag([p.id], kind);
    return { ...p, ra_kind: kind };
  });
}
