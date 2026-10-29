import { Banknote, Paperclip, Pencil, Trash2 } from 'lucide-react';
import type { PurchaseRecord } from '../../types/purchases';
import { balanceOf, deriveStatus } from '../../lib/purchases';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { PurchaseStatusBadge } from './PurchaseStatusBadge';
import { useT } from '../../i18n';
import { purT, purCategory } from '../../i18n/areas/purchases';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import tabStyles from './VendorsTab.module.css';
import { useListKeys } from '../../lib/keys/use-list-keys'; // R20-D5

export interface PurchasesTableProps {
  rows: PurchaseRecord[];
  today: string;
  onPay: (p: PurchaseRecord) => void;
  onEdit: (p: PurchaseRecord) => void;
  onDelete: (p: PurchaseRecord) => void;
}

export function PurchasesTable({ rows, today, onPay, onEdit, onDelete }: PurchasesTableProps) {
  useT(); // re-render on a language switch (5.4)
  // R20-D5 (Tally keys): ↑ ↓ move, Enter opens the bill, Alt+D = the row's Delete button.
  const list = useListKeys(rows.length, (i) => onEdit(rows[i]), { del: (i) => onDelete(rows[i]) });
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead>
          <tr>
            <th>{purT('thVendor')}</th>
            <th>{purT('thDate')}</th>
            <th>{purT('thCategory')}</th>
            <th>{purT('thStatus')}</th>
            <th className={surface.numeric}>{purT('thGst')}</th>
            <th className={surface.numeric}>{purT('thTotal')}</th>
            <th className={surface.numeric}>{purT('thBalance')}</th>
            <th aria-label={purT('thActions')} />
          </tr>
        </thead>
        <tbody id={list.bodyId}>
          {rows.map((p, i) => {
            const status = deriveStatus(p, today);
            const balance = balanceOf(p);
            const tax = p.cgst + p.sgst + p.igst;
            return (
              <tr key={p.id} {...list.row(i)}>
                <td>
                  <div className={tabStyles.name}>
                    <span>{p.vendor_name || '—'}</span>
                    <span className={styles.kindTag}>{p.kind === 'EXPENSE' ? purT('kindExpense') : purT('kindBill')}</span>
                    {p.attachments?.length ? (
                      <span className={styles.kindTag} title={purT(p.attachments.length === 1 ? 'attachedOne' : 'attachedMany', { n: p.attachments.length })} aria-label={purT(p.attachments.length === 1 ? 'attachedOne' : 'attachedMany', { n: p.attachments.length })}>
                        <Paperclip size={11} aria-hidden="true" /> {p.attachments.length}
                      </span>
                    ) : null}
                  </div>
                  {p.bill_number && <div className={tabStyles.sub}>{p.bill_number}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(p.date)}
                  {p.due_date && p.kind === 'PURCHASE' && (
                    <div className={cn(tabStyles.sub, status === 'Overdue' && styles.overdue)}>{purT('due', { date: formatDate(p.due_date) })}</div>
                  )}
                </td>
                <td>{purCategory(p.category)}</td>
                <td><PurchaseStatusBadge status={status} /></td>
                <td className={surface.numeric}>
                  {tax > 0 ? formatCurrency(tax) : '—'}
                  {p.itc_eligible && tax > 0 && <div><span className={styles.itcTag}>ITC</span></div>}
                </td>
                <td className={surface.numeric}>{formatCurrency(p.total)}</td>
                <td className={surface.numeric}>{balance > 0 ? formatCurrency(balance) : '—'}</td>
                <td>
                  <div className={surface.rowActions}>
                    <button
                      type="button"
                      className={controls.btnIcon}
                      title={balance > 0 ? purT('recordPayment') : purT('paymentHistory')}
                      aria-label={purT('paymentsFor', { name: `${p.vendor_name} ${p.bill_number}` })}
                      onClick={() => onPay(p)}
                    >
                      <Banknote size={16} />
                    </button>
                    <button type="button" className={controls.btnIcon} title={purT('edit')} aria-label={purT('editNamed', { name: `${p.vendor_name} ${p.bill_number}` })} onClick={() => onEdit(p)}>
                      <Pencil size={16} />
                    </button>
                    <button type="button" className={controls.btnDanger} title={purT('delete')} aria-label={purT('deleteNamed', { name: `${p.vendor_name} ${p.bill_number}` })} onClick={() => onDelete(p)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
