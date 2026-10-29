# Upgrade Roadmap

Status: in progress — Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Phase 4 ✅ · Phase 5 (5.1, 5.2, 5.3, 5.5–5.9 ✅; 5.4 partial: Hindi / Marathi core screens, other languages partial) · Phase 6 ✅ · Phase 7 / 8 ✅ (open follow-ups listed) · Round 2 ✅ · Round 3 ✅ + QA round 3 ✅ · Round 4 ✅ (R4-A / R4-B / R4-C, PERF-1 / PERF-2) + QA round 5 ✅ · Income-tax Act 2025 labels ✅ (23a–23d open) · Round 5 ✅ (R5-A / R5-B / R5-C industry packs) · QA round 6 ✅ (QA6-1 `6747241`, QA6-2 `10a5bc9`) · Round 6 ✅ (R6-A / R6-B / R6-C) · 7Q ✅ (7.116 open) · Rounds 7–18 ✅ (hotel, trading, retail, services, construction, agriculture, manufacturing, professional firms, travel, platform R16, manpower, housing societies) + QA rounds 7–21 ✅ · Round 19 (logistics) PRD drafted, being built · Open code work, owner and CA items: [`PENDING.md`](PENDING.md) · Baseline: v3.1.0 (2026-10-08) · Drafted 2026-10-24, updated 2026-10-28

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
| 5.4 | 🟡 partial — **Hindi-first i18n**: ✅ dependency-free `t()` / `useT()` with typed, lazily loaded catalogues and a device-local language switch (Settings, login, vault); ✅ Hindi for the shell, login / vault, Dashboard, editor main surface, payment dialog and list empty states; ✅ amount in words in Hindi on the Bilingual template; ✅ self-hosted Noto Sans Devanagari subset in the precache (PDFs no longer vary by device); ✅ Hindi for Reports, Books, GST reports and exports (round 2); ✅ more languages (8.121): Marathi covers the same core screens as Hindi (QA round 3, F19), Gujarati / Tamil the main labels only ("partial"), Bengali / Telugu / Kannada the shell. Remaining (as `docs/features/i18n.md` § Coverage says): several screens still English in Hindi, `src/lib` messages, and Gujarati / Tamil / Bengali / Telugu / Kannada beyond their current screens | L | |
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

Numbering: one sequence 7.1–7.61 in the sub-sections below (7L continues at 7.62, 7M at 7.70, 7N at 7.80, 7O at 7.90, 7P at 7.100, 7Q at 7.110) (renumbered after the WP merge; the work-package
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
| 7.9 | ✅ **Masters & openings ("Accounts Info")**: user groups / sub-groups under the Schedule III primaries (nature and gross-profit effect inherited), Group / Ledger Create · Alter · Display with Tally keys (Enter / Ctrl+A / Esc, Alt+C hook), ledger and party opening balances on a books-beginning date posted as an Opening voucher with the difference in opening balances reported, bill-wise opening outstandings in receivables ageing and statements, opening trial balance screen, ledger interest parameters (lib), bill allocation on manual receipts — `docs/features/masters.md` | Groups, Ledgers, Opening balances, Bill-wise details (WP-1: P0-1, P0-2, P0-11, P1-7 lib) | done (~~P1-21 import kinds~~ ✅ R6-C3; P2 cost categories: open) |
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
| 7.19 | ✅ Bill-wise references (Agst Ref / New Ref / Advance / On Account) and voucher classes on Gateway voucher entry, single-entry mode for Contra / Payment / Receipt — done in 7Q (7.111) | `src/lib/gateway/voucher-refs.ts`, `docs/features/voucher-types.md` | M |

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
| 7.28 | ✅ Job work in / out + **ITC-04** and Rejections In: see 7M (7.70–7.73); sales-order outstanding (WP-8, 7.63); GSTR-9 Table 6 / 9 use of supplier notes and TDS adjustment on a return of a TDS bill: done in 7O (7.93, 7.94). ~~Still open: 9C Table 12 split of supplier notes~~ (done in 7.127, `gstr9c-extra.ts`) | Job Work Out / In Orders, Material Out / In, ITC-04 | done |

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
| 7.49 | 🟡 WP-7 follow-ups: Tally import of inventory vouchers (quantities) and TDS challans in the Tally export — done in 7Q (7.113–7.115); Excel TB template path and per-FY auditor export with chain head — done on master (R6-C3 trial-balance preset, R4-C5 auditor pack); audit segment compression and archive of old FYs to a "history" company still open | — | partly done |

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
| 7.149 | 🟡 7T follow-ups: ✅ 17(2)(viia) accretion (Rule 3B calculator), ✅ Form 16 / 24Q perquisite lines with the 17(2)(vii) excess, 🟡 Form 12BA (statement of perquisites, layout not reproduced), ✅ 201(1A) late-deduction detection, ✅ arrear ECR checks (own, not the EPFO validator), ✅ hotel accommodation; ⏳ plan-asset movements for funded gratuity (CA P27), EV car rates (CA P26), PT challans for other States | — | partly done |


### 7Q · Voucher types, bill-wise voucher entry, books import (`docs/features/voucher-types.md`)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 7.110 | ✅ **Voucher Types master**: user voucher types under a base (Sales – Retail / Export, Receipt – Cash …) with prefix / suffix / starting number / width / yearly or monthly restart, print title, template, default bank (receipt / payment / contra) or godown (sales / notes), "use for POS"; picker in the invoice editor and both voucher editors only when a user type exists; documents without a type keep `INV/FY25-26/0001`; numbers never reused (`series_counters`) (`voucher-series.ts`, `voucher-types.ts`, table `voucher_types`) | P1-13 | done |
| 7.111 | ✅ **Gateway voucher entry (7.19)**: bill-wise references on a receipt's customer line (Agst Ref / New Ref / Advance / On Account through `saveReceiptVoucher`, all or nothing) and a payment's supplier line (a supplier payment through `billwise.ts`, one rollback, not also a PV); voucher class with the used list; single-entry mode for Contra / Payment / Receipt (Account + particulars) | — | done |
| 7.112 | ✅ **Excel / CSV import of books data**: ledgers (group + opening, Tally group names), suppliers (GSTIN / PAN / state / opening payable), stock items (group, unit, opening qty / rate), vouchers (journal / payment / receipt / contra as manual vouchers only) in the import wizard with templates, dry-run review, one undo copy, owner only (`import-books.ts`) | P1-21 | done |
| 7.113 | ✅ **Tally import of inventory quantities**: item lines of sales / purchase / note / stock-journal vouchers as stock moves where the item matches (alternate units, godown by name; quantity-only stock journals import as stock), never GST documents; re-import adds nothing (`tally-import-stock.ts`); Excel **trial-balance template** for openings | 7.49 | done |
| 7.114 | ✅ **Per-FY auditor export** of the audit trail: the FY's rows with `prev` / `hash`, chain head and whole-chain verification, CSV + JSON (`audit-export.ts`, Settings → Activity) | 7.49 | done |
| 7.115 | ✅ **TDS / TCS challans in the Tally export** as Payment vouchers from their ledger postings (`tally-tds.ts`) | 7.49 | done |
| 7.116 | ⏳ 7Q follow-ups: voucher types for purchase / stock / payroll series, bill-wise references when altering a payment voucher and on journals, Excel import of sales / purchase vouchers, batches / serials on imported Tally item lines | — | open |

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
| 7.131 | ⏳ 7R follow-ups: Form 15CA / 15CB, surcharge and Sec 195A grossing-up on 27Q; 27Q FVU text; TRACES flags in the Deductions tab; ~~refund of IGST on goods exports (shipping-bill route)~~ (✅ R4-C2, tracked as an export-incentive row); filed ITC refunds netted in the carried credit; ISD ledger postings and GSTR-6 amendments; books column on 9C rate-wise Table 9; Table 13 of GSTR-9 Part V; operator-side Table 15 / 3.1.1(i) | — | open |

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
| 7.158 | ⏳ 7U follow-ups: foreign-currency supplier payments from an EEFC account, bank-specific response presets, revaluation reversal option, TDS 194H on commission, ~~agent on POS bills~~ (done in 8.81), per-customer offers, ESC/POS QR / logo, Schedule X register book format | — | open |


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
| 7.167 | 🟡 7S follow-ups: ~~serial counts on Physical Stock~~ (done, `physicalLines` serial path), ~~MRP lead times / dated demand buckets~~ (done in R13 MF-A4, `mf-mrp-dated.ts`) and ~~open plans~~ (done, `openPlanDemand`, netted as demand), ~~price lists on POS~~ (done in 8.145, `priceListRate` in `Pos.tsx`), ~~cost-centre closing stock~~ (done, `ledger/cost-centre-stock.ts`, Project P&L memo rows); ITC-04 JSON checked against the offline tool — **not possible** (no published schema; stays `verified: false`, G43); e-Way JSON for goods returned to a principal (sub-type 6) — exists as `buildJwReturnEway`, supply type **waits on MF92** | — | partly done |

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
| 8.7 | ✅ 8A follow-ups: ~~balance snapshot on recurring / converted / late-fee documents issued outside the editor~~ (✅ R6-C5), ~~per-party reminder language~~ (done in 8.121, `message-langs.ts`), ✅ statement web page from list rows, ✅ non-INR khata (foreign balances per currency on the Clients list; receipts stay in Receivables) (PENDING 50) | `Clients.tsx`, `StatementViewer.tsx`, `khata.ts` `foreignBalances` | done |

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
| 8.66 | ✅ 8D follow-ups: Table 3.2 split for composition dealers / UIN holders (`Client.gst_reg_type`); GSTR-1A JSON (`gstr1a-json.ts`, unverified layout); IRN cancel from the bulk tool's response; time bar for GSTR-6 / 7 / 8; one-off due-date extensions as data rows (`DUE_DATE_EXTENSIONS`) | `gst-reports.ts`, `gstr1a-json.ts`, `einvoice-bulk.ts`, `gst-guards.ts`, `compliance.ts` | done |

### 8B · Phone & counter (`docs/features/pwa-backup.md`, `docs/features/pos-barcode-pricing.md`)

From the Vyapar / myBillBook / OkCredit comparison: the phone and the shop counter.

| # | Item | Where | Status |
|---|------|-------|--------|
| 8.20 | ✅ **Phone backup that happens**: encrypted "Share backup" through Web Share L2 (Drive / WhatsApp / Files; `.txt` fallback for Android Chrome; owner only; never readable in vault mode); nudges after 10 new documents or 3 days; "Backed up 2 h ago ✓ / Not backed up — tap to save" on the phone Dashboard and in the bell; a backup shared into the app opens the restore flow (owner, validation, undo copy) | `backup-share.ts`, `phone-backup.ts`, `ShareBackupDialog.tsx`, `BackupStatusLine.tsx` | done |
| 8.21 | ✅ **Hold & new bill**: up to 9 parked carts (Shift+F8), recall list (F1, keys 1–9), kept per company on the device (`DEVICE_DRAFT_KEYS`: sealed, not backed up / synced) | `pos-hold.ts`, `HeldBills.tsx` | done |
| 8.22 | ✅ **UPI QR at the counter** for the exact UPI amount (`am`, `tr` = bill number), full-screen customer view, "Paid? enter UTR"; **quick-item tiles** (favourites + stock groups); zero / negative stock in red | `PosUpiQr.tsx`, `pos-tiles.ts`, `PosTiles.tsx` | done |
| 8.23 | ✅ **PWA entry points**: shortcuts (POS, Payment in → `/clients?pay=1`, New expense); `share_target` for backups, receipt images / PDFs (→ new expense with attachment) and CSV / XLSX (→ bank-statement import) | `manifest.json`, `sw.js`, `share-inbox.ts`, `ShareTarget.tsx` | done |
| 8.24 | ✅ **Add party from contacts** (Contact Picker API, Android Chrome, feature-detected) | `contact-pick.ts`, `ContactPickButton.tsx` | done |
| 8.25 | ✅ **Calculator in number fields** ("120*3+40", "1000+18%"), tiny parser, no eval | `calc-expr.ts`, `NumberInput.tsx` | done |
| 8.26 | ✅ **Web Bluetooth thermal printing** (BLE 58 / 80 mm ESC/POS, off by default, `bluetooth=(self)`), browser-print fallback | `escpos.ts`, `PosPrinter.tsx` | done |
| 8.27 | ◐ 8B follow-ups: share-target on iOS (no Web Share Target there), remembered BLE printer across reloads (`getDevices` still behind a flag), ~~Payment-in quick-pay screen~~ (the 8.150 PWA path), ✅ tiles for price-list items (PENDING 50), held carts across devices (deliberately not synced) | `pos-tiles.ts`, `PosTiles.tsx` | partly done |

### 8C · Capture, bank rules, approvals (`docs/features/bill-capture.md`, `docs/features/banking.md` § Bank rules)

Competitor parity with Zoho Books / Xero / QuickBooks / Refrens / TallyPrime 7.0 purchase capture and bank automation — without OCR or any network call.

| # | Item | Where | Status |
|---|------|-------|--------|
| 8.40 | ✅ **Supplier bill capture from the e-invoice signed QR**: camera (BarcodeDetector), photo / screenshot (BarcodeDetector on an ImageBitmap) or pasted text; JWT payload decoded (SellerGstin, BuyerGstin, DocNo, DocTyp, DocDt, TotInvVal, ItemCnt, MainHsnCode, Irn, IrnDt — **signature not verified offline**); draft bill prefilled (vendor by GSTIN or "Add supplier", bill no. / date / value / HSN, GST backed out when the HSN master knows the rate of a one-item bill, IRN stored as `einvoice_irn`), warning when BuyerGstin is none of our profiles, file kept as an attachment; PDFs are kept but their QR is not read (no PDF engine shipped) | `einvoice-qr.ts`, `bill-capture.ts`, `capture-browser.ts`, `InboxTab.tsx` | done |
| 8.41 | ✅ **Unprocessed documents inbox** (`doc_inbox`) + **draft bills** (`purchase_drafts`, out of the books): make bill / make expense / dismiss; `openCaptureFromFile(file)` and `inboxDb.add` for the PWA share target | `doc-inbox.ts`, `purchase-drafts.ts` | done |
| 8.42 | ✅ **Duplicate supplier bill guard**: same supplier (GSTIN / vendor / name) + normalised bill no. in the same FY, or same amount within ±3 days → soft warning, save again to override; possible duplicates listed in the exception report | `bill-duplicates.ts`, `bill-guard.ts`, `ledger/exceptions.ts` | done |
| 8.43 | ✅ **Recurring bills / expenses** (`recurring_bills`, recurring.ts date rules): each occurrence writes a **draft** (never posted), idempotent; bell: supplier bills due this week, recurring bills due, drafts / inbox waiting (lazy provider) | `recurring-bills.ts`, `RecurringBillsPanel.tsx`, `capture-alerts.ts` | done |
| 8.44 | ✅ **Approvals for bills, expenses and supplier payments**: thresholds (0 = all), clerk's bill held in `purchase_drafts` and payment in `payment_requests` (out of the books); owner approves (posts / pays) or rejects with a reason; shared `approvals` history; data-layer gate in `purchasesDb.save`; payments from bank statements / cheques / confirmed e-payment files exempt | `purchase-approval-gate.ts`, `purchase-approvals.ts`, `PurchaseApprovals.tsx` | done |
| 8.45 | ✅ **Bank rules + memory** (`bank_rules`): ALL / ANY of narration contains / starts with / safe regex, counterparty token, amount range, debit / credit, bank account → expense (head, supplier, GST + ITC, cost centre, branch, mode), voucher to a ledger, receipt against a customer's invoices, contra (twin reused), ignore; run after invoice matching; every suggestion labelled Rule / Match / Memory; memory learned from past expense categorisations; "Create rule for similar lines?" after a manual expense; all-or-nothing batches through the existing writers (roles, period lock, approval gate, audit) | `bank-rules.ts`, `bank-rules-apply.ts`, `BankRulesPanel.tsx`, `RuleSuggestions.tsx` | done |
| 8.46 | ◐ 8C follow-ups (PENDING 48): ✅ QR from images embedded in a PDF (no page rendering — no PDF engine), ✅ multi-line GST split from the full e-invoice JSON, ✅ memory for receipts / vouchers, ✅ payment approval inside the e-payment batch; ✗ GST on voucher rule actions (vouchers never reach GSTR-3B / ITC — use the expense action); total-JS budget headroom | `pdf-images.ts`, `einvoice-qr.ts`, `bill-capture.ts`, `bank-rules.ts`, `epay-confirm.ts` | partly done |

### 8I · Filing & capture UX (`docs/features/gst-reports.md`, `docs/features/bill-capture.md`)

From competitor tutorials (myBillBook "Scan invoice" in Purchases, Refrens "Validate report → error report → download", Tally "resolve exceptions → export JSON"). Working papers only — verify with your CA.

| # | Item | Where | Status |
|---|------|-------|--------|
| 8.160 | ✅ **Scan bill** button in the Expenses header (books.edit): lazy chooser — live e-invoice QR with the camera (BarcodeDetector, where available), take a photo, or pick a photo / PDF → `openCaptureFromFile`; a camera QR drafts the bill via `captureFromQrText`; ends on the inbox row | `ScanBillDialog.tsx`, `capture-browser.ts`, `Expenses.tsx` | done |
| 8.161 | ✅ **Check before JSON download**: GSTR-1 / GSTR-3B / IFF JSON first run the GST exceptions, the report's errors / warnings and the Rule 46 series gaps; anything found → lazy dialog grouped by problem with Fix links, "Download anyway" / "Review"; clean → straight download; "· n ⚠" badge on the JSON buttons | `gst-preflight.ts`, `PreflightDialog.tsx`, `GstReports.tsx` | done |
| 8.162 | ✅ **Filing mode**: steps strip (Period ✓ → Check (n) → Download JSON → Mark filed, marks shared with the Compliance tab) and the 29 GST tabs grouped GSTR-1 / GSTR-3B / Reconcile / Tools (grouped tablists with ←/→ on desktop, a select on phones); every old `?tab=` id still resolves | `gst-tabs.ts`, `GstReports.tsx`, `filing.module.css` | done |
| 8.163 | ✅ Phones: the record-payment row button in the Invoices list shows a visible "₹ Received" label | `Transactions.tsx` | done |
| 8.164 | ✅ ~~8I follow-ups: per-form preflight rules (3B without HSN checks), "Mark filed" for IFF / CMP-08, remembering the downloaded step across reloads~~ — done in R6-C4 (`FilingStrip.tsx`, `compliance.ts` `downloaded_at`, `gst-preflight.ts` per form) | — | done |

### 8F · Distribution, pharma, stock depth (`docs/features/distribution.md`)

| # | Item | Gap ids | Status |
|---|------|---------|--------|
| 8.80 | ✅ **Credit-limit enforcement** (BUSY / Marg / Zoho): policy Off / Warn / Block per company + per party, open sales orders and overdue-beyond-credit-days options; editor and POS (saved customers, unpaid part); Block holds a clerk's document in the approval queue (`reason: 'credit'`), owner override audited (`credit-policy.ts`, `holdIfCreditBlocked` in `approval-gate.ts`) | — | done |
| 8.81 | ✅ **Distribution masters & reports**: areas / beats / routes, party area / beat / default salesman, sales / outstanding / collections by salesman / beat / area, returns by beat, day-wise beat plan, agent on POS bills; **offline order pad** with HMAC-signed order files (share / file / QR) imported as sales orders with dedupe (`distribution.ts`, `order-pad.ts`) | — | done |
| 8.82 | ✅ **Van sales**: van godown kind, van load (transfer), van settlement (returns + cash vs bills, `VST/FY…`), pick lists by bin (`van.ts`, `pick-list.ts`) | — | done |
| 8.83 | ✅ **Fast / slow / non-moving and ABC analysis** (`stock-analysis.ts`) | — | done |
| 8.84 | ✅ **Pharma operations** (Marg): Breakage / Expiry Issue grouped by supplier with debit notes + claims, claim tracking, Breakage / Expiry Receive into a non-saleable Expiry godown, destruction with an ITC-reversal reminder (verify with your CA), salt / substitute search, block sale above batch MRP (`expiry-ops.ts`, `salt-search.ts`, `saleLimitGate`) | — | done |
| 8.85 | ✅ **Item variants** (attribute grid → child items with SKUs / barcodes) and **kits** consuming BOM components on sale (`variants.ts`, `events-kits.ts`) | — | done |
| 8.86 | ✅ **Bin / rack** on items and batches, snapshotted on delivery challan lines and printed on pick lists (`bins.ts`) | — | done |
| 8.87 | ✅ **Thermal roll labels**: 50×25, 38×25 2-up, 100×50 presets; raw TSPL / EPL / ZPL over Web Serial or file; weighed-goods EAN-13 with embedded price (`label-sheet.ts`, `label-raw.ts`) | — | done |
| 8.88 | ✅ 8F follow-ups: one debit note spanning several bills of a supplier (`createMulti`, on account), ~~POS decoding of weighed-goods codes~~ (done in 8.140, `parseScaleBarcode`), kit shortfall warnings (`kitComponentDemand`), order-pad partial import / camera QR scan (existing `CameraScanner`) | `purchase-returns.ts`, `events-kits.ts`, `order-pad.ts` | done |
### 8E · Retail speed (`docs/features/pos-barcode-pricing.md` § 8E)

| # | Item | Where | Status |
|---|---|---|---|
| 8.140 | ✅ **Weighing-scale barcodes**: device-local profile (prefixes 20–29, PLU length, weight / price, decimals, check digit), item `sold_by_weight` + `plu`; weight × rate or exact embedded price; **live weight over Web Serial** (stable ASCII frame → focused quantity, Alt+W) | `scale-barcode.ts`, `scale-serial.ts`, `RetailSettings.tsx` | done |
| 8.141 | ✅ **Keyboard speed pack**: `3*code` / `3 code` / `3*` quantity prefix, item `short_code` (POS + editor typeahead), `=500` gross → rate (and "=" in a rate field), Alt+Q last line's quantity, unknown code → search kept + create item, Ctrl+F5 day summary, Shift+F1 help, PgUp / PgDn bill browser, **custom function keys** (device-local keymap) | `pos-keys.ts`, `pos.ts` (`keyCombo`, `posShortcut(e, keymap)`), `PosHelp.tsx`, `DaySummary.tsx`, `BillBrowser.tsx` | done |
| 8.142 | ✅ **Cashier shifts** (`pos_shifts`): open with float per user, X report, Z per shift with cash count, close blocked while bills are on hold; day close unchanged | `pos-shifts.ts`, `ShiftPanel.tsx` | done |
| 8.143 | ✅ **Customer-facing display** (`/pos-display` pop-up, BroadcastChannel): lines, total, UPI QR, thank-you / change; nothing stored | `pos-display.ts`, `CustomerDisplay.tsx`, `cross-tab.ts` | done |
| 8.144 | ✅ **More tenders**: Cheque, Wallet, On account (saved customers, credit-limit check) — each with "fill rest" | `pos.ts`, `Pos.tsx` | done |
| 8.145 | ✅ **MRP less %** on items and price levels; **selling price lists on the POS** | `pricing.ts`, `catalog.ts`, `Pos.tsx` | done |
| 8.146 | ✅ **Alt+P** opens the POS from anywhere | `DashboardLayout.tsx`, `useHotkeys.ts` | done |
| 8.147 | ✅ **Change strip**: full-width "Give change ₹…" for 3 s after saving | `Pos.tsx` | done |
| 8.148 | ✅ **WhatsApp this bill** (beside Reprint, save toast; prompt when no phone; UPI link for a balance) | `pos-share.ts` | done |
| 8.149 | ✅ **Create item from an unknown code** (POS + editor scan bar) | `QuickItemSheet.tsx`, `catalog.ts` | done |
| 8.150 | ✅ Wiring: PWA "Payment in" (`/clients?pay=1`) → party picker → ₹ Received sheet; shared image / PDF → "Capture as supplier bill (read e-invoice QR)" or "New expense" | `PartyPicker.tsx`, `Clients.tsx`, `ShareTarget.tsx` | done |
| 8.151 | ◐ 8E follow-ups (PENDING 50): ✅ GS1 price check digit on scale labels, ✅ USB-HID / Bluetooth (Weight Scale Service) scales, ✅ drawer hand-over between shifts, ~~short codes on stock-only items~~ (QA-3 F24); ✗ VFD pole displays (no verifiable command set), Option+P on macOS (R20-A keyboard work) | `scale-barcode.ts`, `scale-serial.ts`, `pos-shifts.ts` | partly done |
### 8G · Invoicing UX & insights (`docs/features/invoicing-ux.md`)

Zoho Books / FreshBooks / Xero / TallyPrime 7 habits, offline: deposits and acceptance without a portal, SmartFind, insights computed on the device.

| # | Item | Where | Status |
|---|---|---|---|
| 8.100 | ✅ **Deposits & payment schedules**: additive `payment_schedule` (% or ₹ instalments with due dates) on quotes / proformas / orders / invoices, printed; reminders, ageing and the cash forecast follow the earliest unpaid instalment; "Request deposit" records an advance receipt voucher (Rule 50) or raises a proforma; the advances banner applies part of an advance | `payment-schedule.ts`, `schedule-tools.ts`, `doc-snapshots.ts`, `PaymentScheduleCard.tsx`, `AdvanceNotice.tsx` | done |
| 8.101 | ✅ **Quote acceptance offline**: client copy "Accept" / "Request changes" (pre-filled wa.me / mailto, no script); counter acceptance with an on-canvas signature + name + timestamp snapshotted once on the quote (`acceptance`), printed, Accepted, audited | `quote-acceptance.ts`, `AcceptQuoteDialog.tsx`, `AcceptanceBlock.tsx`, `client-copy.ts` | done |
| 8.102 | ✅ **Live margin chip** in the summary (latest purchase rate → standard cost → opening rate), deferred, hidden from viewers, never printed | `margin.ts`, `MarginChip.tsx` | done |
| 8.103 | ✅ **SmartFind**: bills, suppliers, payments / advances, vouchers, cheques, GSTIN / PAN / IRN / UTR, amounts (`12.5k`, `₹12,500`, `>50k`, `10k-20k`), typo tolerance, optional all-companies read-only peek; index cached per storage version | `smart-find.ts`, `search.ts`, `company-peek.ts`, `CommandPalette.tsx` | done |
| 8.104 | ✅ **Last rate to this party** applied below price levels / lists (basis "Last rate"), with a chip to use it or go back to the catalogue rate | `last-rate.ts`, `pricing-actions.ts`, `LastRateHints.tsx` | done |
| 8.105 | ✅ **Today card** (sales, cash / UPI / bank, udhaar, expenses, cash in hand, "Share to my WhatsApp") and the **post-save success sheet** (WhatsApp with UPI link + party outstanding, Share PDF, Print, Record payment, New; stays until dismissed; bottom sheet on phones) | `today.ts`, `TodayPanel.tsx`, `send-summary.ts`, `SendSheet.tsx` | done |
| 8.106 | ✅ **Bulk actions** on filtered Transactions / Receivables: bulk remind (logged) and bulk bad-debt write-off (confirmed, audited; ledger Dr Other expenses / Cr debtors, never cash) | `write-off.ts`, `BulkCollectDialog.tsx`, `ReceivablesBulk.tsx` | done |
| 8.107 | ✅ **MTD / QTD / YTD** presets on the report period bar | `books.ts` `periodForPreset`, `PeriodBar.tsx` | done |
| 8.108 | ✅ **Offline insights** (deterministic): revenue vs 3-month average, top customers, expense heads spiking, DSO change, customers paying slower, margin erosion, stock at risk, GST payable trend; each card drills into its report | `insights.ts`, `InsightsPanel.tsx` (dashboard tile) | done |
| 8.109 | ✅ **Saved report views** (device-local: name + tab + period + every report's F12 options) and **month-end packs** (P&L, BS, ageing, GSTR-1 / 3B papers in one ZIP; monthly schedule offered by the bell, auto-written to a connected backup folder) | `report-views.ts`, `report-pack.ts`, `report-pack-alerts.ts`, `ReportViewsBar.tsx` | done |
| 8.110 | ✅ **Editor flow** (competitor tutorials): Record payment in Document actions; payment mode chips + UTR and "Fully paid" on Amount received (the receipt is recorded with that mode); split Save (Save / Save & print / Save & WhatsApp, remembered per device); Alt+P print, Alt+D duplicate; customer & items first (document details as one line, party extras behind "More details"); "Cash sale (walk-in)" chip | `counter-receipt.ts`, `PayModeChips.tsx`, `save-choice.ts`, `MetaSummary.tsx`, `editor-actions.ts`, `PartiesSection.tsx` | done |
| 8.111 | ✅ 8G follow-ups: PDF (not just ZIP) month-end pack; GST relief on bad debts (none in GST — documented only); schedule instalments on recurring templates; insights per branch; signature pad in the POS | — | done (PENDING 49, `features/invoicing-ux.md` §8.111) |
### 8H · Shop mode, languages, reach (`docs/features/shop-mode.md`, `docs/features/i18n.md`, `docs/features/loans.md`, `docs/features/security.md` § user rights)

Vyapar / myBillBook / OkCredit parity for small shops, offline. First-paint JS +0.4 kB gz (176.7 → 177.1).

| # | Item | Where | Status |
|---|------|-------|--------|
| 8.120 | ✅ **Shop mode**: business type (Kirana / Wholesale / Services / Manufacturer / CA-full) with module presets; company-level `modules` filter the sidebar and Dashboard tiles; Ctrl+K, links and Settings → Defaults → "Show all features" reach everything; existing companies = full | `shop-mode.ts` (shell), `shop-presets.ts`, `ShopModePanel.tsx`, `DashboardLayout.tsx` | done |
| 8.121 | ✅ **Languages**: Marathi, Gujarati, Tamil (shell, Dashboard, editor, payment, POS, Clients) + Bengali, Telugu, Kannada (shell) in one lazy chunk; phrase glossary lets any `defineArea` screen be translated without touching its area file; amount in words (mr / gu / ta); reminders, party reminders and WhatsApp statements in Hindi / Marathi / Gujarati / Tamil; per-party **message language** on the client | `src/i18n/{mr,gu,ta,bn,te,kn,regional}.ts`, `amount-in-words-in.ts`, `message-langs.ts`, `ClientFormModal.tsx` | done |
| 8.122 | ✅ **Catalogue v2**: item photos (asset refs, inlined), categories (stock groups), MRP / offer badges, a one-message WhatsApp **cart** under a hash-pinned CSP, script-free per-category order links | `catalogue-html.ts`, `catalogue-export.ts`, `item-images.ts`, `CatalogPanel.tsx` | done |
| 8.123 | ✅ **Loans & EMIs**: reducing-balance schedule, disbursement Receipt voucher, EMI Payment vouchers split interest / principal through `saveVoucher`, statement CSV; table `business_loans` (backup, roles, sync DATED + NUMBERED, `LOAN/FY…` via series-counters) | `loans.ts`, `pages/Loans.tsx` | done |
| 8.124 | ✅ **Finer user rights** (convenience access control): per-document create / alter / delete / print, back-dated days allowed, discount cap %, POS-only cashier preset; device-local user record, audited; `can()` / `requireAccess()` honour them; owner-only actions never lifted | `rights.ts` (shell), `user-rights.ts`, `RightsEditor.tsx` | done |
| 8.125 | ✅ **Currency master**: dated reference rates (manual, RBI / FBIL CSV import), FX documents pick the rate by date (`currency_rates`) | `currency-rates.ts`, `CurrencyRatesPanel.tsx`, `ForexFields.tsx` | done |
| 8.126 | ✅ **Import presets**: QuickBooks Online, Xero, Refrens, ClearOne, Marg (BUSY already) | `import-mapping.ts` | done |
| 8.127 | ✅ **Delivery challan**: "hide amounts on print" (quantities only) and "returnable challan" with return-by date | `GstExtrasFields.tsx`, `ChallanQtyTable.tsx`, `TemplateEngine.tsx` | done |
| 8.128 | ✅ **Quick create**: phone "+" opens a sheet (Sale invoice, POS bill, ₹ Payment in, Expense, Purchase bill, Quotation) filtered by role and modules; device setting keeps the old one-tap; Dashboard quick-action row | `quick-create.ts`, `QuickCreateSheet.tsx`, `DashboardStart.tsx` | done |
| 8.129 | ✅ **Wizard step 0 + checklist v2**: language + business type (due days, template, landing on POS for kirana), composition → Bills of Supply, "Explore with sample data instead" in a separate Demo company; checklist adds item, WhatsApp, payment, backup; "Try with sample data" on an empty Dashboard | `onboarding.ts`, `SetupWizard.tsx`, `demo-company.ts`, `checklist.ts` | done |
| 8.130 | ⏳ 8H follow-ups: more keys for Bengali / Telugu / Kannada and amount in words for them; self-hosted Noto subsets only if a script renders badly; loan prepayment re-schedule and interest certificates; per-voucher-type rights for purchases / vouchers in their own screens; catalogue cart for non-INR | — | open |

## Round 2: what the established suites still do better (v6.x) · ✅ done

Spec: `docs/prd/round-2.md` (Zoho Books / Tally / Busy / Marg / Vyapar survey, 18 items in three packages).

### R2-A · Collections & settlement (`docs/features/collections-r2.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R2-A1 | ✅ **Payment terms master** (Net N, EOM + N, day D of next month, instalments, early-pay discount); editor picker, party default, printed schedule, MSME Sec 43B(h) note; table `payment_terms` | `payment-terms.ts`, `TermsPicker.tsx`, `PaymentTermsPanel.tsx` | done |
| R2-A2 | ✅ **Settlement discount / short payment (kasar)** on a receipt → financial credit note `FCN/FY…` (no GST by default, optional pro-rata GST variant; clerk cap → approval queue) | `settlement.ts`, `financial-note.ts`, `SettleRestFields.tsx` | done (verify with your CA) |
| R2-A3 | ✅ **Bad-debt write-off** (single + bulk, owner), register, same-FY / earlier-FY recovery; table `write_off_recoveries` | `write-off.ts`, `WriteOffDialog.tsx`, `WriteOffRegister.tsx` | done |
| R2-A4 | ✅ **Follow-ups & promise-to-pay**: next action, kept / broken promises hold or escalate reminders, bell notices, party timeline; table `collection_notes` | `collections.ts`, `FollowUpsTab.tsx`, `PartyTimeline.tsx` | done |
| R2-A5 | ✅ **Reminder schedule**: per-stage start and cooldown, editable templates (English / Hinglish), per-party reminder mode; key `reminder_settings` | `reminders.ts`, `reminder-settings.ts`, `ReminderSchedulePanel.tsx` | done |
| R2-A6 | ✅ **Statement styles** (balance forward / open items / transactions) + ageing strip | `statement-styles.ts`, `StatementDocument.tsx` | done |
| R2-A7 | ✅ **Party payment score** (grade A–D, reasons, trend) on ageing rows, statements, editor credit warning, reminder priority | `payment-score.ts`, `PaymentScoreBadge.tsx` | done |

### R2-B · Sales documents (`docs/features/sales-r2.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R2-B1 | ✅ **Batch invoices** from a template to many parties, all-or-nothing, consecutive numbers, re-run guard, undo; table `batch_runs` | `batch-invoices.ts`, `BatchTab.tsx` (`/recurring?tab=batch`) | done |
| R2-B2 | ✅ **Progress / milestone billing** from quotations and sales orders (stage invoices, remaining-balance invoice, progress report) | `progress-billing.ts`, `ProgressPanel.tsx`, `ProgressReportModal.tsx` | done |
| R2-B3 | ✅ **Quotation revisions**, optional / alternative lines, proposal sections; table `proposal_snippets` | `quote-revisions.ts`, `proposal-sections.ts`, `RevisionsPanel.tsx` | done |
| R2-B4 | ✅ **Contact persons & ship-to address book** on parties, Kind attn. on the paper, import / export columns | `contacts.ts`, `ContactsEditor.tsx`, `AddressBookEditor.tsx` | done |
| R2-B5 | ✅ **Sales order → back-to-back purchase orders** (drop-ship) and a backorders view | `back-to-back.ts`, `SoToPoDialog.tsx`, `BackordersView.tsx` | done |

### R2-C · Books, compliance & output (`docs/features/books-output-r2.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R2-C1 | ✅ **Annual accounts pack** with notes to accounts (BS / P&L with previous FY, cash flow, TB, automatic + text notes; print / PDF / Excel / ZIP); table `notes_to_accounts` | `ledger/annual-pack.ts`, `ledger/notes-auto.ts`, `AnnualPackTab.tsx` | done |
| R2-C2 | ✅ **Deferred revenue & prepaid expense schedules** (monthly / daily release journals, register); table `deferrals` | `deferrals.ts`, `DeferralsTab.tsx` | done |
| R2-C3 | ✅ **IMS ITC reduction** and the IMS working file (dated remark rule `IMS_REMARK_RULES`) | `gstr2b.ts`, `ims-file.ts`, `ImsDetails.tsx` | done (layout unverified) |
| R2-C4 | ✅ **Packing list** `PKL/FY…` with package types, net / gross weight, CBM; tables `packing_lists`, `package_types` | `packing.ts`, `packing-print.ts`, `PackingListDialog.tsx` | done |
| R2-C5 | ✅ **Design Studio labels** per document type, title suffix, logo-accent swatches | `design-prefs.ts`, `labels.ts`, `logo-colour.ts` | done |
| R2-C6 | ✅ **Display & accessibility** preferences (text size, high contrast, motion, links, tap targets, focus ring), device-local `mrchartist_display_prefs` | `display-prefs.ts`, `DisplayPanel.tsx`, `public/theme-init.js` | done |

## Round 3: freelancer apps, Indian niche tools, app-store favourites (v6.x) · ✅ done

Spec: `docs/prd/round-3.md` (18 items in three packages; every R3 module is lazy).

### R3-A · Restaurant & counter (`docs/features/restaurant.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R3-A1 | ✅ **Tables & running orders** (`/tables`): dining areas with price level and optional service charge, takeaway / delivery / aggregator tokens (Sec 9(5)), move / merge / transfer, settle as a POS bill; tables `dining_areas`, `dining_tables`, `table_orders`, key `restaurant_settings` | `restaurant/tables.ts`, `orders-store.ts`, `pages/Tables.tsx` | done (verify with your CA) |
| R3-A2 | ✅ **KOT**: station routing, daily `K<n>`, cancellation tickets with reason and owner-PIN cap, reprint, KOT register with leakage table; device-local `mrchartist_kot_printers` | `restaurant/kot.ts`, `kot-print.ts`, `KotRegister.tsx` | done |
| R3-A3 | ✅ **Split bill** (equal / custom payers on one invoice; item / seat parts as consecutive invoices; exact GST reconciliation) | `restaurant/split-bill.ts` | done |
| R3-A4 | ✅ **Modifiers / add-ons and "86"** (item or stock group off for today; optional auto-86, off by default); table `modifier_groups` | `restaurant/modifiers.ts`, `ModifiersPanel.tsx` | done |
| R3-A5 | ✅ **Share the bill as an image** (JPEG / PNG, A4 slices or one roll image, copy image) from the preview and the POS | `share-image.ts`, `BillImageShare`, `ShareMenu.tsx` | done |

### R3-B · Service billing & party speed (`docs/features/service-billing-r3.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R3-B1 | ✅ **Rate cards** (task → project → client → work type → default) + re-rate unbilled; table `work_types` | `rate-cards.ts`, `WorkTypesCard.tsx` | done |
| R3-B2 | ✅ **Projects**: hours / fee budget, tasks, board / list, estimate vs actual, 80 / 100% bell; table `project_tasks`, key `project_settings` | `projects.ts`, `ProjectsBoard.tsx`, `project-alerts.ts` | done |
| R3-B3 | ✅ **Prepaid retainer hours**: drawdown, rollover / forfeit, overage, period close, report; table `retainers` | `retainers.ts`, `RetainersTab.tsx`, `RetainerReport.tsx` | done (verify with your CA) |
| R3-B4 | ✅ **Timesheet & expense annexure** snapshot (`InvoiceRecord.annexure`), printed as a following page | `annexure.ts`, `AnnexureBlock.tsx`, `AnnexureActions.tsx` | done |
| R3-B5 | ✅ **Party document defaults** (template, currency, discount, notes / terms, hourly rate, annexure, print language) | `party-defaults.ts`, `DocDefaultsFields.tsx` | done |
| R3-B6 | ✅ **Repeat last bill (Alt+R) and usual items** in the editor and the POS | `party-habits.ts`, `PartyHabitsStrip.tsx`, `UsualTiles.tsx` | done |
| R3-B7 | ✅ **Customers gone quiet**: insight, Clients chip, report, WhatsApp nudge; key `quiet_settings` | `quiet-customers.ts`, `QuietCustomers.tsx` | done |

### R3-C · Document polish & compliance desks (`docs/features/docs-compliance-r3.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R3-C1 | ✅ **Live paper preview** (≥ 1280 px, off by default, device-local `mrchartist_editor_layout`) and live template tiles | `editor-layout.ts`, `LivePreviewPane.tsx`, `TemplateThumb.tsx` | done |
| R3-C2 | ✅ **Job evidence**: item photos on lines, photo pages, receiver signature (`delivery_proof`) | `line-images.ts`, `doc-evidence.ts`, `DeliveryProofDialog.tsx`, `PhotoPages.tsx` | done |
| R3-C3 | ✅ **Page margins and letterhead / footer artwork**, repeated per PDF page | `design-prefs.ts`, `PagePanel.tsx`, `PageArt.tsx`, `pdf-batch.ts` | done |
| R3-C4 | ✅ **GST portal file reader** (GSTR-1 error report, downloaded GSTR-1): match, corrected subset JSON, diff; table `gst_portal_files` | `gst-portal-files.ts`, `PortalFilesView.tsx` | done (formats unverified) |
| R3-C5 | ✅ **e-Way desk**: computed validity (date-keyed `eway-validity.ts`), expiry bell, bulk Part-B / transporter update JSON | `eway-validity.ts`, `eway-desk.ts`, `eway-alerts.ts`, `EwayDesk.tsx` | done (verify with your CA) |
| R3-C6 | ✅ **Practice desk** (`/practice`, owner): all companies' compliance read-only (`peekCompliance`), DSC register, monthly client checklist; tables `dsc_register`, `client_checklist`, key `checklist_template` | `practice.ts`, `dsc-register.ts`, `client-checklist.ts`, `pages/Practice.tsx` | done |

### QA round 3 fixes (`docs/prd/qa-round-3.md`) · ✅ done

Hands-on audit of the built app after Round 2 (27 findings: 3 P0, 4 P1, 20 P2), fixed in two packages.

| # | Item | Where | Status |
|---|---|---|---|
| QA-1 | ✅ **Money and data paths** (F1–F7, F15, F16, F26, F27): shift X/Z counts returns; POS refunds reach the khata and receivables (`posRefunds`, `receivables.md`); no payment against a quotation; Demo company / sample data filled after the flush; recurring drafts unnumbered until issued, "Run now" asks before a future period (`recurring.md`); POS dialogs at 390 px; Dashboard and Receivables agree on outstanding; company switcher name | `pos-shifts.ts`, `receivables.ts`, `localDb.ts`, `recurring.ts`, `stats.ts`, `company-registry.ts` | done |
| QA-2 | ✅ **Documents, GST, settings, i18n** (F3 UI, F8–F14, F17–F25): HSN rows without HSN, date-keyed slab pickers (`GST_SLAB_RULES` in `tax-rules.ts`), own-GSTIN warning, expense amount label, bill dirty guard, backup / restore copy, Compact preset, interim annual pack, Marathi / Hindi strings (`i18n.md`), editor and document labels, 130% overflow | `gst-reports.ts`, `tax-rules.ts`, `gst-guards.ts`, `design-prefs.ts`, `ledger/annual-pack.ts`, `src/i18n/` | done |

## Round 4: makers, store chains, exporters, trust leaders (v6.x) · ✅ done

Spec: `docs/prd/round-4.md` (17 items in three packages; combined budget ≤ +0.9 kB gz first paint).

### R4-A · Production, costing & traceability (`docs/features/production-r4.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R4-A1 | ✅ **Production orders** `WO/FY…`: WIP godown, issue / output / return / close (scrap write-off), make to order from a sales order, MRP → orders; table `production_orders` | `production/orders.ts`, `order-alerts.ts`, `/manufacturing?tab=orders` | done |
| R4-A2 | ✅ **Order costing**: standard vs actual, price / usage / yield / conversion variances, SO margin, cost-centre memo row | `production/costing.ts`, `CostingTab` | done (management working; verify with your CA) |
| R4-A3 | ✅ **Batch genealogy & recall**: backward / forward trace, recall list, printable notice, block batch; table `recall_notices` | `production/genealogy.ts`, `TraceTab`, `RecallList` | done |
| R4-A4 | ✅ **QC hold & release** (QC godown, GRN hold for `qc_on_receipt` items, release / reject, bell); table `qc_results`, key `qc_settings` | `production/qc.ts`, `receipt-notes.ts` `applyQcHold`, `QcTab` | done |
| R4-A5 | ✅ **Landed-cost voucher** `LCV/FY…` across bills / GRNs (value, quantity, weight, equal), restating stock from the receipt date; table `landed_cost_vouchers` | `landed-voucher.ts`, `landed-cost.ts`, `inventory.ts` `liveInputs` | done |
| R4-A6 | ✅ ~~R4-A follow-ups: call `applyQcHold` in the purchase-bill save path; feed the margin chip / insights `liveInputs().purchases`; Inventory → "Landed cost" link; pre-filled debit note from a QC reject~~ — done in R6-C1 (the Inventory link is R6-B's header line) | `purchases.ts`, `margin.ts`, `insights.ts`, `QcTab`, `ReturnsTab` | done |

### R4-B · Stores & chains (`docs/features/retail-chains-r4.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R4-B1 | ✅ **Gift vouchers** `GV/FY…`: Luhn-checked code + random suffix, bulk issue, sale as a receipt voucher to "Gift vouchers outstanding" (no invoice, no GST), redemption as a POS tender or payment method (`Payment.gift_voucher_id`, no money moved), promotional vouchers as a discount, breakage to Other income; tables `gift_vouchers`, key `gift_voucher_settings` | `retail/gift-vouchers.ts`, `gift-voucher-core.ts`, `/receivables?tab=giftvouchers` | done (verify with your CA) |
| R4-B2 | ✅ **Loyalty tiers & points expiry** (FIFO expiry, tier multipliers, liability report); key `loyalty_program` gains `tiers` / `expiry_months` | `retail/loyalty-tiers.ts`, `LoyaltyTiers`, `LoyaltyLiability` | done |
| R4-B3 | ✅ **Store price lists**: branch precedence in `resolvePrice`, dated store overrides, item × store grid with CSV, POS counter branch (device-local `mrchartist_pos_branch`); table `branch_prices`, `Branch.price_level_id` | `retail/store-prices.ts`, `StorePricesGrid`, `BranchesPanel` | done |
| R4-B4 | ✅ **Transfer requests** `TRQ/FY…`: approve, dispatch to an in-transit godown, receive with shortage (write-off journal), Rule 55 challan, own-use e-Way JSON; table `transfer_requests`, `StockTransfer.request_id` / `leg` | `retail/transfer-requests.ts`, `transfer-challan.ts`, `/inventory?tab=transfers&view=requests` | done (verify with your CA) |
| R4-B5 | ✅ **Store replenishment** from the warehouse (`Godown.replenish_from`, netting pending and in-transit, remainder to a PO with MOQ) | `reorder.ts`, `ReplenishTab` | done |

### R4-C · Trade desk & trust (`docs/features/trade-trust-r4.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R4-C1 | ✅ **Exporter profile, LUT register & export fields** (IEC / AD code, Incoterm, ports, countries …; `LUT_MISSING` / `LUT_OUTSIDE_FY` preflight, LUT bell); table `lut_register` | `trade/{exporter,lut-register,lut-alerts}.ts` | done |
| R4-C2 | ✅ **Export desk**: realisation register, IRMs / e-BRC, write-offs, RoDTEP / drawback / IGST-refund claims and scrips (realisation months in date-keyed `trade/trade-rules.ts`); tables `export_irms`, `export_incentives`, `export_writeoffs` | `trade/{export-register,export-incentives,export-alerts}.ts`, `/gst-reports?tab=export-desk` | done (verify with your CA) |
| R4-C3 | ✅ **Bill of Entry duty** (BCD / SWS / other duties into stock cost, IGST / cess into ITC, `PurchaseRecord.boe_duty`, duty journal, pay with a RoDTEP scrip) | `trade/{boe-duty,boe-post}.ts`, `BoeDutySheet` | done (verify with your CA) |
| R4-C4 | ✅ **Recycle bin & accessible Undo**: every watched delete captured (`binRows`), restore through the table's own guarded path, retention 7–90 days (`bin_settings`); deleted invoice / voucher numbers stay reserved in `series_counters`; table `recycle_bin` (backed up, not synced) | `audit-edits.ts`, `trust/recycle-bin.ts`, `UndoDeleted`, Settings → Data → Recently deleted | done |
| R4-C5 | ✅ **Auditor pack** per FY (audit log, deletions, back-dated, overrides, integrity hash, users; year-end mark `auditor_pack`) — closes the 7.49 "per-FY auditor export with chain head" part | `trust/auditor-pack.ts` | done |
| R4-C6 | ✅ **Export everything** (one CSV per table / object, child line CSVs, optional workbook, `schema.json`) | `trust/{open-export,open-export-schema}.ts` | done |
| R4-C7 | ✅ **Field-level sync conflicts** (`Resolution` `{ merge: picks }`, bulk actions) | `trust/field-merge.ts`, `ConflictMerge` | done |
| R4-C8 | ⏳ R4-C follow-ups: bin capture of rows replaced by a restore or a sync "Use theirs"; 3-way field merge with base rows in `sync_state` (non-overlapping masters are approximated today); signed PDF summary in the auditor pack if Rule 11(g) needs it; second dated realisation rule for INR-settled exports | — | open (verify with your CA) |

### Performance round 4 (`docs/prd/perf-round-4.md`) · ✅ done

Scale audit on a 15k-invoice company; two fix packages with mostly disjoint files.

| # | Item | Where | Status |
|---|---|---|---|
| PERF-1 | ✅ **Data layer, background work, save path** (H1, H2, H3, H6, H10, H11): parsed-rows cache (one parse per stored version, `peekTable`, copy-on-write `getTable`), `table-memo.ts` memoised derived results, quiet stamp-gated bell, memoised stock engine, save without re-parse, ledger running-balance index, single-parse backup. Cold start 14.6 s → 6.6 s, bell 5 s → 57 ms, parses of `invoices` per save 24 → 0 | `storage.ts`, `table-memo.ts`, `localDb.ts`, `notifications.ts`, `inventory.ts`, `books.ts`, `backup.ts` | done |
| PERF-2 | ✅ **UI layer** (H4, H5, H7, H8, H9, H12): pre-folded SmartFind index, cheap editor typeahead, one peek per Dashboard, grouped receivables scores, collator-based invoice list, peeked reads in POS / GST | `search.ts`, `smart-find.ts`, `suggest.ts`, `Dashboard.tsx`, `Receivables.tsx`, `Transactions.tsx` | done |
| PERF-3 | ✅ The full stringify + IndexedDB rewrite of the `invoices` table per save is gone: a big table is stored in chunks of 16 rows and a save / payment re-serialises and writes one chunk (5,000 invoices ≈ 7 KB each: save 139 → 4 ms, payment 103 → 2 ms; 20,000: save 1.7 s → 5 ms, payment 466 → 3 ms, Node + fake IndexedDB). Audit appends were coalesced in R15-A2. The rest of save time is the editor's own re-render | `storage.ts`, `audit.ts` | done |

### QA round 5 fixes (`docs/prd/qa-round-5.md`) · ✅ done

Hands-on audit of Rounds 2–4 and the perf work (22 findings: 8 P0, 3 P1, 11 P2), fixed in two packages.

| # | Item | Where | Status |
|---|---|---|---|
| QA5-1 | ✅ **Collections, write-off and composition money paths** (F1, F2, F3, F11, F12, F13, F18, F20): pending settlement notes count against the due; write-off of the net due after credit notes / FCNs; no FCN in CMP-08 / GSTR-4 turnover; same-FY recovery in a locked month; clerks cannot remove a write-off row; FCNs out of "Sales by customer"; clerk cap in rupees; one receipt keeps only the promise it meets | `settlement.ts`, `approvals.ts`, `write-off.ts`, `composition-returns.ts`, `gstr4-annual.ts`, `localDb.ts`, `sales-reports.ts`, `collections.ts` | done |
| QA5-2 | ✅ **Books, service, sales documents, production, restaurant, CSV security** (F4–F10, F14–F17, F19, F21, F22): retainer overage kept; deferral basis = taxable value in INR and never a release before the initial deferral; atomic schedule delete; batch place of supply / PO number / draft numbering; CSV formula guard on practice / e-Way exports; QC / transit-held stock not saleable; unselected optional lines dropped on a tax invoice; progress-billing rounding; split add-on paise; practice ghost company; SO → PO free stock | `retainers.ts`, `deferrals.ts`, `batch-invoices.ts`, `Practice.tsx`, `eway-desk.ts`, `inventory.ts`, `stock-tracking.ts`, `useInvoiceStore.ts`, `progress-billing.ts`, `split-bill.ts`, `back-to-back.ts` | done |

## Income-tax Act 2025 labels (`docs/features/income-tax-act-2025.md`, `docs/prd/round-5.md` §7 Q1) · ✅ done

From 1 Apr 2026 TDS / TCS sections and forms show the 2025-Act reference with the old code in brackets, by the
document / transaction date; stored codes, return marks and keys are unchanged.

| # | Item | Status |
|---|---|---|
| 23 | ✅ Income-tax Act 2025 section / form labels across TDS, TCS, receivables, payroll, editor and exports (date-keyed, append-only `ACT_REF_RULES` / `FORM_REF_RULES` / `OLD_CODE_SHOWN_RULES` in `src/lib/ita2025.ts`) | done: labels only, stored codes unchanged |
| 23a | ⏳ Confirm the Sec 393 / 394 table items against the enacted Act and flip `verified` with new dated entries | open (verify with your CA) |
| 23b | ✅ 2025-Act RPU section codes for Forms 140 / 143 / 144 (`RPU_2025_CODE_RULES` in `tds-rules.ts`, Protean file formats v1.2) | done (tour package / luxury goods codes picked in the RPU) |
| 23c | ⏳ Form 143 due dates (15th vs 31st; `TDS_DUE_RULES` keeps the 15th) | open |
| 23d | ✅ Finance Act 2026 TCS rates (tour package / LRS education 2%), a new `TCS_PRESET_RULES` row from 2026-04-01 (`verified: false`) | done |

## Round 5: industry packs for Indian SMB verticals (v6.x) · ✅ done

Spec: `docs/prd/round-5.md` (18 items in three packages). Every vertical sits behind an **industry pack**
(`src/lib/industry-packs.ts`): an explicit `settings.industry_packs` list wins, else the packs implied by
`business_type`, else none — existing companies see no change. A pack that is off hides its tabs and bell notices only.

### R5-A · Industry packs & marketplace seller (`docs/features/marketplace-r5.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R5-A1 | ✅ **Industry packs**: six business types, pack switch in Settings → Defaults → Shop mode, `PACK_TABS` palette group "Industry packs" | `industry-packs.ts`, `shop-presets.ts`, `palette-destinations.ts` | done |
| R5-A2 | ✅ **Sales channels, clearing account, channel-SKU map** (`BankAccount.clearing`, never offered by cheque / e-pay / BRS pickers via `pickableBankAccounts`); tables `sales_channels`, `channel_skus` | `marketplace/{channels,sku-map}.ts`, `bank-accounts.ts` | done |
| R5-A3 | ✅ **Marketplace sales / returns import** (Amazon / Flipkart / Meesho presets, marketplace numbers, summary mode, undo); table `marketplace_imports`, `InvoiceRecord.channel_*` | `marketplace/sales-import.ts` | done (verify with your CA) |
| R5-A4 | ✅ **Settlement import & payout reconciliation**, post / unpost through the clearing account; table `settlements` | `marketplace/settlement-{import,recon,post}.ts` | done |
| R5-A5 | ✅ **GST TCS / TDS credit** (GSTR-8 / GSTR-7 accept / reject) and **194-O** matching; table `eco_credits` | `marketplace/{tcs-credit,tds-194o}.ts` | done (verify with your CA) |
| R5-A6 | ✅ **Returns / RTO / claims desk** with claim windows; table `marketplace_returns` | `marketplace/returns-desk.ts` | done |
| R5-A7 | ⏳ R5-A follow-ups: a refund paid in a later settlement than the sale shows the customer in credit on Receivables; per-order months above 3,000 rows are slow (summary mode offered) | — | open |

### R5-B · Transport & works contracts (`docs/features/transport-works-r5.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R5-B1 | ✅ **Consignment notes** `LR/FY…` and the GTA option per FY (RCM / forward charge); tables `consignment_notes`, `gta_options` | `transport/{consignment-notes,gta-option,lr-print}.ts` | done (verify with your CA) |
| R5-B2 | ✅ **Freight bills from LRs** (`InvoiceRecord.lr_ids`, LR annexure) | `transport/freight-bill.ts` | done |
| R5-B3 | ✅ **Vehicles, trips** `TRP/FY…`, **hired lorries** with 194C(6) nil TDS (`Vendor.transporter_194c6`, reason `T`); cost-centre kind `vehicle`; tables `vehicles`, `trips` | `transport/{vehicles,trips,trip-pnl}.ts`, `tds-payables.ts` | done (verify with your CA) |
| R5-B4 | ✅ **BOQ and measured RA bills** (`ProgressBasis 'measured'`, `boq_terms`, `InvoiceItem.boq_ref`); tables `ra_measurements`, `boq_coefficients` | `works/{boq,measurements,ra-abstract}.ts` | done |
| R5-B5 | ✅ **RA deductions**: retention, advance recovery, 194C, GST TDS (Sec 51), labour cess; deduction receipts (`ra_journal_id`) through the "RA deductions clearing" account | `works/{deductions,ra-receivable,ra-due}.ts` | done (verify with your CA) |
| R5-B6 | ✅ **Sites**: material at site (`Godown.kind 'site'`, non-saleable) and site cost | `works/sites.ts` | done |
| R5-B7 | ⏳ R5-B follow-ups: a cancelled RA bill's RA number is issued again; RA abstract / LR annexure print as their own pages, not through the annexure component | — | open |

### R5-C · Institutions, non-profits & property (`docs/features/institutions-property-r5.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R5-C1 | ✅ **Fee plans**: heads, instalments, concessions, fines, enrolments, fee runs; tables `fee_plans`, `fee_runs` | `institutions/{fee-plans,enrolments,fee-billing,fee-dues}.ts` | done (verify with your CA) |
| R5-C2 | ✅ **Rule 42 / 43 common credit** (journals of class "ITC reversal — Rule 42 / 43" → GSTR-3B 4(B)(1) via `itcReversals`); table `common_credit_runs` | `institutions/common-credit.ts`, `gst-reports.ts` | done (verify with your CA) |
| R5-C3 | ✅ **Donations** `DON/FY…`, 80G / 35 receipts, Form 10BD / 10BE; tables `donations`, `form_10bd_filings`, `form_10be` | `nonprofit/{donations,donation-receipt,form-10bd}.ts` | done (verify with your CA) |
| R5-C4 | ✅ **Funds and FCRA** (cost-centre kind `fund`, `BankAccount.fcra`, FC-4, Sec 11 application) | `nonprofit/{funds,fund-statement,fcra-checks,fc4,application}.ts` | done (verify with your CA) |
| R5-C5 | ✅ **Leases**: rent, CAM, escalation, GST class, 194-I; tables `properties`, `leases` | `property/{properties,leases,escalation,lease-gst}.ts` | done (verify with your CA) |
| R5-C6 | ✅ **Security deposits** (adjustment receipts `deposit_adjustment_id`, no money moved); table `security_deposits` | `property/deposits.ts` | done |
| R5-C7 | ⏳ R5-C follow-ups: ~~GSTR-9 / compliance / report pack do not pass `itcReversals` yet (the GSTR-3B tab does)~~ (✅ R6-C4); gifts in kind create no voucher; FC-4 lists totals, not the portal's line items | — | open |

## QA round 6 · ✅ done

Hands-on audit of Round 4 (R4-B / R4-C), QA round 5 fixes, the Income-tax Act 2025 labels and Round 5
(`docs/prd/qa-round-6.md`). Fixed in two packages: QA6-1 `6747241` (recycle-bin module hooks, one no-cash predicate,
vouchers in the cash / bank book and BRS) and QA6-2 `10a5bc9` (feature-module findings F2, F3, F6–F10, F12–F15, F18).

## Round 6: consolidation and beta-tester productivity (v6.x) · ✅ done

Spec: `docs/prd/round-6.md` (17 items in three packages: R6-A first run, help and feedback; R6-B discoverability;
R6-C open-roadmap closures and the docs refresh).

### R6-A · First run, help and feedback (`docs/features/help-onboarding-r6.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R6-A1 | ✅ **Setup checklist v3**: steps by business type, packs, modules and role; skip a step, hide the card (Help → Setup checklist brings it back); company object `setup_progress` | `checklist-steps.ts`, `checklist.ts`, `DashboardStart.tsx` | done |
| R6-A2 | ✅ **"On this screen" help**: registry route + tab → topic, six lazy topic files (~210 topics), Help search, CA checklist ids on statutory topics; coverage test ("a new tab needs a help topic") | `lib/help/registry.ts`, `lib/help/topics-*.ts`, `HelpModal.tsx` | done (F1 wired in the shell at integration) |
| R6-A3 | ✅ **Statutory explainers**: "About this tab" strips on GST / TDS / payroll, 35-term glossary popovers, GST / TDS empty states, one-line GST working-paper notice | `AboutStrip.tsx`, `Term.tsx`, `lib/help/glossary.ts` | done (verify with your CA) |
| R6-A4 | ✅ **What's new and the real version** (`__APP_VERSION__` from package.json; `check-whats-new` in postbuild; Dashboard card once after an upgrade) | `whats-new.ts`, `WhatsNewCard.tsx`, `scripts/check-whats-new.mjs` | done |
| R6-A5 | ✅ **Report a problem v2**: problem / idea / question, scrubbed fields, screens-before trail, Copy / WhatsApp / e-mail / Share with no fixed recipient | `feedback.ts`, `route-trail.ts`, `diagnostics.ts`, `ReportProblemDialog.tsx` | done (the shell pushes the trail) |
| R6-A6 | ✅ **Beta guide in the app and one-time screen tips** | `lib/help/beta-guide.ts`, `lib/help/tips.ts`, `ScreenTip.tsx` | done |

### R6-B · Discoverability, empty states and sample data (`docs/features/discoverability-r6.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R6-B1 | ✅ **Ctrl+K finds every tab**: a "Tabs" group over every page's tab list with portal terms and short words ("3b", "tb", "lr", "80g"), "(hidden)" for screens shop mode hides, a "Features" group, "help …" searches help topics (once R6-A's registry exists), a "Try:" line on the empty palette | `palette/{tab-index,synonyms}.ts`, `pages/page-tabs.ts`, `command/tab-destinations.ts` | done |
| R6-B2 | ✅ **Sidebar reach**: Distribution and Manufacturing entries; a screen hosting an active pack's tab stays in shop mode (`PACK_ROUTES`); "N more features — Show"; Practice desk only for CA / several companies; F1 Help, route trail, open-help event | `DashboardLayout.tsx`, `shop-mode.ts`, `help-event.ts` | done |
| R6-B3 | ✅ **Empty states** with the first step on Books, Inventory, Reports, Exports, Distribution, Practice, Reconcile, Gateway; Inventory → Landed cost link | `empty-states.ts`, `components/discover/*` | done (tips mounted on Books, Inventory, Reports, Gateway, Invoices) |
| R6-B4 | ✅ **Sample data v2**: one path to a separate, resettable Demo company (never into a real company), dataset by business (counter, services, trading, transport, works), "Reset samples" | `demo-data.ts`, `lib/demo/*`, `demo-company.ts`, `SampleDataChooser.tsx` | done (Dashboard mounts the chooser) |
| R6-B5 | ✅ **Settings → Features**: every module, pack and 21 advanced options with who needs it, on / off and a switch or a link | `features-catalog.ts`, `FeaturesPanel.tsx` | done |

### R6-C · Open-roadmap closures and the docs refresh (`docs/features/closures-r6.md`)

| # | Item | Where | Status |
|---|---|---|---|
| R6-C1 | ✅ **R4-A follow-ups**: QC hold on goods bills booked without a GRN (new lines only; an edit never re-holds released goods); margin chip and insights cost goods at the landed rate (`liveInputs().purchases`); "Debit note to supplier" from a QC reject of a bill lot opens Returns with the bill and quantities filled (`bill` / `lines` params) | `purchases.ts` `withBillQcHold`, `margin.ts` `liveUnitCosts`, `QcTab`, `ReturnsTab` | done |
| R6-C2 | ✅ **Payables completeness**: supplier opening bills in bill-wise payables (age from their own date, settle Agst Ref through `vendor_payments.allocations[].opening_bill_id`, typed opening residual "On Account"; payables = ledger creditor balance); customer TDS on a voucher-allocated receipt reaches TDS receivable (`voucherTdsJournal`) and the register; POS refunds credit the original receipt's bank ledger | `billwise.ts`, `opening-bills.ts`, `bill-allocation.ts`, `ledger/postings.ts`, `pos-returns.ts` | done (verify with your CA) |
| R6-C3 | ✅ **Import suppliers, ledgers and opening balances** (P1-21): kinds `vendors` / `ledgers` / `opening_bills`, presets for Vyapar, Busy, Marg, Tally, QuickBooks, Xero, Zoho, Refrens, ClearOne and a generic trial balance; dry run with the 1090 difference, nearest-primary group mapping with a warning, GSTIN de-duplication; all or nothing with one undo copy; one row per run in table `import_runs` | `import-openings.ts`, `import-mapping.ts`, `ImportWizard` | done |
| R6-C4 | ✅ **Filing strip & Rule 42 / 43 everywhere**: forms follow the period and filer (GSTR-1 + 3B, IFF in QRMP months 1–2, CMP-08 for a composition quarter); "downloaded" on the compliance row (`downloaded_at`); per-form preflight (IFF without HSN checks, CMP-08 composition checks only); `itcReversals` in GSTR-9 (Table 7C and each month's 3B), 9C, the Compliance interest base and the month-end pack | `FilingStrip.tsx`, `compliance.ts`, `gst-preflight.ts`, `gstr9.ts`, `report-pack.ts` | done (verify with your CA) |
| R6-C5 | ✅ **Previous-balance block on documents issued outside the editor** (8.7): recurring runs in issue mode, batch runs (one snapshot per party), late fees and conversions issued directly, `issueDraft` | `khata-actions.ts` `withIssueSnapshot`, `recurring.ts`, `batch-invoices.ts`, `late-fee.ts`, `documents.ts` | done |
| R6-C6 | ✅ **Docs refresh**: stale roadmap rows struck through, BETA_GUIDE known limitations / flows, CA_REVIEW cross-references, feature-doc stale items | `docs/` | done |
| R6-C7 | ⏳ R6-C follow-ups: issuing a draft from a list row (not the editor) still takes no balance snapshot unless it goes through `issueDraft`; stock opening quantities in the import (PRD §7 Q7); the GSTR-9 7C / 7D split of a combined Rule 42 / 43 journal | — | open (verify with your CA) |

## Rounds 7–19: industry verticals and the platform round (v6.x)

Each round has a PRD in `docs/prd/round-<n>.md` (problem, findings with sources, ranked list, specifications, work
packages) and a feature doc with what shipped, deviations and cuts. Every round was followed by a QA round (table
below) whose findings were fixed with regression tests. Rows still open are in [`PENDING.md`](PENDING.md) §2.

| Round | Vertical / theme | Packages | Feature doc | Status |
|---|---|---|---|---|
| 7 | Hotels and lodging (pack `hotel`) | R7-A front office, R7-B folio and billing, R7-C compliance and reports | `hotel-r7.md` | ✅ done (QA9) |
| 8 | Trading: distributors, wholesalers, commodity / mandi traders, agents | TR-A distributor, TR-B commodity / mandi, TR-C agents and tax rules | `trading-r8.md` | ✅ done (QA8) |
| 9 | Retail shops | RT-A kirana / shared, RT-B pharmacy, RT-C apparel, RT-D electronics, RT-E jewellery | `retail-r9.md` | ✅ done (QA10) |
| 10 | Service businesses: clinics / labs, salons, gyms, coaching, workshops | SV-A front desk, SV-B clinics, SV-C memberships, SV-D workshops | `services-r10.md` | ✅ done (QA12) |
| 11 | Construction: contractors, sub-contractors, builders, interiors, MEP, labour | CN-A profile and bill paper, CN-B contractor finance, CN-C builders (`realty`), CN-D site operations | `construction-r11.md` | ✅ done (QA11) |
| 12 | Agriculture and food processing: FPOs, dairy, mills, cold storage, input dealers | AG-A farm base, AG-B dairy, AG-C mills, AG-D cold storage / inputs / FPO | `agri-r12.md` | ✅ done (QA13) |
| 13 | Manufacturing MSMEs beyond R4-A | MF-A shop floor, MF-B engineering / plastics / press, MF-C garments, MF-D food / FMCG and statutory desk | `mfg-r13.md` | ✅ done (QA15, QA16) |
| 14 | Professional firms: CA / CS, law, architects, IT and service exporters, media | PS-A practice core, PS-B disbursements / legal, PS-C export of services, PS-D statutory desk | `prof-r14.md` | ✅ done (QA17) |
| 15 | Travel, tour and events, plus size recovery and party netting | R15-A size / netting, R15-B travel core, R15-C air tickets and supplier settlement, R15-D outbound TCS and events | `travel-r15.md` | ✅ done (QA18) |
| 16 | Platform round: size headroom, unwired engines, statutory watch | R16-A size recovery (Hindi packs, safe chunk groups), R16-B Round 14 engines wired, R16-C travel / hotel leftovers, R16-D cross-cutting quality and pending-change notes | `docs/prd/round-16.md`, `prof-r14.md` §R16-B, `travel-r15.md` §R16-C | ✅ done (QA19) |
| 17 | Security, facility-management and manpower agencies | R17-A manpower core, R17-B duty register and billing, R17-C compliance and profitability, R17-D arrears and renewals | `manpower-r17.md` | ✅ done (QA20) |
| 18 | Co-operative housing societies, AOAs and RWAs | R18-A society core, R18-B billing run and GST (with `saveMany`), R18-C dues and collections, R18-D funds and statutory | `society-r18.md` | ✅ done (QA21) |
| 19 | Freight forwarders, customs brokers (CHA), courier franchises, 3PL | LG-A … LG-D (job files, house-bill margin, CHA disbursements, courier dockets, storage billing) | `docs/prd/round-19.md` | 🟡 PRD drafted, being built |

### QA rounds 7–22

| QA round | Scope | Report | Fixes |
|---|---|---|---|
| 7 | Round 6 (R6-A help / onboarding, R6-B discoverability and sample data) | `qa-round-7.md` | ✅ G1–G10 (`9013d7d`: Demo company marker, modal stack, report links, palette roles) |
| 8 | Round 8 trading | `qa-round-8.md` | ✅ T1–T16 (`8283e26`) |
| 9 | Round 7 hotel | `qa-round-9.md` | ✅ H1–H16 (`df2fcf8`, `tests/hotel-qa9.test.ts`) |
| 10 | Round 9 retail | `qa-round-10.md` | ✅ R1–R17 (`99ae620`) |
| 11 | Round 11 construction | `qa-round-11.md` | ✅ fixed in the loop (`tests/qa11-construction.test.ts`) |
| 12 | Round 10 services | `qa-round-12.md` | ✅ fixed in the loop (`tests/qa12-services.test.ts`) |
| 13 | Round 12 agriculture | `qa-round-13.md` | ✅ fixed in the loop (`tests/qa13-agri.test.ts`) |
| 14 | Whole-app regression of a plain company and pack leaks (Rounds 7–12) | `qa-round-14.md` | ✅ fixed in the loop (`tests/qa14-core.test.ts`) |
| 15 | Round 13 MF-A … MF-C | `qa-round-15.md` | ✅ fixed in the loop (`tests/qa15-mfg.test.ts`) |
| 16 | MF-D and QA15's open items | `qa-round-16.md` | ✅ fixed in the loop (`tests/qa16-mfg.test.ts`) |
| 17 | Round 14 professional firms | `qa-round-17.md` | ✅ fixed in the loop (`tests/qa17-prof.test.ts`) |
| 18 | Round 15 travel and R15-A netting | `qa-round-18.md` | ✅ fixed in the loop (`tests/qa18-travel.test.ts`) |
| 19 | Round 16 platform (Hindi packs, safe groups, service worker) | `qa-round-19.md` | ✅ fixed in the loop (`tests/qa19-platform.test.ts`) |
| 20 | Round 17 manpower | `qa-round-20.md` | ✅ fixed in the loop (`tests/qa20-manpower.test.ts`) |
| 21 | Round 18 housing societies and the bulk save (`saveMany`) | `qa-round-21.md` | ✅ fixed in the loop (`tests/qa21-society.test.ts`) |
| 22 | Round 19 logistics (forwarders, CHA, courier, agents) | `qa-round-22.md` | ✅ fixed in the loop (`tests/qa22-logistics.test.ts`) |

Left-as-found items and cut features of these rounds are tracked in [`PENDING.md`](PENDING.md) §2 (closed ones in §6).

## Summary timeline

| Release | Theme | Approx. duration |
|---------|-------|------------------|
| v3.1.x | Correctness hotfixes | 1–2 weeks |
| v3.2 | Foundations: migrations, E2E, performance, security | 3–4 weeks |
| v3.3 | Getting paid & daily UX | 4–6 weeks |
| v3.4 | GST & accounting depth | 6–8 weeks |
| v4.0 | IndexedDB, asset storage, scale | 6–8 weeks |
| v4.x | 2B matching, GSTR-9, Hindi, POS, multi-device | ongoing |
| v5.x | Competitive parity (Phase 6), Tally parity (Phase 7), 8A–8I daily-use packages | done |
| v6.x · Round 2 | Collections & settlement, sales documents, books & output (R2-A / R2-B / R2-C) | done |
| v6.x · Round 3 | Restaurant & counter, service billing, document polish & compliance desks (R3-A / R3-B / R3-C), then QA round 3 fixes (QA-1 / QA-2) | done |
| v6.x · Round 4 | Production & traceability (R4-A), stores & chains (R4-B), trade desk & trust (R4-C), scale fixes PERF-1 / PERF-2, then QA round 5 fixes (QA5-1 / QA5-2) | done |
| v6.x · ITA 2025 | Income-tax Act 2025 section / form labels by date (23); 23a–23d open | done |
| v6.x · Round 5 | Industry packs: marketplace seller (R5-A), transport & works contracts (R5-B), institutions, non-profits & property (R5-C) | done |
| v6.x · QA round 6 | Hands-on audit of R4-B / R4-C, QA round 5, ITA 2025 and Round 5 (QA6-1 / QA6-2 fixes) | done |
| v6.x · Round 6 | Consolidation: first run, help and feedback (R6-A), discoverability and sample data (R6-B), open-roadmap closures (R6-C), then QA round 7 | done |
| v6.x · 7Q | Voucher types, bill-wise voucher entry, books import (7.110–7.115; 7.116 open) | done |
| v6.x · Rounds 7–15 | Hotel, trading, retail, services, construction, agriculture, manufacturing, professional firms, travel — each followed by its QA round (8–18) | done |
| v6.x · Round 16 | Platform round: size headroom (Hindi packs, safe chunk groups), unwired engines, statutory watch (QA19) | done |
| v6.x · Rounds 17–18 | Manpower agencies (QA20), housing societies and `saveMany` (QA21) | done |
| v6.x · Round 19 | Logistics: freight forwarders, CHA, couriers, 3PL | in progress |

Phases 2 and 3 can run in parallel if two people work on them; neither depends on the other beyond Phase 1.
