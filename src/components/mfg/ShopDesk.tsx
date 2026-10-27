/**
 * MF-B Shop desk (`/manufacturing?tab=shop&view=`, pack `fabrication`): drawings and revisions, weight-based job quotes,
 * inspection reports and the scrap register / scrap sale. The desk and its views are ONE lazy chunk (the R9 / R12 desk
 * pattern: gzip shares their vocabulary); nothing is read until the tab opens. Working papers — verify with your CA.
 */
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { shT } from '../../i18n/areas/mfg-r13b-shop';
import controls from '../../styles/controls.module.css';
import type { MfgContext } from '../manufacturing/context';
import DrawingsView from './DrawingsView';
import QuotesView from './QuotesView';
import InspectionView from './InspectionView';
import ScrapView from './ScrapView';

const VIEWS = ['drawings', 'quotes', 'inspection', 'scrap'] as const;
type View = (typeof VIEWS)[number];

export default function ShopDesk({ view, ctx }: { view?: string; ctx: MfgContext }) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'drawings';
  const done = (m: string, bad?: boolean) => (bad ? ctx.error(m) : ctx.changed(m));
  return (
    <section data-shop-desk={v}>
      <div role="tablist" className={controls.segment} style={{ marginBottom: '0.75rem' }}>
        {VIEWS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'shop', view: k })} data-shop-view={k}>{shT(`v.${k}`)}</button>
        ))}
      </div>
      {v === 'drawings' && <DrawingsView ctx={ctx} done={done} />}
      {v === 'quotes' && <QuotesView ctx={ctx} done={done} />}
      {v === 'inspection' && <InspectionView ctx={ctx} done={done} />}
      {v === 'scrap' && <ScrapView ctx={ctx} done={done} />}
      <p className={controls.hint}>{shT('wp')}</p>
    </section>
  );
}
