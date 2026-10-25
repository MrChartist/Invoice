/**
 * Payment-reminder logic: stage selection, message templates (English and
 * Hinglish), a tiny log (table `reminders`) and "who should I nudge today".
 * Pure — persistence is done by callers through getTable/setTable.
 */

import type { InvoiceRecord } from '../types/invoice';
import { DOCUMENT_LABELS } from '../types/invoice';
import { formatCurrency, formatDate } from './utils';
import { invoiceUpiLink } from './share';
import { receivableBalance, receivableTotal } from './rcm';
import { effectiveDueDate } from './payment-schedule';

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
  /**
   * Additive (8.4): a party-level reminder (the "Remind all overdue" queue / monthly balance) is
   * logged with the party key (client id, else `name:<lower-cased name>`) and an empty `invoice_id`,
   * so the per-invoice helpers above never count it. See `src/lib/khata.ts`.
   */
  party_key?: string;
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
  if (invoice.status === 'Paid' || receivableBalance(invoice) <= 0) return 'thank_you';
  return stageForDays(daysUntil(effectiveDueDate(invoice), today)) ?? 'upcoming';
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

/** Extra facts a caller may supply; kept out of this module so it stays free of storage. */
export interface ReminderExtras {
  /**
   * Late-payment interest accrued to `today` (see `src/lib/interest.ts`). Only ever worded
   * into the message when the invoice's own terms mention interest / late fees.
   */
  interestAccrued?: number;
}

export function reminderVars(
  invoice: InvoiceRecord,
  stage: ReminderStage,
  lang: ReminderLanguage,
  today: Date = new Date(),
  extras: ReminderExtras = {},
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
  const accrued = extras.interestAccrued;
  const termsLine = termsMentionInterest(invoice)
    ? accrued !== undefined && Number.isFinite(accrued) && accrued > 0
      ? lang === 'en'
        ? `As per the terms on the invoice, late-payment interest of ${formatCurrency(accrued, cur)} has accrued as of ${formatDate(today)}. The balance above does not include it.\n`
        : `Invoice ki terms ke anusaar ${formatDate(today)} tak ${formatCurrency(accrued, cur)} late-payment interest bana hai. Upar ke balance mein yeh shaamil nahi hai.\n`
      : lang === 'en'
        ? 'As per the terms on the invoice, late-payment charges may apply.\n'
        : 'Invoice ki terms ke anusaar late-payment charges lag sakte hain.\n'
    : '';
  return {
    client: invoice.client?.name?.trim() || 'there',
    number: invoice.invoice_number,
    document: DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice',
    // Reverse charge: the GST is the recipient's to pay, never asked for (src/lib/rcm.ts).
    amount: formatCurrency(receivableTotal(invoice), cur),
    balance: formatCurrency(receivableBalance(invoice) > 0 ? receivableBalance(invoice) : receivableTotal(invoice), cur),
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
  extras: ReminderExtras = {},
): ReminderMessage {
  const t = T[lang][stage];
  const vars = reminderVars(invoice, stage, lang, today, extras);
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
  /** Who to chase first, 0–100 (see `reminderPriority`). The list is sorted by this. */
  priority: number;
  priorityLevel: PriorityLevel;
  /** Plain-language reasons behind the score, biggest first. */
  priorityReasons: string[];
}

export type PriorityLevel = 'high' | 'medium' | 'low';

export interface PriorityInput {
  daysToDue: number;
  /** Balance in ₹ (foreign documents converted at their exchange rate when known). */
  balanceInr: number;
  /** Other overdue invoices of the same client. */
  otherOverdue: number;
  /** Reminders already sent for this invoice. */
  remindersSent: number;
}

/**
 * Explainable chase-first score, 0–100:
 *  - days overdue: up to 50 (linear to 90 days; not-yet-due bills score 0–5),
 *  - balance in ₹: up to 30 (₹1,000 → 0, ₹10k → 10, ₹1 lakh → 20, ₹10 lakh+ → 30),
 *  - the client's other overdue bills: 5 each, up to 10,
 *  - reminders already ignored: 5 each, up to 10.
 */
export function reminderPriority(p: PriorityInput): { score: number; level: PriorityLevel; reasons: string[] } {
  const parts: Array<[number, string]> = [];
  const overdue = Math.max(0, -p.daysToDue);
  if (overdue > 0) parts.push([Math.min(50, (overdue * 50) / 90), `${overdue} day${overdue === 1 ? '' : 's'} overdue`]);
  else parts.push([Math.max(0, 5 - p.daysToDue), p.daysToDue === 0 ? 'due today' : `due in ${p.daysToDue} day${p.daysToDue === 1 ? '' : 's'}`]);
  const amount = Math.max(0, p.balanceInr);
  const amountPts = amount > 0 ? Math.min(30, Math.max(0, (Math.log10(amount) - 3) * 10)) : 0;
  if (amountPts > 0) parts.push([amountPts, `₹${Math.round(amount).toLocaleString('en-IN')} outstanding`]);
  if (p.otherOverdue > 0) parts.push([Math.min(10, p.otherOverdue * 5), `${p.otherOverdue} other overdue bill${p.otherOverdue === 1 ? '' : 's'}`]);
  if (p.remindersSent > 0) parts.push([Math.min(10, p.remindersSent * 5), `${p.remindersSent} reminder${p.remindersSent === 1 ? '' : 's'} without payment`]);
  const score = Math.round(Math.min(100, parts.reduce((t, [n]) => t + n, 0)));
  const level: PriorityLevel = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return { score, level, reasons: parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, r]) => r) };
}

function clientKey(inv: InvoiceRecord): string {
  const c = inv.client;
  return (c?.gstin || c?.name || '').trim().toUpperCase();
}

function balanceInr(inv: InvoiceRecord): number {
  const bal = receivableBalance(inv) || 0;
  const cur = (inv.currency || 'INR').toUpperCase();
  const fx = Number(inv.exchange_rate);
  return cur !== 'INR' && fx > 0 ? bal * fx : bal;
}

export interface PendingOptions {
  /** Minimum days between reminders (default 3; 7 once past 30 days overdue). */
  cooldownDays?: number;
}

const COLLECTIBLE = new Set(['INVOICE', 'TAX_INVOICE', 'PROFORMA', 'BILL_OF_SUPPLY']);

/** Unpaid, sent invoices that deserve a nudge today, most overdue first. */
export function pendingReminders(
  invoices: InvoiceRecord[],
  today: Date = new Date(),
  log: ReminderRecord[] = [],
  opts: PendingOptions = {},
): PendingReminder[] {
  const out: Omit<PendingReminder, 'priority' | 'priorityLevel' | 'priorityReasons'>[] = [];
  const overdueByClient = new Map<string, number>();
  for (const invoice of invoices) {
    if (!COLLECTIBLE.has(invoice.doc_type)) continue;
    if (invoice.status === 'Paid' || invoice.status === 'Cancelled' || invoice.status === 'Draft') continue;
    if (!(receivableBalance(invoice) > 0)) continue;
    // 8.100: a payment schedule's earliest unpaid instalment is the date to chase.
    const daysToDue = daysUntil(effectiveDueDate(invoice), today);
    if (daysToDue < 0) overdueByClient.set(clientKey(invoice), (overdueByClient.get(clientKey(invoice)) ?? 0) + 1);
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
  return out
    .map((r) => {
      const key = clientKey(r.invoice);
      const own = r.daysToDue < 0 ? 1 : 0;
      const pr = reminderPriority({
        daysToDue: r.daysToDue,
        balanceInr: balanceInr(r.invoice),
        otherOverdue: key ? Math.max(0, (overdueByClient.get(key) ?? 0) - own) : 0,
        remindersSent: r.count,
      });
      return { ...r, priority: pr.score, priorityLevel: pr.level, priorityReasons: pr.reasons };
    })
    .sort((a, b) => b.priority - a.priority || a.daysToDue - b.daysToDue);
}
