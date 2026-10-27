# Round 13 — manufacturing MSMEs (feature notes and the API for MF-B / MF-C / MF-D)

PRD: `docs/prd/round-13.md` (it names this file `manufacturing-r13.md`; the round's doc is `mfg-r13.md`). CA items:
`docs/CA_REVIEW.md` §13 (MF1–MF32 from the PRD; MF33–MF36 added by MF-A; MF-B uses MF40+, MF-C MF50+, MF-D MF60+). Every
GST / MSME / valuation figure here is a working paper — verify with your CA. One section per package; each package edits
only its own section and records its own bundle numbers.

## MF-A — Manufacturing profile and the shop-floor core

### What shipped

| Item | Where |
|---|---|
| A1 profile | Settings `mfg_kind` (`engineering`, `textile`, `plastics`, `printing`, `food`, `other`) and `mfg_sub` (engineering `drawing` / `catalogue`; textile `garments` / `yarn` / `fabric` / `processing`; plastics `moulding` / `extrusion` / `film` / `corrugation`) — additive, `types/mfg-r13.ts`. **No new business type**: `shop-presets.ts` `MFG_KINDS` / `MFG_SUBS` / `MFG_PROFILES` / `applyMfgKind(kind, { registered, sub, currentPacks })` writes `manufacturer` (`other` keeps type and modules), modules (`registered` adds `gst`; `inventory` and `payroll` always kept, so `/manufacturing` stays visible and `PACK_ROUTES` is unchanged) and packs **in union with the packs the company has** (an agri mill that packs namkeen keeps its agri desks). Six packs `shopfloor`, `fabrication`, `garments`, `plastics`, `press`, `foodmfg` (`industry-packs.ts`; `PACK_OF_TYPE` unchanged). Switches in the company object `mfg_settings` (`mfg/mf-settings.ts`: owner only, audited on save, backed up, synced as a singleton; object-valued keys of B–D kept as stored) via `mfg/mf-profile.ts` (`mfSwitchesOf`, `mfgSwitchesFor`, `applyMfgSwitches` — fills only unset switches). Wizard: one more card "Factory / manufacturing" → `MfgKindPicker` (+ sub-choice, Udyam number and category written on the active sender profile); Settings → Features "Manufacturing profile" for every company (+ "Custom"); Features row `adv.mfgProfile`, `PACK_HREF` rows. Checklist steps (`checklist-steps.ts`, append-only, only with `mfg_kind`): `workCentres`, `udyam` (every kind), engineering `firstDrawing`, textile `firstStyle` / `fabricators`, plastics `firstMould`, printing `pressMaster`, food `fssai` / `shelfLife` (B–D tables / `mfg_settings` keys count once their package writes them). |
| Desks | `MFG_PACK_TABS` (`page-tabs.ts`): `floor` (pack `shopfloor`), `shop` (`fabrication`), `moulding` (`plastics`), `press` (`press`), `garments` (`garments`), `food` (`foodmfg`), `statutory` (`shopfloor`); `Manufacturing.tsx` lists them after `MFG_TABS` when their pack is on (the URL still opens a desk whose pack is off) and mounts one lazy desk each (`components/mfg/*Desk.tsx`). Shop / Moulding / Press / Garments / Food / Statutory and Floor → WIP are **stubs** (`R13Stub.tsx`, `WipView.tsx`) that B / C / D replace in place — `Manufacturing.tsx` is not edited again. Every desk and view of the PRD (34 `PACK_TABS` rows) has a help topic (`topics-packs.ts`), a palette label (`r13.*` in `palette-destinations.ts`) and a Ctrl+K title (`mfg.*` in `discover-r6-tabs.ts`); synonyms for job cards / work centres / routings / load. |
| A2 centres, routings | `mfg/mf-centres.ts` (table `work_centres`, `master.edit`): kind machine / line / manual / outside (vendor = job worker), rates machine + labour + power + overhead (`machineHourRate` = the sum, shown as a breakdown), shifts, working weekdays, efficiency, parallel units, holidays, typed `normal_hours` (D5); `availableHours(centre, day)`. `mfg/mf-routings.ts` (table `routings`, `master.edit`): operations (seq, centre, set-up, run min / unit or units / hour, batch size, move, inspection, piece rate), one default per item, validation, CSV export / CSV or XLSX import (one row per operation), `standardConversion`. `mfg/mf-ops.ts` (small, imported by `production/orders.ts`): `plannedHours` = (set-up + run) ÷ efficiency, `opsForQty`, `opsForRelease` — **release copies the default routing onto the order** (`ProductionOrder.mf.ops`, snapshot with planned hours and the centre's rate) only while the `shopfloor` pack is on; `makeDaysOf`. Floor → Work centres / Routings. An `outside` operation's "Send to job worker" opens Material Out pre-filled (`mfout=vendor~item~qty~process`). |
| A3 job cards | `mfg/mf-jobcards.ts` (table `job_cards`, `JCD/FY…`, `doc.create`, dated by the first entry): **one row per order per operation** with `entries` (date, start / stop or hours, set-up flag, operator employee / karigar, machine, good, rejected + reason, rework, scrap kg + scrap item). Flow rule (`goodLimit`: previous operation's good + this card's rework; the routing's "allow out of sequence" lifts it), overlap warnings per machine, period lock, totals derived. `outputExtras` → R4-A's output dialog (lazy, only for an order with `mf.ops`): the last operation's good units and the scrap lines still due — `buildOutputVoucher(…, newId, { scrapLines, conversion })` appends them (`mf_jc: true`, fixed value = the scrap item's sale rate, else opening rate); lines already posted are subtracted on read, so scrap reaches stock once (MF34). Rejected / rework are reported; the QC desk stays R4-A's. `unitsByEmployee` → Payroll → Attendance "Import production units from job cards" (lazy row with the pack; good units only, MF35). `mfg/mf-floor-report.ts` day report per centre (available, run, set-up, idle, good, rejected, scrap kg) and per operator. Floor → Job cards with the operator screen (phone mode: centre → open operations → Start / Stop → report; order no. typed or scanned by a scanner that types). |
| A4 MRP, load | `mfg/mf-mrp-dated.ts` (`runDatedMrp`: day / week buckets, low-level-code order, projected on hand, planned receipts offset by `lead_days` / `make_days` (else `makeDaysOf`), past-due and late flags; equals `runMrp` over one bucket) and `datedSources` (open sales-order lines by due date, released orders' materials still to issue, open orders' output by due date, open PO lines by expected date through `purchaseOrderOutstanding`; base units via `lineFactor`). MRP tab: a lazy "By date" toggle (with the pack) shows `DatedPlanView`. Item form: lazy "Lead time / make days" row (`LeadTimeRow`, with the pack). `mfg/mf-capacity.ts`: infinite backward loading of open orders' remaining hours from their due dates, buckets by day / week vs available hours (over 100% red), promise date by forward loading into free hours, a centre with no hours refused. Floor → Load (move an order's due date through `productionOrdersDb.save`, audited; nothing rescheduled automatically). |
| A5 paper | Record key **`mf`** (`R13_RECORD_KEYS = ['mf']`, spread into `R9_RECORD_KEYS` — the round's only first-paint token). `mfg/mf-snapshot.ts` `mfSnapshot(kind, parts)` (drops empty parts). `paper-helpers.ts`: `mfLineText` inside `trackingText(item, ag, mf)` (both item tables), `mfSellerText` under the seller's GSTIN (classic / corporate / minimal / ink / letterhead header, GST grid, receipt) — "Udyam: … (Micro)" from the **sender snapshot** once it carries `msme_category` (so older documents print nothing new; `udyam_print: false` hides it) and "FSSAI Lic. No. …" from `fssai_no`; `mfDeclaration` (snapshot text, scrap TCS, AA, recycled content, and the MSMED Sec 15 / 16 clause for micro / small sellers to GSTIN buyers, MF33). `TemplateEngine.tsx`: lazy `MfgBlock` (after the parties / before the GST grid, never on receipt paper; boxes from `mf-print.ts` `mfBoxes`) and lazy `MfgAnnexurePage` (size × colour grid, inspection summary, scrap weighment). Settings → Defaults → Payment terms: lazy `MfProfileRow` (category, "Print Udyam number", FSSAI number, validated 14 digits). |
| Registrations | `mfg/mf-registry.ts` (`MF_TABLE_ACTIONS`, `MF_WATCHED`, runtime), `mfg/mf-shared.ts` (`MF_TABLES`, `MF_OBJECTS`, `MF_SERIES` `JCD`, `MF_RESERVED_SERIES` `FAI` / `PES` / `CUT` / `KPB`, `MF_PACKS`, `MF_DATED`, `MF_NUMBERED`), `mfg-rules.ts` (`WORK_DEFAULTS`, `PAPER_RULES`; sections for B–D). Backup `RECORD_TABLES` / `ID_TABLES`, sync `DATED` / `NUMBERED` (`job_cards`), open-export rows, recycle-bin restore hooks (a job card only while its order lives and no new card was opened for the operation; a default routing only while the item has no other default). |
| Demo | `demo/profile-mfg.ts` (dispatched from `demo/profiles.ts` for a Demo company with `shopfloor`): four work centres, the bracket routing, a released order with two job cards (3.4 kg off-cuts). `work_centres`, `routings`, `job_cards` in `DEMO_EXTRA_TABLES`. |

### API for MF-B / MF-C / MF-D

- **Types** (`src/types/mfg-r13.ts`): MF-A declared, for everyone, the `mf` sub-objects `drawing` (`MfDrawingSnap.inspection`),
  `print` (`MfPrintSnap`), `scrap` (`MfScrapSnap`: rows, `tcs`), `cmt` (`MfCmtSnap`: sizes, grid), `food` (`MfFoodSnap`),
  `export_aa` (`MfExportAaSnap`) and per-line `mf.lines[lineId]` (`MfLineSnap`: drawing / rev / po_line / heat / grade,
  batch / packed_on / best_before / use_by / mrp, style / lot / sizes, epr_cat / recycled_pct); `ProductionOrder.mf`
  (`ops`, `grid`, `food`); `StockItem` `lead_days`, `make_days`, `mf_scrap_class`, `mf_class`, `mf_epr`, `shelf_life_days`,
  `mf_inv_class`, `mf.style`; `Vendor.mf` (`karigar`, `msme_trader`); `Client.mf` (`epr_no`, `min_shelf_pct`);
  `PurchaseRecord.mf`; `JobWorkLine.mf`; `SenderProfile.msme_category` / `udyam_print` / `fssai_no`. Re-declare an
  interface in your block to add fields (interfaces merge). **Do not add record or line keys.**
- **Names** (`mfg/mf-shared.ts`): add your tables to `MF_TABLES` / `MF_DATED` / `MF_NUMBERED`; move your prefix from
  `MF_RESERVED_SERIES` into `MF_SERIES` (write it once — `tests/mf-registry.test.ts` counts `'XXX'` literals).
- **Registry** (`mfg/mf-registry.ts`): add rows in your block; every writer `import './mf-registry'`. `sync-engine.ts`
  and `trust/recycle-bin.ts` already import it. Add backup / sync / open-export rows in `// R13-B` … blocks, and your tables
  to `DEMO_EXTRA_TABLES` when you add sample rows.
- **Rules** (`mfg-rules.ts`): your section; dated rows with `source` and `verified`, append-only; import only from
  `lib/mfg/*` (`tests/mf-rules.test.ts`).
- **Desks**: replace your stub file (`ShopDesk.tsx`, `MouldingDesk.tsx`, `PressDesk.tsx`, `GarmentsDesk.tsx`,
  `FoodDesk.tsx`, `StatutoryDesk.tsx`; D also `WipView.tsx`) with the same default export and props
  (`MfDeskProps` in `components/mfg/desk-props.ts`: `{ view?: string; ctx: MfgContext }` — `ctx.changed(msg)` /
  `ctx.error(msg)` report back). Strings: your own area per desk (`i18n/areas/mfg-r13b*.ts` …); no shared desk kit (the
  floor's `floor-ui.tsx` / `floor-util.ts` are the Floor desk's own). Help topics, palette labels and Ctrl+K titles for
  your desk and views exist (`manufacturing:<desk>:<view>`, `r13.<desk>.<view>`, `mfg.<desk>`); correct their wording.
- **Settings**: `readMfgSettings` / `saveMfgSettings` (`mfg/mf-settings.ts`); keep your sub-objects as object-valued keys
  (`moulds`, `presses`, `absorb`, `eway` …) — `cleanMfgSettings` keeps them; the checklist reads `moulds` / `presses` arrays.
- **Snapshot / paper**: write documents through `mfSnapshot(kind, { header | drawing | print | scrap | cmt | food |
  export_aa, lines, declaration, recycled_pct })`. `MfgBlock` boxes come from `mf-print.ts` `mfBoxes` (add your arm there);
  `MfgAnnexurePage` already prints the size grid, inspection summary and scrap weighment; `mfLineText` and
  `mfDeclaration` print every line / declaration field above.
- **Job cards (C, D)**: `loadCards`, `cardTotals`, `unitsByEmployee`; entries with a `karigar` operator carry the vendor id
  (C4 piece bills); routing operations carry `piece_rate`. D5 conversion: pass `{ conversion: AdditionalCost[] }` as the
  last argument of `buildOutputVoucher` (without it the journal is byte-identical); job-card hours × `MfOrderOp.rate` give
  the conversion; `WorkCentre.normal_hours` is typed for the AS 2 cap.
- **Scrap (B3)**: job-card scrap enters stock through the output journal (`mf_jc` lines); a scrap sale reads stock as usual.
- **Cash**: no new no-cash marker (PRD §4).

### Deviations from the PRD (MF-A)

- **Doc name**: this file is `docs/features/mfg-r13.md` (as asked by the lead), not `manufacturing-r13.md`.
- **Udyam line**: printed by an inline helper (`mfSellerText`, the R10 `svRegText` pattern) at the GSTIN line of each
  layout, not a lazy `UdyamLine.tsx` part — a text line is cheaper than a lazy chunk. It needs `msme_category` on the
  snapshot (MF33) so that documents saved before Round 13 print nothing new. The centered layout's short header shows no
  registration lines (as for `sv_regs`).
- **One chunk for the Floor desk**: the desk and its four views load as one lazy chunk (AG-B's finding: a chunk per view
  costs more); the dated plan is its own lazy chunk on the MRP tab.
- **Rejects to QC**: rejected and rework quantities are reported on the card; posting a reject to the QC hold is still
  R4-A's QC desk (no automatic journal from the card).
- **Order QR scan**: the operator screen takes the order number from a scanner that types; no camera scanner on it.
- **Plans saved with `dated: true`**: the type is declared; the dated view runs on the open plan and is not stored.
- **Demo**: no Udyam number / MSE receivable sample (it would change the Demo company's sender profile); the floor block only.
- **Wizard Udyam**: written on the active sender profile with its category; FSSAI is typed in Settings → Defaults.

### Bundle (MF-A)

Measured with `vite build` + gzip -9 (the budget script's method); before = `claude/elegant-cannon-cwapiv` at `166d7d7`,
after = this branch merged with it.

| Budget | Before | After | Delta | Share |
|---|---|---|---|---|
| Initial JS (first paint) | 189,182 B (184.75 kB) | 189,186 B (184.75 kB) | **+4 B** | ≤ +0.03 kB ✓ |
| Total JS | 3,228,040 B (3152.4 kB) | 3,270,891 B (3194.2 kB) | **+42,851 B (+41.8 kB)** | ≤ 18 kB ✗ |

**Overrun: +23.8 kB over MF-A's 18 kB share** (total stays well under 3400 kB). Breakdown (gz): Floor desk and views
14.5 kB (FloorDesk chunk 8.2 kB: centres, routings, job cards + operator screen, load; its shared chunk 6.4 kB: the
`mfg-r13a` strings in English + Hindi, `floor-ui`, `mf-routings` + CSV, `mf-centres`), job-card engine 2.5 kB (shared by
the desk, the output dialog and payroll), dated plan 2.4 kB + the `mrp.ts` split into a shared chunk 0.8 kB net;
help topics for all 34 R13 desk / view rows 2.8 kB, palette labels 1.1 kB, Ctrl+K titles / synonyms 1.1 kB, reach strings
(packs, checklist) 1.1 kB, glossary 0.7 kB; picker + wizard / features wiring 2.4 kB; profile row 1.5 kB; paper parts
(block, annexure, helpers, TemplateEngine wiring) 2.3 kB; settings / profile / registry / shared / rules 1.8 kB; demo
1.1 kB; lazy rows (payroll units, lead time) 1.4 kB; stubs 1.7 kB; production chunk (release hook `mf-ops`) 0.6 kB;
the rest (checklist, presets, packs, Manufacturing mounts, sync / bin / export rows) ≈ 2.5 kB. Trimming options for the
lead: drop the operator screen and the day report (≈ −2 kB), the dated plan view (≈ −3 kB with the `mrp` split), the
routing CSV import / export (≈ −0.8 kB), or shorten the B–D help topics until their packages land (≈ −1.5 kB).

## MF-B — Engineering, plastics and printing (packs `fabrication`, `plastics`, `press`)

(MF-B fills this section.)

## MF-C — Textiles and garments (pack `garments`)

(MF-C fills this section.)

## MF-D — Food / FMCG and the statutory desk (packs `foodmfg`, `shopfloor`)

(MF-D fills this section.)
