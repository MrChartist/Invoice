import { useCallback, useMemo, useReducer, useRef } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { parseTable } from '../../lib/csv';
import { invoiceAmountMapped, missingRequired, type ImportKind } from '../../lib/import-mapping';
import {
  applyImport,
  buildPreview,
  createLocalSink,
  dryRunReport,
  type ImportReport,
  type PreviewRow,
} from '../../lib/importers';
import { senderStateCode } from '../../store/invoice-defaults';
import { initialWizardState, wizardReducer, type ExistingData } from './wizard-state';
import { ChooseFileStep } from './steps/ChooseFileStep';
import { MapColumnsStep } from './steps/MapColumnsStep';
import { ReviewStep } from './steps/ReviewStep';
import { ImportStep } from './steps/ImportStep';
import ctl from '../../styles/controls.module.css';
import styles from './ImportWizard.module.css';

export interface ImportWizardProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selects the kind of data (the user can still change it on step 1). */
  kind?: ImportKind;
  /** Called once after a successful import so the host page can reload its lists. */
  onDone?: (report: ImportReport, kind: ImportKind) => void;
}

const STEPS = ['Choose file', 'Map columns', 'Review rows', 'Import'] as const;
const MAX_BYTES = 25 * 1024 * 1024;

function readExisting(): ExistingData {
  return {
    clients: localDb.clients.getAll(),
    items: localDb.items.getAll(),
    invoices: localDb.invoices.getAll(),
  };
}

export function ImportWizard(props: ImportWizardProps) {
  // Mounting a fresh body per open resets every piece of wizard state.
  if (!props.open) return null;
  return <WizardBody {...props} />;
}

function WizardBody({ onClose, kind: initialKind, onDone }: ImportWizardProps) {
  // Existing data is re-read when the review step opens so the duplicate check is current.
  const [state, dispatch] = useReducer(wizardReducer, initialKind, (k) => initialWizardState(k, readExisting()));
  const { step, kind, table, mapping, existing, duplicateMode, strictGstin, skipped, filter, running, report } = state;
  const cancelRef = useRef(false);

  const options = useMemo(() => {
    const settings = localDb.settings.get();
    const sender = localDb.settings.activeProfile();
    return {
      duplicateMode,
      strictGstin,
      defaultDueDays: settings.defaultDueDays,
      sender,
      senderStateCode: senderStateCode(sender),
      templateId: localDb.template.get(),
    };
  }, [duplicateMode, strictGstin]);

  const preview = useMemo(
    () =>
      table && step >= 2
        ? buildPreview({ kind, table, mapping, existing, options, skipped })
        : null,
    [table, step, kind, mapping, existing, options, skipped],
  );

  const missing = missingRequired(kind, mapping);
  const amountMissing = kind === 'invoices' && !invoiceAmountMapped(mapping);
  const canMap = missing.length === 0 && !amountMissing;

  /* ── Step 1: loading ───────────────────────────────────────── */
  const loadText = useCallback((text: string, name: string) => {
    const parsed = parseTable(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      dispatch({
        type: 'loadFailed',
        clearTable: true,
        message: parsed.headers.length === 0 ? 'That file looks empty.' : 'Found a header row but no data rows below it.',
      });
      return;
    }
    dispatch({ type: 'loaded', fileName: name, table: { headers: parsed.headers, rows: parsed.rows }, delimiter: parsed.delimiter });
  }, []);

  const loadFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (/\.(xls|ods|numbers)$/i.test(file.name)) {
        dispatch({ type: 'loadFailed', message: 'This spreadsheet format cannot be read directly. Save it as Excel .xlsx or "CSV UTF-8 (Comma delimited)" and pick that file.' });
        return;
      }
      if (file.size > MAX_BYTES) {
        dispatch({ type: 'loadFailed', message: 'That file is larger than 25 MB. Split it into smaller files.' });
        return;
      }
      try {
        if (/\.(xlsx|xlsm)$/i.test(file.name)) {
          // .xlsx → first sheet as CSV text; the parser is loaded only when needed.
          const { xlsxToCsv } = await import('../../lib/xlsx');
          try {
            loadText(await xlsxToCsv(await file.arrayBuffer()), file.name);
          } catch (err) {
            dispatch({ type: 'loadFailed', message: err instanceof Error ? err.message : 'Could not read that workbook.' });
          }
          return;
        }
        loadText(await file.text(), file.name);
      } catch {
        dispatch({ type: 'loadFailed', message: 'Could not read that file.' });
      }
    },
    [loadText],
  );

  /* ── Step 3: review ────────────────────────────────────────── */
  const rows = useMemo(() => {
    if (!preview) return [] as PreviewRow[];
    if (filter === 'errors') return preview.rows.filter((r) => r.action === 'error');
    if (filter === 'issues') return preview.rows.filter((r) => r.issues.length > 0);
    return preview.rows;
  }, [preview, filter]);

  /* ── Step 4: run ───────────────────────────────────────────── */
  const dry = preview ? dryRunReport(preview) : null;
  const writable = preview ? preview.summary.create + preview.summary.update : 0;

  const run = async () => {
    if (!preview) return;
    dispatch({ type: 'runStarted' });
    cancelRef.current = false;
    try {
      const result = await applyImport(preview, createLocalSink(), {
        chunkSize: 250,
        onProgress: (done) => dispatch({ type: 'runProgress', done }),
        shouldCancel: () => cancelRef.current,
      });
      dispatch({ type: 'runSucceeded', report: result, existing: readExisting() });
      onDone?.(result, kind);
    } catch (e) {
      dispatch({ type: 'runFailed', message: e instanceof Error ? e.message : 'The import failed unexpectedly.' });
    } finally {
      dispatch({ type: 'runEnded' });
    }
  };

  const requestClose = () => {
    if (running) return; // never abandon a write half-way
    onClose();
  };

  const goNext = () => dispatch({ type: 'next', existing: step === 1 || step === 0 ? readExisting() : undefined });

  const nextDisabled =
    (step === 0 && !table) || (step === 1 && !canMap) || (step === 2 && writable === 0);

  const footer = (
    <div className={styles.footer}>
      {step > 0 && !report && (
        <button type="button" className={cn(ctl.btn, ctl.btnOutline)} disabled={running} onClick={() => dispatch({ type: 'back' })}>
          <ArrowLeft size={15} /> Back
        </button>
      )}
      <span className={styles.footerSpacer} />
      {report ? (
        <button type="button" className={cn(ctl.btn, ctl.btnPrimary)} onClick={onClose}>
          Done
        </button>
      ) : step < 3 ? (
        <button type="button" className={cn(ctl.btn, ctl.btnPrimary)} disabled={nextDisabled} onClick={goNext}>
          Next <ArrowRight size={15} />
        </button>
      ) : (
        <>
          <button type="button" className={cn(ctl.btn, ctl.btnOutline)} disabled={running} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cn(ctl.btn, ctl.btnPrimary)} disabled={running || writable === 0} onClick={run}>
            <Upload size={15} /> {running ? 'Importing…' : `Import ${writable.toLocaleString('en-IN')} record${writable === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </div>
  );

  return (
    <Modal
      open
      onClose={requestClose}
      size="xl"
      title={
        <>
          <FileSpreadsheet size={18} /> Import data
        </>
      }
      subtitle="Bring clients, items and opening invoices over from Excel, Vyapar, Zoho Books, Tally or Busy. Everything stays in this browser."
      footer={footer}
    >
      <ol className={styles.steps} aria-label="Import progress">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={cn(styles.stepItem, i === step && styles.stepActive, i < step && styles.stepDone)}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className={styles.stepNum}>{i < step ? <CheckCircle2 size={14} /> : i + 1}</span>
            <span className={styles.stepLabel}>{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <ChooseFileStep state={state} dispatch={dispatch} onLoadFile={(f) => void loadFile(f)} onLoadText={loadText} />
      )}

      {step === 1 && table && (
        <MapColumnsStep
          kind={kind}
          table={table}
          mapping={mapping}
          confidence={state.confidence}
          presetId={state.presetId}
          missing={missing}
          amountMissing={amountMissing}
          dispatch={dispatch}
        />
      )}

      {step === 2 && table && preview && (
        <ReviewStep state={state} table={table} preview={preview} rows={rows} writable={writable} dispatch={dispatch} />
      )}

      {step === 3 && table && preview && dry && (
        <ImportStep
          kind={kind}
          table={table}
          preview={preview}
          dry={dry}
          report={report}
          running={running}
          progress={state.progress}
          writable={writable}
          saveError={state.saveError}
        />
      )}
    </Modal>
  );
}
