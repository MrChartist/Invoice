import { useMemo, useState } from 'react';
import { CheckCircle2, FilePlus2, IndianRupee, Mail, MessageCircle, Printer, Share2 } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { emailText, invoiceUpiLink, mailtoLink, normalizePhone, whatsappLink } from '../../lib/share';
import { partyOutstanding, sendMessage, sheetMessage, sheetState } from '../../lib/send-summary';
import { can } from '../../lib/access';
import { cn, formatCurrency } from '../../lib/utils';
import { DOCUMENT_LABELS } from '../../types/invoice';
import { ShareMenu } from '../share';
import { Modal } from '../ui/Modal';
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
 * PDF, Print, ₹ Record payment (balance due) and New. Stays until dismissed or Esc; the one Modal
 * sheet (a bottom sheet on phones). The message carries the bill's balance, the party's whole outstanding and the next instalment.
 */
export function SendSheet({ invoiceId, onClose, onPreview, onRecordPayment, onNew }: SendSheetProps) {
  useT();
  const inv = useMemo(() => localDb.invoices.getById(invoiceId), [invoiceId]);
  const outstanding = useMemo(() => (inv ? partyOutstanding(localDb.invoices.getAll(), inv.client) : { total: 0, bills: 0 }), [inv]);
  const [phone, setPhone] = useState('');
  if (!inv) return null;
  const label = DOCUMENT_LABELS[inv.doc_type] ?? 'Invoice';
  // QA-3 F3: a quotation / proforma / order / challan shows no balance and offers no payment.
  const { balance, canPay, hint } = sheetState(inv);
  const text = sheetMessage(sendMessage(inv, outstanding), balance > 0 ? invoiceUpiLink(inv) : null);
  const clientPhone = inv.client?.phone || '';
  const waPhone = clientPhone || phone;
  const waReady = !!normalizePhone(waPhone) || !clientPhone;
  const big = cn(controls.btnOutline, ux.bigBtn);

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={<><CheckCircle2 size={22} className={ux.good} aria-hidden="true" />{uxT('ssTitle', { doc: label, number: inv.invoice_number })}</>}
      subtitle={<>{inv.client?.name} · {formatCurrency(inv.total, inv.currency)}{balance > 0 ? ` · ${uxT('ssBalance')} ${formatCurrency(balance, inv.currency)}` : ''}</>}
      dialogProps={{ 'data-send-sheet': true }}
    >
      {outstanding.bills > 1 && <p className={ux.muted}>{uxT('ssOutstanding', { n: outstanding.bills })}: <strong>{formatCurrency(outstanding.total, 'INR')}</strong></p>}
      {!clientPhone && (
        <label className={controls.field}>
          <span className={controls.label}>{uxT('ssPhone')}</span>
          <input className={controls.input} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" data-send-phone />
        </label>
      )}
      <div className={ux.bigGrid}>
        <a className={cn(controls.btnPrimary, ux.bigBtn)} data-autofocus href={whatsappLink(waPhone, text)} target="_blank" rel="noreferrer" aria-disabled={!waReady} data-send-whatsapp>
          <MessageCircle size={18} /> {uxT('ssWhatsapp')}
        </a>
        <button type="button" className={big} onClick={() => { onClose(); onPreview('share'); }} data-send-pdf><Share2 size={18} /> {uxT('ssSharePdf')}</button>
        <button type="button" className={big} onClick={() => { onClose(); onPreview('print'); }}><Printer size={18} /> {uxT('ssPrint')}</button>
        {canPay && onRecordPayment && can('payment.record') && (
          <button type="button" className={big} onClick={() => { onClose(); onRecordPayment(); }} data-send-pay><IndianRupee size={18} /> {uxT('ssRecordPay')}</button>
        )}
        {onNew && <button type="button" className={big} onClick={() => { onClose(); onNew(); }}><FilePlus2 size={18} /> {uxT('ssNew')}</button>}
      </div>
      <div className={ux.row}>
        <a className={cn(controls.btnGhost, controls.btnSm)} href={mailtoLink({ to: inv.client?.email, subject: `${label} ${inv.invoice_number}`, body: emailText(text) })}>
          <Mail size={14} /> {uxT('ssEmail')}
        </a>
        <ShareMenu invoice={inv} hideReminder={inv.doc_type === 'QUOTATION'} />
      </div>
      {hint && <p className={ux.kbdHint}>{uxT(hint === 'instalment' ? 'ssHint' : 'ssHintBalance')}</p>}
    </Modal>
  );
}

export default SendSheet;
