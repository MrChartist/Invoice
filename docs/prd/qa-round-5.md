# QA round 5: hands-on audit of Rounds 2–4 and the perf work

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `bd4b0dd` (R2, R3, QA round 3
fixes, R4-A and PERF-1 / PERF-2 merged). `dist/` was rebuilt from that commit (`npm run build`, clean). `npm test`
passed in full (2,189 tests). Every P0 and P1 below was reproduced on that commit.

Method:
- **Browser.** Playwright (Chromium) against the production build, served with the real headers
  (`scripts/lib/harness.mjs`), with persistent profiles. The base profile is an own company ("Asha Traders", GSTIN
  27AAPFU0939F1ZV, Maharashtra, CA / full-accounting wizard) with the sample-data set loaded on top.
- **Data layer.** Node probes run the same public lib / store APIs the screens call, through the repo's test harness
  (`tests/helpers/world.ts`, `createViaStore`). They are used where a UI path needs many set-up clicks.
- **Static review.** The new code was read for XSS, CSV formula injection, `innerHTML`, prototype pollution and
  network calls.

Files:
- Browser scripts: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa5/*.mjs`.
- Node probes: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa5/probes/*.test.ts`.
  Their output is in `probes/*.out`.
- Screenshots: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa5/shots/`.

Below, `shots/` and `probes/` mean those folders. To run a probe:
`node --experimental-strip-types --import ./tests/hooks/register.mjs --test <probe>`.

This doc reports bugs and friction only. It proposes no new features. Items fixed in QA round 3 were re-tested only for
regressions, and none were found.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken.
- **P2:** friction.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| F1 | P0 | Collections / kasar | A clerk's pending settlement notes are not counted against the bill, so two pending FCNs and a full receipt over-credit the party once the owner approves (−₹63,000 on a ₹59,000 bill) |
| F2 | P0 | Collections / write-off | A write-off ignores linked credit notes and FCNs. It writes off the gross balance and leaves the party in credit |
| F3 | P0 | GST (composition) | CMP-08 / GSTR-4 treat a no-GST settlement note (FCN) as negative turnover. Tax falls for manufacturers and restaurants, and traders show a negative exempt value |
| F4 | P0 | Retainers | Closing a period stamps a partly covered entry as wholly covered. Its overage minutes vanish from Unbilled |
| F5 | P0 | Books / deferrals | The deferrable amount is quantity × rate. It is wrong for tax-inclusive prices, invoice-level discounts and foreign-currency invoices |
| F6 | P0 | Books / deferrals | When the source is in a locked month, the initial deferral is skipped but the monthly releases still post, so Sales is overstated |
| F7 | P0 | Batch invoices | A party with no state or GSTIN inherits the source party's place of supply, so a local party is billed IGST |
| F8 | P0 (security, low) | Practice desk / e-Way desk | CSV exports skip the formula-injection guard (`=…` in a company name or DSC holder is exported as a live formula) |
| F9 | P1 | Production / QC hold | Stock held in QC counts as available and can be sold. A sale with no godown passes and drives Main negative |
| F10 | P1 | Quotations / editor | Switching a quotation's type in the editor keeps an unselected optional line. The tax invoice excludes it from the total, but the stock still moves |
| F11 | P1 | Write-off recovery | A same-FY recovery fails when the write-off's bill is dated inside the period lock ("its payments cannot be removed") |
| F12 | P2 | Write-off / roles | The data layer lets a clerk remove a write-off row (`payments.remove`), which undoes an owner-only, PIN-confirmed write-off. Write-off rows also offer "Print receipt" |
| F13 | P2 | Reports | "Sales by customer" subtracts FCNs from sales, but the P&L books them as Discount allowed |
| F14 | P2 | Batch invoices | Every party's invoice carries the source document's PO number |
| F15 | P2 | Batch invoices | A draft run takes FY numbers, and undoing it frees them for reuse |
| F16 | P2 | Progress billing | Quantities are rounded to 4 decimals (33.333% bills 33.33% and leaves a ₹10 "balance 0.0001" stage). The final stage does not absorb round-off (₹1 short). The over-cap message says "would be 100% billed" |
| F17 | P2 | Restaurant split | An add-on whose quantity differs from its parent splits into 0.33-qty pieces. Sub-bills are ₹0.30 + GST short of the whole |
| F18 | P2 | Collections | The clerk's settlement cap compares a foreign-currency amount with a rupee cap |
| F19 | P2 | Practice desk | A registry entry with no database is shown as "Locked — open to see" |
| F20 | P2 | Promises to pay | One receipt keeps every overlapping promise of the party |
| F21 | P2 | SO → PO | Free stock is subtracted once per order line of the same item, and a short-closed PO still counts as on order |
| F22 | P2 | Deferrals | "Delete schedule" is not atomic. A locked voucher leaves the schedule half deleted, and the deleted journals are posted again |

### What was verified and is correct

No console errors, page errors or CSP violations were seen. The tour covered 28 routes and every tab inside them, on a
1366 × 768 light desktop and on a 390 × 844 phone in dark mode. No route scrolled sideways at document level on the
phone.

Logs: `tour-desk.log` and `tour-phone.log`. Shots: `shots/tour-*`, for example `shots/tour-phone-dark_tables.png` and
`shots/tour-phone-dark_manufacturing-t10.png`.

**PERF-1 cache: no stale data found.**
- **Two tabs in one browser context.** Tab B recorded a receipt with a kasar settlement. Tab A at once showed "Updated
  in another tab — Refresh". After in-app navigation, Receivables and Clients in tab A showed the new state, and they
  still agreed after a reload (`s3-crosstab.mjs`, `shots/s3-A-after.png`).
- **Restore while a second tab was open.**
  - Tab B showed the restored data after in-app navigation.
  - A later write from tab B did not bring back the replaced FCN or receipt.
  - The FCN series restarted from the restored counter, as expected.
  - Script: `s6-restore.mjs`. Shot: `shots/s6-B-after-restore.png`.
- **Backup → restore round trip.**
  - In the browser: invoices, receipts, `doc_links` and the FCN series came back exactly.
  - In the code: `collectAppData` / `parseBackup` take every `mrchartist_inv_*` key, so the Round 2–4 tables
    (`payment_terms`, `batch_runs`, `deferrals`, `retainers`, `production_orders`, `landed_cost_vouchers` …) go with
    them. Only device-local `mrchartist_*` preferences stay behind, by design.
- **Practice desk.** It never creates or upgrades another company's database. With a ghost registry entry,
  `indexedDB.databases()` still listed only `mrchartist_inv_kv@3` after the desk loaded
  (`shots/s6-practice-ghost.png`).

**Annual pack ties to the books.**
- Net profit was ₹9,18,879.90 in Books → P&L, in the pack's P&L and in its cash-flow opening line.
- The balance sheet tied at ₹11,09,726.00.
- The interim label from QA-3 F18 is in place.
- Shots: `shots/s5-books-pnl.png`, `shots/s5-annual.png`.

**Kasar on a receipt (UI).**
- A ₹14,000 receipt on a ₹14,160 bill, with "Short payment / kasar", settled the bill.
- An FCN was raised with no GST.
- Nothing appeared in GST reports.
- Shots: `shots/s3-B-kasar.png`, `shots/s3-B-after.png`.

**Pure-logic checks that pass.**
- Progress billing at 33.33% + 33.33% + balance, with line and invoice discounts and shipping, both intra- and
  inter-state: taxable value, GST and total match the quotation to the paisa (`probes/p2-sales.out`, "intra" / "inter").
  The 100% cap refuses 40.0001% after 60% and allows exactly 40%. A closed source refuses a further stage.
- Batch invoices: the CGST + SGST ↔ IGST switch is correct for parties that have a state or GSTIN. Undoing an issued
  run cancels it and never deletes, and numbers are not reused after a cancel.
- Retainer rollover cap and forfeit are correct across months.
- Annual-pack HTML escapes every value.
- The client copy, the catalogue (CSP-pinned script, JSON data block) and the KOT / retainer print pages escape user
  text.
- XLSX exports write text as inline strings with `safeText`, so no formula is possible.
- The GST portal-file reader and backup / sync parsing assign no nested keys from input, so there is no global
  prototype pollution.
- No `fetch`, XHR, WebSocket or beacon exists in `src/`. The only external URLs are user-tapped `wa.me` / `mailto:`
  links.

---

## 2. Findings

### F1 — P0 — Pending settlement notes are invisible to the due, so approvals over-credit the party
- **Repro (data layer, `probes/p1-collections.test.ts` test A):**
  1. Issue a ₹59,000 tax invoice.
  2. As a clerk, raise a ₹5,000 settlement discount (over the ₹100 / 2% cap, so it is held for approval, FCN/0001).
  3. As the same clerk, raise a second note of ₹58,000. It is also accepted as a pending draft.
  4. The customer pays ₹59,000 in full.
  5. The owner approves both notes from the approval queue.
- **Expected:** The second note is refused, because pending notes already reserve part of the due. Approving a note
  checks the due again and refuses (or caps) a note that no longer has anything to settle.
- **Actual:** Both notes are accepted while pending and both are approved after full payment. Receivables shows
  "Bharat Traders: credit notes ₹63,000, net −₹63,000", so the business now owes the customer ₹63,000 that it never
  owed. Approval also does not call `resettleCreditedInvoices`.
- **Cause:** `dueOn` / `creditedOn` count only live credit notes (`isLiveCreditNote` excludes drafts). `decide()` saves
  the note as Sent with no due check.
- **File:** `src/lib/settlement.ts:220-229` (count pending FCN drafts in the cap) and `:240-262`.
  `src/lib/approvals.ts:79-100` (for `note_kind: 'financial'`, re-check `dueOn` on approve, then
  `resettleCreditedInvoices`).
- **Shot:** n/a (data layer). Probe output: `probes/p1-collections.out` ("PROBE A …").

### F2 — P0 — Write-off writes off the gross balance and ignores credit notes and FCNs
- **Repro 1 (`p1-collections` test C):**
  1. Invoice 10 × ₹1,000 + 18% = ₹11,800.
  2. Credit note for 2 units (₹2,360, goods returned). The due is now ₹9,440.
  3. Receivables → expand the party → Write off (or `writeOffBill`).
- **Repro 2 (C2):** ₹11,800 invoice → receipt ₹5,000 → kasar FCN ₹100. The due is ₹6,700, and the write-off books
  ₹6,800.
- **Expected:** The write-off is ₹9,440, and the party ends at nil.
- **Actual:** ₹11,800 is written off. Receivables shows net −₹2,360 (the party is now "Advance"), and Bad debts is
  overstated by the credit. The dialog shows the right figure ("Writes off the open balance of ₹…" uses
  `bill.outstanding`), but the data layer writes `receivableBalance` (total − paid).
- **File:** `src/lib/write-off.ts:33` and `:57`. `writeOffBlock` / `bulkWriteOff` must use `amountDue(inv, credited)`
  with `linkedCredits`, as `settlement.ts:dueOn` does. Callers: `src/components/collections/WriteOffDialog.tsx`,
  `src/components/invoicing-ux/BulkCollectDialog.tsx:79`.
- **Shot:** `shots/s4-writeoff-dialog.png` (the dialog text). Probe: `probes/p1-collections.out` ("C" / "C2").

### F3 — P0 — Composition returns count a no-GST FCN as negative turnover
- **Repro (`p1-collections` test B):**
  1. Composition profile (manufacturer). Bill of supply ₹1,00,000 at an 18% nominal rate, in October.
  2. Receipt ₹90,000 + kasar ₹10,000 (FCN, no GST).
  3. Open CMP-08 for Q3.
- **Expected:** Turnover ₹1,00,000 and tax ₹1,000 (0.5% + 0.5%). A financial note is not a GST document (the same rule
  GSTR-1 already applies through `isNonGstFinancialNote`).
- **Actual:** Turnover ₹90,000 and tax ₹900. For a trader profile the tax is unchanged, but the outward value is
  ₹90,000 with **exempt −₹10,000**. GSTR-4 Table 4/5 is built from the same documents.
- **File:**
  - `src/lib/composition-returns.ts:87` (`SALES_TYPES`) and `:161` (skip `isNonGstFinancialNote(rec)`).
  - `src/lib/gstr4-annual.ts:109` (`estimateEcoTcs`, same filter).
- **Shot:** n/a (data layer). Probe output: `probes/p1-collections.out` ("B turnover …").

### F4 — P0 — Retainer close swallows the overage of a partly covered entry
- **Repro (`probes/p3-service.test.ts`):**
  1. Retainer: 1 h per month from 1 Sep 2026, no rollover.
  2. Billable time in September: 30 min on the 5th and 60 min on the 10th.
  3. While the period is open, the drawdown is: covered 30 + 30, overage 30 (entry e2), used 60 of 60.
  4. Close September.
- **Expected:** The close keeps 30 min of e2 as overage, and Unbilled still offers 30 min at the overage rate.
- **Actual:** After the close, "used 90" against an allowance of 60, overage 0, and the coverage map is e2 → 60. The 30
  overage minutes are never billed. The closed branch takes an entry's whole minutes when it is stamped, but the stamp
  list includes partly covered entries.
- **File:**
  - `src/lib/retainers.ts:207-209` (closed branch of `drawdown`).
  - `closePeriod` (`:256-273`): store the covered minutes per entry (for example `covered: {id: minutes}` on the close
    row), or stamp only wholly covered entries and keep the split for the partial one.
  - `commitClose` (`:377`).
- **Shot:** n/a (data layer). Probe output: `probes/p3-service.out`.

### F5 — P0 — Deferral amounts use quantity × rate, not the line's taxable value in INR
- **Repro (`probes/p5-books.test.ts`):** Books → Deferrals → New schedule, then pick an invoice line.
  - **Tax-inclusive invoice:** ₹11,800 including 18%, so taxable ₹10,000. The schedule is pre-filled with ₹11,800,
    and validation allows up to ₹11,800.
  - **20% invoice-level discount:** taxable ₹8,000. The line offers ₹10,000.
  - **USD export invoice:** $1,200 at ₹84, so ₹1,00,800. The line offers **₹1,200**.
- **Expected:** The line's taxable value in rupees (after the line and invoice discount, tax backed out, × exchange rate).
- **Actual:** The amounts above. For the inclusive invoice, Sales goes negative in the month of deferral (₹11,800 moved
  out of ₹10,000), and "Income received in advance" is overstated until the last release. A USD invoice defers only
  1/84 of the revenue.
- **File:** `src/lib/deferrals.ts:164-178` (`invoiceSourceLines`). Use the calc lines (`calculateInvoice` →
  `lines[i].taxable`) and `inrValue`. Also check `purchaseSourceLines` (`:182`) for inclusive bills.
  `src/components/books/planning/DeferralsTab.tsx:95-101` pre-fills from it.
- **Shot:** n/a. Probe output: `probes/p5-books.out` ("inclusive" / "invoice discount" / "USD").

### F6 — P0 — Deferral releases post without the initial deferral when the source month is locked
- **Repro (`p5-books` "locked month"):**
  1. Invoice dated 10 Aug 2026 (₹12,000 AMC).
  2. Books locked to 31 Aug.
  3. Create a 12-month schedule from 1 Aug.
  4. Open Books (`postDue` to 31 Oct).
- **Expected:** The schedule is refused, because its first entry falls in a locked period. Otherwise nothing is
  released until the initial "defer" journal exists.
- **Actual:**
  - `postDue` reports `posted 2, locked 2`.
  - The Aug "init" and "r1" entries are skipped.
  - "r2" (30 Sep) and "r3" (31 Oct) post Dr Income received in advance ₹1,000 / Cr Sales ₹1,000 each.
  - Sales is overstated by ₹2,000 now and by ₹11,000 by year-end.
  - The holding account carries a debit balance.
- **File:** `src/lib/deferrals.ts:240-277` (`createDeferral`: `assertUnlocked` on `sourceDate`) and `:326-357`
  (`postDue`: do not post a release while `init` is unposted).
- **Shot:** n/a. Probe output: `probes/p5-books.out` ("LOCK …").

### F7 — P0 — Batch invoices charge IGST to a local party that has no state
- **Repro (`probes/p2-sales.test.ts` "batch"):**
  1. Source invoice to a Karnataka GSTIN client (IGST).
  2. Recurring → Batch invoices.
  3. Pick a Maharashtra GSTIN party, the walk-in customer (state 27), a party with no state and no GSTIN, and a
     party with state "Gujarat".
- **Expected:** A party without a state falls back to the seller's state (as the editor does for a new walk-in), or
  is flagged before issue.
- **Actual:** "No State Party" gets place of supply 29 and IGST ₹1,800 on a domestic sale with no state. GSTR-1 B2CS
  then reports the supply as inter-state to Karnataka, because it reads the document's place of supply.
- **File:** `src/lib/batch-invoices.ts:157` (`… || template.place_of_supply || fromState`: drop the template's PoS for
  B2B / B2C parties, or block the draft with a "pick a state" warning in `BatchTab.tsx`).
- **Shot:** n/a. Probe output: `probes/p2-sales.out` ("batch draft …").

### F8 — P0 (security, low) — CSV formula injection in two new exports
- **Repro:**
  1. Name a company (registry) or a DSC holder `=HYPERLINK("http://x","Click")`.
  2. Practice desk → CSV. Or, on the e-Way desk, enter a vehicle-update remark that starts with `=` or `@` → CSV.
  3. Open the file in Excel.
- **Expected:** Text is neutralised like every other export (`safeText` in `src/lib/csv.ts:278`).
- **Actual:** Both files use a local `csvCell` that only quotes, so the cell is written as a live formula. A client's
  company name on a CA's device is enough. Practice is the module that aggregates many clients' data.
- **File:** `src/pages/Practice.tsx:52-55` and `src/lib/eway-desk.ts:152-155`. Use `toCsv` / `csvCell` from
  `src/lib/csv.ts`.
- **Shot:** n/a (static).

### F9 — P1 — QC-held stock is saleable
- **Repro (`probes/p4-production.test.ts`):**
  1. Stock items TV (batch-tracked) and Fan, both with "QC on receipt".
  2. Post a GRN of 10 TV + 4 Fan. The goods go to the "QC hold" godown, correctly.
  3. Check stock levels (`getStockLevel`, Inventory summary, POS / editor availability).
  4. Then save a tax invoice for Fan × 2 with no godown picked.
- **Expected:** Held stock is shown apart and is not available to sell. A sale with no godown is refused (or warned),
  because Main has 0.
- **Actual:**
  - TV shows qty 10 and Fan qty 4, both "ok".
  - The sale saves with no warning.
  - Fan by godown is then `{QC: 4, main: -2}`.
  - The non-saleable check fires only when a line explicitly names the QC godown.
- **File:**
  - `src/lib/pharma-gate.ts:107` (`saleLimitGate`): check the default godown's free quantity when other quantity sits
    in non-saleable godowns.
  - `src/lib/stock-tracking.ts:748-777`.
  - Availability shown in POS / editor (`src/lib/inventory.ts` `findLevel` / `getStockLevel`): exclude
    `nonSaleableGodowns`.
- **Shot:** n/a. Probe output: `probes/p4-production.out`.

### F10 — P1 — An unselected optional line stays on a tax invoice and moves stock
- **Repro (`p2-sales` "optional line", through the editor store):**
  1. Quotation: Service ₹1,000 and Widget 5 × ₹2,000, with Widget marked Optional (not selected).
  2. In the editor, Document → Edit → type Tax Invoice → Save.
- **Expected:** Switching to a bill drops unselected optional / alternative lines and clears the flags, as conversion
  does (`documents.ts:200`). Otherwise the save is refused.
- **Actual:** The invoice is saved with total ₹1,180 (Widget excluded), but Widget stock falls from 10 to 5. The line
  is still on the stored items with `optional: true`. The stock engine, and anything else that walks `items`, counts
  it.
- **File:** `src/store/useInvoiceStore.ts:310` (`setDocType`: strip excluded lines when leaving QUOTATION). As defence,
  filter `isExcludedLine` in the stock event builder in `src/lib/inventory.ts`.
- **Shot:** n/a. Probe output: `probes/p2-sales.out` ("OPT …").

### F11 — P1 — Same-year bad-debt recovery is refused when the bill's month is locked
- **Repro (`p1-collections` test D):**
  1. Invoice dated 5 May 2026, written off on 25 May.
  2. Lock the books to 30 Jun.
  3. In October, Write-off register → Recover ₹3,000.
- **Expected:** The October recovery is recorded in October. It should either post the prior-FY style receipt voucher
  or record a dated receipt without rewriting May.
- **Actual:** "Books are locked up to 30 Jun 2026. INV/FY26-27/0001 is dated 5 May 2026, so it cannot be changed (its
  payments cannot be removed)…" The same-FY path deletes and re-adds the May write-off row, which the lock forbids.
- **File:** `src/lib/write-off.ts:212-226` (`recordRecovery`). When the write-off row's date is locked, use the voucher
  path, or reduce the row with a dated adjustment.
- **Shot:** n/a. Probe output: `probes/p1-collections.out` ("D …").

### F12 — P2 — A clerk can undo a write-off through the payment layer
- **Repro (`p2-sales` "write-off through"):** The owner writes off a bill (PIN-confirmed, `doc.deleteIssued`). As a
  clerk, call `localDb.payments.remove(<write-off row>)`.
- **Expected:** Refused. Reversing a write-off is owner-only (`reverseWriteOff` requires `doc.deleteIssued`).
- **Actual:** Allowed, and the bill is open again ("Sent").
  - In the UI this needs the payment dialog, which a fully written-off (Paid) bill does not open. It is still
    reachable after any other receipt on the bill is removed.
  - The dialog also shows the receipt-print button on "Written off" rows, which are not money.
- **File:** `src/lib/localDb.ts:658-676` (`payments.remove`: `requireAccess('doc.deleteIssued')` when `row.write_off`).
  `src/components/modals/PaymentModal.tsx:349-357` (hide receipt and trash for `p.write_off` unless owner).
- **Shot:** n/a (data layer). The UI attempt is in `shots/s4-err.png`: the Paid bill has no payment button.

### F13 — P2 — "Sales by customer" nets FCNs off sales
- **Repro (`p1-collections` test E):** ₹10,000 + GST invoice → receipt with ₹500 kasar → Reports → By customer.
- **Expected:** Taxable sales ₹10,000 (as in the P&L and GSTR-1), with the FCN shown as a settlement or discount, or
  left out.
- **Actual:** Taxable ₹9,500 and total ₹11,300, with 1 credit note. The P&L shows Sales ₹10,000 and Discount allowed
  ₹500, so the two reports disagree.
- **File:** `src/lib/sales-reports.ts:198-202` (`salesDocs`: skip `isFinancialNote`, or put it in its own column).
- **Shot:** n/a. Probe output: `probes/p1-collections.out` ("E …").

### F14 — P2 — Batch invoices copy the source PO number to everyone
- **Repro:** Source invoice with PO "KA-PO-77" → batch for 4 parties without overrides.
- **Actual:** All four invoices print "PO KA-PO-77", which is another customer's order reference.
- **Expected:** The PO is blank unless it is given per party.
- **File:** `src/lib/batch-invoices.ts:190`, and `templateFromDocument` (`:93`) should drop `po_number`.
- **Shot:** n/a. Probe output: `probes/p2-sales.out` ("po KA-PO-77").

### F15 — P2 — A draft batch run consumes FY numbers, and undo frees them
- **Repro:** Batch run with "Save as drafts" for 4 parties: INV/0002–0005. Undo the run. The next invoice is
  INV/0002.
- **Expected:** Like recurring drafts after QA-1, batch drafts stay unnumbered until issued. Otherwise the numbers are
  recorded in `series_counters` and never handed out again.
- **File:** `src/lib/batch-invoices.ts:263` (number only when `mode === 'issue'`).
- **Shot:** n/a. Probe output: `probes/p2-sales.out` ("next invoice after undo INV/FY26-27/0002").

### F16 — P2 — Progress-billing rounding and copy
- **Rounding.** A quotation line of quantity 1 (₹1,00,000) billed at 33.333% three times gives quantity 0.3333 each
  (33.33%). The balance stage is "0.0001 @ ₹1,00,000 = ₹10", a ₹11.80 invoice.
- **Round-off.** With round-off on, the three stages total ₹1,17,816 against a ₹1,17,817 quotation. Each stage rounds
  on its own, and the balance stage does not take up the difference.
- **Copy.** The over-cap refusal for 40.0001% after 60% says '"A" would be 100% billed', because the percentage is
  rounded to 2 places.
- **File:** `src/lib/progress-billing.ts`:
  - `:43` `roundQty`: bill by value for whole-unit lines, or keep more precision.
  - `buildBalanceInvoice` (`:314`): carry the round-off remainder.
  - `fmtPct`: show more decimals near 100%.
- **Shot:** n/a. Probe output: `probes/p2-sales.out` ("lump …", "round-nearest …", "40.0001 refused").

### F17 — P2 — Item split of an add-on with its own quantity loses paise
- **Repro (`probes/p6-restaurant.test.ts`):** Butter naan × 3 with an add-on "Extra butter" × 1 (₹30). Split by item
  1 / 1 / 1.
- **Actual:**
  - Each part gets "Extra butter 0.33". The parts total ₹209.70 against ₹210, before GST.
  - A non-weight item is billed in fractions.
  - The reconciliation strip is the only place that shows the gap.
- **Expected:** The add-on follows the share-line path (exact paise, remainder to the last part).
- **File:** `src/lib/restaurant/split-bill.ts:134-141` (the `byQty` branch applies `round2(qtys[i] * ratio)` to
  children). Use `allocate` for children whose quantity is not a whole multiple.
- **Shot:** n/a. Probe output: `probes/p6-restaurant.out`.

### F18 — P2 — Clerk settlement cap mixes currencies
- **Repro:** A USD 1,000 invoice at ₹84. As a clerk, raise a kasar of $50 (₹4,200).
- **Expected:** Held for approval (cap ₹100).
- **Actual:** Accepted, because `amount` (50, in USD) is compared with `clerkCap(rupeeValue(invoice))`, which is in INR.
- **File:** `src/lib/settlement.ts:260` (convert `amount` with the invoice rate before comparing).
- **Shot:** n/a (static).

### F19 — P2 — The practice desk calls a missing company "Locked"
- **Repro:** A registry entry whose database does not exist on this device (for example, removed elsewhere). Open
  `/practice`.
- **Actual:** "Ghost Co — Locked — open to see". `peekCompliance` returns `null` for a missing database, and the page
  maps it to `locked: true`. The desk correctly creates no database.
- **Expected:** "No data on this device", with an option to remove the entry.
- **File:** `src/pages/Practice.tsx:46-47`.
- **Shot:** `shots/s6-practice-ghost.png`.

### F20 — P2 — One receipt keeps every overlapping promise
- **Repro (static):** Party promises ₹5,000 by 1 Nov (note A) and ₹5,000 by 5 Nov (note B). One ₹5,000 receipt on
  31 Oct.
- **Actual:** Both promises count as kept. The payment score sees 2 kept, and the reminder hold lifts for both.
- **File:** `src/lib/collections.ts:101-112` (`promiseProgress`: allocate receipts to promises in date order).
- **Shot:** n/a.

### F21 — P2 — SO → PO proposal over-counts free stock and closed POs
- **Over-counted stock.** Two sales-order lines of the same item each subtract the full free stock.
- **Closed POs.** A back-to-back PO that was short-closed (`closed_on`) still counts its whole quantity as "on order".
  The missing quantity is never proposed again.
- **File:** `src/lib/back-to-back.ts:82-90` (share free stock across lines of one item) and `onOrderQty` (`:47`, count
  only the open or received quantity of closed POs).
- **Shot:** n/a (static).

### F22 — P2 — Deleting a deferral schedule is not all-or-nothing
- **Repro (static):** A schedule whose early release journals fall in a later-locked month. Delete the schedule.
- **Actual:** `deleteVoucher` throws partway. The journals deleted before the locked one are gone, but the schedule
  row stays and still lists them. The next `postDue` posts them again.
- **File:** `src/lib/deferrals.ts:372-379` (check every voucher's lock first, or wrap in `withTablesRollback` on
  `vouchers` + `deferrals`).
- **Shot:** n/a.

### Also noted (not counted as findings)
- **Backup nudge on a phone.** The banner covers the lower third of every phone screen until it is dismissed
  (`shots/tour-phone-dark_books-t17.png`). This is by design, and it is dismissible.
- **Restaurant modifiers.** Add-ons copy the parent quantity, and quantity changes scale them (`kot.ts changeQty`), so
  F17 needs an add-on added with its own quantity.
- **Clerks and cancellation.** A clerk can undo an issued batch run with a cancel reason. That matches the clerk's
  general right to cancel (`cancelDocument` is not owner-only), so it is reported here only for awareness.

---

## 3. Fix packages

The two packages touch disjoint files. QA5-1 owns the collections money paths and the composition / sales-report
readers. QA5-2 owns books, service billing, sales documents, production, restaurant and the CSV security fix.

### QA5-1 — collections, write-off and composition money paths
| Finding | Files |
|---|---|
| F1 pending FCNs over-credit (P0) | `src/lib/settlement.ts`, `src/lib/approvals.ts` |
| F2 write-off ignores credits (P0) | `src/lib/write-off.ts`, `src/components/collections/WriteOffDialog.tsx`, `src/components/invoicing-ux/BulkCollectDialog.tsx` |
| F3 FCN in CMP-08 / GSTR-4 (P0) | `src/lib/composition-returns.ts`, `src/lib/gstr4-annual.ts` |
| F11 recovery in a locked month (P1) | `src/lib/write-off.ts` |
| F12 clerk removes write-off; receipt on write-off rows | `src/lib/localDb.ts` (`payments.remove`), `src/components/modals/PaymentModal.tsx` |
| F13 FCN in Sales by customer | `src/lib/sales-reports.ts` |
| F18 cap currency | `src/lib/settlement.ts` |
| F20 overlapping promises | `src/lib/collections.ts` |

Tests to add:
- Two pending FCNs refused beyond the due, and approval after full payment refused.
- Write-off after a credit note writes off only the net due.
- CMP-08 with a kasar FCN keeps the turnover.
- Same-FY recovery with the write-off month locked.
- A clerk cannot remove a write-off row.

### QA5-2 — books, service, sales documents, production, restaurant, CSV security
| Finding | Files |
|---|---|
| F4 retainer close overage (P0) | `src/lib/retainers.ts` (+ the Unbilled reader if the close row shape changes, `src/lib/timesheets.ts`) |
| F5 deferral amount basis (P0) | `src/lib/deferrals.ts`, `src/components/books/planning/DeferralsTab.tsx` |
| F6 deferral in a locked month (P0) | `src/lib/deferrals.ts` |
| F7 batch PoS for parties without a state (P0) | `src/lib/batch-invoices.ts`, `src/components/recurring/BatchTab.tsx` (warning) |
| F8 CSV formula injection (P0, security) | `src/pages/Practice.tsx`, `src/lib/eway-desk.ts` |
| F9 QC stock saleable (P1) | `src/lib/pharma-gate.ts`, `src/lib/stock-tracking.ts`, `src/lib/inventory.ts` (availability) |
| F10 optional line on a tax invoice (P1) | `src/store/useInvoiceStore.ts` (`setDocType`), `src/lib/inventory.ts` (event filter) |
| F14 / F15 batch PO number, draft numbering | `src/lib/batch-invoices.ts` |
| F16 progress rounding / copy | `src/lib/progress-billing.ts` |
| F17 split add-on paise | `src/lib/restaurant/split-bill.ts` |
| F19 practice ghost company | `src/pages/Practice.tsx` |
| F21 SO → PO free stock / closed PO | `src/lib/back-to-back.ts` |
| F22 deferral delete atomicity | `src/lib/deferrals.ts` |

Tests to add:
- Retainer close with a partly covered entry keeps its overage.
- Deferral source lines for inclusive, discounted and USD invoices.
- No release posts before the initial deferral.
- Batch party with no state gets the seller's state.
- Practice / e-Way CSV neutralise `=` and `@`.
- QC-held quantity refused for a sale with no godown.
- A quotation switched to a tax invoice drops unselected optional lines.
- Split by item with a 1-qty add-on on a 3-qty parent.

There is no shared file. `src/lib/inventory.ts` is QA5-2 only, and `src/lib/localDb.ts` is QA5-1 only.
