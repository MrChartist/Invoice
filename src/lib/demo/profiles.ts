/**
 * R6-B4: the extra sample rows of each business profile, one chunk per profile (a kirana never downloads the works
 * dataset). The transport and works rows are built only while their pack is on. Pure builders; `loadDemoData`
 * (`opts.extras`) writes them.
 */
import type { DemoDataset, DemoExtras, DemoProfile } from '../demo-data';

export interface ProfileContext {
  /** Local day the dataset is anchored on (YYYY-MM-DD). */
  today: string;
  base: DemoDataset;
  /** The Demo company's industry packs. */
  packs: readonly string[];
  /** R9: the Demo company's business type (a kirana counter gets the grocery rows). */
  businessType?: string;
}

export async function demoExtras(profile: DemoProfile, ctx: ProfileContext): Promise<DemoExtras> {
  const base = await profileExtras(profile, ctx);
  // R12: an agri Demo company (any profile with the `agri` pack) adds its rows (`profile-agri.ts`, by pack).
  if (!ctx.packs.includes('agri')) return base;
  const agri = (await import('./profile-agri')).agriExtras(ctx);
  return { ...base, tables: { ...base.tables, ...agri.tables } };
}

async function profileExtras(profile: DemoProfile, ctx: ProfileContext): Promise<DemoExtras> {
  switch (profile) {
    case 'counter': { // R9 (RT-A1): plus the retail shop's rows (grocery, or the retail pack's block)
      const [{ counterExtras }, retail] = await Promise.all([import('./profile-counter'), import('./profile-retail')]);
      return retail.mergeExtras(counterExtras(ctx), retail.retailExtras(ctx));
    }
    case 'services':
      return (await import('./profile-services')).servicesExtras(ctx);
    case 'transport':
      return ctx.packs.includes('transport') ? (await import('./profile-transport')).transportExtras(ctx) : {};
    case 'works':
      return ctx.packs.includes('works') ? (await import('./profile-works')).worksExtras(ctx) : {};
    case 'trading': // R8-C: the trading packs' rows (agency now; distributor / commodity from TR-A / TR-B)
      return ['distributor', 'commodity', 'agency'].some((p) => ctx.packs.includes(p)) ? (await import('./profile-trading')).tradingExtras(ctx) : {};
    default:
      return {};
  }
}
