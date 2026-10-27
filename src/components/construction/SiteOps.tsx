/**
 * CN-D site operations — ONE lazy chunk behind Time → Works (views subcon, labour, plant, reco, pnl): sub-contract work
 * orders and bills, labour contractors and the muster, plant logs and hire, material reconciliation and the site P&L.
 * Strings: `i18n/areas/construction-r11d.ts`. Working papers — verify with your CA (CN14–CN17, CN26, CN29–CN31).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import type { Notify } from '../transport/shared';
import SubconView from './SubconView';
import LabourView from './LabourView';
import PlantView from './PlantView';
import RecoView from './RecoView';
import SitePnlView from './SitePnlView';
import { T } from './site-kit';
import controls from '../../styles/controls.module.css';

export type SiteView = 'subcon' | 'labour' | 'plant' | 'reco' | 'pnl';

export default function SiteOps({ view, boq, notify }: { view: SiteView; boq?: InvoiceRecord; notify: Notify }) {
  useT();
  if ((view === 'reco' || view === 'pnl') && !boq) return <p className={controls.hint}>{T('noBoq')}</p>;
  return (
    <section data-site-ops={view}>
      {view === 'subcon' ? <SubconView key={boq?.id} boq={boq} notify={notify} /> : view === 'labour' ? <LabourView notify={notify} /> : view === 'plant' ? <PlantView notify={notify} /> : view === 'reco' ? <RecoView key={boq!.id} boq={boq!} notify={notify} /> : <SitePnlView key={boq!.id} boq={boq!} notify={notify} />}
      <p className={controls.hint}>{T('wp')}</p>
    </section>
  );
}
