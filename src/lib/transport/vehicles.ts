/**
 * R5-B3: the vehicle master (Distribution → Transport → Vehicles). Registration numbers are cleaned like the e-way bill
 * (`cleanVehicle`); each own vehicle gets ONE cost centre of kind `vehicle` (created once, reused on edits), so trip
 * expenses, freight and the Project P&L group by vehicle. Hired lorries name their owner (a supplier).
 * Documents (insurance, permit, fitness, PUC, road tax, national permit) carry an expiry for the bell.
 */
import type { Vehicle, VehicleDoc, VehicleDocKind } from '../../types/transport-works-r5';
import { cleanVehicle } from '../transport';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { COST_CENTRES_TABLE, loadCostCentres, saveCostCentre } from '../cost-centres';
import { shiftDay } from '../dates';

export const VEHICLES_TABLE = 'vehicles';
export const VEHICLE_DOC_KINDS: readonly VehicleDocKind[] = ['insurance', 'permit', 'fitness', 'puc', 'tax', 'national_permit'];
/** Bell: documents expiring within this many days (or expired). */
export const DOC_ALERT_DAYS = 15;

export function loadVehicles(): readonly Vehicle[] {
  return peekTable<Vehicle>(VEHICLES_TABLE).filter((v) => v && typeof v.id === 'string');
}

export function vehicleLabel(v: Pick<Vehicle, 'reg_no' | 'own'> | undefined): string {
  return v ? `${v.reg_no}${v.own ? '' : ' (hired)'}` : '';
}

/** The vehicle's cost centre: the stored one, else one of kind `vehicle` with its registration as the name (created once). */
export function ensureVehicleCostCentre(v: Pick<Vehicle, 'reg_no' | 'cost_centre_id'>): string {
  const all = loadCostCentres();
  if (v.cost_centre_id && all.some((c) => c.id === v.cost_centre_id)) return v.cost_centre_id;
  const found = all.find((c) => c.kind === 'vehicle' && c.name.toUpperCase() === v.reg_no.toUpperCase());
  if (found) return found.id;
  return saveCostCentre({ name: v.reg_no, kind: 'vehicle', active: true }).id;
}

export type VehicleInput = Omit<Vehicle, 'id' | 'created_at'> & { id?: string };

export function saveVehicle(input: VehicleInput): Vehicle {
  requireAccess('master.edit');
  const reg = cleanVehicle(input.reg_no);
  if (reg.length < 4) throw new Error('Enter the registration number.');
  const all = getTable<Vehicle>(VEHICLES_TABLE);
  if (all.some((v) => v.id !== input.id && v.reg_no === reg)) throw new Error(`Vehicle ${reg} is already in the list.`);
  const prev = input.id ? all.find((v) => v.id === input.id) : undefined;
  const docs: VehicleDoc[] = (input.docs ?? []).filter((d) => VEHICLE_DOC_KINDS.includes(d.kind) && /^\d{4}-\d{2}-\d{2}$/.test(d.expires_on));
  return withTablesRollback([VEHICLES_TABLE, COST_CENTRES_TABLE], () => {
    const row: Vehicle = {
      ...prev,
      ...input,
      id: prev?.id ?? generateId(),
      reg_no: reg,
      docs,
      created_at: prev?.created_at ?? new Date().toISOString(),
    };
    if (row.own) row.cost_centre_id = ensureVehicleCostCentre(row);
    else delete row.cost_centre_id;
    if (!row.km_per_litre || !(row.km_per_litre.min > 0) || !(row.km_per_litre.max >= row.km_per_litre.min)) delete row.km_per_litre;
    setTable(VEHICLES_TABLE, prev ? all.map((v) => (v.id === row.id ? row : v)) : [...all, row]);
    return row;
  });
}

/** Delete (only while no trip or LR uses it; history keeps its cost centre). */
export function removeVehicle(id: string): void {
  requireAccess('master.edit');
  if (peekTable<{ vehicle_id?: string }>('trips').some((t) => t.vehicle_id === id) || peekTable<{ vehicle_id?: string }>('consignment_notes').some((l) => l.vehicle_id === id)) {
    throw new Error('Trips or LRs use this vehicle, so it cannot be deleted.');
  }
  setTable(VEHICLES_TABLE, getTable<Vehicle>(VEHICLES_TABLE).filter((v) => v.id !== id));
}

export interface DocAlert {
  vehicle: Vehicle;
  doc: VehicleDoc;
  expired: boolean;
}

/** Documents expiring within `DOC_ALERT_DAYS` of `today`, or already expired (latest document of each kind only). */
export function docAlerts(vehicles: readonly Vehicle[], today: string): DocAlert[] {
  const out: DocAlert[] = [];
  const horizon = shiftDay(today, DOC_ALERT_DAYS);
  for (const v of vehicles) {
    const latest = new Map<VehicleDocKind, VehicleDoc>();
    for (const d of v.docs ?? []) if (!latest.has(d.kind) || latest.get(d.kind)!.expires_on < d.expires_on) latest.set(d.kind, d);
    for (const d of latest.values()) if (d.expires_on <= horizon) out.push({ vehicle: v, doc: d, expired: d.expires_on < today });
  }
  return out.sort((a, b) => a.doc.expires_on.localeCompare(b.doc.expires_on));
}
