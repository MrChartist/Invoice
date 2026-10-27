/**
 * SV-C4 service recipes (back-bar consumption): a service item that is a KIT (`StockItem.kit` + its default BOM,
 * `events-kits.ts`) issues its products from stock on the sale as today — components in ml / g through alternate
 * units (the engine already honours `unit_factor`), the service line's price and tax unchanged. This report adds up
 * the consumption of a month by product, by service and by staff (`line.sv.staff_id`), with the product cost (latest
 * standard cost, else the opening rate) against the service revenue. A bill line may override the quantity used
 * (`line.sv.recipe_qty`, per product id, never printed). Pure.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { Bom } from '../../types/manufacturing';
import type { StockItem } from '../inventory';
import { kitTable } from '../events-kits';
import { lineFactor } from '../units';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';

export interface RecipeRow { key: string; qty: number; cost: number; revenue: number }

/** Cost rate of a product: the latest standard cost, else its opening rate. */
export const costRate = (i: StockItem) => num([...(i.standard_costs ?? [])].sort((a, b) => a.from.localeCompare(b.from)).pop()?.rate ?? i.opening_rate);

/** Consumption of `month` (`YYYY-MM`) grouped by product, service and staff. */
export function recipeReport(invoices: readonly InvoiceRecord[], items: readonly StockItem[], boms: readonly Bom[], month: string, staffName: (id?: string) => string): { product: RecipeRow[]; service: RecipeRow[]; staff: RecipeRow[] } {
  const table = kitTable(items, boms);
  const byId = new Map(items.map((i) => [i.id, i]));
  const kitByName = new Map(items.filter((i) => table.has(i.id)).map((i) => [i.name.trim().toLowerCase(), i.id]));
  const groups = { product: new Map<string, RecipeRow>(), service: new Map<string, RecipeRow>(), staff: new Map<string, RecipeRow>() };
  const add = (g: Map<string, RecipeRow>, key: string, qty: number, cost: number, revenue: number) => {
    const r = g.get(key) ?? { key, qty: 0, cost: 0, revenue: 0 };
    g.set(key, { key, qty: round2(r.qty + qty), cost: round2(r.cost + cost), revenue: round2(r.revenue + revenue) });
  };
  for (const inv of invoices) {
    if (!inv || inv.status === 'Draft' || inv.status === 'Cancelled' || inv.doc_type === 'CREDIT_NOTE' || !String(inv.issue_date).startsWith(month)) continue;
    let taxable: Map<string, number> | undefined;
    for (const l of inv.items ?? []) {
      const kit = kitByName.get(String(l.name).trim().toLowerCase());
      if (!kit) continue;
      taxable ??= new Map(calculateInvoice(calcInputFromRecord(inv)).lines.map((c) => [c.id, num(c.taxable)]));
      const n = num(l.quantity) * lineFactor(l);
      let cost = 0;
      for (const c of table.get(kit) ?? []) {
        const p = byId.get(c.item_id);
        if (!p) continue;
        const q = round2(l.sv?.recipe_qty?.[c.item_id] ?? n * c.per);
        const v = q * costRate(p);
        cost += v;
        add(groups.product, p.name, q, v, 0);
      }
      const rev = taxable.get(l.id) ?? 0;
      add(groups.service, l.name, n, cost, rev);
      add(groups.staff, staffName(l.sv?.staff_id), n, cost, rev);
    }
  }
  const out = (g: Map<string, RecipeRow>) => [...g.values()].sort((a, b) => b.cost - a.cost);
  return { product: out(groups.product), service: out(groups.service), staff: out(groups.staff) };
}
