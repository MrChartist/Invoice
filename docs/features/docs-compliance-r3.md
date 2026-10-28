# Round 3 — R3-C Document polish & compliance desks

Live paper preview and live template tiles, job evidence on documents (item photos, photo pages, receiver
signature), page margins and letterhead artwork, the GST portal file reader, the e-Way desk and the practice
desk. Spec: `docs/prd/round-3.md` §4 R3-C1–C6, §5 R3-C, §6.

## Modules

| Item | Logic (pure, unit-tested) | UI (all lazy) |
|---|---|---|
| C1 live preview / tiles | `src/lib/editor-layout.ts` (device key, draft hash, low-end check) | `creator/LivePreviewPane.tsx` (≥ 1280 px, toggle "Show live preview" above the editor), `creator/live-preview-gate.ts`, `creator/TemplateThumb.tsx` + `TemplatePicker.tsx` |
| C2 job evidence | `src/lib/line-images.ts` (`snapshotLineImages`), `src/lib/doc-evidence.ts` (`printablePhotos`, `setPrintFlag`, `proofIssues`, `buildDeliveryProof`, `setDeliveryProof`) | `ui/SignaturePad.tsx` (extracted from `AcceptQuoteDialog`), `creator/DeliveryProofDialog.tsx` (Document actions → Get signature), `attachments/PrintFlag.tsx`, paper parts `PhotoPages.tsx`, `DeliveryProofBlock.tsx`, item thumbnail in `PaperItemsTable.tsx`, Design Studio toggle "Item photos on lines" |
| C3 page / letterhead | `design-prefs.ts`: `margins_mm`, `letterhead`, `footer_image`, `sanitizeArt` / `sanitizeMargins` / `activeArt` / `marginVars` / `storeArtwork`, `pageSlices(height, design, bands)`; `pdf-batch.ts` repeats the bands per PDF page | `design/PagePanel.tsx` (Design Studio → Page margins & letterhead), paper parts `PageArt.tsx`, `header-band.ts`, `PaperHeader.tsx` |
| C4 portal files | `src/lib/gst-portal-files.ts` (detect / parse / match / subset / diff / saved imports) | `gst-reports/PortalFilesView.tsx` (GST → Tools → Portal files, `?tab=portal-files`), filing-strip step "Portal files (n)" |
| C5 e-Way desk | `src/lib/eway-validity.ts` (date-keyed rules), `src/lib/eway-desk.ts` (rows, filters, bulk payloads, history), `src/lib/eway-alerts.ts` (bell) | `gst-reports/EwayDesk.tsx` (`?tab=eway-desk`), computed validity in `EInvoiceModal` → Portal details |
| C6 practice desk | `src/lib/practice.ts`, `src/lib/dsc-register.ts`, `src/lib/client-checklist.ts`, `src/lib/dsc-alerts.ts`, `peekCompliance` in `company-peek.ts` | `pages/Practice.tsx` (`/practice`, owner only), `practice/DscRegister.tsx`, `practice/ChecklistPanel.tsx`, link in Settings → Companies |

Strings: `src/i18n/areas/docs-r3.ts` (C1–C3, editor side) and `src/i18n/areas/desks-r3.ts` (C4–C6), English + Hindi.

## Storage (all additive)

| Key / table | Kind | Backed up | Synced | Registered |
|---|---|---|---|---|
| `mrchartist_inv_gst_portal_files` | rows `{ id, kind, period, gstin, file_hash, file_name, imported_at, counts, findings (≤ 2,000), resolved }` | yes | yes | `RECORD_TABLES` / `ID_TABLES`, `WATCHED_TABLES` (gst), `TABLE_ACTIONS` = `books.edit` |
| `mrchartist_inv_dsc_register` | rows `{ id, holder, role, dsc_class?, token?, issuer?, valid_from?, valid_to, notes? }` | yes | yes | same, `books.edit` |
| `mrchartist_inv_client_checklist` | rows `{ id: 'YYYY-MM', items: { id, label, done_at?, by?, carried? }[] }` | yes | yes | same, `books.edit` |
| `mrchartist_inv_checklist_template` | object (string list) | yes | yes (singleton) | — |
| `mrchartist_editor_layout` | device-local `{ preview }` (outside the prefix) | no | no | — |
| `mrchartist_checklist_default` | device-local default checklist (outside the prefix) | no | no | — |

Record / design / meta fields:
- `InvoiceRecord.delivery_proof` (`src/types/docs-r3.ts`, declaration merging; `RECORD_KEYS` line `// R3-C`; kept by
  `normalizeRecord`; preserved from the stored row by `localDb.invoices.save`, stripped from new documents).
- `InvoiceItem.image` on lines (`asset:<id>`, snapshotted at save in the editor; kept by `normalizeItem`).
- `AttachmentRef.print = { caption?, group? }` (kept by `readRefs`, images only).
- `design_prefs`: `show_item_images`, `margins_mm`, `letterhead { image, mode: header | background, every_page }`, `footer_image`.
  Artwork is stored once in `assets` (`storeArtwork`, PNG / JPEG ≤ 400 kB).
- `einvoice_meta`: `eway_generated_at`, `eway_cargo`, `eway_distance_km`, `vehicle_history[]`, `transporter_history[]`.
- `doc-snapshots`-style rules for the signature: PNG / JPEG data URL ≤ 350 kB, interned to `assets` before the invoice write.

No new numbered series. `sync-engine.ts` `DATED` / `NUMBERED`: none (as the PRD says).

## Behaviour notes

- **Live preview (C1).** Off by default; the toggle (≥ 1280 px only) is remembered per device. The pane reads the store
  through one `useShallow` selector, defers with `useDeferredValue` + a 250 ms idle debounce and memoises the paper on
  the debounced snapshot, so a keystroke re-renders only the tiny selector component. Clicking the party block, the
  items table, the totals or the notes box scrolls to and focuses that editor card (`data-r3c-section`). Phones never
  request the chunk (the gate checks `matchMedia` first; e2e checks the network log at 390 px). Template tiles render the
  draft (or the sample invoice when empty) at 0.18 scale once scrolled into view, memoised by template id + draft hash
  (snapshotted 800 ms after typing stops); `hardwareConcurrency ≤ 4` or reduced motion keeps the static tiles.
- **Item photos (C2).** The editor copies the catalogue photo reference onto lines without one at save (name, and HSN
  when both have one). Printed only with the design toggle, never on the GST grid or thermal paper.
- **Photo pages.** Image attachments ticked "Print on document" (caption, Before / After / Other) print after the
  totals, four per page, at most 12. Photos are already downscaled once at attach time (`compressPhoto`, 1600 px).
- **Receiver signature.** Document actions → Get signature on an issued invoice / bill of supply / delivery challan.
  Written once (audited); only the owner can replace it, with a reason kept in `replaced[]`. Printed as "Received by".
  The client copy and the PDF capture the rendered paper, so they include photos and the signature; the e-Invoice /
  e-Way JSON builders never read these fields (tested).
- **Page / letterhead (C3).** Margins set the paper's padding variables (`--tpl-pt / --tpl-px / --tpl-pr / --tpl-pb`).
  Header band replaces the template's logo / name block (title + number stay); full-page background sits under the
  content on page 1; the footer band sits at the foot of the paper and, in the PDF, is drawn on every page (the
  `pageSlices` window is shortened by the bands; the header band repeats on pages 2+ only with "every page").
  Pre-printed stationery switches artwork off (and the panel offers to turn pre-printed off). Design prefs are not
  snapshots: saved documents re-render with the current letterhead (existing design behaviour).
- **Portal files (C4).** `.json` or `.zip` (every `.json` inside). Kinds: error report (any `error_cd` / `error_msg`
  on a document, a party group or a summary section), downloaded GSTR-1 (section keys, no errors), else "not
  recognised" — nothing saved. Files for another return period / GSTIN than the one selected are refused with a hint.
  Errors are matched by recipient GSTIN + normalised number (`normBillNo`), then date. "Download corrected JSON" runs
  `buildGstr1Json` on `subsetReport` (document sections only) after `subsetChecks` (GSTIN, date in period, number).
  The diff flags missing on portal / missing in books / taxable or tax difference ≥ ₹1 and links to the GSTR-1A
  paper (GST guards tab). Tables are windowed with `useVirtualRows`. Same file bytes (SHA-256) → "already read".
- **e-Way desk (C5).** Rows from `einvoice_meta` with an `eway_no` (not cancelled on the portal, live document);
  expired bills stay 7 days. Filters: expiring in 24 h, expired, no Part-B. Bell: "n e-Way Bills expire in the next 12
  hours" / "n expired today", ids carry the bill numbers. Bulk update writes JSON + CSV and records the new vehicle /
  transporter with history on `einvoice_meta` (one all-or-nothing write, audited).
- **Practice desk (C6).** Other companies are read with a version-less IndexedDB open that aborts any upgrade (so a
  missing database is never created) in one read-only transaction; a `__vault__` record, `mcv1:` values or a read
  error → "Locked — open to see". The open company is read from live storage. "Open" switches company (flush +
  reload); "Mark filed" (open company) goes to GST → Compliance. Export CSV / XLSX (dynamic `xlsx.ts`).

## Bundle

Measured with the same gzip as `check-bundle-size.mjs` against a build of the merge base (`claude/elegant-cannon-cwapiv`
@ b27b7f9, with R2-A, QA-1 and R3-A) and of this branch:

| | base | R3-C | delta |
|---|---|---|---|
| initial JS (gz) | 183,895 B (179.6 kB) | 184,180 B (179.9 kB) | **+285 B (+0.28 kB)** (budget +0.4 kB) |
| total JS (gz) | 2,029.7 kB | 2,073.9 kB | +44.2 kB, all lazy (budget 2,400 kB) |

First-paint additions: the `/practice` lazy route (+ its chunk names in Vite's preload map), the nav entry and
`nav.practice` strings, three `WATCHED_TABLES` / `TABLE_ACTIONS` lines, two lines in `localDb.invoices.save` and one in
`readRefs`. No new lucide icons (`Building2`, `Pencil` and the rest were already imported; every lucide icon lands in
the first-paint `vendor-ui` chunk). To keep Vite's preload lists in the entry chunk short, editor-side modules are not
shared with lazy chunks: `line-images.ts` (not `doc-evidence.ts`) in the editor, the pane / tiles keep their own
constants and CSS, the paper's eager CSS (`docs-r3-paper.module.css`) is split from the lazy parts'
(`docs-r3-pages.module.css`), the toggle labels have their own two-key area, and Design Studio loads `PagePanel` lazily.
`RECORD_KEYS` and the bell gate live in lazy chunks (store, NotificationBell). Pane, tiles, dialogs, the signature pad
(one chunk shared by both dialogs), paper parts (`PhotoPages`, `DeliveryProofBlock` load only for documents that have
the data), desks and the practice page are all lazy.

## Wiring done here (lead: please keep)

- `src/App.tsx`: `const Practice = lazy(() => import('./pages/Practice')…)` and
  `<Route path="/practice" element={<RequireAccess action="settings.manage"><Practice /></RequireAccess>} />`.
- `src/layouts/DashboardLayout.tsx`: Setup group → `{ label: 'nav.practice', path: '/practice', icon: Briefcase, need: 'settings.manage' }`;
  `nav.practice` in `en.ts` / `hi.ts`. `shop-mode.ts` `PATH_MODULE` not touched (an unmapped path always shows).

## Rows for the lead (ROADMAP / ARCHITECTURE / AGENTS.md — not edited here)

- ARCHITECTURE tables: `gst_portal_files` (R3-C4, `src/lib/gst-portal-files.ts`), `dsc_register` (R3-C6,
  `src/lib/dsc-register.ts`), `client_checklist` + object `checklist_template` (R3-C6, `src/lib/client-checklist.ts`).
- AGENTS.md device-local keys: `mrchartist_editor_layout` (live preview toggle), `mrchartist_checklist_default`.
- AGENTS.md tech debt: e-Way validity rules are date-keyed in `src/lib/eway-validity.ts` (kept out of first-paint
  `tax-rules.ts`, like `gst-penalties.ts`); `/practice` peeks other company databases read-only via `peekCompliance`.
- ROADMAP Round 3: R3-C1 … R3-C6 done (this doc).

## Deviations from the PRD

- Feature doc is `docs/features/docs-compliance-r3.md` (the task's name; the PRD said `desks-r3.md`).
- Two string areas (`docs-r3.ts` for the editor side, `desks-r3.ts` for the desks) so editor chunks do not carry desk
  strings; the two live-preview toggle labels sit in a two-key area inside `creator/live-preview-gate.ts`.
- Item-photo snapshot helpers are in `src/lib/line-images.ts` (not `doc-evidence.ts`) for bundle reasons; the item-photo
  toggle sits in the lazily loaded Page panel of Design Studio (PRD: `DesignPanel`).
- Empty-draft tiles use a small built-in sample document (not Design Studio's `sample.ts`, to keep that module unshared).
- Live preview pane is **off by default** (one click turns it on per device): at 1280 px three columns are tight, and
  a second paper in the DOM would otherwise be on for everyone. The typing-latency budget (PRD: +16 ms p95 on a
  40-line invoice, `docs/qa/performance.md` method) was not measured here — the design keeps the paper off the
  keystroke path (debounced memoised render), but the number should be taken by QA.
- C3 needed a few lines in `TemplateEngine.tsx` beyond the two lazy C2 blocks: `marginVars(design)` on the paper style,
  `<PageArt />` under the content, and `.inner` padding reads `--tpl-pr` (falls back to the side padding). All are
  no-ops without the new design fields.
- Background artwork is drawn on page 1 only; "every page" applies to the header band (and the footer band is always
  per page in the PDF). `window.print()` prints the footer once at the foot of the paper.
- Template snapshot test: TSX cannot run under `node --test` here, so "renders byte-identical" is covered by source
  checks (the blocks are gated on the data and lazy) plus pure checks that a legacy record has none of the fields and
  `marginVars` / `activeArt` return nothing without them.
- PRD lists `period_lock` for the peek: the lock date lives in `settings.lock_until`, which is what is read.
- The GSTR-1A link points to GST → GST guards (where the 8.61 GSTR-1A paper lives).
- `subsetChecks` is a focused preflight (GSTIN, period, number) rather than the full page preflight.
- `/practice` is "owner only" via `settings.manage` (the owner-only action; clerks and viewers lack it).

## Verify with your CA (statutory points — every screen carries the wording)

Consolidated in `docs/CA_REVIEW.md` (ids G27, G46, AC18); answers are logged there with the date and the PR.

- **e-Way validity day boundary (Rule 138(10), Explanation).** Assumed: validity is counted from generation and each
  day expires at midnight of the day after generation, so N days end at 23:59:59 local time on generation date + N.
  Distances assumed: from 1 Jan 2021 one day per 200 km or part (20 km for over-dimensional cargo and multimodal
  shipments with a ship leg); before that 100 km (20 km ODC). A typed / imported valid-upto always wins.
- **Extension window.** Assumed 8 hours before / after expiry (`EWAY_EXTENSION_RULES`), on the portal only; no
  extension JSON is produced (no bulk layout confirmed). Who may extend, and the remaining-distance rule, to confirm.
- **e-Way bulk JSON layouts.** Part-B (vehicle) update: `{ version, vehicleUpdtList: [{ ewbNo, vehicleNo, fromPlace,
  fromState, reasonCode (1 break-down / 2 trans-shipment / 3 others), reasonRem, transDocNo, transDocDate (dd/mm/yyyy),
  transMode (1 road …), vehicleType }] }`; transporter update: `{ version, transporterUpdtList: [{ ewbNo, transporterId }] }`.
  Field names follow the e-Way Bill API as understood; the portal's bulk-tool file layout is not verified.
- **GSTR-1 error report format.** Assumed: the upload's section keys (`b2b`, `b2cl`, `cdnr`, `cdnur`, `exp`, plus
  summary sections) with `error_cd` / `error_msg` on a document or its party group, possibly inside a ZIP and a
  `data` / `error_report` wrapper. Error codes are not interpreted; hints come from the message text (date / period,
  GSTIN, duplicate, place of supply, rate). Whether a corrected subset should be uploaded as "add" or "replace" for
  documents already saved on the portal is open (PRD Q7).
- **Downloaded GSTR-1 JSON.** Assumed to use the same section keys as our upload (`inum` / `idt` / `nt_num` / `nt_dt`,
  `itms[].itm_det`). Value / tax differences under ₹1 are ignored.
- **Practice board due dates** are as per the standard calendar; notified extensions are not tracked.
- **Receiver signature** is a record of delivery on the seller's device, not a legal opinion (PRD Q9).

## Verification

`npx tsc -b` ✓ · `npm run lint` 0 errors (22 warnings, none new beyond the existing set-state-in-effect pattern) ·
`npm test` 2075 / 2075 ✓ · `npm run build` ✓ · `npm run check:size` initial 179.9 / 185 kB, total 2073.9 / 2400 kB ✓ ·
`npm run verify:offline` ✓ · `npm run test:e2e` (E2E_TIMEOUT=60000) all checks passed. New unit tests: `tests/editor-layout.test.ts`,
`tests/doc-evidence.test.ts`, `tests/design-page.test.ts`, `tests/gst-portal-files.test.ts`,
`tests/eway-validity.test.ts`, `tests/practice.test.ts` (+ a case in `tests/purchase-contract.test.ts`, the updated tab
list in `tests/gst-filing.test.ts`). Fixture: `tests/fixtures/gstr1-error-report.json` (synthetic, used by the unit
test and the e2e step).
