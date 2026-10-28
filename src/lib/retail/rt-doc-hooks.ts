/**
 * QA10 (R1 / R6 / R7 / R8): what a bill's URD exchange receipts and finance DO mean when the bill goes away, and the ONE
 * derivation of a URD voucher's settled amount.
 *
 *  - URD voucher (buy-back / old gold): settled = cash / bank paid on it (`amount_paid − exchange_paid`, the cash part
 *    the last sync saw) + its LIVE exchange receipt rows (`exchange_purchase_id`). What is left to settle a sale by
 *    exchange, or to pay, is `total − settled`, so a voucher paid out in cash is never offered for exchange (R1).
 *    `syncUrdPaid` writes `amount_paid` = settled (and `exchange_paid` = live exchange) after every exchange, undo,
 *    bill delete / cancel and recycle-bin restore, so payables and the ledger agree (R6 / R7).
 *  - A bill deleted (`localDb.invoices.remove`) or cancelled (save / setStatus) first frees its exchange receipts and
 *    cancels its finance DO with the transfer row and journal (`voidHook`, approval-gate.ts). A DO the financier already
 *    paid refuses (undo the disbursement first). Restoring the bill brings the DO back with them (recycle-bin hooks).
 * Data only on light modules: imported by `rt-registry.ts`, so the hooks are on wherever a Round 9 table is written.
 * Working paper — verify with your CA.
 */
import './rt-registry';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { FinanceDeal } from '../../types/retail-r9';
import { voidHook } from '../approval-gate';
import { num, round2 } from '../invoice-calc';
import { getTable, peekTable, setTable } from '../storage';
import { localDb } from '../localDb';
import { recordSeries } from '../series-counters';

/** `RT_TABLES.financeDeals` (rt-shared.ts), named here so this registry-side chunk stays small. */
const DEALS = 'finance_deals';

type Urd = Pick<PurchaseRecord, 'id' | 'total' | 'amount_paid' | 'exchange_paid'>;
const isUrd = (p: Partial<PurchaseRecord> | undefined): boolean => !!(p?.used_goods || p?.old_metal);

/**
 * R15-A3: the generalised roll-up — what LIVE receipt rows with `exchange_purchase_id` (R9 exchange, R12 set-off, R15
 * netting) settle on a bill. Re-exported by `netting.ts`.
 */
export const exchangeSettled = (purchaseId: string, payments: readonly Pick<Payment, 'amount' | 'exchange_purchase_id'>[]): number =>
  round2(payments.reduce((s, p) => s + (p.exchange_purchase_id === purchaseId ? num(p.amount) : 0), 0));

/** Exchange value of a voucher used by LIVE receipt rows. */
export const exchangedFrom = exchangeSettled;

/** R15-A3: bills netting never touches (R9 URD vouchers, R12 pooled cycle bills keep their own flows). */
export const ownFlow = (b: PurchaseRecord): boolean => !!(isUrd(b) || b.ag?.cycle_id);

/** Re-derive `amount_paid` / `exchange_paid` of netted bills (all, or `ids`) from live rows. URD vouchers are R9's. */
export function syncNettedPaid(ids?: Iterable<string>): void {
  const want = ids ? new Set(ids) : undefined;
  const pays = peekTable<Payment>('transactions');
  let changed = false;
  const rows = getTable<PurchaseRecord>('purchases').map((b) => {
    if (ownFlow(b) || (want ? !want.has(b.id) : typeof b.exchange_paid !== 'number')) return b;
    const ex = exchangeSettled(b.id, pays);
    const had = num(b.exchange_paid);
    if (Math.abs(ex - had) < 0.005 && (typeof b.exchange_paid === 'number' || !ex)) return b;
    changed = true;
    return { ...b, amount_paid: Math.max(round2(num(b.amount_paid) - had + ex), 0), exchange_paid: ex, updated_at: new Date().toISOString() };
  });
  if (changed) setTable('purchases', rows);
}



/** Cash / bank paid on a URD voucher (its `amount_paid` less the exchange part the last sync put in it). */
export function urdCashPaid(p: Urd, payments: readonly Payment[]): number {
  const paid = num(p.amount_paid);
  // Vouchers saved before QA10 carry no `exchange_paid`: the live exchange rows stand for it (never above amount_paid).
  const ex = typeof p.exchange_paid === 'number' ? num(p.exchange_paid) : Math.min(paid, exchangedFrom(p.id, payments));
  return Math.max(round2(paid - ex), 0);
}

/** Settled on a URD voucher: cash / bank paid + live exchange rows. */
export const urdSettled = (p: Urd, payments: readonly Payment[]): number => round2(urdCashPaid(p, payments) + exchangedFrom(p.id, payments));

/** Left on a URD voucher to settle a sale by exchange (or to pay). */
export const urdLeft = (p: Urd, payments: readonly Payment[]): number => Math.max(round2(num(p.total) - urdSettled(p, payments)), 0);

/** Re-derive `amount_paid` / `exchange_paid` of URD vouchers (all, or `ids`) from live rows. A roll-up, as a payment's. */
export function syncUrdPaid(ids?: Iterable<string>): void {
  const want = ids ? new Set(ids) : undefined;
  const pays = getTable<Payment>('transactions');
  let changed = false;
  const rows = getTable<PurchaseRecord>('purchases').map((p) => {
    if (!isUrd(p) || (want && !want.has(p.id))) return p;
    const ex = exchangedFrom(p.id, pays);
    const paid = round2(urdCashPaid(p, pays) + ex);
    if (Math.abs(paid - num(p.amount_paid)) < 0.005 && p.exchange_paid === ex) return p;
    changed = true;
    return { ...p, amount_paid: paid, exchange_paid: ex, updated_at: new Date().toISOString() };
  });
  if (changed) setTable('purchases', rows);
  // R15-A3: a netting receipt freed (bill cancelled / deleted) or restored settles its supplier bill again.
  syncNettedPaid(ids && want);
}

/** Free a bill's exchange receipts (their vouchers are open again). */
function freeExchanges(inv: InvoiceRecord): void {
  const rows = getTable<Payment>('transactions').filter((p) => p.invoice_id === inv.id && p.exchange_purchase_id);
  if (!rows.length) return;
  const ids = rows.map((r) => r.exchange_purchase_id!);
  syncUrdPaid(ids); // pin the cash part first (a voucher saved before QA10 has no `exchange_paid`)
  for (const r of rows) localDb.payments.remove(r.id);
  syncUrdPaid(ids);
}

/** Cancel a DO with its transfer row and journal (all to the recycle bin). The caller checks the disbursements. */
export function dropDeal(deal: FinanceDeal): void {
  setTable(DEALS, getTable<FinanceDeal>(DEALS).filter((d) => d.id !== deal.id));
  if (getTable<Payment>('transactions').some((p) => p.id === deal.transfer_payment_id)) localDb.payments.remove(deal.transfer_payment_id);
  // The transfer journal (no bill-wise rows of its own): the watched-table delete bins and logs it; its number stays used.
  // (Not `deleteVoucher`: that module would ride along with the registry into every lazy chunk's preload list.)
  const vs = getTable<{ id: string; number?: string }>('vouchers');
  const v = vs.find((x) => x.id === deal.transfer_voucher_id);
  if (v) {
    setTable('vouchers', vs.filter((x) => x.id !== v.id));
    recordSeries(v.number);
  }
}

/** A bill being deleted / cancelled: its DOs go too (refused while the financier has paid on one). */
function cancelFinance(inv: InvoiceRecord): void {
  const deals = getTable<FinanceDeal>(DEALS).filter((d) => d?.invoice_id === inv.id);
  const paid = deals.find((d) => d.disbursements?.length);
  if (paid) throw new Error(`${inv.invoice_number}: the financier has paid on DO ${paid.do_no}. Undo that disbursement in Inventory → Devices → Finance first.`);
  for (const d of deals) dropDeal(d);
}

/** Deleted (`next` absent) or being cancelled: the DO goes first (it may refuse), then the exchanges. */
/** QA18 T2: a netting / exchange receipt removed on its own (payment dialog, invoice delete) re-settles its bill. */
voidHook.paid = (ids) => syncUrdPaid(ids);

voidHook.f = (stored, next) => {
  if (!stored || (next && (stored.status === 'Cancelled' || next.status !== 'Cancelled'))) return;
  cancelFinance(stored);
  freeExchanges(stored);
};
