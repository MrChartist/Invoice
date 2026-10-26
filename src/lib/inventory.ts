/**
 * Inventory / stock summary (Tally / Vyapar style).
 *
 * Stock is DERIVED, never stored: a position is computed on read from
 *   opening balance + manual `stock_moves` + invoice lines + purchase lines.
 * Invoices and purchases are read-only inputs and are never mutated.
 *
 * Pure logic (everything above the "persistence" banner) has no browser APIs
 * so it is unit-tested under node:test.
 *
 * Costing: weighted-average (default) or FIFO. Sales are costed at issue time
 * (COGS); sales returns come back in at the cost of the most recent issue.
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import { round2, num } from './invoice-calc';
import { DB_PREFIX, generateId, getJson, getTable, peekTable, readRaw, setJson, setTable } from './storage';
import { isVoidStatus, readPurchase, readPurchaseLines } from './purchase-normalize';
import { toCsv } from './csv';
import { creditNoteReturnsGoods } from './credit-restock';
import { MAIN_GODOWN_ID, type StockTransfer } from '../types/stock';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { grnCoverage, loadReturnStockDocs, returnStockEvents, type ReturnStockDocs } from './events-returns';
import { jobWorkStockEvents, loadJobWorkStockDocs, type JobWorkStockDocs } from './events-job-work';
import { kitStockEvents } from './events-kits';
import { lineFactor } from './units';
import { itemVoucherReferences } from './item-references';
import { applyLandedVouchers, loadLandedVouchers } from './landed-voucher'; // R4-A5
import type {
  Bom, ManufacturingVoucher, PhysicalStockVoucher, StockJournal, VoucherOutputLine, VoucherStockLine,
} from '../types/manufacturing';

/* ── Types ───────────────────────────────────────────────────── */

export type CostingMethod = 'WEIGHTED_AVG' | 'FIFO';
export type MoveKind = 'opening' | 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer'
  /** Phase 7: components issued / goods produced by a Manufacturing Journal or Stock Journal. */
  | 'consumption' | 'production';
export type StockStatus = 'untracked' | 'negative' | 'out' | 'low' | 'ok';

export interface StockItem {
  id: string;
  /** Matches the catalogue / invoice line name (case-insensitive). */
  name: string;
  sku?: string;
  /** Additive (6.7): barcode on the pack; a scan in the editor / POS finds the item by it. */
  barcode?: string;
  hsn?: string;
  unit: string;
  track_stock: boolean;
  opening_qty: number;
  opening_rate: number;
  reorder_level: number;
  sale_rate?: number;
  tax_rate?: number;
  /** Shelf / bin / rack location (8F: printed on pick lists and delivery challans). */
  location?: string;
  created_at?: string;
  /* ── Opt-in tracking (6.6 / 6.11); absent = off ── */
  /** Batch / expiry tracking: purchase lines capture batch + MFG / expiry, sales pick a batch (FEFO). */
  track_batches?: boolean;
  /** Serial / IMEI tracking: purchase lines list one serial per unit, sales pick in-stock serials. */
  track_serials?: boolean;
  /** Warranty given on a sale, in months (serial-tracked items; 0 / absent = none). */
  warranty_months?: number;
  /** Serials of the opening quantity (serial-tracked items). */
  opening_serials?: string[];
  /**
   * Additive (integrity review): earlier names of this item, recorded on rename, so documents saved
   * under an old name still match it (`buildItemIndex`). A current name always wins over an alias.
   */
  aliases?: string[];
  /* ── Reorder (Phase 7); absent = none ── */
  /** Minimum order quantity: a suggested order is never smaller than this. */
  min_order_qty?: number;
  /** Optional reorder level per godown id (multi-godown businesses). */
  reorder_by_godown?: Record<string, number>;
  /* ── Masters (WP-8, docs/features/inventory-masters.md); absent = none ── */
  /** `stock_groups` row (absent = Primary) and `stock_categories` row (absent = not categorised). */
  group_id?: string;
  category_id?: string;
  /** Additive (8H catalogue v2): photo as an `asset:<id>` reference (`item-images.ts`). */
  image?: string;
  /** Alternate units: 1 `unit` = `factor` base units (`src/lib/units.ts`). Lines snapshot `unit_factor`. */
  alt_units?: { unit: string; factor: number }[];
  /** Standard cost and selling price lists, each rate effective from `from` (yyyy-mm-dd) until the next entry. */
  standard_costs?: { from: string; rate: number }[];
  selling_prices?: { from: string; rate: number }[];
  /* ── 8F (docs/features/distribution.md, inventory.md); absent = none ── */
  /** Salt / composition (pharma), e.g. "Paracetamol 500mg": the editor and POS find substitutes by it. */
  salt?: string;
  /** Variant child: the parent (template) item id; `variant_attrs` holds its values, e.g. {Size: 'L', Colour: 'Red'}. */
  variant_of?: string;
  variant_attrs?: Record<string, string>;
  /** Variant parent: the attribute grid the children were generated from. */
  variant_axes?: { name: string; values: string[] }[];
  /** Kit: sold as one line; its default BOM's components leave stock on the sale (`events-kits.ts`). Not stocked itself. */
  kit?: boolean;
  /** Bin / rack per batch (key: batch number, upper case); the item's own bin is `location`. */
  batch_bins?: Record<string, string>;
}

export interface StockMove {
  id: string;
  item_id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Signed: positive = stock in, negative = stock out. */
  qty: number;
  /** Unit cost for stock-in; sale rate for stock-out (informational). */
  rate: number;
  kind: MoveKind;
  ref_type?: string;
  ref_id?: string;
  note?: string;
  /** Additive (6.10): godown of the move (absent = Main). */
  godown_id?: string;
  /** Additive (6.6): batch added / removed, with its dates for an addition. */
  batch_no?: string;
  mfg_date?: string;
  expiry_date?: string;
  /** Additive (6.11): serials added / removed; count equals |qty|. */
  serials?: string[];
  /**
   * Additive (7M): unit the quantity was typed in and its factor snapshot (`qty` and `rate` are per that unit;
   * the engine converts with `lineFactor`). Absent = the item's base unit.
   */
  unit?: string;
  unit_factor?: number;
}

/** Minimal, defensive view of a purchase bill (the purchases module owns the real type). */
export interface PurchaseLike {
  id?: string;
  status?: string;
  bill_number?: string;
  invoice_number?: string;
  vendor_name?: string;
  date?: string;
  bill_date?: string;
  issue_date?: string;
  invoice_date?: string;
  lines?: PurchaseLineLike[];
  items?: PurchaseLineLike[];
}
export interface PurchaseLineLike {
  name?: string;
  description?: string;
  hsn?: string;
  quantity?: number;
  qty?: number;
  rate?: number;
  unit_price?: number;
  amount?: number;
  discount_percent?: number;
}

export interface InventorySettings {
  method: CostingMethod;
  /** Delivery challans reduce stock when true (default false). */
  includeChallans: boolean;
  /** Batches expiring within this many days raise an alert (6.6; default 30). */
  expiryAlertDays?: number;
  /** Godown new purchase / sale lines default to (6.10; absent = Main). */
  defaultGodown?: string;
}

export const DEFAULT_EXPIRY_ALERT_DAYS = 30;
export const DEFAULT_SETTINGS: InventorySettings = { method: 'WEIGHTED_AVG', includeChallans: false };

export interface LedgerRow {
  key: string;
  date: string;
  kind: MoveKind;
  particulars: string;
  refType?: string;
  refId?: string;
  qtyIn: number;
  qtyOut: number;
  /** Unit rate of this movement (cost for in, unit COGS for out). */
  rate: number;
  /** Value of this movement (in: cost in, out: cost of goods issued). */
  amount: number;
  /** Running quantity after this row. */
  balance: number;
  /** Running stock value after this row. */
  value: number;
  /** Additive (Phase 7): party of the source document, and its number. */
  party?: string;
  refNumber?: string;
}

export interface StockPosition {
  item: StockItem;
  qty: number;
  value: number;
  /** Closing value / qty (0 when no stock). */
  avgCost: number;
  purchasedQty: number;
  purchasedValue: number;
  soldQty: number;
  /** Net sales value (qty x rate after line discount, ex-tax). */
  revenue: number;
  /** Cost of goods sold for the sales. */
  cogs: number;
  returnedQty: number;
  adjustedInQty: number;
  adjustedOutQty: number;
  /** Phase 7: units issued to / received from manufacturing and stock journals. */
  consumedQty: number;
  producedQty: number;
  status: StockStatus;
  isLow: boolean;
  isNegative: boolean;
  lastMovement: string;
  ledger: LedgerRow[];
}

/** The slice of an invoice the engine reads. */
export type InvoiceLike = Partial<
  Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'issue_date' | 'invoice_number' | 'items' | 'client' | 'goods_returned' | 'notes'>
>;

export interface StockInputs {
  items: StockItem[];
  moves: StockMove[];
  invoices: InvoiceLike[];
  purchases?: PurchaseLike[];
  method?: CostingMethod;
  includeChallans?: boolean;
  /** Ignore everything dated after this (YYYY-MM-DD). */
  asOf?: string;
  /** Skip this invoice (used to ask "what if I edit it"). */
  excludeInvoiceId?: string;
  /** Stock transfer vouchers (6.10). Read only when `includeTransfers` is set: they never change value. */
  transfers?: StockTransfer[];
  includeTransfers?: boolean;
  /**
   * `doc_links` rows. When challans move stock, an invoice converted FROM a challan does not move it
   * again (the goods left on the challan). Credit-note links also carry the note's reason: only a
   * credit note that returns goods moves stock (`creditNoteReturnsGoods`).
   */
  links?: { from_id: string; to_id: string; relation: string; reason?: string }[];
  /** WP-3 event source (events-returns.ts): receipt notes, rejections out, purchase returns. */
  returnDocs?: ReturnStockDocs;
  /** Manufacturing / stock journal / physical stock vouchers (Phase 7), see `stockVoucherInputs`. */
  vouchers?: StockVoucherInput[];
  /** 7M event source (events-job-work.ts): Material Out / In with job workers, Rejections In. */
  jobWorkDocs?: JobWorkStockDocs;
  /** 8.85: BOMs, read for kit items (`events-kits.ts`): a kit sale issues its components. */
  kitBoms?: Bom[];
}

/**
 * Engine view of a stock voucher. Consumption lines are issued at cost (FIFO / weighted average);
 * production lines are received at the pooled cost:
 *   pool = consumed cost + extraAmount + extraPct % of consumed cost − Σ fixed-rate lines (by-product, scrap)
 * Lines with `cost_pct` take that share of the pool; the remaining share goes to lines with neither a
 * rate nor a share, split by quantity. `adjust` lines (physical stock) are signed adjustments.
 */
export interface StockVoucherInput {
  id: string;
  number: string;
  date: string;
  type: 'manufacturing' | 'stock_journal' | 'physical';
  consume: VoucherStockLine[];
  produce: VoucherOutputLine[];
  adjust?: { item_id: string; qty: number; godown_id?: string; batch_no?: string; rate?: number }[];
  extraAmount?: number;
  extraPct?: number;
}

const EPS = 1e-9;
const OPENING_DATE = '0000-00-00';

/* ── Matching ────────────────────────────────────────────────── */

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export interface ItemIndex {
  find(name: string, hsn?: string): StockItem | undefined;
}

/** HSN / SAC digits only ("8517 13 00" → "85171300"); lower-cased text when it has no digits. */
export const hsnDigits = (s: unknown) => {
  const t = norm(s);
  const d = t.replace(/\D/g, '');
  return d || t;
};

/**
 * Two HSN codes name the same goods when one is the other with more digits (a 4-digit heading
 * and its 8-digit tariff line). So refining an item's HSN from 8517 to 85171300 keeps its history.
 */
export function hsnCompatible(a: unknown, b: unknown): boolean {
  const x = hsnDigits(a);
  const y = hsnDigits(b);
  if (!x || !y) return true;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Name (case-insensitive) is primary, then an item's earlier names (`aliases`); HSN breaks ties and
 * rejects conflicting codes (a code that only adds digits to the other is not a conflict).
 */
export function buildItemIndex(items: StockItem[]): ItemIndex {
  const byName = new Map<string, StockItem[]>();
  const byAlias = new Map<string, StockItem[]>();
  const add = (map: Map<string, StockItem[]>, k: string, it: StockItem) => {
    if (!k) return;
    const list = map.get(k);
    if (list) {
      if (!list.includes(it)) list.push(it);
    } else map.set(k, [it]);
  };
  for (const it of items) {
    add(byName, norm(it.name), it);
    for (const a of it.aliases ?? []) add(byAlias, norm(a), it);
  }
  const pick = (list: StockItem[] | undefined, hsn?: string) => {
    if (!list) return undefined;
    const h = hsnDigits(hsn);
    if (!h) return list[0];
    return list.find((i) => hsnDigits(i.hsn) === h)
      ?? list.find((i) => !!hsnDigits(i.hsn) && hsnCompatible(i.hsn, h))
      ?? list.find((i) => !hsnDigits(i.hsn));
  };
  return {
    find(name, hsn) {
      const k = norm(name);
      return pick(byName.get(k), hsn) ?? pick(byAlias.get(k), hsn);
    },
  };
}

/** `aliases` after renaming `prev` to `next.name`: the old name is kept, the current one never listed. */
export function aliasesAfterRename(prev: Pick<StockItem, 'name' | 'aliases'> | undefined, next: Pick<StockItem, 'name' | 'aliases'>): string[] | undefined {
  const list = [...(next.aliases ?? prev?.aliases ?? [])];
  if (prev && norm(prev.name) && norm(prev.name) !== norm(next.name)) list.push(prev.name.trim());
  const seen = new Set<string>([norm(next.name)]);
  const out = list.filter((a) => {
    const k = norm(a);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out.length ? out : undefined;
}

/* ── Events ──────────────────────────────────────────────────── */

export interface StockEvent {
  date: string;
  /** Same-day ordering: opening, stock-in, stock-out, then sales returns. */
  rank: number;
  seq: number;
  kind: MoveKind;
  qty: number;
  /** Cost rate for ins (undefined = derive), ignored for outs. */
  rate?: number;
  saleRate?: number;
  particulars: string;
  refType?: string;
  refId?: string;
  /* Tracking dimensions (6.6 / 6.10 / 6.11). Costing ignores them. */
  /** Godown id (always set; Main when the source names none). */
  godown: string;
  batch?: string;
  mfg?: string;
  expiry?: string;
  mrp?: number;
  serials?: string[];
  /** Document number and party, for serial lookup. */
  refNumber?: string;
  party?: string;
  /** Warranty months given on a sale line. */
  warrantyMonths?: number;
  /* Stock vouchers (Phase 7). */
  /** Voucher id for consumption / production events. */
  voucher?: string;
  /** Production: share of the voucher's pooled cost (undefined = fixed `rate`). */
  share?: number;
  /** Production: the voucher's extra cost and fixed-value deductions. */
  pool?: { amount: number; pct: number; fixed: number };
}

function dayOf(d: unknown): string {
  return String(d ?? '').slice(0, 10);
}

function rankFor(kind: MoveKind, qty: number): number {
  if (kind === 'opening') return 0;
  // Vouchers run after the day's receipts and before its issues; their own order comes from `seq`.
  if (kind === 'consumption' || kind === 'production') return 1.5;
  // A sales return follows the sale it reverses, even on the same day (serials come back in stock).
  if (kind === 'return') return 3;
  return qty >= 0 ? 1 : 2;
}

function netRate(line: Pick<InvoiceItem, 'rate' | 'discount_percent'>): number {
  return num(line.rate) * (1 - Math.min(Math.max(num(line.discount_percent), 0), 100) / 100);
}

export function invoiceEffect(
  doc: string | undefined,
  status: string | undefined,
  includeChallans: boolean,
): 'out' | 'in' | null {
  if (status === 'Draft' || status === 'Cancelled') return null;
  if (doc === 'INVOICE' || doc === 'TAX_INVOICE' || doc === 'BILL_OF_SUPPLY' || doc === undefined) return 'out';
  if (doc === 'CREDIT_NOTE') return 'in';
  if (doc === 'DELIVERY_CHALLAN') return includeChallans ? 'out' : null;
  return null; // QUOTATION / PROFORMA / SALES_ORDER never touch stock
}

/** Collect every stock event for every tracked item. Pure; inputs untouched. */
export function collectEvents(input: StockInputs): Map<string, StockEvent[]> {
  const { items, moves, invoices, purchases = [], includeChallans = false, asOf, excludeInvoiceId } = input;
  // When challans move stock, goods leave once per sale: an invoice made from a live challan, or a
  // challan made from a live invoice, does not move them a second time.
  const fromChallan = new Set<string>();
  if (includeChallans && input.links?.length) {
    const live = new Map(
      invoices.filter((d) => d?.id && invoiceEffect(d.doc_type, d.status, true) === 'out').map((d) => [d.id as string, d.doc_type]),
    );
    for (const l of input.links) {
      if (l.relation !== 'converted' || !live.has(l.from_id) || !live.has(l.to_id)) continue;
      const fromIsChallan = live.get(l.from_id) === 'DELIVERY_CHALLAN';
      if (fromIsChallan !== (live.get(l.to_id) === 'DELIVERY_CHALLAN')) fromChallan.add(l.to_id);
    }
  }
  const out = new Map<string, StockEvent[]>();
  const index = buildItemIndex(items.filter((i) => i.track_stock));
  let seq = 0;
  const push = (itemId: string, ev: Omit<StockEvent, 'seq' | 'rank' | 'godown'> & { godown?: string; rank?: number }) => {
    if (asOf && ev.date > asOf) return;
    const list = out.get(itemId) ?? [];
    list.push({ ...ev, godown: ev.godown || MAIN_GODOWN_ID, rank: ev.rank ?? rankFor(ev.kind, ev.qty), seq: seq++ });
    out.set(itemId, list);
  };

  for (const it of items) {
    if (!it.track_stock) continue;
    out.set(it.id, []);
    if (num(it.opening_qty) !== 0) {
      push(it.id, {
        date: OPENING_DATE,
        kind: 'opening',
        qty: num(it.opening_qty),
        rate: num(it.opening_rate),
        particulars: 'Opening balance',
        serials: cleanSerials(it.opening_serials),
      });
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  for (const m of moves) {
    const it = byId.get(m.item_id);
    if (!it || !it.track_stock || !num(m.qty)) continue;
    const mf = lineFactor(m); // 7M: an adjustment typed in an alternate unit
    const q = num(m.qty) * mf;
    const note = m.note ? ` — ${m.note}` : '';
    const label =
      m.kind === 'opening' ? 'Opening balance'
      : m.kind === 'adjustment' ? `Adjustment${note}`
      : m.kind === 'purchase' ? `Purchase${note}`
      : m.kind === 'return' ? `Return${note}`
      : `Sale${note}`;
    push(it.id, {
      date: m.kind === 'opening' ? dayOf(m.date) || OPENING_DATE : dayOf(m.date),
      kind: m.kind,
      qty: q,
      rate: num(m.rate) > 0 ? num(m.rate) / mf : undefined,
      saleRate: q < 0 ? num(m.rate) / mf : undefined,
      particulars: label,
      refType: m.ref_type ?? 'move',
      refId: m.ref_id ?? m.id,
      godown: m.godown_id,
      batch: m.batch_no || undefined,
      mfg: m.mfg_date || undefined,
      expiry: m.expiry_date || undefined,
      serials: cleanSerials(m.serials),
    });
  }

  for (const inv of invoices) {
    if (!inv || (excludeInvoiceId && inv.id === excludeInvoiceId)) continue;
    if (inv.id && fromChallan.has(inv.id)) continue;
    const effect = invoiceEffect(inv.doc_type, inv.status, includeChallans);
    if (!effect) continue;
    // A discount / rate-difference / GST-correction credit note brings no goods back.
    if (effect === 'in' && !creditNoteReturnsGoods(inv, input.links)) continue;
    const date = dayOf(inv.issue_date);
    const clientName = inv.client?.name ? ` · ${inv.client.name}` : '';
    for (const line of inv.items ?? []) {
      const it = index.find(line.name, line.hsn);
      const factor = lineFactor(line); // WP-8: a line typed in an alternate unit (2 BOX = 24 NOS)
      const q = num(line.quantity) * factor;
      if (!it || q <= 0) continue;
      const dims = {
        godown: line.godown_id,
        batch: line.batch_no || undefined,
        expiry: line.batch_expiry || undefined,
        mfg: line.batch_mfg || undefined,
        serials: cleanSerials(line.serials),
        refNumber: inv.invoice_number ?? '',
        party: inv.client?.name ?? '',
        warrantyMonths: num(line.warranty_months) || undefined,
      };
      if (effect === 'out') {
        push(it.id, {
          date,
          kind: 'sale',
          qty: -q,
          saleRate: netRate(line) / factor,
          particulars: `${inv.doc_type === 'DELIVERY_CHALLAN' ? 'Challan' : 'Sale'} — ${inv.invoice_number ?? ''}${clientName}`,
          refType: 'invoice',
          refId: inv.id,
          ...dims,
        });
      } else {
        push(it.id, {
          date,
          kind: 'return',
          qty: q,
          saleRate: netRate(line) / factor,
          particulars: `Sales return — ${inv.invoice_number ?? ''}${clientName}`,
          refType: 'invoice',
          refId: inv.id,
          ...dims,
        });
      }
    }
  }

  const grnCovered = grnCoverage(input.returnDocs); // WP-3: goods a receipt note already brought in
  for (const p of purchases) {
    // Same reader as Books / GST / exports: drafts, cancelled bills and direct
    // expenses (rent, fees ...) never move stock.
    const bill = readPurchase(p);
    if (!bill || isVoidStatus(bill.status) || bill.isExpense) continue;
    for (const line of readPurchaseLines(p)) {
      // WP-8: the picked stock item (`item_id`) first, name + HSN for older lines; quantity in base units.
      const byItemId = line.itemId ? byId.get(line.itemId) : undefined;
      const it = byItemId?.track_stock ? byItemId : index.find(line.name, line.hsn);
      const lineBase = line.quantity * line.unitFactor;
      const q = lineBase - grnCovered.take(line.grnLineId, lineBase);
      if (!it || q <= 0) continue;
      push(it.id, {
        date: bill.date,
        kind: 'purchase',
        qty: q,
        rate: (line.unitCost + line.landedUnit) / line.unitFactor, // WP-8: landed cost loads the stock cost
        particulars: `Purchase — ${bill.number}${bill.partyName ? ` · ${bill.partyName}` : ''}`,
        refType: 'purchase',
        refId: bill.id || undefined,
        godown: line.godownId,
        batch: line.batchNo || undefined,
        mfg: line.mfgDate || undefined,
        expiry: line.expiryDate || undefined,
        mrp: line.mrp || undefined,
        serials: line.serials.length ? line.serials : undefined,
        refNumber: bill.number,
        party: bill.partyName,
      });
    }
  }

  returnStockEvents(input.returnDocs, purchases, index, push, (id) => { // WP-3 event source (+ WP-8 item_id)
    const it = byId.get(id);
    return it?.track_stock ? it : undefined;
  });
  pushVoucherEvents(input.vouchers ?? [], byId, push);
  kitStockEvents(invoices, items, input.kitBoms, (d) => ((excludeInvoiceId && d.id === excludeInvoiceId) || (d.id && fromChallan.has(d.id)) ? null : ((e) => (e === 'in' && !creditNoteReturnsGoods(d, input.links) ? null : e))(invoiceEffect(d.doc_type, d.status, includeChallans))), push); // 8.85 kits
  jobWorkStockEvents(input.jobWorkDocs, { byId: (id) => (byId.get(id)?.track_stock ? byId.get(id) : undefined), index, invoices, links: input.links, includeChallans, includeTransfers: !!input.includeTransfers }, push); // 7M event source

  if (input.includeTransfers) {
    for (const t of input.transfers ?? []) {
      const date = dayOf(t.date);
      for (const l of t.lines ?? []) {
        const it = byId.get(l.item_id);
        const q = num(l.qty) * lineFactor(l); // 7M: a transfer line typed in an alternate unit
        if (!it || !it.track_stock || q <= 0 || !t.from_godown || !t.to_godown || t.from_godown === t.to_godown) continue;
        const base = {
          date, kind: 'transfer' as const, refType: 'transfer', refId: t.id, refNumber: t.transfer_number,
          batch: l.batch_no || undefined, serials: cleanSerials(l.serials),
        };
        push(it.id, { ...base, qty: -q, godown: t.from_godown, particulars: `Transfer out — ${t.transfer_number}` });
        push(it.id, { ...base, qty: q, godown: t.to_godown, particulars: `Transfer in — ${t.transfer_number}` });
      }
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank || a.seq - b.seq));
  }
  return out;
}

const VOUCHER_LABEL: Record<StockVoucherInput['type'], string> = {
  manufacturing: 'Manufacturing', stock_journal: 'Stock journal', physical: 'Physical stock',
};

/** Shares of the pooled cost per production line (index-aligned; undefined = fixed rate). */
export function productionShares(lines: readonly Pick<VoucherOutputLine, 'qty' | 'rate' | 'cost_pct'>[]): (number | undefined)[] {
  const isFixed = (l: Pick<VoucherOutputLine, 'rate' | 'cost_pct'>) => num(l.rate) > 0 && !(num(l.cost_pct) > 0);
  const pctTotal = lines.reduce((s, l) => s + (isFixed(l) ? 0 : Math.max(num(l.cost_pct), 0)), 0);
  const rest = Math.max(0, 1 - pctTotal / 100);
  const restQty = lines.reduce((s, l) => s + (!isFixed(l) && !(num(l.cost_pct) > 0) ? Math.max(num(l.qty), 0) : 0), 0);
  return lines.map((l) => {
    if (isFixed(l)) return undefined;
    if (num(l.cost_pct) > 0) return Math.max(num(l.cost_pct), 0) / 100;
    return restQty > EPS ? (rest * Math.max(num(l.qty), 0)) / restQty : 0;
  });
}

type PushFn = (itemId: string, ev: Omit<StockEvent, 'seq' | 'rank' | 'godown'> & { godown?: string; rank?: number }) => void;

function pushVoucherEvents(vouchers: readonly StockVoucherInput[], byId: Map<string, StockItem>, push: PushFn): void {
  const sorted = [...vouchers].sort((a, b) => dayOf(a.date).localeCompare(dayOf(b.date)) || a.number.localeCompare(b.number, undefined, { numeric: true }));
  for (const v of sorted) {
    const date = dayOf(v.date);
    if (!date) continue;
    const label = `${VOUCHER_LABEL[v.type]} — ${v.number}`;
    const refType = v.type === 'manufacturing' ? 'manufacturing' : v.type === 'stock_journal' ? 'stock_journal' : 'physical_stock';
    const base = { date, refType, refId: v.id, refNumber: v.number, party: VOUCHER_LABEL[v.type] };
    const tracked = (id: string) => {
      const it = byId.get(id);
      return it && it.track_stock ? it : undefined;
    };
    for (const l of v.consume) {
      const q = num(l.qty);
      if (!tracked(l.item_id) || q <= 0) continue;
      push(l.item_id, {
        ...base, kind: 'consumption', qty: -q, particulars: `${label} (consumed)`, voucher: v.id,
        godown: l.godown_id, batch: l.batch_no || undefined, serials: cleanSerials(l.serials), // 7S: serial items
      });
    }
    const produce = v.produce.filter((l) => tracked(l.item_id) && num(l.qty) > 0);
    const shares = productionShares(produce);
    const fixed = produce.reduce((s, l, i) => s + (shares[i] === undefined ? num(l.qty) * num(l.rate) : 0), 0);
    const pool = { amount: Math.max(num(v.extraAmount), 0), pct: Math.max(num(v.extraPct), 0), fixed };
    produce.forEach((l, i) => {
      push(l.item_id, {
        ...base, kind: 'production', qty: num(l.qty), particulars: `${label} (produced)`, voucher: v.id,
        rate: shares[i] === undefined ? num(l.rate) : undefined, share: shares[i], pool,
        godown: l.godown_id, batch: l.batch_no || undefined, mfg: l.mfg_date || undefined, expiry: l.expiry_date || undefined,
        serials: cleanSerials(l.serials), // 7S
      });
    });
    for (const a of v.adjust ?? []) {
      const q = num(a.qty);
      if (!tracked(a.item_id) || Math.abs(q) < EPS) continue;
      // Physical stock is the closing count of its day: after every other movement that day.
      push(a.item_id, {
        ...base, kind: 'adjustment', qty: q, rank: 4, particulars: `${label} (${q > 0 ? 'excess' : 'shortage'})`,
        rate: q > 0 && num(a.rate) > 0 ? num(a.rate) : undefined, godown: a.godown_id, batch: a.batch_no || undefined,
      });
    }
  }
}

/** Trimmed, non-empty serials, or undefined when there are none. */
export function cleanSerials(list: unknown): string[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const out = list.map((x) => String(x ?? '').trim()).filter(Boolean);
  return out.length ? out : undefined;
}

/* ── Costing engines ─────────────────────────────────────────── */

interface Costing {
  receive(qty: number, rate: number): void;
  /** Returns the total cost of goods issued. */
  issue(qty: number): number;
  qty(): number;
  value(): number;
  unit(): number;
}

function weightedAverage(): Costing {
  let qty = 0;
  let value = 0;
  let last = 0;
  const unitNow = () => (qty > EPS ? value / qty : last);
  return {
    receive(q, rate) {
      value += q * rate;
      qty += q;
      if (qty > EPS) last = value / qty;
      else {
        last = rate;
        value = Math.abs(qty) < EPS ? 0 : qty * rate;
      }
    },
    issue(q) {
      const u = unitNow();
      const cost = q * u;
      qty -= q;
      value -= cost;
      last = u;
      if (qty <= EPS) value = Math.abs(qty) < EPS ? 0 : qty * u;
      return cost;
    },
    qty: () => qty,
    value: () => value,
    unit: unitNow,
  };
}

function fifo(): Costing {
  const layers: { qty: number; rate: number }[] = [];
  let deficit = 0;
  let last = 0;
  const layerQty = () => layers.reduce((s, l) => s + l.qty, 0);
  const layerValue = () => layers.reduce((s, l) => s + l.qty * l.rate, 0);
  return {
    receive(q, rate) {
      let rest = q;
      if (deficit > EPS) {
        const cover = Math.min(rest, deficit);
        deficit -= cover;
        rest -= cover;
      }
      last = rate;
      if (rest > EPS) layers.push({ qty: rest, rate });
    },
    issue(q) {
      let rest = q;
      let cost = 0;
      while (rest > EPS && layers.length) {
        const l = layers[0];
        const take = Math.min(rest, l.qty);
        cost += take * l.rate;
        l.qty -= take;
        rest -= take;
        last = l.rate;
        if (l.qty <= EPS) layers.shift();
      }
      if (rest > EPS) {
        cost += rest * last;
        deficit += rest;
      }
      return cost;
    },
    qty: () => layerQty() - deficit,
    value: () => layerValue() - deficit * last,
    unit: () => (layers.length ? layers[0].rate : last),
  };
}

/* ── Position per item ───────────────────────────────────────── */

export function statusOf(item: StockItem, qty: number): StockStatus {
  if (!item.track_stock) return 'untracked';
  if (qty < -EPS) return 'negative';
  if (Math.abs(qty) < EPS) return 'out';
  if (num(item.reorder_level) > 0 && qty <= num(item.reorder_level) + EPS) return 'low';
  return 'ok';
}

function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
}

function emptyPosition(item: StockItem): StockPosition {
  return {
    item, qty: 0, value: 0, avgCost: 0, purchasedQty: 0, purchasedValue: 0, soldQty: 0, revenue: 0,
    cogs: 0, returnedQty: 0, adjustedInQty: 0, adjustedOutQty: 0, consumedQty: 0, producedQty: 0,
    status: item.track_stock ? 'out' : 'untracked', isLow: false, isNegative: false,
    lastMovement: '', ledger: [],
  };
}

interface ItemRunner {
  /** Process one event; returns the cost of goods issued (0 for receipts). */
  step(ev: StockEvent): number;
  finish(): StockPosition;
}

function itemRunner(item: StockItem, method: CostingMethod): ItemRunner {
  const c = method === 'FIFO' ? fifo() : weightedAverage();
  const pos = emptyPosition(item);
  let lastIssueUnit: number | undefined;
  let i = 0;

  return {
    step(ev) {
      const n = i++;
      // Transfers move stock between godowns: company-wide quantity and value are unchanged.
      if (ev.kind === 'transfer') return 0;
      const q = Math.abs(ev.qty);
      let rate: number;
      let amount: number;
      let issued = 0;
      if (ev.qty > 0) {
        if (ev.kind === 'return') rate = ev.rate ?? lastIssueUnit ?? c.unit();
        else if (ev.kind === 'opening') rate = ev.rate ?? 0;
        else rate = ev.rate ?? c.unit();
        c.receive(q, rate);
        amount = q * rate;
        if (ev.kind === 'purchase') {
          pos.purchasedQty += q;
          pos.purchasedValue += amount;
        } else if (ev.kind === 'return') {
          pos.returnedQty += q;
          // A return reverses the sale: net units, revenue and COGS shrink.
          pos.soldQty -= q;
          pos.revenue -= q * (ev.saleRate ?? 0);
          pos.cogs -= amount;
        } else if (ev.kind === 'adjustment') pos.adjustedInQty += q;
        else if (ev.kind === 'production') pos.producedQty += q;
      } else {
        const cost = c.issue(q);
        issued = cost;
        amount = cost;
        rate = q > 0 ? cost / q : 0;
        lastIssueUnit = rate;
        if (ev.kind === 'adjustment') pos.adjustedOutQty += q;
        // Components consumed by a voucher are not sales: their cost moves into the produced goods.
        else if (ev.kind === 'consumption') pos.consumedQty += q;
        else {
          pos.soldQty += q;
          pos.revenue += q * (ev.saleRate ?? 0);
          pos.cogs += cost;
        }
      }
      if (ev.kind !== 'opening' && ev.date > pos.lastMovement) pos.lastMovement = ev.date;
      pos.ledger.push({
        key: `${n}-${ev.refId ?? ev.kind}`,
        date: ev.date === OPENING_DATE ? '' : ev.date,
        kind: ev.kind,
        particulars: ev.particulars,
        refType: ev.refType,
        refId: ev.refId,
        qtyIn: ev.qty > 0 ? q : 0,
        qtyOut: ev.qty < 0 ? q : 0,
        rate: round2(rate),
        amount: round2(amount),
        balance: roundQty(c.qty()),
        value: round2(c.value()),
        ...(ev.party ? { party: ev.party } : {}),
        ...(ev.refNumber ? { refNumber: ev.refNumber } : {}),
      });
      return issued;
    },
    finish() {
      pos.qty = roundQty(c.qty());
      pos.value = round2(c.value());
      pos.avgCost = pos.qty > 0 ? round2(pos.value / pos.qty) : round2(c.unit());
      pos.purchasedValue = round2(pos.purchasedValue);
      pos.revenue = round2(pos.revenue);
      pos.cogs = round2(pos.cogs);
      pos.consumedQty = roundQty(pos.consumedQty);
      pos.producedQty = roundQty(pos.producedQty);
      pos.status = statusOf(item, pos.qty);
      pos.isNegative = pos.status === 'negative';
      pos.isLow = item.track_stock && num(item.reorder_level) > 0 && pos.qty <= num(item.reorder_level) + EPS;
      return pos;
    },
  };
}

function runItem(item: StockItem, events: StockEvent[], method: CostingMethod): StockPosition {
  const r = itemRunner(item, method);
  for (const ev of events) r.step(ev);
  return r.finish();
}

/** Cost roll-up of one voucher as the engine computed it. */
export interface VoucherCosting {
  /** Cost of the components issued. */
  consumed: number;
  /** Extra cost added (₹ amounts + % of consumed). */
  extra: number;
  /** Fixed-value production (by-products, scrap) deducted. */
  fixed: number;
  /** consumed + extra − fixed (never below 0): what the shared production lines carry. */
  pool: number;
  /** Value received per item id. */
  produced: Record<string, number>;
}

export interface StockComputation {
  positions: StockPosition[];
  vouchers: Map<string, VoucherCosting>;
}

const byOrder = (a: StockEvent, b: StockEvent) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.rank - b.rank || a.seq - b.seq);

/**
 * Positions plus the cost roll-up of every stock voucher. Without vouchers each item is costed on its
 * own; with them every event runs in one global order so components are issued (FIFO / weighted
 * average) before the goods they become are received at that cost — multi-level BOMs included.
 */
export function computeStockDetailed(input: StockInputs): StockComputation {
  const method = input.method ?? 'WEIGHTED_AVG';
  const events = collectEvents(input);
  const vouchers = new Map<string, VoucherCosting>();
  // Vouchers (manufacturing, stock journal, job work Material In) need one global order for their pooled cost.
  if (!input.vouchers?.length && ![...events.values()].some((list) => list.some((e) => e.voucher))) {
    const positions = input.items.map((item) =>
      item.track_stock ? runItem(item, events.get(item.id) ?? [], method) : emptyPosition(item),
    );
    return { positions, vouchers };
  }
  const runners = new Map<string, ItemRunner>();
  const all: { itemId: string; ev: StockEvent }[] = [];
  for (const item of input.items) {
    if (!item.track_stock) continue;
    runners.set(item.id, itemRunner(item, method));
    for (const ev of events.get(item.id) ?? []) all.push({ itemId: item.id, ev });
  }
  all.sort((a, b) => byOrder(a.ev, b.ev));
  const costing = (id: string) => {
    let v = vouchers.get(id);
    if (!v) vouchers.set(id, (v = { consumed: 0, extra: 0, fixed: 0, pool: 0, produced: {} }));
    return v;
  };
  for (const { itemId, ev } of all) {
    const r = runners.get(itemId) as ItemRunner;
    if (ev.voucher && ev.kind === 'consumption') {
      costing(ev.voucher).consumed += r.step(ev);
      continue;
    }
    if (ev.voucher && ev.kind === 'production') {
      const v = costing(ev.voucher);
      const p = ev.pool ?? { amount: 0, pct: 0, fixed: 0 };
      v.extra = p.amount + (v.consumed * p.pct) / 100;
      v.fixed = p.fixed;
      v.pool = Math.max(0, v.consumed + v.extra - v.fixed);
      const q = Math.abs(ev.qty);
      const rate = ev.share === undefined ? num(ev.rate) : q > EPS ? (v.pool * ev.share) / q : 0;
      v.produced[itemId] = (v.produced[itemId] ?? 0) + q * rate;
      r.step({ ...ev, rate });
      continue;
    }
    r.step(ev);
  }
  for (const v of vouchers.values()) {
    v.consumed = round2(v.consumed);
    v.extra = round2(v.extra);
    v.fixed = round2(v.fixed);
    v.pool = round2(v.pool);
    for (const k of Object.keys(v.produced)) v.produced[k] = round2(v.produced[k]);
  }
  const positions = input.items.map((item) => runners.get(item.id)?.finish() ?? emptyPosition(item));
  return { positions, vouchers };
}

/** Full stock position for every item (tracked and untracked). */
export function computeStock(input: StockInputs): StockPosition[] {
  return computeStockDetailed(input).positions;
}

/* ── Reports ─────────────────────────────────────────────────── */

export interface StockTotals {
  stockValue: number;
  skus: number;
  tracked: number;
  lowCount: number;
  negativeCount: number;
  outCount: number;
}

export function summarize(positions: StockPosition[]): StockTotals {
  const tracked = positions.filter((p) => p.item.track_stock);
  return {
    stockValue: round2(tracked.reduce((s, p) => s + Math.max(p.value, 0), 0)),
    skus: positions.length,
    tracked: tracked.length,
    lowCount: tracked.filter((p) => p.isLow && !p.isNegative).length,
    negativeCount: tracked.filter((p) => p.isNegative).length,
    outCount: tracked.filter((p) => p.status === 'out').length,
  };
}

export interface MovementRow {
  item: StockItem;
  openingQty: number;
  openingValue: number;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
}

/** Opening / in / out / closing per item for [from, to] (inclusive, YYYY-MM-DD). */
export function movementSummary(positions: StockPosition[], from: string, to: string): MovementRow[] {
  return positions
    .filter((p) => p.item.track_stock)
    .map((p) => {
      let openingQty = 0, openingValue = 0, inQty = 0, inValue = 0, outQty = 0, outValue = 0;
      let closingQty = 0, closingValue = 0;
      for (const r of p.ledger) {
        const d = r.date || OPENING_DATE;
        if (d < from) {
          openingQty = r.balance;
          openingValue = r.value;
        }
        if (d <= to) {
          closingQty = r.balance;
          closingValue = r.value;
        }
        if (d >= from && d <= to && r.kind !== 'opening') {
          inQty += r.qtyIn;
          inValue += r.qtyIn ? r.amount : 0;
          outQty += r.qtyOut;
          outValue += r.qtyOut ? r.amount : 0;
        }
      }
      return {
        item: p.item, openingQty: roundQty(openingQty), openingValue: round2(openingValue),
        inQty: roundQty(inQty), inValue: round2(inValue), outQty: roundQty(outQty),
        outValue: round2(outValue), closingQty: roundQty(closingQty), closingValue: round2(closingValue),
      };
    });
}

export interface DeadStockRow {
  position: StockPosition;
  lastMovement: string;
  daysIdle: number;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.floor(ms / 86400000);
}

/** In-stock items with no movement for at least `days` days (opening excluded). */
export function deadStock(positions: StockPosition[], days: number, today: string): DeadStockRow[] {
  const rows: DeadStockRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock || p.qty <= 0) continue;
    const last = p.lastMovement || dayOf(p.item.created_at);
    const idle = last ? daysBetween(last, today) : days;
    if (idle >= days) rows.push({ position: p, lastMovement: p.lastMovement, daysIdle: idle });
  }
  return rows.sort((a, b) => b.daysIdle - a.daysIdle);
}

export interface MarginRow {
  item: StockItem;
  soldQty: number;
  avgSaleRate: number;
  avgCostRate: number;
  marginPerUnit: number;
  marginPct: number;
  totalMargin: number;
}

/** Realised margin from sales so far; falls back to sale_rate vs current cost when nothing sold. */
export function marginReport(positions: StockPosition[]): MarginRow[] {
  return positions
    .filter((p) => p.item.track_stock)
    .map((p) => {
      let avgSale: number;
      let avgCost: number;
      if (p.soldQty > EPS) {
        avgSale = p.revenue / p.soldQty;
        avgCost = p.cogs / p.soldQty;
      } else {
        avgSale = num(p.item.sale_rate);
        avgCost = p.avgCost;
      }
      const perUnit = avgSale - avgCost;
      return {
        item: p.item,
        soldQty: roundQty(p.soldQty),
        avgSaleRate: round2(avgSale),
        avgCostRate: round2(avgCost),
        marginPerUnit: round2(perUnit),
        marginPct: avgSale > 0 ? round2((perUnit / avgSale) * 100) : 0,
        totalMargin: round2(p.revenue - p.cogs),
      };
    });
}

/* ── Manual moves ────────────────────────────────────────────── */

export function makeAdjustment(opts: {
  item_id: string;
  date: string;
  direction: 'add' | 'remove';
  qty: number;
  /** Unit cost for additions (0 = use current average). */
  rate?: number;
  reason: string;
  id?: string;
  /** 7M: the unit `qty` / `rate` were typed in and its factor (absent or 1 = the item's base unit). */
  unit?: string;
  unit_factor?: number;
}): StockMove {
  const q = Math.abs(num(opts.qty));
  const f = num(opts.unit_factor);
  return {
    ...(opts.unit && f > 0 && f !== 1 ? { unit: opts.unit, unit_factor: f } : {}),
    id: opts.id ?? generateId(),
    item_id: opts.item_id,
    date: opts.date,
    qty: opts.direction === 'add' ? q : -q,
    rate: Math.max(num(opts.rate), 0),
    kind: 'adjustment',
    note: opts.reason.trim(),
  };
}

/* ── Warnings for the invoice creator ────────────────────────── */

export interface StockShortfall {
  itemId: string;
  name: string;
  unit: string;
  requested: number;
  available: number;
  shortBy: number;
}

/**
 * Lines on a document that would take stock below zero. Only INVOICE /
 * TAX_INVOICE (and DELIVERY_CHALLAN when enabled) can short-ship. If the
 * document is already saved (`id`), its own recorded effect is excluded first.
 */
export function shortfallsFor(
  doc: Pick<InvoiceRecord, 'doc_type' | 'items'> & Partial<Pick<InvoiceRecord, 'id'>>,
  inputs: Omit<StockInputs, 'excludeInvoiceId'>,
): StockShortfall[] {
  if (invoiceEffect(doc.doc_type, 'Sent', !!inputs.includeChallans) !== 'out') return [];
  return shortfallsFromPositions(doc, computeStock({ ...inputs, excludeInvoiceId: doc.id }));
}

/** `shortfallsFor` over positions already computed without the document. */
export function shortfallsFromPositions(doc: Pick<InvoiceRecord, 'items'>, positions: StockPosition[]): StockShortfall[] {
  const index = buildItemIndex(positions.map((p) => p.item).filter((i) => i.track_stock));
  const byId = new Map(positions.map((p) => [p.item.id, p]));
  const wanted = new Map<string, number>();
  for (const line of doc.items ?? []) {
    const it = index.find(line.name, line.hsn);
    const q = num(line.quantity) * lineFactor(line);
    if (it && q > 0) wanted.set(it.id, (wanted.get(it.id) ?? 0) + q);
  }
  const out: StockShortfall[] = [];
  for (const [id, requested] of wanted) {
    const p = byId.get(id);
    if (!p) continue;
    const available = Math.max(p.qty, 0);
    if (requested > available + EPS) {
      out.push({
        itemId: id, name: p.item.name, unit: p.item.unit, requested: roundQty(requested),
        available: roundQty(available), shortBy: roundQty(requested - available),
      });
    }
  }
  return out;
}

export function describeShortfall(s: StockShortfall): string {
  return s.available <= 0
    ? `${s.name}: out of stock (need ${s.requested} ${s.unit})`
    : `${s.name}: only ${s.available} ${s.unit} in stock (need ${s.requested})`;
}

/* ── CSV ─────────────────────────────────────────────────────── */

export function stockSummaryCsv(positions: StockPosition[]): string {
  const head = ['Item', 'SKU', 'HSN', 'Unit', 'Location', 'Tracked', 'Quantity', 'Avg cost', 'Stock value', 'Reorder level', 'Sale rate', 'GST %', 'Status'];
  const rows = positions.map((p) => [
    p.item.name, p.item.sku ?? '', p.item.hsn ?? '', p.item.unit, p.item.location ?? '',
    p.item.track_stock ? 'Yes' : 'No', p.qty, p.avgCost, p.value, num(p.item.reorder_level),
    num(p.item.sale_rate), num(p.item.tax_rate), p.status,
  ]);
  return toCsv([head, ...rows]);
}

export function ledgerCsv(p: StockPosition): string {
  const head = ['Date', 'Particulars', 'In', 'Out', 'Rate', 'Balance', 'Value'];
  const rows = p.ledger.map((r) => [r.date, r.particulars, r.qtyIn || '', r.qtyOut || '', r.rate, r.balance, r.value]);
  return toCsv([head, ...rows]);
}

/* ================================================================
   Persistence + convenience helpers (browser; fail-soft)
   ================================================================ */

export const TABLES = { items: 'stock_items', moves: 'stock_moves' } as const;
/** Phase 7 voucher tables (owned by src/lib/manufacturing.ts; read here so every stock reader sees them). */
export const VOUCHER_TABLES = {
  boms: 'boms', manufacturing: 'manufacturing_vouchers', stockJournals: 'stock_journals', physical: 'physical_stock',
} as const;

const extraOf = (costs: readonly { mode: string; value: number }[] | undefined) => ({
  extraAmount: (costs ?? []).reduce((s, c) => s + (c.mode === 'amount' ? Math.max(num(c.value), 0) : 0), 0),
  extraPct: (costs ?? []).reduce((s, c) => s + (c.mode === 'pct' ? Math.max(num(c.value), 0) : 0), 0),
});

/** A voucher line in base units: `qty` × `unit_factor`, a fixed `rate` per base unit (7M alternate units). */
function baseLine<T extends { qty: number; rate?: number; unit_factor?: number }>(l: T): T {
  const f = lineFactor(l);
  if (f === 1) return l;
  return { ...l, qty: num(l.qty) * f, ...(l.rate !== undefined ? { rate: num(l.rate) / f } : {}) };
}

/** Engine inputs for the stored vouchers (pure). The main finished line of a Manufacturing Journal comes first. */
export function stockVoucherInputs(
  mfg: readonly ManufacturingVoucher[], journals: readonly StockJournal[] = [], physical: readonly PhysicalStockVoucher[] = [],
): StockVoucherInput[] {
  const out: StockVoucherInput[] = [];
  for (const m of mfg) {
    if (!m?.id || !m.item_id) continue;
    out.push({
      id: m.id, number: m.number ?? '', date: m.date, type: 'manufacturing',
      consume: (m.components ?? []).map(baseLine),
      produce: [
        { id: `${m.id}:main`, item_id: m.item_id, qty: num(m.qty), godown_id: m.godown_id, batch_no: m.batch_no, mfg_date: m.mfg_date, expiry_date: m.expiry_date, serials: m.serials },
        ...(m.outputs ?? []).map(baseLine),
      ],
      ...extraOf(m.costs),
    });
  }
  for (const j of journals) {
    if (!j?.id) continue;
    out.push({ id: j.id, number: j.number ?? '', date: j.date, type: 'stock_journal', consume: (j.consume ?? []).map(baseLine), produce: (j.produce ?? []).map(baseLine), ...extraOf(j.costs) });
  }
  for (const p of physical) {
    if (!p?.id) continue;
    out.push({
      id: p.id, number: p.number ?? '', date: p.date, type: 'physical', consume: [], produce: [],
      adjust: (p.lines ?? []).map((l) => ({ item_id: l.item_id, qty: num(l.diff), godown_id: l.godown_id, batch_no: l.batch_no, rate: l.rate })),
    });
  }
  return out;
}
const SETTINGS_KEY = `${DB_PREFIX}inventory_settings`;

export function loadSettings(): InventorySettings {
  const s = getJson<Partial<InventorySettings>>(SETTINGS_KEY, {});
  const days = num(s.expiryAlertDays);
  return {
    method: s.method === 'FIFO' ? 'FIFO' : 'WEIGHTED_AVG',
    includeChallans: !!s.includeChallans,
    ...(days > 0 ? { expiryAlertDays: Math.min(Math.round(days), 3650) } : {}),
    ...(s.defaultGodown ? { defaultGodown: String(s.defaultGodown) } : {}),
  };
}

/**
 * Costing method, challan stock, expiry window and default godown change how stock is valued and
 * moved, so they are a settings change (owner only, 6.21) and audited. `setJson` skips the table guard.
 */
export function saveSettings(s: InventorySettings): void {
  requireAccess('settings.manage');
  const prev = loadSettings();
  setJson(SETTINGS_KEY, s);
  const changes: string[] = [];
  if (prev.method !== s.method) changes.push(`costing ${prev.method === 'FIFO' ? 'FIFO' : 'weighted average'} → ${s.method === 'FIFO' ? 'FIFO' : 'weighted average'}`);
  if (!!prev.includeChallans !== !!s.includeChallans) changes.push(`challans ${s.includeChallans ? 'now reduce' : 'no longer reduce'} stock`);
  if ((prev.expiryAlertDays ?? 0) !== (s.expiryAlertDays ?? 0)) changes.push(`expiry alert ${s.expiryAlertDays ?? DEFAULT_EXPIRY_ALERT_DAYS} days`);
  if ((prev.defaultGodown ?? '') !== (s.defaultGodown ?? '')) changes.push('default godown changed');
  if (changes.length) {
    try {
      audit.record({ entity: 'settings', entity_id: 'inventory_settings', action: 'update', summary: `Inventory settings: ${changes.join(', ')}` });
    } catch {
      /* logging never breaks a save */
    }
  }
}

/** Lock subject + audit for a manual stock adjustment (its date is the books date it changes). */
const moveSubject = (m: StockMove) => ({ id: m.id, issue_date: m.date });
function logMove(m: StockMove, action: 'create' | 'delete', item?: StockItem, overridden = false): void {
  try {
    const dir = m.qty >= 0 ? 'added' : 'removed';
    audit.record({
      entity: 'stock_adjustment', entity_id: m.id, action,
      summary: `${action === 'create' ? 'Stock adjustment' : 'Deleted stock adjustment'}: ${Math.abs(m.qty)} ${m.unit ?? item?.unit ?? ''} of ${item?.name ?? 'an item'} ${dir} on ${m.date}${m.note ? ` (${m.note})` : ''}${overridden ? ' (period lock overridden)' : ''}`,
    });
  } catch {
    /* logging never breaks a save */
  }
}

export const stockDb = {
  items: () => getTable<StockItem>(TABLES.items),
  moves: () => getTable<StockMove>(TABLES.moves),
  saveItem(item: StockItem): void {
    const all = getTable<StockItem>(TABLES.items);
    const i = all.findIndex((x) => x.id === item.id);
    // A rename keeps the old name as an alias, so sales / bills saved under it stay attached.
    const aliases = aliasesAfterRename(i >= 0 ? all[i] : undefined, item);
    const row: StockItem = { ...item };
    if (aliases) row.aliases = aliases;
    else delete row.aliases;
    if (i >= 0) all[i] = row;
    else all.push(row);
    setTable(TABLES.items, all);
  },
  /** Deleting an item also removes its manual moves. Refused while a BOM or stock voucher uses it (WP-8). */
  deleteItem(id: string): void {
    const refs = itemVoucherReferences(id, {
      boms: getTable(VOUCHER_TABLES.boms), manufacturing: getTable(VOUCHER_TABLES.manufacturing),
      stockJournals: getTable(VOUCHER_TABLES.stockJournals), physical: getTable(VOUCHER_TABLES.physical),
      jobWork: [...getTable<{ finished_item_id?: string }>('job_work_orders'), ...getTable<{ lines?: { item_id?: string }[] }>('job_work_out'), ...getTable<{ consumed?: { item_id?: string }[] }>('job_work_in')],
    });
    if (refs.length) throw new Error(`This item is used by ${refs.join(', ')}, so it cannot be deleted. Remove it from them first.`);
    setTable(TABLES.items, getTable<StockItem>(TABLES.items).filter((x) => x.id !== id));
    setTable(TABLES.moves, getTable<StockMove>(TABLES.moves).filter((m) => m.item_id !== id));
  },
  /** Period lock (by the adjustment's date) and audit, like every other dated entry. */
  addMove(move: StockMove): void {
    requireAccess('books.edit');
    const state = assertUnlocked(moveSubject(move), 'create');
    setTable(TABLES.moves, [...getTable<StockMove>(TABLES.moves), move]);
    logMove(move, 'create', stockDb.items().find((i) => i.id === move.item_id), state === 'overridden');
  },
  deleteMove(id: string): void {
    const move = getTable<StockMove>(TABLES.moves).find((m) => m.id === id);
    if (!move) return;
    requireAccess('books.edit');
    const state = assertUnlocked(moveSubject(move), 'delete');
    setTable(TABLES.moves, getTable<StockMove>(TABLES.moves).filter((m) => m.id !== id));
    logMove(move, 'delete', stockDb.items().find((i) => i.id === move.item_id), state === 'overridden');
  },
};

export function blankStockItem(partial: Partial<StockItem> = {}): StockItem {
  return {
    id: generateId(), name: '', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0,
    reorder_level: 0, created_at: new Date().toISOString(), ...partial,
  };
}

export function liveInputs(): StockInputs {
  const settings = loadSettings();
  const items = stockDb.items();
  let purchases = getTable<PurchaseLike>('purchases');
  let returnDocs = loadReturnStockDocs();
  // R4-A5: landed-cost vouchers restate the target bills' / GRNs' stock cost from their receipt date (engine copies only).
  const lcv = loadLandedVouchers();
  if (lcv.length) {
    const applied = applyLandedVouchers(lcv, purchases, returnDocs.receipts, items);
    purchases = applied.purchases;
    returnDocs = { ...returnDocs, receipts: applied.receipts };
  }
  return {
    items,
    moves: stockDb.moves(),
    invoices: getTable<InvoiceRecord>('invoices'),
    purchases,
    method: settings.method,
    includeChallans: settings.includeChallans,
    links: getTable<{ from_id: string; to_id: string; relation: string; reason?: string }>('doc_links'),
    returnDocs,
    jobWorkDocs: loadJobWorkStockDocs(),
    kitBoms: getTable<Bom>(VOUCHER_TABLES.boms),
    vouchers: stockVoucherInputs(
      getTable<ManufacturingVoucher>(VOUCHER_TABLES.manufacturing),
      getTable<StockJournal>(VOUCHER_TABLES.stockJournals),
      getTable<PhysicalStockVoucher>(VOUCHER_TABLES.physical),
    ),
  };
}

/** Load everything from localStorage and compute positions. */
export function loadPositions(overrides: Partial<StockInputs> = {}): StockPosition[] {
  return computeStock({ ...liveInputs(), ...overrides });
}

export interface StockLevel {
  itemId: string;
  qty: number;
  unit: string;
  avgCost: number;
  value: number;
  reorderLevel: number;
  status: StockStatus;
}

/** Find a level in a pre-computed list (use this in loops instead of getStockLevel). */
export function findLevel(positions: StockPosition[], itemName: string, hsn?: string): StockLevel | null {
  const it = buildItemIndex(positions.map((p) => p.item).filter((i) => i.track_stock)).find(itemName, hsn);
  const p = it && positions.find((x) => x.item.id === it.id);
  if (!p) return null;
  return {
    itemId: p.item.id, qty: p.qty, unit: p.item.unit, avgCost: p.avgCost, value: p.value,
    reorderLevel: num(p.item.reorder_level), status: p.status,
  };
}

/** Current stock level for an item name (null when not a tracked stock item). */
export function getStockLevel(itemName: string, hsn?: string): StockLevel | null {
  try {
    return findLevel(loadPositions(), itemName, hsn);
  } catch {
    return null;
  }
}

/** Number of tracked items at/below their reorder level (includes negative stock). */
export function lowStockCount(): number {
  try {
    return loadPositions().filter((p) => p.isLow).length;
  } catch {
    return 0;
  }
}

/** Positions without one document, re-computed only when a stock input changed (the editor asks per keystroke). */
let positionsCache: { key: (string | null)[]; positions: StockPosition[] } | null = null;

function cachedPositionsWithout(docId: string | undefined): StockPosition[] {
  const key = [
    docId ?? '',
    ...['invoices', 'purchases', TABLES.items, TABLES.moves, 'doc_links', 'job_work_in', 'rejections_in', VOUCHER_TABLES.boms].map((t) => readRaw(DB_PREFIX + t)),
    readRaw(SETTINGS_KEY),
  ];
  if (positionsCache && positionsCache.key.length === key.length && positionsCache.key.every((k, i) => k === key[i])) {
    return positionsCache.positions;
  }
  const positions = computeStock({ ...liveInputs(), excludeInvoiceId: docId });
  positionsCache = { key, positions };
  return positions;
}

/**
 * Shortfall lines for a draft/saved document, using live data. [] when all is well. Cheap on every
 * keystroke: nothing is read beyond the stock items unless the type moves stock and a line names a
 * tracked item, and positions are cached until a stock input changes.
 */
export function stockWarningForInvoice(
  invoice: Pick<InvoiceRecord, 'doc_type' | 'items'> & Partial<Pick<InvoiceRecord, 'id'>>,
): StockShortfall[] {
  try {
    if (invoiceEffect(invoice.doc_type, 'Sent', true) !== 'out') return [];
    // Read-only view: the stock master is parsed once per stored version, not on every keystroke.
    const tracked = peekTable<StockItem>(TABLES.items).filter((i) => i.track_stock);
    if (!tracked.length) return [];
    const index = buildItemIndex(tracked);
    if (!(invoice.items ?? []).some((l) => num(l.quantity) > 0 && index.find(l.name, l.hsn))) return [];
    if (invoice.doc_type === 'DELIVERY_CHALLAN' && !loadSettings().includeChallans) return [];
    return shortfallsFromPositions(invoice, cachedPositionsWithout(invoice.id));
  } catch {
    return [];
  }
}
