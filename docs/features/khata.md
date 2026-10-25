# Daily khata loop (8A)

What Khatabook / OkCredit / Vyapar / myBillBook users do every day, on top of the existing receivables ledger:
see who owes what, take money in with two taps, give credit, send a statement or a reminder on WhatsApp,
and print the party's running balance on the bill. Everything is offline: the app only builds `wa.me` and
`upi://` links, hands files to the OS share sheet (Web Share Level 2) or downloads them. Nothing is sent by the app.

| Piece | Where | Tests |
|---|---|---|
| Pure maths: balance rows, totals, FIFO, WhatsApp statement, party reminders, queue, snapshot | `src/lib/khata.ts` | `tests/khata.test.ts` |
| Data layer: load the ledger, ₹ Given entries, reminder log, snapshot for a bill | `src/lib/khata-actions.ts` | `tests/khata.test.ts` |
| Quick receipt, all or nothing | `savePartyReceipt` in `src/lib/bill-allocation.ts` | `tests/khata.test.ts` |
| Bill snapshot type / sanitiser / print rows | `src/lib/party-balance.ts`, `InvoiceRecord.party_balance_snapshot` | `tests/khata.test.ts`, `tests/invoice-store.test.ts` (persisted field) |
| ₹ Received / ₹ Given sheet (lazy) | `src/components/khata/QuickEntrySheet.tsx` | e2e |
| Reminder queue (lazy, full screen) | `src/components/khata/RemindQueue.tsx` | — |
| Print block (accent variable only) | `src/components/templates/parts/PartyBalanceBlock.tsx`, `TemplateEngine.tsx` | template wiring tests |
| Statement sharing | `src/components/receivables/StatementViewer.tsx`, `src/lib/client-copy.ts` (generalised), `src/lib/client-copy-dom.ts` | `tests/client-copy.test.ts` |
| Strings (English + Hindi) | `src/i18n/areas/khata.ts` (`khataT`) | `tests/i18n-areas.test.ts` |

## 8.1 Balance-first Clients list

**Clients** now shows a **Balance** column instead of leading with "Billed": *To collect ₹X* (green), *Advance ₹X*
(red; we hold their money) or *Settled*, with "₹Y overdue · N days" under it. The figure is the party's net from
`buildReceivables` — invoices, receipts, credit notes, advance receipts and bill-wise **opening bills** — so it is the
same number Receivables, statements and reminders show. The billed total / invoice count and unadjusted advance link
stay as a second line. Default sort is by balance (biggest to collect first, advances last); also *Most overdue* and
*Name*. An **Overdue only** chip filters. A header card totals **You'll get** (Σ positive balances) and **You'll give**
(Σ advances held). On a phone the row becomes a card (name + balance on top, contact, then the action buttons).
INR only (foreign-currency documents stay in Receivables' currency picker).

## 8.2 ₹ Received and ₹ Given

Row buttons on Clients, and on the party detail (Receivables → Statements, beside Copy / Email):

- **₹ Received** — amount (auto-focused, numeric keypad), mode **Cash / UPI / Bank** with an optional UTR / reference,
  date (today), optional note. The amount is split over the party's open bills **oldest due date first**
  (`fifoAllocate`); every split is editable before saving and whatever is left goes **on account** (an advance).
  Saving calls `savePartyReceipt`: each allocation is a normal `localDb.payments.record` row (receipt number
  `RCPT/FY…`, invoice status, audit), tagged `client_id` / `client_name`; the remainder is one invoice-less row with the
  party and its own receipt number. Receivables treat it as an advance, the ledger and Books post it as a receipt from
  the party, so receivables, statements, ledger and cash book agree. **All or nothing**: the role (`payment.record`),
  the period lock (`pay`, also for the on-account date and opening bills) and approval holds are checked for every
  bill before anything is written, and a failure half-way restores `transactions`, `invoices` and the receipt-number
  high-water mark (`withTablesRollback`).
- **₹ Given** (credit without items) — depends on the active profile (`givenModeFor`):
  - **Composition** profile → a one-line **Bill of Supply** (no tax; the Rule 49 declaration prints as usual).
  - **No GSTIN** on the profile → a one-line bill with GST off.
  - **GST-registered** profile → the sheet explains why and opens the **invoice editor** with the party filled in
    (`/invoice?party=<client id>`). *Decision:* the app never invents a non-GST "credit memo" for a registrant — goods
    or services given on credit are a taxable supply that needs a tax invoice (HSN, rate, place of supply).
  The one-line entry goes through `localDb.invoices.save` (role `doc.create`, period lock, numbering, audit), takes the
  party's credit days for its due date and carries the balance snapshot (8.5).

## 8.3 WhatsApp statement, Share PDF, statement web page

- **WhatsApp statement** (Clients row icon, Receivables aging row icon, Statements tab, statement viewer): a `wa.me`
  link to the party's phone with the text from `buildWhatsAppStatement` — open bills (oldest first, days overdue),
  credits / advances, the **net due** and a `upi://pay` link for exactly that amount (plus the UPI ID). Without a phone
  number WhatsApp asks for the contact. Long text is trimmed to the URL budget (`truncateForUrl`).
- **Share PDF** (statement viewer): the A4 statement is built in the browser (`nodeToPdfBlob`) and handed to the share
  sheet (`shareFile`); if the browser wants a fresh tap the button turns into **Share PDF now**; browsers without file
  sharing download it.
- **Web page** (statement viewer): `buildClientCopyHtml` (now generic: pay-panel label / aria label and a footer note)
  wraps the frozen statement paper (QR canvas → PNG, `client-copy-dom.ts`) in a static, script-free page with its own
  `default-src 'none'` CSP and a **Pay with UPI** panel + QR for the balance. Shared as a file, else downloaded.

## 8.4 Party reminders and "Remind all overdue"

`buildPartyReminder({party, sender, kind, lang})` writes one message per party: **total overdue + oldest bill (number,
date, days late) + total balance + a UPI link for the overdue amount**, in **English, Hinglish or Hindi** (Devanagari).
`kind: 'balance'` is the monthly "here is your balance" message. Nothing overdue falls back to the balance wording.

**Remind all overdue** (Clients header, Receivables header) opens a full-screen stepper over `partyReminderQueue`:
parties with overdue bills, oldest first (then amount). Each screen shows the party, the amount asked, the editable
message and a language switch; **Open WhatsApp** opens the chat and moves to the next party; **Skip**, **Snooze 3 days**
and **Copy** too. **Send everyone their balance** is the same stepper over every party with a balance (biggest
first, 20-day cool-down) — the monthly preset.

Every open / copy / snooze is logged in the existing `reminders` table with an additive **`party_key`** (client id,
else `name:<lower-cased name>`) and an empty `invoice_id`, so per-invoice reminder counts are unchanged. The queue
leaves out snoozed parties and parties reminded within the cool-down (3 days; says how many were left out).

**Honest limit:** browsers only open a new window from a user gesture, so it is **one tap per party** — the app cannot
send a batch by itself, and WhatsApp still needs the user to press Send.

## 8.5 Party balance on the bill

A Design Studio toggle (**Sections → Party balance on the bill**, stored per profile as the additive design pref
`show_party_balance`) prints

```
Previous balance        ₹A
+ This bill             ₹B
− Received now          ₹P   (only when paid at the counter)
Total due               ₹C
```

on every invoice template (outside the layout bodies, after the declarations) and, compact, on the 80 mm thermal /
POS receipt. It uses the accent variable only. The figures come from **`party_balance_snapshot`** stored on the invoice
(additive: `InvoiceRecord`, `RECORD_KEYS`, `normalizeRecord`, persisted-field test):

- Taken when the bill is **first issued** (a new document saved as Sent, or a draft being issued): previous = the
  party ledger closing up to the bill date **without this bill** (`buildLedger`), bill = receivable total less TDS,
  paid = amount paid at issue (POS: the tenders). INR sales documents only (invoice, tax invoice, bill of supply);
  walk-in names that are neither in the client master nor in the ledger get none.
- **Never recomputed**: later saves keep it (only "This bill" follows an edit of the bill itself), so a reprint shows
  what the customer was handed (Critical Rule 3). Duplicates and conversions drop it and take their own at issue.
- **Legacy** documents (issued before this) carry none and print nothing; a snapshot with no previous balance prints
  nothing either.
- Written by the editor save (`useInvoiceStore.saveInvoice`), the POS (`savePosBill`) and ₹ Given. Other automatic
  paths (recurring runs, conversions, late-fee drafts) do not take one yet.

## 8.6 Due dates in shop use

- A client picked from the master on a **new** document sets the due date from its **credit days** (`Client.credit_days`,
  6.25); typing a name never moves it.
- The editor shows a nudge under the due date when a sales bill is unpaid and its due date is not after the issue date.

## Storage

No new tables. Additive fields only: `transactions` rows gain `client_id` / `client_name` (already documented on
`ReceiptRow`), `reminders` rows gain `party_key`, `InvoiceRecord` gains `party_balance_snapshot`, design prefs gain
`show_party_balance`. All live under existing `mrchartist_inv_*` keys, so backup, restore and folder sync carry them
unchanged.

## Not done / follow-ups

- Recurring invoices, conversions and late-fee drafts do not take a balance snapshot when issued outside the editor.
- No per-party default reminder language (the queue starts in the app language).
- Statement web page / Share PDF are in the statement viewer only (not on list rows).
- The khata views are INR only.
