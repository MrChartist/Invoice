/**
 * "List of Groups" / "List of Ledgers" (Tally's pick list before Alter / Display), shown as the
 * group tree with each group's ledgers. Type to filter; pick an item to open it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { allLedgers, groupTree, loadMasters, type GroupNode, type MasterLedger } from '../../lib/ledger';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { MasterFrame } from './shared';
import controls from '../../styles/controls.module.css';
import ledgerStyles from '../books/ledger/ledger.module.css';
import styles from './masters.module.css';

export interface MastersListProps {
  kind: 'groups' | 'ledgers';
  title: string;
  onPick: (id: string) => void;
  onBack: () => void;
}

export function MastersList({ kind, title, onPick, onBack }: MastersListProps) {
  useT();
  const masters = useMemo(() => loadMasters(), []);
  const tree = useMemo(() => groupTree(masters.userGroups), [masters]);
  const ledgers = useMemo(() => allLedgers(masters), [masters]);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const byGroup = useMemo(() => {
    const m = new Map<string, MasterLedger[]>();
    for (const l of ledgers) m.set(l.group, [...(m.get(l.group) ?? []), l]);
    return m;
  }, [ledgers]);

  const render = (n: GroupNode): ReactNode => {
    const own = kind === 'ledgers' ? (byGroup.get(n.group.id) ?? []).filter((l) => !q || l.name.toLowerCase().includes(q)) : [];
    const kids = n.children.map(render).filter(Boolean);
    const groupHit = !q || n.group.label.toLowerCase().includes(q);
    if (kind === 'groups' && !groupHit && !kids.length) return null;
    if (kind === 'ledgers' && !own.length && !kids.length) return null;
    const pickable = kind === 'groups' && !n.group.system;
    return (
      <li key={n.group.id} className={styles.treeItem}>
        {pickable ? (
          <button type="button" className={ledgerStyles.rowButton} onClick={() => onPick(n.group.id)}>
            {n.group.label}
          </button>
        ) : (
          <strong>{n.group.label}</strong>
        )}
        {(own.length > 0 || kids.length > 0) && (
          <ul>
            {own.map((l) => (
              <li key={l.id} className={styles.treeItem}>
                <button type="button" className={ledgerStyles.rowButton} onClick={() => onPick(l.id)}>
                  {l.name}
                </button>
                {l.kind === 'party' && <span className={styles.ledgerName}> · {mastersT('party')}</span>}
              </li>
            ))}
            {kids}
          </ul>
        )}
      </li>
    );
  };

  return (
    <MasterFrame title={title} keys={{ onAccept: () => undefined, onBack }}>
      <input type="search" className={controls.input} style={{ maxWidth: 320 }} placeholder={mastersT('search')} aria-label={mastersT('search')} value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
      <ul className={styles.tree}>{tree.map(render)}</ul>
      <div>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onBack}>
          {mastersT('back')} (Esc)
        </button>
      </div>
    </MasterFrame>
  );
}
