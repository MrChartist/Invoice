/**
 * AG-B2 shift collection (table `milk_shifts`): ONE row per centre per date per shift with an `entries` array — never a
 * row per farmer per shift (a 300-farmer centre makes 730 rows a year, not 219,000). Each entry stores the chart id,
 * rate and amount of its day, so a later chart never reprices it. A rejected can records the quantity with zero amount
 * and a reason; a second can of the same farmer in a shift is flagged (the caller confirms).
 *
 * Stock: closing a shift takes its ACCEPTED litres into the centre's godown at the shift's value — a stock journal
 * (`SJ/FY…`, production lines at a fixed rate, no ledger posting; `books.edit`). The ledger posting is the pooled cycle
 * purchase (A4 / B3), whose lines the stock reader skips (`ag.stock_by_shift`), so milk is never counted twice (AG28).
 * Reopening (audited) removes the journal through the recycle bin; a shift billed in a closed cycle cannot reopen.
 */
import './ag-registry';
import type { AgMilkSettings, FarmerCycle, MilkEntry, MilkKind, MilkRateChart, MilkShift, MilkShiftId, MilkUnit } from '../../types/agri-r12';
import type { StockJournal } from '../../types/manufacturing';
import { generateId, getTable, setTable } from '../storage';
import { currentActor, requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { audit } from '../audit';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { blankStockItem, stockDb } from '../inventory';
import { SJ_PREFIX, SJ_TABLE, stockJournalsDb } from '../manufacturing';
import { readAgriSettings } from './ag-settings';
import { AG_TABLES } from './ag-shared';
import { chartAt, chartRate, clrOf, q3, solids, toL } from './ag-rate-chart';

const T = AG_TABLES.shifts;
export const loadShifts = (): MilkShift[] => getTable<MilkShift>(T).filter((s) => s && typeof s.id === 'string');
/** The shift rows of one day (at most two per centre). */
export const shiftsOn = (all: readonly MilkShift[], date: string, centreId?: string): MilkShift[] => all.filter((s) => s.date === date && (!centreId || s.centre_id === centreId));
const put = (s: MilkShift) => setTable(T, [...loadShifts().filter((x) => x.id !== s.id), { ...s, updated_at: new Date().toISOString() }]);
const find = (id: string) => {
  const s = loadShifts().find((x) => x.id === id);
  if (!s) throw new Error('Shift not found.');
  return s;
};

export interface EntryInput { farmer_id: string; name?: string; code?: string; milk: MilkKind; qty: number; unit: MilkUnit; fat: number; snf: number; clr?: number; water_pct?: number; sample_only?: boolean; reject?: string }

/** Pure: an entry priced by the chart in force on the shift date (or rejected with a reason). */
export function priceEntry(e: EntryInput, ctx: { charts: readonly MilkRateChart[]; date: string; shift: MilkShiftId; centreId?: string; settings?: AgMilkSettings }): MilkEntry {
  if (!e.farmer_id) throw new Error('Pick the farmer.');
  if (!(num(e.qty) > 0)) throw new Error('Type the quantity.');
  const base: MilkEntry = {
    id: generateId(), farmer_id: e.farmer_id, ...(e.name ? { name: e.name } : {}), ...(e.code ? { code: e.code } : {}), milk: e.milk, qty: q3(e.qty), unit: e.unit,
    fat: round2(e.fat), snf: round2(e.snf), ...(num(e.clr) > 0 ? { clr: round2(num(e.clr)) } : {}), ...(e.water_pct !== undefined && num(e.water_pct) > 0 ? { water_pct: round2(num(e.water_pct)) } : {}),
    rate: 0, amount: 0, at: new Date().toISOString(), ...(e.sample_only ? { sample_only: true } : {}),
  };
  if (e.reject?.trim()) return { ...base, rejected: true, reason: e.reject.trim() };
  const chart = chartAt(ctx.charts, ctx.date, e.milk, { centreId: ctx.centreId });
  if (!chart) throw new Error(`No ${e.milk} milk rate chart in force on ${ctx.date}: add one in Rate charts.`);
  const r = chartRate(chart, { fat: e.fat, snf: e.snf, qty: e.qty, unit: e.unit, clr: num(e.clr) || clrOf(e.milk, ctx.settings, ctx.date), shift: ctx.shift, milk: e.milk });
  const priced = { ...base, chart_id: chart.id, rate: r.rate, amount: e.sample_only ? 0 : r.amount, ...(r.incentive ? { incentive: r.incentive } : {}) };
  return r.rejected ? { ...priced, rejected: true, reason: r.reason } : priced;
}

/** Entries of the same farmer already in the shift. */
export const duplicatesOf = (s: Pick<MilkShift, 'entries'> | undefined, farmerId: string): MilkEntry[] => (s?.entries ?? []).filter((e) => e.farmer_id === farmerId);

/** Add a can to the shift (created on its first entry). A second can of the farmer needs `allowDuplicate`. */
export function addEntry(key: { centre_id: string; date: string; shift: MilkShiftId }, e: EntryInput, opts: { allowDuplicate?: boolean } = {}): { shift: MilkShift; entry: MilkEntry } {
  requireAccess('doc.create');
  if (!key.centre_id || !/^\d{4}-\d{2}-\d{2}$/.test(key.date)) throw new Error('Pick the centre and the date.');
  const s = loadShifts().find((x) => x.centre_id === key.centre_id && x.date === key.date && x.shift === key.shift) ?? { id: generateId(), ...key, entries: [] };
  if (s.closed_at) throw new Error('This shift is closed: reopen it to add milk.');
  assertUnlocked({ id: s.id, issue_date: s.date }, 'create');
  if (!opts.allowDuplicate && duplicatesOf(s, e.farmer_id).length) throw new Error(`${e.name ?? 'This farmer'} already has milk in this shift.`);
  const entry = priceEntry(e, { charts: getTable<MilkRateChart>(AG_TABLES.rateCharts), date: s.date, shift: s.shift, centreId: s.centre_id, settings: readAgriSettings().milk });
  const shift = { ...s, entries: [...s.entries, entry] };
  put(shift);
  return { shift, entry };
}

/** Remove an entry of an open shift. */
export function removeEntry(shiftId: string, entryId: string): MilkShift {
  requireAccess('doc.create');
  const s = find(shiftId);
  if (s.closed_at) throw new Error('This shift is closed: reopen it first.');
  assertUnlocked({ id: s.id, issue_date: s.date }, 'edit');
  const next = { ...s, entries: s.entries.filter((e) => e.id !== entryId) };
  put(next);
  return next;
}

export interface ShiftTotals { farmers: number; litres: number; kgFat: number; kgSnf: number; avgFat: number; avgSnf: number; amount: number; rejected: number; rejectedLitres: number; byMilk: Partial<Record<MilkKind, { litres: number; amount: number }>> }

/** Derived totals of accepted milk (sample-only cans count as milk, at zero amount). */
export function shiftTotals(s: Pick<MilkShift, 'entries'>, settings?: AgMilkSettings): ShiftTotals {
  const t: ShiftTotals = { farmers: 0, litres: 0, kgFat: 0, kgSnf: 0, avgFat: 0, avgSnf: 0, amount: 0, rejected: 0, rejectedLitres: 0, byMilk: {} };
  const farmers = new Set<string>();
  let kg = 0;
  for (const e of s.entries ?? []) {
    const clr = num(e.clr) || clrOf(e.milk, settings);
    const l = toL(e.qty, e.unit, clr);
    if (e.rejected) {
      t.rejected++;
      t.rejectedLitres += l;
      continue;
    }
    farmers.add(e.farmer_id);
    const sol = solids(e.qty, e.unit, e.fat, e.snf, clr);
    kg += e.unit === 'KG' ? num(e.qty) : num(e.qty) * (1 + clr / 1000);
    t.litres += l;
    t.kgFat += sol.kgFat;
    t.kgSnf += sol.kgSnf;
    t.amount += num(e.amount);
    const m = (t.byMilk[e.milk] ??= { litres: 0, amount: 0 });
    m.litres = q3(m.litres + l);
    m.amount = round2(m.amount + num(e.amount));
  }
  return { ...t, farmers: farmers.size, litres: q3(t.litres), kgFat: q3(t.kgFat), kgSnf: q3(t.kgSnf), amount: round2(t.amount), rejectedLitres: q3(t.rejectedLitres), avgFat: kg > 0 ? round2((t.kgFat / kg) * 100) : 0, avgSnf: kg > 0 ? round2((t.kgSnf / kg) * 100) : 0 };
}

const MILK_NAMES: Readonly<Record<MilkKind, string>> = { cow: 'Cow milk', buffalo: 'Buffalo milk', mixed: 'Mixed milk' };

/** The stock item of a milk kind (settings, else by name, else created: unit LTR, HSN 0401, class `milk_fresh`). */
export function milkItemId(milk: MilkKind): string {
  const id = readAgriSettings().milk?.items?.[milk];
  const items = stockDb.items();
  const hit = (id && items.find((i) => i.id === id)) || items.find((i) => i.name.toLowerCase() === MILK_NAMES[milk].toLowerCase());
  if (hit) return hit.id;
  const item = blankStockItem({ name: MILK_NAMES[milk], unit: 'LTR', hsn: '0401', tax_rate: 0, ag_class: 'milk_fresh' });
  stockDb.saveItem(item);
  return item.id;
}
/** The godown of a centre (absent = Main). */
export const centreGodown = (centreId: string): string | undefined => readAgriSettings().centres?.find((c) => c.id === centreId)?.godown_id;

/** Write a stock journal straight (role, lock, series, audit) — production lines only (receipt) or consumption only. */
export function milkJournal(date: string, lines: { item_id: string; qty: number; rate?: number; godown_id?: string }[], dir: 'in' | 'out', narration: string, ref: string): StockJournal {
  requireAccess('books.edit');
  const all = getTable<StockJournal>(SJ_TABLE);
  const id = generateId();
  const number = nextSeriesNumberFor(SJ_PREFIX, date, all.map((j) => j.number));
  assertUnlocked({ id, issue_date: date, invoice_number: number }, 'create');
  const ls = lines.filter((l) => l.qty > 0).map((l) => ({ id: generateId(), item_id: l.item_id, qty: q3(l.qty), ...(l.godown_id ? { godown_id: l.godown_id } : {}), ...(dir === 'in' ? { rate: Math.round(num(l.rate) * 10000) / 10000 } : {}) }));
  const row: StockJournal = { id, number, date, consume: dir === 'out' ? ls : [], produce: dir === 'in' ? ls : [], costs: [], narration, milk_ref: ref, created_at: new Date().toISOString() };
  setTable(SJ_TABLE, [...all, row]);
  recordSeries(number);
  audit.record({ entity: 'stock_journal', entity_id: id, action: 'create', doc_number: number, summary: `Created stock journal ${number}: ${narration}` });
  return row;
}

/** Close a shift: accepted milk enters the centre godown (one stock journal); the shift becomes read-only. */
export function closeShift(id: string): MilkShift {
  const s = find(id);
  if (s.closed_at) return s;
  if (!s.entries.length) throw new Error('Nothing collected in this shift.');
  const t = shiftTotals(s, readAgriSettings().milk);
  return withTablesRollback([T, SJ_TABLE, 'stock_items', 'series_counters'], () => {
    const godown_id = centreGodown(s.centre_id);
    const lines = (Object.entries(t.byMilk) as [MilkKind, { litres: number; amount: number }][]).map(([milk, v]) => ({ item_id: milkItemId(milk), qty: v.litres, rate: v.litres > 0 ? v.amount / v.litres : 0, godown_id }));
    const sj = lines.some((l) => l.qty > 0) ? milkJournal(s.date, lines, 'in', `Milk collected — ${s.date} ${s.shift === 'M' ? 'morning' : 'evening'} shift`, s.id) : undefined;
    const next: MilkShift = { ...s, closed_at: new Date().toISOString(), ...(currentActor()?.name ? { closed_by: currentActor()!.name } : {}), ...(sj ? { sj_id: sj.id } : {}) };
    put(next);
    return next;
  });
}

/** Reopen a closed shift (audited); refused when a closed / paid cycle billed it. Its stock journal goes to the bin. */
export function reopenShift(id: string): MilkShift {
  requireAccess('books.edit');
  const s = find(id);
  if (!s.closed_at) return s;
  const cyc = s.cycle_id ? getTable<FarmerCycle>(AG_TABLES.cycles).find((c) => c.id === s.cycle_id) : undefined;
  if (cyc && cyc.status !== 'draft') throw new Error(`Billed in ${cyc.number}: reopen that cycle first.`);
  assertUnlocked({ id: s.id, issue_date: s.date }, 'edit');
  return withTablesRollback([T, SJ_TABLE], () => {
    if (s.sj_id && stockJournalsDb.all().some((j) => j.id === s.sj_id)) stockJournalsDb.remove(s.sj_id);
    const { closed_at: _c, closed_by: _b, sj_id: _j, ...rest } = s;
    void _c; void _b; void _j;
    put(rest);
    return rest;
  });
}
