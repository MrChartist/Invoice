# Upgrade Roadmap

Status: in progress — Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 (5.1, 5.2, 5.3, 5.5–5.9 ✅; 5.4 partial: i18n core + Hindi core screens) · Phase 6 (most ✅; 6.7–6.9, 6.21 in progress) · Baseline: v3.1.0 (2026-10-08) · Drafted 2026-10-24

This roadmap comes from four parallel code reviews of the repository, each from a different angle:
**GST & compliance**, **product & UX**, **architecture & code health**, **security & data durability**.
Every item respects the hard rules in `AGENTS.md`: no backend, no network calls, no Tailwind,
`html-to-image` + `jspdf` for PDFs, Indian-FY numbering, invoice snapshots never change.

Phases are ordered so that each phase builds on the last one. Inside a phase, items are listed in the order to do them.
Effort: **S** ≤ 2 days · **M** ≈ 1 week · **L** 2–4 weeks.

Tax rates, thresholds and notifications cited here come from the reviews. Check each one with a CA before changing
statutory values. Outputs stay labelled as working papers ("verify with your CA").

---

## Phase 0: Correctness hotfixes (v3.1.x) · ✅ done

Bugs in the current code that produce wrong numbers or wrong data. Fix these before adding features.

| # | Item | Where | Effort |
|---|------|-------|--------|
| 0.1 | **Statutory constants module** (`src/lib/tax-rules.ts`, values keyed by effective date). Fixes: B2CL threshold is ₹2.5L but should be **₹1L** for invoices from Aug 2024 (`gst-reports.ts:123`); no **40%** slab in `GST_SLABS` (`types/invoice.ts:83`); 194H preset still 5% (2% from Oct 2024); 206C(1H) TCS preset still offered after its withdrawal (Apr 2025). Old dates keep their old values. | gst-reports, types/invoice | S |
| 0.2 | Plain **Save turns a Draft into "Sent"** even when nothing was sent (`useInvoiceStore.ts:494`). Add an explicit "Mark as sent" instead. | store | S |
| 0.3 | **Duplicate drops the profile prefix**: `localDb.invoices.save` numbers new documents without `invoicePrefix` (`localDb.ts:347`), so multi-profile users get the wrong series. | localDb, Transactions | S |
| 0.4 | **Period lock skips purchases & payments** (`purchases.ts:280`): ITC for a month already filed can change silently. Route those writes through `assertUnlocked`. | purchases, period-lock | S |
| 0.5 | **Purchase GST split ignores the vendor's state**: POS defaults to the business state (`BillModal.tsx:48`), so an inter-state bill shows CGST+SGST instead of IGST. | BillModal | S |
| 0.6 | **Auto-backups are unencrypted JSON** (`auto-backup.ts:234,268`). If the folder is a Drive/Dropbox sync folder, bank, GSTIN and client data sit in the cloud in plain text. Encrypt with the existing AES-GCM backup scheme (key held for the session). | auto-backup, crypto | S |
| 0.7 | Doc-issue table counts drafts as cancelled (`gst-reports.ts:567`). | gst-reports | S |
| 0.8 | Tally receipts don't post TDS receivable, so the party ledger stays open by the TDS amount. | tally-xml | S |
| 0.9 | Small UX bugs: the "Record a payment" palette command should open PaymentModal; the preview dialog needs a focus trap (`InvoicePreview.tsx:126`). | layout, preview | S |
| 0.10 | **Docs are out of date**: `docs/features/gst-reports.md` (₹2.5L, nil/cess wording); AGENTS.md "Known tech debt" (the `any` count is now 0, and the purchase normalisers are partly consolidated). | docs | S |

**Exit criteria:** regression tests for each fix under `tests/`; typecheck/lint/test/build pass.

**Outcome:** all items shipped with tests. Two turned out narrower than first reported: 0.2 (plain Save is
deliberately "issue" — drafts are excluded from every report, so only the button wording changed) and 0.5 (picking
a vendor already set the place of supply; only the GSTIN-only vendor case was missing). 0.7 now leaves drafts out
of the document-issued range instead of counting a trailing draft as cancelled.

---

## Phase 1: Engineering foundations (v3.2) · ✅ done

Phases 3–5 change stored data, so this phase builds the groundwork they rely on: migrations, safety nets and tests.

| # | Item | Why | Effort | Depends on |
|---|------|-----|--------|-----------|
| 1.1 | **`schema_version` key + ordered migration runner** (tested, idempotent) | Replaces scattered read-time patches (e.g. `readSettings`, three purchase normalisers). Phases 3–4 need it. | M | — |
| 1.2 | **Safety backup before any restore/wipe** + **schema/version validation on restore** (reject future versions and malformed tables) | `parseBackup` accepts any `mrchartist_inv_*` value today (`backup.ts:156`) | M | 1.1 |
| 1.3 | **Playwright in devDeps; run `verify:offline` + a smoke E2E (create → save → PDF → backup/restore) in CI**; add coverage reporting | 137 `.tsx` files have no render tests; the perf/offline scripts never run in CI | M | — |
| 1.4 | **Batch writes in `invoices.save`**: upsert the catalogue once per invoice, not once per line | A 20-line save currently does about 23 full-table rewrites | S | — |
| 1.5 | **Editor store selectors** (`useShallow`, separate totals slice); generate `toRecord` from a typed key list | 4 components subscribe to the whole store and re-render on every keystroke; the hand-written 56-field `toRecord` silently drops new fields | M | 1.3 |
| 1.6 | **Finish purchase consolidation** onto `readPurchase`/`PurchaseRecord` (drop the 3 remaining wrappers) | Removes duplicated code, as listed in Known tech debt | S | — |
| 1.7 | **`strictNullChecks` first**, then the other strict flags one at a time; add a tsconfig covering `tests/` and `scripts/` | Tests and scripts are not typechecked today | M | — |
| 1.8 | **Cross-tab safety**: `storage` listener + `BroadcastChannel` refresh, `navigator.locks` around writes | Two open tabs currently overwrite each other's whole tables | S–M | — |
| 1.9 | **Security hardening**: PBKDF2 600k with re-hash on unlock, optional alphanumeric passcode; CSP `<meta>` in `index.html` for hosts that ignore `_headers`; generate the three header files from one source | Current OWASP guidance; header copies drift today | S | — |
| 1.10 | **Storage-health panel**: real usage vs quota, persisted status, Safari "install to Home Screen" warning, read back each backup to confirm it is valid | Users get warned before data is lost | S | — |

**Outcome:** all ten shipped. Bonus: `src/` already compiled under full `strict`, so 4.6 is done too. 1.6 found a
real bug while consolidating — legacy lump-tax bills were posted entirely as Input IGST in Tally; one shared
`splitLumpTax` now serves GST reports, books and exports. CI runs a Playwright journey (account → invoice →
preview → second tab → backup → restore/undo) plus the offline checks against the production build.

---

## Phase 2: Getting paid & daily UX (v3.3) · ✅ done

The upgrades users notice most, measured against Zoho, Vyapar, Refrens and myBillBook.

| # | Item | User value | Effort |
|---|------|-----------|--------|
| 2.1 | **Share the actual PDF** with `navigator.share({ files })` (falls back to download); `handleExportPDF` returns a Blob | One-tap WhatsApp invoice on mobile; today only text is shared | S |
| 2.2 | **Inline typeahead** for client & item names (Tally-style, keyboard-first) + "Save as new client" | Roughly halves the time to enter an invoice | M |
| 2.3 | **First-run wizard**: business → GSTIN (fills state) → bank/UPI → logo → template → sample invoice | Faster to a first invoice; today users are left on their own in Settings | M |
| 2.4 | **Invoice list power tools**: filters (type/date/client/status), sorting, multi-select (mark paid, ZIP of PDFs, CSV, queued reminders), undo on delete | Faster month-end work | M |
| 2.5 | **Payment loop**: receipt voucher PDF, automatic thank-you on full payment, payment-mode presets with UTR reference | Closes the "getting paid" journey | S–M |
| 2.6 | **Quotation lifecycle** (Sent/Accepted/Declined/Expired via `valid_until`) + **ship-to / consignee address** (already accepted by `eway.ts`) | Tracks quotes through to conversion; correct e-way data | S–M |
| 2.7 | **Mobile**: bottom tab bar (Home · New · Invoices · Clients · More), fit-to-width preview with pinch zoom | Usable day to day on a phone; preview is 30% scale today | S |
| 2.8 | **"Client copy" HTML file**: self-contained invoice + UPI QR + tappable `upi://` button + print stylesheet | A client portal with no server; fixes `upi://` links that can't be tapped in messages | M |

**Outcome:** all eight shipped, each covered by the Playwright journey (wizard → typeahead → share PDF → client copy
→ receipt → bulk paid → undo). Left out on purpose: a ZIP of PDFs (each PDF must be rendered on screen and a ZIP
needs a dependency) and "save typed client" (saving an invoice already adds the client). Found and fixed on the way:
`normalizeRecord` dropped fields it did not list, so reopening and saving a document could lose them — a test now
guards every persisted field.

---

## Phase 3: GST & accounting depth (v3.4) · ✅ done

Turns the GST working papers into something a CA can rely on. Every data change goes through the Phase 1 migration runner.

| # | Item | Effort | Depends on |
|---|------|--------|-----------|
| 3.1 | **Proper debit & credit notes**: additive `note_of`/`note_type`; route to CDNR/CDNUR with `ntty` D/C; classify by the original invoice (not the note value); fill e-Invoice `PrecDocDtls` automatically; DBN doc type; doc-issue code 4; own number series | M | 1.1, `doc_links` |
| 3.2 | **Purchase completeness**: RCM flag, ITC reversal with reason (Rule 42/43/37), cess, import/Bill of Entry → 4A(1), Sec 17(5) blocked-credit list. Update `tests/purchase-contract.test.ts` (Critical Rule 9) | M | 1.6, 0.5 |
| 3.3 | **Taxable freight/other charges** (Sec 15) with a per-invoice toggle; legacy invoices keep their snapshots | S–M | 1.1 |
| 3.4 | **Foreign-currency exports**: store `exchange_rate` on the document; convert to INR in GSTR, e-Invoice (`AssVal` must be INR), Books, Tally and dashboard totals; shipping-bill fields in the EXP JSON | M | 1.1 |
| 3.5 | **HSN B2B/B2C split** + digit rule based on turnover (4 vs 6 digits) from the stored `gt` | S–M | 0.1 |
| 3.6 | **Compliance calendar**: GSTR-1/IFF/3B/9 due dates (monthly or QRMP), filed status, Sec 50 interest and late-fee estimate, through the existing notifications | S–M | 0.1 |
| 3.7 | **TDS receivable register**: client PAN/TAN, quarter × section summary, 26AS/AIS CSV matcher, Tally journal | M | 0.8 |
| 3.8 | **MSME 43B(h) tracker**: Udyam number/category on vendors, 15/45-day overdue flags, year-end disallowance, MSMED interest | M | 3.2 |

**Outcome:** 3.1 was built in the main session; 3.2–3.8 by four parallel agents in separate git worktrees, then merged
and verified together (725 unit tests, Playwright journey, bundle budgets). Assumptions to confirm with a CA are
listed in each feature doc — notably: the RBI bank-rate table for MSMED interest, the 43B(h) "paid within the same FY"
reading, the GSTR-1 HSN B2B/B2C JSON keys (`HSN_JSON_LAYOUT` in `gstr-json.ts`) and split start (Jan 2025),
QRMP/late-fee notification values, and freight being taxed at the highest line rate. Known gaps: cess on purchase
bills, 4D(1), RCM/import postings in Books and Tally, exchange gain/loss on receipts, Sec 50(3) interest.
The total (precache) bundle budget was raised 650 → 760 kB gz; initial and entry budgets are unchanged.

---

## Phase 4: Scale & storage (v4.0) · ~6–8 weeks

The 5 MB localStorage limit is the biggest long-term risk. A 60 kB logo copied into every invoice snapshot uses up
the quota after about 80 invoices (about 3,000 without a logo). This is a major version because the storage format changes.

| # | Item | Effort | Depends on |
|---|------|--------|-----------|
| 4.1 | ✅ **Logo/signature assets stored by reference**: snapshot holds a content hash, the asset lives once in an asset table, backups embed it. Historical invoices still render the same (Critical Rule 3) | M | 1.1, 1.3 |
| 4.2 | ✅ **Move tables to IndexedDB** behind a synchronous in-memory cache; one-time migration from localStorage with rollback; shared connection in `idb-kv.ts`. **Keep every `mrchartist_inv_*` table name** | L | 1.1, 1.2, 1.3, 1.8 |
| 4.3 | ✅ **Virtualise long tables** (Transactions, Receivables): long tasks of 235–280 ms at 300 invoices before; windowing + cached `Intl` formatters, numbers in `docs/qa/performance.md` | M | — |
| 4.4 | ✅ **Split large components**: `ImportWizard` (835 lines, 24 `useState`) → `wizard-state.ts` reducer + four step components; `InvoiceCreator` (527 → ~340 lines) → `CreatorHeader`, `DocumentMetaCard`, `MobileSaveBar`, `useCreatorKeys` | M | 1.5 |
| 4.5 | ✅ **Tamper-evident audit log**: hash-chained rows; restore adds a marker row instead of replacing the log; no silent drop when storage is full | M | 4.2 |
| 4.6 | ✅ Full `strict` mode on (done in Phase 1) | — | 1.7 |

---

## Phase 5: Reach & multi-device (v4.x) · ongoing

Larger features, each of which can ship on its own once Phases 1–4 are done.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 5.1 | ✅ **GSTR-2B import & matcher**: user loads the portal JSON/Excel locally; match on GSTIN + bill no. + value; IMS Accept/Reject/Pending worksheet; 4A(5) books-vs-2B comparison (`docs/features/gstr2b.md`) | L | Needs 3.2 |
| 5.2 | ✅ **GSTR-9 annual working paper** from 12 months of GSTR-1/3B + HSN, compared against books (`docs/features/gstr9.md`; 8A typed in from GSTR-2B, since the 5.1 matcher does not keep the 2B file) | M | Needs 3.1, 3.2 |
| 5.3 | ✅ **Advances / receipt vouchers / Table 11**: ADV/FY receipt vouchers (Rule 50) and RFV refunds (Rule 51), date-keyed GST on service advances (none on goods since Notification 66/2017-CT), apply to invoices through the payments API, GSTR-1 11A/11B + JSON `at`/`txpd`, 3B 3.1(a), GSTR-9 4F, ledger, receivables, Tally (`docs/features/advances.md`) | L | Needs 3.1 |
| 5.4 | 🟡 partial — **Hindi-first i18n**: ✅ dependency-free `t()` / `useT()` with typed, lazily loaded catalogues and a device-local language switch (Settings, login, vault); ✅ Hindi for the shell, login / vault, Dashboard, editor main surface, payment dialog and list empty states; ✅ amount in words in Hindi on the Bilingual template; ✅ self-hosted Noto Sans Devanagari subset in the precache (PDFs no longer vary by device). Remaining: other screens and `src/lib` messages, then Marathi/Tamil/Gujarati (`docs/features/i18n.md`) | L | |
| 5.5 | ✅ **POS / thermal quick-bill mode**: one-screen counter billing, walk-in customer, 80 mm auto-print, change calculator (delivered as 6.8: `/pos`, `docs/features/pos-barcode-pricing.md`) | M | Reuses `thermal80` / ReceiptBody |
| 5.6 | ✅ **Barcode/SKU**: `BarcodeDetector` camera scan with typed fallback, Code128 labels (delivered as 6.7) | M | Pairs with 5.5 |
| 5.7 | ✅ **Multi-device via a shared folder**: one encrypted snapshot file per device in a Drive/Dropbox/OneDrive/iCloud desktop folder (File System Access API, AES-GCM under a PBKDF2 sync passphrase); merge by table + row id with version vectors / Lamport clocks (not `updated_at`), concurrent edits and duplicate numbers listed for the user, locked-period changes held for the PIN (`docs/features/sync.md`). Limits: Chrome/Edge desktop only, not real-time (start-up + every 5 min), full-snapshot files, settings are one last-writer-wins unit | L | Needs 0.6, 4.2 |
| 5.8 | ✅ **Optional "vault mode"**: whole store encrypted at rest with a passphrase-wrapped key (clear warning: a lost passphrase means lost data) (`src/lib/vault.ts`, `docs/features/security.md`) | L | Needs 4.2 |
| 5.9 | ✅ **Composition / Bill of Supply** (BOS series, Rule 49 declaration on every template, CMP-08 / GSTR-4 papers, Table 8 / 13 for regular-taxpayer BOS) and **amendments** (B2BA / B2CLA / CDNRA / CDNURA / B2CSA; original period unchanged) (`docs/features/composition-amendments.md`). Follow-up done: e-commerce Sec 52 / 9(5) (Table 14, 3B 3.1.1(ii), GSTR-9 5C1), export amendments (EXPA), GSTR-4 Tables 7-9 + CMP-08 interest / GSTR-4 late fee, bulk e-Way for Bills of Supply, Table 13 challans by purpose. Not covered: GSTR-9 Pt V, Table 14A / 15 | M each | — |

### Not planned (conflicts with the hard rules)
- WebRTC device pairing, payment-gateway links, direct cloud APIs and GSP/IRP portal filing all need network calls or
  a server, so they break Critical Rule 1. Revisit only if that rule is deliberately changed.

---

## Phase 6: Competitive parity — "all the powers" (v5.x) · from the Oct 2026 competitor survey

Surveyed Tally Prime, Zoho Books/Invoice, Vyapar, myBillBook, Busy, Marg, Refrens, Khatabook, Swipe, GimBooks, Giddh,
QuickBooks, Xero, FreshBooks, Wave, Invoice Ninja, Odoo and Sage. Our GST engine, templates, offline design and
backups already match or beat the Indian SME tools; the gaps below all work **without a server**.

| # | Item | Competitors | Effort |
|---|------|-------------|--------|
| 6.1 | ✅ **Double-entry core**: chart of accounts (Schedule III groups), journal / contra / payment / receipt vouchers; documents auto-post — `src/lib/ledger/`, `docs/features/ledger.md` | Tally, Busy, Zoho, Xero, QBO | L |
| 6.2 | ✅ **Trial balance + ledger drill-down** | all accounting tools | S (after 6.1) |
| 6.3 | ✅ **Full balance sheet**: fixed assets & depreciation (IT Act WDV blocks), loans, capital/drawings, GST ledgers (Schedule III vertical format) | Tally, Zoho | M |
| 6.4 | ✅ **Cash-flow statement** (indirect, AS 3) | Vyapar, Refrens, Zoho, Xero | S–M |
| 6.5 | ✅ **Sales orders & purchase orders** with pending quantities → invoice / challan / bill (`src/lib/sales-orders.ts`, `src/lib/purchase-orders.ts`) | Refrens, Odoo, myBillBook, Vyapar, Zoho | M |
| 6.6 | ✅ **Batch / expiry / MFG** on stock with FEFO and expiry alerts (`src/lib/stock-tracking.ts`, `docs/features/inventory.md`) | Vyapar, myBillBook, Busy, Marg | M |
| 6.7 | ✅ **Barcode** scan (BarcodeDetector + keyboard wedge) and Code128/EAN-13 label sheets (`src/lib/barcode.ts`, `scan.ts`, `label-sheet.ts`; camera allowed by `Permissions-Policy: camera=(self)`) | Vyapar, myBillBook, Marg | M |
| 6.8 | ✅ **POS quick bill**: walk-in, split cash/UPI/card tender, 80 mm auto-print, day-end Z report + cash-drawer count (`/pos`, `src/lib/pos.ts`, `docs/features/pos-barcode-pricing.md`) | Vyapar, myBillBook, Marg, Swipe | M |
| 6.9 | ✅ **Price levels & schemes** (wholesale/retail/party rates, qty slabs, buy-X-get-Y as a ₹0 line; `src/lib/pricing.ts`) | Tally, Marg, Vyapar | M |
| 6.10 | ✅ **Multi-godown** stock with transfer vouchers (`STR/FY25-26/0001`, `src/lib/godowns.ts`) | Vyapar, Busy, myBillBook | M |
| 6.11 | ✅ **Serial numbers / IMEI / warranty** lookup (Inventory → Serial lookup) | Busy, myBillBook | M |
| 6.12 | ✅ **Attachments**: receipt photos / PDFs on bills, expenses, invoices (IndexedDB, one key per file, stored once by content, in backups; `src/lib/attachments.ts`, `docs/features/attachments-custom-fields.md`) | Zoho, Xero, Invoice Ninja | M |
| 6.13 | ✅ **Time tracking & billable hours** → invoice lines (`/time`, `src/lib/timesheets.ts`, `docs/features/time-expenses.md`) | FreshBooks, Zoho, Invoice Ninja | M |
| 6.14 | ✅ **Billable expenses & mileage** with markup and pure-agent (Rule 33) reimbursements | FreshBooks, Invoice Ninja | S–M |
| 6.15 | ✅ **Optional automatic late-fee line** per client terms (new draft invoice, never edits the original; `receivables.md`) | FreshBooks, Invoice Ninja | S |
| 6.16 | ✅ **Cost centres / projects** with project P&L (Books → Projects; `docs/features/cost-centres-budgets.md`) | Tally, Busy, QBO, Xero, Zoho | M |
| 6.17 | ✅ **Budgets vs actual** (Books → Budgets: monthly per FY / account / cost centre, copy from last year's actuals) | Tally, Zoho, Xero, QBO | S–M |
| 6.18 | ✅ **Cash-flow forecast** 30/90/180 days from open items, recurring and collection lag (Books → Forecast, `src/lib/cash-forecast.ts`, `docs/features/cash-planning.md`) | Xero | M |
| 6.19 | ✅ **Exchange gain/loss** (realised on receipts, posted to ledger 4930; period-end revaluation report; `src/lib/fx-gain.ts`) | Zoho, Tally, Xero | S–M |
| 6.20 | ✅ **Separate companies** on one device (isolated data sets + switcher) (`src/lib/companies.ts`: one IndexedDB database per company) | Tally, Busy, Vyapar | M |
| 6.21 | ✅ **Local user roles** on a shared device (owner / clerk / viewer PINs; access control, not security) — `src/lib/access.ts`, `src/lib/users.ts`, `docs/features/security.md` § Local user roles | Vyapar, myBillBook, Zoho | M |
| 6.22 | ✅ **.xlsx import/export without a dependency** (native `DecompressionStream` + a hand-written XML tokenizer, `src/lib/xlsx.ts`); ZIP writer `src/lib/zip.ts` (used for the ZIP of PDFs, 7.4) | most | M |
| 6.23 | ✅ **Custom fields** on documents, items, parties, printable (Settings → Custom fields; invoices snapshot label + value; `src/lib/custom-fields.ts`) | Tally (UDF), Zoho, Vyapar | S–M |
| 6.24 | ✅ **Bulk e-Invoice / e-Way JSON** and bulk IRN response import (`einvoice.md`) | Zoho, Tally | S |
| 6.25 | ✅ **Party/item profitability, credit limits at billing** (Reports → Item / Party profit; editor warning; `profitability.ts`, `credit-limit.ts`) | Vyapar, Zoho | S–M |
| 6.26 | ✅ **Cheque register & PDC reminders**, cheque printing (`/cheques`, `src/lib/cheques.ts`, `cheque-print.ts`) | Tally, Busy | S–M |

Already planned in Phase 5 and confirmed by the survey: GSTR-2B/IMS matcher (5.1), GSTR-9 (5.2), advances/Table 11
(5.3), Hindi/regional UI (5.4), POS (5.5 → 6.8), barcode (5.6 → 6.7), folder sync (5.7), vault mode (5.8),
composition / Bill of Supply (5.9).

**Will not build (needs a server)** — live bank feeds, payment gateway/auto-charge, online client portal, direct IRP /
GSP filing and 2B auto-fetch, cloud sync, cloud OCR, automatic FX rates, app-sent SMS/e-mail, online store. Offline
alternatives: statement CSV/XLSX import, UPI deep links + UTR matching, client-copy HTML, offline-tool JSON in/out,
encrypted folder sync, attachments with manual entry, typed or CSV-imported RBI/FBIL rates, `wa.me`/`mailto:` + Web
Share, static catalogue HTML.

**Recommended order:** 6.1–6.4 (unlock 6.16, 6.17, 6.19) → 5.1 + 6.22 → 6.5 → 6.12 → 6.6–6.9 (retail) → 6.13–6.15
(freelancers); 6.20/6.21/5.4 in parallel.

## Phase 7: Tally parity (v5.x)

Numbering: one sequence 7.1–7.61 in the sub-sections below (7L continues at 7.62, 7M at 7.70, 7N at 7.80, 7O at 7.90, 7P at 7.100) (renumbered after the WP merge; the work-package
documents in `docs/features/` keep their own WP ids). Gap ids refer to `docs/GAP_ANALYSIS.md`.

### 7A · Accounting depth (TDS, voucher variants, bill-wise, masters, payroll)

| # | Item | Tally feature | Status |
|---|------|---------------|--------|
| 7.1 | ✅ **TDS on payables**: deduct on bill or on payment, sections 194C / 194J (prof / tech) / 194I (a / b) / 194H / 194Q / 194A, single + FY-aggregate thresholds, 206AA / 206AB / Sec 197, TDS payable ledgers per section (`src/lib/tds-payables.ts`, `tds-rules.ts`, `docs/features/tds-payables.md`) | TDS deduction on purchase / payment | done |
| 7.2 | ✅ **TDS / TCS challans** (ITNS 281: BSR, serial, date) linked to deductions; Sec 201(1A) / 206C(7) interest estimate; deposit / return due dates on `/tds` | Stat payment, TDS challan reconciliation | done |
| 7.3 | ✅ **Return working papers**: Form 26Q and 27EQ in RPU column order (CSV / XLSX / text, unverified), Form 16A data, filed marks; 27Q flagged only | Form 26Q / 27EQ e-return | done |
| 7.4 | ✅ **Voucher variants**: optional (make regular), memorandum, post-dated (with PDC summary), reversing journals, voucher classes (`src/lib/ledger/voucher-variants.ts`) | Optional / Memo / Post-dated / Reversing journal | done |
| 7.5 | ✅ **Bill-wise payables**: Agst Ref over several bills, Advance / On Account / New Ref, later adjustment, ageing, party bill-wise view, MSMED interest (`src/lib/billwise.ts`) | Bill-wise details, outstanding ageing | done |
| 7.6 | ✅ **Ratio analysis** from the ledger with drill-down (`src/lib/ledger/ratios.ts`) | Ratio Analysis | done |
| 7.7 | ✅ (Sec 194-O / 194R / 194S presets, certificate limits / validity: done in 7O — 7.95, 7.97) Form 27Q working paper with DTAA vs Act rate and TRACES justification import: done in 7R (7.120) | — | done |
| 7.8 | ✅ Vendor-form fields for PAN / deductee type / 206AB / Sec 197, TDS dates in the compliance calendar / notification bell — done in 7O (7.95, 7.96) | — | done |
| 7.9 | ✅ **Masters & openings ("Accounts Info")**: user groups / sub-groups under the Schedule III primaries (nature and gross-profit effect inherited), Group / Ledger Create · Alter · Display with Tally keys (Enter / Ctrl+A / Esc, Alt+C hook), ledger and party opening balances on a books-beginning date posted as an Opening voucher with the difference in opening balances reported, bill-wise opening outstandings in receivables ageing and statements, opening trial balance screen, ledger interest parameters (lib), bill allocation on manual receipts — `docs/features/masters.md` | Groups, Ledgers, Opening balances, Bill-wise details (WP-1: P0-1, P0-2, P0-11, P1-7 lib) | done (P1-21 import kinds, P2 cost categories: open) |
| 7.10 | ✅ **Payroll** (WIP-A): employees, pay heads (Tally calculation types), salary structures, attendance / production, Auto fill payroll run → Payroll voucher in the ledger, salary / PF / ESI / PT / TDS (192) payments, payslips, PF ECR, ESI, PT, Form 24Q / Form 16 Part B working papers (`/payroll`, `src/lib/payroll/`, `docs/features/payroll.md`) | Payroll | done |

### 7B · Keyboard-first accounting (Gateway)

For users coming from TallyPrime: the same keyboard conventions on top of the existing ledger. Full key map:
`docs/features/gateway-keyboard.md`.

| # | Item | Notes | Effort |
|---|------|-------|--------|
| 7.11 | ✅ **Gateway of Tally** (`/gateway`, lazy): Masters (Create / Alter), Transactions, Utilities, Reports, Display more reports; highlighted accelerator letters, ↑ ↓ Enter, Esc back, Go To search (Alt+G / Ctrl+G) | `src/lib/gateway/menu.ts`, `src/components/gateway/GatewayMenu.tsx` | M |
| 7.12 | ✅ **Global F-keys**: F2 date, Alt+F2 period, F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9 Purchase, Ctrl+F8 Credit note, Ctrl+F9 Debit note, F11 / F12 Settings; off in fields, on `/pos` and under dialogs | `src/lib/tally-keys.ts` (shell, ~1 kB) | S |
| 7.13 | ✅ **Single-screen voucher entry** (Contra / Payment / Receipt / Journal): Dr/Cr (By/To) lines, type-ahead ledgers + parties, Alt+C create inline, auto-balancing last line, cost centres, Ctrl+A accept, Esc quit, Alt+D delete | `src/lib/gateway/voucher-entry.ts`, `VoucherEntry.tsx`; period lock / audit / roles via `saveVoucher` | M |
| 7.14 | ✅ **Display reports with drill-down**: Balance sheet / P&L / Trial balance / Group summary → ledgers → parties → months → vouchers → voucher or document; Day book; Cash/bank books; Outstandings | `src/lib/gateway/drill.ts`, `DisplayReport.tsx` | M |
| 7.15 | ✅ **Keyboard help** (Ctrl+/ or ?) with a "Tally keys" group; clickable button bar for mouse / touch | `keymap.ts`, `ButtonBar.tsx` | S |
| 7.16 | ✅ **"Tally terms" toggle** (Party, Sales voucher, Purchase voucher) on Gateway screens only | device-local preference | S |
| 7.17 | ✅ **Stock journal (Alt+F7) / Physical stock (Ctrl+F7)**: keys and Gateway rows open `/manufacturing?tab=journal` / `?tab=physical` (WIP-B) | `TALLY_KEYS`, `menu.ts` | S |
| 7.18 | ✅ **Gateway rows for every module** through `GATEWAY_EXTENSIONS`: Employee / Payroll voucher / payroll reports, TDS & TCS payables, GST set-off, Ratio analysis, Accounts Info, banking documents, purchase debit note, receipt note, manufacturing journal, Tally import, Start new year (integration pass, 7.60) | `src/lib/gateway/menu.ts` | S |
| 7.19 | ⏳ Bill-wise references (7.5) and voucher classes (7.4) on Gateway voucher entry, single-entry mode | needs a voucher schema addition | M |

### 7C · Banking & payments (WP-5, `docs/features/banking.md`)

| # | Item | Notes | Effort |
|---|------|-------|--------|
| 7.20 | ✅ **Each bank account as its own ledger** (WP-5, P0-8): main account keeps 3510, others `bank:<id>` under Cash & bank or Bank OD A/c; receipts, supplier payments / advances, advance receipts / refunds, TDS challans and cheques post to their bank; per-bank openings; contra between banks (OD included); Books bank book per account; Tally one ledger per bank | `src/lib/bank-ledgers.ts`, `src/lib/ledger/postings-bank.ts`, `src/lib/tally-bank.ts`, `docs/features/banking.md` | M |
| 7.21 | ✅ **Banking documents** (WP-5, P1-14): deposit / pay-in slip with cheques + cash denominations (`PIS/FY…`), payment advice (bills settled + TDS), bulk e-payment file (generic NEFT / RTGS CSV + HDFC / ICICI / SBI presets — check the format with your bank), cheque against several invoices / bills, vendor bank details | `deposit-slip.ts`, `payment-advice.ts`, `bank-upload.ts`, `cheques.ts`, `BankingDocs.tsx` | M |
| 7.22 | ✅ **Bounce charges posting** and **day-end cash tally by denomination** (WP-5, P2) | `cheques.ts`, `cash-tally.ts` | S |
| 7.23 | ✅ Banking follow-ups: forex bank ledgers, payments recorded from an e-payment file after bank confirmation, Contra from a deposit slip's cash, supplier payments in the Tally export (confirmed, WP-7) — see 7U (7.150–7.153); vendor-form bank details: done in 7.60 | `docs/features/banking.md` | M |

### 7D · Purchase returns, receipt notes, order outstanding (WP-3)

| # | Item | Tally equivalent | Status |
|---|---|---|---|
| 7.24 | ✅ **Purchase return / supplier debit note** against a bill (`DN/FY<yy-yy>/<seq>`): quantity limited to billed less earlier returns, goods leave stock, ITC reversed, GST "reason for note", Agst Ref on the bill (bill-wise / payables), excess on account; Dr Creditors / Cr Purchase returns (5010) + input heads (`src/lib/purchase-returns.ts`, `ledger/postings-returns.ts`, `docs/features/purchase-returns.md`) | Debit Note (Ctrl+F9) | done |
| 7.25 | ✅ **Supplier credit note received** (supplier's number / date, value only or with goods, with or without a bill); GSTR-3B ITC net of notes (`itcAdjustmentsFromNotes`), GSTR-2B CDNR matching (`bookBills` notes), Tally Debit Note voucher (`tally-debit-notes.ts`) | Debit Note with supplier ref | done |
| 7.26 | ✅ **Receipt note (GRN)** → bill (PO → GRN → bill), **Rejections Out**, "Goods received not billed" (`src/lib/receipt-notes.ts`, stock source `events-returns.ts`) | Receipt Note (Alt+F9), Rejections Out | done |
| 7.27 | ✅ **Purchase order outstanding** report (GRN-accepted + directly billed vs ordered, overdue days) | Purchase Order Outstandings | done |
| 7.28 | ✅ Job work in / out + **ITC-04** and Rejections In: see 7M (7.70–7.73); sales-order outstanding (WP-8, 7.63); GSTR-9 Table 6 / 9 use of supplier notes and TDS adjustment on a return of a TDS bill: done in 7O (7.93, 7.94). Still open: 9C Table 12 split of supplier notes | Job Work Out / In Orders, Material Out / In, ITC-04 | done (one item open) |

### 7E · Printing & documents output (WP-4)

| # | Item | Gap ids | Effort |
|---|------|---------|--------|
| 7.29 | ✅ **Printing & documents output**: Rule 48 copies in one print job / PDF with a per-profile default, transport details printed (GST dispatch cells + block), voucher printing, batch PDF / ZIP, bulk statements + confirmation-of-accounts letters, pre-printed stationery mode — `docs/features/printing.md` | P0-9, P1-15, P1-24, P1-6 (print), P2 | M |

### 7F · Manufacturing & stock vouchers (WIP-B)

Details: `docs/features/manufacturing.md`.

| # | Item | Tally equivalent | Status |
|---|------|------------------|--------|
| 7.30 | **Bill of Materials** per stock item: components per unit, scrap %, by-products / co-products / scrap, optional godown, several BOMs with a default (`src/lib/manufacturing.ts`, table `boms`) | Components (BoM) | ✅ |
| 7.31 | **Manufacturing Journal** `MFG/FY…`: BOM explosion, FEFO batch consumption, additional costs (₹ / %), produced goods valued at component cost + additional − by-product / scrap; period lock, audit, roles | Alt+F7 Manufacturing Journal | ✅ |
| 7.32 | **Stock Journal** `SJ/FY…` for conversion / repacking; godown transfers stay STR (`stock_transfers`) | Alt+F7 Stock Journal | ✅ |
| 7.33 | **Physical Stock** `PHY/FY…`: counted vs book, shortage / excess with value, positions after the date follow the count, drift warning | Ctrl+F7 Physical Stock | ✅ |
| 7.34 | **Reorder levels + MOQ** (per godown optional), Reorder Status with pending POs and "Create purchase order", bell alert | Reorder Status | ✅ |
| 7.35 | **Inventory reports**: Stock Summary drill-down (item → month → vouchers), Movement Analysis by party, Stock Ageing (FIFO layers, by batch), Negative stock exceptions (`src/lib/stock-reports.ts`) | Stock Summary, Movement Analysis, Ageing | ✅ |
| 7.36 | Job work out / in orders, material sent / received, ITC-04 | Job Work vouchers | ✅ see 7M |
| 7.37 | ✅ Serial-tracked items in manufacturing; production plan / material requirement vs BOM — done in 7S (7.130, 7.131) | — | ✅ |

### 7G · Business extras (WP-9, `docs/GAP_ANALYSIS.md` § 8)

| # | Item | Competitors | Effort |
|---|------|-------------|--------|
| 7.38 | ✅ **POS returns / exchange** (WP-9, P1-25): scan / pick the bill → lines & qty → credit note with goods back to stock → refund by cash / UPI / card (payment voucher) or exchange against the next bill; Z report shows returns, refunds and net (`src/lib/pos-returns.ts`, `docs/features/business-extras.md`) | Vyapar, Marg, Busy | M |
| 7.39 | ✅ **Approvals (maker-checker)** (WP-9, P1-18): `doc.approve` (owner), "invoices above ₹X / all documents by clerks" policy, pending-approval drafts, owner queue, audit + `approvals` log (`src/lib/approval-gate.ts`, `approvals.ts`) | Zoho | M |
| 7.40 | ✅ **Branches / locations** (WP-9, P1-19): branch master, additive `branch_id` on documents / purchases / vouchers (inferred from profile / GSTIN), branch filter + branch-wise summary; reports-engine option documented for WP-2 (`src/lib/branch.ts`) | Tally, Busy | M |
| 7.41 | ✅ **Dashboard tiles** (WP-9, P1-17): receivables, payables, cash / bank, GST due, top items, low stock, branches, approvals, AMC, loyalty — per user, lazily loaded (`src/lib/dashboard-tiles.ts`) | TallyPrime 4 | S–M |
| 7.42 | ✅ **Loyalty points**, **AMC / service contracts**, **static catalogue HTML** (WP-9, P2) (`src/lib/loyalty.ts`, `amc.ts`, `catalogue-html.ts`) | Vyapar, Marg, Busy | M |
| 7.43 | ✅ Sales commission per agent, bill-value / buy-A-get-B offers, ESC/POS raw receipts + cash drawer, pharma pack — see 7U (7.154–7.157) | Marg, Busy | M |

### 7H · Migration, audit trail & year-end (WP-7, `docs/features/migration-audit.md`)

| # | Item | Tally equivalent | Status |
|---|------|------------------|--------|
| 7.44 | ✅ **Migration from Tally** (WP-7, P0-7): Tally XML import — groups, ledgers (accounts / customers / suppliers with GSTIN, state, PAN, credit period), opening TB + bill-wise openings, stock items / godowns, vouchers as manual vouchers (never invoices); dry run with mapping, duplicate detection on re-import, one undo copy, opening TB checked against Tally to the paisa (`src/lib/tally-import.ts`, `tally-import-apply.ts`, `tally-xml-read.ts`, `components/import/TallyImport.tsx`, `docs/features/migration-audit.md`) | Tally data migration | done |
| 7.45 | ✅ **MCA audit trail completeness** (WP-7, P0-10): every books / masters table write diffed by row through one `onTableWrite` storage hook (create / alter / delete with before → after), archive segments instead of the 5,000-row cap (still hash-chained, in backups, verified as one chain), per-record Edit log, "cannot be disabled" statement (`src/lib/audit-edits.ts`, `audit.ts`, `audit-chain.ts`, `components/audit/EditLog.tsx`) | Edit Log (Alt+G) | done |
| 7.46 | ✅ **Tally export of every voucher** (WP-7, P0-12 / P1-22): supplier payments (TDS on payment) and advances, manual Journal / Contra / Payment / Receipt with cost-centre allocations and reversals, fixed-asset + depreciation journals, stock transfers as Stock Journal; group / cost-centre / godown masters, ledger openings with bill-wise opening bills (`src/lib/tally-books.ts`) | Tally import of our XML | done |
| 7.47 | ✅ **Year-end wizard** (WP-7, P1-20): integrity, closing stock (shows the report-time valuation when it is on; a journal reversed on 1 April only when it is off — never both, 7.60), depreciation check, provisions journal, opening bills review, lock the year, carry-forward report / CSV (`src/lib/year-end.ts`, `year-end-store.ts`, `components/year-end/YearEndWizard.tsx`) | "Start new year" / Split Company Data | done |
| 7.48 | ✅ **Books integrity check** (WP-7, P2): TB and voucher balance, opening difference, orphaned receipts / supplier payments / allocations / document links / opening bills, negative cash days (`src/lib/books-integrity.ts`) | — | done |
| 7.49 | ⏳ WP-7 follow-ups: Tally import of inventory vouchers (quantities), Excel TB template path, audit segment compression, per-FY auditor export with chain head, archive of old FYs to a "history" company, TDS challans in the Tally export | — | open |

### 7I · Reports engine & Tally report grammar (WP-2)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 7.50 | ✅ **One accounting truth**: Day Book and P&L from the ledger (manual vouchers, fixed assets, depreciation included); Trading account with **closing stock** from the inventory (FIFO / weighted average) or a typed figure; balance-sheet inventories — `docs/features/reports-engine.md` | P0-3 | done |
| 7.51 | ✅ **Group Summary + drill-down everywhere** (BS / P&L / TB → group → ledger → months → vouchers → voucher; reusable DrillStack, Enter / Esc), Alt+F1, F12 options, Alt+F2 shared period context | P0-4, P1-3, P1-26 | done |
| 7.52 | ✅ **Comparative columns** (previous period, month / quarter-wise), month-wise voucher registers with columnar view, exception reports, statistics, funds flow; closing stock in ratio analysis (7.6) | P1-1, P1-2, P1-4, P1-5, P2 | done |

### 7J · GST depth & statutory postings (WP-6, `docs/features/gst-setoff.md`)

| # | Item | Tally equivalent | Status |
|---|------|------------------|--------|
| 7.53 | ✅ **GST set-off journal** from a GSTR-3B period (P0-6): liability vs ITC vs cash by head, date-keyed utilisation order (Rule 88A / Sec 49A / original Sec 49(5), `GST_SETOFF_RULES`), Sec 50 interest + Sec 47 late fee estimates, Rule 86B warning; posted through `saveVoucher` (Dr Output / RCM payable / interest / late fee, Cr Input, Cr GST electronic cash ledger 2360); one journal per period × GSTIN (`src/lib/gst-setoff.ts`, "Set-off & payment" tab) | GST adjustment / Set Off of GST | done |
| 7.54 | ✅ **PMT-06 challans** (`gst_challans`): CPIN, CIN / BRN, mode, bank ledger, major × minor head grid; deposit posts Dr electronic cash ledger / Cr bank; cash ledger balance by head, shortfall and "challan for the shortfall"; "Liability to be paid" card on the GSTR-3B tab | Stat Payment | done |
| 7.55 | ✅ **Cess on purchase bills** (`cess_amount`): GSTR-3B 4A / 4C / 3.1(d) cess, cess credit against output cess only, GSTR-9 Tables 6 / 9, Input cess ledger posting | GST cess on purchases | done |
| 7.56 | ✅ **e-Invoice ShipDtls / DispDtls / PayDtls / EwbDtls** from `invoice.ship_to`, a dispatch option, the sender's bank details and `invoice.transport` | e-Invoice with dispatch / ship-to / e-Way | done |
| 7.57 | ✅ **HSN master** with dated rate history and default-rate inheritance (item → HSN → group → company), seeded from existing documents; **purchase HSN / rate register** (`hsn-master.ts`, `hsn-purchase-register.ts`) | GST Rate Setup, HSN-wise purchase summary | done |
| 7.58 | ✅ **Month-wise GSTR-1 vs GSTR-3B vs Books** reconciliation and a **GSTR-9C working paper** (Tables 5 / 7 / 9 / 12 with adjustments) (`gst-recon-monthly.ts`, `gstr9c.ts`) | Reconciliation of Returns | done |
| 7.59 | ✅ WP-6 follow-ups (cess in Books / exports / Tally, ITC carry-forward, RCM self-invoice + Rule 52 series, IFF JSON: done in 7O — 7.90–7.98; EXPA: built with the amendments, `gst-reports.md`): PMT-09 / refunds, ISD, consolidated e-Way, rate-wise 9C Table 9 / Table 14 — done in 7R (7.121–7.127) | — | done |

### 7K · Integration pass (after the WP merge)

| # | Item | Status |
|---|------|--------|
| 7.60 | ✅ **Everything reachable and consistent**: closing stock never double counted (report-time valuation nets any closing-stock journal; year-end wizard posts a journal only when valuation is off, one-click switch either way); Gateway BS / P&L = Books statements with stock; Gateway rows, sidebar "Accounts Info", palette destinations, Books header entries for the year-end wizard / Tally import; Alt+C ledgers in the Books voucher editor; Edit log on vouchers and bills; approval banner, "Pending approval" filter, branch selects; bell notices for approvals / AMC / GST set-off due; vendor bank details; HSN-master default rate on invoice / bill lines; Ctrl+F9 on the purchase side = purchase debit note (`tests/closing-stock-yearend.test.ts`, `tests/wiring.test.ts`) | done |
| 7.61 | ✅ Integration follow-ups: branch filters, branch-wise books, loyalty in the editor, POS return deep link, voucher branch select, Gateway Display drill (7N, 7.80–7.83); PAN / TDS fields on the vendor form (7O, 7.95) | done |

### 7L · Inventory masters & analysis (WP-8, `docs/features/inventory-masters.md`)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 7.62 | ✅ **Stock groups (nested) + stock categories**, **units master** (UQC, decimal places, compound units), **alternate units on lines** (2 BOX → 24 NOS in stock, `unit_factor` snapshot) on the invoice editor and bill / PO / GRN lines, **group-wise Stock Summary**, `PurchaseLine.item_id` set by the bill form's item picker — `docs/features/inventory-masters.md` | P1-10 | done |
| 7.63 | ✅ **Sales Order Outstanding** (pending delivery / invoice by party · item · due date, overdue days) on Inventory → Order outstanding; reorder "pending PO" counts goods received on GRNs before the bill | P1-12 | done |
| 7.64 | ✅ Configurable **ageing slabs** with Hindi bucket labels (Stock reports → Ageing) | P1-11 | done |
| 7.65 | ✅ **Godown hierarchy** (godown inside a godown, stock rolled up), **standard cost / selling price lists** with effective dates, **Stock Query** (stock by godown / batch, last purchase / sale rates, pending orders, prices), **landed cost** on a bill (freight etc. spread to the goods' stock cost, memo only); stock-item delete blocked while BOMs / stock vouchers use it | P2 | done |
| 7.66 | ✅ (UQC mapping into GSTR-1 HSN / e-Invoice / e-Way and alternate-unit item profit: done after the merge; alternate units on POS lines and stock journals: done in 7.72) price lists feeding the editor's rate, group-wise reorder / ageing / movement filters, Manufacturing Journal components and physical counts in alternate units — done in 7S (7.134, 7.135) | P1-10, P2 | done |

### 7M · Job work, ITC-04, Rejections In, alternate units on stock vouchers (`docs/features/job-work.md`)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 7.70 | ✅ **Job work out**: Job Work Out order (`JWO/FY…`), **Material Out** delivery challan under Rule 55 / Sec 143 (`JWC/FY…`, printable in triplicate), **job-worker godowns** (created on first challan, `job_worker` flag — still our stock in the summary), **Material In** (`JWR/FY…`: processed goods at inputs + job charges − scrap, scrap, returned inputs, losses, 5C supplies; consumption typed or exploded from the BOM), **Sec 143 return clocks** (inputs 1 year, capital goods 3 years, tools none, extension) with due-soon / **deemed supply** alerts; stock event source `events-job-work.ts` (one registration line in `collectEvents`) | P1-9 | done |
| 7.71 | ✅ **Job work in** (we are the job worker): principal's material received / sent back register (`JWP/FY…`, not our stock), job charges invoice (SAC 9988 service line opened in the editor); **ITC-04 working paper** (Table 4, 5A / 5B / 5C; half-yearly above ₹5 crore / annual from FY 2021-22, quarterly before — `ITC04_RULES` date-keyed in `tax-rules.ts`; CSV; verify with your CA) | P1-9 | done |
| 7.72 | ✅ **Rejections In** (`RJI/FY…`): customer rejects goods on a delivery challan before invoicing — stock back while challans move stock, challan balance reduced and billed balance on conversion; **alternate units** (`unit_factor`) on POS lines, stock journals, stock transfers and manual adjustments; typed quantities rounded to the units master's decimal places | P1-8, P1-10 | done |
| 7.73 | ✅ Job work follow-ups: serial-tracked items to job workers, e-Way bill JSON for job-work challans, clock alerts in the bell, principal's goods by godown / batch, ITC-04 JSON (layout unverified) — done in 7S (7.132, 7.133); job charges reach GSTR-1 through the normal invoice export | P1-9 | done |


### 7O · GST & TDS follow-ups (`docs/features/gst-setoff.md`, `docs/features/tds-payables.md`)

| # | Item | Tally equivalent | Status |
|---|------|------------------|--------|
| 7.90 | ✅ **Purchase cess everywhere**: Books `gstSummary` (`itcCess`, `rcmCess`, `netCessPayable`; `itcWithCess` for 3B / 9 / 9C comparisons), cost when not claimed, balance sheet; `purchases.ts` `itcTotals.cess`; accounting purchase register "Cess" column; Tally "Input Cess" ledger — nothing lands in round-off any more; **reverse-charge / import cess** out of the supplier payable (`selfAssessedCessOf`) and onto GST payable — reverse charge (2310) / customs (2311) in the ledger and Tally | GST cess on purchases | done |
| 7.91 | ✅ **ITC carry-forward**: a posted set-off stores the unutilised ITC by head (`itc_carry`); the next period's plan starts from it (`carryForwardFor`, gap / pre-7O notes), "Credit ledger (carried)" view (`creditLedgerBalance`); **negative net ITC** (4B(2) / supplier notes above the period's credit) shown signed in the 3B view (`itc.netSigned`), absorbed by carried credit first, else paid in cash with the input ledger restored — flagged for the CA | Electronic credit ledger | done |
| 7.92 | ✅ **RCM self-invoice** (Sec 31(3)(f) / Rule 46, `RCM/FY…`) per bill or **consolidated for a month**, and **Rule 52 payment voucher** (`RPV/FY…`) for reverse-charge purchases from unregistered suppliers; Indian-FY series via `series-counters.ts` (never re-issued), 16-character limit, Rule 47A 30-day due date (date-keyed in `gst-penalties.ts`), printable; GST reports tab "RCM self-invoice" (`src/lib/rcm-self-invoice.ts`, table `rcm_documents`) | Self-invoice / payment voucher under RCM | done |
| 7.93 | ✅ **Supplier notes in GSTR-9 and the compliance estimates**: monthly 3B builds behind GSTR-9 / 9C read `purchase_returns` (Table 6A, Table 9), Table 6B–6F / 8 reduced in the bill's bucket; the Compliance tab's late-fee / interest base nets supplier notes | — | done |
| 7.94 | ✅ **TDS on a purchase return**: a note against a bill with TDS at booking carries `tds_reversed` (`tdsReversalForReturn`, pro rata, rupee-rounded): Dr TDS payable instead of the supplier (ledger, Tally debit note), Books TDS payable, the TDS register nets the bill's deduction and warns when the return comes after the deposit | — | done |
| 7.95 | ✅ **Vendor form TDS block**: PAN, deductee type, default section, 206AB, non-resident (27Q flag), Sec 197 certificate number / rate / **limit** / **validity** — the bill form applies the certificate only inside its validity and up to its limit (excess at the normal rate) | Party TDS details | done |
| 7.96 | ✅ **TDS dates in the GST compliance calendar** (lazy `TdsDueCalendar`) and the **notification bell** (deposit / 26Q overdue or due within 5 days) | Statutory reminders | done |
| 7.97 | ✅ **Sec 194-O / 194R / 194S** presets, date-keyed append-only (`TDS_EXTRA_SECTION_RULES` in `tax-rules.ts`, thresholds `TDS_EXTRA_THRESHOLD_RULES`), on both the receivables and payables side — unverified, see CA list | TDS nature of payment | done |
| 7.98 | ✅ **IFF JSON** (QRMP months 1–2): B2B / CDNR (+ amendments) from the month's GSTR-1 build with the ₹50 lakh check (`src/lib/iff.ts`, date-keyed limit) — layout unverified | — | done |
| 7.99 | ✅ 7O follow-ups — all done in 7R: Form 27Q / DTAA (7.120), TRACES import (7.120), 194-O ₹5 lakh exemption and 5% no-PAN rate (7.120), TDS on payment-mode bills reduced by later returns (7.120), PMT-09 / refunds (7.121), 9C Table 12 split (7.127), cess on supplier notes (7.123), `gst_summary` cess (7.125), TCS (27EQ) in the bell (7.120) | — | done |

### 7P · Payroll depth (`docs/features/payroll.md`)

| # | Item | Where | Status |
|---|------|-------|--------|
| 7.100 | ✅ **Arrears of back-dated revisions**: each finalized month recomputed with the revised structure, difference per pay head with PF (month's ceiling / EPS) and ESI (if covered then), paid in a chosen month, own table on the payslip, taxed in the year paid, relief u/s 89 noted | `payroll/depth.ts`, `ArrearsTab.tsx`, table `payroll_arrears` | done |
| 7.101 | ✅ **Loans & advances** (`LOAN/FY…`): disbursement via payroll payment (Dr 3615), EMI recovered in runs (interest → 4920), reducing-balance schedule from actual recoveries, interest-free / concessional loan perquisite (Rule 3(7)(i), SBI rate per loan) in TDS | `depth.ts`, `LoansTab.tsx`, `employee_loans` | done |
| 7.102 | ✅ **Leave**: types with accrual, openings, carry-forward cap, taken (unpaid → LOP), encashment paid in a run; balances report | `LeaveTab.tsx`, `leave_types`, `leave_entries` | done |
| 7.103 | ✅ **Gratuity** (15/26 × last drawn × years, 5-year rule, ceiling by date) with provision working + journal; **Bonus Act** working (₹21,000 / ₹7,000, 8.33–20%) → payroll / provision | `depth.ts`, `FnfTab.tsx`, `ExtrasTab.tsx`, `payroll-rules.ts` | done |
| 7.104 | ✅ **Full & final settlement** (`FNF/FY…`): notice pay recover / pay, leave encashment (10(10AA)), gratuity (10(10)), recovery of loans, final TDS, paid and posted with the run of its month; printable F&F statement | `depth.ts`, `depth-reports.ts`, `fnf_settlements` | done |
| 7.105 | ✅ **Reimbursements** (exempt by head and regime) and one-off items, **perquisites** (typed value / month), old-regime **senior / super-senior slabs**, **80CCD(2)** employer NPS, **206AA** 20% without PAN | `compute.ts`, `ExtrasTab.tsx`, `payroll_adjustments`, `perquisites` | done |
| 7.106 | ✅ **Integration**: payroll payments in the Books cash / bank book and Day Book, salary cost in `books.profitAndLoss`; payroll Journals / Payments + employee ledgers in the Tally XML; TDS 192 payments in the /tds challan list (read-only, section 192); PF 7Q / 14B estimate | `books-link.ts`, `tally-payroll.ts`, `tds-link.ts`, `depth-reports.ts` | done |
| 7.107 | ✅ **ESI coverage per contribution period** (decided in its first month / month of joining) and **EPS stop at 58** from the date of birth | `compute.ts`, `store.ts` | done |
| 7.108 | ✅ Payroll follow-ups: EPFO arrear ECR, relief u/s 89 (Form 10E) working, actuarial gratuity / leave provisions (actuary's figures), Rule 3 perquisite valuation tables, s. 17(2)(vii) ₹7.5 lakh, ESI low-wage exemption, TDS 201(1A) on salary, PT on arrears, per-user payroll grant for a trusted clerk — see 7T | 7.140–7.148 | done |

### 7T · Payroll follow-ups (`docs/features/payroll.md` § 7T)

| # | Item | Where | Status |
|---|------|-------|--------|
| 7.140 | ✅ **EPFO arrear ECR**: arrear EPF / EPS / EDLI wages and EE / EPS / ER shares per UAN for the arrears paid in a month (`#~#` text + working sheet; layout flagged unverified); arrears now keep their EPS / EDLI wage differences | `payroll/followups.ts`, Reports tab | done |
| 7.141 | ✅ **Relief u/s 89(1) — Form 10E working**: arrears spread over the years they relate to (tax with / without, each year's slabs, surcharge, cess — earlier slabs FY 2017-18 to 2022-23 added), relief = year-of-receipt difference − spread-back difference; suggestion from payroll projections; "allow in TDS" (s. 192(2A)) reduces the year's TDS projection; Form 10E sheet export | `followups.ts`, `followups-store.ts`, `MoreTab.tsx`, table `payroll_relief89` | done |
| 7.142 | ✅ **Rule 3 perquisite valuation**: motor car by cc / use / who runs it (+ chauffeur), accommodation by city population or lease (+ furniture, − recovery), free meals above ₹50, gifts at ₹5,000 a year — date-keyed tables in `payroll-rules.ts`, saved as a perquisite with its basis | `followups.ts`, `MoreTab.tsx` | done |
| 7.143 | ✅ **s. 17(2)(vii)**: employer PF (EPF + EPS) + NPS + superannuation (new employer pay-head flag) for the year above ₹7.5 lakh taxed as a perquisite in the TDS projection; annual working; 17(2)(viia) accretion noted, not computed | `compute.ts`, `followups.ts` | done |
| 7.144 | ✅ **ESI low daily wage**: no employee share at or below the notified average daily wage (₹176, date-keyed), employer share still paid; noted on the payslip | `compute.ts`, `payroll-rules.ts` | done |
| 7.145 | ✅ **Interest u/s 201(1A) on salary TDS**: per final month, TDS deducted on the payroll date vs TDS payments of that period, 1.5% a month or part after the due date (7th / 30 April), on tax rounded down to ₹100 | `followups.ts`, Reports tab | done |
| 7.146 | ✅ **PT on arrears / one-off items** per state (option): arrears, bonus, leave encashment and other earnings join the month's gross for the PT slab in the states ticked | `compute.ts`, `followups-store.ts` | done |
| 7.147 | ✅ **Per-user payroll access**: the owner grants `payroll.view` to a named clerk (can run payroll) or viewer (look only); stored on the device-local user, audited, applied at once; owner-only stays the default | `access.ts` (`actorCan`, `GRANTABLE_ACTIONS`), `auth.ts`, `payroll/grants.ts` | done |
| 7.148 | ✅ **Actuarial valuation entry** (`ACT/FY…`): the actuary's AS-15 / Ind AS 19 figures (opening, service / interest / past service cost, benefits paid, actuarial loss, closing, plan assets), roll-forward check, provision journal (Ind AS 19 gratuity remeasurement → Reserves / OCI) — the valuation itself must come from an actuary | `followups-store.ts`, `ActuarialPanel.tsx`, table `actuarial_valuations` | done |
| 7.149 | ⏳ 7T follow-ups: 17(2)(viia) accretion (Rule 3B), Form 12BA / Form 16 perquisite lines for 17(2)(vii), late-deduction 201(1A) detection, arrear ECR upload validation, plan-asset movements for funded gratuity, hotel / furnished-accommodation variants, EV car rates | — | open |


### 7N · Branch accounting & integration gaps (`docs/features/business-extras.md`, `docs/features/reports-engine.md`)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 7.80 | ✅ **Branch-wise books**: `{ branchId }` option on every report builder (TB, P&L, BS, cash flow, ledger, group summary, day book, registers, statistics, Gateway frames) via `scopeLedger` — whole vouchers by their source row's branch (documents, receipts follow invoices, bills, supplier payments / debit notes follow bills, tagged manual vouchers; company-level entries under "No branch"); branch TBs balance and add up to the company TB; branch filter in the Books statements toolbar and Gateway Display (`b=`); branch select on manual vouchers (Books editor, Gateway voucher entry); branch filter on Transactions and the purchase list (`src/lib/ledger/branch-books.ts`, `tests/branch-books.test.ts`, e2e step) | P1-19 | done |
| 7.81 | ✅ **Inter-branch transfer between distinct GSTINs** (Sec 25(4)): a stock transfer between godowns of two branches with different GSTINs offers "Tax invoice + bill" — TAX_INVOICE from the sending registration + matching ITC bill at the receiving branch, posted to new default ledgers 4030 / 5020 "Branch transfer" so the pair nets out; value per Rule 28 flagged "verify with your CA" (`src/lib/branch-transfer.ts`, `components/branches/BranchTransferDialog.tsx`) | P1-19 | done |
| 7.82 | ✅ **Gateway Display drill = Books**: a balance-sheet head drills into its Schedule III break-up (party advances that moved sides, the valued closing-stock line inside Inventories), party lines straight to the party's monthly summary (`src/lib/gateway/drill.ts`) | P0-4 | done |
| 7.83 | ✅ Small gaps: loyalty redemption in the invoice editor (lazy, only while the programme is on); palette "POS return / exchange" opens the return dialog (`/pos?return=1`); bell GST set-off reminder for every regular filer even before the set-off screen is used (never for composition); Alt+C create-on-the-fly for stock items and godowns (stock-transfer pickers, bill / PO line item names); Edit log on the stock item form (`tests/wiring-7n.test.ts`) | — | done |
| 7.84 | ✅ Branch follow-ups: per-godown closing stock for branch statements, Alt+C in manufacturing / stock-journal grids and the bill godown select, automatic Sec 25(4) prompt (7S, 7.160–7.167); GSTR-1 / 3B column per GSTIN (7R, 7.130) | P1-19 | done |

### 7R · GST & TDS statutory gaps (`docs/features/tds-payables.md`, `docs/features/gst-setoff.md`, `docs/features/gstr9.md`)

| # | Item | Where | Status |
|---|------|-------|--------|
| 7.120 | ✅ **TDS**: **Form 27Q** working paper (non-residents: Sec 195-R / F / I / O sections, Act rates date-keyed with cess in `NR_ACT_RATE_RULES`, vendor country / TIN / TRC / Form 10F / DTAA rate, DTAA only with TRC + 10F, Sec 206AA / Rule 37BC, short-deduction flags, CSV / XLSX, filed mark, separate 27Q due item); **TRACES justification import** (tolerant text / CSV parser with untrusted-file caps, matched to deductions, resolve, table `tds_justifications`); **194-O** ₹5 lakh individual / HUF exemption and 5% no-PAN rate; **TDS on payment-mode bills** net of later supplier returns; **TCS (27EQ)** deposit / return items in the bell (light reader, bell stays lazy) — all unverified, CA list | `tds-27q.ts`, `traces-justification.ts`, `tds-payables.ts`, `tds-rules.ts`, `Tds7rTabs.tsx` | done |
| 7.121 | ✅ **Electronic cash ledger by minor head**, **PMT-09** transfers (`gst_pmt09`) and **refund claims RFD-01** (`gst_refunds`: categories, ARN, trail RFD-02/03/04/06/05, Sec 54(1) last day, Sec 56 delay estimate, receipt voucher on PAID: Dr bank / Cr 2360 or input heads); **Rule 89(4)** LUT refund working paper | `gst-cash-refunds.ts`, tab "Cash ledger & refunds" | done |
| 7.122 | ✅ **ISD**: invoices received / ISD invoices issued (`ISD/FY…`) / ISD credit received (`isd_documents`), Rule 39 distribution by turnover (CGST / SGST → IGST across States), **GSTR-6** working paper (Tables 3, 4, 5, 8; due 13th), ISD credit received → **3B 4A(4)**, JSON ISD row, **GSTR-9 6G** | `isd.ts`, tab "ISD / GSTR-6" | done |
| 7.123 | ✅ **Cess on supplier notes** (`cess_amount` pro rata from the bill) reversed in 3B, GSTR-9, Books, ledger (Input cess 2353) and Tally debit notes | `purchase-returns(-gst).ts`, `postings-returns.ts`, `tally-debit-notes.ts` | done |
| 7.124 | ✅ **GSTR-3B JSON writes the signed 4(C)** (`GSTR3B_JSON_LAYOUT.signedNetItc`, Circular 170/02/2022-GST as understood) and the 4A(4) ISD row | `gstr-json.ts` | done |
| 7.125 | ✅ Accounting **`gst_summary` export Cess column** (inside Total Tax) | `accounting-export.ts` | done |
| 7.126 | ✅ **Consolidated e-Way Bill (EWB-02)** JSON from several EWB numbers for one vehicle (saved or pasted, checks, expired flags; layout unverified) | `eway-consolidated.ts`, tab "Consolidated e-Way" | done |
| 7.127 | ✅ **GSTR-9C** rate-wise **Table 9** (9A–9Q incl. RC rows), **Table 14** (ITC on expenses by head vs 7J), **Table 12 split** of supplier notes (12A-N) | `gstr9c-extra.ts`, `gstr9c.ts`, `Gstr9cView.tsx` | done |
| 7.128 | ✅ **GSTR-9 Part V** (Tables 10–12, 14 from next-FY notes / amendments / supplier notes up to the date-keyed cut-off; 13 noted) | `gstr9-partv.ts`, `gstr9.ts` | done |
| 7.129 | ✅ **GSTR-1 Table 14A(a)** from amendment rows with the operator GSTIN; Table 14A(b) / Table 15 / 3B 3.1.1(i) documented as operator rows (nil in a supplier's return) | `eco-amend.ts`, `EcoView.tsx` | done |
| 7.130 | ✅ **GSTR-1 / 3B by GSTIN** — one column per registration (branches / profiles), bills by branch GSTIN or place-of-supply State, unassigned listed, CSV | `gst-by-gstin.ts`, tab "By GSTIN" | done |
| 7.131 | ⏳ 7R follow-ups: Form 15CA / 15CB, surcharge and Sec 195A grossing-up on 27Q; 27Q FVU text; TRACES flags in the Deductions tab; refund of IGST on goods exports (shipping-bill route); filed ITC refunds netted in the carried credit; ISD ledger postings and GSTR-6 amendments; books column on 9C rate-wise Table 9; Table 13 of GSTR-9 Part V; operator-side Table 15 / 3.1.1(i) | — | open |

### 7U · Banking & business-extras follow-ups (`docs/features/banking.md`, `docs/features/business-extras.md`)

| # | Item | Where | Status |
|---|------|-------|--------|
| 7.150 | ✅ **Forex bank ledgers**: `BankAccount.currency` + `fcy_opening` (EEFC / foreign-currency accounts, never the main account); balance in FCY (opening + same-currency receipts + entries) and INR (the ledger); money in at a typed rate, money out / conversion with the **realised** difference, period-end **revaluation** at a typed closing rate (**unrealised**, AS 11) — each a Journal through `saveVoucher` to 4930; table `fx_bank_moves`; no live rates; verify with your CA | `forex-bank.ts`, `ForexBankPanel.tsx` | done |
| 7.151 | ✅ **Payments from an e-payment file after confirmation**: downloaded batches kept (`epay_batches`, `EPB/FY…`); bank response / status file or statement rows parsed by header; matched by reference, account + amount, unique amount; supplier payments recorded all or nothing (oldest bills first, rest on account, UTR as reference, bank's date); failed rows marked | `epay-confirm.ts`, `EpayConfirmPanel.tsx` | done |
| 7.152 | ✅ **Contra for a deposit slip's cash**: Dr the slip's bank | Cr Cash on the slip date, posted before the cheques move (period lock refuses the slip), optional per slip | `deposit-slip.ts` | done |
| 7.153 | ✅ **Supplier payments in the Tally export** confirmed (WP-7 `tally-books.ts`: Payment vouchers Agst Ref + TDS, advances / on account) and covered by a test with an EEFC-era bank ledger | `tests/banking-7u.test.ts` | done |
| 7.154 | ✅ **Sales commission per agent**: agent master (flat % / % by stock group, on invoice or on receipt), `agent_id` on documents, statement + CSV, payable journal Dr Sales commission | Cr Sundry creditors (agent), periods never overlap; TDS 194H not computed (CA) | `sales-commission.ts`, `AgentsPanel.tsx` | done |
| 7.155 | ✅ **Offers**: `schemes` extended with `kind` — buy A get B (₹0 line of item B with its HSN / rate) and bill-value slabs (% / ₹ off, best slab) applied after the price is chosen as an amount discount with its own line in the editor, POS and receipt (`offer`); GST on the net value (Sec 15(3)(a), Circular 92/11/2019) — verify with your CA | `offers.ts`, `pricing.ts`, `OffersPanel.tsx`, `EditorExtras.tsx` | done |
| 7.156 | ✅ **ESC/POS**: per-device printer mode (browser default / raw 58–80 mm text receipt / ESC-POS over Web Serial, feature-detected, user-picked port), cash-drawer kick on cash bills only in serial mode, fallback to browser print; no network | `escpos.ts`, `PosPrinter.tsx` | done |
| 7.157 | ✅ **Pharma pack**: drug licence numbers on the profile (printed), Schedule H / H1 / X on stock items, prescription on the bill, Schedule H1 register (CSV), near-expiry list, block expired / near-expiry sales option in every stock check | `pharma.ts`, `pharma-gate.ts`, `PharmaPanel.tsx` | done |
| 7.158 | ⏳ 7U follow-ups: foreign-currency supplier payments from an EEFC account, bank-specific response presets, revaluation reversal option, TDS 194H on commission, agent on POS bills, per-customer offers, ESC/POS QR / logo, Schedule X register book format | — | open |


### 7S · Inventory, manufacturing, job work & branch stock follow-ups (`docs/features/manufacturing.md`, `docs/features/job-work.md`)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 7.160 | ✅ **Serial-tracked items on stock vouchers**: Manufacturing Journal components consumed by serial and finished units / by-products given new serials; Stock Journal source / destination by serial; one serial per unit (whole base units), dated in-stock / not-needed-later checks on save, delete refused once a later entry used a produced serial; serial column with "Fill from stock" in the line grids (`src/lib/serial-vouchers.ts`, two `serials` fields in `pushVoucherEvents`) | 7.37 | done |
| 7.161 | ✅ **Production plan / MRP** (`PP/FY…`, table `production_plans`): multi-level default-BOM explosion netted once per item at its low-level code against closing stock and open POs / GRNs; make vs buy with MOQ and last purchase rate; "Create purchase order", "Manufacture" opens a filled Manufacturing Journal; period lock, roles, audit, backup, sync (`src/lib/mrp.ts`, `MrpTab.tsx`) | 7.37 | done |
| 7.162 | ✅ **Job work by serial**: Material Out sends serials to the job worker's godown (still our stock), Material In returns / consumes / supplies / loses them there, processed goods under new serials; checks on save and delete (`jobWorkSerialIssues`) | 7.73, P1-9 | done |
| 7.163 | ✅ **Job work follow-ups**: e-Way bill JSON for a Material Out challan (sub-type 4 Job Work, CHL, tax values nil, transport saved on the challan; verify with your CA — `eway-job-work.ts`), Sec 143 clock alerts in the bell (lazy, `job-work-alerts.ts`), principal's goods by godown / batch (`job-work-principal.ts`), ITC-04 JSON beside the CSV (**layout unverified**, `itc04-json.ts`) | 7.73, P1-9 | done |
| 7.164 | ✅ **Selling price lists in the editor**: the item's selling price in force on the document date becomes the line rate on pick ("Price list"); a customer level's own rate still wins, % levels apply to it, slabs below it apply, typed rates and credit / debit notes untouched (`price-list.ts`, `pricing-actions.ts`) | 7.66, P2 | done |
| 7.165 | ✅ **Group / category filters** on Reorder Status, Movement Analysis and Stock Ageing (incl. by batch); **alternate units** on Manufacturing Journal component lines (FEFO in base units) and Physical Stock counts (`counted_typed`, base units stored) | 7.66, P1-10 | done |
| 7.166 | ✅ **Branch stock**: per-godown closing-stock valuation for branch statements in Books and Gateway (branch godowns × company-wide unit cost; "No branch" takes the rest so branches add up — `ledger/branch-stock.ts`); Alt+C on manufacturing / stock-journal line grids (items, godowns) and the bill godown select; the Sec 25(4) tax invoice + bill dialog opens automatically when a transfer between two GSTINs is saved | 7.84, P1-19 | done |
| 7.167 | ⏳ 7S follow-ups: serial counts on Physical Stock, MRP lead times / dated demand buckets and open plans as scheduled receipts, e-Way JSON for goods returned to a principal (sub-type 6), price lists on POS, ITC-04 JSON checked against the offline tool, cost-centre closing stock | — | open |

### 8A · Daily khata loop (`docs/features/khata.md`)

What Khatabook / OkCredit / Vyapar / myBillBook users do every day, offline: `wa.me` / `upi://` / Web Share / files only.

| # | Item | Where | Status |
|---|------|-------|--------|
| 8.1 | ✅ **Balance-first Clients list**: *To collect / Advance / Settled* from `buildReceivables` (opening bills, credit notes, advances), overdue line, sort by balance / most overdue / name, **Overdue only** chip, header totals *You'll get / You'll give*, phone card layout | `khata.ts`, `Clients.tsx` | done |
| 8.2 | ✅ **₹ Received / ₹ Given** per party (Clients rows, Statements tab): amount-first sheet, Cash / UPI / Bank + UTR, date, note; FIFO allocation (editable), rest on account, saved all or nothing with roles, period lock and audit (`savePartyReceipt`); ₹ Given = one-line Bill of Supply (composition) / non-GST bill (no GSTIN), or the editor prefilled with the party for a GST registrant (no invented non-GST document) | `bill-allocation.ts`, `khata-actions.ts`, `QuickEntrySheet.tsx` | done |
| 8.3 | ✅ **One-tap WhatsApp statement** (open bills + net due + `upi://` link) on Clients / Receivables rows and the statement viewer; **Share PDF** through the share sheet (download fallback); static **statement web page** with Pay-with-UPI panel + QR (`client-copy.ts` generalised) | `StatementViewer.tsx`, `client-copy-dom.ts` | done |
| 8.4 | ✅ **Party reminders + "Remind all overdue"**: `buildPartyReminder` (total overdue, oldest bill, UPI link; English / Hinglish / Hindi), full-screen stepper one tap per party with skip / snooze / copy, logged in `reminders` with additive `party_key`; **Send everyone their balance** monthly preset | `khata.ts`, `RemindQueue.tsx` | done |
| 8.5 | ✅ **Party balance on the bill**: Design Studio toggle (`show_party_balance`, per profile) prints *Previous balance + This bill = Total due* on every template and the thermal / POS receipt from `party_balance_snapshot` frozen at first issue (reprints never change; legacy prints nothing); accent variable only | `party-balance.ts`, `PartyBalanceBlock.tsx`, store / POS save | done |
| 8.6 | ✅ **Due dates in shop use**: the party's credit days set the due date of a new document; the editor nudges for a due date on an unpaid bill | `useInvoiceStore.ts`, `DocumentMetaCard.tsx` | done |
| 8.7 | ⏳ 8A follow-ups: balance snapshot on recurring / converted / late-fee documents issued outside the editor, per-party reminder language, statement web page from list rows, non-INR khata | — | open |

### 8D · GST guards 2025–26 (`docs/features/einvoice.md`, `docs/features/gst-reports.md`, `docs/features/gstr2b.md`, `docs/features/compliance.md`)

Statutory values date-keyed and append-only in the lazy `src/lib/gst-guards.ts` (not in the first-paint `tax-rules.ts`). Working papers — verify with your CA.

| # | Item | Where | Status |
|---|------|-------|--------|
| 8.60 | ✅ **IRP 30-day reporting window** (AATO ≥ ₹10 crore from 1 Apr 2025, invoices + credit / debit notes; ≥ ₹100 crore invoices from 1 Nov 2023): profile `einvoice_aato`, countdown in the e-Invoice dialog and the bulk list, GST guards list, bell at day 20 / day 27 (and once closed) for documents still without an IRN | `gst-guards.ts`, `IrpWindowNote.tsx`, `gst-guard-alerts.ts` | done |
| 8.61 | ✅ **GSTR-1A working paper**: freeze the GSTR-1 as filed (`gstr1_snapshots`), later same-period additions / changes / removals listed (B2B / B2CL / CDNR / CDNUR / EXP + B2CS), closed once the period's 3B is marked filed; **GSTR-3B Table 3.2** as per GSTR-1 vs books per POS with the date-keyed lock (non-editable from the Apr 2025 period per advisory 11 Apr 2025, editable again per advisory 16 May 2025) | `gst-guards.ts`, `Gst8dPanel.tsx` (GST guards tab, under GSTR-3B) | done |
| 8.62 | ✅ **Three-year time bar** (Sec 37(5) / 39(11) / 44(2) / 52(13), portal from 1 Aug 2025): "becomes barred on …" list on the Compliance tab (with "mark filed") and a bell notice 90 days ahead | `timeBarFor` / `timeBarList`, `Gst8dPanel.tsx` | done |
| 8.63 | ✅ **Vendor follow-up from the 2B match** (Clear pattern): per-supplier note (not in 2B, value / tax / head / date / number differences, not in books) by WhatsApp / e-mail / PDF, "followed up on" marks (`gst_followups`); **matched ITC pushed** to a Table 4 panel under GSTR-3B (`gstr2b_itc`) | `gst-followup.ts`, `VendorFollowUp.tsx` | done |
| 8.64 | ✅ **One cancel flow** (TallyPrime 7.0 pattern): cancelling a document with an IRN / EWB prepares the EWB + IRN cancel JSON together, shows the 24-hour deadlines (EWB first; after 24 h → credit note / recipient rejection) and tracks `einvoice_meta.irn_cancel` / `ewb_cancel` | `einvoice-cancel.ts`, `EinvCancelPanel.tsx` (in the cancel dialog) | done |
| 8.65 | ✅ **GST exceptions** ("uncertain transactions"): missing HSN on B2B lines, POS vs GSTIN state, rate outside the date-keyed slab table (GST 2.0 from 22 Sep 2025), B2CL threshold edge (±5%), missing IRN where e-invoicing is mandatory (date-keyed mandate thresholds) | `gstExceptions`, GST guards tab | done |
| 8.66 | ⏳ 8D follow-ups: Table 3.2 split for composition dealers / UIN holders; GSTR-1A JSON; IRN cancel from the bulk tool's response; time bar for GSTR-6 / 7 / 8; one-off due-date extensions | — | open |

## Summary timeline

| Release | Theme | Approx. duration |
|---------|-------|------------------|
| v3.1.x | Correctness hotfixes | 1–2 weeks |
| v3.2 | Foundations: migrations, E2E, performance, security | 3–4 weeks |
| v3.3 | Getting paid & daily UX | 4–6 weeks |
| v3.4 | GST & accounting depth | 6–8 weeks |
| v4.0 | IndexedDB, asset storage, scale | 6–8 weeks |
| v4.x | 2B matching, GSTR-9, Hindi, POS, multi-device | ongoing |

Phases 2 and 3 can run in parallel if two people work on them; neither depends on the other beyond Phase 1.
