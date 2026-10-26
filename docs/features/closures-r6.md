# R6-C — Open-roadmap closures and the docs refresh

Package C of `docs/prd/round-6.md` (§4 R6-C1–C6, §5). Six items that change testers' numbers or block their migration,
plus the documents refresh. No new route, vertical or rule table; every screen is in an existing lazy chunk.

## What was built

### C1 — R4-A follow-ups (QC hold on bills, landed cost in margins, QC-reject debit note)

- **QC hold on bills.** `purchasesDb.save` runs `withBillQcHold` (`purchases.ts`): new goods lines of a bill booked
  without a GRN (no `grn_line_id`) follow the GRN rule (`applyQcHold`: a `qc_on_receipt` item, or `qc_settings.hold_all`,
  with no godown goes to the QC hold godown). Expenses are left alone. On an edit only lines that were not on the bill
  before are held, so goods already released are never moved back.
- **Landed cost in margin figures.** `margin.ts` gains `liveCostPurchases()` (= `liveInputs().purchases`, the stock
  engine's copies with landed-cost vouchers applied) and `liveUnitCosts()`. The editor margin chip and the insights tile
  (margin erosion; the stock-at-risk card already used engine positions) read them. Stored bills never change; the GST /
  expense cards are unaffected because the copies keep the bill's totals.
- **Debit note from a QC reject.** For a lot received on a bill, the QC desk's reject dialog links to
  `/expenses?tab=returns&new=dn&bill=<id>&lines=<lineId>:<qty>,…` (`debitNotePrefillHref`); the Returns tab reads
  `bill` / `lines` once on mount (`parseDebitNotePrefill`) and opens the debit note with the bill and the quantities
  filled (`ReturnModal` `initialQty`, additive).
- **Inventory → "Landed cost" link**: R6-B adds the header line (href `/manufacturing?tab=landed`), per §6.

### C2 — Payables completeness

- **Supplier opening bills in bill-wise payables.** `opening-bills.ts` `payableOpeningBills` / `loadPayableOpeningBills`
  (read helper, mirror of the receivable one: payable bills plus an "On Account" line for a typed creditor opening not
  split into bills). `billwisePayables` takes them as `openingBills`: a Cr bill ages from its own date / due date as a
  `BillRef` keyed `opening:<id>` (`opening: true`); a Dr bill is an open item on the supplier's side. They settle Agst
  Ref through `vendor_payments.allocations[]` rows with the additive `opening_bill_id` (`purchase_id: ''`):
  `recordSupplierPayment` routes `opening:` allocations onto the payment's `vendor_payments` row (validated against the
  bill's open balance, `openingBillBalances`), and `adjustAgainstBill` adjusts an advance against an opening bill. The
  ledger is unchanged (vendor payments already post in full), so the payables net equals the ledger creditor balance
  (test). Bill-wise tab: openings are tagged "Opening" and listed in the payment dialog's allocation picker.
- **TDS on voucher receipts.** `BillAllocation` shows the bill's TDS; the allocation row that clears the bill's cash part
  carries `tds_amount` (`stampVoucherTds`), and `postings.ts` adds `voucherTdsJournal` (Dr TDS receivable, Cr the debtor)
  for receipt rows a manual voucher allocated — the same receipt `tdsSettlements` books on an invoice receipt. The TDS
  register reads the invoice, so the bill shows settled.
- **POS refund bank tag.** `RefundTender.bank_account_id` (additive): `suggestRefund` copies the original receipt's
  account, `tagRefundBanks` fills a typed non-cash tender from the receipt by the same method (else any non-cash
  receipt), and `refundVoucherLines` credits that bank's own ledger (`bankLedgerId`), so multi-account BRS sees it.

### C3 — Import suppliers, ledgers and opening balances (P1-21)

- `ImportKind` gains `vendors`, `ledgers` and `opening_bills` (schemas with header synonyms in `import-mapping.ts`).
  Presets: Vyapar, Zoho, Tally, Busy, QuickBooks, Xero, Refrens, ClearOne and Marg where their exports carry the columns,
  plus a generic **"Trial balance (Name, Group, Debit, Credit)"**.
- `src/lib/import-openings.ts`: `buildOpeningsPreview` (pure dry run) and `applyOpeningsImport`.
  - Amounts: Debit / Credit columns, or a signed balance ("1,200 Dr", a Dr / Cr column, negative = Cr; else the
    group's nature).
  - Groups: user group / sub-group by name or alias, primary by id or label, Tally / Busy / QuickBooks group names; else
    a keyword, else the nearest primary for the balance side — with a warning ("mapped to …").
  - Sundry debtors / creditors rows become party ledgers (`party:debtor|creditor:<id>`; a missing party is created).
  - Existing ledgers are matched by name (opening set, group kept); "Difference in opening balances" rows are skipped
    (the app works it out).
  - Suppliers are matched by GSTIN, then name (existing master and within the file), never duplicated. A party export
    with customers in it (Vyapar's party report) sends customer rows to Clients (party type, else receivable vs payable
    balance).
  - Opening bills: side from the column, else Dr / Cr, else the party master; merged into the party's list by
    reference (`saveOpeningBillsFor` replaces a party's list as a whole, so the existing bills are carried).
  - The dry run shows the **difference in opening balances** (posts to 1090, as `saveOpenings` does) and refuses the
    locked opening day.
  - Writing is **all or nothing**: refused while a row has an error; every write goes through `vendorsDb.save`,
    `localDb.clients.upsert`, `saveUserAccount` (codes `IM-<n>`), `saveOpenings`, `saveOpeningBillsFor` inside one
    `withTablesRollback`. The wizard takes one undo copy first (`saveSafetySnapshot('import')`, like the Tally import).
- **`import_runs`** (company table, one row per import run of any kind: `{id, at, kind, file_name?, created, updated,
  skipped, errors, opening_difference?}`) — R6-A's checklist "import" step reads it. Registered in `backup.ts`
  (record + id table), `access.ts` (`books.edit`), `audit-edits.ts`, `sync-engine.ts` (dated by `at`) and the open-export
  schema.
- Entry points: Settings → Data & backup → "Suppliers, ledgers & openings"; `?import=1` / `?import=<kind>` opens the
  wizard (setup checklist link).

### C4 — Filing strip follow-ups and Rule 42 / 43 reversals everywhere

- `src/components/gst-reports/FilingStrip.tsx` (moved out of `GstReports.tsx`): the forms follow the period and the filer
  (`stripForms`): GSTR-1 + 3B (monthly; a QRMP quarter or its last month), **IFF** in QRMP months 1–2, **CMP-08** for a
  composition quarter (the strip now shows for composition profiles too). "Mark filed" writes the Compliance tab's rows
  (`stripReturn` gives the same ids as the calendar).
- **"Downloaded" survives a reload**: additive `FiledReturn.downloaded_at` on the period's compliance row
  (`setDownloaded` / `downloadedFor` / `rememberDownload`). A row may now carry `filed_on: ''` (downloaded, not filed):
  `filedFor`, the amendment check and the GSTR-4 late-fee reader treat only a non-empty `filed_on` as filed; marking /
  clearing filed keeps the download.
- **Per-form preflight**: `buildPreflight(input, form)` — IFF skips the HSN checks (`HSN_CODES`), CMP-08 runs only the
  composition checks (`COMPOSITION_CODES`).
- **`itcReversals` everywhere**: `buildGstr9` takes them (each month's 3B 4(B)(1) and Table **7C** for the FY), as do
  GSTR-9C, the Compliance tab's late-fee / interest base and the month-end pack. A test proves Table 7C equals the
  month's 3B 4(B)(1).

### C5 — Party-balance snapshot on documents issued outside the editor (8.7)

- `khata-actions.ts` `withIssueSnapshot(record, stored?, cache?)` applies the editor's rule
  (`nextPartyBalanceSnapshot`): a draft takes none, an issued document keeps its own, a document being issued now takes
  a fresh one. `issueDraft(id)` issues a stored draft without the editor (number on issue in `localDb`).
- Called by: recurring runs in issue mode (`recurring.ts`), batch runs (`batch-invoices.ts`, one snapshot per party — the
  balance before the run), late fees and conversions issued directly (`createLateFeeInvoice(…, { issue: true })`,
  `convertDocument(…, { issue: true })`). Drafts, converted drafts and legacy documents carry none.

### C6 — Docs refresh

- `docs/ROADMAP.md`: stale rows struck through with what closed them (7.28, 7.49 part, 7.158 part, 7.167 part, 8.7 part,
  8.88 part, 8.164, R4-A6, R5-C7 part, 7.9 P1-21), status line, and the Round 6 / R6-C block.
- Feature docs: stale items struck (`cash-planning`, `cost-centres-budgets`, `inventory`, `freight-fx`, `gst-setoff`,
  `khata`, `printing`, `purchase-returns`, `time-expenses`) and R6-C closures noted (`masters`, `business-extras`,
  `production-r4`, `institutions-property-r5`). Each "Verify with your CA" section points at the consolidated pack.
- `docs/BETA_GUIDE.md`: §6 every interface language, §7 flows F (industry pack) and G (bring your openings over), §8
  known limitations regenerated (top 10 open rows), §4 / §9 matched to R6-B4 / R6-A5.
- `docs/CA_REVIEW.md`: R6-C notes on I22, T12, AC12, AC10, G23 / G41 (no new id) and an answers log.

## Verify with your CA

Consolidated in `docs/CA_REVIEW.md` (ids I22, T12, AC10, AC12, G23, G41); answers are logged there with the date and the PR.

- A combined Rule 42 / 43 journal is reported in GSTR-9 Table 7C (no 7C / 7D split).
- Imported opening balances are the user's figures; the difference is shown, never forced.

## Deviations and deferrals

1. The PRD names `compliance.ts` for the Compliance late-fee base; the build of that base lives in `ComplianceView.tsx`,
   which now passes `itcReversals` (the pure helpers for the strip are in `compliance.ts`).
2. A draft issued from a list without the editor takes a snapshot only through `issueDraft`; the list screens still open
   the editor to issue (which snapshots), so no user path loses it today.
3. Stock opening quantities are not imported (PRD §7 Q7 left open).
4. BETA_GUIDE §4 (Demo company) and §9 (Report a problem v2) were folded in after merging R6-A / R6-B.
5. `amendments.ts` and `gstr4-annual.ts` (not in C's file list) gained a one-condition guard so a download-only
   compliance row is never read as filed; `ledger/postings.ts` gained `voucherTdsJournal`; `settings/DataPanel.tsx`
   gained the import entry point.

## Bundle

Measured with `npm run build && npm run check:size` (see the commit message for the before / after figures).
