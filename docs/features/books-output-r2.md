# Round 2 · R2-C — Books, compliance & output

Spec: `docs/prd/round-2.md` §4 R2-C1 – C6. Everything is local, lazy-loaded, and every statutory output
says "verify with your CA".

## C1 Annual accounts pack with notes to accounts
- **Where:** Books → Reports → **Annual pack** (`src/components/books/ledger/AnnualPackTab.tsx`, lazy from
  `ReportsHub.tsx`). Uses the report environment, so the branch filter and the closing-stock valuer
  (`loadStockValuer()`) are the same as every Books statement.
- **Model:** `src/lib/ledger/annual-pack.ts` — `buildAnnualPack` (BS / P&L with the previous FY, cash flow,
  TB, notes), `annualPackHtml` (script-free print document), `annualPackBody` (the same pages as an `.ap-root`
  fragment for the preview and the PDF capture), `annualPackSheets` (XLSX), `notesDb`.
- **Notes:** `src/lib/ledger/notes-auto.ts` — automatic notes (capital movement, reserves, borrowings, trade
  payables with MSME split from the vendor's Udyam category and FIFO ageing, GST / TDS balances, fixed-asset
  roll-forward tied to the register's WDV, inventories, receivables ageing, revenue goods / services) and text
  notes with starter wording (policies, contingent liabilities, related parties, events after the BS date).
  `NotesEditor.tsx` edits text notes and an extra paragraph under each automatic note.
- **Entity wording:** proprietorship / partnership / LLP / company (capital title, "Shareholders' funds").
- **Output:** Print / HTML, PDF (`PdfBuilder`, one `.ap-page` at a time), Excel schedules, ZIP (HTML + XLSX +
  CSVs; reuses 8G's `pnlCsv` and the shared `zipBlob`).
- **Storage:** `mrchartist_inv_notes_to_accounts` rows `{ id: 'FY25-26', notes: { [noteId]: { text?, extra? } }, entity_type, updated_at }`.

## C2 Deferred revenue and prepaid expense schedules
- **Where:** Books → **Deferrals** tab (`src/components/books/planning/DeferralsTab.tsx`, lazy).
- **Logic:** `src/lib/deferrals.ts`. Methods `months` (equal per calendar month) / `days` (days in each month,
  leap years counted). Journals are ordinary manual JOURNAL vouchers (class `Deferral`): defer on the document
  date, release on each month end, written by `postDue` (on opening the tab — idempotent, keyed per entry in
  `posted`; locked periods skipped and reported) or "Post journals up to". `stopDeferral` releases the
  unreleased balance on the stop day (offered when the source invoice / bill is cancelled).
- **Accounts:** "Income received in advance" (Other current liabilities) and "Prepaid expenses" (Short-term loans
  & advances) are created as user accounts on first use; the default chart is untouched.
- **Register:** opening / deferred / released / closing per period; ties to the holding ledgers.
- GST, GSTR-1 and receivables are untouched (time of supply = document date).
- **Storage:** `mrchartist_inv_deferrals` (dated). Reads purchases through `readPurchase` / `readPurchaseLines`
  (added to `tests/purchase-contract.test.ts`).

## C3 IMS ITC reduction and IMS working file
- **Where:** GST reports → 2B match: an "ITC / remark" column with a details editor (`ImsDetails.tsx`), and an
  IMS summary under the 3B Table 4A(5) working (counts, ITC reduction by head, ITC not claimed) with the
  working-file downloads.
- **Logic:** `src/lib/gstr2b.ts` (additive `itc_reduction`, `declared_itc`, `remark` on `gstr2b_actions`;
  `gstr2bActionsDb.set` now keeps them; `setDetails`, `effectiveReduction`, `imsSummary`, `imsIssues`,
  `remarkRequired`), `src/lib/ims-file.ts` (JSON + XLSX, "Layout unverified — working paper").
- Remark rule by return period: `IMS_REMARK_RULES` in `src/lib/tax-rules.ts` (Pending / Rejected credit notes
  from the Oct 2025 period, as understood); the view can switch the check off. The GSTR-3B builder is unchanged.

## C4 Packing list
- **Where:** Document actions → **Packing list** on invoices / bills of supply / delivery challans
  (`src/components/dispatch/PackingListButton.tsx` → lazy `PackingListDialog.tsx`); package types in
  Settings → Items → **Package types** (`PackageTypesPanel.tsx`); per-unit net / gross weight and unit on the
  catalogue item editor.
- **Logic:** `src/lib/packing.ts` (weights from stock items then catalogue, `lineFactor` for alternate units,
  gross = net + packaging + tare, CBM, every line packed exactly once, `PKL/FY…` via `series-counters`),
  `src/lib/packing-print.ts` (A4 script-free print with the Design Studio accent). The packing list keeps its
  own line snapshot; the invoice is never changed.
- **Storage:** `mrchartist_inv_packing_lists` (numbered, dated), `mrchartist_inv_package_types`; additive
  `net_weight` / `gross_weight` / `weight_unit` on `items_catalog` / `stock_items` (declaration merging in
  `src/types/books-r2.ts`).

## C5 Design Studio labels and logo accent
- `src/lib/design-prefs.ts`: additive `labels`, `labels_by_type`, `title_suffix`; merged key by key
  (global ← profile), `labelOverride` resolves type → profile → global → default, `designForDoc` flattens the
  type's labels for the template engine (used by the preview, batch PDF, POS print and the Design Studio
  preview), `docTitleText` appends the suffix — the statutory title always prints.
- `labels.ts` `makeLabels(bilingual, overrides)`; an overridden label prints without its Hindi line.
  `paper-context.ts` passes the overrides and a `title()` helper used by `PaperHeader`, `ReceiptBody`, `GstBody`.
  (The GST layout prints its own fixed column captions; only its title takes the suffix.)
- `src/lib/logo-colour.ts`: dominant non-neutral colours from RGBA pixels, darkened to ≥ 3:1 on white,
  3 swatches; the Design Studio samples the profile logo on a canvas (no network).

## C6 Accessibility & display preferences
- Settings → Security → **Display & accessibility** (`src/components/settings/DisplayPanel.tsx`): text size
  90–130 %, high contrast, motion (follow device / reduce / full), underline links, larger tap targets, focus
  ring always visible.
- Device-local `mrchartist_display_prefs` (outside the `mrchartist_inv_` prefix: never backed up or synced).
- Applied before first paint by `public/theme-init.js` (external file, CSP `script-src 'self'` unchanged) as
  `a11y-*` classes on `<html>`; `src/index.css` honours them and resets the root size for print. The invoice
  paper uses px, so PDFs are unaffected.

## Registries (append-only `R2-C` blocks)
`backup.ts` RECORD_TABLES / ID_TABLES, `audit-edits.ts` WATCHED_TABLES, `access.ts` TABLE_ACTIONS,
`sync-engine.ts` DATED (`deferrals`, `packing_lists`) / NUMBERED (`packing_lists`), `CommandPalette.tsx`
(`r2c-destinations.ts`).

## For the lead (shared docs not edited here)
- ARCHITECTURE tables: `notes_to_accounts`, `deferrals`, `packing_lists`, `package_types`; additive fields
  above; device-local `mrchartist_display_prefs` (AGENTS storage keys list).
- Strings: `src/i18n/areas/books-r2.ts`, `gst-r2.ts`, `dispatch-r2.ts`, `design-r2.ts`, `display-r2.ts`.
- Tests: `annual-pack`, `deferrals`, `ims`, `packing`, `design-labels`, `logo-colour`, `display-prefs`;
  e2e step "R2-C: text size 130% … annual pack renders its pages".
