# Share and payment reminders

Get paid faster and share documents. Everything works offline: the app only
builds `wa.me`, `mailto:`, `sms:`, `tel:` and `upi://` links. Nothing is sent
by the app itself.

- Route: none (components, not a page). Embed `RemindersPanel` in the Dashboard and `ShareMenu` in the invoice preview/creator toolbar and the Transactions/invoice list rows.
- Nav label / icon: none needed. If the lead wants a dedicated entry: label "Reminders", icon `BellRing`.

## Files

| File | Purpose |
| --- | --- |
| `src/lib/share.ts` | Pure link builders and plain-text summary |
| `src/lib/reminders.ts` | Stages, templates (English and Hinglish), log helpers, `pendingReminders` |
| `src/components/share/ShareMenu.tsx` | "Share" dropdown |
| `src/components/share/ReminderModal.tsx` | Compose, copy, open and log a reminder |
| `src/components/share/RemindersPanel.tsx` | Dashboard card of invoices to nudge today |
| `src/components/share/useReminderLog.ts` | Hook over the `reminders` table |
| `src/components/share/clipboard.ts` | `copyText`, `openLink` |
| `src/components/share/index.ts` | Barrel export |
| `tests/share.test.ts`, `tests/reminders.test.ts` | node:test coverage |

## Table

`reminders` (via `getTable/setTable`, key `mrchartist_inv_reminders`):
`{ id, invoice_id, channel: 'whatsapp'|'email'|'sms'|'copy'|'snooze', tone: ReminderStage, sent_at (ISO), note? }`.
A `snooze` row stores its resume date (`YYYY-MM-DD`) in `note`. It is part of the
`mrchartist_inv_` prefix, so existing backups include it automatically.

## lib/share.ts exports

`normalizePhone(raw, cc='91')` (digits only, `+91` default; handles `+91`, `0`, `00`, spaces, 10-digit; null if invalid),
`formatPhoneDisplay`, `whatsappLink(phone, text)`, `mailtoLink({to, cc, bcc, subject, body})` (CRLF body, invalid addresses dropped),
`smsLink`, `telLink`, `isValidEmail`, `isValidUpiId`, `upiLink({pa, pn, amount, note, tr})`,
`invoiceUpiLink(invoice)` (INR only, balance due, note "Payment for <number>"),
`invoiceSummaryText(invoice)`, `truncateForUrl`, `MAX_URL_LENGTH` (1900 encoded chars; longer text is trimmed with an ellipsis, never splitting emoji).

## lib/reminders.ts exports

`ReminderStage` = `upcoming | due_today | overdue_polite | overdue_firm | overdue_final | thank_you`.
Boundaries: upcoming = 1 to 3 days before due, due_today = 0, polite = 1 to 7 days late, firm = 8 to 30, final = 31+. `stageForDays(n)`, `suggestStage(invoice, today)`,
`buildReminder(invoice, stage, 'en'|'hinglish', today)` returns `{subject, body}` using `{client} {number} {amount} {balance} {due} {days} {upi} {business} {phone}`.
The final notice mentions late-payment charges only when `termsMentionInterest` finds interest/late fee/penalty wording in the invoice's own terms or notes; no legal claims are invented.
Log helpers: `remindersFor`, `reminderCount`, `lastReminder`, `snoozedUntil`, `isSnoozed`, `makeLogEntry`, `makeSnooze`.
`pendingReminders(invoices, today, log, {cooldownDays})`: unpaid, non-draft INVOICE/TAX_INVOICE/PROFORMA with balance, in a stage, not snoozed, not reminded within the cooldown (3 days; 7 for final notices). Sorted most overdue first.

## Components

- `ShareMenu` props: `{ invoice: InvoiceRecord; onDownloadPdf?: () => void; hideReminder?: boolean; className?: string }`. Items: WhatsApp, Email, SMS, Copy message, Copy payment link (disabled without a UPI ID), Download PDF (if callback given), Payment reminder (unpaid only). Keyboard: arrows, Escape.
- `ReminderModal` props: `{ invoice; open: boolean; onClose: () => void; onSent?: (entry: ReminderRecord) => void }`. Tone chips, channel, English/Hinglish, editable recipient/subject/message, copy, snooze 3 days, history. Every open/copy is logged.
- `RemindersPanel` props: `{ invoices?: InvoiceRecord[]; limit?: number (5); today?: Date; className? }`. Reads `localDb.invoices.getAll()` when `invoices` is omitted.

## Wiring the lead must add

1. Dashboard (`src/pages/Dashboard.tsx`):
```tsx
import { RemindersPanel } from '../components/share';
// ...inside the layout, e.g. below the stats row:
<RemindersPanel />
```
2. Invoice preview / creator toolbar, next to the Download button:
```tsx
import { ShareMenu } from '../components/share';
<ShareMenu invoice={savedInvoice} onDownloadPdf={handleDownloadPdf} />
```
`savedInvoice` must be a full `InvoiceRecord` (saved, with `sender` snapshot and totals).
3. Optional list rows (Transactions/invoice list): `<ShareMenu invoice={inv} hideReminder={inv.status === 'Paid'} />`.
4. Thank-you on payment: after recording a payment that clears the balance, open `<ReminderModal invoice={inv} open onClose=... />` (its default stage is `thank_you` when paid).

No routes, no new dependencies, no edits to shared core files.
