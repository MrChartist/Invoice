/**
 * Order costing (R4-A2): standard against actual per production order, the variance split, yield, and the gross margin
 * of a made-to-order sales order. A MANAGEMENT WORKING, not a books entry: the ledger does not value stock
 * (docs/features/ledger.md), so nothing here posts — verify the method with your CA before relying on it.
 *
 *  - Standard cost per finished unit = Σ component per-unit quantity (scrap included) × its standard cost in force on the
 *    order date (`standard_costs`, `rateOn`), else its weighted-average cost that day (marked "no standard"), plus the
 *    standard conversion cost typed on the order. Standard of the order = planned quantity × that.
 *  - Actual cost (live from the stock engine): cost of the components the order's journals consumed + shop-floor scrap
 *    written off + additional costs on the journals − by-product / scrap values. Actual output = Σ finished quantity.
 *  - Variances, against the standard cost of the ACTUAL output (positive = adverse, i.e. more cost):
 *      material price = (actual rate − standard rate) × actual quantity
 *      material usage = (actual quantity − standard quantity for the actual output) × standard rate
 *      yield          = (planned output − actual output) × standard unit cost      (closed orders only)
 *      conversion     = actual additional cost − standard conversion × actual output
 *    On a closed order the yield is carved out of usage and conversion (its material and conversion parts), so
 *    price + usage + yield + conversion − by-product credit = actual − standard cost of the actual output, to the paisa.
 *
 * Pure (tests/production-costing.test.ts); `loadOrderCosting` reads storage.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { ManufacturingVoucher, StockJournal } from '../../types/manufacturing';
import type { ProductionOrder } from '../../types/production-r4';
import { num, round2 } from '../invoice-calc';
import { inrValue } from '../fx';
import { lineFactor } from '../units';
import { rateOn } from '../stock-query';
import { variance } from '../ledger/budgets';
import type { StockComputation, StockItem } from '../inventory';
import { orderFulfilment } from '../sales-orders';

const EPS = 1e-6;

export interface ComponentCost {
  item_id: string;
  /** Standard quantity per finished unit (scrap included). */
  per_unit: number;
  std_rate: number;
  /** No standard cost on the order date: the weighted-average cost was used. */
  no_standard: boolean;
  actual_qty: number;
  actual_cost: number;
  actual_rate: number;
  std_qty_for_output: number;
  price: number;
  usage: number;
  yield: number;
}

export interface OrderCost {
  order: ProductionOrder;
  planned: number;
  output: number;
  closed: boolean;
  std_material_unit: number;
  std_conversion_unit: number;
  std_unit: number;
  /** planned × standard unit cost. */
  standard: number;
  /** actual output × standard unit cost. */
  standard_for_output: number;
  actual_material: number;
  actual_additional: number;
  /** By-product / scrap value deducted on the journals. */
  by_products: number;
  /** Of `actual_material`: shop-floor balance written off as scrap. */
  written_off: number;
  actual: number;
  /** Actual cost per finished unit (0 before any output). */
  unit_cost: number;
  price: number;
  usage: number;
  yield: number;
  conversion: number;
  /** actual − standard_for_output = price + usage + yield + conversion − by_products. */
  variance: number;
  favourable: boolean;
  /** output / planned × 100 (one decimal). */
  yield_pct: number;
  components: ComponentCost[];
  /** Journals / write-offs of the order (for drill-down). */
  voucher_ids: string[];
}

export interface CostingContext {
  items: readonly StockItem[];
  mfg: readonly ManufacturingVoucher[];
  journals: readonly StockJournal[];
  /** Engine result over live stock (positions with ledgers, voucher roll-ups). */
  computation: StockComputation;
  /** Weighted-average cost of an item on a day (for components without a standard). */
  wacOn: (itemId: string, day: string) => number;
}

/** Standard rate of a component on `day`: its standard cost, else the weighted-average cost (flagged). */
export function standardRate(item: StockItem | undefined, day: string, wacOn: CostingContext['wacOn']): { rate: number; no_standard: boolean } {
  const std = item ? rateOn(item.standard_costs, day) : undefined;
  if (std !== undefined) return { rate: num(std), no_standard: false };
  return { rate: item ? round2(wacOn(item.id, day)) : 0, no_standard: true };
}

/** Standard materials cost of one finished unit from the order's exploded materials. */
export function standardMaterialUnit(order: Pick<ProductionOrder, 'materials' | 'date'>, items: readonly StockItem[], wacOn: CostingContext['wacOn']): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (order.materials ?? []).reduce((s, m) => s + num(m.per_unit) * standardRate(byId.get(m.item_id), order.date, wacOn).rate, 0);
}

/** Costing of one order (see the module comment). */
export function orderCost(order: ProductionOrder, ctx: CostingContext): OrderCost {
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const outputs = ctx.mfg.filter((v) => v.production_order_id === order.id);
  const writeOffs = ctx.journals.filter((j) => j.production_order_id === order.id);
  const ids = new Set([...outputs.map((v) => v.id), ...writeOffs.map((j) => j.id)]);
  const writeOffIds = new Set(writeOffs.map((j) => j.id));
  // Actual consumption per component from the engine's ledgers (cost at issue, FIFO / weighted average).
  const actual = new Map<string, { qty: number; cost: number }>();
  let writtenOff = 0;
  for (const p of ctx.computation.positions) {
    for (const r of p.ledger) {
      if (r.kind !== 'consumption' || !r.refId || !ids.has(r.refId)) continue;
      const a = actual.get(p.item.id) ?? { qty: 0, cost: 0 };
      a.qty += r.qtyOut;
      a.cost += r.amount;
      actual.set(p.item.id, a);
      if (writeOffIds.has(r.refId)) writtenOff += r.amount;
    }
  }
  let extra = 0;
  let fixed = 0;
  for (const v of outputs) {
    const vc = ctx.computation.vouchers.get(v.id);
    extra += vc?.extra ?? 0;
    fixed += vc?.fixed ?? 0;
  }
  const output = outputs.reduce((s, v) => s + num(v.qty), 0);
  const planned = num(order.planned_qty);
  const closed = order.status === 'closed';
  const per = new Map<string, number>();
  for (const m of order.materials ?? []) per.set(m.item_id, (per.get(m.item_id) ?? 0) + num(m.per_unit));
  for (const id of actual.keys()) if (!per.has(id)) per.set(id, 0);
  const stdConv = Math.max(num(order.standard_conversion), 0);
  const components: ComponentCost[] = [];
  let stdMat = 0;
  for (const [itemId, perUnit] of per) {
    const { rate, no_standard } = standardRate(byId.get(itemId), order.date, ctx.wacOn);
    stdMat += perUnit * rate;
    const a = actual.get(itemId) ?? { qty: 0, cost: 0 };
    const stdQty = perUnit * output;
    const usage = (a.qty - stdQty) * rate;
    const yld = closed ? (planned - output) * perUnit * rate : 0;
    components.push({
      item_id: itemId, per_unit: perUnit, std_rate: rate, no_standard,
      actual_qty: Math.round(a.qty * 1000) / 1000, actual_cost: round2(a.cost), actual_rate: a.qty > EPS ? round2(a.cost / a.qty) : 0,
      std_qty_for_output: Math.round(stdQty * 1000) / 1000,
      price: round2(a.cost - rate * a.qty), usage: round2(usage - yld), yield: round2(yld),
    });
  }
  const stdUnit = stdMat + stdConv;
  const actualMaterial = round2([...actual.values()].reduce((s, a) => s + a.cost, 0));
  const actualAdditional = round2(extra);
  const byProducts = round2(fixed);
  const total = round2(actualMaterial + actualAdditional - byProducts);
  const standardForOutput = round2(stdUnit * output);
  const yieldTotal = closed ? round2((planned - output) * stdUnit) : 0;
  const yieldConv = closed ? (planned - output) * stdConv : 0;
  const conversion = round2(actualAdditional - stdConv * output - yieldConv);
  const price = round2(components.reduce((s, c) => s + c.price, 0));
  // Usage absorbs the paisa rounding so the four variances add up exactly.
  const diff = round2(total - standardForOutput);
  const usage = round2(diff - price - yieldTotal - conversion + byProducts);
  const v = variance(false, standardForOutput, total);
  return {
    order, planned, output: Math.round(output * 1000) / 1000, closed,
    std_material_unit: round2(stdMat), std_conversion_unit: round2(stdConv), std_unit: round2(stdUnit),
    standard: round2(stdUnit * planned), standard_for_output: standardForOutput,
    actual_material: actualMaterial, actual_additional: actualAdditional, by_products: byProducts, written_off: round2(writtenOff),
    actual: total, unit_cost: output > EPS ? round2(total / output) : 0,
    price, usage, yield: yieldTotal, conversion, variance: diff, favourable: v.favourable,
    yield_pct: planned > EPS ? Math.round((output / planned) * 1000) / 10 : 0,
    components, voucher_ids: [...ids],
  };
}

/** "Favourable" / "Adverse" for a cost variance (positive = more cost than standard). */
export const varianceTone = (amount: number): 'favourable' | 'adverse' | 'nil' => (Math.abs(amount) < 0.005 ? 'nil' : variance(false, 0, amount).favourable ? 'favourable' : 'adverse');

/* ── Sales-order margin ──────────────────────────────────────── */

export interface SoMarginLine {
  so_line_id: string;
  name: string;
  /** Delivered quantity, base units. */
  delivered: number;
  /** Actual cost per finished unit of the order(s) made for the line (0 = nothing reported yet). */
  unit_cost: number;
  cost: number;
  revenue: number;
}

export interface SoMargin {
  so: Pick<InvoiceRecord, 'id' | 'invoice_number' | 'issue_date'> & { client?: { name?: string } };
  revenue: number;
  cost: number;
  margin: number;
  /** One decimal; null without revenue. */
  margin_pct: number | null;
  lines: SoMarginLine[];
}

type Doc = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'items' | 'sales_order_id'> & Partial<Pick<InvoiceRecord, 'currency' | 'exchange_rate' | 'invoice_number' | 'issue_date' | 'order_closed_on' | 'client'>>;

const isTaxInvoice = (d: Pick<InvoiceRecord, 'doc_type' | 'status'>) => (d.doc_type === 'INVOICE' || d.doc_type === 'TAX_INVOICE' || d.doc_type === 'BILL_OF_SUPPLY') && d.status !== 'Cancelled' && d.status !== 'Draft';
const netLine = (l: { quantity?: number; rate?: number; discount_percent?: number }) => num(l.quantity) * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100);

/**
 * Gross margin of each sales order that has production orders: revenue = taxable value (in ₹, `inrValue`) of the
 * invoice lines raised for the made lines; cost = delivered quantity × actual cost per unit of the orders made for
 * that line. Bought-in lines of the same order are left out of both sides.
 */
export function soMargins(costs: readonly OrderCost[], invoices: readonly Doc[], links: readonly { from_id: string; to_id: string; relation: string }[]): SoMargin[] {
  const byLine = new Map<string, { cost: number; output: number }>();
  const soIds = new Set<string>();
  for (const c of costs) {
    const o = c.order;
    if (!o.so_id || !o.so_line_id || o.status === 'cancelled') continue;
    soIds.add(o.so_id);
    const k = `${o.so_id}|${o.so_line_id}`;
    const a = byLine.get(k) ?? { cost: 0, output: 0 };
    a.cost += c.actual;
    a.output += c.output;
    byLine.set(k, a);
  }
  const out: SoMargin[] = [];
  for (const soId of soIds) {
    const so = invoices.find((d) => d.id === soId && d.doc_type === 'SALES_ORDER');
    if (!so) continue;
    const f = orderFulfilment(so as InvoiceRecord, invoices, links);
    const made = new Set([...byLine.keys()].filter((k) => k.startsWith(`${soId}|`)).map((k) => k.slice(soId.length + 1)));
    const revenueByLine = new Map<string, number>();
    for (const d of invoices) {
      if (d.sales_order_id !== soId || !isTaxInvoice(d)) continue;
      for (const l of d.items ?? []) {
        if (!l.order_line_id || !made.has(l.order_line_id)) continue;
        revenueByLine.set(l.order_line_id, (revenueByLine.get(l.order_line_id) ?? 0) + inrValue(round2(netLine(l)), d));
      }
    }
    const lines: SoMarginLine[] = [];
    for (const lid of made) {
      const st = f.lines.find((x) => x.item.id === lid);
      const a = byLine.get(`${soId}|${lid}`) ?? { cost: 0, output: 0 };
      const unit = a.output > EPS ? a.cost / a.output : 0;
      const delivered = (st?.delivered ?? 0) * lineFactor(st?.item);
      lines.push({ so_line_id: lid, name: st?.item.name ?? '', delivered, unit_cost: round2(unit), cost: round2(unit * delivered), revenue: round2(revenueByLine.get(lid) ?? 0) });
    }
    const revenue = round2(lines.reduce((s, l) => s + l.revenue, 0));
    const cost = round2(lines.reduce((s, l) => s + l.cost, 0));
    out.push({
      so: { id: so.id, invoice_number: so.invoice_number ?? '', issue_date: so.issue_date ?? '', client: so.client },
      revenue, cost, margin: round2(revenue - cost), margin_pct: revenue > EPS ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null, lines,
    });
  }
  return out.sort((a, b) => (b.so.issue_date ?? '').localeCompare(a.so.issue_date ?? ''));
}

/* ── Cost-centre memo (Books → Projects) ─────────────────────── */

/**
 * Materials used per cost centre in a period: component cost consumed (and written off) by orders tagged with a cost
 * centre, on journals dated inside the period. A memo from stock, never posted.
 */
export function materialsByCostCentre(orders: readonly ProductionOrder[], ctx: Pick<CostingContext, 'mfg' | 'journals' | 'computation'>, period: { start: string; end: string }): Map<string, number> {
  const centreOf = new Map<string, string>();
  for (const o of orders) if (o.cost_centre_id && o.status !== 'cancelled') centreOf.set(o.id, o.cost_centre_id);
  const voucherCentre = new Map<string, string>();
  for (const v of [...ctx.mfg, ...ctx.journals]) {
    const c = v.production_order_id ? centreOf.get(v.production_order_id) : undefined;
    if (c && v.date >= period.start && v.date <= period.end) voucherCentre.set(v.id, c);
  }
  const out = new Map<string, number>();
  if (!voucherCentre.size) return out;
  for (const p of ctx.computation.positions) {
    for (const r of p.ledger) {
      const c = r.kind === 'consumption' && r.refId ? voucherCentre.get(r.refId) : undefined;
      if (c) out.set(c, round2((out.get(c) ?? 0) + r.amount));
    }
  }
  return out;
}

/** Rows for CSV / XLSX: one per order. */
export function costingRows(costs: readonly OrderCost[], itemName: (id: string) => string): (string | number)[][] {
  const head = ['Order', 'Date', 'Item', 'Planned', 'Output', 'Yield %', 'Standard (planned)', 'Standard (output)', 'Actual', 'Price var.', 'Usage var.', 'Yield var.', 'Conversion var.', 'By-product credit', 'Variance', 'Status'];
  return [head, ...costs.map((c) => [c.order.number, c.order.date, itemName(c.order.item_id), c.planned, c.output, c.yield_pct, c.standard, c.standard_for_output, c.actual, c.price, c.usage, c.yield, c.conversion, c.by_products, c.variance, c.order.status])];
}
