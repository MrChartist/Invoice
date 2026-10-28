# Collections & settlement (Round 2, R2-A)

Status: **done** (A1–A7). Spec: `docs/prd/round-2.md` §4 R2-A. Everything is local; nothing is sent by the app.
Statutory points are working papers — **verify with your CA** (see the list at the end).

| Item | What | Lib (pure, tested) | UI (all lazy) | Tests |
|---|---|---|---|---|
| A1 | Payment terms master: Net N, EOM + N, day D of next month, instalments, early-pay discount | `src/lib/payment-terms.ts` | Settings → Defaults → Payment terms (`settings/PaymentTermsPanel.tsx`), editor terms picker (`collections/TermsPicker.tsx` in `DocumentMetaCard`), client form (`collections/ReminderModeField.tsx`), print `templates/parts/PaymentScheduleBlock.tsx` | `tests/payment-terms.test.ts` |
| A2 | Settlement discount / short payment (kasar) on a receipt → financial credit note `FCN/FY…` | `src/lib/settlement.ts`, `src/lib/financial-note.ts` | "Settle the rest" in `PaymentModal` and the khata ₹ Received sheet (`collections/SettleRestFields.tsx`, `collections/settle-actions.ts`) | `tests/settlement.test.ts` |
| A3 | Bad-debt write-off (single + bulk), register, recovery | `src/lib/write-off.ts` (on the 8G `write_off` payment flag) | Receivables ageing row "Write off" (`collections/WriteOffDialog.tsx`, owner PIN), Collections tab register (`collections/WriteOffRegister.tsx`), recovery offer in `PaymentModal` (`collections/RecoveryOffer.tsx`) | `tests/write-off.test.ts` |
| A4 | Follow-ups, promise-to-pay, next action, broken-promise alert, party timeline | `src/lib/collections.ts`, `src/lib/reminder-context.ts` | Receivables → Follow-ups tab (`collections/FollowUpsTab.tsx`), "Log follow-up" on ageing rows / statement / Remind queue (`collections/FollowUpDialog.tsx`), timeline card on the statement (`collections/PartyTimeline.tsx`), bell notices (`notifications.ts` `promiseProvider`) | `tests/collections.test.ts` |
| A5 | Reminder schedule, per-stage cooldown, editable templates, per-party reminder mode | `src/lib/reminders.ts` (schedule, `templateFor`), `src/lib/reminder-settings.ts` | Settings → Defaults → Reminder schedule (`settings/ReminderSchedulePanel.tsx`), client form + Remind queue row | `tests/reminders.test.ts` (extended) |
| A6 | Statement styles (balance forward / open items / transactions) + ageing strip | `src/lib/statement-styles.ts` | Statement screen, statement viewer toolbar, bulk statements (`receivables/StatementDocument.tsx`) | `tests/statement-styles.test.ts` |
| A7 | Party payment score (grade A–D, reasons, trend) | `src/lib/payment-score.ts` | Ageing rows + statement header (`collections/PaymentScoreBadge.tsx`), editor credit warning, reminder priority | `tests/payment-score.test.ts` |

## Storage (all additive)

| Key / field | Kind | Backed up / synced | Notes |
|---|---|---|---|
| `mrchartist_inv_payment_terms` | rows | yes / yes | `PaymentTerm`; the starter set (Due on receipt, Net 7/15/30/45, EOM + 30) is used until the first save. `TABLE_ACTIONS`: `master.edit`. |
| `mrchartist_inv_collection_notes` | rows (dated `date`) | yes / yes | `CollectionNote` `{party_key, kind, outcome, date, promise?, next_action?}`. `payment.record`. Sync `DATED` on `date`. |
| `mrchartist_inv_write_off_recoveries` | rows (dated `date`) | yes / yes | `WriteOffRecovery` for both same-FY and earlier-FY recoveries (the register needs both). `books.edit`; the API itself is owner-only. |
| `mrchartist_inv_reminder_settings` | object | yes / yes | `{upcoming_days, polite_after, firm_after, final_after, cooldowns, templates}`; `settings.manage`. |
| `mrchartist_inv_collection_settings` | object | yes / yes | `{gst_variant, clerk_cap_abs, clerk_cap_pct, short_pay_account}`; `settings.manage`. |
| `FCN/FY…` in `series_counters` | counter | yes / yes | financial credit notes never reuse a number. |
| `mrchartist_statement_prefs` | device-local (localStorage, outside the prefix) | no / no | statement style + ageing toggle. |
| `InvoiceRecord.note_kind` / `financial_reason` / `financial_account` / `payment_terms` | fields | — | `financial_account` snapshots the ledger account at issue (see deviations). |
| `Client.payment_terms_id` / `reminder_mode` | master fields | — | stripped from the snapshot-to-master upsert in `localDb.invoices.save` like `credit_limit`, so an old document never resets them. |
| `SenderProfile.msme_udyam` | profile field | — | enables the Sec 43B(h) 45-day note; edited in the Payment terms panel. |
| `RecurringSchedule.payment_terms_id` | field | — | the term is worked out again on every generated document. |

Registered in `backup.ts` (`RECORD_TABLES` / `ID_TABLES`), `access.ts` (`TABLE_ACTIONS`), `audit-edits.ts`
(`WATCHED_TABLES`) and `sync-engine.ts` (`DATED`), each in one `// R2-A` block. Ledger default accounts added:
`discount_allowed` (6392, indirect expenses), `bad_debts` (6394, indirect expenses), `bad_debts_recovered` (4940, other income).

## How it works

### A1 Payment terms
- Built on the 8G payment schedule (`payment-schedule.ts`): picking a term sets `due_date` to the final instalment,
  fills `payment_schedule` (instalment terms only) and snapshots `payment_terms {id, name, early_discount?}`. The 8G
  `AcceptanceBlock` prints the instalment rows ("Instalment 2 of 3 (40%) · due 12 Dec 2026 ₹35,000");
  `PaymentScheduleBlock` prints the term name and "Pay ₹98,000 by 02 Nov 2026 (2% early-payment discount)".
  The UPI QR keeps the full amount.
- A new document for a client with a default term pre-selects it; editing the due date (or a due chip) by hand
  clears the term to "Custom". When the issue date or total changes the picked term is worked out again — that is
  how converted / copied documents are "recomputed on issue". Recurring schedules carry `payment_terms_id`.
- Reminders and ageing already follow the earliest unpaid instalment (`effectiveDueDate`, 8G); ageing buckets stay
  on that date.
- MSME note: with a seller Udyam number, a buyer GSTIN and a final due date more than 45 days after issue, the editor
  shows a non-blocking Sec 43B(h) note.

### A2 Settlement
- "Settle the rest" appears when a receipt is below the due: Leave open (default), Early-payment discount (pre-filled
  from `payment_terms.early_discount` when the receipt date is on or before `until`) or Short payment / kasar.
- The receipt and the note are one all-or-nothing step (`withTablesRollback`). The note: `CREDIT_NOTE`,
  `note_kind: 'financial'`, one 0% line, `gst_mode: 'NONE'`, linked by `doc_links` (`credit_note`), numbered
  `FCN/FY…` (series counter), period-lock checked on its own date. `amountDue` needed no change.
- GST variant (company setting, settlement discounts only): GST pro rata over the invoice's rates
  (`price_includes_tax`, so the note total is the discount) — reported in GSTR-1 CDNR / CDNUR like any discount note.
- Left out without GST: GSTR-1 (CDNR / CDNUR / HSN / Table 13), GSTR-3B (it reads GSTR-1's documents), GSTR-9 /
  9C / IFF (they build on the same report), e-Invoice (`eInvoiceDocType` → null, preflight error, bulk file refuses),
  e-Way (preflight error), GST exception list. Included in receivables, statements, Day Book, the party ledger.
- Ledger: Dr Discount allowed (or the configured short-payment account: discount allowed / round off / other
  expenses) / Cr party. Tally XML: Credit Note voucher to "Discount Allowed" / "Bad Debts Written Off" (Indirect
  Expenses), no GST ledgers, no stock lines. Books P&L (accrual): an indirect expense named by the reason; cash basis:
  nothing (the discounted part was never income).
- Dashboard revenue (`stats.ts`): a financial note is an expense, not a reduction of billed revenue (documented
  choice, PRD open question 10); it still settles the bill's outstanding. Reports → Sales (by customer / item / month,
  tax by rate) follow the same rule and leave financial notes out (QA5 F13), so sales there agree with the P&L. The
  tax of the GST variant is in the GST reports only.
- Composition returns (CMP-08, GSTR-4, the GSTR-4 e-commerce TCS estimate) leave out a no-GST financial note, like
  GSTR-1: kasar never lowers composition turnover (QA5 F3).
- Clerk cap: the lower of ₹100 and 2% of the bill (company setting). Above it the note is saved as a draft
  with `approval.state = 'pending'` and waits in the existing approval queue; a pending note reduces nothing, but it
  reserves its amount: a further note may settle only the due less the pending notes (`settleableOn`). On approval the
  bill must still owe the note (`assertNoteStillSettles`), else the owner is told to reject it (QA5 F1). The cap is in
  rupees: a foreign-currency amount is converted at the bill's rate first (QA5 F18).
- Removing a receipt never cancels its note; the payment dialog offers to cancel the bill's settlement notes.

### A3 Write-off (on the 8G `write_off` payment flag)
- Single write-off from an overdue bill row in Receivables → Ageing: reason, date (must be open), owner PIN when a PIN
  is set up. Bulk write-off stays in the 8G bulk dialog (bucket filter). Both now require `doc.deleteIssued` (owner).
- Ledger: Dr "Bad debts written off" / Cr party (was "Other expenses" in 8G). GST untouched; the dialog says so.
- Register (Receivables → Collections): party, bill, written off, date, reason, recovered, net; CSV and Excel.
- Amount: the true amount due (`amountDue`, linked credit notes and FCNs applied), never total − paid (QA5 F2).
- Recovery: same FY → the write-off row is reduced and the money is a normal receipt; earlier FY → a Receipt voucher
  Dr Cash / Bank, Cr "Bad debts recovered". Same FY with the bill or write-off inside the period lock → the same
  voucher, dated the day the money came in (mode `locked_period`, QA5 F11). All logged in `write_off_recoveries`.
  Undo (owner) removes the row; `payments.remove` itself requires `doc.deleteIssued` for a write-off row, and the
  payment dialog offers no receipt print for it (QA5 F12).
- Exclusions are automatic: a written-off bill is settled, so reminders, the khata queue, credit-limit exposure and the
  cash forecast skip it, and it is no longer in receivables (DSO numerator). Write-off rows are not "received" in the
  monthly collections table.

### A4 Follow-ups
- A promise is KEPT when money received from the party between the day it was made and the promised date reaches the
  amount (receipts are shared out over overlapping promises, earliest promised date first, each used once —
  `promiseAllocation`, QA5 F20); BROKEN when the date has passed without that (partly kept = broken with some money); OPEN otherwise.
- While a promise is open, `pendingReminders` (`isHeld`) and the khata queue (`heldParties`) skip the covered bills
  (all bills for "on account") until the promise date; after a broken promise (`isFirm`, last 90 days) the next
  reminder suggests at least the firm stage.
- Follow-ups tab: Today, Overdue actions, Promises due, Broken, Kept (30 days); a later note supersedes earlier next
  actions; WhatsApp uses the existing `buildPartyReminder`.
- Bell: "N promises to pay due today" (warning) and "N promises broken" (critical, last 7 days); ids fingerprint the
  promise ids.
- Party timeline: on the statement screen (a card under the ledger) rather than inside the print preview.

### A5 Reminder schedule
- Defaults equal the old behaviour (3 days before, polite from day 1, firm after 7, final after 30; cooldown 3, final 7),
  so existing tests pass unchanged. Out-of-order stored values fall back to the defaults.
- Templates per stage and language (English, Hinglish); blank or with an unknown placeholder → built-in text. The 8H
  regional languages keep their own wording (templates apply to English / Hinglish).
- `reminder_mode`: `auto` (default), `manual` (only on demand — not in the queues), `never` (badge in Receivables).
  No per-party language field (8H owns that).
- The Dashboard reminders card (`share/RemindersPanel.tsx`) is now a lazy chunk of its own: it applies the schedule,
  modes, promises and grades (`reminder-context.ts` `panelOptions`) and loads right after first paint. The schedule
  checks and template validation live in `reminder-schedule.ts`; `reminders.ts` only takes an already-checked
  `extras.template`. Net effect on first paint: −1.4 kB gz against the lead branch (180.4 → 179.0 kB).

### A6 Statement styles
- Balance forward (the original paper), Open items (original, credited, received, open, days overdue; unallocated
  credits; balance due = party net), Transactions (no opening / closing balance). Optional ageing strip
  (Current, 1–30, 31–60, 61–90, 90+) as of the statement's "to" date. Same paper in Print / PDF / Share PDF / web page;
  the WhatsApp text is unchanged. Bulk statements skip parties with no activity in range (balance forward /
  transactions) and parties with no open balance (open items).

### A7 Payment score
- From bills settled in the last 12 months: amount-weighted days late (settlement day = when receipts, advance
  adjustments, TDS and linked credit notes cover the bill), on-time %, longest delay, promises kept / broken, trend vs
  the previous 12 months. Grade A (on time ≥ 80% and not late on average), B (≤ 15 days), C (≤ 45), D (later); two or
  more broken promises outnumbering kept ones, or a written-off bill, lower it one step. < 3 bills: "Not enough history".
- `reminderPriority` weight change: grade C +5, D +10 (A / B / none: 0), documented and tested.

## Deviations from the PRD
1. **A1 snapshot shape.** The schedule lives in the 8G `payment_schedule` field (as the lead asked); `payment_terms`
   holds `{id, name, early_discount}` instead of a second copy of the schedule.
2. **A2 `financial_account`.** An extra snapshot field on the note so a later change of the short-payment account never
   re-posts old notes (Critical Rule 3 spirit). Default accounts per reason in `financial-note.ts`.
3. **A3 model.** Built on the 8G `write_off` payment flag (lead's instruction), not on bad-debt financial credit notes;
   `financial_reason: 'bad_debt'` is kept in the type for completeness and is read (ledger / Tally / score) if present.
   `write_off_recoveries` stores same-FY recoveries too (the register needs them).
4. **A4 timeline** is a card on the statement screen, not a side panel inside the A4 print preview.
5. **Tests** for the GSTR-1 / e-Invoice exclusions live in `tests/settlement.test.ts` instead of
   `gst-reports.test.ts` / `einvoice.test.ts`.
6. **MSME note** needs a seller Udyam number, so `SenderProfile.msme_udyam` was added (edited in the Payment terms panel).
7. A6's "configured slabs" are not read: the strip uses the fixed receivables buckets.
8. Bundle: the Dashboard reminders card became lazy (Dashboard.tsx, one `lazy()` line); payment scores on Receivables
   load after the screen (`collections/aging-extras.ts`), the editor's grade line is `collections/CreditScoreLine.tsx`
   (lazy), and the client-form fields are lazy in `ClientFormModal`. The few Receivables strings live in
   `i18n/areas/collections-rcv.ts` so the route chunk shares no chunk with the lazy collections dialogs.
9. R2-B's `partyRecipients` (contact persons) is not used by the reminder templates yet.

## Verify with your CA

Consolidated in `docs/CA_REVIEW.md` (ids G8, G9, T13, T21, T22, AC7, AC17); answers are logged there with the date and the PR.

- **Settlement discount and GST** — default financial note carries no GST (Circular 92/11/2019-GST as understood);
  the GST variant is only for discounts agreed before / at supply with ITC reversed by the buyer (Sec 15(3)(b)).
- **Bad debts** — no output-GST relief; income-tax deduction on write-off (Sec 36(1)(vii)); recovery taxed (Sec 41(4));
  TDS already deducted by the customer on a written-off bill.
- **MSME 45-day note** (Sec 43B(h)) — usefulness, buyer type, Udyam category.
- **Early-pay discount and TDS / TCS** — TDS on the gross invoice and the TDS receivable register after a discount note.

## Wiring for the lead (shared files touched, one `// R2-A` block each)
`src/types/invoice.ts` (A owns), `src/store/useInvoiceStore.ts` (`RECORD_KEYS` appended), `src/store/invoice-defaults.ts`
(normalizeRecord keeps the new fields), `src/lib/localDb.ts` (master-only fields stripped from snapshot upserts),
`backup.ts`, `access.ts`, `audit-edits.ts`, `sync-engine.ts`, `CommandPalette.tsx` (+ `command/collections-destinations.ts`),
`TemplateEngine.tsx` (one line after `PartyBalanceBlock`), `ClientFormModal.tsx` (one line after the credit fields),
`Settings.tsx` (two lazy panels in the Defaults tab). ROADMAP / ARCHITECTURE / AGENTS rows are for the lead.
