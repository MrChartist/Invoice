/**
 * Pharma operations (8.84 — Marg "Breakage / Expiry Issue · Receive").
 *
 *  - Breakage / Expiry ISSUE: every in-stock batch that is expired or expires within N days is traced to
 *    the supplier bill(s) that brought that batch in (the line's `item_id`, else item name; most recent
 *    bill first, never more than the bill line can still return) and grouped by supplier. One pass creates
 *    the debit notes (`purchase_returns`, `DN/FY…`, goods returned from the batch's godown — the stock
 *    engine takes the goods out) — one per supplier bill, or (8.88, "one note per supplier") ONE note spanning the
 *    supplier's bills (`purchaseReturnsDb.createMulti`, on account) — and ONE
 *    claim per supplier (`expiry_claims`) holding them. All-or-nothing: if any note is refused (period lock,
 *    returnable quantity, role) nothing is written.
 *  - Claim tracking: pending → credit received (the supplier's credit note number / date is written on each
 *    debit note, so GSTR-2B CDNR matching finds it) or rejected (the debit notes stay until you delete them).
 *  - Breakage / Expiry RECEIVE (`expiry_receipts`, `BER/FY…`): a customer hands back expired / broken
 *    goods; they come into a non-saleable "Expiry" godown (godown kind 'expiry'; sales from it are refused)
 *    as stock moves, with an optional replacement issued from a saleable godown at nil value.
 *  - Destroy: stock in the expiry godown written off (adjustment out, `ref_type` 'expiry_destroy', the cost
 *    rate kept on the move). Each destruction raises an ITC-reversal reminder: input tax on goods destroyed
 *    is blocked by Sec 17(5)(h) CGST Act and must be reversed in GSTR-3B Table 4(B)(1) — the amount shown
 *    is an estimate (cost × the item's GST rate): verify with your CA.
 *
 * Writers check roles, the period lock and audit. Pure above "Storage".
 */

import type { PurchaseRecord, PurchaseReturn } from '../types/purchases';
import type { StockItem, StockMove } from './inventory';
import type { TrackingMap } from './stock-tracking';
import { num, round2 } from './invoice-calc';
import { isVoidStatus, readPurchase } from './purchase-normalize';
import { lineFactor } from './units';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { withTablesRollback } from './table-txn';

export const CLAIMS_TABLE = 'expiry_claims';
export const RECEIPTS_TABLE = 'expiry_receipts';
export const RECEIPT_PREFIX = 'BER';
const EPS = 1e-6;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/* ── Issue: candidates and grouping (pure) ─────────────────────── */

export interface IssueRow {
  key: string;
  itemId: string;
  item: string;
  batch: string;
  expiry: string;
  expired: boolean;
  godown: string;
  /** Base units to send back on this bill line. */
  qty: number;
  billId: string;
  billNumber: string;
  billDate: string;
  billLineId: string;
  /** Base units per bill-line unit. */
  factor: number;
  vendorId?: string;
  vendorName: string;
  /** Taxable cost per bill-line unit (after the line discount). */
  unitCost: number;
  taxRate: number;
}

export interface Untraced { itemId: string; item: string; batch: string; expiry: string; godown: string; qty: number }

/**
 * Batches expired or expiring by `limitDay`, allocated to the supplier bills that brought them in.
 * `returned` = base units already returned per bill line id (earlier goods notes).
 */
export function brkExpCandidates(
  tracking: TrackingMap,
  purchases: readonly PurchaseRecord[],
  day: string,
  limitDay: string,
  returned: ReadonlyMap<string, number> = new Map(),
): { rows: IssueRow[]; untraced: Untraced[] } {
  const rows: IssueRow[] = [];
  const untraced: Untraced[] = [];
  const left = new Map<string, number>();
  const bills = purchases
    .filter((p) => {
      const c = readPurchase(p);
      return c && !isVoidStatus(c.status) && !c.isExpense && p.kind !== 'EXPENSE';
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const t of tracking.values()) {
    for (const b of t.batches) {
      if (!b.batch || !b.expiry || !(b.qty > EPS) || b.expiry > limitDay) continue;
      const lines: { bill: PurchaseRecord; line: PurchaseRecord['lines'][number] }[] = [];
      for (const bill of bills) {
        for (const line of bill.lines ?? []) {
          if (norm(line.batch_no) !== norm(b.batch)) continue;
          if (line.item_id ? line.item_id !== t.item.id : norm(line.name) !== norm(t.item.name) && !(t.item.aliases ?? []).some((a) => norm(a) === norm(line.name))) continue;
          lines.push({ bill, line });
        }
      }
      for (const [godown, gq] of Object.entries(b.byGodown)) {
        let need = round2(gq);
        if (need <= EPS) continue;
        for (const { bill, line } of lines) {
          if (need <= EPS) break;
          const f = lineFactor(line);
          const cap = left.get(line.id) ?? Math.max(num(line.quantity) * f - (returned.get(line.id) ?? 0), 0);
          const take = Math.min(need, cap);
          if (take <= EPS) continue;
          left.set(line.id, cap - take);
          need = round2(need - take);
          const disc = Math.min(Math.max(num((line as { discount_percent?: number }).discount_percent), 0), 100);
          rows.push({
            key: `${line.id}|${godown}`, itemId: t.item.id, item: t.item.name, batch: b.batch, expiry: b.expiry, expired: b.expiry < day, godown,
            qty: round2(take), billId: bill.id, billNumber: bill.bill_number, billDate: bill.date, billLineId: line.id, factor: f,
            ...(bill.vendor_id ? { vendorId: bill.vendor_id } : {}), vendorName: bill.vendor_name, unitCost: round2(num(line.rate) * (1 - disc / 100)), taxRate: num(line.tax_rate),
          });
        }
        if (need > EPS) untraced.push({ itemId: t.item.id, item: t.item.name, batch: b.batch, expiry: b.expiry, godown, qty: round2(need) });
      }
    }
  }
  rows.sort((a, b) => a.vendorName.localeCompare(b.vendorName) || a.expiry.localeCompare(b.expiry) || a.item.localeCompare(b.item));
  return { rows, untraced };
}

export interface SupplierGroup {
  key: string;
  vendorId?: string;
  vendorName: string;
  rows: IssueRow[];
  /** Bill ids in the group (one debit note each). */
  bills: string[];
  /** Taxable value of the goods (cost). */
  value: number;
}

/** Rows grouped by supplier (vendor id, else name), each with its bills. */
export function groupBySupplier(rows: readonly IssueRow[]): SupplierGroup[] {
  const map = new Map<string, SupplierGroup>();
  for (const r of rows) {
    const key = r.vendorId || `name:${norm(r.vendorName)}`;
    const g = map.get(key) ?? { key, vendorId: r.vendorId, vendorName: r.vendorName, rows: [], bills: [], value: 0 };
    g.rows.push(r);
    if (!g.bills.includes(r.billId)) g.bills.push(r.billId);
    g.value = round2(g.value + (r.qty / r.factor) * r.unitCost);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.value - a.value || a.vendorName.localeCompare(b.vendorName));
}

/** Base units already returned per bill line (goods notes). */
export function returnedByLine(notes: readonly PurchaseReturn[], purchases: readonly PurchaseRecord[]): Map<string, number> {
  const factor = new Map<string, number>();
  for (const p of purchases) for (const l of p.lines ?? []) factor.set(l.id, lineFactor(l));
  const out = new Map<string, number>();
  for (const n of notes) {
    if (!n?.goods_returned) continue;
    for (const l of n.lines ?? []) if (l.bill_line_id) out.set(l.bill_line_id, (out.get(l.bill_line_id) ?? 0) + num(l.quantity) * (factor.get(l.bill_line_id) ?? 1));
  }
  return out;
}

/* ── Claims / receipts types ───────────────────────────────────── */

export type ClaimState = 'pending' | 'credited' | 'rejected';

export interface ExpiryClaim {
  id: string;
  /** yyyy-mm-dd (the debit notes' date). */
  date: string;
  vendor_id?: string;
  vendor_name: string;
  note_ids: string[];
  note_numbers: string[];
  /** Total of the debit notes (₹, with GST). */
  amount: number;
  state: ClaimState;
  supplier_note_number?: string;
  supplier_note_date?: string;
  /** Amount the supplier actually credited (may be less than claimed). */
  credited_amount?: number;
  decided_on?: string;
  remarks?: string;
  created_at?: string;
}

export interface ReceiptLine { id: string; item_id: string; qty: number; batch_no?: string; expiry_date?: string }

export interface ExpiryReceipt {
  id: string;
  /** `BER/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  client_id?: string;
  client_name: string;
  /** Expiry godown the goods came into. */
  godown_id: string;
  lines: ReceiptLine[];
  /** Replacement goods given (from `replace_from`). */
  replacement?: ReceiptLine[];
  replace_from?: string;
  /** Stock moves this receipt wrote (goods in + replacement out). */
  move_ids: string[];
  notes?: string;
  created_at?: string;
}

/* ── ITC reversal reminders (pure) ─────────────────────────────── */

export interface ItcReminder {
  month: string;
  moves: number;
  /** Cost of the goods destroyed. */
  value: number;
  /** Estimated input tax to reverse (cost × GST rate). */
  itc: number;
}

/** Destructions (`ref_type` 'expiry_destroy') per month with the estimated ITC to reverse. */
export function itcReminders(moves: readonly StockMove[], items: readonly Pick<StockItem, 'id' | 'tax_rate'>[]): ItcReminder[] {
  const tax = new Map(items.map((i) => [i.id, num(i.tax_rate)]));
  const map = new Map<string, ItcReminder>();
  for (const m of moves) {
    if (m?.ref_type !== 'expiry_destroy' || !(num(m.qty) < 0)) continue;
    const month = String(m.date).slice(0, 7);
    const value = Math.abs(num(m.qty)) * lineFactor(m) * (num(m.rate) / lineFactor(m));
    const r = map.get(month) ?? { month, moves: 0, value: 0, itc: 0 };
    r.moves++;
    r.value = round2(r.value + value);
    r.itc = round2(r.itc + (value * (tax.get(m.item_id) ?? 0)) / 100);
    map.set(month, r);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();

export interface IssueDeps {
  /** `purchaseReturnsDb.create` (injected so this module stays light; also lets tests observe it). */
  createNote: (draft: {
    kind: 'DEBIT_NOTE'; date: string; purchaseId: string; reason: '01'; goodsReturned: true; notes?: string;
    lines: { id: string; bill_line_id: string; name: string; hsn?: string; unit?: string; quantity: number; rate: number; tax_rate: number; godown_id?: string; batch_no?: string }[];
  }) => PurchaseReturn;
  /** 8.88: `purchaseReturnsDb.createMulti` — one debit note spanning several bills of the supplier. */
  createMultiNote?: (draft: {
    date: string; reason: '01'; goodsReturned: true; notes?: string;
    lines: { id: string; purchase_id: string; bill_line_id: string; name: string; hsn?: string; unit?: string; quantity: number; rate: number; tax_rate: number; godown_id?: string; batch_no?: string }[];
  }) => PurchaseReturn;
}

/**
 * Create the debit notes and one claim per supplier for the chosen rows, all-or-nothing.
 * Rows of a bill line are merged per godown + batch; quantities go back in the bill line's unit.
 */
export function createBrkExpIssue(rows: readonly IssueRow[], date: string, deps: IssueDeps, note = 'Breakage / expiry return', opts: { onePerSupplier?: boolean } = {}): ExpiryClaim[] {
  requireAccess('books.edit');
  const chosen = rows.filter((r) => r.qty > EPS);
  if (!chosen.length) throw new Error('Choose at least one batch to send back.');
  const purchases = getTable<PurchaseRecord>('purchases');
  return withTablesRollback(['purchase_returns', 'purchases', CLAIMS_TABLE, 'series_counters'], () => {
    const claims: ExpiryClaim[] = [];
    for (const g of groupBySupplier(chosen)) {
      const notes: PurchaseReturn[] = [];
      const linesOf = (billId: string) => {
        const bill = purchases.find((p) => p.id === billId);
        if (!bill) throw new Error(`Bill ${billId} no longer exists.`);
        return g.rows.filter((r) => r.billId === billId).map((r) => {
          const bl = bill.lines.find((l) => l.id === r.billLineId);
          return {
            id: generateId(), bill_line_id: r.billLineId, name: bl?.name ?? r.item, ...(bl?.hsn ? { hsn: bl.hsn } : {}), ...(bl?.unit ? { unit: bl.unit } : {}),
            quantity: round2(r.qty / r.factor), rate: r.unitCost, tax_rate: r.taxRate, godown_id: r.godown, batch_no: r.batch,
          };
        });
      };
      if (opts.onePerSupplier && deps.createMultiNote && g.bills.length > 1) {
        // 8.88: one debit note for the supplier, each line naming its bill.
        notes.push(deps.createMultiNote({ date, reason: '01', goodsReturned: true, notes: note, lines: g.bills.flatMap((billId) => linesOf(billId).map((l) => ({ ...l, purchase_id: billId }))) }));
      } else {
        for (const billId of g.bills) notes.push(deps.createNote({ kind: 'DEBIT_NOTE', date, purchaseId: billId, reason: '01', goodsReturned: true, notes: note, lines: linesOf(billId) }));
      }
      const claim: ExpiryClaim = {
        id: generateId(), date, ...(g.vendorId ? { vendor_id: g.vendorId } : {}), vendor_name: g.vendorName,
        note_ids: notes.map((n) => n.id), note_numbers: notes.map((n) => n.note_number), amount: round2(notes.reduce((s, n) => s + num(n.total), 0)),
        state: 'pending', created_at: now(),
      };
      claims.push(claim);
    }
    setTable(CLAIMS_TABLE, [...claimsDb.all(), ...claims]);
    try {
      audit.record({ entity: 'purchase', entity_id: claims[0].id, action: 'create', summary: `Breakage / expiry issue on ${date}: ${claims.length} supplier claim(s), ${claims.reduce((s, c) => s + c.note_numbers.length, 0)} debit note(s), ₹${claims.reduce((s, c) => s + c.amount, 0).toFixed(2)}` });
    } catch {
      /* logging never blocks */
    }
    return claims;
  });
}

export const claimsDb = {
  all: (): ExpiryClaim[] => getTable<ExpiryClaim>(CLAIMS_TABLE).filter((c) => c && typeof c.id === 'string'),

  /**
   * Record the supplier's answer. Credit received: their credit note number / date are written on every
   * debit note of the claim (`setSupplierNote`, for 2B matching). Rejected: a remark is required.
   */
  decide(id: string, state: ClaimState, input: { supplierNoteNumber?: string; supplierNoteDate?: string; creditedAmount?: number; remarks?: string; on: string }, setSupplierNote?: (noteId: string, number: string, date: string) => unknown): ExpiryClaim {
    requireAccess('books.edit');
    const all = claimsDb.all();
    const c = all.find((x) => x.id === id);
    if (!c) throw new Error('Claim not found.');
    if (state === 'credited' && !input.supplierNoteNumber?.trim()) throw new Error("Enter the supplier's credit note number.");
    if (state === 'rejected' && !input.remarks?.trim()) throw new Error('Add a remark: why the supplier rejected the claim.');
    assertUnlocked({ issue_date: input.on || c.date, invoice_number: c.note_numbers.join(', ') }, 'edit');
    const next: ExpiryClaim = {
      ...c, state, decided_on: input.on,
      ...(input.remarks?.trim() ? { remarks: input.remarks.trim() } : {}),
      ...(state === 'credited' ? { supplier_note_number: input.supplierNoteNumber!.trim(), ...(input.supplierNoteDate ? { supplier_note_date: input.supplierNoteDate } : {}), credited_amount: round2(num(input.creditedAmount) || c.amount) } : {}),
    };
    if (state !== 'credited') {
      delete next.supplier_note_number;
      delete next.supplier_note_date;
      delete next.credited_amount;
    }
    withTablesRollback([CLAIMS_TABLE, 'purchase_returns'], () => {
      if (state === 'credited' && setSupplierNote) for (const nid of c.note_ids) setSupplierNote(nid, next.supplier_note_number ?? '', next.supplier_note_date ?? '');
      setTable(CLAIMS_TABLE, all.map((x) => (x.id === id ? next : x)));
    });
    try {
      audit.record({ entity: 'purchase', entity_id: id, action: 'update', summary: `Expiry claim ${c.note_numbers.join(', ')} (${c.vendor_name}): ${state}${next.supplier_note_number ? ` — supplier credit note ${next.supplier_note_number}` : ''}${next.remarks ? ` — ${next.remarks}` : ''}` });
    } catch {
      /* logging never blocks */
    }
    return next;
  },
};

export const receiptsDb = {
  all: (): ExpiryReceipt[] => getTable<ExpiryReceipt>(RECEIPTS_TABLE).filter((r) => r && typeof r.id === 'string'),
  nextNumber: (date?: string): string => nextSeriesNumberFor(RECEIPT_PREFIX, date, receiptsDb.all().map((r) => r.number)),

  /** Customer return of expired / broken goods into the expiry godown (+ optional replacement). */
  receive(input: { date: string; client_id?: string; client_name: string; godown_id: string; lines: ReceiptLine[]; replacement?: ReceiptLine[]; replace_from?: string; notes?: string }): ExpiryReceipt {
    requireAccess('books.edit');
    if (!input.client_name.trim()) throw new Error('Choose the customer.');
    if (!input.godown_id) throw new Error('Create an Expiry godown first (Inventory → Godowns, kind "Expiry").');
    const lines = input.lines.filter((l) => l.item_id && num(l.qty) > 0);
    if (!lines.length) throw new Error('Add at least one item received back.');
    const repl = (input.replacement ?? []).filter((l) => l.item_id && num(l.qty) > 0);
    if (repl.length && !input.replace_from) throw new Error('Choose the godown the replacement leaves from.');
    const number = receiptsDb.nextNumber(input.date);
    const state = assertUnlocked({ issue_date: input.date, invoice_number: number }, 'create');
    const id = generateId();
    const moves: StockMove[] = [
      ...lines.map((l) => ({
        id: generateId(), item_id: l.item_id, date: input.date, qty: round2(num(l.qty)), rate: 0, kind: 'return' as const, ref_type: 'expiry_receipt', ref_id: id,
        note: `Expiry / breakage received ${number} · ${input.client_name.trim()}`, godown_id: input.godown_id,
        ...(l.batch_no ? { batch_no: l.batch_no } : {}), ...(l.expiry_date ? { expiry_date: l.expiry_date } : {}),
      })),
      ...repl.map((l) => ({
        id: generateId(), item_id: l.item_id, date: input.date, qty: -round2(num(l.qty)), rate: 0, kind: 'sale' as const, ref_type: 'expiry_receipt', ref_id: id,
        note: `Replacement for ${number} · ${input.client_name.trim()}`, godown_id: input.replace_from,
        ...(l.batch_no ? { batch_no: l.batch_no } : {}),
      })),
    ];
    const rec: ExpiryReceipt = {
      id, number, date: input.date, ...(input.client_id ? { client_id: input.client_id } : {}), client_name: input.client_name.trim(), godown_id: input.godown_id,
      lines, ...(repl.length ? { replacement: repl, replace_from: input.replace_from } : {}), move_ids: moves.map((m) => m.id),
      ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}), created_at: now(),
    };
    withTablesRollback(['stock_moves', RECEIPTS_TABLE, 'series_counters'], () => {
      setTable('stock_moves', [...getTable<StockMove>('stock_moves'), ...moves]);
      setTable(RECEIPTS_TABLE, [...receiptsDb.all(), rec]);
      recordSeries(number);
    });
    try {
      audit.record({ entity: 'stock_adjustment', entity_id: id, action: 'create', doc_number: number, summary: `Breakage / expiry received ${number} from ${rec.client_name}: ${lines.length} line(s) into the expiry godown${repl.length ? `, ${repl.length} replacement line(s)` : ''}${state === 'overridden' ? ' (period lock overridden)' : ''}` });
    } catch {
      /* logging never blocks */
    }
    return rec;
  },

  /** Delete a receipt and its stock moves (period lock; audited). */
  remove(id: string): void {
    requireAccess('books.edit');
    const rec = receiptsDb.all().find((r) => r.id === id);
    if (!rec) return;
    assertUnlocked({ issue_date: rec.date, invoice_number: rec.number }, 'delete');
    const drop = new Set(rec.move_ids);
    withTablesRollback(['stock_moves', RECEIPTS_TABLE], () => {
      setTable('stock_moves', getTable<StockMove>('stock_moves').filter((m) => !drop.has(m.id)));
      setTable(RECEIPTS_TABLE, receiptsDb.all().filter((r) => r.id !== id));
    });
    try {
      audit.record({ entity: 'stock_adjustment', entity_id: id, action: 'delete', doc_number: rec.number, summary: `Deleted breakage / expiry receipt ${rec.number}` });
    } catch {
      /* logging never blocks */
    }
  },
};

/**
 * Destroy stock in the expiry godown: one adjustment out per line, the cost rate per base unit kept on the
 * move (for the ITC reminder). Returns the moves written.
 */
export function destroyExpiryStock(input: { date: string; godown_id: string; lines: { item_id: string; qty: number; batch_no?: string; cost: number }[]; note?: string }): StockMove[] {
  requireAccess('books.edit');
  const lines = input.lines.filter((l) => l.item_id && num(l.qty) > 0);
  if (!lines.length) throw new Error('Choose the stock to destroy.');
  const state = assertUnlocked({ issue_date: input.date }, 'create');
  const moves: StockMove[] = lines.map((l) => ({
    id: generateId(), item_id: l.item_id, date: input.date, qty: -round2(num(l.qty)), rate: round2(num(l.cost)), kind: 'adjustment', ref_type: 'expiry_destroy',
    note: input.note?.trim() || 'Destroyed (expired / breakage)', godown_id: input.godown_id, ...(l.batch_no ? { batch_no: l.batch_no } : {}),
  }));
  setTable('stock_moves', [...getTable<StockMove>('stock_moves'), ...moves]);
  try {
    audit.record({ entity: 'stock_adjustment', entity_id: moves[0].id, action: 'create', summary: `Destroyed expired / breakage stock on ${input.date}: ${moves.length} line(s), cost ₹${moves.reduce((s, m) => s + Math.abs(m.qty) * m.rate, 0).toFixed(2)} — reverse ITC u/s 17(5)(h) (verify with your CA)${state === 'overridden' ? ' (period lock overridden)' : ''}` });
  } catch {
    /* logging never blocks */
  }
  return moves;
}
