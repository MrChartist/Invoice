import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, FilePlus2, IndianRupee, Mail, MessageCircle, Printer, Share2, X } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { invoiceUpiLink, mailtoLink, normalizePhone, whatsappLink } from '../../lib/share';
import { partyOutstanding, sendMessage, sheetMessage } from '../../lib/send-summary';
import { receivableBalance } from '../../lib/rcm';
import { can } from '../../lib/access';
import { cn, formatCurrency } from '../../lib/utils';
import { DOCUMENT_LABELS } from '../../types/invoice';
import { ShareMenu } from '../share';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import ux from './ux.module.css';

export interface SendSheetProps {
  invoiceId: string;
  onClose: () => void;
  /** Open the preview, optionally running Print / Share PDF once it has rendered. */
  onPreview: (action?: 'print' | 'share') => void;
  onRecordPayment?: () => void;
  onNew?: () => void;
}

/**
 * A1 / 8.105 post-save success sheet (replaces the 10-second toast after an issued save): ✓ number,
 * client and total; big WhatsApp (summary + UPI link; a phone field when the client has none), Share
 * PDF, Print, ₹ Record payment (balance due) and New. Stays until dismissed or Esc; a bottom sheet on
 * phones. The message carries the bill's balance, the party's whole outstanding and the next instalment.
 */
export function SendSheet({ invoiceId, onClose, onPreview, onRecordPayment, onNew }: SendSheetProps) {
  useT();
  const inv = useMemo(() => localDb.invoices.getById(invoiceId), [invoiceId]);
  const outstanding = useMemo(() => (inv ? partyOutstanding(localDb.invoices.getAll(), inv.client) : { total: 0, bills: 0 }), [inv]);
  const [phone, setPhone] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    panel.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  if (!inv) return null;
  const label = DOCUMENT_LABELS[inv.doc_type] ?? 'Invoice';
  const balance = Math.max(receivableBalance(inv), 0);
  const text = sheetMessage(sendMessage(inv, outstanding), balance > 0 ? invoiceUpiLink(inv) : null);
  const clientPhone = inv.client?.phone || '';
  const waPhone = clientPhone || phone;
  const waReady = !!normalizePhone(waPhone) || !clientPhone;
  const big = cn(controls.btnOutline, ux.bigBtn);

  return createPortal(
    <div className={cn(ux.sheetBackdrop, 'no-print')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className={ux.sheetPanel} role="dialog" aria-modal="true" aria-labelledby="send-sheet-title" data-send-sheet>
        <div className={ux.row}>
          <CheckCircle2 size={22} className={ux.good} aria-hidden="true" />
          <div className={ux.grow}>
            <strong id="send-sheet-title">{uxT('ssTitle', { doc: label, number: inv.invoice_number })}</strong>
            <div className={ux.muted}>{inv.client?.name} · {formatCurrency(inv.total, inv.currency)}{balance > 0 ? ` · ${uxT('ssBalance')} ${formatCurrency(balance, inv.currency)}` : ''}</div>
          </div>
          <button type="button" className={controls.btnIcon} onClick={onClose} aria-label={uxT('ssClose')}><X size={16} /></button>
        </div>
        {outstanding.bills > 1 && <p className={ux.muted}>{uxT('ssOutstanding', { n: outstanding.bills })}: <strong>{formatCurrency(outstanding.total, 'INR')}</strong></p>}
        {!clientPhone && (
          <label className={controls.field}>
            <span className={controls.label}>{uxT('ssPhone')}</span>
            <input className={controls.input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" data-send-phone />
          </label>
        )}
        <div className={ux.bigGrid}>
          <a className={cn(controls.btnPrimary, ux.bigBtn)} href={whatsappLink(waPhone, text)} target="_blank" rel="noreferrer" aria-disabled={!waReady} data-send-whatsapp>
            <MessageCircle size={18} /> {uxT('ssWhatsapp')}
          </a>
          <button type="button" className={big} onClick={() => { onClose(); onPreview('share'); }} data-send-pdf><Share2 size={18} /> {uxT('ssSharePdf')}</button>
          <button type="button" className={big} onClick={() => { onClose(); onPreview('print'); }}><Printer size={18} /> {uxT('ssPrint')}</button>
          {balance > 0 && onRecordPayment && can('payment.record') && (
            <button type="button" className={big} onClick={() => { onClose(); onRecordPayment(); }} data-send-pay><IndianRupee size={18} /> {uxT('ssRecordPay')}</button>
          )}
          {onNew && <button type="button" className={big} onClick={() => { onClose(); onNew(); }}><FilePlus2 size={18} /> {uxT('ssNew')}</button>}
        </div>
        <div className={ux.row}>
          <a className={cn(controls.btnGhost, controls.btnSm)} href={mailtoLink({ to: inv.client?.email, subject: `${label} ${inv.invoice_number}`, body: text })}>
            <Mail size={14} /> {uxT('ssEmail')}
          </a>
          <ShareMenu invoice={inv} hideReminder={inv.doc_type === 'QUOTATION'} />
        </div>
        <p className={ux.kbdHint}>{uxT('ssHint')}</p>
      </div>
    </div>,
    document.body,
  );
}

export default SendSheet;
