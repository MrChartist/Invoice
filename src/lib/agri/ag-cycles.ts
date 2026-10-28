/**
 * AG-A4 farmer payment cycles (pure). A cycle is a local-day period (`10day`: 1–10, 11–20, 21–end; `fortnight`: 1–15,
 * 16–end; `weekly` from `start_day`; `monthly`). Each farmer line: amount + bonus + carried − deductions = net; a net
 * never goes below zero — the excess carries to the next cycle as a farmer receivable (`carry_out`, then `carried`).
 * Feed / input deductions come from the farmer's unpaid invoices (the client linked by `ag.code`). The pooled posting
 * is in `ag-cycle-post.ts`. Working paper — verify with your CA (AG26, AG27).
 */
import type { AgCycleSettings, AgDeduction, FarmerCycle, FarmerCycleLine } from '../../types/agri-r12';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const day = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The cycle period that holds `date` (a local `YYYY-MM-DD`; never parsed as UTC). */
export function cyclePeriod(date: string, c: Pick<AgCycleSettings, 'length' | 'start_day'>): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number);
  const end = lastDay(y, m);
  if (c.length === 'monthly') return { from: day(y, m, 1), to: day(y, m, end) };
  if (c.length === 'fortnight') return d <= 15 ? { from: day(y, m, 1), to: day(y, m, 15) } : { from: day(y, m, 16), to: day(y, m, end) };
  if (c.length === '10day') return d <= 10 ? { from: day(y, m, 1), to: day(y, m, 10) } : d <= 20 ? { from: day(y, m, 11), to: day(y, m, 20) } : { from: day(y, m, 21), to: day(y, m, end) };
  // weekly: the 7 days from the last `start_day` (0 = Monday) on or before `date`
  const local = new Date(y, m - 1, d);
  const back = (local.getDay() + 6 - (c.start_day ?? 0) + 7) % 7;
  const from = new Date(y, m - 1, d - back);
  const to = new Date(y, m - 1, d - back + 6);
  const iso = (x: Date) => day(x.getFullYear(), x.getMonth() + 1, x.getDate());
  return { from: iso(from), to: iso(to) };
}

/** A line's raw net (may be negative) and its paid net / carry-out. */
export function lineNet(l: Pick<FarmerCycleLine, 'amount' | 'bonus' | 'carried' | 'deductions'>): { raw: number; net: number; carry_out: number } {
  const raw = round2(num(l.amount) + num(l.bonus) + num(l.carried) - l.deductions.reduce((s, d) => s + num(d.amount), 0));
  return { raw, net: Math.max(raw, 0), carry_out: Math.min(raw, 0) };
}

/** Lines with `net` / `carry_out` recomputed. */
export const settleLines = (lines: readonly FarmerCycleLine[]): FarmerCycleLine[] =>
  lines.map((l) => {
    const n = lineNet(l);
    const { carry_out: _c, ...rest } = l;
    void _c;
    return { ...rest, net: n.net, ...(n.carry_out < 0 ? { carry_out: n.carry_out } : {}) };
  });

export interface CycleTotals { gross: number; bonus: number; carried: number; deductions: number; byKind: Partial<Record<AgDeduction['kind'], number>>; net: number; bank: number; cash: number; carryOut: number }

export function cycleTotals(c: Pick<FarmerCycle, 'lines'>): CycleTotals {
  const t: CycleTotals = { gross: 0, bonus: 0, carried: 0, deductions: 0, byKind: {}, net: 0, bank: 0, cash: 0, carryOut: 0 };
  for (const l of settleLines(c.lines)) {
    t.gross += num(l.amount);
    t.bonus += num(l.bonus);
    t.carried += num(l.carried);
    for (const d of l.deductions) {
      t.deductions += num(d.amount);
      t.byKind[d.kind] = round2((t.byKind[d.kind] ?? 0) + num(d.amount));
    }
    t.net += l.net;
    t[l.mode === 'bank' ? 'bank' : 'cash'] += l.net;
    t.carryOut += num(l.carry_out);
  }
  for (const k of ['gross', 'bonus', 'carried', 'deductions', 'net', 'bank', 'cash', 'carryOut'] as const) t[k] = round2(t[k]);
  return t;
}

/** Carried in for each farmer: the `carry_out` of his line in the centre's latest closed cycle before `from`. */
export function carriedIn(cycles: readonly FarmerCycle[], centreId: string | undefined, from: string): Map<string, number> {
  const prev = cycles.filter((c) => c.status !== 'draft' && (c.centre_id ?? '') === (centreId ?? '') && c.period_to < from).sort((a, b) => b.period_to.localeCompare(a.period_to))[0];
  return new Map((prev?.lines ?? []).filter((l) => num(l.carry_out) < 0).map((l) => [l.farmer_id, round2(num(l.carry_out))]));
}

/**
 * Feed / input deductions of a farmer: his unpaid invoices (to the client with the same `ag.code`), up to `cap` (the
 * money due to him this cycle) — oldest first. Lines of cattle feed make it `feed`, else `input`.
 */
export function inputDeductions(code: string, clients: readonly Client[], invoices: readonly InvoiceRecord[], payments: readonly Payment[], cap: number): AgDeduction[] {
  const ids = new Set(clients.filter((c) => c.id && c.ag?.code?.toUpperCase() === code.toUpperCase()).map((c) => c.id!));
  if (!ids.size) return [];
  const paid = new Map<string, number>();
  for (const p of payments) paid.set(p.invoice_id, round2((paid.get(p.invoice_id) ?? 0) + num(p.amount)));
  const out: AgDeduction[] = [];
  let left = round2(Math.max(num(cap), 0));
  for (const inv of [...invoices].filter((i) => ids.has(i.client?.id ?? '') && i.status !== 'Cancelled' && i.status !== 'Draft' && (i.doc_type === 'INVOICE' || i.doc_type === 'TAX_INVOICE' || i.doc_type === 'BILL_OF_SUPPLY')).sort((a, b) => a.issue_date.localeCompare(b.issue_date))) {
    const open = round2(num(inv.total) - (paid.get(inv.id) ?? 0));
    if (!(open > 0) || !(left > 0)) continue;
    const amount = round2(Math.min(open, left));
    left = round2(left - amount);
    out.push({ kind: (inv.items ?? []).some((i) => i.ag_class === 'cattle_feed') ? 'feed' : 'input', ref_id: inv.id, amount, note: inv.invoice_number });
  }
  return out;
}

/** The bonus / price-difference run (year-end): ₹ per unit on each farmer's quantity in the cycles given. Never posted. */
export function bonusRun(cycles: readonly FarmerCycle[], perUnit: number): { farmer_id: string; name?: string; qty: number; amount: number }[] {
  const by = new Map<string, { farmer_id: string; name?: string; qty: number; amount: number }>();
  for (const c of cycles) if (c.status !== 'draft') for (const l of c.lines) {
    const row = by.get(l.farmer_id) ?? { farmer_id: l.farmer_id, name: l.name, qty: 0, amount: 0 };
    row.qty = Math.round((row.qty + num(l.qty)) * 1000) / 1000;
    row.amount = round2(row.qty * num(perUnit));
    by.set(l.farmer_id, row);
  }
  return [...by.values()];
}
