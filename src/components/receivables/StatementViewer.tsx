import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileSpreadsheet, Globe, Loader2, MessageCircle, Printer, Share2, X } from 'lucide-react';
import { StatementDocument, type StatementDocumentProps } from './StatementDocument';
import { downloadTextFile, exportNodeToPdf, nodeToPdfBlob, safeFilename } from './exportUtils';
import { statementCsv } from '../../lib/receivables';
import { buildWhatsAppStatement, partyUpiLink } from '../../lib/khata';
import { canShareFiles, shareFile, whatsappLink } from '../../lib/share';
import { buildClientCopyHtml } from '../../lib/client-copy';
import { documentCss, freezePaper } from '../../lib/client-copy-dom';
import { downloadBlob } from '../../lib/download';
import { formatCurrency, formatDate } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { rcvT } from '../../i18n/areas/receivables';
import { khataT } from '../../i18n/areas/khata';
import styles from './StatementViewer.module.css';
import { STATEMENT_STYLES, loadStatementPrefs, saveStatementPrefs, type StatementStyle } from '../../lib/statement-styles';
import { rcv2T as colT } from '../../i18n/areas/collections-rcv';
import { localDayOf } from '../../lib/dates';
import { SelectField } from '../ui/SelectField';

export interface StatementViewerProps extends StatementDocumentProps {
  open: boolean;
  onClose: () => void;
  onError?: (message: string) => void;
  /** PENDING 50: make the statement web page as soon as the viewer opens (from a list row's button). */
  autoWeb?: boolean;
}

/**
 * Full-screen A4 preview of a client statement with Print / PDF / CSV, plus (8.3) one-tap WhatsApp
 * statement text, Share PDF through the OS share sheet (download where files cannot be shared) and a
 * static statement web page with a Pay-with-UPI panel and QR.
 */
export function StatementViewer({ open, onClose, onError, autoWeb, ...doc }: StatementViewerProps) {
  useT(); // re-render on a language switch (5.4)
  const paperRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<File | null>(null);
  // R2-A6: style and ageing strip can be switched here too (remembered on this device).
  const [styleKind, setStyleKind] = useState<StatementStyle>(doc.styleKind ?? loadStatementPrefs().style);
  const [ageingOn, setAgeingOn] = useState<boolean>(doc.ageing ? true : loadStatementPrefs().ageing);
  useEffect(() => {
    if (!open) return;
    setStyleKind(doc.styleKind ?? loadStatementPrefs().style);
    setAgeingOn(doc.ageing ? true : loadStatementPrefs().ageing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const remember = (style: StatementStyle, ageing: boolean) => {
    setStyleKind(style);
    setAgeingOn(ageing);
    saveStatementPrefs({ style, ageing });
  };
  const asOf = doc.ageing?.asOf || doc.ledger.to || localDayOf(new Date());

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

  useEffect(() => {
    if (!open || !autoWeb) return;
    // After the paper (and its QR canvas) has painted: same path as pressing "Web page".
    const t = window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-statement-web]')?.click(), 120);
    return () => window.clearTimeout(t);
  }, [open, autoWeb]);

  if (!open) return null;

  const base = `Statement_${safeFilename(doc.party.name)}_${doc.ledger.to || 'all'}`;
  const inr = (doc.currency ?? 'INR').toUpperCase() === 'INR';
  const waText = inr ? buildWhatsAppStatement({ sender: doc.sender, party: doc.party }) : '';

  const handlePdf = async () => {
    if (!paperRef.current) return;
    setBusy(true);
    try {
      await exportNodeToPdf(paperRef.current, `${base}.pdf`);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : rcvT('pdfFailed'));
    } finally {
      setBusy(false);
    }
  };

  const shareReady = async (file: File) => {
    const result = await shareFile(file, { title: file.name, text: waText || undefined });
    if (result === 'blocked') return setReady(file);
    setReady(null);
    if (result === 'unsupported' || result === 'failed') downloadBlob(file.name, file);
  };

  const handleSharePdf = async () => {
    if (!paperRef.current) return;
    setBusy(true);
    try {
      const blob = await nodeToPdfBlob(paperRef.current);
      await shareReady(new File([blob], `${base}.pdf`, { type: 'application/pdf' }));
    } catch (err) {
      onError?.(err instanceof Error ? err.message : rcvT('pdfFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleWebPage = async () => {
    if (!paperRef.current) return;
    const frozen = freezePaper(paperRef.current);
    const net = doc.party.net;
    const html = buildClientCopyHtml({
      title: `Statement of account – ${doc.party.name}`,
      paperHtml: frozen.html,
      css: documentCss(),
      business: doc.sender?.companyName ?? '',
      pay: inr && net > 0.004
        ? {
            amountText: formatCurrency(net, 'INR'),
            label: 'Balance due',
            ariaLabel: 'Pay this balance',
            upiLink: partyUpiLink(doc.sender, net, doc.party.name),
            upiId: doc.sender?.upiId,
            qrDataUrl: frozen.qrDataUrl,
          }
        : null,
      generatedOn: formatDate(new Date()),
      note: doc.ledger.to ? `Statement up to ${formatDate(doc.ledger.to)}` : undefined,
    });
    const name = `${base}.html`;
    const file = new File([html], name, { type: 'text/html' });
    const result = canShareFiles(file) ? await shareFile(file, { title: name }) : 'unsupported';
    if (result === 'unsupported' || result === 'failed' || result === 'blocked') downloadBlob(name, file);
  };

  const btn = `${controls.btn} ${controls.btnOutline} ${controls.btnSm}`;
  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label={rcvT('svAria', { name: doc.party.name })}>
      <div className={`material ${styles.toolbar} no-print`}>
        <span className={styles.title}>{rcvT('svTitle')}</span>
        <div className={styles.actions}>
          <SelectField className={controls.select} value={styleKind} aria-label={colT('stStyle')} onChange={(e) => remember(e.target.value as StatementStyle, ageingOn)} data-viewer-style>
            {STATEMENT_STYLES.map((st) => <option key={st} value={st}>{colT(`st.${st}`)}</option>)}
          </SelectField>
          <label className={controls.check}>
            <input type="checkbox" checked={ageingOn} onChange={(e) => remember(styleKind, e.target.checked)} />
            {colT('stAgeing')}
          </label>
          {inr && (
            <a className={btn} href={whatsappLink(doc.client?.phone, waText)} target="_blank" rel="noopener noreferrer" data-wa-statement>
              <MessageCircle size={14} /> {khataT('whatsapp')}
            </a>
          )}
          <button type="button" className={btn} onClick={() => (ready ? void shareReady(ready) : void handleSharePdf())} disabled={busy}>
            <Share2 size={14} /> {ready ? khataT('shareNow') : khataT('sharePdf')}
          </button>
          <button type="button" className={btn} onClick={() => void handleWebPage()} data-statement-web>
            <Globe size={14} /> {khataT('webPage')}
          </button>
          <button type="button" className={btn} onClick={() => window.print()}>
            <Printer size={14} /> {rcvT('print')}
          </button>
          <button type="button" className={btn}
            onClick={() => downloadTextFile(`${base}.csv`, statementCsv(doc.ledger))}>
            <FileSpreadsheet size={14} /> CSV
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={handlePdf} disabled={busy}>
            {busy ? <Loader2 size={14} className={styles.spin} /> : <Download size={14} />} PDF
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={onClose} aria-label={rcvT('closePreview')}>
            <X size={16} />
          </button>
        </div>
      </div>
      <div className={styles.scroll}>
        <div className={styles.paperShadow}>
          <StatementDocument ref={paperRef} {...doc} styleKind={styleKind} ageing={ageingOn ? { asOf } : undefined} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
