# Bill capture, documents inbox, recurring bills, purchase approvals (8C, roadmap 8.40–8.44)

Purchase-side parity with Zoho Books / Xero / QuickBooks / Refrens / TallyPrime 7.0 — without OCR and without any
network call. Bank rules (8.45) are in `banking.md` § Bank rules. Outputs are working papers — verify with your CA.

| | |
|---|---|
| UI | Expenses → **Inbox** tab (`/expenses?tab=inbox[&doc=<inbox id>]`, lazy `components/capture/InboxTab.tsx`): capture card, approvals (owner / waiting items), draft bills, unprocessed documents, recurring bills (`RecurringBillsPanel.tsx`). Approvals tile on the Dashboard also shows the purchase queue (`components/approvals/PurchaseApprovals.tsx`). Bell: lazy `capture-alerts.ts` |
| Lib | `einvoice-qr.ts`, `bill-capture.ts`, `capture-browser.ts`, `doc-inbox.ts`, `purchase-drafts.ts`, `bill-duplicates.ts`, `bill-guard.ts`, `recurring-bills.ts`, `purchase-approval-gate.ts`, `purchase-approvals.ts` |
| Strings | `src/i18n/areas/capture.ts` (`capT`, English + Hindi) |
| Tests | `tests/capture-bank-rules.test.ts`; contract rows in `tests/purchase-contract.test.ts` |

## 8.40 Capture from the e-invoice signed QR
- Sources: camera (`CameraScanner`, BarcodeDetector), photo / screenshot upload (`readQrFromImage`: BarcodeDetector on an
  `ImageBitmap`, full size then a 1600 px copy; decoded **before** the photo is downscaled for storage), or pasted text
  (QR scanner app / USB scanner). **PDFs (PENDING 48)**: no page is rendered (that needs a PDF engine such as pdf.js,
  which the app does not ship, and `html-to-image` / `jspdf` only write PDFs); instead `pdf-images.ts` (lazy) reads the
  image XObjects embedded in the file — JPEG as is, Flate gray / RGB / 1-bit pixels through the browser's
  `DecompressionStream`, PNG predictors reversed — and `readQrFromPdf` runs the BarcodeDetector on each. A QR drawn as
  vector paths, an encrypted PDF or another image filter (CCITT, JBIG2, JPX) is not found: the PDF is kept and the screen
  says so.
- **Full e-invoice JSON (PENDING 48)**: paste the supplier's e-invoice JSON (INV-01 schema, `{data}` wrappers, or the
  IRP's response with `SignedInvoice`) in the paste box, or pick / share a `.json` file. `decodeEinvoiceJson` (≤ 512 KB,
  ≤ 1,000 lines, same field cleaning as the QR) and `draftFromEinvoiceJson` draft **one bill line per invoice line** —
  HSN, quantity, unit, taxable value (AssAmt; quantity 1 at the taxable value when the rate would not be exact), GST rate,
  cess (`cess_amount`), place of supply from `BuyerDtls.Pos` and the supplier's legal name. The "check the GST split" flag
  is set only when the lines do not add up to TotInvVal (other charges / round-off). The JSON's signature is not verified
  and the JSON itself is not kept as an attachment.
- `decodeEinvoiceQr(text)` (pure): `header.payload.signature`, payload `data` (JSON string or object) → SellerGstin,
  BuyerGstin, DocNo, DocTyp, DocDt (dd/mm/yyyy), TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt. **The signature is not
  verified** (needs NIC's key; offline). Untrusted input: text ≤ 4,096 chars, printable text only, doc no. ≤ 16, GSTIN
  checksum / date / IRN (64 hex) / value problems become warnings, never exceptions.
- `draftFromQr(qr, ctx)` (pure): vendor found by GSTIN (else the draft asks for a name → "Add supplier" creates it with the
  GSTIN); bill no. / date / IRN (`einvoice_irn`, `einvoice_irn_date`); one line "As per e-invoice …" with the main HSN.
  The QR has no taxable value or GST split: for a one-item bill whose HSN the HSN master knows, GST is backed out at that
  rate; otherwise the value is kept and the draft is flagged "check the GST split". Place of supply = the supplier's state
  when it differs from ours (IGST), else ours. BuyerGstin not among our profiles → warning (`draft.foreign_buyer`) and no
  ITC by default. A supplier credit note (CRN) is not drafted ("record it under Returns").
- Posting runs through the bill form; the posted total is compared with the QR value (soft warning).

## 8.41 Inbox and draft bills
- `doc_inbox` (`InboxDoc`): file (attachment ref), source (upload / camera / share / paste), intent, decoded QR, note,
  `draft_id`, status new / done / dismissed. Bounded to 300 rows (oldest finished rows pruned, files released).
- `purchase_drafts` (`PurchaseDraft` = `PurchaseRecord` + `status: 'draft'` + `draft` meta: source capture / recurring /
  approval / manual, inbox id, expected total, review flags, approval, pay-now). **No report reads this table**, so drafts
  are out of the books like a pending sales draft. If a draft row ever reached `purchases`, every `readPurchase` reader
  skips it (`isVoidStatus('draft')`) and `purchasesDb.save` drops `status: 'draft'` and the envelope.
- "Review & post" opens the normal bill / expense form on the draft (the draft id becomes the bill id); the save
  (`saveBillGuarded`) removes the draft and marks the inbox row done, all or nothing.
- **API for the PWA share target** (another feature): `openCaptureFromFile(file, { source: 'share', intent? })` from
  `capture-browser.ts` stores the file, reads the QR (images), drafts the bill and returns `{ inbox, draft?, note, route }`
  — navigate to `route`. Lower level: `inboxDb.add({ source, file, intent, qr, note })` after `attachFile(file)`. The
  window event `mrc:inbox-changed` refreshes an open inbox. This pass did not edit `manifest.json` / `sw.js`.
- Attachments: `ATTACHMENT_OWNER_TABLES` now includes `purchase_drafts` and `doc_inbox`, so clean-up keeps their files.

## 8.42 Duplicate supplier bill guard
`findBillDuplicates(bill, purchases)`: **duplicate** = same supplier (GSTIN when both rows have one, else vendor id, else
normalised name) + same normalised bill no. (`INV/0042` = `inv-42`) in the same Indian FY; **possible duplicate** = same
supplier and total (±₹0.50) dated within ±3 days. The bill / expense forms show a soft warning and save on a second press
(override). Books → Reports → Exception reports lists "Possible duplicate supplier bills" (`duplicateBillPairs`,
bucketed by supplier, later bill in the period).

## 8.43 Recurring bills / expenses
`recurring_bills` (`RecurringBill`): supplier, head, lines (tokens `{month} {year} {period} {date}`), GST, ITC, cost centre,
branch, due-after days, and the recurring-invoice rules (`recurring.ts`: weekly … yearly, every N days, month-end
clamping, catch-up ≤ 12). `runDueBillSchedules` writes **drafts only** (never a posted bill — the supplier's own bill
no. / date / amount must be checked), idempotent on `recurring_bill_id` + `recurring_date`; runs when the bell's lazy
provider loads (once per session) and when the inbox opens. Bell: "supplier bills due this week" (unpaid bills by
`supplierPayable`, overdue = warning), recurring bills due this week, drafts / documents waiting.

## 8.44 Approvals for bills, expenses and supplier payments
- Policy key `purchase_approval_policy` `{bills, billAbove, payments, paymentAbove}` (0 = all; owner, `settings.manage`).
- Clerk saves a bill / expense above the limit → held in `purchase_drafts` (`draft.approval.state = 'pending'`); a
  "paid now" expense keeps its payment (`pay_now`) for approval. `purchasesDb.save` refuses such a bill from any other
  path (`assertBillApproval`, the single data-layer branch). Editing the amount of a posted bill by a clerk is refused.
- Clerk pays above the limit (payment dialog) → `payment_requests` row; nothing paid. Bill-wise payments above the limit
  are refused with a pointer to the per-bill request. Exempt (money already moved): payments from bank statements,
  cleared cheques and confirmed e-payment files.
- Owner (`doc.approve`): approve = post the bill (and its pay-now payment) / record the payment; reject needs a reason
  (the draft stays, the clerk fixes and sends it again — same row). Every decision → audit log + the shared `approvals`
  history (`doc_type` BILL / EXPENSE / PAYMENT). All writes all or nothing (`withTablesRollback`).

## Data / wiring
New tables `doc_inbox`, `purchase_drafts`, `recurring_bills`, `payment_requests` (and `bank_rules`): backup
`RECORD_TABLES` + `ID_TABLES`, `TABLE_ACTIONS` `books.edit`. None reaches the ledger and none is numbered, so none is in the
sync engine's DATED / NUMBERED lists (they sync like any other key). Additive `PurchaseRecord` fields: `status?: 'draft'`
(drafts only), `einvoice_irn`, `einvoice_irn_date`, `recurring_bill_id`, `recurring_date`. Shared files touched (small):
`purchases.ts` (gate + envelope strip), `types/purchases.ts`, `attachments.ts`, `backup.ts`, `access.ts`,
`ledger/exceptions.ts`, `ReportsHub.tsx`, `BillModal.tsx`, `ExpenseModal.tsx`, `PurchasePaymentModal.tsx`,
`BillwiseTab.tsx`, `ApprovalsPanel.tsx`, `NotificationBell.tsx`, `Expenses.tsx`, `Reconcile.tsx`.

## 8.160 "Scan bill" in the Expenses header (8I)
- Button **Scan bill** next to Add bill (only with `books.edit`), as in myBillBook's Purchases → Scan invoice. It opens a
  lazy chooser (`components/capture/ScanBillDialog.tsx`, strings `src/i18n/areas/bill-scan.ts`): **Scan e-invoice QR with
  the camera** (only where `cameraScanSupported()` — BarcodeDetector + camera on a secure page), **Take a photo of the bill**
  (`<input capture="environment">`) and **Choose a photo or PDF** — both through `openCaptureFromFile`.
- A live camera QR goes through `captureFromQrText(text, 'camera')` (`capture-browser.ts`, same path as the Inbox tab's
  camera / paste): inbox row + draft bill, warnings in the toast. Every route ends on the inbox row
  (`/expenses?tab=inbox&doc=<id>`), where the draft is reviewed and posted as before.
