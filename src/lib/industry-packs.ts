/**
 * Industry packs (Round 5, R5-A1): a vertical's work screens switch on per company.
 *
 * A pack only ADDS tabs on existing routes and a few fields in existing dialogs — never a route or a sidebar item,
 * so shop mode (`shop-mode.ts`) is untouched. The rule (`activePacks`):
 *  - `settings.industry_packs` is an array → exactly those packs (unknown ids dropped; `[]` = none, even when the
 *    business type implies one);
 *  - absent → the packs implied by `business_type` (`PACK_OF_TYPE`);
 *  - neither → no pack. Every existing company therefore sees exactly what it saw before.
 * A tab whose pack is off is not listed, but its URL (`?tab=…`) still opens it and Ctrl+K lists it under
 * "Industry packs" with "(pack off)" — progressive disclosure, never removal. Turning a pack off deletes nothing.
 *
 * Lazy screens only (Settings, wizard, Receivables, the palette group). The notification bell checks the same
 * rule inline so this module never reaches first paint.
 */
import type { BusinessType } from './shop-mode';

export type PackId = 'marketplace' | 'transport' | 'works' | 'fees' | 'nonprofit' | 'leases'
  | 'hotel' // R7-A
  // R8-C: trading packs (tabs on /distribution; switched on by the `wholesale` trade profile, never by a business type)
  | 'distributor' | 'commodity' | 'agency';

export const PACK_IDS: readonly PackId[] = [
  'marketplace', 'transport', 'works', 'fees', 'nonprofit', 'leases',
  'hotel', // R7-A
  'distributor', 'commodity', 'agency', // R8-C
];

/** The packs a business type implies when `industry_packs` is absent. */
export const PACK_OF_TYPE: Readonly<Partial<Record<BusinessType, readonly PackId[]>>> = {
  ecommerce: ['marketplace'],
  transport: ['transport'],
  contractor: ['works'],
  institution: ['fees'],
  nonprofit: ['nonprofit'],
  property: ['leases'],
  hotel: ['hotel'], // R7-A
};

/** What the company settings carry for packs (additive, all optional). */
export interface PackSettings {
  business_type?: string;
  industry_packs?: unknown;
}

export const isPackId = (v: unknown): v is PackId => typeof v === 'string' && (PACK_IDS as readonly string[]).includes(v);

/** The packs switched on for a company (see the rule above). */
export function activePacks(s: PackSettings | null | undefined): PackId[] {
  if (!s) return [];
  if (Array.isArray(s.industry_packs)) return PACK_IDS.filter((p) => (s.industry_packs as unknown[]).includes(p));
  const type = s.business_type;
  const implied = typeof type === 'string' && Object.prototype.hasOwnProperty.call(PACK_OF_TYPE, type) ? PACK_OF_TYPE[type as BusinessType] : undefined;
  return implied ? [...implied] : [];
}

export function isPackOn(s: PackSettings | null | undefined, id: PackId): boolean {
  return activePacks(s).includes(id);
}

/** A pack tab for Ctrl+K: `labelKey` is a key of the package's own i18n area (resolved by the palette group). */
export interface PackTab {
  pack: PackId;
  /** Other packs that also turn the row on (a tab shared by several packs, e.g. common credit). */
  alsoPacks?: readonly PackId[];
  path: string;
  labelKey: string;
}

/** True when the row's own pack or one of its `alsoPacks` is among `on`. */
export function packTabOn(t: PackTab, on: readonly PackId[]): boolean {
  return on.includes(t.pack) || (t.alsoPacks ?? []).some((p) => on.includes(p));
}

/**
 * Every pack tab (the "Industry packs" palette group). One appended block per package (§6 of the Round 5 PRD).
 */
export const PACK_TABS: readonly PackTab[] = [
  // R5-A: marketplace seller (Receivables → Marketplace sub-views)
  { pack: 'marketplace', path: '/receivables?tab=marketplace', labelKey: 'tab.marketplace' },
  { pack: 'marketplace', path: '/receivables?tab=marketplace&view=channels', labelKey: 'view.channels' },
  { pack: 'marketplace', path: '/receivables?tab=marketplace&view=import', labelKey: 'view.import' },
  { pack: 'marketplace', path: '/receivables?tab=marketplace&view=settlements', labelKey: 'view.settlements' },
  { pack: 'marketplace', path: '/receivables?tab=marketplace&view=tcs', labelKey: 'view.tcs' },
  { pack: 'marketplace', path: '/receivables?tab=marketplace&view=returns', labelKey: 'view.returns' },
  // R5-C: fees, leases, donations, funds, common credit (labels in `packs-institutions-r5.ts`)
  { pack: 'fees', path: '/recurring?tab=fees', labelKey: 'tab.fees' },
  { pack: 'leases', path: '/recurring?tab=leases', labelKey: 'tab.leases' },
  { pack: 'nonprofit', path: '/receivables?tab=donations', labelKey: 'tab.donations' },
  { pack: 'nonprofit', path: '/books?tab=funds', labelKey: 'tab.funds' },
  { pack: 'fees', alsoPacks: ['nonprofit', 'leases'], path: '/gst-reports?tab=common-credit', labelKey: 'tab.commonCredit' },
  // R5-B: transport (Distribution → Transport) and works contracts (Time → Works); labels in `packs-transport-works-r5.ts`
  { pack: 'transport', path: '/distribution?tab=transport', labelKey: 'tab.transport' },
  { pack: 'transport', path: '/distribution?tab=transport&view=trips', labelKey: 'view.trips' },
  { pack: 'transport', path: '/distribution?tab=transport&view=vehicles', labelKey: 'view.vehicles' },
  { pack: 'works', path: '/time?tab=works', labelKey: 'tab.works' },
  { pack: 'works', path: '/time?tab=works&view=retention', labelKey: 'view.retention' },
  { pack: 'works', path: '/time?tab=works&view=sites', labelKey: 'view.sites' },
  // R7: hotel (Tables → Front desk, sub-views in `&view=`; labels in `hotel-frontdesk-r7.ts`)
  { pack: 'hotel', path: '/tables?tab=frontdesk', labelKey: 'tab.frontdesk' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=calendar', labelKey: 'view.calendar' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=reservations', labelKey: 'view.reservations' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=folios', labelKey: 'view.folios' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=housekeeping', labelKey: 'view.housekeeping' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=audit', labelKey: 'view.audit' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=guests', labelKey: 'view.guests' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=formc', labelKey: 'view.formc' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=reports', labelKey: 'view.reports' },
  { pack: 'hotel', path: '/tables?tab=frontdesk&view=setup', labelKey: 'view.setup' },
  // R8: trading packs on Distribution (labels in `trade-r8c.ts`, keys `r8.*`)
  { pack: 'distributor', path: '/distribution?tab=claims', labelKey: 'r8.claims' },
  { pack: 'distributor', path: '/distribution?tab=claims&view=schemes', labelKey: 'r8.schemes' },
  { pack: 'distributor', path: '/distribution?tab=claims&view=pricedrop', labelKey: 'r8.pricedrop' },
  { pack: 'distributor', path: '/distribution?tab=claims&view=claims', labelKey: 'r8.claimList' },
  { pack: 'distributor', alsoPacks: ['commodity', 'agency'], path: '/distribution?tab=packaging', labelKey: 'r8.packaging' },
  { pack: 'commodity', alsoPacks: ['agency'], path: '/distribution?tab=mandi', labelKey: 'r8.mandi' },
  { pack: 'commodity', alsoPacks: ['agency'], path: '/distribution?tab=brokers', labelKey: 'r8.brokers' },
  { pack: 'agency', path: '/distribution?tab=agency', labelKey: 'r8.agency' },
  { pack: 'agency', path: '/distribution?tab=agency&view=arrivals', labelKey: 'r8.arrivals' },
  { pack: 'agency', path: '/distribution?tab=agency&view=pattis', labelKey: 'r8.pattis' },
  { pack: 'agency', path: '/distribution?tab=agency&view=indents', labelKey: 'r8.indents' },
];

/**
 * Tabs of a page filtered by their pack: rows without `pack` always show; a row whose pack is off is hidden unless it
 * is the tab being shown (its URL still opens it).
 */
export function visibleTabs<T extends { id: string; pack?: PackId }>(tabs: readonly T[], s: PackSettings | null | undefined, current?: string): T[] {
  const on = activePacks(s);
  return tabs.filter((t) => !t.pack || on.includes(t.pack) || t.id === current);
}

/**
 * R8-C: like `visibleTabs`, for rows that a tab shares between packs (`alsoPacks`, e.g. Distribution → Mandi for the
 * commodity and agency packs). A row whose packs are all off is hidden unless it is the tab being shown.
 */
export function visiblePackTabs<T extends { id: string; pack?: PackId; alsoPacks?: readonly PackId[] }>(tabs: readonly T[], s: PackSettings | null | undefined, current?: string): T[] {
  const on = activePacks(s);
  return tabs.filter((t) => !t.pack || on.includes(t.pack) || (t.alsoPacks ?? []).some((p) => on.includes(p)) || t.id === current);
}
