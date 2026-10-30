/**
 * AG-A3 farmer purchase voucher: an ordinary `purchases` row numbered by us `FPV/FY…` (the R9 URD pattern), vendor = a
 * farmer, `ag.voucher` = centre, vehicle, quality readings and cuts, accepted weight, charges and the declaration. The
 * line carries the R8 weighing `wt` (gross, bags, tare, dhalta); the **accepted** weight (after the quality weight cut)
 * is the line quantity, so the stock engine, the purchase register and GSTR-3B Table 5 (exempt inward) read it
 * unchanged. A price cut lowers the line rate. Charges reuse the R8 heads (no preset rate, TR6 / AG20): *recovered from
 * the farmer* is a less-line on the voucher; *paid by us* is a memo (book it to the mandi / labour as usual).
 * Numbers never return after a delete (`series_counters`). Working paper — verify with your CA (AG1, AG11, AG13, AG20).
 */
import './ag-registry';
import type { AgVoucher, AgVoucherCharge, FarmerCycle, QualityParam } from '../../types/agri-r12';
import type { LineWeight } from '../../types/trade-r8';
import type { PurchaseLine, PurchaseRecord, Vendor } from '../../types/purchases';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { getIndianFY } from '../invoice-number';
import { computePurchaseTotals, purchasesDb } from '../purchases';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { kgPer, weighNet } from '../trade/tr-weight';
import { qualityCut, type QualityResult } from './ag-quality';
import { voucherDeclaration } from './ag-tax';
import { AG_SERIES } from './ag-shared';

const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;
export const FPV = AG_SERIES.vouchers;

/** Every FPV number on a purchases row (live or not). */
export const fpvNumbers = (): string[] =>
  getTable<{ bill_number?: unknown }>('purchases').map((p) => (typeof p?.bill_number === 'string' ? p.bill_number : '')).filter((n) => n.toUpperCase().startsWith(`${FPV}/`));
export const nextFpvNumber = (date: string): string => nextSeriesNumberFor(FPV, date, fpvNumbers());

export interface VoucherInput {
  vendor: Vendor;
  date: string;
  commodity?: string;
  item: { name: string; hsn?: string; item_id?: string; unit: string; godown_id?: string };
  wt: LineWeight;
  /** Rate per billing unit (₹ / KG or ₹ / QTL). */
  rate: number;
  tax_rate?: number;
  params?: readonly QualityParam[];
  readings?: Readonly<Record<string, number | undefined>>;
  charges?: readonly AgVoucherCharge[];
  centre_id?: string;
  vehicle?: string;
  wbs_id?: string;
}

export interface VoucherWorking {
  netKg: number;
  quality: QualityResult;
  qty: number;
  rate: number;
  goods: number;
  recovered: number;
  value: number;
  lines: PurchaseLine[];
  declaration: string;
}

/** Pure: weighing → quality cut → quantity, value, lines and the declaration. */
export function voucherWorking(i: VoucherInput): VoucherWorking {
  const per = kgPer(i.item.unit) ?? 1;
  const netKg = weighNet(i.wt).net;
  const quality = qualityCut(i.params ?? [], i.readings ?? {}, netKg, num(i.rate) / per);
  const qty = r3(quality.accepted_kg / per);
  const goods = round2(qty * num(i.rate) - quality.cut_rs);
  const rate = qty > 0 ? Number((goods / qty).toFixed(4)) : num(i.rate);
  const recoveredRows = (i.charges ?? []).filter((c) => c.by === 'farmer' && num(c.amount) > 0);
  const recovered = round2(recoveredRows.reduce((s, c) => s + num(c.amount), 0));
  const lines: PurchaseLine[] = [
    { id: generateId(), name: i.item.name.trim(), ...(i.item.hsn ? { hsn: i.item.hsn } : {}), unit: i.item.unit, quantity: qty, rate, tax_rate: num(i.tax_rate), wt: i.wt, ...(i.item.item_id ? { item_id: i.item.item_id } : {}), ...(i.item.godown_id ? { godown_id: i.item.godown_id } : {}) },
    ...recoveredRows.map((c) => ({ id: generateId(), name: `Less: ${c.name} (recovered)`, unit: 'OTH', quantity: 1, rate: -round2(num(c.amount)), tax_rate: 0, ...(c.head_id ? { charge_head_id: c.head_id } : {}) })),
  ];
  return { netKg, quality, qty, rate, goods, recovered, value: round2(goods - recovered), lines, declaration: voucherDeclaration(i.vendor, lines, i.date) };
}

/** Save the voucher (`books.edit`, period lock through `purchasesDb.save`). Refuses an empty weighing or a reject. */
export function saveVoucher(i: VoucherInput, opts: { acceptReject?: boolean } = {}): PurchaseRecord {
  if (!i.vendor?.id) throw new Error('Pick the farmer.');
  if (!i.item.name.trim()) throw new Error('Type the produce (e.g. Paddy).');
  const w = voucherWorking(i);
  if (!(w.qty > 0) || !(w.goods > 0)) throw new Error('Enter the weighing (gross weight) and the rate.');
  if (w.quality.reject && !opts.acceptReject) throw new Error('A reading is above the reject line: reject the lot or treat it as a lower grade (tick "Accept anyway").');
  const number = nextFpvNumber(i.date);
  const t = computePurchaseTotals(w.lines, { gstApplies: num(i.tax_rate) > 0 });
  const rcm = w.declaration && !w.declaration.startsWith('Purchased from');
  const ag: AgVoucher = {
    ...(i.centre_id ? { centre_id: i.centre_id } : {}), ...(i.vehicle?.trim() ? { vehicle: i.vehicle.trim().toUpperCase() } : {}), ...(i.wbs_id ? { wbs_id: i.wbs_id } : {}),
    ...(i.commodity?.trim() ? { commodity: i.commodity.trim() } : {}),
    quality: w.quality.rows, cut_kg: w.quality.cut_kg, accepted_kg: w.quality.accepted_kg, ...(i.charges?.length ? { charges: i.charges.map((c) => ({ ...c, amount: round2(num(c.amount)) })) } : {}),
    ...(w.declaration ? { declaration: w.declaration } : {}),
  };
  const bill = purchasesDb.save({
    kind: 'PURCHASE', vendor_id: i.vendor.id, vendor_name: i.vendor.name, bill_number: number, date: i.date, category: 'Farm produce purchase',
    lines: w.lines, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, amount_paid: 0, itc_eligible: !!rcm && t.tax > 0,
    ...(rcm ? { reverse_charge: true } : {}), ag: { voucher: ag },
    notes: `Farmer purchase voucher ${number}: ${w.declaration || 'purchase from a farmer'} Verify with your CA.`,
  });
  recordSeries(number);
  return bill;
}

/** Farmer vouchers (newest first), read through the purchases contract (void rows left out). */
export function farmerVouchers(purchases: readonly unknown[]): PurchaseRecord[] {
  return purchases.filter((p): p is PurchaseRecord => !!(p as PurchaseRecord)?.ag?.voucher && !!readPurchase(p) && !isVoidStatus(readPurchase(p)!.status))
    .sort((a, b) => b.date.localeCompare(a.date) || b.bill_number.localeCompare(a.bill_number));
}

/**
 * A farmer's purchases in the FY of `date` (every bill of that vendor, through the contract) plus his lines on closed
 * pooled cycles (QA13 G14: the pooled bill is in the centre's name, the farmer's share is on the cycle) — the 194Q base.
 */
export function fyPurchasesOf(vendorId: string, date: string, purchases: readonly unknown[], cycles: readonly FarmerCycle[] = []): number {
  const fy = getIndianFY(date).label;
  const bills = purchases.reduce<number>((s, raw) => {
    const c = readPurchase(raw);
    return c && (raw as PurchaseRecord).vendor_id === vendorId && !isVoidStatus(c.status) && getIndianFY(c.date).label === fy ? s + c.taxable : s;
  }, 0);
  const pooled = cycles.reduce((s, c) => (c?.status !== 'draft' && Array.isArray(c?.lines) && getIndianFY(c.period_to).label === fy ? s + c.lines.filter((l) => l.farmer_id === vendorId).reduce((t, l) => t + num(l.amount) + num(l.bonus), 0) : s), 0);
  return round2(bills + pooled);
}

/** Delete a farmer voucher (recycle bin, number kept) and free the weighbridge slip it was made from (QA13 G15). */
export function deleteFarmerVoucher(id: string): void {
  withTablesRollback(['purchases', 'weighbridge_slips'], () => {
    purchasesDb.remove(id);
    const slips = getTable<{ id: string; ref_id?: string }>('weighbridge_slips');
    if (slips.some((s) => s?.ref_id === id)) setTable('weighbridge_slips', slips.map((s) => (s?.ref_id === id ? (({ ref_id: _r, ...r }) => (void _r, r))(s) : s)));
  });
}
