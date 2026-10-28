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
  | 'serviceProfile' | 'doctorProfile' | 'serviceMenu' | 'staff' | 'labTest' | 'memberPlan' | 'batch' | 'labourOp' | 'jobCard'
  // R12 (AG-A1): the steps of each agri kind (append-only; existing companies have no `agri_kind`, so none fire)
  | 'farmers' | 'rateChart' | 'firstShift' | 'millBom' | 'cmrAgreement' | 'chambers' | 'rentPlan' | 'agriLicence' | 'shareCapital' | 'farmBatch'
  // R13 (MF-A1): the steps of each manufacturing kind (append-only; only with `mfg_kind`)
  | MfStep
  // R14 (PS-A1): the professional steps (append-only; only with `prof_kind`; B–D append theirs)
  | PsStep
  // R15-B1: the travel steps (append-only; only with `travel_kind`)
  | TvStep
  // R17-A1: the manpower steps (append-only; only with `manpower_kind`; B–D append theirs)
  | MpStep
  // R18-A1: the society steps (append-only; only with `society_kind`; B–D append theirs)
  | HsStep
  // R19-A1: the logistics steps (append-only; only with `logistics_kind`; C / D append theirs)
  | LgStep;

/** Catalogue order (the order steps are shown in). */
export const STEP_ORDER: readonly StepKind[] = ['profile', 'tradeProfile', 'retailProfile', 'serviceProfile', 'opening', 'import', 'client', 'item', 'drugLicence', 'doctor', 'variantGrid', 'serialItem', 'metalRate', 'jewelTag', 'scaleOrBarcode', 'constructionProfile', 'contract', 'boq', 'realtyProject', 'units', 'paymentPlan', 'labourContract', 'doctorProfile', 'serviceMenu', 'staff', 'labTest', 'memberPlan', 'batch', 'labourOp', 'jobCard', 'farmers', 'rateChart', 'firstShift', 'millBom', 'cmrAgreement', 'chambers', 'rentPlan', 'agriLicence', 'shareCapital', 'farmBatch', 'workCentres', 'udyam', 'firstDrawing', 'firstStyle', 'fabricators', 'firstMould', 'pressMaster', 'fssai', 'shelfLife', 'firstMatter', 'staffCapacity', 'enrolment', 'conflictCheck', 'lut', 'edf', 'clientMoneyBank', 'stageTemplate', 'feeSchedule', 'linkCompanies', 'partners', 'firstTrip', 'firstEvent', 'firstSupplier', 'regime', 'firstStatement', 'firstSite', 'firstMuster', 'firstBill', 'siteProof', 'licence', 'societyUnits', 'societyTariff', 'societyRun', 'societyFunds', 'societyAudit', 'lgHeads', 'lgJob', 'lgBill', 'lgManifest', 'posbill', 'invoice', 'packFirst', 'principal', 'schemeScope', 'weightItem', 'whatsapp', 'payment', 'gstPeriod', 'backup'];

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
  /** R12 (AG-A1): `settings.agri_kind` / `settings.mill_kind`. */
  agriKind?: string;
  millKind?: string;
  /** R13 (MF-A1): `settings.mfg_kind`. */
  mfgKind?: string;
  /** R14 (PS-A1): `settings.prof_kind`. */
  profKind?: string;
  /** R15-B1: `settings.travel_kind`. */
  travelKind?: string;
  /** R17-A1: `settings.manpower_kind`. */
  manpowerKind?: string;
  /** R18-A1: `settings.society_kind`. */
  societyKind?: string;
  /** R19-A1: `settings.logistics_kind`. */
  logisticsKind?: string;
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
  /** R12 (AG-A1): rows per agri step (farmers, rate charts, shifts, BOMs, CMR agreements, chambers, rent plans,
   *  licences, member shares, farm batches) — counted only for the kind that has the step. */
  agri?: Partial<Record<AgriStep, number>>;
  /** R13 (MF-A1): rows per manufacturing step (work centres, Udyam / FSSAI on the profile, drawings, styles, karigars,
   *  moulds, presses, items with shelf life) — counted only for the kind that has the step. */
  mfg?: Partial<Record<MfStep, number>>;
  /** R14 (PS-A1): rows per professional step (matters, timekeepers with capacity, the enrolment no., conflict checks). */
  prof?: Partial<Record<PsStep, number>>;
  /** R15-B1: rows per travel step (trip / event files, bookings with a supplier, regime chosen, statement imports). */
  travel?: Partial<Record<TvStep, number>>;
  /** R17-A1: rows per manpower step (sites, bills with a service month). */
  manpower?: Partial<Record<MpStep, number>>;
  /** R18-A1: rows per society step (units, tariff heads). */
  society?: Partial<Record<HsStep, number>>;
  /** R19-A1: rows per logistics step (heads, jobs, invoices of a job). */
  logistics?: Partial<Record<LgStep, number>>;
}

/** R15-B1: the travel steps, the kinds that have them and where each opens. */
type TvStep = 'firstTrip' | 'firstSupplier' | 'regime' | 'firstStatement' | 'firstEvent';
const TV_STEPS: Readonly<Record<TvStep, [kinds: string, to: string]>> = {
  firstTrip: ['tour_operator agent inbound events other', '/time?tab=trips&view=trips'],
  firstSupplier: ['tour_operator agent inbound events other', '/time?tab=trips&view=trips'],
  regime: ['tour_operator', '/time?tab=trips&view=trips'],
  firstStatement: ['agent', '/settings?tab=data&import=1'],
  firstEvent: ['events', '/time?tab=trips&view=trips'],
};
const isTvStep = (k: string): k is TvStep => Object.hasOwn(TV_STEPS, k);

/** R17-A1: the manpower steps, the kinds that have them and where each opens (B: firstMuster; C: compliance; D: licence). */
type MpStep = 'firstSite' | 'firstBill' | 'firstMuster' | 'siteProof' | 'licence';
const MP_STEPS: Readonly<Record<MpStep, [kinds: string, to: string]>> = {
  firstSite: ['security facility staffing labour other', '/time?tab=deploy&view=sites'],
  firstBill: ['security facility staffing labour other', '/time?tab=deploy&view=bills'],
  firstMuster: ['security facility staffing labour other', '/time?tab=deploy&view=muster'], // R17-B
  siteProof: ['security facility staffing labour other', '/time?tab=deploy&view=compliance'], // R17-C
  licence: ['security labour', '/time?tab=deploy&view=statutory'], // R17-D: PSARA / contract-labour licence
};
const isMpStep = (k: string): k is MpStep => Object.hasOwn(MP_STEPS, k);

/** R18-A1: the society steps (every kind) and where each opens (B: societyRun; D: societyFunds, societyAudit). */
type HsStep = 'societyUnits' | 'societyTariff' | 'societyRun' | 'societyFunds' | 'societyAudit'; // R18-B: societyRun; R18-D: funds, audit
const HS_STEPS: Readonly<Record<HsStep, string>> = {
  societyUnits: '/recurring?tab=society&view=units',
  societyTariff: '/recurring?tab=society&view=heads',
  societyRun: '/recurring?tab=society&view=bills', // R18-B
  societyFunds: '/recurring?tab=society&view=funds', // R18-D
  societyAudit: '/recurring?tab=society&view=registers',
};
const isHsStep = (k: string): k is HsStep => Object.hasOwn(HS_STEPS, k);

/** R19-A1: the logistics steps (job steps not for a courier / warehouse kind) and the desk view each opens (C: lgDeposit; D: lgManifest). */
type LgStep = 'lgHeads' | 'lgJob' | 'lgBill' | 'lgManifest';
/** D's step carries the pack it needs (`courier`). */
const LG_STEPS: Readonly<Record<LgStep, [jobKindsOnly: boolean, view: string, pack?: string]>> = { lgHeads: [false, 'rates'], lgJob: [true, 'jobs'], lgBill: [true, 'jobs'], lgManifest: [false, 'courier', 'courier'] };
const isLgStep = (k: string): k is LgStep => Object.hasOwn(LG_STEPS, k);

/** R14 (PS-A1): the professional steps, the kinds that have them and where each opens. */
type PsStep = 'firstMatter' | 'staffCapacity' | 'enrolment' | 'conflictCheck'
  | 'feeSchedule' | 'linkCompanies' | 'partners' // R14 (PS-D): CA fee schedule and company links; partners of a firm
  | 'clientMoneyBank' | 'stageTemplate' // R14 (PS-B)
  | 'lut' | 'edf'; // R14 (PS-C): LUT register, first EDF (pack `svcexport`)
const PS_STEPS: Readonly<Record<PsStep, [kinds: string, to: string]>> = {
  firstMatter: ['ca legal design consulting agency freelancer other', '/time?tab=matters&view=matters'],
  staffCapacity: ['ca legal design consulting agency freelancer other', '/time?tab=wip&view=utilisation'],
  enrolment: ['legal', '/settings?tab=features'],
  conflictCheck: ['legal', '/time?tab=matters&view=conflicts'],
  // PS-D (`partners` only with the partners pack)
  feeSchedule: ['ca', '/time?tab=cadesk&view=fees'],
  linkCompanies: ['ca', '/time?tab=cadesk&view=fees'],
  partners: ['ca legal design consulting agency freelancer other', '/time?tab=firm&view=partners'],
  // PS-B: a client-money account (law firm; skippable) and the stage template (design)
  clientMoneyBank: ['legal', '/reconcile?tab=statements'],
  stageTemplate: ['design', '/time?tab=matters&view=stages'],
  // PS-C (any kind with the `svcexport` pack): the LUT register, the first EDF
  lut: ['@svcexport', '/settings?tab=business'],
  edf: ['@svcexport', '/time?tab=exportsvc&view=edf'],
};
const isPsStep = (k: string): k is PsStep => Object.hasOwn(PS_STEPS, k);

/** R13 (MF-A1): the manufacturing steps, the kinds that have them and where each opens. */
type MfStep = 'workCentres' | 'udyam' | 'firstDrawing' | 'firstStyle' | 'fabricators' | 'firstMould' | 'pressMaster' | 'fssai' | 'shelfLife';
const MF_ALL = 'engineering textile plastics printing food other';
const MF_STEPS: Readonly<Record<MfStep, [kinds: string, to: string]>> = {
  workCentres: [MF_ALL, '/manufacturing?tab=floor&view=centres'],
  udyam: [MF_ALL, '/settings?tab=defaults'],
  firstDrawing: ['engineering', '/manufacturing?tab=shop&view=drawings'],
  firstStyle: ['textile', '/manufacturing?tab=garments&view=styles'],
  fabricators: ['textile', '/manufacturing?tab=garments&view=karigars'],
  firstMould: ['plastics', '/manufacturing?tab=moulding&view=runs'],
  pressMaster: ['printing', '/manufacturing?tab=press&view=estimates'],
  fssai: ['food', '/settings?tab=defaults'],
  shelfLife: ['food', '/manufacturing?tab=food&view=shelflife'],
};
const isMfStep = (k: string): k is MfStep => Object.hasOwn(MF_STEPS, k);

/** R12 (AG-A1): the agri steps, the kinds that have them and where each opens. */
type AgriStep = 'farmers' | 'rateChart' | 'firstShift' | 'millBom' | 'cmrAgreement' | 'chambers' | 'rentPlan' | 'agriLicence' | 'shareCapital' | 'farmBatch';
const AGRI_STEPS: Readonly<Record<AgriStep, [kinds: string, to: string]>> = {
  farmers: ['fpo coop dairy mill cold inputs farm other', '/inventory?tab=farm&view=farmers'],
  rateChart: ['dairy', '/inventory?tab=dairy&view=charts'],
  firstShift: ['dairy', '/inventory?tab=dairy&view=collection'],
  millBom: ['mill', '/manufacturing?tab=boms'],
  cmrAgreement: ['mill:rice', '/inventory?tab=mill&view=cmr'],
  chambers: ['cold', '/inventory?tab=cold&view=chambers'],
  rentPlan: ['cold', '/inventory?tab=cold&view=rent'],
  agriLicence: ['inputs', '/inventory?tab=inputs&view=licences'],
  shareCapital: ['fpo coop', '/inventory?tab=members&view=shares'],
  farmBatch: ['farm', '/inventory?tab=farm&view=batches'],
};
const isAgriStep = (k: string): k is AgriStep => Object.hasOwn(AGRI_STEPS, k);
const agriApplies = (k: AgriStep, ctx: ChecklistCtx): boolean =>
  !!ctx.agriKind && AGRI_STEPS[k][0].split(' ').some((x) => x === ctx.agriKind || x === `${ctx.agriKind}:${ctx.millKind ?? 'rice'}`);

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
    case 'partners': return !!ctx.profKind && (ctx.packs ?? []).includes('partners'); // R14 (PS-D1)
    default: return isLgStep(kind) ? !!ctx.logisticsKind && (LG_STEPS[kind][2] ? (ctx.packs as readonly string[] ?? []).includes(LG_STEPS[kind][2]!) : !LG_STEPS[kind][0] || !/courier|warehouse/.test(ctx.logisticsKind)) : isHsStep(kind) ? !!ctx.societyKind : isMpStep(kind) ? !!ctx.manpowerKind && MP_STEPS[kind][0].split(' ').includes(ctx.manpowerKind) : isTvStep(kind) ? !!ctx.travelKind && TV_STEPS[kind][0].split(' ').includes(ctx.travelKind) : isPsStep(kind) ? !!ctx.profKind && (PS_STEPS[kind][0] === '@svcexport' ? ctx.packs.includes('svcexport') : PS_STEPS[kind][0].split(' ').includes(ctx.profKind)) : isMfStep(kind) ? !!ctx.mfgKind && MF_STEPS[kind][0].split(' ').includes(ctx.mfgKind) : isAgriStep(kind) ? agriApplies(kind, ctx) : true; // profile, item, payment, backup; R12 agri / R13 mfg steps
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
    default: return isLgStep(kind) ? one((f.logistics?.[kind] ?? 0) > 0, `/time?tab=shipments&view=${LG_STEPS[kind][1]}`) : isHsStep(kind) ? one((f.society?.[kind] ?? 0) > 0, HS_STEPS[kind]) : isMpStep(kind) ? one((f.manpower?.[kind] ?? 0) > 0, MP_STEPS[kind][1]) : isTvStep(kind) ? one((f.travel?.[kind] ?? 0) > 0, TV_STEPS[kind][1]) : isPsStep(kind) ? one((f.prof?.[kind] ?? 0) > 0, PS_STEPS[kind][1]) : isMfStep(kind) ? one((f.mfg?.[kind] ?? 0) > 0, MF_STEPS[kind][1]) : one((f.agri?.[kind] ?? 0) > 0, AGRI_STEPS[kind][1]); // R12 (AG-A1), R13 (MF-A1)
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

/** R12 (AG-A1): rows behind each agri step (farmers = vendors / clients with `ag`; chambers / licences in `agri_settings`). */
function agriFacts(kind: string): Partial<Record<AgriStep, number>> {
  const ag = getJson<{ chambers?: unknown[]; licences?: unknown[] } | null>(`${DB_PREFIX}agri_settings`, null);
  const n = (t: string) => peekTable(t).length;
  const out: Partial<Record<AgriStep, number>> = { farmers: [...peekTable<{ ag?: unknown }>('vendors'), ...peekTable<{ ag?: unknown }>(KEYS.clients)].filter((r) => r?.ag).length };
  if (kind === 'dairy') Object.assign(out, { rateChart: n('milk_rate_charts'), firstShift: n('milk_shifts') });
  if (kind === 'mill') Object.assign(out, { millBom: n('boms'), cmrAgreement: n('cmr_agreements') });
  if (kind === 'cold') Object.assign(out, { chambers: ag?.chambers?.length ?? 0, rentPlan: n('cold_rent_plans') });
  if (kind === 'inputs') out.agriLicence = ag?.licences?.length ?? 0;
  if (kind === 'fpo' || kind === 'coop') out.shareCapital = n('member_shares');
  if (kind === 'farm') out.farmBatch = n('farm_batches');
  return out;
}

/** R13 (MF-A1): rows behind each manufacturing step (B–D tables count once their package writes them). */
function mfgFacts(kind: string, profile: { msme_udyam?: string; fssai_no?: string } | undefined): Partial<Record<MfStep, number>> {
  const mf = getJson<{ moulds?: unknown[]; presses?: unknown[] } | null>(`${DB_PREFIX}mfg_settings`, null);
  const out: Partial<Record<MfStep, number>> = { workCentres: peekTable('work_centres').length, udyam: profile?.msme_udyam ? 1 : 0 };
  if (kind === 'engineering') out.firstDrawing = peekTable('drawings').length;
  if (kind === 'textile') Object.assign(out, { firstStyle: peekTable<{ mf?: { style?: string } }>('stock_items').filter((r) => r?.mf?.style).length, fabricators: peekTable<{ mf?: { karigar?: boolean } }>('vendors').filter((r) => r?.mf?.karigar).length });
  if (kind === 'plastics') out.firstMould = mf?.moulds?.length ?? 0;
  if (kind === 'printing') out.pressMaster = mf?.presses?.length ?? 0;
  if (kind === 'food') Object.assign(out, { fssai: profile?.fssai_no ? 1 : 0, shelfLife: peekTable<{ shelf_life_days?: number }>('stock_items').filter((r) => (r?.shelf_life_days ?? 0) > 0).length });
  return out;
}

/** R14 (PS-A1): rows behind each professional step (B–D append theirs). */
function profFacts(): Partial<Record<PsStep, number>> {
  const ps = getJson<{ legal?: { enrolment?: string } } | null>(`${DB_PREFIX}prof_settings`, null);
  return {
    firstMatter: peekTable<{ ps?: { code?: string } }>('cost_centres').filter((c) => c?.ps?.code).length,
    staffCapacity: peekTable<{ ps?: { capacity_hours_week?: number } }>('service_staff').filter((s) => (s?.ps?.capacity_hours_week ?? 0) > 0).length,
    enrolment: ps?.legal?.enrolment ? 1 : 0,
    conflictCheck: peekTable('conflict_checks').length,
    // PS-D
    feeSchedule: peekTable<{ ps?: { fee_event?: string } }>('items_catalog').filter((i) => i?.ps?.fee_event).length,
    linkCompanies: (ps as { ca?: { company_clients?: unknown[] } } | null)?.ca?.company_clients?.length ?? 0,
    partners: peekTable('partners').length,
    clientMoneyBank: peekTable<{ client_money?: boolean }>('bank_accounts').filter((a) => a?.client_money).length, // PS-B
    stageTemplate: peekTable<{ stage?: unknown }>('engagements').filter((e) => e?.stage).length,
    lut: peekTable('lut_register').length, // PS-C
    edf: peekTable('edf_register').length,
  };
}

/** R15-B1: rows behind each travel step. */
function travelFacts(): Partial<Record<TvStep, number>> {
  const trips = peekTable<{ tv?: { kind?: string } }>('cost_centres').filter((c) => c?.tv);
  return {
    firstTrip: trips.length,
    firstEvent: trips.filter((c) => c.tv?.kind === 'event').length,
    firstSupplier: peekTable<{ vendor_id?: string }>('travel_bookings').filter((b) => b?.vendor_id).length,
    regime: getJson<{ regime_ok?: boolean } | null>(`${DB_PREFIX}travel_settings`, null)?.regime_ok ? 1 : 0,
    firstStatement: peekTable<{ kind?: string }>(IMPORT_RUNS_TABLE).filter((r) => r?.kind === 'supplier_statement').length,
  };
}

/** R17-A1: rows behind each manpower step (sites = cost centres with `mp`; bills = invoices with a service month). */
function manpowerFacts(): Partial<Record<MpStep, number>> {
  return {
    firstSite: peekTable<{ mp?: unknown }>('cost_centres').filter((c) => c?.mp).length,
    firstBill: peekTable<{ mp?: { month?: string } }>(KEYS.invoices).filter((r) => r?.mp?.month).length,
    firstMuster: peekTable('site_musters').length, // R17-B
    siteProof: peekTable('site_compliance').length, // R17-C
    licence: getJson<{ licences?: unknown[] } | null>(`${DB_PREFIX}manpower_settings`, null)?.licences?.length ?? 0, // R17-D
  };
}

/** R18-A1: rows behind each society step (units; heads in the society settings). */
function societyFacts(): Partial<Record<HsStep, number>> {
  const hs = getJson<{ heads?: unknown[]; funds?: object; audit?: unknown[] } | null>(`${DB_PREFIX}society_settings`, null);
  return {
    societyUnits: peekTable('society_units').length,
    societyTariff: hs?.heads?.length ?? 0,
    societyRun: peekTable('society_runs').length, // R18-B
    societyFunds: Object.keys(hs?.funds ?? {}).length, // R18-D
    societyAudit: hs?.audit?.length ?? 0,
  };
}

/** R19-A1: rows behind each logistics step (heads in the logistics settings, jobs, invoices of a job). */
function logisticsFacts(invoices: readonly { lg?: { job_id?: unknown } }[]): Partial<Record<LgStep, number>> {
  return {
    lgHeads: getJson<{ heads?: unknown[] } | null>(`${DB_PREFIX}logistics_settings`, null)?.heads?.length ?? 0,
    lgJob: peekTable('lg_jobs').length,
    lgBill: invoices.filter((r) => r?.lg?.job_id).length,
    lgManifest: peekTable('lg_manifests').length, // R19-D
  };
}

/** Counts only, from the shared parsed rows (PERF-2: never copied). */
export function readChecklistInputs(): { facts: ChecklistFactsV3; ctx: ChecklistCtx } {
  const settings = localDb.settings.get();
  const profile = localDb.settings.activeProfile();
  const packs = activePacks(settings);
  const invoices = peekTable<{ pos?: boolean; lg?: { job_id?: unknown } }>(KEYS.invoices);
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
  const agKind = typeof settings.agri_kind === 'string' ? settings.agri_kind : undefined; // R12 (AG-A1)
  const mfKind = typeof settings.mfg_kind === 'string' ? settings.mfg_kind : undefined; // R13 (MF-A1)
  const psKind = typeof settings.prof_kind === 'string' ? settings.prof_kind : undefined; // R14 (PS-A1)
  const tvKind = typeof settings.travel_kind === 'string' ? settings.travel_kind : undefined; // R15-B1
  const mpKind = typeof settings.manpower_kind === 'string' ? settings.manpower_kind : undefined; // R17-A1
  const hsKind = typeof settings.society_kind === 'string' ? settings.society_kind : undefined; // R18-A1
  const lgKind = typeof settings.logistics_kind === 'string' ? settings.logistics_kind : undefined; // R19-A1
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
    // R12 (AG-A1): agri steps (read only for an agri company; B–D tables count once their package writes them)
    ...(agKind ? { agri: agriFacts(agKind) } : {}),
    ...(mfKind ? { mfg: mfgFacts(mfKind, profile ?? undefined) } : {}), // R13 (MF-A1)
    ...(psKind ? { prof: profFacts() } : {}), // R14 (PS-A1)
    ...(tvKind ? { travel: travelFacts() } : {}), // R15-B1
    ...(mpKind ? { manpower: manpowerFacts() } : {}), // R17-A1
    ...(hsKind ? { society: societyFacts() } : {}), // R18-A1
    ...(lgKind ? { logistics: logisticsFacts(invoices) } : {}), // R19-A1
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
    ...(agKind ? { agriKind: agKind, ...(typeof settings.mill_kind === 'string' ? { millKind: settings.mill_kind } : {}) } : {}),
    ...(mfKind ? { mfgKind: mfKind } : {}), // R13 (MF-A1)
    ...(psKind ? { profKind: psKind } : {}), // R14 (PS-A1)
    ...(tvKind ? { travelKind: tvKind } : {}), // R15-B1
    ...(mpKind ? { manpowerKind: mpKind } : {}), // R17-A1
    ...(hsKind ? { societyKind: hsKind } : {}), // R18-A1
    ...(lgKind ? { logisticsKind: lgKind } : {}), // R19-A1
  };
  return { facts, ctx };
}
