import { useEffect, useId, useRef, useState } from 'react';
import {
  BellRing,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Globe,
  Link2,
  Mail,
  MessageCircle,
  MessageSquare,
  Share2,
} from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import { useToast } from '../ui/useToast';
import { cn } from '../../lib/utils';
import { invoiceSummaryText, invoiceUpiLink, mailtoLink, smsLink, whatsappLink } from '../../lib/share';
import controls from '../../styles/controls.module.css';
import styles from './share.module.css';
import { copyText, openLink } from './clipboard';
import { ReminderModal } from './ReminderModal';
import { receivableBalance } from '../../lib/rcm';
import { useT } from '../../i18n';
import { shareT } from '../../i18n/areas/share';

export interface ShareMenuProps {
  invoice: InvoiceRecord;
  onDownloadPdf?: () => void;
  /** Share the PDF file through the OS share sheet (only passed where the browser supports it). */
  onSharePdf?: () => void;
  /** Send a self-contained HTML copy with a pay button (the preview supplies it). */
  onClientCopy?: () => void;
  /** Hide the "Payment reminder" entry (e.g. for quotations). */
  hideReminder?: boolean;
  className?: string;
}

export function ShareMenu({ invoice, onDownloadPdf, onSharePdf, onClientCopy, hideReminder, className }: ShareMenuProps) {
  useT(); // re-render on a language switch (5.4)
  const [open, setOpen] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { notify, toastNode } = useToast();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrapRef.current?.querySelector<HTMLElement>('button')?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(
          wrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
        );
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    wrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const summary = invoiceSummaryText(invoice);
  const payLink = invoiceUpiLink(invoice);
  const client = invoice.client;
  const unpaid = receivableBalance(invoice) > 0 && invoice.status !== 'Paid' && invoice.status !== 'Cancelled';
  const subject = `${invoice.invoice_number} from ${invoice.sender?.companyName || 'us'}`;

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const copy = (text: string, done: string) => async () => {
    setOpen(false);
    const ok = await copyText(text);
    notify(ok ? done : shareT('copyFailed'), ok ? 'success' : 'error');
  };

  return (
    <div className={cn(styles.menuWrap, className)} ref={wrapRef}>
      <button
        type="button"
        className={controls.btnOutline}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Share2 size={16} /> {shareT('share')} <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} role="menu" id={menuId} aria-label={shareT('menu')}>
          {onSharePdf && (
            <>
              <button type="button" role="menuitem" className={styles.menuItem} onClick={run(onSharePdf)}>
                <FileText size={16} className={styles.menuIcon} /> {shareT('sharePdf')}
                <span className={styles.menuHint}>{shareT('sharePdfHint')}</span>
              </button>
              <div className={styles.menuSep} role="separator" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={run(() => openLink(whatsappLink(client?.phone, summary)))}
          >
            <MessageCircle size={16} className={styles.menuIcon} /> WhatsApp
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={run(() => openLink(mailtoLink({ to: client?.email, subject, body: summary })))}
          >
            <Mail size={16} className={styles.menuIcon} /> {shareT('email')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={run(() => openLink(smsLink(client?.phone, summary)))}
          >
            <MessageSquare size={16} className={styles.menuIcon} /> SMS
          </button>
          <div className={styles.menuSep} role="separator" />
          <button type="button" role="menuitem" className={styles.menuItem} onClick={copy(summary, shareT('copied'))}>
            <Copy size={16} className={styles.menuIcon} /> {shareT('copyMessage')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={!payLink}
            title={payLink ? undefined : shareT('noUpiTitle')}
            onClick={copy(payLink ?? '', shareT('linkCopied'))}
          >
            <Link2 size={16} className={styles.menuIcon} /> {shareT('copyLink')}
            {!payLink && <span className={styles.menuHint}>{shareT('noUpi')}</span>}
          </button>
          {onClientCopy && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={run(onClientCopy)}>
              <Globe size={16} className={styles.menuIcon} /> {shareT('clientCopy')}
              <span className={styles.menuHint}>{shareT('clientCopyHint')}</span>
            </button>
          )}
          {onDownloadPdf && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={run(onDownloadPdf)}>
              <Download size={16} className={styles.menuIcon} /> {shareT('downloadPdf')}
            </button>
          )}
          {!hideReminder && unpaid && (
            <>
              <div className={styles.menuSep} role="separator" />
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={run(() => setReminderOpen(true))}
              >
                <BellRing size={16} className={styles.menuIcon} /> {shareT('reminder')}
              </button>
            </>
          )}
        </div>
      )}

      {reminderOpen && (
        <ReminderModal invoice={invoice} open onClose={() => setReminderOpen(false)} />
      )}
      {toastNode}
    </div>
  );
}
