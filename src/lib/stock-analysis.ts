/**
 * Stock depth reports (8.83 — BUSY / Marg "fast / slow / non-moving", "ABC analysis"). Derived from the
 * stock ledger of each position (`computeStock`), so they agree with the Stock Summary. Pure.
 *
 *  - Movement class for a period: outward = units issued by sales and consumption (manufacturing / stock
 *    journals) less sales returns. Turnover = cost of goods issued ÷ average stock value ((opening +
 *    closing) ÷ 2), annualised over the period length. Fast: turnover ≥ `fastTurns` a year (default 6);
 *    slow: some outward but below that; non-moving: no outward in the period (in stock or not).
 *  - ABC: items ranked by the cost of goods issued in the period; cumulative share up to `a`% (default 70)
 *    is class A (the item that crosses the line is still A), up to `b`% (default 90) is B, the rest C. Items
 *    with no issue in the period are C.
 */

import type { LedgerRow, StockPosition } from './inventory';
import { round2 } from './invoice-calc';

export type MoveClass = 'fast' | 'slow' | 'non';
export type AbcClass = 'A' | 'B' | 'C';

export interface MovingRow {
  itemId: string;
  name: string;
  unit: string;
  outQty: number;
  /** Cost of goods issued in the period. */
  outValue: number;
  openingValue: number;
  closingQty: number;
  closingValue: number;
  /** Annualised turnover (0 when the average stock is nil). */
  turnover: number;
  /** Days of stock at the period's rate of issue (null when nothing was issued). */
  daysCover: number | null;
  /** Last outward day ('' = never). */
  lastOut: string;
  cls: MoveClass;
}

const DAY = 86400000;
const dayNum = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY : NaN;
};
const isOut = (r: LedgerRow) => r.kind === 'sale' || r.kind === 'consumption';

/** Value of stock just before `from` (last running value of a row dated earlier). */
function valueBefore(rows: readonly LedgerRow[], from: string): number {
  let v = 0;
  for (const r of rows) {
    if (r.date >= from) break;
    v = r.value;
  }
  return v;
}
function stateAt(rows: readonly LedgerRow[], to: string): { qty: number; value: number } {
  let s = { qty: 0, value: 0 };
  for (const r of rows) {
    if (r.date > to) break;
    s = { qty: r.balance, value: r.value };
  }
  return s;
}

export function movingAnalysis(positions: readonly StockPosition[], period: { from: string; to: string }, fastTurns = 6): MovingRow[] {
  const days = Math.max(dayNum(period.to) - dayNum(period.from) + 1, 1);
  const rows: MovingRow[] = [];
  for (const p of positions) {
    if (!p.item.track_stock) continue;
    let outQty = 0;
    let outValue = 0;
    let lastOut = '';
    for (const r of p.ledger) {
      if (r.date < period.from || r.date > period.to) continue;
      if (isOut(r)) {
        outQty += r.qtyOut;
        outValue += r.amount;
        if (r.qtyOut > 0 && r.date > lastOut) lastOut = r.date;
      } else if (r.kind === 'return') {
        outQty -= r.qtyIn;
        outValue -= r.amount;
      }
    }
    outQty = Math.max(round2(outQty), 0);
    outValue = Math.max(round2(outValue), 0);
    const openingValue = round2(valueBefore(p.ledger, period.from));
    const closing = stateAt(p.ledger, period.to);
    const avg = (openingValue + closing.value) / 2;
    const turnover = avg > 0.005 ? round2((outValue / avg) * (365 / days)) : outValue > 0 ? Infinity : 0;
    const daysCover = outQty > 0 ? Math.round((closing.qty / outQty) * days) : null;
    const cls: MoveClass = outQty <= 0 ? 'non' : turnover >= fastTurns ? 'fast' : 'slow';
    rows.push({
      itemId: p.item.id, name: p.item.name, unit: p.item.unit, outQty, outValue, openingValue,
      closingQty: round2(closing.qty), closingValue: round2(closing.value), turnover: Number.isFinite(turnover) ? turnover : 999,
      daysCover, lastOut, cls,
    });
  }
  const order: Record<MoveClass, number> = { fast: 0, slow: 1, non: 2 };
  return rows.sort((a, b) => order[a.cls] - order[b.cls] || b.turnover - a.turnover || b.closingValue - a.closingValue || a.name.localeCompare(b.name));
}

export interface AbcRow {
  itemId: string;
  name: string;
  outValue: number;
  /** Share of the total issue value, %. */
  share: number;
  /** Cumulative share including this item, %. */
  cumulative: number;
  cls: AbcClass;
}

/** ABC classes from issue values (cut-offs in %, A ≤ a < B ≤ b < C). */
export function abcClasses(values: readonly { itemId: string; name: string; outValue: number }[], a = 70, b = 90): AbcRow[] {
  const sorted = [...values].sort((x, y) => y.outValue - x.outValue || x.name.localeCompare(y.name));
  const total = sorted.reduce((s, r) => s + Math.max(r.outValue, 0), 0);
  let before = 0;
  return sorted.map((r) => {
    const v = Math.max(r.outValue, 0);
    const share = total > 0 ? (v / total) * 100 : 0;
    const startedAt = before;
    before += share;
    const cls: AbcClass = v <= 0 ? 'C' : startedAt < a - 1e-9 ? 'A' : startedAt < b - 1e-9 ? 'B' : 'C';
    return { itemId: r.itemId, name: r.name, outValue: round2(v), share: round2(share), cumulative: round2(Math.min(before, 100)), cls };
  });
}

export function abcAnalysis(positions: readonly StockPosition[], period: { from: string; to: string }, a = 70, b = 90): AbcRow[] {
  return abcClasses(movingAnalysis(positions, period).map((r) => ({ itemId: r.itemId, name: r.name, outValue: r.outValue })), a, b);
}

/** Count and value per class (for the summary line). */
export function abcSummary(rows: readonly AbcRow[]): Record<AbcClass, { items: number; value: number }> {
  const out: Record<AbcClass, { items: number; value: number }> = { A: { items: 0, value: 0 }, B: { items: 0, value: 0 }, C: { items: 0, value: 0 } };
  for (const r of rows) {
    out[r.cls].items++;
    out[r.cls].value = round2(out[r.cls].value + r.outValue);
  }
  return out;
}
