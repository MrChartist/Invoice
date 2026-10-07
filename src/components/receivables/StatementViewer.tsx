import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, Loader2, Printer, X } from 'lucide-react';
import { StatementDocument, type StatementDocumentProps } from './StatementDocument';
import { downloadTextFile, exportNodeToPdf, safeFilename } from './exportUtils';
import { statementCsv } from '../../lib/receivables';
import controls from '../../styles/controls.module.css';
import styles from './StatementViewer.module.css';

export interface StatementViewerProps extends StatementDocumentProps {
  open: boolean;
  onClose: () => void;
  onError?: (message: string) => void;
}

/** Full-screen A4 preview of a client statement with Print / PDF / CSV. */
export function StatementViewer({ open, onClose, onError, ...doc }: StatementViewerProps) {
  const paperRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('statement-printing');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('statement-printing');
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const base = `Statement_${safeFilename(doc.party.name)}_${doc.ledger.to || 'all'}`;

  const handlePdf = async () => {
    if (!paperRef.current) return;
    setBusy(true);
    try {
      await exportNodeToPdf(paperRef.current, `${base}.pdf`);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Could not create the PDF.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={`Statement for ${doc.party.name}`}>
      <div className={`${styles.toolbar} no-print`}>
        <span className={styles.title}>Statement preview · A4</span>
        <div className={styles.actions}>
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
            onClick={() => downloadTextFile(`${base}.csv`, statementCsv(doc.ledger))}>
            <FileSpreadsheet size={14} /> CSV
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={handlePdf} disabled={busy}>
            {busy ? <Loader2 size={14} className={styles.spin} /> : <Download size={14} />} PDF
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={onClose} aria-label="Close preview">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className={styles.scroll}>
        <div className={styles.paperShadow}>
          <StatementDocument ref={paperRef} {...doc} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
