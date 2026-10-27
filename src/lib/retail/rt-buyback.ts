/**
 * RT-D3 exchange / buy-back and second-hand resale.
 *
 *  - Buy-back voucher: an ordinary `purchases` row (kind PURCHASE) numbered by us `URD/FY…` (`rt-urd.ts`), from the
 *    customer as an individual vendor, NO GST, `itc_eligible: false`, no RCM (RT11). The device goes into the `'used'`
 *    godown (saleable) as a serial of a `second_hand` stock item ("<model> (used)"), carrying `used_goods`.
 *  - Exchange on a sale: a receipt row on the sale with `exchange_purchase_id` (moved no cash: `movedNoCash`; the ledger
 *    debits Sundry creditors — the customer). The voucher's `amount_paid` rises by the same value ("paid on the bill"),
 *    so payables show it settled. The sale invoice carries the FULL price (GST on all of it, RT11). The customer must be
 *    the same party on both (their creditor and debtor balances net off).
 *  - Margin scheme resale (Rule 32(5), RT12): a sale line of a used serial bought with no ITC is split into a "cost"
 *    line (purchase value, no GST) and a "margin" line (selling price − purchase value, GST inside it; 0 when
 *    negative). `invoice-calc.ts` is unchanged. Refused on a bill to a registered buyer (they would get no ITC).
 * Working paper — verify with your CA (RT11, RT12, RT14).
 */
import './rt-registry';
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { UsedGoods } from '../../types/retail-r9';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { invoiceOpen } from '../advances';
import { purchasesDb } from '../purchases';
import { vendorsDb } from '../vendors';
import { godownsDb } from '../godowns';
import { blankStockItem, stockDb, type StockItem } from '../inventory';
import { loadTracking, lookupSerial, serialKey } from '../stock-tracking';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { nextUrdNumber, recordUrd } from './rt-urd';

export const EXCHANGE_METHOD = 'Exchange';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Pure ── */

/** A buy-back voucher (URD purchase carrying `used_goods`). */
export type BuyBack = PurchaseRecord & { used_goods: UsedGoods };
export const isBuyBack = (p: Partial<PurchaseRecord> | undefined): p is BuyBack => !!p?.used_goods;

/** Exchange value already used from a voucher (its exchange receipt rows). */
export const exchangedFrom = (purchaseId: string, payments: readonly Payment[]): number =>
  round2(payments.filter((p) => p.exchange_purchase_id === purchaseId).reduce((s, p) => s + num(p.amount), 0));

/** URD vouchers (old device, or RT-E old metal) with value left to settle a sale by exchange. */
export function openVouchers(purchases: readonly PurchaseRecord[], payments: readonly Payment[]): { purchase: PurchaseRecord; left: number }[] {
  return purchases.filter((p) => p.used_goods || p.old_metal).map((purchase) => ({ purchase, left: round2(num(purchase.total) - exchangedFrom(purchase.id, payments)) })).filter((x) => x.left > 0.004);
}

/** The buy-back a serial came in on, with its value per unit (no ITC taken, no GST). */
export function buyBackOf(serial: string, purchases: readonly PurchaseRecord[]): { purchase: PurchaseRecord; value: number } | undefined {
  const k = serialKey(serial);
  for (const p of purchases) {
    // Rule 9: read through the purchases contract (a void bill, ITC taken or any GST on it rules the margin scheme out).
    const c = readPurchase(p);
    if (!isBuyBack(p) || !c || isVoidStatus(c.status) || c.itcEligible || c.tax > 0) continue;
    const l = readPurchaseLines(p).find((x) => x.serials.some((s) => serialKey(s) === k));
    if (l) return { purchase: p, value: round2(l.unitCost) };
  }
  return undefined;
}

/**
 * Split a sale line of a used serial for the margin scheme. `inclusive` = the bill's rates include GST. Returns the
 * cost line (purchase value, 0%) and the margin line (GST inside the margin), or the cost line alone when the margin
 * is nil / negative (then the whole price carries no GST: negative value ignored).
 */
export function marginLines(line: InvoiceItem, purchase: { id: string; value: number }, inclusive: boolean, newId: () => string): InvoiceItem[] {
  if (num(line.quantity) !== 1) throw new Error('Sell one used device per line under the margin scheme.');
  const price = round2(num(line.rate) * (1 - num(line.discount_percent) / 100) * (inclusive ? 1 : 1 + num(line.tax_rate) / 100));
  const value = round2(num(purchase.value));
  const margin = round2(price - value);
  const tag = { purchase_id: purchase.id, purchase_value: value };
  const cost: InvoiceItem = { ...line, rate: margin > 0 ? value : price, tax_rate: 0, discount_percent: 0, amount: margin > 0 ? value : price, margin: { ...tag, part: 'cost' }, description: 'Margin scheme — no GST on this part (Rule 32(5))' };
  delete cost.band_rate;
  if (!(margin > 0)) return [cost];
  const r = num(line.tax_rate);
  const rate = inclusive ? margin : round2(margin * 100 / (100 + r));
  const m: InvoiceItem = {
    id: newId(), name: `Margin — ${line.name}`, description: 'GST on margin under Rule 32(5) — verify with your CA', type: line.type || 'Product', hsn: line.hsn, unit: line.unit,
    quantity: 1, rate, tax_rate: r, discount_percent: 0, amount: rate, margin: { ...tag, part: 'margin' },
  };
  return [cost, m];
}

/** Margin scheme refused on a bill to a registered buyer (no ITC for them) — '' when allowed. */
export const marginIssue = (rec: Pick<InvoiceRecord, 'client'>): string =>
  String(rec.client?.gstin ?? '').trim() ? 'Margin scheme: this buyer is registered (GSTIN) and gets no ITC on a margin-scheme sale — bill the full value with GST instead. Verify with your CA.' : '';

/* ── Storage ── */

/** The `'used'` godown (created once, saleable). */
export function usedGodown(): string {
  const g = godownsDb.list().find((x) => x.kind === 'used');
  return (g ?? godownsDb.save({ name: 'Used goods', kind: 'used' })).id;
}

/** The second-hand stock item of a model ("<model> (used)"), serial-tracked; created once. */
export function usedItem(model: string, opts: { hsn?: string; taxRate?: number; imei?: boolean } = {}): StockItem {
  const name = `${model.trim()} (used)`;
  const found = stockDb.items().find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found;
  const item = blankStockItem({ name, hsn: opts.hsn ?? '', track_serials: true, second_hand: true, ...(typeof opts.taxRate === 'number' ? { tax_rate: opts.taxRate } : {}), ...(opts.imei ? { serial_kind: 'imei' as const } : {}) });
  stockDb.saveItem(item);
  return item;
}

export interface BuyBackInput {
  date: string;
  customer: string;
  phone?: string;
  model: string;
  serial: string;
  value: number;
  hsn?: string;
  /** Resale GST rate of the model (used on the margin line). */
  taxRate?: number;
  goods?: Omit<UsedGoods, 'serial' | 'model' | 'item_id' | 'godown_id'>;
}

/** Record a buy-back (URD purchase voucher; stock into the `'used'` godown). All or nothing. */
export function recordBuyBack(input: BuyBackInput): PurchaseRecord {
  requireAccess('books.edit');
  const customer = input.customer.trim();
  const serial = input.serial.replace(/\s+/g, '');
  const value = round2(num(input.value));
  if (!DAY.test(input.date)) throw new Error('Choose the date.');
  if (!customer) throw new Error('Type the customer\'s name.');
  if (!input.model.trim() || !serial) throw new Error('Type the model and its IMEI / serial.');
  if (!(value > 0)) throw new Error('Enter the buy-back value.');
  if (lookupSerial(loadTracking(), serial, input.date, 1).some((r) => r.inStock && serialKey(r.serial) === serialKey(serial))) throw new Error(`${serial} is already in stock.`);
  return withTablesRollback(['purchases', 'vendors', 'godowns', 'stock_items', 'series_counters'], () => {
    const phone = String(input.phone ?? '').replace(/\D/g, '');
    const vendor = vendorsDb.all().find((v) => (phone && String(v.phone ?? '').replace(/\D/g, '') === phone && v.name.trim().toLowerCase() === customer.toLowerCase()) || (!phone && v.name.trim().toLowerCase() === customer.toLowerCase()))
      ?? vendorsDb.save({ name: customer, ...(phone ? { phone } : {}), deductee_type: 'INDIVIDUAL', notes: 'Individual (buy-back / exchange)' });
    const godown = usedGodown();
    const item = usedItem(input.model, { hsn: input.hsn, taxRate: input.taxRate, imei: /^\d{15}$/.test(serial) });
    const number = nextUrdNumber(input.date);
    const goods: UsedGoods = { ...input.goods, serial, model: input.model.trim(), item_id: item.id, godown_id: godown };
    const saved = purchasesDb.save({
      kind: 'PURCHASE', vendor_id: vendor.id, vendor_name: vendor.name, bill_number: number, date: input.date, category: 'Used goods (buy-back)',
      lines: [{ id: generateId(), name: item.name, item_id: item.id, hsn: input.hsn ?? '', unit: 'NOS', quantity: 1, rate: value, tax_rate: 0, serials: [serial], godown_id: godown }],
      taxable: value, cgst: 0, sgst: 0, igst: 0, total: value, amount_paid: 0, itc_eligible: false, used_goods: goods,
      notes: `Purchase voucher ${number}: used device bought from an unregistered person — no GST, no ITC, no reverse charge (RT11). Verify with your CA.`,
    });
    recordUrd(number);
    return saved;
  });
}

/** Settle part of a sale by a buy-back / old-metal voucher (no cash moved). The bill's customer must be the voucher's party. */
export function applyExchange(invoiceId: string, purchaseId: string, amount?: number): Payment {
  requireAccess('payment.record');
  const inv = localDb.invoices.getById(invoiceId);
  const bb = purchasesDb.get(purchaseId);
  if (!inv) throw new Error('The bill was not found.');
  if (!bb || !(bb.used_goods || bb.old_metal)) throw new Error('Pick the buy-back voucher.');
  if (String(inv.client?.name ?? '').trim().toLowerCase() !== bb.vendor_name.trim().toLowerCase()) throw new Error(`The buy-back is from ${bb.vendor_name}; put that name on the bill (it is now ${inv.client?.name ?? '—'}).`);
  const pays = getTable<Payment>('transactions');
  const left = round2(num(bb.total) - exchangedFrom(bb.id, pays));
  const amt = round2(num(amount ?? Math.min(left, invoiceOpen(inv))));
  if (!(amt > 0)) throw new Error('Nothing left to adjust.');
  if (amt > left + 0.004) throw new Error(`Only ₹${left.toFixed(2)} of ${bb.bill_number} is left.`);
  if (amt > invoiceOpen(inv) + 0.004) throw new Error(`${inv.invoice_number} has only ₹${invoiceOpen(inv).toFixed(2)} unpaid.`);
  return withTablesRollback(['transactions', 'invoices', 'purchases', 'series_counters'], () => {
    const p = localDb.payments.record({ invoiceId, amount: amt, method: EXCHANGE_METHOD, date: inv.issue_date, reference: bb.bill_number, note: bb.used_goods ? `Less: exchange (old device ${bb.used_goods.model ?? ''} ${bb.used_goods.serial ?? ''})` : `Less: old ${bb.old_metal?.metal ?? 'metal'} (${num(bb.old_metal?.gross_wt).toFixed(3)} g @ ${bb.old_metal?.purity_pct ?? ''}%)` }); // RT-E3 wording
    setTable('transactions', getTable<Payment>('transactions').map((x) => (x.id === p.id ? { ...x, exchange_purchase_id: bb.id } : x)));
    setTable('purchases', purchasesDb.all().map((x) => (x.id === bb.id ? { ...x, amount_paid: round2(num(x.amount_paid) + amt), updated_at: new Date().toISOString() } : x)));
    return { ...p, exchange_purchase_id: bb.id };
  });
}

/** Undo an exchange receipt (the voucher is open again). */
export function undoExchange(paymentId: string): void {
  requireAccess('payment.record');
  const p = getTable<Payment>('transactions').find((x) => x.id === paymentId);
  if (!p?.exchange_purchase_id) throw new Error('Not an exchange receipt.');
  const pid = p.exchange_purchase_id;
  withTablesRollback(['transactions', 'invoices', 'purchases'], () => {
    localDb.payments.remove(paymentId);
    setTable('purchases', purchasesDb.all().map((x) => (x.id === pid ? { ...x, amount_paid: Math.max(round2(num(x.amount_paid) - num(p.amount)), 0) } : x)));
  });
}

/** Delete a buy-back voucher (recycle bin; its URD number stays used). Refused once it settled a sale. */
export function deleteBuyBack(purchaseId: string): void {
  if (getTable<Payment>('transactions').some((p) => p.exchange_purchase_id === purchaseId)) throw new Error('This buy-back settled a sale: undo that exchange first.');
  purchasesDb.remove(purchaseId);
}

/** Buy-backs with their resale (sale line of the serial) and margin, newest first. */
export function buyBackRows(purchases: readonly PurchaseRecord[], invoices: readonly InvoiceRecord[]): { purchase: BuyBack; sale?: InvoiceRecord; price?: number; margin?: number }[] {
  return purchases.filter(isBuyBack).sort((a, b) => b.date.localeCompare(a.date)).map((p) => {
    const s = serialKey(p.used_goods.serial ?? '');
    const sale = invoices.find((i) => i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE' && (i.items ?? []).some((l) => (l.serials ?? []).some((x) => serialKey(x) === s)));
    if (!sale) return { purchase: p };
    const lines = sale.items.filter((l) => l.margin?.purchase_id === p.id || (l.serials ?? []).some((x) => serialKey(x) === s));
    const price = round2(lines.reduce((t, l) => t + num(l.quantity) * num(l.rate) * (1 - num(l.discount_percent) / 100), 0));
    return { purchase: p, sale, price, margin: round2(price - num(p.total)) };
  });
}
