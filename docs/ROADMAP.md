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

### Accounting depth

| # | Item | Tally feature | Status |
|---|------|---------------|--------|
| 7.1 | ✅ **TDS on payables**: deduct on bill or on payment, sections 194C / 194J (prof / tech) / 194I (a / b) / 194H / 194Q / 194A, single + FY-aggregate thresholds, 206AA / 206AB / Sec 197, TDS payable ledgers per section (`src/lib/tds-payables.ts`, `tds-rules.ts`, `docs/features/tds-payables.md`) | TDS deduction on purchase / payment | done |
| 7.2 | ✅ **TDS / TCS challans** (ITNS 281: BSR, serial, date) linked to deductions; Sec 201(1A) / 206C(7) interest estimate; deposit / return due dates on `/tds` | Stat payment, TDS challan reconciliation | done |
| 7.3 | ✅ **Return working papers**: Form 26Q and 27EQ in RPU column order (CSV / XLSX / text, unverified), Form 16A data, filed marks; 27Q flagged only | Form 26Q / 27EQ e-return | done |
| 7.4 | ✅ **Voucher variants**: optional (make regular), memorandum, post-dated (with PDC summary), reversing journals, voucher classes (`src/lib/ledger/voucher-variants.ts`) | Optional / Memo / Post-dated / Reversing journal | done |
| 7.5 | ✅ **Bill-wise payables**: Agst Ref over several bills, Advance / On Account / New Ref, later adjustment, ageing, party bill-wise view, MSMED interest (`src/lib/billwise.ts`) | Bill-wise details, outstanding ageing | done |
| 7.6 | ✅ **Ratio analysis** from the ledger with drill-down (`src/lib/ledger/ratios.ts`) | Ratio Analysis | done |
| 7.7 | Form 27Q (non-residents), Sec 194-O/194R/194S, lower-deduction certificate limits, TRACES justification import | — | open |
| 7.8 | Vendor-form fields for PAN / deductee type / 206AB / Sec 197 (stored, not yet editable on the vendor form), TDS dates in the compliance calendar / notification bell | — | open |
| 7.9 | ✅ **Masters & openings ("Accounts Info")**: user groups / sub-groups under the Schedule III primaries (nature and gross-profit effect inherited), Group / Ledger Create · Alter · Display with Tally keys (Enter / Ctrl+A / Esc, Alt+C hook), ledger and party opening balances on a books-beginning date posted as an Opening voucher with the difference in opening balances reported, bill-wise opening outstandings in receivables ageing and statements, opening trial balance screen, ledger interest parameters (lib), bill allocation on manual receipts — `docs/features/masters.md` | Groups, Ledgers, Opening balances, Bill-wise details (WP-1: P0-1, P0-2, P0-11, P1-7 lib) | done (P1-21 import kinds, P2 cost categories: open) |

### Keyboard-first accounting (Gateway)

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
| 7.17 | ⏳ **Stock journal (Alt+F7) / Physical stock (Ctrl+F7)**: key hooks and menu rows ready (shown "not available"); wire them when the manufacturing / stock-count screens land (`GATEWAY_EXTENSIONS`, `TALLY_KEYS`) | — | S |
| 7.18 | ⏳ **Employee master / payroll vouchers** in Create, **TDS** statutory rows (7.1–7.3), **Ratio analysis** report (7.6) | add through `GATEWAY_EXTENSIONS` when those modules exist | S |
| 7.19 | ⏳ Bill-wise references (7.5) and voucher classes (7.4) on Gateway voucher entry, single-entry mode | needs a voucher schema addition | M |
| 7.20 | ✅ **Each bank account as its own ledger** (WP-5, P0-8): main account keeps 3510, others `bank:<id>` under Cash & bank or Bank OD A/c; receipts, supplier payments / advances, advance receipts / refunds, TDS challans and cheques post to their bank; per-bank openings; contra between banks (OD included); Books bank book per account; Tally one ledger per bank | `src/lib/bank-ledgers.ts`, `src/lib/ledger/postings-bank.ts`, `src/lib/tally-bank.ts`, `docs/features/banking.md` | M |
| 7.21 | ✅ **Banking documents** (WP-5, P1-14): deposit / pay-in slip with cheques + cash denominations (`PIS/FY…`), payment advice (bills settled + TDS), bulk e-payment file (generic NEFT / RTGS CSV + HDFC / ICICI / SBI presets — check the format with your bank), cheque against several invoices / bills, vendor bank details | `deposit-slip.ts`, `payment-advice.ts`, `bank-upload.ts`, `cheques.ts`, `BankingDocs.tsx` | M |
| 7.22 | ✅ **Bounce charges posting** and **day-end cash tally by denomination** (WP-5, P2) | `cheques.ts`, `cash-tally.ts` | S |
| 7.23 | ⏳ Banking follow-ups: forex bank ledgers, vendor-form UI for bank details (only in e-Payments now), record payments from an e-payment file after bank confirmation, supplier payments in the Tally export, Contra voucher from a deposit slip's cash | — | M |

### Purchase returns, receipt notes, order outstanding (WP-3)

| # | Item | Tally equivalent | Status |
|---|---|---|---|
| 7.20 | ✅ **Purchase return / supplier debit note** against a bill (`DN/FY<yy-yy>/<seq>`): quantity limited to billed less earlier returns, goods leave stock, ITC reversed, GST "reason for note", Agst Ref on the bill (bill-wise / payables), excess on account; Dr Creditors / Cr Purchase returns (5010) + input heads (`src/lib/purchase-returns.ts`, `ledger/postings-returns.ts`, `docs/features/purchase-returns.md`) | Debit Note (Ctrl+F9) | done |
| 7.21 | ✅ **Supplier credit note received** (supplier's number / date, value only or with goods, with or without a bill); GSTR-3B ITC net of notes (`itcAdjustmentsFromNotes`), GSTR-2B CDNR matching (`bookBills` notes), Tally Debit Note voucher (`tally-debit-notes.ts`) | Debit Note with supplier ref | done |
| 7.22 | ✅ **Receipt note (GRN)** → bill (PO → GRN → bill), **Rejections Out**, "Goods received not billed" (`src/lib/receipt-notes.ts`, stock source `events-returns.ts`) | Receipt Note (Alt+F9), Rejections Out | done |
| 7.23 | ✅ **Purchase order outstanding** report (GRN-accepted + directly billed vs ordered, overdue days) | Purchase Order Outstandings | done |
| 7.24 | Job work in / out (Rule 55 challans, 1 / 3-year return clocks, job-worker godowns) + **ITC-04** working paper; Rejections In (customer rejects a challan); sales-order outstanding (WP-8); GSTR-9 Table 6 / 9C use of supplier notes; TDS adjustment on a return of a TDS bill | Job Work Out / In Orders, Material Out / In, ITC-04 | open |

### Printing & documents output (WP-4)

| # | Item | Gap ids | Effort |
|---|------|---------|--------|
| 7.25 | ✅ **Printing & documents output**: Rule 48 copies in one print job / PDF with a per-profile default, transport details printed (GST dispatch cells + block), voucher printing, batch PDF / ZIP, bulk statements + confirmation-of-accounts letters, pre-printed stationery mode — `docs/features/printing.md` | P0-9, P1-15, P1-24, P1-6 (print), P2 | M |

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
