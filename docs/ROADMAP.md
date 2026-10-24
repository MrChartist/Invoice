# Upgrade Roadmap

Status: in progress — Phase 0 ✅ · Phase 1 ✅ · Phase 2 ✅ · Phase 3 ✅ · Baseline: v3.1.0 (2026-10-08) · Drafted 2026-10-24

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
| 4.1 | **Logo/signature assets stored by reference**: snapshot holds a content hash, the asset lives once in an asset table, backups embed it. Historical invoices still render the same (Critical Rule 3) | M | 1.1, 1.3 |
| 4.2 | **Move tables to IndexedDB** behind a synchronous in-memory cache; one-time migration from localStorage with rollback; shared connection in `idb-kv.ts`. **Keep every `mrchartist_inv_*` table name** | L | 1.1, 1.2, 1.3, 1.8 |
| 4.3 | ✅ **Virtualise long tables** (Transactions, Receivables): long tasks of 235–280 ms at 300 invoices before; windowing + cached `Intl` formatters, numbers in `docs/qa/performance.md` | M | — |
| 4.4 | ✅ **Split large components**: `ImportWizard` (835 lines, 24 `useState`) → `wizard-state.ts` reducer + four step components; `InvoiceCreator` (527 → ~340 lines) → `CreatorHeader`, `DocumentMetaCard`, `MobileSaveBar`, `useCreatorKeys` | M | 1.5 |
| 4.5 | **Tamper-evident audit log**: hash-chained rows; restore adds a marker row instead of replacing the log; no silent drop when storage is full | M | 4.2 |
| 4.6 | ✅ Full `strict` mode on (done in Phase 1) | — | 1.7 |

---

## Phase 5: Reach & multi-device (v4.x) · ongoing

Larger features, each of which can ship on its own once Phases 1–4 are done.

| # | Item | Effort | Notes |
|---|------|--------|-------|
| 5.1 | **GSTR-2B import & matcher**: user loads the portal JSON/Excel locally; match on GSTIN + bill no. + value; feeds 4A(5) | L | Needs 3.2 |
| 5.2 | **GSTR-9 annual working paper** from 12 months of GSTR-1/3B + HSN, compared against books | M | Needs 3.1, 3.2 |
| 5.3 | **Advances / receipt vouchers / Table 11** (tax on service advances, adjusted against the later invoice) | L | Needs 3.1 |
| 5.4 | **Hindi-first i18n**: string extraction, amount in words in Hindi, self-hosted Noto Sans Devanagari subset in the precache (fixes PDFs that vary by device today); then Marathi/Tamil/Gujarati | L | |
| 5.5 | **POS / thermal quick-bill mode**: one-screen counter billing, walk-in customer, 80 mm auto-print, change calculator | M | Reuses `thermal80` / ReceiptBody |
| 5.6 | **Barcode/SKU**: `BarcodeDetector` camera scan with typed fallback, Code128 labels | M | Pairs with 5.5 |
| 5.7 | **Multi-device via a shared folder**: encrypted store + per-device change log written to a Drive/Dropbox/iCloud folder (File System Access API); merge by UUID + `updated_at`, show conflicts to the user. The cloud client moves the files, so the app makes no network calls | L | Needs 0.6, 4.2 |
| 5.8 | **Optional "vault mode"**: whole store encrypted at rest with a passphrase-wrapped key (clear warning: a lost passphrase means lost data) | L | Needs 4.2 |
| 5.9 | Composition / Bill of Supply, amendments (B2BA/CDNRA), e-commerce Sec 52/9(5) | M each | On demand |

### Not planned (conflicts with the hard rules)
- WebRTC device pairing, payment-gateway links, direct cloud APIs and GSP/IRP portal filing all need network calls or
  a server, so they break Critical Rule 1. Revisit only if that rule is deliberately changed.
- `.xlsx` import (needs a heavy dependency). CSV stays the import format.

---

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
