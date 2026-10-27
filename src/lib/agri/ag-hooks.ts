/**
 * AG-A3 hook loaded by `gst-guards.ts` (one dynamic import, agri companies only): the soft "rate differs from the
 * class (AGn)" notice on lines that carry an agri class. C's pre-packaged 25 kg rule plugs into this same check.
 * Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { StockItem } from '../inventory';
import { getTable } from '../storage';
import { caOfClass, classRate } from './ag-tax';
import { packClass } from './ag-packing';

export function agExceptions(inv: InvoiceRecord): { code: 'AG_CLASS_RATE'; vars: Record<string, string | number> }[] {
  const out: { code: 'AG_CLASS_RATE'; vars: Record<string, string | number> }[] = [];
  // AG-C4: a stock item's pack size and label move a loose / packed class pair (≤ 25 kg labelled → packed).
  const packs = new Map(getTable<StockItem>('stock_items').filter((i) => i?.name && (i.ag_pack_kg || i.ag_labelled)).map((i) => [i.name.trim().toLowerCase(), i]));
  for (const l of inv.items ?? []) {
    const it = l?.ag_class ? packs.get(String(l.name ?? '').trim().toLowerCase()) : undefined;
    const cls = l?.ag_class ? (it ? packClass({ ag_class: l.ag_class, ag_pack_kg: it.ag_pack_kg, ag_labelled: it.ag_labelled }, { date: inv.issue_date }) ?? l.ag_class : l.ag_class) : undefined;
    const c = cls ? classRate(cls, inv.issue_date) : null;
    if (c && (Number(l.tax_rate) || 0) !== c.rate) out.push({ code: 'AG_CLASS_RATE', vars: { name: l.name, rate: Number(l.tax_rate) || 0, want: c.rate, ca: caOfClass(cls!) } });
  }
  return out;
}
