# Round 5 · R5-A — Industry packs & marketplace seller

Spec: `docs/prd/round-5.md` §4 R5-A1…A6, §6. Everything here is a **working paper**: the marketplace's reports and the
GST / income-tax portals are the authority — verify with your CA.

## A1 Industry packs (the pack switch)

- `src/lib/industry-packs.ts` — `PackId` (all six: `marketplace`, `transport`, `works`, `fees`, `nonprofit`, `leases`),
  `PACK_OF_TYPE`, `activePacks`, `isPackOn`, `PACK_TABS` (one block per package), `visibleTabs`.
- Rule: `settings.industry_packs` array → exactly those packs (unknown ids dropped, `[]` = none); absent → packs implied
  by `business_type`; neither → none. Existing companies see no change (test `industry-packs.test.ts`).
- Six business types (`shop-mode.ts` union only; `shop-presets.ts` `BUSINESS_TYPES` / `PRESETS` / `BUSINESS_DEFAULTS`,
  plus `PACK_BUSINESS_TYPES`). Wizard cards and the Settings select list them after the existing types.
- Settings → Defaults → Shop mode: "Industry packs" fieldset (six checkboxes with descriptions). Ticking a box writes an
  explicit `industry_packs` list; the page's Save fires `SHOP_MODE_EVENT` as before. "Show all features" does not turn
  packs on.
- Ctrl+K: one lazily loaded group (`components/marketplace/palette-destinations.ts`, subtitle "Industry packs"), re-read
  on every open; rows of a pack that is off say "(pack off)" and still open the tab. B / C rows whose `labelKey` is not in
  the marketplace area show the key text until their package resolves it (append a resolver there).
- Turning a pack off hides its tab and bell notices only; no data is deleted.

## A2 Channels, clearing account, SKU map

- `marketplace/channels.ts`: `sales_channels` store, GSTIN (`checkEcoGstin`, "C" in place 14 expected — a "Z" GSTIN is a
  note) / TAN (`isValidTan`) checks, operator party created by name, `ensureClearingAccount` (a `bank_accounts` row with
  `clearing: true`, ledger `bank:<id>`, created once).
- `bank-accounts.ts`: normalise keeps `clearing`; `pickableBankAccounts(purpose)` leaves clearing accounts out of the
  cheque (`ChequeFormModal` via `BankAccountSelect purpose="cheque"`), deposit-slip / bulk e-payment (`BankingDocs`) and
  BRS statement (`Reconcile`) pickers.
- `marketplace/sku-map.ts`: `channel_skus` rows (`qty_per_unit` = pack of N), lookup by channel SKU then listing id, then
  the catalogue's own `sku` (1 unit); listing-file match sku → barcode → short code (auto) → title (suggestion only);
  unmapped list with "Map" / "Create item".

## A3 Sales / returns import

- `marketplace/sales-import.ts`: presets are synonym tables fed to `scoreHeader` (Amazon MTR B2C / B2B, Flipkart sales,
  Meesho GST sales / returns, generic); mapping saved on the channel by header text. CSV / XLSX (dynamic import).
- Sale row → `INVOICE` (B2C) / `TAX_INVOICE` (B2B), marketplace number and date, `eco_gstin` = the operator GSTIN for the
  ship-from state, `eco_section` from the channel, place of supply = ship-to state, lines from the SKU map
  (rate = taxable ÷ units; the GST rate is read from the amounts; a different catalogue rate is a warning), party
  "<channel> customer — <state>" or the B2B GSTIN party. Refund → `CREDIT_NOTE` linked through `doc_links`,
  `goods_returned` false for price adjustments, damaged → the channel's damaged godown; it also opens a returns-desk row.
  Cancellations skipped and listed.
- Idempotent on (channel, order id, kind, number); summary mode (state × rate × day) suggested above 3,000 rows. A
  summary document keeps its order ids (`channel_order_ids`, read back from its note for older ones), so a per-order
  import of the same orders, or a second summary import, reports them "already imported" (QA6 F2); when a summary's order
  list cannot be read, an order inside its day × state × rate is refused rather than booked twice;
  preview = counts, totals by head, refused rows (unmapped SKU, period lock, number used elsewhere), "file total =
  documents total" to the paisa. Documents are issued (status Sent), never drafts, and never take an app series number.
- Undo = cancel every document of the batch (`cancelDocument`, credit notes first), refused while any has a payment.

## A4 Settlements

- `settlement-import.ts`: Amazon V2 long format (header row = id, period, deposit, total) and wide files (Flipkart
  sheets read together, Meesho, generic). Buckets: channel rules ("contains → bucket", an array — never file text as an
  object key) → preset table → `other` (listed to teach once). Refused unless Σ lines = payout to the paisa; a
  settlement id is imported once per channel; deposit date inside the period lock refused.
- `settlement-recon.ts`: per order invoice value, sale, fees, GST on fees, TCS, TDS, net, settled %, status
  (settled / short / excess fee / unsettled after cycle + 7 days / refunded / pending); CSV via `toCsv` (formula guard).
- `settlement-post.ts` "Post": receipts into the clearing account (method "Marketplace settlement", ref = settlement id,
  capped at what the document owes; a refund of the same order in the same settlement is netted off its receipt), one
  journal (`saveVoucher`, class "Marketplace settlement"), one payout contra. Accounts by name: "Marketplace fees",
  "GST TCS receivable", "GST on marketplace fees — awaiting invoice" (and "GST TDS receivable" for A5 TDS rows).
  A posted settlement leaves clearing at 0.00 (shown per settlement and in total). "Unpost" reverses through
  `deleteVoucher` / `payments.remove` (period lock, recycle bin capture). "Record fee invoice" saves an EXPENSE bill
  (category "Marketplace fees", ITC eligible, settled) + a re-class journal (Dr creditors | Cr fees, Cr awaiting GST).
- Bell (`marketplace-alerts.ts`, gate in `NotificationBell.tsx`): unsettled orders, settlements unposted > 7 days,
  non-zero clearing at the last month end, returns pending > 15 days, claim windows closing in ≤ 3 days.

## A5 GST TCS / TDS credit and 194-O

- `tcs-credit.ts`: books expected (TCS_52 documents × `ecoTcsRate`, IGST vs CGST + SGST by place of supply; GST TDS from
  `ra_deductions` read by field name), withheld (settlement `tcs`), portal rows (`eco_credits`, pasted with synonyms),
  reasons (missing on portal / in books, value mismatch, month shift). Accept → Dr 2360 | Cr receivable (idempotent);
  reject posts nothing. `TcsCreditPanel` is a default export taking `kind`, so R5-B mounts it with `kind="tds"`.
- 194-O: `tds-194o.ts` turns settlement `tds_194o` lines into `TdsExpectedLine`s; `tds-register.ts` takes them through
  the additive `TdsInput.extraExpected`; the TDS tab adds them (pack on only, lazy). Labels use `ita2025.sectionText`
  ("Sec 393(1) … [old 194-O]" from 1 Apr 2026).

## A6 Returns / RTO / claims desk

- `returns-desk.ts`: rows from returns reports (presets), A3 refunds or by hand; status pending → received →
  restocked / claimed → closed; claim deadline = event day + window (Amazon 60, Flipkart 14 — platform policy, dated,
  overridable per channel); "Restock" saves the goods-returned credit note once (damaged → non-saleable godown);
  settlement claim / reimbursement lines mark open claims reimbursed.

## Storage (rows for the lead)

| Key / table | Kind | Registries |
|---|---|---|
| `industry_packs` on `mrchartist_inv_settings` | settings field | — |
| `mrchartist_inv_sales_channels` | rows | backup, audit, `master.edit` |
| `mrchartist_inv_channel_skus` | rows | backup, audit, `master.edit` |
| `mrchartist_inv_marketplace_imports` | rows, DATED `imported_at` | backup, audit, `doc.create`, sync |
| `mrchartist_inv_settlements` | rows, DATED `deposit_date` | backup, audit, `doc.create` (post: `books.edit`), sync |
| `mrchartist_inv_eco_credits` | rows, DATED `month`-01 | backup, audit, `books.edit`, sync |
| `mrchartist_inv_marketplace_returns` | rows, DATED `expected_on` / created | backup, audit, `doc.create`, sync |
| `InvoiceRecord.channel_id / channel_order_id / channel_import_id / channel_order_ids` | additive fields | `RECORD_KEYS`, `normalizeRecord` |
| `BankAccount.clearing` | additive field | `bank-accounts.ts` normalise |

Also: open-export schema meanings for the six tables (`trust/open-export-schema.ts`). Lead rows for ROADMAP /
ARCHITECTURE / AGENTS: the pack rule (above), the six tables, the two additive fields, "clearing accounts are not real
banks: cheque / e-payment / BRS pickers must use `pickableBankAccounts`".

## Bundle (vite build, gzip -9; baseline = `claude/elegant-cannon-cwapiv` at e40b4b6)

| | before | after | delta |
|---|---|---|---|
| Initial JS | 186,863 B (182.5 kB) | 187,028 B (182.6 kB) | **+165 B** (budget +0.2 kB) |
| Total JS | 2,361,884 B | 2,405,073 B | **+43.2 kB** (package budget 38 kB — over by ~4.2 kB, needs the lead) |

Largest new chunks: MarketplaceTab 17.2 kB, shared marketplace lib chunk 9.6 kB, marketplace i18n area (en + hi) 6.3 kB,
channels 1.9 kB, alerts 1.1 kB; `reach` area +1.5 kB (type / pack labels moved there so the Settings and wizard
routes add no new preload entry). The pack type/pack-name strings live in `reach.ts` for the same reason.

## Verify with your CA

Consolidated in `docs/CA_REVIEW.md` (ids I1–I9); answers are logged there with the date and the PR.

1. Importing marketplace-generated invoices with the marketplace's own numbers as the seller's Rule 46 record; files
   without an invoice number (Meesho GST report) are recorded as `<prefix>/<order id>` — confirm or replace.
2. E-invoicing of B2B orders invoiced by the marketplace in the seller's name (no IRN is created here).
3. B2C summary mode (state × rate × day) as the books record / GSTR-1 Table 7 source.
4. TCS rate history (1% → 0.5% from 10 Jul 2024, `ECO_TCS_RATE_RULES` "verify"); whether credit is taken on acceptance
   (as built) or on filing; Sec 52(8) liability when GSTR-8 value ≠ GSTR-1 value (shown as "value mismatch" only).
5. 194-O rates come from the existing date-keyed `tax-rules.ts` history (1% / 0.75% COVID period / 0.1% from 1 Oct 2024,
   "verify"); the ITA 2025 label is "Sec 393(1) Sl. 8(v)" from 1 Apr 2026 (lead's `ita2025.ts`).
6. RTO after the invoice: credit note (as built by "Restock") vs cancellation; credit-note time limit (30 Nov).
7. GST on marketplace fees: forward charge with ITC, parked as "awaiting invoice" until the fee tax invoice is recorded.
8. FBA / warehouse stock in other states (additional place of business) — not checked by the app.
9. Claim windows (Amazon 60 / Flipkart 14 days) are platform policy from secondary sources — verify on the seller portal.

## Known limits

- A refund paid in a LATER settlement than the sale is debited to the customer in the journal; the ledger balances, but
  the receivables screen (which reads invoices / receipts / credit notes) shows that customer in credit.
- Marketplace documents are saved one by one through `localDb.invoices.save` (guards intact); very large per-order
  months are slow — summary mode is offered above 3,000 rows.
