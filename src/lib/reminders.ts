/**
 * Payment-reminder logic: stage selection, message templates (English and
 * Hinglish), a tiny log (table `reminders`) and "who should I nudge today".
 * Pure — persistence is done by callers through getTable/setTable.
 */

import type { InvoiceRecord } from '../types/invoice';
import { DOCUMENT_LABELS } from '../types/invoice';
import { formatCurrency, formatDate } from './utils';
import { invoiceUpiLink } from './share';

export const REMINDERS_TABLE = 'reminders';

export type ReminderStage =
  | 'upcoming'
  | 'due_today'
  | 'overdue_polite'
  | 'overdue_firm'
  | 'overdue_final'
  | 'thank_you';

export type ReminderChannel = 'whatsapp' | 'email' | 'sms' | 'copy' | 'snooze';
export type ReminderLanguage = 'en' | 'hinglish';

/** Persisted row. A `snooze` row stores the resume date (YYYY-MM-DD) in `note`. */
export interface ReminderRecord {
  id: string;
  invoice_id: string;
  channel: ReminderChannel;
  tone: ReminderStage;
  sent_at: string;
  note?: string;
}

export const STAGE_LABELS: Record<ReminderStage, string> = {
  upcoming: 'Upcoming (friendly)',
  due_today: 'Due today',
  overdue_polite: 'Overdue 1–7 days (polite)',
  overdue_firm: 'Overdue 8–30 days (firm)',
  overdue_final: 'Overdue 30+ days (final notice)',
  thank_you: 'Thank you (paid)',
};

export const STAGE_ORDER: ReminderStage[] = [
  'upcoming', 'due_today', 'overdue_polite', 'overdue_firm', 'overdue_final', 'thank_you',
];

/** Days before the due date at which the "upcoming" nudge starts. */
export const UPCOMING_WINDOW_DAYS = 3;

/* ── Dates ────────────────────────────────────────────────────── */

/** Start-of-day epoch for a date-only string or Date, in local time. */
function dayStart(d: string | Date): number {
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  }
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
}

/** Signed whole days from `today` to `due` (negative = overdue). NaN if invalid. */
export function daysUntil(due: string | undefined, today: Date): number {
  if (!due) return NaN;
  const a = dayStart(due);
  if (Number.isNaN(a)) return NaN;
  return Math.round((a - dayStart(today)) / 86400000);
}

/* ── Stage ────────────────────────────────────────────────────── */

/** Stage for an unpaid invoice, or null when it is too early to nudge. */
export function stageForDays(daysToDue: number): ReminderStage | null {
  if (!Number.isFinite(daysToDue)) return null;
  if (daysToDue > UPCOMING_WINDOW_DAYS) return null;
  if (daysToDue > 0) return 'upcoming';
  if (daysToDue === 0) return 'due_today';
  const late = -daysToDue;
  if (late <= 7) return 'overdue_polite';
  if (late <= 30) return 'overdue_firm';
  return 'overdue_final';
}

export function suggestStage(invoice: InvoiceRecord, today: Date = new Date()): ReminderStage {
  if (invoice.status === 'Paid' || invoice.balance_due <= 0) return 'thank_you';
  return stageForDays(daysUntil(invoice.due_date, today)) ?? 'upcoming';
}

/* ── Templates ────────────────────────────────────────────────── */

const T: Record<ReminderLanguage, Record<ReminderStage, { subject: string; body: string }>> = {
  en: {
    upcoming: {
      subject: 'Friendly reminder: {document} {number} due on {due}',
      body:
        'Hi {client},\n\nA quick heads-up that {document} {number} for {balance} is due on {due} ({days}).\n{upi_line}\nPlease let me know if you need anything from my side.\n\nThanks,\n{business}\n{phone}',
    },
    due_today: {
      subject: '{document} {number} is due today',
      body:
        'Hi {client},\n\n{document} {number} for {balance} is due today ({due}).\n{upi_line}\nKindly arrange the payment at your earliest convenience.\n\nThanks,\n{business}\n{phone}',
    },
    overdue_polite: {
      subject: 'Gentle reminder: {document} {number} was due on {due}',
      body:
        'Hi {client},\n\nI hope you are well. Our records show {document} {number} for {balance} was due on {due} ({days}). If you have already paid, please ignore this note and share the reference.\n{upi_line}\nThank you,\n{business}\n{phone}',
    },
    overdue_firm: {
      subject: 'Overdue: {document} {number} - {balance} outstanding',
      body:
        'Dear {client},\n\n{document} {number} for {balance} was due on {due} and is now {days}. Please clear the outstanding amount within the next 3 working days, or tell me when I can expect payment.\n{upi_line}\nRegards,\n{business}\n{phone}',
    },
    overdue_final: {
      subject: 'Final notice: {document} {number} - {balance} overdue',
      body:
        'Dear {client},\n\nThis is a final reminder for {document} {number}. The balance of {balance} was due on {due} and is {days}, despite earlier reminders.\n{terms_line}Please make the payment immediately or contact me today to agree on a date.\n{upi_line}\nRegards,\n{business}\n{phone}',
    },
    thank_you: {
      subject: 'Payment received: {document} {number}. Thank you!',
      body:
        'Hi {client},\n\nThank you! We have received your payment for {document} {number}. It was a pleasure working with you.\n\nRegards,\n{business}\n{phone}',
    },
  },
  hinglish: {
    upcoming: {
      subject: 'Reminder: {document} {number} {due} ko due hai',
      body:
        'Namaste {client} ji,\n\nBas yaad dila raha hu ki {document} {number} ({balance}) {due} ko due hai ({days}).\n{upi_line}\nKoi dikkat ho to bata dijiye.\n\nDhanyavaad,\n{business}\n{phone}',
    },
    due_today: {
      subject: '{document} {number} aaj due hai',
      body:
        'Namaste {client} ji,\n\n{document} {number} ka {balance} aaj ({due}) due hai.\n{upi_line}\nKripya jaldi payment kar dijiye.\n\nDhanyavaad,\n{business}\n{phone}',
    },
    overdue_polite: {
      subject: 'Reminder: {document} {number} {due} ko due tha',
      body:
        'Namaste {client} ji,\n\nHamare record ke hisaab se {document} {number} ({balance}) {due} ko due tha ({days}). Agar payment ho chuka hai to please reference bhej dijiye.\n{upi_line}\nDhanyavaad,\n{business}\n{phone}',
    },
    overdue_firm: {
      subject: 'Overdue: {document} {number} - {balance} baaki hai',
      body:
        '{client} ji,\n\n{document} {number} ka {balance} {due} ko due tha aur ab {days}. Kripya agle 3 working days mein payment clear kijiye, ya bataiye ki payment kab tak milega.\n{upi_line}\nDhanyavaad,\n{business}\n{phone}',
    },
    overdue_final: {
      subject: 'Final notice: {document} {number} - {balance} overdue',
      body:
        '{client} ji,\n\nPehle ke reminders ke baad bhi {document} {number} ka {balance} baaki hai (due {due}, {days}).\n{terms_line}Kripya turant payment kijiye ya aaj hi baat karke date tay kar lijiye.\n{upi_line}\nDhanyavaad,\n{business}\n{phone}',
    },
    thank_you: {
      subject: 'Payment mil gaya: {document} {number}. Shukriya!',
      body:
        'Namaste {client} ji,\n\nShukriya! {document} {number} ka payment mil gaya. Aapke saath kaam karke accha laga.\n\nDhanyavaad,\n{business}\n{phone}',
    },
  },
};

/** Placeholders users can write in an edited message / custom template. */
export const PLACEHOLDERS = [
  '{client}', '{number}', '{amount}', '{balance}', '{due}', '{days}', '{upi}', '{business}', '{phone}',
] as const;

/** True only if the invoice's own terms/notes already talk about late interest or fees. */
export function termsMentionInterest(invoice: Pick<InvoiceRecord, 'terms' | 'notes'>): boolean {
  return /\b(interest|late (payment )?(fee|charge)s?|penalt(y|ies)|surcharge)\b/i.test(
    `${invoice.terms ?? ''} ${invoice.notes ?? ''}`,
  );
}

function daysPhrase(daysToDue: number, lang: ReminderLanguage): string {
  if (!Number.isFinite(daysToDue)) return '';
  const n = Math.abs(daysToDue);
  const unit = n === 1 ? 'day' : 'days';
  if (daysToDue === 0) return lang === 'en' ? 'today' : 'aaj';
  if (daysToDue > 0) return lang === 'en' ? `in ${n} ${unit}` : `${n} din mein`;
  return lang === 'en' ? `${n} ${unit} overdue` : `${n} din se overdue`;
}

/** Fill `{placeholders}`. Unknown tokens are left untouched. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function reminderVars(
  invoice: InvoiceRecord,
  stage: ReminderStage,
  lang: ReminderLanguage,
  today: Date = new Date(),
): Record<string, string> {
  const cur = invoice.currency || 'INR';
  const s = invoice.sender;
  const upi = s?.upiId?.trim() ?? '';
  const payLink = stage === 'thank_you' ? null : invoiceUpiLink(invoice);
  const upiLine =
    stage === 'thank_you' || !upi
      ? ''
      : (lang === 'en' ? `You can pay via UPI to ${upi}` : `UPI se payment: ${upi}`) +
        (payLink ? `\nPay link: ${payLink}` : '') +
        '\n';
  const termsLine = termsMentionInterest(invoice)
    ? lang === 'en'
      ? 'As per the terms on the invoice, late-payment charges may apply.\n'
      : 'Invoice ki terms ke anusaar late-payment charges lag sakte hain.\n'
    : '';
  return {
    client: invoice.client?.name?.trim() || 'there',
    number: invoice.invoice_number,
    document: DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice',
    amount: formatCurrency(invoice.total, cur),
    balance: formatCurrency(invoice.balance_due > 0 ? invoice.balance_due : invoice.total, cur),
    due: invoice.due_date ? formatDate(invoice.due_date) : 'the due date',
    days: daysPhrase(daysUntil(invoice.due_date, today), lang),
    upi,
    business: s?.companyName?.trim() || '',
    phone: s?.companyPhone?.trim() ? `Ph: ${s.companyPhone.trim()}` : '',
    upi_line: upiLine,
    terms_line: termsLine,
  };
}

export interface ReminderMessage {
  subject: string;
  body: string;
}

/** Clean up blank runs left by empty placeholders. */
function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildReminder(
  invoice: InvoiceRecord,
  stage: ReminderStage,
  lang: ReminderLanguage = 'en',
  today: Date = new Date(),
): ReminderMessage {
  const t = T[lang][stage];
  const vars = reminderVars(invoice, stage, lang, today);
  return { subject: tidy(fillTemplate(t.subject, vars)), body: tidy(fillTemplate(t.body, vars)) };
}

/* ── Log helpers ──────────────────────────────────────────────── */

export function remindersFor(log: ReminderRecord[], invoiceId: string): ReminderRecord[] {
  return log.filter((r) => r.invoice_id === invoiceId && r.channel !== 'snooze');
}

export function reminderCount(log: ReminderRecord[], invoiceId: string): number {
  return remindersFor(log, invoiceId).length;
}

export function lastReminder(log: ReminderRecord[], invoiceId: string): ReminderRecord | null {
  const rows = remindersFor(log, invoiceId);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (a.sent_at >= b.sent_at ? a : b));
}

/** Resume date (YYYY-MM-DD) of the latest snooze, or null. */
export function snoozedUntil(log: ReminderRecord[], invoiceId: string): string | null {
  const dates = log
    .filter((r) => r.invoice_id === invoiceId && r.channel === 'snooze' && r.note)
    .map((r) => r.note as string)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

export function isSnoozed(log: ReminderRecord[], invoiceId: string, today: Date): boolean {
  const until = snoozedUntil(log, invoiceId);
  return !!until && dayStart(until) > dayStart(today);
}

export function makeLogEntry(
  id: string,
  invoiceId: string,
  channel: ReminderChannel,
  tone: ReminderStage,
  now: Date = new Date(),
  note = '',
): ReminderRecord {
  return { id, invoice_id: invoiceId, channel, tone, sent_at: now.toISOString(), note };
}

/** A snooze row that hides the invoice from `pendingReminders` for `days` days. */
export function makeSnooze(
  id: string,
  invoiceId: string,
  days: number,
  today: Date = new Date(),
): ReminderRecord {
  const start = new Date(dayStart(today));
  start.setDate(start.getDate() + Math.max(1, Math.round(days)));
  const y = start.getFullYear();
  const m = String(start.getMonth() + 1).padStart(2, '0');
  const d = String(start.getDate()).padStart(2, '0');
  return makeLogEntry(id, invoiceId, 'snooze', 'upcoming', today, `${y}-${m}-${d}`);
}

/* ── Who to nudge ─────────────────────────────────────────────── */

export interface PendingReminder {
  invoice: InvoiceRecord;
  stage: ReminderStage;
  /** Signed days to due (negative = overdue). */
  daysToDue: number;
  count: number;
  lastSentAt: string | null;
}

export interface PendingOptions {
  /** Minimum days between reminders (default 3; 7 once past 30 days overdue). */
  cooldownDays?: number;
}

const COLLECTIBLE = new Set(['INVOICE', 'TAX_INVOICE', 'PROFORMA']);

/** Unpaid, sent invoices that deserve a nudge today, most overdue first. */
export function pendingReminders(
  invoices: InvoiceRecord[],
  today: Date = new Date(),
  log: ReminderRecord[] = [],
  opts: PendingOptions = {},
): PendingReminder[] {
  const out: PendingReminder[] = [];
  for (const invoice of invoices) {
    if (!COLLECTIBLE.has(invoice.doc_type)) continue;
    if (invoice.status === 'Paid' || invoice.status === 'Cancelled' || invoice.status === 'Draft') continue;
    if (!(invoice.balance_due > 0)) continue;
    const daysToDue = daysUntil(invoice.due_date, today);
    const stage = stageForDays(daysToDue);
    if (!stage) continue;
    if (isSnoozed(log, invoice.id, today)) continue;

    const last = lastReminder(log, invoice.id);
    if (last) {
      const cooldown = opts.cooldownDays ?? (stage === 'overdue_final' ? 7 : 3);
      const since = Math.round((dayStart(today) - dayStart(last.sent_at)) / 86400000);
      if (since < cooldown) continue;
    }
    out.push({
      invoice,
      stage,
      daysToDue,
      count: reminderCount(log, invoice.id),
      lastSentAt: last?.sent_at ?? null,
    });
  }
  return out.sort((a, b) => a.daysToDue - b.daysToDue);
}
