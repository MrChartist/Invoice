/**
 * RT-E3 old gold bought from a customer, or taken in exchange (a URD purchase voucher, `URD/FY…`, `rt-urd.ts`):
 *
 *   net   = gross − stones
 *   fine  = net × touch % × (1 − melting loss %)          (24K grams, 3 decimals)
 *   value = fine × the day's 24K BUY rate                  (setting: net × (1 − melt %) × the stated purity's buy rate)
 *
 * No GST, no ITC, no RCM: a private person selling old jewellery is not supplying in the course of business (RT17).
 * Stock: the `Old gold (fine)` item (GMS, quantity = fine weight) in the 'used' godown (saleable, RT-D3's kind). The
 * customer's PAN / Form 60 / ID is snapshotted when the value reaches the PAN limit. Paid in cash / bank (purchase
 * payment; Sec 40A(3) warning) or settled by exchange against a sale (RT-D3 `applyExchange` in rt-buyback.ts: the sale keeps its FULL
 * value — GST on it, §8 #19, CA item RT17). Working paper — verify with your CA.
 */
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { Metal, OldMetal } from '../../types/retail-r9';
import type { Payment } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';
import { blankStockItem, stockDb } from '../inventory';
import { vendorsDb } from '../vendors';
import { paymentsDb, purchasesDb } from '../purchases';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { generateId } from '../storage';
import { nextUrdNumber, recordUrd } from './rt-urd';
import { exchangedFrom, usedGodown } from './rt-buyback'; // RT-D3: the shared 'used' godown and exchange receipts
import { urdLeft } from './rt-doc-hooks';
import { panNeeded as overPanLimit } from './rt-cash-guard';
import { netWeight } from './rt-jewel-line';
import { r3 } from './rt-jewel-rates';

/** Fine weight and value of old metal (pure). `basis` 'purity': net × (1 − melt %) at the stated purity's buy rate. */
export function oldGoldValue(i: { gross: number; stone?: number; purity_pct: number; melt_pct?: number; rate: number; basis?: 'fine' | 'purity' }): { net: number; fine: number; value: number } {
  const net = netWeight(i.gross, num(i.stone));
  const keep = 1 - Math.min(Math.max(num(i.melt_pct), 0), 100) / 100;
  const raw = (net * Math.min(Math.max(num(i.purity_pct), 0), 100) * keep) / 100;
  return { net, fine: r3(raw), value: round2((i.basis === 'purity' ? net * keep : raw) * Math.max(num(i.rate), 0)) };
}

export interface OldGoldInput {
  date: string;
  customer: { name: string; phone?: string; pan?: string; form?: '60' | '97'; id_type?: string; id_last4?: string };
  metal: Metal;
  gross: number;
  stone?: number;
  purity_pct: number;
  melt_pct?: number;
  rate: number;
  basis?: 'fine' | 'purity';
  test_method?: string;
}

const phoneKey = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10);

/** The customer as a vendor (matched by phone, else by name), created once. */
function customerVendor(c: OldGoldInput['customer']): Vendor {
  const all = vendorsDb.all();
  const ph = phoneKey(c.phone);
  return all.find((v) => (ph.length === 10 && phoneKey(v.phone) === ph) || v.name.trim().toLowerCase() === c.name.trim().toLowerCase())
    ?? vendorsDb.save({ name: c.name.trim(), ...(ph ? { phone: c.phone } : {}), ...(c.pan ? { pan: c.pan.toUpperCase() } : {}), notes: 'Customer: old gold / URD purchases' });
}

/** Record an old-gold voucher (URD number, no GST, into the 'used' godown). Throws when PAN / Form 60 is needed. */
export function recordOldGold(input: OldGoldInput): PurchaseRecord {
  const v = oldGoldValue({ gross: input.gross, stone: input.stone, purity_pct: input.purity_pct, melt_pct: input.melt_pct, rate: input.rate, basis: input.basis });
  if (!input.customer.name.trim()) throw new Error('Type the customer\'s name.');
  if (!(v.fine > 0) || !(v.value > 0)) throw new Error('Enter the weight, touch % and the buy rate.');
  const panNeeded = overPanLimit(v.value, input.date); // QA10 R14: "exceeding" the limit, as on a sale (one rule)
  const c = input.customer;
  if (panNeeded && !/^[A-Z]{5}\d{4}[A-Z]$/.test(String(c.pan ?? '').toUpperCase()) && !c.form) throw new Error('This voucher reaches the PAN limit: take the customer\'s PAN or a Form 60 declaration (Rule 114B), verify with your CA.');
  const vendor = customerVendor(c);
  const name = input.metal === 'silver' ? 'Old silver (fine)' : 'Old gold (fine 24K)';
  let item = stockDb.items().find((i) => i.name === name);
  if (!item) stockDb.saveItem((item = blankStockItem({ name, unit: 'GMS', hsn: input.metal === 'silver' ? '7106' : '7108', tax_rate: 3 })));
  const used = usedGodown(); // RT-D3's 'used' godown (saleable)
  const number = nextUrdNumber(input.date);
  const old: OldMetal = {
    metal: input.metal, gross_wt: r3(num(input.gross)), stone_wt: r3(num(input.stone)), net_wt: v.net, purity_pct: num(input.purity_pct), melt_loss_pct: num(input.melt_pct),
    fine_wt: v.fine, rate_24k: round2(num(input.rate)), value: v.value, ...(input.basis === 'purity' ? { basis: 'purity' as const } : {}), ...(input.test_method ? { test_method: input.test_method } : {}),
    ...(panNeeded || c.id_type ? { kyc: { ...(c.pan ? { pan: c.pan.toUpperCase() } : {}), ...(c.form ? { form: c.form } : {}), ...(c.id_type ? { id_type: c.id_type, id_last4: c.id_last4 } : {}) } } : {}),
  };
  const bill = purchasesDb.save({
    kind: 'PURCHASE', vendor_id: vendor.id, vendor_name: vendor.name, bill_number: number, date: input.date, category: 'Old gold purchase (URD)',
    lines: [{ id: generateId(), name, hsn: item.hsn, unit: 'GMS', item_id: item.id, godown_id: used, quantity: v.fine, rate: Number((v.value / v.fine).toFixed(6)), tax_rate: 0 }],
    taxable: v.value, cgst: 0, sgst: 0, igst: 0, total: v.value, amount_paid: 0, exchange_paid: 0, itc_eligible: false, old_metal: old,
    notes: `Purchase voucher for old ${input.metal} from an unregistered person: no GST / ITC / RCM (RT17). Verify with your CA.`,
  });
  recordUrd(number);
  return bill;
}

/** Cash paid today to the voucher's customer on URD vouchers (for the Sec 40A(3) warning). */
export function cashPaidToday(vendorId: string | undefined, date: string): number {
  const ids = new Set(purchasesDb.all().filter((p) => p.vendor_id === vendorId).map((p) => p.id));
  return round2(paymentsDb.all().filter((p) => ids.has(p.purchase_id) && p.date === date && p.method.toLowerCase() === 'cash').reduce((s, p) => s + num(p.amount), 0));
}

/** Old-gold vouchers (newest first) with what was settled by exchange and what is still owed. Reads the real bill shape. */
export function oldGoldVouchers(purchases: readonly PurchaseRecord[], payments: readonly Payment[]): (PurchaseRecord & { exchanged: number; open: number })[] {
  return purchases.filter((p) => p?.old_metal && readPurchase(p) && !isVoidStatus(p.status))
    .map((p) => ({ ...p, exchanged: exchangedFrom(p.id, payments), open: urdLeft(p, payments) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.bill_number.localeCompare(a.bill_number));
}

