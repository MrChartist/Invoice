/**
 * AG-A3 quality cuts (table `quality_cut_tables`, `master.edit`, audited). Per commodity: parameters with a norm, a
 * mode (cut the weight or the price), the cut per point above the norm, an optional cap and a reject line. No preset
 * values: they are contract / agency terms (starter rows in help only). A reading at or below the norm cuts nothing.
 *
 *   points = reading − norm (≥ 0) · cut % = points × per-point % (capped at `max_pct`)
 *   weight mode: cut kg = net kg × cut % · price mode: rate cut = rate × cut %
 * Pure above "Storage".
 */
import './ag-registry';
import type { AgQualityReading, QualityCutTable, QualityParam } from '../../types/agri-r12';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { AG_TABLES } from './ag-shared';

const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;
const KEYS: readonly QualityParam['key'][] = ['moisture', 'foreign', 'damaged', 'immature', 'broken', 'custom'];

export interface QualityResult {
  rows: AgQualityReading[];
  cut_kg: number;
  /** Rupees cut from the value (price mode). */
  cut_rs: number;
  accepted_kg: number;
  reject: boolean;
}

/** The cuts of `readings` (by key) on `netKg` at `ratePerKg`. */
export function qualityCut(params: readonly QualityParam[], readings: Readonly<Record<string, number | undefined>>, netKg: number, ratePerKg = 0): QualityResult {
  const rows: AgQualityReading[] = [];
  let cutKg = 0;
  for (const p of params) {
    const v = readings[p.label ?? p.key] ?? readings[p.key];
    if (v === undefined || !Number.isFinite(Number(v))) continue;
    const reading = num(v);
    const points = Math.max(reading - num(p.norm_pct), 0);
    const pct = r3(Math.min(points * num(p.per_point_pct), p.max_pct ?? Infinity));
    const row: AgQualityReading = { key: p.key, ...(p.label ? { label: p.label } : {}), reading, norm: num(p.norm_pct), mode: p.mode, cut_pct: pct };
    if (p.mode === 'weight') {
      row.cut_kg = r3((num(netKg) * pct) / 100);
      cutKg += row.cut_kg;
    }
    if (p.reject_above !== undefined && reading > num(p.reject_above)) row.reject = true;
    rows.push(row);
  }
  // A price cut applies to the weight left after the weight cuts (recomputed once they are all known).
  const accepted = r3(Math.max(num(netKg) - cutKg, 0));
  let cutRs = 0;
  for (const r of rows) if (r.mode === 'price') cutRs += (r.cut_rs = round2((accepted * num(ratePerKg) * r.cut_pct) / 100));
  return { rows, cut_kg: r3(cutKg), cut_rs: round2(cutRs), accepted_kg: accepted, reject: rows.some((r) => r.reject) };
}

/** "Moisture 19% (norm 17%) − 2% = 52.8 kg" — the printed line of a reading. */
export const readingText = (r: AgQualityReading): string =>
  `${r.label ?? r.key[0].toUpperCase() + r.key.slice(1)} ${r.reading}% (norm ${r.norm}%)${r.cut_pct > 0 ? ` − ${r.cut_pct}%${r.cut_kg ? ` = ${r.cut_kg} kg` : r.cut_rs ? ` = ₹${r.cut_rs.toFixed(2)}` : ''}` : ''}${r.reject ? ' · above the reject line' : ''}`;

/* ── Storage ── */

export const loadQualityTables = (): QualityCutTable[] => getTable<QualityCutTable>(AG_TABLES.quality).filter((t) => t && typeof t.id === 'string');
export const qualityTableFor = (commodity: string | undefined, all = loadQualityTables()): QualityCutTable | undefined =>
  all.find((t) => t.commodity.trim().toLowerCase() === String(commodity ?? '').trim().toLowerCase());

/** Save a commodity's table (parameters with a norm and a per-point cut; no preset values). */
export function saveQualityTable(input: Omit<QualityCutTable, 'id'> & { id?: string }): QualityCutTable {
  requireAccess('master.edit');
  const commodity = input.commodity.trim();
  if (!commodity) throw new Error('Type the commodity (e.g. Paddy).');
  const params = input.params.filter((p) => KEYS.includes(p.key)).map((p) => ({
    key: p.key, ...(p.label?.trim() ? { label: p.label.trim() } : {}), norm_pct: num(p.norm_pct), mode: p.mode === 'price' ? 'price' as const : 'weight' as const, per_point_pct: num(p.per_point_pct),
    ...(num(p.max_pct) > 0 ? { max_pct: num(p.max_pct) } : {}), ...(num(p.reject_above) > 0 ? { reject_above: num(p.reject_above) } : {}),
  }));
  if (!params.length) throw new Error('Add at least one parameter (moisture, foreign matter …).');
  const all = loadQualityTables();
  const clash = all.find((t) => t.id !== input.id && t.commodity.toLowerCase() === commodity.toLowerCase());
  if (clash) throw new Error(`${commodity} already has a table.`);
  const row: QualityCutTable = { id: input.id || generateId(), commodity, params, updated_at: new Date().toISOString() };
  setTable(AG_TABLES.quality, input.id && all.some((t) => t.id === input.id) ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
  return row;
}

/** Delete a table (recycle bin; vouchers keep their printed readings). */
export function removeQualityTable(id: string): void {
  requireAccess('master.edit');
  setTable(AG_TABLES.quality, loadQualityTables().filter((t) => t.id !== id));
}
