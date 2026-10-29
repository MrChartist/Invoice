# PRD — Round 20: Tally Prime parity, made easy enough for a layperson (keys, Go To, report grammar, voucher habits)

Status: draft for build · Drafted 2026-10-29 · Baseline: branch `claude/elegant-cannon-cwapiv` at `ae02b40` (PERF-5 merged on
top of `b1b33c2`). Merged on the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–22, Rounds 7–19, PERF-5. PENDING items
45 / 49 hold up to 6 kB of core in parallel (§1.4).

The owner's request, in their words: *"bring all the possible shortcut keys and other things and other features from
Tally to here, but that will be easy to use. In Tally, it is very hard to use, but here we will keep it easy to use, so
any layman will also use those features."*

Companion document: **`docs/prd/round-20-shortcuts.md`**, the proposed full key map (Tally key → our key, mode, scope,
conflicts). This PRD names a key by its row id there (`K-…`) where the detail matters.

Sources (§2.5): **P** = primary text read this round (TallyPrime help page fetched and read); **S** = secondary
(third-party list, vendor blog extract); **V** = Tally's own marketing claim. No CA items: this round changes how
features are reached, never what they compute. Every output that was a working paper stays one ("verify with your
CA", Critical Rule 10).

Every item follows `AGENTS.md`:
- **Local-first and serverless.** No connected banking, Tally.NET, TallyDrive, WhatsApp API, e-mail sending, ODBC or
  remote access. Keys open screens that already exist or small dialogs over them.
- **Styling.** Vanilla CSS Modules with tokens. Key chips use `--pal-*` / text tokens, never raw hex.
- **No new lucide icons.** Every icon lands in the first-paint `vendor-ui` chunk; reuse only (§1.5).
- **Storage.** Every new key is a **device-local viewing preference** outside the `mrchartist_inv_` prefix (never backed
  up or synced), like `mrchartist_tally_terms` and `mrchartist_pos_keys`. No company data, no migration, no
  `TABLE_ACTIONS`, no `sync-engine` row.
- **Hindi.** Every string through `defineArea(en, hi)` with a literal Hindi object. Key caps stay Latin (`Ctrl`, `Alt`,
  `F5`) because the physical keys are printed that way; the action names are bilingual.
- **Help.** No new route or tab is added, so `tests/help-registry.test.ts` needs no new tab topic; the round adds one
  topic `tally-keys` and extends `gateway` (§4, A6).

---

## 1. Problem statement

### 1.1 Who this is for

Three kinds of users open this app:

1. **The Tally hand.** A clerk or accountant who has used Tally for years and types without looking (F5, Enter, Enter,
   Ctrl+A). Today they get a Gateway at `/gateway` with F2, F4–F9, Alt+G, Ctrl+A, Alt+C and the report grammar on Books.
   Outside the Gateway half their habits do nothing (Alt+F5 / Alt+F6 credit / debit note, Ctrl+F8 sales order,
   Ctrl+L optional voucher, Ctrl+H change view, Space to select, Ctrl+R narration, PgUp / PgDn …).
2. **The layperson owner.** A shopkeeper or freelancer who has never used Tally, uses the mouse or a phone, and must
   never be surprised. Today pressing **F5 to reload the page opens a Payment voucher** for them, because the Tally keys
   are always on (`src/lib/tally-keys.ts`, `useTallyKeys` in `DashboardLayout`). That breaks the owner's "keep it
   simple" rule.
3. **The owner who wants to learn.** Hears "Tally users press F8" and wants to try. Today the only list is the `?`
   overlay (`ShortcutsOverlay.tsx`): English only (its title and `GLOBAL_SHORTCUTS` labels are hard-coded), no search,
   no "this screen" filter, no Tally name next to our name, not printable.

### 1.2 What "easy" means in this round (design rules, testable)

| # | Rule | How it is checked |
|---|---|---|
| U1 | **Visible, never hidden-only.** Every key has a button, chip or menu row that does the same thing with a mouse or a finger. A key with no visible twin is refused by a registry test | `tests/keys-registry.test.ts`: every row has a `twin` (button id, menu row, palette action) |
| U2 | **Key chips on screen.** With Tally keys on, buttons show their key as a small chip (`F5`, `Ctrl+A`); a bottom **Key bar** lists the keys of the current screen (Tally's right / bottom button bar) | e2e: chip text present; Key bar row count > 0 on Gateway, a report, the editor |
| U3 | **Plain name first, Tally name second.** "Money paid out (Payment)", "Money received (Receipt)", "Bank ↔ cash (Contra)", "Adjustment (Journal)"; with "Tally terms" on, the Tally name leads | Registry rows carry `plain` and `tally` labels in both languages |
| U4 | **A "?" cheat sheet** that searches (English, Hindi, Tally names), filters to "This screen", shows plain name · Tally name · key, and prints on one A4 page | Unit test on the filter; e2e opens it with `?` and with the header button |
| U5 | **Undo.** Every key that writes (save, delete, cancel, duplicate, insert) shows a toast with **Undo** (Alt+Z, the R4-C4 toast pattern); destructive keys ask once (Y / N, as the Gateway already does) | Unit tests per action; e2e: Alt+D then Undo restores |
| U6 | **Mouse and touch equal.** The Key bar is a scrollable row of real buttons (≥ 44 px targets on touch); on phones a "Keys" button opens the same list as a sheet | e2e at 390 px width |
| U7 | **A "Tally keys" switch, default simple.** Off: only the app's own keys (Ctrl+K, `/`, `?`, F1, Esc, Ctrl+S, Ctrl+P, Alt+P, `g` sequences, Alt+Z). On: the full Tally map. The Gateway keeps its keys either way (the user chose the Gateway) | `tests/keys-mode.test.ts` |
| U8 | **Hindi labels** for every row, chip, dialog and help text | `tests/i18n-areas.test.ts` (literal Hindi objects) |
| U9 | **Never fight the browser or OS.** Keys the browser will not give up are never claimed; keys it gives up but users need (F5 reload, Ctrl+F find) are claimed only in Tally keys mode, and the cheat sheet names the browser twin | Conflict list as data (`NEVER_CLAIM`) + test (§5) |

### 1.3 What already exists (inventory on `b1b33c2`; PERF-5 changed only build scripts)

| Area | What exists | Where |
|---|---|---|
| Gateway of Tally | `/gateway` menu with letter accelerators (C A H V D/K N I B P S M, O Y via `GATEWAY_EXTENSIONS`), Create / Alter / Vouchers / Banking / Import-export / Display more reports sub-menus, Go To box (Alt+G / Ctrl+G, English + Hindi + keywords), Display reports with drill (`/gateway/display?r=&d=`), function-key **ButtonBar** (mouse / touch twin of every key) | `src/pages/Gateway.tsx`, `src/components/gateway/*`, `src/lib/gateway/{menu,drill,period,voucher-entry,voucher-refs}.ts`, `docs/features/gateway-keyboard.md` |
| Global Tally keys | F2 date, Alt+F2 period, F4–F9 vouchers, Ctrl+F8 credit note, Ctrl+F9 debit note (Tally.ERP 9 layout), Alt+F7 stock journal, Ctrl+F7 physical stock, F11 features, F12 configure, Alt+G / Ctrl+G Go To, Ctrl+/ shortcuts. **Always on**, off in fields, in dialogs and on `/pos`; role-checked | `src/lib/tally-keys.ts` (`TALLY_KEYS`, `resolveTallyKey`, shell), `src/hooks/useTallyKeys.ts`, `src/layouts/DashboardLayout.tsx` |
| Voucher entry | Enter field-to-field, Ctrl+A accept, Esc quit (Y / N), Alt+C create ledger / customer / vendor, Alt+D delete, F2 date field, F4–F7 change type in place, By / To with "Tally terms", single-entry mode, voucher class, user voucher types (7Q), bill-wise Agst Ref / New Ref / Advance / On Account, cost-centre column | `src/components/gateway/VoucherEntry.tsx`, `docs/features/voucher-types.md` |
| Master forms | Enter next, Ctrl+A accept, Esc back, Alt+C on `data-create` fields | `src/components/masters/useMasterKeys.ts`; Alt+C for stock items in bill lines (`purchases/LineItemsEditor.tsx`, `BillLineTracking.tsx`), transfers |
| Report grammar | Group Summary → ledger → monthly → vouchers → voucher; Enter / Esc; Alt+F1 detailed; F12 options per report (`mrchartist_report_prefs`); Alt+F2 shared period (`mrchartist_report_period`); comparative columns; saved views and month-end pack (8G, `mrchartist_report_views`); registers, exception reports, statistics, funds flow, ratios, interest, budgets, cost-centre P&L | `src/components/books/ledger/{DrillStack,drill-hooks,ReportToolbar,ReportViews}.tsx`, `src/components/books/PeriodBar.tsx`, `src/lib/{report-prefs,period-context,report-views}.ts`, `src/lib/ledger/*`, `docs/features/reports-engine.md` |
| Voucher variants | Optional, memorandum, post-dated, reversing (Books voucher editor, not the Gateway form) | `src/lib/ledger/voucher-variants.ts`, `components/books/tally/VoucherVariantFields.tsx` |
| POS keys | F1–F10, Shift / Ctrl / Alt variants, PageUp / PageDown, device-local overrides with a conflict check that already refuses Ctrl+F4, Alt+F4, bare F11 / F12 | `src/lib/pos.ts` `POS_SHORTCUTS`, `src/lib/pos-keys.ts` (`mrchartist_pos_keys`, `isAssignableCombo`) |
| Palette, help, dialogs | Ctrl+K palette (fuzzy, recents, Hindi synonyms, tab index), `/` search, `?` and Ctrl+/ shortcuts overlay, F1 Help "On this screen" (not on `/pos`, `/gateway`, in fields or dialogs), modal stack (only the top dialog acts on Esc / Tab), toast **Undo** with Alt+Z (R4-C4 recycle bin) | `src/components/command/{CommandPalette,ShortcutsOverlay}.tsx`, `src/hooks/useHotkeys.ts` (`GLOBAL_SHORTCUTS`), `src/lib/palette/*`, `src/lib/help/*`, `src/lib/modal-stack.ts`, `src/components/ui/{Modal,Toast}.tsx` |
| Editor | Ctrl+S / Ctrl+Enter save, Ctrl+P preview, Esc leave, Alt+R repeat the party's last bill, typed sums in amount fields (`calc-expr.ts`, "8.25 calculator") | `src/hooks/useCreatorKeys.ts`, `src/components/ui/NumberInput.tsx` |
| Tally data | Tally XML import (masters, vouchers, stock, payroll, TDS, bank) and export; Excel import of books | `src/lib/tally-{xml,xml-read,import,import-apply,import-stock,books,bank,payroll,tds,debit-notes}.ts`, `docs/features/import.md`, `exports.md` |
| Company / data | Company registry and switcher (6.20), PIN lock, users / rights, vault, backup / restore / auto-backup, start new year, books integrity check, audit trail (Tally edit log) | `src/lib/{companies,company-registry,auth,access,vault,backup,auto-backup,year-end,books-integrity,audit*}.ts`, `components/companies/CompanySwitcher.tsx` |

**Defects found while inventorying** (fixed by R20-A because they block the round):
- **Bug 1 · Option key on macOS.** `matchesEvent` (`useHotkeys.ts`) compares `e.key`; Option+G gives `e.key === '©'`, so
  **Alt+G, Alt+P, Alt+R, Alt+F2-style combos with letters do not fire on a Mac**. Only `isAltC` reads `e.code`. Fix:
  match letters and digits on `e.code` (`KeyG`, `Digit2`) whenever Alt is down.
- **Bug 2 · F5 hijacks reload for everyone** (§1.1). Fixed by the mode switch (U7).
- **Bug 3 · The shortcuts overlay is English only** (title, subtitle, `GLOBAL_SHORTCUTS` labels, "then", "(in editor)").
- **Bug 4 · Credit / debit note keys follow Tally.ERP 9** (Ctrl+F8 / Ctrl+F9). TallyPrime moved them to **Alt+F6 credit
  note / Alt+F5 debit note** and gave Ctrl+F8 / Ctrl+F9 to **Sales Order / Purchase Order** (P, §2.5). Both layouts
  are offered (A3).

### 1.4 Budgets the round must respect

Measured by the PRD author on `ae02b40` after PERF-5 (`npx vite build` + `node scripts/check-bundle-size.mjs`,
2026-10-29; the coordinator's figures agree):

| Budget | Now | Limit | Headroom | Round 20 share |
|---|---|---|---|---|
| Initial JS (first paint) | **177.9 kB** | 185 kB | 7.1 kB | **≤ 0 net.** A moves the `TALLY_KEYS` route table out of the shell and leaves a ≤ 0.35 kB claim stub (§4 A1) |
| Entry chunk | 89.5 kB | 100 kB | 10.5 kB | ≤ 0 net |
| Core precache (English) | **3,232.9 kB** | 3,300 kB | **67.1 kB** (≈ 61 kB after the 6 kB held for PENDING 45 / 49) | **≤ 30 kB gross for the whole round** (A ≤ 9, B ≤ 7, C ≤ 7, D ≤ 6; 1 kB lead reserve). Leaves ≈ 31 kB for Round 21 |
| Hindi pack | 369.4 kB | 400 kB | 30.6 kB | ≤ 8 kB |
| Hindi left in English chunks | 21.7 kB | 36 kB | 14.3 kB | **0** (literal `defineArea(en, hi)` only) |
| `lazy-leaves` | 17.6 kB | 20 kB | 2.4 kB | **0** |
| `lazy-leaves-ui` (PERF-5) | 13.3 kB | 20 kB | 6.7 kB | ≤ 1 kB (small `components/keys/*` leaves may land here; anything bigger goes into `f-keys`) |

**Family group.** The engine, registry, actions modules and their sheets import each other and lazy palette / report
code, so A adds **one row** `safeFamilyGroup(graph, 'f-keys', familyRe('keys', 'keys-r20'), 12)` to `vite.config.ts`
and the name to `tests/bundle-config.test.ts` (the R18 / R19 shape; the regex captures `src/lib/keys/*`,
`src/components/keys/*`, `src/i18n/areas/keys-r20a.ts`), unless `build-meta/chunks.json` shows the modules already sit
in one lazy chunk. Screens that call `useKeyActions` stay in their own chunks.

Calibration: R19 packages cost **≈ 1.5–2.5 kB per item with a view, 0.8–1 kB per engine-only item** (R19-D +11.1 kB
for 4 items). Round 20 is mostly **key rows (data) and handlers on screens that already exist** (≈ 0.1–0.3 kB a key)
plus ≈ 10 small sheets / dialogs (≈ 1–1.5 kB each with strings): ≈ 110 rows + 10 sheets + the engine land at
≈ 25–28 kB, inside 30 kB, with these rules:

- **One lazy key engine.** The shell keeps a stub that knows only the mode flag and a compact list of claimed combos (so
  `preventDefault` stays synchronous) and dynamically imports `src/lib/keys/engine.ts` on idle when the mode is on, on
  the first claimed key, or on `/gateway`. Everything else (rows, labels, Key bar, cheat sheet, dialogs) is lazy.
- **Rows are data, handlers live on the screen.** A screen registers handlers by row id (`useKeyActions(scope, {id:
  fn})`), so a key adds one row (≈ 60 B) plus a one-line handler; no screen grows a second keydown listener.
- **Reuse, never fork.** Go To = the Ctrl+K palette in a "Go To" mode, not a second search; filters reuse
  `ItemFilterBar` patterns; the cheat sheet replaces `ShortcutsOverlay.tsx`'s body (same file); undo reuses the toast
  action and the recycle bin.
- **A package that reaches its cap cuts** in its pre-ranked order (§3); it does not ask. Caps are ceilings, not targets:
  each package reports its real cost and the lead may lend unused room to a later package.

### 1.5 Icons

Reuse only. The Key bar and cheat sheet need: a keyboard-ish icon (the header already uses one for "Shortcuts" in
`DashboardLayout.tsx`, line ≈ 504 — reuse that exact name), `Search`, `Printer`, `Undo2` / `RotateCcw` **only if
already imported somewhere** (A greps first; else text "Undo"), `ChevronUp` / `ChevronDown` for the bar collapse
(already used). No icon is added for any key.

### 1.6 Non-goals

- **Tally's look.** No blue Tally theme, no fixed "Gateway" layout outside `/gateway`, no monochrome screens.
- **Re-implementing TDL**, add-ons, Tally's data path / company folder model, ODBC, Tally.NET users, remote access.
- **Online features:** connected banking (F6 / F7 / F8 / F10 bank-connection actions), TallyDrive (F6 refresh),
  Docs by Ira, e-Invoice / e-Way online send (`S` / `X` / `I`), Bharat Connect, WhatsApp / e-mail sending from the
  app (Ctrl+Alt+W, Ctrl+M stay "open the share sheet" using the existing share / `mailto:` paths).
- **Group company consolidation** (Tally Alt+R in company creation). A data feature, not a key; separate round.
- **A calculator panel** (Tally Ctrl+N / Alt+C in amount). Ctrl+N cannot be claimed; amount fields already evaluate
  typed sums (`calc-expr.ts`) and A adds a visible "type 120*3" hint chip instead.
- **Currency-symbol keys** (Ctrl+4 / Alt+4 for ₹, Ctrl+Shift+6 / 7). Typing ₹ belongs to the OS keyboard; amount
  fields take numbers.
- **Data-entry language** (Tally Ctrl+W): Ctrl+W closes the browser tab; Indic typing is the OS IME's job.

---

## 2. Findings

### 2.1 Gap table — every Tally key or feature

Status: **Have** (works today, same or better) · **Partial** (the feature exists but the key, the place or the Tally
behaviour is missing) · **Missing** · **N/A** (out of scope, §8). "Pkg" = the package that builds the easy version.
"Mode": **Always** = in the simple default; **Tally** = only with Tally keys on; **Gw** = always on `/gateway`.
Row ids carry a `K` (`GK1`, `VK1`, `EK1`, `RK1`, `MK1`) so the CA-id regexes (`G`, `R`, `M`, `E` … in
`tests/docs-links.test.ts`) never read them as CA items; this round has no CA items.

#### 2.1.1 Across the app

| # | Tally key / feature (what Tally does) | We have | Status | Easy version we build | Pkg |
|---|---|---|---|---|---|
| GK1 | **F1** Help menu | F1 opens Help "On this screen" (`DashboardLayout`), not on `/pos` / `/gateway` | Have | On `/gateway` F1 also opens Help (the Gateway handles no F1 today); key chip on the Help button | A |
| GK2 | **Ctrl+F1** help topic for this screen | F1 already is contextual | Partial | Ctrl+F1 = alias of F1 (Tally mode) | A |
| GK3 | **F2** change date (voucher date in entry, report date in reports) | F2 always jumps to the Gateway date dialog (leaves the screen); F2 inside Gateway voucher = date field | Partial | F2 acts **in place**: the date field in the editor / bill form / voucher, the "as at" or period-end date on a report, else the Gateway dialog. Chip on the date field | A (shell row), B (forms), C (reports) |
| GK4 | **Alt+F2** change period | Books `PeriodBar`, Gateway period dialog, shared period | Have | Chip on the period button; Hindi label already there | — |
| GK5 | **F3** switch company | Company switcher in the header (`CompanySwitcher.tsx`), reload per company | Partial | F3 opens the switcher's list with ↑ ↓ Enter; it already reloads safely. Chip on the switcher | D |
| GK6 | **Alt+F3** open company from another path / company info | Settings → Companies (create, open, demo) | Partial | Alt+F3 opens Settings → Companies | D |
| GK7 | **Ctrl+F3** shut company | PIN lock (`logout`), idle lock | Partial | Ctrl+F3 = Lock now (asks once when an editor is dirty) | D |
| GK8 | **F11** company features | `/settings?tab=defaults`, Features panel | Have | Keep; browser full screen also uses F11 (§5) — Key bar button is the twin | — |
| GK9 | **F12** configure (report options on reports) | F12 on Books reports (`ReportToolbar`), else Settings | Have | Keep; chip on "Options" | — |
| GK10 | **Alt+G Go To** — any report / voucher / master from anywhere, **opens on top of the current screen**, lists recently opened, finds alternate names ("daily entries" → Day Book) (P, V) | Alt+G navigates **to** `/gateway` with its Go To box; Ctrl+K palette searches pages / documents / tabs with Hindi synonyms and recents | Partial | Alt+G opens the **palette in Go To mode over the current screen**: Tally report names + plain names + Hindi, "Recently opened" first, Esc returns to exactly where you were (focus restored). On the Gateway it still focuses the Go To box | D |
| GK11 | **Ctrl+G Switch To** — replaces the current screen instead of stacking | Same as Alt+G today | Partial | Ctrl+G = Go To that navigates (no "return" chip). A Mac user gets ⌘G | D |
| GK12 | Multi-tasking: leave a half-done voucher, do something else, come back | Editor drafts autosave; Gateway voucher form is lost on navigation (asks Y / N) | Partial | A **"Back to your unfinished entry"** chip in the Key bar when a Gateway voucher or editor draft was left by Go To; the Gateway voucher keeps its typed lines in `sessionStorage` (per tab, never in a backup) | D (chip), B (voucher keep) |
| GK13 | **Esc** back / close | Esc closes dialogs (top of the modal stack), pops drill levels, quits voucher with Y / N, leaves the editor | Have | Chip "Esc Back" in every Key bar | — |
| GK14 | **Ctrl+Q** quit screen | Not claimable on Linux browsers / `⌘Q` on macOS (quits the browser) | Partial | Not claimed. Esc and a visible "Quit" button; cheat sheet row says "Ctrl+Q → use Esc" | A (doc row) |
| GK15 | **Alt+F4** quit Tally | OS key | N/A | Never claimed; listed in the conflicts table | — |
| GK16 | **Ctrl+A** accept / save | Gateway voucher and master forms | Partial | Ctrl+A accepts in the invoice editor, bill / PO / GRN forms, master forms and dialogs **in Tally mode**; Ctrl+S / Ctrl+Enter always. Outside a form Ctrl+A stays "select all". Toast with Undo after a new voucher | B |
| GK17 | Top menu **Alt+K** Company | Header company switcher, Settings | Missing (as a menu) | Alt+K opens a small **Company** sheet: switch (F3), features (F11), configure (F12), lock (Ctrl+F3), companies (Alt+F3), users. Same sheet from a Key bar button | D |
| GK18 | **Alt+Y** Data (backup, restore, repair, split, migrate) | Settings → Data (backup / restore / auto-backup / phone backup), start new year on the Gateway, books integrity check | Partial | Alt+Y opens a **Data** sheet: Back up now, Restore, Check data (Tally's "Repair" / Ctrl+Alt+R), Start new year, Recycle bin | D |
| GK19 | **Alt+Z** Exchange (sync, send) | Folder sync (5.7); **Alt+Z is our toast Undo** | Partial | Alt+Z stays **Undo** (the one key a layperson needs most); the Exchange actions go in the Data sheet. Cheat sheet row: "Tally Alt+Z → Data sheet (Alt+Y)" | A (doc row) |
| GK20 | **Alt+O** Import | Gateway Import & export (I), Settings import, `/exports` | Partial | Alt+O opens Import (Tally XML, Excel, bank statement) as the Gateway's Import sub-menu, over the current screen | D |
| GK21 | **Alt+E** Export / **Ctrl+E** export this | Per-report CSV / Excel buttons, `/exports` | Partial | On a report Ctrl+E presses the report's own Export button; Alt+E opens `/exports`. Alt+E is the Chrome menu on Windows (§5): Ctrl+E is the documented key | C |
| GK22 | **Alt+P** Print menu / **Ctrl+P** print this | Editor Ctrl+P preview; report print buttons | Partial | Ctrl+P on a report presses its Print button (the editor keeps its own). **Alt+P stays "POS counter"** (8E, users rely on it); cheat sheet row explains | C |
| GK23 | **Alt+M** Share / **Ctrl+M** e-mail | Share menu / send sheet on documents and statements | Partial | Ctrl+M on a document or statement opens its Share sheet (e-mail / WhatsApp / copy link-free text). No sending from the app | C |
| GK24 | **Ctrl+Alt+W** WhatsApp current | Share sheet has WhatsApp | Partial | Alias of Ctrl+M; never fires in a field (AltGr, §5) | C |
| GK25 | **Ctrl+K** display language | **Ctrl+K is our palette** (and language is in the header / Settings) | Partial | Ctrl+K stays the palette. Palette action "Language / भाषा" (exists via settings); cheat sheet row maps it | A (doc row) |
| GK26 | **Ctrl+W** data-entry language | Ctrl+W closes the browser tab | N/A | Never claimed | — |
| GK27 | **Ctrl+Alt+N** notifications | Notification bell | Missing (key) | Ctrl+Alt+N opens the bell popover (focus on the first item) | D |
| GK28 | **Ctrl+Alt+R** rewrite (repair) data | Books integrity check (`books-integrity.ts`), audit chain check | Partial | Ctrl+Alt+R opens "Check data" in the Data sheet (read-only report; nothing is rewritten) | D |
| GK29 | **Ctrl+Alt+B** build information | Help → What's new shows the version | Partial | Ctrl+Alt+B opens Help → About (version, storage used, companies) | D |
| GK30 | **Ctrl+Alt+T** TDL / add-on details | — | N/A | No add-ons | — |
| GK31 | **Alt+F** find bar / **Ctrl+F** filter (3.0+) | `/` search, Ctrl+K, per-list search boxes; Ctrl+F is the browser's find | Partial | On a **report** in Tally mode Ctrl+F opens the report filter (C5); elsewhere Ctrl+F stays the browser's find. Alt+F is not claimed (Chrome / Firefox menus on Windows) | C |
| GK32 | **Ctrl+N** calculator panel | Typed sums in amount fields | Partial | No panel (N/A for the key). A "=120*3" hint chip in amount fields when focused (Tally mode) | A (hint) |
| GK33 | Arrows, Home / End, PgUp / PgDn, Ctrl+Home / End, Ctrl+↑ / ↓ in lists and menus | Gateway menu (roving focus), report rows (`useDrillRows`: ↑ ↓ Home End PgUp PgDn Enter) | Partial | Same row navigation on the Day Book, registers and the Gateway Display viewer (C); the four main document lists (D5); other lists out of scope (§8) | C, D |
| GK34 | Underlined letters (Alt = single underline, Ctrl = double) open menu items | Gateway menu letters (with a Hindi badge) | Have (Gateway) | The Data / Company / Import sheets use the same letter badges | D |
| GK35 | **Right / bottom button bar** (every screen lists its keys as buttons) | Gateway `ButtonBar` only | Partial | **Key bar** on every screen in Tally mode (and always on the Gateway): the current screen's rows as buttons with chips, collapsible, scrollable on phones | A |
| GK36 | **Save View** (Ctrl+L on a report), **Ctrl+H** change view → Saved Views / Show original view / Delete, default view (P) | 8G saved views (device-local, Reports page) | Partial | On any Books / Gateway report: Ctrl+L "Save this view", Ctrl+H "Views" sheet (saved views of this report, Show original, Delete, Set as default) — same storage `mrchartist_report_views` | C |

#### 2.1.2 Opening vouchers (F10 menu equivalents)

| # | Tally key (TallyPrime) | We have | Status | Easy version | Pkg |
|---|---|---|---|---|---|
| VK1 | **F4** Contra | F4 → Gateway contra | Have | Plain name "Bank ↔ cash (Contra)" | — |
| VK2 | **F5** Payment | F5 → Gateway payment (always on, hijacks reload) | Partial | Tally mode only; simple mode leaves F5 to the browser (bug 2) | A |
| VK3 | **F6** Receipt | F6 → Gateway receipt | Have | Tally mode only | A |
| VK4 | **F7** Journal | F7 → Gateway journal | Have | Tally mode only | A |
| VK5 | **F8** Sales | F8 → `/invoice` | Have | Tally mode only | A |
| VK6 | **F9** Purchase | F9 → `/expenses?new=bill` | Have | Tally mode only | A |
| VK7 | **Alt+F6** Credit Note (Prime; ERP 9: Ctrl+F8) | Ctrl+F8 → `/invoice?type=CREDIT_NOTE` | Partial | Prime layout: Alt+F6; ERP 9 layout: Ctrl+F8 (A3) | A |
| VK8 | **Alt+F5** Debit Note (Prime; ERP 9: Ctrl+F9) | Ctrl+F9 → sales DN, or purchase-return DN on `/expenses` | Partial | Prime: Alt+F5 (same `/expenses` rule); ERP 9: Ctrl+F9. On a report Alt+F5 is "detailed" (C) — the report scope wins | A |
| VK9 | **Ctrl+F8** Sales Order (Prime) | `/invoice?type=SALES_ORDER` exists, no key | Missing (key) | Prime layout: Ctrl+F8 | A |
| VK10 | **Ctrl+F9** Purchase Order (Prime) | Expenses → Orders tab (`purchase_orders`) | Missing (key) | Prime layout: Ctrl+F9 → `/expenses?tab=orders` new PO | A |
| VK11 | **Alt+F8** Delivery Note | `/invoice?type=DELIVERY_CHALLAN` | Missing (key) | Alt+F8 → new delivery challan ("Delivery note") | A |
| VK12 | **Alt+F9** Receipt Note (GRN) | Gateway Vouchers **G** → `/expenses?tab=returns&new=grn` | Missing (key) | Alt+F9 → the GRN form | A |
| VK13 | **Alt+F7** Stock Journal | Alt+F7 → `/manufacturing?tab=journal` | Have | — | — |
| VK14 | **Ctrl+F7** Physical Stock | Ctrl+F7 → `/manufacturing?tab=physical` | Have | — | — |
| VK15 | **Ctrl+F4** Payroll voucher | `/payroll` (runs) | Missing (key) | **Ctrl+F4 closes the browser tab** (§5): our key **Ctrl+Shift+F4**, and the Vouchers sheet row "Payroll" | A |
| VK16 | **Ctrl+F5** Rejection Out | Purchase returns (`/expenses?tab=returns`), Manufacturing → Rejections | Missing (key) | Ctrl+F5 (Tally mode; it is "hard reload" in browsers) → purchase return; POS keeps its own Ctrl+F5 | A |
| VK17 | **Ctrl+F6** Rejection In | Credit note with restock (`credit-restock.ts`), Manufacturing → Rejections | Missing (key) | Ctrl+F6 → credit note with "goods came back" ticked | A |
| VK18 | **F10** list of all vouchers (other vouchers) | Gateway Vouchers screen (V) | Partial | F10 opens a **Vouchers sheet** over the current screen: every voucher with its key and plain name, letters to pick. The answer for every key a browser or Mac will not give us | A |
| VK19 | Voucher types (user-defined) | 7Q voucher types, picker on the Gateway | Have | — | — |

#### 2.1.3 Inside voucher / document entry

| # | Tally key / feature | We have | Status | Easy version | Pkg |
|---|---|---|---|---|---|
| EK1 | **Enter** next field, Enter on empty ledger ends lines | Gateway voucher, master forms | Partial | Same in the bill / PO / GRN forms (Tally mode; Enter in a line grid already adds lines in the editor) | B |
| EK2 | **Alt+C** create master on the fly | Gateway voucher (ledger, customer, vendor), master forms, stock items in bill lines | Partial | Alt+C on the editor's party and item pickers and the bill form's vendor picker (opens the existing quick-create dialogs, name pre-filled) | B |
| EK3 | **Ctrl+Enter** alter the master in this field | — | Missing | Ctrl+Enter on a party / item / ledger picker opens that master's edit dialog (exists) and returns to the field | B |
| EK4 | **Alt+D** delete voucher | Gateway voucher (altering) with Y / N | Partial | Same in the editor and bill form (Tally mode), plus a toast **Undo** (recycle bin) on all three | B |
| EK5 | **Alt+X** cancel voucher | Invoices can be cancelled (status) | Partial | Alt+X on an invoice / note in the editor or Day Book = Cancel (asks reason once); toast Undo restores the status. Manual vouchers: Alt+X = delete-to-bin with the number kept reserved (no "cancelled" voucher kind is added) | B |
| EK6 | **Ctrl+D** remove a line | Line delete buttons | Missing | Ctrl+D deletes the focused line in the editor, bill and voucher grids (toast Undo restores the line) | B |
| EK7 | **Ctrl+T** post-dated | Books voucher editor variant (`voucher-variants.ts`) | Partial | Ctrl+T opens a new browser tab and cannot be claimed (§5.1): our key is **Alt+T**, toggling "Post-dated" on the Gateway voucher (a chip next to the date is the twin) | B |
| EK8 | **Ctrl+L** optional voucher | Books voucher editor variant | Partial | Ctrl+L toggles "Optional (not in books yet)" on the Gateway voucher | B |
| EK9 | Memorandum voucher (ERP 9 Ctrl+F10) | Books voucher editor variant | Partial | A "Memo (note only)" choice in the same chip; no key (Ctrl+F10 is the browser menu bar on some systems) | B |
| EK10 | **Ctrl+H** change voucher mode (item / accounting invoice, as voucher, double / single entry) | Single-entry mode on Gateway contra / payment / receipt | Partial | Ctrl+H on the Gateway voucher toggles single / double entry; in the editor Ctrl+H toggles "Item lines / Amount only" when the document type allows it | B |
| EK11 | **Ctrl+I** more details for this instance | Editor "More" sections | Partial | Ctrl+I opens the focused line's / party's detail panel (exists) | B |
| EK12 | **Alt+J** stat adjustment | GST set-off journals, TDS payables | N/A (key) | No key; the Vouchers sheet links "GST adjustment" | — |
| EK13 | **Alt+S** stock query for the item | Inventory → Stock query tab (`StockQueryTab.tsx`, `stock-query.ts`) | Partial | Alt+S on an item line opens the stock query for that item in a side sheet (read-only), Esc returns to the line. Alt+S is Firefox's History menu on Windows: cut-1 alias **Ctrl+Shift+S** | B |
| EK14 | **Ctrl+O** related reports (party ledger, outstanding) | `PartyHabitsStrip` shows party facts in the editor | Partial | Ctrl+O on a party opens a side sheet: outstanding, last 5 bills, ledger link. Ctrl+O is "open file" in browsers (claimable) | B |
| EK15 | **Alt+A** GST tax analysis | Editor summary shows the tax break-up | Partial | Alt+A scrolls to and opens the tax break-up (rate-wise table) | B |
| EK16 | **Alt+R** narration from the party's previous voucher; **Ctrl+R** from the previous voucher of this type | Editor Alt+R = repeat the party's last **bill** (R3-B6) | Partial | Ctrl+R in a **narration / notes field** copies the last narration of this voucher type; Alt+R in the narration field copies the party's last narration (outside the field Alt+R keeps "repeat last bill"). Never claims Ctrl+R outside a narration field (reload) | B |
| EK17 | **Ctrl+Alt+U** unused voucher numbers | Number gap check in `voucher-series.ts` | Partial | No key (AltGr); the voucher number field gets a "Gaps in this series" link | — (cut) |
| EK18 | **Alt+Q** edit log of this voucher | Activity timeline in document actions; Settings → Activity | Partial | Alt+Q opens the document's / voucher's activity timeline | B |
| EK19 | **PgUp / PgDn** previous / next voucher while altering | — | Missing | On the Gateway voucher and the editor (altering a saved document): PgUp / PgDn = previous / next of the same type, asking Y / N when changed | B |
| EK20 | **Alt+2** duplicate voucher | Duplicate invoice exists | Partial | Alt+2 duplicates the open document / voucher (new number on save); toast Undo | B |
| EK21 | **Ctrl+C / Ctrl+V** in fields | Browser native | Have | Never claimed | — |
| EK22 | Esc quit with "Quit? Y / N" | Gateway voucher | Have | Same words in the editor exit (drafts autosave, so the question is only for a dirty saved document) | — |
| EK23 | Bill-wise (Agst Ref, New Ref, Advance, On Account), cost-centre allocation, voucher class, By / To | Gateway voucher | Have | — | — |
| EK24 | **Ctrl+F** autofill stat vouchers | GST / TDS payment helpers | N/A (key) | — | — |

#### 2.1.4 Reports

| # | Tally key / feature | We have | Status | Easy version | Pkg |
|---|---|---|---|---|---|
| RK1 | **Enter** drill down / **Esc** up | DrillStack, Gateway Display | Have | — | — |
| RK2 | **Alt+F1** detailed / condensed | Books reports (`ReportToolbar`) | Have | Gateway Display too; chip on the toggle | C |
| RK3 | **Alt+F5** detailed / condensed (Prime alternative) | — | Missing | Alias of Alt+F1 on reports | C |
| RK4 | **F12** configure | Per-report options | Have | — | — |
| RK5 | **Ctrl+B** basis of values (e.g. include post-dated / optional, budget, scenario) (P) | F12 options; variants are left out of the books by design | Partial | Ctrl+B "Show values as": include optional, include post-dated, show budget column (Books budgets), cost centre | C |
| RK6 | **Ctrl+H** change view / **Ctrl+L** save view | 8G saved views (Reports page) | Partial | See GK36 | C |
| RK7 | **Ctrl+J** exceptions for this report | Books → Reports → Exception reports (all) | Partial | Ctrl+J opens the exception list filtered to this report's ledgers (cash below zero, debtors in credit …); a red count chip when any | C |
| RK8 | **Ctrl+F / Alt+F12** filter with conditions (range of amounts, dates, party, narration) | Report-specific search boxes only | Missing | Ctrl+F opens a **plain filter**: "Amount between … and …", "Date from / to", "Party / ledger contains", "Narration contains"; a filter chip shows on the report; Esc clears | C |
| RK9 | **Ctrl+F12** balances from filtered vouchers | — | Missing | A "Totals of what you see" footer while a filter is on | C |
| RK10 | **Space** select a line, **Shift+Space**, **Ctrl+Alt+I** invert, **Shift+↑ / ↓** extend | — | Missing | Space ticks a row (a visible checkbox column appears); the selection footer shows count and total; Ctrl+Alt+I (outside fields) inverts. Selected rows feed Ctrl+R / Print / Export | C |
| RK11 | **Shift+Enter** expand / collapse | Detailed toggle; row `children` | Partial | Shift+Enter expands / collapses the focused row (a ▸ twist button is the twin) | C |
| RK12 | **Ctrl+Enter** alter master / open voucher | Enter opens the voucher | Partial | Ctrl+Enter on a ledger / party row opens its master | C |
| RK13 | **Ctrl+R** hide line, **Ctrl+U** restore last hidden, **Alt+U** restore all | — | Missing | Ctrl+R hides the focused / selected rows ("3 rows hidden · Show all" chip = Alt+U); never saved; totals marked "of shown rows". Ctrl+R outside a report = browser reload (not claimed) | C |
| RK14 | **+ / −** next / previous date or report in a sequence | — | Missing | `+` / `−` (also `]` / `[`) move the report period one step (month / quarter / FY by the preset); chip on the period button | C |
| RK15 | **Alt+C / Alt+A / Alt+D / Alt+N** add / alter / delete / auto-repeat columns | Comparative columns picker (previous, monthly, quarterly) on Group Summary, P&L, TB, BS | Partial | Alt+N opens the column picker; Alt+C "Add a period column"; Alt+D removes the last added. On a **report** these win over voucher meanings | C |
| RK16 | **Alt+I** insert voucher / **Alt+A** add / **Alt+2** duplicate / **Alt+D** delete / **Alt+X** cancel **from a report** (Day Book, ledger vouchers) | Open voucher via Enter, then act | Missing | On Day Book / ledger-voucher rows: Alt+I new voucher of that type dated that day, Alt+2 duplicate, Alt+D delete (Y / N, Undo), Alt+X cancel (B's action). Alt+A on vouchers rows = Alt+I (Tally uses both) | C |
| RK17 | **Alt+F6 / Alt+F7 / F4 / F5 / F6 / F7 / F8 / F10** bank and GST report keys (Prime) | BRS, cheques, GST papers | Partial | Report-scoped rows where the screen has the action (e.g. F5 "Show reconciled" on BRS, F5 "Nature / Return view" on GSTR-1 tab switch); connected-banking keys are N/A | C (cut 2) |
| RK18 | Day Book, Trial Balance, P&L, Balance Sheet, Group / Ledger summaries, Cash / Funds flow, Ratio analysis, Statistics, Columnar registers, Exception reports, Outstandings / ageing, Interest, Budgets, Cost-centre reports, Stock summary / ageing / movement / reorder, BRS, Cheque register / printing, GST / TDS papers, Payroll reports | All built (WP-2, 7N, 7S, 8G, Phases 5–8) | Have | Go To finds each by its Tally name (D) | D |
| RK19 | Horizontal Balance Sheet (Liabilities / Assets) | Schedule III vertical only | Partial | Out of scope (§8; a layout choice, not a key) | — |
| RK20 | Scenarios (optional / memo / reversing vouchers grouped as a "what if") | Variants exist, no scenario report | Partial | Ctrl+B "include optional" covers the common use; full scenarios out of scope | C (via RK5) |

#### 2.1.5 Company, masters, data

| # | Tally feature | We have | Status | Easy version | Pkg |
|---|---|---|---|---|---|
| MK1 | Create / Alter / Chart of accounts, groups, ledgers, cost centres, godowns, price levels, units, voucher types | Gateway C / A / H, masters screens | Have | — | — |
| MK2 | F11 features: bill-wise, cost centres, interest, multi-currency, inventory, GST / TDS / TCS / payroll on or off | Settings → Defaults / Features, industry packs, shop mode | Have | — | — |
| MK3 | Security control, users, Tally Vault | PIN, local users and rights, vault mode | Have | — | — |
| MK4 | Backup / restore, split company, start new year | Settings → Data, Gateway Y | Have | Data sheet (GK18) | D |
| MK5 | Edit log (Tally Audit) | Audit trail, MCA edit-log archive | Have | Alt+Q (EK18) | B |
| MK6 | Multi-currency, rates of exchange, forex gain / loss | `fx.ts`, `currency-rates.ts`, `fx-gain.ts` | Have | — | — |
| MK7 | Interest calculation, budgets, cost centres | WP-2 interest, Books budgets, cost-centre P&L | Have | — | — |
| MK8 | Banking: BRS, cheque printing, cheque register, deposit slip, payment advice, e-payments file | `/reconcile`, `/cheques`, Gateway Banking | Have | — | — |
| MK9 | Connected banking, Tally.NET, TallyDrive, remote access, Docs by Ira, online e-Invoice / e-Way send | — | N/A | Local-first (§8) | — |
| MK10 | Group company consolidation | — | N/A | §8 | — |
| MK11 | Tally XML import / export, Excel import with sample files (Alt+L) | Tally XML both ways, Excel import with templates | Have | Alt+O (GK20) | D |
| MK12 | Language (display / entry) | English / Hindi (+ regional pack) | Have | Palette action | — |

### 2.2 Gap counts

| | Have | Partial | Missing | N/A | Total |
|---|---|---|---|---|---|
| Across the app (GK1–GK36) | 6 | 25 | 2 | 3 | **36** |
| Opening vouchers (VK1–VK19) | 8 | 4 | 7 | 0 | **19** |
| Voucher / document entry (EK1–EK24) | 3 | 16 | 3 | 2 | **24** |
| Reports (RK1–RK20) | 4 | 9 | 7 | 0 | **20** |
| Company, masters, data (MK1–MK12) | 10 | 0 | 0 | 2 | **12** |
| **Total** | **31** | **54** | **19** | **7** | **111** |

(Counted from the Status column; "Missing (key)" counts as Missing, "N/A (key)" as N/A.) Reading: **the features are
almost all there**; what is missing is reach (keys that open them in place, over the current screen), the TallyPrime
layout, report-row actions (select / hide / filter / insert) and the easy layer (mode switch, Key bar, cheat sheet,
Hindi, undo).

### 2.3 What makes Tally hard, and our answer

| Tally difficulty | Our answer |
|---|---|
| Keys are invisible until learned; the button bar is dense and English-only | Key bar per screen with plain names first, Hindi, collapsible; chips on the real buttons |
| The same key means different things on different screens (Alt+A, Alt+S, F5 …) | One registry with **scopes**; the cheat sheet's "This screen" view shows exactly what a key does here |
| No undo; deletes are final | Toast Undo (Alt+Z) on every write a key makes; recycle bin behind it |
| Dr / Cr, By / To, "Sundry Debtors" | Plain names first, Tally names on demand ("Tally terms") |
| Keyboard only; mouse is second-class | Every key has a button (U1); touch-size targets; phones get a Keys sheet |
| Two layouts across versions (ERP 9 vs Prime) | A layout setting (Prime default for new users, ERP 9 kept for existing devices) |

### 2.4 Verified against the code (`b1b33c2`)

- `resolveTallyKey` returns null while typing, while `[aria-modal="true"]` exists, and on `/pos`; role-checked by `need`.
  `useTallyKeys` listens in the bubble phase, so screens that `preventDefault` first win. The Gateway's
  `GatewayShell` has one capture-phase listener and a per-screen handler (`useScreenKeys`). Books' `ReportToolbar` and
  `PeriodBar` listen in the capture phase for Alt+F1, F12, Alt+F2.
- `useHotkeys` refuses `mod+s` / `mod+p` (`RESERVED_COMBOS`), runs two-key `g` sequences (900 ms), and matches on
  `e.key` (bug 1).
- `ShortcutsOverlay` = `GLOBAL_SHORTCUTS` + `tallyShortcuts()` + `extra`; English title (bug 3). It is lazy (mounted on
  first open).
- `ButtonBar` builds its buttons from `TALLY_KEYS` and fires the overlay by dispatching a synthetic Ctrl+/.
- `pos-keys.ts` `isAssignableCombo` already encodes the browser conflict rule for POS (Ctrl / Alt+F4, bare F11 / F12,
  Ctrl+letter refused). R20-A lifts it into one shared `NEVER_CLAIM` list that POS keeps using.
- `Toast` supports an action with Alt+Z ("Undo") — R4-C4.
- `mrchartist_tally_terms` lives in `src/lib/gateway/period.ts` (`getTallyTerms` / `setTallyTerms`), device-local.

### 2.5 Sources

- **P** TallyHelp, "Keyboard Shortcuts in TallyPrime"
  (https://help.tallysolutions.com/tally-prime/keyboard-shortcuts/keyboard-shortcuts-tally-prime/), fetched 2026-10-29:
  Across TallyPrime (F1, Ctrl+F1, F2, Alt+F2, F3, Alt+F3, Ctrl+F3, F11, F12, Alt+G, Ctrl+G, Alt+K / Y / Z / O / E / M /
  P, Ctrl+K, Ctrl+W, Ctrl+N, Ctrl+M, Ctrl+A, Ctrl+Q, Alt+F4, Ctrl+Alt+N / R / B / T / I / W, navigation keys); Reports
  (Alt+F1, Alt+F5, Ctrl+B, Ctrl+H, Ctrl+J, Ctrl+F / Alt+F12, Ctrl+F12, Space, Shift+Enter, +, −, Alt+C / A / D / N,
  Ctrl+R, Ctrl+U, Alt+U, Ctrl+Enter, Alt+I, Alt+2, Alt+X, Alt+D, bank / GST F-keys); Vouchers & Masters (Alt+D, Alt+X,
  Ctrl+D, Ctrl+T, Ctrl+L, Ctrl+I, Ctrl+H, Alt+J, Alt+S, F10, Ctrl+O, Alt+A, Alt+R, Ctrl+R, Alt+C, Ctrl+F, Ctrl+Alt+U,
  Alt+Q, Alt+4 / Ctrl+4, PgUp / PgDn); Open vouchers (F4 Contra, F5 Payment, F6 Receipt, F7 Journal, F8 Sales, F9
  Purchase, Alt+F7 Stock Journal, Ctrl+F7 Physical Stock, Alt+F8 Delivery Note, Ctrl+F8 Sales Order, Alt+F9 Receipt
  Note, Ctrl+F9 Purchase Order, Alt+F6 Credit Note, Alt+F5 Debit Note, Ctrl+F4 Payroll, Ctrl+F6 Rejection In, Ctrl+F5
  Rejection Out; the page notes ERP 9 used Ctrl+F8 / Ctrl+F9 for credit / debit notes).
- **P** TallyHelp, "How to save views of reports in TallyPrime" and "Use Save View feature"
  (https://help.tallysolutions.com/tally-prime/how-to-save-views-of-reports-in-tallyprime/,
  https://help.tallysolutions.com/use-save-view-feature-in-tallyprime/): Ctrl+L save view, Ctrl+H → Saved Views /
  Show Original View / Delete Saved Views, default view, Ctrl+B basis of values (search-result extracts; **S** for the
  exact menu wording).
- **P** TallyHelp, "Company Features in TallyPrime (F11)" (https://help.tallysolutions.com/company-features-f11-tally/):
  bill-wise on by default; cost centres and interest behind "Show more features" (search-result extract, **S**).
- **V** Tally Solutions blog, "TallyPrime's Go To — a powerful capability to discover"
  (https://tallysolutions.com/tally/tallyprimes-go-to-a-powerful-capability-to-discover/): Go To from any screen,
  alternate names ("warehouse summary", "daily entries"), list of opened reports, return to unfinished work.
- **S** TallyHelp search extracts on Switch To (Ctrl+G replaces the screen; Go To stacks on top) and the underline rule
  (Alt for single underline, Ctrl for double).
- Browser behaviour (§5) is from the PRD author's knowledge of Chromium / Firefox / Safari key handling; every "B-test"
  row is confirmed in the R20-A browser matrix before the key ships (§5.3).

---

## 3. Ranked list: what to build now

Ranked by value to the two audiences (Tally hand / layperson) ÷ size. Cuts are pre-ranked per package (last cut first).

| Rank | Item | Pkg | Value | Size (kB, core) | Cut order |
|---|---|---|---|---|---|
| 1 | Tally keys mode switch + lazy key engine + stub (fixes F5, bug 1 Mac Option) + `f-keys` group | A | 3 | 2.0 | never |
| 2 | Registry of every key (≈ 110 rows, scopes, Prime / ERP 9 layouts, never-claim list) | A | 3 | 1.6 | never |
| 3 | Cheat sheet (bilingual, search, This screen, print) replacing the overlay body | A | 3 | 1.6 | A cut 2 drops the print layout |
| 4 | Key bar per screen + chips + phone Keys sheet + amount hint chip | A | 3 | 1.5 | A cut 3 drops the hint chip |
| 5 | Vouchers sheet (F10) + Prime voucher keys (Alt+F5 / F6, Ctrl+F8 / F9, Alt+F8 / F9, Ctrl+Shift+F4, Ctrl+F5 / F6) | A | 2 | 0.8 | A cut 1 drops Ctrl+F5 / F6 |
| — | Row labels for the whole round (English; Hindi goes to the pack) | A | — | 1.3 | shared words once |
| 6 | Ctrl+A / Alt+C / Ctrl+Enter / Alt+D / Ctrl+D in the editor and bill forms, with Undo | B | 3 | 2.2 | never |
| 7 | Gateway voucher: Alt+T, Ctrl+L, memo chip, Ctrl+H mode, PgUp / PgDn, keep typed lines | B | 2 | 1.5 | B cut 2 drops PgUp / PgDn |
| 8 | Ctrl+R / Alt+R narration, Alt+2 duplicate, Alt+X cancel, Alt+Q edit log | B | 2 | 1.0 | B cut 1 drops Alt+R narration |
| 9 | Side sheets: Alt+S stock query, Ctrl+O related, Alt+A tax analysis, Ctrl+I details | B | 2 | 1.6 | B cut 3 drops Ctrl+O |
| 10 | Report filter (Ctrl+F) + totals of shown rows | C | 3 | 1.8 | never |
| 11 | Select (Space / Ctrl+Alt+I) + hide / restore (Ctrl+R / Ctrl+U / Alt+U) | C | 2 | 1.3 | C cut 2 drops invert |
| 12 | Views (Ctrl+H / Ctrl+L), basis (Ctrl+B), exceptions (Ctrl+J), Alt+F5, Shift+Enter, Ctrl+Enter, + / − | C | 2 | 1.8 | C cut 3 drops Ctrl+B |
| 13 | Row actions from reports (Alt+I / Alt+2 / Alt+D / Alt+X) + print / export / share keys | C | 2 | 1.0 | C cut 1 drops bank / GST report F-keys (RK17) |
| 14 | Go To over the current screen (palette Go To mode, Tally names, return chip), Ctrl+G | D | 3 | 1.4 | never |
| 15 | Company / Data / Import sheets (Alt+K / Alt+Y / Alt+O), F3, Alt+F3, Ctrl+F3, Ctrl+Alt+N / R / B | D | 2 | 1.5 | D cut 1 drops Ctrl+Alt+B, cut 2 drops Alt+F3 |
| 16 | List keys on the main document lists (D5): ↑ ↓ Enter, Space select, Alt+D / Alt+X / Alt+2 on the focused row | D | 2 | 1.8 | D cut 3 drops Space selection |
| 17 | Onboarding question "Have you used Tally?" + What's new note | D | 2 | 0.4 | D cut 4 drops the wizard question (the switch stays) |

**Total ≈ 27 kB** against a 29 kB package sum (A 9 + B 7 + C 7 + D 6) + 1 kB lead reserve = **30 kB**.

---

## 4. Specifications

### R20-A — Key engine, Tally keys mode, registry, cheat sheet, Key bar (merge first)

#### A1 Mode switch and the lazy engine
- **Preference** `mrchartist_tally_keys` (device-local, outside the `mrchartist_inv_` prefix; listed with the other
  viewing preferences in `AGENTS.md` by the lead): `'off' | 'on'`, plus `mrchartist_tally_layout`: `'prime' | 'erp9'`.
  Read / written next to `mrchartist_tally_terms` in `src/lib/gateway/period.ts` (fail-soft try / catch, as today).
- **Default (no migration of data, no surprise for anyone):**
  - absent and the device has **any** earlier sign of use (`mrchartist_whats_new_seen` set to a version before the
    Round 20 version, or `mrchartist_tally_terms` / `mrchartist_report_prefs` present) → **on**, layout **erp9**
    (exactly today's behaviour; What's new tells them the switch exists and that F5 reload returns when off);
  - absent on a fresh device → **off**, layout **prime** when first switched on.
- **Where the switch lives (all twins, U1):** the cheat sheet header, the Gateway menu (next to "Tally terms"), Settings →
  Defaults (one row), a Ctrl+K action "Tally keys on / off" (Hindi "टैली कुंजियाँ चालू / बंद"), the onboarding question
  (D4). Switching announces "Tally keys on" in a polite live region.
- **Shell stub** (`src/lib/keys/stub.ts`, first paint, ≤ 0.35 kB gz): replaces `useTallyKeys` in `DashboardLayout`.
  It holds the mode, a compact claimed-combo list per layout (generated into a string constant by a unit-tested helper,
  so the stub never imports the registry), and one bubble-phase `keydown` listener. On a claimed combo (outside fields
  for plain / F-keys, no `[aria-modal]`, not `/pos`) it calls `preventDefault()` synchronously, then
  `import('./engine')` and hands the event's plain fields to `engine.dispatch`. On idle (`requestIdleCallback`, as the
  editor prefetch does) with the mode on, or on `/gateway`, it preloads the engine.
- `src/lib/tally-keys.ts` keeps `resolveTallyKey`'s rules but its route table moves into the lazy registry; the shell
  copy shrinks. **Net first paint ≤ 0** (A records before / after in `docs/features/tally-keys-r20.md`).
- **Bug 1 fix** in `useHotkeys.ts` `matchesEvent`: when `altKey` is down and the combo key is a letter or digit, compare
  `e.code` (`KeyG`, `Digit2`); unit test with `{ key: '©', code: 'KeyG', altKey: true }`.
- **Acceptance:** fresh device: F5 reloads, F8 does nothing, `?` and Ctrl+K work; switch on: F8 opens the editor;
  existing device (seeded `mrchartist_whats_new_seen`): F5 opens Payment as today; Mac Option+G opens Go To; first
  paint not larger.

#### A2 Registry (`src/lib/keys/registry.ts`, lazy)
- One row per key per scope: `{ id, combo: { prime, erp9? }, scope: 'global' | 'gateway' | 'voucher' | 'editor' |
  'bill' | 'report' | 'reportRow' | 'list' | 'field:narration' | 'field:picker' | 'field:amount', mode: 'always' |
  'tally', plain: LabelKey, tally?: LabelKey, twin: string, need?: AccessAction, pkg: 'A' | 'B' | 'C' | 'D', route? ,
  browser?: 'safe' | 'claim-tally-only' }`. A writes **every row of the round in one commit** from
  `round-20-shortcuts.md` (B–D only implement handlers), so the cheat sheet and conflict tests see the whole map.
- `BUILT = new Set(['A'])`: each package adds its letter in its merge (one line). Rows of an unbuilt package never show.
- **Scopes resolve most-specific first**: field → row → screen → global; on a report, Alt+F5 / Alt+C / Alt+D / Alt+A are
  report actions, elsewhere voucher actions (the Tally rule). A screen claims a scope with
  `useKeyActions(scope, { [rowId]: handler })` (`src/lib/keys/use-key-actions.ts`, lazy, ≤ 40 lines); the engine fires
  the top-most registered handler for the row, else the row's `route`.
- `NEVER_CLAIM` (§5.1) is data in the same file; `isAssignableCombo` in `pos-keys.ts` reads it (one import; POS
  behaviour unchanged, its tests pass).
- **Acceptance (`tests/keys-registry.test.ts`):** ids unique; no combo appears twice in one scope and layout; no row
  uses a `NEVER_CLAIM` combo; every row has a `twin` and Hindi labels; every `mode: 'always'` row is one of the
  simple-mode set; the stub's claimed list equals the registry's global rows (generated, compared).

#### A3 Layouts
- **prime** (TallyPrime): Alt+F6 credit note, Alt+F5 debit note, Ctrl+F8 sales order, Ctrl+F9 purchase order, Alt+F8
  delivery note, Alt+F9 receipt note, Ctrl+F5 / Ctrl+F6 rejection out / in, Ctrl+Shift+F4 payroll.
- **erp9**: Ctrl+F8 credit note, Ctrl+F9 debit note (today's mapping), Alt+F8 / Alt+F9 as prime; sales / purchase
  order only through F10 (VK18).
- A picker "Key layout: TallyPrime / Tally.ERP 9" in the cheat sheet header (only while Tally keys are on).

#### A4 Cheat sheet (replaces the body of `ShortcutsOverlay.tsx`; same lazy mount, `?` and Ctrl+/)
- Columns: **What it does** (plain, current language) · **Tally name** · **Key** (chips; "then" localised). Search box
  (English, Hindi, Tally name, key text such as "f5"); tabs **This screen** (default when the screen has rows) / **All**;
  groups: Go to, Vouchers, While entering, Reports, Company & data, This app.
- Rows show for the current layout and mode; with the mode off, Tally rows show dimmed with "Switch on Tally keys to use"
  and the switch beside it (so a learner discovers them without being surprised).
- "Not in a browser" rows (Ctrl+W, Ctrl+N, Alt+F4, Ctrl+Q) say what to use instead.
- **Print**: `@media print` one-column A4 list; the print button uses `window.print()` on the dialog content only.
- `GLOBAL_SHORTCUTS` labels and `ShortcutsOverlay` strings move to the `keys-r20a` area (bug 3 fixed).
- **Acceptance:** search "भुगतान" finds Payment; "f5" finds Payment with the layout's note; This screen on `/books?tab=tb`
  lists report keys; print preview fits one page for "This screen".

#### A5 Key bar and chips
- `KeyBar.tsx` (lazy, mounted once by `DashboardLayout` when the mode is on or on `/gateway`): a `role="toolbar"` row
  fixed at the bottom of the content area (above the phone tab bar, respecting `--tab-bar-h`), listing the current
  scope's built rows that have a handler or route, plain name + chip, overflow scroll, collapse to a single "Keys"
  button (state in `mrchartist_tally_keys` as `on:collapsed`). Gateway keeps its own `ButtonBar` (now built from the
  registry) and the Key bar stays hidden there.
- `KeyChip` (CSS only, `keys.module.css`): `<kbd>` styled with tokens; `aria-hidden` (the button carries
  `aria-keyshortcuts`). Screens add chips through `data-key-row="<rowId>"` on an existing button; the engine renders
  chips into a `::after` attribute (`data-key-chip`) so screens need no JSX change (pure CSS `content: attr()`).
- Phones (≤ 900 px): the Key bar becomes a floating "Keys" pill that opens the list as a bottom sheet (a `Modal`, in
  the modal stack).
- Amount fields (`NumberInput`) show a "=120*3" hint chip on focus in Tally mode (GK32).
- **Acceptance:** e2e: Tally mode on, `/books?tab=tb` Key bar lists ≥ 6 rows; clicking "Detailed" toggles like Alt+F1;
  390 px width shows the pill and the sheet.

#### A6 Strings, help, palette
- `src/i18n/areas/keys-r20a.ts` (≤ 1.6 kB gz English): every row's plain / Tally label for the whole round, cheat sheet
  and Key bar strings. B–D areas hold only their dialogs' strings.
- Help: new topic `tally-keys` (≤ 160 chars per language) in `topics-books.ts`; the `gateway` topic links it; the
  `gateway` tip in `tips.ts` changes to "Press ? for every key — plain names and Tally names".
- Palette: actions "Tally keys on / off", "Keyboard cheat sheet", "Key layout" with Hindi synonyms in
  `palette/synonyms.ts`.

### R20-B — Voucher and document entry (after A)

| Item | Spec | Acceptance |
|---|---|---|
| B1 Accept / create / alter | Ctrl+A accepts the editor, bill / PO / GRN forms and master dialogs in Tally mode (outside a text selection intent: Ctrl+A in a **text** field accepts only in Tally mode, as Tally does — the cheat sheet says "select all: Shift+Home / Shift+End"). Alt+C on party / item / vendor pickers opens the existing quick-create, name pre-filled. Ctrl+Enter on a picker opens that master to alter, returning focus to the picker | `tests/keys-entry.test.ts` (pure helpers); e2e: F8, type a new party, Alt+C, save, Ctrl+A saves the invoice |
| B2 Delete / remove line / duplicate / cancel | Alt+D (Y / N) in the editor and bill form; Ctrl+D deletes the focused line; Alt+2 duplicates the open document / voucher; Alt+X cancels an invoice / note (reason once). Every one shows a toast with **Undo** (Alt+Z): delete restores from the recycle bin through the existing restore call (never `writeRaw`), cancel restores the status, duplicate removes the unsaved copy, Ctrl+D re-inserts the line. Period lock and `requireAccess` apply unchanged | Unit tests per action; `no-cash-readers` and recycle-bin suites unchanged; e2e: Alt+D then Undo |
| B3 Gateway voucher habits | Alt+T post-dated (Tally Ctrl+T, §5.1), Ctrl+L optional, "Memo" choice (a chip next to the date, writes `variant` / `post_dated` through `saveVoucher` as the Books editor does); Ctrl+H single / double entry; PgUp / PgDn previous / next voucher of the type while altering (Y / N when dirty); typed lines kept in `sessionStorage` when the user leaves by Go To (GK12) | `tests/gateway.test.ts` additions; variants appear in the Optional / Post-dated registers |
| B4 Narration | In a narration / notes field: Ctrl+R = last narration of this voucher / document type, Alt+R = the party's last narration. Ctrl+R is claimed **only** in those fields | Unit test on the narration lookup (reads existing rows only) |
| B5 Side sheets | Alt+S (cut alias Ctrl+Shift+S) stock query for the focused item line (reuses `stock-query.ts` + a slim view); Ctrl+O party facts (outstanding, last 5 bills, ledger link; reuses `PartyHabitsStrip` data); Alt+A opens the tax break-up; Ctrl+I opens the line's / party's detail panel; Alt+Q the activity timeline. All are `Modal` side sheets in the modal stack, Esc returns focus to the field | e2e: Alt+S on a line shows stock; Esc returns focus |
| B6 F2 in place | F2 focuses the date field of the editor / bill / voucher | Unit test on the scope resolution |

Owned files (edit): `src/components/gateway/VoucherEntry.tsx`, `src/hooks/useCreatorKeys.ts`, `src/pages/InvoiceCreator.tsx`
(one `useKeyActions` call), the bill / PO / GRN form components under `src/components/purchases/` (one `useKeyActions`
each), `src/components/masters/useMasterKeys.ts`, `src/components/creator/PartiesSection.tsx` and the item picker
(`data-key-row` on the existing create buttons). New: `src/lib/keys/entry-actions.ts`, `src/components/keys/EntrySheets.tsx`,
`src/i18n/areas/keys-r20b.ts`, tests `keys-entry`.

### R20-C — Reports (after A; parallel with B and D)

| Item | Spec | Acceptance |
|---|---|---|
| C1 Filter (Ctrl+F; Alt+F12 alias) | A plain-language filter sheet on Books reports, Day Book, registers, ledger vouchers and the Gateway Display: amount between, date range inside the period, party / ledger contains, narration contains, Dr / Cr side. A chip "Filtered · Clear" on the report; Esc clears. Ctrl+F stays the browser's find everywhere else and in simple mode | `tests/keys-report-filter.test.ts` (pure `filterRows`); e2e |
| C2 Totals of shown rows (Ctrl+F12) | While filtered / selected / rows hidden, a footer "Totals of what you see" (Dr, Cr, net) and the report total marked "of shown rows" | Unit test |
| C3 Select / hide | Space ticks a row (checkbox column appears on first use; touch: long-press or the checkbox), Shift+↑ / ↓ extends, Ctrl+Alt+I inverts (outside fields, AltGr safe), footer shows count + total; Ctrl+R hides selected / focused rows, Ctrl+U restores the last, Alt+U all (a "3 hidden · Show all" chip). Never saved; print / export use shown rows with a "rows hidden" note | Unit tests; print snapshot contains the note |
| C4 Views and basis | Ctrl+L "Save this view" (8G storage, per report id), Ctrl+H "Views" sheet (saved views, Show original, Delete, Set as default — default stored as a flag on the saved view), Ctrl+B "Show values as" (include optional, include post-dated, budget column where Books budgets exist, cost centre) | `tests/report-views.test.ts` additions |
| C5 Exceptions, detail, drill | Ctrl+J opens exceptions filtered to the report's ledgers (red count chip when any); Alt+F5 = Alt+F1; Shift+Enter expands / collapses the focused row; Ctrl+Enter on a ledger / party row opens its master; `+` / `−` (and `]` / `[`) step the period by the preset; Alt+N / Alt+C / Alt+D columns | Unit tests on period stepping; e2e on TB |
| C6 Row actions | On Day Book / ledger-voucher rows: Alt+I (and Alt+A) new voucher of that type dated that day; Alt+2 duplicate; Alt+D delete (Y / N, Undo); Alt+X cancel (B2's action; C calls it, never re-implements) | e2e: Alt+D on a Day Book row then Undo |
| C7 Output keys | Ctrl+P print, Ctrl+E export, Ctrl+M share **press the report's existing buttons** (no new output code); Alt+E opens `/exports` | e2e: Ctrl+E downloads the TB CSV |
| C8 Report F-keys (cut 1) | BRS F5 "Show reconciled", GSTR-1 F5 "Nature / Return view" where those toggles exist | — |

Owned files (edit): `src/components/books/ledger/{DrillStack,drill-hooks,ReportToolbar,ReportViews,DayBookTab}.tsx`,
`src/components/books/PeriodBar.tsx`, `src/components/gateway/DisplayReport.tsx`, `src/lib/report-views.ts`
(additive `default?` flag), `src/lib/report-prefs.ts` (additive basis fields). New: `src/lib/keys/report-actions.ts`
(pure `filterRows`, `stepPeriod`, selection model), `src/components/keys/ReportSheets.tsx`, `src/i18n/areas/keys-r20c.ts`,
tests `keys-report-*`.

### R20-D — Go To, company and data menus, list keys, onboarding (after A; parallel with B and C)

| Item | Spec | Acceptance |
|---|---|---|
| D1 Go To over the screen | Alt+G opens `CommandPalette` in **Go To mode** (title "Go To", Tally names indexed from `GATEWAY_SCREENS` labels and `tally` labels, report synonyms like "daily entries", "warehouse summary", "outstanding", "trial"); "Recently opened" (existing recents) first; picking a report pushes it, and a **"Back to …" chip** in the Key bar returns to the previous screen with its URL and focus. On `/gateway` Alt+G still focuses the Gateway box. Ctrl+G = Switch To (navigate, no chip) | `tests/search.test.ts` additions (Tally names, Hindi); e2e: from the editor Alt+G "trial", Enter, then the chip returns to the editor with the draft intact |
| D2 Company / Data / Import sheets | Alt+K Company (switch F3, features F11, configure F12, companies Alt+F3, users, lock Ctrl+F3), Alt+Y Data (back up now, restore, check data = Ctrl+Alt+R, start new year, recycle bin, folder sync), Alt+O Import (Tally XML, Excel, bank statement). Letter badges as on the Gateway; every row is an existing route or action | e2e: Alt+Y then B runs "Back up now" (existing flow) |
| D3 Small keys | F3 opens the company switcher list (↑ ↓ Enter); Ctrl+F3 lock now (Y / N when a form is dirty); Ctrl+Alt+N opens the bell; Ctrl+Alt+B opens Help → About (cut 1); Alt+F3 Settings → Companies (cut 2) | Unit tests on scope; e2e: Ctrl+Alt+N focuses the bell list |
| D4 Onboarding and What's new | Setup wizard question "Have you used Tally before?" (Yes → Tally keys on, layout Prime; No → off, "you can switch it on any time from ?"); a What's new entry for existing devices ("Tally keys can now be switched off: F5 reloads again when they are off") | Wizard unit test; `scripts/check-whats-new.mjs` passes (lead bumps the version) |
| D5 List keys | On `/transactions`, `/clients`, Expenses → Bills and Vendors (Tally mode): ↑ ↓ Home End move a highlight bar (reuse `useDrillRows` from `drill-hooks.ts` — D imports it, C owns the file and keeps that signature), Enter opens, Space ticks the row's existing checkbox where a bulk bar exists, Alt+D delete / Alt+X cancel / Alt+2 duplicate on the focused row through B2's actions (D calls them, never re-implements). The Key bar shows these rows on those pages | e2e: `/transactions` ↓ ↓ Enter opens the second document |

Owned files (edit): `src/components/command/CommandPalette.tsx` (Go To mode prop), `src/lib/search.ts` /
`src/lib/palette/synonyms.ts` (Tally-name entries in a `// R20-D` block), `src/components/companies/CompanySwitcher.tsx`
(an imperative `open()` handle), `src/components/command/NotificationBell.tsx` (an `open()` handle — one export),
the setup wizard (`src/components/onboarding/SetupWizard.tsx`, one question), `src/pages/{Transactions,Clients}.tsx` and the
Expenses bills / vendors list components (one `useKeyActions` + `useDrillRows` call each, D5). New: `src/lib/keys/nav-actions.ts`,
`src/components/keys/MenuSheets.tsx`, `src/i18n/areas/keys-r20d.ts`, tests `keys-nav`.

---

## 5. Conflicts with browser and OS shortcuts

### 5.1 Never claimed (`NEVER_CLAIM`, data in `registry.ts`, tested)

| Key | Owner | Tally meaning | Our answer |
|---|---|---|---|
| Ctrl+N, Ctrl+Shift+N | New window / private window (not cancellable in Chromium) | Calculator | No calculator key; typed sums in amount fields |
| Ctrl+T, Ctrl+Shift+T | New tab / reopen tab | Post-dated (Ctrl+T) | Ctrl+T cannot be cancelled in any browser → our key for post-dated is **Alt+T** in voucher scope (EK7, B3); the cheat sheet lists Ctrl+T as "not in a browser"; the chip next to the date is the twin |
| Ctrl+W, Ctrl+Shift+W, Ctrl+F4 | Close tab / window | Data-entry language; **Ctrl+F4 Payroll** | Payroll = **Ctrl+Shift+F4** and the F10 Vouchers sheet |
| Alt+F4 | Close window (OS) | Quit | — |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgUp / PgDn, Ctrl+1…9 | Switch tabs | (Ctrl+PgUp / PgDn none in Prime) | PgUp / PgDn **without** Ctrl for previous / next voucher |
| Ctrl+Q (quits Chromium / Firefox on Linux), Ctrl+Shift+Q (Firefox on Windows), ⌘Q, ⌘W, ⌘H, ⌘M, ⌘Tab, ⌘Space, ⌘⌥Esc | Quit / hide / minimise / OS | Quit screen | Esc |
| Ctrl+Alt+Del, Ctrl+Shift+Esc, Win+…, Alt+Tab, Ctrl+Alt+T (Linux terminal), Ctrl+Alt+L (Linux lock), Ctrl+Alt+arrows (workspace / screen rotation on some Windows Intel drivers) | OS | — | Never used |
| Ctrl+Z / Y / X / C / V, Ctrl+←/→, Shift+arrows, Home / End **inside fields** | Text editing | (Ctrl+C / V same) | Never claimed in fields |

### 5.2 Claimable, but only in Tally keys mode (simple mode leaves them to the browser)

| Key | Browser default | Tally use | Rule |
|---|---|---|---|
| **F5**, Ctrl+R, Ctrl+F5 | Reload / hard reload | Payment; narration; rejection out | F5 and Ctrl+F5 claimed in Tally mode outside fields; Ctrl+R only in narration fields (B4) and on reports (C3). The cheat sheet and the Key bar show "Reload: use the browser's ⟳ button" |
| F1 | Browser help (Chrome) | Help | Claimed always (today's behaviour) |
| F3, Ctrl+G, Ctrl+F | Find next / find | Company; Switch To; filter | Ctrl+F claimed only on reports in Tally mode; F3 / Ctrl+G in Tally mode outside fields |
| F6, Ctrl+F6 | Focus address bar / next pane | Receipt; rejection in | Tally mode; **B-test** in Chromium (F6 is cancellable on keydown in current Chromium / Firefox; confirm in the matrix) |
| F7 | Caret browsing prompt | Journal | Tally mode; B-test |
| F10 | Menu bar (Windows Firefox / Edge) | Vouchers list | Tally mode; B-test |
| F11 | Full screen | Features | Tally mode. Browsers may keep it: the Key bar and the Company sheet are the twins (already documented) |
| F12 | Developer tools | Configure | Same as F11; Ctrl+Shift+I stays dev tools |
| Ctrl+L, Ctrl+D, Ctrl+H, Ctrl+J, Ctrl+B, Ctrl+E, Ctrl+O, Ctrl+P, Ctrl+U, Ctrl+M | Address bar, bookmark, history, downloads, (bookmarks), search, open file, print, view source, (mute tab in some) | Optional / save view; remove line; mode / view; exceptions; basis; export; related; print; restore line; share | Claimed only in the scope that uses them (voucher, report, editor) in Tally mode; never globally. Ctrl+P keeps opening our preview in the editor (existing) |
| Alt+letter (Alt+F, Alt+E, Alt+V, Alt+S, Alt+H, Alt+B, Alt+T, Alt+D) | Firefox / Edge / Chrome menus on Windows and Linux; Alt+D = address bar | Many | Claimed only in scope, Tally mode; **Alt+F / Alt+E are not claimed** (Chrome menu on Windows may not be cancellable) — Ctrl+F / Ctrl+E are the documented keys. Alt+S has the Ctrl+Shift+S alias (B5). B-test all |
| Ctrl+Alt+letter | **AltGr on Windows**: types characters on Indian (InScript, Hindi Traditional), Polish, German … layouts | N / R / B / I / W | Fire only outside text fields; never in a field |
| Ctrl+A | Select all | Accept | In Tally mode inside Tally forms only (as the Gateway does today); simple mode keeps select all |
| Alt+← / → | Back / forward | — | Never claimed; Esc already pops one level and browser Back works the same on reports |

### 5.3 macOS, iPad and phones

- **Option (⌥) = Alt.** Option+letter types a symbol, so `e.key` is wrong: match `e.code` (A1, bug 1). The chip shows ⌥.
- **⌘ = Ctrl** where `mod` is used (existing `formatCombo`). Ctrl+A / Ctrl+D / Ctrl+L … become ⌘A / ⌘D / ⌘L on a Mac;
  ⌘Q, ⌘W, ⌘H, ⌘M, ⌘Tab are never claimed. ⌘D (bookmark) and ⌘L (address bar) are cancellable in Safari / Chrome
  (B-test).
- **F-keys on Mac** are media keys unless Fn is held or "Use F1, F2 … as standard function keys" is on. The cheat sheet
  shows "fn F5" on Apple platforms and points to the F10 Vouchers sheet and the Key bar. Ctrl+F2 / Ctrl+F3 / Ctrl+F7
  are macOS keyboard-navigation keys when "Keyboard navigation" is on — we use none of them.
- **iPad with a keyboard:** ⌘ combos work in Safari; holding ⌘ shows only Safari's own list (web apps cannot add to it),
  so the Key bar is the discovery path.
- **Phones (no keyboard):** keys do not exist; the Key bar becomes the "Keys" pill + bottom sheet (A5). Hardware
  keyboards on Android Chrome follow the Windows / Linux rules.
- **The browser matrix (A, before merge):** Chromium (Windows, Linux, macOS), Firefox (Windows, Linux), Safari (macOS),
  installed PWA window (Chromium). For every **B-test** row: does `preventDefault` on `keydown` stop the browser
  action? A row that fails on any browser becomes `browser: 'unsafe:<browser>'`: the cheat sheet shows the twin and the
  stub does not claim it there. Results in `docs/features/tally-keys-r20.md`.

---

## 6. Accessibility

- **Focus.** Every sheet / dialog is a `Modal` in `modal-stack.ts`: opening moves focus to its first control, Esc
  closes only the top one and **returns focus to the element that opened it** (the field for B5 side sheets, the row for
  C sheets). Go To's "Back to …" restores the previous route and the previously focused element (by `data-focus-key`
  when the DOM re-renders; else the page heading).
- **Keys never fire inside a dialog** except that dialog's own (existing `[aria-modal]` rule kept in the stub and the
  engine). F1 stays quiet while a dialog is open (QA7 G3).
- **Screen readers.** Buttons with keys carry `aria-keyshortcuts` (existing `ariaKeys()`); chips are `aria-hidden`, so
  nothing is read twice. Mode changes, filters ("Filtered: 12 rows"), selections ("3 selected, total ₹4,500"), hides
  and undo results go to one polite live region. NVDA / JAWS browse mode swallows single letters: the Gateway menu and
  the menu sheets use `role="menu"` / `menuitem` so screen readers switch to focus mode, and the letter badges are also
  read as part of the item name ("Back up now, B"). Report tables keep real `<table>` semantics; the selection
  checkbox column has a header "Select".
- **The Key bar** is `role="toolbar"` with one tab stop and roving arrow focus; it never traps focus and sits after the
  main content in DOM order (Skip link unchanged).
- **Visible focus** on chips and rows (existing focus ring tokens); targets ≥ 44 px on touch; chips meet contrast in
  light, dark and the R2-C high-contrast mode; no motion on chips (respects reduced motion).
- **Language.** Labels in Hindi when the interface is Hindi; key caps stay Latin with `lang="en"` so screen readers
  pronounce "Control F5" correctly.
- **No timing.** No key relies on a hold or a fast sequence except the existing `g` sequences (900 ms) and those have
  menu twins.

---

## 7. Work packages and the shared-file protocol

**Merge order:** **A first** (engine, stub, registry with every row, cheat sheet, Key bar, layouts, Vouchers sheet,
strings for every row). Then **B, C and D in parallel, any order**: each implements handlers for its own rows on screens
it owns and adds its letter to `BUILT`.

| Package | Scope | Owned (new) | Owned (edit) | Cap (core gz) |
|---|---|---|---|---|
| **R20-A** | A1–A6 | `src/lib/keys/{stub,engine,registry,use-key-actions,layouts}.ts`, `src/components/keys/{KeyBar,VouchersSheet}.tsx`, `keys.module.css`, `src/i18n/areas/keys-r20a.ts`, `docs/features/tally-keys-r20.md`, tests `keys-registry`, `keys-mode`, `keys-stub` | `src/layouts/DashboardLayout.tsx`, `src/hooks/useHotkeys.ts`, `src/hooks/useTallyKeys.ts` (removed or reduced to a re-export), `src/lib/tally-keys.ts`, `src/components/command/ShortcutsOverlay.tsx` (+ css), `src/components/gateway/{keymap.ts,ButtonBar.tsx,GatewayMenu.tsx}` (switch row), `src/lib/gateway/period.ts` (prefs), `src/lib/pos-keys.ts` (reads `NEVER_CLAIM`), `src/components/ui/NumberInput.tsx` (hint chip attr), the Settings → Defaults panel (one row), `vite.config.ts` + `tests/bundle-config.test.ts` (the `f-keys` row) | **≤ 9** |
| **R20-B** | B1–B6 | `src/lib/keys/entry-actions.ts`, `src/components/keys/EntrySheets.tsx`, `src/i18n/areas/keys-r20b.ts`, tests `keys-entry` | `src/components/gateway/VoucherEntry.tsx`, `src/hooks/useCreatorKeys.ts`, `src/pages/InvoiceCreator.tsx` (one hook call), purchase bill / PO / GRN form components, `src/components/masters/useMasterKeys.ts`, editor party / item pickers (`data-key-row` attributes) | **≤ 7** |
| **R20-C** | C1–C8 | `src/lib/keys/report-actions.ts`, `src/components/keys/ReportSheets.tsx`, `src/i18n/areas/keys-r20c.ts`, tests `keys-report-*` | `src/components/books/ledger/{DrillStack,drill-hooks,ReportToolbar,ReportViews,DayBookTab}.tsx`, `src/components/books/PeriodBar.tsx`, `src/components/gateway/DisplayReport.tsx`, `src/lib/report-views.ts`, `src/lib/report-prefs.ts` | **≤ 7** |
| **R20-D** | D1–D5 | `src/lib/keys/nav-actions.ts`, `src/components/keys/MenuSheets.tsx`, `src/i18n/areas/keys-r20d.ts`, tests `keys-nav` | `src/components/command/CommandPalette.tsx`, `src/lib/search.ts`, `src/components/companies/CompanySwitcher.tsx`, `src/components/command/NotificationBell.tsx`, `src/components/onboarding/SetupWizard.tsx`, `src/pages/{Transactions,Clients}.tsx`, Expenses bills / vendors lists (D5) | **≤ 6** |

**Combined:** first paint **≤ 0 net** at every merge; core **≤ 29 kB gross + 1 kB lead reserve = 30 kB**; Hindi
pack ≤ 8 kB; Hindi in core 0. Each package runs `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and
`npm run check:size` (one at a time), and again after rebase; the last package also runs `npm run test:e2e` and
`npm run verify:offline`.

### 7.1 Shared files (the only overlaps)

| File | Who | Rule |
|---|---|---|
| `src/lib/keys/registry.ts` | A writes all rows; B / C / D edit **one line** | Each package adds its letter to `BUILT` (`new Set(['A', 'B'])` …) — a one-line conflict resolved by union. Any row change after A goes through the lead |
| `src/lib/keys/engine.ts` | A | Not edited by B–D: handlers live on screens via `useKeyActions`, and B / C / D's `*-actions.ts` modules are imported by their own screens |
| `src/i18n/areas/keys-r20a.ts` | A | All row labels (both languages). B–D never edit it; a missing label is a lead fix |
| `src/hooks/useCreatorKeys.ts` | B only | C / D never touch the editor |
| `src/components/books/ledger/drill-hooks.ts` | C owns; D imports | D5 reuses `useDrillRows` as is. C may add options but keeps the current signature and behaviour (`tests/reports-engine.test.ts`) |
| `src/lib/keys/entry-actions.ts` | B owns; C, D import | C6 (report rows) and D5 (list rows) call B2's delete / cancel / duplicate actions. If C or D merges before B, it ships the row keys hidden (row not in `BUILT`) and they show once B lands |
| `src/components/gateway/*` | A (`keymap.ts`, `ButtonBar.tsx`, `GatewayMenu.tsx`), B (`VoucherEntry.tsx`), C (`DisplayReport.tsx`) | Different files; `GatewayShell.tsx` unchanged by all |
| `src/components/command/CommandPalette.tsx` | D | A adds palette **actions** through `DashboardLayout`'s `actions` list (A owns that file) — no palette edit by A |
| `src/lib/palette/synonyms.ts`, `src/lib/help/topics-books.ts`, `src/lib/help/tips.ts` | A, D | Appended blocks `// R20-A`, `// R20-D` |
| `src/components/ui/Toast.tsx` | — | Not edited; the action API already exists |
| `tests/e2e/smoke.mjs` | A–D | One appended `step(...)` block each, in merge order |
| `docs/features/tally-keys-r20.md` | A creates | One section per package with its bundle numbers |
| `src/lib/whats-new.ts`, `package.json` version, `AGENTS.md`, `docs/ROADMAP.md`, `docs/features/gateway-keyboard.md` | lead | After merge: the two new device-local keys in AGENTS.md's viewing-preferences list; the key-map pointer; the What's new entry |

### 7.2 Storage summary

| Key | Package | Kind | Backed up | Synced |
|---|---|---|---|---|
| `mrchartist_tally_keys` (`off` / `on` / `on:collapsed`) | A | device-local preference | no | no |
| `mrchartist_tally_layout` (`prime` / `erp9`) | A | device-local preference | no | no |
| `mrchartist_report_views` (+ `default?` flag per view) | C | existing device-local key, additive field | no | no |
| `mrchartist_report_prefs` (+ basis fields) | C | existing device-local key, additive fields | no | no |
| Gateway voucher draft lines | B | `sessionStorage`, per tab, cleared on save / quit | no | no |

No company data changes, no migration, no `TABLE_ACTIONS`, `WATCHED_TABLES`, `backup.ts` or `sync-engine.ts` edit.

---

## 8. Out of scope (with reasons)

| Item | Reason |
|---|---|
| Connected banking keys, TallyDrive, Tally.NET, remote access, Docs by Ira, online e-Invoice / e-Way send, Bharat Connect, WhatsApp / e-mail sending | Critical Rule 1 (no network); the share sheet already hands text to the device |
| Calculator panel (Ctrl+N), currency-symbol keys (Ctrl+4, Ctrl+Shift+6 / 7), data-entry language (Ctrl+W) | Browser / OS own the keys; amount fields already evaluate sums; ₹ is the OS keyboard's job |
| Group company consolidation, split company data by date | Data features, not keys; a future round |
| Horizontal (Tally-style) Balance Sheet, full Scenario management | Layout / data features; Ctrl+B "include optional" covers the common case |
| Keyboard navigation of every other list (Inventory, Receivables, pack desks …) | D5 covers the four main lists; the rest is a large surface across many files; `/` search + Ctrl+K cover it. Candidate for a later round |
| User-remappable keys outside POS | POS already has it (`mrchartist_pos_keys`); a general remapper doubles the conflict surface and the test matrix for little gain. The layout switch covers the ERP 9 / Prime split |
| A Tally-like theme or full-screen "Tally mode" UI | The owner asked for Tally's power, not its look |
| Alt+J stat adjustments, Ctrl+F autofill, Ctrl+Alt+U unused numbers, Ctrl+Alt+T TDL | Rare, or AltGr-unsafe in fields; existing screens / links cover them |
| Changing `Alt+P` (POS) or `Alt+Z` (Undo) to Tally's meanings | Existing users rely on them; the cheat sheet maps the Tally meaning to its new key |

---

## 9. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **A:** fresh device → F5 reload not intercepted (assert no navigation to `/gateway/voucher/payment`); `?` opens the
   cheat sheet; search "भुगतान" shows Payment with "Switch on Tally keys"; switch on → F8 opens `/invoice`; Key bar on
   `/books?tab=tb` lists rows; 390 px shows the Keys pill; F10 opens the Vouchers sheet and "R" opens Receipt.
2. **A (existing device):** seed `mrchartist_whats_new_seen` older → F5 opens Payment (today's behaviour), layout erp9:
   Ctrl+F8 opens a credit note.
3. **B:** Tally mode → F8, Alt+C on the party picker creates a party, Ctrl+A saves; Alt+D on the saved invoice then Undo
   restores it (IndexedDB predicate wait); Gateway payment with Alt+T post-dated appears in the post-dated register.
4. **C:** TB → Ctrl+F amount ≥ 10,000 → chip shows; Space selects two rows → footer total; Ctrl+R hides one → "1 hidden";
   Ctrl+L saves a view; Ctrl+E downloads CSV.
5. **D:** from the editor Alt+G "trial" Enter → TB; "Back to …" returns to the editor with the draft; Alt+Y then B runs a
   backup; Ctrl+Alt+N focuses the bell; `/transactions` ↓ ↓ Enter opens the second document.

---

## 10. Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Registry invariants (unique, no `NEVER_CLAIM`, twins, Hindi, layouts), stub claimed list = registry, mode default rules, `e.code` matching (Option), scope resolution order | `tests/keys-registry.test.ts`, `tests/keys-mode.test.ts`, `tests/keys-stub.test.ts` |
| Unit | Entry actions (undo of delete / cancel / duplicate / line), narration lookup, PgUp / PgDn ordering | `tests/keys-entry.test.ts` |
| Unit | `filterRows`, totals of shown rows, selection model, hide / restore, period stepping, default view | `tests/keys-report-*.test.ts`, `tests/report-views.test.ts` |
| Unit | Go To index (Tally names, Hindi, synonyms), menu sheets map to existing routes / actions | `tests/keys-nav.test.ts`, `tests/search.test.ts` |
| Existing suites unchanged | `gateway`, `gateway-billwise`, `modal-stack`, `search`, `pos*` (POS keys), `reports-engine`, `report-views`, `i18n-areas`, `help-registry`, `docs-links`, recycle bin, `no-cash-readers`, `purchase-contract` | — |
| Build | `check:size` per commit; first paint ≤ baseline; `lazy-leaves` unchanged, `lazy-leaves-ui` ≤ +1 kB; `f-keys` in `tests/bundle-config.test.ts` | `scripts/check-bundle-size.mjs` |
| Browser matrix | §5.3, manual once by A, results in the feature note | `docs/features/tally-keys-r20.md` |

---

## 11. Size budget per package (gz, core = English precache)

| Package | First paint | Core (cap) | Planned split | Stop rule |
|---|---|---|---|---|
| R20-A | **≤ 0 net** (stub +0.35, route table −0.4 … −0.6) | **≤ 9** | engine + scopes + stub 2.0, registry rows (~110) 1.6, cheat sheet 1.6, Key bar + chips + phone sheet + hint 1.5, Vouchers sheet + Prime keys 0.8, row labels 1.3 | cut 1: Ctrl+F5 / F6 rows; cut 2: print layout of the cheat sheet; cut 3: amount hint chip |
| R20-B | 0 | **≤ 7** | accept / create / alter 1.0, delete / line / duplicate / cancel + undo 1.2, Gateway voucher habits 1.5, narration + edit log 0.6, side sheets 1.6, strings 0.6 | cut 1: Alt+R narration; cut 2: PgUp / PgDn; cut 3: Ctrl+O sheet |
| R20-C | 0 | **≤ 7** | filter + totals 1.8, select / hide 1.3, views / basis / exceptions / detail / step 1.8, row actions + output keys 1.0, strings 0.6 | cut 1: RK17 report F-keys; cut 2: invert; cut 3: Ctrl+B |
| R20-D | 0 | **≤ 6** | Go To mode + return chip 1.4, menu sheets 1.2, small keys 0.3, list keys 1.8, wizard + What's new 0.4, strings 0.4 | cut 1: Ctrl+Alt+B; cut 2: Alt+F3; cut 3: Space selection on lists; cut 4: wizard question |
| **Round** | **≤ 0** | **≤ 29 + 1 reserve = 30** | Hindi pack ≤ 8 kB | Core ≤ 3,262.9 kB at the end on today's baseline (≈ 3,268.9 kB with PENDING 45 / 49) |

---

## 12. Open questions — with the default the builders use

| # | Question | Default |
|---|---|---|
| Q1 | Should existing devices keep Tally keys on? | **Yes** (no behaviour change for current users); What's new tells them about the switch |
| Q2 | Prime or ERP 9 layout for existing devices? | **ERP 9** (today's mapping); fresh devices get Prime when they switch on |
| Q3 | Ctrl+A in a text field: accept or select all? | Accept **in Tally mode inside Tally forms** (Tally's behaviour, already shipped on the Gateway); select all otherwise |
| Q4 | Post-dated key, since Ctrl+T cannot be claimed | **Alt+T** in voucher scope + the date chip |
| Q5 | Payroll key, since Ctrl+F4 closes the tab | **Ctrl+Shift+F4** + F10 sheet |
| Q6 | Key bar placement | Bottom of the content area, collapsible; the Gateway keeps its top ButtonBar |
| Q7 | Do report "hide line" / selection survive navigation? | No — per visit, never saved (Tally behaves the same until you save a view) |

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Core precache overrun (67.1 kB headroom, 6 kB held for PENDING 45 / 49) | M | M | 30 kB round cap (≤ 9 per package) with pre-ranked cuts; rows are data; reuse palette / toast / sheets; `check:size` per commit; leaves ≈ 31 kB for Round 21 |
| First paint grows (the stub) | M | H | A must land ≤ 0 net by moving the route table out; measured before / after |
| A browser does not let us cancel a key (F6, F10, Alt+letter, ⌘D) | M | M | `B-test` rows + matrix; failing rows marked unsafe per browser and the twin documented; F10 sheet and Key bar always available |
| Existing users lose a key (mode default, layout change) | L | M | Existing devices default to on + ERP 9; What's new; the cheat sheet shows Tally ↔ our key |
| Key collisions between scopes (Alt+A, Alt+D, Alt+S, F5 mean different things) | M | M | One registry, most-specific scope wins, tests forbid duplicates per scope; "This screen" view in the cheat sheet |
| AltGr / Option produce characters instead of commands (Hindi InScript users) | M | M | `e.code` matching; Ctrl+Alt never in fields; every Ctrl+Alt key has a twin |
| Undo restores the wrong thing or bypasses the period lock / rights | L | H | Undo only through existing data-layer calls (recycle-bin restore, `saveVoucher`), never `writeRaw`; tests per action |
| Screen-reader users lose single-letter browse keys on menus | L | M | `role="menu"` only on real menus; letters only fire with focus inside |
| Scope creep into a general key remapper or list navigation everywhere | M | M | §8 lists both as out of scope |
