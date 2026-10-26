# QA round 3: hands-on audit of the built app

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `2cbe512` (R2-A, R2-B and R2-C
merged). `dist/` was rebuilt from that commit and every P0 and P1 finding was reproduced on it again.
Method: Playwright (Chromium) against the production build served with the real headers (`scripts/lib/harness.mjs`).
Viewports were 1366×768 and 390×844, in light and dark mode, with persistent browser profiles. Most journeys used an
own company ("Asha Traders", GSTIN 27AAPFU0939F1ZV, Maharashtra) with hand-made data. The rest used the sample-data set.
Scripts: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa/*.mjs`.
Screenshots: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa/shots/`. Below,
`shots/` means that folder.

This doc reports bugs and friction only. It proposes no new features.

Severity: **P0** means data or money is wrong. **P1** means a flow is broken. **P2** means friction or a visual problem.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| F1 | P0 | POS | The cashier-shift X/Z report ignores refunds, so the expected cash in the drawer is too high |
| F2 | P0 | Khata / receivables | POS cash refunds never reduce the party's credit: Walk-in shows "Advance", and "You'll give" is overstated |
| F3 | P0 | Quotations | The post-save sheet lets you record a payment against a quotation. The money is receipted but missing from the Dashboard and the khata |
| F4 | P1 | First run | "Explore with sample data instead" opens an **empty** Demo company and starts the wizard again |
| F5 | P1 | Dashboard | "Try with sample data" reloads before the data is written, so nothing is added |
| F6 | P1 | Recurring | The list is stale after the schedule's first auto-run, and "Run now" then pulls next month's invoice forward (a duplicate, and number gaps) |
| F7 | P1 | POS (phone) | The Z report at 390 px hides its value column. The Return / exchange dialog scrolls sideways |
| F8 | P2 | GST | HSN summary: lines without HSN are merged under the first line's description ("NA · Steel rack" also holds Banquet chairs) |
| F9 | P2 | GST / editor | Every rate picker still offers 12% and 28% for current dates. GST guards then flag 12% as "not in the slab table" |
| F10 | P2 | GST | No warning when the client GSTIN is the supplier's own GSTIN (a B2B row to yourself) |
| F11 | P2 | Expenses | Quick expense "Amount (₹)" means *before GST* but is not labelled so. Typing a receipt total inflates the expense |
| F12 | P2 | Purchases | Esc (or the backdrop) closes "Add purchase bill" with no confirm, and every typed line is lost |
| F13 | P2 | Backup | The nudge says "over a week since your last backup" on a new account. The Data tab still says "never" after a download |
| F14 | P2 | Backup | The restore confirm names the backup by a UUID ("Restore this backup? 7f584e9d-… contains 10 invoices") |
| F15 | P2 | Dashboard vs Receivables | Two different "outstanding" figures: ₹50,150 on the Dashboard, ₹48,302 net on Receivables |
| F16 | P2 | POS | The Z report does not prefill the shift float, and it shows "Short ₹X" before any cash is counted |
| F17 | P2 | Design Studio | The "Compact" preset hides the discount column (and the UPI QR), so printed lines no longer add up |
| F18 | P2 | Annual pack | A mid-year pack is headed "As at 31 Mar 2027" while it holds figures to date |
| F19 | P2 | i18n | Marathi is English on most screens it claims (Dashboard checklist, editor, POS, Clients, wizard). Hindi has leftovers |
| F20 | P2 | First run | The demo choice is only on the last wizard step, after a required business name, and it throws away what you typed |
| F21 | P2 | Editor | "1 · Document" is collapsed **below** "3 · Items". Doc type sits behind "Edit". There are four Save controls, including a select labelled "Save" |
| F22 | P2 | Documents | The Convert menu offers both "Convert to Invoice" and "Convert to Tax Invoice". A quotation shows "Due" instead of "Valid until" in the ledger |
| F23 | P2 | Send sheet | The e-mail body carries WhatsApp `*bold*` markers. "…and the next instalment due" appears when there is no schedule |
| F24 | P2 | Catalogue | Items saved from invoices are typed "Service" even with a goods HSN (9403). The stock item and the catalogue are separate, so a short code can only be set in Settings |
| F25 | P2 | Layout | At 130% text on a phone, Settings › Profiles overflows by 172 px and the editor's split-Save select overflows by 50 px |
| F26 | P2 | POS (phone) | Seven toolbar buttons push the cart total and Save below the fold. The phone tab bar has no POS for a Kirana shop |
| F27 | P2 | Shell | The demo company registry calls the user's own company "Main business" (seen in the company switcher) |

No console errors, page errors or CSP violations were seen on any route, in any theme, viewport or language. No route
scrolled sideways at document level at 390 px (100% text). Ordinary actions were well under 500 ms. The exceptions
were adding a user (about 1 s, PBKDF2, expected) and the Demo-company switch (3 reloads).

Maths verified by hand and correct: intra-state invoice (two rates, line discount, shipping, round-off), inter-state
IGST, partial and then full payment, line credit note (discount carried, round-off), quote → tax invoice, POS bill and
Z totals, GSTR-1 overview / B2B / B2CS / CDNR, GSTR-3B 3.1 + 4 + set-off, trial balance, P&L (stock 2,400 → 2,280,
gross profit 40,948, net 27,022.73), balance sheet tie, cash flow, annual pack.

---

## 2. Findings

### F1 — P0 — Shift X/Z report ignores returns, so the expected drawer cash is wrong
- **Repro:** POS → Open shift with a ₹1,000 float. Sell Toor Dal 1kg (₹145, 5%) and Steel rack (₹1,250, 18%), bill
  ₹1,627, cash. Return / exchange → return 1 Toor Dal → refund ₹152 cash. Open the shift panel.
- **Expected:** Returns ₹152. Expected in drawer 1,000 + 1,627 − 152 = ₹2,475.
- **Actual:** "Returns ₹0.00 … expected ₹2,627.00". The day Z report on the same screen does show the ₹152 refund, so
  the two reports disagree. Closing the shift stores a difference that is ₹152 too short.
- **Cause:** `shiftReport` passes only the shift's own bills to `zReport`. `zReturns` then looks up the credit note by
  `credit_note_id` in that list, never finds it, and drops every return.
- **File:** `src/lib/pos-shifts.ts:73-80` (pass all invoices, or the return CNs, to `zReturns`). Caller:
  `src/components/pos-retail/ShiftPanel.tsx:56`.
- **Shot:** `shots/j4b-06-shift-x.png`, `shots/j4b-08-z.png`

### F2 — P0 — POS refunds are invisible to the khata and receivables
- **Repro:** As in F1, refund ₹152 cash on a walk-in bill. Open Clients.
- **Expected:** Walk-in customer is settled (bill 1,627 − receipt 1,627 − CN 152 + refund 152 = 0). Books agree: Sundry
  debtors 54,454 Dr, with walk-in at nil.
- **Actual:** "Walk-in customer — Advance ₹152.00". "You'll give" = ₹1,480 (₹1,632 after two refunds), when it should be
  ₹1,328. Receivables shows Credits 152 and a net outstanding that is too low by the same amount. The refund voucher is
  never read.
- **File:** `src/lib/receivables.ts:249` (`buildReceivables` input has invoices / payments / advances / links, no
  refunds). Callers: `src/lib/khata-actions.ts:36`, `src/lib/khata.ts:483`, `src/lib/bill-allocation.ts:86`. Refund
  rows: `src/lib/pos-returns.ts` (`refunds`, `voucher_id`).
- **Shot:** `shots/j6-01-clients.png`, `shots/j6-05-receivables.png`

### F3 — P0 — A payment can be recorded against a quotation, and it vanishes from every total
- **Repro:** New invoice → Document "Edit" → Type = Quotation → client "Quote Party", Chairs ₹1,000 → Ctrl+S. In the
  post-save sheet: Record payment → ₹500 → Record payment.
- **Expected:** A quotation shows no balance and offers no "Record payment". An advance against a quote goes through
  Advances.
- **Actual:** The sheet shows "Balance on this bill ₹1,180" and the payment dialog accepts the ₹500. The quote becomes
  "Partially Paid" and receipt RCPT/FY26-27/0001 is issued. The Dashboard still shows Received ₹0, and the khata row
  says "Quote Party — Settled". The money exists only on the quote.
- **File:** `src/components/invoicing-ux/SendSheet.tsx:83` (pay button and `ssBalance` shown for any doc type).
  Copy: `src/i18n/areas/invoicing-ux.ts:81-86`. Also guard the payment modal / `localDb` payment add for
  non-revenue docs (`isRevenueDoc` in `src/lib/stats.ts`).
- **Shot:** `shots/j3q-quote-record-payment.png`, `shots/j3-03-quote-sheet.png`

### F4 — P1 — "Explore with sample data instead" gives an empty Demo company
- **Repro:** New account → wizard → CA / full accounting → Next → name → Next → GSTIN → Next → Next → Logo step →
  "Explore with sample data instead".
- **Expected:** The app reloads into a "Demo" company that holds the sample invoices.
- **Actual:** It reloads three times and lands in "Demo" with the wizard at step 1 again: Billed ₹0, 0 of 7 done. The
  IndexedDB for Demo holds only `__meta__` and `schema_version`. `fillDemo` writes and then calls
  `window.location.reload()` straight away, so the queued IndexedDB commit is lost.
- **File:** `src/components/onboarding/demo-company.ts:27,45` (use `reloadAfterFlush()`, as `SampleDataCard` does).
- **Shot:** `shots/dbg-demo-t7.png`

### F5 — P1 — Dashboard "Try with sample data" adds nothing
- **Repro:** A fresh onboarded company → Dashboard → "Try with sample data".
- **Expected:** About 23 sample invoices.
- **Actual:** The page reloads and still shows Billed ₹0, with the card still offered. Settings → Data → "Try with
  sample data" (which uses `reloadAfterFlush`) works.
- **File:** `src/components/dashboard/DashboardStart.tsx:47`.
- **Shot:** `shots/j1c-after-sample.png`

### F6 — P1 — Recurring: stale list, and "Run now" makes an extra invoice
- **Repro:** Open INV/FY26-27/0002 (25 Oct) → Make recurring → keep the defaults (Monthly, first date today) → Create
  schedule. A toast says "1 recurring invoice created as draft". The list still shows "NEXT RUN 25 Oct 2026 · Today ·
  LAST RUN Never · INVOICES 0". Click Run now.
- **Expected:** The list refreshes after the auto-run (Next run 25 Nov, 1 invoice). "Run now" asks before it bills a
  future period. Making a schedule from an invoice dated today does not bill today again.
- **Actual:** INV/0004 is created for October as a duplicate of 0002. Run now creates INV/0005 (period 25 Nov, issue
  date today). Both drafts take FY numbers. If they are deleted, GSTR-1 Documents shows "2 unused numbers … report as
  cancelled".
- **File:** `src/pages/Recurring.tsx:51-63` (only reloads on window focus). Runner: `src/hooks/useRecurringRunner.ts:19-22`.
  Default first date: `src/components/recurring/*` (schedule form). Also check `runNow` in `src/lib/recurring.ts`.
- **Shot:** `shots/j3c-02-recurring-list.png`, `shots/j5c-tab-Documents.png`

### F7 — P1 — POS dialogs break at 390 px
- **Repro (dark, 390×844):** POS → Z report. Separately: Return / exchange → find a bill → type a return qty.
- **Expected:** All values readable, no sideways scroll.
- **Actual:** In the Z report the value column is off-screen, and only the labels show (Bills, Gross sales, Net
  sales…). The Return dialog body scrolls sideways: the bill number, the picker and the table headings are cut off on
  the left once the qty input takes focus.
- **File:** `src/components/pos/ZReportModal.tsx` (+ its CSS module). The return dialog is in
  `src/components/pos-returns/` (the table needs to stack or scroll in its own wrapper).
- **Shot:** `shots/j4b-phone-08-z.png`, `shots/j4b-phone-05-return.png`

### F8 — P2 — HSN summary mislabels lines without HSN
- **Repro:** Two B2B invoices whose lines have no HSN: Steel rack ×4 (INV/0002) and Banquet chairs ×50 (INV/0003). GST
  reports → October → HSN.
- **Expected:** One row per item, or a "No HSN" row without a misleading description.
- **Actual:** "NA · Steel rack · NOS · 54 · 47,223.00" holds both items.
- **File:** `src/lib/gst-reports.ts:~1002` (the group key ignores the description, and the first line's `desc` wins).
- **Shot:** `shots/j5c-tab-HSN.png`

### F9 — P2 — Rate pickers ignore the date-keyed slab table
- **Repro:** Editor, purchase bill, quick expense, Settings → Defaults: the GST rate list.
- **Expected:** Rates valid on the document date (12% removed from 22 Sep 2025, per `gst-guards.ts:228`), or a warning
  inline.
- **Actual:** 12% and 28% are offered with no hint. GST guards later say "Rate 12% is not in the GST slab table for the
  document date" (INV/FY26-27/0001).
- **File:** `src/lib/tax-rules.ts:154` (`GST_SLABS` is static) against `src/lib/gst-guards.ts:220-228`. Pickers:
  `src/components/creator/ItemsTable.tsx`, `src/components/purchases/ExpenseModal.tsx`, the bill modal, Settings defaults.
- **Shot:** `shots/j5c-tab-GST_guards.png`

### F10 — P2 — Client GSTIN equal to your own GSTIN is accepted silently
- **Repro:** Invoice to "Nashik Hotels" with GSTIN 27AAPFU0939F1ZV (the seller's own) → save → GST reports.
- **Expected:** A warning in the editor, or a GST-guards exception.
- **Actual:** It is reported as a normal B2B row, with no guard.
- **File:** `src/lib/gst-guards.ts` (exceptions list). The editor hint goes in `src/components/creator/PartiesSection.tsx`.
- **Shot:** `shots/j5c-tab-B2B.png`

### F11 — P2 — Quick expense amount is ambiguous
- **Repro:** Expenses → Quick expense → Rent, Amount 11,800, GST 18%.
- **Expected:** The label says whether GST is included. Most receipts give the total.
- **Actual:** Taxable ₹11,800 + GST ₹2,124 = ₹13,924 is booked. Rent in the P&L is ₹13,924.
- **File:** `src/components/purchases/ExpenseModal.tsx` (`#exp-amt` label; offer "includes GST").
- **Shot:** `shots/j5b-01-qe-filled.png`

### F12 — P2 — Esc closes a filled purchase bill without asking
- **Repro:** Expenses → Add bill → pick a vendor, bill no., line 1 → press Esc → Add bill again.
- **Expected:** A "Discard this bill?" confirm, or a kept draft.
- **Actual:** The dialog closes. When it reopens, every field is empty.
- **File:** the purchase bill modal in `src/components/purchases/` (dirty-guard on `onClose`), or a shared `Modal` option.
- **Shot:** `shots/j5-01-add-bill.png`

### F13 — P2 — Backup nudge copy and stale status
- **Repro:** A new account with one invoice → after about 3 s the banner reads "It has been over a week since your last
  backup." Settings → Data → Download backup.
- **Expected:** "You have not backed up yet" for a new account. The status updates on download.
- **Actual:** The copy is wrong for never-backed-up. "Last backup: never" stays until a reload, even though
  `last_backup` is set.
- **File:** `src/components/pwa/BackupNudge.tsx` + `src/i18n/areas/pwa.ts:11`. `src/components/settings/DataPanel.tsx:112-128`
  (re-read the status after `markBackupDone`).
- **Shot:** `shots/j4b-ERR.png` (banner), `shots/j7c-backup-status.png`

### F14 — P2 — The restore confirm shows a UUID
- **Repro:** Settings → Data → Restore from file → pick a backup from the Demo company.
- **Actual:** "Restore this backup? 7f584e9d-10c0-496c-9e97-0a1d24450c1f contains 10 invoice(s)…".
- **Expected:** The business or company name, plus the backup date.
- **File:** `src/components/settings/DataPanel.tsx` (restore summary). Copy: `src/i18n/areas/settings.ts:170`.
- **Shot:** `shots/j7b-04-restore-confirm.png`

### F15 — P2 — Dashboard and Receivables disagree on "outstanding"
- **Repro:** With a credit note on a paid invoice (₹1,328 owed to Pune Mart) and an on-account receipt.
- **Actual:** Dashboard "Outstanding ₹50,150 · 22% collected". Receivables "Net outstanding ₹48,302 · collection
  efficiency 23.03%".
- **Expected:** The same figure, or labels that say gross versus net of credits.
- **File:** `src/lib/stats.ts` against `src/lib/receivables.ts`.
- **Shot:** `shots/j6-05-receivables.png`

### F16 — P2 — Z report drawer section
- **Repro:** Open a shift with a ₹1,000 float → bills → Z report.
- **Actual:** The Opening float field is empty. "Expected in drawer ₹3,102 · Short ₹3,102" shows before anything is
  counted, and the shift panel likewise shows "difference −₹2,627" before a count.
- **Expected:** The float is taken from today's shifts, and no Short/Over until a count is typed.
- **File:** `src/components/pos/ZReportModal.tsx`, `src/components/pos-retail/ShiftPanel.tsx`.
- **Shot:** `shots/j4b-08-z.png`

### F17 — P2 — The Compact preset makes printed lines look wrong
- **Repro:** Design Studio → Compact → Save design → preview INV/0001 (Steel rack 3 × 1,250 with a 10% discount).
- **Actual:** The row prints "3 NOS · 1,250.00 · Taxable 3,375.00" with no discount column. The preset also turns off
  the UPI QR.
- **Expected:** Keep the discount column when any line has a discount, or say on the preset card what it hides.
- **File:** the presets in `src/lib/design-prefs.ts` / `src/components/design/`.
- **Shot:** `shots/j7e-preview-compact-discount.png`

### F18 — P2 — The annual pack is dated year-end during the year
- **Repro:** Books → Reports → Annual pack in October 2026.
- **Actual:** "Balance sheet · As at 31 Mar 2027" and "For the year ended 31 Mar 2027", with figures as of 25 Oct.
  Books → Balance sheet correctly says "as at 25 Oct 2026".
- **File:** `src/lib/ledger/annual-pack.ts:279` (use the as-of date, or label it "Draft, to date").
- **Shot:** `shots/j5e-annual-desk.png`

### F19 — P2 — Marathi is mostly English; Hindi has leftovers
- **Repro:** Settings → Language → मराठी, then visit the screens (and do the same with हिन्दी).
- **Expected:** What `docs/features/i18n.md` § Coverage (8H) claims for mr: Dashboard, editor main surface, POS and
  Clients translated.
- **Actual (mr):**
  - Wizard step 0 subtitle, intro and business types are in English.
  - Dashboard "Get set up" checklist and "Payments to chase" are in English.
  - Editor: "Fill in the details, then save.", "Cash sale (walk-in)", "More details…", "Payment schedule", "Summary and
    tax", "Other charges", "Fully paid" are in English.
  - Clients: "You'll get / You'll give", "Remind all overdue", "Sort" are in English.
  - POS: "Open shift", "Hold & new", "On hold", "Return / exchange", "Save & print", "New bill" are in English.
- **Actual (hi):**
  - "Sold through an e-commerce operator" (editor) is in English.
  - Day Book voucher types and expense categories (Sales, Receipt, Rent, Software & subscriptions…) are in English.
  - Design Studio preset descriptions and sample labels are in English.
  - "Valid GSTIN" is in English.
  - The label "भाषा / भाषा" is duplicated.
- No overflow from Devanagari was found.
- **File:** `src/i18n/mr.ts` (`phrases`: add the area English strings), `src/i18n/hi.ts` / areas `editor.ts`, `books.ts`,
  `design.ts`, `settings.ts`. Wizard: `src/components/onboarding/SetupWizard.tsx:156` (label), `src/i18n/areas/reach.ts`.
- **Shot:** `shots/j1-desk-light-02b-wizard-marathi.png`, `shots/tour-demo-phone-dark-mr_pos.png`,
  `shots/tour-demo-phone-light-hi_books.png`, `shots/j1-desk-light-02-wizard-hindi.png`

### F20 — P2 — The demo choice is buried in the wizard
- **Repro:** Wizard: the "Explore with sample data instead" button is only on step 5 (Logo). The business-name step
  must be filled to get there.
- **Expected:** Offer it on step 1, next to "Skip for now".
- **Actual:** Everything typed is then discarded: the main company has no settings afterwards.
- **File:** `src/components/onboarding/SetupWizard.tsx:262-266`.
- **Shot:** `shots/j1-desk-light-06-wizard-logo.png`

### F21 — P2 — Editor layout and labels
- Section "1 · Document" is collapsed into a one-line strip **after** "3 · Items". The page starts at "2 · Parties".
- Doc type (Quotation, Proforma…) is reached only via that strip's "Edit".
- Four save controls: Save (top), Save draft, "Save invoice", and a select whose accessible name is "Save" ("What to do
  after saving").
- The due-date chip "45d" wraps onto its own line at 1366 px.
- The total in words shows a bare "Zero" for ₹0.
- **File:** `src/pages/InvoiceCreator.tsx`, `src/components/creator/DocumentMetaCard.tsx`, `SummaryPanel.tsx`.
- **Shot:** `shots/ss-demo-desk-light_invoice-s1.png`, `shots/j3-01-doc-edit.png`

### F22 — P2 — Document labels
- From a quotation, the Convert menu lists "Convert to Tax Invoice" **and** "Convert to Invoice".
- The ledger shows a converted quotation as "Due 8 Nov 2026" (it should say valid until).
- The recurring "Start from" list offers credit notes as templates.
- **File:** `src/lib/documents.ts:85` (`TRANSITIONS`), `src/pages/Transactions.tsx`, the recurring form in
  `src/components/recurring/`.
- **Shot:** `shots/j3b-04-ledger.png`

### F23 — P2 — Send sheet copy
- The `mailto:` body starts with "*Invoice INV/…*". WhatsApp bold markers end up in e-mail.
- The hint "The message includes the balance and the next instalment due." appears on invoices with no instalment
  schedule.
- **File:** `src/components/invoicing-ux/SendSheet.tsx`, `src/i18n/areas/invoicing-ux.ts:86`.
- **Shot:** `shots/j2-02-postsave-sheet.png`

### F24 — P2 — Catalogue versus stock item
- Items auto-saved from invoices appear in Settings → Items & rates as type "Service" even with HSN 9403 / 7318 (goods).
- Inventory "Add stock item" has a barcode field but no short code. Short codes live only in the separate Settings
  catalogue.
- The POS found the stock item by barcode, so scanning works.
- **File:** the catalogue auto-save in `src/lib/localDb.ts` (item upsert on invoice save),
  `src/components/settings/CatalogPanel.tsx`, the Inventory item dialog in `src/components/inventory/`.
- **Shot:** `shots/j4-03-settings-items.png`

### F25 — P2 — Overflow at 130% text on a phone
- **Repro:** Display preferences 130% (Settings → Security) at 390 px.
- **Actual:** Settings › Profiles card: `main` scrollWidth is 562 against 390 (the "Add" button and the profile list run
  off the right). Editor: the split-Save select reaches 440.
- **File:** the Settings profiles panel CSS (`src/components/settings/*.module.css`, `_profileList`), and
  `src/components/creator/SummaryPanel.module.css` / `MobileSaveBar`.
- **Shot:** `shots/tour-demo-phone-light-en-s130_settings.png`

### F26 — P2 — The POS on a phone
- Shift, Customer display, Hold & new, On hold, Return / exchange, Printer and Z report take about 300 px. The cart
  total, the tenders and Save bill are below the fold.
- In Kirana shop mode the phone tab bar is Home / Invoices / New / Clients / More, with no POS.
- **File:** `src/pages/Pos.tsx` (toolbar → overflow menu on small screens), the phone tab bar in `src/components/layout/`.
- **Shot:** `shots/j4b-phone-02-pos-scanned.png`

### F27 — P2 — "Main business" in the company switcher
- After the Demo company is created, the user's own company is listed as "Main business" rather than its profile name.
- **File:** `src/lib/company-registry.ts` (default entry name).
- **Shot:** `shots/dbg-demo-t7.png`

### Also noted (not counted as findings)
- GST reports open on the previous month (September), which is the right default for filing. A user who has just
  issued October invoices sees "No reportable tax documents"; the period picker is right there.
- The P&L shows a net round-off expense as "Other (indirect) income −1.27".

---

## 3. Fix packages

The two packages touch mostly disjoint files. QA-1 owns money and data in POS / khata / recurring / sample data. QA-2
owns documents, GST papers, settings and i18n. One file is shared: `src/i18n/areas/invoicing-ux.ts` is QA-2 only.

### QA-1 — money and data paths
| Finding | Files |
|---|---|
| F1 shift returns (P0) | `src/lib/pos-shifts.ts`, `src/components/pos-retail/ShiftPanel.tsx` |
| F2 refunds in the khata / receivables (P0) | `src/lib/receivables.ts`, `src/lib/khata-actions.ts`, `src/lib/khata.ts`, `src/lib/bill-allocation.ts`, `src/lib/pos-returns.ts` |
| F3 (data-layer guard half) | the payment add path in `src/lib/localDb.ts` / payment modal: refuse non-revenue docs |
| F4 Demo company empty (P1) | `src/components/onboarding/demo-company.ts` |
| F5 Dashboard sample data (P1) | `src/components/dashboard/DashboardStart.tsx` |
| F6 recurring stale list / Run now (P1) | `src/pages/Recurring.tsx`, `src/hooks/useRecurringRunner.ts`, `src/lib/recurring.ts` |
| F7 POS phone dialogs (P1) | `src/components/pos/ZReportModal.tsx` (+css), `src/components/pos-returns/*` |
| F15 Dashboard vs Receivables | `src/lib/stats.ts` |
| F16 Z drawer section | `src/components/pos/ZReportModal.tsx`, `ShiftPanel.tsx` |
| F26 POS on a phone | `src/pages/Pos.tsx`, phone tab bar in `src/components/layout/` |
| F27 company name | `src/lib/company-registry.ts` |

Tests to add: `shiftReport` with a return, receivables with a POS refund, a payment against a quotation refused, and an
e2e step for "Explore with sample data" that ends with invoices present.

### QA-2 — documents, GST, settings, i18n
| Finding | Files |
|---|---|
| F3 (UI half: no balance / pay on quotes) | `src/components/invoicing-ux/SendSheet.tsx`, `src/i18n/areas/invoicing-ux.ts` |
| F8 HSN description | `src/lib/gst-reports.ts` |
| F9 date-aware rate pickers | `src/lib/tax-rules.ts`, `src/components/creator/ItemsTable.tsx`, `src/components/purchases/ExpenseModal.tsx`, bill modal, settings defaults |
| F10 own-GSTIN guard | `src/lib/gst-guards.ts`, `src/components/creator/PartiesSection.tsx` |
| F11 expense amount label | `src/components/purchases/ExpenseModal.tsx` |
| F12 bill dialog dirty guard | purchase bill modal in `src/components/purchases/` |
| F13 / F14 backup copy, status, restore name | `src/components/pwa/BackupNudge.tsx`, `src/i18n/areas/pwa.ts`, `src/components/settings/DataPanel.tsx`, `src/i18n/areas/settings.ts` |
| F17 Compact preset | `src/lib/design-prefs.ts`, `src/components/design/` |
| F18 annual pack date | `src/lib/ledger/annual-pack.ts` |
| F19 Marathi / Hindi strings | `src/i18n/mr.ts`, `src/i18n/hi.ts`, `src/i18n/areas/{editor,books,design,settings,reach}.ts` |
| F20 demo CTA placement | `src/components/onboarding/SetupWizard.tsx` |
| F21 / F22 / F23 editor & document labels | `src/pages/InvoiceCreator.tsx`, `src/components/creator/{DocumentMetaCard,SummaryPanel}.tsx`, `src/lib/documents.ts`, `src/pages/Transactions.tsx` |
| F24 catalogue item type | catalogue upsert in `src/lib/localDb.ts` (coordinate with QA-1's F3 guard in the same file, which touches a different function), `src/components/settings/CatalogPanel.tsx` |
| F25 130% overflow | Settings profiles CSS, `src/components/creator/SummaryPanel.module.css` |

Overlap to coordinate: `src/lib/localDb.ts` (QA-1 payment guard, QA-2 catalogue upsert). Everything else is disjoint.
