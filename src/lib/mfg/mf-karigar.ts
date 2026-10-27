/**
 * MF-C4 karigars: piece-rate workers who are NOT on payroll are vendors with `Vendor.mf.karigar` (kind home / floor /
 * fabricator, a rate card by operation and style from a date). Employees paid by the piece stay in payroll (A3 job
 * cards → the `production` pay head) and are never karigars. Pieces for a period come from:
 *  - job-card entries whose operator is the karigar (A3; rejects deducted when the setting says so),
 *  - bundle coupons recorded against him without a job-card entry (C2),
 *  - CMT Material In from him (C3: good stitched pieces).
 * The ledger reads his piece bills through `readPurchase` (billed, TDS, paid) and his advances from the vouchers.
 * Pure, except the live readers at the end. Working paper — verify with your CA (MF28).
 */
import type { Vendor } from '../../types/purchases';
import type { MaterialIn } from '../../types/job-work';
import { num, round2 } from '../invoice-calc';
import { readPurchase, supplierPayable } from '../purchase-normalize';
import { cmtPieces, cmtTag } from './mf-cmt';
import type { CutPlan, MfKarigar, MfPieceLine } from './mf-c-pending';

export const ADVANCE_LEDGER = 'Karigar advances';
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
const inRange = (d: string, p: { from: string; to: string }) => d >= p.from && d <= p.to;

export function karigarOf(v: unknown): MfKarigar | undefined {
  const k = (v as { mf?: { karigar?: unknown } } | undefined)?.mf?.karigar;
  return k && typeof k === 'object' && Array.isArray((k as MfKarigar).rates) ? (k as MfKarigar) : undefined;
}
export const karigars = (vendors: readonly Vendor[]): Vendor[] => vendors.filter((v) => karigarOf(v)).sort((a, b) => a.name.localeCompare(b.name));

/** The rate for an operation (id or name) and style on `date`: a style row wins over a general one; the latest `from`. */
export function rateFor(k: MfKarigar | undefined, op: { id?: string; name?: string }, styleId: string | undefined, date: string): number | null {
  const rows = (k?.rates ?? []).filter((r) => r.from <= date && (norm(r.op) === norm(op.id) || norm(r.op) === norm(op.name)) && (!r.style_id || r.style_id === styleId));
  rows.sort((a, b) => Number(!!b.style_id) - Number(!!a.style_id) || b.from.localeCompare(a.from));
  return rows.length ? num(rows[0].rate) : null;
}

/** Minimal shape of an A3 job card read here. */
export interface JobCardLike {
  order_id: string;
  op_id: string;
  entries: { id: string; date: string; operator?: { kind: string; id: string }; good: number; rejected: number }[];
}

export interface PieceSources {
  jobCards?: readonly JobCardLike[];
  /** Operation name of an order's operation, and the order's style (item) id. */
  opName?: (orderId: string, opId: string) => string;
  styleOfOrder?: (orderId: string) => string | undefined;
  plans?: readonly CutPlan[];
  cmtIns?: readonly MaterialIn[];
  /** Process name of a Material In (its order's process), default "Stitching". */
  processOf?: (m: MaterialIn) => string;
}

/**
 * The pieces a karigar did in a period, one line per operation and style, priced from his rate card (rate 0 when the
 * card has no row — the bill shows it). `deduct` = pieces rejected for his fault come off (job cards, bundles).
 */
export function pieceLines(vendorId: string, k: MfKarigar | undefined, period: { from: string; to: string }, s: PieceSources): MfPieceLine[] {
  const deduct = k?.deduct_rejects !== false;
  const by = new Map<string, MfPieceLine & { opId?: string }>();
  const add = (op: string, opId: string | undefined, style: string | undefined, pieces: number, source: MfPieceLine['source'], ref: string, date: string) => {
    if (!pieces) return;
    const key = `${norm(op)}|${style ?? ''}|${source}`;
    const l = by.get(key) ?? { op, ...(opId ? { opId } : {}), ...(style ? { style } : {}), pieces: 0, rate: rateFor(k, { id: opId, name: op }, style, date) ?? 0, amount: 0, source, refs: [] };
    l.pieces += pieces;
    if (!l.refs!.includes(ref)) l.refs!.push(ref);
    by.set(key, l);
  };
  const usedEntries = new Set<string>();
  for (const c of s.jobCards ?? []) {
    for (const e of c.entries ?? []) {
      if (e.operator?.kind !== 'karigar' || e.operator.id !== vendorId || !inRange(e.date, period)) continue;
      usedEntries.add(e.id);
      add(s.opName?.(c.order_id, c.op_id) ?? c.op_id, c.op_id, s.styleOfOrder?.(c.order_id), num(e.good) + (deduct ? 0 : num(e.rejected)), 'jobcard', e.id, e.date);
    }
  }
  for (const p of s.plans ?? []) {
    for (const b of p.bundles ?? []) {
      for (const h of b.history) {
        if (h.by !== vendorId || !inRange(h.date, period) || (h.jc_entry_id && usedEntries.has(h.jc_entry_id))) continue;
        add(h.op ?? h.op_id ?? 'Operation', h.op_id, p.style_id, num(h.good) + (deduct ? 0 : num(h.rejected)), 'bundle', `${p.number}/${b.no}`, h.date);
      }
    }
  }
  for (const m of s.cmtIns ?? []) {
    if (m.vendor_id !== vendorId || !inRange(m.date, period)) continue;
    const pcs = cmtPieces(m.received);
    if (!pcs) continue;
    const lot = (m.received ?? []).map((l) => cmtTag(l)?.lot).find(Boolean);
    const style = (s.plans ?? []).find((p) => p.number === lot)?.style_id;
    add(s.processOf?.(m) || 'Stitching', undefined, style, pcs, 'cmt', m.number, m.date);
  }
  return [...by.values()].map(({ opId: _o, ...l }) => (void _o, { ...l, amount: round2(l.pieces * l.rate) }));
}

export interface KarigarBalance {
  billed: number;
  tds: number;
  /** What the bills still owe him (after TDS on the bill and payments / set-offs recorded on them). */
  payable: number;
  advance: number;
}

/** His piece bills (`purchases`, read through `readPurchase`) and the advances outstanding (vouchers on the advance ledger). */
export function karigarBalance(vendor: Pick<Vendor, 'id' | 'name'>, purchases: readonly unknown[], advanceVouchers: readonly { lines: { account_id: string; dr: number; cr: number; party?: string }[] }[], advanceAccountId?: string): KarigarBalance {
  let billed = 0;
  let tds = 0;
  let payable = 0;
  for (const raw of purchases) {
    const c = readPurchase(raw);
    if (!c || c.status === 'void' || (raw as { vendor_id?: string }).vendor_id !== vendor.id) continue;
    billed += c.total;
    tds += c.tdsAmount;
    payable += Math.max(supplierPayable(raw) - c.paid, 0);
  }
  let adv = 0;
  if (advanceAccountId) for (const v of advanceVouchers) for (const l of v.lines) if (l.account_id === advanceAccountId && norm(l.party) === norm(vendor.name)) adv += (num(l.dr) - num(l.cr)) / 100;
  return { billed: round2(billed), tds: round2(tds), payable: round2(payable), advance: round2(Math.max(adv, 0)) };
}
