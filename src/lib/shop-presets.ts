/**
 * Shop mode presets (8H): business types, their module lists and the Dashboard tile map.
 * Only lazy screens (setup wizard, Settings, Dashboard tiles) import this; the shell needs only `shop-mode.ts`.
 */
import { ALL_MODULES, type BusinessType, type ModuleId, type ShopModeSettings } from './shop-mode';

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

