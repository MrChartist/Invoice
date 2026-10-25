# Masters & openings — "Accounts Info" (WP-1)

Tally-style groups, sub-groups, ledgers and opening balances, so a CA can load a 31 March trial balance and start
on 1 April. Gap ids P0-1, P0-2, P1-7 (lib) from `docs/GAP_ANALYSIS.md`; P0-11 is a documented hook (below).
Everything is a **working paper — verify with your CA**.

| | |
|---|---|
| Lib | `src/lib/ledger/accounts.ts` (groups model, `GroupId` opened to `string`), `src/lib/ledger/groups.ts` (tree, ledgers in a group, CRUD), `src/lib/ledger/openings.ts` (ledger openings, books-beginning date), `src/lib/ledger/postings-openings.ts` (opening voucher), `src/lib/opening-bills.ts` (bill-wise openings), `src/lib/ledger/ledger-interest.ts` (P1-7) |
| UI | `src/components/masters/**` — lazy chunk, mounted today from Books → Chart of accounts (`ChartTab`) |
| i18n | `src/i18n/areas/masters.ts` (`mastersT`, English + Hindi) |
| Tests | `tests/groups.test.ts`, `tests/openings.test.ts`, contract row in `tests/purchase-contract.test.ts`, e2e step "masters: …" in `tests/e2e/smoke.mjs` |

## Storage (additive; all in backups, `RECORD_TABLES` + `ID_TABLES`)

| table | shape | role action |
|---|---|---|
| `groups` | `{id, name, alias?, parent, subledger?, net_balances?, created_at, updated_at?}` — `parent` is a primary id or another user group | `master.edit` |
| `accounts` (existing) | additive `under?` (user sub-group id), `alias?`, `interest?: {rate, on: dr\|cr\|both, days_in_year?, from?}`. **`group` stays the Schedule III primary**, so every report keeps working | `master.edit` (was `books.edit`; clerks have both) |
| `ledger_openings` | `{id, ledger_id, dr, cr, party_name?, created_at, updated_at?}` — integer **paise**, one row per ledger; `ledger_id` = account id or party ledger id `party:debtor:<clientId>` / `party:creditor:<vendorId>` | `books.edit` |
| `books_begin` | one row `{id: 'books_begin', date}` — "books beginning from"; pinned the first time an opening is saved (default 1 April of the current FY) so it never drifts | `books.edit` |
| `opening_bills` | `{id, party_id?, party_name, side: receivable\|payable, ref_no, date, due_date?, amount (₹ > 0), dr_cr, created_at, updated_at?}` | `books.edit` |
| `clients` / `vendors` (existing) | additive `group_id?` — sub-group under Sundry Debtors / Creditors | `master.edit` |

No migration was needed: nothing stored changes shape. `normalizeUserAccounts(rows, userGroups)` also accepts a row whose
`group` is a user group id (written by newer code / other packages) and maps it to `{group: primary, under: id}` at read
time; a dangling `under` falls back to the primary. All normalisers are idempotent (tested).

## Behaviour (Tally parity)

- **Groups.** 24 fixed primaries (ids unchanged). User groups nest to any depth; nature, Schedule III head and
  "affects gross profit" (`direct`) are inherited from the primary. Names are unique across all groups; a group cannot
  come under itself or its own sub-group; delete only when empty (no sub-groups, ledgers or parties).
- **Ledgers.** Ledger Creation under Sundry Debtors creates a **client**, under Sundry Creditors a **vendor** (parties stay
  in their own masters, placed in a sub-group via `group_id`); anywhere else a chart **account**. Built-in accounts take
  only an opening balance.
- **Openings.** Balances at the start of the books-beginning date, posted as one `Opening` voucher dated the day before
  (`obal:<date>`, number `OPENING`): every ledger opening, party lines on Debtors / Creditors with the party name the
  invoices use (`company || name`). A party with opening bills but no typed opening uses its bill total. The residual is
  posted to **1090 Opening balance difference** and shown as "Difference in opening balances: ₹x Dr" (Opening TB screen,
  Chart of accounts banner, TB row) — never forced to zero.
  - Income / expense openings dated before 1 April roll into reserves (last year's profit), as the TB/BS FY rule does.
    With a mid-year books-beginning date they stay in the current year.
  - Books → Cash & bank "opening balance" (`book_opening`) still sets the cash / bank balance at its own `as_of`; when it
    is on the books-beginning date it wins for that ledger (no double count — tested).
- **Bill-wise openings.** "Bill-wise Details for: <party>" (New Ref, name, date, due date / credit days, amount, Dr / Cr).
  The total should equal the ledger opening; any remainder shows as **On Account** (and reaches receivables as an
  "On Account" line, so receivables net = ledger party balance). Opening bills age and appear in statements like
  invoices but are **never** documents: not in GSTR, revenue, stock, numbering or the invoice list.
- **Receipts against opening bills.** A `transactions` row with `invoice_id` = the opening bill id (plus `client_id`,
  `client_name`) settles that bill in receivables; the ledger posts it to that party (postings now fall back to
  `client_name` for receipts without an invoice, which also fixes on-account receipts that showed "Unknown customer").
- **Interest (P1-7, lib).** `interestOnBalances` / `ledgerInterest`: simple interest on the end-of-day balance, Dr / Cr /
  both, 365 or 360 days. No report screen yet.

## Entry points for the Gateway of Tally (WIP-D) and the lead

Screens are addressed by `MasterScreen` (`src/components/masters/screens.ts`, tiny, no chunk cost):
`menu`, `group-create`, `group-alter`, `group-display`, `ledger-create`, `ledger-alter`, `ledger-display`, `opening-tb`,
`billwise` (+ item id).

- **URL:** `/books?tab=coa&m=<screen>&mid=<id>` — `mastersHref(screen, id)` builds it. Works today with no shell change.
- **Component:** `React.lazy(() => import('src/components/masters/MastersPanel'))` with props
  `{screen?, itemId?, onNavigate?, onClose?, onChanged?, notify?}` (controlled or self-routing).
- **Individual forms** (named exports): `GroupForm {mode, groupId?, initialName?, initialParent?, onDone, onBack}`,
  `LedgerForm {mode, ledgerId?, initialName?, initialGroup?, onDone, onBack, onBillwise?}`,
  `OpeningTrialBalance {onDone, onBack, onBillwise?}`, `BillwiseOpening {ledgerId, onDone, onBack}`,
  `MastersList {kind, title, onPick, onBack}`.
- **Alt+C create-on-the-fly:** `useCreateOnTheFly(notify)` → `{open({kind: 'ledger'|'group', name?, under?}), node}`;
  `open` resolves `{id, name}` (account id, party ledger id or group id) or `undefined`. `isAltC(e)` from
  `useMasterKeys.ts`. Inside the masters forms, Alt+C on a field marked `data-create` calls `onCreate`.
- **Keys** (`useMasterKeys`): Enter → next field (Enter on the last field accepts), Ctrl+A accept, Esc back.

Lead wiring suggestions: a nav / Gateway entry "Accounts Info" → `mastersHref('menu')`; the voucher editor's account
picker can call `useCreateOnTheFly` on Alt+C.

## APIs for other packages

| export | from | for |
|---|---|---|
| `groupTree(userGroups?)`, `groupDescendants(id)`, `groupPath(id)` | `ledger/groups.ts` | WP-2 group summary |
| `ledgersInGroup(groupId, masters?, {recursive})`, `allLedgers(m)`, `findLedger(id)`, `loadMasters()` | `ledger/groups.ts` | WP-2, WP-7 import |
| `openingBalance(ledgerId, asOf?)`, `loadOpenings()`, `saveOpenings(entries)`, `openingDifference()`, `loadBooksBegin()` | `ledger/openings.ts` | WP-2, WP-7 opening TB import |
| `openingBillsFor(partyId, side?)`, `saveOpeningBillsFor()`, `receivableOpeningBills()` | `opening-bills.ts` | WIP-C bill-wise payables, P0-11 |
| `groupOf(id, userGroups?)`, `primaryOf()`, `allGroups()`, `immediateGroupOf()`, `PrimaryGroupId`, `GroupId = string` | `ledger/accounts.ts` | everyone (payroll / manufacturing add accounts with a primary `group`) |
| `registerAccountProvider(name, fn)`, `providedAccounts()` | `ledger/accounts.ts` | WP-5 synthesised bank ledgers |
| `BuildInput.openingBills` / `OpeningBillInput`, `Bill.opening` | `receivables.ts` | receivables consumers |

## Not done / hooks

- **P0-11 bill allocation in manual RV / PV** — WIP-C (TDS / bill-wise payables) was not merged when this package was
  rebased, so the voucher editor is untouched. Hook: an allocation becomes a `transactions` row `{invoice_id: <invoice or
  opening bill id>, client_id, client_name, amount, date, method}` (receivable side); the payable side reads
  `openingBillsFor(vendorId, 'payable')`. Payable opening bills are stored and posted but not yet in a payables ageing.
- **P1-21 import kinds** (ledgers / vendors / openings in the CSV wizard) — not done; the wizard's kinds are wired through
  `import-mapping.ts` and its UI, larger than "straightforward". `saveOpenings` / `saveOpeningBillsFor` are the write APIs to use.
- **P2 cost categories** — not done.
- No interest report screen; GST / TDS defaults and party bank details on ledgers are not modelled.
- The TB tab (WP-2) shows the difference only as the 1090 row; the Tally banner is on the Opening TB screen and the
  Chart of accounts tab.
