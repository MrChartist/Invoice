# Stores & chains (Round 4, package R4-B)

Five features for retail chains and franchises: gift vouchers, loyalty tiers with points expiry, store price lists,
transfer requests with goods in transit, and replenishment of stores from the warehouse. Spec: `docs/prd/round-4.md`
§4 R4-B1–B5.

All of it is local-first. Every screen is a tab or a dialog on an existing lazy route, and there are no new routes:

| Feature | Where | Chunk |
|---|---|---|
| Gift vouchers: sell, register, breakage, settings | `/receivables?tab=giftvouchers` | `GiftVouchersPanel` + `gift-vouchers` |
| Gift-voucher tender | POS payment card (shown once vouchers exist) | `GiftVoucherTender` + `gift-voucher-core` |
| Gift-voucher payment method | Payment dialog → method "Gift voucher" | `GiftVoucherCodeField`, `gift-vouchers` on submit |
| Gift-voucher dashboard tile | Dashboard tiles → "Gift vouchers" (tile id `giftVouchers`) | `GiftVoucherTile` |
| Loyalty tiers, expiry, liability | Dashboard loyalty tile → settings / liability | `LoyaltyTiers`, `LoyaltyLiability` |
| Store price list per branch | Dashboard Branches tile → "Store price lists" | `BranchesPanel` |
| Store price grid (item × store, CSV) | Settings → Items → Pricing → "Store prices" (`?storeprices=1`) | `StorePricesGrid` |
| POS counter branch | POS customer card → "This counter is branch" | inside `Pos` |
| Transfer requests, In transit | `/inventory?tab=transfers&view=requests` / `view=transit` | `transfer-tabs` |
| Replenish | `/manufacturing?tab=reorder`, under Reorder Status (two or more godowns) | `ReplenishTab` |

## R4-B1 Gift vouchers

- **Series and code.** Numbers run `GV/FY<yy-yy>/<seq>` through `series-counters`; the prefix can be changed in
  settings. The code is 15 characters, printed as `<11 digits>-<4 characters>`:
  - the 11 digits are the FY digits, a 6-digit sequence and a Luhn check digit, so a typing mistake is caught before
    any lookup;
  - the 4 characters come from `crypto.getRandomValues`, using an alphabet without 0 / O / 1 / I, so a code cannot be
    guessed from its number.

  The slip prints the code as Code128 (`barcode.ts`). You can sell up to 500 vouchers at a time (bulk issue).
- **Sale.** No invoice is raised. One receipt voucher (`RV/FY…`) is saved through `saveVoucher`, which applies the
  period lock, roles and audit: Dr Cash / Bank (by tender) | Cr **Gift vouchers outstanding**. That ledger is a user
  ledger under Other current liabilities, created on first use (`ensureGiftVoucherAccount`). A promotional voucher
  (`promo: true`) posts nothing.
- **Redemption.**
  - **POS:** the "Gift voucher" tender (scan or type the code, one tender per voucher).
  - **Payment dialog:** method "Gift voucher" plus the code.

  Both check the code, the cancelled flag, the dates (`issued_on` ≤ bill date ≤ `expires_on`) and the balance, again
  at save time. When "allow part use" is off, the whole balance must be used in one go. The bill's taxable value is
  unchanged. The receipt row is an ordinary `transactions` row with method `Gift voucher` and the additive
  `gift_voucher_id`.
  - **Ledger** (`ledger/postings.ts`, one hunk): Dr Gift vouchers outstanding (falls back to Other current
    liabilities if the ledger is missing) | Cr Debtors.
  - **Cash / bank book** (`books.ts` `buildVouchers`, one hunk): the row is left out, so it never reaches the cash
    book, bank reconciliation, the cash forecast or the Today card.
  - **Z report:** gift vouchers are a separate "Gift vouchers redeemed" row (`ZReport.giftVouchers`). They are not in
    the tenders or "Received", and not in the cash drawer.
- **Promotional vouchers** are applied on the POS as an **amount discount**, added to any loyalty amount discount, and
  the use is noted on the voucher (`promo_uses`). If that bill is cancelled, the value comes back. A promotional
  voucher cannot be used as a payment.
- **Balance is derived:** face value − receipts paid with the voucher − promo discounts on live bills − breakage.
  Removing a receipt gives the value back. Status:
  - `cancelled` (stored);
  - `expired` (breakage recognised, or past `expires_on`);
  - `redeemed` (nothing left);
  - otherwise `active`.
- **Breakage.** "Recognise unredeemed balance" posts ONE journal on the chosen date for every sold voucher that expired
  before it and still has a balance: Dr Gift vouchers outstanding | Cr **Unredeemed voucher income** (Other income,
  created on first use). No GST is charged on it. Each voucher is recognised only once. **Undo** deletes the journal
  (the period lock applies) and the balances are outstanding again.
- **Cancel / refund** is owner only (`doc.deleteIssued`):
  - refused once anything has been redeemed, or once breakage has been recognised;
  - a sold voucher is refunded by a payment voucher: Dr Gift vouchers outstanding | Cr Cash / Bank.
- **Register.** Shows issued count, sold value, promotional value, redeemed in the period, outstanding and expired, by
  issuing branch and period. Each voucher has a history (sold, each redemption, discount uses, breakage,
  cancellation). The register exports to CSV.
- **Settings** (key `gift_voucher_settings`): `validity_months` (default 12), `allow_partial` (default on), `prefix`
  (default `GV`).

## R4-B2 Loyalty tiers and points expiry

- **Tiers.** `loyalty_program.tiers` holds dated tier sets `{ from, tiers: { id, name, min_spend_12m, multiplier }[] }`
  with up to 5 tiers. A changed list is appended from its date and never overwritten, so a bill keeps the tiers of
  its own date.
  - A customer's tier on a bill date is set by taxable spend from `date − 365` days up to the day before: sales minus
    credit notes, saved customers only. The bill itself does not count.
  - Earning = base points × multiplier, rounded down.
  - A credit note takes back points at the multiplier of its own date.
- **Expiry.** `loyalty_program.expiry_months`; absent means points never expire.
  - Each earn lot expires on its earn date plus N calendar months.
  - Redemptions and negative entries (credit notes, negative adjustments) use the oldest lots first.
  - A debit larger than the open lots leaves a deficit, which the next earning fills first.
  - The ledger gains "Expired" rows (`kind: 'expired'`, `expired`), and earn rows carry `expires_on`.
- **POS / editor redeem box** shows the tier, the spend still needed for the next tier, and "N points expire on
  dd/mm".
- **Liability** (in the loyalty tile, with CSV export) shows outstanding points × today's point value, and the points
  lapsing in the rest of the month. It is a working figure for the CA's provision.
- **Backward compatible.** With no tiers and no expiry, every balance equals the WP-9 single-rate result. A regression
  test covers this.

## R4-B3 Store price lists

- `Branch.price_level_id`: the store's price list, which can be any price level, including "MRP less %" levels.
- Table `branch_prices` holds dated per-item overrides `{ branch_id, item_id (catalogue id), from, rate }`.
  `master.edit` is required to change them.
- **Precedence in `resolvePrice`** (unit-tested): the first rule that sets a rate wins, then a lower quantity slab
  still applies.
  1. A typed rate. A line without a price basis is never re-priced.
  2. The customer's own price level (rate or % off).
  3. The store's dated override.
  4. The store's price list (rate or % off).
  5. The item's selling price list on the date. The caller passes it as the base rate.
  6. The catalogue rate.

  The line note reads "Store price (Mall)". Credit and debit notes are never re-priced.
- **Which store.**
  - **Editor:** the document's `branch_id`, or else the branch of its business profile / GSTIN (`branchOfInvoice`).
  - **POS:** the device-local choice "This counter is branch …" (key `mrchartist_pos_branch`, outside the data
    prefix, so it is never backed up or synced). It defaults to the branch of the active business profile.
- **Grid.** Items × stores, effective from a chosen date. CSV export / import matches names case-insensitively. A `-`
  cell clears an override, and unknown items or stores are reported back.

## R4-B4 Transfer requests, in transit, receive with shortage

- **Request** `TRQ/FY<yy-yy>/<seq>`: from-godown, to-godown, lines (item, qty, unit with `unit_factor`), needed-by
  date, requested-by. Statuses: Requested → Approved (optional, `doc.approve`) → Partly dispatched / Dispatched →
  Received → Closed, or Rejected. Everything except approved / rejected / closed is **derived** from the request's
  stock vouchers.
- **Dispatch** saves a normal STR (`STR/FY…`, `request_id`, `leg: 'out'`) from the source godown into the receiving
  store's in-transit godown.
  - The in-transit godown is "In transit → Mall" (`kind: 'transit'`, `parent_id` = the receiving godown), created on
    first use. It is non-saleable (`nonSaleableGodowns`).
  - Batches go first-expiry-first (`fefoAllocate`) and serials by serial.
  - The stock check is the normal `transferIssues`.
- **Receive** saves an STR from transit to the store (`leg: 'in'`) with the received quantity, taking batches and
  serials from what is in transit.
  - Short and damaged quantities stay in transit as `exceptions`.
  - A scan bar adds one received unit per scan.
  - Each exception is resolved in one of three ways:
    - **Write off:** a consume-only stock journal from the transit godown, tagged `request_id`.
    - **Claim from the transporter:** a note. The goods stay in transit until they are written off or found.
    - **Found:** a late receipt STR.
  - Close is refused while anything is still in transit. Quantities that were never sent are simply not sent.
- **Same GSTIN.** Each dispatch prints a **Rule 55 delivery challan** (three copies, value at cost, no tax) and offers
  **own-use e-Way JSON** (`buildEwayTransfer`: supply type O, sub-type 5 "For own use", document CHL, from and to
  GSTIN both your own, value at cost, nil tax).
- **Different GSTINs.** The dispatch STR crosses two branches with different GSTINs: the transit godown's parent is the
  receiving godown, so `transferTaxPair` sees the receiving branch. The existing Sec 25(4) tax invoice + bill dialog
  on the Transfers list applies to it unchanged, and the request detail points there instead of offering the
  challan.
- **Views.**
  - The requests list per store.
  - **In transit**, with age in days and value at cost (the stock engine's average cost), with value per receiving
    store / branch.
  - **Fill rate** per store: received ÷ requested over the last 90 days.
- **Bell** (lazy `ensureTransferAlerts`, loaded only once a request exists):
  - goods in transit for more than 3 days;
  - requests past their needed-by date.
- **Stock truth.** Goods in transit are the company's and count in closing stock (valued in the transit godown). In a
  branch view they belong to the receiving branch, because `branch-stock.ts` reads godown → parent → branch.

## R4-B5 Store replenishment

- **Setup.** `Godown.replenish_from`, set in the godown form ("Refill from").
- **The pass.** `replenishPlan` (in `reorder.ts`, pure, run after the per-godown Reorder Status) works on each store
  godown with a source:
  - need = shortfall − pending requests − goods in transit;
  - **transfer** = min(need, the source's free stock above its own reorder level);
  - **purchase** = the remainder, raised to the MOQ, at the last purchase rate from the last supplier.
- **Competing stores.** Several stores that draw on one source are served in godown-name order, then by item name.
- **Actions.**
  - "Create transfer requests": one request per source → store pair.
  - "Create purchase order": the existing PO path.
- **Fill rate.** The fill rate per store is shown under the plan.

## Storage

All the new tables are backed up (`RECORD_TABLES` / `ID_TABLES`), audited (`WATCHED_TABLES`) and role-guarded
(`TABLE_ACTIONS`).

| Key / table | Kind | Roles | Sync |
|---|---|---|---|
| `mrchartist_inv_gift_vouchers` | rows, dated `issued_on`, numbered `GV/FY…` | `doc.create` (cancel needs `doc.deleteIssued`) | DATED + NUMBERED |
| `mrchartist_inv_gift_voucher_settings` | object | `settings.manage` (in code) | yes |
| `mrchartist_inv_branch_prices` | rows | `master.edit` | yes |
| `mrchartist_inv_transfer_requests` | rows, dated, numbered `TRQ/FY…` | `doc.create` (dispatch / receive `books.edit`, approve `doc.approve`) | DATED + NUMBERED |
| `mrchartist_pos_branch` | device-local, outside the prefix | — | never |

Additive fields come by declaration merging in `src/types/stores-r4.ts`:
- `Payment.gift_voucher_id`;
- `Branch.price_level_id`;
- `Godown.replenish_from`;
- `StockTransfer.request_id` / `leg`;
- `StockJournal.request_id`.

Key `loyalty_program` gains `tiers?` and `expiry_months?`, and `TenderMethod` gains `'Gift voucher'`. No `RECORD_KEYS`
change.

## Statutory points — working papers, verify with your CA

1. **Gift vouchers.**
   - Per Circular 243/37/2024-GST, a transaction in vouchers is neither a supply of goods nor of services. So the sale
     raises no invoice and no GST.
   - GST arises on the underlying supply at redemption, on its full value: the voucher is consideration, not a
     discount.
   - A free promotional voucher is applied as a discount at redemption (Sec 15(3)(a)) because no money was received.
     **Verify with your CA:**
     - whether this treatment is right for both PPI and non-PPI vouchers;
     - whether Sec 12(4) was omitted from 1 Oct 2025, as a secondary source says;
     - whether the promotional-voucher-as-discount treatment is right.
2. **Breakage** (the unredeemed balance after expiry) is posted to Other income with no GST, because it is not a supply
   under the circular. **Verify with your CA** that it is taxable under income tax in the year of expiry.
3. **Same-GSTIN transfer challan.** The challan is built to Rule 55(1)(c) for movement other than by way of supply,
   with value at cost and no tax. **Verify the challan contents with your CA.**
4. **Own-use e-Way JSON.** The JSON uses sub-type 5 "For own use", document type CHL and value at cost. It follows the
   portal's bulk layout but is not validated against the portal. **Verify with your CA:**
   - the sub-type, document type and value;
   - whether an e-Way bill is needed below ₹50,000 for intra-State branch movements in your State.
5. **Goods lost in transit.** The write-off journal's narration reminds you to check an ITC reversal under Sec
   17(5)(h). **Verify with your CA.**
6. **Different GSTINs.** Transfers between different GSTINs stay on the Sec 25(4) tax invoice + bill path (Rule 28
   value), which this package does not change.
7. **Loyalty liability.** The report is outstanding points × point value, as a working figure. **Verify with your CA**
   whether Ind AS 115 / AS 9 entities need a provision journal.

## Bundle (`npm run build && npm run check:size`)

| | Before (base `claude/elegant-cannon-cwapiv` with PERF-1) | After R4-B | Delta |
|---|---|---|---|
| Initial JS (gz) | 181.84 kB | 182.00 kB | **+0.16 kB** (budget +0.3) |
| Total JS (gz) | 2178.23 kB | 2230.20 kB | **+52.0 kB** (target ≈ +45) |

- **First paint.** Only three things reach first paint:
  - the `'method.Gift voucher'` label in `en.ts` / `hi.ts`;
  - the lazy bell gate `ensureTransferAlerts`;
  - the lazy palette loader.

  Every R4-B library and screen is in its own lazy chunk. The palette destinations load on the first palette open.
  Every icon is reused: `Gift`, `Trophy`, `Store`, `Truck`, `ArrowLeftRight`, `Tags`, `Printer`, `Download`,
  `Upload`, `PackageCheck`, `Plus`, `Trash2`, `X`, `ShoppingCart`.
- **Total.** The largest new chunks (gz) are:
  - `transfer-tabs`: 7.9 kB (requests, in transit, challan, e-Way);
  - the `stores-r4` strings: 6.9 kB (English + Hindi);
  - `transfer-requests`: 5.4 kB;
  - `gift-vouchers`: 4.3 kB;
  - `GiftVouchersPanel`: 3.8 kB;
  - `gift-voucher-core`: 2.3 kB.

  Total JS stays well inside its 2400 kB budget.

## Tests

| File | What it covers |
|---|---|
| `tests/gift-vouchers.test.ts` | Codes; sale → receipt; partial redemption on the POS and on an invoice; expired / no-part-use refused; promotional discount; breakage + undo; cancel rules; Z report row; cash book; trial balance; period lock; roles. |
| `tests/loyalty-tiers.test.ts` | Tier boundaries; multiplier rounding; FIFO expiry with partial redemption and deficit; mid-year tier change; regression equality; liability. |
| `tests/store-prices.test.ts` | Full precedence table; dated switch-over; slabs after the store price; MRP-less-% list; POS counter branch; CSV round trip; roles. |
| `tests/transfer-requests.test.ts` | Request → dispatch 18 → receive 17 + 1 short → write-off with the transit balance back to zero; serials; found; alternate units; e-Way JSON shape; challan; Sec 25(4) pair; branch-stock attribution; views and bell; roles / approval / period lock. |
| `tests/replenish.test.ts` | Source free stock above its own level; netting of pending and in transit; remainder to PO with MOQ; competing stores. |
| e2e (`tests/e2e/smoke.mjs`) | Sell a GV → redeem it as a POS tender → transfer request → dispatch → receive with one short. |

## Rows for the lead (ROADMAP / ARCHITECTURE / AGENTS)

- **ROADMAP, Round 4:** "R4-B Stores & chains — gift vouchers (GV/FY…, liability, breakage), loyalty tiers + FIFO
  expiry + liability, store price lists (branch precedence in `resolvePrice`, POS counter branch), transfer requests
  (TRQ/FY…, in-transit godown, receive with shortage, Rule 55 challan, own-use e-Way JSON), store replenishment.
  `docs/features/retail-chains-r4.md`."
- **ARCHITECTURE, tables:**
  - `gift_vouchers`: `GiftVoucher` (`src/types/stores-r4.ts`), `GV/FY…`. Redemptions are `transactions` rows with
    `gift_voucher_id` (`retail/gift-vouchers.ts`).
  - `branch_prices`: `BranchPrice`, dated store overrides (`retail/store-prices.ts`).
  - `transfer_requests`: `TransferRequest`, `TRQ/FY…`. Dispatch / receipt are `stock_transfers` with `request_id` /
    `leg`; write-offs are `stock_journals` with `request_id` (`retail/transfer-requests.ts`).
  - Objects `gift_voucher_settings` and `loyalty_program.tiers` / `expiry_months`.
  - Additive `Godown.replenish_from`, `Branch.price_level_id`.
  - The `stock_transfers` row gains `request_id` / `leg`.
  - The `transactions` row gains `gift_voucher_id`.
- **AGENTS, storage keys:**
  - R4-B `gift_vouchers`, `branch_prices`, `transfer_requests` + object `gift_voucher_settings`.
  - New series `GV`, `TRQ`.
  - Device-local `mrchartist_pos_branch` (POS counter branch, outside the prefix).
  - Types file `src/types/stores-r4.ts`.
- **AGENTS, tech debt:** "A receipt row with `gift_voucher_id` moved no money: cash / bank readers must skip it (as
  `buildVouchers` does), and the ledger posts it to Gift vouchers outstanding."
