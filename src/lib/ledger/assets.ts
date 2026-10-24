/**
 * Fixed-asset register + Income-tax Act WDV depreciation (Phase 6.3). Table `fixed_assets`.
 *
 * Each asset belongs to a block (rates in src/lib/tax-rules.ts, keyed by FY). Depreciation is
 * computed per asset, per Indian FY, on the written-down value: full rate, or HALF the rate in
 * the year the asset is put to use when it is used for fewer than 180 days in that year
 * (Sec 32(1), second proviso). The register posts:
 *   - an acquisition voucher (Dr asset account / Cr the account it was paid from), unless the
 *     purchase is already in the books (`paid_from` empty);
 *   - one depreciation voucher per FY, dated 31 March (Dr Depreciation / Cr Accumulated depreciation).
 *
 * Simplifications (verify with your CA): the IT Act works on the WHOLE block (sale proceeds
 * reduce the block, a block that ceases gives a capital gain/loss); this register depreciates
 * asset by asset and does not handle disposals — record a sale with a manual journal.
 */

import { audit } from '../audit';
import { isoDay } from '../dates';
import { num, round2 } from '../invoice-calc';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { DEPRECIATION_BLOCK_LABELS, DEPRECIATION_HALF_RATE_DAYS, depreciationRate, type DepreciationBlock } from '../tax-rules';
import { formatMoney } from '../utils';

export const ASSETS_TABLE = 'fixed_assets';

export interface FixedAsset {
  id: string;
  name: string;
  block: DepreciationBlock;
  /** Fixed-asset account in the chart (e.g. `fa_computers`). */
  account_id: string;
  /** Cost in rupees, excluding GST claimed as input credit. */
  cost: number;
  /** Bought on (acquisition voucher date). */
  acquired_on: string;
  /** Put to use on — drives the 180-day half-rate rule. */
  put_to_use: string;
  /** Account credited on acquisition (bank / cash / creditors / loans). '' = already recorded elsewhere. */
  paid_from: string;
  /** Supplier name when paid_from is the creditors control account. */
  party?: string;
  created_at: string;
  updated_at?: string;
}

export const BLOCK_DEFAULT_ACCOUNT: Record<DepreciationBlock, string> = {
  BUILDING_RESIDENTIAL: 'fa_building',
  BUILDING_OTHER: 'fa_building',
  BUILDING_TEMPORARY: 'fa_building',
  FURNITURE: 'fa_furniture',
  PLANT_MACHINERY: 'fa_plant',
  MOTOR_CAR: 'fa_vehicles',
  MOTOR_VEHICLE_HIRE: 'fa_vehicles',
  COMPUTER: 'fa_computers',
  BOOKS_PROFESSIONAL: 'fa_office',
  INTANGIBLE: 'fa_intangible',
  ENERGY_SAVING: 'fa_plant',
};

const BLOCKS = Object.keys(DEPRECIATION_BLOCK_LABELS) as DepreciationBlock[];

function fyStart(iso: string): number {
  const y = parseInt(iso.slice(0, 4), 10);
  return parseInt(iso.slice(5, 7), 10) >= 4 ? y : y - 1;
}

/** Days from `from` to `to`, both inclusive (calendar arithmetic, zone-proof). */
export function daysInclusive(from: string, to: string): number {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((d(to) - d(from)) / 86_400_000) + 1;
}

export const fyLabelOf = (startYear: number) => `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;

export interface DepreciationRow {
  assetId: string;
  fyStartYear: number;
  /** 31 March of the FY. */
  date: string;
  openingWdv: number; // paise
  ratePct: number;
  halfRate: boolean;
  depreciation: number; // paise
  closingWdv: number; // paise
}

/** Year-by-year WDV schedule for one asset, for every FY that has started on or before `today`. */
export function depreciationSchedule(asset: FixedAsset, today: string): DepreciationRow[] {
  const use = isoDay(asset.put_to_use);
  if (!use || !(asset.cost > 0)) return [];
  const rows: DepreciationRow[] = [];
  let wdv = Math.round(round2(asset.cost) * 100);
  const first = fyStart(use);
  const last = fyStart(today);
  for (let y = first; y <= last && wdv > 0; y++) {
    const start = `${y}-04-01`;
    const end = `${y + 1}-03-31`;
    const rate = depreciationRate(asset.block, start);
    const half = y === first && daysInclusive(use, end) < DEPRECIATION_HALF_RATE_DAYS;
    const eff = half ? rate / 2 : rate;
    // Integer paise, rounded half up.
    const dep = Math.min(wdv, Math.round((wdv * eff) / 100));
    rows.push({ assetId: asset.id, fyStartYear: y, date: end, openingWdv: wdv, ratePct: eff, halfRate: half, depreciation: dep, closingWdv: wdv - dep });
    wdv -= dep;
  }
  return rows;
}

export interface BlockSummary {
  block: DepreciationBlock;
  label: string;
  ratePct: number;
  openingWdv: number;
  additions: number;
  depreciation: number;
  closingWdv: number;
}

/** IT-Act style block summary for one FY (paise). */
export function blockSummary(assets: readonly FixedAsset[], fyStartYear: number, today: string): BlockSummary[] {
  const map = new Map<DepreciationBlock, BlockSummary>();
  for (const a of assets) {
    const row = depreciationSchedule(a, today).find((r) => r.fyStartYear === fyStartYear);
    if (!row) continue;
    const s = map.get(a.block) ?? {
      block: a.block,
      label: DEPRECIATION_BLOCK_LABELS[a.block],
      ratePct: depreciationRate(a.block, `${fyStartYear}-04-01`),
      openingWdv: 0,
      additions: 0,
      depreciation: 0,
      closingWdv: 0,
    };
    const added = fyStart(isoDay(a.put_to_use)) === fyStartYear;
    if (added) s.additions += row.openingWdv;
    else s.openingWdv += row.openingWdv;
    s.depreciation += row.depreciation;
    s.closingWdv += row.closingWdv;
    map.set(a.block, s);
  }
  return [...map.values()].sort((x, y) => x.label.localeCompare(y.label));
}

/* ── Storage ───────────────────────────────────────────────────── */

export function normalizeAssets(rows: unknown[]): FixedAsset[] {
  const out: FixedAsset[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const block = o.block as DepreciationBlock;
    const put = isoDay(o.put_to_use);
    if (typeof o.id !== 'string' || !BLOCKS.includes(block) || !put) continue;
    out.push({
      id: o.id,
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Asset',
      block,
      account_id: typeof o.account_id === 'string' && o.account_id ? o.account_id : BLOCK_DEFAULT_ACCOUNT[block],
      cost: round2(Math.max(num(o.cost), 0)),
      acquired_on: isoDay(o.acquired_on) || put,
      put_to_use: put,
      paid_from: typeof o.paid_from === 'string' ? o.paid_from : '',
      ...(typeof o.party === 'string' && o.party.trim() ? { party: o.party.trim() } : {}),
      created_at: typeof o.created_at === 'string' ? o.created_at : '',
      ...(typeof o.updated_at === 'string' ? { updated_at: o.updated_at } : {}),
    });
  }
  return out;
}

export function loadAssets(): FixedAsset[] {
  return normalizeAssets(getTable<unknown>(ASSETS_TABLE));
}

export class AssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetError';
  }
}

export type FixedAssetInput = Omit<FixedAsset, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export function validateAsset(a: FixedAssetInput): string[] {
  const errors: string[] = [];
  if (!a.name.trim()) errors.push('Enter the asset name.');
  if (!BLOCKS.includes(a.block)) errors.push('Choose a block of assets.');
  if (!(num(a.cost) > 0)) errors.push('Enter the cost.');
  if (!isoDay(a.acquired_on)) errors.push('Choose the purchase date.');
  if (!isoDay(a.put_to_use)) errors.push('Choose the date it was put to use.');
  else if (isoDay(a.acquired_on) && a.put_to_use < a.acquired_on) errors.push('An asset cannot be put to use before it was bought.');
  if (!a.account_id) errors.push('Choose the fixed-asset account.');
  return errors;
}

/** Add or edit a register entry (period lock on the purchase date; audited). */
export function saveAsset(input: FixedAssetInput): FixedAsset {
  const errors = validateAsset(input);
  if (errors.length) throw new AssetError(errors[0]);
  const all = loadAssets();
  const prev = input.id ? all.find((a) => a.id === input.id) : undefined;
  const id = prev?.id ?? generateId();
  if (prev) assertUnlocked({ id, issue_date: prev.acquired_on, invoice_number: prev.name }, 'edit');
  assertUnlocked({ id, issue_date: input.acquired_on, invoice_number: input.name }, prev ? 'edit' : 'create');
  const now = new Date().toISOString();
  const row: FixedAsset = {
    id,
    name: input.name.trim(),
    block: input.block,
    account_id: input.account_id,
    cost: round2(num(input.cost)),
    acquired_on: input.acquired_on,
    put_to_use: input.put_to_use,
    paid_from: input.paid_from,
    ...(input.party && input.party.trim() ? { party: input.party.trim() } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(ASSETS_TABLE, prev ? all.map((a) => (a.id === id ? row : a)) : [...all, row]);
  audit.record({
    entity: 'fixed_asset',
    entity_id: id,
    action: prev ? 'update' : 'create',
    doc_number: row.name,
    summary: `${prev ? 'Edited' : 'Added'} fixed asset “${row.name}” (${DEPRECIATION_BLOCK_LABELS[row.block]}), cost ₹${formatMoney(row.cost)}, put to use ${row.put_to_use}`,
  });
  return row;
}

export function deleteAsset(id: string): void {
  const all = loadAssets();
  const row = all.find((a) => a.id === id);
  if (!row) return;
  assertUnlocked({ id, issue_date: row.acquired_on, invoice_number: row.name }, 'delete');
  setTable(ASSETS_TABLE, all.filter((a) => a.id !== id));
  audit.record({ entity: 'fixed_asset', entity_id: id, action: 'delete', doc_number: row.name, summary: `Deleted fixed asset “${row.name}” (cost ₹${formatMoney(row.cost)})` });
}
