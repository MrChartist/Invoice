/**
 * Shop mode presets (8H): business types, their module lists and the Dashboard tile map.
 * Only lazy screens (setup wizard, Settings, Dashboard tiles) import this; the shell needs only `shop-mode.ts`.
 */
import { ALL_MODULES, type BusinessType, type ModuleId, type ShopModeSettings } from './shop-mode';

export const BUSINESS_TYPES: readonly BusinessType[] = ['kirana', 'restaurant', 'wholesale', 'services', 'manufacturer', 'full'];

export const PRESETS: Readonly<Record<BusinessType, readonly ModuleId[]>> = {
  kirana: ['pos', 'purchases', 'inventory', 'reports'],
  wholesale: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'loans'],
  services: ['recurring', 'time', 'purchases', 'reports', 'gst', 'tds', 'design'],
  manufacturer: ['purchases', 'inventory', 'accounts', 'banking', 'reports', 'gst', 'tds', 'payroll', 'loans'],
  full: ALL_MODULES,
  // R3-A: café / dhaba / restaurant — tables & KOT live under the POS module.
  restaurant: ['pos', 'inventory', 'reports'],
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
};

/** Settings after the wizard: shop-mode modules plus the type's default due days. */
export function applyBusinessDefaults<S extends ShopModeSettings & { defaultDueDays: number }>(settings: S, type: BusinessType): S {
  return { ...settings, ...applyBusinessType(type), defaultDueDays: BUSINESS_DEFAULTS[type].defaultDueDays };
}
