/**
 * RT-D2 EMI / consumer-finance sales (table `finance_deals`, `doc.create`, dated `date`). The invoice is to the
 * CUSTOMER for the full value; the down payment is the bill's other tenders.
 *
 *  - Transfer (at the sale): the finance part becomes a receipt row on the customer's bill into the "Consumer finance
 *    clearing" account (a clearing bank account, never offered by bank pickers) tagged with its journal
 *    (`ra_journal_id`, the R5-B5 / R7-B5 pattern, so every cash / bank reader skips it through `movedNoCash`), and one
 *    journal (class "Finance transfer") Dr Sundry debtors — the financier | Cr the clearing account. Net effect:
 *    Dr Financier (debtor) / Cr Customer (debtor); the customer's bill is settled, the financier holds the DO.
 *  - Disbursement: a receipt voucher (class "Finance disbursement") Dr Bank (net received) + Dr Sundry creditors — the
 *    financier (fee withheld) | Cr Sundry debtors — the financier; and the fee as the financier's own bill to us: a
 *    purchase DRAFT, SAC 997119 at 18% (ITC per its invoice), to approve under Expenses → Drafts. The DO closes when
 *    receipts + fees = the loan; a partial disbursement leaves it open.
 *  - A card EMI stays a card tender; a retailer-funded no-cost discount is an invoice discount at the sale (RT10).
 * Working paper — verify with your CA (RT10).
 */
import './rt-registry';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { FinanceDeal, FinanceDisbursement } from '../../types/retail-r9';
import { FINANCE_FEE_RULES } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { invoiceOpen } from '../advances';
import { A } from '../ledger/accounts';
import { deleteVoucher, rupeesToPaise, saveVoucher } from '../ledger/vouchers';
import { bankLedgerId } from '../bank-ledgers';
import { bankAccountsDb } from '../bank-accounts';
import { draftsDb, PURCHASE_DRAFTS_TABLE } from '../purchase-drafts';
import { shiftDay } from '../dates';
import { RT_TABLES } from './rt-shared';

export const FINANCE_TABLE = RT_TABLES.financeDeals;
export const FINANCE_CLEARING = 'Consumer finance clearing';
export const FINANCE_METHOD = 'Finance (DO)';
/** Journal classes this module posts and undoes itself (the recycle bin pairs / refuses them). */
export const TRANSFER_CLASS = 'Finance transfer';
export const DISBURSE_CLASS = 'Finance disbursement';

/* ── Pure ── */

/** What is still due from the financier on a deal (loan − receipts − fees). */
export const dealOpen = (d: Pick<FinanceDeal, 'loan' | 'disbursements'>): number => round2(num(d.loan) - (d.disbursements ?? []).reduce((s, x) => s + num(x.amount) + num(x.fee), 0));
export const dealClosed = (d: Pick<FinanceDeal, 'loan' | 'disbursements'>): boolean => dealOpen(d) <= 0.004;

/** Tender split of a finance bill: the customer pays `total − loan` (down payment) by the other tenders. */
export function financeSplit(total: number, loan: number): { down: number; loan: number; error: string } {
  const t = round2(num(total));
  const l = round2(num(loan));
  if (!(l > 0)) return { down: t, loan: 0, error: 'Enter the loan amount.' };
  if (l > t + 0.004) return { down: 0, loan: l, error: 'The loan is more than the bill.' };
  return { down: round2(t - l), loan: l, error: '' };
}

/** Fee (incl. GST) → taxable + GST at the rule's rate (the financier's bill to us). */
export function feeSplit(fee: number, date?: string): { sac: string; rate: number; taxable: number; gst: number } {
  const r = ruleAt(FINANCE_FEE_RULES, date);
  const taxable = round2(num(fee) * 100 / (100 + r.rate));
  return { ...r, taxable, gst: round2(num(fee) - taxable) };
}

/** Open DOs older than `days` (default 7), oldest first. */
export const pendingDos = (deals: readonly FinanceDeal[], today: string, days = 7): FinanceDeal[] =>
  deals.filter((d) => !dealClosed(d) && d.date <= shiftDay(today, -days)).sort((a, b) => a.date.localeCompare(b.date));

/** Financier-wise: loans, received, fees, open. */
export function financierSummary(deals: readonly FinanceDeal[]): { financier: string; deals: number; loan: number; received: number; fees: number; open: number }[] {
  const by = new Map<string, { financier: string; deals: number; loan: number; received: number; fees: number; open: number }>();
  for (const d of deals) {
    const r = by.get(d.financier) ?? { financier: d.financier, deals: 0, loan: 0, received: 0, fees: 0, open: 0 };
    r.deals++;
    r.loan = round2(r.loan + num(d.loan));
    for (const x of d.disbursements ?? []) {
      r.received = round2(r.received + num(x.amount));
      r.fees = round2(r.fees + num(x.fee));
    }
    r.open = round2(r.open + Math.max(dealOpen(d), 0));
    by.set(d.financier, r);
  }
  return [...by.values()].sort((a, b) => b.open - a.open);
}

const csvCell = (v: unknown) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export function financeCsv(deals: readonly FinanceDeal[], today: string): string {
  const head = ['Date', 'Invoice', 'Customer', 'Financier', 'DO no.', 'Scheme', 'Loan', 'Received', 'Fees', 'Open', 'Age (days)'];
  const rows = deals.map((d) => {
    const got = (d.disbursements ?? []).reduce((s, x) => s + num(x.amount), 0);
    const fee = (d.disbursements ?? []).reduce((s, x) => s + num(x.fee), 0);
    const age = Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${d.date}T00:00:00`)) / 864e5);
    return [d.date, d.invoice_number, d.customer, d.financier, d.do_no, d.scheme ?? '', d.loan, round2(got), round2(fee), dealOpen(d), age];
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/* ── Storage ── */

export const loadDeals = (): FinanceDeal[] => getTable<FinanceDeal>(FINANCE_TABLE).filter((r) => r && typeof r.id === 'string').map((d) => ({ ...d, disbursements: d.disbursements ?? [] }));

/** The clearing account the finance parts pass through (created once; not a real bank). */
export function financeClearing(): string {
  const found = bankAccountsDb.all().find((a) => a.name.toLowerCase() === FINANCE_CLEARING.toLowerCase());
  if (found) return (found.clearing ? found : bankAccountsDb.save({ ...found, clearing: true })).id;
  return bankAccountsDb.save({ id: generateId(), name: FINANCE_CLEARING, active: true, clearing: true }).id;
}

export interface FinanceInput {
  invoiceId: string;
  financier: string;
  financierId?: string;
  loan: number;
  doNo: string;
  scheme?: string;
  expectedFee?: number;
  loanAccount?: string;
  /** Default: the bill date. */
  date?: string;
}

/** Record the finance part of a saved bill: the transfer row + journal and the deal (all or nothing). */
export function recordFinance(input: FinanceInput): FinanceDeal {
  requireAccess('payment.record');
  const inv = localDb.invoices.getById(input.invoiceId);
  if (!inv) throw new Error('The bill was not found.');
  const financier = input.financier.trim();
  if (!financier) throw new Error('Pick the financier.');
  if (!input.doNo.trim()) throw new Error('Type the DO / reference number.');
  const loan = round2(num(input.loan));
  if (!(loan > 0)) throw new Error('Enter the loan amount.');
  const open = invoiceOpen(inv);
  if (loan > open + 0.004) throw new Error(`Only ₹${open.toFixed(2)} of ${inv.invoice_number} is unpaid.`);
  if (financier.toLowerCase() === String(inv.client?.name ?? '').trim().toLowerCase()) throw new Error('The financier cannot be the customer.');
  const date = input.date || inv.issue_date;
  const deals = loadDeals();
  return withTablesRollback(['transactions', 'invoices', 'vouchers', 'bank_accounts', 'series_counters', FINANCE_TABLE], () => {
    const clearing = financeClearing();
    const pay = localDb.payments.record({ invoiceId: inv.id, amount: loan, method: FINANCE_METHOD, date, bankAccountId: clearing, reference: input.doNo.trim(), note: `${financier} — DO ${input.doNo.trim()}` });
    const p = rupeesToPaise(loan);
    const v = saveVoucher({
      type: 'JOURNAL', date, voucher_class: TRANSFER_CLASS,
      narration: `${inv.invoice_number}: finance part ₹${loan.toFixed(2)} moved from ${inv.client?.name ?? 'the customer'} to ${financier} (DO ${input.doNo.trim()}) — verify with your CA`,
      lines: [{ account_id: A.debtors, dr: p, cr: 0, party: financier }, { account_id: bankLedgerId(clearing), dr: 0, cr: p }],
    });
    setTable('transactions', getTable<Payment>('transactions').map((x) => (x.id === pay.id ? { ...x, ra_journal_id: v.id } : x)));
    const last4 = String(input.loanAccount ?? '').replace(/\s+/g, '').slice(-4);
    const deal: FinanceDeal = {
      id: generateId(), date, invoice_id: inv.id, invoice_number: inv.invoice_number, customer: inv.client?.name ?? '', financier, loan, do_no: input.doNo.trim(),
      down_payment: round2(num(inv.total) - loan), transfer_payment_id: pay.id, transfer_voucher_id: v.id, disbursements: [], created_at: new Date().toISOString(),
      ...(input.financierId ? { financier_id: input.financierId } : {}),
      ...(input.scheme?.trim() ? { scheme: input.scheme.trim() } : {}),
      ...(num(input.expectedFee) > 0 ? { expected_fee: round2(num(input.expectedFee)) } : {}),
      ...(last4 ? { loan_account: last4 } : {}),
    };
    setTable(FINANCE_TABLE, [...deals, deal]);
    return deal;
  });
}

/**
 * The financier paid: `amount` reached the bank and `fee` (subvention + processing, incl. GST) was withheld.
 * Posts the receipt voucher and drafts the financier's fee bill; returns the updated deal.
 */
export function recordDisbursement(dealId: string, input: { date: string; amount: number; fee?: number; method?: string; bankAccountId?: string }): FinanceDeal {
  requireAccess('payment.record');
  const deals = loadDeals();
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) throw new Error('Finance deal not found.');
  const amount = round2(num(input.amount));
  const fee = round2(num(input.fee));
  if (amount < 0 || fee < 0 || !(amount + fee > 0)) throw new Error('Enter the amount received.');
  if (input.date < deal.date) throw new Error('The financier cannot pay before the sale.');
  const open = dealOpen(deal);
  if (amount + fee > open + 0.004) throw new Error(`Only ₹${open.toFixed(2)} is due on DO ${deal.do_no}.`);
  const cash = /^cash$/i.test(String(input.method ?? ''));
  return withTablesRollback(['vouchers', 'series_counters', PURCHASE_DRAFTS_TABLE, FINANCE_TABLE], () => {
    const v = saveVoucher({
      type: 'RECEIPT', date: input.date, voucher_class: DISBURSE_CLASS,
      narration: `${deal.financier}: DO ${deal.do_no} (${deal.invoice_number}) — received ₹${amount.toFixed(2)}${fee ? `, fee ₹${fee.toFixed(2)} withheld` : ''} — verify with your CA`,
      lines: [
        ...(amount > 0 ? [{ account_id: cash ? A.cash : bankLedgerId(input.bankAccountId), dr: rupeesToPaise(amount), cr: 0 }] : []),
        ...(fee > 0 ? [{ account_id: A.creditors, dr: rupeesToPaise(fee), cr: 0, party: deal.financier }] : []),
        { account_id: A.debtors, dr: 0, cr: rupeesToPaise(amount + fee), party: deal.financier },
      ],
    });
    let draftId: string | undefined;
    if (fee > 0) {
      const f = feeSplit(fee, input.date);
      draftId = draftsDb.save({
        kind: 'EXPENSE', vendor_name: deal.financier, bill_number: `DO ${deal.do_no}`, date: input.date, category: 'Finance charges (subvention / processing)',
        lines: [{ id: generateId(), name: `Subvention / processing fee — DO ${deal.do_no}`, hsn: f.sac, unit: 'OTH', quantity: 1, rate: f.taxable, tax_rate: f.rate }],
        taxable: f.taxable, cgst: round2(f.gst / 2), sgst: round2(f.gst - round2(f.gst / 2)), igst: 0, total: fee, amount_paid: 0, itc_eligible: true,
        notes: `Withheld by ${deal.financier} from DO ${deal.do_no}: settled against its creditor balance by ${v.number}. Check IGST / CGST + SGST and the GSTIN on its invoice — verify with your CA (RT10).`,
        draft: { source: 'manual', created_at: new Date().toISOString() },
      }).id;
    }
    const d: FinanceDisbursement = {
      id: generateId(), date: input.date, amount, fee, method: input.method || 'Bank transfer', voucher_id: v.id, voucher_number: v.number,
      ...(input.bankAccountId && !cash ? { bank_account_id: input.bankAccountId } : {}), ...(draftId ? { draft_id: draftId } : {}),
    };
    const next = { ...deal, disbursements: [...deal.disbursements, d], updated_at: new Date().toISOString() };
    setTable(FINANCE_TABLE, deals.map((x) => (x.id === dealId ? next : x)));
    return next;
  });
}

/** Undo one disbursement: its voucher (to the recycle bin) and its fee draft if still a draft. */
export function undoDisbursement(dealId: string, disbursementId: string): FinanceDeal {
  requireAccess('payment.record');
  const deals = loadDeals();
  const deal = deals.find((d) => d.id === dealId);
  const x = deal?.disbursements.find((d) => d.id === disbursementId);
  if (!deal || !x) throw new Error('Disbursement not found.');
  return withTablesRollback(['vouchers', 'series_counters', PURCHASE_DRAFTS_TABLE, FINANCE_TABLE], () => {
    const next = { ...deal, disbursements: deal.disbursements.filter((d) => d.id !== disbursementId), updated_at: new Date().toISOString() };
    setTable(FINANCE_TABLE, deals.map((d) => (d.id === dealId ? next : d))); // first: the bin then sees the voucher as undone
    deleteVoucher(x.voucher_id);
    if (x.draft_id && draftsDb.get(x.draft_id)) draftsDb.remove(x.draft_id);
    return next;
  });
}

/** Cancel a deal with no disbursement: the transfer row and journal go, the customer's bill is due again. */
export function cancelDeal(dealId: string): void {
  requireAccess('payment.record');
  const deals = loadDeals();
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) return;
  if (deal.disbursements.length) throw new Error('Undo the financier\'s disbursements first.');
  assertUnlocked({ id: deal.id, issue_date: deal.date, invoice_number: deal.invoice_number }, 'delete');
  withTablesRollback(['transactions', 'invoices', 'vouchers', 'series_counters', FINANCE_TABLE], () => {
    setTable(FINANCE_TABLE, deals.filter((d) => d.id !== dealId));
    if (getTable<Payment>('transactions').some((p) => p.id === deal.transfer_payment_id)) localDb.payments.remove(deal.transfer_payment_id);
    if (getTable<{ id: string }>('vouchers').some((v) => v.id === deal.transfer_voucher_id)) deleteVoucher(deal.transfer_voucher_id);
  });
}

/** Deals of an invoice (the bill's finance strip). */
export const dealsOf = (invoice: Pick<InvoiceRecord, 'id'>): FinanceDeal[] => loadDeals().filter((d) => d.invoice_id === invoice.id);
