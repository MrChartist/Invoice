/**
 * CN-C1 units (table `realty_units`, `master.edit`, audited): tower / floor / unit no., type, carpet area (sq m),
 * saleable area (sq ft), base rate (₹ per sq ft of saleable area, carpet converted when none), PLC heads and status
 * (available → hold → booked → registered; cancelled bookings free the unit). Bulk add by tower (floors × units per
 * floor, "A-1203" style numbers). Bookings move the status (`cn-bookings.ts`); the grid lists by tower and floor.
 */
import './cn-registry';
import type { RealtyUnit, RealtyUnitStatus, RealtyUnitType } from '../../types/construction-r11';
import { generateId, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { toCsv } from '../csv';
import { RT, removeRow, rows, upsert } from './cn-realty-projects';

export const SQFT_PER_SQM = 10.7639;
export const loadUnits = () => rows<RealtyUnit>(RT.units);

/** Base price + PLC: rate × saleable sq ft (or carpet sq m × 10.7639). */
export function unitPrice(u: Pick<RealtyUnit, 'base_rate' | 'saleable_sqft' | 'carpet_sqm' | 'plc'>): number {
  const area = num(u.saleable_sqft) > 0 ? num(u.saleable_sqft) : num(u.carpet_sqm) * SQFT_PER_SQM;
  return round2(num(u.base_rate) * area + (u.plc ?? []).reduce((s, p) => s + num(p.amount), 0));
}

/** Allowed status moves (a booked unit changes only through its booking). */
const MOVES: Record<RealtyUnitStatus, RealtyUnitStatus[]> = {
  available: ['hold', 'booked'],
  hold: ['available', 'booked'],
  booked: ['registered', 'available'],
  registered: ['available'],
  cancelled: ['available'],
};
export const canMove = (from: RealtyUnitStatus, to: RealtyUnitStatus): boolean => from === to || MOVES[from].includes(to);

export interface BulkInput {
  project_id: string;
  tower_id: string;
  tower: string;
  floors: number;
  perFloor: number;
  /** First floor numbered (1 = units 101…). */
  from?: number;
  type: RealtyUnitType;
  carpet_sqm: number;
  saleable_sqft?: number;
  base_rate: number;
}

/** Pure: the units of a bulk add ("A-101" … "A-1204"), skipping numbers already in the tower. */
export function bulkUnits(b: BulkInput, existing: readonly Pick<RealtyUnit, 'tower_id' | 'unit_no'>[]): RealtyUnit[] {
  const taken = new Set(existing.filter((u) => u.tower_id === b.tower_id).map((u) => u.unit_no.toUpperCase()));
  const out: RealtyUnit[] = [];
  const first = Math.max(0, Math.round(num(b.from ?? 1)));
  for (let f = first; f < first + Math.max(0, Math.round(num(b.floors))); f++) {
    for (let n = 1; n <= Math.max(0, Math.round(num(b.perFloor))); n++) {
      const unit_no = `${b.tower ? `${b.tower}-` : ''}${f}${String(n).padStart(2, '0')}`;
      if (taken.has(unit_no.toUpperCase())) continue;
      out.push({ id: generateId(), project_id: b.project_id, tower_id: b.tower_id, unit_no, floor: f, type: b.type, carpet_sqm: num(b.carpet_sqm), ...(num(b.saleable_sqft) > 0 ? { saleable_sqft: num(b.saleable_sqft) } : {}), base_rate: num(b.base_rate), status: 'available' });
    }
  }
  return out;
}

export function addUnits(b: BulkInput): RealtyUnit[] {
  requireAccess('master.edit');
  const all = loadUnits();
  const made = bulkUnits(b, all);
  if (!made.length) throw new Error('No new units: check floors and units per floor (existing numbers are skipped).');
  setTable(RT.units, [...all, ...made]);
  return made;
}

export function saveUnit(u: RealtyUnit): RealtyUnit {
  requireAccess('master.edit');
  if (!u.unit_no.trim()) throw new Error('Enter the unit number.');
  const prev = loadUnits().find((x) => x.id === u.id);
  if (prev && !canMove(prev.status, u.status)) throw new Error(`A ${prev.status} unit cannot be marked ${u.status}.`);
  if (prev?.booking_id && u.status !== prev.status) throw new Error('This unit has a booking: change it from the booking.');
  return upsert(RT.units, { ...u, unit_no: u.unit_no.trim() });
}

export function deleteUnit(id: string): void {
  requireAccess('master.edit');
  if (loadUnits().find((u) => u.id === id)?.booking_id) throw new Error('This unit has a booking: cancel it first.');
  removeRow(RT.units, id);
}

/** Units CSV (grid export). */
export const unitsCsv = (units: readonly RealtyUnit[], tower: (id: string) => string): string =>
  toCsv([['Tower', 'Unit', 'Floor', 'Type', 'Carpet sq m', 'Saleable sq ft', 'Base rate', 'Price', 'Status'], ...units.map((u) => [tower(u.tower_id), u.unit_no, u.floor, u.type, u.carpet_sqm, u.saleable_sqft ?? '', u.base_rate, unitPrice(u), u.status])]);
