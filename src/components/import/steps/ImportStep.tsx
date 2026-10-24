import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { KIND_LABELS, type ImportKind } from '../../../lib/import-mapping';
import { errorRowsCsv, reportErrorsCsv, type ImportPreview, type ImportReport, type ImportTable } from '../../../lib/importers';
import { download } from '../download';
import ctl from '../../../styles/controls.module.css';
import styles from '../ImportWizard.module.css';

interface Props {
  kind: ImportKind;
  table: ImportTable;
  preview: ImportPreview;
  /** What the import would do (computed from the preview). */
  dry: ImportReport;
  /** What it did, once finished. */
  report: ImportReport | null;
  running: boolean;
  progress: number;
  writable: number;
  saveError: string;
}

/** Step 4: confirm, watch progress, then the result with downloadable problem rows. */
export function ImportStep({ kind, table, preview, dry, report, running, progress, writable, saveError }: Props) {
  return (
    <div className={styles.stack}>
      {!report ? (
        <>
          <h3 className={styles.h3}>Ready to import {KIND_LABELS[kind].toLowerCase()}</h3>
          <div className={styles.result}>
            <Stat label="Will be created" value={dry.created} tone="ok" />
            <Stat label="Will be updated" value={dry.updated} tone="info" />
            <Stat label="Skipped" value={preview.summary.skip} />
            <Stat label="Rows with errors" value={preview.summary.error} tone={preview.summary.error ? 'bad' : undefined} />
          </div>
          <p className={ctl.hint}>
            Data is written to this browser only. Existing invoices are never overwritten — a number that already exists is skipped.
            Take a backup from Settings first if you are unsure.
          </p>
          {running && (
            <div>
              <div
                className={styles.bar}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={writable}
                aria-valuenow={progress}
                aria-label="Import progress"
              >
                <span style={{ width: `${writable ? (progress / writable) * 100 : 0}%` }} />
              </div>
              <p className={ctl.hint}>
                {progress.toLocaleString('en-IN')} of {writable.toLocaleString('en-IN')} written…
              </p>
            </div>
          )}
          {saveError && (
            <p className={ctl.error} role="alert">
              <AlertTriangle size={14} /> {saveError}
            </p>
          )}
          {preview.summary.error > 0 && (
            <button
              type="button"
              className={cn(ctl.btn, ctl.btnOutline, ctl.btnSm)}
              onClick={() => download('import-error-rows.csv', errorRowsCsv(table, preview))}
            >
              <Download size={14} /> Download rows with errors
            </button>
          )}
        </>
      ) : (
        <div aria-live="polite">
          <h3 className={styles.h3}>
            <CheckCircle2 size={20} className={styles.okIcon} /> Import finished
          </h3>
          <div className={styles.result}>
            <Stat label="Created" value={report.created} tone="ok" />
            <Stat label="Updated" value={report.updated} tone="info" />
            <Stat label="Not imported" value={report.skipped} tone={report.errors.length ? 'bad' : undefined} />
          </div>
          {report.errors.length > 0 && (
            <>
              <ul className={styles.errList}>
                {report.errors.slice(0, 8).map((e, i) => (
                  <li key={i}>
                    <strong>Row {e.line}</strong> {e.label && `· ${e.label}`} — {e.message}
                  </li>
                ))}
                {report.errors.length > 8 && <li>…and {report.errors.length - 8} more in the download.</li>}
              </ul>
              <div className={styles.dropActions}>
                <button type="button" className={cn(ctl.btn, ctl.btnOutline, ctl.btnSm)} onClick={() => download('import-error-rows.csv', errorRowsCsv(table, preview))}>
                  <Download size={14} /> Error rows (original columns)
                </button>
                <button type="button" className={cn(ctl.btn, ctl.btnGhost, ctl.btnSm)} onClick={() => download('import-report.csv', reportErrorsCsv(report))}>
                  <Download size={14} /> Problem list
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'info' | 'bad' }) {
  return (
    <div className={cn(styles.stat, tone && styles[`stat_${tone}`])}>
      <span className={styles.statValue}>{value.toLocaleString('en-IN')}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
