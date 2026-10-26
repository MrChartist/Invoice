# QA round 7: hands-on audit of Round 6 (R6-A help and onboarding, R6-B discoverability and sample data)

Status: findings for the fix loop. Baseline: branch `claude/elegant-cannon-cwapiv` at `63db94d` (R6-A, R6-B and their
integration merged; R6-C not merged). `dist/` was rebuilt from that commit (`npm run build`, clean, `check-whats-new: ok
(3.1.0)`). `npm test` passed in full (2,526 tests). `npm run check:size`: initial JS 184.1 / 185 kB, entry 70.6 kB,
total 2,518.4 / 2,600 kB. Every finding below was reproduced on that commit.

Method:
- **Browser.** Playwright (Chromium) against the production build, served with the real headers
  (`scripts/lib/harness.mjs`), fresh profiles per scenario (owner account, PIN 482916; kirana via the wizard; a local
  viewer user for role checks; two tabs in one context for the multi-tab checks).
- **Data layer.** Node probes through the repo's test harness (`tests/helpers/shim.ts`), calling the same lib APIs the
  screens call (`loadDemoData` / `removeDemoData` per profile, `resetDemoSamples`, `saveSetupProgress`, `scrubTyped`,
  `capForShare`, `whatsappLink`, `maskRoute`).
- **Static review** of the R6 diff (`3765b16..63db94d`, 134 files under `src/`).

Files:
- Browser scripts: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa7/*.mjs`
  (`demo-tabs.mjs`, `demo-pending.mjs`, `f1-modal.mjs`, `report.mjs`, `kirana-practice.mjs`, `viewer-palette.mjs`,
  `palette-lang.mjs`; shared helpers in `common.mjs`).
- Node probes: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/qa7/probes/*.test.ts`.
  They were run from `tests/` and moved out afterwards (nothing committed). To run one, copy it into `tests/` and run
  `node --experimental-strip-types --import ./tests/hooks/register.mjs --test tests/<file>.test.ts`.

Below, `qa7/` means the scratchpad folder above.

This doc reports bugs and friction only. It proposes no new features.

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, or a stated R6 invariant is broken.
- **P2:** friction.

---

## 1. Summary

| # | Sev | Area | Finding |
|---|---|---|---|
| G1 | P1 | Sample data / multi-tab | With two tabs open, opening the Demo company in one tab makes the other tab (still on the real company's database) believe it is the Demo company. Its Dashboard then fills the **real** company with the 26 sample invoices, either by "Reset samples" or by finishing the pending demo request |
| G2 | P1 | Sample data | The Demo company is found by its **name**. A real company the user named "Demo" gets the "nothing here is real" banner and "Reset samples", which adds the sample set next to its real invoices; "Try with sample data" switches into it and fills it |
| G3 | P1 | F1 / modals | F1 over an open dialog stacks Help on top; one Escape then closes **both** dialogs, so whatever was typed in the first (here a new client's name) is lost |
| G4 | P2 | Report a problem | A long description with an emoji at the cut point crashes the whole app ("Something went wrong — URI malformed") |
| G5 | P2 | Report a problem | The 1,800 cap counts raw characters, not the link: the WhatsApp link is 2,558 characters for English and 6,876 for Hindi text |
| G6 | P2 | Report a problem | The typed-text scrubber lets through UPI IDs, Devanagari digits (phones, amounts), comma amounts such as "1,250", and lower-case PANs (partly) |
| G7 | P2 | Sidebar / sample data | Trying sample data makes "Practice desk" (a CA tool) appear for every kirana / shop owner, because the Demo company counts as a second company (U10 regresses) |
| G8 | P2 | Ctrl+K / roles | The new Tabs and Features groups ignore the role: a viewer is offered BRS, Recurring, Payroll and Settings → Data & backup, and each is refused after Enter |
| G9 | P2 | Ctrl+K / i18n | Help topics in the palette keep the language of the first open: after switching to Hindi, "? trial balance" still shows "Trial balance", not "ट्रायल बैलेंस" |
| G10 | P2 | Setup checklist / roles | A clerk's Hide and Skip are company-wide: one clerk click hides the owner's card (opening balances, import, backup steps) on every device |

No P0 was found. Sample rows written by G1 and G2 carry `demo: true` and can still be removed with "Remove sample
data", so no real row is lost or changed.

### What was verified and is correct

**Sample data (R6-B4).**
- All five profiles (counter, services, trading, transport, works) were loaded and then removed in a company with
  saved settings. After removal, every storage key equals its value before the load (`qa7/probes/zz-qa7-demo.test.ts`).
  The only difference is a table that did not exist before and now holds `[]`.
- Nothing is left in `series_counters`, `recycle_bin`, `audit_log`, `doc_links` or the profile tables (`stock_items`,
  `pos_shifts`, `time_entries`, `retainers`, `vehicles`, `consignment_notes`, `trips`, `ra_measurements`).
- No other key is written. The MCA edit log is untouched.
- The single-tab Dashboard path fills only the Demo company (`demo-tabs.mjs`: main company 0 invoices, Demo company 26).
- The PIN session survives the switch reload. The company registry stays valid.
- Clerks and viewers never see the chooser (`DashboardStart.tsx:75`, `settings.manage`).

**F1.**
- On `/pos`, F1 still opens "Bills on hold" and Help stays closed.
- Alt+F1 in Books does not open Help.
- F1 typed inside a field does nothing (`f1-modal.mjs`).

**Report a problem (R6-A5).**
- The route trail masks record ids and every query value except `tab` / `view`: `/clients?q=…&tab=ledger`,
  `/invoice/:id`.
- Only `/invoice/:id` has a path parameter (`App.tsx:107`).
- GSTINs, upper-case PANs, e-mails, 4+ digit runs (phones, account numbers, the digits of an IFSC), `₹` / `Rs` / `INR`
  amounts and `INV/FY…` numbers are masked.
- No recipient is filled in (`wa.me/?text=`, `mailto:?subject=`).

**What's new (R6-A4).**
- `mrchartist_whats_new_seen` is outside the `mrchartist_inv_` prefix, so it is device-local and never backed up or
  synced.
- The Dashboard mounts the card behind the first-run wizard, so a fresh install records the version silently.

**Settings → Features (R6-B5).**
- Toggles render only for `settings.manage`, and clerks and viewers see the panel read-only.
- Modules and packs go through the page's Save bar, as Settings → Defaults does.
- `isPathVisible` without packs behaves as before (pinned by `tests/industry-packs.test.ts`).

**Checklist storage.**
- `setup_progress` is in `TABLE_ACTIONS` (`doc.create`), so a viewer's write is refused.
- It is described in `open-export-schema.ts`, and backup picks it up as a `mrchartist_inv_*` key.

**Budgets.**
- First paint is 184.1 kB, entry 70.6 kB, total 2,518.4 kB. All are within budget.
- No R6 text or registry (help topics, glossary, What's new, demo profiles) is in the first-paint files.
- The shell gained only the nav rows, the "more features" label, `PACK_ROUTES` and the help event.
- Note for the lead: initial JS rose by 1.1 kB over the round (183.0 → 184.1 kB), against the PRD's combined +0.7 kB.
  0.9 kB of headroom is left for Round 7.

**Palette.**
- "3b", "GSTR-3B", "cdnur" and "trial balance" find their tabs in English and in Hindi.
- Tab and feature rows are rebuilt on every open, so a shop-mode change shows at once.

---

## 2. Findings

### G1 — P1 — A second tab writes sample data into the real company

- **Cause:**
  - `isDemoCompanyOpen()` (`components/onboarding/demo-company.ts:42`) and `useDemoPending` (`:100–111`) compare the
    Demo company's id with `activeCompanyId()`. That function reads the **device-local registry**
    (`company-registry.ts:65`).
  - `switchCompany` in tab A rewrites that registry. Tab B's storage cache and IndexedDB connection still belong to
    the main company (`idb-kv.ts:45` opens the database once). Yet every registry check in tab B now says "Demo".
  - `DemoNotice` (`components/demo/DemoNotice.tsx:223–240`) therefore shows the Demo banner in tab B.
  - Its "Reset samples" (`resetDemoSamples`, `demo-company.ts:69`) and the pending fill (`fillDemo`) write into tab
    B's cache, which is the real company.
- **Repro A (`qa7/demo-tabs.mjs`):**
  1. Fresh owner account. Open a second tab on `/`.
  2. In tab A, Dashboard → "Open a separate Demo company (recommended)". Tab A reloads into Demo, which holds 26
     invoices. The main company still holds 0.
  3. In tab B, go to the Dashboard without reloading. It shows "Sample company — nothing here is real · Switch to
     Main business · Reset samples".
  4. Click Reset samples and confirm.
- **Actual (A):**
  - The main company holds 26 invoices, all `demo: true`.
  - Its profiles become `["", "Sample Studio (demo)"]`, and the sample profile is now the active one.
  - Tab B then reloads into the Demo company, so the user does not see what happened.
- **Repro B (`qa7/demo-pending.mjs`):**
  1. Tab A clicks the same button, but its reload has not finished yet. The script stalls tab A's document request to
     simulate this; a slow phone or a long boot has the same effect.
  2. Tab B opens its Dashboard.
- **Actual (B):**
  - The main company holds 26 sample invoices.
  - The pending flag is consumed, so the Demo company opens empty.
- **Expected:** Sample rows never reach a real company (R6-B4: "never into a real company").
- **Fix:**
  - Record the company this tab booted with, e.g. `bootCompanyId` in `storage.ts` / `idb-kv.ts`, set when the
    database is opened.
  - Use it in `isDemoCompanyOpen`, `useDemoPending` and `resetDemoSamples` in place of the live registry.
  - Better still, make every tab reload (or show "This tab is on another company — reload") when the registry's
    `active` changes in a `storage` event. Today a stale tab keeps showing and editing the old company under the new
    company's name in the switcher.
  - Make `loadDemoData` refuse unless the open company is the Demo company. The check belongs in the data layer, not
    only in the buttons.

### G2 — P1 — A company named "Demo" is treated as the sample company

- **Cause:**
  - `demoCompanyEntry()` (`demo-company.ts:40`) matches the registry entry by name, `demo` in any case.
  - `createCompany` and `renameCompany` (`companies.ts:33–51`) let the owner give a real company that name.
  - `startDemoCompany` (`demo-company.ts:80–96`) reuses that entry.
  - `fillDemo` → `loadDemoData({ confirm: true })` (`demo-company.ts:60`) skips the `has_real_data` guard.
- **Repro (`qa7/probes/zz-qa7-misc.test.ts`, first test):**
  1. Set up a registry with a main company "Asha Traders" and a second company "demo", with "demo" open.
  2. Add one real invoice to "demo".
  3. Call `resetDemoSamples()`. The banner's "Reset samples" button does exactly this.
- **Actual:**
  - `isDemoCompanyOpen()` is true, so the banner reads "Sample company — nothing here is real".
  - After the reset, the company holds 27 invoices: 1 real and 26 sample.
  - From another company, "Try with sample data" switches into this company and fills it the same way.
- **Expected:** Only the company the app created for samples is the Demo company. A user's company is never filled,
  whatever its name.
- **Fix:**
  - Mark the entry when it is created, e.g. `CompanyEntry.demo: true` in the registry (additive), or a
    `settings.demo_company: true` flag inside its database.
  - Match on that flag, not on the name.
  - Reserve the name, or keep `confirm: false` in `fillDemo` so the existing `has_real_data` guard still applies.

### G3 — P1 — F1 over a dialog, then Escape, closes both dialogs and loses the form

- **Cause:**
  - F1 is bound on the whole shell (`layouts/DashboardLayout.tsx:328`). It fires whenever focus is not in a field,
    including while another `Modal` is open.
  - Every `Modal` adds a capture-phase `keydown` listener on `document` (`components/ui/Modal.tsx:81–84, 109`). On
    Escape it calls `event.stopPropagation()`, which does not stop the other listeners on the same node.
  - So both open modals run `onClose`. This limit was there before R6, but nothing used to stack a second dialog with
    one key.
- **Repro (`qa7/f1-modal.mjs`):**
  1. Open `/clients?new=1` (the Add client dialog).
  2. Type "Asha Traders" in Client name.
  3. Click the dialog title, so focus is no longer in a field.
  4. Press F1. Two dialogs are open: Add client and Help & about.
  5. Press Escape once.
- **Actual:** No dialog is left open. The typed client is gone. Only Add client was tried, but every dialog built on
  `Modal` shares the listener, so bill, payment and voucher entry are open to the same loss.
- **Expected:** Escape closes only the top dialog (Help) and the form stays as typed.
- **Fix:**
  - In `Modal`, close only the topmost dialog, using a module-level stack of open modals. Alternatively, call
    `stopImmediatePropagation()` from the newest listener: register it so it runs first, or check
    `dialogRef.current` against the last opened modal.
  - Also consider leaving F1 alone while a dialog is open (`document.querySelector('[role=dialog]')`).

### G4 — P2 — A long report with an emoji crashes the app

- **Cause:**
  - When the typed part alone is longer than the cap, `capForShare` cuts it with `typed.slice(0, cap - note.length - 1)`
    (`lib/feedback.ts:66`). That can split a UTF-16 surrogate pair.
  - `whatsappLink` / `mailtoLink` then call `encodeURIComponent` on a lone surrogate (`feedback.ts:81, 86`), which
    throws `URIError`.
  - The call happens during render (`ReportProblemDialog.tsx:222, 225`), so the error boundary replaces the whole app.
- **Repro (`qa7/report.mjs`):**
  1. Press F1.
  2. Choose Report a problem.
  3. Fill "What did you do?" with 1,581 × "x" followed by emoji. In the node probe, any length that puts an emoji on
     the cut point works (`qa7/probes/zz-qa7-feedback.test.ts`: "URIError URI malformed").
- **Actual:** "Something went wrong · Your saved invoices are safe in this browser. Reload the page · URI malformed".
- **Expected:** The link text is shortened at a character boundary and the dialog stays open.
- **Fix:**
  - Cut by code points, e.g. `Array.from(typed).slice(...)`, or drop a trailing high surrogate after the slice.
  - Wrap the link building in a try / catch that falls back to Copy only.

### G5 — P2 — The share cap does not bound the link length

- **Cause:** `SHARE_CAP = 1800` (`lib/feedback.ts:31`) is compared with `full.length`, the raw string length
  (`feedback.ts:62–74`). The link is built afterwards with `encodeURIComponent`:
  - each space and newline becomes 3 characters;
  - each Devanagari letter becomes 9 characters (`%E0%A4%95`).
- **Repro (`qa7/probes/zz-qa7-feedback.test.ts`, "encoded link length"):** A capped report of 1,791 characters gives:

  | Text | `wa.me` link | `mailto:` link |
  |---|---|---|
  | English | 2,558 | 2,632 |
  | Hindi, same length | 6,876 | 6,950 |
- **Expected:** The link stays under the length the comment protects ("long URLs fail on some phones"). This matters
  most for Hindi testers, who are the ones R6 added Hindi help for.
- **Fix:**
  - Cap on `encodeURIComponent(text).length`: shorten the diagnostics line by line until the encoded length fits, then
    the typed text by code points.
  - Keep the full report on the clipboard, as now.

### G6 — P2 — The typed-text scrubber misses UPI IDs, Devanagari digits and short amounts

- **Cause:**
  - `scrubText` / `scrubTyped` (`lib/diagnostics.ts:54–76`) use ASCII `\d`.
  - The e-mail pattern needs a dotted domain.
  - The PAN pattern is upper-case only.
  - The number rule needs 4+ consecutive digits, or a 6+ character run.
- **Repro (`qa7/probes/zz-qa7-feedback.test.ts`, "scrub samples"):**

  | Input | Output |
  |---|---|
  | `upi asha@okhdfcbank` | unchanged |
  | `फ़ोन ९८७६५४३२१० पर करें, राशि १२५०० रुपये` | unchanged |
  | `billed 1,250 to Asha Traders, then 999 and 12.5k` | unchanged |
  | `pan aapfu0939f` | `pan aapfu[number]f` |
  | `ifsc sbin0000300` | `ifsc sbin[number]` (the bank code stays, which is harmless) |
- **Expected:** Phones, amounts and payment handles a tester types by habit do not travel. The dialog promises "No
  business data is included".
- **Fix:**
  - Normalise Devanagari digits (U+0966–U+096F) to ASCII before scrubbing, or use `\p{Nd}` with the `u` flag.
  - Mask `\S+@[a-z][a-z0-9.-]*` with no TLD as `[upi]`.
  - Make the PAN / GSTIN patterns case-insensitive.
  - Mask Indian-grouped amounts (`\d{1,3}(,\d{2,3})+`) and short numbers after "₹ / rs / rupees / रुपये".
  - Names stay a documented limit.

### G7 — P2 — Trying sample data puts "Practice desk" in a shop's sidebar

- **Cause:** The Practice rule `readRegistry().list.length > 1` (`layouts/DashboardLayout.tsx:171`) counts the Demo
  company. R6-B4 now creates a Demo company for every "Try with sample data", so any owner who tried samples has two
  companies.
- **Repro (`qa7/kirana-practice.mjs`):**
  1. Kirana wizard. The sidebar has no Practice desk.
  2. Dashboard → Open a separate Demo company.
  3. In the Demo banner, click Switch to Asha Kirana.
- **Actual:**
  - The sidebar now shows "Practice desk".
  - `/practice` lists the Demo company's returns next to the shop's own.
- **Expected:** The U10 fix holds. A shop sees the CA desk only when it really keeps several companies.
- **Fix:**
  - Count only non-Demo companies (with G2's flag) in the Practice rule.
  - Consider leaving the Demo company out of the practice desk and of "All companies" search.

### G8 — P2 — Ctrl+K Tabs / Features rows ignore the role

- **Cause:**
  - `buildTabIndex` (`lib/palette/tab-index.ts:79–101`) and `featureDestinations` (`components/command/tab-destinations.ts:20`)
    list every page's tabs whatever the role.
  - The older Pages and Actions groups are filtered by `need` in the shell (`DashboardLayout.tsx:96–136, 335–365`).
- **Repro (`qa7/viewer-palette.mjs`, signed in as a local viewer):**

  | Ctrl+K | Offered | After Enter |
  |---|---|---|
  | "bank reconciliation" | "BRS statement · Reconcile" | "Your role (Viewer) cannot change … the books" |
  | "recurring" | "Recurring schedules", "Batch invoices" | refused the same way |
  | "data backup" | "Data & backup · Settings" | lands on Settings, which has no Data tab for a viewer |
  | "salary run" | payroll tab | "cannot view or run payroll" |
- **Expected:** The palette does not offer screens the role cannot open, as the Pages group already does.
- **Fix:** Give `TAB_PAGES` the route's access action, the same `need` as the nav entry or `RequireAccess` in
  `App.tsx`, plus per-tab rights for Settings tabs. Filter with `can()` in `tabDestinations()`.

### G9 — P2 — Palette help topics keep the first language

- **Cause:** `loadHelpTopics()` picks English or Hindi titles when it runs (`CommandPalette.tsx:88`). It runs only
  while `helpEntries` is empty (`:243`), so a later language switch keeps the old titles. The tab rows follow the
  language, because they are rebuilt per open.
- **Repro (`qa7/palette-lang.mjs`):**
  1. Open Ctrl+K once in English.
  2. Switch to Hindi through Ctrl+K "hindi".
  3. Search "? trial balance". It shows "Trial balance", but the topic's Hindi title is "ट्रायल बैलेंस"
     (`lib/help/topics-books.ts:14`).
  4. Search "3b". It shows the Hindi tab titles ("GSTR-3B GST रिपोर्ट").
- **Fix:** Keep the raw `helpIndex()` rows and map titles per open. Alternatively, add the language to the effect's
  dependencies and reload when it changes.

### G10 — P2 — A clerk's Hide / Skip changes the owner's checklist

- **Cause:**
  - `saveSetupProgress` (`lib/checklist-steps.ts:173–178`) needs only `doc.create`.
  - `setup_progress` is one company object, synced last-writer-wins.
  - The Dashboard's Hide (`components/dashboard/DashboardStart.tsx:52–54`) and Skip are offered to clerks.
- **Repro (`qa7/probes/zz-qa7-misc.test.ts`, second test):** A clerk saves `{ skipped: ['client'], hidden_at }`.
  Signed in as the owner, `showCard` is false and the owner's "client" step reads "skipped".
- **Expected:** A clerk's view of the card does not hide the owner's setup steps: opening balances, import, GST period
  and backup, which the clerk never sees.
- **Fix:** Either of these:
  - Store `hidden_at` / `skipped` per user, e.g. `{ byUser: { [userId]: {...} } }` (additive, normalised by
    `normalizeProgress`).
  - Let only `settings.manage` hide or skip, and give clerks a device-local "hide for me".

### Also noted (not counted as findings)

- **Checklist "Import your data" cannot complete.** Nothing writes `import_runs` until R6-C3 lands
  (`checklist-steps.ts:83`, documented in `help-onboarding-r6.md`). Full and wholesale companies see it open until
  they skip it.
- **Wrong company offered after the Demo company.**
  - The Demo banner's "Switch to <company>" picks the first non-Demo company in the registry
    (`DemoNotice.tsx:251`), not the one the user came from.
  - With several real companies, that is usually "Main business".
- **Stale tab after a company switch (pre-existing).** A tab left open after another tab switches company keeps
  editing the old company's data while the switcher shows the new name. G1 is the R6 consequence. The general fix is
  the reload-on-registry-change in G1.

---

## 3. Fix package

### QA7-1: sample data, dialogs and feedback

| Finding | Files |
|---|---|
| G1, G2, G7 | `components/onboarding/demo-company.ts`, `components/demo/DemoNotice.tsx`, `lib/demo-data.ts` (data-layer guard), `lib/company-registry.ts` / `companies.ts` (demo flag, reload on registry change), `layouts/DashboardLayout.tsx` (Practice rule) |
| G3 | `components/ui/Modal.tsx` (top-of-stack Escape), optionally `DashboardLayout.tsx` (F1 while a dialog is open) |
| G4, G5, G6 | `lib/feedback.ts`, `lib/diagnostics.ts`, `tests/diagnostics.test.ts` |
| G8, G9 | `lib/palette/tab-index.ts`, `components/command/tab-destinations.ts`, `components/command/CommandPalette.tsx` |
| G10 | `lib/checklist-steps.ts`, `components/dashboard/DashboardStart.tsx`, `components/help/SetupChecklistPanel.tsx` |

Regression tests to add:
- **G1:** a stale-tab test (registry `active` changed under a loaded cache → `isDemoCompanyOpen()` false and
  `loadDemoData` refused).
- **G2:** a company named "Demo" is not treated as the Demo company.
- **G3:** a stacked-modal Escape test.
- **G4 to G6:**
  - `capForShare` with surrogate pairs and Devanagari, asserting `encodeURIComponent(text).length ≤ cap`;
  - `scrubTyped` cases for UPI IDs, Devanagari digits and "1,250".
- **G8:** viewer palette rows.
- **G9:** palette help topics in Hindi after a language switch.
- **G10:** a clerk's Hide does not change the owner's card.
