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
  | 'distributor' | 'commodity' | 'agency'
  // R9 (RT-A1): retail packs (a tab each on /inventory; switched on by the `kirana` retail profile, never by a business type)
  | 'pharmacy' | 'apparel' | 'electronics' | 'jewellery'
  // R11 (CN-A1): builders / developers (a tab on /receivables; switched on by the `builder` construction profile)
  | 'realty'
  // R10 (SV-A1): service packs (desk tabs on /time; switched on by the `services` service profile, never by a business type)
  | 'clinic' | 'salon' | 'fitness' | 'workshop'
  // R12 (AG-A1): agri packs (desk tabs on /inventory; switched on by the agri profile, never by a business type)
  | 'agri' | 'dairy' | 'mill' | 'coldstore' | 'agri_inputs' | 'fpo';

export const PACK_IDS: readonly PackId[] = [
  'marketplace', 'transport', 'works', 'fees', 'nonprofit', 'leases',
  'hotel', // R7-A
  'distributor', 'commodity', 'agency', // R8-C
  'pharmacy', 'apparel', 'electronics', 'jewellery', // R9 (RT-A1)
  'realty', // R11 (CN-A1)
  'clinic', 'salon', 'fitness', 'workshop', // R10 (SV-A1)
  'agri', 'dairy', 'mill', 'coldstore', 'agri_inputs', 'fpo', // R12 (AG-A1)
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
  { pack: 'fees', alsoPacks: ['nonprofit', 'leases', 'hotel', 'clinic', 'salon', 'fitness'], path: '/gst-reports?tab=common-credit', labelKey: 'tab.commonCredit' }, // R10 (SV-A4): + clinic / salon / fitness
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
  // R9: retail packs on Inventory (one desk tab each, sub-views in `&view=`; labels `r9.*` in `palette-destinations.ts`)
  { pack: 'pharmacy', path: '/inventory?tab=pharmacy', labelKey: 'r9.pharmacy' },
  { pack: 'pharmacy', path: '/inventory?tab=pharmacy&view=rx', labelKey: 'r9.rx' },
  { pack: 'pharmacy', path: '/inventory?tab=pharmacy&view=doctors', labelKey: 'r9.doctors' },
  { pack: 'pharmacy', path: '/inventory?tab=pharmacy&view=registers', labelKey: 'r9.registers' },
  { pack: 'pharmacy', path: '/inventory?tab=pharmacy&view=refills', labelKey: 'r9.refills' },
  { pack: 'pharmacy', path: '/inventory?tab=pharmacy&view=prices', labelKey: 'r9.prices' },
  { pack: 'apparel', path: '/inventory?tab=apparel', labelKey: 'r9.apparel' },
  { pack: 'apparel', path: '/inventory?tab=apparel&view=matrix', labelKey: 'r9.matrix' },
  { pack: 'apparel', path: '/inventory?tab=apparel&view=alterations', labelKey: 'r9.alterations' },
  { pack: 'apparel', path: '/inventory?tab=apparel&view=bands', labelKey: 'r9.bands' },
  { pack: 'electronics', path: '/inventory?tab=devices', labelKey: 'r9.devices' },
  { pack: 'electronics', path: '/inventory?tab=devices&view=imei', labelKey: 'r9.imei' },
  { pack: 'electronics', path: '/inventory?tab=devices&view=finance', labelKey: 'r9.finance' },
  { pack: 'electronics', path: '/inventory?tab=devices&view=buyback', labelKey: 'r9.buyback' },
  { pack: 'electronics', path: '/inventory?tab=devices&view=service', labelKey: 'r9.service' },
  { pack: 'jewellery', path: '/inventory?tab=jewellery', labelKey: 'r9.jewellery' },
  { pack: 'jewellery', path: '/inventory?tab=jewellery&view=rates', labelKey: 'r9.rates' },
  { pack: 'jewellery', path: '/inventory?tab=jewellery&view=tags', labelKey: 'r9.tags' },
  { pack: 'jewellery', path: '/inventory?tab=jewellery&view=oldgold', labelKey: 'r9.oldgold' },
  { pack: 'jewellery', path: '/inventory?tab=jewellery&view=karigar', labelKey: 'r9.karigar' },
  // R11: construction — the RA bill view on /time (pack `works`) and the builder desk on /receivables (pack `realty`);
  // labels `r11.*` in `palette-destinations.ts`. CN-B / CN-D add their Works views and CN-C the desk's views with
  // their screens (one row + help topic + palette label each).
  { pack: 'works', path: '/time?tab=works&view=ra', labelKey: 'r11.ra' },
  // CN-B: contractor finance (labels `view.*` in `packs-transport-works-r5.ts`)
  { pack: 'works', path: '/time?tab=works&view=contracts', labelKey: 'view.contracts' },
  { pack: 'works', path: '/time?tab=works&view=advances', labelKey: 'view.advances' },
  { pack: 'works', path: '/time?tab=works&view=escalation', labelKey: 'view.escalation' },
  { pack: 'works', path: '/time?tab=works&view=guarantees', labelKey: 'view.guarantees' },
  { pack: 'realty', path: '/receivables?tab=realty', labelKey: 'r11.realty' },
  // CN-C: the builder desk's views
  { pack: 'realty', path: '/receivables?tab=realty&view=projects', labelKey: 'r11.realty.projects' },
  { pack: 'realty', path: '/receivables?tab=realty&view=units', labelKey: 'r11.realty.units' },
  { pack: 'realty', path: '/receivables?tab=realty&view=bookings', labelKey: 'r11.realty.bookings' },
  { pack: 'realty', path: '/receivables?tab=realty&view=plans', labelKey: 'r11.realty.plans' },
  { pack: 'realty', path: '/receivables?tab=realty&view=demands', labelKey: 'r11.realty.demands' },
  { pack: 'realty', path: '/receivables?tab=realty&view=rera', labelKey: 'r11.realty.rera' },
  { pack: 'realty', path: '/receivables?tab=realty&view=cancellations', labelKey: 'r11.realty.cancellations' },
  { pack: 'realty', path: '/receivables?tab=realty&view=procurement', labelKey: 'r11.realty.procurement' },
  // R10: service desks on /time (SV-A writes every row; labels `r10.*` in `palette-destinations.ts`). The front desk is
  // shared: appointments for clinic / salon / fitness / workshop, commission for the same four.
  { pack: 'clinic', alsoPacks: ['salon', 'fitness', 'workshop'], path: '/time?tab=appointments', labelKey: 'r10.appointments' },
  { pack: 'clinic', alsoPacks: ['salon', 'fitness', 'workshop'], path: '/time?tab=appointments&view=day', labelKey: 'r10.day' },
  { pack: 'clinic', alsoPacks: ['salon', 'fitness', 'workshop'], path: '/time?tab=appointments&view=week', labelKey: 'r10.week' },
  { pack: 'clinic', alsoPacks: ['salon', 'fitness', 'workshop'], path: '/time?tab=appointments&view=queue', labelKey: 'r10.queue' },
  { pack: 'clinic', alsoPacks: ['salon', 'fitness', 'workshop'], path: '/time?tab=appointments&view=birthdays', labelKey: 'r10.birthdays' },
  { pack: 'salon', alsoPacks: ['fitness', 'clinic', 'workshop'], path: '/time?tab=commission', labelKey: 'r10.commission' },
  { pack: 'salon', alsoPacks: ['fitness', 'clinic', 'workshop'], path: '/time?tab=commission&view=staff', labelKey: 'r10.staff' },
  { pack: 'salon', alsoPacks: ['fitness', 'clinic', 'workshop'], path: '/time?tab=commission&view=plans', labelKey: 'r10.plans' },
  { pack: 'salon', alsoPacks: ['fitness', 'clinic', 'workshop'], path: '/time?tab=commission&view=statement', labelKey: 'r10.statement' },
  // SV-B: clinic desk
  { pack: 'clinic', path: '/time?tab=clinic', labelKey: 'r10.clinic' },
  { pack: 'clinic', path: '/time?tab=clinic&view=patients', labelKey: 'r10.patients' },
  { pack: 'clinic', path: '/time?tab=clinic&view=opd', labelKey: 'r10.opd' },
  { pack: 'clinic', path: '/time?tab=clinic&view=ipd', labelKey: 'r10.ipd' },
  { pack: 'clinic', path: '/time?tab=clinic&view=lab', labelKey: 'r10.lab' },
  { pack: 'clinic', path: '/time?tab=clinic&view=tests', labelKey: 'r10.tests' },
  { pack: 'clinic', path: '/time?tab=clinic&view=referrals', labelKey: 'r10.referrals' },
  { pack: 'clinic', path: '/time?tab=clinic&view=rates', labelKey: 'r10.rates' },
  // SV-C: members desk (fitness, salon packages) and the coaching views of the Fees tab
  { pack: 'fitness', alsoPacks: ['salon'], path: '/time?tab=members', labelKey: 'r10.members' },
  { pack: 'fitness', alsoPacks: ['salon'], path: '/time?tab=members&view=plans', labelKey: 'r10.memberPlans' },
  { pack: 'fitness', alsoPacks: ['salon'], path: '/time?tab=members&view=members', labelKey: 'r10.memberList' },
  { pack: 'fitness', alsoPacks: ['salon'], path: '/time?tab=members&view=checkin', labelKey: 'r10.checkin' },
  { pack: 'fitness', alsoPacks: ['salon'], path: '/time?tab=members&view=classes', labelKey: 'r10.classes' },
  { pack: 'fitness', alsoPacks: ['salon'], path: '/time?tab=members&view=recipes', labelKey: 'r10.recipes' },
  { pack: 'fees', path: '/recurring?tab=fees&view=batches', labelKey: 'r10.batches' },
  { pack: 'fees', path: '/recurring?tab=fees&view=attendance', labelKey: 'r10.attendance' },
  { pack: 'fees', path: '/recurring?tab=fees&view=refunds', labelKey: 'r10.refunds' },
  // SV-D: workshop desk (claims view: SV-A5's claims desk until SV-D merges its own)
  { pack: 'workshop', path: '/time?tab=workshop', labelKey: 'r10.workshop' },
  { pack: 'workshop', path: '/time?tab=workshop&view=jobs', labelKey: 'r10.jobs' },
  { pack: 'workshop', path: '/time?tab=workshop&view=estimates', labelKey: 'r10.estimates' },
  { pack: 'workshop', path: '/time?tab=workshop&view=claims', labelKey: 'r10.claims' },
  { pack: 'workshop', path: '/time?tab=workshop&view=reminders', labelKey: 'r10.reminders' },
  { pack: 'workshop', path: '/time?tab=workshop&view=labour', labelKey: 'r10.labour' },
  { pack: 'workshop', path: '/time?tab=workshop&view=vehicles', labelKey: 'r10.vehicles' },
  // CN-D: site operations (Works views)
  { pack: 'works', path: '/time?tab=works&view=subcon', labelKey: 'r11.subcon' },
  { pack: 'works', path: '/time?tab=works&view=labour', labelKey: 'r11.labour' },
  { pack: 'works', path: '/time?tab=works&view=plant', labelKey: 'r11.plant' },
  { pack: 'works', path: '/time?tab=works&view=reco', labelKey: 'r11.reco' },
  { pack: 'works', path: '/time?tab=works&view=pnl', labelKey: 'r11.pnl' },
  // R12: agri desks on /inventory (AG-A writes every row; labels `r12.*` in `palette-destinations.ts`). B / C / D replace
  // their desk's stub with their screens; the rows stay.
  { pack: 'agri', path: '/inventory?tab=farm', labelKey: 'r12.farm' },
  { pack: 'agri', path: '/inventory?tab=farm&view=farmers', labelKey: 'r12.farm.farmers' },
  { pack: 'agri', path: '/inventory?tab=farm&view=vouchers', labelKey: 'r12.farm.vouchers' },
  { pack: 'agri', path: '/inventory?tab=farm&view=cycles', labelKey: 'r12.farm.cycles' },
  { pack: 'agri', path: '/inventory?tab=farm&view=quality', labelKey: 'r12.farm.quality' },
  { pack: 'agri', path: '/inventory?tab=farm&view=batches', labelKey: 'r12.farm.batches' },
  { pack: 'dairy', path: '/inventory?tab=dairy', labelKey: 'r12.dairy' },
  { pack: 'dairy', path: '/inventory?tab=dairy&view=charts', labelKey: 'r12.dairy.charts' },
  { pack: 'dairy', path: '/inventory?tab=dairy&view=collection', labelKey: 'r12.dairy.collection' },
  { pack: 'dairy', path: '/inventory?tab=dairy&view=bills', labelKey: 'r12.dairy.bills' },
  { pack: 'dairy', path: '/inventory?tab=dairy&view=dispatch', labelKey: 'r12.dairy.dispatch' },
  { pack: 'dairy', path: '/inventory?tab=dairy&view=products', labelKey: 'r12.dairy.products' },
  { pack: 'dairy', path: '/inventory?tab=dairy&view=cards', labelKey: 'r12.dairy.cards' },
  { pack: 'mill', path: '/inventory?tab=mill', labelKey: 'r12.mill' },
  { pack: 'mill', path: '/inventory?tab=mill&view=intake', labelKey: 'r12.mill.intake' },
  { pack: 'mill', path: '/inventory?tab=mill&view=batches', labelKey: 'r12.mill.batches' },
  { pack: 'mill', path: '/inventory?tab=mill&view=cmr', labelKey: 'r12.mill.cmr' },
  { pack: 'mill', path: '/inventory?tab=mill&view=yield', labelKey: 'r12.mill.yield' },
  { pack: 'coldstore', path: '/inventory?tab=cold', labelKey: 'r12.cold' },
  { pack: 'coldstore', path: '/inventory?tab=cold&view=lots', labelKey: 'r12.cold.lots' },
  { pack: 'coldstore', path: '/inventory?tab=cold&view=gatepasses', labelKey: 'r12.cold.gatepasses' },
  { pack: 'coldstore', path: '/inventory?tab=cold&view=rent', labelKey: 'r12.cold.rent' },
  { pack: 'coldstore', path: '/inventory?tab=cold&view=loans', labelKey: 'r12.cold.loans' },
  { pack: 'coldstore', path: '/inventory?tab=cold&view=chambers', labelKey: 'r12.cold.chambers' },
  { pack: 'agri_inputs', path: '/inventory?tab=inputs', labelKey: 'r12.inputs' },
  { pack: 'agri_inputs', path: '/inventory?tab=inputs&view=licences', labelKey: 'r12.inputs.licences' },
  { pack: 'agri_inputs', path: '/inventory?tab=inputs&view=subsidy', labelKey: 'r12.inputs.subsidy' },
  { pack: 'agri_inputs', path: '/inventory?tab=inputs&view=credit', labelKey: 'r12.inputs.credit' },
  { pack: 'fpo', path: '/inventory?tab=members', labelKey: 'r12.members' },
  { pack: 'fpo', path: '/inventory?tab=members&view=register', labelKey: 'r12.members.register' },
  { pack: 'fpo', path: '/inventory?tab=members&view=shares', labelKey: 'r12.members.shares' },
  { pack: 'fpo', path: '/inventory?tab=members&view=patronage', labelKey: 'r12.members.patronage' },
  { pack: 'fpo', path: '/inventory?tab=members&view=papers', labelKey: 'r12.members.papers' },
  { pack: 'fpo', path: '/inventory?tab=members&view=loans', labelKey: 'r12.members.loans' },
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
