import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { gwT } from '../../i18n/areas/gateway';
import { GROUPS, type GroupId } from '../../lib/ledger/accounts';
import { createLedgerInline, type LedgerKind, type LedgerOption } from '../../lib/gateway/voucher-entry';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

interface Props {
  kind: LedgerKind;
  initialName?: string;
  /** Group a new ledger account starts under. */
  defaultGroup?: GroupId;
  terms?: boolean;
  onClose: () => void;
  onCreated: (o: LedgerOption) => void;
}

/** Alt+C — create a ledger account, customer or vendor without leaving the screen. */
export function CreateLedgerDialog({ kind: initialKind, initialName = '', defaultGroup = 'INDIRECT_EXPENSES', terms, onClose, onCreated }: Props) {
  const [kind, setKind] = useState<LedgerKind>(initialKind);
  const [name, setName] = useState(initialName);
  const [group, setGroup] = useState<GroupId>(defaultGroup);
  const [gstin, setGstin] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const o = kind === 'account' ? createLedgerInline({ kind, name, group }) : createLedgerInline({ kind, name, gstin });
      onCreated(o);
    } catch (err) {
      setError((err as Error).message || gwT('cDenied'));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={gwT('cTitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{gwT('cancel')}</button>
          <button type="submit" form="gw-create-ledger" className={controls.btnPrimary}>{gwT('cCreate')}</button>
        </>
      }
    >
      <form id="gw-create-ledger" onSubmit={submit} style={{ display: 'grid', gap: '0.75rem' }}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="gw-cl-kind">{gwT('cType')}</label>
          <SelectField id="gw-cl-kind" className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as LedgerKind)}>
            <option value="account">{gwT('vKindAccount')}</option>
            <option value="customer">{gwT(terms ? 'customerTally' : 'customer')}</option>
            <option value="vendor">{gwT(terms ? 'vendorTally' : 'vendor')}</option>
          </SelectField>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="gw-cl-name">{gwT('cName')}</label>
          <input id="gw-cl-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </div>
        {kind === 'account' ? (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="gw-cl-group">{gwT('cGroup')}</label>
            <SelectField id="gw-cl-group" className={controls.select} value={group} onChange={(e) => setGroup(e.target.value as GroupId)}>
              {GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </SelectField>
          </div>
        ) : (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="gw-cl-gstin">{gwT('cGstin')}</label>
            <input id="gw-cl-gstin" className={controls.input} value={gstin} onChange={(e) => setGstin(e.target.value)} />
          </div>
        )}
        {error && <p className={controls.error} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
