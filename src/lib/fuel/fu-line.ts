/**
 * R21-A3 the fuel line (pure): the price in force at a moment, ₹ ↔ litres (the amount stays exact, the litres are
 * rounded to three decimals — FU8), the non-GST column of MS / HSD / CNG by the line date (R10 line key
 * `sv.exempt: 'NON_GST'`, FU1), the `fu.lines[lineId]` snapshot and the document decision: a fuel-only bill is a Bill
 * of Supply; a mixed bill to a buyer without a GSTIN takes the Rule 46A title (R10 `sv.rule46a`); to a GSTIN buyer it
 * is split into a Bill of Supply and a tax invoice (FU4). Working papers — verify with your CA.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelPrice, FuLine, FuProduct } from '../../types/fuel-r21';
import { num, round2 } from '../invoice-calc';
import { FUEL_GST_STATUS_RULES, fuKeyedAt } from '../fuel-rules';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** "2-B" (DU no. – nozzle no.). */
export const nozzleLabel = (n: Pick<FuelNozzle, 'du_no' | 'nozzle_no'>): string => `${n.du_no}-${n.nozzle_no}`;

/** The price row in force for `itemId` at `day` `time` (the latest at or before that moment; a later-saved row wins a tie), or null. */
export function priceAt(rows: readonly FuelPrice[], itemId: string, day: string, time: string): FuelPrice | null {
  const t = `${day} ${time}`;
  let hit: FuelPrice | null = null;
  for (const r of rows) if (r.item_id === itemId && `${r.date} ${r.time}` <= t && (!hit || `${r.date} ${r.time}` >= `${hit.date} ${hit.time}`)) hit = r;
  return hit;
}

/** Is this product outside GST on `day` (FUEL_GST_STATUS_RULES)? */
export const isNonGst = (product: FuProduct | undefined, day: string): boolean => !!product && !!fuKeyedAt(FUEL_GST_STATUS_RULES, product, day);

/** ₹ → litres at `rsp` (three decimals) and the rate that keeps the amount exact. */
export function litresFor(amount: number, rsp: number): { litres: number; rate: number } {
  const litres = rsp > 0 ? r3(amount / rsp) : 0;
  return { litres, rate: litres ? Math.round((amount / litres) * 1e6) / 1e6 : rsp };
}

/** The line at the price in force, from ₹ (`amount`) or litres (the line's quantity), with its `fu` data. */
export function fuelLine(line: InvoiceItem, o: { product: FuProduct; unit?: 'L' | 'KG'; price: FuelPrice; nozzle?: FuelNozzle; amount?: number; day: string }): { line: InvoiceItem; fu: FuLine } {
  const q = o.amount && o.amount > 0 ? litresFor(o.amount, o.price.rsp) : { litres: r3(num(line.quantity)), rate: o.price.rsp };
  const out: InvoiceItem = { ...line, quantity: q.litres, rate: q.rate, amount: round2(q.litres * q.rate) };
  if (isNonGst(o.product, o.day)) Object.assign(out, { tax_rate: 0, sv: { ...line.sv, exempt: 'NON_GST' } });
  const fu: FuLine = { litres: q.litres, price_id: o.price.id, rsp: o.price.rsp, at: `${o.price.date} ${o.price.time}`, ...(o.unit === 'KG' ? { unit: 'KG' as const } : {}), ...(o.nozzle ? { nozzle_id: o.nozzle.id, nozzle: nozzleLabel(o.nozzle) } : {}) };
  return { line: out, fu };
}

const live = (r: Pick<InvoiceRecord, 'items'>) => (r.items ?? []).filter((i) => num(i.quantity) || num(i.rate));
const isFuel = (i: InvoiceItem) => i.sv?.exempt === 'NON_GST';

/** The document patch for a bill with fuel lines, and whether it must be split (mixed lines to a GSTIN buyer). */
export function fuDocPatch(rec: InvoiceRecord, lines: Readonly<Record<string, FuLine>>): { patch: Partial<InvoiceRecord>; split: boolean } {
  const items = live(rec);
  const fuel = items.filter(isFuel).length;
  if (!Object.keys(lines).length) return { patch: {}, split: false };
  const patch: Partial<InvoiceRecord> = { fu: { ...rec.fu, lines: { ...lines } } };
  if (fuel && fuel === items.length) Object.assign(patch, { doc_type: 'BILL_OF_SUPPLY', exempt_kind: 'NON_GST' });
  else if (fuel && !String(rec.client?.gstin ?? '').trim()) patch.sv = { ...rec.sv, rule46a: true };
  return { patch, split: !!fuel && fuel < items.length && !!String(rec.client?.gstin ?? '').trim() };
}

/** FU4: a mixed bill to a GSTIN buyer → a Bill of Supply (the non-GST lines) and a tax invoice (the rest); ids / numbers are the caller's. */
export function fuSplit(rec: InvoiceRecord): [InvoiceRecord, InvoiceRecord] {
  const fuel = rec.items.filter(isFuel);
  const ids = new Set(fuel.map((i) => i.id));
  const lines = Object.fromEntries(Object.entries(rec.fu?.lines ?? {}).filter(([id]) => ids.has(id)));
  const { fu: _fu, ...rest } = rec;
  void _fu;
  return [
    { ...rec, items: fuel, doc_type: 'BILL_OF_SUPPLY', exempt_kind: 'NON_GST', fu: { ...rec.fu, lines } },
    { ...rest, items: rec.items.filter((i) => !ids.has(i.id)) },
  ];
}
