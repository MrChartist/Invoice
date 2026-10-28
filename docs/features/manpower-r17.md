# Round 17 — security, facility-management and manpower-supply agencies

Spec: `docs/prd/round-17.md`. One section per package; each records its bundle numbers (gzip -9, KiB, the method of
`scripts/check-bundle-size.mjs`) and the `f-manpower` chunk. Working papers — verify with your CA (`docs/CA_REVIEW.md`
§17, MP1–MP32).

## §A — R17-A: manpower core (A1–A4)

### What shipped

| Item | Where |
|---|---|
| A1 profile | `SERVICE_KINDS` / `ServiceKind` gain `manpower`; settings `manpower_kind` (`security`, `facility`, `staffing`, `labour`, `other`). `shop-presets.ts` `MANPOWER_KINDS`, `MANPOWER_LANDING`, `applyManpowerKind(kind, { registered, currentPacks })`: business type `services`, `service_kind: 'manpower'`, modules services + payroll, accounts, banking, tds, recurring, purchases, time (`registered` adds `gst`), packs in union (`manpower`; + `security` for a security agency), due days 7, template `gst_tax_invoice`. Packs `manpower` / `security` (`PACK_OF_TYPE`, `PACK_OF_TYPE_INLINE`, `PACK_ROUTES` unchanged). Object `manpower_settings` (`manpower/mp-settings.ts`: owner only, audited, synced as a singleton, backed up; unknown B–D keys kept; the whole shape of every package is typed in `types/manpower-r17.ts`). Profile defaults `manpowerDefaultsFor` (12-hour shifts for security, else 8; calendar pro-rata; month-end bill date; service charge 0). Wizard: Services → "Security, housekeeping and manpower supply" → `ManpowerKindPicker` with the firm form (written as the annual pack's entity type through R14 `writeFirmForm`, never a second field); Settings → Features "Manpower profile" for every services company (+ Custom); Features row `adv.manpowerProfile`. Checklist (only with `manpower_kind`): `firstSite`, `firstBill` (invoices with `mp.month`). Demo: `demo/profile-manpower.ts` (packs `manpower` / `security`): Sunrise Towers (4 guards 12 h + 1 supervisor) and Green Park RWA (2 guards + 1 housekeeper). |
| Build | `vite.config.ts` row `safeFamilyGroup(graph, 'f-manpower', familyRe('manpower', 'manpower-rules', 'manpower-r17', 'mp-registry'), 12)` (pinned in `tests/bundle-config.test.ts`; `familyRe`'s new optional `except` keeps the registry a lazy leaf, see Bundle); `MP` in the CA-id regexes of `help-registry`, `help-glossary`, `docs-links` (with an `MP1` / `P1` case); `manpower/mp-shared.ts`, `manpower/mp-registry.ts` (imported by `sync-engine.ts`, `trust/recycle-bin.ts`, every writer); `manpower-rules.ts` (sections R17-A / C / D); record key **`mp`** (`R17_RECORD_KEYS`, spread into `R9_RECORD_KEYS`; no line key). |
| A2 sites | A site IS a project cost centre with `CostCentre.mp` (`SiteInfo`: code, address, State, contract from / to / ref / escalation, posts ≤ 30, bill group, status; `cost-centres.ts` keeps `mp`, one line). `manpower/mp-sites.ts` (pure / raw reads): `loadSites`, `siteLabel`, `suggestSac` (`MP_SAC_RULES`, MP5), `suggestSiteCode` (`S-<seq>`), `validateSite`, `cleanSite`, `monthValue`, `endsSoon`. Bridge `mp-sites-io.ts`: `saveSite` (`doc.create`; closed → `done`, paused → `on_hold`), `saveClientMp` (`Client.mp`: `gst_tds_only`, `composition`, `school`; `tds` typed for B4 / D2). `normalizeEmployees` keeps `Employee.mp` (one line) for B–D. |
| A3 regime | `manpower/mp-regime.ts` (pure; `firmForm()` reads the annual pack's entity type): `postRegime` / `mpRegime` (`split` for mixed posts) / `splitPosts` / `forcedRegime` / `mpRegimePatch`. Rules `MP_GST_RATE_RULES`, `SECURITY_RCM_RULES`, `BODY_CORPORATE_RULES`, `EDU_EXEMPT_RULES`, `RCM_ONLY_REG_RULES`. The patch writes the existing `reverse_charge` / `rcm_tax_excluded` and the R10 line key `sv.exempt`; no GST reader changed (test: GSTR-1 B2B `rchrg: 'Y'`, e-Invoice `RegRev: 'Y'`, Table 8 exempt). Editor: lazy `ManpowerRows` (packs on) — site, service month, regime auto / override with a reason (`mp.regime_note`). |
| A4 paper | Lazy `parts/ManpowerBlock.tsx` (+ `manpower-paper.module.css`, template variables only) after `TravelBlock`, before `GstBody`, never on receipt paper: site, service month, post summary (≤ 12 rows), the regime sentence — from `mp` only (`manpower/mp-print.ts`). `paper-helpers.ts` `mpLineText` (after `tvLineText`, in `trackingText`). |
| Desk | `TIME_TABS` row `deploy` (pack `manpower`, also `security`); `Time.tsx` mounts `components/manpower/DeployDesk.tsx` through `import.meta.glob('../components/manpower/*Desk.tsx')`. View `sites`: list (client, posts, heads, value a month at 30 duties, contract end red within 30 days, regime chip) and the site form (`SiteForm.tsx`: posts grid, contract, client flags). Shared UI `mp-ui.tsx` (`Field`, `RegimeChip`, `MpViewProps`). |
| Help / Ctrl+K | Topics `time:deploy`, `time:deploy:sites` (MP ids); Ctrl+K `time.deploy`; palette `r17.deploy`, `r17.deploy.sites`; synonyms; `PACK_TABS` rows (desk + sites). Strings `i18n/areas/manpower-r17a.ts` (shared words for B–D: site, post, duty, muster, shift, reliever, service charge, client, month, compliance; lists as comma strings read by `mpList`) and `manpower-r17a-pick.ts` (the picker, kept out of the family chunk). Every `defineArea` passes a literal Hindi object. |
| Tests / e2e | `mp-profile`, `mp-registry`, `mp-rules` (import graph, family chunk after a build, verified set), `mp-pack-gate`, `mp-sites`, `mp-regime`, `mp-print`; `industry-packs`, `features-catalog` updated. E2E step "R17-A manpower core". |

### API for R17-B / C / D

- **Types** (`types/manpower-r17.ts`, add only inside your `// R17-x` block): `MpSnapshot.muster_id` / `annex` / `tds` (B),
  `comp` (C), `arrear` (D); `MpPostRow.duties` / `amount` / `line_id` / `site` (B fills them; the paper and `mpLineText`
  already print them); `ManpowerSettings.extra_duty_type_id` / `costplus` / `print_tds` (B), `wage_revisions` (C),
  `licences` / `arrears_doc` (D); `PurchaseRecord.mp.site_id` (C); `Employee.mp.guard_licence` (D). No record or line keys.
- **Names / registry**: add `musters: 'site_musters'` (B) / `compliance: 'site_compliance'` (C) to `MP_TABLES` and
  `MP_DATED`, rows in `mp-registry.ts` (your block), `import './mp-registry'` in every writer; backup / sync / open-export
  rows in `// R17-B` / `// R17-C` blocks.
- **Sites**: `loadSites()`, `siteLabel`, `monthValue`, `MP_BASES` (`mp-sites.ts`); `saveSite`, `saveClientMp` (`mp-sites-io.ts`).
- **Regime**: `postRegime(sac, ctx)`, `splitPosts(posts, ctx)` (one invoice per group), `mpRegimePatch(record, result,
  note?)`; ctx = `{ date, entityType: firmForm(), client }` with the client's master row (for `Client.mp`).
- **Deploy (A2 criterion 5, moved to B)**: B creates `mp-payroll-io.ts` (the only importer of the payroll store) with the
  attendance push and "Deploy" (`saveEmployee({ ...e, cost_centre_id, mp: { post_id } })`), and its list in `SiteForm`.
- **Desk**: add one entry per view to `DeployDesk.tsx` `VIEWS` (`lazy(() => import('./XView'))` or static, as R15-C
  measured), its `PACK_TABS` row with an `r17.deploy.<view>` label in `palette-destinations.ts`, a help topic
  `time:deploy:<view>`, Ctrl+K text appended to `time.deploy`. Checklist steps go into `MP_STEPS` (`checklist-steps.ts`).
- **Paper**: add `parts/manpower/*.tsx` parts and mount them inside `ManpowerBlock` (B: duty annexure page).
- **Payroll**: B creates `mp-payroll-io.ts`; C appends `readRunForMonth`.

### Deviations (R17-A)

- **Cut 1 applied** (PRD §3 / §11): no per-employee annexure page in A — B's `parts/manpower/DutyAnnex.tsx` owns it.
- **Fewer files:** the profile defaults live in `mp-settings.ts` (no `mp-profile.ts`); `suggestSac` lives in
  `mp-sites.ts` (no `mp-sac.ts`). Writing sites is the bridge `mp-sites-io.ts` (it reaches `cost-centres.ts`, which is
  not first paint), so bridges are `mp-sites-io` (A) + B's `mp-payroll-io`, `mp-draft-io`, `mp-tds-io` = 4.
- **Deployed list / "Deploy" (A2 criterion 5) moved to B**, with the payroll bridge B owns: importing the payroll store
  from the desk split the shared payroll chunk (+0.4 kB) and put A over its cap. The client's TDS section / deductee
  selects (B4 / D2 data) are left to B / D; the type is declared.
- **Posts grid**: a plain table, not `LinesGrid` (that grid edits stock-item lines).
- **`PACK_TABS`**: only A's desk and `sites` rows (B–D add theirs with their views — no stubs; the R14 / R15 precedent).
  The wizard landing for `staffing` / `labour` is `view=muster`, which falls back to `sites` until B merges.
- **Checklist**: A adds `firstSite` and `firstBill`; `firstMuster` (B), `compliance` (C), `licence` (D) are theirs.
- **Regime override**: audited with the document's own save (the reason is snapshotted in `mp.regime_note`); no
  separate audit row. An override chosen without a reason stores "chosen in the editor".
- **Demo**: Green Park RWA uses a base demo client (which has a GSTIN): its guards therefore show RCM, its housekeeper
  forward charge. The base dataset's clients are not extended (`clients` is not a `DEMO_EXTRA_TABLES` table).
- **E2E**: the profile is picked in Settings → Features (as R15-B), not through a fresh company's wizard.

### Bundle (R17-A)

Before = `claude/elegant-cannon-cwapiv` at `a188df9` (QA19 merged), after = this branch; `vite build` + gzip -9. Normalized
= chunk hashes stripped before gzip (two builds differ by ≈ 1 kB raw from hashed names alone).

| Budget | Before | After | Delta | Cap |
|---|---|---|---|---|
| Initial JS (first paint) | 186,513 B (182.1 kB) | 186,541 B (182.2 kB) | **+28 B** (entry preload map only: order of `lazy-leaves` / `vendor-ui` in a dependency list; no new file, no Round 17 code) | 0 ✗ (display rounds 182.14 → 182.17) |
| Entry chunk | 88.1 kB | 88.2 kB | same +28 B | — |
| Core precache (English) | 3,102.7 kB | 3,114.0 kB | +11.3 raw; **+10.6 kB normalized** | 11 kB ✓ |
| Hindi pack | 340.6 kB | 342.4 kB | +1.8 kB (`lang-hi-manpower` 1.35 kB + wiring areas) | 8 kB ✓ |
| Hindi left in core | 21.3 kB | 21.3 kB | 0 | 0 ✓ |
| `lazy-leaves` | 16.1 kB | 16.6 kB | +0.48 kB (`demo/profile-manpower.ts`, `manpower/mp-registry.ts`) | 0.5 kB ✓ |

Chunks (normalized gz): `f-manpower` 3.5 kB (rules, regime, sites, print, shared, `manpower-r17a` English), DeployDesk
2.8 kB (desk, sites view, site form, `mp-sites-io`, `mp-ui`), ManpowerRows 1.2 kB, ManpowerBlock 0.6 kB, `mp-settings`
0.55 kB (shared by the wizard / Features and the family), wiring 2.0 kB (picker + its area 0.26 in the wizard's picker
chunk, help 0.18, wizard 0.16, presets 0.15, checklist 0.14, Time 0.13, TemplateEngine 0.13, palette / Ctrl+K 0.2,
editor 0.09, Features 0.07, the rest < 0.07 each).

First paint: the registry is excluded from the family (`familyRe(…, 'mp-registry')`) because `sync-engine.ts` and
`trust/recycle-bin.ts` import it statically — inside `f-manpower` it made every sync run load the whole family chunk
and added the chunk's file name to the entry's preload map (+38 B). As a leaf it adds no file; the remaining +28 B is
the dependency order of one map entry. Not reduced further without dropping the registry import from those two lazy
writers (AGENTS.md rule) — the lead may accept it as R15-B's +24 B was.
