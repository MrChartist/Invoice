/**
 * Group Creation / Alteration / Display (Tally "Accounts Info → Groups"). Fields in Tally order:
 * Name, (alias), Under, then the inherited nature and gross-profit effect, sub-ledger and nett
 * balances flags.
 */
import { useId, useMemo, useState } from 'react';
import { can } from '../../lib/access';
import { deleteUserGroup, groupDescendants, groupOf, loadMasters, saveUserGroup, type UserGroup } from '../../lib/ledger';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { GroupSelect, MasterFrame } from './shared';
import { natureLabel } from './masters-utils';
import controls from '../../styles/controls.module.css';
import styles from './masters.module.css';

export interface GroupFormProps {
  mode: 'create' | 'alter' | 'display';
  /** Group to alter / display. */
  groupId?: string;
  /** Pre-filled values for create (e.g. create-on-the-fly from another screen). */
  initialName?: string;
  initialParent?: string;
  onDone: (saved?: UserGroup) => void;
  onBack: () => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

export function GroupForm({ mode, groupId, initialName = '', initialParent = 'TRADE_RECEIVABLES', onDone, onBack, notify }: GroupFormProps) {
  useT();
  const uid = useId();
  const masters = useMemo(() => loadMasters(), []);
  const existing = groupId ? masters.userGroups.find((g) => g.id === groupId) : undefined;
  const readOnly = mode === 'display' || !can('master.edit');
  const [name, setName] = useState(existing?.name ?? initialName);
  const [alias, setAlias] = useState(existing?.alias ?? '');
  const [parent, setParent] = useState(existing?.parent ?? initialParent);
  const [subledger, setSubledger] = useState(!!existing?.subledger);
  const [net, setNet] = useState(!!existing?.net_balances);
  const [error, setError] = useState('');
  const def = groupOf(parent, masters.userGroups);
  const exclude = useMemo(() => new Set(groupId ? groupDescendants(groupId, masters.userGroups) : []), [groupId, masters.userGroups]);
  const title = mode === 'create' ? mastersT('groupCreation') : mode === 'alter' ? mastersT('groupAlteration') : mastersT('groupDisplay');

  const accept = () => {
    if (readOnly) return onBack();
    try {
      const saved = saveUserGroup({ id: existing?.id, name, alias, parent, subledger, net_balances: net });
      notify?.(mastersT('saved', { name: saved.name }));
      onDone(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = () => {
    if (!existing) return;
    try {
      deleteUserGroup(existing.id, masters);
      notify?.(mastersT('deleted', { name: existing.name }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <MasterFrame
      title={title}
      keys={{ onAccept: accept, onBack }}
      actions={
        <>
          {!readOnly && (
            <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={accept}>
              {mastersT('accept')} (Ctrl+A)
            </button>
          )}
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onBack}>
            {mastersT('back')} (Esc)
          </button>
          {mode === 'alter' && existing && !readOnly && (
            <button type="button" className={`${controls.btn} ${controls.btnDanger}`} onClick={remove}>
              {mastersT('delete')}
            </button>
          )}
        </>
      }
    >
      {mode !== 'display' && !can('master.edit') && <p className={styles.note}>{mastersT('readOnly')}</p>}
      <div className={styles.form}>
        <label htmlFor={`${uid}-name`}>{mastersT('name')}</label>
        <input id={`${uid}-name`} className={controls.input} value={name} readOnly={readOnly} autoFocus data-autofocus onChange={(e) => setName(e.target.value)} />
        <label htmlFor={`${uid}-alias`}>{mastersT('alias')}</label>
        <input id={`${uid}-alias`} className={controls.input} value={alias} readOnly={readOnly} onChange={(e) => setAlias(e.target.value)} />
        <label htmlFor={`${uid}-under`}>{mastersT('under')}</label>
        <GroupSelect id={`${uid}-under`} value={parent} onChange={setParent} userGroups={masters.userGroups} exclude={exclude} disabled={readOnly} />
        <span>{mastersT('nature')}</span>
        <span className={styles.readout}>{natureLabel(def.nature)}</span>
        <span>{mastersT('affectsGp')}</span>
        <span className={styles.readout}>{def.direct ? mastersT('yes') : mastersT('no')}</span>
        <label htmlFor={`${uid}-sub`}>{mastersT('subledger')}</label>
        <input id={`${uid}-sub`} type="checkbox" checked={subledger} disabled={readOnly} onChange={(e) => setSubledger(e.target.checked)} />
        <label htmlFor={`${uid}-net`}>{mastersT('netBalances')}</label>
        <input id={`${uid}-net`} type="checkbox" checked={net} disabled={readOnly} onChange={(e) => setNet(e.target.checked)} />
      </div>
      {error && (
        <div className={controls.error} role="alert">
          {error}
        </div>
      )}
    </MasterFrame>
  );
}
