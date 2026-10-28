/**
 * R6-B4: the extra sample rows of each business profile, one chunk per profile (a kirana never downloads the works
 * dataset). The transport and works rows are built only while their pack is on. Pure builders; `loadDemoData`
 * (`opts.extras`) writes them.
 */
import type { DemoDataset, DemoExtras, DemoProfile } from '../demo-data';
import type { SocietySettings } from '../../types/society-r18';
import type { LogisticsSettings } from '../../types/logistics-r19';

export interface ProfileContext {
  /** Local day the dataset is anchored on (YYYY-MM-DD). */
  today: string;
  base: DemoDataset;
  /** The Demo company's industry packs. */
  packs: readonly string[];
  /** R9: the Demo company's business type (a kirana counter gets the grocery rows). */
  businessType?: string;
}

export async function demoExtras(profile: DemoProfile, ctx: ProfileContext): Promise<DemoExtras & { societySettings?: SocietySettings; logisticsSettings?: LogisticsSettings }> {
  const base = await profileExtras(profile, ctx);
  // R12: an agri Demo company (any profile with the `agri` pack) adds its rows (`profile-agri.ts`, by pack).
  const agri = ctx.packs.includes('agri') ? (await import('./profile-agri')).agriExtras(ctx) : {};
  // R13: a manufacturing Demo company (pack `shopfloor`) adds its rows (`profile-mfg.ts`, by pack; stock items appended).
  const mfg = ctx.packs.includes('shopfloor') ? (await import('./profile-mfg')).mfgExtras(ctx) : {};
  // R14: a professional Demo company (pack `practice`) adds its rows (`profile-prof.ts`, by pack; time entries appended).
  const prof = ctx.packs.includes('practice') ? (await import('./profile-prof')).profExtras(ctx) : {};
  // R15: a travel Demo company (pack `travel` / `events`) adds its rows (`profile-travel.ts`, by pack; trip cost centres appended).
  const travel = ctx.packs.some((p) => p === 'travel' || p === 'events') ? (await import('./profile-travel')).travelExtras(ctx) : {};
  // R17: a manpower Demo company (pack `manpower` / `security`) adds its sites (`profile-manpower.ts`; cost centres appended).
  const manpower = ctx.packs.some((p) => p === 'manpower' || p === 'security') ? (await import('./profile-manpower')).manpowerExtras(ctx) : {};
  // R18: a society Demo company (pack `society`) adds its units (`profile-society.ts`) and its tariff (written by fillDemo).
  const society = ctx.packs.includes('society') ? (await import('./profile-society')).societyExtras(ctx) : undefined;
  // R19: a logistics Demo company (pack `logistics`) adds its job and agent (`profile-logistics.ts`) and its heads (written by fillDemo).
  const logistics = ctx.packs.includes('logistics') ? (await import('./profile-logistics')).logisticsExtras(ctx) : undefined;
  if (!agri.tables && !mfg.tables && !prof.tables && !travel.tables && !manpower.tables && !society && !logistics) return base;
  const stock = [...(base.tables?.stock_items ?? []), ...(agri.tables?.stock_items ?? []), ...(mfg.tables?.stock_items ?? [])];
  const time = [...(base.tables?.time_entries ?? []), ...(prof.tables?.time_entries ?? [])];
  const centres = [...(prof.tables?.cost_centres ?? []), ...(travel.tables?.cost_centres ?? []), ...(manpower.tables?.cost_centres ?? [])];
  const staff = [...(base.tables?.service_staff ?? []), ...(prof.tables?.service_staff ?? [])];
  // R16-C4: the travel profile also adds a TCS invoice
  return { ...base, ...(society ? { societySettings: society.societySettings } : {}), ...(logistics ? { logisticsSettings: logistics.logisticsSettings } : {}), ...(travel.invoices ? { invoices: [...(base.invoices ?? []), ...travel.invoices] } : {}), tables: { ...base.tables, ...agri.tables, ...mfg.tables, ...prof.tables, ...travel.tables, ...society?.tables, ...logistics?.tables, ...(centres.length ? { cost_centres: centres } : {}), ...(stock.length ? { stock_items: stock } : {}), ...(time.length ? { time_entries: time } : {}), ...(staff.length ? { service_staff: staff } : {}) } };
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
