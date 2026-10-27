# QA round 14: whole-app regression pass — the core paths of a plain company, and pack leaks (Rounds 7–12)

Status: findings fixed in the same loop, each with a regression test in `tests/qa14-core.test.ts`. Baseline: branch
`claude/elegant-cannon-cwapiv` at `d4bf52b` (Rounds 7–12 and the QA13 follow-ups merged), re-merged at `bcdddc8` before
the report. The whole suite and the Playwright smoke passed on the baseline (3,282 / 3,282; 514 PASS lines).

Method:
- **A plain company in the browser** (Playwright against `dist/`, scratch probes not committed): first-run wizard with
  "Services / freelancer" (no industry pack, shop-mode modules), then
  - one plain tax invoice per template (all **26**) opened in "Preview & download PDF": every paper prints the amount in
    words and **no pack block** (RA bill / works header, agri particulars or statement, UHID / doctor line, BIS line,
    exchange line, cash-discount line, Rule 46A title, hotel folio text) — checked by text on each preview;
  - the core routes (`/`, `/invoice`, `/transactions`, `/clients`, `/receivables`, `/expenses`, `/books`, `/gst`,
    `/inventory`, `/settings`, `/exports`, `/recurring`) in **Hindi**: the only English left is data (state names, template
    names, the default terms) and Tally's own menu names on the Exports page;
  - the same routes at **375 px**: no horizontal page scroll; no page error or CSP violation anywhere.
- **Real flows at the data layer** (the repo's harness, `tests/helpers/world.ts`): every `RECORD_KEYS` field through
  `normalizeRecord`; every `InvoiceItem` field (all declaration merges, read with the TypeScript checker) against
  `normalizeItem`; backup → wipe → restore of every record table; the seven demo datasets (counter, retail packs, services
  packs, trading, transport, works, agri) → backup → validate → wipe → restore; the recycle bin with ordinary vouchers.
- **Large data**: 5,000 invoices + 5,000 bills in storage — double-entry ledger 343 ms, trial balance 13 ms, P&L 10 ms,
  balance sheet 26 ms (difference 0), GST exceptions 44 ms, GSTR-1 / 3B (FY) 248 ms, stock positions 49 ms; no table read
  inside a per-row loop in the core libraries.
- **Static review** for the regressions the brief lists: pack hooks on core paths (editor line parts, POS strips, bell
  providers, GST exception checks, stock gates, `voidHook`), `normalizeRecord` keys, `movedNoCash` readers, purchase
  readers, `lineFactor` readers, restore hooks, bell / Compliance cards; UTC-day (`toISOString().slice(0, 10)`) and
  `new Date(bareDate)` uses.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated invariant is broken, or a tax document / return figure comes out wrong.
- **P2:** friction, a working-paper figure is off, or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| Q1 | P1 | Branch transfer (Sec 25(4)) | A stock transfer line typed in an **alternate unit** (10 BOX of 12) raised its tax invoice and the receiving branch's bill as **10 NOS at the per-piece cost** the dialog suggests: taxable value and GST 12× too low, and the quantity wrong on the tax invoice, GSTR-1 HSN and the bill | `transferBaseQty` — quantity in the item's base unit (`qty × unit_factor`), the rate stays per base unit; the dialog shows the base quantity and unit | `Q1` |
| Q2 | P1 | Recycle bin | A **hand-entered journal** whose free-text voucher class matched a module's ("Loan", "Donation", "Deferral", "Brokerage", "Trade claim" …) could not be restored ("was undone where it was posted … post it twice") in a company that never used that module | The module guard applies only when one of the owning tables is in use (a row live or in the bin); otherwise the voucher restores like any other. A company using the module keeps the guard | `Q2` |
| Q3 | P2 | Tally XML | Stock transfers went to Tally's **Stock Journal** in the typed quantity labelled with the item's base unit (5 BOX → "5 NOS") — a `lineFactor` miss | Quantity × the line's unit factor (base unit, as the label says) | `Q3` |
| Q4 | P2 | Amount in words | From **₹10,000 crore** the English words read "Rupees undefined Hundred Crore"; ₹1,200 crore read "Twelve Hundred Crore" while the Hindi line read "एक हज़ार दो सौ करोड़" | The crore (and billion) part is spelt with the same Indian (international) system recursively: "One Lakh Crore", "One Thousand Two Hundred Crore" | `Q4` |
| Q5 | P2 | e-Invoice cancel register | An IRN / e-Way cancel marked done between 00:00 and 05:30 IST was dated the **previous day** (UTC day) | `localDayOf(now)` | `Q5` |
| Q6 | P2 | Paper / live preview | The R9 exchange line (`exchangeText`) **copied the whole receipts table** on every render of every paper — each keystroke of the live preview, each page of a batch print — in every company | `peekTable` (shared read-only rows) | `Q6` (static guard) |

### What was verified and is correct

- **Numbering and dates.** `INV/FY26-27/0001` on the first save (smoke and `qa14` round trip); the FY turns on 1 April
  in every zone of `ZONES`, recurring drafts stay unnumbered until issue and deleted numbers stay reserved (existing
  `localDb`, recurring and recycle-bin suites, green). No core module parses a bare date with
  `new Date(str)`; the remaining UTC-day uses are UTC-anchored arithmetic (`Date.UTC(...)`) or a test print — except Q5.
- **Record and line keys.** Every `InvoiceRecord` key survives `normalizeRecord` (the compile-time `RECORD_KEYS` check plus
  a value per key); every pack line key of R8–R12 (`disc_chain`, `wt`, `arrival_id`, `band_rate`, `serial_pairs`,
  `margin`, `jw`, `sv`, `ag_class` …) survives `normalizeItem`. The InvoiceItem fields it drops are catalogue-only
  (`mrp_tax_basis`, `label_price`, `gst_band`, `sv_class`, `cn_class`, weights) or R3-A order-line fields (below).
- **Templates.** All 26 print a plain invoice with no pack part; every pack part mounts only on its own snapshot
  (`ag`, `boq_terms.cn` / `ra_no`, `sv.visit`, `jw.bis`, `cash_discount`, exchange rows).
- **Pack hooks with the pack off.** Editor line parts and strips, POS strips, the GST exception checks (`svOn`, agri),
  the R9 `voidHook` (kirana / retail only), the bell providers (pack gates, or a table in use) and the Compliance view
  (FPO calendar behind `isPackOn`) load nothing for a plain company. `agriExpiryGate` / the MRP guard return at once.
- **No-cash rows.** Every receipt reader that works out cash / bank goes through `movedNoCash`; the module markers carry
  their own method strings, so the van / POS `/cash/i` checks never take one for cash.
- **Purchases and stock.** Pack modules that touch `purchases` only write bills; readers go through `readPurchase` /
  `readPurchaseLines`. Stock readers convert with `lineFactor` / `unitFactor` (GSTR-1 HSN converts to the item's base unit);
  the misses were Q1 and Q3.
- **Data safety.** Backup → wipe → restore returns every record table byte for byte (the edit log gains its restore
  marker); the seven demo datasets back up, validate and restore; no restore hook refuses an ordinary row (after Q2).
- **Books and returns at scale.** Trial balance nets to zero and the balance sheet difference is 0 with 5,000 + 5,000
  documents; the cross-module review (`gst-review-cross`) agrees GSTR-1 ↔ 3B ↔ 9 ↔ ledger ↔ Books ↔ receivables ↔ Tally.

### Not changed (noted)

- **Tally XML sales / purchase inventory lines in an alternate unit** go out in the typed unit and quantity (consistent
  per line, the item master takes the first unit seen). When one item is sold in two units, Tally needs the alternate
  unit defined on the item. Converting needs the stock-item index in the Tally builder; left for the Tally import work.
- **R3-A order-line fields on invoices** (`modifier_of`, `note`, `seat`): a restaurant bill opened in the editor and
  saved loses the modifier link of its child lines. The bill prints and totals the same; only the KOT-side grouping is
  lost, and restaurant bills are settled from the table, not the editor.
- **"One Paise" / "एक पैसे"** (singular paisa) and "Zero" for a zero total are kept as printed so far.

---

## 2. Findings

### Q1 — P1 — Branch transfer in an alternate unit billed at a fraction of its value

- **Repro:** two branches with different GSTINs → Inventory → Transfers → 10 BOX (12 per box) of an item costing ₹100 a
  piece → "Raise tax invoice": the invoice shows 10 NOS × ₹100 = ₹1,000 (+ GST) for 120 pieces.
- **Fix:** `branch-transfer.ts` `transferBaseQty(line)` for the invoice and bill lines (amount = base quantity × rate);
  `BranchTransferDialog` shows "120 NOS". The default rate (`defaultTransferRates`: average cost, opening rate, sale rate)
  was always per base unit.

### Q2 — P1 — An ordinary journal refused by the recycle bin

- **Repro:** Books → Vouchers → a journal with class "Loan" → delete → Recycle bin → Restore: refused.
- **Fix:** `trust/recycle-bin.ts` `vouchers` hook: `OWNED_VOUCHERS` applies only while an owner table has a live or binned
  row. QA6 F1 / QA8 T2 / QA13 G2 / G11 behaviour is unchanged where the module is in use (`qa6`, `qa8`, `qa10`–`qa13`
  restore tests pass).

### Q3 — P2 — Tally Stock Journal in the wrong unit

- **Fix:** `tally-books.ts` stock-transfer lines: `qty × unit_factor` (the unit is the item's base unit).

### Q4 — P2 — Amount in words above ₹1,000 crore

- **Fix:** `amount-in-words.ts`: `indianWords(crore) + ' Crore'`, `internationalWords(billion) + ' Billion'`. Amounts
  below ₹1,000 crore read exactly as before.

### Q5 — P2 — Cancel date on the UTC day

- **Fix:** `einvoice-cancel.ts` `withCancel` — `done_on` defaults to the local day.

### Q6 — P2 — Receipts table copied on every paper render

- **Fix:** `paper-helpers.ts` `exchangeText` reads `peekTable('transactions')` (the paper chunk no longer imports
  `getTable`).

---

## 3. Checks and budget

`tsc -b` clean; `eslint .` 0 errors (27 warnings, as before); `node --test` 3,289 / 3,289 (the six Q regressions fail on
`d4bf52b` and pass after the fixes; the round-trip test passes on both); `vite build` + `postbuild` ok; bundle check ok;
Playwright smoke (`E2E_TIMEOUT=60000`) all checks passed. `npm run …` exits 216 in this sandbox, so each command was run
directly.

Budget (vite build, gzip -9, against `d4bf52b`): first paint 189,198 B → 189,182 B (**−16 B**); total JS 3,227,940 B →
3,228,040 B (**+100 B**, all lazy: the bin guard, the transfer quantity, the Tally factor, the e-invoice day). No new
icon names.

## 4. CA questions

None added: Q1 changes only the unit the existing Sec 25(4) valuation is applied in (G48 stands).
