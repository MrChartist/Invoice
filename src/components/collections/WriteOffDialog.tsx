import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { PinConfirmModal } from '../audit/PinConfirmModal';
import { can } from '../../lib/access';
import { getUser, verifyPin } from '../../lib/auth';
import { writeOffBill } from '../../lib/write-off';
import { formatCurrency, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import styles from './collections.module.css';

export interface WriteOffDialogProps {
  invoiceId: string;
  number: string;
  party: string;
  outstanding: number;
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * R2-A3 single write-off: reason, date (an open period), then the owner's PIN (when a PIN is set up). Writes off
 * the open balance through the 8G `write_off` payment flag; the dialog says GST is untouched (verify with your CA).
 */
export function WriteOffDialog({ invoiceId, number, party, outstanding, onClose, onDone }: WriteOffDialogProps) {
  useT();
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayInput());
  const [error, setError] = useState('');
  const [pin, setPin] = useState(false);
  const owner = can('doc.deleteIssued');

  const run = () => {
    try {
      const r = writeOffBill(invoiceId, { date, reason: reason.trim() });
      onDone(colT('woDone', { number, amount: formatCurrency(r.total, 'INR') }));
      onClose();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };
  const confirm = () => {
    if (!reason.trim()) return setError(colT('woNeedReason'));
    setError('');
    if (getUser()) setPin(true);
    else run();
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="md"
        title={colT('woTitle', { number })}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={onClose}>{colT('cancel')}</button>
            <button type="button" className={controls.btnDanger} onClick={confirm} disabled={!owner} data-writeoff-confirm>{colT('woConfirm')}</button>
          </>
        }
      >
        <div className={styles.stack} data-writeoff-dialog>
          {!owner && <p className={controls.error} role="alert">{colT('woOwner')}</p>}
          <p className={styles.note}>{colT('woIntro', { amount: formatCurrency(outstanding, 'INR'), party })}</p>
          <p className={styles.warn} role="note">{colT('woGst')}</p>
          <div className={styles.grid2}>
            <label className={controls.field}>
              <span className={controls.label}>{colT('woReason')}</span>
              <input className={controls.input} value={reason} maxLength={200} placeholder={colT('woReasonPh')} onChange={(e) => setReason(e.target.value)} data-writeoff-reason />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{colT('woDate')}</span>
              <input className={controls.input} type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          {error && <p className={controls.error} role="alert">{error}</p>}
        </div>
      </Modal>
      <PinConfirmModal
        open={pin}
        title={colT('woPinTitle')}
        message={colT('woPinMsg', { number })}
        confirmLabel={colT('woConfirm')}
        onClose={() => setPin(false)}
        onSubmit={async (p) => {
          if (!(await verifyPin(p))) return false;
          run();
          return true;
        }}
      />
    </>
  );
}

export default WriteOffDialog;
