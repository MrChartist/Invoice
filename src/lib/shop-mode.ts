/**
 * Shop mode / business-type presets (8H, roadmap 8.120) — progressive disclosure.
 *
 * A company may say what it does (Kirana / retail, wholesale, services, manufacturer, CA / full
 * accounting). That picks a preset list of MODULES; the sidebar (NAV_ITEMS) and the Dashboard tiles
 * then show only what that business uses. Nothing is removed: every screen stays reachable through
 * Ctrl+K and its URL, and Settings → Defaults → "Show all features" turns the filter off.
 *
 * Stored on the company settings (`mrchartist_inv_settings`, additive fields `business_type` and
 * `modules`), so it is backed up and synced with the company. ABSENT `modules` = FULL: existing
 * companies see exactly what they saw before.
 *
 * Data-driven and dependency-free on purpose: this file is part of the shell, so it must stay tiny;
 * presets, tiles and the business-type list live in `shop-presets.ts` (lazy screens only).
 * A path or tile this table does not know is always shown (new screens never vanish by accident).
 */

export type BusinessType =
  | 'kirana' | 'wholesale' | 'services' | 'manufacturer' | 'full' | 'restaurant'
  // R5-A1 industry packs (type only; presets in `shop-presets.ts`, packs in `industry-packs.ts`)
  | 'ecommerce' | 'transport' | 'contractor' | 'institution' | 'nonprofit' | 'property';

/** Optional modules (invoices, clients, receivables, dashboard and settings are always on). */
export type ModuleId =
  | 'pos'
  | 'recurring'
  | 'time'
  | 'purchases'
  | 'inventory'
  | 'accounts'
  | 'banking'
  | 'tds'
  | 'payroll'
  | 'reports'
  | 'gst'
  | 'loans'
  | 'design';

export const ALL_MODULES: readonly ModuleId[] = ['pos', 'recurring', 'time', 'purchases', 'inventory', 'accounts', 'banking', 'tds', 'payroll', 'reports', 'gst', 'loans', 'design'];

/** Route (path without query) → module. Paths not listed are core and always visible. */
const PATH_MODULE: Readonly<Record<string, ModuleId>> = {
  '/pos': 'pos',
  '/tables': 'pos',
  '/recurring': 'recurring',
  '/time': 'time',
  '/expenses': 'purchases',
  '/inventory': 'inventory',
  '/manufacturing': 'inventory',
  '/gateway': 'accounts',
  '/books': 'accounts',
  '/reconcile': 'banking',
  '/cheques': 'banking',
  '/tds': 'tds',
  '/payroll': 'payroll',
  '/reports': 'reports',
  '/gst-reports': 'gst',
  '/exports': 'gst',
  '/loans': 'loans',
  '/design': 'design',
};

const isModule = (v: unknown): v is ModuleId => typeof v === 'string' && (ALL_MODULES as readonly string[]).includes(v);

/** What the company settings carry (additive, all optional). */
export interface ShopModeSettings {
  business_type?: BusinessType;
  /** Absent = full (every module). */
  modules?: ModuleId[];
}

/** The enabled modules, or null for "everything" (no filter). Unknown ids are dropped. */
export function enabledModules(s: ShopModeSettings | null | undefined): ReadonlySet<ModuleId> | null {
  if (!s || !Array.isArray(s.modules)) return null;
  return new Set(s.modules.filter(isModule));
}

/** Module a route belongs to (the first path segment), or undefined for core / unknown routes. */
export function moduleOfPath(path: string): ModuleId | undefined {
  const seg = '/' + (path.split(/[?#]/)[0].split('/')[1] ?? '');
  return Object.prototype.hasOwnProperty.call(PATH_MODULE, seg) ? PATH_MODULE[seg] : undefined;
}

export function isPathVisible(path: string, modules: ReadonlySet<ModuleId> | null): boolean {
  if (!modules) return true;
  const m = moduleOfPath(path);
  return !m || modules.has(m);
}

/** Fired (on window) after the shop mode changes so the shell re-reads it without a reload. */
export const SHOP_MODE_EVENT = 'mrc:shop-mode';
