/**
 * R7-B5 OTA payout entry. An OTA-collect guest prepaid the OTA; weeks later the OTA pays the net after its commission
 * (+ GST), TCS u/s 52 and 194-O. One entry settles every booking it covers, all or nothing:
 *  - per invoice, a receipt for its net share into the bank (`localDb.payments.record`);
 *  - per invoice, the withheld part (commission + GST + TCS) as a receipt into the deductions clearing account
 *    tagged with the payout journal (`ra_journal_id`, so `movedNoCash` cash readers skip it — the R5-B5 pattern), and
 *    one journal Dr "GST TCS receivable" (TCS) + Dr Sundry creditors / the OTA (commission + GST) | Cr clearing;
 *  - the commission bill as a purchase draft (vendor = the OTA, SAC 998552, ITC per C1, no 194H — F14);
 *  - B5 cut-first applied (bundle share): no `eco_credits` row is written — the TCS sits in "GST TCS receivable" and is
 *    matched in the R5-A5 credit view from the portal statement (pasted there), like any operator's TCS.
 * 194-O sits on the invoice since check-out (`tds_section: '194O'`), so the TDS register / 26AS reconciler expects it.
 * Σ net shares must equal the payout: a difference is refused with the gap shown. Working paper — verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { invoiceOpen } from '../advances';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { rupeesToPaise, saveVoucher } from '../ledger/vouchers';
import { bankLedgerId } from '../bank-ledgers';
import { draftsDb, PURCHASE_DRAFTS_TABLE } from '../purchase-drafts';
import { hotelDb } from './hotel-store';
import { HotelError } from './reservations';
import { otaTcs } from './ota';
import { commissionBill, fullyLowBand } from './agent-commission';

/** "GST TCS receivable" (the R5-A name, group and code), created on first use. */
function tcsAccount(): string {
  const chart = chartOf(loadUserAccounts());
  return chart.find((a) => a.name.toLowerCase() === 'gst tcs receivable')?.id ?? saveUserAccount({ code: chart.some((a) => a.code === '2371') ? '2379' : '2371', name: 'GST TCS receivable', group: 'DUTIES_TAXES' }).id;
}

export interface PayoutRow {
  invoiceId: string;
  commission: number;
  /** GST on the commission. */
  gst: number;
  tcs: number;
}

/** OTA-collect check-out invoices not yet paid (the payout's pick list), with suggested TCS. */
export function payoutCandidates(ota?: string): { inv: InvoiceRecord; ota: string; due: number; tcs: number }[] {
  const res = new Map(hotelDb.reservations().filter((r) => r.source === 'ota' && r.ota?.collect === 'ota_collect').map((r) => [r.id, r]));
  return localDb.invoices.getAll()
    .filter((i) => i.reservation_id && res.has(i.reservation_id) && i.status !== 'Draft' && i.status !== 'Cancelled' && invoiceOpen(i) > 0.004)
    .map((inv) => ({ inv, ota: res.get(inv.reservation_id!)!.ota!.name, due: invoiceOpen(inv), tcs: otaTcs(inv) }))
    .filter((x) => !ota || x.ota === ota);
}

/** Net share of each row (what is still owed − withheld) and the gap to the payout amount (pure). */
export function payoutPlan(rows: readonly PayoutRow[], due: (id: string) => number, amount: number): { nets: number[]; gap: number } {
  const nets = rows.map((r) => round2(due(r.invoiceId) - r.commission - r.gst - r.tcs));
  return { nets, gap: round2(amount - nets.reduce((s, n) => s + n, 0)) };
}

export interface PayoutInput {
  ota: string;
  gstin?: string;
  date: string;
  amount: number;
  method: string;
  bankAccountId?: string;
  ref?: string;
  rows: PayoutRow[];
}

/** Post a payout (all or nothing). Returns the receipts. */
export async function postPayout(p: PayoutInput): Promise<Payment[]> {
  requireAccess('payment.record');
  const ra = await import('../works/ra-receivable');
  const invs = new Map(localDb.invoices.getAll().map((i) => [i.id, i]));
  if (!p.rows.length || p.rows.some((r) => !invs.has(r.invoiceId))) throw new HotelError('Pick the bookings this payout covers.');
  const { nets, gap } = payoutPlan(p.rows, (id) => invoiceOpen(invs.get(id)!), p.amount);
  if (Math.abs(gap) > 0.004) throw new HotelError(`The payout differs from the bookings by ₹${gap.toFixed(2)} — check commission, TCS and 194-O.`);
  if (nets.some((n) => n < 0)) throw new HotelError('A booking\'s deductions are more than what it owes.');
  const ref = `OTA payout ${p.ref || p.date}`;
  const sum = (k: keyof Omit<PayoutRow, 'invoiceId'>) => round2(p.rows.reduce((s, r) => s + r[k], 0));
  return withTablesRollback(['transactions', 'invoices', 'vouchers', 'accounts', 'bank_accounts', 'series_counters', PURCHASE_DRAFTS_TABLE], () => {
    const out: Payment[] = [];
    const held: string[] = [];
    p.rows.forEach((r, i) => {
      if (nets[i] > 0) out.push(localDb.payments.record({ invoiceId: r.invoiceId, amount: nets[i], method: p.method, date: p.date, bankAccountId: p.bankAccountId, reference: ref, note: p.ota }));
      const w = round2(r.commission + r.gst + r.tcs);
      if (w > 0) held.push(localDb.payments.record({ invoiceId: r.invoiceId, amount: w, method: 'OTA deductions', date: p.date, bankAccountId: ra.ensureDeductionClearing(), reference: ref, note: `${p.ota}: commission + GST + TCS withheld` }).id);
    });
    const tcs = sum('tcs');
    const comm = round2(sum('commission') + sum('gst'));
    if (held.length) {
      const lines = [
        ...(tcs > 0 ? [{ account_id: tcsAccount(), dr: rupeesToPaise(tcs), cr: 0 }] : []),
        ...(comm > 0 ? [{ account_id: A.creditors, dr: rupeesToPaise(comm), cr: 0, party: p.ota }] : []),
        { account_id: bankLedgerId(ra.ensureDeductionClearing()), dr: 0, cr: rupeesToPaise(round2(tcs + comm)) },
      ];
      const v = saveVoucher({ type: 'JOURNAL', date: p.date, voucher_class: 'OTA payout', narration: `${ref} (${p.ota}): TCS and commission withheld`, lines });
      const ids = new Set(held);
      setTable('transactions', getTable<Payment>('transactions').map((x) => (ids.has(x.id) ? { ...x, ra_journal_id: v.id } : x)));
    }
    if (sum('commission') > 0) {
      const sender = localDb.settings.activeProfile();
      const home = sender?.stateCode || String(sender?.companyGstin ?? '').slice(0, 2);
      const bill = commissionBill({ vendor: { name: p.ota, gstin: p.gstin }, amount: sum('commission'), gst: sum('gst'), date: p.date, home, ref, lowBand: fullyLowBand(localDb.invoices.getAll(), p.date), tds194h: false });
      draftsDb.save({ ...bill, notes: `${bill.notes} Deducted from ${ref}: settle it against the OTA's creditor balance.`, draft: { source: 'manual', created_at: new Date().toISOString() } });
    }
    return out;
  });
}
