# Round 5 · R5-B — Transport & works contracts

Spec: `docs/prd/round-5.md` §4 R5-B1…B6, §6. Everything here is a **working paper** — the GST / income-tax position is
as understood; verify with your CA (list at the end).

Both verticals sit behind their industry packs (`src/lib/industry-packs.ts`): `transport` (business type `transport`)
adds **Distribution → Transport**; `works` (business type `contractor`) adds **Time → Works**. With neither pack on, no
new tab, field, bell notice or table read appears (test `transport-works-pack-gate.test.ts`). The tabs' URLs still open
them and Ctrl+K lists them under "Industry packs" (`PACK_TABS` block `// R5-B`, labels resolved in
`palette-destinations.ts`). No new route, no new icon name.

## B1 Consignment notes (LR / bilty) and the GTA option

- `lib/transport/gta-option.ts` — `gta_options` rows `{ fy, option: rcm | fcm_5 | fcm_18, filed_on, arn, note }`; no row
  = reverse charge. `liablePerson(option, recipientKind, date)`: option `rcm` and a notified recipient
  (`GTA_RCM_RECIPIENT_KINDS`) → recipient; otherwise the GTA. A GSTIN reads as "registered person"; an unregistered payer's
  kind can be picked on the LR.
- `lib/transport/consignment-notes.ts` — `consignment_notes`, series `LR/FY…` through `series-counters` (branch prefix
  e.g. `LR-DEL` = its own series); freight = rate × basis (fixed / per kg / per ton of charged weight / per package /
  per trip) + charges (detention and "other" go on their own bill line); payer = consignor (paid) / consignee (to pay) /
  billing party (to be billed). Person liable derived, override needs a reason and is audited (`action: 'override'`).
  Status booked → in transit (on a trip) → delivered (POD: date, received by, shortage, damage, detention) → billed /
  cancelled (reason; the number stays used). "Billed" is derived from a **live** freight bill, so cancelling the bill
  frees the LR. Role `doc.create`, period lock on create / edit / cancel.
- `lib/transport/lr-print.ts` — script-free HTML, three copies (Consignor / Consignee / Driver-office), "Person liable to
  pay GST", the option line, the declaration; printed through `printHtmlDocument`; Web Share / wa.me text.
- "Collect freight" (paid / to-pay): one tax document built by B2's builder + its cash receipt.
- "e-Way Part B": copies vehicle and LR no. / date into the consignor's `einvoice_meta` row when that invoice is in this
  company, otherwise downloads the R3-C5 Part-B update JSON (`vehicleUpdateJson`) for the EWB numbers on the LR.

## B2 Freight bills

- `lib/transport/freight-bill.ts` — pickable = to-be-billed LRs and delivered to-pay LRs not on a live bill; grouped by
  billing party × person liable (a mixed selection becomes two bills). `TAX_INVOICE` (GSTIN) or `INVOICE`, SAC 996791
  (date-keyed default), one line per LR (freight + charges). Recipient liable → `reverse_charge` + `rcm_tax_excluded`
  (5%); GTA liable → forward charge at the option's rate (5% / 18%, 12% before 22 Sep 2025; an unregistered payer under the
  RCM option is billed at 5% forward charge — CA point 3). `lr_ids` on the bill, `bill_id` on the LR; an LR on a live bill
  is refused. Annexure (LR, date, route, packages, charged kg, POD, shortage, damage, amount) as print + CSV.
- GSTR-1, receivables, books and Tally read an ordinary invoice (GSTR-1 B2B `rchrg: 'Y'` for RCM bills).
- `bill-guard.ts`: under `fcm_5` for the bill's FY (transport pack on only), a bill claiming ITC gets the soft warning
  "5% without ITC — check the ITC on this bill" (save again to continue).

## B3 Vehicles, trips, hired lorries

- `lib/transport/vehicles.ts` — `vehicles` (registration cleaned like the e-way bill, own / hired, type, capacity, owner
  supplier, documents with expiry, km/l range). Each own vehicle gets ONE cost centre of kind `vehicle`.
- `lib/transport/trips.ts` — `trips` `TRP/FY…`: vehicle, driver, km, route, LRs (they go in transit). Expenses = quick
  expenses (`purchases` EXPENSE, paid cash) tagged `trip_id` + the vehicle cost centre. Driver advance = PAYMENT voucher
  Dr "Loans & advances to employees" (3615) | Cr cash / bank. Close: one journal Dr cash | Cr 3615 for (spent from the
  advance + cash returned); the rest stays as the driver's advance. Re-open deletes that journal through `deleteVoucher`.
- Hired lorry: "Lorry hire" supplier bill (no GST, 194C individual / others by PAN). With the owner's
  `transporter_194c6` declaration (on the **vendor** record — see deviations), ≤ 10 goods carriages
  (`TDS_194C6_RULES`, `tds-rules.ts`), valid PAN and the declaration dated on or before the bill, TDS is nil with reason
  `T`; `tdsDeductions` keeps the nil row and the 26Q working paper reports it with reason `T` (no "not linked to a
  challan" warning; a 194C(6) note instead). Labels via `ita2025.sectionText` ("Sec 393(1) [Table: Sl. No. 6(i)]
  [old 194C]" from 1 Apr 2026).
- `lib/transport/trip-pnl.ts` — freight (own LR freight, or the charged-weight share of a multi-LR bill's taxable value)
  − expenses − lorry hire = margin; per trip / vehicle / month; mileage flagged outside the vehicle's range. Reads
  `purchases` through `readPurchase` (added to `purchase-contract.test.ts`).
- Bell (`transport-alerts.ts`): GTA option for the next FY in the Annexure V / VI window (1 Jan – 31 Mar, date-keyed) when
  none is recorded; vehicle documents expiring ≤ 15 days / expired; trips open > 10 days.

## B4 BOQ and measured RA bills

- The BOQ is a sales order (or quotation). Lines carry `boq_ref` (item no., edited in Works → BOQ; kept by
  `normalizeItem`); BOQ terms are one additive field `boq_terms` (deduction set, DLP months, release / completion day,
  mobilisation advance, project cost centre, cess mode, work order). BOQ import from CSV / XLSX (item no., description,
  unit, qty, rate, HSN / SAC; `scoreHeader` mapping) creates an issued sales order at the date-keyed works-contract rate
  (`WORKS_CONTRACT_RATE_RULES`).
- `lib/works/measurements.ts` — per line cumulative-to-date (or this-bill) quantity, MB ref; previous cumulative = R2-B2
  billed-so-far (live stages net of credit notes). Over the BOQ only with an excess / variation reason → the excess is an
  "Extra item —" line. Save = R2-B2 builder with the new basis `measured` (`progress-billing.ts`: one branch — the
  quantity is the measured one; HSN / rate / GST stay the BOQ's; over-billing check is R2-B2's). `ra_no` = highest live RA
  bill + 1 (a cancelled bill's number is issued again), `ra_final`, `boq_id`. A final bill that reaches the BOQ exactly is
  R2-B2's balance bill (paisa-exact). RA bills are saved issued (or as a draft on request). `ra_measurements` rows keep
  the lines.
- `lib/works/ra-abstract.ts` — abstract per BOQ line (BOQ qty, rate, up to previous / this bill / cumulative qty and
  amount, % of BOQ) + deductions + net payable, printed as its own HTML page and CSV (see deviations). RA register (RA
  no., gross, cumulative, deductions, net, money received, balance) + CSV.

## B5 RA deductions

- `lib/works/deductions.ts` — retention (% of value before / incl. GST, cap % of contract), advance recovery (% until the
  advance is recovered; optional start after x% of work), IT TDS (194C via the invoice's own `tds_*` fields), GST TDS u/s
  51 (2% on value excl. GST — CGST 1% + SGST 1% or IGST 2% — only for a client flagged `gst_tds_deductor` and a contract
  above ₹2.5 lakh, `GST_TDS_51_RULES`), BOCW labour cess (1%, `LABOUR_CESS_RULES`), security deposit, LD, other. The RA
  bill stores `ra_deductions`, `ra_net_payable`, `retention_release_on`; total / GST / GSTR-1 unchanged.
- `lib/works/ra-due.ts` `raDueSplit` (≈0.4 kB, receivables chunk): due now = net payable less money received; held =
  retention (release day), GST TDS, cess, SD, LD / other, advance recovery not yet adjusted. `receivables.ts`: one guarded
  call for documents with `ra_deductions` — the bill keeps its outstanding, `held` is not aged (counted under "Not due").
- `lib/works/ra-receivable.ts` — payment dialog block (`RaReceiptPanel`, lazy; works pack on): pre-fills cash = due now;
  GST TDS / cess rows = a receipt into the "RA deductions clearing" account (`clearing: true`, as R5-A) + a journal Dr
  "GST TDS receivable" (2373, the name A5 reads) / "Labour cess deducted" (expense 6197 or recoverable 3702, per BOQ) |
  Cr clearing (clearing nets to zero; the IT TDS still books with the receipt that settles the bill); advance recovery =
  `applyAdvance` tagged `ra_kind`; retention / SD release = a later receipt tagged with the kind. The A5 panel is mounted in
  Works → GST TDS credit with `kind="tds"` (accepting a GSTR-7A row moves "GST TDS receivable" to 2360).
- Works → Retention & held lists every live RA bill with due now / held and the actions. Bell (`works-alerts.ts`):
  retention due within 30 days or past and not received.

## B6 Sites

- `lib/works/sites.ts` — "Add site" = godown of kind `site` (non-saleable; `stock.ts` union + `godowns.ts`
  `nonSaleableGodowns`) with `boq_id` / `cost_centre_id`. Material goes by an ordinary stock transfer. "Book consumption" =
  consume-only stock journal (`saveConsumeOnlyJournal`, `SJ/FY…`) from the site godown with `cost_centre_id`. Coefficients
  per BOQ line in `boq_coefficients`. Statement per period: issued, consumed, theoretical (measured this-bill qty ×
  coefficient), variance %, closing at site (alternate units through `lineFactor`); CSV.
- Site cost: `siteCostByCentre` (stock-engine consumption value per cost centre) — Books → Projects shows it as a lazy
  memo row (`SiteMaterialsRow`, only once a stock journal carries a cost centre); the project P&L stays ledger-based.

## Shared-file edits (all additive, §6)

`types/stock.ts` (`'site'`), `types/sales-r2.ts` (`ProgressBasis` gains `'measured'` — a type alias cannot be merged),
`cost-centres.ts` (kinds `vehicle` and `fund` in one union change + `fields.ts` labels `kind.vehicle` / `kind.fund`;
`ProjectsTab` falls back to the master's label for kinds its area does not name), `godowns.ts`, `progress-billing.ts`
(`lineQtys`, one branch), `receivables.ts` (one guarded call + `Bill.held`), `tds-payables.ts` (194C(6) branch, reason
`T`), `tds-returns.ts` (reason-T row note), `tds-rules.ts` (`TDS_194C6_RULES`), `bill-guard.ts`, `PaymentModal.tsx`
(lazy block), `Distribution.tsx` / `Time.tsx` (pack tabs), `industry-packs.ts` (`PACK_TABS` block), `RECORD_KEYS` (one
spread line of `R5B_RECORD_KEYS`, kept by `normalizeRecord`), `normalizeItem` (`boq_ref`), `backup.ts`, `audit-edits.ts`,
`access.ts`, `sync-engine.ts` (DATED + NUMBERED `LR`, `TRP`), `open-export-schema.ts`, `NotificationBell.tsx` (one gate
function, two lazy imports), `palette-destinations.ts` (label resolver), `ProjectsTab.tsx` (memo row).

## Storage (rows for the lead)

| Key / table | Kind | Registries |
|---|---|---|
| `mrchartist_inv_consignment_notes` | rows, DATED `date`, NUMBERED `LR/FY…` | backup, audit, `doc.create`, sync |
| `mrchartist_inv_gta_options` | rows (one per FY) | backup, audit, `settings.manage`, sync |
| `mrchartist_inv_vehicles` | rows | backup, audit, `master.edit`, sync |
| `mrchartist_inv_trips` | rows, DATED `start_date`, NUMBERED `TRP/FY…` | backup, audit, `doc.create`, sync |
| `mrchartist_inv_ra_measurements` | rows, DATED `date` | backup, audit, `doc.create`, sync |
| `mrchartist_inv_boq_coefficients` | rows | backup, audit, `master.edit`, sync |
| `InvoiceRecord.lr_ids / ra_no / ra_final / boq_id / ra_deductions / ra_net_payable / retention_release_on / boq_terms` | additive | `RECORD_KEYS`, `normalizeRecord` |
| `InvoiceItem.boq_ref` | additive | `normalizeItem` |
| `Client.gst_tds_deductor`, `Vendor.transporter_194c6`, `Payment.ra_kind / trip_id`, `PurchaseRecord.trip_id`, `StockJournal.cost_centre_id`, `Godown.boq_id / cost_centre_id`, `Godown.kind 'site'` | additive | declaration merging (`types/transport-works-r5.ts`) |
| Accounts by name: "GST TDS receivable", "Labour cess deducted"; bank account "RA deductions clearing" (`clearing: true`) | created on first use | — |

Lead rows for ROADMAP / ARCHITECTURE / AGENTS: the six tables; the additive fields; cost-centre kinds `vehicle` / `fund`;
`Godown.kind 'site'` is non-saleable; `ProgressBasis 'measured'`; B's statutory rules live in
`src/lib/transport-works-rules.ts` (out of the first-paint `tax-rules.ts`, like `gst-penalties.ts`); "RA deductions
clearing" is a clearing account (pickers must use `pickableBankAccounts`).

## Bundle (vite build, gzip -9; baseline = `claude/elegant-cannon-cwapiv` at 569d492, built the same way)

| | before | after | delta |
|---|---|---|---|
| Initial JS (first paint) | 187,014 B (182.6 kB) | 187,207 B (182.8 kB) | **+193 B (0.19 kB)** — budget +0.2 kB |
| Total JS | 2,404,240 B | 2,458,739 B | **+54.5 kB** (53.2 KiB) — package budget 34 kB: over by ≈20 kB; **accepted by the lead** (global cap 2600 kB holds) |

Where it goes (gz): TransportTab chunk 12.8 kB (LR, freight bill, vehicles, trips, GTA UI + `consignment-notes`,
`freight-bill`, `lr-print`, `trip-pnl`), WorksTab 11.9 kB (BOQ, deductions, RA, retention, sites UI + `boq`,
`measurements`, `deductions`, `ra-abstract`, `ra-receivable`), i18n area (en + hi) 7.1 kB, shared transport lib chunk
`trips` 6.3 kB, works shared 1.6 kB, `sites` 1.3 kB, the two bell chunks 1.8 kB, `RaReceiptPanel` 0.8 kB, rules 0.7 kB,
`SiteMaterialsRow` 0.5 kB, `ra-due` 0.4 kB; existing chunks +3.6 kB (Time / Distribution tabs, Expenses (bill-guard
caution), PaymentModal, receivables, tds-payables, bell, shared). Mounting R5-A's `TcsCreditPanel` from a second lazy
importer re-chunked the marketplace code (`settlement-post` and `TcsCreditPanel` became their own chunks): net +1.95 kB.
First paint: `RECORD_KEYS` / `normalizeRecord` (one shared key list), `normalizeItem` `boq_ref`, the bell gate, and the
`access` / `audit-edits` registry rows. Trimming already done: shorter strings, shared field / button helpers, IT TDS rate
from the first-paint `tdsSections` (avoids splitting `tds-rules`).

## Verify with your CA

1. GTA rates and options: RCM 5%; forward charge 5% without ITC; 18% with ITC from 22 Sep 2025 (12% before) — the
   notification and dates (`GTA_RATE_RULES`). SAC 996791 as the default.
2. Annexure V / VI window (1 Jan – 31 Mar of the preceding FY) and whether the option continues by default; the notified
   RCM recipient list (`GTA_RCM_RECIPIENT_KINDS`), including composition-registered recipients.
3. An unregistered payer under the RCM option: billed here at 5% forward charge by the GTA — or exempt? Confirm.
4. Rule 46 / consignment-note contents (serial no., consignor, consignee, vehicle, goods, origin, destination, person
   liable, GSTINs) on the printed LR.
5. 194C(6): ≤ 10 goods carriages at any time in the year, PAN and declaration; the effective date in `TDS_194C6_RULES`
   (1 Jun 2015 used — the PRD said 1 Apr 2015); the 26Q no-deduction code `T`; the 2025-Act table item (6(i) shown).
6. Works-contract GST rates (`WORKS_CONTRACT_RATE_RULES`: 18% general; government works 12% before 22 Sep 2025, 18% from
   then) — which government / affordable-housing works keep a lower rate.
7. Retention: GST charged on the full value at invoice time (as built), not on release.
8. Mobilisation advance: GST at receipt through the R5.3 advance receipt voucher; recovery by advance adjustment.
9. GST TDS u/s 51: 2% on value excl. GST, ₹2.5 lakh tested on the contract value (as built), credit on acceptance of the
   GSTR-7A row; which PSUs / local authorities are deductors.
10. Labour cess: 1% of the value before GST (as built) — state practice, expense vs recoverable, and whether GST is on a
    value including the cess.
11. Driver advances through 3615 and trip expenses as cash expenses; lorry hire booked without GST (hire of a goods
    carriage to a GTA) — confirm the GST position of the hire.

## Known limits / deviations

- **Bundle**: total-JS delta is over the package budget (see table); first paint is within +0.2 kB.
- `transporter_194c6` is kept on the **vendor** (the lorry owner is a supplier: the hire bill is a purchase), not on
  `clients` as the PRD listed. The vehicle form saves it on the owner's vendor record. The hire bill is a supplier bill (`PURCHASE`, opens in
  BillModal); BillModal and ExpenseModal start their TDS block from `billTdsInputFor` (`tds-payables.ts`), which reads the
  vendor's declaration and keeps a stored reason-`T` nil deduction on edit (also when the vendor master lost the
  declaration).
- BOQ terms are grouped in one additive field `boq_terms` (instead of `ra_deduction_set` / `dlp_months` / `advance_id`
  separately), so `RECORD_KEYS` gains 8 keys (7 in the PRD + `boq_terms`).
- `ProgressBasis` is a type alias, so `'measured'` was added in `types/sales-r2.ts` (one token) — declaration merging
  cannot extend a union.
- The RA abstract and the freight-bill LR annexure print as their own HTML pages (Works → RA register, Transport →
  Freight bills) instead of through the R3-B4 annexure component, which is timesheet-shaped (no `TemplateEngine` edit).
- B's statutory values live in `src/lib/transport-works-rules.ts` (date-keyed `Versioned` rows, "verify"), not appended
  to `tax-rules.ts`, which is in the first-paint bundle (appending them there alone would cost ≈0.4 kB of first paint).
- One bell gate function (`ensureTransportWorksAlerts`) with two lazy imports, each checked against its own pack.
- A GST TDS / cess receipt carries `ra_journal_id`; removing it from the payment dialog removes its journal with it
  (`removeDeductionRow`: one `withTablesRollback`, period lock on both, recycle bin through `payments.remove` /
  `deleteVoucher`). Other screens that delete receipts (cheques, write-offs) never hold these rows.
- RA numbers: a cancelled RA bill's number is issued again (the invoice number is not).
