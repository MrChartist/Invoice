/**
 * AG-A1 farm batches (table `farm_batches`, dated `start`, `doc.create`, audited): a flock, pond, herd or crop with
 * events (mortality, feed, harvest, medicine, weight). A batch creates its cost centre (kind `project`) on first save,
 * so purchase bills and sales tagged to it give the batch P&L the existing reports show. Memo figures only — no posting
 * from events (GST classes for live poultry, eggs, fresh fish: AG31).
 *   mortality % = dead ÷ placed · FCR = feed kg ÷ weight gained kg · cost per kg = cost ÷ (harvest or live weight kg)
 */
import './ag-registry';
import type { FarmBatch, FarmBatchEvent } from '../../types/agri-r12';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { loadCostCentres, saveCostCentre } from '../cost-centres';
import { AG_TABLES } from './ag-shared';

const T = AG_TABLES.batches;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;

export interface BatchMemo { dead: number; mortalityPct: number; feedKg: number; harvestKg: number; liveKg: number; gainedKg: number; fcr: number | null; costPerKg: number | null }

/** Memo figures of a batch; `cost` = what the batch's cost centre carries (optional). */
export function batchMemo(b: Pick<FarmBatch, 'placed' | 'events' | 'start_weight_kg'>, cost = 0): BatchMemo {
  const sum = (k: FarmBatchEvent['kind']) => r3(b.events.filter((e) => e.kind === k).reduce((s, e) => s + num(e.qty), 0));
  const dead = sum('mortality');
  const feedKg = sum('feed');
  const harvestKg = sum('harvest');
  const weights = b.events.filter((e) => e.kind === 'weight').sort((x, y) => x.date.localeCompare(y.date));
  const liveKg = num(weights.at(-1)?.qty);
  const gainedKg = r3(Math.max(harvestKg + liveKg - num(b.start_weight_kg), 0));
  const out = harvestKg || liveKg;
  return {
    dead, mortalityPct: num(b.placed) > 0 ? round2((dead / num(b.placed)) * 100) : 0, feedKg, harvestKg, liveKg, gainedKg,
    fcr: gainedKg > 0 ? round2(feedKg / gainedKg) : null, costPerKg: out > 0 && cost > 0 ? round2(cost / out) : null,
  };
}

export const loadBatches = (): FarmBatch[] => getTable<FarmBatch>(T).filter((b) => b && typeof b.id === 'string');

/** Save a batch; the first save creates its cost centre (once). */
export function saveBatch(input: Omit<FarmBatch, 'id' | 'events' | 'status'> & { id?: string; events?: FarmBatchEvent[]; status?: FarmBatch['status'] }): FarmBatch {
  requireAccess('doc.create');
  if (!input.name.trim()) throw new Error('Name the batch (e.g. Broiler flock 12).');
  if (!DAY.test(input.start)) throw new Error('Choose the start date.');
  if (!(num(input.placed) > 0)) throw new Error('Enter how many were placed (birds / seed / animals / acres).');
  const all = loadBatches();
  const prev = input.id ? all.find((b) => b.id === input.id) : undefined;
  let cc = prev?.cost_centre_id ?? input.cost_centre_id;
  const ccName = `${input.name.trim()} (${input.kind})`;
  if (!cc || !loadCostCentres().some((c) => c.id === cc)) cc = (loadCostCentres().find((c) => c.name.toLowerCase() === ccName.toLowerCase()) ?? saveCostCentre({ name: ccName, kind: 'project', active: true })).id;
  const row: FarmBatch = { ...prev, ...input, id: prev?.id ?? generateId(), name: input.name.trim(), placed: num(input.placed), cost_centre_id: cc, events: input.events ?? prev?.events ?? [], status: input.status ?? prev?.status ?? 'active', created_at: prev?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
  setTable(T, prev ? all.map((b) => (b.id === row.id ? row : b)) : [...all, row]);
  return row;
}

/** Add an event to a batch. */
export function addBatchEvent(id: string, e: FarmBatchEvent): FarmBatch {
  const b = loadBatches().find((x) => x.id === id);
  if (!b) throw new Error('Batch not found.');
  if (!DAY.test(e.date) || !(num(e.qty) > 0)) throw new Error('Enter the date and the quantity.');
  return saveBatch({ ...b, events: [...b.events, { ...e, qty: num(e.qty) }].sort((x, y) => x.date.localeCompare(y.date)) });
}

/** Delete a batch (recycle bin); its cost centre stays with the bills tagged to it. */
export function removeBatch(id: string): void {
  requireAccess('doc.create');
  setTable(T, loadBatches().filter((b) => b.id !== id));
}
