/**
 * Accounts Info (WP-1): the menu and router for the masters screens. Default export so it can be
 * `React.lazy`-loaded (the Chart of accounts tab does; the Gateway of Tally can too). Screens are
 * addressed by `MasterScreen` + optional item id; see docs/features/masters.md for the URL form
 * `/books?tab=coa&m=<screen>&mid=<id>`.
 */
import { useState } from 'react';
import { can } from '../../lib/access';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { BillwiseOpening } from './BillwiseOpening';
import { GroupForm } from './GroupForm';
import { LedgerForm } from './LedgerForm';
import { MastersList } from './MastersList';
import { OpeningTrialBalance } from './OpeningTrialBalance';
import type { MasterScreen } from './screens';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';

export type { MasterScreen } from './screens';

export interface MastersPanelProps {
  /** Controlled screen (e.g. from the URL); omit to let the panel keep its own. */
  screen?: MasterScreen;
  /** Item id for alter / display / billwise. */
  itemId?: string;
  onNavigate?: (screen: MasterScreen, itemId?: string) => void;
  /** Leave the masters (Esc on the menu). */
  onClose?: () => void;
  /** Any master or opening was saved (refresh ledgers / reports). */
  onChanged?: () => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

export default function MastersPanel({ screen: screenProp, itemId: itemProp, onNavigate, onClose, onChanged, notify }: MastersPanelProps) {
  useT();
  const [own, setOwn] = useState<{ screen: MasterScreen; id?: string }>({ screen: 'menu' });
  const screen = screenProp ?? own.screen;
  const itemId = screenProp ? itemProp : own.id;
  const go = (s: MasterScreen, id?: string) => {
    if (onNavigate) onNavigate(s, id);
    if (!screenProp) setOwn({ screen: s, id });
  };
  const menu = () => go('menu');
  const done = () => {
    onChanged?.();
    menu();
  };
  const billwise = (id: string) => {
    onChanged?.();
    go('billwise', id);
  };

  switch (screen) {
    case 'group-create':
      return <GroupForm key="gc" mode="create" onDone={done} onBack={menu} notify={notify} />;
    case 'group-alter':
    case 'group-display':
      if (!itemId) return <MastersList kind="groups" title={mastersT('listOfGroups')} onPick={(id) => go(screen, id)} onBack={menu} />;
      return <GroupForm key={`g-${itemId}`} mode={screen === 'group-alter' ? 'alter' : 'display'} groupId={itemId} onDone={done} onBack={() => go(screen)} notify={notify} />;
    case 'ledger-create':
      return <LedgerForm key="lc" mode="create" onDone={done} onBack={menu} onBillwise={billwise} notify={notify} />;
    case 'ledger-alter':
    case 'ledger-display':
      if (!itemId) return <MastersList kind="ledgers" title={mastersT('listOfLedgers')} onPick={(id) => go(screen, id)} onBack={menu} />;
      return <LedgerForm key={`l-${itemId}`} mode={screen === 'ledger-alter' ? 'alter' : 'display'} ledgerId={itemId} onDone={done} onBack={() => go(screen)} onBillwise={billwise} notify={notify} />;
    case 'opening-tb':
      return <OpeningTrialBalance onDone={done} onBack={menu} onBillwise={billwise} notify={notify} />;
    case 'billwise':
      return itemId ? <BillwiseOpening key={itemId} ledgerId={itemId} onDone={done} onBack={menu} notify={notify} /> : <MastersMenu go={go} onClose={onClose} />;
    default:
      return <MastersMenu go={go} onClose={onClose} />;
  }
}

function MastersMenu({ go, onClose }: { go: (s: MasterScreen) => void; onClose?: () => void }) {
  const editMasters = can('master.edit');
  const block = (title: string, prefix: 'group' | 'ledger') => (
    <div className={styles.menuBlock}>
      <h3 className={styles.menuTitle}>{title}</h3>
      <div className={styles.menuLinks}>
        {editMasters && (
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => go(`${prefix}-create`)} aria-label={`${mastersT('create')} ${title}`}>
            {mastersT('create')}
          </button>
        )}
        {editMasters && (
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => go(`${prefix}-alter`)} aria-label={`${mastersT('alter')} ${title}`}>
            {mastersT('alter')}
          </button>
        )}
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => go(`${prefix}-display`)} aria-label={`${mastersT('display')} ${title}`}>
          {mastersT('display')}
        </button>
      </div>
    </div>
  );
  return (
    <section className={surface.card} aria-label={mastersT('accountsInfo')} onKeyDown={(e) => e.key === 'Escape' && onClose?.()}>
      <div className={surface.cardHead}>{mastersT('accountsInfo')}</div>
      <div className={surface.cardBody}>
        <div className={styles.screen}>
          <p className={styles.note}>{mastersT('accountsInfoHint')}</p>
          <div className={styles.menu}>
            {block(mastersT('groups'), 'group')}
            {block(mastersT('ledgers'), 'ledger')}
            <div className={styles.menuBlock}>
              <h3 className={styles.menuTitle}>{mastersT('openingTb')}</h3>
              <p className={styles.note}>{mastersT('openingTbHint')}</p>
              <div className={styles.menuLinks}>
                <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => go('opening-tb')}>
                  {mastersT('openingTb')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
