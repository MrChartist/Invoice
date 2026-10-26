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
}

export async function demoExtras(profile: DemoProfile, ctx: ProfileContext): Promise<DemoExtras> {
  switch (profile) {
    case 'counter':
      return (await import('./profile-counter')).counterExtras(ctx);
    case 'services':
      return (await import('./profile-services')).servicesExtras(ctx);
    case 'transport':
      return ctx.packs.includes('transport') ? (await import('./profile-transport')).transportExtras(ctx) : {};
    case 'works':
      return ctx.packs.includes('works') ? (await import('./profile-works')).worksExtras(ctx) : {};
    default:
      return {};
  }
}
