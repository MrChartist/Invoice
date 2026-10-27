/** R11 (CN-D): the Works view ids of the site desk and their tab labels (in the Works chunk; the screens are lazy). */
import { defineArea } from '../../i18n/area';

export const SITE_VIEWS = ['subcon', 'labour', 'plant', 'reco', 'pnl'] as const;

const labels = defineArea(
  { subcon: 'Sub-contracts', labour: 'Labour', plant: 'Plant', reco: 'Material reco', pnl: 'Site P&L' } as const,
  { subcon: 'उप-ठेके', labour: 'श्रमिक', plant: 'प्लांट', reco: 'सामग्री मिलान', pnl: 'साइट लाभ-हानि' },
);

export const siteViewLabel = (v: string) => labels(v as (typeof SITE_VIEWS)[number]);
