# Job work, ITC-04, Rejections In and alternate units on stock vouchers (Phase 7M)

Tally's "Job Work Out / In Orders", "Material Out / In", job-worker godowns ("our stock with third party") and the
ITC-04 working paper (P1-9); "Rejections In" (P1-8); alternate units and decimal rounding on POS lines, stock
journals, stock transfers and manual adjustments (P1-10 follow-up, roadmap 7.66). Stock only: nothing here posts to
Books or the double-entry ledger.

- **Route**: `/manufacturing?tab=jobwork` (sections `&jw=out|in|orders|principal|clocks|itc04`) and
  `/manufacturing?tab=rejections`. Both tabs are `React.lazy` chunks loaded on demand from the manufacturing page.
- **Gateway** (`GATEWAY_EXTENSIONS`): Vouchers → Job work order (W), Material out (O), Material in (I), Rejections in
  (X); Inventory books → Job work register (J); Statutory → ITC-04 (4).
- **Screens**: `src/components/job-work/*` (new files). **Strings**: `src/i18n/areas/job-work.ts` (`jwT`, English +
  Hindi); two tab labels in the manufacturing area.
- **Logic**: `src/lib/job-work.ts` (orders, Material Out / In, principal register, Sec 143 clocks, storage),
  `src/lib/events-job-work.ts` (stock event source, one registration line in `collectEvents`), `src/lib/itc04.ts`
  (working paper), `src/lib/job-work-challan.ts` (Rule 55 challan print), `src/lib/rejections-in.ts`.
- **Types**: `src/types/job-work.ts`. **Tests**: `tests/job-work.test.ts` (pure), `tests/integration/job-work.test.ts`
  (storage, numbering, lock, roles, audit, backup, ledger), e2e step "job work: Material Out … ITC-04 lists the challan".

## Tables (all in backup `RECORD_TABLES` / `ID_TABLES`, role guard `TABLE_ACTIONS: books.edit`, folder-sync dated + numbered)

| table | what | number |
|---|---|---|
| `job_work_orders` | Job Work Out / In order (party, process, goods expected back, BOM, job charges / unit) | `JWO/FY<yy-yy>/<seq>` |
| `job_work_out` | Material Out — delivery challan to a job worker (Rule 55 / Sec 143) | `JWC/FY…` (16 characters, within Rule 55's limit) |
| `job_work_in` | Material In — processed / scrap / returned lines, inputs consumed, losses, 5C supplies, job charges | `JWR/FY…` |
| `job_work_principal` | Job Work In side: the principal's material received / sent back (not our stock) | `JWP/FY…` |
| `rejections_in` | Rejections In against a delivery challan | `RJI/FY…` |

Numbers follow the Indian FY of the date and the `series_counters` high-water mark: a deleted latest number is never
issued again; a date moved into another FY takes that FY's next number. Every save / delete checks the period lock (PIN
override tagged in the audit row) and writes an audit row (entities `job_work`, `rejection_in`). Additive fields
elsewhere: `Godown.job_worker` / `vendor_id`; `unit` / `unit_factor` on `StockMove`, `StockTransferLine` and
`VoucherStockLine`; `ConvertContext.rejected` (documents.ts).

## Stock (how the documents reach the engine)

Like every voucher, the documents are read-only engine inputs (`liveInputs().jobWorkDocs`), never `stock_moves`, so a
delete can never leave orphan moves.

- **Job worker's godown.** The first Material Out to a party creates "<name> (job worker)" (`ensureJobWorkerGodown`,
  `job_worker: true`, linked to the supplier). Stock there is still ours: it counts in the stock summary and its value.
- **Material Out** = godown move our godown → job worker's godown (kind `transfer`, emitted only when stock is read by
  godown, exactly like stock transfers). Company-wide quantity and value do not change.
- **Material In**: consumed lines issue from the job worker's godown (kind `consumption`); processed lines are produced
  into our godown at `inputs consumed + job charges − scrap value`, split by quantity; scrap lines at their value per
  unit; returned and 5C-supplied lines move back from the job worker's godown; losses leave as an adjustment (not a
  sale, not COGS). The voucher pool uses the same global costing pass as manufacturing journals
  (`computeStockDetailed` now takes it whenever any event belongs to a voucher).
- **Consumption per BOM is optional**: "Fill from BOM" explodes the order's BOM (or the processed item's default BOM)
  for the processed quantity; a Material In with processed goods needs consumed inputs and vice versa.
- **Principal's goods** (Job Work In) are never in our stock; the register shows received / sent back / with us per
  principal and order. "Job charges invoice" opens a new tax invoice in the editor with a SAC 9988 service line
  (`jobChargesLine`); the GST rate is typed (5 / 12 / 18 % depending on the goods — verify with your CA).
- **Job charges paid** to our job worker are booked as a purchase bill (service) as usual; the Material In charges
  field only loads the stock cost (memo), so the bill is not double counted.

## Return clocks (Sec 143) and deemed supply

`challanBalances` settles each Material Out line by consumed + returned + supplied + lost quantities (a line's chosen
challan first, else the oldest open line of the item at that job worker — FIFO). Clock per line: inputs one year,
capital goods three years from the challan date (last day = anniversary − 1, conservative), moulds / dies / jigs /
fixtures / tools no limit, or the Commissioner's extension (`extended_until`). Statuses: settled / open / due soon
(30 days) / **deemed supply** (past the clock with quantity pending) / no limit; a line settled after its clock is
flagged "came back late". Alerts sit on top of the Job work tab: "treated as supplied on <challan date> (Sec 143(3)/(4)).
Raise an invoice and pay the tax with interest; verify with your CA." Nothing is posted automatically. Receiving more
than is pending is refused; a challan with goods received against it cannot be deleted (or edited below that); an order
used by a challan cannot be deleted; a godown named by job-work documents cannot be deleted; a stock item used by them
cannot be deleted (`item-references.ts`).

## ITC-04 working paper (`src/lib/itc04.ts`)

- **Table 4**: our challans in the period — job worker GSTIN / state, description, HSN, UQC (units master), quantity
  (base unit), taxable value, inputs / capital goods, rate, IGST or CGST + SGST (inter-State by the job worker's state vs
  ours — information only, no tax is charged on a job-work challan).
- **Table 5A** received back from the same job worker (inputs consumed for processed goods, returned unprocessed, with
  losses / wastes), **5B** received through another job worker (Material In "received through another job worker"),
  **5C** supplied from the job worker's premises — each against the original challan it settled.
- **Frequency** (`ITC04_RULES` in `tax-rules.ts`, date-keyed, append-only): quarterly to FY 2020-21; from FY 2021-22
  half-yearly when the previous year's aggregate turnover exceeds ₹5 crore, annual otherwise (Rule 45(3) as amended by
  Notification 35/2021-CT); due on the 25th of the month after the period. The screen asks for the turnover and allows
  an override. CSV download; the paper and the screen carry "verify with your CA".

## Rejections In (`src/lib/rejections-in.ts`)

A customer rejects goods sent on a delivery challan before it is invoiced: pick a live, not-yet-invoiced challan and
the rejected quantity per line (≤ challan balance). Stock comes back (kind `return`, reversing the challan's issue)
only while challans move stock (Inventory setting); otherwise it reduces the balance only. Converting the challan to an
invoice bills the balance (`buildConvertedDraft` with `rejected`; fully rejected → refused). An invoiced challan is
refused ("record the return as a credit note").

## Alternate units and decimal rounding (7.66)

`unit` + `unit_factor` snapshot (as on document lines) on **POS lines** (unit picker under the item when the stock item
has alternate units; rate rescaled, a typed price), **stock journal** source / destination lines (`LinesGrid` unit
column; also its godown-transfer mode), **stock transfers** (Inventory → Transfers) and **manual stock adjustments**.
Every reader converts: `collectEvents` (moves, transfers), `stockVoucherInputs` (`baseLine`: qty × factor, fixed rate ÷
factor), `transferIssues`, `consumptionShortfalls`, job-work lines. Typed quantities round to the decimal places of the
unit they are typed in (`roundTypedQty` over the units master: NOS 0, KG 3, MTR 2 …) on blur in these editors and on
every POS quantity change.

## CA points / verify

- ITC-04 frequency switch from FY 2021-22 (Notification 35/2021-CT effective 1 Oct 2021, applied here from the H1
  2021-22 period) and the 25th due day.
- Whether the one-year / three-year clock ends on the anniversary or the day before (the app is conservative).
- Table 5 reporting of inputs consumed for processed goods (we report the original goods settled, base unit).
- GST rate on job charges (5 / 12 / 18 % by goods and principal's registration).
- Deemed supply valuation and interest when a clock expires (the app only flags).

## Gaps / next steps

- ~~Serial-tracked items cannot go to a job worker yet~~ — 7S.
- ~~No automatic e-Way bill JSON for job-work challans~~ — 7S.
- ~~Job Work In side does not track the principal's goods by godown / batch~~ — 7S (register by godown / batch; still not our stock).
- ~~Alerts are shown on the Job work tab only~~ — 7S: the bell shows them (lazy provider).
- e-Way JSON for goods we send back to a principal (sub-type 6 "job work returns") is not generated yet; GSTR-1 JSON of
  job charges is the normal invoice export.

## 7S follow-ups (roadmap 7.73)

- **Serials**: `JobWorkLine.serials` (additive). Material Out lines list the serials sent (they must be in the source
  godown on the challan date); Material In consumed / returned / supplied / lost lines name serials at the job worker's
  godown; processed goods and scrap come in under new serials (`jobWorkSerialIssues`, checked in `materialOutDb.save` /
  `materialInDb.save` against live stock without the document's own copy). The events carry the serials
  (`events-job-work.ts`), so a serial at the job worker shows in Serial lookup under his godown and is still our stock.
  Deleting a challan / Material In whose serials a later entry used is refused. Grids show a serial column with
  "Fill from stock".
- **e-Way bill JSON** (`src/lib/eway-job-work.ts`): Material Out row → "e-Way bill JSON": bulk-upload layout of `eway.ts`
  (version 1.0.0621), supply type O, sub-type 4 "Job Work" (`EWAY_SUB_JOB_WORK`, the only eway.ts change), document CHL;
  from = business profile, to = job worker (supplier master address / GSTIN / state); lines with HSN, UQC, value, the
  GST rate split IGST or CGST + SGST — tax values nil (no tax on a job-work challan). Transport (vehicle, transporter ID /
  name, distance) is saved on the challan. "Needed" when inter-State or above ₹50,000. Not portal-validated: verify with
  your CA.
- **Clock alerts in the bell** (`src/lib/job-work-alerts.ts`): one critical notice for lines past their Sec 143 clock
  (deemed supply, "verify with your CA") and one warning for lines due within 30 days, linking to Return clocks. The
  lazy stock-alerts provider registers them; the bell loads it when a `job_work_out` row exists (one table-length check
  in the shell).
- **Principal's goods by godown / batch** (`src/lib/job-work-principal.ts`): principal movement lines take `godown_id` and
  `batch_no` (additive); "Principal's goods by godown / batch" lists received − sent back per principal × item × godown ×
  batch. A return without godown / batch settles the oldest balances of that item first. Register only — never our stock.
- **ITC-04 JSON** (`src/lib/itc04-json.ts`): "Download JSON (layout unverified)" beside the CSV — `m2jw` (Table 4),
  `jw2m` (5A), `jw2jw` (5B), `jwsupply` (5C) grouped by job worker GSTIN, `fp` = MMYYYY of the period's last month,
  dd-mm-yyyy dates. **The layout is not verified against the portal / offline tool**; the CSV stays the reference.

CA points added by 7S: e-Way bill for job-work challans (Rule 138 — inter-State always, intra-State above ₹50,000; tax
values nil), ITC-04 JSON keys / codes, and whether the principal's goods register needs the principal's batch.
