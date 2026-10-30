import type { Dispatch } from 'react';
import { Pencil, SkipForward, Undo2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { IMPORT_SCHEMAS, type ColumnMapping, type ImportKind } from '../../../lib/import-mapping';
import type { ImportPreview, ImportTable, PreviewRow } from '../../../lib/importers';
import type { WizardAction, WizardState } from '../wizard-state';
import ctl from '../../../styles/controls.module.css';
import styles from '../ImportWizard.module.css';
import { SelectField } from '../../ui/SelectField';

interface Props {
  state: WizardState;
  table: ImportTable;
  preview: ImportPreview;
  /** Preview rows after the All / With issues / Errors only filter. */
  rows: PreviewRow[];
  writable: number;
  dispatch: Dispatch<WizardAction>;
}

/** Step 3: what will happen to each row; skip or fix rows in place. */
export function ReviewStep({ state, table, preview, rows, writable, dispatch }: Props) {
  const { kind, filter, duplicateMode, strictGstin, skipped, editing, visible, mapping } = state;
  return (
    <div className={styles.stack}>
      <div className={styles.chips} role="status">
        <span className={cn(styles.chip, styles.chipCreate)}>{preview.summary.create.toLocaleString('en-IN')} new</span>
        <span className={cn(styles.chip, styles.chipUpdate)}>{preview.summary.update.toLocaleString('en-IN')} update</span>
        <span className={styles.chip}>{preview.summary.skip.toLocaleString('en-IN')} skipped</span>
        <span className={cn(styles.chip, preview.summary.error ? styles.chipError : '')}>
          {preview.summary.error.toLocaleString('en-IN')} with errors
        </span>
        <span className={styles.chip}>{preview.summary.warnings.toLocaleString('en-IN')} warnings</span>
      </div>

      <div className={styles.toolbar}>
        <div className={ctl.segment} role="group" aria-label="Filter rows">
          {(['all', 'issues', 'errors'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={filter === f ? ctl.segmentBtnActive : ctl.segmentBtn}
              aria-pressed={filter === f}
              onClick={() => dispatch({ type: 'setFilter', filter: f })}
            >
              {f === 'all' ? 'All rows' : f === 'issues' ? 'With issues' : 'Errors only'}
            </button>
          ))}
        </div>
        {kind !== 'invoices' && (
          <label className={styles.inline}>
            <span className={ctl.label}>If it already exists</span>
            <SelectField className={cn(ctl.input, ctl.select)} value={duplicateMode} onChange={(e) => dispatch({ type: 'setDuplicateMode', mode: e.target.value as 'update' | 'skip' })}>
              <option value="update">Update (fill in blanks, keep the rest)</option>
              <option value="skip">Skip it</option>
            </SelectField>
          </label>
        )}
        {(kind === 'clients' || kind === 'invoices' || kind === 'vendors' || kind === 'ledgers') && (
          <label className={ctl.check}>
            <input type="checkbox" checked={!strictGstin} onChange={(e) => dispatch({ type: 'setStrictGstin', strict: !e.target.checked })} />
            <span>Import rows with an invalid GSTIN anyway</span>
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <p className={ctl.hint}>No rows match this filter.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.reviewTable}>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Record</th>
                <th scope="col">Result</th>
                <th scope="col">Problems</th>
                <th scope="col">
                  <span className={styles.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, visible).map((r) => (
                <ReviewRow
                  key={r.index}
                  row={r}
                  isSkipped={skipped.has(r.index)}
                  open={editing === r.index}
                  table={table}
                  mapping={mapping}
                  kind={kind}
                  onToggleSkip={() => dispatch({ type: 'toggleSkip', sourceIndexes: r.sourceIndexes })}
                  onToggleEdit={() => dispatch({ type: 'toggleEdit', index: r.index })}
                  onEditCell={(rowIndex, col, value) => dispatch({ type: 'editCell', rowIndex, col, value })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > visible && (
        <button type="button" className={cn(ctl.btn, ctl.btnOutline)} onClick={() => dispatch({ type: 'showMore' })}>
          Show more ({(rows.length - visible).toLocaleString('en-IN')} remaining)
        </button>
      )}
      {writable === 0 && <p className={ctl.error}>Nothing to import yet: fix the errors, change the mapping, or un-skip rows.</p>}
    </div>
  );
}

const ACTION_LABEL = { create: 'New', update: 'Update', skip: 'Skip', error: 'Error' } as const;

interface ReviewRowProps {
  row: PreviewRow;
  isSkipped: boolean;
  open: boolean;
  table: ImportTable;
  mapping: ColumnMapping;
  kind: ImportKind;
  onToggleSkip: () => void;
  onToggleEdit: () => void;
  onEditCell: (rowIndex: number, col: number, value: string) => void;
}

function ReviewRow({ row, isSkipped, open, table, mapping, kind, onToggleSkip, onToggleEdit, onEditCell }: ReviewRowProps) {
  const fields = IMPORT_SCHEMAS[kind].filter((f) => (mapping[f.key] ?? -1) >= 0);
  const problems = row.issues;
  return (
    <>
      <tr className={cn(row.action === 'error' && styles.rowError, isSkipped && styles.rowSkipped)}>
        <td className={styles.mono}>{row.line}</td>
        <td>
          <span className={styles.recordName}>{row.label || '-'}</span>
          {row.skipReason && <span className={styles.fieldHint}>{row.skipReason}</span>}
        </td>
        <td>
          <span className={cn(styles.badge, styles[`badge_${row.action}`])}>{ACTION_LABEL[row.action]}</span>
        </td>
        <td>
          {problems.length === 0 ? (
            <span className={ctl.hint}>-</span>
          ) : (
            <ul className={styles.issueList}>
              {problems.map((p, i) => (
                <li key={i} className={p.level === 'error' ? styles.issueError : styles.issueWarn}>
                  <span className={styles.srOnly}>{p.level}: </span>
                  {p.message}
                </li>
              ))}
            </ul>
          )}
        </td>
        <td className={styles.actions}>
          {row.sourceIndexes.length === 1 && (
            <button type="button" className={cn(ctl.btn, ctl.btnGhost, ctl.btnSm)} onClick={onToggleEdit} aria-expanded={open} aria-label={`Edit row ${row.line}`}>
              <Pencil size={14} />
            </button>
          )}
          <button
            type="button"
            className={cn(ctl.btn, ctl.btnGhost, ctl.btnSm)}
            onClick={onToggleSkip}
            aria-label={isSkipped ? `Include row ${row.line}` : `Skip row ${row.line}`}
          >
            {isSkipped ? <Undo2 size={14} /> : <SkipForward size={14} />}
          </button>
        </td>
      </tr>
      {open && (
        <tr className={styles.editRow}>
          <td colSpan={5}>
            <div className={styles.editGrid}>
              {fields.map((f) => {
                const col = mapping[f.key]!;
                const id = `edit-${row.index}-${f.key}`;
                return (
                  <div key={f.key} className={ctl.field}>
                    <label className={ctl.label} htmlFor={id}>
                      {f.label}
                    </label>
                    <input
                      id={id}
                      className={ctl.input}
                      value={table.rows[row.index]?.[col] ?? ''}
                      onChange={(e) => onEditCell(row.index, col, e.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
