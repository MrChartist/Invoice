# QA round 19: cross-package pass over Round 16 (platform: Hindi packs / safe groups / service worker; R16-B … D seams)

Status: findings fixed in the same loop, each with a regression test that fails on the baseline source:
`tests/qa19-platform.test.ts` (U1–U5: `public/sw.js` run in a `vm` sandbox over an in-memory Cache API, the i18n runtime,
a source scan), `tests/qa19-seams.test.ts` (U7–U9), `tests/perf.test.ts` (U6) and, for U1–U3, the production build in
Chromium (`scripts/verify-offline.mjs`, three new blocks; on the baseline build they fail 4 checks: U1 ×2, U2, U3).
Baseline: branch `claude/elegant-cannon-cwapiv` at `4efee3c` (R16-A … D merged), re-merged at `d0a89fb` / `0953a61`
(e2e-only change) before the final checks.

Method: the previous release (`0521a90`, Hindi inside every chunk) built side by side with the head; its service worker
state recreated in Playwright (no `/__lang__`, no manifest copy, other chunk names) and upgraded to the head build; a
Playwright sweep with Hindi on over 80 routes / tabs / pack desks, flagging any visible text node, placeholder, title or
`aria-label` equal to an area's English string that has Hindi (12,313 strings), run on both builds; a source scan for
translated values frozen in hook initialisers; a scan of every dynamic `import()` that brings a new area into a screen;
the seams of R16-B (media / appearance lines, disbursement write-off, partner delete), R16-C (commission, re-issue) and
R16-D (netting) walked at the data layer with `tests/helpers/world.ts`; the `perf.test.ts` timing profiled
(`--cpu-prof`) on both trees.

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| U1 | P1 | R16-A service worker × upgrade from the previous release | A Hindi device upgrading from a pre-R16 worker: that worker never stored `/__lang__`, so the new install read the language as English and cached **no Hindi pack**. If the first launch after the update was offline (update installed in the background, app reopened on the train), the app opened **in English** and every lazy screen stayed English until an online visit | Install: language unknown **and** an older `mci-shell-*` present → cache every pack this once (best effort, never fails the install). `deviceLang()` returns null when unknown. One-time cost for English upgraders: 361 kB, dropped by U2 on their next update | `U1` (vm); verify-offline "U1: first launch after the upgrade is OFFLINE and still Hindi" |
| U2 | P2 | R16-A service worker × storage | Old build assets were **never removed**: R16-A dropped the runtime `trim` (it could evict the core), so `mci-assets` grew by ≈ 3.1 MB per release forever | `activate` → `pruneAssets()` before the old shell is deleted: keep the union of the new and the replaced build's manifests (`files` + the device's pack; every pack while the language is unknown); a shell without a manifest copy (pre-R16 / no-manifest fallback) → prune nothing. The replaced build is kept so a tab still running it can load its lazy chunks | `U2` (vm); verify-offline: stale file pruned, replaced-build file kept, every core asset and the Hindi pack kept, unused regional pack pruned, offline Hindi after pruning |
| U3 | P2 | R16-A language message × first install | The page tells the worker its language only on boot and on a switch; on the **first visit** the page is not controlled yet, so a Hindi choice made then (setup wizard step 0) never reached the worker that claimed the page: no pack cached until a later online boot | `initI18n` re-posts the stored language on `controllerchange` (first claim, every update) | `U3` (unit); verify-offline "U3: first visit in Hindi … pack cached (94/94)" (0/94 on the baseline) |
| U4 | P2 | R16-A Hindi split × hook initialisers | Area Hindi now arrives **after** a lazily loaded screen's first render. Values computed once in `useMemo` (deps without `lang`) or `useState(<translated>)` froze that first English render: cheque link options ("Bill"), "No batch", landed-cost bill labels, the year-end FX "no rate" memo (R16-B), restaurant item hints, the cheque document labels, the Time unbilled "Client" row, the share-inbox message. (Before R16-A Hindi was synchronous, so this only hit a language switch) | `lang` added to the 6 memo deps; `YearEndWipView` subscribes with `useT()`; `ShareTarget` keeps `null` and translates at render. Rule added to `docs/features/i18n.md` | `U4`: source scan — every `useMemo` / `useState` that calls an area translator must depend on `lang` / not freeze |
| U5 | P2 | R16-A language switch × pre-R16 controller | Right after the R16 deploy the new page runs under the **old** worker until the update is applied (network-first navigation). A switch to Hindi then waited the full **20 s** reply timeout (the old worker never answers) with the picker disabled | The worker acks a `lang` message at once (`{ack:true}`, then `{complete}`); the page waits 2 s for the ack, then the usual 20 s for the pack. No ack → resolve as before (no worker) | `U5` (≈ 2 s vs 6 s race; the worker's replies) |
| U6 | — | `perf.test.ts` R15-A2 cap (4.6 s vs 4.0 s in loaded runs) | **Not a regression.** The timed block was 13–16 `payments.record` calls on 5,000 invoices — each rewrites the whole invoices table (≈ 40–80 ms, PERF-3 row-level storage deferred). Profile: `audit.record` + the one write = 6–10 ms of ≈ 1.2 s; baseline `0521a90` 1,112–1,149 ms vs head 1,137–1,185 ms. Parallel test files on a loaded box pushed it over | The test caps the **audit work** (time inside `audit.record` + the audit-log write, 1 s cap, measures ≈ 6 ms) and still asserts one write per task; the saves keep their cap in the bulk test. No cap was raised or skipped | `perf.test.ts` |
| U7 | P1 | R16-C2 re-issue × credit note | A cheaper re-issue credited the old fare line by a **quantity rounded to 2 decimals**: ₹800 on a ₹5,350 fare → qty 0.15 → credit **₹802.50**; on a ₹12,345 fare ₹800 → ₹740.70. The client's account and the refund were off | `CreditLineRequest.amount` (additive): a value credit — the note's line carries exactly the amount; quantity = amount ÷ rate, unrounded; credited / remaining quantities kept to 6 decimals so the rest of the line stays creditable to the paisa. The pure-agent credit has no taxable value, so no GSTR-1 row value (checked) — PF22 | `U7` |
| U8 | P1 | R16-D1 netting × Tally XML / receipts CSV | D1 fixed the app's ledger only. The Tally journal for a netting row still debited **"&lt;client&gt; (Creditor)"** and the receipts CSV deposited to it: in Tally the hand-linked supplier's ledger kept the full ₹1,80,000 payable and a phantom creditor ledger in the client's name held the debit — the defect D1 fixed, back in the books the CA imports | `exchangeCreditorLedger` (`export-shared.ts`): a netting row (`netting_id`) → the bill's own supplier ledger (the purchase voucher's party); R9 / R12 exchanges keep their URD creditor ledger. Used by `tally-xml.ts` and `accounting-export.ts` — PF23 | `U8` (Tally: supplier Cr 1,15,000 left, client 0, no phantom ledger, journal Dr supplier / Cr client; CSV) |
| U9 | P2 | R16-B5 delete partner × openings | `deletePartner` refused only when a voucher or a `partner_runs` row named the partner: a partner whose capital ledger had an **opening balance** (the usual case after migration) could be deleted, leaving the capital orphaned for appropriation / 194T | Openings on the capital / current ledger also refuse ("has postings. Enter an exit date…") | `U9` |

## 2. R16-A runtime: what was checked and found right

- **Hindi split on every screen family.** The Playwright sweep (Hindi on, 2–2.5 s after load) over Dashboard, Books (18
  tabs), GST reports, Inventory, Receivables (9 tabs), Time (13 tabs incl. WIP's 7 views and the R16-B Disbursements
  view), Expenses (5), Clients, Settings, Transactions, Reports, Payroll, Recurring, Reconcile, Exports, TDS, Loans,
  Cheques, Practice, Design, Manufacturing, Distribution, POS, Tables, Order pad and the editor: the only English left
  is **identical on the pre-R16 build** (chart-of-accounts ledger names are data; ratio-analysis row labels; the Design
  Studio sample invoice prints in the document language; "GSTR-1 filed" on the practice desk; "Dine-in") — left as found,
  not R16 regressions. No page errors.
- **`.hi` read before load.** Only `works-text.ts` (construction paper) reads an area's `.hi`; its area is in `HI_INLINE`
  (inline Hindi). `WhatsNew` / `ScreenTip` / `Term` read their own data, not areas. Bilingual prints (`amount-in-words-hi`,
  e-invoice print, gateway) are inline / allow-listed.
- **Lazily imported libs that bring a new area** (notification providers, palette destinations, guard hooks): providers
  compute their text when the bell runs and the bell re-runs fresh when opened; guard messages are built at save time,
  after the module (and its Hindi) has loaded. No change.
- **Language switch online / offline**: unchanged cases still pass (offline message, stays English, online pack 94/94,
  regional not fetched, offline Hindi reload, pack re-cached across an update, broken deploy rejected).
- **Chunk groups / first paint**: 4 initial files, Hindi in core 21.3 kB (cap 36), `lazy-leaves` 16.3 kB (cap 20), group
  invariants pass; `html-esc` / `day-math` not initial.
- **CSP**: no violations in `verify-offline` (including the new upgrade / pruning / first-visit blocks) or the e2e.

## 3. Seams walked and found correct

- **R16-B media lines**: agent mode is one `rule33` pure-agent line per insertion (no HSN, 0 %), so GSTR-1 / HSN /
  e-Invoice `ItemList` leave it out and `feeBase` (`isRecovery`) keeps it out of the 194J / 194C base; principal-mode
  cost and the fee lines are ordinary taxable lines at the firm's SAC. Media expense rows billed through `bill_refs` leave
  the expense selection.
- **R16-B appearances**: lines carry `bill_refs` of their entries; the entries are marked invoiced and still count for
  realisation; off = the same draft.
- **R16-B disbursement write-off**: stamps `PurchaseRecord.ps.wo` (no journal, PS56); the Unbilled list leaves it out;
  deleting / restoring the bill goes through the bin with the stamp.
- **R16-C commission**: 194H / 194D through the R14-D receivable path on the commission before GST (`tds_on_taxable`), so
  it reaches the TDS receivable register and the chase list (existing `tv-commission` tests); insurer → outward reverse
  charge.
- **R16-D netting** in the app: ledger, bill-wise payables, cash book (`movedNoCash`), reversal (rows removed → postings
  derived away). Exports fixed by U8.
- **Pending changes**: no rule file or `src/lib` reader imports `pending-changes.ts` (guarded by its test); screens load
  it lazily.

## 4. Size

| Budget | Before (`4efee3c`) | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 182.1 kB, 4 files | 182.2 kB, 4 files | +0.1 (U3 listener, U5 ack wait in `i18n/index.ts`) |
| Entry chunk | 88.1 kB | 88.2 kB | +0.1 |
| Core precache | 3,103.0 kB | 3,104.1 kB | +1.1 (sw.js is not JS-budgeted; seams and memo deps) |
| Hindi pack | 340.6 kB | 340.6 kB | 0 |
| Regional pack | 20.7 kB | 20.7 kB | 0 |

## 5. Regression tests

`tests/qa19-platform.test.ts` (U1–U5), `tests/qa19-seams.test.ts` (U7–U9), `tests/perf.test.ts` (U6),
`scripts/verify-offline.mjs` (U1–U3 in Chromium against the production build).

## 6. CA questions

PF22 (re-issue refund credit note), PF23 (netting journal in Tally / CSV) in `docs/CA_REVIEW.md` §16.2 (total 565 → 567).
