import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Loader2, Palette, Printer, X } from 'lucide-react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb, blankProfile } from '../../lib/localDb';
import { TEMPLATES, templateById } from '../templates/registry';
import { TemplateEngine } from '../templates/TemplateEngine';
import { ShareMenu } from '../share';
import { pageSlices, paperSize, resolve as resolveDesign } from '../../lib/design-prefs';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../types/invoice';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './InvoicePreview.module.css';


interface InvoicePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Full-screen, scale-to-fit A4 preview with print and multi-page PDF export. */
export const InvoicePreviewModal = ({ isOpen, onClose }: InvoicePreviewModalProps) => {
  const invoice = useInvoiceStore();
  const paperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
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
    setScale(Math.min(1, Math.max(0.3, available / PAPER_W)));
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const idx = Math.max(0, TEMPLATES.findIndex((t) => t.id === invoice.template_id));
  const meta = templateById(invoice.template_id);
  const step = (dir: -1 | 1) => invoice.setTemplate(TEMPLATES[(idx + dir + TEMPLATES.length) % TEMPLATES.length].id);

  const handleExportPDF = async () => {
    if (!paperRef.current || busy) return;
    setBusy(true);
    setError('');
    try {
      // Loaded on demand — the PDF stack is ~200 KB gzipped and most sessions never export.
      const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
      const node = paperRef.current;
      const height = Math.max(node.offsetHeight, PAPER_H);
      const dataUrl = await toPng(node, {
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
        pdf.addImage(dataUrl, 'PNG', 0, -page * pageHmm, pageWmm, imgHmm);
      });
      const safe = (invoice.invoice_number || 'draft').replace(/[\\/:*?"<>|]+/g, '-');
      pdf.save(`${DOCUMENT_LABELS[invoice.doc_type].replace(/\s+/g, '_')}_${safe}.pdf`);
    } catch (err) {
      console.error('PDF export failed', err);
      setError('Could not create the PDF. Try Print → Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={cn(styles.overlay, 'print-host')} role="dialog" aria-modal="true" aria-label="Document preview">
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

        <div className={styles.actions}>
          <Link to="/design" className={controls.btnIcon} onClick={onClose} aria-label="Customise design" title="Customise design">
            <Palette size={18} />
          </Link>
          {invoice.id && (
            <ShareMenu invoice={invoice as unknown as InvoiceRecord} onDownloadPdf={handleExportPDF} />
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
