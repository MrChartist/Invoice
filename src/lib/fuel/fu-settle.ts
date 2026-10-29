/**
 * R21-B2 attendant settlement (pure). Per attendant: expected = the value of their nozzles' litres − what POS bills
 * from those nozzles in the shift already billed; collections are typed by mode (cash, UPI, card, fleet card, OMC
 * loyalty, credit slips); short / excess = collected − expected. The counter litres (meter litres on no POS bill or
 * credit slip) are what the day close bills. A shortage is settled later by a cash receipt from the attendant or a
 * write-off row ("Shortage at pump", no cash — `movedNoCash`); an excess is taken off the attendant's collections
 * (cash first) and shown as a note — "Excess at pump" is other income, posted in Books (journal cut at the cap). Working papers — verify with your CA (FU10, FU29).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { FuCollection, FuelShift, FuelSlip } from '../../types/fuel-r21';
import { round2 } from '../invoice-calc';
import type { FuNozzleSale } from './fu-shift';
import { momentOf } from './fu-shift';
import { fbT } from '../../i18n/areas/fuel-r21b';

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const MODES = ['cash', 'upi', 'card', 'fleet', 'loyalty', 'credit'] as const;
export type FuMode = FuCollection['mode'];
type Billed = Map<string, { litres: number; amount: number }>;

const add = (m: Billed, id: string | undefined, litres: number, amount: number) => {
  if (!id) return;
  const b = m.get(id) ?? { litres: 0, amount: 0 };
  m.set(id, { litres: r3(b.litres + litres), amount: round2(b.amount + amount) });
};

/** Litres / ₹ per nozzle already on POS bills made during the shift (`pos`) and on its credit slips (`slips`). */
export function billedInShift(s: FuelShift, invoices: readonly InvoiceRecord[], slips: readonly FuelSlip[] = []): { pos: Billed; slips: Billed } {
  const pos: Billed = new Map();
  const sl: Billed = new Map();
  const to = s.closed_at ?? '9999';
  for (const inv of invoices) {
    if (inv.status === 'Cancelled' || inv.fu?.shift_id || !inv.fu?.lines || inv.fu.slip_ids?.length) continue;
    const at = inv.created_at ? momentOf(new Date(inv.created_at)) : `${inv.issue_date} 00:00`;
    if (at < s.opened_at || at >= to) continue;
    for (const it of inv.items) { const l = inv.fu.lines[it.id]; if (l) add(pos, l.nozzle_id, l.litres, Number(it.amount) || 0); }
  }
  for (const x of slips) if (x.shift_id === s.id) add(sl, x.nozzle_id, x.litres, x.amount);
  return { pos, slips: sl };
}

export interface FuAttendantSettle { idx: number; name: string; value: number; billed: number; expected: number; slips: number; collected: number; byMode: Partial<Record<FuMode, number>>; diff: number }

/** Each attendant's expected amount, collections and short (−) / excess (+). */
export function settleShift(s: FuelShift, sales: readonly FuNozzleSale[], billed: ReturnType<typeof billedInShift>): FuAttendantSettle[] {
  return s.attendants.map((a, idx) => {
    const mine = sales.filter((x) => a.nozzle_ids.includes(x.nozzle_id));
    const value = round2(mine.reduce((v, x) => v + x.value, 0));
    const bill = round2(mine.reduce((v, x) => v + (billed.pos.get(x.nozzle_id)?.amount ?? 0), 0));
    const slips = round2(mine.reduce((v, x) => v + (billed.slips.get(x.nozzle_id)?.amount ?? 0), 0));
    const byMode: Partial<Record<FuMode, number>> = {};
    for (const c of s.collections) if (c.attendant === idx) byMode[c.mode] = round2((byMode[c.mode] ?? 0) + c.amount);
    const collected = round2(Object.values(byMode).reduce((v, x) => v + (x ?? 0), 0));
    const expected = round2(value - bill);
    return { idx, name: a.name ?? a.employee_id ?? '', value, billed: bill, expected, slips, collected, byMode, diff: round2(collected - expected) };
  });
}

export interface FuCounterLine { item_id: string; tank_id: string; price_id: string; rsp: number; litres: number; amount: number; nozzles: string[] }

/**
 * Counter litres / ₹ per tank × product × price row: meter sales less POS bills and slips (refused when bills exceed
 * the meter). A nozzle's billed litres / ₹ come off its price segments in proportion to their litres, so each line keeps
 * the price row it was sold at — the day-close bill's `fu.lines` (Rule 42 duty working, 3.1(e) check; QA25 W3).
 */
export function counterLines(sales: readonly FuNozzleSale[], billed: ReturnType<typeof billedInShift>): FuCounterLine[] {
  const out = new Map<string, FuCounterLine>();
  for (const x of sales) {
    const p = billed.pos.get(x.nozzle_id);
    const q = billed.slips.get(x.nozzle_id);
    const bl = (p?.litres ?? 0) + (q?.litres ?? 0);
    const ba = (p?.amount ?? 0) + (q?.amount ?? 0);
    let restL = r3(x.litres - bl);
    if (restL < -0.0005) throw new Error(fbT('eOver', { n: x.nozzle_id }));
    let restA = round2(x.value - ba);
    x.segs.forEach((g, i) => {
      const last = i === x.segs.length - 1;
      const share = x.litres ? g.litres / x.litres : 0;
      const l = last ? restL : r3(g.litres - bl * share);
      const a = last ? restA : round2(g.litres * g.rsp - ba * share);
      restL = r3(restL - l);
      restA = round2(restA - a);
      const k = `${x.tank_id}|${x.item_id}|${g.price_id}`;
      const o = out.get(k) ?? { item_id: x.item_id, tank_id: x.tank_id, price_id: g.price_id, rsp: g.rsp, litres: 0, amount: 0, nozzles: [] };
      out.set(k, { ...o, litres: r3(o.litres + l), amount: round2(o.amount + a), nozzles: o.nozzles.includes(x.nozzle_id) ? o.nozzles : [...o.nozzles, x.nozzle_id] });
    });
  }
  return [...out.values()].filter((l) => l.litres > 0.0005 && l.amount > 0.004);
}

/** What the day close records: receipts by mode (credit slips excluded — D bills them) and the excess taken off each mode. */
export function postPlan(rows: readonly FuAttendantSettle[]): { pay: Partial<Record<FuMode, number>>; excess: Partial<Record<FuMode, number>> } {
  const pay: Partial<Record<FuMode, number>> = {};
  const excess: Partial<Record<FuMode, number>> = {};
  for (const a of rows) {
    let over = Math.max(0, a.diff);
    for (const m of MODES) {
      if (m === 'credit') continue;
      const v = a.byMode[m] ?? 0;
      const cut = round2(Math.min(v, over));
      over = round2(over - cut);
      if (cut > 0) excess[m] = round2((excess[m] ?? 0) + cut);
      if (v - cut > 0.004) pay[m] = round2((pay[m] ?? 0) + v - cut);
    }
  }
  return { pay, excess };
}
