import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { suggest } from '../../lib/suggest';
import type { KhataRow } from '../../lib/khata';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import styles from '../pos-retail/retail.module.css';

/**
 * "Payment in" from the installed app's shortcut (`/clients?pay=1`, 8E wiring): pick the party, then
 * the ₹ Received quick-entry sheet opens. Parties owing money come first; typing searches name / phone.
 */
export default function PartyPicker({ rows, onPick, onClose }: { rows: KhataRow[]; onPick: (row: KhataRow) => void; onClose: () => void }) {
  useT();
  const [q, setQ] = useState('');
  const withClient = useMemo(() => rows.filter((r) => r.client), [rows]);
  const list = useMemo(() => {
    if (!q.trim()) return [...withClient].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name)).slice(0, 12);
    return suggest(q, withClient, { label: (r) => r.name, extra: (r) => [r.client?.phone, r.client?.company], limit: 12 }).map((s) => s.row);
  }, [q, withClient]);
  return (
    <Modal open onClose={onClose} size="sm" title={retailT('pickTitle')} subtitle={retailT('pickSub')}>
      <div className={controls.field} data-party-picker>
        <input
          className={controls.input}
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && list[0]) {
              e.preventDefault();
              onPick(list[0]);
            }
          }}
          placeholder={retailT('pickPh')}
          aria-label={retailT('pickPh')}
        />
        {list.length === 0 ? (
          <p className={controls.hint}>{retailT('pickNone')}</p>
        ) : (
          <ul className={styles.pickList}>
            {list.map((r) => (
              <li key={r.key}>
                <button type="button" className={controls.btnGhost} onClick={() => onPick(r)} data-pick-party={r.name}>
                  <span>{r.name}</span>
                  <span>{r.net > 0 ? formatCurrency(r.net, 'INR') : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
