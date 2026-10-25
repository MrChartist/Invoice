import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { useCan } from '../../hooks/useCan';
import { localDb } from '../../lib/localDb';
import { enabledModules } from '../../lib/shop-mode';
import { PLUS_ONE_TAP_KEY, quickActions } from '../../lib/quick-create';
import { QUICK_ICONS } from './quick-icons';
import { readRaw, removeRaw, writeRaw } from '../../lib/storage';
import { useT } from '../../i18n';
import { reachT } from '../../i18n/areas/reach';
import controls from '../../styles/controls.module.css';
import styles from './QuickCreate.module.css';

/** Phone "+" sheet (8H): the everyday "new …" actions this user and company use. */
export function QuickCreateSheet({ onClose }: { onClose: () => void }) {
  useT();
  const { can } = useCan();
  const actions = quickActions(can, enabledModules(localDb.settings.get()));
  const [oneTap, setOneTap] = useState(() => readRaw(PLUS_ONE_TAP_KEY) === '1');
  return (
    <Modal open onClose={onClose} size="sm" title={reachT('qa.title')}>
      <div className={styles.grid}>
        {actions.map((a) => {
          const Icon = QUICK_ICONS[a.id];
          return (
            <Link key={a.id} to={a.to} className={styles.action} onClick={onClose} data-quick={a.id}>
              <Icon size={22} aria-hidden="true" />
              <span>{reachT(`qa.${a.id}`)}</span>
            </Link>
          );
        })}
      </div>
      <label className={controls.check}>
        <input
          type="checkbox"
          checked={oneTap}
          onChange={(e) => {
            setOneTap(e.target.checked);
            try {
              if (e.target.checked) writeRaw(PLUS_ONE_TAP_KEY, '1');
              else removeRaw(PLUS_ONE_TAP_KEY);
            } catch {
              /* a preference that cannot be saved just is not remembered */
            }
          }}
        />{' '}
        {reachT('qa.oneTap')}
      </label>
    </Modal>
  );
}
