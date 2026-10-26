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

export type PackId = 'marketplace' | 'transport' | 'works' | 'fees' | 'nonprofit' | 'leases';

export const PACK_IDS: readonly PackId[] = ['marketplace', 'transport', 'works', 'fees', 'nonprofit', 'leases'];

/** The packs a business type implies when `industry_packs` is absent. */
export const PACK_OF_TYPE: Readonly<Partial<Record<BusinessType, readonly PackId[]>>> = {
  ecommerce: ['marketplace'],
  transport: ['transport'],
  contractor: ['works'],
  institution: ['fees'],
  nonprofit: ['nonprofit'],
  property: ['leases'],
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
  path: string;
  labelKey: string;
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
];

/**
 * Tabs of a page filtered by their pack: rows without `pack` always show; a row whose pack is off is hidden unless it
 * is the tab being shown (its URL still opens it).
 */
export function visibleTabs<T extends { id: string; pack?: PackId }>(tabs: readonly T[], s: PackSettings | null | undefined, current?: string): T[] {
  const on = activePacks(s);
  return tabs.filter((t) => !t.pack || on.includes(t.pack) || t.id === current);
}
