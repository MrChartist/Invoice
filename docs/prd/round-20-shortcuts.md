# Round 20 — proposed key map (Tally key → our key)

Companion to `docs/prd/round-20.md`. R20-A turns this table into `src/lib/keys/registry.ts` rows (one row per key per
scope). Sources: TallyHelp "Keyboard Shortcuts in TallyPrime" (fetched 2026-10-29) and the code on `ae02b40`.

**Mode:** **Always** = works in the simple default · **Tally** = only with "Tally keys" on · **Gw** = always on
`/gateway`. **Pkg** = the R20 package that builds it ("have" = exists today). On a Mac, Ctrl = ⌘ and Alt = ⌥; F-keys
may need `fn`. A key never fires while typing in a field unless the Scope says "field", and never while a dialog is
open (except the dialog's own keys) or on `/pos` (POS keeps its own map, `src/lib/pos.ts`).

## 1. Our own keys (always on, unchanged)

| Key | Action | Notes |
|---|---|---|
| Ctrl+K | Command palette | Tally's Ctrl+K (display language) → palette action "Language / भाषा" |
| `/` | Search | |
| `?`, Ctrl+/ | Keyboard cheat sheet | Rebuilt by R20-A (Hindi, search, This screen, print) |
| F1 | Help for this screen | Now also on `/gateway` |
| Esc | Back / close the top dialog | Tally's Ctrl+Q (quit screen) → Esc |
| Ctrl+S, Ctrl+Enter | Save (editor, forms) | |
| Ctrl+P | Preview / print (editor) | On reports in Tally mode: the report's Print button |
| Alt+P | POS counter | Tally's Alt+P (print menu) → Ctrl+P |
| Alt+R | Repeat the party's last bill (editor) | In a narration field (Tally mode): the party's last narration |
| Alt+Z | Undo (toast) | Tally's Alt+Z (Exchange) → Alt+Y Data sheet |
| `g` then `d` / `i` / `t` / `c` / `s` | Go to Dashboard / New invoice / Invoices / Clients / Settings | |

## 2. Going places

| Id | Tally key | Tally action | Our key | Mode | Scope | Opens | Pkg | Notes |
|---|---|---|---|---|---|---|---|---|
| K-goto | Alt+G | Go To (on top of this screen) | Alt+G | Tally, Gw | global | Palette in Go To mode; "Back to …" chip | D | Mac: match `e.code` (today's bug) |
| K-switch | Ctrl+G | Switch To | Ctrl+G | Tally, Gw | global | Go To that navigates | D | Browser "find next" yields |
| K-help-ctx | Ctrl+F1 | Help for this screen | Ctrl+F1 | Tally | global | Same as F1 | A | |
| K-company | F3 | Switch company | F3 | Tally | global | Company switcher list | D | Browser "find next" yields |
| K-company-open | Alt+F3 | Open / company info | Alt+F3 | Tally | global | Settings → Companies | D | cut 2 |
| K-lock | Ctrl+F3 | Shut company | Ctrl+F3 | Tally | global | Lock now (asks if a form is dirty) | D | |
| K-menu-company | Alt+K | Company menu | Alt+K | Tally | global | Company sheet (letters) | D | |
| K-menu-data | Alt+Y | Data menu | Alt+Y | Tally | global | Data sheet: Back up, Restore, Check data, New year, Recycle bin, Sync | D | |
| K-menu-import | Alt+O | Import menu | Alt+O | Tally | global | Import (Tally XML, Excel, bank statement) | D | |
| K-menu-export | Alt+E | Export menu | — (Ctrl+E on reports; `/exports` from Ctrl+K) | — | — | — | C | Alt+E opens the Chrome menu on Windows: not claimed |
| K-notify | Ctrl+Alt+N | Notifications | Ctrl+Alt+N | Tally | global (not in fields) | Bell popover | D | AltGr: never in a field |
| K-repair | Ctrl+Alt+R | Rewrite data | Ctrl+Alt+R | Tally | global (not in fields) | Data sheet → Check data (read-only) | D | |
| K-about | Ctrl+Alt+B | Build info | Ctrl+Alt+B | Tally | global (not in fields) | Help → About | D | cut 1 |
| K-features | F11 | Company features | F11 | Tally, Gw | global | `/settings?tab=defaults` | have | Browser full screen may win; Key bar twin |
| K-configure | F12 | Configure | F12 | Tally, Gw | global; report → report options | `/settings` or the report's options | have | Browser dev tools may win |
| K-date | F2 | Change date | F2 | Tally, Gw | in place: form date field / report date; else the Gateway date dialog | | A, B, C | Today it always leaves the screen |
| K-period | Alt+F2 | Change period | Alt+F2 | Always on reports; Tally elsewhere | report / global | Period bar / Gateway dialog | have | |
| K-vouchers | F10 | List of vouchers | F10 | Tally, Gw | global | Vouchers sheet (letters, every voucher with its key) | A | The answer for every key a browser / Mac will not give us |
| K-keys | — | (button bar) | Key bar button / "Keys" pill | Tally, Gw | every screen | Key bar | A | Phones: bottom sheet |

## 3. Opening vouchers

Layout **prime** = TallyPrime (default for new users); **erp9** = Tally.ERP 9 (today's mapping, default for existing
devices). Only the rows that differ name both.

| Id | Tally key (Prime) | Voucher | Our key (prime) | Our key (erp9) | Opens | Mode | Pkg |
|---|---|---|---|---|---|---|---|
| K-contra | F4 | Contra | F4 | F4 | `/gateway/voucher/contra` | Tally, Gw | have |
| K-payment | F5 | Payment | F5 | F5 | `/gateway/voucher/payment` | Tally, Gw | have (now Tally-only: F5 reloads in simple mode) |
| K-receipt | F6 | Receipt | F6 | F6 | `/gateway/voucher/receipt` | Tally, Gw | have |
| K-journal | F7 | Journal | F7 | F7 | `/gateway/voucher/journal` | Tally, Gw | have |
| K-sales | F8 | Sales | F8 | F8 | `/invoice` | Tally, Gw | have |
| K-purchase | F9 | Purchase | F9 | F9 | `/expenses?new=bill` | Tally, Gw | have |
| K-cn | Alt+F6 | Credit note | **Alt+F6** | Ctrl+F8 | `/invoice?type=CREDIT_NOTE` | Tally, Gw | A |
| K-dn | Alt+F5 | Debit note | **Alt+F5** | Ctrl+F9 | `/invoice?type=DEBIT_NOTE`; on `/expenses` the purchase-return DN | Tally, Gw | A (on a report Alt+F5 = detailed) |
| K-so | Ctrl+F8 | Sales order | **Ctrl+F8** | F10 sheet only | `/invoice?type=SALES_ORDER` | Tally, Gw | A |
| K-po | Ctrl+F9 | Purchase order | **Ctrl+F9** | F10 sheet only | `/expenses?tab=orders` (new PO) | Tally, Gw | A |
| K-dc | Alt+F8 | Delivery note | Alt+F8 | Alt+F8 | `/invoice?type=DELIVERY_CHALLAN` | Tally, Gw | A |
| K-grn | Alt+F9 | Receipt note | Alt+F9 | Alt+F9 | `/expenses?tab=returns&new=grn` | Tally, Gw | A |
| K-stockj | Alt+F7 | Stock journal | Alt+F7 | Alt+F7 | `/manufacturing?tab=journal` | Tally, Gw | have |
| K-physical | Ctrl+F7 | Physical stock | Ctrl+F7 | Ctrl+F7 | `/manufacturing?tab=physical` | Tally, Gw | have |
| K-payroll | Ctrl+F4 | Payroll | **Ctrl+Shift+F4** | Ctrl+Shift+F4 | `/payroll` | Tally, Gw | A — Ctrl+F4 closes the browser tab |
| K-rej-out | Ctrl+F5 | Rejection out | Ctrl+F5 | Ctrl+F5 | `/expenses?tab=returns` (new purchase return) | Tally, Gw | A, cut 1 — Ctrl+F5 = hard reload in simple mode |
| K-rej-in | Ctrl+F6 | Rejection in | Ctrl+F6 | Ctrl+F6 | credit note with "goods came back" | Tally, Gw | A, cut 1 — B-test |

## 4. While entering a voucher or document

Scopes: **voucher** = Gateway voucher form; **editor** = invoice / note / challan editor; **bill** = bill / PO / GRN
forms; **master** = master forms and quick-create dialogs; **picker** = a party / item / ledger picker field;
**narration** = narration / notes field; **line** = a focused line in a grid.

| Id | Tally key | Tally action | Our key | Mode | Scope | Pkg | Notes |
|---|---|---|---|---|---|---|---|
| K-accept | Ctrl+A | Accept / save | Ctrl+A | Tally, Gw | voucher, editor, bill, master | B (voucher / master: have) | Simple mode: Ctrl+A = select all; Ctrl+S / Ctrl+Enter always save |
| K-next | Enter | Next field | Enter | Tally, Gw | voucher, bill, master | B (voucher / master: have) | Not in textareas |
| K-create | Alt+C | Create master on the fly | Alt+C | Tally, Gw | picker | B (voucher, bill lines: have) | Opens the existing quick-create, name pre-filled |
| K-alter-master | Ctrl+Enter | Alter master | Ctrl+Enter | Tally | picker | B | Outside a picker Ctrl+Enter keeps "save" in the editor |
| K-delete | Alt+D | Delete voucher | Alt+D | Tally, Gw | voucher (have), editor, bill | B | Y / N, then toast Undo (recycle bin) |
| K-cancel | Alt+X | Cancel voucher | Alt+X | Tally | editor (invoice / note), voucher | B | Asks a reason; Undo restores |
| K-dup | Alt+2 | Duplicate | Alt+2 | Tally | editor, voucher | B | New number on save; Mac `e.code` Digit2 |
| K-rmline | Ctrl+D | Remove line | Ctrl+D | Tally | line | B | Browser bookmark yields in scope; Undo re-inserts |
| K-postdated | Ctrl+T | Post-dated | **Alt+T** | Tally, Gw | voucher | B | Ctrl+T (new tab) cannot be claimed |
| K-optional | Ctrl+L | Optional | Ctrl+L | Tally, Gw | voucher | B | Address bar yields in scope |
| K-memo | (ERP 9 Ctrl+F10) | Memorandum | — (chip next to the date) | — | voucher | B | No key |
| K-mode | Ctrl+H | Change voucher mode | Ctrl+H | Tally, Gw | voucher (single / double entry), editor (item lines / amount only) | B | History yields in scope |
| K-more | Ctrl+I | More details | Ctrl+I | Tally | editor, bill, line | B | |
| K-stockq | Alt+S | Stock query | Alt+S (alias Ctrl+Shift+S) | Tally | line | B | Alt+S = Firefox History menu on Windows: B-test |
| K-related | Ctrl+O | Related reports | Ctrl+O | Tally | editor, bill (party) | B, cut 3 | Open-file yields in scope |
| K-gstan | Alt+A | GST tax analysis | Alt+A | Tally | editor, bill | B | On a report Alt+A = add voucher / column |
| K-narr-type | Ctrl+R | Narration of the previous voucher of this type | Ctrl+R | Tally | narration only | B | Reload stays everywhere else |
| K-narr-party | Alt+R | Narration of the party's previous voucher | Alt+R | Tally | narration only | B, cut 1 | Outside the field Alt+R = repeat last bill |
| K-editlog | Alt+Q | Edit log | Alt+Q | Tally | editor, voucher, bill | B | Activity timeline |
| K-prev-next | PgUp / PgDn | Previous / next voucher | PgUp / PgDn | Tally, Gw | voucher, editor (altering) | B, cut 2 | Y / N when changed |
| K-vtype | F4–F7 | Change type in place | F4–F7 | Gw | voucher | have | |
| K-datefield | F2 | Date | F2 | Tally, Gw | voucher (have), editor, bill | B | |
| — | Alt+J, Ctrl+F, Ctrl+Alt+U, Alt+4 / Ctrl+4 | Stat adjustment, autofill, unused numbers, ₹ symbol | — | — | — | — | Out of scope (PRD §8) |

## 5. Reports

Scope **report** = Books report tabs, Gateway Display, registers; **row** = a focused report row (Day Book, ledger
vouchers, Group Summary).

| Id | Tally key | Tally action | Our key | Mode | Scope | Pkg | Notes |
|---|---|---|---|---|---|---|---|
| K-drill | Enter / Esc | Drill down / up | Enter / Esc | Always | report | have | |
| K-detail | Alt+F1 | Detailed / condensed | Alt+F1 | Always on reports | report | have (Books); C adds Gateway Display | |
| K-detail2 | Alt+F5 | Detailed / condensed | Alt+F5 | Tally | report | C | Wins over "debit note" on a report |
| K-options | F12 | Configure | F12 | Always on reports | report | have | |
| K-basis | Ctrl+B | Basis of values | Ctrl+B | Tally | report | C, cut 3 | Include optional / post-dated, budget column, cost centre |
| K-views | Ctrl+H | Change view | Ctrl+H | Tally | report | C | Saved views, Show original, Delete, Set default |
| K-saveview | Ctrl+L | Save view | Ctrl+L | Tally | report | C | `mrchartist_report_views` |
| K-except | Ctrl+J | Exceptions | Ctrl+J | Tally | report | C | Downloads page yields in scope |
| K-filter | Ctrl+F (Alt+F12) | Filter | Ctrl+F, Alt+F12 | Tally | report | C | Browser find everywhere else |
| K-filtered-bal | Ctrl+F12 | Balances of filtered vouchers | (automatic footer) | Tally | report | C | "Totals of what you see" |
| K-select | Space | Select line | Space | Tally | row | C | Checkbox column is the twin |
| K-extend | Shift+↑ / ↓ | Extend selection | Shift+↑ / ↓ | Tally | row | C | |
| K-invert | Ctrl+Alt+I | Invert selection | Ctrl+Alt+I | Tally | report (not in fields) | C, cut 2 | |
| K-expand | Shift+Enter | Expand / collapse | Shift+Enter | Tally | row | C | ▸ button is the twin |
| K-alter-row | Ctrl+Enter | Alter master / open voucher | Ctrl+Enter | Tally | row | C | |
| K-hide | Ctrl+R | Remove line | Ctrl+R | Tally | row | C | Never saved |
| K-unhide1 | Ctrl+U | Restore last hidden | Ctrl+U | Tally | report | C | View-source yields in scope |
| K-unhideall | Alt+U | Restore all | Alt+U | Tally | report | C | "n hidden · Show all" chip |
| K-step | + / − | Next / previous period or report | `+` / `−` and `]` / `[` | Tally | report | C | |
| K-cols | Alt+N / Alt+C / Alt+D | Auto columns / add / delete column | Alt+N / Alt+C / Alt+D | Tally | report | C | On a report these win over voucher meanings |
| K-insert | Alt+I, Alt+A | Insert / add voucher | Alt+I, Alt+A | Tally | row | C | Same type, that day |
| K-rowdup | Alt+2 | Duplicate voucher | Alt+2 | Tally | row | C (calls B) | |
| K-rowdel | Alt+D | Delete | Alt+D | Tally | row | C (calls B) | Y / N + Undo |
| K-rowcancel | Alt+X | Cancel | Alt+X | Tally | row | C (calls B) | |
| K-print | Ctrl+P / Alt+P | Print | Ctrl+P | Tally | report | C | Presses the report's Print button; Alt+P stays POS |
| K-export | Ctrl+E / Alt+E | Export | Ctrl+E | Tally | report | C | Alt+E not claimed |
| K-share | Ctrl+M / Alt+M / Ctrl+Alt+W | E-mail / share / WhatsApp | Ctrl+M (Ctrl+Alt+W alias) | Tally | report, document | C | Opens the share sheet; nothing is sent by the app |
| K-bank-gst | F4–F10, Alt+F6 / F7, Alt+S / R / V / W / Q (bank / GST screens) | Screen-specific | Same keys where the screen has the action | Tally | BRS, GST tabs | C, cut 1 | Connected-banking and portal keys out of scope |

## 6. Lists (D5)

| Id | Tally key | Our key | Mode | Scope | Pkg |
|---|---|---|---|---|---|
| K-list-move | ↑ ↓ Home End PgUp PgDn | same | Tally | `/transactions`, `/clients`, Expenses bills / vendors | D |
| K-list-open | Enter | Enter | Tally | same | D |
| K-list-select | Space | Space | Tally | same (where a bulk bar exists) | D, cut 3 |
| K-list-act | Alt+D / Alt+X / Alt+2 | same | Tally | same | D (calls B) |

## 7. Never claimed (browser / OS) — shown in the cheat sheet as "not in a browser"

| Key | Owner | Tally meaning | Use instead |
|---|---|---|---|
| Ctrl+N, Ctrl+Shift+N | New window | Calculator | Type a sum in an amount field (`120*3`) |
| Ctrl+T, Ctrl+Shift+T | New tab | Post-dated | Alt+T |
| Ctrl+W, Ctrl+Shift+W, Ctrl+F4 | Close tab | Entry language; Payroll | Ctrl+Shift+F4 / F10 sheet for payroll |
| Alt+F4 | Close window | Quit | — |
| Ctrl+Q (Linux), Ctrl+Shift+Q (Firefox), ⌘Q, ⌘W, ⌘H, ⌘M | Quit / hide | Quit screen | Esc |
| Ctrl+Tab, Ctrl+PgUp / PgDn, Ctrl+1…9 | Switch tabs | — | — |
| Alt+← / → | Back / forward | — | Esc, browser Back |
| Alt+F, Alt+E | Browser menu (Windows) | Find bar, Export | Ctrl+F (reports), Ctrl+E |
| Ctrl+Z / Y / X / C / V, Shift+arrows, Home / End in fields | Text editing | (same) | — |
| Ctrl+Alt+anything inside a text field | AltGr characters (InScript, Hindi and many European layouts) | — | Use outside the field or the Key bar |

## 8. Notes

- **Mode default.** Fresh device: Tally keys **off**, layout Prime when switched on. Existing device (any earlier sign of
  use): **on**, layout ERP 9 — no change from today. Keys: `mrchartist_tally_keys`, `mrchartist_tally_layout`
  (device-local, never backed up).
- **B-test** keys (F6, F7, F10, Ctrl+F6, Alt+S, ⌘D, ⌘L …) are confirmed in R20-A's browser matrix; a key a browser will
  not give up is marked unsafe for that browser and the cheat sheet shows its twin.
- **Scope order:** field → row → screen → global. One combo appears at most once per scope per layout
  (`tests/keys-registry.test.ts`).
- **Every key has a visible twin** (button, menu row or palette action), labels in English and Hindi, plain name first
  and Tally name second.
