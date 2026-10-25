# Printing & documents output (WP-4)

Covers gap-analysis items **P0-9** (multiple copies), **P1-15** (voucher printing, batch PDF / ZIP), **P1-24**
(transport details on the invoice), the print parts of **P1-6** (confirmation-of-accounts letter, bulk statements)
and the **P2** pre-printed stationery mode. Everything runs offline; the PDF stack stays `html-to-image` + `jspdf`
(Critical Rule 6), loaded on demand. Initial JS is unchanged (173.5 kB gz against the 185 kB budget).

| Piece | Where | Tests |
|---|---|---|
| Copies model, Rule 48 / 49 / 55 labels, goods vs services | `src/lib/print-copies.ts` | `tests/printing.test.ts` |
| Copy banner (accent variable only), mounted above every layout | `src/components/templates/parts/CopyBanner.tsx`, `TemplateEngine.tsx` (`copyLabel` prop) | string-level + e2e |
| Print options popover (copies, pre-printed, save as profile default) | `src/components/preview/PrintOptions.tsx`, `InvoicePreview.tsx` | e2e "3 copies → 3× pages" |
| Per-profile default | `design_prefs.copies` (additive: `'single'` / `'auto'` / list), `design_prefs.preprinted` | `tests/printing.test.ts` |
| PDF assembly, file names, ZIP of PDFs | `src/lib/pdf-batch.ts` (`PdfBuilder`, `zipFiles` → `zip.ts` STORE mode) | ZIP round-trip through `openZip` |
| Batch PDF / ZIP from the documents list | `src/components/preview/BatchPdfModal.tsx`, button "PDF / ZIP" in the Transactions bulk bar | — |
| Transport details | `InvoiceRecord.transport` (`src/types/invoice.ts`, `RECORD_KEYS`, `normalizeRecord`), `src/lib/transport.ts`, editor `src/components/creator/TransportFields.tsx` (in `DocumentMetaCard`) | persisted-field test, rows test, e2e |
| Transport print | GST layout: dispatch cells in the document grid; other layouts: `parts/TransportBlock.tsx`; receipt: compact block | string-level + e2e |
| Voucher print | `src/lib/voucher-print.ts`; Printer button per row in Books → Vouchers | escaping test |
| Confirmation of accounts | `src/lib/confirmation-letter.ts`, `src/components/receivables/letters.ts`; Receivables → Statements "Confirmation letter" | totals test |
| Bulk statements / letters | `src/components/receivables/BulkStatements.tsx`; Receivables header "Bulk statements" | — |
| UI strings (English + Hindi) | `src/i18n/areas/printing.ts` (`printT`) | `tests/i18n-areas.test.ts` |

## Copies (P0-9)

- **Default is unchanged**: with no `copies` preference a document prints one paper without a banner.
- **Rule 48 set** (`'auto'`): goods → *Original for Recipient / Duplicate for Transporter / Triplicate for Supplier*;
  services → *Original for Recipient / Duplicate for Supplier*. Goods = any line typed Goods/Product or with an HSN that
  is not a 99xx SAC. Delivery challans (Rule 55) → *Original for Consignee / Duplicate for Transporter / Triplicate for
  Consigner*. Quotations / proformas / sales orders print plain *Original / Duplicate / Triplicate*. *Extra Copy* can be
  added up to 6 copies in all. The wording is statutory and stays English on paper.
- The preview renders one paper per copy; **Print** puts each copy on a new sheet (`break-before: page`), **PDF** captures
  each copy and appends its pages, so N copies give N× the pages. The client-copy HTML uses the first copy only.
- "Save as this profile's default" writes `copies` / `preprinted` into the profile's `design_prefs` row. Design presets
  keep these print-job settings.

## Transport details (P1-24)

`transport?: { mode, vehicle_no, transporter_name, transporter_id, lr_no, lr_date, eway_bill_no, distance_km }`,
normalised on load (vehicle numbers upper-case without spaces, dates must be `YYYY-MM-DD`, a bare mode is dropped);
absent on legacy rows. The editor offers "Fill from saved e-Way data" when the e-Invoice module saved vehicle /
transporter / EWB details for this document (`einvoice_meta`); typed fields win. The paper prints only the document's
own snapshot. When the IRN block already prints the same e-Way number it is not repeated. Duplicates, credit notes,
debit notes and late-fee invoices do not inherit transport details; a conversion (challan → invoice) keeps them.

## Voucher print (P1-15)

Tally voucher-print style: company header, "<Type> Voucher", No. / Dated, Particulars with *By* (Dr) then *To* (Cr),
totals, narration, amount in words, *Prepared by / Checked by / Authorised signatory*. Script-free HTML with every value
escaped, opened in a print window (a blocked pop-up downloads the HTML). Works for manual and automatic vouchers.

## Batch PDF / ZIP

Select documents in the list → **PDF / ZIP** → one combined PDF or a ZIP of one PDF per document (unique names), with a
progress bar and cancel. Each document is normalised, recalculated and rendered off-screen with its own sender snapshot
and its profile's design (optionally its default copies), captured, then dropped.

## Confirmation of accounts & bulk statements (P1-6 print part)

Letter per party for a period: opening balance, debits, credits, closing balance (Dr / Cr, in words), bills open on the
closing date (receipts after it not counted), and a reconciling line for advances / credit notes / on-account receipts
not set against a bill, so *open bills − unadjusted = closing*. Request to confirm within 15 days, two signature
blocks, "verify with your CA" line. Bulk: pick parties (optionally only those with a balance) → statements as one PDF
or a ZIP, or all letters in one print job.

## Pre-printed stationery (P2)

Hides the letterhead (free-form layouts get a slim title + number line; the GST layout blanks the seller cell),
backgrounds, watermark and letterhead footer, and offsets the content by a top space (0–120 mm) and left offset
(−20–40 mm).

## Gaps / follow-ups

- The e-Invoice modal does not yet read `invoice.transport` when building the e-Way JSON (owned by the e-Invoice module).
- The Design Studio panel has no copies / pre-printed controls yet; they are set from the preview.
- Bills on the confirmation letter ignore advance adjustments dated before the closing date (their amount is not on
  the ledger entry); the reconciling line keeps the closing balance correct.
- Dot-matrix text mode is not built.

## 8G additions
- `AcceptanceBlock` prints a document's own payment schedule and a quotation's acceptance snapshot (signer, time, amount, signature) — accent variable only, legacy documents print nothing.
