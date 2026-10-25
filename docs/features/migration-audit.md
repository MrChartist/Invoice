# Migration, audit & year-end (WP-7)

Gap ids P0-7, P0-10, P0-12, P1-20, P1-22, P1-23 (edit-log part) and the P2 integrity check from
`docs/GAP_ANALYSIS.md`. Everything is a **working paper — verify with your CA**.

| | |
|---|---|
| Lib | `src/lib/tally-xml-read.ts` (safe XML reading), `src/lib/tally-import.ts` (parse + dry-run plan, pure), `src/lib/tally-import-apply.ts` (writes), `src/lib/audit-edits.ts` (edit log of every books table), `src/lib/audit.ts` / `audit-chain.ts` (archive segments), `src/lib/tally-books.ts` (export of the rest of the books), `src/lib/books-integrity.ts`, `src/lib/year-end.ts` (pure) + `src/lib/year-end-store.ts` |
| UI | `src/components/import/TallyImport.tsx` (lazy modal, separate from the CSV wizard), `src/components/year-end/YearEndWizard.tsx` (lazy modal), `src/components/audit/EditLog.tsx`; `ActivityPanel` / `AuditIntegrity` updated |
| Strings | `src/i18n/areas/migration.ts` (`migT`, English + Hindi). CSV / XML papers stay English |
| Tests | `tests/tally-import.test.ts` (+ fixture `tests/tally-fixture.ts`), `tests/audit-edits.test.ts`, `tests/audit.test.ts` (archive), `tests/tally-books.test.ts`, `tests/year-end.test.ts`, contract row in `tests/purchase-contract.test.ts` |

## 1. Tally import (P0-7)

**Reading (untrusted input).** `decodeTallyBytes` handles Tally's UTF-16 exports (BOM or not) and UTF-8.
`sanitizeTallyXml` caps the text (64 M characters; the screen refuses files over 128 MB first), **refuses any
DOCTYPE / ENTITY declaration** (no entity expansion or external entity can happen in either parser) and
removes what XML 1.0 forbids — notably Tally's `&#4;` "not applicable" marker, which otherwise makes the
browser's DOMParser reject the whole file. The screen parses with `DOMParser` and falls back to the built-in
`parseXmlLite` (also used by tests); both produce the same `XmlNode` tree. Element count is capped (2 M).

**What is read** (`TALLYMESSAGE` children anywhere under `ENVELOPE`): `GROUP`, `LEDGER` (parent, opening
balance — Tally writes debit as negative —, GSTIN, state, PAN, e-mail, phone, address, PIN, credit period,
alias, bill-wise `BILLALLOCATIONS.LIST` openings), `STOCKITEM` (unit, HSN, IGST rate, opening qty / value),
`UNIT`, `GODOWN`, `VOUCHERTYPE` (custom type → base type) and `VOUCHER` (date, number, narration, party,
reference, cancelled / optional / post-dated flags, ledger entries from `ALLLEDGERENTRIES.LIST` /
`LEDGERENTRIES.LIST` **and** the sales / purchase ledger inside `ALLINVENTORYENTRIES.LIST →
ACCOUNTINGALLOCATIONS.LIST` of invoice-view vouchers, cost-centre allocations). Forex amounts take the rupee
part (`… = ₹ 8200.00`).

**Mapping (dry run, `planTallyImport`, writes nothing).**
- Tally's reserved groups map onto the Schedule III primaries (`TALLY_RESERVED_GROUPS`: Bank Accounts and
  Cash-in-Hand → Cash & bank, Bank OD A/c → short-term borrowings, Direct Incomes → Sales, …); every other
  group becomes a WP-1 user group under its parent (parents first). An existing user group of the same name
  is reused.
- Ledgers under Sundry Debtors become **clients** (matched by GSTIN, else name), under Sundry Creditors
  **vendors**; a sub-group becomes the party's `group_id`. Other ledgers map to an existing chart account
  of the same name / alias, to the default account they stand for (Cash, Output / Input CGST·SGST·IGST·cess,
  TCS, Round off, Sales, Purchases; "Profit & Loss A/c" → Reserves & surplus), else a **new account**
  (code `T0001…`) under the user group or primary. The screen lets the user re-map any non-party ledger to
  an existing account.
- A GSTIN that fails the check digit is reported and the party is saved without it.
- **Opening TB:** Tally's openings as read (Dr / Cr totals). Stock items' opening value goes to
  Stock-in-hand when no Stock-in-Hand ledger carries an opening (Tally's integrated inventory). A difference
  is reported and later shows as "Difference in opening balances" (1090) — never forced.
- **Vouchers** become **manual vouchers only**: Contra / Payment / Receipt keep their type when they pass
  the cash / bank rule, everything else (Sales, Purchase, Journal, Credit / Debit Note) is a journal. They are
  **never invoices or bills**, so nothing imported reaches GSTR-1 / 3B, e-invoice, the invoice list or the
  numbering series. Narration: `Tally <type> #<no> — <reference> — <narration> [tally:<fingerprint>]`;
  `voucher_class` = `Tally import`; cost-centre allocations split the line per centre (centres created).
  Statuses: `ok`, `duplicate` (fingerprint already in the books or twice in the file), `cancelled`,
  `before_books` (dated before the books-beginning date — already inside the openings), `locked` (period
  lock), `error` (unknown ledger, quantity-only stock journal, unbalanced).
- **Fingerprint** = SHA-256 of the Tally GUID, else type + date + number + amount (first 12 hex digits).

**Applying (`applyTallyImport`, owner only — `data.restore`).** The screen first stores the safety snapshot
(`saveSafetySnapshot('import')`, additive reason) so the whole import is undone in one step from the result
screen or Settings → Data. Writes go through the WP-1 / ledger APIs, so each row is validated, lock-checked
and audited: `saveUserGroup`, `saveUserAccount`, `localDb.clients.upsert`, `vendorsDb.save`,
`saveBooksBegin` + `saveOpenings` (openings of two Tally ledgers mapped to one account add up),
`saveOpeningBillsFor`, `godownsDb.save`, `stockDb.saveItem`, `saveCostCentre`, `saveVoucher`. Refusals are
listed and the rest stands; an unexpected throw restores the pre-import copy at once (`restoreBackup`).
Audit rows: "Tally import started / finished / rolled back" (entity `system`, id `tally_import`) plus every
create row of the APIs. Afterwards `openingCheck` compares Tally's opening per ledger with the books
(side by side on screen).

**Re-import** of the same file adds nothing (masters matched by name / GSTIN, vouchers by fingerprint).

Not done: inventory quantities of vouchers (stock journals, item lines), Excel "TB as at 31-Mar" template,
Tally currency / budget / employee masters, payroll vouchers.

## 2. MCA audit trail (P0-10)

**One storage hook.** `storage.ts` gained exactly one observer: `onTableWrite(hook)` — called after a
successful `setTable` with the table name, the raw JSON before the write and the rows written (asset-encoded
rows for snapshot tables). `writeRaw` (restore, sync merges, migrations) does not report. The hook can never
break a save (errors swallowed). `audit.ts` installs `audit-edits.ts`'s observer at load.

**Edit log of every books table** (`WATCHED_TABLES`: receipts, clients, vendors, catalogue, stock items /
moves / transfers, godowns, purchases, supplier payments, POs, purchase returns, receipt notes, supplier
advances, vouchers, accounts, groups, bank accounts, ledger openings, opening bills, books-beginning, cash /
bank opening, fixed assets, cost centres, budgets, cheques, deposit slips, advances, recurring schedules,
bank statements, TDS challans / deductions / return marks, POS day close / returns, document links,
year-end marks). Rows are diffed by `id` into create / alter / delete with field-level before → after:
- when the module logs the change itself (`audit.record` with the row id in the same task), the changes
  are **attached to its row** (no second row) — vouchers, accounts, groups, … now carry full before / after;
- otherwise (purchases, vendors, supplier payments, recurring, importer rows, …) one row per change is
  recorded at the end of the task ("Supplier ACME edited: GSTIN — → 29…");
- a write of more than 40 unlogged rows becomes one summary row per table (counts + first refs);
- privacy as before: contact, bank, notes, serial fields are only flagged "(hidden) → (changed)".
`invoices` stays with `localDb` (full document diff already); `audit_log` and archives are never watched.

**No silent cap loss.** Past 5,000 live rows the oldest 500+ move to an **archive segment**
(`audit_archive_0001`, … one key each, so a write commits only the new segment) and an `archive` anchor row
(`seal: {reason: 'archive', dropped, cut, segment, archived_head}`) is chained into the live log. Segments
are ordinary app keys: in every backup (validated on restore as lists of rows) and the undo copy, never in
folder sync (`isSyncedKey` excludes them, like `audit_log`). `audit.fullRows()` = segments + live log; the
chain verifies **as one** across segments (Settings → Activity → Verify integrity uses it), and the live log
still verifies alone (the newest `archive` anchor's `cut` is accepted like a `truncate` anchor's). Only a
storage-quota failure still sheds rows, recorded by a `truncate` anchor as before; if a segment cannot be
written the old cap applies (also recorded). Edge: a storage-full truncation after archives leaves a gap that
full verification reports.

**Edit log per record (P1-23).** `audit.forRecord(id)` (archives included) and `EditLog` modal
(`{open, recordId, name?, onClose}`, "altered by / on" + changes). Settings → Activity: each row has
"Edit log" (filters to that record), "Include archived entries", archived count, and the statement that the
trail **cannot be turned off** (there is no setting).

## 3. Tally export of every voucher (P0-12 / P1-22)

`ExportSource.books` (additive, `loadTallyBooksSource(today)` in the Export Center) feeds `tally-books.ts`,
called from `buildTallyModel`:
- supplier payments (`purchase_payments`): Payment, Dr supplier Agst Ref the bill number | Cr bank / cash
  (WP-5 per-bank resolver) [+ Cr `TDS Payable <section>` for TDS on payment]; numbers `<bill>/P<n>`;
- supplier advances / on account / new ref (`vendor_payments`): Payment, Dr supplier (Advance / New Ref);
- manual vouchers in the books (optional, memo and not-yet-due post-dated left out; reversing journals with
  their reversal): Journal / Contra / Payment / Receipt with our number and narration, party lines on the
  party ledger, **cost-centre allocations** (`CATEGORYALLOCATIONS.LIST`, "Primary Cost Category"); invoices'
  `cost_centre_id` allocates their sales entry. Receipt rows a manual voucher allocated bill-wise (P0-11) go
  out once, with the voucher;
- fixed assets: acquisition journal (when `paid_from` is set) and the year's depreciation journal (31 March);
- stock transfers: **Stock Journal** (`INVENTORYENTRIESOUT/IN.LIST` with godown batch allocations, quantity
  only; items must exist in Tally);
- masters: user **groups** (parents first), **cost centres**, **godowns**, and **opening balances** on
  ledgers (`OPENINGBALANCE`, Tally sign) with **bill-wise opening bills**; our accounts land under Tally's
  own groups (`TALLY_GROUP_OF`), default accounts keep the ledger names the document export uses.
Counts gain `payments`, `journals`, `contras`, `stockJournals` (additive). A source without `books` exports
byte-identically to before (tested).

Not exported yet: TDS / TCS challans, advance GST adjustments, receipts at the realised FX rate, batch /
godown allocations on sales and purchase item lines.

## 4. Year-end wizard (P1-20) and integrity check (P2)

`YearEndWizard` (FY picker, last closed year by default) runs `yearEndChecklist`:
1. **Integrity** — `checkBooksIntegrity`: every voucher and the whole ledger balance; opening difference;
   orphaned receipts / supplier payments / voucher allocations / document links / opening bills of deleted
   parties; **negative cash days** (cash in hand closing below zero); ledger warnings.
2. **Closing stock** — inventory valuation on 31 March; "Post closing stock journal" = Dr Stock-in-hand |
   Cr Purchases on 31 March, reversed on 1 April (opening stock), class `Year-end closing stock`; re-posting
   replaces. Shown as done when the P&L already carries closing stock (a `Closing Stock` ledger voucher —
   WP-2's engine, when it lands) — then skip the journal.
3. **Depreciation** — the register's depreciation for the year (posted automatically); warns when
   fixed-asset ledgers hold more than the register knows.
4. **Provisions** — lines Dr expense | Cr Provisions (2500) on 31 March, optionally reversed on 1 April.
5. **Opening bills** — party balances carried into the new year; old opening bills still open.
6. **Lock** — `lockYear` sets the period lock to 31 March (owner, `settings.manage`; never moves a later
   lock back).
7. **Carry forward** — `carryForward` (new year's opening balances; the profit sits in Reserves & surplus)
   with CSV download.
Review marks live in table **`year_end`** (`{id: 'FY25-26', marks}`; backed up, `TABLE_ACTIONS` books.edit,
audited).

## Wiring for the lead

Both screens open from **Settings → Data → "Migration & year-end"**, the **Books header** ("Start new year",
"Import from Tally"), `/books?open=yearend|tally`, the Gateway (root **Y**, Import & export **T**) and the palette
(lazy chunks; Tally import needs `data.restore`). **Edit log** buttons (`EditLogButton`) are on the Books voucher editor
and the purchase bill form; the stock item screen is left to WP-8. The closing-stock step shows the report-time
valuation when it is on and posts a journal only when it is off (`docs/features/reports-engine.md`).

## Hot / shared files touched

- `src/lib/storage.ts`: the single `onTableWrite` hook (+ `notifyTableWrite` in `setTable`), documented.
- `src/lib/backup.ts`: `SafetySnapshot.reason` gains `'import'`; archive segments validated on restore;
  `year_end` in `RECORD_TABLES` / `ID_TABLES`.
- `src/lib/access.ts`: `TABLE_ACTIONS.year_end = 'books.edit'`.
- `src/lib/sync-engine.ts`: `isSyncedKey` excludes `audit_archive_*`.
- `src/lib/tally-xml.ts` (WP-7 owned): new voucher types, cost centres, Stock Journal, opening balances,
  group / cost-centre / godown masters, the `books` call. `src/lib/export-shared.ts`: `ExportSource.books`.
- `src/types/audit.ts`: entities `vendor`, `purchase_payment`, `recurring`, `opening`, `bank_statement`;
  action `archive`; seal `segment`, `archived_head` (all additive).
- `src/components/exports/ExportCenter.tsx` (books source + counts), `src/components/settings/DataPanel.tsx`
  (entry card), `src/i18n/areas/exports.ts` (3 count labels).
- `tests/storage-idb.test.ts`: the quota test now writes `export_prefs` (outside the edit log) so audit
  writes do not join the flushes it measures.
