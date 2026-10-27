# Round 11 — construction (feature notes and the API for CN-B / CN-C / CN-D)

PRD: `docs/prd/round-11.md`. CA items: `docs/CA_REVIEW.md` §11 (CN1–CN28). Every GST / TDS / cess figure here is a
working paper — verify with your CA. One section per package; each package records its own bundle numbers.

## CN-A — Construction profile and the bill paper

### What shipped

| Item | Where |
|---|---|
| A1 profile | `construction_kind` (settings, additive) under business type `contractor`: civil, subcontractor, builder, interiors, mep, labour, other. `shop-presets.ts` `CONSTRUCTION_KINDS` / `CONSTRUCTION_PROFILES` / `applyConstructionKind(kind, { registered })`; switches in `construction/cn-profile.ts` (`constructionSwitchesFor`, `applyConstructionSwitches(kind, { government })`) written to the company object `construction_settings` (`cn-settings.ts`, owner only, audited, backed up, synced as a singleton). Picker `components/construction/ConstructionKindPicker.tsx` in the setup wizard and Settings → Features (+ "Custom"; the government question for civil / sub-contractor / MEP). Pack `realty` (`industry-packs.ts`), Features rows `pack.realty` and `adv.construction`. Checklist steps `constructionProfile`, `contract`, `boq`, `realtyProject`, `units`, `paymentPlan`, `labourContract`. `PACK_OF_TYPE` / `PACK_ROUTES` unchanged — existing contractor companies see what they saw. |
| A2 tax classes, PoS = site | `construction/cn-tax.ts` (`classRate`, `rateDiffers`, `suggestedRate`, `worksPlaceOfSupply`, `otherStateNotice`, `mixedSupplyInstall`, `reclassAsWorks`); `construction-rules.ts` `WORKS_CLASS_RULES` (CN1 default: government / earthwork / sub-contract 18% from 2025-09-22, `verified: false`). `saveRaBill` sets the bill's place of supply to the site State (contract → BOQ `boq_terms.header.site` / `boq_terms.site`) and re-derives IGST / CGST + SGST. Declarations (`cn-print.ts` `worksDeclarations`) print on works documents. |
| A3 contract particulars | Snapshot `boq_terms.cn.header` (`cnHeaderSnapshot`) written by `saveRaBill` through one call (`cn-snapshot-io.ts` `raSnapshotFor`); line snapshot `boq_terms.cn.lines[lineId]` (`ref`, `mb`, `cls`, `kind`, `approval`, `substitutes`, BOQ / previous / cumulative qty and amount). Paper: `WorksHeaderBlock` (contract box), `worksLineText` sub-line under every line in both item tables, RA title "Tax Invoice — Running Account Bill No. n" / "— Final Bill" (`raDocTitle`), "Site" instead of "Ship to". Editor: lazy `creator/ContractPanel.tsx` (DocumentMetaCard; works pack on, or a document with the snapshot / an RA number). Measurement form: period from / to, date of measurement, MB per line (already) reaching the bill. |
| A4 abstract | `cn-abstract.ts` (`buildAbstract`, `deviationSplit`, `splitDeviation`, `deviationWarnings`, `itemKind`), `cn-sections.ts`. Snapshotted at save in `boq_terms.cn.abstract`; printed as the following page `WorksAbstractPage` (sections A BOQ / B extra / C substituted / D deviation with sub-totals, then gross, GST, deductions, net payable). Quantity beyond BOQ × (1 + deviation %) (default 25%, `DEVIATION_DEFAULTS`; contract → BOQ `deviation_pct` → settings) becomes a `-d` "Deviation — …" line; the measurement form warns. Line classes `extra` / `substituted` (approval, replaced item no.) on the measurement form. "Recompute abstract" on the RA register re-snapshots DRAFT bills only (`recomputeDraftSnapshot`). `pwd` paper: `RaItemsTable` replaces the item table on non-gst layouts. The standalone RA register abstract gained the MB column. |
| A5 deductions | `WorksDeductionsBlock`: `ra_deductions` grouped Statutory / Recoveries / Held / Other (`cn-print.ts` `DEDUCTION_GROUP` covers the six CN-B kinds), bill amount, total deductions, **Net payable** (from `ra_net_payable`) in figures and words (Hindi on bilingual paper), notes (GST on the full value; GST TDS u/s 51; labour cess), declarations, contractor's certificate (`DEFAULT_CERTIFICATE`, settings text) and, with `signoff_boxes`, "Measured by / Checked by / Passed for payment". `FooterBlocks` skips "Less: TDS" / its balance line for documents with `ra_deductions` (IT TDS printed once). |

All paper parts are one lazy chunk (`parts/WorksPaper.tsx`), mounted by `TemplateEngine` only when the document has
`boq_terms.cn` or `ra_no`, never on receipt paper; the PDF, share link and print copies render `TemplateEngine`, so they
carry the same paper and page 2. Paper strings: `i18n/areas/construction-r11-paper.ts`; UI strings:
`construction-r11a.ts`; picker: `construction-r11-pick.ts`.

### API for CN-B / CN-C / CN-D

- **Types** (`src/types/construction-r11.ts`, one block per package): `CnSnapshot` (`boq_terms.cn`) with `header`,
  `lines`, `abstract`, `paper`, `certificate`, `deviation_pct` (A) and `pv` (B, `CnPvSnapshot`), `jv` (B), `demand`
  (C, `CnDemandSnapshot`) — fill your sub-object's fields in your block. `ConstructionSettings` (switches; `views` per
  `CnWorksView`). `BoqTerms.site` / `header` / `deviation_pct`. `RaDeductionKind` gained `secured_advance`,
  `material_recovery`, `water_power`, `hire_charges`, `advance_interest`, `withheld` (labels in `DEDUCTION_LABELS`,
  print groups in `DEDUCTION_GROUP`; their maths and `DEDUCTION_KINDS` rows are CN-B's).
- **Contract → bill header (B1):** rows of table `works_contracts` with `boq_id` (or `boq_ids`) and the `ContractLike`
  fields (`name_of_work`, `agreement_no` / `_date`, `work_order_no` / `_date`, `tender_ref`, `client_office`,
  `engineer`, `site { address, state_code }`, `contract_value`, `stipulated_start` / `_completion`,
  `extended_completion`, `deviation_pct`, `jv_note`) are read by `contractOfBoq` and win over the BOQ's typed header in
  `cnHeaderSnapshot`; the site's State becomes the bill's place of supply.
- **Registry:** `construction/cn-registry.ts` — add your tables to `CN_TABLE_ACTIONS` / `CN_WATCHED` in your block and
  `import './cn-registry'` in every writer. **The first package that adds a table also adds
  `import './construction/cn-registry';` to `sync-engine.ts` and `import '../construction/cn-registry';` to
  `trust/recycle-bin.ts`** (CN-A has no table; adding them in A cost +54 B on first paint through the entry's preload
  map — see Budget) and extends `tests/cn-registry.test.ts`.
- **Rules:** `construction-rules.ts` sections `// CN-B` … `// CN-D` (rows `CnRule<T>` = `Versioned<T> & { verified }`).
- **Paper:** export `PvWorkingPage` (B) / `DemandBlock` (C) from `parts/WorksPaper.tsx` (placeholders return null);
  `TemplateEngine` already mounts them when `boq_terms.cn.pv` / `.demand` is set. Keep paper parts free of imports that
  the preview chunk also uses (pass helpers as props, as `RaItemsTable` / `WorksDeductionsBlock` do) or a new shared
  chunk appears.
- **Works views:** append your view ids to `VIEWS` in `WorksTab.tsx` with a lazy mount; list a view when
  `worksViewOn(readConstructionSettings(), view)` (or it is the current view). The profile already switches the views
  on (`CONSTRUCTION_SWITCHES`). Add its `PACK_TABS` row, help topic (`topics-packs.ts`) and palette label
  (`r11T` in `palette-destinations.ts`).
- **Builder desk (C):** replace the lazy target `R11Stub` in `Receivables.tsx` (`RealtyDesk`) with your desk.
- **Series:** `SWO`, `SCB`, `BKG`, `DMD`, `MUS`, `PLG`, `PVB` are unused (pinned free by `tests/cn-registry.test.ts`).

### Deviations from the PRD (CN-A)

- Works views (contracts … pnl) are **not** listed as stubs: the stubs, their help topics and palette rows cost ~1.5 kB
  of a budget already over its share; each package adds its own view with its screen. A profile landing on a view that
  does not exist yet opens the BOQ view. The realty tab exists with a one-line stub (builder landing).
- `sync-engine.ts` / `recycle-bin.ts` registry imports deferred to the first package with a table (first-paint rule).
- `gst-guards.ts` class-rate notice and `bill-guard.ts` realty no-ITC caution are not wired: the class-rate notice
  shows in the editor's Contract & RA panel; the realty caution belongs with CN-C's classes.
- Sample data (`demo/profile-works.ts` dispatcher and blocks) not added; existing works sample rows unchanged.
- Settings switches beyond the picker (paper style, certificate text, deviation %) have no separate Settings form:
  the profile writes them; per document the paper style is chosen in the editor panel.
- `DEDUCTION_KINDS` (BOQ deduction-set editor) is unchanged; CN-B adds rows with their maths.
- `tests/features-catalog.test.ts`: advanced options 21 → 22 (the construction profile row).

### Budget (CN-A)

Measured against `claude/elegant-cannon-cwapiv` at `aa7a504` (same machine, `vite build`, gzip -9):

| | Before | After | Δ |
|---|---|---|---|
| Initial JS (first paint) | 189,038 B | 189,044 B ± hash noise | ≈ +0.006 kB (entry content unchanged) |
| Total JS | 2,855,361 B | ≈ 2,877,500 B | ≈ +21.6 kB |

Breakdown of the total (gz): engines `cn-tax` chunk (cn-tax / snapshot / abstract / rules / UI strings) 7.5 kB,
paper chunk 3.2 kB + paper strings 1.6 kB, editor panel 2.2 kB, `cn-print` / sections 1.5 kB, picker in the shared
picker chunk 1.2 kB, settings 0.9 kB, profile 0.5 kB, help topics + glossary 0.7 kB, checklist / reach / Features /
wizard / palette / Ctrl+K rows ≈ 2.1 kB, the rest in host chunks. **Over the 15 kB CN-A share by ≈ 6.6 kB**; total JS
stays at ≈ 2,811 kB of 2,900 kB. Trimmed already: paper parts in one chunk, paper-only strings, pure section module,
no stub views.
