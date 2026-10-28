/**
 * AG-C5 mill reports (read-only).
 *
 *  - Monthly mill report: intake (own purchases of the batches' input items, CMR paddy, job-milling receipts), milled
 *    (input of the month's manufacturing journals), outputs by kind, outturn % vs the input-weighted standard,
 *    moisture loss, batches flagged (C2) and by-product realisation (sales value ÷ qty). Every figure is a sum of the
 *    journal figures `ag-yield.ts` gives a batch, so Σ months = Σ batches. Oil mills read the same panel: outturn % is
 *    the oil yield on seed and by-product % the cake.
 *  - Bank stock statement, mill preset (`STOCK_STATEMENT_PRESETS.mill` in `tr-stock-statement.ts`): the TR-C4 working
 *    with stock grouped as paddy / rice / broken / bran / husk / packing; principals' material (CMR / job, the JWP
 *    register) is never in our stock and is shown only as an excluded memo; creditors for goods are deducted as before.
 *
 * Purchases are read through `readPurchase` / `readPurchaseLines` (tests/purchase-contract.test.ts); stock lines through
 * `lineFactor`. Pure above "Storage" (tests/ag-mill-reports.test.ts).
 */
import type { CmrAgreement, MillOrderMeta } from '../../types/agri-r12';
import type { InvoiceRecord } from '../../types/invoice';
import type { ManufacturingVoucher } from '../../types/manufacturing';
import type { PrincipalMovement } from '../../types/job-work';
import type { ProductionOrder } from '../../types/production-r4';
import type { BankStatementTerms } from '../../types/trade-r8';
import { computeStock, liveInputs, stockDb, type StockItem, type StockPosition } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { getTable } from '../storage';
import { readPurchase, readPurchaseLines } from '../purchase-normalize';
import { principalBalances, principalDb } from '../job-work';
import { manufacturingDb } from '../manufacturing';
import { productionOrdersDb } from '../production/orders';
import { loadStockStatementInput } from '../trade/tr-stock-live';
import { loadAgreements } from './ag-cmr';
import { kgPer } from '../trade/tr-weight';
import { STOCK_STATEMENT_PRESETS, type StockStatementInput } from '../trade/tr-stock-statement';
import { ZERO, addFigures, moistureLoss, voucherFigures, yieldOf, type YieldFigures } from './ag-yield';

const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;
const monthOf = (d: string) => String(d ?? '').slice(0, 7);
const low = (s: unknown) => String(s ?? '').trim().toLowerCase();

export interface Realisation { item_id: string; name: string; qty: number; value: number; rate: number }

export interface MillMonth extends YieldFigures {
  month: string;
  /** kg (or the unit when not a weight). */
  intakeOwn: number;
  intakeCmr: number;
  intakeJob: number;
  outturnPct: number;
  byPct: number;
  /** Input-weighted standard outturn of the month's batches. */
  standard: number;
  moistureLoss: number;
  flagged: number;
  realisation: Realisation[];
}

export interface MillReportInput {
  orders: readonly ProductionOrder[];
  mfg: readonly ManufacturingVoucher[];
  items: readonly StockItem[];
  purchases: readonly unknown[];
  principal: readonly PrincipalMovement[];
  agreements: readonly CmrAgreement[];
  invoices: readonly InvoiceRecord[];
}

/** The input items of the batches (BOM components consumed by their journals). */
function inputItems(mfg: readonly ManufacturingVoucher[]): Set<string> {
  return new Set(mfg.filter((v) => v?.production_order_id).flatMap((v) => (v.components ?? []).map((c) => c.item_id)));
}
/** The by-product items of the batches. */
function byItems(mfg: readonly ManufacturingVoucher[]): Set<string> {
  return new Set(mfg.filter((v) => v?.production_order_id).flatMap((v) => (v.outputs ?? []).filter((o) => o.kind === 'by_product').map((o) => o.item_id)));
}

/** Pure: by-product realisation from issued sales documents in `month` (lines matched to the item by name / alias). */
export function realisation(invoices: readonly InvoiceRecord[], items: readonly StockItem[], ids: ReadonlySet<string>, month?: string): Realisation[] {
  const want = items.filter((i) => ids.has(i.id));
  const names = new Map<string, StockItem>();
  for (const i of want) for (const n of [i.name, ...(i.aliases ?? [])]) names.set(low(n), i);
  const acc = new Map<string, Realisation>();
  for (const inv of invoices) {
    if (!inv || !isRevenueDoc(inv) || (month && monthOf(inv.issue_date) !== month)) continue;
    for (const l of inv.items ?? []) {
      const it = names.get(low(l.name));
      if (!it) continue;
      const q = num(l.quantity) * (num(l.unit_factor) > 0 ? num(l.unit_factor) : 1);
      const v = num(l.quantity) * num(l.rate) * (1 - Math.min(Math.max(num(l.discount_percent), 0), 100) / 100);
      const r = acc.get(it.id) ?? { item_id: it.id, name: it.name, qty: 0, value: 0, rate: 0 };
      r.qty = r3(r.qty + q);
      r.value = round2(r.value + v);
      acc.set(it.id, r);
    }
  }
  return [...acc.values()].map((r) => ({ ...r, rate: r.qty > 0 ? round2(r.value / r.qty) : 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Pure: the monthly mill report, newest month first. */
export function millMonths(i: MillReportInput): MillMonth[] {
  const byId = new Map(i.items.map((x) => [x.id, x]));
  const orders = new Map(i.orders.map((o) => [o.id, o]));
  const months = new Map<string, MillMonth & { stdWeight: number }>();
  const blank = (month: string) => ({ ...ZERO, month, intakeOwn: 0, intakeCmr: 0, intakeJob: 0, outturnPct: 0, byPct: 0, standard: 0, moistureLoss: 0, flagged: 0, realisation: [], stdWeight: 0 });
  const get = (m: string) => {
    let x = months.get(m);
    if (!x) months.set(m, (x = blank(m)));
    return x;
  };
  // Milled and outputs: every journal reported against a production order (a milling batch).
  const lastMonth = new Map<string, string>();
  for (const v of i.mfg) {
    if (!v?.production_order_id || !v.date) continue;
    const f = voucherFigures(v, byId);
    const meta: Partial<MillOrderMeta> | undefined = orders.get(v.production_order_id)?.ag?.mill;
    const m = get(monthOf(v.date));
    Object.assign(m, addFigures(m, f));
    m.moistureLoss = r3(m.moistureLoss + moistureLoss(f.input, meta?.input_moisture, meta?.output_moisture));
    if (num(meta?.standard_outturn_pct) > 0) {
      m.standard += num(meta?.standard_outturn_pct) * f.input;
      m.stdWeight += f.input;
    }
    const prev = lastMonth.get(v.production_order_id);
    if (!prev || prev < monthOf(v.date)) lastMonth.set(v.production_order_id, monthOf(v.date));
  }
  // Batches flagged, in the month of their last journal.
  for (const [orderId, month] of lastMonth) {
    const o = orders.get(orderId);
    if (!o) continue;
    const f = i.mfg.filter((v) => v?.production_order_id === orderId).reduce((t, v) => addFigures(t, voucherFigures(v, byId)), ZERO);
    if (yieldOf(f, o.ag?.mill).flag) get(month).flagged += 1;
  }
  // Intake: own purchases of the batches' input items (kg), CMR paddy lots, job-milling receipts.
  const inputs = inputItems(i.mfg);
  const inputNames = new Map<string, StockItem>();
  for (const id of inputs) {
    const it = byId.get(id);
    if (it) for (const n of [it.name, ...(it.aliases ?? [])]) inputNames.set(low(n), it);
  }
  for (const raw of i.purchases) {
    const p = readPurchase(raw);
    const kind = (raw as { kind?: string } | null)?.kind ?? 'PURCHASE';
    if (!p || kind !== 'PURCHASE' || (raw as { status?: string }).status === 'void') continue;
    for (const l of readPurchaseLines(raw)) {
      const it = (l.itemId && inputs.has(l.itemId) ? byId.get(l.itemId) : undefined) ?? inputNames.get(low(l.name));
      if (!it) continue;
      get(monthOf(p.date)).intakeOwn = r3(get(monthOf(p.date)).intakeOwn + (l.unitFactor !== 1 ? l.quantity * l.unitFactor * (kgPer(it.unit) ?? 1) : l.quantity * (kgPer(l.unit || it.unit) ?? 1))); // QA13 G13: an alternate unit converts to the item's unit first
    }
  }
  const cmrJwp = new Set<string>();
  for (const a of i.agreements) {
    for (const l of a.paddy_lots ?? []) {
      cmrJwp.add(l.jwp_id);
      const m = get(monthOf(l.date));
      m.intakeCmr = r3(m.intakeCmr + num(l.qty) * 100);
    }
  }
  for (const r of i.principal) {
    if (!r || r.kind !== 'receipt' || cmrJwp.has(r.id)) continue;
    const m = get(monthOf(r.date));
    m.intakeJob = r3(m.intakeJob + (r.lines ?? []).reduce((s, l) => s + num(l.qty) * (kgPer(l.unit) ?? 1), 0));
  }
  const bys = byItems(i.mfg);
  return [...months.values()].filter((m) => m.month).map(({ stdWeight, ...m }) => {
    const y = yieldOf(m, undefined, undefined, m.moistureLoss);
    return { ...m, outturnPct: y.outturnPct, byPct: y.byPct, standard: stdWeight > 0 ? round2(m.standard / stdWeight) : 0, realisation: realisation(i.invoices, i.items, bys, m.month) };
  }).sort((a, b) => b.month.localeCompare(a.month));
}

/* ── Bank stock statement, mill preset ─────────────────────────── */

export type MillGroup = (typeof STOCK_STATEMENT_PRESETS.mill.groups)[number];

const CLASS_GROUP: Readonly<Record<string, MillGroup>> = {
  paddy: 'paddy', cereal_loose: 'rice', cereal_packed_25: 'rice', flour_loose: 'rice', flour_packed_25: 'rice', pulses_loose: 'rice', pulses_packed_25: 'rice', edible_oil: 'rice',
  broken_rice: 'broken', rice_bran_feed: 'bran', rice_bran_other: 'bran', dorb: 'bran', oil_cake_feed: 'bran', oil_cake_other: 'bran', rice_husk: 'husk',
};

/** The mill group of a stock item: by its class, else by name (paddy / dhan, broken, bran / chokar / cake, husk, bags). */
export function millGroup(item: Pick<StockItem, 'name' | 'ag_class'>): MillGroup {
  if (item.ag_class && CLASS_GROUP[item.ag_class]) return CLASS_GROUP[item.ag_class];
  const n = low(item.name);
  if (/paddy|dhan|wheat|gehu|seed|pulses \(whole\)|grain/.test(n)) return 'paddy';
  if (/broken|kanki|khanda/.test(n)) return 'broken';
  if (/bran|chokar|cake|khal|chunni/.test(n)) return 'bran';
  if (/husk|bhusa|chilka/.test(n)) return 'husk';
  if (/bag|gunny|bardana|pack|carton|pouch|label/.test(n)) return 'packing';
  if (/rice|chawal|atta|maida|suji|flour|dal|oil/.test(n)) return 'rice';
  return 'other';
}

/** Pure: stock at cost by mill group (preset order; empty groups left out). */
export function millStockGroups(positions: readonly Pick<StockPosition, 'item' | 'value'>[], label: (g: MillGroup) => string): { name: string; value: number }[] {
  const by = new Map<MillGroup, number>();
  for (const p of positions) {
    if (!(Math.abs(p.value) > 0.004)) continue;
    const g = millGroup(p.item);
    by.set(g, round2((by.get(g) ?? 0) + p.value));
  }
  return STOCK_STATEMENT_PRESETS.mill.groups.filter((g) => by.has(g)).map((g) => ({ name: label(g), value: by.get(g)! }));
}

/** Pure: principals' material still with us (JWP register): quintals of weight lines and the typed value, if any. */
export function principalMemo(rows: readonly PrincipalMovement[]): { qtl: number; value: number } {
  let qtl = 0;
  let value = 0;
  const unitValue = new Map<string, number>();
  for (const r of rows) for (const l of r?.kind === 'receipt' ? r.lines ?? [] : []) if (num(l.value) > 0 && num(l.qty) > 0) unitValue.set(low(l.name), num(l.value) / num(l.qty));
  for (const b of principalBalances(rows)) {
    if (!(b.pending > 0)) continue;
    qtl += (b.pending * (kgPer(b.unit) ?? 0)) / 100;
    value += b.pending * (unitValue.get(low(b.name)) ?? 0);
  }
  return { qtl: r3(qtl), value: round2(value) };
}

/* ================================================================
   Storage (readers)
   ================================================================ */

/** Everything the monthly mill report reads. */
export function loadMillReportInput(): MillReportInput {
  return {
    orders: productionOrdersDb.all(), mfg: manufacturingDb.all(), items: stockDb.items(), purchases: getTable('purchases'),
    principal: principalDb.all(), agreements: loadAgreements(), invoices: getTable<InvoiceRecord>('invoices'),
  };
}

/** The bank stock statement input with the mill preset: stock regrouped, principals' material as a memo. */
export function loadMillStockStatement(asOf: string, bankAccountId: string, terms: BankStatementTerms, label: (g: MillGroup) => string): StockStatementInput & { valuerLabel?: string; principalQtl: number } {
  const base = loadStockStatementInput(asOf, bankAccountId, terms);
  const memo = principalMemo(principalDb.all().filter((r) => r.date <= asOf));
  return { ...base, groups: millStockGroups(computeStock({ ...liveInputs(), asOf }), label), consignment: round2(base.consignment + memo.value), principalQtl: memo.qtl };
}
