/**
 * AG-B3 milk bills per cycle, on AG-A4's pooled cycle. `buildMilkCycle` reads the CLOSED shifts of a centre in the
 * period (not billed in another cycle) and makes one line per farmer: litres, kg fat, kg SNF, amount (chart add-ons
 * included — they are in each entry's rate), the shift-wise detail for his bill, carried-in balance and feed / input
 * deductions (A4). An unclosed shift in the period blocks the bill. `closeMilkCycle` closes through A4 (one exempt
 * pooled purchase — GSTR-3B Table 5) and marks that purchase `ag.stock_by_shift`: the milk already entered stock
 * shift by shift, so the stock reader skips the purchase's lines. Bills print from the cycle row only.
 */
import './ag-registry';
import type { FarmerCycle, FarmerCycleLine, MilkShift } from '../../types/agri-r12';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { getTable, setTable } from '../storage';
import { num, round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { esc } from '../voucher-print';
import { AG_TABLES } from './ag-shared';
import { carriedIn, inputDeductions, cycleTotals } from './ag-cycles';
import { closeCycle, loadCycles, saveCycleDraft } from './ag-cycle-post';
import { readAgriSettings } from './ag-settings';
import { loadShifts } from './ag-shifts';
import { clrOf, q3, solids, toL } from './ag-rate-chart';

export interface MilkCycleDraft { lines: FarmerCycleLine[]; unclosed: MilkShift[]; shiftIds: string[] }

/** Pure: the farmer lines of a centre's period from its shifts (closed ones only; unclosed are listed). */
export function buildMilkCycle(
  centreId: string, from: string, to: string,
  d: { shifts: readonly MilkShift[]; vendors: readonly Vendor[]; cycles?: readonly FarmerCycle[]; clients?: readonly Client[]; invoices?: readonly InvoiceRecord[]; payments?: readonly Payment[]; selfId?: string },
): MilkCycleDraft {
  const live = new Set((d.cycles ?? []).filter((c) => c.id !== d.selfId).map((c) => c.id));
  const inRange = d.shifts.filter((s) => s.centre_id === centreId && s.date >= from && s.date <= to && !(s.cycle_id && live.has(s.cycle_id)));
  const unclosed = inRange.filter((s) => !s.closed_at && s.entries.length);
  const closed = inRange.filter((s) => s.closed_at).sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
  const ms = readAgriSettings().milk;
  const by = new Map<string, FarmerCycleLine>();
  for (const s of closed) for (const e of s.entries) {
    if (e.rejected) continue;
    const v = d.vendors.find((x) => x.id === e.farmer_id);
    const l = by.get(e.farmer_id) ?? { farmer_id: e.farmer_id, name: v?.name ?? e.name, qty: 0, unit: 'L', kg_fat: 0, kg_snf: 0, amount: 0, deductions: [], net: 0, mode: v?.bank_account_no || v?.ag?.bank?.account ? 'bank' : 'cash', shifts: [] };
    const clr = num(e.clr) || clrOf(e.milk, ms, s.date);
    const sol = solids(e.qty, e.unit, e.fat, e.snf, clr);
    const litres = toL(e.qty, e.unit, clr);
    l.qty = q3(l.qty + litres);
    l.kg_fat = q3(num(l.kg_fat) + sol.kgFat);
    l.kg_snf = q3(num(l.kg_snf) + sol.kgSnf);
    l.amount = round2(l.amount + num(e.amount));
    l.shifts!.push({ date: s.date, shift: s.shift, qty: litres, fat: e.fat, snf: e.snf, rate: e.rate, amount: num(e.amount) });
    by.set(e.farmer_id, l);
  }
  const carry = carriedIn(d.cycles ?? [], centreId, from);
  const lines = [...by.values()].map((l) => {
    const carried = carry.get(l.farmer_id);
    const code = d.vendors.find((v) => v.id === l.farmer_id)?.ag?.code;
    const cap = round2(l.amount + num(carried));
    const deductions = code && d.clients && d.invoices ? inputDeductions(code, d.clients, d.invoices, d.payments ?? [], cap) : [];
    return { ...l, ...(carried ? { carried } : {}), deductions, net: Math.max(round2(cap - deductions.reduce((s, x) => s + x.amount, 0)), 0) };
  });
  return { lines: lines.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')), unclosed, shiftIds: closed.map((s) => s.id) };
}

const live = () => ({
  shifts: loadShifts(), vendors: getTable<Vendor>('vendors'), cycles: loadCycles(), clients: getTable<Client>('clients'),
  invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'),
});

/** Make (or remake) the draft milk cycle of a centre's period and tag its shifts. Blocked by an unclosed shift. */
export function makeMilkCycle(centreId: string, from: string, to: string, id?: string): FarmerCycle {
  const d = buildMilkCycle(centreId, from, to, { ...live(), selfId: id });
  if (d.unclosed.length) throw new Error(`Close these shifts first: ${d.unclosed.map((s) => `${s.date} ${s.shift}`).join(', ')}.`);
  if (!d.lines.length) throw new Error('No closed milk shifts in this period.');
  return withTablesRollback([AG_TABLES.cycles, AG_TABLES.shifts, 'series_counters'], () => {
    const c = saveCycleDraft({ ...(id ? { id } : {}), centre_id: centreId, period_from: from, period_to: to, source: 'milk', lines: d.lines });
    const ids = new Set(d.shiftIds);
    setTable(AG_TABLES.shifts, loadShifts().map((s) => (ids.has(s.id) ? { ...s, cycle_id: c.id } : s.cycle_id === c.id ? (({ cycle_id: _x, ...r }) => (void _x, r))(s) : s)));
    return c;
  });
}

/** Close a milk cycle through A4 and mark its pooled purchase `ag.stock_by_shift` (milk entered stock per shift). */
export function closeMilkCycle(id: string, centreName?: string): FarmerCycle {
  return withTablesRollback(['purchases'], () => {
    const c = closeCycle(id, centreName);
    if (c.purchase_id) setTable('purchases', getTable<PurchaseRecord>('purchases').map((p) => (p.id === c.purchase_id ? { ...p, ag: { ...p.ag, cycle_id: c.id, stock_by_shift: true } } : p)));
    return c;
  });
}

export interface CycleSummaryRow { key: string; litres: number; kgFat: number; amount: number; avgFat: number }
/** Cycle summary by farmer, village or route (from the cycle row), plus active farmers of the centre with no supply. */
export function cycleSummary(c: Pick<FarmerCycle, 'lines' | 'centre_id'>, vendors: readonly Vendor[], by: 'farmer' | 'village' | 'route'): { rows: CycleSummaryRow[]; noSupply: Vendor[] } {
  const m = new Map<string, CycleSummaryRow & { fq: number; q: number }>();
  for (const l of c.lines) {
    const v = vendors.find((x) => x.id === l.farmer_id);
    const key = by === 'farmer' ? l.name ?? v?.name ?? l.farmer_id : (by === 'village' ? v?.ag?.village : v?.ag?.route) || '—';
    const r = m.get(key) ?? { key, litres: 0, kgFat: 0, amount: 0, avgFat: 0, fq: 0, q: 0 };
    r.litres = q3(r.litres + l.qty);
    r.kgFat = q3(r.kgFat + num(l.kg_fat));
    r.amount = round2(r.amount + l.amount);
    for (const x of l.shifts ?? []) {
      r.fq += num(x.qty) * num(x.fat);
      r.q += num(x.qty);
    }
    m.set(key, r);
  }
  const rows = [...m.values()].map(({ fq, q, ...r }) => ({ ...r, avgFat: q > 0 ? round2(fq / q) : 0 })).sort((a, b) => b.avgFat - a.avgFat);
  const on = new Set(c.lines.map((l) => l.farmer_id));
  return { rows, noSupply: vendors.filter((v) => v.ag?.code && v.ag.status !== 'inactive' && (!c.centre_id || c.centre_id === 'main' || v.ag.centre_id === c.centre_id) && !on.has(v.id)) };
}

const f2 = (n: number) => num(n).toFixed(2);
/** Farmer milk bills (A5 pages, one per farmer) printed from the cycle row only — never recomputed. */
export function milkBillHtml(c: FarmerCycle, firm: string, only?: readonly string[]): string {
  const t = cycleTotals(c);
  const pages = c.lines.filter((l) => !only || only.includes(l.farmer_id)).map((l) => `<section><h2>${esc(firm)}</h2><p><b>Milk bill ${esc(c.number)}</b> · ${esc(c.period_from)} to ${esc(c.period_to)}<br>${esc(l.name ?? '')}</p>
<table><tr><th>Date</th><th>Shift</th><th>Litres</th><th>Fat %</th><th>SNF %</th><th>Rate</th><th>Amount</th></tr>${(l.shifts ?? []).map((s) => `<tr><td>${esc(s.date)}</td><td>${s.shift}</td><td>${s.qty.toFixed(3)}</td><td>${f2(num(s.fat))}</td><td>${f2(num(s.snf))}</td><td>${f2(num(s.rate))}</td><td>${f2(s.amount)}</td></tr>`).join('')}
<tr><th colspan="2">Total</th><th>${l.qty.toFixed(3)}</th><th colspan="2">kg fat ${num(l.kg_fat).toFixed(3)} · kg SNF ${num(l.kg_snf).toFixed(3)}</th><th></th><th>${f2(l.amount)}</th></tr>
${num(l.carried) ? `<tr><td colspan="6">Carried from the last cycle</td><td>${f2(num(l.carried))}</td></tr>` : ''}${l.deductions.map((x) => `<tr><td colspan="6">Less: ${esc(x.kind)}${x.note ? ` (${esc(x.note)})` : ''}</td><td>−${f2(x.amount)}</td></tr>`).join('')}
<tr><th colspan="6">Net payable (${l.mode === 'bank' ? 'bank' : 'cash'})</th><th>${f2(l.net)}</th></tr></table></section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.number)}</title><style>@page{size:A5;margin:10mm}body{font:12px sans-serif}section{page-break-after:always}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:2px 4px;text-align:right}td:first-child,th:first-child{text-align:left}h2{margin:0}</style></head><body>${pages}<p>Cycle total ₹${f2(t.gross)} · deductions ₹${f2(t.deductions)} · net ₹${f2(t.net)}</p></body></html>`;
}
