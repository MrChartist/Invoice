# QA round 23: the PENDING-item work of PRs #94–#112

Status: findings fixed in the same loop, each with a regression test that fails on the baseline source:
`tests/qa23-pending.test.ts` (W1–W6, six tests; all six fail on `d60856d`'s `src/`). Baseline: branch
`claude/elegant-cannon-cwapiv` at `d60856d`, re-merged at `91c4ebc` (#113, R20-A) before the final checks. Round 19
logistics (#95, #97, #99, #101) is out of scope (QA22).

Method: each merge's diff (`git diff <merge>^1 <merge>`) read against its PENDING row, then the money paths walked at the
data layer with `tests/helpers/world.ts` / `r5c.ts`: the editor's client pick (`clientToParty` → store snapshot →
`gst-reports` / `offers`), loans → prepayment → `emiSchedule` vs the forecast's copy, purchase bill ↔ goods notes
(single and multi-bill) ↔ recycle bin, donations by mode, cheques in foreign currency, the 3B 3.2 split, GSTR-1A JSON,
IRN-cancel import, EEFC supplier payments and revaluation reversal, combo offers, per-voucher rights, TCS presets / RPU
codes, recurring instalments, Form 16 / 24Q perquisites and 201(1A), serial counts and cost-centre stock. Data safety:
new writers against `getTable` rows (#103 deep-freeze), society import / delete / attachments (#94 / #96), recycle-bin
hooks and registry imports, `movedNoCash` / `readPurchase` in new readers. Hindi strings, help topics, Ctrl+K, CSV
neutralisation (`toCsv`) and `escHtml` in new exports and prints.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | PR | Area | Finding | Fix | Test |
|---|---|---|---|---|---|---|
| W1 | P2 | #100 × #106 | Cash forecast × loan prepayment | `forecastEmis` (the forecast's copy of `emiSchedule`, kept apart for the chunk graph) ignored PENDING 52's re-scheduling prepayments, and `loanCommitments` ignored `closed`. Loans → Prepay (default "shorter tenure") left the forecast showing the old EMIs past the new end date; "lower EMI" kept the old amount; a loan closed by prepayment still showed every remaining EMI as an outflow | `forecastEmis` applies `n = 0` + `reschedule` prepayments exactly as `emiSchedule` (same opening cut, same EMI re-computation); closed loans give no commitments | W1 |
| W2 | P1 | #104 | GSTR-3B 3.2 × client snapshot | `Client.gst_reg_type` (composition / UIN) is read from the **document's** client snapshot, but the editor copies a picked client through `clientToParty`, which did not carry it. Every invoice made in the editor lost the kind: 3.2 `comp_details` / `uin_details` stayed empty (composition supplies were silently dropped from 3.2), and a UIN client's invoice was flagged `GSTIN_INVALID` and reported as B2C | `clientToParty` copies `gst_reg_type` (always set, so picking a regular client clears the previous one's kind). Existing invoices keep their snapshot (Critical Rule 3): re-pick the client on a document to take the kind | W2 |
| W3 | P1 | #106 | Per-customer offers × editor | `bestBillOffer` matched `Scheme.client_ids` on `rec.client.id`, but the editor's client copy carries no id (`clientToParty`; credit check, receivables etc. match by id **or name**). A customer-only offer never applied to an editor bill, for any customer; POS (full client) was right. The offer effect also did not re-run when the client changed | `applyBillOffer(…, { clients })` / `bestBillOffer(…, clients)` resolve a snapshot without an id by name (`customerId`, as `masterFor`); `EditorExtras` passes the masters (only when a scheme has `client_ids`) and re-applies on a client change | W3 |
| W4 | P2 | #100 | Gift-in-kind journal | The goods-ledger picker offered **cash / bank and debtor ledgers** (only liability / income groups were filtered), so a gift in kind could be journalised Dr Cash — the cash book and BRS then show money that never came in. Library: correcting a kind receipt to "no ledger" kept its old journal (reused id, nothing re-saved) — not reachable from the form today (no edit screen), fixed with it | `KIND_EXCLUDED_GROUPS` (+ `CASH_BANK`, `TRADE_RECEIVABLES`) shared by the form and `saveDonation` (refused with "Check the values entered."); a kind receipt that no longer posts deletes its old voucher | W4 |
| W5 | P1 | #100 × #104 | Return-qty guard × multi-bill debit note | `returnedQtyIssue` collected **every** line of a multi-bill goods note (PENDING 47, `bill_refs`) for each bill, then looked for the other bills' lines on this bill (not found → "already returned … cannot show 0"). Expiry ops → "one note per supplier" → any later edit of one of those bills (even a bill number) was refused | Only the note's lines naming this bill (`line.purchase_id`) count on a multi-bill note | W5 |
| W6 | P2 | #100 | Return-qty guard × recycle bin | The PENDING 38 guard runs on bill save only. Delete a goods debit note (to the bin) → edit the bill below the returned units (allowed: no note now) → restore the note: it came back returning 4 of a 2-unit bill (stock, ITC reversal and `returnableLines` off), also onto a bill that was deleted | `purchase_returns` restore hook: a goods note comes back only while each of its bills (`purchase_id` or `bill_refs`) is live and `returnedQtyIssue` passes with the live notes | W6 |

No defect sat in an excluded file (keyboard, report toolbar / drill, `CommandPalette` / `search.ts`, `VoucherEntry` /
`InvoiceCreator`, `SetupWizard`, `Transactions` / `Clients` lists, `vite.config.ts`, `scripts/`).

## 2. Paths walked and found right

- **#100** PENDING 27 `settlementRefunds` / `nettedRefundLines` — one rule shared by posting and Receivables (bill
  allocation, khata input, shared input); only posted settlements, only refund lines not netted in their own sale's
  settlement. PENDING 28 `nextRaNo` over live + cancelled RA bills + measurement rows; the RA restore hook's `>=`. PENDING
  34 ageing slabs / basis (device-local, `normalizeAgeing`), CSV labels and interest column. PENDING 36 shared period
  (`setPeriodRange` keeps rolling presets; GST reports take it only for a month / quarter). PENDING 37 TB / balance-sheet
  comparatives (previous-only ledgers included at zero). PENDING 38 guard on `purchasesDb.save` (paid + free units).
  PENDING 39 FX cheques: `chequeReceiptFor` books the invoice-currency amount at the realised rate so the bank gets the
  cheque's rupees and the difference goes to FX gain / loss; balance checks in the invoice currency; forecast credit
  notes (linked off the bill, unlinked off the party's first parts), GST (20th, credit notes negative, FCN skipped,
  RCM in cash) / TDS (7th) from `readPurchase`, salaries from the last final run (deposits once per month).
- **#104** 3.2 split by POS for composition / UIN (registered only); GSTR-1A JSON = added / changed docs whole + B2CS
  differences, turnover fields dropped, `verified: false`; IRN cancel matched by the recorded IRN only (never by number),
  local day, meta written only when something changed; Table 14A(b) / 8 / 12 / 13 amendment effects sign-aware;
  `createMulti` checks each bill like a single note, same supplier / GST type / ITC, no RCM / import / TDS / cess, on
  account (bill balances untouched); `notedValue` / delete guard / stock events per bill line.
- **#106** EEFC supplier payment: `recordSupplierPayment` from the account + a Journal of only the difference
  (sign checked: settle > carrying = gain = Dr bank); delete removes the payment group. Revaluation `reverse_on` posts a
  mirrored journal (`reversalOf`), the FCY statement row and the period's unrealised net of reversals. Combo saving per
  full set after line discounts, free lines out; offers do not stack. Loan prepayment re-schedule in `emiSchedule`,
  `loanStatement` EMI = next unpaid row; interest certificate per Indian FY. Per-voucher / purchase rights:
  `checkDocRight` (owner and POS-only exempt), back-dated window on the voucher date.
- **#109** TCS 2026 presets (`verified: false`), 2025-Act codes only from 2026-04-01, unknown labels keep the stored code,
  unmapped 26Q codes warned; recurring instalments re-dated per run, a payment term's schedule wins (`termFields`).
  Month-end PDF: every CSV cell through `escHtml`.
- **#110** Form 16 1(a) = payslip gross − payslip perquisites, 1(b) = perquisites + the actual 17(2)(vii) excess, 1(d)
  includes it once (`salaryIncome`); 24Q Annexure II same; 12BA working groups typed perquisites by kind with the rest
  as loan perquisite; 201(1A) late deduction FIFO on ₹100-rounded parts.
- **#112** serial count: missing serials leave from the godown each was in, found serials post as one excess, a swap
  moves even when the count nets to nil; `assertSerialCount` checks later needs; cost-centre stock by tagged godown and
  its children, opening on the day before (built from parts, no UTC parse).
- **Data safety.** No new writer assigns into a `getTable` row or its nested values in #104–#112 (scan of added lines;
  the new pushes are on own objects). #94 unit import all-or-nothing in one `withTablesRollback`, new members only,
  `import_runs` row fail-soft; `deleteUnit` refused while billed / run / linked, goes through `setTable` (bin). #96
  `attachmentIdsIn` keeps CN-D2 nested files (also when binned) and the new owner tables `site_compliance` /
  `works_contracts` (top-level `attachments`); binned rows keep theirs through `BinEntry.attachments`. Recycle bin
  imports every registry. New cash readers: the forecast commitments read no receipts; existing ones keep
  `movedNoCash`. New purchase readers (`gstTdsCommitments`, EEFC payment, multi-bill notes) go through `readPurchase` /
  `purchasesDb`.
- **Hindi / help / Ctrl+K.** Every new `defineArea` has a literal Hindi object (build split passes); new tabs / views are
  sub-views of existing tabs (Reports hub "Interest", Loans certificate, Forecast commitments, E-commerce 14A(b),
  GSTR-1A button) covered by their tab's help topic; `help-registry.test.ts` green. New CSVs go through `toCsv`
  (formula neutralisation); new HTML (catalogue currency, month-end PDF, CB register) escapes every value.

## 3. Statutory re-check

| Rule | Read | Outcome |
|---|---|---|
| GSTR-3B 3.2 (composition / UIN rows) | As in #104 | W2 makes the data reach it; no rule row |
| Rule 46 / Sec 15 offers | As in #106 | W3 is matching only |

No rule row was added or flipped.

## 4. Size

Before = `91c4ebc`, after = this branch; `vite build` + `check-bundle-size`.

| Budget | Before | After | Delta |
|---|---|---|---|
| First paint | 177.9 kB | 177.9 kB | 0 |
| Core precache | 3,254.1 kB | 3,254.5 kB | +0.4 kB (offers, cash forecast, donations, recycle-bin hook) |

## 5. Deferred

- **Restored debit note with an adjustment**: `purchaseReturnsDb.remove` takes `adjusted_amount` off the bill's
  `amount_paid`, but restoring the note from the bin does not put it back (pre-dates these PRs; W6 covers only the
  quantity side). Needs a restore side effect in `recycle-bin.ts`; left for a data-layer round.
- **Amount-based recurring instalments** (#109): a template made from an invoice whose schedule is in rupees keeps the
  rupees; a lease schedule whose rent escalates then has instalments that no longer add up to the bill (percent
  schedules are fine). Converting to percents at template time changes stored templates — left as a note.
- **Existing invoices without `gst_reg_type`** (W2): documents issued since #104 keep their snapshot; re-picking the
  client on each (or a one-off fill from the master) is the user's call — not done silently (Critical Rule 3).
- **Interest certificate CSV** labels the disbursed amount "Date" (`loansT('date')`): cosmetic.
- **Per-voucher rights on system vouchers** (#106): a clerk denied voucher create is also refused flows that post a
  voucher as a side effect (donation receipt, loan EMI, forex entry). Consistent with "books.edit"; noted for the owner.

## 6. CA questions

No new ids.
