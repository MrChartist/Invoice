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
