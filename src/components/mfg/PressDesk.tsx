/**
 * MF-B Press desk (`/manufacturing?tab=press&view=`, pack `press`): print estimates (sheets / ups / impressions / GSM,
 * presses), job tickets and the paper calculator with paper by GSM. One lazy chunk with its views. Working papers —
 * printing GST classes are suggestions; verify with your CA (MF3–MF5).
 */
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { prT } from '../../i18n/areas/mfg-r13b-press';
import controls from '../../styles/controls.module.css';
import type { MfgContext } from '../manufacturing/context';
import EstimatesView, { PaperView } from './EstimatesView';
import TicketsView from './TicketsView';

const VIEWS = ['estimates', 'tickets', 'paper'] as const;
type View = (typeof VIEWS)[number];

export default function PressDesk({ view, ctx }: { view?: string; ctx: MfgContext }) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'estimates';
  const done = (m: string, bad?: boolean) => (bad ? ctx.error(m) : ctx.changed(m));
  return (
    <section data-press-desk={v}>
      <div role="tablist" className={controls.segment} style={{ marginBottom: '0.75rem' }}>
        {VIEWS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'press', view: k })} data-press-view={k}>{prT(`v.${k}`)}</button>
        ))}
      </div>
      {v === 'estimates' && <EstimatesView ctx={ctx} done={done} />}
      {v === 'tickets' && <TicketsView ctx={ctx} done={done} />}
      {v === 'paper' && <PaperView ctx={ctx} />}
      <p className={controls.hint}>{prT('wp')}</p>
    </section>
  );
}
