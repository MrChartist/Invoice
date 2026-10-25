import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Loader2, Palette, Printer, Share2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb, blankProfile } from '../../lib/localDb';
import { TEMPLATES, templateById } from '../templates/registry';
import { TemplateEngine } from '../templates/TemplateEngine';
import { ShareMenu } from '../share';
import { pageSlices, paperSize, resolve as resolveDesign } from '../../lib/design-prefs';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { downloadBlob } from '../../lib/download';
import { ensureDevanagariFont } from '../../lib/fonts-ready';
import { canShareFiles, invoiceSummaryText, invoiceUpiLink, shareFile } from '../../lib/share';
import { buildClientCopyHtml } from '../../lib/client-copy';
import { FOCUSABLE } from '../ui/Modal';
import controls from '../../styles/controls.module.css';
import styles from './InvoicePreview.module.css';


interface InvoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Full-screen, scale-to-fit A4 preview with print and multi-page PDF export. */
export const InvoicePreviewModal = (props: InvoicePreviewModalProps) =>
  // Mount the body (and its whole-store subscription) only while open, so typing in the
  // editor does not re-render a closed preview.
  props.isOpen ? <PreviewBody {...props} /> : null;

const PreviewBody = ({ isOpen, onClose }: InvoicePreviewModalProps) => {
  const invoice = useInvoiceStore();
  const paperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  /** null = fit the width (default); otherwise an explicit zoom the user chose. */
  const [zoom, setZoom] = useState<number | null>(null);
  const scale = zoom ?? fitScale;
  /** A built PDF waiting for a fresh tap when the browser refused the first share attempt. */
  const [readyToShare, setReadyToShare] = useState<File | null>(null);
  const [paperHeight, setPaperHeight] = useState(1123);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Never render someone else's details: snapshot first, then the active profile, then a blank.
  const sender = useMemo(
    () => invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoice.sender, isOpen],
  );

  const design = useMemo(
    () => resolveDesign(sender.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sender.id, isOpen],
  );
  const size = paperSize(design);
  const PAPER_W = size.width;
  const PAPER_H = size.height;

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const available = stage.clientWidth - 8;
    setFitScale(Math.min(1, Math.max(0.3, available / PAPER_W)));
    if (paperRef.current) setPaperHeight(Math.max(paperRef.current.offsetHeight, PAPER_H));
  }, [PAPER_W, PAPER_H]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    if (paperRef.current) ro.observe(paperRef.current);
    return () => ro.disconnect();
  }, [isOpen, fit, invoice.items.length, invoice.template_id]);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    // Modal dialog: move focus inside, keep Tab inside, give focus back on close.
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(overlayRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    focusables()[0]?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = overlayRef.current?.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const idx = Math.max(0, TEMPLATES.findIndex((t) => t.id === invoice.template_id));
  const meta = templateById(invoice.template_id);
  const step = (dir: -1 | 1) => invoice.setTemplate(TEMPLATES[(idx + dir + TEMPLATES.length) % TEMPLATES.length].id);

  const pdfFilename = () => {
    const safe = (invoice.invoice_number || 'draft').replace(/[\\/:*?"<>|]+/g, '-');
    return `${DOCUMENT_LABELS[invoice.doc_type].replace(/\s+/g, '_')}_${safe}.pdf`;
  };

  /** Render the paper to a PDF Blob (null if the preview is not mounted). Throws on failure. */
  const buildPdf = async (): Promise<Blob | null> => {
    if (!paperRef.current) return null;
    // Loaded on demand — the PDF stack is ~200 KB gzipped and most sessions never export.
    const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
    const node = paperRef.current;
    await ensureDevanagariFont(node.textContent);
    const height = Math.max(node.offsetHeight, PAPER_H);
    const dataUrl = await toJpeg(node, {
      quality: 0.92,
      pixelRatio: 2.5,
      cacheBust: true,
      width: PAPER_W,
      height,
      backgroundColor: '#ffffff',
      style: { transform: 'none', transformOrigin: 'top left' },
    });

    // Thermal rolls are one tall page; sheet formats are sliced page by page.
    const slices = pageSlices(height, design);
    const pageWmm = size.mm.width;
    const imgHmm = (height / PAPER_W) * pageWmm;
    const pageHmm = size.autoHeight ? imgHmm : size.mm.height;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageWmm, pageHmm] });
    slices.forEach((_, page) => {
      if (page > 0) pdf.addPage([pageWmm, pageHmm], 'portrait');
      pdf.addImage(dataUrl, 'JPEG', 0, -page * pageHmm, pageWmm, imgHmm, undefined, 'FAST');
    });
    return pdf.output('blob');
  };

  const handleExportPDF = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await buildPdf();
      if (blob) downloadBlob(pdfFilename(), blob);
    } catch (err) {
      console.error('PDF export failed', err);
      setError('Could not create the PDF. Try Print → Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Client copy: the rendered page as one static HTML file with a pay panel. QR canvases are
   * frozen into images and the app's stylesheet rules are inlined so it opens anywhere offline.
   */
  const handleClientCopy = async () => {
    const node = paperRef.current;
    if (!node) return;
    const clone = node.cloneNode(true) as HTMLElement;
    const live = Array.from(node.querySelectorAll('canvas'));
    let qrDataUrl: string | undefined;
    Array.from(clone.querySelectorAll('canvas')).forEach((c, i) => {
      try {
        const url = live[i]?.toDataURL('image/png');
        if (!url) return;
        qrDataUrl ??= url;
        const img = document.createElement('img');
        img.src = url;
        img.width = live[i].width;
        img.height = live[i].height;
        img.style.cssText = live[i].style.cssText;
        img.alt = 'QR code';
        c.replaceWith(img);
      } catch {
        c.remove();
      }
    });
    const css = Array.from(document.styleSheets)
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        } catch {
          return '';
        }
      })
      .join('\n');
    const rec = invoice as unknown as InvoiceRecord;
    const due = Number(rec.balance_due) > 0 ? rec.balance_due : 0;
    const html = buildClientCopyHtml({
      title: `${DOCUMENT_LABELS[rec.doc_type]} ${rec.invoice_number}`.trim(),
      paperHtml: clone.outerHTML,
      css,
      business: rec.sender?.companyName ?? '',
      pay: due > 0 && rec.doc_type !== 'QUOTATION' && rec.doc_type !== 'SALES_ORDER' ? { amountText: formatCurrency(due, rec.currency), upiLink: invoiceUpiLink(rec), upiId: rec.sender?.upiId, qrDataUrl } : null,
      generatedOn: formatDate(new Date()),
    });
    const name = pdfFilename().replace(/\.pdf$/, '.html');
    const file = new File([html], name, { type: 'text/html' });
    const result = canShareFiles(file) ? await shareFile(file, { title: name }) : 'unsupported';
    if (result === 'unsupported' || result === 'failed' || result === 'blocked') downloadBlob(name, file);
  };

  /** Share the PDF itself (e.g. into a WhatsApp chat); browsers without file sharing get a download. */
  const shareReady = async (file: File) => {
    const result = await shareFile(file, {
      title: `${DOCUMENT_LABELS[invoice.doc_type]} ${invoice.invoice_number}`.trim(),
      text: invoiceSummaryText(invoice as unknown as InvoiceRecord),
    });
    if (result === 'blocked') return setReadyToShare(file);
    setReadyToShare(null);
    if (result === 'unsupported' || result === 'failed') downloadBlob(file.name, file);
  };

  const handleSharePDF = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await buildPdf();
      if (!blob) return;
      await shareReady(new File([blob], pdfFilename(), { type: 'application/pdf' }));
    } catch (err) {
      console.error('PDF share failed', err);
      setError('Could not create the PDF. Try Print → Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div ref={overlayRef} className={cn(styles.overlay, 'print-host')} role="dialog" aria-modal="true" aria-label="Document preview">
      <div className={cn(styles.toolbar, 'no-print')}>
        <div className={styles.templatePicker}>
          <button type="button" className={controls.btnIcon} onClick={() => step(-1)} aria-label="Previous template">
            <ChevronLeft size={18} />
          </button>
          <div className={styles.templateName}>
            <span className={styles.swatch} style={{ background: meta.accent }} />
            <select
              value={invoice.template_id}
              onChange={(e) => invoice.setTemplate(e.target.value)}
              aria-label="Template"
            >
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.category}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className={controls.btnIcon} onClick={() => step(1)} aria-label="Next template">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className={styles.zoom} role="group" aria-label="Zoom">
          <button type="button" className={controls.btnIcon} onClick={() => setZoom(Math.max(0.3, Math.round((scale - 0.15) * 100) / 100))} aria-label="Zoom out">
            <ZoomOut size={17} />
          </button>
          <button type="button" className={styles.zoomValue} onClick={() => setZoom(zoom === null ? 1 : null)} title={zoom === null ? 'Show at 100%' : 'Fit to width'}>
            {zoom === null ? 'Fit' : `${Math.round(scale * 100)}%`}
          </button>
          <button type="button" className={controls.btnIcon} onClick={() => setZoom(Math.min(2, Math.round((scale + 0.15) * 100) / 100))} aria-label="Zoom in">
            <ZoomIn size={17} />
          </button>
        </div>

        <div className={styles.actions}>
          <Link to="/design" className={cn(controls.btnIcon, styles.hideSm)} onClick={onClose} aria-label="Customise design" title="Customise design">
            <Palette size={18} />
          </Link>
          {invoice.id && (
            <ShareMenu invoice={invoice as unknown as InvoiceRecord} onDownloadPdf={handleExportPDF} onSharePdf={canShareFiles() ? handleSharePDF : undefined} onClientCopy={handleClientCopy} />
          )}
          {readyToShare && (
            <button type="button" className={controls.btnPrimary} onClick={() => shareReady(readyToShare)}>
              <Share2 size={16} /> Share PDF now
            </button>
          )}
          <button type="button" className={controls.btnOutline} onClick={() => window.print()}>
            <Printer size={16} /> <span className={styles.hideSm}>Print</span>
          </button>
          <button type="button" className={controls.btnPrimary} onClick={handleExportPDF} disabled={busy}>
            {busy ? <Loader2 size={16} className={styles.spin} /> : <Download size={16} />} PDF
          </button>
          <button type="button" className={controls.btnIcon} onClick={onClose} aria-label="Close preview">
            <X size={20} />
          </button>
        </div>
      </div>

      {error && <div className={cn(styles.error, 'no-print')}>{error}</div>}

      <div className={styles.stage} ref={stageRef}>
        <div className={styles.paperFrame} style={{ width: PAPER_W * scale, height: paperHeight * scale }}>
          <div className={cn(styles.paperScale, 'paper-scale')} style={{ transform: `scale(${scale})`, width: PAPER_W }}>
            <div ref={paperRef}>
              <TemplateEngine invoice={invoice} sender={sender} totals={invoice.totals} templateId={invoice.template_id} design={design} pageRule />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
