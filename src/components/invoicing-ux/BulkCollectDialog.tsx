import { useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import { buildReminder, suggestStage } from '../../lib/reminders';
import { whatsappLink } from '../../lib/share';
import { receivableBalance } from '../../lib/rcm';
import { bulkWriteOff, writeOffBlock } from '../../lib/write-off';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import { round2 } from '../../lib/invoice-calc';
import { Modal } from '../ui/Modal';
import { useReminderLog } from '../share/useReminderLog';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import ux from './ux.module.css';

/**
 * 8.106 bulk actions on a filtered list (Transactions / Receivables):
 *  - remind: one WhatsApp message per bill (the browser opens one chat per tap), each logged in the
 *    reminders table so the queue and cooldowns know;
 *  - write-off: the open balance of every eligible bill is written off as a bad debt after an explicit
 *    confirmation (typed reason), one payment row each plus one summary audit row (`write-off.ts`).
 */
export function BulkCollectDialog({ mode, invoices, onClose, onDone }: { mode: 'remind' | 'writeoff'; invoices: InvoiceRecord[]; onClose: () => void; onDone: (message: string) => void }) {
  useT();
  const { record } = useReminderLog();
  const [sent, setSent] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayInput());
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const open = useMemo(() => invoices.filter((i) => receivableBalance(i) > 0.004 && i.status !== 'Draft' && i.status !== 'Cancelled'), [invoices]);
  const eligible = useMemo(() => invoices.filter((i) => !writeOffBlock(i)), [invoices]);
  const total = round2(eligible.reduce((s, i) => s + receivableBalance(i), 0));

  if (mode === 'remind') {
    return (
      <Modal open onClose={onClose} title={uxT('bkRemindTitle', { n: open.length })} subtitle={uxT('bkRemindSub')} size="md">
        <ul className={ux.list} data-bulk-remind>
          {open.map((inv) => {
            const stage = suggestStage(inv);
            const msg = buildReminder(inv, stage);
            const done = sent.has(inv.id);
            return (
              <li key={inv.id}>
                <span>{inv.invoice_number} · {inv.client?.name} · {formatCurrency(receivableBalance(inv), inv.currency)}</span>
                <a
                  className={cn(done ? controls.btnGhost : controls.btnOutline, controls.btnSm)}
                  href={whatsappLink(inv.client?.phone, msg.body)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    try {
                      record(inv.id, 'whatsapp', stage, 'bulk');
                    } catch {
                      /* the message still opens */
                    }
                    setSent((s) => new Set(s).add(inv.id));
                  }}
                >
                  <MessageCircle size={14} /> {done ? uxT('bkSent') : uxT('bkSend')}
                </a>
              </li>
            );
          })}
        </ul>
        {open.length === 0 && <p className={ux.muted}>{uxT('bkNothing')}</p>}
        <p className={ux.muted}>{uxT('bkSentCount', { n: sent.size, total: open.length })}</p>
      </Modal>
    );
  }

  const run = () => {
    if (!confirm || !reason.trim()) {
      setError(uxT('bkConfirmNeeded'));
      return;
    }
    try {
      const r = bulkWriteOff(eligible.map((i) => i.id), { date, reason: reason.trim() });
      onDone(uxT('bkWoDone', { n: r.done.length, amount: formatCurrency(r.total, 'INR'), skipped: r.skipped.length }));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={uxT('bkWoTitle', { n: eligible.length })}
      subtitle={uxT('bkWoSub', { amount: formatCurrency(total, 'INR') })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{uxT('cancel')}</button>
          <button type="button" className={controls.btnDanger} disabled={!eligible.length} onClick={run} data-bulk-writeoff>{uxT('bkWoConfirm')}</button>
        </>
      }
    >
      <div className={ux.sheet}>
        <label className={controls.field}>
          <span className={controls.label}>{uxT('bkDate')}</span>
          <input type="date" className={controls.input} value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{uxT('bkReason')}</span>
          <input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={uxT('bkReasonPh')} />
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> {uxT('bkConfirm')}
        </label>
        {invoices.length > eligible.length && <p className={ux.muted}>{uxT('bkSkipped', { n: invoices.length - eligible.length })}</p>}
        <p className={ux.warn}>{uxT('bkWoNote')}</p>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

export default BulkCollectDialog;
