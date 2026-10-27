/**
 * AG-C1 grain intake: gate entry and weighbridge slips (table `weighbridge_slips`, `WBS/FY…`, `doc.create`, dated
 * `date`). The first weighing (loaded vehicle) opens the slip; the second (empty vehicle), hours later, records the tare
 * and closes it: net = gross − tare. Gross and tare come from the Web Serial scale reader (the view imports
 * `scale-serial.ts` on demand) or are typed. The lab readings (moisture, foreign matter …) ride on the slip and feed the
 * quality cuts of the farmer purchase voucher (AG-A3) through `voucherPrefill`; "Receive for CMR" adds the lot to a
 * custom-milling agreement (`ag-cmr.ts`), "Receive for job milling" records a principal's-material receipt (JWP).
 *
 * A cancelled slip keeps its number; a slip used for a voucher / CMR lot / JWP receipt is never deleted. Deletes go
 * through `setTable` (the recycle bin keeps the row; the number stays reserved in `series_counters`).
 * Pure helpers above the "Storage" divider (tests/ag-weighbridge.test.ts).
 */
import './ag-registry';
import type { WbsReadings, WbsReadingKey, WbsUse, WeighbridgeSlip } from '../../types/agri-r12';
import type { LineWeight } from '../../types/trade-r8';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { principalDb } from '../job-work';
import { esc } from '../voucher-print';
import { AG_SERIES, AG_TABLES } from './ag-shared';

export const WBS = AG_SERIES.wbs;
export const WBS_TABLE = AG_TABLES.weighbridge;
export const READING_KEYS: readonly WbsReadingKey[] = ['moisture', 'foreign', 'damaged', 'immature', 'broken'];
/** An open slip older than this is flagged in the daily intake report. */
export const STALE_HOURS = 24;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100 || 0;

/* ── Small data-layer helpers shared by the AG-C writers ─────────── */

export const rowsOf = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');
/** Insert or replace a row by id (one table write: the edit observer audits it). */
export function put<T extends { id: string }>(t: string, row: T): T {
  const all = rowsOf<T>(t);
  setTable(t, all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}
/** Data-layer delete (the row goes to the recycle bin). */
export const drop = (t: string, id: string) => setTable(t, rowsOf<{ id: string }>(t).filter((r) => r.id !== id));

/** Local `yyyy-mm-ddTHH:mm` of now (bare local time; never parsed as UTC). */
export function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ── Pure ─────────────────────────────────────────────────────── */

/** Net kg = gross − tare (never below 0; 0 while the second weighing is missing). */
export const slipNet = (gross: number, tare?: number): number => (tare === undefined || !(num(tare) >= 0) ? 0 : r3(Math.max(num(gross) - num(tare), 0)));

/** Readings with only numeric, in-range values (0–100 %). */
export function cleanReadings(r: WbsReadings | undefined): WbsReadings {
  const out: WbsReadings = {};
  for (const k of READING_KEYS) {
    const v = r?.[k];
    if (v === undefined || v === null || String(v) === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`Reading "${k}" must be a % between 0 and 100.`);
    out[k] = r2(n);
  }
  return out;
}

/** Whole hours between two local stamps (`yyyy-mm-ddTHH:mm`). */
export function hoursBetween(a: string, b: string): number {
  const t = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)).getTime() : NaN;
  };
  const h = (t(b) - t(a)) / 3_600_000;
  return Number.isFinite(h) ? Math.floor(h) : 0;
}

export interface OpenSlip { slip: WeighbridgeSlip; hours: number; stale: boolean }

/** Open slips (first weighing only), oldest first, with their age and the > 24 h flag. */
export function openSlips(slips: readonly WeighbridgeSlip[], now: string): OpenSlip[] {
  return slips.filter((s) => s.status === 'open').sort((a, b) => a.gross_at.localeCompare(b.gross_at))
    .map((slip) => { const hours = hoursBetween(slip.gross_at, now); return { slip, hours, stale: hours > STALE_HOURS }; });
}

export interface IntakeGroup { key: string; slips: number; net_kg: number; avg_moisture: number | null }
export interface IntakeReport {
  date: string;
  byCommodity: IntakeGroup[];
  byParty: IntakeGroup[];
  byUse: IntakeGroup[];
  net_kg: number;
  /** Net-weighted average moisture of the day's done slips that carry a reading. */
  avg_moisture: number | null;
  open: OpenSlip[];
  stale: number;
}

function group(slips: readonly WeighbridgeSlip[], key: (s: WeighbridgeSlip) => string): IntakeGroup[] {
  const m = new Map<string, { slips: number; net: number; mw: number; mk: number }>();
  for (const s of slips) {
    const k = key(s);
    const g = m.get(k) ?? { slips: 0, net: 0, mw: 0, mk: 0 };
    g.slips += 1;
    g.net += num(s.net_kg);
    if (s.readings?.moisture !== undefined) { g.mw += num(s.readings.moisture) * num(s.net_kg); g.mk += num(s.net_kg); }
    m.set(k, g);
  }
  return [...m].map(([k, g]) => ({ key: k, slips: g.slips, net_kg: r3(g.net), avg_moisture: g.mk > 0 ? r2(g.mw / g.mk) : null })).sort((a, b) => a.key.localeCompare(b.key));
}

/** Daily intake: done slips of `date` by commodity, party kind and use; average moisture; open slips (> 24 h flagged). */
export function dailyIntake(slips: readonly WeighbridgeSlip[], date: string, now: string): IntakeReport {
  const done = slips.filter((s) => s.status === 'done' && s.date === date);
  const all = group(done, () => '*')[0];
  const open = openSlips(slips, now);
  return {
    date,
    byCommodity: group(done, (s) => s.commodity.trim() || '—'),
    byParty: group(done, (s) => s.party_kind),
    byUse: group(done, (s) => s.use),
    net_kg: all?.net_kg ?? 0,
    avg_moisture: all?.avg_moisture ?? null,
    open,
    stale: open.filter((o) => o.stale).length,
  };
}

/** What AG-A3's farmer purchase voucher is pre-filled with (net weight as quintals, bags, the weighing, readings). */
export interface VoucherPrefill {
  wbs_id: string;
  wbs_number: string;
  date: string;
  vendor_id?: string;
  vendor_name?: string;
  vehicle: string;
  bags: number;
  net_kg: number;
  readings: WbsReadings;
  line: { name: string; unit: 'QTL'; quantity: number; wt: LineWeight };
}

/** Pure: the voucher pre-fill of a done slip (the vehicle net is the weighing's gross; bag tare is typed on the voucher). */
export function voucherPrefill(s: WeighbridgeSlip): VoucherPrefill {
  if (s.status !== 'done') throw new Error('Record the second weighing (tare) first.');
  const bags = Math.max(Math.round(num(s.bags)), 0);
  const wt: LineWeight = { packages: bags, kind: 'BAG', gross: num(s.net_kg), gross_unit: 'KG', tare_per_package: 0, deduction: { basis: 'per_qtl', value: 0 } };
  return {
    wbs_id: s.id, wbs_number: s.number, date: s.date, ...(s.party_id ? { vendor_id: s.party_id } : {}), ...(s.party_name ? { vendor_name: s.party_name } : {}),
    vehicle: s.vehicle, bags, net_kg: num(s.net_kg), readings: { ...s.readings },
    line: { name: s.commodity, unit: 'QTL', quantity: r3(num(s.net_kg) / 100), wt },
  };
}

const fmtKg = (n: number) => num(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const at = (s?: string) => (s ? s.replace('T', ' ') : '—');

/** The printed slip (A5 small paper): both weighings with times, net, readings, "subject to quality cut". */
export function slipHtml(s: WeighbridgeSlip, business: { name?: string; address?: string }): string {
  const readings = READING_KEYS.filter((k) => s.readings?.[k] !== undefined).map((k) => `<tr><td>${esc(k[0].toUpperCase() + k.slice(1))}</td><td class="n">${esc(s.readings[k])} %</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(s.number)}</title>
<style>@page{size:A5}body{font-family:system-ui,sans-serif;margin:0;padding:16px;font-size:13px}h1{font-size:16px;margin:0}.t{font-weight:700;text-align:center;letter-spacing:.1em;border:1px solid;padding:4px;margin:8px 0}table{width:100%;border-collapse:collapse}td{padding:4px 6px;border-bottom:1px solid}td.n{text-align:right}.f{margin-top:10px;font-size:11px}</style></head><body>
<h1>${esc(business.name || 'Your business')}</h1>${business.address ? `<div>${esc(business.address)}</div>` : ''}
<div class="t">WEIGHBRIDGE SLIP${s.status === 'cancelled' ? ' — CANCELLED' : ''}</div>
<table><tbody>
<tr><td>Slip no.</td><td class="n"><strong>${esc(s.number)}</strong></td></tr>
<tr><td>Vehicle</td><td class="n">${esc(s.vehicle)}</td></tr>
<tr><td>Party</td><td class="n">${esc(s.party_name || '—')} (${esc(s.party_kind)})</td></tr>
<tr><td>Commodity</td><td class="n">${esc(s.commodity)}${s.bags ? ` · ${esc(s.bags)} bags` : ''}</td></tr>
<tr><td>Gross (loaded) · ${esc(at(s.gross_at))}</td><td class="n">${esc(fmtKg(s.gross_kg))} kg</td></tr>
<tr><td>Tare (empty) · ${esc(at(s.tare_at))}</td><td class="n">${s.tare_kg !== undefined ? `${esc(fmtKg(s.tare_kg))} kg` : '—'}</td></tr>
<tr><td><strong>Net</strong></td><td class="n"><strong>${esc(fmtKg(s.net_kg))} kg</strong></td></tr>
${readings}
</tbody></table>
<p class="f">Subject to quality cut. Weights as shown by the weighbridge${s.note ? ` · ${esc(s.note)}` : ''}.</p>
<p class="f">Driver / party ______________ &nbsp; Weighbridge operator ______________</p>
</body></html>`;
}

/* ================================================================
   Storage
   ================================================================ */

export const loadSlips = (): WeighbridgeSlip[] => rowsOf<WeighbridgeSlip>(WBS_TABLE);
const mustGet = (id: string): WeighbridgeSlip => {
  const s = loadSlips().find((x) => x.id === id);
  if (!s) throw new Error('This weighbridge slip no longer exists.');
  return s;
};
const lockOf = (s: Pick<WeighbridgeSlip, 'id' | 'date' | 'number'>) => ({ id: s.id, issue_date: s.date, invoice_number: s.number });

export type FirstWeighing = Pick<WeighbridgeSlip, 'date' | 'vehicle' | 'party_kind' | 'commodity' | 'gross_kg'> & Partial<Pick<WeighbridgeSlip, 'party_id' | 'party_name' | 'bags' | 'readings' | 'use' | 'note' | 'gross_at'>>;

/** First weighing: a new open slip in the WBS series. */
export function openSlip(i: FirstWeighing): WeighbridgeSlip {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Enter the date.');
  if (!i.vehicle?.trim()) throw new Error('Enter the vehicle number.');
  if (!i.commodity?.trim()) throw new Error('Enter the commodity.');
  if (!(num(i.gross_kg) > 0)) throw new Error('Enter the gross (loaded) weight.');
  if (num(i.bags) < 0) throw new Error('Bags cannot be negative.');
  const readings = cleanReadings(i.readings);
  const number = nextSeriesNumberFor(WBS, i.date, loadSlips().map((s) => s.number));
  const id = generateId();
  assertUnlocked(lockOf({ id, date: i.date, number }), 'create');
  const slip: WeighbridgeSlip = {
    id, number, date: i.date, vehicle: i.vehicle.trim().toUpperCase(), party_kind: i.party_kind,
    ...(i.party_id ? { party_id: i.party_id } : {}), ...(i.party_name?.trim() ? { party_name: i.party_name.trim() } : {}),
    commodity: i.commodity.trim(), gross_kg: r3(num(i.gross_kg)), gross_at: i.gross_at || localStamp(), net_kg: 0,
    ...(num(i.bags) > 0 ? { bags: Math.round(num(i.bags)) } : {}), readings, use: i.use ?? 'purchase', status: 'open',
    ...(i.note?.trim() ? { note: i.note.trim() } : {}), created_at: new Date().toISOString(),
  };
  return withTablesRollback([WBS_TABLE, 'series_counters'], () => {
    put(WBS_TABLE, slip);
    recordSeries(number);
    return slip;
  });
}

/** Second weighing: tare recorded, net = gross − tare, the slip is done. */
export function recordTare(id: string, tareKg: number, opts: { at?: string; readings?: WbsReadings; bags?: number } = {}): WeighbridgeSlip {
  requireAccess('doc.create');
  const s = mustGet(id);
  if (s.status !== 'open') throw new Error(`Slip ${s.number} is ${s.status}.`);
  const tare = num(tareKg);
  if (!(tare > 0)) throw new Error('Enter the tare (empty vehicle) weight.');
  if (tare >= num(s.gross_kg)) throw new Error('The tare must be less than the gross weight.');
  assertUnlocked(lockOf(s), 'edit');
  const readings = opts.readings ? { ...s.readings, ...cleanReadings(opts.readings) } : s.readings;
  return put(WBS_TABLE, {
    ...s, tare_kg: r3(tare), tare_at: opts.at || localStamp(), net_kg: slipNet(s.gross_kg, tare), readings, status: 'done',
    ...(num(opts.bags) > 0 ? { bags: Math.round(num(opts.bags)) } : {}), updated_at: new Date().toISOString(),
  });
}

/** Lab readings typed after the weighing (before the slip is used). */
export function setReadings(id: string, readings: WbsReadings): WeighbridgeSlip {
  requireAccess('doc.create');
  const s = mustGet(id);
  if (s.status === 'cancelled' || s.ref_id) throw new Error(`Slip ${s.number} is ${s.ref_id ? 'already used' : 'cancelled'}.`);
  return put(WBS_TABLE, { ...s, readings: cleanReadings(readings), updated_at: new Date().toISOString() });
}

/** Cancel (the number stays used; the slip prints "cancelled"). A used slip is refused. */
export function cancelSlip(id: string, reason: string): WeighbridgeSlip {
  requireAccess('doc.create');
  const s = mustGet(id);
  if (s.ref_id) throw new Error(`Slip ${s.number} is already used; cancel the voucher / receipt first.`);
  if (!reason.trim()) throw new Error('Give a reason for cancelling.');
  assertUnlocked(lockOf(s), 'edit');
  return put(WBS_TABLE, { ...s, status: 'cancelled', cancel_reason: reason.trim(), updated_at: new Date().toISOString() });
}

/** Delete an unused slip (recycle bin; its WBS number stays reserved). */
export function deleteSlip(id: string): void {
  requireAccess('doc.create');
  const s = loadSlips().find((x) => x.id === id);
  if (!s) return;
  if (s.ref_id) throw new Error(`Slip ${s.number} is used; it cannot be deleted.`);
  assertUnlocked(lockOf(s), 'delete');
  drop(WBS_TABLE, id);
}

/** Mark a done slip used (purchase voucher / CMR lot / JWP receipt). Refused when already used or not done. */
export function markUsed(id: string, use: WbsUse, refId: string): WeighbridgeSlip {
  requireAccess('doc.create');
  const s = mustGet(id);
  if (s.status !== 'done') throw new Error(`Slip ${s.number} has no second weighing yet.`);
  if (s.ref_id && s.ref_id !== refId) throw new Error(`Slip ${s.number} is already used.`);
  return put(WBS_TABLE, { ...s, use, ref_id: refId, updated_at: new Date().toISOString() });
}

/** Free a slip again (its voucher / receipt was deleted). */
export function releaseSlip(id: string): void {
  const s = loadSlips().find((x) => x.id === id);
  if (!s?.ref_id) return;
  const { ref_id: _r, ...rest } = s;
  void _r;
  put(WBS_TABLE, { ...rest, updated_at: new Date().toISOString() });
}

/** "Receive for job milling": a principal's-material receipt (JWP) of the slip's net weight in quintals. */
export function receiveForJob(id: string, principal: { name: string; client_id?: string; gstin?: string }): { slip: WeighbridgeSlip; jwpId: string; jwpNumber: string } {
  const s = mustGet(id);
  if (s.status !== 'done') throw new Error(`Slip ${s.number} has no second weighing yet.`);
  if (s.ref_id) throw new Error(`Slip ${s.number} is already used.`);
  return withTablesRollback([WBS_TABLE, 'job_work_principal', 'series_counters'], () => {
    const r = principalDb.save({
      date: s.date, kind: 'receipt', party_name: principal.name || s.party_name || 'Principal', ...(principal.client_id ? { client_id: principal.client_id } : {}),
      ...(principal.gstin ? { party_gstin: principal.gstin } : {}), challan_no: s.number, challan_date: s.date,
      lines: [{ id: generateId(), name: s.commodity, qty: r3(num(s.net_kg) / 100), unit: 'QTL' }], narration: `Job milling — weighbridge slip ${s.number}, vehicle ${s.vehicle}`,
    });
    return { slip: markUsed(s.id, 'job', r.id), jwpId: r.id, jwpNumber: r.number };
  });
}
