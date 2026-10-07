import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import {
  statementClosing,
  statementLinesCsv,
  summarizeRecon,
  type BankStatement,
  type BookIndex,
} from '../../lib/bank-recon';
import { formatDate, formatMoney } from '../../lib/utils';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { NumberInput } from '../ui/NumberInput';
import { downloadCsv } from '../books/download';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './reconcile.module.css';

export interface StatementsPanelProps {
  statements: readonly BankStatement[];
  index: BookIndex;
  onClosingBalance: (id: string, value: number | undefined) => void;
  onRemove: (id: string) => void;
}

export function StatementsPanel({ statements, index, onClosingBalance, onRemove }: StatementsPanelProps) {
  const [deleting, setDeleting] = useState<BankStatement | null>(null);

  return (
    <div className={surface.card}>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>Imported bank statements</caption>
          <thead>
            <tr>
              <th scope="col">Statement</th>
              <th scope="col">Period</th>
              <th scope="col" className={surface.numeric}>Lines</th>
              <th scope="col" className={surface.numeric}>Reconciled</th>
              <th scope="col" className={surface.numeric}>Closing balance</th>
              <th scope="col"><span className={surface.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {statements.map((s) => {
              const dates = s.lines.map((l) => l.date).sort();
              const sum = summarizeRecon(s.lines, index);
              const fromFile = s.lines.some((l) => l.balance !== undefined);
              const closing = statementClosing(s);
              return (
                <tr key={s.id}>
                  <td>
                    <strong>{s.bank_label}</strong>
                    <div className={styles.muted}>{s.file_name} · imported {formatDate(s.imported_at.slice(0, 10))}</div>
                  </td>
                  <td>{dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : '—'}</td>
                  <td className={surface.numeric}>{sum.total}</td>
                  <td className={surface.numeric}>{sum.pctReconciled}%</td>
                  <td className={surface.numeric}>
                    {fromFile ? (
                      <span title="Taken from the balance column of the file">{closing === null ? '—' : `₹${formatMoney(closing)}`}</span>
                    ) : (
                      <NumberInput
                        aria-label={`Closing balance for ${s.file_name}`}
                        className={`${controls.input} ${controls.inputNumeric}`}
                        style={{ maxWidth: 150 }}
                        blankZero
                        value={s.closing_balance ?? 0}
                        placeholder="Enter balance"
                        onChange={(v) => onClosingBalance(s.id, v === 0 ? undefined : v)}
                      />
                    )}
                  </td>
                  <td>
                    <span className={surface.rowActions}>
                      <button
                        type="button"
                        className={controls.btnIcon}
                        aria-label={`Download ${s.file_name} with reconciliation status`}
                        onClick={() => downloadCsv(`${s.file_name.replace(/\.[a-z]+$/i, '')}-reconciliation.csv`, statementLinesCsv(s.lines, index))}
                      >
                        <Download size={16} />
                      </button>
                      <button type="button" className={controls.btnIcon} aria-label={`Delete statement ${s.file_name}`} onClick={() => setDeleting(s)}>
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!deleting}
        title="Delete this statement?"
        message={`Removes ${deleting?.lines.length ?? 0} lines of ${deleting?.file_name ?? ''} and their match status from this device. Receipts and payments already in your books are not touched.`}
        confirmLabel="Delete statement"
        destructive
        onConfirm={() => {
          if (deleting) onRemove(deleting.id);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
