import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Package,
  Pencil,
  ReceiptText,
  SkipForward,
  Undo2,
  Upload,
  Users,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { parseTable, writeCsv } from '../../lib/csv';
import {
  IMPORT_PRESETS,
  IMPORT_SCHEMAS,
  KIND_LABELS,
  guessMapping,
  invoiceAmountMapped,
  missingRequired,
  templateFileName,
  templateRows,
  type ColumnMapping,
  type ImportKind,
} from '../../lib/import-mapping';
import {
  applyImport,
  buildPreview,
  createLocalSink,
  dryRunReport,
  errorRowsCsv,
  reportErrorsCsv,
  type ImportReport,
  type ImportTable,
  type PreviewRow,
} from '../../lib/importers';
import { senderStateCode } from '../../store/invoice-defaults';
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
const PAGE = 100;

const KIND_META: Record<ImportKind, { icon: typeof Users; text: string }> = {
  clients: { icon: Users, text: 'Customers and parties with GSTIN, state and contact details.' },
  items: { icon: Package, text: 'Products and services with HSN/SAC, rate and GST %.' },
  invoices: { icon: ReceiptText, text: 'Past invoices and outstanding balances, keeping their numbers and amounts.' },
};

function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportWizard(props: ImportWizardProps) {
  // Mounting a fresh body per open resets every piece of wizard state.
  if (!props.open) return null;
  return <WizardBody {...props} />;
}

function WizardBody({ onClose, kind: initialKind, onDone }: ImportWizardProps) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ImportKind>(initialKind ?? 'clients');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<ImportTable | null>(null);
  const [delimiterLabel, setDelimiterLabel] = useState('');
  const [loadError, setLoadError] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [dragging, setDragging] = useState(false);

  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [presetId, setPresetId] = useState('generic');

  const [duplicateMode, setDuplicateMode] = useState<'update' | 'skip'>('update');
  const [strictGstin, setStrictGstin] = useState(true);
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'issues' | 'errors'>('all');
  const [editing, setEditing] = useState<number | null>(null);
  const [visible, setVisible] = useState(PAGE);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [saveError, setSaveError] = useState('');
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Existing data is read when the review step opens so the duplicate check is current. */
  const [existing, setExisting] = useState(() => ({
    clients: localDb.clients.getAll(),
    items: localDb.items.getAll(),
    invoices: localDb.invoices.getAll(),
  }));

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

  const schema = IMPORT_SCHEMAS[kind];
  const missing = missingRequired(kind, mapping);
  const amountMissing = kind === 'invoices' && !invoiceAmountMapped(mapping);
  const canMap = missing.length === 0 && !amountMissing;

  /* ── Step 1: loading ───────────────────────────────────────── */
  const loadText = useCallback(
    (text: string, name: string) => {
      const parsed = parseTable(text);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setLoadError(
          parsed.headers.length === 0
            ? 'That file looks empty.'
            : 'Found a header row but no data rows below it.',
        );
        setTable(null);
        return;
      }
      setLoadError('');
      setFileName(name);
      setTable({ headers: parsed.headers, rows: parsed.rows });
      setDelimiterLabel(
        parsed.delimiter === '\t' ? 'tab' : parsed.delimiter === ';' ? 'semicolon' : parsed.delimiter === '|' ? 'pipe' : 'comma',
      );
      const guess = guessMapping(kind, parsed.headers, parsed.rows);
      setMapping(guess.mapping);
      setConfidence(guess.confidence);
      setPresetId(guess.presetId ?? 'generic');
      setSkipped(new Set());
      setEditing(null);
    },
    [kind],
  );

  const loadFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (/\.(xlsx|xlsm|xls|ods|numbers)$/i.test(file.name)) {
        setLoadError('Excel workbooks cannot be read directly. In Excel choose File → Save As → "CSV UTF-8 (Comma delimited)" and pick that file.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setLoadError('That file is larger than 25 MB. Split it into smaller files.');
        return;
      }
      try {
        loadText(await file.text(), file.name);
      } catch {
        setLoadError('Could not read that file.');
      }
    },
    [loadText],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void loadFile(e.dataTransfer.files?.[0]);
  };

  const changeKind = (next: ImportKind) => {
    setKind(next);
    if (table) {
      const guess = guessMapping(next, table.headers, table.rows);
      setMapping(guess.mapping);
      setConfidence(guess.confidence);
      setPresetId(guess.presetId ?? 'generic');
      setSkipped(new Set());
    }
  };

  /* ── Step 2: mapping ───────────────────────────────────────── */
  const setColumn = (key: string, value: string) => {
    const col = value === '' ? undefined : Number(value);
    setMapping((m) => {
      const next: ColumnMapping = { ...m };
      if (col === undefined) delete next[key];
      else {
        for (const k of Object.keys(next)) if (next[k] === col) delete next[k]; // one column, one field
        next[key] = col;
      }
      return next;
    });
    setConfidence((c) => ({ ...c, [key]: col === undefined ? 0 : 1 }));
  };

  const reguess = (id: string) => {
    if (!table) return;
    setPresetId(id);
    const guess = guessMapping(kind, table.headers, table.rows, id === 'generic' ? undefined : id);
    setMapping(guess.mapping);
    setConfidence(guess.confidence);
  };

  /* ── Step 3: review ────────────────────────────────────────── */
  const rows = useMemo(() => {
    if (!preview) return [] as PreviewRow[];
    if (filter === 'errors') return preview.rows.filter((r) => r.action === 'error');
    if (filter === 'issues') return preview.rows.filter((r) => r.issues.length > 0);
    return preview.rows;
  }, [preview, filter]);

  const toggleSkip = (r: PreviewRow) =>
    setSkipped((s) => {
      const next = new Set(s);
      for (const i of r.sourceIndexes) {
        if (next.has(i)) next.delete(i);
        else next.add(i);
      }
      return next;
    });

  const editCell = (rowIndex: number, col: number, value: string) =>
    setTable((t) =>
      t
        ? { ...t, rows: t.rows.map((row, i) => (i === rowIndex ? row.map((c, ci) => (ci === col ? value : c)) : row)) }
        : t,
    );

  /* ── Step 4: run ───────────────────────────────────────────── */
  const dry = preview ? dryRunReport(preview) : null;
  const writable = preview ? preview.summary.create + preview.summary.update : 0;

  const run = async () => {
    if (!preview) return;
    setRunning(true);
    setSaveError('');
    setProgress(0);
    cancelRef.current = false;
    try {
      const result = await applyImport(preview, createLocalSink(), {
        chunkSize: 250,
        onProgress: (done) => setProgress(done),
        shouldCancel: () => cancelRef.current,
      });
      setReport(result);
      setExisting({
        clients: localDb.clients.getAll(),
        items: localDb.items.getAll(),
        invoices: localDb.invoices.getAll(),
      });
      onDone?.(result, kind);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The import failed unexpectedly.');
    } finally {
      setRunning(false);
    }
  };

  const requestClose = () => {
    if (running) return; // never abandon a write half-way
    onClose();
  };

  const goNext = () => {
    if (step === 1 || step === 0) setExisting({
      clients: localDb.clients.getAll(),
      items: localDb.items.getAll(),
      invoices: localDb.invoices.getAll(),
    });
    setStep((s) => Math.min(s + 1, 3));
  };

  const nextDisabled =
    (step === 0 && !table) || (step === 1 && !canMap) || (step === 2 && writable === 0);

  const footer = (
    <div className={styles.footer}>
      {step > 0 && !report && (
        <button type="button" className={cn(ctl.btn, ctl.btnOutline)} disabled={running} onClick={() => setStep(step - 1)}>
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

      {/* ───────── Step 1 ───────── */}
      {step === 0 && (
        <div className={styles.stack}>
          <fieldset className={styles.kindSet}>
            <legend className={ctl.label}>What are you importing?</legend>
            <div className={styles.kindGrid}>
              {(Object.keys(KIND_LABELS) as ImportKind[]).map((k) => {
                const Icon = KIND_META[k].icon;
                return (
                  <label key={k} className={cn(styles.kindCard, kind === k && styles.kindCardOn)}>
                    <input
                      type="radio"
                      name="import-kind"
                      className={styles.srOnly}
                      checked={kind === k}
                      onChange={() => changeKind(k)}
                    />
                    <Icon size={20} aria-hidden />
                    <strong>{KIND_LABELS[k]}</strong>
                    <span>{KIND_META[k].text}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div
            className={cn(styles.drop, dragging && styles.dropOn)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <Upload size={26} aria-hidden />
            <p className={styles.dropTitle}>{table ? fileName : 'Drop a CSV file here'}</p>
            <p className={ctl.hint}>
              {table
                ? `${table.rows.length.toLocaleString('en-IN')} data rows · ${table.headers.length} columns · ${delimiterLabel}-separated`
                : 'CSV, TSV or TXT exported from Excel, Vyapar, Zoho Books, Tally or Busy. Excel .xlsx: use Save As → CSV UTF-8.'}
            </p>
            <div className={styles.dropActions}>
              <button type="button" className={cn(ctl.btn, ctl.btnPrimary)} onClick={() => fileRef.current?.click()}>
                {table ? 'Choose a different file' : 'Choose file'}
              </button>
              <button type="button" className={cn(ctl.btn, ctl.btnGhost)} onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>
                Paste instead
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
              className={styles.srOnly}
              aria-label="Choose a CSV file"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>

          {pasteOpen && (
            <div className={ctl.field}>
              <label className={ctl.label} htmlFor="import-paste">
                Paste rows (with a header line)
              </label>
              <textarea
                id="import-paste"
                className={cn(ctl.input, ctl.textarea, styles.paste)}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'Name,GSTIN,City\nAcme Traders,27AAPFU0939F1ZV,Mumbai'}
                rows={5}
              />
              <div>
                <button type="button" className={cn(ctl.btn, ctl.btnOutline, ctl.btnSm)} disabled={!pasted.trim()} onClick={() => loadText(pasted, 'Pasted data')}>
                  Use pasted data
                </button>
              </div>
            </div>
          )}

          {loadError && (
            <p className={ctl.error} role="alert">
              <AlertTriangle size={14} /> {loadError}
            </p>
          )}

          <div className={styles.templates}>
            <span className={ctl.hint}>Starting from scratch? Download a ready-made template:</span>
            {(Object.keys(KIND_LABELS) as ImportKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className={cn(ctl.btn, ctl.btnGhost, ctl.btnSm)}
                onClick={() => download(templateFileName(k), writeCsv(templateRows(k), { bom: true }))}
              >
                <Download size={14} /> {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ───────── Step 2 ───────── */}
      {step === 1 && table && (
        <div className={styles.stack}>
          <div className={styles.row}>
            <div className={ctl.field}>
              <label className={ctl.label} htmlFor="import-preset">
                Source / saved mapping
              </label>
              <select id="import-preset" className={cn(ctl.input, ctl.select)} value={presetId} onChange={(e) => reguess(e.target.value)}>
                {IMPORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <span className={ctl.hint}>{IMPORT_PRESETS.find((p) => p.id === presetId)?.description}</span>
            </div>
            <p className={styles.mapNote}>
              Columns were matched automatically. Check the low-confidence ones and fix anything that is wrong.
            </p>
          </div>

          {(missing.length > 0 || amountMissing) && (
            <p className={ctl.error} role="alert">
              <AlertTriangle size={14} />
              {missing.length > 0
                ? `Map a column for: ${missing.map((f) => f.label).join(', ')}.`
                : 'Map an invoice total, a taxable value, or line-item name and rate columns.'}
            </p>
          )}

          <div className={styles.tableWrap}>
            <table className={styles.mapTable}>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Your column</th>
                  <th scope="col">Match</th>
                  <th scope="col">Sample values</th>
                </tr>
              </thead>
              <tbody>
                {schema.map((f) => {
                  const col = mapping[f.key];
                  const mapped = col !== undefined && col >= 0;
                  const conf = confidence[f.key] ?? 0;
                  const samples = mapped
                    ? table.rows.map((r) => r[col!]).filter(Boolean).slice(0, 3)
                    : [];
                  const selectId = `map-${f.key}`;
                  return (
                    <tr key={f.key}>
                      <th scope="row">
                        <label htmlFor={selectId}>
                          {f.label}
                          {f.required && <span className={styles.req} aria-label="required"> *</span>}
                        </label>
                        {f.hint && <span className={styles.fieldHint}>{f.hint}</span>}
                      </th>
                      <td>
                        <select
                          id={selectId}
                          className={cn(ctl.input, ctl.select, f.required && !mapped && ctl.inputInvalid)}
                          value={mapped ? String(col) : ''}
                          onChange={(e) => setColumn(f.key, e.target.value)}
                        >
                          <option value="">— not mapped —</option>
                          {table.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {mapped && (
                          <span className={cn(styles.conf, conf >= 0.85 ? styles.confHigh : conf >= 0.6 ? styles.confMid : styles.confLow)}>
                            {conf >= 1 && presetId !== 'generic' ? 'Preset' : `${Math.round(conf * 100)}%`}
                          </span>
                        )}
                      </td>
                      <td className={styles.samples}>
                        {samples.length ? samples.map((s, i) => <code key={i}>{s}</code>) : <span className={ctl.hint}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───────── Step 3 ───────── */}
      {step === 2 && table && preview && (
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
                  onClick={() => {
                    setFilter(f);
                    setVisible(PAGE);
                  }}
                >
                  {f === 'all' ? 'All rows' : f === 'issues' ? 'With issues' : 'Errors only'}
                </button>
              ))}
            </div>
            {kind !== 'invoices' && (
              <label className={styles.inline}>
                <span className={ctl.label}>If it already exists</span>
                <select className={cn(ctl.input, ctl.select)} value={duplicateMode} onChange={(e) => setDuplicateMode(e.target.value as 'update' | 'skip')}>
                  <option value="update">Update (fill in blanks, keep the rest)</option>
                  <option value="skip">Skip it</option>
                </select>
              </label>
            )}
            {(kind === 'clients' || kind === 'invoices') && (
              <label className={ctl.check}>
                <input type="checkbox" checked={!strictGstin} onChange={(e) => setStrictGstin(!e.target.checked)} />
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
                  {rows.slice(0, visible).map((r) => {
                    const isSkipped = skipped.has(r.index);
                    return (
                      <ReviewRow
                        key={r.index}
                        row={r}
                        isSkipped={isSkipped}
                        open={editing === r.index}
                        table={table}
                        mapping={mapping}
                        kind={kind}
                        onToggleSkip={() => toggleSkip(r)}
                        onToggleEdit={() => setEditing(editing === r.index ? null : r.index)}
                        onEditCell={editCell}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > visible && (
            <button type="button" className={cn(ctl.btn, ctl.btnOutline)} onClick={() => setVisible((v) => v + PAGE * 4)}>
              Show more ({(rows.length - visible).toLocaleString('en-IN')} remaining)
            </button>
          )}
          {writable === 0 && <p className={ctl.error}>Nothing to import yet — fix the errors, change the mapping, or un-skip rows.</p>}
        </div>
      )}

      {/* ───────── Step 4 ───────── */}
      {step === 3 && table && preview && dry && (
        <div className={styles.stack}>
          {!report ? (
            <>
              <h3 className={styles.h3}>Ready to import {KIND_LABELS[kind].toLowerCase()}</h3>
              <div className={styles.result}>
                <Stat label="Will be created" value={dry.created} tone="ok" />
                <Stat label="Will be updated" value={dry.updated} tone="info" />
                <Stat label="Skipped" value={preview.summary.skip} />
                <Stat label="Rows with errors" value={preview.summary.error} tone={preview.summary.error ? "bad" : undefined} />
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
      )}
    </Modal>
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
          <span className={styles.recordName}>{row.label || '—'}</span>
          {row.skipReason && <span className={styles.fieldHint}>{row.skipReason}</span>}
        </td>
        <td>
          <span className={cn(styles.badge, styles[`badge_${row.action}`])}>{ACTION_LABEL[row.action]}</span>
        </td>
        <td>
          {problems.length === 0 ? (
            <span className={ctl.hint}>—</span>
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
