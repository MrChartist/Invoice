# PRD — Round 16: platform round (size headroom, unwired engines, cross-cutting quality, Oct 2026 – Apr 2027 statutory watch)

Status: draft for build · Drafted 2026-10-28 · Baseline: branch `claude/elegant-cannon-cwapiv` at `0521a90`. Merged on
the baseline: Phases 0–8, Rounds 2–6, QA rounds 3–17, Rounds 7–15 (R15-A … R15-D). No other round is being built in
parallel.

Companion documents:
- `docs/CA_REVIEW.md` §16: the CA items **PF1–PF18** (§9 of this PRD). The lead copies them there when the PRD is
  accepted. `PF` ("platform") is a new prefix. The prefixes already used are `A B C D G H I M P Q R S T X AC AG CN HT MF
  PS QA RT SV TR TV`. `PF` cannot collide with `P…` ids because every CA-id regex needs a digit right after the prefix.
- Sources: §2.8. **P** = primary text read this round, **S** = secondary source, **V** = vendor's own claim.
- Measurement scripts used for §2 (scratch, not committed): a build-only Hindi-split plugin, a module-graph plugin for
  "safe" groups, and gzip -9 counters with the method of `scripts/check-bundle-size.mjs`. A1 / A2 re-create them
  properly as committed build scripts (§4).

**Round 16 adds no vertical.** Every item follows `AGENTS.md`:
- **Local-first and serverless.** No new network call. The Hindi pack is fetched from the app's own origin by the
  service worker, like every other precached chunk today.
- **Styling.** Vanilla CSS Modules with tokens. Templates use the `accent` variable only (Critical Rule 5).
- **Invoice snapshots never change.** Nothing in this round changes what an existing document prints.
- **Dates.** Bare dates are parsed as local days.
- **Statutory values.** Date-keyed and append-only. A row is `verified: true` only when its value was read in a primary
  text this round. A recommendation that is **not yet notified** never becomes a rule row (§4 D4).
- **Outputs are working papers** with "verify with your CA" (Critical Rule 10).

---

## 1. Problem statement

### 1.1 Why a platform round

| Budget (gz -9) | Now (`0521a90`) | Limit | Headroom |
|---|---|---|---|
| Initial JS (first paint) | **182.6 kB** | 185 kB | 2.4 kB |
| Entry chunk | 88.6 kB | 100 kB | 11.4 kB |
| Total JS (= offline precache) | **3,429.3 kB** | 3,500 kB | **70.7 kB** |

Rounds 13–15 each measured 60–130 kB gross. The next vertical does not fit. Three things are also left over from the
last rounds:
- **Engines with tests and no screen** (QA17 "Not wired"; R15-C / R15-D cuts).
- **Deviation notes** that hide real defects (one wrong ledger, one layout bug, two cautions never shown).
- **Statutory changes announced in Oct 2026.** The 57th GST Council (8 Oct 2026) recommended changes that touch
  refunds, late fees, export of services, RCM on scrap and e-invoicing. None is notified yet (§2.7).

**Goal of Round 16:** ship **4 packages, 19 items**:
- **R16-A: size recovery** (merged first). Hindi out of the English chunks, "safe" chunk groups, shared helpers, new
  budgets. Measured: **English precache −314.6 kB**, first paint **−1.2 kB**.
- **R16-B: wire the Round 14 engines** (professional firms). ≤ 8 kB.
- **R16-C: travel / hotel leftovers** (commission invoices, re-issue, bed-bank preset, demo rows). ≤ 8 kB.
- **R16-D: cross-cutting quality and the statutory watch.** ≤ 5 kB.

### 1.2 What R16-A recovers (measured on `0521a90`, §2.1–2.4)

| Lever | Total JS / English precache | First paint | Status |
|---|---|---|---|
| A1 Hindi strings out of every English chunk, into Hindi chunks precached only on Hindi devices | **−279 to −290 kB** English precache (Hindi pack 286–365 kB, never downloaded by English devices) | **−0.7 kB** | Measured (build) |
| A1 also moves the two existing language chunks (`hi.ts` 8.8 kB, `regional.ts` 20.6 kB) into language packs | −29.4 kB English precache | 0 | Measured (chunk sizes) |
| A2 "safe" family groups (R7–R15 libs + their string areas) | **−32.3 kB** total | −0.1 kB | Measured (build) |
| A2 "lazy-leaves" group (lib modules ≤ 3 kB whose imports are all first-paint / vendor) | −9.2 kB more (−41.5 with families) | −0.4 kB more | Measured (build) |
| A3 duplicated helpers (≈ 120 copies of `esc`, `daysBetween`, `addDays`, `fyOf`, `roundQty` …) | ≈ −2 to −3 kB | 0 | Estimated (not built) |
| **A1 + A2 measured together** | total **3,400.3 kB** of which **English 3,114.7 kB (−314.6)** + Hindi 285.7 kB; English **3,085.3 kB (−344.0)** with `hi.ts` / `regional` as packs | **181.4 kB (−1.2)** | Measured (build) |

The target (≥ 150 kB recovered, first paint unchanged or smaller) is met **only if the lead accepts the precache
change** (§8 Q1): Hindi chunks are not precached on English devices. Without it the Hindi bytes still ship, and only
A2 + A3 count (≈ −44 kB).

### 1.3 Non-goals

- **No new vertical, route or sidebar item.** New screens are views inside existing desks.
- **No `strictExecutionOrder`, no `includeDependenciesRecursively: false`.** Measured: +149 kB total and +8.5 kB first
  paint (§2.3).
- **No "core lazy" mega-chunk.** Measured −247 kB total, but one 842 kB-gz chunk then loads with every lazy screen
  (§2.3).
- **No renaming of files `AGENTS.md` names.** The Hindi split is a build transform. Area files keep `defineArea(en, hi)`
  as written, and the typecheck still forces every Hindi key.
- **No rule row for un-notified recommendations.** They go into a "pending changes" list (D4) until a notification is
  issued.
- **Deferred:** row-level `invoices` storage (PERF-3 rest), the ARQP scheme (57th Council concept note only), the
  e-Way Ship-to GSTIN change (on hold since 29 Jul 2026).

---

## 2. Findings

### 2.1 Baseline measurements (`0521a90`)

`npx vite build` (Vite 8.0.10, rolldown 1.0.0-rc.17) + `node scripts/check-bundle-size.mjs`, gzip -9, KiB:

| | Chunks | Initial | Entry | Total | Initial files | `import{…}from` statements |
|---|---|---|---|---|---|---|
| Baseline | 1,009 | 182.6 | 88.6 | 3,429.3 | 4 | 5,879 |

The build takes ≈ 4 s, so every variant below is a real build, measured and then reverted (`git checkout vite.config.ts
src/i18n/area.ts`). The tree was clean after every run.

### 2.2 Hindi inside English chunks

**Where the Devanagari is (source, string literals containing Devanagari, raw):**

| Source | Files | Raw |
|---|---|---|
| `src/i18n/areas/*` (`defineArea(en, hi)`) | 151 | 951 kB |
| `defineArea` calls in components / libs outside `areas/` | 36 | (in the 212 calls below) |
| `src/lib/help/*` (topics, glossary, tips) | 9 | 39 kB |
| `src/i18n/hi.ts` (already a lazy language chunk) / `mr.ts` (in `regional`) | 2 | 26 / 29 kB |
| `message-langs.ts` (WhatsApp text in Hindi, needed in every UI language) | 1 | 9 kB |
| Bilingual print (`amount-in-words-hi`, construction paper, einvoice print), keymap, what's new | ≈ 20 | ≈ 10 kB |

**In the build:** 187 of 1,009 chunks contain Devanagari. Blanking every Devanagari literal saves **266.7 kB gz**. The
literals alone gzip to 280.8 kB per chunk (1,082 kB raw). Round 15's "≈ 440 kB" compressed each literal on its own,
so it overstated the saving.

**The experiment (A1's design, built for real).** A build-only plugin (`enforce: 'pre'`, rolldown `parseAst`)
rewrites the second argument of every `defineArea(en, hi)` into `() => import('virtual:hi-area/<file>~<hash>')`.
- **212 calls moved, 0 skipped.** Every `hi` argument is a static object of string literals.
- Two files were kept inline because code reads `T.hi` directly:
  - `gateway.ts`: `GatewayMenu` shows the other language beside each item;
  - `construction-r11a.ts`: `works-text.ts` prints the bilingual works paper.
- `area.ts` accepted a loader in place of the object. Hindi loads when the language is Hindi; `setLanguage('hi')`
  awaits the areas already evaluated.

| Variant (Hindi grouping) | Chunks | Initial | Entry | Total (all JS) | **English chunks** | Hindi chunks |
|---|---|---|---|---|---|---|
| Baseline | 1,009 | 182.6 | 88.6 | 3,429.3 | 3,429.3 (Hindi inside) | — |
| One Hindi chunk per call (212) | 1,221 | **181.9** | 87.9 | 3,504.3 | **3,138.9 (−290.4)** | 365.3 |
| One `hi-areas` chunk | 1,010 | 181.9 | 87.9 | 3,435.9 | 3,150.2 (−279.1) | **285.7** (1,152 kB raw) |
| `hi-areas` with `maxSize: 200000` | 1,018 | 181.9 | 87.9 | 3,444.7 | 3,150.6 | 294.1 in 9 chunks |
| **One Hindi chunk per string family** (`name()` by area file prefix: `gst`, `prof`, `agri` …), with A2 | 1,020 | 181.4 | 87.4 | 3,447.4 | **3,115.1** | **332.3 in 105 chunks** (largest `hi-gst` 22.2 kB) |

What is left in English chunks after the split: **34.3 kB gz** of Devanagari in 32 chunks. It breaks down as:
- language chunks `regional` 7.2, `hi` 6.2;
- help glossary 6.7 and help topics ≈ 4.3;
- keymap 2.0, `message-langs` 1.8;
- the construction paper 0.9 and small bilingual-print bits.

**Parse cost for Hindi devices.** A cold `import()` of the single `hi-areas` chunk (1.15 MB raw) took **38–44 ms in
Node on this container**, about 4× more on a mid-range phone. Loading it at boot would therefore add ≈ 150 ms to every
Hindi start. Family chunks load only with their screens. Their total is 46 kB larger, but no screen pays for another
family's strings. **A1 uses family chunks** (§8 Q2).

**Why first paint drops by 0.7 kB:** some first-paint modules call `defineArea`, for example the Dashboard's
gift-voucher tile (`DashboardTiles.tsx:54`). Their Hindi leaves the entry chunk.
- On a Hindi device these modules are evaluated before `initI18n()` sets the language, so they are still English at
  that moment.
- `setLanguage('hi')` awaits their loaders, and `main.tsx` already awaits `initI18n()` before the first render.
- The first paint is therefore Hindi with no flash.

### 2.3 Merging small chunks (groups that do not drag dependencies into first paint)

**The baseline's small chunks.** 595 chunks are under 2 kB gz (549 kB in total); 341 are under 1 kB gz (183 kB). The
table below is an upper bound: it concatenates each family's chunks under 2 kB.

| Family (chunks < 2 kB gz) | Chunks | Apart | Together | Bound |
|---|---|---|---|---|
| R8 trade | 37 | 34.0 | 22.9 | −11.1 |
| R14 prof | 36 | 28.3 | 19.5 | −8.8 |
| R12 agri | 28 | 27.4 | 19.7 | −7.6 |
| R13 mfg | 20 | 15.9 | 11.1 | −4.8 |
| R10 services | 19 | 14.9 | 10.9 | −4.0 |
| R9 retail | 13 | 12.4 | 9.5 | −2.9 |
| R11 construction | 14 | 11.8 | 9.0 | −2.8 |
| R15 travel | 9 | 6.7 | 5.3 | −1.4 |
| i18n areas | 18 | 17.6 | 12.7 | −4.9 |
| other (core lazy) | 394 | 375.1 | 267.0 | −108.1 |

**The trap QA17 hit.** Rolldown pulls a captured module's static dependencies into its group
(`includeDependenciesRecursively`, on by default). R15-A's `app-initial` group (`tags: ['$initial']`, priority 20)
already takes the first-paint modules out of reach. So a lower-priority group **can no longer push first paint up**,
which QA17's 310 kB trial did. It can still swallow **shared lazy** modules.

| Variant (extra groups after `app-initial`) | Chunks | Initial | Total | Verdict |
|---|---|---|---|---|
| Naive per-family lib groups (`src/lib/<family>/`, priority 10) | 775 | 180.9 | 3,259.0 (−170.3) | **Rejected.** `r-trade` captured 817 kB raw of `ledger/`, `gst-reports`, `books`, `inventory`, `tds-payables` (193 kB gz). Opening Books would load the trade chunk. `r-retail` captured `pos`, `industry-packs`, `advances`, `shop-presets` |
| Same with `entriesAware` (merge threshold 8 kB) | 920 | 184.1 | 3,561.0 (+131.7) | Rejected |
| `strictExecutionOrder: true` alone | 1,009 | 191.1 | 3,578.4 (+149) | Rejected (module wrappers) |
| `includeDependenciesRecursively: false` + strict + lib groups | 901 | 192.6 | 3,648.7 | Rejected |
| A "lazy-core" group for every non-family `src/lib` module (priority 15) + family groups | 636 | 179.3 | 3,182.3 (−247.0) | **Rejected:** `lazy-core` is **842 kB gz / 3.7 MB raw** and loads with nearly every lazy screen |
| **Safe family groups**: a module is captured only if all its static imports (transitively) are in the same family, on first paint or in a vendor group | 978 (libs only) / **944** (libs + rule files + string areas, `-pick` areas excluded) | 182.6 / **182.5** | 3,420.4 (−8.9) / **3,397.0 (−32.3)** | **Kept (A2).** Each `f-*` chunk holds only its family (6.6–19.8 kB gz) |
| Safe groups per `src/lib/<dir>/` (name function) on top | 941 | 182.5 | 3,396.8 (−0.2 more) | Not worth it |
| **+ `lazy-leaves`**: `src/lib` modules ≤ 3,000 B whose imports are all first-paint / vendor | 915 | **182.2** | **3,387.8 (−41.5)** | **Kept (A2).** Leaves chunk 17.2 kB gz |
| + leaves ≤ 2,000 B (lib + i18n) | 919 | 182.2 | 3,391.5 | — |
| + leaves ≤ 6,000 B (lib only) | 892 | 181.9 | 3,376.9 (−52.4) | Option: leaves chunk 52.2 kB gz loads with many screens |
| + leaves ≤ 6,000 B (lib + i18n) | 876 | 181.7 | 3,370.0 (−59.3) | Option: leaves chunk 86.3 kB gz, mixes unrelated strings |
| + all leaves (no size cap) | 794 | 180.6 | 3,300.3 (−129.0) | Rejected: one 2 MB-raw (565 kB gz) chunk |

**How the safe test works.** A `moduleParsed` hook records each module's `importedIds` and the entry. Rolldown calls
group `test` functions at chunking time, after the graph is complete. The test is:

> id matches the family **and** id is not `$initial` **and** every static import is `$initial`, a vendor module, or a
> family module that passes the same test.

The production version must compute this over strongly connected components; the experiment's simple cycle cut is not
enough.

### 2.4 Duplicated helpers across rounds

Grep of `src/lib` + `src/components` for local one-line helpers:

| Helper | Copies | Divergence found |
|---|---|---|
| `esc` (HTML escape for print windows) | 31 (33 in `dist`) | Some escape `'`, some do not (`TdsChasePanel`, `PresumptiveView`, `RoomPicker`, `DeliveriesTab`, `mf-msme-recv` …); some take `unknown`, some `string` |
| `daysBetween` / `dayNo` / `/864e5` day maths | 17 / 12 / 64 sites | UTC vs local `parseDay`; rounding differs |
| `fyOf` | 13 | Returns a start year in some files and `{start, end}` in others (`ps-threshold.ts`); one falls back to the calendar year (`ps-194t.ts`) |
| `addDays` / `addMonths` / `monthEnd` | 10 / 10 / 7 | Month-end clamping differs (`sv-members.ts` returns `clamped`) |
| `roundQty` | 16 | 3 decimals in most files; 6 decimals in `progress-billing.ts` (deliberate) |
| `lockOf` (period-lock shape) | 22 | Same shape everywhere |
| `useRun` (desk run / notify hook) | 9 | Same idea; different signatures |

`src/lib/dates.ts` is **first paint**, so these helpers must not be added there: any export of an entry-chunk module
ships at first paint. The bytes are small (≈ 2–3 kB, estimated). The real value is **one tested definition** of
`esc` (print windows render user text) and of FY maths (Critical Rule 4).

### 2.5 Unwired engines, verified against the code (`0521a90`)

Each export was grepped across `src/` (outside its own file) and `tests/`:

| Engine (file) | Exports with no caller in `src/` | Tests | Where it belongs | → |
|---|---|---|---|---|
| `prof/ps-disb.ts` (149 lines) | `unrecoveredDisbursements`, `ageBuckets`, `disbursementSchedule`, `writeOffDisbursement`, `reverseDisbursementWriteOff` | yes (2) | WIP desk, new view `disb` | B1 |
| `prof/ps-media.ts` (119) | `unbilledMedia`, `mediaLines`, `byMedium`, `commissionLine`, `mediaTds`, `mediaSchedule`, `mediaSnap` | yes | Matters → pre-bill (pack `media`) | B2 |
| `prof/ps-legal.ts` (93) | `appearanceLines` | yes | Pre-bill "Bill appearances" (pack `legal`) | B3 |
| `prof/ps-fx-rates.ts` (69) | `atClosing` | yes | Year-end WIP view: FX memo | B4 |
| `prof/ps-partners.ts` (170) | `deletePartner` | yes | Firm → Partners | B5 |
| `prof/ps-conflicts.ts` (110) | `deleteCheck` | **none** | Matters → Conflicts | B5 |
| `prof/ps-property-pos.ts` | `isPropertyExport` | yes | Superseded by QA17 R6 (`ps.export.pos_class: 'property'`) | B5: remove the dead export and its test (no bytes; less confusion) |
| R15-C cut 1 (commission income) | not built | — | Bookings → commission invoice to the principal, 194H expected, insurer RCM flag | C1 |
| R15-C cut 3 (re-issue) | not built | — | Bookings → Ticket → Re-issue | C2 |
| R15-C cut 2 (bed-bank preset) | not built (`bedbank` kind exists) | — | Statements import presets | C3 |
| R15-B / C / D demo | No event, outbound TCS or statement rows | — | `demo/profile-travel.ts` | C4 |
| R7 `hotel/agent-commission.ts` `recordCommission` | Not wired to a button (R7-B deviation) | yes | Folio → "Agent commission bill" | C5 |

All of these are tree-shaken today, so they cost no bytes. Wiring them is lazy view code only.

### 2.6 Deviation and CA-review sweep (R10–R15 feature docs, QA16, QA17, `CA_REVIEW.md` ★ items)

Each "Deviations" section of `services-r10`, `construction-r11`, `agri-r12`, `mfg-r13`, `prof-r14`, `travel-r15`,
`hotel-r7`, `trading-r8` and `retail-r9` was read. So were QA16 / QA17 "Not changed" and the 13 ★ items of §15.

**Real defects** (a figure or a screen is wrong):

| # | Note (where) | Why it is a defect | → |
|---|---|---|---|
| 1 | R15-A3: "the creditor sub-ledger line uses the client's name … a hand-linked vendor with another name nets in the client's name" (`travel-r15.md` §A deviations) | When `Vendor.client_id` links a vendor whose name differs from the client's, the netting journal debits a creditor sub-ledger named after the **client**. The vendor's own ledger, its statement and its confirmation letter still show the full payable. The bill-wise payables are right, so the books disagree with the payables. | D1 |
| 2 | R15-D: "after **Bill** on the Trips desk (in-app navigation to `/invoice/<id>`), Chromium leaves the editor's whole items footer … without a layout box" (`travel-r15.md` §D deviations) | Add line, the trip row and the chips are invisible until a reload. The e2e step reloads to hide it. Other in-app routes into the editor may hit the same path (the `.wrap` size container). | D2 |
| 3 | CN-A and CN-C: "`bill-guard.ts` realty no-ITC caution … is not wired"; "class-rate notice" in `gst-guards.ts` not wired (`construction-r11.md`) | A real-estate developer under the 1 % / 5 % no-ITC scheme gets no warning when a purchase bill claims ITC, so GSTR-3B Table 4 is overstated. The rules exist (`construction-rules.ts`); only the cautions are missing. | D3 |
| 4 | R15-B: "the bill is refused with an English message (one string in the Expenses chunk)" | A Hindi user sees an English refusal on the ITC-override path. Small, but it is the only untranslated refusal found in Round 15. | D3 (one string) |
| 5 | `esc` divergence (§2.4) | Print windows built with `document.write` from user text. Variants that do not escape `'` are safe only while every attribute stays double-quoted. One tested helper removes the risk. | A3 |

**User-facing gaps worth closing now** (the engine exists): §2.5, items B1–B5 and C1–C5.

**Left as found** (design choices, or the CA must answer first):
- netting by a clerk is refused, not queued (`approvals.ts` holds documents only);
- MF82 CMT pieces;
- the e-Way sub-type 6 (MF92);
- the CN "settings switches" form;
- SV-A "Now serving" customer display;
- MF-C job-charges class suggestion.

### 2.7 Statutory changes effective Oct 2026 – Apr 2027 (web research, 28 Oct 2026)

Confidence: **H** = primary text read; **M** = two secondary sources agree; **L** = one source or conflict. A
recommendation of the GST Council is not law until a notification or an Act amendment is issued, so **every row below
is `verified: false` as a rule value**, even where the recommendation itself was read in the primary press release.

| Change | What / when | App today | Source | Conf. / app action |
|---|---|---|---|---|
| **57th GST Council (8 Oct 2026)** — the meeting | Process reforms; no rate rationalisation | — | **P** PIB release 8 Oct 2026 (read); S taxguru outcome page (agrees on date, late-fee waiver, Apr 2027 mechanism, e-invoicing extension, scrap RCM) | H (recommendation) → D4 pending list |
| Refund of accumulated ITC on **input services** (inverted duty) | For ITC on input services availed **on or after 1 Nov 2026**; capital goods (IDS and zero-rated) over **60 months**, ITC on or after **1 Apr 2027** | `mf/mf-inverted.ts`: Net ITC = inputs only; a dated `inputServices` flag already exists in `mfg-rules.ts` | **P** PIB ¶8.2–8.3; S taxguru (date not stated there) | H recommendation / not notified → D4 (pending note on the refund paper; append the row only when notified) → **PF1** |
| Rule 89(4)(C): remove the 1.5× cap on zero-rated goods turnover | — | `gst-cash-refunds.ts`, R14 `ps-refund-svc.ts` apply the cap | **P** PIB ¶6.2 | H rec. → D4 → PF2 |
| Late fee waived for returns u/s 39(1) (turnover ≤ ₹5 crore) **filed by the end of the month in which due** | Date not given | `gst-penalties.ts` late-fee rows | **P** PIB ¶15; S taxguru | H rec. → D4 → **PF3** |
| Alternate mechanism to amend liability / ITC (GSTR-1/1A/IFF ↔ 3B; Rule 61(1A) / (1B); IMS Rule 60(6A) with a credit-note "pending" period; Rules 86C / 86D statements) | **From the return of April 2027** | GSTR-3B papers, `ims-file.ts`, `gstr2b.ts` | **P** PIB ¶5.1–5.2; S taxguru ("Proposed from April 2027") | M → D4 → PF4 |
| Export of services: delete Sec 2(6)(v) IGST (distinct-person condition) | Needs an IGST Act amendment; no date | R14 `ps-export-check.ts` fails condition (v) for "our own branch" | **P** PIB ¶10 | H rec. → D4 → **PF5** |
| Sec 13(3)(a) IGST omitted: services on goods made available by the recipient → default POS (recipient's location) | Act amendment | `ps-pos.ts`, export check | **P** PIB ¶10 | H rec. → D4 → PF6 |
| RCM on plastic / e-waste / tyre scrap and used cooking oil from unregistered suppliers; **GST TDS 2 %** on B2B supplies of these | Notification awaited | `trading-rules.ts` `RCM_NOTIFIED_GOODS_RULES` (metal scrap since 10 Oct 2024) | **P** PIB C1 ¶5; S taxguru, studycafe, caalley | H rec. → D4 → **PF7** |
| e-Invoicing extended to RCM inward supplies from unregistered persons and to import of services, AATO ≥ ₹5 crore | Date not given | `rcm-self-invoice.ts` (self-invoice, no IRN) | **P** PIB ¶18; S taxguru | H rec. → D4 → **PF8** |
| Sec 17(5) relaxed (outdoor catering, health / life insurance, free samples, goods written off on expiry …) | Act amendment | ITC hints treat them as blocked | **P** PIB ¶9 | H rec. → D4 → PF9 |
| Limited ITC "in the same line of business" for restaurants, hotels ≤ ₹7,500, gyms; 5 % option for EV passenger transport / rental; 5 % no-ITC delivery via ECO | Rate notifications awaited | `hotel-rules.ts`, restaurant, R15 travel regimes | **P** PIB C2 ¶1, 2, 4 | H rec. → D4 → PF10 |
| Max general penalty Sec 125 ₹25,000 → ₹10,000; SCN threshold ₹10,000; arrest powers withdrawn | Act amendment | Not modelled | **P** PIB ¶7, 11 | No app change |
| ARQP scheme (≤ ₹5 crore, B2C only), concept note | In principle | — | **P** PIB ¶17 | Non-goal (watch) → PF11 |
| e-Invoice 30-day IRP reporting limit at AATO ≥ ₹10 crore | Unchanged since 1 Apr 2025; no 2026 extension found | Existing late-IRN warning | S taxmann, indiafilings (Jun 2026), themunim | M / no change (TV24 stands) |
| e-Invoice / e-Way API: mandatory Ship-to GSTIN (URP for unregistered) and voluntary EWB closure from 1 Aug 2026 | **Put on hold 29 Jul 2026**, no new date | `einvoice.ts` already writes `ShipDtls.Gstin` when the consignee has one | S taxo.online, lookuptax, busy.in, carajput | M / no change → PF12 (watch) |
| GSTR-3B Table 5.1 interest: auto-populated, not editable downward (Jan / Feb 2026 periods) | In force (advisories 30 Jan / 19 Feb 2026) | `gst-penalties.ts` interest paper | S taxmann, Masters India, taxo.online | M / help note only → PF13 |
| Income-tax Act 2025 Sec 397(1)(c): a resident individual / HUF buying property from a **non-resident** needs no TAN | **1 Oct 2026** | No app impact (no individual-buyer flow) | **P** Finance Bill 2026 cl. 75 and Memorandum (read) | H (Bill) / no change |
| Declaration (15G / 15H type) to a depository; quarterly furnishing | **1 Apr 2027** | No app impact | **P** Memorandum cl. 72 | — |
| TCS on overseas tour packages 2 % (Sec 394(1) Sl. 8) | 1 Apr 2026 (R15) | `travel-rules.ts` | Act text still not found (S taxaj; no gazette text in results) | Stays `verified: false` (TV1) |

Not found: a 2026 GSTN advisory changing invoice-reporting time limits, and any CBIC notification implementing the
57th Council (searched 28 Oct 2026). The CBIC FAQs on goods (9 Oct 2026) are cited by the press but were not read.

### 2.8 Sources

Accessed 28 Oct 2026.

**Statute, Council and regulators**
- **P** PIB, "Recommendations of the 57th Meeting of the GST Council", posted 08 Oct 2026 —
  https://www.pib.gov.in/PressReleasePage.aspx?PRID=2320934 (fetched; ¶5.1–5.2, 6.2, 7, 8.2–8.3, 9, 10, 15, 17, 18, C1 ¶5,
  C2 ¶1–4 quoted above)
- **P** Memorandum explaining the Finance Bill 2026 — clauses 72 (1 Apr 2027), 74, 75 (Sec 397(1)(c), 1 Oct 2026) —
  https://www.indiabudget.gov.in/doc/memo.pdf ; Finance Bill 2026 notes on clauses — https://www.indiabudget.gov.in/doc/Finance_Bill.pdf
- S Outcome of the 57th GST Council — https://taxguru.in/goods-and-service-tax/outcome-57th-meeting-gst-council.html ;
  https://studycafe.in/57th-gst-council-meeting-2026-new-gst-rules-proposed-for-waste-and-scrap-under-rcm-and-2-tds-427371.html ;
  https://caalley.com/news-updates/indian-news/gst-council-proposes-2-tds-on-scrap-deals
- S e-Invoice 30-day rule unchanged — https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/ ;
  https://www.indiafilings.com/learn/gst-einvoice-30-day-rule-10crore-turnover/ ; GSTN advisory on mahagst.gov.in (listed, not read)
- S Ship-to GSTIN / EWB closure (advisory 17 Jun 2026, from 1 Aug 2026) and the hold (29 Jul 2026) —
  https://taxo.online/latest-news/gstn-system-enhancements-new-e-invoice-and-e-way-bill-api-changes-effective-1-august-2026/ ;
  https://lookuptax.com/tax-changes/india/gstn-einvoice-api-ship-to-2026 ; https://lookuptax.com/tax-changes/india/gstn-advisory-668-eway-einvoice-on-hold ;
  https://busy.in/business-updates/e-way-bill-changes-2026-gstn-puts-august-updates-on-hold/ ; https://carajput.com/blog/gstn-puts-proposed-e-way-bill-changes-on-hold/
- S GSTR-3B interest / IMS 2026 — https://www.taxmann.com/post/blog/gstn-enhances-gstr-3b-interest-and-itc-functionality/ ;
  https://www.mastersindia.co/blog/gstn-gstr-3b-interest-itc-changes-2026/ ;
  https://taxo.online/latest-news/20-02-2026-gstn-issued-advisory-on-interest-collection-gstr-3b-enhancements-same-shall-be-available-from-february-2026-period/ ;
  https://www.gstcouncil.gov.in/sites/default/files/2026-05/newsletter_april_issue.pdf (listing)
- S TCS tour package 2 % for FY 2026-27 — https://www.taxaj.com/learn/?p=1290 (Act text not found)

**Build tooling**
- rolldown 1.0.0-rc.17 `CodeSplittingGroup` (`name` as a function, `test` as a function, `priority`, `maxModuleSize`,
  `entriesAware`), `CodeSplittingOptions.includeDependenciesRecursively`, `parseAst` —
  `node_modules/rolldown/dist/shared/define-config-*.d.mts`, `parse-ast-index.d.mts` (read)

---

## 3. Ranked list

Value 1–5. Effort S = 1, M = 2, L = 3. **Cut** = the order a package drops items at its cap (1 = first to go).

| Rank | Id | Item | Value | Effort | Pkg | Cut |
|---|---|---|---|---|---|---|
| 1 | A1 | Hindi split + language packs in the precache | 5 | M | A | never |
| 2 | A2 | Safe family groups + `lazy-leaves` | 4 | S | A | never |
| 3 | A4 | Budgets, Hindi-leak check, docs | 5 | S | A | never |
| 4 | D1 | Netting: debit the linked vendor's own sub-ledger | 5 | S | D | never |
| 5 | D2 | Editor footer layout after in-app navigation | 4 | S | D | never |
| 6 | D3 | Realty no-ITC caution + CN class-rate notice + the Hindi refusal | 4 | S | D | never |
| 7 | D4 | Pending-changes list (57th Council) with notes on five screens | 4 | S | D | 1 (notes on the refund paper and late-fee card only) |
| 8 | B1 | Unrecovered disbursements: ageing, schedule, write-off | 4 | S | B | never |
| 9 | C1 | Commission invoices to principals, 194H expected, insurer RCM | 4 | S | C | never |
| 10 | A3 | Shared `esc` / day-maths helpers | 3 | S | A | 1 (keep `esc` only) |
| 11 | B5 | Delete partner / conflict check; drop dead export | 3 | S | B | never |
| 12 | B3 | Per-appearance lines on the pre-bill | 3 | S | B | 3 |
| 13 | B2 | Media billing rows on the pre-bill | 3 | M | B | 1 (keep `mediaLines` + `commissionLine`, drop schedule print) |
| 14 | B4 | FX closing memo on the year-end WIP | 2 | S | B | 2 |
| 15 | C5 | Hotel agent-commission button | 3 | S | C | 3 |
| 16 | C2 | Ticket re-issue | 3 | M | C | 1 |
| 17 | C4 | Travel demo rows (event, outbound TCS, BSP statement) | 2 | S | C | 2 |
| 18 | C3 | Bed-bank statement preset | 2 | S | C | 4 |
| 19 | D5 | GSTR-3B interest help note; Ship-to watch note | 2 | S | D | 2 |

Rejected (measured, §2.3): naive family groups, `entriesAware`, strict execution order, the lazy-core group, uncapped
leaves.

---

## 4. Specifications (19 items)

Conventions for every item:
- **Tests.** Logic is tested with `node:test` (`tests/*.test.ts`); UI with `step(...)` blocks in `tests/e2e/smoke.mjs`.
- **Strings.**
  - New strings go through `defineArea(en, hi)` as today. After A1 the Hindi goes to the Hindi pack automatically.
  - From A1 on, a package's size counts **English** bytes only. Hindi has its own budget (§11).
- **Help.**
  - A new view needs a help topic (`tests/help-registry.test.ts`) and a Ctrl+K title (`discover-r6-tabs.ts`).
  - CA ids `PF…` are cited as `ca: ['PF5']`. A adds `PF` to the three CA-id regexes.
- **Icons.** Reuse only (grep before use).
- **Guards.**
  - Destructive calls use `requireAccess`, and writes in a locked period use `assertUnlocked`.
  - Deletes go through the data layer (recycle bin).
  - A multi-table write uses `withTablesRollback`.
- **Registries.** Writers import their round's registry (`ps-registry`, `tv-registry`, `ag-registry` …) as `AGENTS.md`
  requires.

### R16-A — Size recovery (merge first)

#### A1 Hindi out of the English chunks; language packs in the precache

**User story.**
- As an English user, I install and update a lighter app, and none of my offline features change.
- As a Hindi user, every screen is in Hindi offline, after one online visit once I switch to Hindi.

**Acceptance criteria.**
1. **Build transform, source unchanged.**
   - **Plugin.** `scripts/vite-hi-split.mjs` (build only, `apply: 'build'`, `enforce: 'pre'`, rolldown `parseAst`)
     rewrites the `hi` argument of each `defineArea(en, hi)` into a loader of a virtual module
     `virtual:hi/<family>/<file>~<hash>`.
   - **Family.** The area file's prefix up to the first `-r<digits>` / digit / `-` segment that names a round or a
     sub-area (`prof-r14a-matters` → `prof`, `gst-views` → `gst`, `books-ledger` → `books`). Calls in components use
     the component's folder name.
   - **Dev.** The dev server keeps Hindi inline, so `npm run dev` is unchanged.
   - **Fail-loud.** The plugin **fails the build** on a `hi` argument that is not a static object of string literals,
     unless its file is listed in `HI_INLINE`. On the baseline: 212 calls, 0 non-static.
2. **`HI_INLINE` allow-list.** The translators whose `.hi` is read directly stay inline:
   - `i18n/areas/gateway.ts` (bilingual Gateway menu);
   - `i18n/areas/construction-r11a.ts` (bilingual works paper).

   `tests/hi-split.test.ts` greps `src/` for `\w+T\.hi\b` / `\.hi\[` and asserts that every reader's area is in
   `HI_INLINE`. A new bilingual print must add its area there.
3. **Runtime** (`src/i18n/area.ts`, `src/i18n/index.ts`, first paint; budget ≤ +0.3 kB, measured experiment −0.7 kB
   net):
   - `defineArea(en, hi | loader)`. With a loader the translator returns English until the Hindi object arrives, and
     `.hi` returns the loaded object, else `en`.
   - A registry of pending loaders. `setLanguage('hi')` awaits every evaluated area's loader **before** it emits.
   - An area evaluated while the language is Hindi starts its load and, on arrival, bumps an i18n **version** counter.
   - `useT()` snapshots `lang + version`, so mounted components re-render.
   - Boot: `initI18n()` (already awaited by `main.tsx`) loads the first-paint areas' Hindi, so the first paint has no
     English flash.
4. **Chunks.** One `codeSplitting` group with a `name()` function → `lang-hi-<family>` chunks (priority 25; they have
   no dependencies, so nothing is dragged).
   - `hi.ts` and `regional.ts` are already their own lazy chunks.
   - The plugin's `generateBundle` writes **`dist/lang-manifest.json`**: `{ hi: [files], regional: [files] }`. The
     lists are computed from chunk module ids, never from file names.
5. **Precache** (`scripts/gen-precache.mjs`, `public/sw.js`). This needs the lead's decision, §8 Q1.
   - **Manifest.** `precache-manifest.json` gains `langs: { hi: [...], regional: [...] }`. `files` (installed by every
     worker) **leaves those files out**.
   - **The page tells the worker.** On boot and on every `setLanguage`, it posts `{ type: 'lang', lang }` to the
     worker. The worker stores the choice as a synthetic `/__lang__` response in its cache and caches that language's
     pack at once (online).
   - **Install.** The worker reads `/__lang__` from the previous cache and precaches that pack too. A device already
     in Hindi therefore stays fully Hindi offline across updates.
   - **Offline switch.** Switching to Hindi while offline with no pack cached shows "Hindi needs one online visit"
     (EN + HI) and stays English. `setLanguage` rejects; `LanguageSwitch` shows the message.
   - **Guard.** A language pack whose fetch fails never rejects the core install. It is retried on the next message.
6. **Leak check** (post-build, in `check-bundle-size.mjs`): for every JS file **not** in `lang-manifest.json`, the gz
   estimate of its Devanagari string literals (blank them and re-gzip).
   - **Total cap.** Core total **≤ 36 kB** (measured 34.3 after A1).
   - **Per-chunk cap.** **≤ 1 kB** per chunk, except the allow-listed modules:
     - `message-langs`, `keymap`, `amount-in-words-hi`;
     - the construction paper, `gateway`, `einvoice-print`, `whats-new`;
     - help `glossary` / `topics-*`, `ScreenTip`.

     A module is matched by name in a build meta file, `build-meta/chunks.json`, written outside `dist/` and never
     precached.
   - **Failure message.** "Hindi strings re-entered English chunks: <chunk> (<kB>) from <module>; use `defineArea` or add
     the module to `HI_INLINE` / the allow-list with a reason".
7. **Measured on the A1 commit, in `docs/qa/performance.md`.**
   - Required: English precache **≤ 3,160 kB**, Hindi pack **≤ 345 kB**, initial **≤ 182.6 kB**.
   - The author's family build: English 3,150 kB without A2 (3,115 kB with it), Hindi 332.3 kB.
   - **Stop rule.** If the English saving is below 200 kB, A1 stops and reports.
8. `npm run test:e2e` and `npm run verify:offline` pass; §7 adds a Hindi step and an offline-Hindi step.

**Files.**
- New: `scripts/vite-hi-split.mjs`, `tests/hi-split.test.ts` (transform fixtures: object literal, template literal,
  non-static → error, `HI_INLINE`, family names), `tests/i18n-lazy-hi.test.ts` (loader registry, version bump,
  `setLanguage` awaits, `.hi` fallback).
- Edit: `vite.config.ts` (plugin + group), `src/i18n/area.ts`, `src/i18n/index.ts`, `scripts/gen-precache.mjs`,
  `public/sw.js`, `scripts/check-bundle-size.mjs`, `scripts/verify-offline.mjs` (language-pack cases),
  `src/components/ui/LanguageSwitch.tsx` (offline message), `docs/features/i18n.md`.

**Not in A1.** Help topics and the glossary keep their Hindi positional arguments (≈ 11 kB gz). Moving them needs
another transform; it is listed for a later round.

#### A2 Safe family groups and lazy leaves

**Acceptance criteria.**
1. **Graph plugin.** `scripts/vite-safe-groups.mjs` exports:
   - `graphPlugin()`: `moduleParsed` → static `importedIds`, plus the entry;
   - `safeFamilyGroup(name, re, priority)`;
   - `leafGroup(name, priority, { maxModuleSize })`.

   "Safe" is computed over strongly connected components, so a cycle inside a family passes only if the whole
   component passes. It allows `$initial` modules, the vendor groups and family members.
2. **Groups in `vite.config.ts`, after `app-initial`.**
   - Families, priority 12: `f-hotel`, `f-trade`, `f-retail`, `f-services`, `f-cn`, `f-agri`, `f-mfg`, `f-prof`,
     `f-travel`. Each is `src/lib/<family>/` + `src/lib/<family>-rules.ts` + `src/i18n/areas/<family>-r<n>*`, with
     `-pick` areas excluded (the wizard imports those).
   - `lazy-leaves`, priority 9: `src/lib/**`, `maxModuleSize: 3000`.
   - A later family adds its row in the same shape.
3. **Post-build invariant** (`check-bundle-size.mjs`, from `build-meta/chunks.json`):
   - every module of an `f-*` chunk matches its family regex;
   - every module of `lazy-leaves` imports only first-paint / vendor modules;
   - `lazy-leaves` ≤ **20 kB gz**.
4. **Measured on the A2 commit.** Total −41.5 kB (families −32.3, leaves −9.2); initial −0.4 kB.
   - **Stop rule.** If the result is < −25 kB, report.
   - **Option for the lead.** `maxModuleSize: 6000` (−52.4 kB, leaves 52 kB gz).
5. `tests/bundle-config.test.ts` pins the group names, their priorities, the absence of any group without a `test` /
   `tags` filter, and that no group matches `jspdf` / `html-to-image`.

**Risks.** A family chunk is loaded by any screen of that family. That is the intent (packs are per company), and
another family's screens never load it (test 3).

#### A3 Shared helpers (lazy)

**Acceptance criteria.**
1. **New lazy modules (never first paint):**
   - `src/lib/html-esc.ts` with `escHtml(v: unknown)`, which escapes `& < > " '`;
   - `src/lib/day-math.ts` with `daysBetween` (local days via `parseDay`), `addDays`, `addMonths(day, n, { clamp })`,
     `monthEnd`, `fyStartYear(day)` (Apr–Mar) and `fyBounds(day)`.
2. **Replace local copies in lazy modules only.** Leave `progress-billing.ts` `roundQty` (6 decimals) and every module
   in `app-initial` alone. The bundle check fails if `html-esc` or `day-math` lands in the initial chunk.
3. **Tests:** `tests/day-math.test.ts` (FY edges 31 Mar / 1 Apr, leap years, month-end clamps, DST-free local days) and
   `tests/html-esc.test.ts`. Existing tests pass unchanged.
4. **Measured.** The result must be ≤ 0 kB total. If it is positive, keep only the `esc` unification (cut 1).

#### A4 Budgets, CA prefix, docs

1. **`check-bundle-size.mjs`.**
   - `BUDGET_TOTAL` now measures the **core precache** (all JS minus `lang-manifest.json` files).
   - New budgets: `BUDGET_LANG_HI_GZ_KB` and `BUDGET_LANG_REGIONAL_GZ_KB`; values in §11.
   - The Hindi-leak check (A1.6) and the group invariants (A2.3).
2. `PF` in the CA-id regexes of `tests/help-registry.test.ts`, `tests/help-glossary.test.ts` and
   `tests/docs-links.test.ts` (with a `PF1` vs `P1` case).
3. `docs/qa/performance.md`: an "R16-A" section with the before / after table. `AGENTS.md` (lead):
   - Stack: "`vite-hi-split` moves `defineArea` Hindi into `lang-hi-*` chunks; precache language packs via
     `lang-manifest.json`; add bilingual readers to `HI_INLINE`";
   - "family chunk groups are safe groups (`vite-safe-groups.mjs`); a new family adds one row".

### R16-B — Wire the Round 14 engines (pack-gated, lazy; ≤ 8 kB English)

#### B1 Unrecovered disbursements

- **View.** WIP desk → **Disbursements** (`/time?tab=wip&view=disb`, packs `practice` / `legal` / `cafirm`):
  - `unrecoveredDisbursements` by client / matter, with `ageBuckets` (0–30 / 31–60 / 61–90 / 90+);
  - Print schedule (`disbursementSchedule`, through the existing print window, with `escHtml`);
  - **Write off** (`validateWriteOff`, `writeOffDisbursement`; `requireAccess('books.edit')`, period lock; no journal,
    PS56) and **Reverse**.
- Tests: the existing `ps-disb` tests plus one view-model test (`tests/ps-disb-view.test.ts`, filters and totals).
  E2E §7.

#### B2 Media billing on the pre-bill

- **Pre-bill rows (pack `media`).** "Media" rows from `unbilledMedia` grouped `byMedium`, each billed:
  - principal: cost + fee;
  - agent: pure-agent recovery (`rule33`) + fee (`mediaLines`).
- Optional publisher **commission line** (`commissionLine`) and the expected TDS hint (`mediaTds`).
- The snapshot `mediaSnap` goes into `ps` (the existing record key; **no new key**).
- Cut 1 drops the schedule print (`mediaSchedule`).

#### B3 Per-appearance billing

On the pre-bill (pack `legal`), a toggle **Bill appearances**: entries of appearance work types become `appearanceLines`
(count × fee). Time still counts for realisation. Off = today's lines (test: byte-identical draft).

#### B4 FX closing memo

Year-end WIP view, for a foreign-currency rate card or open foreign invoice: a memo column **"At closing rate"**
(`atClosing` with the year-end row from the currency master). It is a memo only, never a journal (PF14).

#### B5 Delete partner / conflict check; dead export

- **Firm → Partners → Delete** (`deletePartner`):
  - refused while a `partner_runs` row or a ledger balance names the partner;
  - `requireAccess('settings.manage')`; recycle bin.
- **Conflicts → Delete** (`deleteCheck`) with a new test `tests/ps-conflicts-delete.test.ts`.
- Remove `isPropertyExport` and its test case (superseded by QA17 R6). Note it in `prof-r14.md`.

### R16-C — Travel and hotel leftovers (pack-gated, lazy; ≤ 8 kB English)

#### C1 Commission income (R15-C4 as specified there)

On a booking with `commission`: **Bill commission** creates an invoice **to the principal** (airline / hotel /
insurer):
- 18 % at the agent's SAC (rule row in `travel-rules.ts`, `verified: false`, TV16);
- expected TDS 194H from `tds-rules.ts` (2 % from 1 Oct 2024), labelled by date through `ita2025.ts`;
- for an insurer, the existing outward-RCM flag (TV17).

The booking keeps `commission.bill_id`; billed is derived as in B2. The trip margin is unchanged (it already counts
typed commission). Tests: `tv-commission`.

#### C2 Ticket re-issue

On a ticket line: **Re-issue**. It records a new ticket number, the fare difference (pure agent), the airline change
penalty (pure agent) and our re-issue fee (18 %, the C1 SAC row).
- Draft invoice through `buildBillDraft`.
- The original `tkt` is marked `reissued_by`, and its line stays on the old invoice.
- No credit note, unless the difference is negative (then `documents.createCreditNote`). TV35 note.
- Tests: `tv-reissue`.

#### C3 Bed-bank statement preset

A third preset in `tv-statements.ts` (hotel name, confirmation no., check-in, nights, net) using the same
`scoreHeader` synonym table. One test file case.

#### C4 Travel demo rows

`demo/profile-travel.ts`, inside the Demo company only (`demoDatabaseOpen()`):
- an event with a budget and three vendors;
- an outbound Dubai package dated after 1 Apr 2026 with 2 % TCS;
- one 4-row BSP statement (2 matched, 1 ADM, 1 refund).

Cap ≤ 0.6 kB.

#### C5 Hotel agent commission button

Folio → **Agent commission bill** for a reservation with an agent: `recordCommission` → purchase-bill draft with 194H
(R7-B deviation closed).

### R16-D — Cross-cutting quality and the statutory watch (≤ 5 kB English)

#### D1 Netting posts to the linked vendor's own sub-ledger

- **Fix.** A netting receipt (`method: 'netting'`, `netting_id`) whose bill belongs to a vendor linked by
  `Vendor.client_id` posts **Dr Sundry creditors (vendor's name) / Cr Debtors (client's name)**.
  - The posting reads the vendor through the bill.
  - R9 / R12 exchange receipts without `netting_id` keep today's posting; `tests/rt-buyback*.test.ts` and
    `ag-cycle*` pass unchanged.
- **Migration.** None: postings are derived on read (`ledger/postings.ts` builds them from `transactions`).
- **Tests** (`tests/netting.test.ts`): with a vendor named differently from the client,
  - the vendor ledger closes to the bill-wise payable;
  - the client ledger closes to the receivable;
  - the TB is balanced;
  - the cash book is unchanged.

#### D2 Editor footer after in-app navigation

> **Status (R16-D): already fixed by QA round 18 T1** (`docs/prd/qa-round-18.md` §2): the size container is now the
> lines block (`.lines`), the footer sits outside it in `.wrap`, for every route into the editor (the cause was the
> shared `ItemsTable`, not the route). Pinned by `tests/qa18-travel.test.ts` T1; the e2e checks `footerLaidOut` after 7
> in-app jumps, and the R15-D reload is gone. R16-D re-verified it (Trips → Bill, no reload) and adds no code.

1. Reproduce: Trips → Bill → `/invoice/<id>`. The items footer has no layout box (`getClientRects()` empty).
2. Fix the cause in the editor shell (`.wrap` size container), and check the other in-app routes into the editor:
   - Convert from quotation;
   - Duplicate;
   - Bill from timesheet;
   - Make bill from statement.
3. Remove the reload from the R15-D e2e step. Add a check that `Add line` is visible after each route above.

#### D3 Construction cautions and the Hindi refusal

1. **`bill-guard.ts`.** A purchase bill claiming ITC for a company whose construction profile is real estate under the
   1 % / 5 % no-ITC scheme (`construction-rules.ts`) gets a caution.
   - It reads lazily (no first-paint bytes) and has a CA-id link.
   - It is the same caution pattern as the R15-B 5 %-trip ITC block (override with an audited reason).
2. **`gst-guards.ts`.** The class-rate notice CN-A left: a works-contract invoice whose rate differs from the
   contract's class.
3. The R15-B ITC-override refusal message gets a Hindi string (`travel-r15b.ts`).

#### D4 Pending changes (57th GST Council) — notes, not rules

1. **New lazy module** `src/lib/pending-changes.ts`: `PENDING_CHANGES` rows with:
   - `{ id, area, summary_en, summary_hi, recommended_on: '2026-10-08', proposed_from?, source: 'PIB 8 Oct 2026 ¶…',
     ca: 'PF…', notified: false }`;
   - `pendingFor(area, day)` returns rows whose `proposed_from` is absent or ≤ the day + 6 months.
2. **Notes**, one line each, "Recommended by the GST Council on 8 Oct 2026, not yet notified — verify with your CA":
   - MF inverted-duty refund paper: input services from 1 Nov 2026 (PF1); capital goods 2027 (PF1);
   - R14 Rule 89(4) paper (PF2);
   - late-fee card (PF3);
   - GSTR-3B paper header, from the April 2027 return (PF4);
   - R14 export check, condition (v) (PF5);
   - R8 RCM goods list (PF7);
   - RCM self-invoice (PF8).

   Cut 1 keeps only the refund paper and the late-fee card.
3. **When a notification is issued**, the developer:
   - appends a dated row to the owning rule file (`mfg-rules.ts` `inputServices`, `gst-penalties.ts`,
     `trading-rules.ts` …) with the notification number;
   - sets `notified: 'N xx/2026-CT'` on the pending row.

   **No reader ever applies a pending row.**
4. **Help → What's new** lists the pending rows (EN / HI) under "Announced, not yet in force".
5. Tests (`tests/pending-changes.test.ts`):
   - no rule file imports `pending-changes.ts`;
   - every row has `ca` and `source`;
   - `pendingFor` dates.

#### D5 Help notes

- GSTR-3B Table 5.1 interest is auto-populated and cannot be edited downward from the Jan / Feb 2026 periods (PF13):
  one help line on the interest paper.
- e-Way / e-Invoice Ship-to GSTIN is on hold (PF12): no change; the help says that `ShipDtls.Gstin` is already written
  when the consignee has a GSTIN.

---

## 5. Work packages

Four packages, each one agent in its own worktree.

**Merge order:** **A first.** It changes what every package measures (English vs Hindi bytes, family chunks) and adds
`PF` to the regexes. Then B, C and D in any order: their files are disjoint except help topics, `discover-r6-tabs.ts`
and `tests/e2e/smoke.mjs` (one block each).

### R16-A — Size recovery (A1–A4)

- **Owned (new):**
  - `scripts/vite-hi-split.mjs`, `scripts/vite-safe-groups.mjs`;
  - `src/lib/html-esc.ts`, `src/lib/day-math.ts`;
  - tests `hi-split`, `i18n-lazy-hi`, `day-math`, `html-esc`.
- **Owned (edit):**
  - `vite.config.ts`, `scripts/check-bundle-size.mjs`, `scripts/gen-precache.mjs`, `scripts/verify-offline.mjs`;
  - `public/sw.js`, `src/i18n/area.ts`, `src/i18n/index.ts`, `LanguageSwitch.tsx`;
  - the lazy modules whose local helpers A3 replaces;
  - `tests/bundle-config.test.ts`, the three CA-regex tests;
  - `docs/qa/performance.md`, `docs/features/i18n.md`.
- **Budget:**
  - first paint ≤ 182.6 kB (measured 181.4);
  - English core ≤ 3,120 kB at the end of A (measured 3,114.7 with `hi.ts` / `regional` still in core; 3,085.3 with
    them as packs);
  - Hindi pack ≤ 345 kB.

### R16-B — Round 14 engines (B1–B5)

- **Owned (new):** `components/prof/DisbView.tsx`, `components/prof/MediaRows.tsx` (exists, extend) or `MediaPrebill.tsx`,
  `i18n/areas/prof-r16b.ts`, tests `ps-disb-view`, `ps-conflicts-delete`.
- **Owned (edit):** `WipDesk.tsx` (view map), `PreBillView.tsx` (two lazy rows), `YearEndWipView.tsx` (memo column),
  `PartnersView.tsx`, `ConflictsView.tsx`, `ps-property-pos.ts` (remove the export), `industry-packs.ts` `PACK_TABS`
  (one row; first paint ≈ +20 B, see risk), help, palette, `prof-r14.md`.
- **Budget:** ≤ 8 kB English total; first paint ≤ +0.05 kB.

### R16-C — Travel and hotel leftovers (C1–C5)

- **Owned (new):** `travel/tv-commission.ts`, `travel/tv-reissue.ts`, `i18n/areas/travel-r16c.ts`, tests `tv-commission`,
  `tv-reissue`.
- **Owned (edit):** `BookingTable` actions, `TicketRows.tsx`, `tv-statements.ts` (preset), `travel-rules.ts` (appended
  `// R16-C` rows), `demo/profile-travel.ts`, hotel `FolioView.tsx` (one button), help, `travel-r15.md` (new §R16-C).
- **Budget:** ≤ 8 kB English total; first paint 0.

### R16-D — Quality and statutory watch (D1–D5)

- **Owned (new):** `src/lib/pending-changes.ts`, `tests/pending-changes.test.ts`.
- **Owned (edit):**
  - `ledger/postings.ts` (netting branch) or `netting.ts`; `tests/netting.test.ts`;
  - the editor shell (`InvoiceCreator` / its CSS module);
  - `bill-guard.ts`, `gst-guards.ts` (lazy checks), `travel-r15b.ts` (one string);
  - the five screens of D4 (one lazy note each);
  - `whats-new.ts` (the version row the lead bumps), help, `CA_REVIEW.md` (lead).
- **Budget:** ≤ 5 kB English total; first paint 0 (`bill-guard.ts` reads its rule lazily, as the R15-B ITC block does).

---

## 6. Shared-file protocol

| File | Who | Rule |
|---|---|---|
| `vite.config.ts`, `scripts/check-bundle-size.mjs`, `scripts/gen-precache.mjs`, `public/sw.js` | A | One package. Later packages never edit them |
| `src/i18n/area.ts`, `src/i18n/index.ts` | A | API stays `defineArea(en, hi)`. `.hi` keeps working (loaded object, else `en`) |
| `src/lib/dates.ts` and every first-paint module | — | **Not edited** (A3 helpers are lazy modules) |
| `industry-packs.ts` (first paint) | B (one `PACK_TABS` row) | ≤ 20 B. C / D add none |
| `travel-rules.ts`, `mfg-rules.ts`, `gst-penalties.ts`, `trading-rules.ts` | C (`// R16-C` rows only) | D adds **no rule rows** (pending list only) |
| `ledger/postings.ts` | D | Netting branch only; exchange receipts without `netting_id` unchanged |
| `src/lib/help/topics-*.ts`, `discover-r6-tabs.ts` | A, B, C, D | One `// R16-x` block each |
| `tests/e2e/smoke.mjs` | A, B, C, D | One appended `step(...)` block each, in merge order |
| `docs/features/i18n.md`, `docs/qa/performance.md` | A | — |
| `docs/CA_REVIEW.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` | lead | §16 PF items; Stack and storage notes for A1 / A2; the pending-changes note |

**Storage.** No new table, key, series or record key in Round 16. Device-local:
- the service-worker cache entry `/__lang__` (not app data; outside IndexedDB);
- `mrchartist_inv_lang` (existing).

---

## 7. E2E steps (production build, `tests/e2e/smoke.mjs`)

1. **R16-A:**
   - `check:size` passes (core, Hindi, regional, leak check, group invariants); 4 initial files; the existing checks pass.
   - English boot → Settings → Language → हिन्दी. Visit Books, GST reports, Inventory, Time → WIP and Trips. No
     visible English label from an area that has Hindi (sample selectors per screen) after the first frame.
   - `verify:offline`:
     - English install: no `lang-hi-*` file in the cache;
     - after switching to Hindi online: the Hindi pack is cached; reload offline → Hindi;
     - a new build installs with the pack (`/__lang__` kept);
     - switching to Hindi offline with no pack → the message, and the UI stays English.
   - A Hindi device's first paint shows the Dashboard gift-voucher tile in Hindi (a first-paint area).
2. **R16-B:**
   - Practice company: a disbursement of ₹2,500 aged 70 days shows in 61–90 → Write off → gone; Reverse → back.
   - Media pre-bill: two insertions billed as agent with a fee.
   - Legal: five appearances → one line 5 × fee.
   - Delete a conflict check.
3. **R16-C:**
   - Booking with ₹1,200 airline commission → Bill commission → invoice to the airline at 18 % with 194H expected.
   - Re-issue a ticket: fare difference ₹800 + penalty ₹1,500 + fee ₹300 → draft.
   - Demo company shows an event budget and a BSP statement.
4. **R16-D:**
   - Client "Mehta Tours" ↔ vendor "Mehta Travels Pvt Ltd" linked by hand → netting ₹65,000 → the vendor ledger shows
     the debit; TB balanced.
   - Trips → Bill → Add line is visible without a reload.
   - Real-estate profile: a bill claiming ITC → caution.
   - The inverted-duty paper shows the pending input-services note.

---

## 8. Open questions — with the default the builders will use

| # | Question | Default chosen | Why |
|---|---|---|---|
| 1 | **May English devices skip precaching Hindi** (Round 15 §8 Q4)? | **Yes.** Hindi needs one online visit after switching. Devices already in Hindi keep their pack across updates (`/__lang__`). Offline switch → message, stays English | −314.6 kB on every English install and update; it is the only lever ≥ 150 kB that does not drag shared code (§2.3) |
| 2 | One Hindi chunk, per-family chunks, or per-area? | **Per family** (105 chunks, 332 kB) | One chunk costs ≈ 150 ms of parse on a phone at every Hindi start (38–44 ms in Node); per area is 365 kB |
| 3 | `lazy-leaves` size cap | **3,000 B** (leaves chunk 17 kB gz) | 6,000 B saves 11 kB more but loads a 52 kB chunk with many screens |
| 4 | What does "total JS" mean after A1? | **Core precache** (all JS minus language packs). Languages get their own budgets | It is what an English device downloads |
| 5 | Un-notified Council recommendations | **Pending list + one-line notes**, never rule rows | Dates and conditions change at notification; readers must not guess |
| 6 | Which unwired engines? | **All of B1–B5 and C1–C5** within the caps; the cut order decides | Each is lazy and tested; QA17 asked for scheduling |
| 7 | Netting posting for a linked vendor | **Vendor's own sub-ledger**, derived on read; no migration | Postings are derived from `transactions` |
| 8 | Help-topic Hindi (≈ 11 kB) | **Not in Round 16** | Positional `t(id, en, hi, …)` needs a second transform |
| 9 | Round 17 budget | §11 "after" values | Leaves ≈ 180 kB English headroom |

---

## 9. CA review items (PF1–PF18) — for `docs/CA_REVIEW.md` §16

★ = changes what a document prints or a return reports once notified.

| Id | Question for the CA | Default in the app |
|---|---|---|
| PF1 ★ | 57th Council ¶8.2–8.3: from which notification / date does Net ITC for an inverted-duty refund include input services (ITC availed ≥ 1 Nov 2026)? Capital goods over 60 months from 1 Apr 2027: per-month apportionment? | Pending note only; formula unchanged (inputs only) |
| PF2 | Rule 89(4)(C) 1.5× cap removal: effective date; does it also cover services? | Pending note; cap still applied |
| PF3 ★ | Late fee waived for ≤ ₹5 crore when the return is filed by the end of the due month: from which period; GSTR-1 too or only Sec 39(1) returns? | Pending note; late fee still computed |
| PF4 | Alternate mechanism from the April 2027 return: does our GSTR-1 / 3B working paper need new tables (Rule 61(1A) / (1B), 86C / 86D statements)? | Pending note on the 3B paper |
| PF5 ★ | Deletion of Sec 2(6)(v) IGST: from when may a supply to our own foreign branch be zero-rated? | Export check still fails condition (v) for "own branch" |
| PF6 | Sec 13(3)(a) omission: which of our job-work / repair exports move to Sec 13(2)? | Pending note |
| PF7 ★ | RCM on plastic / e-waste / tyre scrap and UCO from unregistered suppliers; 2 % GST TDS on B2B supplies: who deducts, from when, return form? | Not modelled; pending note on the RCM goods list |
| PF8 | e-Invoicing for RCM inward supplies from URP and for import of services (≥ ₹5 crore): IRN on a self-invoice — which document type? | Self-invoice without IRN, pending note |
| PF9 | Sec 17(5) relaxations (outdoor catering, health / life insurance, free samples, goods written off on expiry): effective date; transition for bills before it | ITC hints unchanged |
| PF10 | Same-line ITC for restaurants, hotels ≤ ₹7,500 and gyms; 5 % option for EV passenger transport / rental; delivery via ECO at 5 % no ITC | Not modelled |
| PF11 | ARQP scheme (≤ ₹5 crore, B2C only): any invoice or record-keeping change? | Watch |
| PF12 | Ship-to GSTIN / "URP" in e-Invoice and e-Way (on hold since 29 Jul 2026): do we print or report anything new? | `ShipDtls.Gstin` when given; no URP |
| PF13 | GSTR-3B Table 5.1: the system-computed interest is the minimum payable — should our interest paper reconcile to it? | Help line |
| PF14 | FX closing memo on WIP / foreign receivables (B4): memo only at year-end, or a restatement journal (AS 11 / Ind AS 21)? | Memo only |
| PF15 | Commission invoice to an airline / hotel (C1): SAC and 18 %; 194H base (gross commission incl. GST?) | SAC per TV16 row; 194H on the commission before GST |
| PF16 | Ticket re-issue (C2): change penalty and fare difference as pure agent; our re-issue fee at 18 % | As stated |
| PF17 ★ | Netting for a vendor linked by hand (D1): the set-off journal between two differently named ledgers of one party | Vendor's and client's own sub-ledgers |
| PF18 | Real-estate no-ITC caution (D3): which inward supplies stay eligible (e.g. capital goods for a commercial let)? | Caution on every ITC claim; override with a reason |

---

## 10. Test plan (summary)

| Layer | What | Where |
|---|---|---|
| Unit | Hi-split transform fixtures; `HI_INLINE` readers; lazy-Hindi runtime (loader registry, version, `setLanguage` awaits); safe-group graph maths (SCC, `$initial`, vendor); helpers; disbursement view model; conflict delete; commission and re-issue engines; netting posting; pending-changes rules | `tests/hi-split`, `i18n-lazy-hi`, `bundle-config`, `day-math`, `html-esc`, `ps-disb-view`, `ps-conflicts-delete`, `tv-commission`, `tv-reissue`, `netting`, `pending-changes` |
| **Bundle** (post-build, `check:size` in CI) | 1. **Hindi leak:** no non-pack chunk holds > 1 kB gz of Devanagari literals unless allow-listed, and the core total is ≤ 36 kB. 2. Language packs exist and are listed in `lang-manifest.json`. 3. `f-*` chunks hold only family modules; `lazy-leaves` imports only first-paint / vendor. 4. Initial files ≤ 5; `html-esc` / `day-math` not initial | `scripts/check-bundle-size.mjs` (+ `build-meta/chunks.json`) |
| Existing suites | Pass unchanged: `i18n*`, `help-*`, `rt-buyback*`, `ag-cycle*`, `ps-*`, `tv-*`, `gst-reports*`, `einvoice*`, `purchase-contract`, `no-cash-readers` | — |
| E2E | §7, incl. the Hindi walk | `tests/e2e/smoke.mjs` |
| Offline | Language-pack install / update / offline switch | `scripts/verify-offline.mjs` |

---

## 11. Size budget per package (gz)

**English** = core precache (all JS minus language packs). **Hindi** = the `lang-hi-*` chunks plus `hi.ts`.

| Package | First paint | English (core) | Hindi pack | Stop rule |
|---|---|---|---|---|
| Baseline `0521a90` | 182.6 | 3,429.3 (Hindi inside) | — | — |
| R16-A | **≤ 182.6** (measured 181.4) | **≤ 3,120** (measured 3,114.7; 3,085.3 with `hi.ts` / `regional` as packs) | ≤ 345 (measured 332.3 family + 8.8 `hi.ts`) | A1 < 200 kB saved → report; A2 < 25 kB → report; A3 > 0 → cut 1 |
| R16-B | ≤ +0.05 | ≤ +8 | ≤ +3 | At cap: cuts 1, 2, 3 |
| R16-C | 0 | ≤ +8 | ≤ +3 | At cap: cuts 1, 2, 3, 4 |
| R16-D | 0 | ≤ +5 | ≤ +2 | At cap: cuts 1, 2 |
| **After Round 16** | **≤ 182.7** | **≤ 3,111** (with packs) | ≤ 353 | — |

**New budgets for Round 17** (`check-bundle-size.mjs`, set by A4, re-checked by the lead after D):
- initial **185** (unchanged, hard);
- entry 100;
- core precache **3,300**, which leaves ≈ 190 kB for Round 17;
- Hindi pack **400**;
- regional **25**;
- initial files ≤ 5;
- the Hindi-leak cap 36.

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hindi user sees English for a frame on a newly opened screen (area evaluated after boot) | M | L | Pending loaders + version re-render; family chunks are served from the SW cache. E2E asserts no English after the first frame on five screens. Fallback (measured option): top-level `await` in split areas, tried only if the e2e fails |
| A bilingual reader of `T.hi` breaks (prints English where Hindi was expected) | L | M | `HI_INLINE` + the grep test; `.hi` falls back to the loaded object, else `en`, never `undefined` |
| Hindi pack not cached when the device goes offline right after switching | M | M | Message and stay in English; the pack is fetched on the next online boot; `/__lang__` survives updates |
| Service-worker change breaks the core install | L | **H** | Language packs are fetched after the core and never reject the install; `verify-offline` covers install, update and broken-deploy cases |
| Safe-group maths wrong on cycles → a shared module dragged into a family chunk | L | M | SCC computation; post-build invariant (every `f-*` module matches its family); measured family chunks hold only family modules |
| Rolldown RC changes `name()` / `test()` timing | L | M | Pinned versions; `bundle-config` test; the A stop rules re-measure on the A commits |
| Netting posting change alters R9 / R12 exchange postings | L | H | Branch only on `netting_id`; existing buy-back / cycle suites unchanged |
| A pending 57th-Council item is notified with different terms | H | L | Notes only; the real row is appended at notification with its number (D4.3) |
| Wiring engines overruns (R13–R15 ran 1.3–2.5 × plan) | M | L | Caps count English only after A1 (Hindi no longer inflates them); cut lists per package |
