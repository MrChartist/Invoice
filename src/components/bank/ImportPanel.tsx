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
import { useT } from '../../i18n';
import { bankT } from '../../i18n/areas/bank';
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
  useT(); // re-render on a language switch (5.4)
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
      setReadError(bankT('errTooBig'));
      return;
    }
    try {
      // Excel statements: first sheet → CSV text (dates come back as YYYY-MM-DD); parser loaded on demand.
      const content = /\.(xlsx|xlsm)$/i.test(file.name)
        ? await (await import('../../lib/xlsx')).xlsxToCsv(await file.arrayBuffer())
        : await file.text();
      setFileName(file.name);
      setText(content);
      setForced(null);
      setRemap(false);
      setBankLabel('');
    } catch (err) {
      setReadError(err instanceof Error && (err.name === 'ZipError' || err.name === 'TableLimitError') ? err.message : bankT('errRead'));
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
          <h3 className={styles.dropTitle}>{bankT('importTitle')}</h3>
          <p className={styles.muted} style={{ maxWidth: 460 }}>
            {bankT('importText')}
          </p>
          <input
            ref={fileRef}
            id={inputId}
            type="file"
            accept=".csv,.txt,.xlsx,.xlsm,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className={surface.srOnly}
            onChange={(e) => void load(e.target.files?.[0])}
          />
          <label htmlFor={inputId} className={controls.btnPrimary} style={{ cursor: 'pointer' }}>
            <Upload size={16} /> {bankT('chooseFile')}
          </label>
          {readError && <div className={controls.error} role="alert">{readError}</div>}
          {onCancel && <button type="button" className={controls.btnGhost} onClick={onCancel}>{bankT('cancel')}</button>}
        </div>
      )}

      {parsed && split && (
        <div className={surface.card}>
          <div className={surface.cardHead}>
            <span>{fileName}</span>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={reset}>{bankT('chooseAnother')}</button>
          </div>
          <div className={surface.cardBody}>
            <div className={styles.previewMeta} role="status">
              <span>{bankT('bankN')} <strong>{bankLabel || parsed.bankLabel}</strong></span>
              <span><strong>{parsed.lines.length}</strong> {bankT('txFound')}</span>
              <span><strong>{split.fresh.length}</strong> {bankT('newN')}</span>
              {split.duplicates.length > 0 && <span><strong>{split.duplicates.length}</strong> {bankT('alreadyImported')}</span>}
              {parsed.skipped > 0 && <span>{bankT('nonTx', { n: parsed.skipped })}</span>}
              {parsed.openingBalance !== undefined && <span>{bankT('openingN')} <strong>{formatMoney(parsed.openingBalance)}</strong></span>}
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
                    <caption className={surface.srOnly}>{bankT('firstTx')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{bankT('thDate')}</th>
                        <th scope="col">{bankT('thNarration')}</th>
                        <th scope="col" style={{ textAlign: 'right' }}>{bankT('thDebit')}</th>
                        <th scope="col" style={{ textAlign: 'right' }}>{bankT('thCredit')}</th>
                        <th scope="col" style={{ textAlign: 'right' }}>{bankT('thBalance')}</th>
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
                {parsed.lines.length > 8 && <p className={styles.muted}>{bankT('andMoreN', { n: parsed.lines.length - 8 })}</p>}
                <div className={controls.field} style={{ maxWidth: 320 }}>
                  <label className={controls.label} htmlFor={`${inputId}-label`}>{bankT('bankLabel')}</label>
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
                    {bankT(split.fresh.length === 1 ? 'importOne' : 'importMany', { n: split.fresh.length })}
                  </button>
                  <button type="button" className={controls.btnOutline} onClick={() => setRemap(true)}>
                    {bankT('columnsWrong')}
                  </button>
                  {split.fresh.length === 0 && <span className={styles.muted}>{bankT('allImported')}</span>}
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
      <p className={styles.muted}>{bankT('mapIntro')}</p>
      <div className={controls.field} style={{ maxWidth: 520 }}>
        <label className={controls.label} htmlFor={`${id}-hr`}>{bankT('headerRow')}</label>
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
            <option key={i} value={i}>{bankT('rowN', { n: i + 1, text: r.filter(Boolean).join(' | ').slice(0, 70) || bankT('blank') })}</option>
          ))}
        </select>
      </div>
      <div className={styles.mapGrid}>
        {MAP_FIELDS.map((f) => (
          <div key={f} className={controls.field}>
            <label className={controls.label} htmlFor={`${id}-${f}`}>{bankT(`col.${f}`) || COLUMN_FIELD_LABELS[f]}</label>
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
              <option value={-1}>{bankT('notInFile')}</option>
              {header.map((h, i) => (
                <option key={i} value={i}>{bankT('columnN', { n: i + 1, text: h || bankT('blank') })}</option>
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
          {bankT('useColumns')}
        </button>
      </div>
    </div>
  );
}
