import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { InvoiceRecord } from '../../types/invoice';
import { num, round2 } from '../../lib/invoice-calc';
import { formatCurrency, formatDate } from '../../lib/utils';
import { useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import styles from './retail.module.css';

/**
 * PgUp / PgDn: look back through saved POS bills (newest first) without touching the bill on the
 * counter. Reprint, or open the bill in the editor to change it (as from the invoice list).
 */
export function BillBrowser({ bills, index, onIndex, onClose, onReprint }: {
  bills: InvoiceRecord[];
  index: number;
  onIndex: (n: number) => void;
  onClose: () => void;
  onReprint: (bill: InvoiceRecord) => void;
}) {
  useT();
  const bill = bills[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PageUp' && index > 0) {
        e.preventDefault();
        onIndex(index - 1);
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        if (index < bills.length - 1) onIndex(index + 1);
        else onClose(); // past the newest bill: back to the counter
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, bills.length, onIndex, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={retailT('browseTitle')}
      subtitle={bills.length ? retailT('browseSub', { n: index + 1, of: bills.length }) : undefined}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => onIndex(index - 1)} disabled={index <= 0} aria-label={retailT('a.prevBill')}><ChevronLeft size={16} /> PgUp</button>
          <button type="button" className={controls.btnOutline} onClick={() => (index < bills.length - 1 ? onIndex(index + 1) : onClose())} aria-label={retailT('a.nextBill')}>PgDn <ChevronRight size={16} /></button>
          {bill && <button type="button" className={controls.btnOutline} onClick={() => onReprint(bill)}><Printer size={16} /> {retailT('reprint')}</button>}
          {bill && <Link className={controls.btnPrimary} to={`/invoice/${bill.id}`}>{retailT('openBill')}</Link>}
        </>
      }
    >
      {!bill ? (
        <p className={styles.muted}>{retailT('browseNone')}</p>
      ) : (
        <div className={styles.grid} data-bill-browser={bill.invoice_number}>
          <div className={styles.billHead}>
            <strong>{bill.invoice_number}</strong>
            <span>{formatDate(bill.issue_date)} · {bill.client?.name}</span>
            <span>{bill.status}</span>
          </div>
          <table className={styles.table}>
            <tbody>
              {bill.items.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className={styles.r}>{num(l.quantity)} {l.unit}</td>
                  <td className={styles.r}>{formatCurrency(round2(num(l.quantity) * num(l.rate) * (1 - num(l.discount_percent) / 100)))}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" colSpan={2}>{retailT('total')}</th>
                <td className={styles.r}><strong>{formatCurrency(bill.total)}</strong></td>
              </tr>
              {num(bill.balance_due) > 0 && (
                <tr><th scope="row" colSpan={2}>{retailT('t.Account')}</th><td className={styles.r}>{formatCurrency(bill.balance_due)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
