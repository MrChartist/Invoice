/**
 * Alt+C create-on-the-fly for stock masters (Tally parity): a stock item (the full item form) or a
 * godown, opened over the current picker. Default export, loaded lazily by `CreateMasterDialog`.
 */
import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { ItemFormModal } from '../inventory/ItemFormModal';
import { blankStockItem, stockDb } from '../../lib/inventory';
import { godownsDb } from '../../lib/godowns';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
import controls from '../../styles/controls.module.css';
import type { SavedLedger } from './LedgerForm';

export default function StockMasterCreate({ kind, name, onClose, notify }: {
  kind: 'stockItem' | 'godown';
  name?: string;
  onClose: (created?: SavedLedger) => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}) {
  useT();
  const [item] = useState(() => blankStockItem({ name: name?.trim() ?? '' }));
  const [godown, setGodown] = useState({ name: name?.trim() ?? '', address: '' });
  const [error, setError] = useState('');

  if (kind === 'stockItem') {
    const taken = stockDb.items().map((i) => i.name.trim().toLowerCase());
    return (
      <ItemFormModal
        open
        item={item}
        isNew
        takenNames={taken}
        onClose={() => onClose()}
        onSave={(saved) => {
          try {
            stockDb.saveItem(saved);
            notify?.(invT('itemAdded'));
            onClose({ id: saved.id, name: saved.name });
          } catch (err) {
            notify?.((err as Error).message, 'error');
          }
        }}
      />
    );
  }

  const save = () => {
    try {
      const g = godownsDb.save({ name: godown.name, ...(godown.address.trim() ? { address: godown.address.trim() } : {}) });
      notify?.(invT('godownAdded', { name: g.name }));
      onClose({ id: g.id, name: g.name });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal
      open
      onClose={() => onClose()}
      size="sm"
      title={invT('addGodown')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => onClose()}>{invT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>{invT('addGodown')}</button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="fly-gd-name">{invT('godownName')}</label>
          <input id="fly-gd-name" className={controls.input} autoFocus value={godown.name} onChange={(e) => setGodown((g) => ({ ...g, name: e.target.value }))} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="fly-gd-addr">{invT('addressOptional')}</label>
          <input id="fly-gd-addr" className={controls.input} value={godown.address} onChange={(e) => setGodown((g) => ({ ...g, address: e.target.value }))} />
        </div>
        {error && <p className={controls.error} role="alert">{error}</p>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
