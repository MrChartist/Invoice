/**
 * MF-B Press desk (`/manufacturing?tab=press&view=`, pack `press`): print estimates (sheets / ups / impressions / GSM,
 * presses), job tickets and the paper calculator with paper by GSM. One lazy chunk with its views. Working papers —
 * printing GST classes are suggestions; verify with your CA (MF3–MF5).
 */
import { useT } from '../../i18n';
import { prT } from '../../i18n/areas/mfg-r13b-press';
import type { MfgContext } from '../manufacturing/context';
import { Desk } from './mfb-ui';
import EstimatesView, { PaperView } from './EstimatesView';
import TicketsView from './TicketsView';

const VIEWS = ['estimates', 'tickets', 'paper'] as const;

export default function PressDesk({ view, ctx }: { view?: string; ctx: MfgContext }) {
  useT();
  const v = VIEWS.find((k) => k === view) ?? 'estimates';
  const done = (m: string, bad?: boolean) => (bad ? ctx.error(m) : ctx.changed(m));
  return (
    <Desk desk="press" views={VIEWS} v={v} label={(k) => prT(`v.${k as typeof v}`)} hint={prT('wp')}>
      {v === 'estimates' && <EstimatesView ctx={ctx} done={done} />}
      {v === 'tickets' && <TicketsView ctx={ctx} done={done} />}
      {v === 'paper' && <PaperView ctx={ctx} />}
    </Desk>
  );
}
