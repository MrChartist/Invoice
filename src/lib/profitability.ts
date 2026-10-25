/**
 * Party and item profitability (roadmap 6.25, Vyapar / Zoho style).
 *
 * Revenue is the taxable value of issued sales documents in the period (debit notes add, credit
 * notes subtract), in rupees (foreign documents at their invoice rate; one without a rate is left
 * out and counted). Each line is costed, best source first:
 *
 *   1. stock   — a tracked inventory item: the cost of goods the inventory engine issued for THIS
 *                invoice (weighted average or FIFO, `inventory.ts`); a credit note takes the cost
 *                of the return back in — only when goods actually came back (`credit-restock.ts`):
 *                a discount / rate-difference / GST-correction note reduces revenue only, with no
 *                cost and no quantity;
 *   2. purchases — otherwise the weighted average unit cost of purchase-bill lines with the same
 *                item name (and HSN when both sides have one), from bills dated on or before the
 *                sale (any bill if none is that old);
 *   3. none    — services and items never bought: no cost (shown as "not costed", so a 100 %
 *                margin is visibly an assumption).
 *
 * Both cost sources are per BASE unit; a line typed in an alternate unit (WP-8: 2 BOX where 1 BOX =
 * 12 NOS, `unit_factor: 12`) is costed on quantity × factor (24 NOS). Revenue and GST stay as typed.
 * Purchase-bill lots are converted the same way (quantity × factor, cost ÷ factor).
 *
 * Party profit also deducts billable expenses (6.14) incurred for that client in the period
 * (purchase bills with `billable_to_client_id`, at cost: taxable value when ITC is claimed, else the
 * total), whether or not they have been re-billed yet.
 *
 * Pure: no storage. Management estimate, not a statutory figure.
 */

import type { Client, InvoiceRecord } from '../types/invoice';
import { inPeriod, type Period } from './books';
import { toCsv } from './csv';
import { fxRate } from './fx';
import { mulRound2, num, round2 } from './invoice-calc';
import type { StockPosition } from './inventory';
import { isVoidStatus, readPurchase, readPurchaseLines } from './purchase-normalize';
import { salesDocs, salesLineFactor, type SalesDoc } from './sales-reports';
import { creditNoteReturnsGoods, type RestockLink } from './credit-restock';

export type CostSource = 'stock' | 'purchases' | 'none';

export interface ProfitInputs {
  invoices: readonly InvoiceRecord[];
  purchases: readonly unknown[];
  vendors?: readonly unknown[];
  positions?: readonly StockPosition[];
  clients?: readonly Client[];
  /** `doc_links` rows: a credit note's reason decides whether goods came back (older notes). */
  links?: readonly RestockLink[];
}

/** Credit notes that brought no goods back: revenue reduction only (no cost, no quantity). */
function valueOnlyNotes(input: ProfitInputs): Set<string> {
  return new Set(
    input.invoices.filter((i) => i.doc_type === 'CREDIT_NOTE' && !creditNoteReturnsGoods(i, input.links ?? [])).map((i) => i.id),
  );
}

const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/* ── Documents in rupees ────────────────────────────────────── */

/** Every live sales document / credit note in rupees, plus how many foreign ones had no rate. */
export function rupeeDocs(invoices: readonly InvoiceRecord[]): { docs: SalesDoc[]; excluded: number } {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const currencies = new Set(invoices.map((i) => (i.currency || 'INR').toUpperCase()));
  const docs: SalesDoc[] = [];
  let excluded = 0;
  for (const cur of currencies) {
    for (const d of salesDocs(invoices, cur).docs) {
      if (cur === 'INR') {
        docs.push(d);
        continue;
      }
      const rate = fxRate(byId.get(d.id));
      if (rate === null) {
        excluded++;
        continue;
      }
      const m = (x: number) => mulRound2(x, rate);
      docs.push({
        ...d,
        taxable: m(d.taxable),
        tax: m(d.tax),
        other: m(d.other),
        total: m(d.total),
        income: m(d.income),
        lines: d.lines.map((l) => ({ ...l, taxable: m(l.taxable), cgst: m(l.cgst), sgst: m(l.sgst), igst: m(l.igst), cess: m(l.cess), tax: m(l.tax) })),
      });
    }
  }
  return { docs, excluded };
}

/* ── Costing ────────────────────────────────────────────────── */

interface PurchaseLot {
  date: string;
  hsn: string;
  qty: number;
  unitCost: number;
}

export interface Coster {
  /**
   * Signed cost of a line (signed quantity in its own unit; `unitFactor` base units per unit, absent = 1)
   * on document `docId` dated `date`, and where it came from.
   */
  cost(line: { name: string; hsn: string; quantity: number; unitFactor?: number }, doc: { id: string; date: string }): { cost: number; source: CostSource };
  /** The item's base unit from the stock items, when the line names one. */
  baseUnit(name: string, hsn: string): string | undefined;
}

export function buildCoster(purchases: readonly unknown[], vendors: readonly unknown[] = [], positions: readonly StockPosition[] = []): Coster {
  // Inventory: per tracked item, the cost issued (or returned) per invoice.
  const stockByName = new Map<string, StockPosition[]>();
  const anyByName = new Map<string, StockPosition[]>();
  for (const p of positions) {
    const k = norm(p.item.name);
    anyByName.set(k, [...(anyByName.get(k) ?? []), p]);
    if (!p.item.track_stock) continue;
    stockByName.set(k, [...(stockByName.get(k) ?? []), p]);
  }
  const findIn = (map: Map<string, StockPosition[]>, name: string, hsn: string): StockPosition | undefined => {
    const list = map.get(norm(name));
    if (!list) return undefined;
    const h = norm(hsn);
    if (!h) return list[0];
    return list.find((p) => norm(p.item.hsn) === h) ?? list.find((p) => !norm(p.item.hsn));
  };
  const findStock = (name: string, hsn: string) => findIn(stockByName, name, hsn);
  // Purchases: lots by item name.
  const lots = new Map<string, PurchaseLot[]>();
  for (const raw of purchases) {
    const bill = readPurchase(raw, vendors);
    if (!bill || isVoidStatus(bill.status) || bill.isExpense) continue;
    for (const l of readPurchaseLines(raw)) {
      if (!l.name || !(l.quantity > 0) || !(l.unitCost > 0)) continue;
      const k = norm(l.name);
      // Per base unit: 2 BOX of 12 @ ₹600 is 24 NOS @ ₹50.
      const f = l.unitFactor > 0 ? l.unitFactor : 1;
      lots.set(k, [...(lots.get(k) ?? []), { date: bill.date, hsn: norm(l.hsn), qty: l.quantity * f, unitCost: l.unitCost / f }]);
    }
  }
  const avgCost = (name: string, hsn: string, date: string): number | null => {
    const h = norm(hsn);
    const all = (lots.get(norm(name)) ?? []).filter((l) => !h || !l.hsn || l.hsn === h);
    if (!all.length) return null;
    const before = all.filter((l) => l.date <= date);
    const use = before.length ? before : all;
    const qty = use.reduce((s, l) => s + l.qty, 0);
    return qty > 0 ? use.reduce((s, l) => s + l.qty * l.unitCost, 0) / qty : null;
  };

  return {
    baseUnit(name, hsn) {
      return findIn(anyByName, name, hsn)?.item.unit?.trim() || undefined;
    },
    cost(line, doc) {
      // Both sources below cost a BASE unit: an alternate-unit line (2 BOX of 12) moves 24 of them.
      const q = num(line.quantity) * salesLineFactor(line);
      if (!q) return { cost: 0, source: 'none' };
      const pos = findStock(line.name, line.hsn);
      if (pos) {
        const rows = pos.ledger.filter((r) => r.refType === 'invoice' && r.refId === doc.id && (r.kind === 'sale' || r.kind === 'return'));
        const moved = rows.reduce((s, r) => s + r.qtyIn + r.qtyOut, 0);
        if (moved > 0) {
          const unit = rows.reduce((s, r) => s + r.amount, 0) / moved;
          return { cost: round2(unit * q), source: 'stock' };
        }
      }
      const unit = avgCost(line.name, line.hsn, doc.date);
      if (unit !== null) return { cost: round2(unit * q), source: 'purchases' };
      return { cost: 0, source: 'none' };
    },
  };
}

/* ── Item profitability ─────────────────────────────────────── */

export interface ItemProfitRow {
  key: string;
  name: string;
  hsn: string;
  unit: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
  /** profit ÷ revenue, % (null without revenue). */
  margin: number | null;
  source: CostSource | 'mixed';
  /** Revenue from lines that could not be costed. */
  uncosted: number;
}

export interface ProfitTotals {
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  uncosted: number;
}

const marginOf = (profit: number, revenue: number) => (revenue > 0 ? round2((profit / revenue) * 100) : null);

function totalsOf(rows: readonly { revenue: number; cost: number; profit: number; uncosted: number }[]): ProfitTotals {
  const revenue = round2(rows.reduce((s, r) => s + r.revenue, 0));
  const cost = round2(rows.reduce((s, r) => s + r.cost, 0));
  const profit = round2(rows.reduce((s, r) => s + r.profit, 0));
  return { revenue, cost, profit, margin: marginOf(profit, revenue), uncosted: round2(rows.reduce((s, r) => s + r.uncosted, 0)) };
}

export function itemProfitability(input: ProfitInputs, period: Period): { rows: ItemProfitRow[]; totals: ProfitTotals; excluded: number } {
  const { docs, excluded } = rupeeDocs(input.invoices);
  const coster = buildCoster(input.purchases, input.vendors, input.positions);
  const valueOnly = valueOnlyNotes(input);
  const map = new Map<string, ItemProfitRow & { sources: Set<CostSource> }>();
  for (const d of docs) {
    if (!inPeriod(d.date, period)) continue;
    for (const l of d.lines) {
      if (l.name === '(no line items)') continue;
      const key = norm(l.name) || '(unnamed)';
      const row = map.get(key) ?? { key, name: l.name || '(unnamed)', hsn: l.hsn, unit: l.unit, quantity: 0, revenue: 0, cost: 0, profit: 0, margin: null, source: 'none', uncosted: 0, sources: new Set<CostSource>() };
      if (valueOnly.has(d.id)) {
        row.revenue = round2(row.revenue + l.taxable);
        map.set(key, row);
        continue;
      }
      const c = coster.cost(l, d);
      const f = salesLineFactor(l);
      const base = f !== 1 ? coster.baseUnit(l.name, l.hsn) : undefined;
      // Quantity in the item's base unit when an alternate-unit line can be resolved to it.
      row.quantity = round2(row.quantity + (base ? l.quantity * f : l.quantity));
      if (base) row.unit = base;
      row.revenue = round2(row.revenue + l.taxable);
      row.cost = round2(row.cost + c.cost);
      if (c.source === 'none') row.uncosted = round2(row.uncosted + l.taxable);
      row.sources.add(c.source);
      if (!row.hsn && l.hsn) row.hsn = l.hsn;
      map.set(key, row);
    }
  }
  const rows: ItemProfitRow[] = [...map.values()].map(({ sources, ...r }) => {
    const profit = round2(r.revenue - r.cost);
    return { ...r, profit, margin: marginOf(profit, r.revenue), source: sources.size > 1 ? 'mixed' : ([...sources][0] ?? 'none') };
  });
  rows.sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
  return { rows, totals: totalsOf(rows), excluded };
}

/* ── Party profitability ────────────────────────────────────── */

export interface PartyProfitRow {
  key: string;
  name: string;
  clientId?: string;
  partyKey: string;
  docs: number;
  revenue: number;
  /** Cost of goods sold. */
  cogs: number;
  /** Billable expenses incurred for the client. */
  expenses: number;
  cost: number;
  profit: number;
  margin: number | null;
  uncosted: number;
}

export function partyProfitability(input: ProfitInputs, period: Period): { rows: PartyProfitRow[]; totals: ProfitTotals & { cogs: number; expenses: number }; excluded: number } {
  const { docs, excluded } = rupeeDocs(input.invoices);
  const coster = buildCoster(input.purchases, input.vendors, input.positions);
  const valueOnly = valueOnlyNotes(input);
  const map = new Map<string, PartyProfitRow>();
  const byClientId = new Map<string, string>();
  const rowFor = (key: string, name: string, clientId: string | undefined, partyKey: string) => {
    let row = map.get(key);
    if (!row) {
      row = { key, name, clientId, partyKey, docs: 0, revenue: 0, cogs: 0, expenses: 0, cost: 0, profit: 0, margin: null, uncosted: 0 };
      map.set(key, row);
      if (clientId) byClientId.set(clientId, key);
    }
    return row;
  };
  for (const d of docs) {
    if (!inPeriod(d.date, period)) continue;
    const row = rowFor(d.customerKey, d.customerName, d.clientId, d.partyKey);
    row.docs++;
    row.revenue = round2(row.revenue + d.taxable);
    if (valueOnly.has(d.id)) continue;
    for (const l of d.lines) {
      const c = coster.cost(l, d);
      row.cogs = round2(row.cogs + c.cost);
      if (c.source === 'none') row.uncosted = round2(row.uncosted + l.taxable);
    }
  }
  for (const raw of input.purchases) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const clientId = typeof r.billable_to_client_id === 'string' ? r.billable_to_client_id : '';
    if (!clientId) continue;
    const bill = readPurchase(raw, input.vendors);
    if (!bill || isVoidStatus(bill.status) || !inPeriod(bill.date, period)) continue;
    const cost = bill.itcEligible ? bill.taxable : bill.total;
    const existing = byClientId.get(clientId);
    const master = input.clients?.find((c) => c.id === clientId);
    const row = existing ? map.get(existing)! : rowFor(`id:${clientId}`, String(master?.company || master?.name || 'Client'), clientId, clientId);
    row.expenses = round2(row.expenses + cost);
  }
  const rows = [...map.values()].map((r) => {
    const cost = round2(r.cogs + r.expenses);
    const profit = round2(r.revenue - cost);
    return { ...r, cost, profit, margin: marginOf(profit, r.revenue) };
  });
  rows.sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));
  const t = totalsOf(rows);
  return {
    rows,
    totals: { ...t, cogs: round2(rows.reduce((s, r) => s + r.cogs, 0)), expenses: round2(rows.reduce((s, r) => s + r.expenses, 0)) },
    excluded,
  };
}

/* ── CSV ────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<ItemProfitRow['source'], string> = { stock: 'Inventory cost', purchases: 'Average purchase cost', none: 'Not costed', mixed: 'Mixed' };
export const costSourceLabel = (s: ItemProfitRow['source']) => SOURCE_LABEL[s];

export function itemProfitCsv(rep: ReturnType<typeof itemProfitability>, period: Period): string {
  return toCsv([
    [`Item profitability ${period.start} to ${period.end}`, 'Management estimate (taxable value, ₹)'],
    ['Item', 'HSN/SAC', 'Unit', 'Quantity', 'Sales (taxable)', 'Cost', 'Profit', 'Margin %', 'Cost basis', 'Not costed (sales)'],
    ...rep.rows.map((r) => [r.name, r.hsn, r.unit, r.quantity, r.revenue, r.cost, r.profit, r.margin ?? '', SOURCE_LABEL[r.source], r.uncosted]),
    ['Total', '', '', '', rep.totals.revenue, rep.totals.cost, rep.totals.profit, rep.totals.margin ?? '', '', rep.totals.uncosted],
  ]);
}

export function partyProfitCsv(rep: ReturnType<typeof partyProfitability>, period: Period): string {
  return toCsv([
    [`Party profitability ${period.start} to ${period.end}`, 'Management estimate (taxable value, ₹)'],
    ['Customer', 'Documents', 'Sales (taxable)', 'Cost of goods sold', 'Billable expenses', 'Profit', 'Margin %', 'Not costed (sales)'],
    ...rep.rows.map((r) => [r.name, r.docs, r.revenue, r.cogs, r.expenses, r.profit, r.margin ?? '', r.uncosted]),
    ['Total', '', rep.totals.revenue, rep.totals.cogs, rep.totals.expenses, rep.totals.profit, rep.totals.margin ?? '', rep.totals.uncosted],
  ]);
}
