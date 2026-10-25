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
`pendingReminders(invoices, today, log, {cooldownDays})`: unpaid, non-draft INVOICE/TAX_INVOICE/PROFORMA with balance, in a stage, not snoozed, not reminded within the cooldown (3 days; 7 for final notices). Sorted by chase priority (`reminderPriority`, 0–100, ties most overdue first): days overdue up to 50 (linear to 90 days; not-yet-due 0–5), balance in ₹ up to 30 (log scale, ₹1,000 → 0, ₹10 lakh+ → 30; foreign documents converted at their exchange rate), the client's other overdue bills 5 each up to 10 (client matched by GSTIN, else name), reminders already sent 5 each up to 10. Level: high ≥ 50, medium ≥ 25, else low; the Dashboard card shows the level with the reasons as a tooltip.

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

## Sharing the PDF itself

Where the browser can hand files to other apps (Android Chrome, iOS/macOS Safari, Edge), the preview's Share menu
offers **Share PDF…**: the PDF is built in the browser and passed to the OS share sheet (`shareFile` in
`src/lib/share.ts`, Web Share Level 2), so it lands in a WhatsApp chat or mail as an attachment. If the browser
refuses because building the PDF outlasted the tap (`blocked`), a **Share PDF now** button finishes it with one more
tap; browsers without file sharing get a normal download.

## Client copy (web page)

Share → **Client copy (web page)** turns the rendered preview into one static HTML file (`buildClientCopyHtml` in
`src/lib/client-copy.ts`): the page markup is cloned, QR canvases are frozen into PNG images, the app's stylesheet
rules are inlined, and an on-screen pay panel adds the amount due, a tappable **Pay with UPI** (`upi://`) button,
the UPI ID and QR. It carries its own `default-src 'none'` CSP, no scripts (`sanitizePaper` strips any), and opens
offline in any browser; printing hides the pay panel. Shared as a file where supported, otherwise downloaded.
Fonts fall back to the system font outside the app.

## Party-level reminders (8.4, `docs/features/khata.md`)

`src/lib/khata.ts` adds reminders per **party** rather than per invoice: `buildPartyReminder({party, sender, kind, lang})`
(`kind` `overdue` = total overdue + oldest bill + UPI link for the overdue amount; `balance` = the monthly "your balance
is ₹X"), in `en`, `hinglish` or `hi` (Devanagari). `partyReminderQueue(report, clients, log, {kind, today, cooldownDays})`
lists who to message (overdue: oldest first; balance: biggest first), leaving out snoozed parties and those reminded
inside the cool-down (3 days; 20 for the monthly balance).

The stepper (`src/components/khata/RemindQueue.tsx`, lazy) opens WhatsApp for one party per tap and advances; Skip,
Snooze 3 days and Copy too. **One tap per party** is a browser rule (a new window needs a user gesture) — the app never
sends anything itself.

Log rows use the existing `reminders` table with an additive `party_key` and an empty `invoice_id`
(`makePartyLogEntry`, `makePartySnooze`, `partyReminderRows`, `lastPartyReminder`, `partySnoozedUntil`), so the
per-invoice helpers above (`remindersFor`, `pendingReminders` …) never count them.

## WhatsApp statement and statement web page (8.3)

`buildWhatsAppStatement({sender, party})` — open bills, credits / advances, net due and a `upi://pay` link for the net
— goes into `whatsappLink(phone, text)` from Clients rows, Receivables aging rows, the Statements tab and the statement
viewer. The viewer's **Share PDF** uses `shareFile` (blocked → "Share PDF now", unsupported → download) and **Web page**
uses the generalised `buildClientCopyHtml` (`pay.label`, `pay.ariaLabel`, `note`) with `freezePaper` / `documentCss`
from `src/lib/client-copy-dom.ts`.

## 8G additions
- Reminders chase the earliest unpaid instalment of a payment schedule. The post-save success sheet (WhatsApp with UPI link and party outstanding) and quotation Accept / Request changes links in the client copy are described in `docs/features/invoicing-ux.md` § 8.101 / 8.105.
