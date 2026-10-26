# QA round 6: hands-on audit of R4-B, R4-C, the ITA 2025 labels and R5-A / R5-B / R5-C

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `7910120` (R4-B, R4-C, QA5-1 /
QA5-2 fixes, ITA 2025 labels, R5-A, R5-B and R5-C merged). `dist/` was rebuilt from that commit (`npm run build`,
clean). `npm test` passed in full (2,432 tests). Every P0 and P1 below was reproduced on that commit.

Method:
- **Browser.** Playwright (Chromium) against the production build, served with the real headers
  (`scripts/lib/harness.mjs`), with persistent profiles. The base profile is the QA round 5 company ("Asha Traders",
  GSTIN 27AAPFU0939F1ZV, Maharashtra, CA / full-accounting wizard, sample data), with all six industry packs turned on
  in Settings → Defaults (`s0-packs.mjs`).
- **Data layer.** Node probes run the same public lib / store APIs the screens call, through the repo's test harness
  (`tests/helpers/world.ts`, `transport-works.ts`, `marketplace.ts`, `r5c.ts`). They are used where a UI path needs many
  set-up clicks.
- **Static review.** The new code was read for XSS, CSV formula injection, prototype pollution, network calls, and for
  every reader of `transactions` that must skip the no-cash markers (`gift_voucher_id`, `deposit_adjustment_id`,
  `ra_journal_id`).

Files:
- Browser scripts: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa6/*.mjs`. Logs:
  `tour-desk.log`, `tour-phone.log`, `phone2.log`.
- Node probes: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa6/probes/*.test.ts`.
  Their output is in `probes/*.out`. `probes/run.sh <probe>` runs one and writes its `.out`.
- Screenshots: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa6/shots/`.

Below, `shots/` and `probes/` mean those folders. To run a probe by hand:
`node --experimental-strip-types --import ./tests/hooks/register.mjs --test <probe>`.

This doc reports bugs and friction only. It proposes no new features. Items fixed in QA rounds 3 and 5 were re-tested
only for regressions, and none were found (the QA round 5 probes were run again on this commit, see §1).

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken.
- **P2:** friction.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| F1 | P0 | Recycle bin / Undo | A restore puts rows back with no regard for the module that owns them. A ₹1,000 gift voucher pays ₹2,000. A settlement journal comes back while the settlement says "not posted", so a re-post books it twice (clearing −₹225.43). An RA deduction receipt comes back without its journal (RA clearing ₹2,000) |
| F2 | P0 | Marketplace import | A file imported in summary mode and then again per order is imported twice: sales taxable ₹3,800 for a file of ₹2,400, and GSTR-1 counts both |
| F3 | P0 | Security deposits | "Adjust against invoice" ignores credit notes: ₹10,000 of the deposit settles a bill that owes ₹6,000. The party ends ₹4,000 in credit and the deposit register is ₹4,000 short |
| F4 | P0 | No-cash receipts | Gift-voucher redemptions are bank money in the Today card, bank-reconciliation candidates, payment modes and the Tally XML (Dr "Bank Account"). The receipts CSV export sends GV, deposit-adjustment and RA-deduction rows as "Deposit To: Bank" |
| F5 | P1 | Cash / bank book | Money that moves only through a manual voucher (gift-voucher sales, donations, security deposits, marketplace payouts) never reaches Books → Cash & bank, the cash tally, the Today card, the dashboard tile or Reconcile. A marketplace payout cannot be matched in the BRS |
| F6 | P1 | Export desk / LUT | Exports saved as "Tax Invoice" are skipped by the LUT_MISSING preflight and by the realisation (e-BRC) register. The sample data itself uses Tax Invoice |
| F7 | P1 | GTA freight bill | An unregistered payer gets the place of supply of its own state, not of the place the goods were handed over (Sec 12(8) IGST Act). A Pune → Surat load billed to an unregistered Surat party is charged IGST instead of CGST + SGST |
| F8 | P1 | Rule 42 / 43 | The annual true-up journal is dated 31 March of the closed FY. It is refused once that year is locked, which is normal by September, and otherwise it lands in the March GSTR-3B (already filed) |
| F9 | P2 | Transfer requests | A later receipt takes the batch that was reported short, so the batch left in transit is not the one the shortage names |
| F10 | P2 | Gift vouchers | Breakage can be recognised with a journal dated before the voucher expired, or even before it was sold |
| F11 | P2 | Gift vouchers | Removing a redemption after breakage strands the amount in "Gift vouchers outstanding" for good, and the register and the voucher disagree on the balance |
| F12 | P2 | POS | A second promotional voucher is listed as applied but gives no discount and is not recorded |
| F13 | P2 | Fees | A plan with both nil-rated and exempt heads makes one Bill of Supply tagged EXEMPT, so the nil part is reported as exempt in GSTR-1 Table 8 |
| F14 | P2 | GTA freight bill | An LR booked under the old FY's RCM option and billed after a forward-charge option prints both "payable by the recipient" and "forward charge 18% paid by the GTA" |
| F15 | P2 | Export register | Credit notes against an export invoice are not netted, so a credited amount shows as unrealised and goes overdue |
| F16 | P2 | Invoices / Undo | A delete waiting behind its Undo toast is lost when the tab is reloaded or closed: the invoice is back in the list |
| F17 | P2 | Recycle bin / roles | A clerk can restore an issued invoice the owner deleted (data layer: `restoreEntry` checks no owner of the entry) |
| F18 | P2 | Security deposits / perf | The deposits panel clones every invoice on each render while a deposit action is open (each keystroke in its amount box) |

### What was verified and is correct

**No console errors, page errors or CSP violations, and no layout problems.**
- 28 new routes and tabs were toured on a 1366 × 768 light desktop and on a 390 × 844 phone in dark mode, with every pack
  on. Logs: `tour-desk.log` and `tour-phone.log`.
- No route scrolled sideways at document level.
- On the phone, 14 new panels had no element clipped past the right edge outside a scroller (`phone2.log`).
- Shots: `shots/tour-*`, `shots/phone2_*`, `shots/p3_receivables_tab_giftvouchers-s2.png`,
  `shots/p3_gst-reports_tab_export-desk-s3.png`.

**Money paths that add up.**
- **Marketplace settlement.**
  - A posted Amazon V2 settlement leaves clearing at exactly 0.00, for the settlement and for the account.
  - Unpost brings it back to 0.00.
  - Probe: `probes/p4-market.out`.
- **RA bills.**
  - GST TDS and labour-cess rows post Dr GST TDS receivable / cess | Cr RA deductions clearing, and the clearing nets
    to 0.
  - The trial balance balances, with no ledger warnings.
  - The cash book, BRS candidates, payment modes, Today card and export register skip the rows.
  - Probe: `probes/p3-nocash.out`.
- **Fees.** A fee run cannot be undone once a receipt exists against one of its documents (`probes/p7-r5c.out`
  "FE-2").
- **Transfer requests.** Dispatch and receive move stock through the transit godown, and the transit quantity matches
  the open shortage (`probes/p2-transfer.out`).
- **QA round 5 fixes hold.** The round 5 probes (`qa5/probes/p1`, `p2`, `p3`, `p5`) were run again on this commit:
  - write-off of 9,440 after a credit note;
  - CMP-08 tax of 1,000 with a kasar FCN;
  - same-FY recovery inside a locked month;
  - retainer close keeps the 30-minute overage;
  - deferral bases of 10,000 / 8,000 / 1,00,800;
  - batch place of supply 27 for a party with no state, PO blank, drafts unnumbered and not reused.

**Backup → restore round trip.**
- A company with every new table was built: gift vouchers, LUT, settlements, channels, deposits, donations, the GTA
  option and a recycle-bin row.
- It was backed up, wiped and restored.
- All 22 `mrchartist_inv_*` keys came back byte-identical (`probes/p6-roundtrip.out` "RT-1").

**Roles.**
- A viewer cannot restore from the bin. A clerk cannot delete for good.
- A clerk can sell a gift voucher, dispatch a transfer and post a settlement. This matches the clerk's `doc.create` /
  `books.edit` rights.

**Security (static review and probes).**
- **CSV formula guard.** Every new CSV builder goes through `toCsv` / `safeText`: GV register, store-price grid,
  settlement recon, RA register, rent roll, deposit schedule, 10BD, fee dues, open export, auditor pack.
  Export-everything ZIP entries are named by id, not by user text.
- **HTML escaping.** These printed pages escape every value:
  - Rule 55 challan;
  - LR / bilty;
  - RA abstract;
  - freight annexure;
  - GV slips;
  - donation and deposit-refund receipts (`receipts.ts` `title` / `rows` / `notes`).

  `<img onerror>` / `<script>` payloads in a godown name and in a party name came out escaped (`probes/p2-transfer.out`
  "TR-1", `probes/p5-transport.out` "TP-1").
- **Prototype pollution.**
  - Marketplace files are read by column index, and saved mappings are checked with `Object.hasOwn`.
  - Bucket rules are an array.
  - The field-level merge writes only into a local copy, so there is no global prototype pollution.
- **Network calls.** There are no `fetch`, XHR, WebSocket or beacon calls in `src/`. The only new external URL is a
  user-tapped `wa.me` share (`LrList.tsx`).

**Income-tax Act 2025 labels.**
- Every caller passes the document date or the period start (`quarterStart`, `periodStart`, `fyStart`).
- Stored codes are unchanged.
- 26Q / 27Q / 27EQ / 16A / 24Q titles switch by period, and 10BD / 10BE switch by the donation FY.

**Performance.** The LUT hint reads the register once per mount, store prices use `peekTable`, and the POS voucher
lookup uses the shared rows. No new per-keystroke full-table read was found in the editor or the POS (F18 is a dialog).

---

## 2. Findings

### F1 — P0 — Recycle bin restore ignores the module that owns the row
- **Repro A (gift voucher spent twice, `probes/p1-retail.test.ts` "GV-2"):**
  1. Sell one ₹1,000 gift voucher (cash).
  2. Pay invoice A (₹1,000) with it from the payment dialog.
  3. Delete invoice A (owner). The invoice and its GV receipt go to the bin, and the voucher balance is ₹1,000 again.
  4. Pay invoice B (₹1,000) with the same voucher.
  5. Settings → Data → Recently deleted → restore invoice A with its linked rows. The Undo toast does the same.
- **Expected:** The restore is refused (or restores the invoice without its receipt), because the voucher has been
  spent since.
- **Actual:**
  - The restore succeeds. The voucher shows redeemed ₹2,000 against a face value of ₹1,000.
  - "Gift vouchers outstanding" closes at a ₹1,000 debit, so the liability has become an asset.
  - Two bills are settled by one voucher.
- **Repro B (settlement, `probes/p4-market.test.ts` "MP-3"):**
  1. Post an Amazon settlement. Clearing is 0.00.
  2. Unpost it. Its contra, journal and two receipts go to the bin.
  3. Restore the journal from Recently deleted.
  4. Post the settlement again.
- **Actual (B):** Clearing is −₹225.43. The settlement row still says "not posted", so the re-post books a second
  journal.
- **Repro C (RA deduction, `probes/p3-nocash.test.ts` "NC-2"):**
  1. Record a GST TDS deduction row on an RA bill.
  2. Remove it. The row and its journal both go to the bin.
  3. Restore the receipt alone.
- **Actual (C):** "RA deductions clearing" closes at ₹2,000. The restored row still carries `ra_journal_id` of a deleted
  journal.
- **Same class, by reading the code:**
  - a GV breakage journal restored after "Undo breakage" (the vouchers no longer carry `breakage_voucher_id`);
  - a Rule 42 journal restored after "Undo" (the run row is gone, so 4(B)(1) counts it and a re-post doubles it).
- **Cause:** `putBack` writes the row through the table's save path (roles, lock, number), but module state that lives
  in other tables is never checked:
  - the voucher balance;
  - `settlements.posted`;
  - `ra_journal_id`;
  - `breakage_voucher_id`;
  - `common_credit_runs`.
- **File:** `src/lib/trust/recycle-bin.ts` (`planRestore` / `putBack` / `restoreEntry`).
  - Refuse a single-row restore of module-owned rows, and say where to redo the action:
    - vouchers whose `voucher_class` is "Marketplace settlement", "RA deduction", "Gift voucher breakage",
      "ITC reversal — Rule 42 / 43", "Security deposit" or "Gift voucher sale";
    - receipts carrying `ra_journal_id` / `deposit_adjustment_id` or method "Marketplace settlement".
  - For a `gift_voucher_id` receipt, re-run `liveRedeemIssue` (read-only import from `gift-voucher-core.ts`) before
    restoring it.
  - `UndoDeleted.tsx` uses the same path.
- **Shot:** n/a (data layer). Probe outputs: `probes/p1-retail.out`, `probes/p4-market.out`, `probes/p3-nocash.out`.

### F2 — P0 — Summary import, then per-order import of the same file, doubles the sales
- **Repro (`probes/p4-market.test.ts` "MP-1"):**
  1. Receivables → Marketplace → Import the Amazon MTR fixture with "Summary mode" on. This makes 4 documents, with
     sales taxable ₹2,400.
  2. Import the same file again without summary mode.
- **Expected:** Every order is reported "already imported", as a same-mode re-import does (`MP-2` is fine: per order,
  then summary → already 4).
- **Actual:**
  - `already 2`, and 2 B2C invoices are planned and saved again.
  - Sales taxable is ₹3,800, and GSTR-1 B2CS counts the orders twice.
  - The B2B invoice and the credit note are caught only because their numbers clash.
- **Cause:** A summary document is keyed `channel_order_id = SUMMARY:<date>:<pos>:<rate>` and gets its own number
  (`…/SUM/…`). The per-order plan looks up `docKey(channel, <real order id>, …)` and the file's own invoice number, so
  it finds neither.
- **File:** `src/lib/marketplace/sales-import.ts:276-284` and `:309-317`.
  - Index the order ids of stored summary documents as already imported (keep them on the record, e.g. an additive
    `channel_order_ids`, or parse them back from the summary).
  - Refuse an order that a live summary document already covers.
- **Shot:** n/a. Probe output: `probes/p4-market.out`.

### F3 — P0 — Deposit adjustment over-settles a bill that has a credit note
- **Repro (`probes/p7-r5c.test.ts` "DP-1"):**
  1. Rent invoice of ₹10,000.
  2. Credit note for 40% (₹4,000). The due is ₹6,000.
  3. Recurring → Leases → Deposits: a ₹20,000 deposit received.
  4. "Adjust against invoice" of ₹10,000.
- **Expected:** Refused above ₹6,000 (the due net of credit notes, as `settlement.ts` `dueOn` / `amount-due.ts` work
  since QA5 F2).
- **Actual:**
  - ₹10,000 is accepted. The bill is settled with ₹4,000 to spare, and the tenant is ₹4,000 in credit.
  - The deposit register shows ₹4,000 less held than the tenant actually left with you.
  - The adjustment journal debits "Security deposits received" by ₹10,000.
- **File:**
  - `src/lib/property/deposits.ts:128` (`adjustAgainstInvoice` uses `receivableBalance(inv)`): use
    `amountDue(inv, linkedCredits(…))`.
  - `:159` (`applyToCharge`, same helper; harmless today because the invoice is new).
  - `src/components/property/DepositsPanel.tsx:30` (the "open invoices" pick list uses the same balance).
- **Shot:** n/a. Probe output: `probes/p7-r5c.out`.

### F4 — P0 — No-cash receipt rows still read as bank money
The rule in AGENTS.md is that every cash / bank reader skips `gift_voucher_id`, `deposit_adjustment_id` and
`ra_journal_id`. Every reader of `transactions` was checked, and these are the misses.
- **Repro (`probes/p1-retail.test.ts` "GV-4", `probes/p3-nocash.test.ts` "NC-1"):** One invoice paid ₹1,000 with a
  gift voucher, plus an RA bill with GST TDS / cess rows and a deposit adjustment.

| Reader | Actual | File |
|---|---|---|
| Today card (Dashboard / invoicing UX) | GV redemption counted as "Bank ₹1,000" received today | `src/lib/today.ts:46` (skips deposit / RA, not `gift_voucher_id`) |
| BRS candidates | "Gift voucher ₹1,000" offered to match a bank statement line | `src/lib/bank-recon.ts:660` |
| Reports → Payment modes | A "Gift voucher" row (100% of receipts) | `src/lib/sales-reports.ts:638` |
| Tally XML receipts | GV redemption exported as Dr **Bank Account** / Cr party. Tally's bank is overstated and the GV liability is never reduced | `src/lib/tally-xml.ts:530-545` (Dr the GV liability ledger, as `ledger/postings.ts:302` does) |
| Receipts CSV (Zoho / generic import) | GV, "Security deposit adjustment", "GST TDS (Sec 51)" and "Labour cess deducted" rows all "Deposit To: **Bank**" | `src/lib/accounting-export.ts:305-318` |
| Cash-forecast collection lag | Deduction / GV / deposit rows counted as collections (5 receipts for one bill) | `src/lib/cash-forecast.ts:141` |

- **Expected:** These readers skip the three markers. The Tally / CSV exports either post them to their own ledgers or
  leave them out with a note.
- **Shot:** n/a. Probe outputs: `probes/p1-retail.out`, `probes/p3-nocash.out` (Tally narrations and the CSV rows are
  printed there).

### F5 — P1 — Money moved by a manual voucher is missing from the cash / bank book and the BRS
- **Repro (`probes/p3-nocash.test.ts` "NC-1"):**
  1. Sell a ₹500 gift voucher for cash.
  2. Record a ₹2,000 donation in cash.
  3. Record a ₹3,000 security deposit received by bank.
  4. Open Books → Cash & bank (or the cash tally, the Today card, the dashboard cash / bank tile, Reconcile).
- **Expected:** Cash ₹2,500. Bank includes the ₹3,000. The marketplace settlement's payout contra (Dr bank / Cr
  clearing) can be matched to the bank statement line it creates.
- **Actual:**
  - The simple cash book shows cash **₹0** and bank ₹1,08,000 (the deposit is missing). The ledger has them, with
    cash ₹2,500 in the trial balance.
  - The day-end cash tally therefore reports every GV / donation cash sale as "excess".
  - Reconcile's book balance leaves out every payout, and the BRS has no candidate for it. The marketplace seller's
    main bank inflow cannot be reconciled.
- **Cause:** `books.ts` `buildVouchers` reads documents, receipts, bills and advances only, not `vouchers`. R4-B / R5
  are the first features whose main money movement is a manual voucher:
  - GV sale / refund;
  - donation receipts;
  - deposit receive / pay / refund;
  - settlement payout contra;
  - trip driver advances.
- **File:**
  - `src/lib/books.ts:459` (`buildVouchers`): add the cash / bank lines of `loadVouchers()` (class-tagged, so they are
    not double counted with allocated receipts).
  - `src/lib/bank-recon.ts` (`receiptCandidates` / payment candidates): offer voucher bank lines.
  - Readers: `TodayPanel.tsx:23`, `dashboard-tiles.ts:128`, `cash-forecast.ts:382`, `Reconcile.tsx:184-192`,
    `BankingDocs.tsx:442` (cash tally).
- **Shot:** n/a. Probe output: `probes/p3-nocash.out`.

### F6 — P1 — Export compliance skips "Tax Invoice" documents
- **Repro (`probes/p6-roundtrip.test.ts` "EX-1"):** An issued export under LUT (`supply_type: EXPORT_LUT`, USD, shipping
  bill 123), with no LUT number, saved as type **Tax Invoice**. The sample company's documents are all Tax Invoice
  (`shots/s4-after-reload.png`).
- **Expected:** GST reports → filing check shows LUT_MISSING. The export desk lists it for realisation (15-month
  clock, IRM matching, e-BRC).
- **Actual:**
  - 0 LUT findings (1 when the same record is type `INVOICE`).
  - 0 realisation rows (1 as `INVOICE`).
  - The bell's overdue-realisation notice, the IRM suggestions and "unrealised as at 31 March" miss it too.
- **File:**
  - `src/lib/trade/lut-register.ts:105`: allow `TAX_INVOICE`.
  - `src/lib/trade/export-register.ts:85` (`live`: `INVOICE` only): allow `TAX_INVOICE`.
- **Shot:** n/a. Probe output: `probes/p6-roundtrip.out`.

### F7 — P1 — GTA freight bill uses the wrong place of supply for an unregistered payer
- **Repro (`probes/p5-transport.test.ts` "TP-1"):**
  1. GTA in Maharashtra, option `fcm_5`.
  2. LR Pune (27) → Surat (24), to-be-billed to an **unregistered** party whose state is Gujarat.
  3. Create the freight bill.
- **Expected:** Sec 12(8)(b) IGST Act: for a recipient who is not registered, the place of supply is where the goods
  are handed over for transport (Pune, 27), so CGST + SGST.
- **Actual:** PoS 24, IGST ₹400, CGST 0. GSTR-1 B2CS reports an inter-state supply to Gujarat.
- **File:** `src/lib/transport/freight-bill.ts:113`
  (`pos = (registered ? gstin : ctx.party.state_code) || lrs[0].from.state || home`).
  - For an unregistered payer, use `lrs[0].from.state` first.
  - Bills that mix LRs from different origin states need one bill per origin state (`groupForBills`).
- **Shot:** n/a. Probe output: `probes/p5-transport.out`.

### F8 — P1 — The Rule 42 / 43 annual true-up is dated in the closed year
- **Repro (`probes/p8-cc.test.ts`, mirroring `CommonCreditView.tsx:74`):**
  1. In September 2026, with books locked to 30 June 2026, open GST → Common credit → Annual for FY 2025-26.
  2. Post the true-up.
- **Expected:**
  - The difference is reversed (or reclaimed) in a return up to September following the FY (Rule 42(2) / 43). The
    screen shows that due date (`trueUp().dueBy`).
  - The journal is dated in the month it is filed, so it shows in that month's GSTR-3B 4(B)(1).
- **Actual:**
  - The journal is dated `${fy + 1}-03-31` and refused: "Books are locked up to 30 Jun 2026. JV/FY25-26/0001 is dated
    31 Mar 2026".
  - Without a lock, the reversal lands in the **March** 3B 4(B)(1), a return already filed in April.
- **File:**
  - `src/components/institutions/CommonCreditView.tsx:74`: post on a user-chosen day, default today and capped at
    `dueBy`.
  - `src/lib/institutions/common-credit.ts` (`postReversal`): the `annual` kind keeps `month: FY…` but takes that date.
- **Shot:** n/a. Probe output: `probes/p8-cc.out`.

### F9 — P2 — A later receipt takes the batch that was reported short
- **Repro (`probes/p2-transfer.test.ts` "TR-1"):**
  1. Batches A (5, earlier expiry) and B (5). Request 10, and dispatch 10 (A 5 + B 5).
  2. Receive 3 + short 2. The exception is "A 2".
  3. Receive the other 5.
- **Expected:** The second receipt takes B 5. A 2 stays in transit under the exception.
- **Actual:** The receipt lines are `A 2, B 3`. Transit holds B 2 while the exception still names A 2. A write-off
  then falls back to B, and batch traceability / FEFO at the store is wrong.
- **File:** `src/lib/retail/transfer-requests.ts:199-223` (`transitLines`) and `:475` (`receive`). Skip the quantities
  held by open / claimed exceptions per batch, not only in total (`unaccounted`).
- **Shot:** n/a. Probe output: `probes/p2-transfer.out`.

### F10 — P2 — Breakage journal can be dated before expiry
- **Repro (`p1-retail` "GV-3"):** Voucher sold 10 May, expiring 30 June. "Recognise unredeemed balance" as at 15 July,
  with journal date 1 May.
- **Actual:** Accepted (`JV/FY26-27/0001`, ₹800). The liability goes to a debit balance for May and June, and income
  is booked before the sale.
- **Expected:** Refused when the journal date is before `asOf`, or before any voucher's `expires_on`.
- **File:** `src/lib/retail/gift-vouchers.ts:216` (`recogniseBreakage`).
- **Shot:** n/a.

### F11 — P2 — A redemption removed after breakage strands the liability
- **Repro (`p1-retail` "GV-5"):**
  1. A ₹1,000 voucher with ₹400 redeemed.
  2. Breakage of ₹600 recognised.
  3. Remove the ₹400 receipt.
- **Actual:**
  - "Gift vouchers outstanding" keeps ₹400 credit forever. The voucher is "expired" with balance ₹400, and
    `breakageDue` skips it because it already has a breakage journal.
  - The register's totals say balance 0 while the voucher says 400.
- **Expected:** Removing a redemption of a voucher already recognised is refused ("Undo the breakage first"), as cancel
  is.
- **File:** `src/lib/localDb.ts` `payments.remove` (or a guard in `gift-vouchers.ts` called from `PaymentModal`). Check
  `breakage_voucher_id` of the row's `gift_voucher_id`.
- **Shot:** n/a.

### F12 — P2 — A second promotional voucher on a POS bill is ignored
- **Repro (static):** POS → Gift voucher tender. Apply promo voucher P1 (₹100), then promo voucher P2 (₹50).
- **Actual:**
  - Both are listed as applied, but `promoV = gvApplied.find((a) => a.promo)` applies only P1.
  - Only P1 is noted on save (`input.promoVoucher`).
  - The cashier believes ₹150 was taken off.
- **Expected:** A second promo is refused ("one promotional voucher per bill"), or both apply.
- **File:** `src/components/retail/GiftVoucherTender.tsx:31-40` (refuse a second promo) and `src/pages/Pos.tsx:240`.
- **Shot:** n/a.

### F13 — P2 — Nil-rated and exempt fee heads are merged as exempt
- **Repro (`probes/p7-r5c.test.ts` "FE-1"):** A plan with "Consultation" (exempt, ₹1,000) and a nil-rated head (₹500).
  Run a billing run.
- **Actual:** One Bill of Supply of ₹1,500 with `exempt_kind: EXEMPT`. GSTR-1 Table 8 shows ₹1,500 exempt and ₹0 nil.
- **Expected:** Two Bills of Supply (or the nil head reported as nil). The batch builder already makes one document per
  kind.
- **File:** `src/lib/institutions/fee-plans.ts:126` (`splitByTax`) and `src/lib/institutions/fee-billing.ts:71-72` (one
  BOS per class).
- **Shot:** n/a.

### F14 — P2 — Freight bill under a changed GTA option prints a contradiction
- **Repro (`p5-transport` "TP-2"):** An LR dated 25 Mar 2027 to a registered party (option RCM → liable: recipient).
  Then FY 27-28 option `fcm_18`. Freight bill dated 5 Apr 2027.
- **Actual:** A 5% RCM bill whose notes say "GST payable by: Recipient … (reverse charge)" and "GTA option FY 27-28:
  forward charge — 18% with ITC, paid by the GTA".
- **Expected:** The liable person is decided for the bill date (the option for that FY), or the bill is refused with
  "re-save the LR".
- **File:** `src/lib/transport/freight-bill.ts:90-95` (re-derive `liable` with `liablePerson(optionFor(ctx.date), …)`
  unless the LR has an override).
- **Shot:** n/a.

### F15 — P2 — Export register ignores credit notes
- **Repro (static):** USD 1,000 export, then a credit note of USD 200 linked through `doc_links`. USD 800 received.
- **Actual:** `fcy` = invoice total 1,000. Outstanding is USD 200, and after 15 months the bill is "overdue" (Rule 96A
  note).
- **Expected:** The realisable value is the total less live credit notes.
- **File:** `src/lib/trade/export-register.ts:118` (`fcy`): net `linkedCredits`.
- **Shot:** n/a.

### F16 — P2 — A pending delete is lost on reload
- **Repro (`s4-undo-reload.mjs`):**
  1. Invoices → Delete DEMO/FY26-27/0025 → Delete. The "Deleted · Undo" toast is shown.
  2. Reload the tab without touching the toast.
- **Actual:** The invoice is back in the list (`shots/s4-after-reload.png`). It was never removed. The delete is
  committed only when the toast is dismissed or the page unmounts, and a reload, tab close or crash does neither.
  Until then it is also still counted in every report.
- **Expected:** Commit on `pagehide` / `visibilitychange` as well, or show it as "pending" in the list.
- **File:** `src/pages/Transactions.tsx:309-312`.
- **Shot:** `shots/s4-after-delete.png`, `shots/s4-after-reload.png`.

### F17 — P2 — A clerk can restore an owner-deleted issued invoice
- **Repro (`p6-roundtrip` "RB-1"):** The owner deletes an issued invoice. As a clerk, call `restoreEntry(<bin id>)`.
- **Actual:** Accepted. The UI hides other users' entries (`visibleEntries`), but the data layer does not check
  `deleted_by`. A viewer is refused.
- **Expected:** Restoring someone else's entry needs `data.erase` (owner), as the listing implies.
- **File:** `src/lib/trust/recycle-bin.ts` (`restoreEntry`: `requireAccess('data.erase')` when
  `e.deleted_by !== currentActor()?.name`).
- **Shot:** n/a.

### F18 — P2 — The deposits panel reads all invoices on every render
- **Repro (static):** Recurring → Leases → Deposits → pick a deposit → Adjust, then type in the amount.
- **Actual:** `localDb.invoices.getAll()` (a full clone of every invoice) runs on each keystroke. At the PERF-1 scale
  of 15,000 invoices this is the per-keystroke full read PERF-2 removed elsewhere.
- **File:** `src/components/property/DepositsPanel.tsx:30` (`useMemo` on `sel?.d.party_id`, `peekTable`).
- **Shot:** n/a.

### Also noted (not counted as findings)
- **Duplicate labels.** Recurring → Leases shows the sub-view "Leases" under the tab "Leases", and Books → Funds shows
  "Funds | Funds" (`tour-desk.log`). The labels are the same, not broken.
- **Settlement refunds.** A refund paid in a later settlement than its sale is documented as a known limit
  (`marketplace-r5.md`) and was not re-reported.
- **GV-paid bills that are cancelled.** A cancelled bill that was paid with a gift voucher keeps the redemption, as a
  cash receipt on a cancelled bill does. The value is the party's credit, not the voucher's.
- **Clerk rights.** A clerk can post / unpost a settlement and dispatch / receive transfers (`books.edit`). This is
  consistent with the access matrix and reported only for awareness.
- **Other `buildGstReport` callers.** GSTR-9, compliance and the report pack do not pass `itcReversals` yet. This is
  documented in `institutions-property-r5.md`.

---

## 3. Fix packages

The two packages touch disjoint files.
- **QA6-1** owns the cross-cutting money readers and the recycle bin: the trust module, the cash / bank book, the
  bank reconciliation and the accounting exports.
- **QA6-2** owns the feature modules: marketplace import, deposits, export desk / LUT, transport, common credit,
  transfers, gift vouchers, POS and fees.

### QA6-1 — recycle bin, no-cash readers, cash / bank book and exports
| Finding | Files |
|---|---|
| F1 bin restore ignores module state (P0) | `src/lib/trust/recycle-bin.ts` (read-only import of `retail/gift-voucher-core.ts`), `src/components/trust/UndoDeleted.tsx`, `src/components/trust/RecycleBinPanel.tsx` (refusal text) |
| F4 no-cash rows read as bank money (P0) | `src/lib/today.ts`, `src/lib/bank-recon.ts`, `src/lib/sales-reports.ts`, `src/lib/tally-xml.ts`, `src/lib/accounting-export.ts`, `src/lib/cash-forecast.ts` |
| F5 manual-voucher money missing from the cash / bank book and BRS (P1) | `src/lib/books.ts` (`buildVouchers`), `src/lib/bank-recon.ts` (candidates), `src/pages/Reconcile.tsx`, `src/components/invoicing-ux/TodayPanel.tsx`, `src/lib/dashboard-tiles.ts`, `src/components/bank/docs/BankingDocs.tsx` |
| F11 redemption removed after breakage | `src/lib/localDb.ts` (`payments.remove` guard, reading `gift-voucher-core.ts`) |
| F16 pending delete lost on reload | `src/pages/Transactions.tsx` |
| F17 clerk restores the owner's entry | `src/lib/trust/recycle-bin.ts` |

Tests to add:
- **Restores that must be refused:**
  - a GV receipt whose voucher was spent since;
  - a settlement journal;
  - an RA deduction receipt without its journal.
- **Readers that must skip the three markers:** Today, BRS candidates, payment modes, Tally receipts and the receipts
  CSV. Extend the R5-C6 regression in `tests/works-deductions.test.ts` with a GV row.
- **Cash book and BRS:** the cash book includes a GV cash sale and a deposit received by bank, and the BRS offers a
  settlement payout.

### QA6-2 — marketplace, deposits, export desk, transport, common credit, transfers, gift vouchers, fees
| Finding | Files |
|---|---|
| F2 summary → per-order re-import (P0) | `src/lib/marketplace/sales-import.ts` |
| F3 deposit adjustment vs credit notes (P0) | `src/lib/property/deposits.ts`, `src/components/property/DepositsPanel.tsx` |
| F6 Tax Invoice exports skipped (P1) | `src/lib/trade/lut-register.ts`, `src/lib/trade/export-register.ts` |
| F7 freight PoS for unregistered payers (P1) | `src/lib/transport/freight-bill.ts` |
| F8 annual true-up date (P1) | `src/lib/institutions/common-credit.ts`, `src/components/institutions/CommonCreditView.tsx` |
| F9 transit batch picked from the shortage | `src/lib/retail/transfer-requests.ts` |
| F10 breakage dating | `src/lib/retail/gift-vouchers.ts` |
| F12 second promo voucher | `src/components/retail/GiftVoucherTender.tsx`, `src/pages/Pos.tsx` |
| F13 nil + exempt fee heads | `src/lib/institutions/fee-plans.ts`, `src/lib/institutions/fee-billing.ts` |
| F14 GTA option change | `src/lib/transport/freight-bill.ts` |
| F15 export register and credit notes | `src/lib/trade/export-register.ts` |
| F18 deposits panel per-render read | `src/components/property/DepositsPanel.tsx` |

Tests to add:
- **Marketplace:** summary import, then per order, imports nothing new (and the reverse).
- **Deposits:** adjustment capped at the due net of credit notes.
- **Export desk:** a `TAX_INVOICE` export shows LUT_MISSING and a realisation row, and a credit note reduces its
  realisable value.
- **Transport:** an unregistered payer's freight bill takes the origin state.
- **Common credit:** the annual true-up posts on the chosen day inside an open period.
- **Transfers:** a second receipt does not take the short batch.
- **Gift vouchers:** breakage before expiry is refused.
- **Fees:** a nil + exempt plan gives two Bills of Supply.

There is no shared file. `src/lib/localDb.ts`, `src/lib/books.ts` and `src/lib/bank-recon.ts` are QA6-1 only.
`src/lib/retail/gift-vouchers.ts` and `src/components/property/DepositsPanel.tsx` are QA6-2 only.
`gift-voucher-core.ts` is read, not edited, by QA6-1.
