import { useMemo, useState } from 'react';
import { BellOff, Copy, Mail, MessageCircle, MessageSquare } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import type { InvoiceRecord } from '../../types/invoice';
import {
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
import { interestForReminder } from '../../lib/interest';
import { isValidEmail, mailtoLink, normalizePhone, smsLink, whatsappLink } from '../../lib/share';
import { formatCurrency, formatDate } from '../../lib/utils';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './share.module.css';
import { copyText, openLink } from './clipboard';
import { useReminderLog } from './useReminderLog';
import { receivableBalance } from '../../lib/rcm';
import { useT } from '../../i18n';
import { shareT } from '../../i18n/areas/share';
import { remindT } from '../../i18n/areas/reminders';
import { areaNodes } from '../../i18n/areas/nodes';

export interface ReminderModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
  /** Called after a reminder (or snooze) was logged. */
  onSent?: (entry: ReminderRecord) => void;
}

type Composer = 'whatsapp' | 'email' | 'sms';

const CHANNEL_KEYS: Record<ReminderChannel, true> = { whatsapp: true, email: true, sms: true, copy: true, snooze: true };

const COMPOSERS: { id: Composer; icon: typeof Mail }[] = [
  { id: 'whatsapp', icon: MessageCircle },
  { id: 'email', icon: Mail },
  { id: 'sms', icon: MessageSquare },
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
  useT(); // re-render on a language switch (5.4)
  const { notify, toastNode } = useToast();
  const { log, record, snooze } = useReminderLog();

  const [channel, setChannel] = useState<Composer>(() =>
    normalizePhone(invoice.client?.phone) || !isValidEmail(invoice.client?.email) ? 'whatsapp' : 'email',
  );
  const [stage, setStage] = useState<ReminderStage>(() => suggestStage(invoice));
  const [lang, setLang] = useState<ReminderLanguage>('en');
  const [message, setMessage] = useState(() =>
    buildReminder(invoice, suggestStage(invoice), 'en', new Date(), { interestAccrued: interestForReminder(invoice) }),
  );
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
    setMessage(
      buildReminder(invoice, nextStage, nextLang, new Date(), { interestAccrued: interestForReminder(invoice) }),
    );
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
      notify((err as Error).message || shareT('rmLogFailed'), 'error');
    }
  };

  const send = () => {
    if (channel === 'whatsapp') {
      logAndRun('whatsapp', () => openLink(whatsappLink(phone, message.body)), shareT('rmOpenedWa'));
    } else if (channel === 'email') {
      logAndRun(
        'email',
        () => openLink(mailtoLink({ to: email, subject: message.subject, body: message.body })),
        shareT('rmOpenedEmail'),
      );
    } else {
      logAndRun('sms', () => openLink(smsLink(phone, message.body)), shareT('rmOpenedSms'));
    }
  };

  const copy = async () => {
    const text = channel === 'email' ? `${message.subject}\n\n${message.body}` : message.body;
    if (await copyText(text)) logAndRun('copy', () => undefined, shareT('rmCopied'));
    else notify(shareT('rmCopyFailed'), 'error');
  };

  const doSnooze = (days: number) => {
    try {
      const entry = snooze(invoice.id, days);
      finish(entry, shareT('rmSnoozed', { n: days }));
      onClose();
    } catch (err) {
      notify((err as Error).message || shareT('rmSnoozeFailed'), 'error');
    }
  };

  const sendLabel =
    channel === 'whatsapp' ? shareT('rmOpenWa') : channel === 'email' ? shareT('rmOpenEmail') : shareT('rmOpenSms');
  const recipientBad = channel === 'email' ? !emailOk : !phoneOk;
  const smsLong = channel === 'sms' && message.body.length > 320;

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="lg"
        title={shareT('reminder')}
        subtitle={shareT('rmSub')}
        footer={
          <div className={styles.footActions}>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => doSnooze(3)}>
              <BellOff size={15} /> {shareT('rmSnooze3')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={copy}>
              <Copy size={15} /> {shareT('rmCopy')}
            </button>
            <button type="button" className={controls.btnPrimary} onClick={send} disabled={recipientBad}>
              {sendLabel}
            </button>
          </div>
        }
      >
        <div className={styles.stack}>
          <div className={styles.summaryLine}>
            <span><strong>{invoice.client?.name || shareT('rmClient')}</strong></span>
            <span>{invoice.invoice_number}</span>
            <span>{areaNodes(shareT('rmBalance'), { amount: <strong>{formatCurrency(receivableBalance(invoice), cur)}</strong> })}</span>
            <span>{shareT('rmDue', { date: formatDate(invoice.due_date) })}</span>
            {last && <span>{shareT('rmLast', { date: formatDate(last.sent_at), n: history.length })}</span>}
          </div>

          <div className={controls.field}>
            <span className={controls.label} id="rm-stage">{shareT('rmTone')}</span>
            <div className={styles.chips} role="group" aria-labelledby="rm-stage">
              {STAGE_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === stage ? styles.chipActive : styles.chip}
                  aria-pressed={s === stage}
                  onClick={() => regenerate(s, lang)}
                >
                  {remindT(`stage.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div className={controls.row}>
            <div className={controls.field}>
              <span className={controls.label}>{shareT('rmChannel')}</span>
              <div className={controls.segment} role="group" aria-label={shareT('rmChannel')}>
                {COMPOSERS.map(({ id, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    className={channel === id ? controls.segmentBtnActive : controls.segmentBtn}
                    aria-pressed={channel === id}
                    onClick={() => setChannel(id)}
                  >
                    <Icon size={14} /> {shareT(`ch.${id}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className={controls.field}>
              <span className={controls.label}>{shareT('rmLanguage')}</span>
              <div className={controls.segment} role="group" aria-label={shareT('rmLanguage')}>
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
              <label className={controls.label} htmlFor="rm-email">{shareT('rmSendEmail')}</label>
              <input
                id="rm-email"
                type="email"
                className={cn(controls.input, !emailOk && email && controls.inputInvalid)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                autoComplete="off"
              />
              {!emailOk && <span className={controls.hint}>{shareT('rmNoEmail')}</span>}
            </div>
          ) : (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rm-phone">{shareT('rmSendMobile')}</label>
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
                {phoneOk ? shareT('rmWillUse', { phone: normalizePhone(phone) ?? '' }) : shareT('rmBadPhone')}
                {shareT('rmPlus91')}
              </span>
            </div>
          )}

          {channel === 'email' && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rm-subject">{shareT('rmSubject')}</label>
              <input
                id="rm-subject"
                className={controls.input}
                value={message.subject}
                onChange={(e) => setMessage((m) => ({ ...m, subject: e.target.value }))}
              />
            </div>
          )}

          <div className={controls.field}>
            <label className={controls.label} htmlFor="rm-body">{shareT('rmMessage')}</label>
            <textarea
              id="rm-body"
              className={cn(controls.textarea, styles.messageArea)}
              value={message.body}
              onChange={(e) => setMessage((m) => ({ ...m, body: e.target.value }))}
            />
            <div className={cn(styles.counter, smsLong && styles.counterWarn)}>
              {shareT('rmChars', { n: message.body.length })}{smsLong ? shareT('rmLong') : ''}
            </div>
          </div>

          {history.length > 0 && (
            <div className={controls.field}>
              <span className={controls.label}>{shareT('rmHistory')}</span>
              <ul className={styles.history}>
                {history.slice(0, 5).map((h) => (
                  <li key={h.id}>
                    {formatDate(h.sent_at)} · {h.channel in CHANNEL_KEYS ? shareT(`ch.${h.channel}`) : h.channel} · {remindT(`stage.${h.tone}`)}
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
