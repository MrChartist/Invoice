/**
 * MF-B Moulding desk (`/manufacturing?tab=moulding&view=`, pack `plastics`): moulding / extrusion runs with moulds,
 * the material balance and the EPR register. One lazy chunk with its views. Working papers — verify with your CA.
 */
import { useT } from '../../i18n';
import { moT } from '../../i18n/areas/mfg-r13b-mould';
import type { MfgContext } from '../manufacturing/context';
import { Desk } from './mfb-ui';
import RunsView from './RunsView';
import BalanceView from './BalanceView';
import EprView from './EprView';

const VIEWS = ['runs', 'balance', 'epr'] as const;

export default function MouldingDesk({ view, ctx }: { view?: string; ctx: MfgContext }) {
  useT();
  const v = VIEWS.find((k) => k === view) ?? 'runs';
  const done = (m: string, bad?: boolean) => (bad ? ctx.error(m) : ctx.changed(m));
  return (
    <Desk desk="moulding" views={VIEWS} v={v} label={(k) => moT(`v.${k as typeof v}`)} hint={moT('wp')}>
      {v === 'runs' && <RunsView ctx={ctx} done={done} />}
      {v === 'balance' && <BalanceView ctx={ctx} />}
      {v === 'epr' && <EprView ctx={ctx} done={done} />}
    </Desk>
  );
}
