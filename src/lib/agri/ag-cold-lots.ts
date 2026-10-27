/**
 * AG-D1 cold-storage lots (table `cold_lots`, `doc.create`, dated `date_in`, numbered `CSR/FY…`; gate passes `GPO/FY…`
 * live on the lot, `ag-gatepass.ts`). **Custody only**: a lot is the depositor's goods held by us — it never enters the
 * stock engine (no godown stock, no valuation, no stock report reads this table; AG30). Balance bags = in − gate passes
 * − bags transferred to another depositor (who gets a child lot carrying the same `date_in`, so the rent runs on).
 * Chambers live in `agri_settings.chambers`. The storage receipt is a plain non-negotiable receipt, never a WDRA e-NWR
 * (AG23). Pure above "Storage".
 */
import './ag-registry';
import type { ColdChamber, ColdLot } from '../../types/agri-r12d';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { esc } from '../voucher-print';
import { AG_SERIES, AG_TABLES } from './ag-shared';

export const LOTS_TABLE = AG_TABLES.coldLots;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Bags are whole or 3-decimal (part bags by weight); weights in kg to 3 decimals. */
export const q3 = (n: unknown): number => Math.round(num(n) * 1000) / 1000;

/* ── Pure ── */

export const bagsOut = (l: Pick<ColdLot, 'outs' | 'transfers'>): number => q3((l.outs ?? []).reduce((s, o) => s + num(o.bags), 0) + (l.transfers ?? []).reduce((s, t) => s + num(t.bags), 0));
export const lotBalance = (l: Pick<ColdLot, 'bags' | 'outs' | 'transfers'>): number => q3(num(l.bags) - bagsOut(l));
export const lotStatus = (l: Pick<ColdLot, 'bags' | 'outs' | 'transfers'>): ColdLot['status'] => (lotBalance(l) <= 0 ? 'closed' : bagsOut(l) > 0 ? 'part_out' : 'stored');

/** Bags stored per chamber against its capacity (closed lots hold nothing). */
export function chamberUse(lots: readonly ColdLot[], chambers: readonly ColdChamber[]): { chamber: ColdChamber; bags: number; pct: number }[] {
  return chambers.map((c) => {
    const bags = q3(lots.filter((l) => l.chamber_id === c.id).reduce((s, l) => s + Math.max(lotBalance(l), 0), 0));
    return { chamber: c, bags, pct: num(c.capacity_bags) > 0 ? round2((bags / num(c.capacity_bags)) * 100) : 0 };
  });
}

/** The depositor's lots, bags in / out / balance (rent and loans are added by the statement view). */
export function depositorLots(lots: readonly ColdLot[], depositorId: string) {
  const mine = lots.filter((l) => l.depositor_id === depositorId);
  return { lots: mine, in: q3(mine.reduce((s, l) => s + num(l.bags), 0)), out: q3(mine.reduce((s, l) => s + bagsOut(l), 0)), balance: q3(mine.reduce((s, l) => s + lotBalance(l), 0)) };
}

/** A small A5 paper (storage receipt, gate pass, share certificate): title, label / value rows, a foot note. */
export function smallPaper(title: string, head: string, rows: readonly [string, unknown][], foot: string, sign = 'Authorised signatory'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A5;margin:12mm}body{font:13px system-ui,sans-serif;color:#111}h1{font-size:17px;margin:0 0 2px}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin:10px 0}td{border:1px solid #999;padding:5px 7px}td:first-child{width:38%;color:#444}.f{font-size:11px;color:#444}.s{margin-top:36px;text-align:right}</style></head><body><h1>${esc(title)}</h1><p>${esc(head)}</p><table>${rows.filter((r) => r[1] !== undefined && r[1] !== '').map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table><p class="f">${esc(foot)}</p><p class="s">${esc(sign)}</p></body></html>`;
}

/** Storage receipt (A5): "Non-negotiable receipt — not a WDRA e-NWR" (AG23) and the terms typed in settings. */
export function receiptHtml(l: ColdLot, ctx: { company: string; chamber?: string; plan?: string; terms?: string }): string {
  return smallPaper(`Storage receipt ${l.number}`, ctx.company, [
    ['Depositor', l.depositor_name], ['Date in', l.date_in], ['Commodity', [l.commodity, l.variety].filter(Boolean).join(' — ')], ['Bags', l.bags],
    ['Weight (kg)', l.weight_kg ?? (l.bag_kg ? q3(l.bags * l.bag_kg) : '')], ['Chamber / location', [ctx.chamber, l.location].filter(Boolean).join(' · ')],
    ['Grade / marks', [l.grade, l.marks].filter(Boolean).join(' · ')], ['Season', l.season], ['Rent', ctx.plan ?? ''],
    ['Insured', l.insured ? `${l.insured.by} — ₹${l.insured.value}` : ''],
  ], `Non-negotiable receipt — not a WDRA e-NWR. ${ctx.terms ?? ''}`.trim());
}

/* ── Storage ── */

export const loadLots = (): ColdLot[] => getTable<ColdLot>(LOTS_TABLE).filter((r) => r && typeof r.id === 'string').map((r) => ({ ...r, outs: Array.isArray(r.outs) ? r.outs : [] }));
export const writeLots = (rows: ColdLot[]): void => setTable(LOTS_TABLE, rows);

export interface LotInput {
  date_in: string;
  depositor_id: string;
  depositor_name: string;
  commodity: string;
  variety?: string;
  bags: number;
  bag_kg?: number;
  weight_kg?: number;
  chamber_id: string;
  location?: string;
  grade?: string;
  season: string;
  rent_plan_id: string;
  marks?: string;
  insured?: { by: string; value: number };
}

function check(i: LotInput): void {
  if (!DAY.test(i.date_in)) throw new Error('Choose the date in.');
  if (!i.depositor_id) throw new Error('Choose the depositor.');
  if (!i.commodity.trim()) throw new Error('Type the commodity.');
  if (!(q3(i.bags) > 0)) throw new Error('Enter the bags received.');
  if (!i.chamber_id) throw new Error('Choose the chamber.');
  if (!i.rent_plan_id) throw new Error('Choose the rent plan.');
}

const clean = (i: LotInput) => ({
  date_in: i.date_in, depositor_id: i.depositor_id, depositor_name: i.depositor_name.trim(), commodity: i.commodity.trim(), bags: q3(i.bags),
  chamber_id: i.chamber_id, season: i.season.trim(), rent_plan_id: i.rent_plan_id,
  ...(i.variety?.trim() ? { variety: i.variety.trim() } : {}), ...(num(i.bag_kg) > 0 ? { bag_kg: q3(i.bag_kg) } : {}),
  ...(num(i.weight_kg) > 0 ? { weight_kg: q3(i.weight_kg) } : {}), ...(i.location?.trim() ? { location: i.location.trim() } : {}),
  ...(i.grade?.trim() ? { grade: i.grade.trim() } : {}), ...(i.marks?.trim() ? { marks: i.marks.trim() } : {}),
  ...(i.insured?.by?.trim() ? { insured: { by: i.insured.by.trim(), value: round2(num(i.insured.value)) } } : {}),
});

/** Receive a lot (numbered `CSR/FY…`, never reused after a delete). `doc.create`; the period lock applies to its date. */
export function addLot(input: LotInput): ColdLot {
  requireAccess('doc.create');
  check(input);
  const all = loadLots();
  const number = nextSeriesNumberFor(AG_SERIES.csr, input.date_in, all.map((l) => l.number));
  assertUnlocked({ issue_date: input.date_in, invoice_number: number }, 'create');
  const lot: ColdLot = { id: generateId(), number, ...clean(input), outs: [], status: 'stored', created_at: new Date().toISOString() };
  return withTablesRollback([LOTS_TABLE, 'series_counters'], () => {
    writeLots([...all, lot]);
    recordSeries(number);
    return lot;
  });
}

/** Edit a lot's particulars; bags cannot fall below what has gone out. */
export function editLot(id: string, input: LotInput): ColdLot {
  requireAccess('doc.create');
  check(input);
  const all = loadLots();
  const prev = all.find((l) => l.id === id);
  if (!prev) throw new Error('Lot not found.');
  assertUnlocked({ id, issue_date: prev.date_in, invoice_number: prev.number }, 'edit');
  const next: ColdLot = { ...prev, ...clean(input), updated_at: new Date().toISOString() };
  if (lotBalance(next) < 0) throw new Error(`${q3(bagsOut(prev))} bags have already gone out of this lot.`);
  next.status = lotStatus(next);
  writeLots(all.map((l) => (l.id === id ? next : l)));
  return next;
}

/** Delete a lot with nothing out of it (to the recycle bin through the watched table); its number stays used. */
export function deleteLot(id: string): void {
  requireAccess('doc.create');
  const all = loadLots();
  const lot = all.find((l) => l.id === id);
  if (!lot) return;
  if (bagsOut(lot) > 0) throw new Error('Bags have gone out of this lot: delete its gate passes first.');
  assertUnlocked({ id, issue_date: lot.date_in, invoice_number: lot.number }, 'delete');
  writeLots(all.filter((l) => l.id !== id));
}

/**
 * Transfer bags to another depositor (a sale inside the store), with the consent note. The receiver gets a child lot
 * (new `CSR` number, same commodity / chamber / plan / `date_in`): rent follows the plan and is charged to whoever
 * takes the bags out (default).
 */
export function transferBags(lotId: string, t: { date: string; to_depositor_id: string; to_depositor_name: string; bags: number; note: string }): ColdLot {
  requireAccess('doc.create');
  const all = loadLots();
  const lot = all.find((l) => l.id === lotId);
  if (!lot) throw new Error('Lot not found.');
  const bags = q3(t.bags);
  if (!DAY.test(t.date)) throw new Error('Choose the transfer date.');
  if (!t.to_depositor_id || t.to_depositor_id === lot.depositor_id) throw new Error('Choose the other depositor.');
  if (!t.note.trim()) throw new Error('Note both parties\' consent.');
  if (!(bags > 0) || bags > lotBalance(lot)) throw new Error(`Only ${lotBalance(lot)} bags are in this lot.`);
  const number = nextSeriesNumberFor(AG_SERIES.csr, t.date, all.map((l) => l.number));
  assertUnlocked({ issue_date: t.date, invoice_number: number }, 'create');
  const child: ColdLot = {
    ...lot, id: generateId(), number, depositor_id: t.to_depositor_id, depositor_name: t.to_depositor_name.trim(), bags, outs: [], transfers: [], from_lot_id: lot.id,
    ...(lot.weight_kg ? { weight_kg: q3((lot.weight_kg * bags) / lot.bags) } : {}), status: 'stored', created_at: new Date().toISOString(),
  };
  const next: ColdLot = { ...lot, transfers: [...(lot.transfers ?? []), { id: generateId(), date: t.date, to_depositor_id: t.to_depositor_id, to_depositor_name: child.depositor_name, bags, note: t.note.trim(), to_lot_id: child.id }] };
  next.status = lotStatus(next);
  return withTablesRollback([LOTS_TABLE, 'series_counters'], () => {
    writeLots([...all.map((l) => (l.id === lotId ? next : l)), child]);
    recordSeries(number);
    return child;
  });
}
