/**
 * SV-D1 vehicles and appliances (table `service_assets`, `master.edit`, audited "Vehicle / appliance") and the company
 * object `workshop_settings` (owner only, audited on save, synced as a singleton). A registration no. is normalised
 * (`mh 12 ab-1234` → `MH12AB1234`) and unique; an odometer reading below the last one is kept with a warning.
 * History of an asset: its jobs (RT-D4 `service_jobs`, newest first) with their bills and readings.
 */
import './sv-registry';
import type { ServiceJob } from '../../types/retail-r9';
import type { ServiceAsset, WorkshopSettings } from '../../types/services-r10';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { num } from '../invoice-calc';
import { SV_OBJECTS, SV_TABLES } from './sv-shared';

export const WORKSHOP_SETTINGS_KEY = `${DB_PREFIX}${SV_OBJECTS.workshopSettings}`;
export const DEFAULT_CHECKLIST = ['Lights', 'Wipers', 'Tyres', 'Brakes', 'Battery', 'Fluids', 'Body scratches / dents', 'Tools & spare wheel'];

export const normReg = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const loadAssets = (): ServiceAsset[] => getTable<ServiceAsset>(SV_TABLES.assets).filter((a) => !!a && typeof a.id === 'string');
export const lastKm = (a: Pick<ServiceAsset, 'odometer'> | undefined): number | undefined => a?.odometer?.[a.odometer.length - 1]?.km;
export const assetLabel = (a: Pick<ServiceAsset, 'reg_no' | 'serial' | 'make' | 'model'>): string => [a.reg_no || a.serial, a.make, a.model].filter(Boolean).join(' · ');

/** Warning (never a block) when a reading is below the last one. */
export const odometerIssue = (a: Pick<ServiceAsset, 'odometer'> | undefined, km: number | undefined): string => {
  const last = lastKm(a);
  return km !== undefined && last !== undefined && km < last ? `Odometer ${km} km is below the last reading ${last} km — check it.` : '';
};

/** Pure: the asset with a reading added (date order; one reading per day, the newer replaces it). */
export function withReading(a: ServiceAsset, date: string, km: number | undefined): ServiceAsset {
  if (!(num(km) > 0)) return a;
  const rows = [...(a.odometer ?? []).filter((r) => r.date !== date), { date, km: num(km) }].sort((x, y) => x.date.localeCompare(y.date));
  return { ...a, odometer: rows };
}

export type AssetInput = Omit<ServiceAsset, 'id' | 'created_at'> & { id?: string };

export function saveAsset(i: AssetInput): ServiceAsset {
  requireAccess('master.edit');
  const all = loadAssets();
  const reg = normReg(i.reg_no);
  if (!i.model?.trim() || !i.owner_name?.trim()) throw new Error('Type the model and the owner.');
  if (i.kind === 'vehicle' && !reg) throw new Error('Type the registration no.');
  const dup = reg && all.find((a) => a.id !== i.id && normReg(a.reg_no) === reg);
  if (dup) throw new Error(`${reg} is already on file (${dup.owner_name}).`);
  const prev = i.id ? all.find((a) => a.id === i.id) : undefined;
  const row: ServiceAsset = { ...prev, ...i, id: prev?.id ?? generateId(), model: i.model.trim(), owner_name: i.owner_name.trim(), ...(reg ? { reg_no: reg } : {}), created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.assets, prev ? all.map((a) => (a.id === row.id ? row : a)) : [...all, row]);
  return row;
}

/** Data-layer delete (recycle bin); refused while a job card names the asset. */
export function deleteAsset(id: string, jobs: readonly Pick<ServiceJob, 'asset_id'>[]): void {
  requireAccess('master.edit');
  if (jobs.some((j) => j.asset_id === id)) throw new Error('Job cards use this vehicle / appliance.');
  setTable(SV_TABLES.assets, loadAssets().filter((a) => a.id !== id));
}

/** Jobs of an asset, newest first (the job card's "last service" is the first delivered one). */
export const assetJobs = (id: string, jobs: readonly ServiceJob[]): ServiceJob[] => jobs.filter((j) => j.asset_id === id).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
export const lastService = (id: string, jobs: readonly ServiceJob[], exceptJob?: string): ServiceJob | undefined => assetJobs(id, jobs).find((j) => j.id !== exceptJob && (j.status === 'delivered' || !!j.invoice_id));

/** Vehicle age in months on `date` (registration year taken as January). */
export const ageMonths = (a: Pick<ServiceAsset, 'year'>, date: string): number => (a.year ? Math.max(0, (Number(date.slice(0, 4)) - a.year) * 12 + Number(date.slice(5, 7)) - 1) : 0);

/* ── Workshop settings (owner only) ── */

const nums = (v: unknown) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => num(x) > 0).map(([k, x]) => [k, num(x)])) : undefined);

export function readWorkshopSettings(): WorkshopSettings {
  const r = getJson<WorkshopSettings | null>(WORKSHOP_SETTINGS_KEY, null);
  return r && typeof r === 'object' ? r : {};
}

export function saveWorkshopSettings(patch: Partial<WorkshopSettings>): WorkshopSettings {
  requireAccess('settings.manage');
  const next: WorkshopSettings = { ...readWorkshopSettings(), ...patch, updated_at: new Date().toISOString() };
  if (patch.labour_rate) next.labour_rate = nums(patch.labour_rate);
  if (patch.checklists) next.checklists = patch.checklists.map((x) => x.trim()).filter(Boolean);
  setJson(WORKSHOP_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: SV_OBJECTS.workshopSettings, action: 'update', summary: `Workshop settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}
