# Round 4 · R4-C — Trade desk & trust

Spec: `docs/prd/round-4.md` §4 R4-C1–C7, §5, §6. Everything is local (no ICEGATE / DGFT / bank fetch). GST, customs,
FEMA and incentive outputs are **working papers — verify with your CA**.

## What was built

| Item | Where | Notes |
|---|---|---|
| C1 Exporter profile, LUT register, export fields | Settings → Business → *Export (IEC, AD code, LUT)* (lazy `ExportSettingsPanel`); editor *Export details* (lazy `ExportDetailsFields`, shown with the shipping-bill fields); LUT auto-fill + hint under the editor's LUT fields (lazy `LutHint`); printed `ExportBlock` (lazy in `TemplateEngine`); e-Invoice `CntCode` pre-fill; packing list shows ports / destination / marks of its source invoice | `lib/trade/{exporter,lut-register,lut-alerts}.ts`. Preflight codes `LUT_MISSING` (error) and `LUT_OUTSIDE_FY` (warning) via `buildPreflight({ lut })`. Bell: "No LUT for FY27-28 yet" from 15 March; exports this FY without an LUT. |
| C2 Realisation, e-BRC, incentives | GST reports → Tools → **Export desk** (`?tab=export-desk`, views `register` / `irms` / `incentives` / `imports`) | `lib/trade/{export-register,export-incentives,export-alerts,trade-rules,ledgers}.ts`. Register CSV / XLSX, bank statement per party, unrealised as at 31 March. IRMs typed or CSV-imported (column mapping), split / multi-IRM matching, e-BRC fields; write-offs with a reason. RoDTEP / drawback / IGST-refund claims, credits, scrip use against a BOE and scrip sale, journals through `saveVoucher`. Bell: overdue (Rule 96A note), due within 60 days, shipping bill missing. |
| C3 Bill of Entry duty | Import-of-goods bill → **Bill of Entry duty…** (lazy `BoeDutySheet`); Export desk → *Imports (BOE)* register with *Post duty* and *Pay with RoDTEP scrip* | `lib/trade/{boe-duty,boe-post}.ts`. IGST / cess into the bill's tax fields; BCD / SWS / other duties as `landed_costs` rows ("BCD", "SWS", "Other customs duties") → stock cost through the existing engine; snapshot `PurchaseRecord.boe_duty`. Journal Dr *Customs duty on imports* \| Cr *Customs duty payable* (user ledgers, created on first use). |
| C4 Recycle bin + accessible Undo | Settings → Data → *Recently deleted* (owner) and Settings → Activity → *Recently deleted* (clerks see their own); `UndoDeleted` toast on Clients, Expenses, Books, Inventory; Transactions' delete waits for the toast | Capture in `audit-edits.ts` (`binRows`, every `WATCHED_TABLES` delete) and `localDb.invoices.remove`; `lib/trust/{recycle-bin,trust-alerts,payroll-tables}.ts`. `Toast` with an action never auto-dismisses, `Alt+Z` runs it, `onDismiss` when closed / replaced. |
| C5 Auditor pack | Settings → Activity → **Auditor pack…** | `lib/trust/auditor-pack.ts`; ZIP via `zip.ts` (dynamic import): `audit-log-FY.csv`, `deletions-FY.csv`, `backdated-FY.csv`, `overrides-FY.csv`, `integrity.txt` (+ its SHA-256 shown on screen), `users.csv`, `README.txt`. Year-end step `auditor_pack` (mark). Retention: bell notice past 8 FYs; note under Erase. |
| C6 Export everything | Settings → Data → **Export everything (CSV / Excel)** (`data.backup`) | `lib/trust/{open-export,open-export-schema}.ts`; ZIP with one CSV per table / object key, child CSVs `invoice_items` / `purchase_lines` / `voucher_lines`, `assets/` images, optional `workbook.xlsx` (`xlsx.ts`), `schema.json`, `README.md`, optional `attachments/` + index. |
| C7 Field-level conflicts | Settings → Data → Sync folder (lazy `ConflictMerge` per conflict + bulk actions) | `lib/trust/field-merge.ts`; `Resolution` gains `{ merge: picks }` in `resolveConflict` (re-scan / stale rule, rights, PIN override for a locked period, validation, audit row "merged field by field"). |

Command palette: Export desk, Import register, Recently deleted, Auditor pack, Export everything (loaded on first open).

## Storage (all additive)

| Key / field | Kind | Backed up | Synced | Rights |
|---|---|---|---|---|
| `mrchartist_inv_lut_register` | rows `{fy, gstin, arn, filed_on, valid_from, valid_to}` | yes | yes | `settings.manage` |
| `mrchartist_inv_export_irms` | rows (DATED `date`) | yes | yes | `books.edit` |
| `mrchartist_inv_export_incentives` | rows (DATED `date` = claim date) | yes | yes | `books.edit` |
| `mrchartist_inv_export_writeoffs` | rows (DATED `date`) | yes | yes | `books.edit` |
| `mrchartist_inv_recycle_bin` | rows `{table, row_id, deleted_at, deleted_by?, row, attachments?}` | yes | **no** (`isSyncedKey`) | capture: none (side effect of a guarded delete); restore: the target table's own save path |
| `mrchartist_inv_bin_settings` | object `{days}` (7–90, default 30) | yes | yes | `settings.manage` |
| `SenderProfile.iec / ad_code / ad_bank` | profile fields | with settings | | |
| `InvoiceRecord.incoterm, port_of_loading, port_of_discharge, country_of_origin, country_of_destination, pre_carriage, vessel_flight, marks_numbers, export_payment_terms` | `RECORD_KEYS` (one `// R4-C` line), kept by `normalizeRecord` | | | |
| `PurchaseRecord.boe_duty` | BOE sheet snapshot (+ `voucher_id` once posted) | | | |
| `year_end.marks.auditor_pack` | year-end step mark | | | |

Registries appended (`// R4-C`): `RECORD_TABLES` / `ID_TABLES` (+ exported `BACKUP_RECORD_TABLES`), `WATCHED_TABLES`,
`TABLE_ACTIONS`, sync `DATED`, sync exclusions (`recycle_bin`), `ATTACHMENT_OWNER_TABLES` (`recycle_bin`: files are kept
while their record is binned), GST tab `export-desk`, bell gates `ensureTradeAlerts` / `ensureTrustAlerts`.

Statutory values (date-keyed, append-only) are in **`src/lib/trade/trade-rules.ts`**, a sibling of `tax-rules.ts`
(that file is in the first-paint bundle): `exportRealisationMonths` (9 → 15 from 2025-11-13), `customsSwsPct`
(10% from 2018-02-02), `customsLandingChargePct` (1% → 0 from 2017-09-26), `customsIgstBase` (AV + BCD + SWS + other
duties, cess excluded; rupee rounding), plus the bin retention and the 8-FY audit retention.

## Numbers are never reused

Invoices: `localDb.invoices.remove` records the series high-water mark (`series_counters`), and `nextNumber` counts every
high-water mark as issued, so a deleted (binned or purged) number is never handed out again — GSTR-1 Table 13 shows it as
a gap. Vouchers: `deleteVoucher` records it and `nextVoucherNumber` reads it. The other numbered series already used
`series_counters`. A restore keeps the original id and number and is refused if a live row holds either.

## Tests

`tests/exporter.test.ts`, `tests/export-register.test.ts`, `tests/boe-duty.test.ts`, `tests/recycle-bin.test.ts`,
`tests/auditor-pack.test.ts`, `tests/open-export.test.ts`, `tests/field-merge.test.ts`; two merge round trips appended to
`tests/sync.test.ts`; R4-C block in `tests/purchase-contract.test.ts` (import register, open export); extended
`invoice-store` (normalizeRecord persistence), `attachments` (files kept while binned), `year-end`, `gst-filing`.
E2E (`tests/e2e/smoke.mjs`): Alt+Z runs the Undo; the Undo toast stays past 6.5 s; dismiss commits the delete; the
invoice is in Recently deleted and *Restore with N linked rows* brings it back with the same number, id and receipts; an
export without an LUT shows `LUT_MISSING` in the filing check; an LUT is added in Settings; an IRM is matched from the
suggestions and the register shows the shipping bill as Realised.

## Bundle

Measured with `npm run build && npm run check:size` against `claude/elegant-cannon-cwapiv` after R4-B, QA5-1 and QA5-2:

| | Before | After | Delta |
|---|---|---|---|
| Initial JS (gz) | 182.03 kB | 182.42 kB | **+0.39 kB** (Toast no-auto-dismiss / Alt+Z / onDismiss, bin capture, 4 `WATCHED_TABLES` rows, number reservation; bell gates and palette rows are lazy) |
| Entry chunk (gz) | 68.7 kB | 69.1 kB | +0.4 kB |
| Total JS (gz) | 2233.2 kB | 2301.9 kB | **+68.7 kB** (largest: the English + Hindi area file 10.5 kB, auditor pack 4.5, open export 4.3 + schema map 3.6, export desk 3.7, realisation lib 3.3) |

No new routes, no new dependencies, no new icon names (Globe, Landmark, FileArchive, Trash2, Undo2, History, FileDiff,
ShieldCheck, FileSpreadsheet, plus already-used Download, Upload, Calculator, KeyRound).

## Deviations from the spec

- **Budgets:** first paint +0.39 kB (limit +0.4) — kept by moving the GST tab label, the bill button label and the
  LUT preflight module off the route chunks, the merge helpers into the sync chunk and the export block into its own
  CSS module (each new shared chunk adds a name to the entry's preload map). Total JS **+68.7 kB** (target ≈ +45–50):
  the area file carries Hindi for every string (10.5 kB gz), and the auditor pack, open export, schema map and export
  desk are each 3.5–4.5 kB gz.
- Statutory values live in `trade/trade-rules.ts`, not `tax-rules.ts` (first-paint file).
- **Realised FCY** = the larger of receipts and allocated IRMs, not their sum (an IRM is the bank's record of the same
  remittance a receipt records). Gift-voucher redemptions (R4-B) and bad-debt write-offs are not realisation.
- IEC / AD code print **in the export block** (under the parties) rather than under the GSTIN in each header layout; in
  the ruled GST grid and the receipt layout the block prints after the grid. Export labels are fixed English (the
  Design Studio has no overridable keys for them).
- The IRM CSV column scorer mirrors `import-mapping.ts`'s `scoreHeader` locally (`headerScore`) so the export desk does
  not split the importer's chunk.
- BOE duty rows are spread by the existing landed-cost engine **by value** over the bill's lines, so lines with
  different BCD rates share the duty by value, not by their own rate.
- Vouchers are restored by a guarded table write (roles, period lock, id / number check, audit), not `saveVoucher`,
  because `saveVoucher` would give the voucher a new id and break its receipt links. Receipts restore through the
  table and the invoice re-derives what it received (`localDb.invoices.save`); a write-off receipt also needs
  `doc.deleteIssued` (QA5-1).
- The bin keeps 5 MB / 30 days by **purge on start-up after first paint** (lazy bell gate) and on the size cap; capture
  itself never trims.
- *Merge non-overlapping masters*: without a stored base version, "only mine changed" is approximated as "the other side
  is empty"; a field set differently on both sides is left for the user. Offered only when the version vectors show the
  remote follows a version this device knew.
- No `tests/toast.test.tsx`: `node --test` runs `.ts` only and cannot load JSX; the Toast is covered by the e2e step.
- `UndoDeleted` is mounted on Clients, Expenses, Books and Inventory (one lazy line each) and watches the bin table.
- Small edits outside the owned list: `GstReports.tsx` (lazy LUT findings for the preflight, tab case), `gst.ts` /
  `purchases.ts` / `migration.ts` area keys, `YearEndWizard.tsx` (mark button), `invoice-defaults.ts`
  (`normalizeRecord` keys), `packing-print.ts` / `PackingListDialog.tsx`, `attachments.ts`, `demo-data.ts` (sample rows
  never reach the bin nor reserve numbers), `ledger/vouchers.ts`, the four pages above.

## Open points for the CA (verify with your CA)

1. **Realisation period:** confirm 15 months from the date of export, the RBI notification and its effective date
   (the rule uses 2025-11-13, by shipment date), whether it covers shipments before the amendment, and whether the
   proposed 18 months for INR-settled exports needs a second dated rule. Should SOFTEX / service exports start from the
   invoice date?
2. **Rule 96A:** what exactly must be done on non-realisation of an LUT export (IGST with interest within 15 days of the
   period ending?). The app only warns.
3. **Incentives:** accrual of RoDTEP / drawback income on shipment vs on credit (ICDS VII / AS 9); GST on the sale of
   RoDTEP scrips; accounting of scrips used against BCD (the app credits the receivable at face value and books the
   sale difference to incentive income).
4. **Customs duty:** the current AV rule (no 1% landing charge since 2017-09-26?), the IGST base (AV + BCD + SWS + other
   duties, cess excluded), SWS exemptions per tariff line, and the presentation (duty expensed to *Customs duty on
   imports* while stock valuation carries it — or a "Purchases — customs duty" account under Purchases?).
5. **Recycle bin / DPDP Act 2023:** keeping deleted personal data 30 days; *Delete permanently* stays with the owner.
   Should the bin also capture rows replaced by a restore or a sync "Use theirs"?
6. **Auditor pack:** is CSV + integrity text acceptable evidence for Rule 11(g), or is a signed PDF summary expected?
   Should it include the backup log for Rule 3(5) (the app's backups are user-located)?
7. **Field-level merge:** is "non-overlapping masters" safe without a base version, or should it wait for a 3-way merge
   that keeps base rows in `sync_state`?

## Rows for the lead (ROADMAP / ARCHITECTURE / AGENTS)

- ROADMAP: R4-C1–C7 done; 7.49 (per-FY auditor export with chain head) and 7.131 (IGST refund on goods exports,
  shipping-bill route — tracked as an incentive row) can be marked done.
- ARCHITECTURE storage table: `lut_register`, `export_irms`, `export_incentives`, `export_writeoffs` (rows, backed up,
  synced), `recycle_bin` (rows, backed up, **not synced**), `bin_settings` (object); `trade/trade-rules.ts` as the
  trade-desk sibling of `tax-rules.ts`; the bin capture lives in the audit edit observer (`binRows`).
- AGENTS storage keys: the same keys; "a deleted invoice / voucher number stays reserved via `series_counters`";
  "every list delete reaches the recycle bin — read deleted rows from `recycle_bin`, never resurrect them by hand".
