/**
 * Landed-cost voucher (R4-A5, `LCV/FY<yy-yy>/<seq>`): the clearing agent's or transporter's bill that arrives after the
 * goods, spread over the goods lines of one or more earlier purchase bills / GRNs so stock cost and margins are right.
 *
 *  - Charges: non-stock lines of purchase bills / expenses (freight, CHA, insurance), or typed memo amounts.
 *  - Targets: purchase bills and / or GRNs (their goods lines).
 *  - Method: by value (default), quantity in base units, net weight (catalogue `net_weight`) or equal per line —
 *    `allocateLandedAmounts` (landed-cost.ts); paisa drift goes to the largest line.
 *  - Engine: `liveInputs()` (inventory.ts) hands the stock engine COPIES of the target bills / GRNs carrying the extra
 *    cost per line (`applyLandedVouchers`), effective from the target's receipt date, so FIFO layers and averages are
 *    restated — the same "the engine recomputes live" rule as back-dated purchases. Stored documents never change.
 *  - Books: nothing posts. The freight / CHA bill is already an expense in Books; the voucher only moves stock
 *    valuation, which the report-time closing stock (`loadStockValuer`) picks up (verify the presentation with your CA).
 *  - A charge line can be spread by one voucher only, and a memo charge already typed as a target bill's own
 *    `landed_costs` is refused (it would count twice).
 *
 * Pure above the "Storage" divider (tests/landed-voucher.test.ts).
 */
import type { PurchaseRecord, ReceiptNote } from '../types/purchases';
import type { LandedAllocationRow, LandedCostVoucher, LandedMethod, LandedVoucherCharge, LandedVoucherTarget } from '../types/production-r4';
import { allocateLandedAmounts, type LandedBasis } from './landed-cost';
import { LANDED_EXTRA_KEY, isVoidStatus, readPurchase, readPurchaseLines } from './purchase-normalize';
import { round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { withTablesRollback } from './table-txn';

export const LCV_TABLE = 'landed_cost_vouchers';
export const LCV_PREFIX = 'LCV';
export const LANDED_METHODS: readonly LandedMethod[] = ['value', 'qty', 'weight', 'equal'];

const EPS = 1e-9;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const low = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Minimal stock-item view (kept local so the stock engine can import this module without a cycle). */
export interface LandedItem {
  id: string;
  name: string;
  aliases?: string[];
  track_stock?: boolean;
  net_weight?: number;
  weight_unit?: 'kg' | 'g';
}

export interface TargetLine {
  target: LandedVoucherTarget;
  lineId: string;
  itemId?: string;
  name: string;
  /** Line quantity, in the line's unit. */
  quantity: number;
  unitFactor: number;
  /** Cost per line unit before any landed cost. */
  unitCost: number;
  /** Landed cost per line unit already on it (the bill's own `landed_costs`, other vouchers). */
  landedUnit: number;
  /** kg per base unit (0 = unknown). */
  netWeight: number;
  date: string;
  docNumber: string;
  party: string;
}

const kgOf = (it: LandedItem | undefined) => (it ? Math.max(n(it.net_weight), 0) / (it.weight_unit === 'g' ? 1000 : 1) : 0);

function itemFinder(items: readonly LandedItem[]) {
  const tracked = items.filter((i) => i.track_stock);
  const byId = new Map(tracked.map((i) => [i.id, i]));
  const byName = new Map<string, LandedItem>();
  for (const i of tracked) {
    if (!byName.has(low(i.name))) byName.set(low(i.name), i);
    for (const a of i.aliases ?? []) if (!byName.has(low(a))) byName.set(low(a), i);
  }
  return (itemId: string | undefined, name: string) => (itemId ? byId.get(itemId) : undefined) ?? byName.get(low(name));
}

/** Goods lines of the targets (lines that match a stock item that tracks stock). */
export function targetLines(
  targets: readonly LandedVoucherTarget[], purchases: readonly unknown[], receipts: readonly ReceiptNote[], items: readonly LandedItem[],
  extras?: LandedExtras,
): TargetLine[] {
  const find = itemFinder(items);
  const out: TargetLine[] = [];
  for (const t of targets) {
    if (t.kind === 'bill') {
      const raw = purchases.find((p) => (p as { id?: string })?.id === t.id);
      const bill = readPurchase(raw);
      if (!bill || isVoidStatus(bill.status) || bill.isExpense) continue;
      for (const l of readPurchaseLines(raw, extras?.bill.get(t.id))) {
        const it = find(l.itemId, l.name);
        if (!it || !l.lineId || !(l.quantity > 0)) continue;
        out.push({ target: t, lineId: l.lineId, itemId: it.id, name: l.name, quantity: l.quantity, unitFactor: l.unitFactor, unitCost: l.unitCost, landedUnit: l.landedUnit, netWeight: kgOf(it), date: bill.date, docNumber: bill.number, party: bill.partyName });
      }
    } else {
      const g = receipts.find((r) => r?.id === t.id && r.kind === 'GRN');
      if (!g) continue;
      for (const l of g.lines ?? []) {
        const it = find(l.item_id, l.name);
        if (!it || !(n(l.quantity) > 0)) continue;
        out.push({ target: t, lineId: l.id, itemId: it.id, name: l.name, quantity: n(l.quantity), unitFactor: n(l.unit_factor) > 0 ? n(l.unit_factor) : 1, unitCost: n(l.rate), landedUnit: extras?.grn.get(l.id) ?? 0, netWeight: kgOf(it), date: String(g.date ?? '').slice(0, 10), docNumber: g.number, party: g.vendor_name });
      }
    }
  }
  return out;
}

/** Rupees per target line (index-aligned with `lines`). */
export function allocateVoucher(v: Pick<LandedCostVoucher, 'charges' | 'method'>, lines: readonly TargetLine[]): number[] {
  return allocateLandedAmounts(
    lines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost, unitFactor: l.unitFactor, netWeight: l.netWeight })),
    v.charges.map((c) => ({ label: c.label, amount: c.amount })),
    (LANDED_METHODS.includes(v.method) ? v.method : 'value') as LandedBasis,
  );
}

/** Preview / snapshot rows: ₹ per line and the cost per base unit before / after. */
export function allocationRows(v: Pick<LandedCostVoucher, 'charges' | 'method'>, lines: readonly TargetLine[]): LandedAllocationRow[] {
  const amounts = allocateVoucher(v, lines);
  return lines.map((l, i) => {
    const qtyBase = l.quantity * l.unitFactor;
    const before = (l.unitCost + l.landedUnit) / l.unitFactor;
    return {
      target: l.target, line_id: l.lineId, ...(l.itemId ? { item_id: l.itemId } : {}), name: l.name, qty_base: Math.round(qtyBase * 1000) / 1000,
      amount: amounts[i], unit_before: round2(before), unit_after: round2(before + (qtyBase > EPS ? amounts[i] / qtyBase : 0)),
    };
  });
}

export interface LandedExtras {
  /** bill id → { bill line id → extra per bill line unit }. */
  bill: Map<string, Record<string, number>>;
  /** GRN line id → extra per GRN line unit. */
  grn: Map<string, number>;
}

/** Extra cost per target line unit from every voucher (allocated live over the targets as they are now). */
export function landedExtras(vouchers: readonly LandedCostVoucher[], purchases: readonly unknown[], receipts: readonly ReceiptNote[], items: readonly LandedItem[]): LandedExtras {
  const out: LandedExtras = { bill: new Map(), grn: new Map() };
  for (const v of vouchers) {
    if (!v?.id || !Array.isArray(v.charges) || !Array.isArray(v.targets)) continue;
    const lines = targetLines(v.targets, purchases, receipts, items);
    const amounts = allocateVoucher(v, lines);
    lines.forEach((l, i) => {
      const per = l.quantity > EPS ? amounts[i] / l.quantity : 0;
      if (!(per > 0)) return;
      if (l.target.kind === 'bill') {
        const m = out.bill.get(l.target.id) ?? {};
        m[l.lineId] = (m[l.lineId] ?? 0) + per;
        out.bill.set(l.target.id, m);
      } else out.grn.set(l.lineId, (out.grn.get(l.lineId) ?? 0) + per);
    });
  }
  return out;
}

/**
 * Engine inputs with the vouchers applied: copies of the target bills carry `LANDED_EXTRA_KEY`, copies of unbilled GRN
 * lines a higher rate, and bill lines that bill a target GRN line carry its extra too (a billed GRN is valued at its
 * bill's rate). Untouched rows are passed through as they are. Pure.
 */
export function applyLandedVouchers<P, R extends ReceiptNote>(
  vouchers: readonly LandedCostVoucher[], purchases: readonly P[], receipts: readonly R[], items: readonly LandedItem[],
): { purchases: P[]; receipts: R[] } {
  if (!vouchers.length) return { purchases: [...purchases], receipts: [...receipts] };
  const ex = landedExtras(vouchers, purchases, receipts, items);
  const grnFactor = new Map<string, number>();
  for (const g of receipts) for (const l of g?.lines ?? []) if (ex.grn.has(l.id)) grnFactor.set(l.id, n(l.unit_factor) > 0 ? n(l.unit_factor) : 1);
  const outP = purchases.map((p) => {
    const rec = p as unknown as { id?: string; lines?: { id?: string; grn_line_id?: string; unit_factor?: number }[] };
    const own = rec?.id ? ex.bill.get(rec.id) : undefined;
    const viaGrn: Record<string, number> = {};
    for (const l of rec?.lines ?? []) {
      const e = l?.id && l.grn_line_id ? ex.grn.get(l.grn_line_id) : undefined;
      if (e && l.id) viaGrn[l.id] = (e / (grnFactor.get(l.grn_line_id as string) ?? 1)) * (n(l.unit_factor) > 0 ? n(l.unit_factor) : 1);
    }
    if (!own && !Object.keys(viaGrn).length) return p;
    const merged: Record<string, number> = { ...(own ?? {}) };
    for (const [k, v] of Object.entries(viaGrn)) merged[k] = (merged[k] ?? 0) + v;
    return { ...(p as object), [LANDED_EXTRA_KEY]: merged } as P;
  });
  const outR = receipts.map((g) => {
    if (g?.kind !== 'GRN' || !(g.lines ?? []).some((l) => ex.grn.has(l.id))) return g;
    return { ...g, lines: g.lines.map((l) => (ex.grn.has(l.id) ? { ...l, rate: n(l.rate) + (ex.grn.get(l.id) ?? 0) } : l)) };
  });
  return { purchases: outP, receipts: outR };
}

/* ── Charges ──────────────────────────────────────────────────── */

export interface ChargeCandidate {
  source: { kind: 'bill'; id: string; line_id?: string };
  label: string;
  amount: number;
  date: string;
  party: string;
  /** Already spread by another voucher (number). */
  usedBy?: string;
}

const chargeKey = (s: { kind: string; id?: string; line_id?: string }) => `${s.kind}|${s.id ?? ''}|${s.line_id ?? ''}`;

/** Non-stock lines of live bills and expenses (freight, CHA, insurance …) that can be spread, newest first. */
export function chargeCandidates(purchases: readonly unknown[], items: readonly LandedItem[], vouchers: readonly LandedCostVoucher[], excludeId?: string): ChargeCandidate[] {
  const find = itemFinder(items);
  const used = new Map<string, string>();
  for (const v of vouchers) if (v.id !== excludeId) for (const c of v.charges ?? []) if (c.source?.kind === 'bill') used.set(chargeKey(c.source), v.number);
  const out: ChargeCandidate[] = [];
  for (const raw of purchases) {
    const bill = readPurchase(raw);
    if (!bill || isVoidStatus(bill.status) || !bill.id) continue;
    const lines = readPurchaseLines(raw);
    const push = (line_id: string | undefined, label: string, amount: number) => {
      if (!(amount > 0)) return;
      const source = { kind: 'bill' as const, id: bill.id, ...(line_id ? { line_id } : {}) };
      const usedBy = used.get(chargeKey(source));
      out.push({ source, label: `${bill.number || 'Bill'} · ${label}`, amount: round2(amount), date: bill.date, party: bill.partyName, ...(usedBy ? { usedBy } : {}) });
    };
    if (!lines.length && bill.isExpense) push(undefined, bill.category || 'Expense', bill.taxable);
    for (const l of lines) if (l.lineId && !find(l.itemId, l.name)) push(l.lineId, l.name || 'Charge', l.quantity * l.unitCost || 0);
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Why the voucher cannot be saved ('' = fine). */
export function validateLandedVoucher(
  v: Pick<LandedCostVoucher, 'date' | 'method' | 'charges' | 'targets'> & { id?: string },
  ctx: { vouchers: readonly LandedCostVoucher[]; purchases: readonly unknown[]; receipts: readonly ReceiptNote[]; items: readonly LandedItem[] },
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date ?? '')) return 'Choose the voucher date.';
  if (!LANDED_METHODS.includes(v.method)) return 'Choose how to spread the charges.';
  const charges = (v.charges ?? []).filter((c) => n(c.amount) > 0);
  if (!charges.length) return 'Add at least one charge with an amount.';
  if (charges.some((c) => !String(c.label ?? '').trim())) return 'Every charge needs a description.';
  if (!(v.targets ?? []).length) return 'Pick at least one purchase bill or GRN to spread the charges over.';
  const lines = targetLines(v.targets, ctx.purchases, ctx.receipts, ctx.items);
  if (!lines.length) return 'The chosen bills / GRNs have no goods lines of stock items.';
  const seen = new Set<string>();
  const candidates = new Map(chargeCandidates(ctx.purchases, ctx.items, ctx.vouchers, v.id).map((c) => [chargeKey(c.source), c]));
  for (const c of charges) {
    if (c.source?.kind !== 'bill') continue;
    const k = chargeKey(c.source);
    if (seen.has(k)) return `${c.label}: the same charge is listed twice.`;
    seen.add(k);
    const cand = candidates.get(k);
    if (!cand) return `${c.label}: that bill line is not a non-stock charge any more (deleted, cancelled or a goods line).`;
    if (cand.usedBy) return `${c.label} is already spread by landed-cost voucher ${cand.usedBy}.`;
  }
  // A memo charge already typed as a target bill's own landed cost would count twice.
  for (const t of v.targets.filter((x) => x.kind === 'bill')) {
    const bill = ctx.purchases.find((p) => (p as { id?: string })?.id === t.id) as PurchaseRecord | undefined;
    for (const own of (bill as { landed_costs?: { label?: string; amount?: number }[] } | undefined)?.landed_costs ?? []) {
      const dup = charges.find((c) => c.source?.kind === 'memo' && low(c.label) === low(own.label) && Math.abs(n(c.amount) - n(own.amount)) < 0.005);
      if (dup) return `${dup.label} (₹${n(dup.amount)}) is already spread on bill ${bill?.bill_number ?? ''} as its own landed cost.`;
    }
  }
  return '';
}

/** Earliest receipt date among the targets (the period lock applies there too). */
export function earliestTargetDate(lines: readonly TargetLine[]): string {
  return lines.reduce((m, l) => (!m || (l.date && l.date < m) ? l.date : m), '');
}

/* ================================================================
   Storage
   ================================================================ */

export const loadLandedVouchers = (): LandedCostVoucher[] => getTable<LandedCostVoucher>(LCV_TABLE).filter((v) => v && typeof v.id === 'string');

export function newCharge(partial: Partial<LandedVoucherCharge> = {}): LandedVoucherCharge {
  return { id: generateId(), source: { kind: 'memo' }, label: '', amount: 0, ...partial };
}

const lockOf = (id: string, date: string, number?: string) => ({ id, issue_date: date, ...(number ? { invoice_number: number } : {}) });

export interface LandedContext {
  purchases: readonly unknown[];
  receipts: readonly ReceiptNote[];
  items: readonly LandedItem[];
}

export const landedVouchersDb = {
  all: loadLandedVouchers,
  nextNumber: (date?: string): string => nextSeriesNumberFor(LCV_PREFIX, date, loadLandedVouchers().map((v) => v.number)),

  /**
   * Insert / update (books.edit; period lock on the voucher date AND on the earliest target receipt date, since the
   * stock cost is restated from there; LCV series; audited as a purchase-side document).
   */
  save(input: Omit<LandedCostVoucher, 'id' | 'number' | 'allocation_snapshot'> & { id?: string; number?: string }, ctx: LandedContext): LandedCostVoucher {
    requireAccess('books.edit');
    const rows = loadLandedVouchers();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    const charges = input.charges.filter((c) => n(c.amount) > 0).map((c) => ({ ...c, id: c.id || generateId(), label: c.label.trim(), amount: round2(n(c.amount)) }));
    const err = validateLandedVoucher({ ...input, charges }, { ...ctx, vouchers: rows });
    if (err) throw new Error(err);
    const others = rows.filter((r) => r.id !== existing?.id);
    const lines = targetLines(input.targets, ctx.purchases, ctx.receipts, ctx.items, landedExtras(others, ctx.purchases, ctx.receipts, ctx.items));
    if (existing) {
      assertUnlocked(lockOf(existing.id, existing.date, existing.number), 'edit');
      const before = earliestTargetDate(targetLines(existing.targets, ctx.purchases, ctx.receipts, ctx.items));
      if (before) assertUnlocked(lockOf(existing.id, before), 'edit');
    }
    const number = existing && numberFitsFy(existing.number, input.date) ? existing.number : landedVouchersDb.nextNumber(input.date);
    const id = existing?.id ?? input.id ?? generateId();
    const state = assertUnlocked(lockOf(id, input.date, number), existing ? 'edit' : 'create');
    const earliest = earliestTargetDate(lines);
    if (earliest) assertUnlocked(lockOf(id, earliest), existing ? 'edit' : 'create');
    if (others.some((r) => r.number.toUpperCase() === number.toUpperCase())) throw new Error(`Voucher number ${number} is already used.`);
    const record: LandedCostVoucher = {
      ...existing, ...input, id, number, charges,
      allocation_snapshot: allocationRows({ charges, method: input.method }, lines),
      created_at: existing?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    withTablesRollback([LCV_TABLE, 'series_counters'], () => {
      setTable(LCV_TABLE, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
      recordSeries(number);
    });
    const total = round2(charges.reduce((s, c) => s + c.amount, 0));
    try {
      audit.record({
        entity: 'purchase', entity_id: id, action: existing ? 'update' : 'create', doc_number: number,
        summary: `${existing ? 'Edited' : 'Created'} landed-cost voucher ${number}: ₹${total} spread by ${record.method} over ${lines.length} goods line(s) of ${record.targets.length} document(s)${state === 'overridden' ? ' (period lock overridden)' : ''}`,
      });
    } catch {
      /* logging never breaks a save */
    }
    return record;
  },

  /** Delete (books.edit, period lock on its date and the earliest target date, audited); the stock costs go back. */
  remove(id: string, ctx: LandedContext): void {
    requireAccess('books.edit');
    const rows = loadLandedVouchers();
    const v = rows.find((r) => r.id === id);
    if (!v) return;
    const state = assertUnlocked(lockOf(v.id, v.date, v.number), 'delete');
    const earliest = earliestTargetDate(targetLines(v.targets, ctx.purchases, ctx.receipts, ctx.items));
    if (earliest) assertUnlocked(lockOf(v.id, earliest), 'delete');
    setTable(LCV_TABLE, rows.filter((r) => r.id !== id));
    try {
      audit.record({ entity: 'purchase', entity_id: id, action: 'delete', doc_number: v.number, summary: `Deleted landed-cost voucher ${v.number}${state === 'overridden' ? ' (period lock overridden)' : ''}` });
    } catch {
      /* logging never breaks a save */
    }
  },
};
