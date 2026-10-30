import { useState } from 'react';
import {
  BellRing,
  Camera,
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
import { Menu, type MenuItem } from '../ui/Menu';
import { cn } from '../../lib/utils';
import { emailText, invoiceSummaryText, invoiceUpiLink, mailtoLink, smsLink, whatsappLink } from '../../lib/share';
import controls from '../../styles/controls.module.css';
import styles from './share.module.css';
import { copyText, openLink } from './clipboard';
import { ReminderModal } from './ReminderModal';
import { receivableBalance } from '../../lib/rcm';
import { useT } from '../../i18n';
import { shareT } from '../../i18n/areas/share';
import { rPosT } from '../../i18n/areas/restaurant-pos';

export interface ShareMenuProps {
  invoice: InvoiceRecord;
  onDownloadPdf?: () => void;
  /** Share the PDF file through the OS share sheet (only passed where the browser supports it). */
  onSharePdf?: () => void;
  /** R3-A5: share the rendered paper as an image (JPG / PNG); copy it to the clipboard where supported. */
  onShareImage?: () => void;
  onCopyImage?: () => void;
  /** Send a self-contained HTML copy with a pay button (the preview supplies it). */
  onClientCopy?: () => void;
  /** Hide the "Payment reminder" entry (e.g. for quotations). */
  hideReminder?: boolean;
  className?: string;
}

export function ShareMenu({ invoice, onDownloadPdf, onSharePdf, onShareImage, onCopyImage, onClientCopy, hideReminder, className }: ShareMenuProps) {
  useT(); // re-render on a language switch (5.4)
  const [reminderOpen, setReminderOpen] = useState(false);
  const { notify, toastNode } = useToast();

  const summary = invoiceSummaryText(invoice);
  const payLink = invoiceUpiLink(invoice);
  const client = invoice.client;
  const unpaid = receivableBalance(invoice) > 0 && invoice.status !== 'Paid' && invoice.status !== 'Cancelled';
  const subject = `${invoice.invoice_number} from ${invoice.sender?.companyName || 'us'}`;

  const copy = (text: string, done: string) => async () => {
    const ok = await copyText(text);
    notify(ok ? done : shareT('copyFailed'), ok ? 'success' : 'error');
  };

  const items: MenuItem[] = [];
  const add = (item: MenuItem | false | undefined | null) => item && items.push(item);
  add(onSharePdf && { icon: <FileText size={16} />, label: shareT('sharePdf'), hint: shareT('sharePdfHint'), onSelect: onSharePdf });
  add(onShareImage && { icon: <Camera size={16} />, label: rPosT('shareImage'), hint: rPosT('imageHint'), onSelect: onShareImage, attrs: { 'data-share-image': true } });
  add(onShareImage && onCopyImage && { icon: <Copy size={16} />, label: rPosT('copyImage'), onSelect: onCopyImage });
  const sendGroup = items.length > 0;
  add({ icon: <MessageCircle size={16} />, label: 'WhatsApp', onSelect: () => openLink(whatsappLink(client?.phone, summary)), separator: sendGroup });
  add({ icon: <Mail size={16} />, label: shareT('email'), onSelect: () => openLink(mailtoLink({ to: client?.email, subject, body: emailText(summary) })) });
  add({ icon: <MessageSquare size={16} />, label: 'SMS', onSelect: () => openLink(smsLink(client?.phone, summary)) });
  add({ icon: <Copy size={16} />, label: shareT('copyMessage'), onSelect: copy(summary, shareT('copied')), separator: true });
  add({
    icon: <Link2 size={16} />,
    label: shareT('copyLink'),
    hint: payLink ? undefined : shareT('noUpi'),
    disabled: !payLink,
    title: payLink ? undefined : shareT('noUpiTitle'),
    onSelect: copy(payLink ?? '', shareT('linkCopied')),
  });
  add(onClientCopy && { icon: <Globe size={16} />, label: shareT('clientCopy'), hint: shareT('clientCopyHint'), onSelect: onClientCopy });
  add(onDownloadPdf && { icon: <Download size={16} />, label: shareT('downloadPdf'), onSelect: onDownloadPdf });
  add(!hideReminder && unpaid && { icon: <BellRing size={16} />, label: shareT('reminder'), onSelect: () => setReminderOpen(true), separator: true });

  return (
    <div className={cn(styles.menuWrap, className)}>
      <Menu
        label={shareT('menu')}
        items={items}
        triggerClassName={controls.btnOutline}
        trigger={<><Share2 size={16} /> {shareT('share')} <ChevronDown size={14} aria-hidden="true" /></>}
      />

      {reminderOpen && (
        <ReminderModal invoice={invoice} open onClose={() => setReminderOpen(false)} />
      )}
      {toastNode}
    </div>
  );
}
