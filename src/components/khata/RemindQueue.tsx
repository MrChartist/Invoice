import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { BellOff, Copy, MessageCircle, NotebookPen, SkipForward, X } from 'lucide-react';
import { MESSAGE_LANGS, messageLangOf } from '../../lib/message-langs';
import { localDb } from '../../lib/localDb';
import {
  buildPartyReminder, makePartyLogEntry, makePartySnooze, partyReminderQueue, partyStage,
  type PartyReminderKind, type PartyReminderLang,
} from '../../lib/khata';
import { appendReminders, loadKhataReport, loadReminderLog, newId } from '../../lib/khata-actions';
import { whatsappLink } from '../../lib/share';
import { copyText } from '../share/clipboard';
import { formatCurrency, formatDate } from '../../lib/utils';
import { getLanguage, useT } from '../../i18n';
import { khataT } from '../../i18n/areas/khata';
import controls from '../../styles/controls.module.css';
import styles from './khata.module.css';
import { can } from '../../lib/access';
import { loadReminderSchedule } from '../../lib/reminder-settings';
import { loadCollectionNotes, openPromises, receiptsByParty } from '../../lib/collections';
import { localDayOf } from '../../lib/dates';
import { colT } from '../../i18n/areas/collections';
import type { ReminderMode } from '../../types/invoice';
import { SelectField } from '../ui/SelectField';

// R2-A4: "Log follow-up" from the queue (promise to pay / next action), loaded on first use.
const FollowUpDialog = lazy(() => import('../collections/FollowUpDialog'));

export interface RemindQueueProps {
  /** `overdue`: "Remind all overdue". `balance`: the monthly "send everyone their balance". */
  kind: PartyReminderKind;
  onClose: () => void;
  /** After at least one row was logged (so lists can refresh their "last reminded"). */
  onChanged?: () => void;
}

/**
 * Full-screen stepper (8.4): one party per screen, one tap opens its WhatsApp chat with the message
 * and moves on. Skip / snooze 3 days / copy; every open, copy and snooze is logged in the existing
 * `reminders` table with the party key. Browsers only open a new window from a user gesture, so it
 * is honestly one tap per party — nothing is sent automatically.
 */
export function RemindQueue({ kind, onClose, onChanged }: RemindQueueProps) {
  useT();
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const schedule = useMemo(() => loadReminderSchedule(), []);
  const queue = useMemo(() => {
    const { input, report } = loadKhataReport();
    // R2-A4: a party with an open promise to pay is not reminded until the promised date.
    const notes = loadCollectionNotes();
    const heldParties = notes.some((n) => n.promise)
      ? new Set(openPromises(notes, receiptsByParty(input.invoices, input.payments, input.clients ?? []), localDayOf(new Date())).keys())
      : undefined;
    return partyReminderQueue(report, input.clients ?? [], loadReminderLog(), { kind, heldParties });
  }, [kind]);
  const [logging, setLogging] = useState(false);
  const [modes, setModes] = useState<Record<string, ReminderMode | undefined>>({});
  const [index, setIndex] = useState(0);
  const [lang, setLang] = useState<PartyReminderLang>(() => {
    const ui = getLanguage();
    return ui === 'hi' || ui === 'mr' || ui === 'gu' || ui === 'ta' ? ui : 'en';
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [tally, setTally] = useState({ sent: 0, skipped: 0, snoozed: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const item = queue.items[index];
  // 8H: a party with its own message language gets it unless the user picks another for this party.
  const [picked, setPicked] = useState<Record<string, PartyReminderLang>>({});
  const own = item ? messageLangOf(item.client) : undefined;
  const effLang: PartyReminderLang = item ? picked[item.party.key] ?? (own && own !== 'en' ? own : lang) : lang;
  const pick = (l: PartyReminderLang) => {
    setLang(l);
    if (item) setPicked((p) => ({ ...p, [item.party.key]: l }));
  };
  const generated = item ? buildPartyReminder({ party: item.party, sender, kind, lang: effLang }) : null;
  const editKey = item ? `${item.party.key}|${effLang}` : '';
  const body = item ? edits[editKey] ?? generated!.body : '';
  const total = queue.items.length;

  const log = (channel: 'whatsapp' | 'copy') => {
    if (!item) return;
    try {
      appendReminders([makePartyLogEntry(newId(), item.party.key, channel, partyStage(item.party, schedule), new Date(), kind)]);
      onChanged?.();
    } catch {
      /* the log is a convenience; never block the reminder itself */
    }
  };
  const next = (field: 'sent' | 'skipped' | 'snoozed') => {
    setTally((t) => ({ ...t, [field]: t[field] + 1 }));
    setCopied(false);
    setIndex((i) => i + 1);
  };

  const title = kind === 'overdue' ? khataT('queueOverdue') : khataT('queueBalance');
  return createPortal(
    <div className={styles.queue} role="dialog" aria-modal="true" aria-label={title}>
      <div className={styles.queueBar}>
        <span className={styles.queueTitle}>{title}</span>
        <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={onClose} aria-label={khataT('close')}>
          <X size={16} />
        </button>
      </div>
      <div className={styles.queueBody}>
        <div className={styles.queueCard}>
          {total > 0 && (
            <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(index, total)}>
              <div className={styles.progressFill} style={{ width: `${(Math.min(index, total) / total) * 100}%` }} />
            </div>
          )}
          {(queue.snoozed > 0 || queue.recent > 0) && <p className={styles.meta}>{khataT('hidden', { snoozed: queue.snoozed, recent: queue.recent })}</p>}
          {((queue.muted ?? 0) > 0 || (queue.promised ?? 0) > 0) && <p className={styles.meta}>{colT('rmQueueMuted', { muted: queue.muted ?? 0, promised: queue.promised ?? 0 })}</p>}
          {!item ? (
            <>
              <p className={styles.notice} role="status">
                {total === 0 ? khataT('empty') : khataT('done', tally)}
              </p>
              <div className={styles.queueActions}>
                <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={onClose}>{khataT('close')}</button>
              </div>
            </>
          ) : (
            <>
              <span className={styles.meta}>{khataT('step', { i: index + 1, n: total })}</span>
              <div>
                <div className={styles.partyName}>{item.party.name}</div>
                <div className={styles.partyAmount}>{formatCurrency(item.amount, 'INR')}</div>
                <div className={styles.meta}>
                  {item.oldestDays > 0 && khataT('overdueLine', { amount: formatCurrency(item.overdue, 'INR'), n: item.oldestDays })}
                  {item.lastSentAt && <> · {khataT('lastSent', { date: formatDate(item.lastSentAt) })}</>}
                </div>
              </div>
              {!item.phone && <p className={controls.hint}>{khataT('noPhone')}</p>}
              {item.client?.id && can('master.edit') && (
                <label className={controls.field}>
                  <span className={controls.label}>{colT('rmSetMode', { name: item.party.name })}</span>
                  <SelectField className={controls.select} value={(item.party.key in modes ? modes[item.party.key] : item.client.reminder_mode) ?? 'auto'}
                    onChange={(e) => {
                      const mode = e.target.value === 'auto' ? undefined : (e.target.value as ReminderMode);
                      try {
                        localDb.clients.upsert({ ...item.client!, reminder_mode: mode });
                        setModes((m) => ({ ...m, [item.party.key]: mode }));
                      } catch { /* role / storage: the select simply does not change */ }
                    }}>
                    <option value="auto">{colT('rmAuto')}</option>
                    <option value="manual">{colT('rmManual')}</option>
                    <option value="never">{colT('rmNever')}</option>
                  </SelectField>
                </label>
              )}
              <div className={controls.field}>
                <span className={controls.label}>{khataT('language')}</span>
                <div className={controls.segment} role="radiogroup" aria-label={khataT('language')}>
                  {(['en', 'hinglish', 'hi'] as const).map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={effLang === l}
                      className={effLang === l ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => pick(l)}>
                      {l === 'en' ? khataT('langEn') : l === 'hinglish' ? khataT('langHinglish') : khataT('langHi')}
                    </button>
                  ))}
                  {/* 8H: Marathi, Gujarati, Tamil (and each party's own message language by default). */}
                  {(['mr', 'gu', 'ta'] as const).map((l) => (
                    <button key={l} type="button" role="radio" aria-checked={effLang === l} lang={l}
                      className={effLang === l ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => pick(l)}>
                      {MESSAGE_LANGS.find((m) => m.code === l)?.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className={controls.field}>
                <span className={controls.label}>{khataT('message')}</span>
                <textarea className={`${controls.textarea} ${styles.message}`} value={body}
                  onChange={(e) => setEdits((m) => ({ ...m, [editKey]: e.target.value }))} />
              </label>
              <div className={styles.queueActions}>
                <a className={`${controls.btn} ${controls.btnPrimary} ${controls.btnLg}`} href={whatsappLink(item.phone, body)}
                  target="_blank" rel="noopener noreferrer" data-queue-open
                  onClick={() => { log('whatsapp'); next('sent'); }}>
                  <MessageCircle size={18} /> {khataT('openWa')}
                </a>
                <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => next('skipped')}>
                  <SkipForward size={16} /> {khataT('skip')}
                </button>
                <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
                  onClick={() => {
                    try {
                      appendReminders([makePartySnooze(newId(), item.party.key, 3)]);
                      onChanged?.();
                    } catch { /* see log() */ }
                    next('snoozed');
                  }}>
                  <BellOff size={16} /> {khataT('snooze')}
                </button>
                <button type="button" className={`${controls.btn} ${controls.btnGhost}`}
                  onClick={async () => { if (await copyText(body)) { setCopied(true); log('copy'); } }}>
                  <Copy size={16} /> {copied ? khataT('copied') : khataT('copy')}
                </button>
                {can('payment.record') && (
                  <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={() => setLogging(true)} data-queue-followup>
                    <NotebookPen size={16} /> {colT('fuLog')}
                  </button>
                )}
              </div>
              <p className={styles.meta}>{khataT('limit')}</p>
            </>
          )}
        </div>
      </div>
      {logging && item && (
        <Suspense fallback={null}>
          <FollowUpDialog partyKey={item.party.key} partyName={item.party.name}
            bills={item.party.bills.filter((b) => !b.opening).map((b) => ({ id: b.invoiceId, number: b.number, outstanding: b.outstanding }))}
            onClose={() => setLogging(false)} onSaved={() => onChanged?.()} />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}

export default RemindQueue;
