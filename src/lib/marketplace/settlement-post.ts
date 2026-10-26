/**
 * "Post settlement" (R5-A4.5): the books for one imported settlement, in one all-or-nothing step.
 *
 *  1. Receipts — for each order with a sale line and its A3 document, an ordinary payment (`localDb.payments.record`)
 *     INTO THE CHANNEL'S CLEARING ACCOUNT, method "Marketplace settlement", reference = settlement id, for the sale
 *     settled (capped at what the document still owes).
 *  2. One journal (`saveVoucher`, class "Marketplace settlement"):
 *       Dr Marketplace fees (net of GST)          Dr Input IGST / CGST + SGST — only when the fee tax invoice is in
 *       Dr GST TCS receivable                     hand, else Dr "GST on marketplace fees — awaiting invoice"
 *       Dr TDS receivable (2370, 194-O)           Dr Sundry debtors (customer) for refunds paid out
 *       Cr Other income for reimbursements / claims, Cr Sundry debtors (operator, on account) for sale money with no
 *       document, and the clearing account for the balance.
 *  3. Payout — one contra Dr bank / Cr clearing for the deposit on the deposit date.
 * A fully posted settlement leaves the clearing account at 0.00 (Σ lines = payout is checked at import).
 * "Unpost" reverses the three through the existing delete paths (period lock respected).
 *
 * Fee invoice (A4.6): a purchase bill from the settlement's fee buckets (vendor = the operator party, ITC eligible,
 * marked settled) plus one re-class journal (Dr creditors | Cr Marketplace fees, Cr awaiting GST), so the fee is
 * expensed once and its GST moves to input credit. This module WRITES `purchases` (purchase-contract test).
 * Working paper — verify with your CA.
 */
import type { Payment } from '../../types/invoice';
import type { SalesChannel, Settlement, SettlementBucket, SettlementLine } from '../../types/marketplace-r5';
import type { PurchaseRecord } from '../../types/purchases';
import { num, round2 } from '../invoice-calc';
import { getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { A, chartOf, loadUserAccounts, saveUserAccount, type PrimaryGroupId } from '../ledger/accounts';
import { deleteVoucher, loadVouchers, rupeesToPaise, saveVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { bankLedgerId } from '../bank-ledgers';
import { DEFAULT_BANK_ID } from '../bank-accounts';
import { purchasesDb } from '../purchases';
import { readPurchase } from '../purchase-normalize';
import { senderStateCode } from '../../store/invoice-defaults';
import { channelById, SETTLEMENTS_TABLE } from './channels';
import { FEE_BUCKETS, SettlementError } from './settlement-import';

export const MARKETPLACE_FEES_ACCOUNT = 'Marketplace fees';
export const TCS_RECEIVABLE_ACCOUNT = 'GST TCS receivable';
export const FEE_GST_AWAITING_ACCOUNT = 'GST on marketplace fees — awaiting invoice';
export const GST_TDS_RECEIVABLE_ACCOUNT = 'GST TDS receivable';
export const SETTLEMENT_METHOD = 'Marketplace settlement';
export const SETTLEMENT_CLASS = 'Marketplace settlement';

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

/** "Marketplace fees" (indirect expenses), created by name on first use. */
export const ensureMarketplaceFeesAccount = () => ensureAccount(MARKETPLACE_FEES_ACCOUNT, 'INDIRECT_EXPENSES', 6196);
/** "GST TCS receivable" (duties & taxes, a debit balance until credited to the cash ledger). */
export const ensureTcsReceivableAccount = () => ensureAccount(TCS_RECEIVABLE_ACCOUNT, 'DUTIES_TAXES', 2371);
/** "GST on marketplace fees — awaiting invoice" (other current assets). */
export const ensureFeeGstAwaitingAccount = () => ensureAccount(FEE_GST_AWAITING_ACCOUNT, 'OTHER_CA', 3701);
/** "GST TDS receivable" (R5-B5 creates it for works contracts; A5 reads / creates it by the same name). */
export const ensureGstTdsReceivableAccount = () => ensureAccount(GST_TDS_RECEIVABLE_ACCOUNT, 'DUTIES_TAXES', 2373);

const FEES = new Set<SettlementBucket>(FEE_BUCKETS);

/** Σ fee deductions (positive = charged) and GST on them, per settlement. */
export function feeTotals(s: Pick<Settlement, 'lines'>): { fees: number; gst: number } {
  let fees = 0;
  let gst = 0;
  for (const l of s.lines) {
    if (FEES.has(l.bucket)) fees -= l.amount;
    else if (l.bucket === 'gst_on_fees') gst -= l.amount;
  }
  return { fees: round2(fees), gst: round2(gst) };
}

/** IGST, or CGST + SGST halves when the operator's GSTIN is in our own state. */
export function splitFeeGst(gst: number, channel: Pick<SalesChannel, 'gstins'>, homeState: string): { igst: number; cgst: number; sgst: number } {
  const st = channel.gstins[0]?.gstin.slice(0, 2) ?? '';
  if (st && homeState && st === homeState) {
    const cgst = round2(gst / 2);
    return { igst: 0, cgst, sgst: round2(gst - cgst) };
  }
  return { igst: round2(gst), cgst: 0, sgst: 0 };
}

export interface PostOptions {
  /** Fee tax invoice for the month is in hand: GST on fees goes straight to input credit. */
  feeInvoiceReceived?: boolean;
  /** The real bank the payout reached (default: the main account). */
  bankAccountId?: string;
}

function getSettlement(id: string): Settlement {
  const s = getTable<Settlement>(SETTLEMENTS_TABLE).find((x) => x.id === id);
  if (!s) throw new SettlementError('Settlement not found.');
  return s;
}

function patchSettlement(id: string, patch: Partial<Settlement>): Settlement {
  const all = getTable<Settlement>(SETTLEMENTS_TABLE);
  let out: Settlement | undefined;
  setTable(SETTLEMENTS_TABLE, all.map((x) => {
    if (x.id !== id) return x;
    out = { ...x, ...patch };
    for (const k of Object.keys(patch) as (keyof Settlement)[]) if (patch[k] === undefined) delete out[k];
    return out;
  }));
  return out!;
}

const POST_TABLES = ['transactions', 'invoices', 'vouchers', 'accounts', SETTLEMENTS_TABLE, 'purchases', 'purchase_payments', 'series_counters'] as const;

/** Post receipts, the journal and the payout contra for one settlement (see the module note). */
export function postSettlement(settlementId: string, opts: PostOptions = {}): Settlement {
  requireAccess('books.edit');
  const s = getSettlement(settlementId);
  if (s.posted) throw new SettlementError('This settlement is already posted.');
  const channel = channelById(s.channel_id);
  if (!channel?.clearing_bank_id) throw new SettlementError('The channel has no clearing account — open the channel and save it once.');
  const clearing = channel.clearing_bank_id;
  const clearingLedger = bankLedgerId(clearing);
  const bank = opts.bankAccountId || DEFAULT_BANK_ID;
  if (bank === clearing) throw new SettlementError('Choose the real bank account the payout reached.');
  const home = senderStateCode(localDb.settings.activeProfile());
  const partyName = (localDb.clients.getById(channel.party_id)?.name ?? channel.name).trim();

  return withTablesRollback(POST_TABLES, () => {
    // 1. Receipts per order into clearing. A refund of the same order in the same settlement is netted off its
    //    receipt (the credit note then settles the invoice), so the customer's account is not left in credit.
    const saleByDoc = new Map<string, number>();
    const docOfOrder = new Map<string, string>();
    let onAccount = 0;
    for (const l of s.lines) {
      if (l.bucket !== 'sale' && l.bucket !== 'shipping_recovered') continue;
      if (l.doc_id) {
        saleByDoc.set(l.doc_id, round2((saleByDoc.get(l.doc_id) ?? 0) + l.amount));
        if (l.order_id) docOfOrder.set(l.order_id.trim().toLowerCase(), l.doc_id);
      } else onAccount = round2(onAccount + l.amount);
    }
    const nettedRefund = new Set<SettlementLine>();
    for (const l of s.lines) {
      const docId = l.bucket === 'refund' && l.order_id ? docOfOrder.get(l.order_id.trim().toLowerCase()) : undefined;
      if (!docId) continue;
      saleByDoc.set(docId, round2((saleByDoc.get(docId) ?? 0) + l.amount));
      nettedRefund.add(l);
    }
    const payment_ids: string[] = [];
    for (const [docId, amount] of saleByDoc) {
      const doc = localDb.invoices.getById(docId);
      const owed = doc && doc.status !== 'Cancelled' ? round2(Math.max(num(doc.total) - num(doc.tds_amount) - num(doc.amount_paid), 0)) : 0;
      const pay = round2(Math.min(Math.max(amount, 0), owed));
      if (pay > 0) {
        const p = localDb.payments.record({ invoiceId: docId, amount: pay, method: SETTLEMENT_METHOD, reference: s.settlement_id, date: s.deposit_date, bankAccountId: clearing });
        payment_ids.push(p.id);
      }
      onAccount = round2(onAccount + amount - pay);
    }

    // 2. One journal for everything else.
    const lines: ManualVoucherLine[] = [];
    const add = (account_id: string, rupees: number, party?: string) => {
      const p = rupeesToPaise(rupees);
      if (!p) return;
      const dr = rupees > 0;
      lines.push({ account_id, dr: dr ? p : 0, cr: dr ? 0 : p, ...(party ? { party } : {}) });
    };
    const { fees, gst } = feeTotals(s);
    let tcs = 0;
    let tds = 0;
    let income = 0;
    let other = 0;
    const refunds = new Map<string, number>();
    for (const l of s.lines) {
      if (l.bucket === 'tcs') tcs -= l.amount;
      else if (l.bucket === 'tds_194o') tds -= l.amount;
      else if (l.bucket === 'reimbursement' || l.bucket === 'claim') income += l.amount;
      else if (l.bucket === 'other') other -= l.amount;
      else if (l.bucket === 'refund' && !nettedRefund.has(l)) {
        const doc = l.doc_id ? localDb.invoices.getById(l.doc_id) : undefined;
        const who = doc?.client?.name?.trim() || partyName;
        refunds.set(who, round2((refunds.get(who) ?? 0) - l.amount));
      }
    }
    const feeAcc = fees || other > 0 ? ensureMarketplaceFeesAccount() : '';
    if (fees) add(feeAcc, fees);
    if (gst) {
      if (opts.feeInvoiceReceived) {
        const g = splitFeeGst(gst, channel, home);
        add(A.inIgst, g.igst);
        add(A.inCgst, g.cgst);
        add(A.inSgst, g.sgst);
      } else add(ensureFeeGstAwaitingAccount(), gst);
    }
    if (tcs) add(ensureTcsReceivableAccount(), round2(tcs));
    if (tds) add(A.tdsReceivable, round2(tds));
    if (round2(other) > 0) add(feeAcc, round2(other));
    else if (round2(other) < 0) add(A.otherIncome, round2(other));
    if (income) add(A.otherIncome, -round2(income));
    for (const [who, amt] of refunds) add(A.debtors, amt, who);
    if (onAccount) add(A.debtors, -onAccount, partyName);
    const dr = lines.reduce((a, l) => a + l.dr, 0);
    const cr = lines.reduce((a, l) => a + l.cr, 0);
    if (dr !== cr) lines.push({ account_id: clearingLedger, dr: dr < cr ? cr - dr : 0, cr: dr > cr ? dr - cr : 0 });
    const journal = lines.length >= 2
      ? saveVoucher({ type: 'JOURNAL', date: s.deposit_date, narration: `${channel.name} settlement ${s.settlement_id}: fees, TCS / TDS, refunds and adjustments (working paper — verify with your CA)`, lines, voucher_class: SETTLEMENT_CLASS })
      : undefined;

    // 3. Payout contra.
    const payout = rupeesToPaise(s.payout);
    const contra = payout
      ? saveVoucher({
        type: 'CONTRA', date: s.deposit_date, narration: `${channel.name} settlement ${s.settlement_id}: payout to the bank`, voucher_class: SETTLEMENT_CLASS,
        lines: s.payout > 0
          ? [{ account_id: bankLedgerId(bank), dr: payout, cr: 0 }, { account_id: clearingLedger, dr: 0, cr: payout }]
          : [{ account_id: clearingLedger, dr: payout, cr: 0 }, { account_id: bankLedgerId(bank), dr: 0, cr: payout }],
      })
      : undefined;

    return patchSettlement(s.id, {
      posted: { payment_ids, ...(journal ? { journal_id: journal.id } : {}), ...(contra ? { contra_id: contra.id } : {}), ...(opts.feeInvoiceReceived ? { fee_invoice_received: true } : {}), at: new Date().toISOString() },
    });
  });
}

/** Reverse a posting: contra, journal and receipts go through their own delete paths (period lock applies). */
export function unpostSettlement(settlementId: string): Settlement {
  requireAccess('books.edit');
  const s = getSettlement(settlementId);
  if (!s.posted) throw new SettlementError('This settlement is not posted.');
  if (s.fee_invoice_id) throw new SettlementError('Delete the fee invoice recorded from this settlement first.');
  const posted = s.posted;
  return withTablesRollback(POST_TABLES, () => {
    if (posted.contra_id) deleteVoucher(posted.contra_id);
    if (posted.journal_id) deleteVoucher(posted.journal_id);
    for (const id of posted.payment_ids) localDb.payments.remove(id);
    return patchSettlement(s.id, { posted: undefined });
  });
}

/* ── Fee invoice (A4.6) ─────────────────────────────────────────── */

export interface FeeInvoiceInput {
  bill_number: string;
  date: string;
  /** SAC on the fee bill (9985 support services / 9967 transport support), chosen by the user. */
  hsn: string;
}

/** Record the operator's fee tax invoice for a settlement posted while it was awaited, and re-class its GST. */
export function recordFeeInvoice(settlementId: string, input: FeeInvoiceInput): { bill: PurchaseRecord; reclassId: string } {
  requireAccess('books.edit');
  const s = getSettlement(settlementId);
  if (!s.posted) throw new SettlementError('Post the settlement first.');
  if (s.posted.fee_invoice_received) throw new SettlementError('The GST on these fees already went to input credit when the settlement was posted.');
  if (s.fee_invoice_id) throw new SettlementError('A fee invoice is already recorded for this settlement.');
  if (!input.bill_number.trim()) throw new SettlementError('Type the fee invoice number.');
  const channel = channelById(s.channel_id);
  if (!channel) throw new SettlementError('Channel not found.');
  const { fees, gst } = feeTotals(s);
  if (!(fees > 0)) throw new SettlementError('This settlement has no fees to bill.');
  const home = senderStateCode(localDb.settings.activeProfile());
  const g = splitFeeGst(gst, channel, home);
  const party = localDb.clients.getById(channel.party_id);
  const vendorName = (party?.name ?? channel.name).trim();
  const total = round2(fees + gst);
  return withTablesRollback(POST_TABLES, () => {
    const feeAcc = ensureMarketplaceFeesAccount();
    const awaiting = ensureFeeGstAwaitingAccount();
    const bill = purchasesDb.save({
      kind: 'EXPENSE',
      vendor_name: vendorName,
      ...(channel.gstins[0]?.gstin ? { vendor_gstin: channel.gstins[0].gstin } : {}),
      bill_number: input.bill_number.trim(),
      date: input.date,
      place_of_supply: home,
      category: MARKETPLACE_FEES_ACCOUNT,
      lines: [{ id: 'fee', name: `${channel.name} fees — settlement ${s.settlement_id}`, hsn: input.hsn || '9985', unit: 'NOS', quantity: 1, rate: fees, tax_rate: fees > 0 ? round2((gst / fees) * 100) : 0 }],
      taxable: fees,
      cgst: g.cgst,
      sgst: g.sgst,
      igst: g.igst,
      itc_eligible: true,
      total,
      // Settled through the settlement itself (no money paid separately): bill-wise payables see it as paid.
      amount_paid: total,
      notes: `Fee invoice for ${channel.name} settlement ${s.settlement_id}; fees were deducted from the payout.`,
    });
    if (!readPurchase(bill)) throw new SettlementError('The fee bill could not be read back.');
    const paise = (r: number) => rupeesToPaise(r);
    const lines: ManualVoucherLine[] = [{ account_id: A.creditors, dr: paise(total), cr: 0, party: vendorName }, { account_id: feeAcc, dr: 0, cr: paise(fees) }];
    if (gst) lines.push({ account_id: awaiting, dr: 0, cr: paise(gst) });
    const v = saveVoucher({ type: 'JOURNAL', date: input.date, narration: `Fee invoice ${bill.bill_number} (${channel.name}): fees already booked from settlement ${s.settlement_id}; GST moved to input credit`, lines, voucher_class: SETTLEMENT_CLASS });
    patchSettlement(s.id, { fee_invoice_id: bill.id, fee_reclass_id: v.id });
    return { bill, reclassId: v.id };
  });
}

/** Remove a fee invoice recorded from a settlement (bill + re-class journal). */
export function deleteFeeInvoice(settlementId: string): void {
  requireAccess('books.edit');
  const s = getSettlement(settlementId);
  if (!s.fee_invoice_id) return;
  withTablesRollback(POST_TABLES, () => {
    if (s.fee_reclass_id) deleteVoucher(s.fee_reclass_id);
    purchasesDb.remove(s.fee_invoice_id!);
    patchSettlement(s.id, { fee_invoice_id: undefined, fee_reclass_id: undefined });
  });
}

/* ── Clearing balance ───────────────────────────────────────────── */

type PayRow = Payment & { gift_voucher_id?: string; voucher_id?: string };

/**
 * Balance of a clearing account (Dr positive) up to `asOf`: receipts recorded into it plus voucher lines on its
 * ledger. Gift-voucher / advance adjustments and write-offs move no money and are skipped (like every bank reader).
 */
export function clearingBalance(bankId: string, asOf?: string, data?: { payments?: readonly PayRow[]; vouchers?: ReturnType<typeof loadVouchers> }): number {
  const ledger = bankLedgerId(bankId);
  const payments = data?.payments ?? peekTable<PayRow>('transactions');
  const vouchers = data?.vouchers ?? loadVouchers();
  let paise = 0;
  for (const p of payments) {
    if (p.bank_account_id !== bankId || p.advance_id || p.gift_voucher_id || p.write_off || p.voucher_id) continue;
    if (asOf && p.date > asOf) continue;
    paise += rupeesToPaise(p.amount) * (num(p.amount) < 0 ? -1 : 1);
  }
  for (const v of vouchers) {
    if (v.variant || (asOf && v.date > asOf)) continue;
    for (const l of v.lines) if (l.account_id === ledger) paise += l.dr - l.cr;
  }
  return paise / 100;
}

/** Clearing balance left by one settlement's own postings (0.00 when fully posted). */
export function settlementClearing(s: Settlement): number {
  if (!s.posted) return 0;
  const channel = channelById(s.channel_id);
  if (!channel) return 0;
  const ids = new Set(s.posted.payment_ids);
  const vids = new Set([s.posted.journal_id, s.posted.contra_id].filter(Boolean));
  return clearingBalance(channel.clearing_bank_id, undefined, {
    payments: peekTable<PayRow>('transactions').filter((p) => ids.has(p.id)),
    vouchers: loadVouchers().filter((v) => vids.has(v.id)),
  });
}

