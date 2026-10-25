import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { TemplateEngine } from '../templates/TemplateEngine';
import { blankProfile, localDb } from '../../lib/localDb';
import { resolve as resolveDesign, type DesignPrefs } from '../../lib/design-prefs';
import { calcInputFromRecord, calculateInvoice, type CalcTotals } from '../../lib/invoice-calc';
import { normalizeRecord } from '../../store/invoice-defaults';
import { printCopies, type PrintCopy } from '../../lib/print-copies';
import { invoicePdfName, nextPaint, PdfBuilder, zipFiles } from '../../lib/pdf-batch';
import { downloadBlob } from '../../lib/download';
import { todayInput } from '../../lib/utils';
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';
import { useT } from '../../i18n';
import { printT } from '../../i18n/areas/printing';
import controls from '../../styles/controls.module.css';
import styles from './InvoicePreview.module.css';

interface Job {
  invoice: InvoiceRecord;
  sender: SenderProfile;
  totals: CalcTotals;
  design: DesignPrefs;
  copies: PrintCopy[];
}

function prepare(raw: InvoiceRecord, useCopies: boolean): Job {
  const invoice = normalizeRecord(raw, raw.template_id);
  // The document's own sender snapshot first (Critical Rule 3).
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const design = resolveDesign(sender.id);
  const totals = calculateInvoice(calcInputFromRecord(invoice));
  return { invoice, sender, totals, design, copies: printCopies(invoice, useCopies ? design.copies : 'single') };
}

/**
 * Batch output (P1-15): many saved documents → one combined PDF or a ZIP of PDFs. Each document
 * is rendered off-screen through the same TemplateEngine as the preview, captured, then dropped,
 * so memory stays flat. Works offline; nothing leaves the device.
 */
export function BatchPdfModal({ invoices, onClose }: { invoices: InvoiceRecord[]; onClose: () => void }) {
  useT();
  const [mode, setMode] = useState<'pdf' | 'zip'>('pdf');
  const [useCopies, setUseCopies] = useState(true);
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const painted = useRef<(() => void) | null>(null);

  // Resolve the waiting render once React has committed the job and the browser painted it.
  useEffect(() => {
    if (!job || !painted.current) return;
    const done = painted.current;
    painted.current = null;
    void nextPaint().then(done);
  }, [job]);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  const render = (next: Job) =>
    new Promise<void>((resolve) => {
      painted.current = resolve;
      setJob(next);
    });

  const run = async () => {
    cancelled.current = false;
    setError('');
    setResult('');
    setProgress({ done: 0, total: invoices.length });
    try {
      const combined = mode === 'pdf' ? await PdfBuilder.create() : null;
      const files: { name: string; data: Uint8Array }[] = [];
      let pages = 0;
      for (let i = 0; i < invoices.length; i++) {
        if (cancelled.current) return;
        const next = prepare(invoices[i], useCopies);
        await render(next);
        const papers = Array.from(hostRef.current?.querySelectorAll<HTMLElement>('[data-print-copy]') ?? []);
        const target = combined ?? (await PdfBuilder.create());
        for (const node of papers) pages += await target.addPaper(node, next.design);
        if (!combined) files.push({ name: invoicePdfName(next.invoice), data: await target.bytes() });
        setProgress({ done: i + 1, total: invoices.length });
      }
      setJob(null);
      const stamp = todayInput();
      if (combined) downloadBlob(`Documents_${stamp}.pdf`, combined.blob());
      else downloadBlob(`Documents_${stamp}.zip`, await zipFiles(files));
      setResult(printT('done', { pages }));
    } catch (err) {
      console.error('Batch PDF failed', err);
      setError(printT('failed'));
    } finally {
      setJob(null);
      setProgress(null);
    }
  };

  const busy = progress !== null;
  return (
    <Modal
      open
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      size="sm"
      title={printT('batchTitle', { n: invoices.length })}
      subtitle={printT('offline')}
      footer={
        <>
          <button type="button" className={controls.btnGhost} onClick={() => (busy ? (cancelled.current = true) : onClose())}>
            {busy ? printT('cancel') : printT('close')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={run} disabled={busy || invoices.length === 0}>
            {busy ? <Loader2 size={16} className={styles.spin} /> : <Download size={16} />} {printT('create')}
          </button>
        </>
      }
    >
      <fieldset className={styles.optsGroup} disabled={busy}>
        <label className={controls.check}>
          <input type="radio" name="batch-mode" checked={mode === 'pdf'} onChange={() => setMode('pdf')} />
          {printT('combined')}
        </label>
        <label className={controls.check}>
          <input type="radio" name="batch-mode" checked={mode === 'zip'} onChange={() => setMode('zip')} />
          {printT('zip')}
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={useCopies} onChange={(e) => setUseCopies(e.target.checked)} />
          {printT('useCopies')}
        </label>
      </fieldset>
      {progress && (
        <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
          <progress max={progress.total} value={progress.done} style={{ width: '100%' }} />
          <div className={controls.hint}>{printT('progress', { done: Math.min(progress.done + 1, progress.total), total: progress.total })}</div>
        </div>
      )}
      {result && <p className={controls.hint} role="status">{result}</p>}
      {error && <p className={controls.error} role="alert">{error}</p>}
      {job &&
        createPortal(
          <div ref={hostRef} className={styles.offscreen} aria-hidden="true">
            {job.copies.map((c) => (
              <div key={c.key} data-print-copy={c.key}>
                <TemplateEngine invoice={job.invoice} sender={job.sender} totals={job.totals} templateId={job.invoice.template_id} design={job.design} copyLabel={c.label} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </Modal>
  );
}
