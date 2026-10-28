/**
 * MF-B Shop desk (`/manufacturing?tab=shop&view=`, pack `fabrication`): drawings and revisions, weight-based job quotes,
 * inspection reports and the scrap register / scrap sale. The desk and its views are ONE lazy chunk (the R9 / R12 desk
 * pattern: gzip shares their vocabulary); nothing is read until the tab opens. Working papers — verify with your CA.
 */
import { useT } from '../../i18n';
import { shT } from '../../i18n/areas/mfg-r13b-shop';
import type { MfgContext } from '../manufacturing/context';
import { Desk } from './mfb-ui';
import DrawingsView from './DrawingsView';
import QuotesView from './QuotesView';
import InspectionView from './InspectionView';
import ScrapView from './ScrapView';

const VIEWS = ['drawings', 'quotes', 'inspection', 'scrap'] as const;

export default function ShopDesk({ view, ctx }: { view?: string; ctx: MfgContext }) {
  useT();
  const v = VIEWS.find((k) => k === view) ?? 'drawings';
  const done = (m: string, bad?: boolean) => (bad ? ctx.error(m) : ctx.changed(m));
  return (
    <Desk desk="shop" views={VIEWS} v={v} label={(k) => shT(`v.${k as typeof v}`)} hint={shT('wp')}>
      {v === 'drawings' && <DrawingsView ctx={ctx} done={done} />}
      {v === 'quotes' && <QuotesView ctx={ctx} done={done} />}
      {v === 'inspection' && <InspectionView ctx={ctx} done={done} />}
      {v === 'scrap' && <ScrapView ctx={ctx} done={done} />}
    </Desk>
  );
}
