/**
 * Shop mode presets (8H): business types, their module lists and the Dashboard tile map.
 * Only lazy screens (setup wizard, Settings, Dashboard tiles) import this; the shell needs only `shop-mode.ts`.
 */
import { ALL_MODULES, type BusinessType, type ModuleId, type ShopModeSettings } from './shop-mode';
import type { PackId } from './industry-packs';
import type { MfgSub } from '../types/mfg-r13';

export const BUSINESS_TYPES: readonly BusinessType[] = [
  'kirana', 'restaurant', 'wholesale', 'services', 'manufacturer', 'full',
  // R5-A1: industry packs (listed after the existing types)
  'ecommerce', 'transport', 'contractor', 'institution', 'nonprofit', 'property',
  'hotel', // R7-A
];

/** R5-A1: the six industry-pack business types (their labels live in the pack i18n area). */
export const PACK_BUSINESS_TYPES: readonly BusinessType[] = ['ecommerce', 'transport', 'contractor', 'institution', 'nonprofit', 'property',
  'hotel', // R7-A
];

export const PRESETS: Readonly<Record<BusinessType, readonly ModuleId[]>> = {
  kirana: ['pos', 'purchases', 'inventory', 'reports'],
  wholesale: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'loans'],
  services: ['recurring', 'time', 'purchases', 'reports', 'gst', 'tds', 'design'],
  manufacturer: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'loans'],
  full: ALL_MODULES,
  // R3-A: café / dhaba / restaurant — tables & KOT live under the POS module.
  restaurant: ['pos', 'inventory', 'reports'],
  // R5-A1: industry packs — the pack itself (`industry-packs.ts`) adds the vertical's tabs on these modules' routes.
  ecommerce: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds'],
  transport: ['purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'loans'],
  contractor: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'time'],
  institution: ['recurring', 'purchases', 'accounts', 'reports', 'gst', 'payroll'],
  nonprofit: ['recurring', 'purchases', 'accounts', 'banking', 'reports', 'tds', 'payroll'],
  property: ['recurring', 'accounts', 'banking', 'reports', 'gst', 'tds'],
  // R7-A: hotel / lodge / homestay — the front desk lives on /tables (POS module)
  hotel: ['pos', 'inventory', 'purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll'],
};

/** Dashboard tile → module. Tiles not listed are always available. */
const TILE_MODULE: Readonly<Record<string, ModuleId>> = {
  payables: 'purchases',
  cashBank: 'accounts',
  gstDue: 'gst',
  lowStock: 'inventory',
  topItems: 'inventory',
  branches: 'accounts',
  amcDue: 'recurring',
  loyalty: 'pos',
  pharma: 'inventory',
};

export function isBusinessType(v: unknown): v is BusinessType {
  return typeof v === 'string' && (BUSINESS_TYPES as readonly string[]).includes(v);
}

export function isTileVisible(tile: string, modules: ReadonlySet<ModuleId> | null): boolean {
  if (!modules) return true;
  const m = Object.prototype.hasOwnProperty.call(TILE_MODULE, tile) ? TILE_MODULE[tile] : undefined;
  return !m || modules.has(m);
}

/** Settings patch for a business type: its preset (full = no filter). */
export function applyBusinessType(type: BusinessType): ShopModeSettings {
  return type === 'full' ? { business_type: type, modules: undefined } : { business_type: type, modules: [...PRESETS[type]] };
}


/** Starting defaults per business type (8H wizard): due days, invoice design and the first screen after setup. */
export interface BusinessDefaults {
  defaultDueDays: number;
  templateId: string;
  /** Where the wizard lands: a kirana counter goes straight to POS. */
  landing: string;
}

export const BUSINESS_DEFAULTS: Readonly<Record<BusinessType, BusinessDefaults>> = {
  kirana: { defaultDueDays: 0, templateId: 'retail_receipt', landing: '/pos' },
  wholesale: { defaultDueDays: 30, templateId: 'gst_tax_invoice', landing: '/invoice' },
  services: { defaultDueDays: 15, templateId: 'freelancer_light', landing: '/invoice' },
  manufacturer: { defaultDueDays: 30, templateId: 'corporate_navy', landing: '/invoice' },
  full: { defaultDueDays: 14, templateId: 'classic_orange', landing: '/invoice' },
  restaurant: { defaultDueDays: 0, templateId: 'compact_receipt', landing: '/tables' },
  // R5-A1: industry packs land on their pack's tab
  ecommerce: { defaultDueDays: 0, templateId: 'gst_tax_invoice', landing: '/receivables?tab=marketplace' },
  transport: { defaultDueDays: 30, templateId: 'gst_tax_invoice', landing: '/distribution?tab=transport' },
  contractor: { defaultDueDays: 30, templateId: 'corporate_navy', landing: '/time?tab=works' },
  institution: { defaultDueDays: 10, templateId: 'freelancer_light', landing: '/recurring?tab=fees' },
  nonprofit: { defaultDueDays: 0, templateId: 'classic_orange', landing: '/receivables?tab=donations' },
  property: { defaultDueDays: 7, templateId: 'gst_tax_invoice', landing: '/recurring?tab=leases' },
  hotel: { defaultDueDays: 0, templateId: 'gst_tax_invoice', landing: '/tables?tab=frontdesk' }, // R7-A
};

/** Settings after the wizard: shop-mode modules plus the type's default due days. */
export function applyBusinessDefaults<S extends ShopModeSettings & { defaultDueDays: number }>(settings: S, type: BusinessType): S {
  return { ...settings, ...applyBusinessType(type), defaultDueDays: BUSINESS_DEFAULTS[type].defaultDueDays };
}

/* ── R8-C (TR-C5): trade profile under the `wholesale` business type ── */

/** The trade picker's four choices (stored as `settings.trade_kind`); the business type stays `wholesale`. */
export const TRADE_KINDS = ['distributor', 'wholesaler', 'commodity', 'agent'] as const;
export type TradeKindId = (typeof TRADE_KINDS)[number];

export interface TradeProfile {
  modules: readonly ModuleId[];
  /** Explicit `industry_packs` list (an empty list = none, so a wholesaler gets no trading pack). */
  packs: readonly ('distributor' | 'commodity' | 'agency')[];
  landing: string;
  defaultDueDays: number;
  templateId: string;
  trade_discounts: boolean;
  returnable_packaging: boolean;
}

export const TRADE_PROFILES: Readonly<Record<TradeKindId, TradeProfile>> = {
  distributor: { modules: PRESETS.wholesale.filter((m) => m !== 'pos' && m !== 'recurring'), packs: ['distributor'], landing: '/distribution?tab=claims', defaultDueDays: 21, templateId: 'gst_tax_invoice', trade_discounts: true, returnable_packaging: true },
  wholesaler: { modules: PRESETS.wholesale, packs: [], landing: '/invoice', defaultDueDays: 30, templateId: 'gst_tax_invoice', trade_discounts: true, returnable_packaging: false },
  commodity: { modules: PRESETS.wholesale, packs: ['commodity'], landing: '/invoice', defaultDueDays: 15, templateId: 'gst_tax_invoice', trade_discounts: false, returnable_packaging: true },
  agent: { modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds'], packs: ['agency', 'commodity'], landing: '/distribution?tab=agency', defaultDueDays: 7, templateId: 'gst_tax_invoice', trade_discounts: false, returnable_packaging: true },
};

export const isTradeKind = (v: unknown): v is TradeKindId => typeof v === 'string' && (TRADE_KINDS as readonly string[]).includes(v);

/** Settings patch for a trade profile: business type `wholesale`, its modules, packs and the two trade switches. */
export function applyTradeKind(kind: TradeKindId): ShopModeSettings & { trade_kind: TradeKindId; industry_packs: ('distributor' | 'commodity' | 'agency')[]; trade_discounts: boolean; returnable_packaging: boolean } {
  const p = TRADE_PROFILES[kind];
  return { business_type: 'wholesale', modules: [...p.modules], trade_kind: kind, industry_packs: [...p.packs], trade_discounts: p.trade_discounts, returnable_packaging: p.returnable_packaging };
}

/* ── R9 (RT-A1): retail profile under the `kirana` business type ── */

/** The shop picker's six choices (stored as `settings.retail_kind`); the business type stays `kirana`. */
export const RETAIL_KINDS = ['grocery', 'pharmacy', 'apparel', 'electronics', 'jewellery', 'general'] as const;
export type RetailKindId = (typeof RETAIL_KINDS)[number];
type RetailPackId = 'pharmacy' | 'apparel' | 'electronics' | 'jewellery';

export interface RetailProfile {
  /** Without `gst`: a registered shop adds it (`applyRetailKind(…, { registered })`). */
  modules: readonly ModuleId[];
  /** Explicit `industry_packs` list (an empty list = none). */
  packs: readonly RetailPackId[];
  landing: string;
  defaultDueDays: number;
  templateId: string;
  /** `retail_settings` switches the profile turns on (RT-A2 / A3 / A4, RT-E3). */
  retail: { mrp_guard: 'off' | 'warn' | 'block'; delivery?: boolean; short_book?: boolean; free_qty?: boolean; cash_guard?: 'warn' | 'block'; require_pan?: boolean };
  /** The 7U pharma switches (`pharma_settings`: enabled, block expired, block above MRP), pharmacy only. */
  pharma?: boolean;
}

const COUNTER = PRESETS.kirana;
export const RETAIL_PROFILES: Readonly<Record<RetailKindId, RetailProfile>> = {
  grocery: { modules: COUNTER, packs: [], landing: '/pos', defaultDueDays: 0, templateId: 'retail_receipt', retail: { mrp_guard: 'warn', delivery: true, short_book: true, free_qty: true } },
  pharmacy: { modules: [...COUNTER, 'accounts', 'banking'], packs: ['pharmacy'], landing: '/pos', defaultDueDays: 0, templateId: 'gst_tax_invoice', retail: { mrp_guard: 'block', delivery: true, short_book: true, free_qty: true }, pharma: true },
  apparel: { modules: [...COUNTER, 'accounts'], packs: ['apparel'], landing: '/pos', defaultDueDays: 0, templateId: 'retail_receipt', retail: { mrp_guard: 'off' } },
  electronics: { modules: [...COUNTER, 'accounts', 'banking', 'tds'], packs: ['electronics'], landing: '/pos', defaultDueDays: 0, templateId: 'gst_tax_invoice', retail: { mrp_guard: 'off', cash_guard: 'warn' } },
  jewellery: { modules: [...COUNTER, 'accounts', 'banking', 'tds'], packs: ['jewellery'], landing: '/inventory?tab=jewellery&view=rates', defaultDueDays: 0, templateId: 'gst_tax_invoice', retail: { mrp_guard: 'off', cash_guard: 'block', require_pan: true } },
  general: { modules: COUNTER, packs: [], landing: '/pos', defaultDueDays: 0, templateId: 'retail_receipt', retail: { mrp_guard: 'warn' } },
};

export const isRetailKind = (v: unknown): v is RetailKindId => typeof v === 'string' && (RETAIL_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a retail profile: business type `kirana`, its modules (`registered` adds `gst`), the explicit packs
 * and the kind. The profile's switches (`retail_settings`, pharma) are written by `retail/rt-profile.ts`.
 */
export function applyRetailKind(kind: RetailKindId, opts: { registered?: boolean } = {}): ShopModeSettings & { retail_kind: RetailKindId; industry_packs: RetailPackId[] } {
  const p = RETAIL_PROFILES[kind];
  const modules: ModuleId[] = opts.registered && !p.modules.includes('gst') ? [...p.modules, 'gst'] : [...p.modules];
  return { business_type: 'kirana', modules, retail_kind: kind, industry_packs: [...p.packs] };
}

/* ── R11 (CN-A1): construction profile under the `contractor` business type ── */

/** The construction picker's seven choices (stored as `settings.construction_kind`); the business type stays `contractor`. */
export const CONSTRUCTION_KINDS = ['civil', 'subcontractor', 'builder', 'interiors', 'mep', 'labour', 'other'] as const;
export type ConstructionKindId = (typeof CONSTRUCTION_KINDS)[number];
type ConstructionPackId = 'works' | 'realty';

export interface ConstructionProfile {
  modules: readonly ModuleId[];
  /** Explicit `industry_packs` list; absent (`other`) = the `works` pack implied by `contractor` (today's behaviour). */
  packs?: readonly ConstructionPackId[];
  landing: string;
  defaultDueDays: number;
  templateId: string;
  /** Kinds that ask "Do you work for government departments / PSUs?" */
  asksGovernment?: boolean;
}

const WORKS_MODULES = PRESETS.contractor;
export const CONSTRUCTION_PROFILES: Readonly<Record<ConstructionKindId, ConstructionProfile>> = {
  civil: { modules: WORKS_MODULES, packs: ['works'], landing: '/time?tab=works&view=contracts', defaultDueDays: 30, templateId: 'gst_tax_invoice', asksGovernment: true },
  subcontractor: { modules: WORKS_MODULES, packs: ['works'], landing: '/time?tab=works&view=ra', defaultDueDays: 30, templateId: 'gst_tax_invoice', asksGovernment: true },
  builder: { modules: [...WORKS_MODULES, 'recurring'], packs: ['realty', 'works'], landing: '/receivables?tab=realty', defaultDueDays: 15, templateId: 'corporate_navy' },
  interiors: { modules: WORKS_MODULES.filter((m) => m !== 'payroll'), packs: ['works'], landing: '/time?tab=works&view=boq', defaultDueDays: 15, templateId: 'corporate_navy' },
  mep: { modules: WORKS_MODULES, packs: ['works'], landing: '/time?tab=works&view=boq', defaultDueDays: 30, templateId: 'gst_tax_invoice', asksGovernment: true },
  labour: { modules: ['purchases', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'time'], packs: ['works'], landing: '/time?tab=works&view=labour', defaultDueDays: 15, templateId: 'gst_tax_invoice' },
  other: { modules: WORKS_MODULES, landing: '/time?tab=works', defaultDueDays: 30, templateId: 'corporate_navy' },
};

export const isConstructionKind = (v: unknown): v is ConstructionKindId => typeof v === 'string' && (CONSTRUCTION_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a construction profile: business type `contractor`, its modules (`registered` adds `gst`), the
 * explicit packs (none for `other`: the implied `works` pack, as today) and the kind. The profile's switches
 * (`construction_settings`) are written by `construction/cn-profile.ts`.
 */
export function applyConstructionKind(kind: ConstructionKindId, opts: { registered?: boolean } = {}): ShopModeSettings & { construction_kind: ConstructionKindId; industry_packs: ConstructionPackId[] | undefined } {
  const p = CONSTRUCTION_PROFILES[kind];
  const modules: ModuleId[] = opts.registered && !p.modules.includes('gst') ? [...p.modules, 'gst'] : [...p.modules];
  return { business_type: 'contractor', modules, construction_kind: kind, industry_packs: p.packs ? [...p.packs] : undefined };
}

/* ── R10 (SV-A1): service profile under the `services` business type ── */

/** The service picker's nine choices (stored as `settings.service_kind`); the business type stays `services`. */
export const SERVICE_KINDS = ['clinic', 'lab', 'salon', 'fitness', 'coaching', 'workshop', 'appliance', 'professional', 'other', 'travel', 'manpower'] as const; // R15-B1: + travel; R17-A1: + manpower
export type ServiceKindId = (typeof SERVICE_KINDS)[number];
type ServicePackId = 'clinic' | 'salon' | 'fitness' | 'workshop' | 'fees' | 'pharmacy';

export interface ServiceProfile {
  /** Without `gst`: a registered business adds it (`applyServiceKind(…, { registered })`). Every kind keeps `time`. */
  modules: readonly ModuleId[];
  /** Explicit `industry_packs` list (an empty list = none). */
  packs: readonly ServicePackId[];
  landing: string;
  defaultDueDays: number;
  templateId: string;
  /** Clinic: ask "Do you sell medicines from the clinic?" */
  asksPharmacy?: boolean;
}

const CLINIC_MODULES: readonly ModuleId[] = ['time', 'recurring', 'purchases', 'reports', 'accounts', 'banking', 'tds'];
const WORKSHOP_MODULES: readonly ModuleId[] = ['time', 'recurring', 'purchases', 'inventory', 'accounts', 'banking', 'reports', 'tds'];
export const SERVICE_PROFILES: Readonly<Record<ServiceKindId, ServiceProfile>> = {
  clinic: { modules: CLINIC_MODULES, packs: ['clinic'], landing: '/time?tab=appointments', defaultDueDays: 0, templateId: 'freelancer_light', asksPharmacy: true },
  lab: { modules: CLINIC_MODULES, packs: ['clinic'], landing: '/time?tab=clinic&view=lab', defaultDueDays: 0, templateId: 'freelancer_light' },
  salon: { modules: ['pos', 'time', 'purchases', 'inventory', 'reports', 'payroll'], packs: ['salon'], landing: '/time?tab=appointments', defaultDueDays: 0, templateId: 'retail_receipt' },
  fitness: { modules: ['pos', 'time', 'recurring', 'purchases', 'reports', 'payroll'], packs: ['fitness'], landing: '/time?tab=members', defaultDueDays: 0, templateId: 'retail_receipt' },
  coaching: { modules: ['time', 'recurring', 'purchases', 'reports', 'accounts', 'payroll'], packs: ['fees'], landing: '/recurring?tab=fees&view=batches', defaultDueDays: 10, templateId: 'freelancer_light' },
  workshop: { modules: WORKSHOP_MODULES, packs: ['workshop'], landing: '/time?tab=workshop', defaultDueDays: 0, templateId: 'gst_tax_invoice' },
  appliance: { modules: WORKSHOP_MODULES, packs: ['workshop'], landing: '/time?tab=workshop', defaultDueDays: 0, templateId: 'gst_tax_invoice' },
  professional: { modules: PRESETS.services, packs: [], landing: '/invoice', defaultDueDays: 15, templateId: 'freelancer_light' },
  other: { modules: [...PRESETS.services, 'pos'], packs: [], landing: '/invoice', defaultDueDays: 7, templateId: 'freelancer_light' },
  travel: { modules: [...PRESETS.services, 'accounts'], packs: [], landing: '/invoice', defaultDueDays: 7, templateId: 'gst_tax_invoice' }, // R15-B1: the kind picker sets packs
  manpower: { modules: [...PRESETS.services, 'payroll', 'accounts'], packs: [], landing: '/time?tab=deploy', defaultDueDays: 7, templateId: 'gst_tax_invoice' }, // R17-A1: the kind picker sets packs
};

export const isServiceKind = (v: unknown): v is ServiceKindId => typeof v === 'string' && (SERVICE_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a service profile: business type `services`, its modules (`registered` adds `gst`; `pharmacy`
 * — clinic only — adds `inventory` and the R9 `pharmacy` pack), the explicit packs and the kind. The profile's switches
 * (`service_settings`) are written by `services/sv-profile.ts`.
 */
export function applyServiceKind(kind: ServiceKindId, opts: { registered?: boolean; pharmacy?: boolean } = {}): ShopModeSettings & { service_kind: ServiceKindId; industry_packs: ServicePackId[] } {
  const p = SERVICE_PROFILES[kind];
  const modules: ModuleId[] = [...p.modules];
  const packs: ServicePackId[] = [...p.packs];
  if (opts.registered && !modules.includes('gst')) modules.push('gst');
  if (opts.pharmacy && p.asksPharmacy) {
    if (!modules.includes('inventory')) modules.push('inventory');
    packs.push('pharmacy');
  }
  return { business_type: 'services', modules, service_kind: kind, industry_packs: packs };
}


/* ── R12 (AG-A1): agri profile — a wizard card that is not a business type ── */

/** The agri picker's choices (stored as `settings.agri_kind`); each writes an existing business type (or none). */
export const AGRI_KINDS = ['fpo', 'coop', 'dairy', 'mill', 'cold', 'inputs', 'farm', 'other'] as const;
export type AgriKindId = (typeof AGRI_KINDS)[number];
export const MILL_KINDS = ['rice', 'flour', 'dal', 'oil'] as const;
export type MillKindId = (typeof MILL_KINDS)[number];
type AgriPackId = 'agri' | 'dairy' | 'mill' | 'coldstore' | 'agri_inputs' | 'fpo' | 'commodity';

export interface AgriProfile {
  /** `manufacturer` (or `kirana` for input dealers); absent (`other`) = the business type is unchanged. */
  type?: BusinessType;
  /** Without `gst`: a registered business adds it. Absent (`other`) = modules unchanged. */
  modules?: readonly ModuleId[];
  packs: readonly AgriPackId[];
  landing: string;
  defaultDueDays?: number;
  templateId?: string;
}

const MFG_POS: readonly ModuleId[] = [...PRESETS.manufacturer, 'pos'];
export const AGRI_PROFILES: Readonly<Record<AgriKindId, AgriProfile>> = {
  fpo: { type: 'manufacturer', modules: MFG_POS, packs: ['agri', 'fpo', 'commodity'], landing: '/inventory?tab=members', defaultDueDays: 15, templateId: 'gst_tax_invoice' },
  coop: { type: 'manufacturer', modules: MFG_POS, packs: ['agri', 'fpo'], landing: '/inventory?tab=members', defaultDueDays: 15, templateId: 'gst_tax_invoice' },
  dairy: { type: 'manufacturer', modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'pos', 'recurring'], packs: ['agri', 'dairy'], landing: '/inventory?tab=dairy&view=collection', defaultDueDays: 0, templateId: 'retail_receipt' },
  mill: { type: 'manufacturer', modules: PRESETS.manufacturer, packs: ['agri', 'mill', 'commodity'], landing: '/inventory?tab=mill&view=intake', defaultDueDays: 15, templateId: 'gst_tax_invoice' },
  cold: { type: 'manufacturer', modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds'], packs: ['agri', 'coldstore'], landing: '/inventory?tab=cold&view=lots', defaultDueDays: 0, templateId: 'gst_tax_invoice' },
  inputs: { type: 'kirana', modules: [...PRESETS.kirana, 'accounts', 'banking'], packs: ['agri', 'agri_inputs'], landing: '/pos', defaultDueDays: 0, templateId: 'gst_tax_invoice' },
  farm: { type: 'manufacturer', modules: ['purchases', 'inventory', 'accounts', 'banking', 'reports'], packs: ['agri'], landing: '/inventory?tab=farm&view=batches', defaultDueDays: 7, templateId: 'classic_orange' },
  other: { packs: ['agri'], landing: '/inventory?tab=farm' },
};

export const isAgriKind = (v: unknown): v is AgriKindId => typeof v === 'string' && (AGRI_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for an agri profile: the business type and modules (`registered` adds `gst`), the explicit packs and
 * the kind (`mill_kind` for a mill). Input dealers also get `retail_kind: 'general'` so R9's "Pick your shop" step does
 * not fire. `other` keeps the type and modules and adds `agri` to the packs the company has (`current`). The profile's
 * switches (`agri_settings`) are written by `agri/ag-profile.ts`.
 */
export function applyAgriKind(kind: AgriKindId, opts: { registered?: boolean; mill_kind?: string; currentPacks?: readonly PackId[] } = {}): ShopModeSettings & { agri_kind: AgriKindId; mill_kind?: MillKindId; industry_packs: PackId[]; retail_kind?: 'general' } {
  const p = AGRI_PROFILES[kind];
  const packs: PackId[] = kind === 'other' ? [...new Set<PackId>([...(opts.currentPacks ?? []), 'agri'])] : [...p.packs];
  const out: ShopModeSettings & { agri_kind: AgriKindId; mill_kind?: MillKindId; industry_packs: PackId[]; retail_kind?: 'general' } = { agri_kind: kind, industry_packs: packs };
  if (p.type) out.business_type = p.type;
  if (p.modules) out.modules = opts.registered && !p.modules.includes('gst') ? [...p.modules, 'gst'] : [...p.modules];
  if (kind === 'mill') out.mill_kind = (MILL_KINDS as readonly string[]).includes(opts.mill_kind ?? '') ? (opts.mill_kind as MillKindId) : 'rice';
  if (kind === 'inputs') out.retail_kind = 'general';
  return out;
}

/* ── R13 (MF-A1): manufacturing profile — a wizard card that is not a business type ── */

/** The manufacturing picker's choices (stored as `settings.mfg_kind`); each writes `manufacturer` (or nothing: `other`). */
export const MFG_KINDS = ['engineering', 'textile', 'plastics', 'printing', 'food', 'other'] as const;
export type MfgKindId = (typeof MFG_KINDS)[number];
/** The sub-choice of a kind (settings `mfg_sub`); the first is the default. */
export const MFG_SUBS: Readonly<Partial<Record<MfgKindId, readonly string[]>>> = {
  engineering: ['drawing', 'catalogue'],
  textile: ['garments', 'yarn', 'fabric', 'processing'],
  plastics: ['moulding', 'extrusion', 'film', 'corrugation'],
};
type MfgPackId = 'shopfloor' | 'fabrication' | 'garments' | 'plastics' | 'press' | 'foodmfg';

export interface MfgProfile {
  /** `manufacturer`; absent (`other`) = the business type and modules are unchanged. */
  type?: BusinessType;
  modules?: readonly ModuleId[];
  packs: readonly MfgPackId[];
  landing: string;
  defaultDueDays?: number;
  templateId?: string;
}

const MF_GST: Pick<MfgProfile, 'type' | 'modules' | 'templateId'> = { type: 'manufacturer', modules: PRESETS.manufacturer, templateId: 'gst_tax_invoice' };
export const MFG_PROFILES: Readonly<Record<MfgKindId, MfgProfile>> = {
  engineering: { ...MF_GST, packs: ['shopfloor', 'fabrication'], landing: '/manufacturing?tab=floor&view=cards', defaultDueDays: 30 },
  textile: { ...MF_GST, packs: ['shopfloor', 'garments'], landing: '/manufacturing?tab=garments&view=styles', defaultDueDays: 45 },
  plastics: { ...MF_GST, packs: ['shopfloor', 'plastics'], landing: '/manufacturing?tab=moulding&view=runs', defaultDueDays: 30 },
  printing: { ...MF_GST, packs: ['shopfloor', 'press'], landing: '/manufacturing?tab=press&view=estimates', defaultDueDays: 30 },
  food: { ...MF_GST, modules: [...PRESETS.manufacturer, 'pos'], packs: ['shopfloor', 'foodmfg'], landing: '/manufacturing?tab=food&view=costcards', defaultDueDays: 15 },
  other: { packs: ['shopfloor'], landing: '/manufacturing?tab=floor' },
};

export const isMfgKind = (v: unknown): v is MfgKindId => typeof v === 'string' && (MFG_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a manufacturing profile: business type and modules (`registered` adds `gst`; every kind keeps
 * `inventory` and `payroll`), the packs (the kind's own, in union with the packs the company has, so an agri mill that
 * also packs namkeen keeps its agri desks) and the kind / sub-choice. `other` keeps the type and modules. The profile's
 * switches (`mfg_settings`) are written by `mfg/mf-profile.ts`.
 */
export function applyMfgKind(kind: MfgKindId, opts: { registered?: boolean; sub?: string; currentPacks?: readonly PackId[] } = {}): ShopModeSettings & { mfg_kind: MfgKindId; mfg_sub?: MfgSub; industry_packs: PackId[] } {
  const p = MFG_PROFILES[kind];
  const out: ShopModeSettings & { mfg_kind: MfgKindId; mfg_sub?: MfgSub; industry_packs: PackId[] } = { mfg_kind: kind, industry_packs: [...new Set<PackId>([...(opts.currentPacks ?? []), ...p.packs])] };
  if (p.type) out.business_type = p.type;
  if (p.modules) out.modules = [...new Set<ModuleId>([...p.modules, 'inventory', 'payroll', ...(opts.registered ? ['gst' as const] : [])])];
  const subs = MFG_SUBS[kind];
  if (subs) out.mfg_sub = (subs.includes(opts.sub ?? '') ? opts.sub : subs[0]) as MfgSub;
  return out;
}

/* ── R14 (PS-A1): professional profile under `services` / `professional` ── */

/** The professional picker's choices (stored as `settings.prof_kind`); business type stays `services`. */
export const PROF_KINDS = ['ca', 'legal', 'design', 'consulting', 'agency', 'freelancer', 'other'] as const;
export type ProfKindId = (typeof PROF_KINDS)[number];
/** The sub-choice of a kind (settings `prof_sub`); the first is the default. `exports` adds the `svcexport` pack. */
export const PROF_SUBS: Readonly<Partial<Record<ProfKindId, readonly string[]>>> = {
  ca: ['icai', 'icsi', 'icmai'],
  legal: ['litigation', 'advisory', 'both'],
  design: ['architect', 'interior', 'engineer'],
  consulting: ['domestic', 'exports'],
  agency: ['creative', 'media_buying'],
  freelancer: ['domestic', 'exports'],
};
export const FIRM_FORMS = ['proprietorship', 'partnership', 'llp', 'company'] as const;
type ProfPackId = 'practice' | 'cafirm' | 'legal' | 'design' | 'media' | 'svcexport' | 'partners';

export interface ProfProfile {
  /** Without `gst`: a registered firm adds it. Every kind keeps `time`. */
  modules: readonly ModuleId[];
  packs: readonly ProfPackId[];
  landing: string;
  defaultDueDays: number;
  templateId?: string;
}

const PROF_ACC: readonly ModuleId[] = [...PRESETS.services, 'accounts'];
export const PROF_PROFILES: Readonly<Record<ProfKindId, ProfProfile>> = {
  ca: { modules: PROF_ACC, packs: ['practice', 'cafirm'], landing: '/time?tab=cadesk&view=events', defaultDueDays: 15, templateId: 'gst_tax_invoice' }, // PS-D5: the CA desk
  legal: { modules: PROF_ACC, packs: ['practice', 'legal'], landing: '/time?tab=matters&view=matters', defaultDueDays: 15, templateId: 'freelancer_light' },
  design: { modules: PROF_ACC, packs: ['practice', 'design'], landing: '/time?tab=matters&view=stages', defaultDueDays: 15, templateId: 'gst_tax_invoice' }, // PS-B4: the stages view
  consulting: { modules: PROF_ACC, packs: ['practice'], landing: '/time?tab=wip&view=wip', defaultDueDays: 30, templateId: 'gst_tax_invoice' },
  agency: { modules: PROF_ACC, packs: ['practice', 'media'], landing: '/time?tab=matters&view=engagements', defaultDueDays: 30, templateId: 'gst_tax_invoice' },
  freelancer: { modules: PRESETS.services, packs: ['practice'], landing: '/invoice', defaultDueDays: 15, templateId: 'freelancer_light' },
  other: { modules: PRESETS.services, packs: ['practice'], landing: '/time?tab=matters', defaultDueDays: 15 },
};

export const isProfKind = (v: unknown): v is ProfKindId => typeof v === 'string' && (PROF_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a professional profile: business type `services`, `service_kind: 'professional'`, modules
 * (`registered` adds `gst`; `time` always kept), packs in union with the company's (`exports` / the `exports` sub add
 * `svcexport`; a partnership or LLP adds `partners`) and the kind / sub-choice. The firm form itself is the annual pack's
 * entity type (`prof/ps-profile.ts` writes it); the switches (`prof_settings`) too.
 */
export function applyProfKind(kind: ProfKindId, opts: { registered?: boolean; sub?: string; firmForm?: string; exports?: boolean; currentPacks?: readonly PackId[] } = {}): ShopModeSettings & { service_kind: 'professional'; prof_kind: ProfKindId; prof_sub?: string; industry_packs: PackId[] } {
  const p = PROF_PROFILES[kind];
  const subs = PROF_SUBS[kind];
  const sub = subs ? (subs.includes(opts.sub ?? '') ? opts.sub! : subs[0]) : undefined;
  const packs = new Set<PackId>([...(opts.currentPacks ?? []), ...p.packs]);
  if (opts.exports || sub === 'exports') packs.add('svcexport');
  if (opts.firmForm === 'partnership' || opts.firmForm === 'llp') packs.add('partners');
  const modules = [...new Set<ModuleId>([...p.modules, 'time', ...(opts.registered ? ['gst' as const] : [])])];
  return { business_type: 'services', modules, service_kind: 'professional', prof_kind: kind, ...(sub ? { prof_sub: sub } : {}), industry_packs: [...packs] };
}

/* ── R15 (R15-B1): travel profile under `services` / `travel` ── */

/** The travel picker's choices (stored as `settings.travel_kind`); business type stays `services`. */
export const TRAVEL_KINDS = ['tour_operator', 'agent', 'inbound', 'events', 'other'] as const;
export type TravelKindId = (typeof TRAVEL_KINDS)[number];
export const TRAVEL_LANDING: Readonly<Record<TravelKindId, string>> = {
  tour_operator: '/time?tab=trips&view=trips',
  agent: '/time?tab=trips&view=bookings',
  inbound: '/time?tab=trips&view=trips',
  events: '/time?tab=trips&view=events',
  other: '/time?tab=trips',
};
export const isTravelKind = (v: unknown): v is TravelKindId => typeof v === 'string' && (TRAVEL_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a travel profile: business type `services`, `service_kind: 'travel'`, modules (services + accounts
 * + purchases; `registered` adds `gst`; `time` always kept, so `/time` stays visible and `PACK_ROUTES` is unchanged),
 * packs in union with the company's (`events` for planners, plus `travel` when they also book travel), due days 7 and
 * the kind. The regime default and switches (`travel_settings`) are written by `travel/tv-profile.ts`.
 */
export function applyTravelKind(kind: TravelKindId, opts: { registered?: boolean; currentPacks?: readonly PackId[]; alsoTravel?: boolean } = {}): ShopModeSettings & { service_kind: 'travel'; travel_kind: TravelKindId; industry_packs: PackId[]; defaultDueDays: number } {
  const packs = new Set<PackId>([...(opts.currentPacks ?? []), ...(kind === 'events' ? (opts.alsoTravel ? ['events', 'travel'] as const : ['events'] as const) : ['travel'] as const)]);
  const modules = [...new Set<ModuleId>([...PRESETS.services, 'accounts', 'purchases', 'time', ...(opts.registered ? ['gst' as const] : [])])];
  return { business_type: 'services', modules, service_kind: 'travel', travel_kind: kind, industry_packs: [...packs], defaultDueDays: 7 };
}

/* ── R17 (R17-A1): manpower profile under `services` / `manpower` ── */

/** The manpower picker's choices (stored as `settings.manpower_kind`); business type stays `services`. */
export const MANPOWER_KINDS = ['security', 'facility', 'staffing', 'labour', 'other'] as const;
export type ManpowerKindId = (typeof MANPOWER_KINDS)[number];
export const MANPOWER_LANDING: Readonly<Record<ManpowerKindId, string>> = {
  security: '/time?tab=deploy&view=sites',
  facility: '/time?tab=deploy&view=sites',
  staffing: '/time?tab=deploy&view=muster',
  labour: '/time?tab=deploy&view=muster',
  other: '/time?tab=deploy',
};
export const isManpowerKind = (v: unknown): v is ManpowerKindId => typeof v === 'string' && (MANPOWER_KINDS as readonly string[]).includes(v);

/**
 * Settings patch for a manpower profile: business type `services`, `service_kind: 'manpower'`, modules (services +
 * payroll, accounts, banking, tds, recurring, purchases; `registered` adds `gst`; `time` always kept, so `/time` stays
 * visible and `PACK_ROUTES` is unchanged), packs in union with the company's (`manpower`; `security` for a security
 * agency), due days 7 and the GST tax-invoice template. The firm form is the annual pack's entity type (written by the
 * wizard through `prof/ps-profile.ts`); the defaults in `manpower_settings` by `manpower/mp-profile.ts`.
 */
export function applyManpowerKind(kind: ManpowerKindId, opts: { registered?: boolean; currentPacks?: readonly PackId[] } = {}): ShopModeSettings & { service_kind: 'manpower'; manpower_kind: ManpowerKindId; industry_packs: PackId[]; defaultDueDays: number; templateId: string } {
  const packs = new Set<PackId>([...(opts.currentPacks ?? []), 'manpower', ...(kind === 'security' ? ['security' as const] : [])]);
  const modules = [...new Set<ModuleId>([...PRESETS.services, 'payroll', 'accounts', 'banking', 'tds', 'recurring', 'purchases', 'time', ...(opts.registered ? ['gst' as const] : [])])];
  return { business_type: 'services', modules, service_kind: 'manpower', manpower_kind: kind, industry_packs: [...packs], defaultDueDays: 7, templateId: 'gst_tax_invoice' };
}

/* ── R18 (R18-A1): society profile — a wizard card, not a business type (the R12 / R13 pattern) ── */

/** The society picker's choices (stored as `settings.society_kind`). */
export const SOCIETY_KINDS = ['chs', 'aoa', 'rwa', 'commercial', 'agency'] as const;
export type SocietyKindId = (typeof SOCIETY_KINDS)[number];
export const isSocietyKind = (v: unknown): v is SocietyKindId => typeof v === 'string' && (SOCIETY_KINDS as readonly string[]).includes(v);
/** Where each kind lands after setup (the Society desk on Recurring). */
export const SOCIETY_LANDING: Readonly<Record<SocietyKindId, string>> = {
  chs: '/recurring?tab=society&view=units',
  aoa: '/recurring?tab=society&view=units',
  rwa: '/recurring?tab=society&view=units',
  commercial: '/recurring?tab=society&view=units',
  agency: '/recurring?tab=society&view=bills',
};

/**
 * Settings patch for a society profile: business type `nonprofit` (`services` for a maintenance agency), the type's
 * modules (`registered` adds `gst`; `recurring` always kept, so `/recurring` stays visible and `PACK_ROUTES` is
 * unchanged), packs = the company's ∪ `society` written as an EXPLICIT list (so the donations pack the `nonprofit`
 * type implies is never switched on by it), due days 15 and the GST tax-invoice template. The society's own defaults
 * (`society_settings`) are written by `society/hs-settings.ts`.
 */
export function applySocietyKind(kind: SocietyKindId, opts: { registered?: boolean; currentPacks?: readonly PackId[] } = {}): ShopModeSettings & { society_kind: SocietyKindId; industry_packs: PackId[]; defaultDueDays: number; templateId: string } {
  const type: BusinessType = kind === 'agency' ? 'services' : 'nonprofit';
  const modules = [...new Set<ModuleId>([...PRESETS[type], 'recurring', 'accounts', 'banking', ...(opts.registered ? ['gst' as const] : [])])];
  return { business_type: type, modules, society_kind: kind, industry_packs: [...new Set<PackId>([...(opts.currentPacks ?? []), 'society'])], defaultDueDays: 15, templateId: 'gst_tax_invoice' };
}
