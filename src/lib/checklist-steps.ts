/**
 * R6-A1 setup checklist v3: a business-aware step catalogue. Which steps apply depends on the business type, the
 * active industry packs, the shop-mode modules and the role; whether a step is done is derived from the company's
 * data (so work done on another device counts). Only `skipped` and `hidden_at` are stored, in the company object
 * `mrchartist_inv_setup_progress` (backed up, synced as a singleton, not audited — viewing state): the owner's at the
 * top level, each clerk's under `byUser[<user id>]` (QA7 G10).
 *
 * Pure catalogue + builder (tests/onboarding.test.ts); `loadSetupProgress` / `saveSetupProgress` do the storage.
 */
import { PACK_TABS, activePacks, type PackId } from './industry-packs';
import { enabledModules, type ModuleId } from './shop-mode';
import { DB_PREFIX, KEYS, getJson, peekTable, readRaw, setJson } from './storage';
import { currentActor, currentRole, requireAccess } from './access';
import { localDb } from './localDb';

export type StepKind =
  | 'profile' | 'opening' | 'import' | 'client' | 'item' | 'posbill' | 'invoice' | 'packFirst' | 'whatsapp' | 'payment' | 'gstPeriod' | 'backup'
  // R8-C (TR-C5): trade profile and the trading packs' own steps
  | 'tradeProfile' | 'schemeScope' | 'weightItem' | 'principal'
  // R9 (RT-A1): retail profile and the steps of each shop (append-only)
  | 'retailProfile' | 'drugLicence' | 'doctor' | 'variantGrid' | 'serialItem' | 'metalRate' | 'jewelTag' | 'scaleOrBarcode'
  // R11 (CN-A1): construction profile and the steps of each kind (append-only)
  | 'constructionProfile' | 'contract' | 'boq' | 'realtyProject' | 'units' | 'paymentPlan' | 'labourContract'
  // R10 (SV-A1): service profile and the steps of each kind (append-only)
  | 'serviceProfile' | 'doctorProfile' | 'serviceMenu' | 'staff' | 'labTest' | 'memberPlan' | 'batch' | 'labourOp' | 'jobCard';

/** Catalogue order (the order steps are shown in). */
export const STEP_ORDER: readonly StepKind[] = ['profile', 'tradeProfile', 'retailProfile', 'opening', 'import', 'client', 'item', 'drugLicence', 'doctor', 'variantGrid', 'serialItem', 'metalRate', 'jewelTag', 'scaleOrBarcode', 'constructionProfile', 'contract', 'boq', 'realtyProject', 'units', 'paymentPlan', 'labourContract', 'serviceProfile', 'doctorProfile', 'serviceMenu', 'staff', 'labTest', 'memberPlan', 'batch', 'labourOp', 'jobCard', 'posbill', 'invoice', 'packFirst', 'principal', 'schemeScope', 'weightItem', 'whatsapp', 'payment', 'gstPeriod', 'backup'];

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
  /** R9 (RT-A1): `settings.retail_kind` (a kirana company without one gets "Pick your shop"). */
  retailKind?: string;
  /** R11 (CN-A1): `settings.construction_kind` (a contractor company without one gets "Pick your kind of construction business"). */
  constructionKind?: string;
  /** R10 (SV-A1): `settings.service_kind` (a services company without one gets "Pick your kind of service"). */
  serviceKind?: string;
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
  /** R9 (RT-A1): drug licences on file, doctors, styles with a size / colour grid, serial-tracked items, metal rates,
   *  jewellery tags, items with a barcode or sold by weight (each counted only when its shop applies). */
  drugLicences?: number;
  doctors?: number;
  variantStyles?: number;
  serialItems?: number;
  metalRates?: number;
  jewelTags?: number;
  barcodeItems?: number;
  /** R11 (CN-A1): contracts (CN-B table), BOQs (sales orders / quotations), builder projects, units and payment plans
   *  (CN-C tables) — each counted only when its kind applies. */
  contracts?: number;
  boqs?: number;
  realtyProjects?: number;
  realtyUnits?: number;
  paymentPlans?: number;
  /** R10 (SV-A1): the doctor's registration line on the profile, items with a service class, service staff, lab tests
   *  (SV-B), member plans / batches (SV-C), labour operations / job cards (SV-D) — each counted only when its kind applies. */
  regLine?: boolean;
  serviceItems?: number;
  serviceStaff?: number;
  labTests?: number;
  memberPlans?: number;
  batches?: number;
  labourOps?: number;
  jobCards?: number;
}

export interface SetupProgress {
  skipped: string[];
  hidden_at?: string;
}

/**
 * The stored object. The top level is the owner's (company-level) state, unchanged since R6-A1; QA7 G10 adds
 * `byUser`: each clerk's own skips and Hide, keyed by the local user id, so a clerk never changes the owner's card.
 */
export interface StoredSetupProgress extends SetupProgress {
  byUser?: Record<string, SetupProgress>;
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

/** The table whose first row completes a pack's first step (R9 retail packs have their own steps per shop instead). */
export const PACK_FIRST_TABLE: Readonly<Partial<Record<PackId, string>>> = {
  transport: 'consignment_notes',
  works: 'ra_measurements',
  fees: 'fee_plans',
  nonprofit: 'donations',
  leases: 'leases',
  marketplace: 'sales_channels',
  hotel: 'hotel_reservations', // R7-A
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
    case 'packFirst': return ctx.packs.some((p) => PACK_FIRST_TABLE[p]);
    case 'tradeProfile': return isType(ctx, 'wholesale') && !ctx.tradeKind; // R8-C: existing wholesale companies
    case 'schemeScope': return ctx.packs.includes('distributor');
    case 'weightItem': return ctx.packs.includes('commodity');
    case 'principal': return ctx.packs.includes('agency');
    // R9 (RT-A1): existing kirana companies get "Pick your shop"; each shop its own first steps
    case 'retailProfile': return isType(ctx, 'kirana') && !ctx.retailKind;
    case 'drugLicence': case 'doctor': return ctx.retailKind === 'pharmacy';
    case 'variantGrid': return ctx.retailKind === 'apparel';
    case 'serialItem': return ctx.retailKind === 'electronics';
    case 'metalRate': case 'jewelTag': return ctx.retailKind === 'jewellery';
    case 'scaleOrBarcode': return ctx.retailKind === 'grocery';
    // R11 (CN-A1): existing contractor companies get "Pick your kind of construction business"; each kind its steps
    case 'constructionProfile': return isType(ctx, 'contractor') && !ctx.constructionKind;
    case 'contract': return ctx.constructionKind === 'civil' || ctx.constructionKind === 'mep';
    case 'boq': return ['civil', 'mep', 'subcontractor', 'interiors'].includes(ctx.constructionKind ?? '');
    case 'realtyProject': case 'units': case 'paymentPlan': return ctx.constructionKind === 'builder';
    case 'labourContract': return ctx.constructionKind === 'labour';
    // R10 (SV-A1): existing services companies get "Pick your kind of service"; each kind its steps
    case 'serviceProfile': return isType(ctx, 'services') && !ctx.serviceKind;
    case 'doctorProfile': return ctx.serviceKind === 'clinic';
    case 'serviceMenu': return ctx.serviceKind === 'clinic' || ctx.serviceKind === 'salon';
    case 'staff': return ctx.serviceKind === 'salon' || ctx.serviceKind === 'fitness';
    case 'labTest': return ctx.serviceKind === 'lab';
    case 'memberPlan': return ctx.serviceKind === 'fitness';
    case 'batch': return ctx.serviceKind === 'coaching';
    case 'labourOp': case 'jobCard': return ctx.serviceKind === 'workshop' || ctx.serviceKind === 'appliance';
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
    case 'packFirst': return ctx.packs.filter((p) => PACK_FIRST_TABLE[p]).map((p) => ({ key: `packFirst:${p}`, kind, pack: p, done: (f.packRecords?.[p] ?? 0) > 0, to: packHref(p) }));
    case 'whatsapp': return one(f.messagesSent > 0, '/transactions');
    case 'payment': return one(f.payments > 0, '/transactions?filter=unpaid&pay=1');
    case 'gstPeriod': return one((f.gstPeriods ?? 0) > 0, '/gst-reports');
    case 'backup': return one(!!f.lastBackup, '/settings?tab=data');
    case 'tradeProfile': return one(!!ctx.tradeKind, '/settings?tab=features');
    case 'schemeScope': return one((f.scopedSchemes ?? 0) > 0, '/settings?tab=items');
    case 'weightItem': return one((f.weightItems ?? 0) > 0, '/inventory');
    case 'principal': return one((f.principals ?? 0) > 0, '/expenses?tab=vendors');
    // R9 (RT-A1)
    case 'retailProfile': return one(!!ctx.retailKind, '/settings?tab=features');
    case 'drugLicence': return one((f.drugLicences ?? 0) > 0, '/inventory?tab=pharmacy&view=registers');
    case 'doctor': return one((f.doctors ?? 0) > 0, '/inventory?tab=pharmacy&view=doctors');
    case 'variantGrid': return one((f.variantStyles ?? 0) > 0, '/inventory?tab=depth');
    case 'serialItem': return one((f.serialItems ?? 0) > 0, '/inventory');
    case 'metalRate': return one((f.metalRates ?? 0) > 0, '/inventory?tab=jewellery&view=rates');
    case 'jewelTag': return one((f.jewelTags ?? 0) > 0, '/inventory?tab=jewellery&view=tags');
    case 'scaleOrBarcode': return one((f.barcodeItems ?? 0) > 0, '/inventory');
    // R11 (CN-A1)
    case 'constructionProfile': return one(!!ctx.constructionKind, '/settings?tab=features');
    case 'contract': return one((f.contracts ?? 0) > 0, '/time?tab=works&view=contracts');
    case 'boq': return one((f.boqs ?? 0) > 0, '/time?tab=works&view=boq');
    case 'realtyProject': return one((f.realtyProjects ?? 0) > 0, '/receivables?tab=realty&view=projects');
    case 'units': return one((f.realtyUnits ?? 0) > 0, '/receivables?tab=realty&view=units');
    case 'paymentPlan': return one((f.paymentPlans ?? 0) > 0, '/receivables?tab=realty&view=plans');
    case 'labourContract': return one((f.contracts ?? 0) > 0, '/time?tab=works&view=labour');
    // R10 (SV-A1)
    case 'serviceProfile': return one(!!ctx.serviceKind, '/settings?tab=features');
    case 'doctorProfile': return one(!!f.regLine, '/settings');
    case 'serviceMenu': return one((f.serviceItems ?? 0) > 0, '/settings?tab=items');
    case 'staff': return one((f.serviceStaff ?? 0) > 0, '/time?tab=commission&view=staff');
    case 'labTest': return one((f.labTests ?? 0) > 0, '/time?tab=clinic&view=tests');
    case 'memberPlan': return one((f.memberPlans ?? 0) > 0, '/time?tab=members&view=plans');
    case 'batch': return one((f.batches ?? 0) > 0, '/recurring?tab=fees&view=batches');
    case 'labourOp': return one((f.labourOps ?? 0) > 0, '/time?tab=workshop&view=labour');
    case 'jobCard': return one((f.jobCards ?? 0) > 0, '/time?tab=workshop&view=jobs');
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

/** The whole stored object: the owner's state plus each clerk's (`byUser`, dropped when empty). */
export function normalizeStored(v: unknown): StoredSetupProgress {
  const top = normalizeProgress(v);
  const raw = v && typeof v === 'object' ? (v as StoredSetupProgress).byUser : undefined;
  const byUser: Record<string, SetupProgress> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [id, p] of Object.entries(raw)) if (id) byUser[id] = normalizeProgress(p);
  return Object.keys(byUser).length ? { ...top, byUser } : top;
}

/** QA7 G10: whose slot this tab reads and writes — a non-owner's own id, else the company level (owner, no PIN). */
const progressUser = (): string | null => {
  const actor = currentActor();
  return actor && actor.role !== 'owner' ? actor.id : null;
};

const loadStored = (): StoredSetupProgress => normalizeStored(getJson<unknown>(SETUP_PROGRESS_KEY, null));

/** The signed-in user's view: the owner's company-level state, or a clerk's own (empty until they act). */
export const loadSetupProgress = (): SetupProgress => {
  const stored = loadStored();
  const user = progressUser();
  return user ? (stored.byUser?.[user] ?? { skipped: [] }) : normalizeProgress(stored);
};

/**
 * Skip / un-skip a step, hide / un-hide the card. Clerks may write it (`doc.create`); viewers may not. A clerk's
 * change goes to their own `byUser` slot (QA7 G10); the owner's goes to the top level, as before.
 */
export function saveSetupProgress(next: SetupProgress): SetupProgress {
  requireAccess('doc.create');
  const clean = normalizeProgress(next);
  const stored = loadStored();
  const user = progressUser();
  const { byUser } = stored;
  setJson(SETUP_PROGRESS_KEY, user ? { ...normalizeProgress(stored), byUser: { ...byUser, [user]: clean } } : { ...clean, ...(byUser && { byUser }) });
  return clean;
}

export const withSkipped = (p: SetupProgress, key: string, on: boolean): SetupProgress => ({
  ...p, skipped: on ? [...new Set([...p.skipped, key])] : p.skipped.filter((k) => k !== key),
});

/* ── Reading the facts (Dashboard card, Help → Setup checklist) ─────────────── */

/** R9: drug licences on file — RT-B's `pharma_settings.licences`, else the profile's printed licence text. */
function drugLicenceCount(profileText: unknown): number {
  const ph = getJson<{ licences?: unknown } | null>(`${DB_PREFIX}pharma_settings`, null);
  const n = Array.isArray(ph?.licences) ? ph.licences.length : 0;
  return n || (typeof profileText === 'string' && profileText.trim() ? 1 : 0);
}

/** Counts only, from the shared parsed rows (PERF-2: never copied). */
export function readChecklistInputs(): { facts: ChecklistFactsV3; ctx: ChecklistCtx } {
  const settings = localDb.settings.get();
  const profile = localDb.settings.activeProfile();
  const packs = activePacks(settings);
  const invoices = peekTable<{ pos?: boolean }>(KEYS.invoices);
  const packRecords: Partial<Record<PackId, number>> = {};
  for (const p of packs) {
    const table = PACK_FIRST_TABLE[p];
    if (table) packRecords[p] = peekTable(table).length;
  }
  const retailKind = typeof settings.retail_kind === 'string' ? settings.retail_kind : undefined;
  const stock = retailKind ? peekTable<{ track_serials?: unknown; variant_axes?: unknown; barcode?: unknown; sold_by_weight?: unknown }>('stock_items') : [];
  const cnRaw = (settings as { construction_kind?: unknown }).construction_kind; // R11 (CN-A1)
  const cnKind = typeof cnRaw === 'string' ? cnRaw : undefined;
  const svKind = typeof settings.service_kind === 'string' ? settings.service_kind : undefined; // R10 (SV-A1)
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
    // R9 (RT-A1): each shop's first steps (read only for that shop)
    ...(retailKind === 'pharmacy' ? { drugLicences: drugLicenceCount(profile?.drug_licence), doctors: peekTable('doctors').length } : {}),
    ...(retailKind === 'apparel' ? { variantStyles: stock.filter((r) => Array.isArray(r?.variant_axes) && r.variant_axes.length).length } : {}),
    ...(retailKind === 'electronics' ? { serialItems: stock.filter((r) => r?.track_serials).length } : {}),
    ...(retailKind === 'jewellery' ? { metalRates: peekTable('metal_rates').length, jewelTags: peekTable('jewel_tags').length } : {}),
    // R11 (CN-A1): construction steps (read only for that kind)
    ...(cnKind === 'civil' || cnKind === 'mep' || cnKind === 'labour' ? { contracts: peekTable('works_contracts').length } : {}),
    ...(cnKind && cnKind !== 'builder' && cnKind !== 'labour' && cnKind !== 'other' ? { boqs: peekTable<{ doc_type?: string; status?: string }>(KEYS.invoices).filter((r) => (r?.doc_type === 'SALES_ORDER' || r?.doc_type === 'QUOTATION') && r.status !== 'Cancelled').length } : {}),
    // R10 (SV-A1): service steps (read only for that kind; SV-B / C / D tables count once their package writes them)
    ...(svKind === 'clinic' ? { regLine: Boolean(profile?.regLine?.trim()) } : {}),
    ...(svKind === 'clinic' || svKind === 'salon' ? { serviceItems: [...peekTable<{ sv_class?: unknown }>(KEYS.items), ...peekTable<{ sv_class?: unknown }>('stock_items')].filter((r) => r?.sv_class).length } : {}),
    ...(svKind === 'salon' || svKind === 'fitness' ? { serviceStaff: peekTable('service_staff').length } : {}),
    ...(svKind === 'lab' ? { labTests: peekTable('lab_tests').length } : {}),
    ...(svKind === 'fitness' ? { memberPlans: peekTable('member_plans').length } : {}),
    ...(svKind === 'coaching' ? { batches: peekTable('class_schedules').length } : {}),
    ...(svKind === 'workshop' || svKind === 'appliance' ? { labourOps: peekTable('labour_ops').length, jobCards: peekTable('service_jobs').length } : {}),
    ...(cnKind === 'builder' ? { realtyProjects: peekTable('realty_projects').length, realtyUnits: peekTable('realty_units').length, paymentPlans: peekTable('payment_plans').length } : {}),
    ...(retailKind === 'grocery' ? { barcodeItems: stock.filter((r) => r?.barcode || r?.sold_by_weight).length + peekTable<{ barcode?: unknown; sold_by_weight?: unknown }>(KEYS.items).filter((r) => r?.barcode || r?.sold_by_weight).length } : {}),
  };
  const ctx: ChecklistCtx = {
    businessType: typeof settings.business_type === 'string' ? settings.business_type : undefined,
    packs,
    modules: enabledModules(settings),
    role: currentRole(),
    gstRegistered: Boolean(profile?.companyGstin?.trim()),
    ...(typeof settings.trade_kind === 'string' ? { tradeKind: settings.trade_kind } : {}),
    ...(retailKind ? { retailKind } : {}),
    ...(cnKind ? { constructionKind: cnKind } : {}),
    ...(svKind ? { serviceKind: svKind } : {}),
  };
  return { facts, ctx };
}
