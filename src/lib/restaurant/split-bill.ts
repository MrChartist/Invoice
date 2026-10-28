/**
 * Split bill (R3-A3). Pure (the records are built with the POS builder; nothing is saved here).
 *
 *  - Equal (n) and Custom amounts: ONE invoice with n payer rows; each row is settled as a tender on
 *    its own (a partial settlement keeps the order open). No extra tax documents.
 *  - By item and By seat: one invoice per part, each with its own GST computation (`calculateInvoice`
 *    through `buildSettleRecord`), numbered consecutively in the POS series when saved together.
 *  - A line can be split across parts by quantity (1 of 3 naan). Fractional quantities only for items
 *    sold by weight; otherwise the part gets a "share" line — same name, HSN and GST rate, quantity 1,
 *    rate = its share of the line amount. An add-on follows its parent by quantity only when its own
 *    pieces are whole; else it becomes share lines too (QA5-2 F17).
 *  - Share amounts are chosen in steps whose GST (and CGST / SGST halves, and cess) is exact in paise,
 *    with the last share taking the remainder, so the sub-bills' tax adds up to the unsplit tax. Any
 *    paisa that still differs (charges, odd rates) is shown on the reconciliation strip and ends in the
 *    bills' round-off — tax is never adjusted.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { OrderLine, PayerRow, TableOrder } from '../../types/restaurant';
import { num, round2 } from '../invoice-calc';
import { invoiceItemsOf } from './tables';

const paise = (n: number) => Math.round(num(n) * 100);
const rupees = (p: number) => round2(p / 100);

/* ── Equal / custom ──────────────────────────────────────────── */

/** `total` in `n` equal payer rows; the paisa left over goes to the first rows (1,001 / 3 → 333.67, 333.67, 333.66). */
export function equalPayers(total: number, n: number): PayerRow[] {
  const parts = Math.max(Math.floor(num(n)), 1);
  const t = paise(total);
  const base = Math.floor(t / parts);
  let rest = t - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    return { amount: rupees(base + extra) };
  });
}

/** Errors for custom payer amounts against the bill total (empty = they add up). */
export function customPayerErrors(total: number, amounts: readonly number[]): string[] {
  if (!amounts.length) return ['Add at least one payer.'];
  if (amounts.some((a) => !(num(a) > 0))) return ['Every payer needs an amount above zero.'];
  const sum = amounts.reduce((s, a) => s + paise(a), 0);
  const diff = paise(total) - sum;
  if (diff !== 0) return [`The payers add up to ₹${rupees(sum).toFixed(2)}; the bill is ₹${round2(total).toFixed(2)} (${diff > 0 ? 'short' : 'over'} by ₹${rupees(Math.abs(diff)).toFixed(2)}).`];
  return [];
}

export const payersPaid = (payers: readonly PayerRow[] | undefined): boolean => !!payers?.length && payers.every((p) => p.paid);
export const payersDue = (payers: readonly PayerRow[] | undefined): number => round2((payers ?? []).filter((p) => !p.paid).reduce((s, p) => s + num(p.amount), 0));

/* ── Item / seat parts ───────────────────────────────────────── */

/** One allocation of a line (or part of it) to a part (1-based). */
export interface PartPick {
  line_id: string;
  part: number;
  /** Units of the line for this part; the whole line when absent. */
  qty?: number;
}

/** Default by-seat allocation: each line to its seat (no seat → part 1); children follow the parent. */
export function seatPicks(lines: readonly OrderLine[]): { picks: PartPick[]; parts: number } {
  const seats = [...new Set(lines.filter((l) => !l.modifier_of).map((l) => l.seat ?? 0))].sort((a, b) => a - b);
  const partOf = new Map(seats.map((s, i) => [s, i + 1]));
  const picks = lines.filter((l) => !l.modifier_of).map((l) => ({ line_id: l.id, part: partOf.get(l.seat ?? 0) ?? 1 }));
  return { picks, parts: Math.max(seats.length, 1) };
}

/**
 * Smallest share step (paise) for which the line's GST at `rate`, its CGST / SGST halves and its cess
 * are exact paise (exclusive pricing: on the amount; inclusive: the amount includes them).
 */
export function shareStep(rate: number, cessRate = 0, inclusive = false): number {
  const r = Math.max(num(rate), 0);
  const c = Math.max(num(cessRate), 0);
  if (r === 0 && c === 0) return 1;
  const exact = (x: number) => Math.abs(x - Math.round(x)) < 1e-7;
  for (let k = 1; k <= 100000; k++) {
    const taxable = inclusive ? (k * 100) / (100 + r + c) : k;
    if (!exact(taxable)) continue;
    const tax = (taxable * r) / 100;
    const cess = (taxable * c) / 100;
    if (exact(tax) && Math.round(tax) % 2 === 0 && exact(cess)) return k;
  }
  return 1;
}

/** Split a value (paise) into weights: steps of `step` for all but the last, the last takes the rest. */
export function allocate(totalPaise: number, weights: readonly number[], step = 1): number[] {
  const sumW = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (!weights.length || sumW <= 0) return weights.map(() => 0);
  const out: number[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) {
      out.push(totalPaise - used);
      return;
    }
    const raw = (totalPaise * Math.max(w, 0)) / sumW;
    let v = Math.round(raw / step) * step;
    if (used + v > totalPaise) v = Math.max(totalPaise - used, 0);
    out.push(v);
    used += v;
  });
  return out;
}

const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

/**
 * Lines of each part. Whole-line picks keep the line; a quantity pick keeps a quantity line when the
 * quantity is whole (or the item is sold by weight), else becomes a share line. Modifier children follow
 * their parent in the same proportion. Unpicked lines go to part 1.
 */
export function partLines(order: Pick<TableOrder, 'lines'>, picks: readonly PartPick[], parts: number, inclusive = false): InvoiceItem[][] {
  const out: OrderLine[][] = Array.from({ length: Math.max(parts, 1) }, () => []);
  const parents = order.lines.filter((l) => !l.modifier_of);
  for (const line of parents) {
    const mine = picks.filter((p) => p.line_id === line.id && p.part >= 1 && p.part <= out.length);
    const family = [line, ...order.lines.filter((l) => l.modifier_of === line.id)];
    if (!mine.length) {
      out[0].push(...family);
      continue;
    }
    const total = num(line.quantity);
    const qtys = mine.map((p) => (p.qty === undefined ? total / mine.length : Math.max(num(p.qty), 0)));
    const sumQ = qtys.reduce((s, q) => s + q, 0);
    if (mine.length === 1 && Math.abs(qtys[0] - total) < 1e-9) {
      out[mine[0].part - 1].push(...family);
      continue;
    }
    // Every split piece of the family: by quantity when allowed, else by share of the amount.
    const byQty = qtys.every((q) => line.sold_by_weight || isWhole(q)) && Math.abs(sumQ - total) < 1e-9;
    for (const member of family) {
      const value = paise(num(member.quantity) * num(member.rate) * (1 - num(member.discount_percent) / 100));
      const ratio = num(member.quantity) / (total || 1);
      // QA5-2 F17: an add-on with its own quantity (1 butter on 3 naan) would split into 0.33 pieces that
      // lose paise: it takes the share-line path unless its pieces are whole (or it is sold by weight).
      const memberByQty = byQty && (member === line || !!member.sold_by_weight || qtys.every((q) => isWhole(q * ratio)));
      if (memberByQty) {
        mine.forEach((p, i) => {
          const q = round2(qtys[i] * ratio);
          if (q > 0) out[p.part - 1].push({ ...member, id: `${member.id}~${p.part}`, ...(member.modifier_of ? { modifier_of: `${member.modifier_of}~${p.part}` } : {}), quantity: q, amount: round2(q * num(member.rate)) });
        });
      } else {
        const step = shareStep(num(member.tax_rate), num(member.cess_rate), inclusive);
        const shares = allocate(value, qtys, step);
        mine.forEach((p, i) => {
          if (shares[i] <= 0) return;
          const amt = rupees(shares[i]);
          const share: OrderLine = {
            ...member,
            id: `${member.id}~${p.part}`,
            quantity: 1,
            rate: amt,
            amount: amt,
            note: [member.note, `Share ${i + 1} of ${mine.length}`].filter(Boolean).join(' · '),
          };
          delete share.discount_percent;
          delete share.cess_per_unit;
          delete share.unit_factor;
          if (member.modifier_of) share.modifier_of = `${member.modifier_of}~${p.part}`;
          out[p.part - 1].push(share);
        });
      }
    }
  }
  return out.map((lines) => invoiceItemsOf(lines));
}

/* ── Reconciliation strip ────────────────────────────────────── */

export interface ReconRow {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
}

export interface Reconciliation {
  parts: ReconRow;
  whole: ReconRow;
  /** parts − whole per head. */
  diff: ReconRow;
  /** Tax heads agree to the paisa. */
  taxExact: boolean;
  /** Total GST + cess agrees to the paisa (CGST / SGST halves may swap a paisa from per-line rounding). */
  taxTotalExact: boolean;
}

const row = (r: Pick<InvoiceRecord, 'taxable_value' | 'cgst_amount' | 'sgst_amount' | 'igst_amount' | 'cess_amount' | 'total'>): ReconRow => ({
  taxable: num(r.taxable_value), cgst: num(r.cgst_amount), sgst: num(r.sgst_amount), igst: num(r.igst_amount), cess: num(r.cess_amount), total: num(r.total),
});

export function reconcile(parts: readonly InvoiceRecord[], whole: InvoiceRecord): Reconciliation {
  const sum: ReconRow = { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0 };
  for (const p of parts) {
    const r = row(p);
    for (const k of Object.keys(sum) as (keyof ReconRow)[]) sum[k] = round2(sum[k] + r[k]);
  }
  const w = row(whole);
  const diff = Object.fromEntries((Object.keys(sum) as (keyof ReconRow)[]).map((k) => [k, round2(sum[k] - w[k])])) as unknown as ReconRow;
  return {
    parts: sum, whole: w, diff,
    taxExact: diff.cgst === 0 && diff.sgst === 0 && diff.igst === 0 && diff.cess === 0,
    taxTotalExact: round2(diff.cgst + diff.sgst + diff.igst + diff.cess) === 0,
  };
}
