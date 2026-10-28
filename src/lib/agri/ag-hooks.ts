/**
 * AG-A3 hook loaded by `gst-guards.ts` (one dynamic import, agri companies only): the soft "rate differs from the
 * class (AGn)" notice on lines that carry an agri class. C's pre-packaged 25 kg rule plugs into this same check.
 * QA13 G6: a line typed in the editor / POS carries no class of its own, so the class comes from its stock item (by
 * name); a line selling less than one pack (kg sold < `ag_pack_kg`) is a loose counter sale from a bigger bag.
 * Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { StockItem } from '../inventory';
import { getTable } from '../storage';
import { num } from '../invoice-calc';
import { kgPer } from '../trade/tr-weight';
import { caOfClass, classRate } from './ag-tax';
import { packClass } from './ag-packing';

const LITRE = /^(L|LTR|LTRS|LITRE|LITRES)$/;
/** kg (or litres) per unit: a weight unit through `kgPer`, a litre as 1, else undefined (a pack / piece unit). */
const per = (u?: string): number | undefined => kgPer(u) ?? (LITRE.test(String(u ?? '').trim().toUpperCase()) ? 1 : undefined);
/** kg (or litres) a line sells: its own weight unit, else base units (× `unit_factor`) of the item's weight unit or packs. */
const kgSold = (l: { quantity?: number; unit?: string; unit_factor?: number }, it: StockItem): number => {
  const own = per(l.unit);
  if (own !== undefined) return num(l.quantity) * own;
  const base = num(l.quantity) * (num(l.unit_factor) > 0 ? num(l.unit_factor) : 1);
  return base * (per(it.unit) ?? num(it.ag_pack_kg));
};

export function agExceptions(inv: InvoiceRecord): { code: 'AG_CLASS_RATE'; vars: Record<string, string | number> }[] {
  const out: { code: 'AG_CLASS_RATE'; vars: Record<string, string | number> }[] = [];
  // AG-C4: a stock item's class, pack size and label move a loose / packed class pair (≤ 25 kg labelled → packed).
  const items = new Map(getTable<StockItem>('stock_items').filter((i) => i?.name && (i.ag_class || i.ag_pack_kg || i.ag_labelled)).map((i) => [i.name.trim().toLowerCase(), i]));
  for (const l of inv.items ?? []) {
    const it = items.get(String(l?.name ?? '').trim().toLowerCase());
    const own = l?.ag_class ?? it?.ag_class;
    if (!own) continue;
    const counterLoose = !!it && num(it.ag_pack_kg) > 0 && kgSold(l, it) < num(it.ag_pack_kg) - 1e-9;
    const cls = it ? packClass({ ag_class: own, ag_pack_kg: it.ag_pack_kg, ag_labelled: it.ag_labelled }, { date: inv.issue_date, counterLoose }) ?? own : own;
    const c = classRate(cls, inv.issue_date);
    if (c && (Number(l.tax_rate) || 0) !== c.rate) out.push({ code: 'AG_CLASS_RATE', vars: { name: l.name, rate: Number(l.tax_rate) || 0, want: c.rate, ca: caOfClass(cls) } });
  }
  return out;
}
