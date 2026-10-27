/**
 * MF-B4 moulding / extrusion runs (table `process_runs`, `doc.create`, dated `date`; pack `plastics`). A run records the
 * machine, mould (cavities, cycle), hours, inputs by kind (virgin, regrind, masterbatch, additive), good / rejected
 * parts, runners, purge and the regrind made. Expected output = hours × 3600 ÷ cycle × cavities; efficiency = good ÷
 * expected. Material balance: input kg = good × part weight + rejects × part weight + runners + purge + unaccounted loss;
 * yield = good kg ÷ input kg; regrind % of the mix warns above the item's `mf_max_regrind_pct`.
 *
 * Posting: ONE manufacturing journal per run (`production_order_id` tagged): inputs consumed, good parts produced, the
 * regrind item produced for `regrind_out_kg` as a scrap line at its rate — regrind is an ordinary stock item consumed by
 * later runs (no new stock path; in-house regrind has no tax effect, MF27). Moulds live in `mfg_settings.moulds`; their
 * shots so far = the typed starting count + the runs' shots (derived, never written by a run). Pure helpers above
 * "Storage" (tests/mf-runs.test.ts).
 */
import type { MfMould, ProcessRun } from '../../types/mfg-r13';
import type { ManufacturingVoucher } from '../../types/manufacturing';
import type { StockInputs, StockItem } from '../inventory';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { manufacturingDb, MFG_TABLE } from '../manufacturing';
import { num } from '../invoice-calc';
import { readMfgSettings, saveMfgSettings } from './mf-settings';
import { MF_TABLES } from './mf-shared';
import { DAY, drop, mustGet, nowIso, put, r2, r3, rowsOf, scrapRate } from './mf-b-db';

export const RUNS_TABLE = MF_TABLES.runs;
/** Mould life warning at this share of `life_shots`. */
export const LIFE_WARN = 0.9;

/* ── Pure ─────────────────────────────────────────────────────── */

/** Shots for the hours at a cycle time (whole shots). */
export const shotsFor = (hours: number, cycleS: number): number => (num(cycleS) > 0 ? Math.floor((num(hours) * 3600) / num(cycleS)) : 0);
/** Expected good parts = shots × cavities. */
export const expectedOutput = (hours: number, cycleS: number, cavities: number): number => shotsFor(hours, cycleS) * Math.max(Math.round(num(cavities)), 1);

/** g per part: typed on the run, else (shot − runner) ÷ cavities of the mould. */
export function partGrams(run: Pick<ProcessRun, 'part_g' | 'cavities'>, mould?: Pick<MfMould, 'shot_g' | 'runner_g' | 'cavities'>): number {
  if (num(run.part_g) > 0) return num(run.part_g);
  const cav = Math.max(num(run.cavities) || num(mould?.cavities), 1);
  return num(mould?.shot_g) > 0 ? Math.max(num(mould?.shot_g) - num(mould?.runner_g), 0) / cav : 0;
}

export interface Balance {
  input_kg: number;
  good_kg: number;
  reject_kg: number;
  runner_kg: number;
  purge_kg: number;
  /** Unaccounted loss (input − everything accounted); negative = more out than in (check the weights). */
  loss_kg: number;
  yield_pct: number;
  regrind_pct: number;
  expected: number;
  efficiency_pct: number;
}

export function runBalance(run: ProcessRun, mould?: MfMould): Balance {
  const pg = partGrams(run, mould);
  const input = run.inputs.reduce((s, i) => s + num(i.kg), 0);
  const regrind = run.inputs.filter((i) => i.kind === 'regrind').reduce((s, i) => s + num(i.kg), 0);
  const good = (num(run.good_qty) * pg) / 1000;
  const reject = (num(run.reject_qty) * pg) / 1000;
  const expected = expectedOutput(run.hours, num(run.cycle_s) || num(mould?.cycle_s), num(run.cavities) || num(mould?.cavities) || 1);
  return {
    input_kg: r3(input), good_kg: r3(good), reject_kg: r3(reject), runner_kg: r3(num(run.runner_kg)), purge_kg: r3(num(run.purge_kg)),
    loss_kg: r3(input - good - reject - num(run.runner_kg) - num(run.purge_kg)),
    yield_pct: input > 0 ? r2((good / input) * 100) : 0, regrind_pct: input > 0 ? r2((regrind / input) * 100) : 0,
    expected, efficiency_pct: expected > 0 ? r2((num(run.good_qty) / expected) * 100) : 0,
  };
}

/** '' or the regrind warning against the item's limit. */
export const regrindWarning = (b: Pick<Balance, 'regrind_pct'>, item?: Pick<StockItem, 'mf_max_regrind_pct' | 'name'>): string =>
  item && num(item.mf_max_regrind_pct) > 0 && b.regrind_pct > num(item.mf_max_regrind_pct) ? `Regrind ${b.regrind_pct}% is above the ${num(item.mf_max_regrind_pct)}% allowed for ${item.name}.` : '';

/** Shots of the mould so far (typed start + every run on it) and the life share. */
export function mouldLife(m: MfMould, runs: readonly Pick<ProcessRun, 'mould_id' | 'shots'>[]): { shots: number; pct: number; warn: boolean } {
  const shots = Math.round(num(m.shots_done) + runs.filter((r) => r.mould_id === m.id).reduce((s, r) => s + num(r.shots), 0));
  const pct = num(m.life_shots) > 0 ? r2((shots / num(m.life_shots)) * 100) : 0;
  return { shots, pct, warn: num(m.life_shots) > 0 && shots >= num(m.life_shots) * LIFE_WARN };
}

/** The run's manufacturing journal (one per run): inputs → good parts (+ regrind as a scrap line). */
export function runVoucher(run: ProcessRun, items: readonly Pick<StockItem, 'id' | 'sale_rate' | 'opening_rate'>[]): Omit<ManufacturingVoucher, 'id' | 'number'> {
  const rg = run.regrind_item_id && num(run.regrind_out_kg) > 0 ? run.regrind_item_id : undefined;
  return {
    date: run.date, item_id: run.item_id, qty: num(run.good_qty),
    components: run.inputs.filter((i) => i.item_id && num(i.kg) > 0).map((i) => ({ id: generateId(), item_id: i.item_id, qty: r3(i.kg), ...(i.batch ? { batch_no: i.batch } : {}) })),
    outputs: rg ? [{ id: generateId(), item_id: rg, qty: r3(num(run.regrind_out_kg)), kind: 'scrap', rate: r2(scrapRate(items.find((i) => i.id === rg))) }] : [],
    costs: [], narration: `Moulding run ${run.date}${run.shift ? ` · ${run.shift}` : ''}`, ...(run.order_id ? { production_order_id: run.order_id } : {}),
  };
}

/* ================================================================
   Storage
   ================================================================ */

export const loadRuns = (): ProcessRun[] => rowsOf<ProcessRun>(RUNS_TABLE).filter((r) => Array.isArray(r.inputs));
export const loadMoulds = (): MfMould[] => readMfgSettings().moulds ?? [];

/** Owner: add or edit a mould (`mfg_settings.moulds`, audited with the settings). */
export function saveMould(m: Omit<MfMould, 'id' | 'shots_done'> & { id?: string; shots_done?: number }): MfMould {
  if (!m.name?.trim()) throw new Error('Name the mould.');
  if (!m.item_id) throw new Error('Pick the part it makes.');
  if (!(num(m.cavities) >= 1) || !(num(m.cycle_s) > 0)) throw new Error('Enter cavities and the cycle time.');
  const all = loadMoulds();
  const row: MfMould = { ...m, id: m.id ?? generateId(), name: m.name.trim(), cavities: Math.round(num(m.cavities)), cycle_s: num(m.cycle_s), shots_done: Math.max(Math.round(num(m.shots_done)), 0) };
  saveMfgSettings({ moulds: all.some((x) => x.id === row.id) ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row] });
  return row;
}

const lockOf = (r: Pick<ProcessRun, 'id' | 'date'>) => ({ id: r.id, issue_date: r.date, invoice_number: '' });

export type RunInput = Omit<ProcessRun, 'id' | 'voucher_id' | 'shots'> & { id?: string; shots?: number };

/** Record a run and post its journal (books.edit for the journal; period lock on the date). */
export function saveRun(i: RunInput, items: readonly StockItem[], inputs?: StockInputs): ProcessRun {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Enter the date.');
  if (!i.item_id) throw new Error('Pick the part made.');
  if (!(num(i.hours) > 0)) throw new Error('Enter the hours run.');
  if (!(num(i.good_qty) > 0)) throw new Error('Enter the good parts.');
  if (!i.inputs.some((x) => x.item_id && num(x.kg) > 0)) throw new Error('Enter the material used (kg).');
  for (const k of ['reject_qty', 'runner_kg', 'purge_kg', 'regrind_out_kg'] as const) if (num(i[k]) < 0) throw new Error('Quantities cannot be negative.');
  if (num(i.regrind_out_kg) > 0 && !i.regrind_item_id) throw new Error('Pick the regrind item.');
  const mould = i.mould_id ? loadMoulds().find((m) => m.id === i.mould_id) : undefined;
  const prev = i.id ? loadRuns().find((r) => r.id === i.id) : undefined;
  const id = prev?.id ?? generateId();
  assertUnlocked(lockOf({ id, date: i.date }), prev ? 'edit' : 'create');
  const cycle = num(i.cycle_s) || num(mould?.cycle_s);
  const run: ProcessRun = {
    ...prev, ...i, id, ...(cycle ? { cycle_s: cycle } : {}), ...(mould ? { cavities: num(i.cavities) || mould.cavities } : {}),
    shots: num(i.shots) > 0 ? Math.round(num(i.shots)) : shotsFor(i.hours, cycle), created_at: prev?.created_at ?? nowIso(), updated_at: nowIso(),
  };
  return withTablesRollback([RUNS_TABLE, MFG_TABLE, 'series_counters'], () => {
    const v = manufacturingDb.save({ ...runVoucher(run, items), ...(prev?.voucher_id ? { id: prev.voucher_id } : {}) }, items, inputs);
    return put(RUNS_TABLE, { ...run, voucher_id: v.id });
  });
}

/** Delete a run and its journal (both to the recycle bin). */
export function removeRun(id: string): void {
  requireAccess('doc.create');
  const r = mustGet<ProcessRun>(RUNS_TABLE, id, 'run');
  assertUnlocked(lockOf(r), 'delete');
  withTablesRollback([RUNS_TABLE, MFG_TABLE], () => {
    if (r.voucher_id && manufacturingDb.get(r.voucher_id)) manufacturingDb.remove(r.voucher_id);
    drop(RUNS_TABLE, id);
  });
}
