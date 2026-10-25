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
import { useT } from '../../i18n';
import { bankT } from '../../i18n/areas/bank';
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
  useT(); // re-render on a language switch (5.4)
  const [deleting, setDeleting] = useState<BankStatement | null>(null);

  return (
    <div className={surface.card}>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{bankT('importedStatements')}</caption>
          <thead>
            <tr>
              <th scope="col">{bankT('thStatement')}</th>
              <th scope="col">{bankT('thPeriod')}</th>
              <th scope="col" className={surface.numeric}>{bankT('thLines')}</th>
              <th scope="col" className={surface.numeric}>{bankT('thReconciled')}</th>
              <th scope="col" className={surface.numeric}>{bankT('thClosing')}</th>
              <th scope="col"><span className={surface.srOnly}>{bankT('thActions')}</span></th>
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
                    <div className={styles.muted}>{bankT('importedOn', { file: s.file_name, date: formatDate(s.imported_at.slice(0, 10)) })}</div>
                  </td>
                  <td>{dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : '—'}</td>
                  <td className={surface.numeric}>{sum.total}</td>
                  <td className={surface.numeric}>{sum.pctReconciled}%</td>
                  <td className={surface.numeric}>
                    {fromFile ? (
                      <span title={bankT('fromFile')}>{closing === null ? '—' : `₹${formatMoney(closing)}`}</span>
                    ) : (
                      <NumberInput
                        aria-label={bankT('closingFor', { file: s.file_name })}
                        className={`${controls.input} ${controls.inputNumeric}`}
                        style={{ maxWidth: 150 }}
                        blankZero
                        value={s.closing_balance ?? 0}
                        placeholder={bankT('enterBalance')}
                        onChange={(v) => onClosingBalance(s.id, v === 0 ? undefined : v)}
                      />
                    )}
                  </td>
                  <td>
                    <span className={surface.rowActions}>
                      <button
                        type="button"
                        className={controls.btnIcon}
                        aria-label={bankT('downloadWithStatus', { file: s.file_name })}
                        onClick={() => downloadCsv(`${s.file_name.replace(/\.[a-z]+$/i, '')}-reconciliation.csv`, statementLinesCsv(s.lines, index))}
                      >
                        <Download size={16} />
                      </button>
                      <button type="button" className={controls.btnIcon} aria-label={bankT('deleteStatementNamed', { file: s.file_name })} onClick={() => setDeleting(s)}>
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
        title={bankT('deleteStatementTitle')}
        message={bankT('deleteStatementMsg', { n: deleting?.lines.length ?? 0, file: deleting?.file_name ?? '' })}
        confirmLabel={bankT('deleteStatement')}
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
