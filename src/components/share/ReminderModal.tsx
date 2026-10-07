import { useMemo, useState } from 'react';
import { BellOff, Copy, Mail, MessageCircle, MessageSquare } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import type { InvoiceRecord } from '../../types/invoice';
import {
  STAGE_LABELS,
  STAGE_ORDER,
  buildReminder,
  lastReminder,
  remindersFor,
  suggestStage,
  type ReminderChannel,
  type ReminderLanguage,
  type ReminderRecord,
  type ReminderStage,
} from '../../lib/reminders';
import { isValidEmail, mailtoLink, normalizePhone, smsLink, whatsappLink } from '../../lib/share';
import { formatCurrency, formatDate } from '../../lib/utils';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './share.module.css';
import { copyText, openLink } from './clipboard';
import { useReminderLog } from './useReminderLog';

export interface ReminderModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  /** Called after a reminder (or snooze) was logged. */
  onSent?: (entry: ReminderRecord) => void;
}

type Composer = 'whatsapp' | 'email' | 'sms';

const COMPOSERS: { id: Composer; label: string; icon: typeof Mail }[] = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'sms', label: 'SMS', icon: MessageSquare },
];

export function ReminderModal({ invoice, open, onClose, onSent }: ReminderModalProps) {
  if (!open) return null;
  return <ReminderModalBody invoice={invoice} onClose={onClose} onSent={onSent} />;
}

function ReminderModalBody({
  invoice,
  onClose,
  onSent,
}: Omit<ReminderModalProps, 'open'>) {
  const { notify, toastNode } = useToast();
  const { log, record, snooze } = useReminderLog();

  const [channel, setChannel] = useState<Composer>(() =>
    normalizePhone(invoice.client?.phone) || !isValidEmail(invoice.client?.email) ? 'whatsapp' : 'email',
  );
  const [stage, setStage] = useState<ReminderStage>(() => suggestStage(invoice));
  const [lang, setLang] = useState<ReminderLanguage>('en');
  const [message, setMessage] = useState(() => buildReminder(invoice, suggestStage(invoice), 'en'));
  const [phone, setPhone] = useState(invoice.client?.phone ?? '');
  const [email, setEmail] = useState(invoice.client?.email ?? '');

  const history = useMemo(
    () => remindersFor(log, invoice.id).sort((a, b) => b.sent_at.localeCompare(a.sent_at)),
    [log, invoice.id],
  );
  const last = lastReminder(log, invoice.id);

  const regenerate = (nextStage: ReminderStage, nextLang: ReminderLanguage) => {
    setStage(nextStage);
    setLang(nextLang);
    setMessage(buildReminder(invoice, nextStage, nextLang));
  };

  const cur = invoice.currency || 'INR';
  const phoneOk = !!normalizePhone(phone);
  const emailOk = isValidEmail(email);

  const finish = (entry: ReminderRecord | null, text: string) => {
    if (!entry) return;
    notify(text);
    onSent?.(entry);
  };

  const logAndRun = (ch: ReminderChannel, run: () => void, doneText: string) => {
    try {
      const entry = record(invoice.id, ch, stage);
      run();
      finish(entry, doneText);
    } catch (err) {
      notify((err as Error).message || 'Could not log the reminder.', 'error');
    }
  };

  const send = () => {
    if (channel === 'whatsapp') {
      logAndRun('whatsapp', () => openLink(whatsappLink(phone, message.body)), 'Opened WhatsApp. Reminder logged.');
    } else if (channel === 'email') {
      logAndRun(
        'email',
        () => openLink(mailtoLink({ to: email, subject: message.subject, body: message.body })),
        'Opened your email app. Reminder logged.',
      );
    } else {
      logAndRun('sms', () => openLink(smsLink(phone, message.body)), 'Opened SMS. Reminder logged.');
    }
  };

  const copy = async () => {
    const text = channel === 'email' ? `${message.subject}\n\n${message.body}` : message.body;
    if (await copyText(text)) logAndRun('copy', () => undefined, 'Message copied. Reminder logged.');
    else notify('Could not copy. Select the text and copy it manually.', 'error');
  };

  const doSnooze = (days: number) => {
    try {
      const entry = snooze(invoice.id, days);
      finish(entry, `Snoozed for ${days} days.`);
      onClose();
    } catch (err) {
      notify((err as Error).message || 'Could not snooze.', 'error');
    }
  };

  const sendLabel =
    channel === 'whatsapp' ? 'Open in WhatsApp' : channel === 'email' ? 'Open in Email' : 'Open in SMS';
  const recipientBad = channel === 'email' ? !emailOk : !phoneOk;
  const smsLong = channel === 'sms' && message.body.length > 320;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title="Payment reminder"
        subtitle="Nothing is sent by this app. It opens your own WhatsApp, email or SMS app with the message filled in."
        footer={
          <div className={styles.footActions}>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => doSnooze(3)}>
              <BellOff size={15} /> Snooze 3 days
            </button>
            <button type="button" className={controls.btnOutline} onClick={copy}>
              <Copy size={15} /> Copy
            </button>
            <button type="button" className={controls.btnPrimary} onClick={send} disabled={recipientBad}>
              {sendLabel}
            </button>
          </div>
        }
      >
        <div className={styles.stack}>
          <div className={styles.summaryLine}>
            <span><strong>{invoice.client?.name || 'Client'}</strong></span>
            <span>{invoice.invoice_number}</span>
            <span>Balance <strong>{formatCurrency(invoice.balance_due, cur)}</strong></span>
            <span>Due {formatDate(invoice.due_date)}</span>
            {last && <span>Last reminded {formatDate(last.sent_at)} ({history.length}x)</span>}
          </div>

          <div className={controls.field}>
            <span className={controls.label} id="rm-stage">Tone</span>
            <div className={styles.chips} role="group" aria-labelledby="rm-stage">
              {STAGE_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === stage ? styles.chipActive : styles.chip}
                  aria-pressed={s === stage}
                  onClick={() => regenerate(s, lang)}
                >
                  {STAGE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className={controls.row}>
            <div className={controls.field}>
              <span className={controls.label}>Channel</span>
              <div className={controls.segment} role="group" aria-label="Channel">
                {COMPOSERS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={channel === id ? controls.segmentBtnActive : controls.segmentBtn}
                    aria-pressed={channel === id}
                    onClick={() => setChannel(id)}
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={controls.field}>
              <span className={controls.label}>Language</span>
              <div className={controls.segment} role="group" aria-label="Language">
                <button
                  type="button"
                  className={lang === 'en' ? controls.segmentBtnActive : controls.segmentBtn}
                  aria-pressed={lang === 'en'}
                  onClick={() => regenerate(stage, 'en')}
                >
                  English
                </button>
                <button
                  type="button"
                  className={lang === 'hinglish' ? controls.segmentBtnActive : controls.segmentBtn}
                  aria-pressed={lang === 'hinglish'}
                  onClick={() => regenerate(stage, 'hinglish')}
                >
                  Hinglish
                </button>
              </div>
            </div>
          </div>

          {channel === 'email' ? (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rm-email">Send to (email)</label>
              <input
                id="rm-email"
                type="email"
                className={cn(controls.input, !emailOk && email && controls.inputInvalid)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                autoComplete="off"
              />
              {!emailOk && <span className={controls.hint}>Add the client's email to open your mail app.</span>}
            </div>
          ) : (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rm-phone">Send to (mobile)</label>
              <input
                id="rm-phone"
                type="tel"
                inputMode="tel"
                className={cn(controls.input, !phoneOk && phone && controls.inputInvalid)}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                autoComplete="off"
              />
              <span className={controls.hint}>
                {phoneOk ? `Will use +${normalizePhone(phone)}. ` : 'Enter a valid number. '}
                10-digit numbers default to +91.
              </span>
            </div>
          )}

          {channel === 'email' && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rm-subject">Subject</label>
              <input
                id="rm-subject"
                className={controls.input}
                value={message.subject}
                onChange={(e) => setMessage((m) => ({ ...m, subject: e.target.value }))}
              />
            </div>
          )}

          <div className={controls.field}>
            <label className={controls.label} htmlFor="rm-body">Message (editable)</label>
            <textarea
              id="rm-body"
              className={cn(controls.textarea, styles.messageArea)}
              value={message.body}
              onChange={(e) => setMessage((m) => ({ ...m, body: e.target.value }))}
            />
            <div className={cn(styles.counter, smsLong && styles.counterWarn)}>
              {message.body.length} characters{smsLong ? ' (long for SMS, may be split)' : ''}
            </div>
          </div>

          {history.length > 0 && (
            <div className={controls.field}>
              <span className={controls.label}>Previous reminders</span>
              <ul className={styles.history}>
                {history.slice(0, 5).map((h) => (
                  <li key={h.id}>
                    {formatDate(h.sent_at)} · {h.channel} · {STAGE_LABELS[h.tone]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
      {toastNode}
    </>
  );
}
