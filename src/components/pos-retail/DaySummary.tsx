import { useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { zReport } from '../../lib/pos';
import { posReturnsDb } from '../../lib/pos-returns';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import styles from './retail.module.css';

/** Ctrl+F5: today so far — sales, returns and tenders — without leaving the bill on the counter. */
export function DaySummary({ open, onClose, held }: { open: boolean; onClose: () => void; held: number }) {
  useT();
  const day = todayInput();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const z = useMemo(() => zReport(day, localDb.invoices.getAll(), localDb.payments.getAll(), posReturnsDb.all()), [day, open]);
  const stat = (label: string, value: string, key: string) => (
    <div className={styles.stat} data-day={key}><span>{label}</span><strong>{value}</strong></div>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={retailT('dayTitle')}
      subtitle={formatDate(day)}
      footer={<button type="button" className={controls.btnPrimary} onClick={onClose}>{retailT('backToBill')}</button>}
    >
      <div className={styles.grid} data-day-summary>
        <div className={styles.stats}>
          {stat(retailT('dayBills'), String(z.bills), 'bills')}
          {stat(retailT('daySales'), formatCurrency(z.net), 'net')}
          {stat(retailT('dayReturns'), `${z.returns.count} · ${formatCurrency(z.returns.value)}`, 'returns')}
          {stat(retailT('dayNet'), formatCurrency(z.netAfterReturns), 'after')}
        </div>
        <p className={styles.section}>{retailT('dayTenders')}</p>
        <div className={styles.stats}>
          {stat(retailT('t.Cash'), formatCurrency(z.tenders.cash - z.returns.refunds.cash), 'cash')}
          {stat('UPI', formatCurrency(z.tenders.upi), 'upi')}
          {stat(retailT('t.Card'), formatCurrency(z.tenders.card), 'card')}
          {stat(retailT('dayOther'), formatCurrency(z.tenders.other), 'other')}
          {stat(retailT('t.Account'), formatCurrency(z.credit), 'credit')}
        </div>
        <p className={styles.muted}>{retailT('dayCashNote', { refund: formatCurrency(z.returns.refunds.cash) })}</p>
        {held > 0 && <p className={styles.warn}>{retailT('dayHeld', { n: held })}</p>}
      </div>
    </Modal>
  );
}
