/**
 * R6-A1 setup checklist v3: a business-aware step catalogue. Which steps apply depends on the business type, the
 * active industry packs, the shop-mode modules and the role; whether a step is done is derived from the company's
 * data (so work done on another device counts). Only `skipped` and `hidden_at` are stored, in the company object
 * `mrchartist_inv_setup_progress` (backed up, synced as a singleton, not audited — viewing state).
 *
 * Pure catalogue + builder (tests/onboarding.test.ts); `loadSetupProgress` / `saveSetupProgress` do the storage.
 */
import { PACK_TABS, activePacks, type PackId } from './industry-packs';
import { enabledModules, type ModuleId } from './shop-mode';
import { DB_PREFIX, KEYS, getJson, peekTable, readRaw, setJson } from './storage';
import { currentRole, requireAccess } from './access';
import { localDb } from './localDb';

export type StepKind =
  | 'profile' | 'opening' | 'import' | 'client' | 'item' | 'posbill' | 'invoice' | 'packFirst' | 'whatsapp' | 'payment' | 'gstPeriod' | 'backup'
  // R8-C (TR-C5): trade profile and the trading packs' own steps
  | 'tradeProfile' | 'schemeScope' | 'weightItem' | 'principal';

/** Catalogue order (the order steps are shown in). */
export const STEP_ORDER: readonly StepKind[] = ['profile', 'tradeProfile', 'opening', 'import', 'client', 'item', 'posbill', 'invoice', 'packFirst', 'principal', 'schemeScope', 'weightItem', 'whatsapp', 'payment', 'gstPeriod', 'backup'];

/** Steps a clerk sees (R6-A1 AC4). */
export const CLERK_STEPS: readonly StepKind[] = ['client', 'item', 'invoice', 'posbill', 'payment'];

export const MAX_STEPS = 7;

export type ChecklistRole = 'owner' | 'clerk' | 'viewer';

export interface ChecklistCtx {
  /** `settings.business_type`; absent = full accounting (existing companies). */
  businessType?: string;
  packs: readonly PackId[];
  /** Shop-mode modules; null = every module. */
  modules: ReadonlySet<ModuleId> | null;
  role: ChecklistRole;
  /** The active profile has a GSTIN. */
  gstRegistered?: boolean;
  /** R8-C: `settings.trade_kind` (a wholesale company without one gets "Pick your trade"). */
  tradeKind?: string;
}

export interface ChecklistFactsV3 {
  profileReady: boolean;
  clients: number;
  items: number;
  invoices: number;
  messagesSent: number;
  payments: number;
  lastBackup?: string;
  /** `ledger_openings` + `opening_bills` rows. */
  openings?: number;
  /** Import runs recorded (`IMPORT_RUNS_TABLE`, written by the CSV / XLSX import wizard). */
  importRuns?: number;
  /** Inventory stock items. */
  stockItems?: number;
  /** Invoices saved from the POS (`pos: true`). */
  posBills?: number;
  /** First records of each pack (LR, RA bill, fee plan, donation, lease, channel). */
  packRecords?: Partial<Record<PackId, number>>;
  /** Compliance rows of this company (a return marked filed or a JSON download recorded). */
  gstPeriods?: number;
  /** R8-C: schemes with a group / party scope, items sold by weight / bags, principals (vendors with a kind). */
  scopedSchemes?: number;
  weightItems?: number;
  principals?: number;
}

export interface SetupProgress {
  skipped: string[];
  hidden_at?: string;
}

export interface ChecklistStepV3 {
  /** Stable key: the kind, or `packFirst:<pack>`. Stored in `skipped`. */
  key: string;
  kind: StepKind;
  pack?: PackId;
  done: boolean;
  skipped: boolean;
  to: string;
}

/** Where a C3 import run is recorded (the wizard appends one row per run). */
export const IMPORT_RUNS_TABLE = 'import_runs';

/** The table whose first row completes a pack's first step. */
export const PACK_FIRST_TABLE: Readonly<Record<PackId, string>> = {
  transport: 'consignment_notes',
  works: 'ra_measurements',
  fees: 'fee_plans',
  nonprofit: 'donations',
  leases: 'leases',
  marketplace: 'sales_channels',
  // R8-C: trading packs
  distributor: 'party_rates',
  commodity: 'trade_charge_heads',
  agency: 'arrivals',
};

const isType = (ctx: ChecklistCtx, ...types: string[]) => types.includes(ctx.businessType || 'full');
const moduleOn = (ctx: ChecklistCtx, m: ModuleId) => !ctx.modules || ctx.modules.has(m);

function applies(kind: StepKind, ctx: ChecklistCtx): boolean {
  switch (kind) {
    case 'opening': return isType(ctx, 'full', 'wholesale', 'manufacturer') || ctx.packs.length > 0;
    case 'import': return isType(ctx, 'full', 'wholesale');
    case 'client': case 'invoice': return !isType(ctx, 'kirana');
    case 'posbill': return isType(ctx, 'kirana', 'restaurant');
    case 'whatsapp': return isType(ctx, 'services', 'kirana', 'wholesale');
    case 'gstPeriod': return !!ctx.gstRegistered && moduleOn(ctx, 'gst');
    case 'packFirst': return ctx.packs.length > 0;
    case 'tradeProfile': return isType(ctx, 'wholesale') && !ctx.tradeKind; // R8-C: existing wholesale companies
    case 'schemeScope': return ctx.packs.includes('distributor');
    case 'weightItem': return ctx.packs.includes('commodity');
    case 'principal': return ctx.packs.includes('agency');
    default: return true; // profile, item, payment, backup
  }
}

const packHref = (p: PackId) => PACK_TABS.find((t) => t.pack === p)?.path ?? '/';

function stepsOf(kind: StepKind, f: ChecklistFactsV3, ctx: ChecklistCtx): Omit<ChecklistStepV3, 'skipped'>[] {
  const one = (done: boolean, to: string) => [{ key: kind, kind, done, to }];
  const inventory = moduleOn(ctx, 'inventory');
  switch (kind) {
    case 'profile': return one(f.profileReady, '/settings');
    case 'opening': return one((f.openings ?? 0) > 0, '/books?tab=coa&m=opening-tb');
    case 'import': return one((f.importRuns ?? 0) > 0, '/settings?tab=data&import=1');
    case 'client': return one(f.clients > 0, '/clients?new=1');
    case 'item': return one(f.items > 0 || (inventory && (f.stockItems ?? 0) > 0), inventory ? '/inventory?new=1' : '/settings?tab=items');
    case 'posbill': return one((f.posBills ?? 0) > 0, '/pos');
    case 'invoice': return one(f.invoices > 0, '/invoice');
    case 'packFirst': return ctx.packs.map((p) => ({ key: `packFirst:${p}`, kind, pack: p, done: (f.packRecords?.[p] ?? 0) > 0, to: packHref(p) }));
    case 'whatsapp': return one(f.messagesSent > 0, '/transactions');
    case 'payment': return one(f.payments > 0, '/transactions?filter=unpaid&pay=1');
    case 'gstPeriod': return one((f.gstPeriods ?? 0) > 0, '/gst-reports');
    case 'backup': return one(!!f.lastBackup, '/settings?tab=data');
    case 'tradeProfile': return one(!!ctx.tradeKind, '/settings?tab=features');
    case 'schemeScope': return one((f.scopedSchemes ?? 0) > 0, '/settings?tab=items');
    case 'weightItem': return one((f.weightItems ?? 0) > 0, '/inventory');
    case 'principal': return one((f.principals ?? 0) > 0, '/expenses?tab=vendors');
  }
}

/** Every step that applies to this company and role, in catalogue order (Help → Setup checklist lists these). */
export function allSteps(f: ChecklistFactsV3, ctx: ChecklistCtx, progress: SetupProgress = { skipped: [] }): ChecklistStepV3[] {
  if (ctx.role === 'viewer') return [];
  const skipped = new Set(progress.skipped);
  return STEP_ORDER.filter((k) => applies(k, ctx) && (ctx.role !== 'clerk' || CLERK_STEPS.includes(k)))
    .flatMap((k) => stepsOf(k, f, ctx))
    .map((s) => ({ ...s, skipped: !s.done && skipped.has(s.key), done: s.done || skipped.has(s.key) }));
}

/** The card's steps: at most 7, open steps first to fill the slots, shown in catalogue order. */
export function cardSteps(all: readonly ChecklistStepV3[]): ChecklistStepV3[] {
  const open = all.filter((s) => !s.done).slice(0, MAX_STEPS);
  const done = all.filter((s) => s.done).slice(0, MAX_STEPS - open.length);
  const keep = new Set([...open, ...done]);
  return all.filter((s) => keep.has(s));
}

/** The card shows while a step is open, the card is not hidden and the role may act. */
export const showCard = (steps: readonly ChecklistStepV3[], progress: SetupProgress, role: ChecklistRole): boolean =>
  role !== 'viewer' && !progress.hidden_at && steps.some((s) => !s.done);

/* ── Storage (company object `setup_progress`) ─────────────────────────────── */

export const SETUP_PROGRESS_KEY = `${DB_PREFIX}setup_progress`;

export function normalizeProgress(v: unknown): SetupProgress {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<SetupProgress>) : {};
  const skipped = Array.isArray(o.skipped) ? [...new Set(o.skipped.filter((x): x is string => typeof x === 'string'))] : [];
  return typeof o.hidden_at === 'string' && o.hidden_at ? { skipped, hidden_at: o.hidden_at } : { skipped };
}

export const loadSetupProgress = (): SetupProgress => normalizeProgress(getJson<unknown>(SETUP_PROGRESS_KEY, null));

/** Skip / un-skip a step, hide / un-hide the card. Clerks may write it (`doc.create`); viewers may not. */
export function saveSetupProgress(next: SetupProgress): SetupProgress {
  requireAccess('doc.create');
  const clean = normalizeProgress(next);
  setJson(SETUP_PROGRESS_KEY, clean);
  return clean;
}

export const withSkipped = (p: SetupProgress, key: string, on: boolean): SetupProgress => ({
  ...p, skipped: on ? [...new Set([...p.skipped, key])] : p.skipped.filter((k) => k !== key),
});

/* ── Reading the facts (Dashboard card, Help → Setup checklist) ─────────────── */

/** Counts only, from the shared parsed rows (PERF-2: never copied). */
export function readChecklistInputs(): { facts: ChecklistFactsV3; ctx: ChecklistCtx } {
  const settings = localDb.settings.get();
  const profile = localDb.settings.activeProfile();
  const packs = activePacks(settings);
  const invoices = peekTable<{ pos?: boolean }>(KEYS.invoices);
  const packRecords: Partial<Record<PackId, number>> = {};
  for (const p of packs) packRecords[p] = peekTable(PACK_FIRST_TABLE[p]).length;
  const facts: ChecklistFactsV3 = {
    profileReady: !!settings.onboarded && Boolean(profile?.companyName?.trim()) && Boolean(profile?.upiId || profile?.accountNumber),
    clients: peekTable(KEYS.clients).length,
    items: peekTable(KEYS.items).length,
    invoices: invoices.length,
    messagesSent: peekTable<{ channel?: string }>('reminders').filter((r) => r && r.channel !== 'snooze').length,
    payments: peekTable(KEYS.transactions).length,
    lastBackup: readRaw(`${DB_PREFIX}last_backup`) ?? '',
    openings: peekTable('ledger_openings').length + peekTable('opening_bills').length,
    importRuns: peekTable(IMPORT_RUNS_TABLE).length,
    stockItems: peekTable('stock_items').length,
    posBills: invoices.filter((i) => i?.pos).length,
    packRecords,
    gstPeriods: peekTable('compliance').length,
    // R8-C: trading steps (counted only while their pack is on)
    ...(packs.includes('distributor') ? { scopedSchemes: peekTable<{ scope?: unknown }>('schemes').filter((r) => r?.scope).length } : {}),
    ...(packs.includes('commodity') ? { weightItems: peekTable<{ sold_by_weight_bags?: unknown }>('stock_items').filter((r) => r?.sold_by_weight_bags).length } : {}),
    ...(packs.includes('agency') ? { principals: peekTable<{ principal_kind?: unknown }>('vendors').filter((r) => r?.principal_kind).length } : {}),
  };
  const ctx: ChecklistCtx = {
    businessType: typeof settings.business_type === 'string' ? settings.business_type : undefined,
    packs,
    modules: enabledModules(settings),
    role: currentRole(),
    gstRegistered: Boolean(profile?.companyGstin?.trim()),
    ...(typeof settings.trade_kind === 'string' ? { tradeKind: settings.trade_kind } : {}),
  };
  return { facts, ctx };
}
