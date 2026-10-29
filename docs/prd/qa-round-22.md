# QA round 22: Round 19 (freight forwarders, customs brokers, courier franchisees, 3PL)

Status: findings fixed in the same loop, each with a regression test that fails on the baseline source:
`tests/qa22-logistics.test.ts` (W1–W9, nine tests; all nine fail on `1200d69`'s `src/`). Baseline: branch
`claude/elegant-cannon-cwapiv` at `1200d69` (R19-A … D, PR #101), re-merged at `a534f94` (master, same tree) before the
final checks.

Method: the money paths walked at the data layer with `tests/helpers/world.ts` — job → charge sheet → regime per head
(`lg-regime.ts`, by date) → plan → ONE `saveMany` → GSTR-1 B2B / B2CS / EXP / HSN / e-Invoice; disbursements → Rule 33
lines (`bill_refs`) → cancel; deposits → `applyAdvance` / `refundAdvance`; agent note / agent bill → netting at the bill's
rate → `exchangeSettled` / `syncNettedPaid` / ledger / FX; dockets → manifests → month run → undo; job costing through
`readPurchase`. The data layer (backup / sync / open export / `TABLE_ACTIONS` / audit / recycle-bin hooks / demo removal)
and every Shipments-desk view with the strings its engines build; the B / C / D merge seams (`billExtras`, `VIEWS`, the
shared tests).

Severity: **P0** money or data wrong, data lost, security; **P1** a flow broken, an invariant broken, or a tax figure
wrong; **P2** friction, a working-paper figure off, cosmetic.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| W1 | P1 | LG15 GST reader × unregistered client | Export freight to a client in India **without a GSTIN** (an individual's personal effects, a small exporter): the bill is POS 96 IGST (`export_freight`, Sec 12(8) proviso), but `gst-reports.ts` sent it to **EXP (Table 6A, WPAY)** and 3B 3.1(b) zero-rated. The LG15 exception required a valid GSTIN. A supply to a recipient in India is not an export | `freight96` = POS 96 + `export_freight` + (a valid GSTIN **or** a client not coded 96 / 99): B2CL / B2CS with POS 96, IGST, 3.1(a). A client coded "Other Country" stays an export. e-Invoice unchanged (B2C is not e-invoiced) | W1 |
| W2 | P1 | R19-D2 courier × GST reader | An international docket's bill (POS 96, IGST, 12(8) proviso, LG18) had no `lg.regime`, so the LG15 exception never applied: an Indian account customer's courier bill went to **EXP / 6A** and the e-Invoice as `EXPWP` with a foreign buyer | `courierBill` writes `lg.regime: 'export_freight'` on the international document of a customer not coded 96 / 97 / 99 → B2B (or B2C per W1) with POS 96 | W2 |
| W3 | P1 | R19-B2 GTA head × R5-B option | The GTA leg took the R5-B option's **rate** only: with no `gta_options` row (= reverse charge, the default) a registered client's "Transportation" head was billed at **5 % forward charge** (CGST + SGST collected), while R5-B's own freight bills for the same client are reverse charge — the client would pay the GST twice | `RegimeCtx.gtaRcm` (option `rcm` and a registered recipient, `GTA_RCM_RECIPIENT_KINDS`); the GTA head's regime carries `rcm`, groups on its own document with `reverse_charge` + `rcm_tax_excluded` (total = taxable), reason "GST payable by the recipient (reverse charge)", chip "… RCM". Forward-charge options unchanged | W3; LG8 |
| W4 | P1 | R19-D1 agents in India | "Add agent" offers "outside India" unticked (co-loaders, airlines' Indian GSAs, CFS, transporters), but "Debit agent" always made **POS 96 `EXPORT_WITH_PAYMENT`** (GSTR-1 6A for an Indian party) and "Agent's bill" always booked an **import of services under RCM** (IGST self-assessed and claimed on a domestic supplier's bill) | A non-foreign agent's note is a domestic document (POS by Sec 12(2): its GSTIN's State, else its State, else ours; `regime: 'general'`; B2B / B2C); its bill is refused ("An agent in India charges its own GST: record its bill in Purchases") | W4; LG17 / LG30 |
| W5 | P2 | R19-D2 "Undo month" × credit notes | Undo cancelled a courier bill that carried a **live credit note** (a rate dispute): the note stayed live, a credit against a cancelled bill (the QA21 W5 case on another run) | Refused up front, naming the bills, while a bill has a receipt **or** a live linked credit note (`doc_links`) | W5 |
| W6 | P2 | R19-D1 netting × roles | `settleAgent` had no owner check: a clerk could net an agent's receivables against its payables, which R15-A `postNetting` refuses ("Netting needs the owner's approval") | Same rule (`can('doc.approve')`), Hindi string | W6 |
| W7 | P2 | R19-D1 netting × Books → FX | An agent netting row is a receipt on a USD note, so Books → FX listed it with an **editable realised rate**. Changing or clearing it moved the ledger's creditor clearing (Dr creditors at amount × rate) while the bill's `amount_paid` kept the old ₹; cleared, the next re-sync (`exchangeSettled`, amount × 1) counted USD as rupees (USD 60 → ₹60 paid instead of ₹5,040) | `foreignReceipts` marks netting rows (`netted`); the FX tab shows their rate read-only (it is the bill's rate, set by the netting; reverse the netting to change it). The data-layer guard was not put in `localDb.ts` (first paint 0 B) | W7 |
| W8 | P2 | Hindi × customs desk | With Hindi on, the C bridge's errors (`Give the date and a reason.`, `Not an open disbursement.`, `Client not found.`, `No open invoice of this job.`) and the SB / BOE import's row errors (`Row n: job not found …`) stayed English | Strings in `logistics-r19c` (literal Hindi); `noInv` reused | W8 |
| W9 | P2 | Ctrl+K × courier pack | The courier palette row took every Round 19 pack (`alsoPacks`), so a plain forwarder saw "Courier manifests and monthly bills" in Ctrl+K although the desk lists the view only with the `courier` pack. The reports row promised "deposits" (cut in R19-D) | Courier row: pack `courier` only; reports label "margin, agents, disbursements ageing" (Hindi too) | W9 |

## 2. Paths walked and found right

- **Regime per head (`lg-regime.ts`)**: Sec 12(8) domestic (registered → its State, else ours as the hand-over place);
  the proviso from 2019-02-01 (POS 96, IGST, also an import job's leg with `dest_country` IN stays domestic); a foreign
  client 13(9) destination of goods to 2023-09-30 (mail / courier always 13(2)), 13(2) from 2023-10-01, LUT only with
  Sec 2(6) not failed and an LUT on record and a registered sender; intermediary at our location while the R14 rule says
  `supplier` (CGST + SGST), recipient from 2026-03-30; exempt heads (Sl. 54(e) / 24, a Bill of Supply when the whole
  group is exempt, `sv.exempt` lines); pure agent (0 %, `rule33`, no SAC); multimodal 12 % → 5 % / 18 % with an air leg
  from 2025-09-22, domestic only (an international multimodal job takes its leg's rate).
- **LG15 readers**: B2B POS 96 with IGST in GSTR-1 and e-Invoice (`SupTyp: B2B`, `Pos: 96`); no `POS_VS_GSTIN` info on
  them; LUT / with-payment bills to an overseas client stay EXP; `rule33` lines stay outside Table 8 / HSN / 3.1.
- **Rule 34(2)**: a USD line to an Indian client is a ₹ line at the typed rate, else the currency master on the bill date
  (the USD amount and rate in its text, `lg.fx` printed); a client abroad gets a USD document with `exchange_rate`; no
  rate → the job is skipped and the currency named.
- **Rule 33 disbursements**: billed by row (`bill_refs: [disb_id]`, `billedBy` — the editor's billable-cost rule);
  re-bill skips them; cancelling the bill frees them (and brings the D notice back); write-off is a memo stamp, period
  checked by its own date; job costing leaves them out (`lg.on_behalf`).
- **Duty deposits**: an advance at 0 % with `pass_through`; apply = `applyAdvance` (a payment with `advance_id`, skipped
  by every cash reader through `movedNoCash`); refund = `refundAdvance`; position = open deposits − unrecovered − owed.
- **Agent netting** at `realised_rate` = the bill's rate: the note is settled in USD, the ₹ bill at amount × rate
  (`exchangeSettled`), the ledger Dr creditors at the realised ₹ and the exchange difference to FX; reversal and a
  cancelled note free both sides (`voidHook` → `syncUrdPaid` → `syncNettedPaid`). R9 / R12 / R15 rows carry no
  `realised_rate` (`payments.record` sets it only on a foreign invoice; R15 `postNetting` refuses foreign invoices), so
  their roll-up is unchanged.
- **Courier**: chargeable = max(kg, volume ÷ 5000) up to 0.5 kg; first 500 g + each further 500 g; the minimum before RTO
  and FSC; a typed charge wins; duplicates in a file and across manifests refused; a billed month refuses new dockets.
- **Batch billing**: `billJob` / `billMonth` and the courier run issue through ONE `saveMany` (B inside
  `withTablesRollback`); re-bill is idempotent (billed heads / manifests derived from live documents, credit notes not
  bills); grouping by place of supply × currency × kind × export supply (× RCM, W3).
- **Job costing**: revenue = taxable of live documents in ₹ less recoveries, credit notes negative, financial notes out;
  cost = tagged bills through `readPurchase` (+ GST not taken as credit), void / draft and on-behalf rows out.
- **Snapshot rule**: `LogisticsBlock`, `DisbSchedule` and `lgLineText` print from `invoice.lg` only.
- **CSV / print**: the CB register's CSV neutralises a leading `= + - @`; the print escapes every cell (`escHtml`); report
  and docket CSVs go through `toCsv` (neutralised).
- **Data layer**: `lg_jobs` / `lg_manifests` in backup (both lists), sync (DATED `date`), open-export schema,
  `TABLE_ACTIONS` / audit via `lg-registry` (every writer imports it: `lg-save`, `lg-settings`, `lg-issue-io`,
  `lg-recv-io`, `lg-d-save`; sync engine and recycle bin too), restore hooks (job: client lives, no live job holds the
  HBL / HAWB, case-insensitive like `validateJob`; manifest: client, customer × month, dockets), `DEMO_EXTRA_TABLES`.
- **Merge seams**: `billExtras` has C's arm once (D adds none, by design); `VIEWS` lists eight views once each, `customs`
  and `courier` pack-filtered; no test or string duplicated by the merges.
- **Not reachable**: `split: 'single'` with a pure-agent line at another POS would be refused (`eSingle`), but no screen
  sets `split` (it stays `pos_currency`); left as found.

## 3. Statutory re-check

| Rule | Read | Outcome |
|---|---|---|
| Sec 12(8) proviso / Circular 184/16/2022-GST | As quoted in R19 (P) | The proviso reaches any recipient in India — basis of W1 / W2 |
| GTA under RCM (N 13/2017-CT(R) entry 1) | `GTA_RCM_RECIPIENT_KINDS` (R5-B, `verified` as there) | W3 follows R5-B's `liablePerson`; no rule row added |

No rule row was added or flipped.

## 4. Size

Before = `1200d69`, after = this branch; `vite build` + `check-bundle-size`.

Normalized = chunk hashes stripped from names and contents before gzip -9.

| Budget | Before | After | Delta |
|---|---|---|---|
| Initial JS (first paint) | 183.0 kB, 4 files (entry 87,846 B normalized) | 183.0 kB, 4 files (entry 87,846 B) | **0 B** (runtime / vendor chunks byte-identical) |
| Core precache (English) | 3,263.3 kB | 3,263.1 kB | +0.5 kB normalized (`f-logistics` +335 B, ShipmentsDesk +150, `fx-gain` +25, `gst-reports` +14, FxTab +7, `lg-recv-io` −29, `industry-packs` −5); raw total within build noise |
| Hindi pack | 359.4 kB | 359.6 kB | +168 B (`lang-hi-logistics`: W4 / W5 / W6 / W8 strings) |
| Hindi left in core / `lazy-leaves` | 21.7 / 17.7 kB | 21.7 / 17.7 kB | 0 |

Every budget stays green (`check-bundle-size`).

## 5. Deferred

- **Unregistered recipient's hand-over State**: B uses our State for transport heads, D's courier bill the customer's
  State on record (both documented; LG1 open with the CA).
- **Domestic agent statement**: a domestic agent's bills recorded in Purchases carry no `lg.fx`, so they do not enter the
  agent statement / netting (netting them goes through R15-A Receivables → Netting). Not a defect; a later round can add
  it.
- **`deleteJob`** refuses only on live invoices, not on tagged disbursements / deposits (no screen calls it; the recycle
  bin brings the job back).

## 6. CA questions

No new ids. "Where" cells updated in `docs/CA_REVIEW.md` §19: LG8 (W3), LG15 (W1, W2), LG17 / LG30 (W4), LG18 (W2).
