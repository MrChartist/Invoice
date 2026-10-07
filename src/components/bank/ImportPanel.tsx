import { useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp, Upload } from 'lucide-react';
import {
  COLUMN_FIELD_LABELS,
  makeStatement,
  parseBankStatement,
  splitDuplicates,
  type BankStatement,
  type ColumnField,
  type ColumnMap,
  type ParsedStatement,
} from '../../lib/bank-recon';
import { formatDate, formatMoney } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './reconcile.module.css';

export interface ImportPanelProps {
  existing: readonly BankStatement[];
  onImport: (statement: BankStatement, info: { duplicates: number }) => void;
  onCancel?: () => void;
}

const MAP_FIELDS: ColumnField[] = ['date', 'narration', 'debit', 'credit', 'amount', 'drcr', 'balance', 'ref'];

/** Choose / drop a bank CSV, check what was understood, fix the columns if needed, then import. */
export function ImportPanel({ existing, onImport, onCancel }: ImportPanelProps) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [bankLabel, setBankLabel] = useState('');
  const [forced, setForced] = useState<{ columns: ColumnMap; headerRow: number } | null>(null);
  const [readError, setReadError] = useState('');
  const [remap, setRemap] = useState(false);

  const parsed: ParsedStatement | null = useMemo(
    () => (text ? parseBankStatement(text, forced ?? {}) : null),
    [text, forced],
  );
  const split = useMemo(() => (parsed ? splitDuplicates(existing, parsed.lines) : null), [parsed, existing]);

  const load = async (file: File | undefined) => {
    if (!file) return;
    setReadError('');
    if (file.size > 8 * 1024 * 1024) {
      setReadError('That file is over 8 MB — export a shorter period from your bank.');
      return;
    }
    try {
      const content = await file.text();
      setFileName(file.name);
      setText(content);
      setForced(null);
      setRemap(false);
      setBankLabel('');
    } catch {
      setReadError('Could not read that file.');
    }
  };

  const reset = () => {
    setText('');
    setFileName('');
    setForced(null);
    setRemap(false);
    setReadError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const doImport = () => {
    if (!parsed || !split || split.fresh.length === 0) return;
    const st = makeStatement(
      { bankLabel: bankLabel.trim() || parsed.bankLabel, openingBalance: parsed.openingBalance },
      split.fresh,
      fileName || 'statement.csv',
    );
    onImport(st, { duplicates: split.duplicates.length });
    reset();
  };

  return (
    <div className={styles.stack}>
      {!parsed && (
        <div
          className={dragging ? styles.dropActive : styles.drop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void load(e.dataTransfer.files?.[0]);
          }}
        >
          <span className={styles.dropIcon} aria-hidden="true"><FileUp size={24} /></span>
          <h3 className={styles.dropTitle}>Import a bank statement</h3>
          <p className={styles.muted} style={{ maxWidth: 460 }}>
            Download the statement as <strong>CSV</strong> from your net banking (HDFC, ICICI, SBI, Axis, Kotak and most others work) and drop it here.
            Nothing leaves your device.
          </p>
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className={surface.srOnly}
            onChange={(e) => void load(e.target.files?.[0])}
          />
          <label htmlFor={inputId} className={controls.btnPrimary} style={{ cursor: 'pointer' }}>
            <Upload size={16} /> Choose CSV file
          </label>
          {readError && <div className={controls.error} role="alert">{readError}</div>}
          {onCancel && <button type="button" className={controls.btnGhost} onClick={onCancel}>Cancel</button>}
        </div>
      )}

      {parsed && split && (
        <div className={surface.card}>
          <div className={surface.cardHead}>
            <span>{fileName}</span>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={reset}>Choose another file</button>
          </div>
          <div className={surface.cardBody}>
            <div className={styles.previewMeta} role="status">
              <span>Bank: <strong>{bankLabel || parsed.bankLabel}</strong></span>
              <span><strong>{parsed.lines.length}</strong> transactions found</span>
              <span><strong>{split.fresh.length}</strong> new</span>
              {split.duplicates.length > 0 && <span><strong>{split.duplicates.length}</strong> already imported (will be skipped)</span>}
              {parsed.skipped > 0 && <span>{parsed.skipped} non-transaction rows ignored</span>}
              {parsed.openingBalance !== undefined && <span>Opening balance <strong>{formatMoney(parsed.openingBalance)}</strong></span>}
            </div>

            {parsed.warnings.map((w) => (
              <div key={w} className={styles.noticeWarn} role="alert">
                <AlertTriangle size={16} className={styles.noticeIcon} aria-hidden="true" />
                <span>{w}</span>
              </div>
            ))}

            {parsed.lines.length === 0 || remap ? (
              <MappingStep
                parsed={parsed}
                onApply={(columns, headerRow) => {
                  setForced({ columns, headerRow });
                  setRemap(false);
                }}
              />
            ) : (
              <>
                <div className={styles.previewScroll}>
                  <table className={styles.previewTable}>
                    <caption className={surface.srOnly}>First transactions found in the file</caption>
                    <thead>
                      <tr>
                        <th scope="col">Date</th>
                        <th scope="col">Narration</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Debit</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Credit</th>
                        <th scope="col" style={{ textAlign: 'right' }}>Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.lines.slice(0, 8).map((l, i) => (
                        <tr key={i}>
                          <td>{formatDate(l.date)}</td>
                          <td>{l.narration}</td>
                          <td className={`num ${styles.neg}`}>{l.debit ? formatMoney(l.debit) : ''}</td>
                          <td className={`num ${styles.pos}`}>{l.credit ? formatMoney(l.credit) : ''}</td>
                          <td className="num">{l.balance !== undefined ? formatMoney(l.balance) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.lines.length > 8 && <p className={styles.muted}>…and {parsed.lines.length - 8} more.</p>}
                <div className={controls.field} style={{ maxWidth: 320 }}>
                  <label className={controls.label} htmlFor={`${inputId}-label`}>Bank / account label</label>
                  <input
                    id={`${inputId}-label`}
                    className={controls.input}
                    value={bankLabel}
                    placeholder={parsed.bankLabel}
                    onChange={(e) => setBankLabel(e.target.value)}
                  />
                </div>
                <div className={styles.toolbarGroup}>
                  <button type="button" className={controls.btnPrimary} disabled={split.fresh.length === 0} onClick={doImport}>
                    Import {split.fresh.length} transaction{split.fresh.length === 1 ? '' : 's'}
                  </button>
                  <button type="button" className={controls.btnOutline} onClick={() => setRemap(true)}>
                    Columns look wrong?
                  </button>
                  {split.fresh.length === 0 && <span className={styles.muted}>Every line in this file is already imported.</span>}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pick the header row and which column is which when auto-detection could not. */
function MappingStep({ parsed, onApply }: { parsed: ParsedStatement; onApply: (columns: ColumnMap, headerRow: number) => void }) {
  const id = useId();
  const rows = parsed.rawRows;
  const [headerRow, setHeaderRow] = useState(parsed.headerRow >= 0 ? parsed.headerRow : 0);
  const [cols, setCols] = useState<ColumnMap>(parsed.columns);
  const header = rows[headerRow] ?? [];

  return (
    <div className={styles.stack}>
      <p className={styles.muted}>Tell us which column is which. We remember nothing — pick once per file.</p>
      <div className={controls.field} style={{ maxWidth: 520 }}>
        <label className={controls.label} htmlFor={`${id}-hr`}>Header row</label>
        <select
          id={`${id}-hr`}
          className={controls.select}
          value={headerRow}
          onChange={(e) => {
            setHeaderRow(+e.target.value);
            setCols({});
          }}
        >
          {rows.slice(0, 25).map((r, i) => (
            <option key={i} value={i}>Row {i + 1}: {r.filter(Boolean).join(' | ').slice(0, 70) || '(blank)'}</option>
          ))}
        </select>
      </div>
      <div className={styles.mapGrid}>
        {MAP_FIELDS.map((f) => (
          <div key={f} className={controls.field}>
            <label className={controls.label} htmlFor={`${id}-${f}`}>{COLUMN_FIELD_LABELS[f]}</label>
            <select
              id={`${id}-${f}`}
              className={controls.select}
              value={cols[f] ?? -1}
              onChange={(e) => {
                const v = +e.target.value;
                setCols((c) => {
                  const next = { ...c };
                  if (v < 0) delete next[f];
                  else next[f] = v;
                  return next;
                });
              }}
            >
              <option value={-1}>(not in file)</option>
              {header.map((h, i) => (
                <option key={i} value={i}>{`Column ${i + 1}: ${h || '(blank)'}`}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className={styles.toolbarGroup}>
        <button
          type="button"
          className={controls.btnPrimary}
          disabled={cols.date === undefined || (cols.debit === undefined && cols.credit === undefined && cols.amount === undefined)}
          onClick={() => onApply(cols, headerRow)}
        >
          Use these columns
        </button>
      </div>
    </div>
  );
}
