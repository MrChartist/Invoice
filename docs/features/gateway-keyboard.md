# Gateway of Tally & keyboard map (Phase 7, Tally parity)

A TallyPrime-style keyboard layer over the existing ledger (`docs/features/ledger.md`). Nothing new is stored
except vouchers / ledgers / parties created through the existing APIs; outputs stay working papers — verify with your CA.

| | |
|---|---|
| Routes | `/gateway` (menu, `?m=<screen>`), `/gateway/voucher/:type` (`contra` `payment` `receipt` `journal`, `?id=` to alter), `/gateway/display?r=<report>&d=<path>` |
| Page | `src/pages/Gateway.tsx` (lazy); voucher entry and Display report are further lazy chunks |
| Components | `src/components/gateway/*` — `GatewayShell` (key dispatcher, F2 / Alt+F2 dialogs), `GatewayMenu`, `VoucherEntry`, `DisplayReport`, `ButtonBar`, `CreateLedgerDialog`, `keymap.ts` |
| Lib | `src/lib/tally-keys.ts` (shell: global keys → routes), `src/lib/gateway/{menu,drill,voucher-entry,period}.ts` |
| Shell hooks | `src/hooks/useTallyKeys.ts`, registered once in `DashboardLayout`; nav item "Gateway" |
| Strings | `src/i18n/areas/gateway.ts` (English + Hindi) |
| Tests | `tests/gateway.test.ts`, e2e step "Gateway of Tally" in `tests/e2e/smoke.mjs` |

## Global keys (anywhere in the app)
Fire only when focus is **not** in an input / textarea / select / contenteditable, no modal dialog is open, and the
page is not `/pos` (POS owns F2–F10). Entries the signed-in role cannot use are skipped (`need` in `TALLY_KEYS`).

| Key | Action | Opens |
|---|---|---|
| F2 | Change voucher date | Gateway → date dialog |
| Alt+F2 | Change period (Display reports) | Gateway → period dialog |
| F4 | Contra voucher | `/gateway/voucher/contra` |
| F5 | Payment voucher | `/gateway/voucher/payment` |
| F6 | Receipt voucher | `/gateway/voucher/receipt` |
| F7 | Journal voucher | `/gateway/voucher/journal` |
| F8 | Sales (invoice editor) | `/invoice` |
| F9 | Purchase (bill form) | `/expenses?new=bill` |
| Ctrl+F8 | Credit note | `/invoice?type=CREDIT_NOTE` |
| Ctrl+F9 | Debit note (on `/expenses`: purchase-return debit note) | `/invoice?type=DEBIT_NOTE` · `/expenses?tab=returns&new=dn` |
| Alt+F7 | Stock journal (and Manufacturing journal tab) | `/manufacturing?tab=journal` |
| Ctrl+F7 | Physical stock | `/manufacturing?tab=physical` |
| F11 | Features | `/settings?tab=defaults` |
| F12 | Configure | `/settings` |
| Alt+G / Ctrl+G | Go To | Gateway with the Go To box focused |
| Ctrl+/ or ? | Keyboard shortcuts overlay (includes a "Tally keys" group) | |

Existing shortcuts are unchanged: Ctrl+K palette, `/` search, `g d`/`g i`/… sequences, Ctrl+S / Ctrl+P in the editor.
On Apple keyboards ⌘ works wherever Ctrl is listed. Browsers may keep F11 (full screen) / F12 (dev tools) for
themselves; the button bar offers both.

## Gateway menu
- The highlighted letter opens an item (`C` Create, `A` Alter, `H` Chart of accounts, `V` Vouchers, `D` (or Tally's `K`)
  Day book, `N` Banking, `I` Import & export, `B` Balance sheet, `P` Profit & loss, `S` Stock summary, `M` Display more
  reports). In Hindi the letter shows as a badge before the label.
- ↑ ↓ Home End move (roving focus), Enter opens, Esc goes back one menu, `/` focuses Go To.
- Go To (Alt+G / Ctrl+G): type any menu or report name (English or Hindi, plus keywords like "gstr3b", "brs");
  ↑ ↓ Enter open, Esc clears.
- Sub-menus: **Create** (L Ledger, U Customer, E Vendor, G Group → chart, I Stock item, O Godown, T Cost centre,
  P Price levels), **Alter** (same letters, open the lists), **Vouchers** (C P R J S U N D, K Stock journal / Y Physical
  stock shown as not available), **Banking** (R BRS, I statement import, C cheques, B cash / bank books),
  **Import & export** (I, E, B), **Display more reports** (T Trial balance, D Day book, A Account books,
  S Statements of accounts, I Inventory books, R Statutory reports) and their children.
- Other modules add rows through `GATEWAY_EXTENSIONS` (same id replaces a built-in row, e.g. Stock journal). Rows
  added by the integration pass: root **O** Accounts Info, **Y** Start new year; Import & export **T** Import from Tally;
  Banking **D** deposit slip, **A** payment advice, **E** e-payments, **T** cash tally; Vouchers **E** debit note
  (purchase return), **G** receipt note (GRN), **M** manufacturing journal; Statutory **D** TDS & TCS payables, **O** GST
  set-off; Display more reports **O** Ratio analysis.

## Voucher entry (Contra / Payment / Receipt / Journal)
| Key | Action |
|---|---|
| Enter | next field: Dr/Cr → ledger → (cost centre) → amount → next line; an empty last ledger ends the lines when balanced; Enter in narration accepts |
| Ctrl+A | accept (save) |
| Esc | close suggestions, else quit (asks "Quit without saving? Y / N" when something was typed) |
| Alt+C | create a ledger, customer or vendor inline (name pre-filled with what you typed) |
| Alt+D | delete (when altering a saved voucher; asks Y / N) |
| F2 | jump to the date field |
| F4–F7 | change the voucher type in place (lines kept) |
| ↑ ↓ | move in the ledger suggestions |

- The first line starts Dr for Payment / Journal, Cr for Receipt / Contra (TallyPrime double-entry mode). With "Tally
  terms" on, the side reads By / To.
- A new line opens on the short side with the difference pre-filled; choosing a ledger on a line with no amount fills
  the balancing amount.
- Ledgers: the chart of accounts plus every customer (Sundry debtors party) and vendor (Sundry creditors party);
  Contra offers cash & bank only.
- Cost centre column appears once a cost centre exists; kept on income / expense lines only.
- Saving uses `saveVoucher`: FY numbering (`PV/FY25-26/0001`), period lock (the error is shown), audit log, `books.edit`
  role. Roles without `books.edit` see a message instead of the form, and the menu hides voucher rows.
- Bill-wise references (Agst Ref / New Ref) are not supported on manual vouchers — they post on account.

## Display reports and drill-down
| Report (`r=`) | Root frame |
|---|---|
| `bs` Balance sheet | the Books statement (`ledgerBalanceSheet` + `loadStockValuer()`): one row per head + Profit & loss A/c row + closing / opening stock rows (open the stock summary), FY-to-date as at the period end (capped at today); totals equal Books |
| `pl` Profit & loss | income / expense groups, opening / closing stock, net profit (same as Books) |
| `tb` Trial balance, `groups` Group summary | closing Dr / Cr per group |
| `daybook` | every ledger voucher in the period (manual + automatic) |
| `cash` | cash & bank ledgers |
| `ledgers` | every ledger with activity |
| `acct&x=debtors` / `creditors` | Outstandings: parties of the control account |

Drill path (`d=`): group `g:` → ledger `a:` → party `p:` (control accounts) → month `m:` → vouchers. Enter drills in;
on a voucher row it opens the Gateway voucher screen (manual vouchers) or the source document (invoice, bills page…).
Esc goes one level up (browser Back works the same), restoring the selected line. Alt+F2 changes the period for all
Display reports.

## Period store
`src/lib/gateway/period.ts`: working period (default: this Indian FY) and voucher date, per tab in sessionStorage
(fail-soft, never in a backup). The Books page keeps its own period picker. "Tally terms" is a device preference in
localStorage (`mrchartist_tally_terms`).

## Not built yet
Bill-wise voucher references, single-entry voucher mode and voucher classes on Gateway voucher entry (ROADMAP 7.19);
`DrillStack` for the Display viewer.
