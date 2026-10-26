# Restaurant & counter (Round 3, package R3-A)

Tables and running orders, kitchen order tickets (KOT), split bills, modifiers / "86", and sharing a bill as an
image. Everything is local: no network, no aggregator API, no kitchen display. Settled orders become normal POS
invoices through `savePosBill`, so numbering, stock, tenders, the Z report and shifts work as they already do.

GST, service charge and split-bill treatment here are working papers. **Verify with your CA** (and a legal adviser
for service charge). The open points are listed at the end.

## Screens

- **`/tables`** (`src/pages/Tables.tsx`, lazy; module `pos`; needs `doc.create`). It shows one tab per dining area
  with a grid of tables (Free / Occupied with covers, running amount and minutes open / Bill printed / Settling),
  plus Takeaway, Delivery and Aggregator tabs that hold daily tokens.
  - The **order panel** (`OrderPanel.tsx`) handles:
    - search, scan and the `3*naan` quantity grammar (`pos-keys.ts`), plus the POS tiles (`PosTiles`, with the
      new greyed "not available" state);
    - line quantity, seat, note and remove;
    - Send KOT, Print bill / Reopen, Settle (Cash / UPI / Card), Split, Move, Merge, Transfer and Void;
    - the KOT list with Reprint (marked DUPLICATE).
  - The **open-order dialog** takes covers and the captain (a local user from `listUsers()`). It also takes a
    customer name and phone, or, for an aggregator, the operator name, operator GSTIN (`checkEcoGstin`) and
    operator order number.
  - The **"Not available today" panel** marks one item, or a whole stock group (with sub-groups), off for today.
- **Tables settings** (`TablesSettings.tsx`, a lazy modal) has five tabs:
  - Areas & tables: area name, price level, service charge %, and the tables;
  - Stations: stock group → station;
  - Modifiers: `ModifiersPanel.tsx`;
  - KOT printers: per station, device-local;
  - Rules: default service charge, clerk cancel cap, auto-86, plus GST and day-close notes.
- **KOT register** (`KotRegister.tsx`, a lazy modal) lists KOTs by day, captain and station. It also has a leakage
  table (cancellations, moves, transfers, merges, voids, reopens) with CSV / XLSX export. Its source is
  `table_orders` only.
- **POS** (`src/pages/Pos.tsx`) gets:
  - a **Tables** link (URL only, no restaurant import);
  - the modifier picker, lazy, when an item with modifier groups is picked;
  - greyed tiles and search hits for 86'd items, with a confirm before adding one;
  - **Share as image** for the bill just saved (lazy `BillImageShare`).
- **Preview → Share** (`ShareMenu.tsx`, `InvoicePreview.tsx`) gets **Share as image** (and **Copy image** where
  `ClipboardItem` exists).

## Logic (pure, tested)

| File | What |
|---|---|
| `src/lib/restaurant/tables.ts` | starter masters (Dine-in, tables 1–10), floor status, daily tokens, `addItem` (area price level via `resolvePrice`), `repriceLines`, move / merge / transfer (the sent quantity moves with a transferred line via `sent_offset`), `buildSettleRecord` / `finishOrderRecord` (service charge, Sec 9(5), `table_order_id`) |
| `src/lib/restaurant/kot.ts` | `sentQty`, pending lines, station grouping (unmapped → Kitchen), daily `K<n>`, `changeQty` (cancellation ticket + log), PIN cap `needsOwnerPin`, ticket text at 32 / 48 columns (no prices), `kotRegister` + `registerSheet` |
| `src/lib/restaurant/split-bill.ts` | equal / custom payer rows, `seatPicks`, `partLines` (whole-quantity pieces, or share lines with the same HSN / rate), `shareStep` / `allocate` (share amounts whose GST, CGST / SGST halves and cess are exact paise), `reconcile` |
| `src/lib/restaurant/modifiers.ts` | `groupsFor`, `validatePicks`, `validateGroup`, `modifierLines` (child lines with the parent's HSN / GST, or the mapped item's own), 86 (`isUnavailable`, `set86`, `idsInGroup`), `autoUnavailable` (`lineFactor`) |
| `src/lib/restaurant/orders-store.ts` | storage + guards: masters (`master.edit`), orders (`doc.create`); `settleOrder`, `startPayers` / `payPayer`, `previewParts` / `settleParts`, all inside `withTablesRollback`; owner-PIN error (`OwnerPinRequired`) |
| `src/lib/restaurant/kot-print.ts` | device printers per station (`mrchartist_kot_printers`), HTML ticket page, ESC/POS via `ticketBytes` (serial / Bluetooth). Loaded on the first print |
| `src/lib/share-image.ts` | slices (A4 up to 5 pages, a roll is one image), JPEG / PNG choice, file names (`INV-FY26-27-0012.jpg`), render via `html-to-image` (dynamic), share / download / ZIP, copy |

Tests: `tests/restaurant-tables.test.ts`, `restaurant-kot.test.ts`, `restaurant-split.test.ts`,
`restaurant-modifiers.test.ts`, `share-image.test.ts`; E2E step "R3-A: open table 1 → … → two bills settled".

### Behaviour notes

- **An order is not an invoice.** It has no number, no GST and is never in reports. It is saved on every change.
  Print bill freezes it (unsent lines are auto-sent to the kitchen first); Reopen is logged.
- **Settle** builds the bill through the POS builder (walk-in place of supply = the shop's state). The service charge
  is booked as `other_charges` with `charges_taxable: true`, so it is taxed like the food it follows (the charges
  rule). It is named in the bill notes as "Service charge (optional) @ n%". It is off unless the area sets a %, and the
  cashier can remove it for a bill.
- **Aggregator** orders get `eco_gstin` + `eco_section: 'PAY_9_5'`, with line tax set to 0. The existing GSTR-1 build
  puts the value in Table 14(b) and GSTR-3B 3.1.1(ii).
- **KOT changes.** Lowering a line below what the kitchen has needs a reason (wrong order / customer cancelled /
  out of stock / other). It prints a cancellation ticket and logs `{line, qty, value, reason, by, at}`. A clerk past
  the cap (default 2 lines or ₹ 500 per order) needs the owner PIN (`checkPinWithGuard`, owner lockout rules).
- **Split.**
  - Equal / custom: one invoice. The first payer's payment saves it (`allowCredit`, so the rest stays due) and later
    payers are payments on it. The order settles when every row is paid.
  - Item / seat: one invoice per part, saved together, so the POS numbers are consecutive. Each part carries
    `split_of {order_id, part, parts}` and `table_order_id`. Each part is paid in full by its chosen tender.
  - Reconciliation strip: total GST + cess is exact. Per-line CGST / SGST halves of whole-quantity pieces may swap a
    paisa between the two heads; the strip shows it and tax is never adjusted.
- **Day close / shift close** (`dayCloseDb.close`, `shiftsDb.close`) refuse while an order is open or printed but
  unsettled (`openOrdersBlocker` in `pos.ts` reads `table_orders` directly). The message lists the tables / tokens
  and points to `/tables`.
- **Folder sync is not real time.** Two phones working one floor at the same time is a non-goal (no LAN).

## Storage

| Key / table | Kind | Backed up | Synced | Guard |
|---|---|---|---|---|
| `mrchartist_inv_dining_areas` | `DiningArea` rows | yes (`RECORD_TABLES`/`ID_TABLES`) | yes | `master.edit` |
| `mrchartist_inv_dining_tables` | `DiningTable` rows | yes | yes | `master.edit` |
| `mrchartist_inv_table_orders` | `TableOrder` rows (lines, kots, log, payers) | yes | yes, DATED by `day` (local day opened; else `opened_at`) | `doc.create` |
| `mrchartist_inv_modifier_groups` | `ModifierGroup` rows | yes | yes | `master.edit` |
| `mrchartist_inv_restaurant_settings` | object: `service_charge_default`, `token_reset`, `stations`, `station_names`, `cancel_cap`, `auto86` | yes | yes | `master.edit` (API) |
| `mrchartist_kot_printers` | device-local, outside the prefix (like `mrchartist_pos_printer`) | no | no | — |

Additive fields, declared by merging in `src/types/restaurant.ts`:
- `InvoiceRecord.table_order_id`, `split_of`. Both are in `RECORD_KEYS` (one `// R3-A` line) and `normalizeRecord`.
- Line `modifier_of`, `note`, `seat`.
- Catalogue `unavailable_on`.

There is no new numbered series. KOT numbers are daily counters inside `table_orders`.

All four tables are in `WATCHED_TABLES` (audit edit log) and `TABLE_ACTIONS`. Each shared registry has one appended
`// R3-A` block (backup, audit-edits, access, sync-engine, CommandPalette → `r3a-destinations.ts`).

## Wiring done in this package (the PRD assigned it to the lead)

- `src/App.tsx`: `const Tables = lazy(() => import('./pages/Tables'));` and
  `<Route path="/tables" element={<RequireAccess action="doc.create" fallback="/transactions"><Tables /></RequireAccess>} />`.
- `src/layouts/DashboardLayout.tsx`: the nav entry `{ label: 'nav.tables', path: '/tables', icon: Store, need: 'doc.create' }`
  under Sales, after POS. It reuses the `Store` icon because every lucide icon lands in the first-paint `vendor-ui`
  chunk. `nav.tables` is added to `en.ts` / `hi.ts`.
- `src/lib/shop-mode.ts`: `'restaurant'` in `BusinessType`, and `PATH_MODULE['/tables'] = 'pos'`.
- `src/lib/shop-presets.ts`: the `restaurant` preset is POS + inventory + reports, landing on `/tables` with the
  `compact_receipt` template. Its wizard / panel labels live in `reach.ts`.

## Rows for the lead (ROADMAP / ARCHITECTURE / AGENTS.md)

- **ARCHITECTURE → Tables**:
  - `dining_areas` / `dining_tables`: restaurant R3-A (`src/lib/restaurant/orders-store.ts`). `DiningArea {id, name,
    price_level_id?, service_charge_pct?, sort?}` and `DiningTable {id, name, seats, area_id, sort?}`. A starter
    Dine-in area with tables 1–10 is used until the first save.
  - `table_orders`: restaurant R3-A. `TableOrder` (`src/types/restaurant.ts`) is a running order: lines, KOTs
    (`K<n>` per local day), event log and payer rows. It is not an invoice. Settled into POS invoices with
    `table_order_id` / `split_of`. Synced, DATED by `day`.
  - `modifier_groups`: restaurant R3-A. `ModifierGroup` with min / max and options (price, optional `item_id`),
    linked to items / stock groups.
  - `restaurant_settings` (object): restaurant R3-A. Station map, cancel cap, default service charge, auto-86.
- **AGENTS.md → device-local preferences**: `mrchartist_kot_printers` (KOT printer per kitchen station).
- **ROADMAP**: Round 3 R3-A1–A5 are built. A4's optional auto-86 is built (off by default). A5's share sheet
  works in the preview and at the POS. The editor's post-save sheet (`SendSheet.tsx`, not owned by this package)
  reaches it through Preview → Share.

## Deviations from the PRD

- **`eco_section` value.** The PRD says `'9(5)'`, but the existing type is `EcoSection = 'TCS_52' | 'PAY_9_5'`.
  `PAY_9_5` is used, so the existing GSTR-1 / 3B logic applies unchanged.
- **Service charge label.** Templates are not touched (TemplateEngine is off-limits this round). The amount is the
  bill's "Other charges (taxable)" line, and the bill notes name it "Service charge (optional) @ n% … voluntary".
- **Split parts.** Item / seat parts are saved together (consecutive numbers), each paid in full in its own mode.
  A part cannot be left unpaid for later. Equal / custom payer rows do settle one by one.
- **Day-close list.** It is shown as a message listing the open tables / tokens, with no per-order jump links.
  `ZReportModal.tsx` only gained a `try/catch` so the refusal shows as a toast.
- **`escpos.ts` import.** `kot.ts` imports the pure text helpers (`lr`, `center`, `wrap`) statically, so the ticket
  text is testable. `escpos.ts` therefore sits in the lazy `/tables` chunk; device sending stays in the lazily
  loaded `kot-print.ts`.
- **Strings.** Restaurant strings live in two areas. `restaurant.ts` serves the Tables screen. `restaurant-pos.ts`
  is a small one, so the POS chunk and ShareMenu do not carry the whole restaurant catalogue.
- **Lib errors.** Validation messages from the libs (modifier min / max, split amounts) are English, like the
  existing POS lib errors.

## Bundle

First paint is **+0.33 kB gz** against the R2-B baseline (184,773 → 185,105 bytes). That covers the route entry,
nav entry and `nav.tables` string, the `RECORD_KEYS` / `normalizeRecord` fields, the registry rows (audit-edits /
sync-engine / access live in first-paint chunks) and the shop-mode path. Everything else is lazy:
- the `/tables` page chunk;
- settings, register, split and picker modals;
- `kot-print`;
- `share-image` (with `html-to-image` loaded dynamically).

## Statutory open points (verify with your CA)

1. **Restaurant GST rate.** The starter assumption is 5% without ITC for restaurant service. Restaurants in
   "specified premises" are assumed at 18% with ITC. Composition restaurants keep the composition logic. Rates come
   from the items / profile; nothing is hard-coded here.
   - Are these still the values after the 22 Sep 2025 rate changes?
   - Should a "specified premises" flag become a date-keyed rule in `tax-rules.ts`?
   - How should outdoor catering be treated?
2. **Service charge** (and a legal adviser). It is off by default, optional, removable and labelled voluntary.
   - Is that enough under the consumer-protection guidelines as understood?
   - Is GST on a voluntarily paid service charge right at the food rate (taxed here via `charges_taxable`)?
   - Should it be excluded from staff payout reports?
3. **Split bills.**
   - Is it acceptable that item / seat splits create separate tax invoices, while equal / custom splits keep one
     invoice with several payers?
   - Must sub-invoices reference each other on paper? Today they carry `split_of` and the shared `table_order_id`
     in data only.
   - Is it right to leave a paisa CGST / SGST swap from per-line rounding visible rather than adjust tax?
4. **Aggregator orders (Sec 9(5)).**
   - Confirm value-only reporting in Table 14(b) / 3B 3.1.1(ii), and that the operator GSTIN is required.
   - Should aggregator commission invoices be prompted as purchases with ITC?
