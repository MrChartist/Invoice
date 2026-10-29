# Tally keys (Round 20) — key engine, registry, cheat sheet, Key bar

PRD: `docs/prd/round-20.md` (R20-A … D) and the key map `docs/prd/round-20-shortcuts.md`. This note is the contract
packages B, C and D build on. R20-A built the engine; B / C / D only add **handlers** for rows that already exist.

## What a user sees

- **"Tally keys" switch** (device-local `mrchartist_tally_keys`: `off` / `on` / `on:collapsed`) and **layout**
  (`mrchartist_tally_layout`: `prime` = TallyPrime / `erp9` = Tally.ERP 9). Never backed up or synced.
  - A fresh device starts **off** (F5 reloads, F8 does nothing; only the app's own keys: Ctrl+K, `/`, `?`, Ctrl+/, F1,
    Esc, Ctrl+S, Ctrl+P, Alt+P, Alt+R, Alt+Z, `g` sequences, and the Books report keys Alt+F1 / F12 / Alt+F2).
    Switched on, it uses the TallyPrime layout.
  - A device used before (What's new seen at an older version, or `mrchartist_tally_terms` / `mrchartist_report_prefs`
    present) starts **on** with the **ERP 9** layout — exactly the keys it had. The choice is decided once and stored.
  - `/gateway` keeps its keys either way (rows with `gw`).
  - Twins of the switch: the cheat sheet header, the Gateway menu (next to "Tally terms"), Settings → Defaults, Ctrl+K
    "Tally keys on / off" and "Key layout". The switch announces itself in a polite live region.
- **Cheat sheet** (`?`, Ctrl+/, the header keyboard button, Ctrl+K): plain name · Tally name · key, English or Hindi,
  search (English, Hindi — fetched on demand on an English screen —, Tally names, key text `f5`, `ctrl+f8`), tabs
  "This screen" / "All", dimmed Tally rows with "Switch on Tally keys to use" while off, the other layout's key as a
  note, "Not in a browser" (what to use instead of Ctrl+N, Ctrl+T, Ctrl+W, Ctrl+F4, Alt+F4, Ctrl+Q, Alt+F, Alt+E), Print
  (one-column A4 of the sheet only, CSS `:has`).
- **Key bar** (Tally keys on, not on `/gateway` or `/pos`): `role="toolbar"`, one tab stop, ← → Home End, sticky at the
  bottom of the main column; the screen's rows (route-implied scopes + registered handlers) then F10, Alt+G, F2, Alt+F2,
  F1, `?`, Esc. Collapse → a "Keys" button (`on:collapsed`). Phones (≤ 900 px): a "Keys" pill opening the same list
  as a sheet (`Modal`, in the modal stack). Clicking a row runs its handler, its route, or replays its key to the
  screen's own listener (`ext` rows — e.g. "Detailed / short" on a report = Alt+F1).
- **Key chips**: any button with `data-key-row="<row id>"` gets `aria-keyshortcuts` and a CSS chip (`data-key-chip`,
  `::after`) while Tally keys are on — no JSX change on the screen.
- **F10 Vouchers sheet**: every voucher with its key in the current layout and a letter (C P R J S U N D O E L G K H Y …);
  the answer for every key a browser or a Mac keeps (Ctrl+F4 payroll, ERP 9 sales / purchase order).
- **Layouts**: TallyPrime — Alt+F6 credit note, Alt+F5 debit note, Ctrl+F8 sales order, Ctrl+F9 purchase order; ERP 9 —
  Ctrl+F8 / Ctrl+F9 credit / debit note, orders only through F10. Both: Alt+F8 delivery challan, Alt+F9 GRN, Alt+F7 /
  Ctrl+F7 stock journal / physical stock, Ctrl+Shift+F4 payroll (Ctrl+F4 closes the tab). The Debit note key on
  `/expenses` opens the purchase-return debit note.
- **Mac**: Alt + letter / digit match `e.code` (Option+G types "©"); the cheat sheet shows `fn` before F-keys.

## Files

| File | What |
|---|---|
| `src/lib/keys/stub.ts` | First paint. Mode / layout prefs, `KEY_CLAIMS` (generated), one keydown listener |
| `src/lib/keys/registry.ts` | Every row (`KEY_ROWS`), `BUILT`, `NEVER_CLAIM` (re-export), `SIMPLE_KEYS`, `comboFor`, `normCombo`, `comboOf`, `claimList`, `SCREEN_SCOPES` |
| `src/lib/keys/never-claim.ts` | The browser / OS keys never claimed (POS reads it too) |
| `src/lib/keys/engine.ts` | `registerKeyActions`, `dispatchKey`, `candidates`, `runKeyRow`, `screenRows`, `rowRoute`, `rowLive` |
| `src/lib/keys/use-key-actions.ts` | `useKeyActions(scope, handlers, enabled?)`, `useKeysState()` |
| `src/lib/keys/cheat.ts`, `palette.ts` | Cheat-sheet search / "This screen"; the Ctrl+K actions |
| `src/components/keys/KeysHost.tsx`, `keys.module.css` | One lazy chunk: Key bar, phone sheet, chips, F10 `VouchersSheet`, `KeysSwitch`, `KeyCaps` |
| `src/components/command/ShortcutsOverlay.tsx` | The cheat sheet (same lazy mount as before) |
| `src/i18n/areas/keys-r20a.ts` | Every row label of the round (A–D), both languages; sheet / bar strings |
| `src/lib/tally-keys.ts` | Phase 7 view over the registry (`resolveTallyKey`, `TALLY_KEYS`, layout `erp9` by default); not on first paint |

Build group `f-keys` (`familyRe('keys', null, 'keys-r20')`): engine, registry, never-claim, cheat, palette,
use-key-actions and the A label area in one lazy chunk. Components import CSS modules, so they are their own chunks.

## API for B, C and D

**Do not add or change rows** (that is a lead change). Your rows are already in `KEY_ROWS` with `pkg: 'B' | 'C' | 'D'`
and labels in `keys-r20a`. A row with `pkg` not in `BUILT` never fires and never shows.

1. **Handle your rows on the screen that owns them** — no new keydown listener:

   ```ts
   import { useKeyActions } from '../../lib/keys/use-key-actions';
   useKeyActions('editor', {
     'delete.editor': () => { askDelete(); },            // return nothing / true: handled (preventDefault)
     'accept.editor': (e) => (canSave ? void save() : false), // false: not handled, the key passes on
   });
   ```

   `useKeyActions(scope: KeyScope, handlers: Record<rowId, (e: KeyLike, row: KeyRow) => boolean | void>, enabled = true)`.
   The registration lives while the component is mounted; handlers are read through a ref. Outside React:
   `registerKeyActions(scope, map)` returns the unregister.
2. **Field scopes** (`field:narration`, `field:picker`, `field:amount`) fire only while focus is inside an element with
   `data-key-field="narration"` (etc.); put that attribute on the field (or its wrapper) and register the handler with
   the same scope. Row scopes (`reportRow`, `list`, `line`) and screen scopes (`voucher`, `editor`, `bill`, `master`,
   `report`, `gateway`) fire when a handler is registered for them.
3. **Order**: field → row (`reportRow` / `list` / `line`) → screen → global; within one rank the newest registration
   wins; a handler returning `false` passes to the next candidate. On a report, C's report rows (Alt+F5, Alt+C, Alt+D,
   Alt+A) therefore beat the global / voucher meanings.
4. **Rules the engine applies for you**: Tally rows only with the mode on (or on `/gateway` for `gw` rows); never on
   `/pos`; never while `[aria-modal="true"]` is open (a dialog handles its own keys); never while typing unless the row
   has `inField` or a field scope — and never Ctrl+Alt in a field (AltGr); `need` checked with `can()`;
   `browser: 'unsafe:<name>'` rows skipped on that browser; Apple-only never-claim keys (⌘H, ⌘M) skipped on Apple.
5. **Ship**: add your letter to `BUILT` in `registry.ts` (one line). If a global row of yours becomes built, run
   `claimList()` and paste the result into `KEY_CLAIMS` in `stub.ts` — `tests/keys-stub.test.ts` prints the expected
   string. Add `data-key-row="<id>"` to the existing button of a row to get its chip.
6. **Twins**: the Key bar lists every built row of the screen that has a handler; `runKeyRow(id)` runs a row from a
   button (`ext` rows replay their key).
7. **Strings**: row labels are already in `keys-r20a` (B–D never edit it); your dialogs' strings go in
   `keys-r20b / c / d` (`defineArea(en, hi)`, literal Hindi).

Cross-package rows: C6 (report rows) and D5 (list rows) call B's `entry-actions.ts`; if C or D merges first, keep
those rows' package letter out of `BUILT` until B lands (the PRD §7.1 rule). Ctrl+F5 / Ctrl+F6 (rejection out / in) are
registered under `B` (A cut 1): B wires them to the purchase return and a credit note with "goods came back".

## Browser-conflict matrix (A, before merge)

`node tests/e2e/key-matrix.mjs` — Playwright Chromium 153 (headless, Linux), a blank local page with a keydown
listener: for 69 keys (every claimable F-key / Alt / Ctrl / Ctrl+Alt combo of the map, PageUp / PageDown, Ctrl+/ and
`?`) the page **received** the keydown and, with `preventDefault`, **kept the page** (no reload, navigation or new tab):
69 / 69 safe, none marked `unsafe:chromium`. Limits, stated plainly: the protocol-level input Playwright sends does not
trigger browser-shell accelerators (even without `preventDefault`, F5 did not reload), so this run proves delivery and
cancellability inside the page, not that a real F5 / F6 / F10 / F11 / F12 / Alt+letter press is cancellable in every
browser. Firefox, Safari, Windows and macOS were **not** run here (no such browsers in the build container). The keys a
browser keeps by design are not claimed (`NEVER_CLAIM`) and every key has a twin (Key bar, F10 sheet, buttons). A real
browser run that finds a key not cancellable marks the row `browser: 'unsafe:<browser>'` (one token `u:` in the row
line); the engine and the stub then skip it there.

## Sizes (gzip, `node scripts/check-bundle-size.mjs`, base `d091326`)

| | Base | After R20-A | Change |
|---|---|---|---|
| First paint | 177.9 kB (182,219 B) | 177.9 kB (182,173 B) | −46 B (stub in; Phase 7 route table, `useTallyKeys`, the overlay's English labels and the palette strings out) |
| Core precache | 3,242.9 kB | 3,254.1 kB | **+11.2 kB** — over the A cap of 9 kB. Chunks: `f-keys` 7.4 (labels of every row of the round ≈ 2.2, rows ≈ 1.8, never-claim 0.3, engine / cheat / palette / hook ≈ 3.0), `KeysHost` 2.2, cheat sheet +1.0, help topic +0.2, POS +0.1; ≈ +0.7 is hash churn across ≈ 700 chunks (the first-paint chunk's export names moved). Cuts taken: 1 (Ctrl+F5 / F6 → B), 3 (no amount hint chip); cut 2 (print) kept, it costs < 0.1 kB with CSS `:has` |
| Hindi pack | ≈ 370.4 kB | 373.2 kB | +2.8 kB (`lang-hi-keys`) |
| Hindi in English chunks | 21.7 kB | 21.8 kB | +0.1 |

## Tests

`tests/keys-registry.test.ts` (unique ids, one combo per scope and layout, no never-claimed key, twins, Hindi labels,
simple-mode set, layouts, search, "This screen"), `tests/keys-stub.test.ts` (claims = registry, Mac Option / `e.code`),
`tests/keys-mode.test.ts` (fresh / existing device, subscribers, engine mode and scope rules), `tests/gateway.test.ts`
(Phase 7 keys, ERP 9), e2e step "R20-A" in `tests/e2e/smoke.mjs`.

## R20-D — Go To, company / data / import menus, list keys, onboarding

- **Go To (Alt+G)** opens the Ctrl+K palette in Go To mode over the current screen (`CommandPalette` `mode` +
  `gotoRows`): screens and reports only (no documents or actions), recent searches first, the Gateway's leaves with
  their labels in both languages and Tally names (`lib/keys/nav-goto.ts` over `flattenMenu`), plus the R20-D synonyms
  `GOTO_SYNONYMS` in `search.ts` ("daily entries", "warehouse summary", "outstanding", "trial", तलपट …). Picking a
  screen shows a **"Back to …"** chip (fixed above the Key bar / Keys pill) that returns to the previous URL and puts
  focus back (`data-focus-key` or the element id, else `#main`); a `/invoice?type=` link returns to `/invoice` so the
  draft in the store is kept. **Ctrl+G** = Switch To (same list, no chip). On `/gateway` both fall through to the
  Gateway's own Go To box.
- **Menus**: Alt+K Company (S switch company, C companies, F features, G configure, U users, L lock), Alt+Y Data
  (B back up now — the palette's `downloadBackupNow`, R restore, C check data, N new year, E recycle bin, S folder
  sync), Alt+O Import (T Tally XML, X Excel / CSV, B bank statement). Letters as on the Gateway, `role="menu"`, ↑ ↓
  Home End, rows filtered by rights (`MENUS` / `menuItems` in `lib/keys/nav-actions.ts`).
- **Small keys**: F3 company list (↑ ↓ Enter), Ctrl+F3 lock (always asks Y / N — the app cannot tell whether a form
  is dirty), Alt+F3 Settings → Data (the row's route), Ctrl+Alt+N opens and focuses the bell list, Ctrl+Alt+R check
  data (Settings → Activity, the edit-log integrity check), Ctrl+Alt+B Help (version at the foot). Ctrl+Alt never fires
  in a field (engine rule).
- **Host**: `components/keys/MenuSheets.tsx` is mounted lazily by the first notification bell while Tally keys are on
  (the bell is always mounted after first paint) and registers the global handlers with `useKeyActions('global')`.
- **List keys** (`lib/keys/use-list-keys.ts`, Tally keys on): Transactions, Clients, Expenses bills, Vendors — ↑ ↓ Home
  End PgUp PgDn move a highlight bar, Enter opens / edits the row (not when a button or link has focus), Space ticks the
  row on Transactions (the only one of the four with a bulk bar), Alt+D presses the row's own Delete (its confirm and
  "Deleted · Undo" as before), Alt+2 the row's Duplicate (Transactions). Alt+X (cancel) has no handler until B's
  `entry-actions.ts` lands. **Not `useDrillRows`**: importing drill-hooks from the list pages split it and the ledger
  stylesheet out of the Books chunk into three new chunks whose names reach the first-paint preload map (+112 B gz);
  the hook is a 30-line local equivalent (same keys and steps, `moveTo` tested) that joins `f-keys`. Virtualised lists
  (> 100 rows) do not scroll an unmounted row into view.
- **Setup wizard**: last step asks "Have you used Tally before?" — Yes: Tally keys on, TallyPrime layout; No: off;
  unanswered: unchanged (`applyTallyAnswer`).
- **First paint**: the stub's `KEY_CLAIMS` gained the nine D globals; paid for by loading the sidebar company select
  lazily (`CompanySwitcher` → `CompanySwitcherList`, only with a second company).

| | Base (`91c4ebc`) | After R20-D | Change |
|---|---|---|---|
| First paint | 177.9 kB (182,165 B) | 177.8 kB (182,101 B) | −64 B |
| Core precache | 3,254.1 kB (3,332,204 B) | 3,258.6 kB (3,336,794 B) | +4.5 kB (cap 6): `f-keys` +1.4 (nav-actions, list hook, keys-r20d), MenuSheets 2.3, palette +0.2, bell +0.4, wizard +0.1, list pages +0.3, the Gateway label area split into its own chunk |
| Hindi pack | 373.2 kB | 373.7 kB | +0.5 kB (`keys-r20d`) |

Tests: `tests/keys-nav.test.ts` (menus → routes / rights / letters / labels, D rows built and claimed, wizard answer,
Go To search incl. Hindi, de-duplication, list movement), `tests/search.test.ts` (Go To rows), e2e step "R20-D".

## R20-B — voucher and document entry

Built rows (`BUILT` has `B`): every `pkg: 'B'` row except those listed under "Cut". Everything works with Tally keys on
(Gateway rows also on `/gateway`); simple mode is unchanged.

| Where | Keys | How |
|---|---|---|
| Invoice editor (`useEditorEntryKeys` in `src/hooks/useCreatorKeys.ts`, one call in `InvoiceCreator.tsx`) | Ctrl+A accept · Alt+D delete (Y / N) · Alt+X cancel (reason once) · Alt+2 duplicate · F2 date · Alt+A tax break-up · Alt+Q edit log · line: Ctrl+D remove (Undo re-inserts), Alt+S / Ctrl+Shift+S stock query · picker (`data-key-field="picker"` on the party name and the item name cell): Alt+C create (party: Ledger Creation under Sundry debtors with the typed name, which saves the client; item: stock item create-on-the-fly), Ctrl+Enter Ledger Alteration of the party (else save; `CreateMasterRequest.alter`) · notes (`data-key-field="narration"`): Ctrl+R last notes of this document type | `useKeyActions('editor' / 'line' / 'field:picker' / 'field:narration')`. Engine rule: rows without `inField` (Alt+D, Alt+X, Alt+2, F2 …) fire when focus is not in a text field. In Tally mode the editor's old Alt+D (duplicate) yields to the engine: Alt+D deletes, Alt+2 duplicates |
| Gateway voucher (`VoucherEntry.tsx`, its own capture listener) | Alt+T post-dated · Ctrl+L optional · "Kind" chip next to the date (Regular / Optional / Post-dated / Memorandum, written through `saveVoucher`) · Ctrl+H single / double entry · Alt+2 duplicate (`?dup=<id>`, new number on save, quitting drops it) · Alt+Q edit log · narration: Ctrl+R last narration of the type · Alt+X explains that a voucher is deleted, not cancelled · Alt+D now stays on a fresh voucher with an Undo toast | `rowFor(e, ids, true)` (every key works in a field, as on the Gateway); twins: the Kind chip and Button-bar entries (Duplicate, Edit history). Typed lines of a new voucher left by Go To are kept in `sessionStorage` (`mrchartist_gw_draft:<TYPE>`, this tab) and come back on the next new voucher of the type; quit / save clear it |
| Bill / PO / GRN forms (dialogs: the engine stays out, `entryKeyDown` on the `<form>`) | Ctrl+A accept, F2 date (all three) · bill: Alt+D delete (Y / N; Expenses' recycle-bin Undo toast), Alt+Q edit log, Alt+S stock query on a line | `LineItemsEditor` rows carry `data-line` |
| Global | Ctrl+F5 rejection out (purchase-return debit note), Ctrl+F6 rejection in (`/invoice?type=CREDIT_NOTE&rej=1` → a credit note with "goods came back") | `KEY_CLAIMS` regenerated; the `rejIn` row got its route (one token, lead-reviewed) |

`src/lib/keys/entry-actions.ts` (C's report rows and D's list rows call it): `deleteEntry(kind, id)` /
`undoDelete(kind, id)` (`invoice` / `voucher` / `purchase`; data-layer delete to the recycle bin, Undo through
`restoreEntries`, so rights, period lock and module checks run again), `cancelEntry(id, reason, ack?)` /
`undoCancel(id)` (`cancelDocument` / `reinstateDocument`), `duplicateRoute(kind, id, type?)` (the editor / voucher
opens an unsaved copy), `rowFor` / `entryKeyDown` (screens that read their own keys), `lastText`,
`withoutLine`, `acceptForm`, `focusFormDate`. Side sheets: `src/components/keys/EntrySheets.tsx` (one lazy chunk; stock
query via `loadStockQuery`, tax break-up from the editor totals, `EditLog`, the Y / N
and reason asks), all `Modal`s in the modal stack. Strings: `keys-r20b`.

Cut — the PRD's ranked cuts 1–3, taken at the 7 kB cap: Alt+R party narration, PgUp / PgDn previous / next entry,
Ctrl+O party facts; then Ctrl+I more details. Their rows stay built but have no handler, so they never fire and never
show on the Key bar (the cheat sheet's "All" tab still lists them — a lead call whether to drop the rows). Also cut (cap /
data model): Ctrl+H "item lines / amount only" in the editor (no such mode exists), Ctrl+Enter alter of an item (saves
instead), Ctrl+D / Ctrl+O / Alt+A / Ctrl+I on bill forms (the line's remove button stays), Alt+X / Alt+2 on bills, voucher
cancel (no cancelled state for a voucher without a data change). Tests: `tests/keys-entry.test.ts`; e2e step "R20-B".

| | Base (`67ccabd`) | After R20-B | Change |
|---|---|---|---|
| First paint | 177.8 kB | 177.8 kB | 0 (`KEY_CLAIMS` + `mod+f5 mod+f6`, a few bytes) |
| Core precache | 3,277.2 kB | 3,285.5 kB | +8.3 kB: own code +7.1 (`f-keys` +2.1 entry-actions + `keys-r20b` English, `EntrySheets` 1.5, editor hook 1.5, `VoucherEntry` 1.1, bill / PO / GRN forms 0.6, help + palette 0.3); ≈ +1.3 hash churn across ≈ 700 chunks (the first-paint chunk's hash moves with `KEY_CLAIMS`). Cap 7 kB: own code at the cap after the ranked cuts |
| Hindi pack | 376.6 kB | 377.1 kB | +0.5 kB (`keys-r20b`) |
| Hindi in core | 21.8 kB | 21.9 kB | +0.1 |

## R20-C — report keys

Built on every Books report that uses `useDrillRows` (trial balance, P&L, balance sheet, group summary, registers,
Day Book, group / ledger vouchers, the Reports hub) and on the Gateway Display viewer. All work only with Tally keys on
(rows `pkg: 'C'`, none global, so `KEY_CLAIMS` is unchanged) and are **never saved** except views (PRD Q7).

| Key | What | Where it lives |
|---|---|---|
| Ctrl+F / Alt+F12 | Filter sheet: amount from / up to, party / ledger text, Dr / Cr side, and on voucher reports date from / to and narration. A strip under the report: "Filtered: n of m rows · Clear"; Esc on the report clears it | `filterRows` (`src/lib/keys/report-actions.ts`), `ReportSheets.tsx` |
| (Ctrl+F12) | "Totals of what you see" (Dr, Cr, net) whenever rows are filtered, ticked or hidden; ticked rows total on their own. A parent row followed by its own shown child is not counted twice | `totalsOf` |
| Space, Shift+↑ / ↓, Ctrl+Alt+I | Tick rows (a ☐ / ☑ column shows while any row is ticked; Ctrl / ⌘ + click is the mouse twin), extend, invert | `useDrillRows` |
| Ctrl+R, Ctrl+U, Alt+U | Hide the ticked (else the focused) rows; restore the last batch / all. ↑ ↓ skip hidden rows; print leaves them out with a note; the Day Book CSV exports only the shown rows | `hideRows`, `unhideLast`, `unhideAll` |
| Ctrl+H / Ctrl+L | Saved-views sheet (8G storage, `mrchartist_report_views`): open, delete, "Open by default" (additive `default` flag, one per screen + tab, applied by PeriodBar on arrival), save this view with the name box focused | `ViewsSheet`, `setDefaultView` / `defaultView` (`report-views.ts`) |
| + / − (] / [) | Step the report period: a month / quarter / FY by the preset; a custom range of whole months by its months, else by its days | `stepPeriod`, `PeriodBar.tsx` |
| Ctrl+J | Exceptions of the period (`negativeLedgers`: cash below zero, customers in credit …); a row opens the ledger | `ReportSheets.tsx` |
| Alt+F5 | = Alt+F1 detailed / short | `ReportToolbar.tsx` |
| Alt+N / Alt+C / Alt+D | Period columns (focus the picker) / next column set / back to none, on reports with the columns picker | `ReportToolbar.tsx` |
| Shift+Enter | Day Book: one voucher's ledger lines | `DayBookTab.tsx` (`opts.expand`) |
| Ctrl+Enter | Group summary ledger row: alter the ledger master; elsewhere = Enter | `opts.master` |
| Alt+I / Alt+A, Alt+2 | Day Book, group / ledger vouchers: Alt+2 opens an unsaved copy of the row's voucher / document (B's `duplicateRoute`); a new entry of the row's type on its day (Gateway vouchers take the day through `setVoucherDate`; documents open their usual new form) | `opts.voucher` |
| Ctrl+P / Ctrl+E | Print; press the report's own Export (CSV / Excel) button — no new output code | `useDrillRows` |

**API (D and later reports).** `useDrillRows(count, onActivate, opts?)` keeps its signature and behaviour; the optional
`opts` adds `fact(i)` (filter / totals facts, else read from the row's cells), `voucher(i)`, `master(i)`, `expand(i)`.
`nav.row(i)` now also returns `data-ri`, `aria-selected` (while ticking) and `hidden`; `nav.shown(i)` says whether a row
is on screen. Report parts join the keys with `useReportKeys(scope, el, handlers)` (`src/lib/keys/report-keys.ts`):
one registration per scope, and a key goes to the visible part holding the focus, else the newest visible one, so a
report hidden under a drill level never answers. The strip mounts through `ReportStrip` (`report-keys.ts`;
DrillStack, Day Book and the Gateway viewer render one).

**Held / cut.** `HELD` in `registry.ts` keeps built-package rows hidden: `delete.row`, `cancel.row` (Alt+D / Alt+X from
a report row: B's `deleteEntry` / `cancelEntry` are there, but a report row needs the Y / N confirm, the reason box, the
Undo toast and a ledger refresh of the open report — a follow-up; remove the ids when they ship). Alt+2 (`dup.row`) is
live: it opens B's `duplicateRoute` for a manual voucher or a sales document. Cut: `basis` (Ctrl+B, cut 3: including
optional / post-dated vouchers needs a ledger-build change outside C's files) and `share` / `share.alias` (Ctrl+M /
Ctrl+Alt+W: no report has a share sheet to press).
Also left out: C8 bank / GST report F-keys (cut 1), the red exception count chip, "Show original" in the views sheet,
long-press ticking on touch (the Key bar's "Tick a row" and Ctrl / ⌘ + click are the twins).

Tests: `tests/keys-report-actions.test.ts` (filter, totals, ticks / hide, period stepping, default view, held rows), e2e
step "R20-C" in `tests/e2e/smoke.mjs` (TB: Ctrl+F chip and Esc, Space ×2 strip, Ctrl+R / Ctrl+U, Ctrl+L view, Ctrl+E CSV, +).

R20-C sizes (gzip, on `91c4ebc`): first paint 177.9 → 177.9 kB (0); core 3,254.1 → 3,260.7 kB (**+6.6 kB**, cap 7: `f-keys`
+≈1.8 for `report-actions` / `report-keys` / the strip / `keys-r20c`, `ReportSheets` chunk 2.1, the rest in LedgerPanel,
PeriodBar, DisplayReport, `report-views` and the CSS module); Hindi pack 373.2 → 373.8 kB; Hindi in core 21.8 kB (0).
