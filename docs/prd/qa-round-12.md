# QA round 12: hands-on audit of Round 10 (services: SV-A front desk, SV-B clinics, SV-C memberships, SV-D workshops)

Status: findings fixed in the same loop, each with a regression test in `tests/qa12-services.test.ts`. Baseline:
branch `claude/elegant-cannon-cwapiv` at `f2cea21` (SV-A, SV-C, SV-D), then `402be84` once SV-B (clinics) landed while
the audit ran; SV-B's desks (OPD, IPD, lab, referrals) were reviewed after that merge. The Round 10 suites
(`tests/sv-*.test.ts`, `no-cash-readers`, `help-registry`, `purchase-contract`) pass on both commits.

Method:
- **Real flows at the data layer**, through the repo's test harness (`tests/helpers/shim.ts`, `world.ts`), calling the
  same lib APIs the desks call:
  - salon / gym: `saveMemberPlan` → `sellPlan` → `freeze` / `upgrade` / `transfer` / `cancelMembership` / `renew` /
    `autoRenewDue` / `topUp`; `redeemPatch`; `checkIn`; `commissionFor` (invoice and receipt basis) with wallet
    (`applyAdvance`), write-off and redemption bills;
  - front desk: `billLines` / `appointmentDraft` for catalogue and typed services;
  - claims: `saveClaim` → `billClaim` → `writeOffShort` / `rejectAndRebill`; motor `motorSplit` / `billMotorClaim`;
  - workshop: `makeEstimate` → `approveEstimate` → `issueParts` → `billWorkshopJob` (`settleForBill`, advance);
  - clinic: `saveVisit` → `billVisit`; `saveOrder` → `billOrder`; `saveAdmission` → `addCharge` → `discharge` →
    `finalBill` (room class, claim split) → `applyDeposits`; `referralReport` / `feeShare`;
  - shared: `localDb.invoices.save` (client write-back), `localDb.invoices.remove`, `restoreEntry`.
- **Static review** of `src/lib/services/*`, `service-rules.ts`, the desks in `components/services-r10/*`, the R10 rows
  of `backup.ts`, `sync-engine.ts`, `open-export-schema.ts`, `trust/recycle-bin.ts`, `demo/profile-services.ts`, the
  i18n areas `services-r10*.ts` and `storage.ts` (cross-tab refresh, for the coordinator's e2e question).

Severity:
- **P0:** money or data is wrong, data is lost, or there is a security issue.
- **P1:** a flow is broken, a stated Round 10 invariant is broken, or a tax document / return figure comes out wrong.
- **P2:** friction, a working-paper figure is off, or a cosmetic or printing error.

---

## 1. Summary

| # | Sev | Area | Finding | Fix | Test |
|---|---|---|---|---|---|
| S1 | P0 | Shared / R5-C / SV-C | **Saving any document wrote its whole client snapshot back to the client master.** Re-saving an old fee bill reset the student's enrolments (batch, refund request); the same happened to contacts, delivery addresses, birthday / anniversary, hotel / trade / transport defaults, patient data — every master-only field except the eight credit / distribution keys that were stripped one by one | Root fix in `localDb.invoices.save`: the write-back learns only the party's **identity** (`id`, name, e-mail, address, city, PIN, company, GSTIN, phone, state, state code, PAN, TAN — `PARTY_KEYS`); everything else is the master's own. A new party typed on a document is still created | `S1` |
| S2 | P0 | SV-C1 cancel | `cancelMembership` had no "already closed" check and the desk offers every action on every row: a cancelled (or upgraded) membership could be **cancelled again — a second GST credit note / refund** on the same sale bill. Freeze (fee bill), renew and wallet top-up also ran on closed memberships | One `open()` guard: cancel, freeze, upgrade, transfer, renew and top-up refuse a closed membership | `S2` |
| S3 | P0 | SV-C1 wallet | A wallet top-up taxed the advance at `plan.tax_rate` only. The plan form has **no rate field** (the rate comes from the tax class), so every wallet sold from the desk took **0% GST on the advance** (GSTR-1 Table 11A / 3B short) | The top-up uses the rate a sale of the plan would use (class rate by date, else the default rate). CA question SV60 (Rule 50: 18% when the later rate is not determinable) | `S3` |
| S4 | P1 | SV-A3 commission | Receipt basis: (a) a **prepaid redemption** (₹0 line, bill total ₹0) never earned — the per-session rule (₹ per session for trainers / therapists) paid nothing; (b) a bill **paid from the wallet / advance**, a gift voucher, a deposit or an exchange earned nothing, because every no-cash row was skipped — only write-offs are unpaid | Redemption lines earn on the bill's date; receipts count unless `noCashKind(p) === 'write_off'`. CA question SV62 | `S4` |
| S5 | P1 | SV-C1 / GSTR-1 | A membership / package of an **exempt class** (charitable yoga, education, health care) went out at 0% **without** `sv.exempt`, so GSTR-1 Table 8 put it in the nil-rated column and the exceptions report flagged `SV_NIL_NOT_EXEMPT` on the app's own bill | `planLine` carries the class's Table 8 column on a 0% line (as `classPatch` / `billLines` / `clinicLine` already did). CA question SV61 | `S5` |
| S6 | P1 | SV-C1 gate | A membership whose **sale bill was cancelled (or deleted) in the editor** — not through *Cancel with refund* — stayed **active**: the gate let the member in, sessions could be redeemed, check-ins redeemed | `statusOf(m, day, used, invoices)` (and `redeemPatch` / `checkIn`) returns `cancelled` when the sale bill is gone or cancelled; the desk, the check-in gate and the redeem chip pass the invoices (pure maths without them unchanged) | `S6` |
| S7 | P1 | SV-A2 appointment → bill | A service **typed** in the appointment dialog (not from the catalogue, no class) was billed at **0%** — a taxable salon / workshop service reported as nil-rated | `billLines` falls back to the company's default rate, like a new editor line | `S7` |
| S8 | P1 | SV-A5 claims | `rejectAndRebill` could run twice on the same claim (the data layer had no guard; only the desk hid the button): **the beneficiary billed twice** | Refused once the claim is rejected / re-billed | `S8` |
| S9 | P2 | SV-C1 auto-renew | (a) An auto-renewal bill was saved **issued first**, then turned back into a draft (two audit rows, a transient issued bill). (b) One auto-renewing membership whose plan was deleted threw, and **no other** membership was renewed — every time the desk opened | The successor's bill is saved as a draft at once (`sellPlan(…, { draft })`); each renewal is tried on its own | `S9` |
| S10 | P1 | Recycle bin / SV-B / SV-D | A deleted **OPD / lab / admission / workshop-job bill** came back from the recycle bin next to the bill made again for that visit / order / admission / job (each engine allows a re-bill once its bill is gone): **the same service billed twice** | `invoices` restore hook: refused while the source row now names another live bill (quotations and credit notes are left alone); a stray delete with nothing re-made still restores | `S10` |

### What was verified and is correct

- **Timing of GST on memberships and packages (SV14 / SV15).** The whole price is invoiced and taxed on the sale date;
  a redemption is a ₹0 line (never taxed twice — it keeps its SAC for the HSN summary, SV45); a wallet spend adjusts
  the advance through the ordinary advance machinery, so the GST paid on receipt is adjusted, not charged again.
- **Exempt vs 5%-no-ITC vs 18% in the returns.** `line.sv.exempt` decides the Table 8 / 3.1 column (non-GST to 3.1(e));
  the 5%-no-ITC classes (beauty, fitness, hospital room above ₹5,000 / day) reach 3.1(a) at 5% and the Rule 42
  "exempt-like" turnover; the ITC caution on purchase bills fires once such a class was sold in the FY.
- **Payer split.** Per head (approved incl. GST ÷ job total) and per line; the two bills add up to the job to the paisa;
  the job's own draft becomes the beneficiary's bill (no number skipped); motor depreciation and excess tags.
- **Workshop.** Parts issued to "Jobs in progress" go back to main before the sale (`settleForBill`), so stock leaves
  once; AMC labour is dropped; quotations are linked `converted`; the advance is adjusted once.
- **Clinics (SV-B).** Consultations, lab tests, medicines on an admission are exempt health-care lines (`sv.exempt`);
  the room-rent test (ICU kinds exempt; > ₹5,000 / day 5% without ITC from 18 Jul 2022); a Bill of Supply for an
  unregistered clinic; the UHID / doctor registration snapshot on paper; deposits are advances applied once.
- **No-cash rows.** No services module computes cash / bank money from receipts; commission is a "paid by the customer"
  reader and now uses `noCashKind` (write-offs only) — the cash-reader guard in `no-cash-readers.test.ts` is unchanged.
- **Storage coverage.** Every SV table (A–D) is in both backup lists and the open-export schema; dated / numbered tables
  sync by date (`appointments`, `staff_payouts`, `payer_claims`, `clinic_visits`, `admissions`, `lab_orders`,
  `memberships`, `checkins`, `class_attendance`); objects sync as singletons; every writer imports `./sv-registry`.
- **Demo company.** The services profile writes its front-desk and members blocks only into the Demo company; demo
  memberships carry no sale bill, so S6 leaves them active.
- **Hindi / help / Ctrl+K.** Every desk string goes through the `services-r10*` areas (English + Hindi, the type checks
  parity); every R10 pack tab has a help topic, palette label and Ctrl+K title (`help-registry`).
- **Empty data.** Every loader filters rows without an id; desks render with no plans / staff / tests / admissions.

### Not changed (noted)

- **Numbered drafts.** Auto-renewal, appointment, claim, OPD / lab / IPD bills are numbered drafts (as every editor
  draft). Deleting one leaves its number reserved; cancel it instead (GSTR-1 Table 13 then shows it as cancelled).
- **A deleted / cancelled workshop job bill** leaves the job "billed" (RT-D4's rule: edit the bill instead).

---

## 2. Findings

### S1 — P0 — A re-saved old document reset the client master

- **Repro:** enrol a student (batch "morning"), bill June fees; move the student to "evening" and record a refund
  request; open the June bill and save it again → the student is back in "morning" with no refund request. Same for a
  client's contact persons, address book, birthday (SV-A2), patient object (SV-B1) and every pack's party defaults.
- **Cause:** `localDb.invoices.save` upserted `toSave.client` (the snapshot of the day) by id, which takes every field.
  QA rounds had stripped credit terms (6.25) and distribution fields (8F) one at a time; SV-C stripped enrolments only in
  its own credit-note path.
- **Fix:** the write-back takes only the party identity (`PARTY_KEYS` in `localDb.ts`) — the fields a user types on a
  document's party. The list replaces the old eight-key strip, so the shell grew by 3 bytes (gzip).

### S2 — P0 — Cancel twice = refund twice

- **Repro:** sell a 6-month gym plan (₹9,000, pro rata), *Cancel with refund* on 1 June → credit note ₹7,4xx; pick the
  row again → *Cancel with refund* → a second credit note on the same bill.
- **Fix:** `open(id)` in `sv-memberships.ts` refuses every action except unfreeze / bonus use on a closed membership.

### S3 — P0 — Wallet top-ups at 0% GST

- **Repro:** Plans → Wallet with tax class "Beauty (9997)", bonus 10% → sell with a ₹10,500 top-up → the advance
  receipt shows GST 0.
- **Fix:** `topUp` → `tax_rate: planLine(m.plan, date).tax_rate`.

### S4 — P1 — Receipt-basis commission missed redemptions and wallet-paid bills

- **Repro:** trainer plan "₹50 per session redeemed", basis receipt; redeem a PT session on a ₹0 bill → ₹0 commission.
  A ₹1,000 haircut paid from the customer's wallet → ₹0 commission (10% expected).
- **Fix:** see the table; credit notes still take back in their month.

### S5 — P1 — Exempt plans reported as nil-rated

- **Fix:** `planLine` adds `sv.exempt` (the class's column) on a 0% line; taxed lines carry none.

### S6 — P1 — A cancelled sale bill left the membership active

- **Fix:** `saleVoid(m, invoices)` in `sv-members.ts`; `statusOf` takes optional invoices. Two SV-C tests passed an
  empty invoice list as a shortcut; they now pass the real list.

### S7 — P1 — Typed appointment services at 0%

- **Fix:** `billLines`: `s.tax_rate` → class rate → `settings.defaultTaxRate`.

### S8 — P1 — Claim rejected twice

- **Fix:** `rejectAndRebill` refuses a claim with status `rejected` or a `rebill_invoice_id`.

### S9 — P2 — Auto-renewal

- **Fix:** `sellPlan` takes `{ draft }`; `autoRenewDue` renews each membership in its own try.

### S10 — P1 — Recycle bin double-bills a service

- **Repro:** OPD visit → *Bill* (draft) → delete the draft → *Bill* again → Recycle bin → restore the first bill → two
  consultation bills for one visit (same for a lab order, an admission's final bill, a workshop job bill).
- **Fix:** restore hook on `invoices` in `trust/recycle-bin.ts` (`sv.visit` / `sv.lab_order` / `sv.admission` /
  `sv.job` → the source row's `invoice_id`).

---

## 3. The coordinator's e2e question: a just-written record missing from a dropdown

Reviewed `storage.ts` (write-through cache, batched IndexedDB flush, BroadcastChannel refresh `onRemoteChange`) and the
e2e harness (`idbPut` writes IndexedDB directly and broadcasts, as "another tab").

- **Without a vault there is no lost-update race inside one tab.** A remote refresh never overwrites a key this tab has
  pending; its read transaction is ordered before or after this tab's write transaction by IndexedDB, and its result is
  applied in the same microtask checkpoint as the read completes, before this tab's flush can complete.
- **With vault mode on there was one (P2; fixed after QA round 13 — see below):** the remote value is decrypted asynchronously
  (`crypto.subtle`), so this tab's own write of the same key can be flushed (and leave `pending`) while the decrypt
  runs; the older remote value then replaces this tab's newer one **in the cache** (IndexedDB keeps the newer value,
  so a reload shows it). The fix — remember a per-key local write sequence and skip remote values read before it — sits
  in `storage.ts` (first paint, ≈ 30 B gzip), which is over this round's +0.02 kB budget; listed for the next shell pass.
  The e2e harness does not use a vault, so this is not the e2e symptom.
  **Fixed (QA13 follow-up):** `storage.ts` records `dataVersion` at each local write of a key (`wrote`) and the version
  up to which writes are inside a flush transaction (`sent`, set in the write callback); a remote refresh skips a key
  this tab wrote after the version `sent` held when the remote read began (or still has pending), so a value read before
  this tab's write reached IndexedDB never replaces it. +28 B gz in `storage`. Test: `tests/vault.test.ts` "QA12: a remote
  value still being decrypted …" (fails without the fix).
- **The desks' lists are memoised on a local `tick`** (`ClinicDesk`, `MembersDesk`, `WorkshopDesk`): a record written by
  another tab (or by the harness through IndexedDB) while the desk is mounted is not in its dropdowns until the desk
  re-renders with a new tick or the page reloads. That is the app's documented cross-tab behaviour ("Updated in another
  tab — Refresh", `CrossTabNotice`), not a data race; the harness's own writes are followed by `page.goto`, so they are
  re-read. The SV-B e2e steps already wait for the record in IndexedDB before navigating.

## 4. Checks and budget

`tsc -b` clean; `eslint .` 0 errors (27 warnings, as before); `node --test` 3,124 / 3,124; `vite build` + `postbuild`
ok; bundle check ok; Playwright smoke (`E2E_TIMEOUT=60000`) all checks passed (472 PASS lines). `npm run …` exits 216 in
this sandbox, so each command was run directly. The ten regressions fail on `402be84` and pass after the fixes. Budget (vite build, gzip -9, against `402be84`):
first paint 189,144 B → 189,147 B (**+3 B**: `PARTY_KEYS` replaced the old eight-key strip in `localDb.ts`); total JS
3,077,346 B → 3,078,416 B (+1.0 kB). Every other fix sits in lazy service chunks or `trust/recycle-bin.ts`; no new icon.

## 5. CA questions added

SV60 (wallet top-up rate; Rule 50 18% when the later rate is not determinable), SV61 (exempt plans in Table 8), SV62
(receipt-basis commission on wallet-paid bills and redemptions) — `docs/CA_REVIEW.md` §10.9.
