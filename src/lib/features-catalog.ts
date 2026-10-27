/**
 * R6-B5: Settings → Features — one list of what a company can switch on: the shop-mode modules (8H), the industry
 * packs (R5) and the advanced options spread over other screens (batches, godowns, branches, approvals, vault …).
 *
 * Nothing moves: every row reads the setting where it already lives (`isOn`) and its `href` opens the screen where it
 * is set. Modules and packs are switched in the panel itself through the existing setters (`ShopModePanel`); the
 * pharma pack is the one advanced row that is a plain flag, so it toggles in place. Ctrl+K lists every row under
 * "Features". Lazy (Settings → Features and the palette only).
 */
import { ALL_MODULES, type ModuleId } from './shop-mode';
import { PACK_IDS, activePacks, type PackId } from './industry-packs';
import { DB_PREFIX, getJson, getTable, vaultEnabled } from './storage';
import { readUsers } from './auth';
import { companySyncPrefs } from './sync-device';
import { readApprovalPolicy, CREDIT_POLICY_KEY } from './approval-gate';
import { readPharmaSettings } from './pharma-gate';
import { localDb, type AppSettings } from './localDb';

export type FeatureSection = 'modules' | 'packs' | 'advanced';

export type AdvancedId =
  | 'batches' | 'serials' | 'godowns' | 'branches' | 'approvals' | 'credit' | 'loyalty' | 'offers' | 'priceLevels'
  | 'costCentres' | 'currency' | 'einvoice' | 'composition' | 'vault' | 'sync' | 'users' | 'gateway' | 'shifts'
  | 'tables' | 'pharma' | 'scale'
  | 'construction' // R11 (CN-A1)
  | 'serviceProfile'; // R10 (SV-A1)

export interface FeatureRow {
  /** `mod.<id>`, `pack.<id>` or `adv.<id>`. */
  id: string;
  section: FeatureSection;
  /** Where it is set (a route, maybe with `?tab=`). */
  href: string;
  /** `true` / `false`, or `'n/a'` for something that is always available. */
  isOn: (s: FeatureSettings) => boolean | 'n/a';
  /** A plain flag the panel can switch in place (owner only). */
  toggle?: (on: boolean) => Promise<void>;
}

export type FeatureSettings = Pick<AppSettings, 'modules' | 'profiles' | 'activeProfileId'> & { business_type?: string; industry_packs?: unknown };

const rows = (table: string) => getTable<Record<string, unknown>>(table);
const activeProfile = (s: FeatureSettings) => s.profiles?.find((p) => p.id === s.activeProfileId) ?? s.profiles?.[0];
const deviceKey = (key: string): boolean => {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

/** Godowns other than Main with a name (the same count `isMultiGodown` makes). */
export const multiGodown = (): boolean => rows('godowns').some((g) => g.id !== 'main' && typeof g.name === 'string' && g.name.trim() !== '');
const tracked = (flag: 'track_batches' | 'track_serials') => rows('stock_items').some((i) => !!i.track_stock && !!i[flag]);

const ADVANCED: readonly { id: AdvancedId; href: string; isOn: FeatureRow['isOn']; toggle?: FeatureRow['toggle'] }[] = [
  { id: 'batches', href: '/inventory', isOn: () => tracked('track_batches') },
  { id: 'serials', href: '/inventory', isOn: () => tracked('track_serials') },
  { id: 'godowns', href: '/inventory?tab=godowns', isOn: () => multiGodown() },
  { id: 'branches', href: '/', isOn: () => rows('branches').length > 0 },
  {
    id: 'approvals',
    href: '/',
    isOn: () => {
      // The purchase policy is read raw (as `readPurchaseApprovalPolicy` does) to keep its gate out of this chunk.
      const p = getJson<{ bills?: unknown; payments?: unknown } | null>(`${DB_PREFIX}purchase_approval_policy`, null);
      return readApprovalPolicy().enabled || p?.bills === true || p?.payments === true;
    },
  },
  {
    id: 'credit',
    href: '/distribution?tab=credit',
    isOn: () => (getJson<{ mode?: unknown } | null>(CREDIT_POLICY_KEY, null)?.mode ?? 'warn') !== 'off',
  },
  { id: 'loyalty', href: '/', isOn: () => getJson<{ enabled?: unknown } | null>(`${DB_PREFIX}loyalty_program`, null)?.enabled === true },
  { id: 'offers', href: '/', isOn: () => rows('schemes').length > 0 },
  { id: 'priceLevels', href: '/settings?tab=items', isOn: () => rows('price_levels').length > 0 },
  { id: 'costCentres', href: '/books?tab=proj', isOn: () => rows('cost_centres').length > 0 },
  { id: 'currency', href: '/settings?tab=defaults', isOn: () => rows('currency_rates').length > 0 },
  { id: 'einvoice', href: '/settings?tab=business', isOn: (s) => Number(activeProfile(s)?.einvoice_aato) > 0 },
  { id: 'composition', href: '/settings?tab=business', isOn: (s) => activeProfile(s)?.gst_scheme === 'composition' },
  { id: 'vault', href: '/settings?tab=security', isOn: () => vaultEnabled() },
  { id: 'sync', href: '/settings?tab=data', isOn: () => companySyncPrefs().enabled === true },
  { id: 'users', href: '/settings?tab=security', isOn: () => readUsers().length > 0 },
  { id: 'gateway', href: '/gateway', isOn: () => 'n/a' },
  { id: 'shifts', href: '/pos', isOn: () => rows('pos_shifts').length > 0 },
  { id: 'tables', href: '/tables', isOn: () => rows('dining_tables').length > 0 },
  {
    id: 'pharma',
    href: '/',
    isOn: () => readPharmaSettings().enabled,
    toggle: async (on) => {
      const { savePharmaSettings } = await import('./pharma');
      savePharmaSettings({ ...readPharmaSettings(), enabled: on });
    },
  },
  { id: 'scale', href: '/pos', isOn: () => deviceKey('mrchartist_pos_scale') },
  // R11 (CN-A1): the construction profile (picked in Settings → Features under Contractor)
  { id: 'construction', href: '/settings?tab=features', isOn: (s) => typeof (s as { construction_kind?: unknown }).construction_kind === 'string' },
  // R10 (SV-A1): the service profile (picked in Settings → Features under Services)
  { id: 'serviceProfile', href: '/settings?tab=features', isOn: (s) => typeof (s as { service_kind?: unknown }).service_kind === 'string' },
];

/** Where each module's screen is (the first sidebar route that belongs to it). */
export const MODULE_HREF: Readonly<Record<ModuleId, string>> = {
  pos: '/pos',
  recurring: '/recurring',
  time: '/time',
  purchases: '/expenses',
  inventory: '/inventory',
  accounts: '/books',
  banking: '/reconcile',
  tds: '/tds',
  payroll: '/payroll',
  reports: '/reports',
  gst: '/gst-reports',
  loans: '/loans',
  design: '/design',
};

/** The route that hosts each pack's first tab. */
export const PACK_HREF: Readonly<Record<PackId, string>> = {
  marketplace: '/receivables?tab=marketplace',
  transport: '/distribution?tab=transport',
  works: '/time?tab=works',
  fees: '/recurring?tab=fees',
  nonprofit: '/receivables?tab=donations',
  leases: '/recurring?tab=leases',
  hotel: '/tables', // R7-A (the floor links to the front desk; feature rows need a page tab or a route)
  // R8-C: trading packs
  distributor: '/distribution?tab=claims',
  commodity: '/distribution?tab=mandi',
  agency: '/distribution?tab=agency',
  // R9 (RT-A1): retail packs (desk tabs on Inventory)
  pharmacy: '/inventory?tab=pharmacy',
  apparel: '/inventory?tab=apparel',
  electronics: '/inventory?tab=devices',
  jewellery: '/inventory?tab=jewellery',
  // R11 (CN-A1): builders desk (a tab on Receivables)
  realty: '/receivables?tab=realty',
  // R10 (SV-A1): service desks (tabs on Time)
  clinic: '/time?tab=clinic',
  salon: '/time?tab=appointments',
  fitness: '/time?tab=members',
  workshop: '/time?tab=workshop',
  // R12 (AG-D): desks on Inventory
  coldstore: '/inventory?tab=cold',
  agri_inputs: '/inventory?tab=inputs',
  fpo: '/inventory?tab=members',
};

export const FEATURE_ROWS: readonly FeatureRow[] = [
  ...ALL_MODULES.map((m): FeatureRow => ({ id: `mod.${m}`, section: 'modules', href: MODULE_HREF[m], isOn: (s) => !Array.isArray(s.modules) || s.modules.includes(m) })),
  ...PACK_IDS.map((p): FeatureRow => ({ id: `pack.${p}`, section: 'packs', href: PACK_HREF[p], isOn: (s) => activePacks(s).includes(p) })),
  ...ADVANCED.map((a): FeatureRow => ({ ...a, id: `adv.${a.id}`, section: 'advanced' })),
];

/** A row's state for the company now (rows read storage; a reader that throws counts as off). */
export function featureState(row: FeatureRow, s: FeatureSettings = localDb.settings.get()): boolean | 'n/a' {
  try {
    return row.isOn(s);
  } catch {
    return false;
  }
}
