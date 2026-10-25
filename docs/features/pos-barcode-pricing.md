# POS quick bill, barcodes & labels, price levels & schemes (roadmap 6.7 / 6.8 / 6.9, 5.5 / 5.6)

Counter billing for Indian retailers (the Vyapar / myBillBook / Marg / Swipe workflow), all offline and all
**opt-in**: a user who never adds a barcode, a price level, a slab or a scheme sees only a "POS" entry in the sidebar
and a small "Scan barcode" button above the editor's items.

| Piece | Where | Pure logic | Tests |
|---|---|---|---|
| Barcode encoders (Code 128 B, EAN-13) + SVG | — | `src/lib/barcode.ts` | `tests/barcode.test.ts` |
| A4 label sheets | Settings → Items → *Print labels* | `src/lib/label-sheet.ts` | `tests/barcode.test.ts` |
| Scan matching / qty increment | editor scan box, POS | `src/lib/scan.ts` | `tests/pricing.test.ts` |
| Price levels, qty slabs, schemes | Settings → Items (item form + *Price levels & schemes*), Clients → edit | `src/lib/pricing.ts` | `tests/pricing.test.ts` |
| POS bill, tenders, Z report, day close | `/pos` (`src/pages/Pos.tsx`, lazy) | `src/lib/pos.ts` | `tests/integration/pos.test.ts`, e2e step |

## Data (all additive)

| Where | Field / table | Notes |
|---|---|---|
| `items_catalog` rows | `barcode`, `sku`, `mrp`, `qty_slabs: {min_qty, rate}[]` | catalogue only (never copied to invoice lines); validated in `validateCatalogItem` (EAN-13 check digit, unique barcode / SKU) |
| `stock_items` rows | `barcode` (`sku` already existed) | Inventory → item form |
| `clients` rows | `price_level` (level id) | cleared from every client when the level is deleted; never part of an invoice's client snapshot |
| invoice lines | `price_basis` ("Wholesale", "Qty ≥ 10"), `scheme_id`, `free_of` | normalised in `normalizeItem`; absent on plain lines |
| `InvoiceRecord` | `pos: true` | in `RECORD_KEYS` + `normalizeRecord`; never copied by duplicate / convert / late-fee |
| new table `price_levels` | `PriceLevel {id, name, percent_off?, rates?: {catalogueItemId: rate}}` | backup `RECORD_TABLES` + `ID_TABLES` |
| new table `schemes` | `Scheme {id, item_id, item_name, buy_qty, free_qty, valid_from?, valid_to?, active?}` | backup `RECORD_TABLES` + `ID_TABLES` |
| new table `pos_day_close` | `PosDayClose {id, day, opening_float, expected_cash, counted_cash, difference, bills, net, cash, upi, card, note?, closed_at}` | one row per day (re-closing replaces it); backup `RECORD_TABLES` + `ID_TABLES` |

## 6.7 Barcode scan + labels

- **Scanning.** USB / Bluetooth scanners are keyboards ("keyboard wedge"): they type the code and press Enter into the
  focused field. The editor shows a scan box above the items once any catalogue or stock item has a barcode / SKU
  (otherwise behind the *Scan barcode* button); the POS search box is the scan box and has focus on load (F2 returns
  to it). A code matches the catalogue barcode, then the catalogue SKU, then a stock item's barcode / SKU (mapped to
  the catalogue row of the same name; a stock item that is not in the catalogue is sold at its sale rate). Matching
  ignores case, scanner control characters and leading zeros on numeric codes, so a 12-digit UPC-A finds its
  13-digit EAN form. Scanning an item already on the bill raises that line's quantity; free scheme lines and lines
  with serials picked are never merged into.
- **Camera.** The *Camera* button uses the browser's `BarcodeDetector` (Shape Detection API: Chrome / Edge on
  Android, ChromeOS, macOS) with `getUserMedia({video: {facingMode: 'environment'}})`; frames are read on the device
  every 200 ms, the same code is ignored for 1.5 s, and the stream stops when the dialog closes. Browsers without it
  get a message pointing to a USB scanner or typing. No library, no CSP change (no new script / connect sources; the
  video is a local `MediaStream`). **`Permissions-Policy` changed from `camera=()` to `camera=(self)`** in
  `scripts/security-headers.mjs` (regenerated into `public/_headers`, `netlify.toml`, `vercel.json`); microphone,
  geolocation, payment and USB stay off (`tests/security-headers.test.ts`). The camera needs a secure origin
  (HTTPS or localhost).
- **Encoders** (`barcode.ts`): Code 128 code set B (printable ASCII; start B, data, mod-103 checksum = (104 + Σ
  position × value) mod 103, stop) and EAN-13 (L / G / R tables, first-digit parity, guards; refuses a wrong check
  digit, `ean13CheckDigit`). `pickSymbology` prints a valid 13-digit code as EAN-13 and anything else as Code 128.
  `nextInStoreEan` assigns restricted-circulation codes starting with 2 (item form *New*, label sheet *Assign*).
- **Label sheets** (`label-sheet.ts`): A4 24-up (3 × 8, 70 × 37 mm), 40-up (4 × 10, 52.5 × 29.7 mm) and 65-up
  (5 × 13, 38.1 × 21.2 mm); per item copies, "skip used labels" for a part-used sheet, price = sale / MRP / both /
  none. One script-free HTML document with inline SVG, printed from its own window like receipts and cheques (a
  blocked pop-up downloads the HTML). Print at 100 %.

## 6.8 POS quick bill (`/pos`)

- **Counter screen**: scan / search (↑ ↓ Enter picks a search result; stock on hand shown for tracked items),
  quantity − / +, rate (typing drops the automatic level / slab basis), line discount %, remove. Customer: walk-in by
  default (optional name and phone, printed on the bill), or a saved client (search by name / phone / GSTIN), whose
  price level then applies. Totals come from the existing `calculateInvoice` (no new tax maths).
- **Place of supply**: the business's own state for every counter sale — walk-in or a saved client from another state:
  goods handed over at the counter are supplied where delivery happens (Sec 10(1)(a)/(c) IGST Act), so the bill is
  intra-state. When a saved client is picked, a **"Deliver to the customer's state (dispatch)"** box makes that
  client's state the place of supply (IGST when it differs) for goods sent out. Verify with your CA.
- **Doc type**: `makeDraft` decides, as in the editor — `INVOICE` normally, `BILL_OF_SUPPLY` (BOS series, no tax) for a
  composition profile.
- **Split tender** (`tenderSummary`): cash, UPI (+ optional UTR) and card amounts; *Rest* / F4 / F6 / F7 fills what is
  still due into that tender (`fillRest`). Change is given only from cash and never exceeds the cash taken; UPI + card
  above the bill is refused. A walk-in must pay in full; a saved client may leave a balance on account. UPI / card go
  to the chosen bank account when there are several (`BankAccountSelect`).
- **Save** (`savePosBill`): FEFO batch auto-pick (`applyStockRules`: batch-tracked lines take unexpired batches in
  first-expiry order, split across batches when one does not cover the quantity, never offering what earlier lines of
  the same bill took; with several godowns tracked lines leave from the default godown), then the editor's issue checks
  (`liveDocTrackingIssues`: a serial-tracked item must have its serials picked — the POS shows the serial picker on the
  line — expired batches ask "Sell anyway"), the custom-field snapshot, the FY number of the doc type's series from the
  profile prefix, and `localDb.invoices.save` (period lock, Rule 46 duplicate guard, audit, catalogue / client
  learning — the same call the editor's `saveInvoice` ends in). Then one `localDb.payments.record` per tender, dated the
  bill date (cash net of change). Stock is derived from invoice lines, so the saved bill is the stock-out. A locked
  period refuses the bill before anything is written.
- **Print**: after saving, the bill prints on the 80 mm roll with the existing receipt layout (`TemplateEngine` with
  `paper: 'thermal80'`, i.e. `ReceiptBody`), rendered off-screen and shown only to the printer (`@media print`), then
  the counter resets for the next bill. *Reprint* re-prints the last bill; the auto-print checkbox turns it off.
- **Keyboard** (`POS_SHORTCUTS` / `posShortcut`): F2 scan / search · F3 customer · F4 cash · F6 UPI · F7 card (each fills
  the rest) · F8 new bill · F9 or Ctrl/⌘+Enter save & print · F10 Z report. Shortcuts pause while a dialog is open.
- **Z report** (`zReport`, *Z report* button / F10): for a day, POS bills (`pos: true`, cancelled ones counted
  separately and left out), number range, gross (Σ qty × rate), discounts, taxable value, GST by rate (CGST / SGST /
  IGST), cess, round-off, net sales, tenders (cash / UPI / card / other — payments on those bills dated that day) and
  the amount left on account. **Day close**: opening float + counted cash → expected cash (float + cash taken) and the
  short / over difference, saved in `pos_day_close` (re-closing a day updates it). Printable 80 mm (script-free window)
  and CSV.

## 6.9 Price levels, slabs, schemes

- **Levels** (Settings → Items → *Price levels & schemes*): a name and an optional % off the default rate; per item
  own rates in the item form ("Wholesale (₹)", blank = use the %). Clients → edit → *Price level*.
- **Quantity slabs**: per item `qty ≥ N → rate` rows in the item form.
- **Resolution** (`resolvePrice`): base rate → the level (own item rate beats the level's %) → the highest slab with
  `min_qty ≤ qty`; the line gets the lower of the level price (or base) and the slab price, a tie keeping the level. The
  basis is shown under the line ("Wholesale price", "Qty ≥ 10 price") and saved as `price_basis`. A typed rate always
  wins and is never re-priced. The editor re-prices a line when its catalogue item is picked, scanned or its quantity
  changes; picking a client shows "X buys at Wholesale prices" with *Re-price lines*. In the POS, picking a customer
  re-prices automatic lines. Credit / debit notes are never re-priced.
- **Schemes**: buy X get Y free of the same item, optional date window, pause / resume. The free goods are a **separate
  ₹0 line** (`scheme_id`, `free_of`, description "Free under scheme: Buy 2 get 1 free") directly under the paid line,
  kept in step with its quantity (`syncSchemeLines`). Why a ₹0 line rather than a discount: the printed price stays the
  real unit price, stock goes out for the free units (lines match stock by name), and the taxable value is exactly
  what the customer paid. CBIC Circular 92/11/2019-GST treats "buy one get one free" as one supply of both goods for
  the price charged — not a free supply — so GST is due on that price and no ITC reversal arises; the ₹0 line has no
  taxable value (it is also left out of the HSN summary, which skips zero-value lines). **Verify with your CA**
  (e.g. for related-party or "free sample" cases, where valuation rules differ).

## Local roles (6.21)

`/pos` and its sidebar entry need `doc.create` (owner, clerk); the bill and its payments go through the same
`localDb` checks as the editor. Price levels and schemes need `master.edit` (`priceLevelsDb` / `schemesDb`), a day
close needs `payment.record` (`dayCloseDb.close`). A viewer sees neither the POS nor the Items tab.

## Limitations / not built

- POS returns / exchange now have their own screen (WP-9, `docs/features/business-extras.md`). POS bills appear in the
  normal invoice list and can be edited there like any invoice.
- A walk-in bill upserts one "Walk-in customer" client row (and a client per typed walk-in name), the same as any
  invoice saved by the editor.
- Cash drawer / ESC-POS raw printing and 58 mm text receipts: 7U (`docs/features/business-extras.md`). No weighing-scale barcodes (price-embedded EAN-13 "2…" codes are matched as plain codes).
- Camera scanning needs `BarcodeDetector` (not in Firefox / Safari as of this writing); USB / typed entry works everywhere.
- Price levels and schemes apply in the editor and the POS; importers, recurring runs and conversions keep the rates
  they carry. Buy-A-get-B and bill-value offers: 7U (`docs/features/business-extras.md`). Label layouts are fixed presets.
