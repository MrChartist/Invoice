import { Banknote, Pencil, Trash2 } from 'lucide-react';
import type { PurchaseRecord } from '../../types/purchases';
import { balanceOf, deriveStatus } from '../../lib/purchases';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { PurchaseStatusBadge } from './PurchaseStatusBadge';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import tabStyles from './VendorsTab.module.css';

export interface PurchasesTableProps {
  rows: PurchaseRecord[];
  today: string;
  onPay: (p: PurchaseRecord) => void;
  onEdit: (p: PurchaseRecord) => void;
  onDelete: (p: PurchaseRecord) => void;
}

export function PurchasesTable({ rows, today, onPay, onEdit, onDelete }: PurchasesTableProps) {
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead>
          <tr>
            <th>Vendor</th>
            <th>Date</th>
            <th>Category</th>
            <th>Status</th>
            <th className={surface.numeric}>GST</th>
            <th className={surface.numeric}>Total</th>
            <th className={surface.numeric}>Balance</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const status = deriveStatus(p, today);
            const balance = balanceOf(p);
            const tax = p.cgst + p.sgst + p.igst;
            return (
              <tr key={p.id}>
                <td>
                  <div className={tabStyles.name}>
                    <span>{p.vendor_name || '—'}</span>
                    <span className={styles.kindTag}>{p.kind === 'EXPENSE' ? 'Expense' : 'Bill'}</span>
                  </div>
                  {p.bill_number && <div className={tabStyles.sub}>{p.bill_number}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {formatDate(p.date)}
                  {p.due_date && p.kind === 'PURCHASE' && (
                    <div className={cn(tabStyles.sub, status === 'Overdue' && styles.overdue)}>Due {formatDate(p.due_date)}</div>
                  )}
                </td>
                <td>{p.category}</td>
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
                      title={balance > 0 ? 'Record payment' : 'Payment history'}
                      aria-label={`Payments for ${p.vendor_name}`}
                      onClick={() => onPay(p)}
                    >
                      <Banknote size={16} />
                    </button>
                    <button type="button" className={controls.btnIcon} title="Edit" aria-label={`Edit ${p.vendor_name}`} onClick={() => onEdit(p)}>
                      <Pencil size={16} />
                    </button>
                    <button type="button" className={controls.btnDanger} title="Delete" aria-label={`Delete ${p.vendor_name}`} onClick={() => onDelete(p)}>
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
