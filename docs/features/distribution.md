# Distribution, pharma operations & stock depth (8F, roadmap 8.80–8.88)

BUSY / Marg / Gofrugal / Zoho-Inventory parity for distributors and pharmacies. Everything is local: no server, no
live sync. Screens: **Distribution** (`/distribution`, lazy — opened from the Inventory toolbar or the command palette; no
sidebar entry, the sidebar is unchanged), **Order pad** (`/order-pad`, salesman mode), and three
Inventory tabs — *Fast / slow · ABC*, *Variants, kits & bins*, *Breakage / expiry* (each its own chunk).

## Credit-limit enforcement (8.80)

| Piece | Where | Storage |
|---|---|---|
| Company policy Off / Warn / Block, "count open sales orders", "block on overdue bills" | `credit-policy.ts`, Distribution → Credit control (owner only, audited) | key `credit_policy` |
| Per-party override | Distribution → Masters → Parties | `Client.credit_policy` (additive) |
| Data-layer gate | `holdIfCreditBlocked` in `approval-gate.ts`, one line after `holdIfApprovalNeeded` in `localDb.invoices.save` and `setStatus` | `ApprovalInfo.reason = 'credit'` (additive) |

- Figures are the existing `creditCheck` (`credit-limit.ts`) plus, when asked, the GST-inclusive rupee value of the
  party's open sales orders still to bill (`openOrderValue`).
- **Warn**: editor / POS notice, saving never stops (the 6.25 behaviour; Warn is the default).
- **Block**: only a document that *adds* credit (its unpaid rupee value > 0) is blocked, when the party is over its
  limit or (option) has bills older than its credit days. A clerk's save is held as a **Draft pending approval** (same
  queue as maker-checker, reason "credit", the warning in `approval.note`); the owner approves from the queue and the
  approved value passes. The owner's own save passes and is audited ("Credit limit overridden by …").
- **POS**: POS bills are exempt from the data-layer gate (paid at the counter). The POS checks the *unpaid* part for a
  saved customer before saving: a clerk is told to take payment or ask the owner; the owner gets an override dialog and
  the override is audited (`recordCreditOverride`).
- The evaluator lives in the lazy editor / POS chunks and registers itself (`registerCreditGate`); the editor
  chunk is prefetched on idle. If a clerk issues a document under a company Block policy before it is loaded, it is held
  (fail-safe). First paint grows only by the small gate.
- The master decides, never the snapshot: `localDb.invoices.save` strips `area_id`, `beat_id`, `agent_id` and
  `credit_policy` from the client snapshot before learning the party (as it already did for the credit limit).

## Distribution pack (8.81–8.82)

- **Masters** (`distribution.ts`, `master.edit`, audited): areas `dist_areas`, routes `dist_routes` (optionally in an
  area), beats `dist_beats` (area, route, salesman, visiting weekdays, order). Party fields `area_id`, `beat_id`,
  default `agent_id` (additive on `Client`; no invoice field changed, so `RECORD_KEYS` is untouched). Bulk assignment
  in Distribution → Masters (one write, one audit row) — the Clients screen is not changed.
- **Salesman of a document**: its own `agent_id` (editor; POS now has an agent select too), else the party's default
  salesman, else the beat's salesman. The editor fills an empty agent from the party's default when the party is picked.
  Area: the party's, else its beat's.
- **Reports** (Distribution → Reports, CSV): sales (revenue documents, value incl. GST and taxable), outstanding (open
  balances), collections (payment rows in the period, by the document paid) and sales returns (credit notes) — each by
  salesman / beat / area; unassigned rows last. Foreign documents at their invoice rate; those without a rate are left out.
- **Beat plan**: beats visited on a date's weekday with every party and its outstanding; week-at-a-glance grid.
- **Van sales** (`van.ts`): a godown of kind `van` (godowns master, additive `Godown.kind`). *Van load* = stock
  transfer (`STR/…`). *Van settlement* (`van_settlements`, `VST/FY<yy-yy>/<seq>`, series counters): unsold goods return
  by a van → godown transfer, cash counted vs cash received on the day's van bills + other collections; difference kept.
  Settlement + return transfer are all-or-nothing; delete removes both. Posts nothing (bills and payments already did).
- **Pick list** (`pick-list.ts`): lines of chosen sales orders / challans merged per item + batch, sorted by bin.

### Offline order pad (8.81)

- Salesman's device: `/order-pad` books orders per party (filter by beat) into `order_pad_outbox`, then makes **one
  signed order file** (`.mcorder`): JSON payload + HMAC-SHA256 over `app|v|salt|iter|payload`, key from PBKDF2-SHA256
  (210 000 iterations, same `crypto.ts` helpers and limits as backups / sync) of a passphrase the office shares with its
  salesmen. Shared by Web Share (files), saved as a file, or shown as a QR code (when ≤ 2 300 characters).
- Office: Distribution → Order import verifies the signature (wrong passphrase / any edit → refused) and imports each
  order as a **Sales Order** (`SO/FY…`, `buildSalesOrder`: editor defaults, party state as place of supply, totals,
  the salesman as `agent_id`). Imported order ids are kept in `order_pad_imports`, so a repeated file only reports
  duplicates. One file imports all-or-nothing. The signature proves origin and integrity; the file is **not encrypted**.

## Pharma operations (8.84) — see also business-extras.md § Pharma

- **Breakage / Expiry Issue** (`expiry-ops.ts`, Inventory → Breakage / expiry → Issue): every in-stock batch expired
  or expiring within N days, per godown, traced to the supplier bill lines that brought that batch in (`item_id`, else
  name / alias; latest bill first; never more than the line can still return). Grouped by supplier; one pass creates
  the debit notes through `purchaseReturnsDb.create` (goods returned, reason 01, from the batch's godown) — **one per
  supplier bill**, because a debit note is against one bill — and **one claim per supplier** (`expiry_claims`).
  All-or-nothing (purchase returns, bill adjustments, claims, series counters roll back together). Batches with no bill
  are listed as "not traced".
- **Claims**: pending → *credit received* (supplier's credit note number / date written on every debit note of the
  claim via `setSupplierNote`, for GSTR-2B matching) or *rejected* (remark required; debit notes stay until deleted).
- **Breakage / Expiry Receive** (`expiry_receipts`, `BER/FY…`): customer returns into a godown of kind `expiry` as
  stock moves (kind `return`, `ref_type` `expiry_receipt`), optional replacement issued from a saleable godown at nil
  value. Sales from an expiry godown are refused (`saleLimitGate` in `liveDocTrackingIssues`). A value credit note is
  raised in the editor with *goods returned* off.
- **Destroy**: adjustment out of the expiry godown at cost (`ref_type` `expiry_destroy`, cost on the move). **ITC
  reversal reminder** per month: estimated input tax (cost × item GST rate) to reverse under Sec 17(5)(h) in GSTR-3B
  Table 4(B)(1) — *verify with your CA*.
- **Salt / composition** (`StockItem.salt`, set in *Variants, kits & bins → Bins & salts*): the editor item picker and
  the POS search match it and show it, so typing a salt lists substitutes (`salt-search.ts`).
- **Block sale above MRP** (pharma setting `block_above_mrp`): a line priced (after discount, incl. GST, per base unit)
  above its batch's MRP (from the purchase line) is refused. Batch MRP is read as per base unit.

## Stock depth (8.83, 8.85, 8.86)

- **Fast / slow / non-moving** and **ABC** (`stock-analysis.ts`) from the stock ledger: outward = sales + consumption −
  sales returns; turnover = cost issued ÷ average stock value, annualised (fast ≥ 6 a year by default); ABC by issue
  value with cumulative cut-offs (70 / 90 by default; the item crossing a line stays in the class).
- **Variants** (`variants.ts`): attribute grid on a parent (`variant_axes`, ≤ 3 attributes, ≤ 200 combinations)
  generates child stock items (`variant_of`, `variant_attrs`, SKU `<parent>-<VAL>-<VAL>`, optional in-store EAN-13).
  Re-generating only adds new combinations.
- **Kits** (`events-kits.ts`, one registration line in `collectEvents`): a stock item with `kit: true` (not stocked) is
  sold as one line; its default BOM's components (× `unit_factor`, scrap grossed up) leave stock as sales, the line
  value shared by component sale rate; a goods credit note brings them back. Same effect rules as invoice lines
  (drafts, challans, "what if I edit it" exclusion). `liveInputs` reads `boms`; the editor stock cache keys on it.
- **Bin / rack**: item `location`, per batch `batch_bins` (`bins.ts`). Delivery challan lines snapshot the bin when the
  item is picked (`InvoiceItem.bin`, printed in the tracking sub-line); pick lists read the live master.

## Thermal labels (8.87)

- Roll presets in `label-sheet.ts`: 50 × 25 mm 1-up, 38 × 25 mm 2-up, 100 × 50 mm (one row per page, page = roll
  width × label height), used by the existing label dialog.
- Raw printer output (`label-raw.ts`): TSPL, EPL2 and ZPL at 203 dpi, ASCII only; sent with the Web Serial helper of
  `escpos.ts` where the browser has it (feature-detected; WebUSB stays off per the security headers) or saved as a file —
  the label dialog shows the language select and both buttons when a roll layout is chosen (`RawLabelButtons`, lazy).
- Weighed goods: EAN-13 `22` + PLU (5) + price in paise (5) + check (or `21` + grams for weight); `parseWeighedEan`
  reads them back; `weighedLabel` builds the label (price = weight × rate per kg).

## Tables (backup, sync, roles)

`dist_areas`, `dist_routes`, `dist_beats` (master.edit) · `van_settlements` (books.edit, dated + numbered VST) ·
`order_pad_outbox`, `order_pad_imports` (doc.create) · `expiry_claims` (books.edit, dated) · `expiry_receipts`
(books.edit, dated + numbered BER) · key `credit_policy`. All in both backup lists, `TABLE_ACTIONS`, sync `DATED` /
`NUMBERED` as noted.

## Open items

- A debit note per supplier *bill* (not one note spanning several bills of the supplier); the claim groups them.
- Weighed-goods codes are not yet decoded by the POS scan (price → quantity); the parser is ready.
- Kits: no shortfall warning in the editor for kit components; kit lines on purchase side are not exploded.
- Order pad: no partial import, no edit of an imported order's lines before import; QR scanning uses any external
  scanner (paste the text).
