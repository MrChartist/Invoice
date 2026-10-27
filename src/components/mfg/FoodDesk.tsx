/**
 * MF-D Food desk (`/manufacturing?tab=food&view=`, pack `foodmfg`): batch cost cards (D1), shelf life at dispatch and
 * the near-expiry desk (D2), food / FMCG scheme presets with the Circular 251 note (D2). One lazy chunk with its views;
 * nothing is read until the tab opens. Working papers — verify with your CA.
 */
import { useT } from '../../i18n';
import { fdT } from '../../i18n/areas/mfg-r13d-food';
import controls from '../../styles/controls.module.css';
import type { MfDeskProps } from './desk-props';
import { Views } from './mfd-ui';
import CostCardsView from './CostCardsView';
import ShelfLifeView from './ShelfLifeView';
import SchemesView from './SchemesView';

const VIEWS = ['costcards', 'shelflife', 'schemes'] as const;

export default function FoodDesk({ view, ctx }: MfDeskProps) {
  useT();
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? view! : 'costcards';
  return (
    <section data-food-desk>
      <Views tab="food" views={VIEWS} view={v} label={(k) => fdT(`view.${k}` as 'view.costcards')} />
      {v === 'costcards' && <CostCardsView ctx={ctx} />}
      {v === 'shelflife' && <ShelfLifeView ctx={ctx} />}
      {v === 'schemes' && <SchemesView ctx={ctx} />}
      <p className={controls.hint}>{fdT('wp')}</p>
    </section>
  );
}
