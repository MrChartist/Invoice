/**
 * Tally import of inventory voucher QUANTITIES (ROADMAP 7.49). The accounting side of every voucher is
 * imported by `tally-import.ts` as a manual voucher; this module adds its item lines as `stock_moves`
 * where the stock item matches (existing item or one created by the same import), so stock summaries,
 * valuation and the report-time closing stock follow Tally. Never GST documents: nothing reaches the
 * invoice list, GSTR-1 / 3B or e-invoice.
 *
 *   Sales / Debit Note (purchase return) lines → stock out;  Purchase / Credit Note (sales return) → in;
 *   Stock Journal → INVENTORYENTRIESOUT out (consumed), INVENTORYENTRIESIN in (produced);
 *   any other line follows Tally's ISDEEMEDPOSITIVE (Yes = in).
 *
 * Re-import adds nothing: each move carries `ref_type: 'tally'` + `ref_id: <voucher tag>#<line>`.
 * Pure above "Apply". Working papers — verify with your CA.
 */
import type { StockItem, StockMove, MoveKind } from './inventory';
import { kids, textOf, type XmlNode } from './tally-xml-read';
import type { TallyBaseType, TallyVoucherRec } from './tally-import';

export interface TallyInvLine {
  item: string;
  /** Positive quantity (in the unit written by Tally). */
  qty: number;
  unit: string;
  direction: 'in' | 'out';
  /** Absolute value in paise (0 when Tally wrote none). */
  paise: number;
  godown?: string;
  batch?: string;
}

const yes = (s: string) => /^yes$/i.test(s.trim());

function qtyOf(text: string): { qty: number; unit: string } {
  const m = /(-?[\d,]*\.?\d+)\s*(.*)$/.exec(String(text ?? '').trim());
  if (!m) return { qty: 0, unit: '' };
  const q = Math.abs(Number(m[1].replace(/,/g, '')) || 0);
  return { qty: Number.isFinite(q) ? q : 0, unit: m[2].trim().slice(0, 20) };
}

function paiseOf(text: string): number {
  const t = String(text ?? '').trim();
  const eq = t.lastIndexOf('=');
  const digits = (eq >= 0 ? t.slice(eq + 1) : t).replace(/[^0-9.]/g, '');
  if (!digits || !/^\d*\.?\d*$/.test(digits)) return 0;
  return Math.round(Number(digits) * 100) || 0;
}

/** Item lines of a VOUCHER element (all four Tally inventory tags). */
export function readInventoryLines(v: XmlNode, base: TallyBaseType): TallyInvLine[] {
  const out: TallyInvLine[] = [];
  const take = (e: XmlNode, forced?: 'in' | 'out') => {
    const item = textOf(e, 'STOCKITEMNAME').slice(0, 200);
    const { qty, unit } = qtyOf(textOf(e, 'ACTUALQTY') || textOf(e, 'BILLEDQTY'));
    if (!item || !(qty > 0)) return;
    const deemed = textOf(e, 'ISDEEMEDPOSITIVE');
    const direction: 'in' | 'out' =
      forced ?? (deemed ? (yes(deemed) ? 'in' : 'out') : base === 'Sales' || base === 'Debit Note' ? 'out' : 'in');
    const batch = kids(e, 'BATCHALLOCATIONS.LIST')[0];
    const godown = textOf(batch, 'GODOWNNAME');
    const batchName = textOf(batch, 'BATCHNAME');
    out.push({
      item, qty, unit, direction, paise: paiseOf(textOf(e, 'AMOUNT')),
      ...(godown && !/^main location$/i.test(godown) ? { godown: godown.slice(0, 100) } : {}),
      ...(batchName && !/^primary batch$/i.test(batchName) ? { batch: batchName.slice(0, 60) } : {}),
    });
  };
  for (const tag of ['ALLINVENTORYENTRIES.LIST', 'INVENTORYENTRIES.LIST']) kids(v, tag).forEach((e) => take(e));
  kids(v, 'INVENTORYENTRIESOUT.LIST').forEach((e) => take(e, 'out'));
  kids(v, 'INVENTORYENTRIESIN.LIST').forEach((e) => take(e, 'in'));
  return out;
}

export type PlannedMoveStatus = 'ok' | 'no_item' | 'unit' | 'duplicate' | 'cancelled' | 'before_books' | 'locked';

export interface PlannedStockMove {
  /** `<voucher tag>#<line index>` — the move's `ref_id`. */
  ref: string;
  date: string;
  vtype: string;
  number: string;
  item: string;
  /** Signed quantity in the item's base unit (in > 0). */
  qty: number;
  rate: number;
  unit?: string;
  unit_factor?: number;
  godown?: string;
  batch?: string;
  kind: MoveKind;
  status: PlannedMoveStatus;
  reason?: string;
}

export interface StockPlanContext {
  /** Stock items in the books (name, aliases, unit, alternate units). */
  stockItems: ReadonlyArray<{ name: string; unit?: string; aliases?: string[]; alt_units?: ReadonlyArray<{ unit: string; factor: number }> }>;
  /** Items the same import creates (name → unit). */
  newItems?: ReadonlyArray<{ name: string; unit: string }>;
  /** `ref_id`s of Tally moves already in the books. */
  knownRefs?: ReadonlySet<string>;
  booksBegin: string;
  lockUntil: string;
}

const fold = (s: string | undefined) => (s ?? '').trim().toLowerCase();

function kindOf(base: TallyBaseType, direction: 'in' | 'out'): MoveKind {
  if (base === 'Sales') return 'sale';
  if (base === 'Purchase') return 'purchase';
  if (base === 'Credit Note' || base === 'Debit Note') return 'return';
  void direction; // stock journals and other vouchers read as adjustments in the stock ledger
  return 'adjustment';
}

/** Stock moves for every item line of the file's vouchers, with a status each (writes nothing). */
export function planTallyStockMoves(vouchers: readonly TallyVoucherRec[], ctx: StockPlanContext, tagOf: (v: TallyVoucherRec) => string): PlannedStockMove[] {
  const items = new Map<string, { unit: string; alt: ReadonlyArray<{ unit: string; factor: number }> }>();
  for (const s of ctx.stockItems) {
    const v = { unit: s.unit ?? '', alt: s.alt_units ?? [] };
    items.set(fold(s.name), v);
    for (const a of s.aliases ?? []) if (!items.has(fold(a))) items.set(fold(a), v);
  }
  for (const n of ctx.newItems ?? []) if (!items.has(fold(n.name))) items.set(fold(n.name), { unit: n.unit, alt: [] });
  const out: PlannedStockMove[] = [];
  const seen = new Set<string>();
  for (const v of vouchers) {
    const inv = v.inventory ?? [];
    if (!inv.length) continue;
    const tag = tagOf(v);
    inv.forEach((l, i) => {
      const ref = `${tag}#${i}`;
      const item = items.get(fold(l.item));
      const rate = l.qty > 0 && l.paise ? Math.round(l.paise / l.qty) / 100 : 0;
      const pm: PlannedStockMove = {
        ref, date: v.date, vtype: v.vtype, number: v.number, item: l.item,
        qty: l.direction === 'in' ? l.qty : -l.qty, rate,
        ...(l.godown ? { godown: l.godown } : {}), ...(l.batch ? { batch: l.batch } : {}),
        kind: kindOf(v.base, l.direction), status: 'ok',
      };
      const fail = (status: PlannedMoveStatus, reason: string) => {
        pm.status = status;
        pm.reason = reason;
      };
      if (v.cancelled || v.optional) fail('cancelled', v.cancelled ? 'Cancelled in Tally.' : 'Optional voucher in Tally.');
      else if (ctx.knownRefs?.has(ref) || seen.has(ref)) fail('duplicate', 'Already imported.');
      else if (v.date < ctx.booksBegin) fail('before_books', 'Before the books beginning: inside the opening quantity.');
      else if (ctx.lockUntil && v.date <= ctx.lockUntil) fail('locked', `Inside the locked period (up to ${ctx.lockUntil}).`);
      else if (!item) fail('no_item', `Stock item "${l.item}" is not in this file or your books.`);
      else if (l.unit && item.unit && fold(l.unit) !== fold(item.unit)) {
        const alt = item.alt.find((a) => fold(a.unit) === fold(l.unit));
        if (alt && alt.factor > 0) {
          pm.unit = alt.unit;
          pm.unit_factor = alt.factor;
        } else fail('unit', `Unit ${l.unit} differs from the item's unit ${item.unit}.`);
      }
      seen.add(ref);
      out.push(pm);
    });
  }
  return out;
}

/* ── Apply ────────────────────────────────────────────────────── */

export interface StockApplyDeps {
  items: () => StockItem[];
  godowns: () => ReadonlyArray<{ id: string; name: string }>;
  addMove: (m: StockMove) => void;
  newId: () => string;
}

/** Add the planned `ok` moves through `addMove` (period lock, role, audit). Refusals are returned. */
export function applyTallyStockMoves(planned: readonly PlannedStockMove[], deps: StockApplyDeps): { added: number; failed: string[] } {
  const ok = planned.filter((p) => p.status === 'ok');
  if (!ok.length) return { added: 0, failed: [] };
  const byName = new Map<string, StockItem>();
  for (const it of deps.items()) {
    byName.set(fold(it.name), it);
    for (const a of it.aliases ?? []) if (!byName.has(fold(a))) byName.set(fold(a), it);
  }
  const godownId = new Map(deps.godowns().map((g) => [fold(g.name), g.id]));
  let added = 0;
  const failed: string[] = [];
  for (const p of ok) {
    const item = byName.get(fold(p.item));
    if (!item) {
      failed.push(`Stock ${p.vtype} ${p.number} (${p.date}): item ${p.item} was not created`);
      continue;
    }
    const gid = p.godown ? godownId.get(fold(p.godown)) : undefined;
    try {
      deps.addMove({
        id: deps.newId(),
        item_id: item.id,
        date: p.date,
        qty: p.qty,
        rate: p.rate,
        kind: p.kind,
        ref_type: 'tally',
        ref_id: p.ref,
        note: `Tally ${p.vtype} ${p.number}`.trim(),
        ...(gid ? { godown_id: gid } : {}),
        ...(p.batch ? { batch_no: p.batch } : {}),
        ...(p.unit ? { unit: p.unit, unit_factor: p.unit_factor } : {}),
      });
      added++;
    } catch (err) {
      failed.push(`Stock ${p.vtype} ${p.number} (${p.date}): ${(err as Error).message}`);
    }
  }
  return { added, failed };
}
