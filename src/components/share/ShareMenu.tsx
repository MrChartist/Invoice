import { useEffect, useId, useRef, useState } from 'react';
import {
  BellRing,
  ChevronDown,
  Copy,
  Download,
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

export interface ShareMenuProps {
  invoice: InvoiceRecord;
  onDownloadPdf?: () => void;
  /** Hide the "Payment reminder" entry (e.g. for quotations). */
  hideReminder?: boolean;
  className?: string;
}

export function ShareMenu({ invoice, onDownloadPdf, hideReminder, className }: ShareMenuProps) {
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
  const unpaid = invoice.balance_due > 0 && invoice.status !== 'Paid' && invoice.status !== 'Cancelled';
  const subject = `${invoice.invoice_number} from ${invoice.sender?.companyName || 'us'}`;

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const copy = (text: string, done: string) => async () => {
    setOpen(false);
    const ok = await copyText(text);
    notify(ok ? done : 'Could not copy to the clipboard.', ok ? 'success' : 'error');
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
        <Share2 size={16} /> Share <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} role="menu" id={menuId} aria-label="Share invoice">
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
            <Mail size={16} className={styles.menuIcon} /> Email
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
          <button type="button" role="menuitem" className={styles.menuItem} onClick={copy(summary, 'Message copied.')}>
            <Copy size={16} className={styles.menuIcon} /> Copy message
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={!payLink}
            title={payLink ? undefined : 'Add a UPI ID to the sender profile (INR invoices only)'}
            onClick={copy(payLink ?? '', 'Payment link copied.')}
          >
            <Link2 size={16} className={styles.menuIcon} /> Copy payment link
            {!payLink && <span className={styles.menuHint}>no UPI</span>}
          </button>
          {onDownloadPdf && (
            <button type="button" role="menuitem" className={styles.menuItem} onClick={run(onDownloadPdf)}>
              <Download size={16} className={styles.menuIcon} /> Download PDF
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
                <BellRing size={16} className={styles.menuIcon} /> Payment reminder
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
