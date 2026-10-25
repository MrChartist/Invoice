/**
 * Inventory reports Tally users expect (Phase 7), all derived from the stock ledger of each
 * position (`computeStock`), so they agree with the Stock Summary to the rupee:
 *  - Stock Summary drill-down: item → monthly movement for a financial year → vouchers of a month;
 *  - Movement Analysis: inward / outward quantity and value per party;
 *  - Stock Ageing: closing stock by receipt-date bucket (FIFO layers), and by batch;
 *  - Negative stock exceptions: when an item went below zero, how far, and what caused it.
 * Pure (no browser APIs).
 */

import { num, round2 } from './invoice-calc';
import type { LedgerRow, MoveKind, StockPosition } from './inventory';
import type { TrackingMap } from './stock-tracking';

const EPS = 1e-9;
const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

/* ── Drill-down: monthly movement ─────────────────────────────── */

export interface MonthRow {
  /** yyyy-mm */
  month: string;
  label: string;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
  vouchers: number;
}

export interface MonthlyMovement {
  openingQty: number;
  openingValue: number;
  months: MonthRow[];
}

/** Twelve months (April–March) of the financial year starting `fyStartYear`, with the FY opening. */
export function monthlyMovement(p: StockPosition, fyStartYear: number): MonthlyMovement {
  const start = `${fyStartYear}-04-01`;
  let qty = 0;
  let value = 0;
  for (const r of p.ledger) {
    if ((r.date || '0000') < start) {
      qty = r.balance;
      value = r.value;
    }
  }
  const opening = { openingQty: roundQty(qty), openingValue: round2(value) };
  const months: MonthRow[] = MONTHS.map((label, i) => {
    const y = i < 9 ? fyStartYear : fyStartYear + 1;
    const m = String(((i + 3) % 12) + 1).padStart(2, '0');
    return { month: `${y}-${m}`, label: `${label} ${y}`, inQty: 0, inValue: 0, outQty: 0, outValue: 0, closingQty: 0, closingValue: 0, vouchers: 0 };
  });
  const byMonth = new Map(months.map((m) => [m.month, m]));
  for (const r of p.ledger) {
    const row = r.date ? byMonth.get(r.date.slice(0, 7)) : undefined;
    if (!row) continue;
    row.inQty += r.qtyIn;
    row.inValue += r.qtyIn ? r.amount : 0;
    row.outQty += r.qtyOut;
    row.outValue += r.qtyOut ? r.amount : 0;
    row.vouchers++;
    row.closingQty = r.balance;
    row.closingValue = r.value;
  }
  // Months without movement carry the previous closing.
  let cq = opening.openingQty;
  let cv = opening.openingValue;
  for (const m of months) {
    if (m.vouchers === 0) {
      m.closingQty = cq;
      m.closingValue = cv;
    }
    cq = m.closingQty;
    cv = m.closingValue;
    m.inQty = roundQty(m.inQty);
    m.outQty = roundQty(m.outQty);
    m.inValue = round2(m.inValue);
    m.outValue = round2(m.outValue);
  }
  return { ...opening, months };
}

/** Ledger rows (vouchers) of one month, yyyy-mm. */
export function monthVouchers(p: StockPosition, month: string): LedgerRow[] {
  return p.ledger.filter((r) => r.date && r.date.startsWith(month));
}

/* ── Movement analysis by party ───────────────────────────────── */

const KIND_PARTY: Record<MoveKind, string> = {
  opening: 'Opening balance', sale: 'Sales (no party)', purchase: 'Purchases (no party)', adjustment: 'Stock adjustments',
  return: 'Sales returns', transfer: 'Godown transfers', consumption: 'Manufacturing', production: 'Manufacturing',
};

export interface PartyMovement {
  party: string;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
}

export interface ItemMovementAnalysis {
  position: StockPosition;
  inward: PartyMovement[];
  outward: PartyMovement[];
}

/** Inward / outward quantity and cost value per party for [from, to] (opening balances excluded). */
export function movementAnalysis(positions: readonly StockPosition[], from: string, to: string): ItemMovementAnalysis[] {
  const out: ItemMovementAnalysis[] = [];
  for (const p of positions) {
    if (!p.item.track_stock) continue;
    const parties = new Map<string, PartyMovement>();
    for (const r of p.ledger) {
      if (!r.date || r.date < from || r.date > to || r.kind === 'opening') continue;
      const name = r.party?.trim() || KIND_PARTY[r.kind];
      const m = parties.get(name) ?? { party: name, inQty: 0, inValue: 0, outQty: 0, outValue: 0 };
      if (r.qtyIn) {
        m.inQty += r.qtyIn;
        m.inValue += r.amount;
      } else {
        m.outQty += r.qtyOut;
        m.outValue += r.amount;
      }
      parties.set(name, m);
    }
    const list = [...parties.values()].map((m) => ({ ...m, inQty: roundQty(m.inQty), outQty: roundQty(m.outQty), inValue: round2(m.inValue), outValue: round2(m.outValue) }));
    if (list.length === 0) continue;
    out.push({
      position: p,
      inward: list.filter((m) => m.inQty > EPS).sort((a, b) => b.inValue - a.inValue),
      outward: list.filter((m) => m.outQty > EPS).sort((a, b) => b.outValue - a.outValue),
    });
  }
  return out.sort((a, b) => a.position.item.name.localeCompare(b.position.item.name));
}

/* ── Ageing ───────────────────────────────────────────────────── */

export const AGE_BUCKETS = [30, 60, 90, 180] as const;
export const AGE_LABELS = ['0–30 days', '31–60 days', '61–90 days', '91–180 days', 'Over 180 days'];

function dayNo(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
}

function bucketOf(age: number, buckets: readonly number[]): number {
  const i = buckets.findIndex((b) => age <= b);
  return i < 0 ? buckets.length : i;
}

export interface AgeingRow {
  position: StockPosition;
  qty: number[];
  value: number[];
  /** Oldest receipt date still in stock ('' = opening balance). */
  oldest: string;
}

/**
 * Closing stock split by age of receipt: receipts form FIFO layers and every issue uses the oldest
 * first (physical flow), whatever the costing method. Layer values are scaled to the item's closing
 * value so the total equals the Stock Summary. Opening stock counts from `openingDate` (or the oldest bucket).
 */
export function stockAgeing(positions: readonly StockPosition[], today: string, buckets: readonly number[] = AGE_BUCKETS, openingDate = ''): AgeingRow[] {
  const rows: AgeingRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock || p.qty <= EPS) continue;
    const layers: { date: string; qty: number; rate: number }[] = [];
    for (const r of p.ledger) {
      if (r.qtyIn > 0) layers.push({ date: r.date, qty: r.qtyIn, rate: r.rate });
      let rest = r.qtyOut;
      while (rest > EPS && layers.length) {
        const take = Math.min(rest, layers[0].qty);
        layers[0].qty -= take;
        rest -= take;
        if (layers[0].qty <= EPS) layers.shift();
      }
    }
    const qty = Array(buckets.length + 1).fill(0) as number[];
    const raw = Array(buckets.length + 1).fill(0) as number[];
    for (const l of layers) {
      const d = l.date || openingDate;
      const age = d ? dayNo(today) - dayNo(d) : Infinity;
      const b = bucketOf(Number.isFinite(age) ? Math.max(age, 0) : Infinity, buckets);
      qty[b] += l.qty;
      raw[b] += l.qty * l.rate;
    }
    const rawTotal = raw.reduce((s, v) => s + v, 0);
    const qtyTotal = qty.reduce((s, v) => s + v, 0);
    const value = raw.map((v, i) => round2(rawTotal > EPS ? (v / rawTotal) * p.value : qtyTotal > EPS ? (qty[i] / qtyTotal) * p.value : 0));
    rows.push({ position: p, qty: qty.map(roundQty), value, oldest: layers[0]?.date ?? '' });
  }
  return rows.sort((a, b) => a.position.item.name.localeCompare(b.position.item.name));
}

export interface BatchAgeRow {
  itemName: string;
  unit: string;
  batch: string;
  firstIn: string;
  expiry?: string;
  qty: number;
  age: number;
  bucket: number;
}

/** Batch-wise ageing (batch-tracked items): age from the first receipt of the batch. */
export function batchAgeing(tracking: TrackingMap, today: string, buckets: readonly number[] = AGE_BUCKETS): BatchAgeRow[] {
  const rows: BatchAgeRow[] = [];
  for (const t of tracking.values()) {
    if (!t.item.track_batches) continue;
    for (const b of t.batches) {
      if (!b.batch || b.qty <= EPS) continue;
      const age = b.firstIn ? Math.max(0, dayNo(today) - dayNo(b.firstIn)) : Infinity;
      rows.push({
        itemName: t.item.name, unit: t.item.unit, batch: b.batch, firstIn: b.firstIn, expiry: b.expiry, qty: roundQty(b.qty),
        age: Number.isFinite(age) ? age : -1, bucket: bucketOf(age, buckets),
      });
    }
  }
  return rows.sort((a, b) => b.age - a.age || a.itemName.localeCompare(b.itemName));
}

/* ── Negative stock exceptions ────────────────────────────────── */

export interface NegativeRow {
  position: StockPosition;
  /** Day the balance first went below zero, and the voucher that did it. */
  firstDate: string;
  firstRef: string;
  lowest: number;
  lowestDate: string;
  /** Separate spells below zero. */
  episodes: number;
  current: number;
}

/** Items whose running balance went below zero at any point (sold / consumed before receipt). */
export function negativeStockReport(positions: readonly StockPosition[]): NegativeRow[] {
  const rows: NegativeRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock) continue;
    let below = false;
    let row: NegativeRow | null = null;
    for (const r of p.ledger) {
      const neg = r.balance < -EPS;
      if (neg && !below) {
        row ??= { position: p, firstDate: r.date, firstRef: r.refNumber || r.particulars, lowest: r.balance, lowestDate: r.date, episodes: 0, current: p.qty };
        row.episodes++;
      }
      if (neg && row && r.balance < row.lowest) {
        row.lowest = r.balance;
        row.lowestDate = r.date;
      }
      below = neg;
    }
    if (row) rows.push({ ...row, lowest: roundQty(row.lowest), current: roundQty(num(p.qty)) });
  }
  return rows.sort((a, b) => a.lowest - b.lowest);
}
