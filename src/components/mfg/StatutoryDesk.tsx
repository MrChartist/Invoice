/**
 * MF-D Statutory desk (`/manufacturing?tab=statutory&view=`, pack `shopfloor`): MSME both ways (D3), incentives and
 * export authorisations (D4), the Schedule III inventories split with the WIP statement (D5). One lazy chunk with its
 * views; nothing is read until the tab opens. Working papers — verify with your CA; nothing is filed.
 */
import { useT } from '../../i18n';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import controls from '../../styles/controls.module.css';
import type { MfDeskProps } from './desk-props';
import { Views } from './mfd-ui';
import MsmeView from './MsmeView';
import IncentivesView from './IncentivesView';
import AuthorisationsView from './AuthorisationsView';
import InventoriesView from './InventoriesView';

const VIEWS = ['msme', 'incentives', 'authorisations', 'inventories'] as const;

export default function StatutoryDesk({ view, ctx }: MfDeskProps) {
  useT();
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? view! : 'msme';
  return (
    <section data-statutory-desk>
      <Views tab="statutory" views={VIEWS} view={v} label={(k) => sdT(`view.${k}` as 'view.msme')} />
      {v === 'msme' && <MsmeView ctx={ctx} />}
      {v === 'incentives' && <IncentivesView ctx={ctx} />}
      {v === 'authorisations' && <AuthorisationsView ctx={ctx} />}
      {v === 'inventories' && <InventoriesView ctx={ctx} />}
      <p className={controls.hint}>{sdT('wp')}</p>
    </section>
  );
}
