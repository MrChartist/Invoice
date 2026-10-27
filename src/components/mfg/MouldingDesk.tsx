/**
 * MF-B Moulding desk (`/manufacturing?tab=moulding&view=`, pack `plastics`): moulding / extrusion runs with moulds,
 * the material balance and the EPR register. One lazy chunk with its views. Working papers — verify with your CA.
 */
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { moT } from '../../i18n/areas/mfg-r13b-mould';
import controls from '../../styles/controls.module.css';
import type { MfgContext } from '../manufacturing/context';
import RunsView from './RunsView';
import BalanceView from './BalanceView';
import EprView from './EprView';

const VIEWS = ['runs', 'balance', 'epr'] as const;
type View = (typeof VIEWS)[number];

export default function MouldingDesk({ view, ctx }: { view?: string; ctx: MfgContext }) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'runs';
  const done = (m: string, bad?: boolean) => (bad ? ctx.error(m) : ctx.changed(m));
  return (
    <section data-moulding-desk={v}>
      <div role="tablist" className={controls.segment} style={{ marginBottom: '0.75rem' }}>
        {VIEWS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'moulding', view: k })} data-moulding-view={k}>{moT(`v.${k}`)}</button>
        ))}
      </div>
      {v === 'runs' && <RunsView ctx={ctx} done={done} />}
      {v === 'balance' && <BalanceView ctx={ctx} />}
      {v === 'epr' && <EprView ctx={ctx} done={done} />}
      <p className={controls.hint}>{moT('wp')}</p>
    </section>
  );
}
