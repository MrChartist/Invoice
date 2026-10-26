# Round 7 · R7-A — Hotel front office (and the contract for R7-B / R7-C)

Spec: `docs/prd/round-7.md` §4 R7-A1…A6, §5, §6, §7 (defaults D1–D20). Everything statutory here is a **working paper**
— bands, rates and the Form C clock are readings of the law as understood; verify with your CA (`docs/CA_REVIEW.md` §7,
HT1–HT17).

The `hotel` industry pack (business type `hotel`, or `industry_packs: ['hotel']`) adds the **front desk** on the existing
`/tables` route: `/tables?tab=frontdesk&view=…`. No new route, no new lucide icon. With the pack off `/tables` is the
restaurant floor exactly as before; the URL still opens the front desk (with a "pack is off" note) and Ctrl+K lists every
view under "Industry packs". For a hotel company the sidebar row reads **Front desk** (`nav.frontDesk`).

## What R7-A ships

| Item | Where |
|---|---|
| A1 pack, type, shell, rule file, store, registries | `industry-packs.ts` (`'hotel'`, `PACK_TABS` block `// R7: hotel`), `shop-mode.ts` (union, `PACK_ROUTES['/tables']`), `shop-presets.ts`, `src/types/hotel-r7.ts`, `src/lib/hotel/{hotel-rules,hotel-store,business-date}.ts`, `src/pages/Tables.tsx` (tab switch + floor link), `src/components/hotel/FrontDesk.tsx` |
| A2 room types, rooms, rate plans, pricing | `lib/hotel/{rooms,rate-plans,pricing}.ts`; Setup view |
| A3 reservations, room calendar, advances | `lib/hotel/{reservations,availability}.ts`; Calendar / Reservations views, booking dialog |
| A4 check-in, walk-in, guest register | `lib/hotel/{checkin,guests}.ts`; check-in dialog, Guests view |
| A5 housekeeping | `lib/hotel/housekeeping.ts`; **cut-first applied**: status controls live on the board tiles (`view=housekeeping` shows the board with status selects and out-of-order) |
| A6 night audit | `lib/hotel/{night-audit,room-post}.ts`; Night audit view |

### Behaviour notes

- **Business date** (`hotel_settings.business_date`) moves only through the night audit (`setBusinessDate`). Until the
  first audit it reads as the device's today. A night is named by its start day.
- **Pricing** (`priceNight`): 1- / 2-adult rate; adults above min(2, base occupancy) are extra adults; each child and
  extra bed is charged; weekend nights (default Fri, Sat) take the plan's own weekend rate, else `weekend_pct`; then the
  **last** matching season applies (`override` sets the room rate and beats the weekend, `amount` adds to the room rate,
  `pct` scales every charge). Tax-inclusive plans are reverse-solved per night through `bandForInclusive` (a gross that
  fits no band — e.g. ₹7,875.01–₹8,850 from 22 Sep 2025 — takes the higher band and is flagged `gap`). `meal` is the
  meal share **inside** `total` (information, D5).
- **Snapshots**: a booking stores `RoomLine.nightly`; editing a plan never reprices it; changing dates / occupancy
  prices only new nights; `saveReservation(…, { reprice: true })` recomputes every night.
- **Availability**: the departure day is free; inactive and out-of-order rooms (`Room.ooo`, both days inclusive) are
  excluded; a type-level booking (no room) is allowed up to the type's free count per night with a "last room" warning;
  assigning a room may not starve an unassigned booking.
- **Numbering**: `RES/FY…` by the booking date (`booked_on`) through `series-counters` (never reused).
- **Period lock**: creating / editing a booking whose arrival is locked is refused; status changes (check-in / out) are
  not. The night audit refuses to post into a locked date and stops there (`AuditRun.stopped.locked`).
- **Advance**: `takeAdvance(resId, …)` saves an ordinary advance receipt voucher (`advances.ts`) from the bill-to (else
  the guest), place of supply = the property's state (F6), GST rate = `advanceRate(res)` (band of the booked nights; a
  mixed stay takes the higher rate — D6 keeps it), and links it in `advance_ids`.
- **Check-in**: refuses an out-of-order, occupied or other-type room; a room that is not vacant clean / inspected throws
  `NeedsConfirm` (UI asks, then `force: true`). Folios open (window 1 guest; window 2 company when billed to a client).
  A foreign guest starts the Form C clock (`form_c.due_at` = check-in + `FORM_C_HOURS_RULES` hours); missing Form C
  fields do not block (`formCIncomplete`).
- **Guests / privacy (D9)**: Aadhaar stored masked by default (`XXXX XXXX 1234`); lists use `shownId`; the edit log hides
  `id_doc`, `foreign` and `dob` (`audit-edits.ts` HIDDEN); a vault-mode banner shows while vault is off.
- **Housekeeping**: check-out → dirty; night audit → occupied rooms dirty (setting `hk_dirty_on_audit`, default on);
  status changes need `doc.create` and are written "as the app" (`hotelDb.patchRooms`), so a clerk can do them while the
  room master needs `master.edit`.
- **Night audit**: pre-checks (due-outs and un-guaranteed arrivals block; guaranteed ones are late arrivals; Form C is a
  warning) → idempotent room post → housekeeping → `hotel_night_audits` row `na:<night>` → roll. Catch-up runs night by
  night up to yesterday after one confirmation. Statistics (D14): available = active − OOO; occupied counts
  complimentary / house use; ADR = room revenue ÷ paid occupied; RevPAR = room revenue ÷ available. Payments by mode use
  `movedNoCash`. On 31 March with guests in house the result carries `yearEnd: true` (interim invoices are R7-B3).
- **Folios** are running accounts, never tax documents (no GST, no tax-series number).

## API for R7-B and R7-C

Types — `src/types/hotel-r7.ts` (append your own `// R7-B` / `// R7-C` blocks at the end):
`RoomType`, `Room`, `RatePlan` (+ `CancelPolicy` for B6), `NightPrice`, `RoomLine` (+ `form_c: FormCTrack`),
`Reservation` (`ota`, `bill_to`, `routing`, `cancellation`, `advance_ids` already declared), `Guest` / `ForeignDetails`,
`Folio` / `FolioLine` / `FolioLineKind`, `NightAudit` / `AuditStats`, `HotelSettings` / `PremisesDecl`, `StaySnapshot`;
`InvoiceRecord.folio_id / reservation_id / stay / hotel_band` (in `RECORD_KEYS` and `normalizeRecord` already).

Store — `src/lib/hotel/hotel-store.ts`:
- `HT` table names, `HOTEL_TABLES`, `HOTEL_SETTINGS_KEY`, `RES_PREFIX`, `DEFAULT_HOTEL_SETTINGS`;
- `hotelDb.{roomTypes, rooms, ratePlans, reservations, reservation(id), folios, guests, audits, settings}()`;
- writes: `saveRoomTypes / saveRooms / saveRatePlans` (`master.edit`), `patchRooms` (housekeeping, `doc.create`),
  `putReservations / putFolios / putGuests / putAudit` (replace by id, `doc.create`), `saveSettings`
  (`settings.manage`), `setBusinessDate` (night audit only).
- Registry rows for all seven tables (backup, edit log / recycle bin, roles, sync DATED + NUMBERED `RES`, open export)
  are in place (rights and edit-log rows at runtime through `hotel-registry.ts`; a new hotel writer imports
  `hotel-store.ts` or `./hotel-registry`); B and C do not edit `backup.ts`, `audit-edits.ts`, `access.ts` or `sync-engine.ts`.

Rules — `src/lib/hotel/hotel-rules.ts`: `ACCOMMODATION_RATE_RULES`, `HOTEL_RESTAURANT_RATE_RULES`,
`SPECIFIED_PREMISES_RULES`, `FORM_C_HOURS_RULES` (rows exactly as PRD §4 C1; C appends), `ruleAt`,
`accommodationBand(value, date) → { rate, itc, exempt, band: 'low' | 'high' }` (inclusive at ₹7,500, D1),
`bandForInclusive(gross, date) → { …band, value, gap? }`, `formCRule(date)`. C1's `hotel-gst.ts` should re-export these
rather than re-implement them.

Engines:
- `pricing.ts`: `priceNight`, `priceStay`, `stayTotal`, `isWeekend`, `seasonOn`, `minStayError`.
- `availability.ts`: `isLiveLine`, `isLiveRes`, `lineDates`, `oooOn`, `freeRooms`, `typeFreeCount`, `checkLines`.
- `reservations.ts`: `HotelError`, `saveReservation(input, { reprice })`, `priceLine`, `closeReservation(id,
  'cancelled' | 'no_show', reason)` (B6 adds the charge / invoice on top), `takeAdvance`, `advanceRate`,
  `reservationValue`, `arrivalsOn / departuresOn / inHouseOn`, `searchReservations`, `nextResNumber`.
- `checkin.ts`: `checkIn`, `walkIn`, `NeedsConfirm`, `markCheckedOut(resId, lineId)` — **B3's check-out calls this
  after the invoice is saved** (line out, room dirty, booking closed when no line is in).
- `guests.ts`: `cleanGuest`, `saveGuest`, `maskAadhaar`, `shownId`, `isIndian`, `formCMissing`, `FORM_C_FIELDS` (the
  portal order C2's data sheet uses), `matchGuest`, `guestRegister` (C3's police register).
- `room-post.ts` (the folio contract B1 builds on): `ROOM_KINDS`, `windowFor(res, kind)` (routing rules, else company
  kinds → window 2 with a bill-to), `newFolio`, `folioOf`, `openFolios`, `folioName`, `folioTotal`, `folioBalance`
  (lines − `applied`), `stayKey`, `isPosted`, `nightLines`, `postNight`. B1 may replace `windowFor`'s defaults through
  `Reservation.routing`; keep the `stay:<line>:<night>[:part]` keys so the audit stays idempotent.
- `housekeeping.ts`: `HK_STATUSES`, `setHk`, `setOoo`, `occupiedRooms`, `readyForCheckIn`, `byFloor`, `who`.
- `night-audit.ts`: `preCheck`, `blocking`, `statsOf`, `nightStats`, `runNight(night)`, `runAudit({ today })` →
  `AuditRun { nights, done[{ audit, yearEnd }], stopped? }`. C3's occupancy report reads `hotel_night_audits` rows
  (`stats`, `revenue_by_kind`, `payments_by_mode`, `guest_ledger`, `advances_held`).
- `business-date.ts`: `nextDay`, `nightsBetween`, `auditNights(businessDate, today)`, `isYearEnd`.

UI — `src/components/hotel/FrontDesk.tsx`: views `board | calendar | reservations | folios | housekeeping | audit |
guests | formc | reports | setup`. `folios`, `formc` and `reports` render "comes with the next update" until R7-B / R7-C
add their lazy component to the `EXTRA_VIEWS` map in that file (one line each, e.g.
`folios: lazy(() => import('./FolioView'))`, wrapped in `<Suspense>`); each view receives `{ ctx }` (type `Ctx`, exported) with `tick, day,
refresh, notify, open, go, run`. The booking / check-in dialogs open through `ctx.open({ res })`, `ctx.open({ ci, line })`,
`ctx.open({ walk: true })`.

Strings — `src/i18n/areas/hotel-frontdesk-r7.ts` (`hT`, en + hi). Palette labels for the `PACK_TABS` rows are inline in
`src/components/marketplace/palette-destinations.ts` (`hT` there), so the palette does not load the area.

Help — minimal topics for `tables:frontdesk` and every view are in `src/lib/help/topics-packs.ts` (block `// R7 hotel`);
R7-C owns them and adds the HT ids (note: `tests/help-registry.test.ts` only accepts CA ids matching `G|T|P|AC|I|X`, so
HT ids need that regex widened first).

## Tests

`tests/hotel-pack.test.ts` (switch, `/tables` visibility, registry coverage incl. roles / sync lock / numbering, record
keys, first-paint isolation), `hotel-pricing.test.ts` (every rule row at its boundaries incl. ₹7,500 / ₹7,500.01,
reverse solve and the gap, weekend / season precedence, extras, min stay, snapshot vs re-price),
`hotel-reservations.test.ts` (departure day free, OOO, type count, RES/FY across 31 Mar, cancel, band-correct advance,
lock and roles), `hotel-checkin.test.ts` (walk-in, rollback, company window, Form C clock, Aadhaar masking and edit-log
privacy, returning guests, refused rooms, dirty → confirm, check-out → dirty, clerk housekeeping),
`hotel-night-audit.test.ts` (idempotent post and re-run, catch-up, pre-checks and no-show hand-off, statistics, payments
by mode via `movedNoCash`, locked period, 31 March, roles, routing / meals / complimentary). Helpers:
`tests/helpers/hotel.ts`.

## Bundle (gzip, measured against base `a5941f5` with `npm run build`)

| | Before | After R7-A | Δ |
|---|---|---|---|
| Initial JS (first paint) | 188,838 B (184.41 kB) | 188,964 B (184.53 kB) | +126 B |
| Total JS | 2,640,600 B | 2,665,367 B | +24,767 B (≈ 24.2 kB) |

First paint: the `shop-mode.ts` route / type rows, the sidebar label ternary, `nav.frontDesk` (en), the hidden guest-ID
fields in the edit log and the mangled-export shifts they cause. The hotel rights and edit-log rows are registered at
runtime by `src/lib/hotel/hotel-registry.ts` (the Round 8 `tr-registry.ts` pattern), imported by `hotel-store.ts`, the
sync engine and the recycle bin, so `access.ts` / `audit-edits.ts` carry no hotel rows.

R7-A is **over its 13 kB total-JS share**: the front-desk chunk (all views, the engines and the en + hi strings in one
lazy chunk) is ≈ 21.7 kB gz, plus ≈ 2.4 kB of registry / help / palette rows in existing chunks. Cut-first A5 was
applied (housekeeping lives on the board) and the views were merged into one module (per-chunk overhead), which took the
package from ≈ 40 kB to ≈ 24 kB. The total-JS budget (2,700 kB) still has ample headroom; the lead decides whether the
round's split should move or further cuts are wanted (next candidates: the guest register into C3, the plan editor's
seasons / weekend rates, shorter Hindi strings).

---

# R7-B — Folio and billing

Spec: `docs/prd/round-7.md` §4 R7-B1…B6 (defaults D1–D20). The view is `/tables?tab=frontdesk&view=folios` with three
sub-tabs: **Folios**, **Cancellations**, **OTA payouts**. Every GST / TDS figure is a working paper — verify with your CA.

| Item | Where |
|---|---|
| B1 folio windows, routing, split, transfer, void | `lib/hotel/{folio,routing}.ts`; Folios tab (`FolioView.tsx`) |
| B2 charge to room (Tables, POS) | `lib/hotel/charge-to-room.ts`, `orders-store.ts` `settleToFolio`; `RoomPicker.tsx` in the Tables settle dialog and the POS tenders (pack-gated) |
| B3 check-out and interim invoices | `lib/hotel/{checkout,checkout-save}.ts`; "Check out" / "Interim invoice" on a folio |
| B4 company / agent bill-to, TDS default, commission | `lib/hotel/{bill-to,agent-commission}.ts`; bill-to box on a folio |
| B5 OTA tagging and payouts | `lib/hotel/{ota,ota-payout}.ts`; OTA payouts tab |
| B6 cancellation / no-show charges | `lib/hotel/cancellation.ts`; Cancellations tab |

Types: `// R7-B` block of `src/types/hotel-r7.ts` — `TableOrder.folio_id`, `Client.hotel { tds_default, commission_pct,
rate_plan_id }`, `FolioLine.tax_rate / band_value`, `Reservation.bill_kind / commission`. Strings: `src/i18n/areas/hotel-billing-r7.ts`
(`bT`; common words reuse the front-desk `hT`). No new table, key, series or icon.

## Behaviour

- **Routing (B1)**: `windowFor` reads `Reservation.routing`; `setBillTo` stores the default (room, extra bed / person, meal
  plan → window 2 when a company / agent pays) or the user's rules (windows 1–4, one rule per kind) and moves open
  window-2 folios to the new payer. Charges post through `postCharge` (stay → routed window, created when missing; or a
  house folio, D10 `openHouseFolio`). An allowance is stored negative; one linked to a night (`src.night` / `line_id`)
  lowers that night's value for the band.
- **Split / transfer**: `splitLine` (by quantity or amount) moves the part to another window of the stay;
  `transferLines` moves lines to another window, another in-house folio (room-to-room) or a company / house folio.
  Totals are kept; `moved_from` = the source folio name; a split night keeps its `stay:` key prefix (`:s…`) so the night
  audit stays idempotent. Invoiced lines (`src.invoice_id`) never move.
- **Void**: reason required; a posted room night only as "rate correction" or "complimentary"; a clerk above
  `clerk_void_cap` (lines or ₹ per day, by the same user) gets `VoidPinRequired` → owner PIN (`checkPinWithGuard`) →
  retry. Voided lines stay on the folio (struck through, who / when / why) and leave every total.
- **Charge to room (B2)**: one `fnb` line per order for its pre-GST total (`previewBill(order).taxable_value`, service
  charge included) with the KOT numbers and key `order:<id>`; `settleToFolio` marks the order settled with `folio_id`
  in one rollback (day close no longer blocked); no invoice. A second charge of the same order is a no-op.
  `undoRoomCharge` (lib) removes the line and reopens the order (logged) until invoiced. POS: one `fnb` (HSN empty /
  9963…) or `misc` line for the bill's taxable value — no POS bill, no Z-report cash. `RoomPicker` loads through the
  FrontDesk chunk (`FrontDesk.tsx` re-exports it) so all hotel code stays in one chunk.
- **Check-out invoice (B3)**: `draftFor(folio, day)` → `buildCheckoutInvoice`: payer client (master-only fields
  dropped) or the guest (B2C, home state; company + GSTIN typed at the desk makes it B2B); place of supply = the sender
  profile's state (D18: the booking's `property_id` profile), CGST + SGST always; night value = room-type lines of the
  room line × night (+ linked allowances; cancellation lines use `band_value`) → `accommodationBand(value, invoice
  date)` (D6), grouped per kind × room × description × rate × GST, SAC 996311; F&B at `fnbRate(day, isSpecified(...))`
  (minimal C1 reading: typed `prev_fy_max_value` or the previous FY's highest posted unit-night > ₹7,500, else the latest
  opt-in / opt-out declaration — **R7-C's `premisesStatus` should replace `isSpecified`**), SAC 996331; other kinds at
  their `tax_rate`. Annexure (`kind: 'timesheet'`, one row per night line), `stay`, `folio_id`, `reservation_id`,
  `hotel_band` snapshotted; the rate-change chip counts nights under an older rule row. Unregistered / composition →
  Bill of Supply; unregistered OTA stay → `PAY_9_5`, tax 0, the 9(5) note.
- **Save**: `saveCheckout({ windows, interim?, checkout? })` — `localDb.invoices.save` (status Sent, FY series),
  `applyAdvance` per ticked advance (payment with `advance_id`), the balance with `localDb.payments.record`, billed lines
  stamped `src.invoice_id` — all windows or none (`withTablesRollback`). A final check-out marks the stay's windows
  `invoiced` and calls `markCheckedOut`. Interim (D7): `interimDates` (every `interim_days` from arrival and 31 March)
  drives the "interim invoice due" chip; an interim invoice bills lines dated up to the business date and leaves the
  folio open. Company / agent windows default to credit (due = client's `credit_days` or the default).
- **TDS (B4, D11)**: `Client.hotel.tds_default` `none` (default) / `194I-B` / `194C` (stored as `194C-2`); rate from
  `tdsSections(day)`, label from `ita2025.ts` (`tdsLabel`). Agent commission due = `commission_pct` × booked room value.
- **OTA (B5)**: `otaTags` — valid operator GSTIN → `eco_gstin` + `TCS_52` (registered sender, D8) or `PAY_9_5`;
  OTA-collect also carries 194-O (`tds_section: '194O'`, rate from the existing rows) so the TDS register expects it.
  Payout: per invoice a receipt for its net share (bank) and one for the withheld commission + GST + TCS into the
  "RA deductions clearing" account tagged `ra_journal_id` (`movedNoCash` skips it), one journal Dr "GST TCS receivable" +
  Dr Sundry creditors (the OTA) | Cr clearing, and the OTA's commission bill as a purchase draft (SAC 998552, ITC per
  D12, no 194H). Σ net shares ≠ payout → refused with the gap. The R5-A5 credit view sees the TCS through the invoices'
  `TCS_52` tags (`expectedTcs`).
- **Cancellation (B6)**: `cancelCharge` from the plan policy (free window to check-in time, first night / pct / full,
  no-show rule); each part keeps the replaced night's value (`band_value`, D13). `chargeCancellation` builds the invoice
  through B3 (company-guaranteed with no advance → the company on credit), applies the booking's advances, refunds the
  rest with `refundAdvance` (RFV) when a method is given, and stores `Reservation.cancellation`. Waiving or editing the
  amount needs a reason; a waiver makes no invoice.

## Deviations (R7-B)

- **Bundle**: the folios view is a **static** import of `FrontDesk.tsx` (`EXTRA_VIEWS.folios = FolioView`), not a lazy
  chunk — the lazy chunk cost ≈ 2.8 kB gz of split overhead; the front desk itself stays a lazy chunk. `FrontDesk.tsx`
  also exports its form kit (`Fields`, `Row`, `Tbl`, `Spec`) and re-exports `RoomPicker`.
- **Cut-first applied**: B5 reduced — no `eco_credits` row is written on a payout (TCS goes to "GST TCS receivable";
  the R5-A5 view's books-expected column still shows it). B4's commission bill is a **note** with the amount on the
  folio (the tested `recordCommission` lib — a purchase-bill draft with 194H — is not wired to a button).
- `isSpecified` is a stand-in for C1's `premisesStatus` (see above). Rate-change nights are only flagged (D6).
- Check-out from the Reservations list / audit (R7-A buttons) still only flips status; billing happens on the folio.

## Tests (R7-B)

`hotel-folio` (routing, split / transfer totals, void cap → PIN, voided lines out of the balance, open → invoiced),
`hotel-charge-to-room` (one pre-GST line, settled, no invoice, idempotent, undo, F&B 5% / 18%, POS no Z cash),
`hotel-checkout` (₹7,500.00 / 7,500.01, extra bed, CP + discount, mixed, out-of-state company and foreign guest intra,
22 Sep 2025 chip and 21 Sep 12%, advance with `advance_id`, interim then final, interim dates, all-or-none on lock /
refusal, Bill of Supply), `hotel-bill-to` (routing default, 194I-B 10%, agent draft 194H + ITC flag, ITA 2025 label),
`hotel-ota` (TCS_52 / PAY_9_5, 194-O 0.1%, 3-booking payout nets to zero, clearing rows no-cash, commission draft),
`hotel-cancellation` (free window, first night / pct / full, ₹8,000 → 18%, ₹3,000 → 5%, ₹7,500 boundary on a pct
charge, advance + RFV refund, waiver). `purchase-contract` covers the commission bills.

## Bundle (R7-B, gzip, against `cedc33e` with `npm run build`)

| | Before | After R7-B | Δ |
|---|---|---|---|
| Initial JS (first paint) | 188,997 B | 189,002 B | +5 B |
| Total JS | 2,712,194 B | 2,726,244 B | +14,050 B (≈ 13.7 kB) |

FrontDesk chunk +13.4 kB (folios view, libs, `bT` en + hi, RoomPicker), Pos +0.3 kB, Tables / orders-store +0.1 kB each.
**Over the 12 kB share by ≈ 1.7 kB** after both cut-first items; the 2,800 kB budget has ample headroom.

---

# Round 7 · R7-C — Hotel compliance and reports

Spec: `docs/prd/round-7.md` §4 R7-C1…C3, §6, §7 (D1, D4, D6, D12, D14, D15, D17, D18). Every output is a working paper —
verify with your CA (`docs/CA_REVIEW.md` §7, HT1–HT17, and the "R7-C build notes" under the §7 table).

## What R7-C ships

| Item | Where |
|---|---|
| C1 GST → Hotel (`/gst-reports?tab=hotel-gst`, Tools group, `PACK_GST_TABS['hotel-gst'] = ['hotel']`) | `lib/hotel/{hotel-gst,premises,band-report}.ts`, `components/hotel/HotelGstTab.tsx` |
| C1 common-credit input (D12) | `exemptLike` → `components/institutions/CommonCreditView.tsx` adds it to E with the pack on; `PACK_GST_TABS['common-credit']` and the `PACK_TABS` common-credit row gain `'hotel'` (and `shop-mode.ts` `PACK_ROUTES['/gst-reports']`) |
| C2 Form C desk (`view=formc`) and the bell | `lib/hotel/{form-c,hotel-alerts}.ts`, `components/hotel/FormCView.tsx`; Board tiles show a `Form C nh` chip; `NotificationBell.tsx` one `gate('hotel', …)` line |
| C3 reports (`view=reports`) | `lib/hotel/hotel-reports.ts`, `components/hotel/ReportsView.tsx` |
| Strings | `src/i18n/areas/hotel-compliance-r7.ts` (`cT`, en + hi); shared words from `hotel-frontdesk-r7.ts` |
| Help / Ctrl+K | HT ids on every hotel topic (`topics-packs.ts`); `gst-reports:hotel-gst` in `topics-statutory.ts` (the GST area's file — the registry test requires it there); title in `discover-r6-tabs.ts`, synonyms (`specified premises`, `7500`, `hotel gst`, `996311`); `tests/help-registry.test.ts` accepts `HT` ids |
| e2e | `tests/e2e/smoke.mjs` "R7 hotel stay" (after R5-B): walk-in of a foreign guest → Form C chip → night audit posts ₹3,000 → Form C data sheet + Mark filed → GST → Hotel "specified" after typing ₹7,600 for the previous FY, F&B 18%. Check-out is left for R7-B (not on this base) |

### Behaviour notes

- **Bands** (`hotel-gst.ts`): re-exports `accommodationBand` / `bandForInclusive` / the rule tables from `hotel-rules.ts`
  (not re-implemented; `hotel-rules.ts` unchanged). Room lines = SAC 996311 (or `sac_room`), F&B = 99633x (or
  `sac_fnb`); unit-day value = taxable ÷ quantity, rate on the invoice date. Composition / Bill-of-Supply documents are
  left out (D17, the tab says "composition — bands not applied"); credit notes count negative; financial notes skipped.
- **Specified premises** (`premises.ts`): `prevFyMax` (stays' night snapshots, meals priced separately and comp rooms
  left out, per `property_id`; or the typed `prev_fy_max_value['2025-26']`), `premisesStatus(fy, ctx)` →
  `{specified, basis, prev, decl, optOutIgnored, rule}`; `declWindow` / `declError` (Jan–Mar of the year the FY starts;
  Annexure VIII within 15 days of `arn_on`, the one `// R7-C` type addition); `addDecl` refuses outside the window.
  Settings writes keep an un-audited business date unset. The desk shows this and the next FY for the main premises.
- **Guards**: wrong band (an extra-bed line may ride at its room's higher rate), F&B vs `restaurantRate`, IGST hotel
  invoice, ITC claimed on bills while every room-night of the FY is no-ITC (reads `purchases` via `readPurchase`;
  added to `tests/purchase-contract.test.ts`). The 22 Sep 2025 note shows for FY 2025-26. The PRD's "lazy check in the
  existing GST exceptions" was not added (the guards live on the tab only).
- **Band report**: per month low / high nights and value, F&B, no-ITC turnover (5% rooms + 5% F&B — exempt-like),
  turnover with ITC; GSTR-1 HSN / SAC 9963 rows by SAC × rate.
- **Form C**: due = check-in instant + `FORM_C_HOURS_RULES` hours (24, across midnight); statuses `overdue | due |
  departed_not_updated | filed | done`; data sheet = personal, `FORM_C_FIELDS` in order, stay; copy per field and
  "Copy all"; `markFiled(res, line, ref)` / `markCheckoutUpdated` (`doc.create` via `hotelDb.putReservations`).
- **Bell** (`registerHotelAlerts`, provider re-checks the pack): Form C ≤ 6 h (warning) / overdue (critical),
  arrivals not in by check-in + 4 h, due-outs past check-out time, night audit not run for a past business date (only
  once an audit has stored a business date), the declaration window 1 Jan – 31 Mar (id per year, dismiss once). The
  interim-invoice notice is left to R7-B3's interim builder.
- **Reports** (cut-first applied): occupancy / ADR / RevPAR by day (audit rows, else `nightStats` from stays) with a
  CSS-width bar, by month, by room type, source mix (OTA by name), night-audit history (guest ledger and advances held
  per night), and a link to the printable police / guest register (Guests view). CSV and Excel each. Dropped: revenue
  by kind, separate guest / advance / city ledgers, OTA summary (needs R7-B5).

### One chunk for the pack

`FormCView` and `ReportsView` are static in `FrontDesk.tsx`'s `EXTRA_VIEWS`; `FrontDesk.tsx` also re-exports
`HotelGstTab`, `registerHotelAlerts` and `exemptLike`. GST → Hotel, GST → Common credit and the bell load them through
`components/hotel/hotel-lazy.ts` (`hotelChunk()`, the `r5c-lazy` pattern). Separate lazy chunks made rolldown split
A's modules (store, rules, reservations, night audit) into small shared chunks and cost ≈ 21 kB instead of ≈ 11.5 kB.
`FrontDesk.tsx` now exports `Fields`, `Row`, `Tbl`, `Rec`, `Spec` for the R7-C views.

## Tests

`tests/hotel-gst.test.ts` (every rule row at 999.99 / 1000 / 1000.01 / 2500 / 7500 / 7500.01, rate-change days
2019-10-01 / 2022-07-18 / 2025-09-22, inclusive round trip + gap, premises status incl. ₹7,500.00 vs ₹7,500.01, opt-in
window, opt-out vs clause (a), Annexure VIII 15 days, per premises, pre-2025, stays / typed source, band report and
`exemptLike`, HSN 9963, guards, pack gate of the tab), `tests/hotel-form-c.test.ts` (24 h across midnight and month end,
statuses, rows / Indian guest, data-sheet order, filing, check-out tick, bell rows and thresholds, declaration window
only Jan–Mar, pack off: no hotel read and the bell's gate checks the pack before importing), `tests/hotel-reports.test.ts`
(D14 formulas, audit vs stays days, month and room-type roll-ups, source mix = room revenue, no writes). Pins updated:
`gst-filing` (tab list), `r5c-pack-gate` (common-credit packs), `help-registry` (HT ids).

## Bundle (gzip, `npm run build`, against base `cedc33e`)

| | Base | After R7-C | Δ |
|---|---|---|---|
| Initial JS (first paint) | 188,997 B | 189,002 B | +5 B (budget +50 B) |
| Total JS | 2,712,194 B | 2,723,682 B | +11,488 B (≈ 11.2 kB; share 8 kB) |

First paint: `'hotel'` in the common-credit `alsoPacks` and `PACK_ROUTES['/gst-reports']`. The bell gate line sits in
the lazy NotificationBell chunk. Of the total, ≈ 9.5 kB is the pack chunk (R7-C code + en / hi strings ≈ 2.4 kB), ≈ 0.9 kB
the `hotel-lazy` preload list, ≈ 0.3 kB each GST page / common credit, ≈ 0.3 kB help topics and palette rows.

**Over the 8 kB share by ≈ 3.2 kB** after cut-first (C3 reduced, interim notice left to B3, Form C field labels shown as
the portal's names like A's check-in form, help text trimmed). Next cuts if wanted: the HSN 9963 table (≈ 0.2 kB), the
arrivals / due-outs / audit bell rows (≈ 0.4 kB), the Excel buttons, the room-type report, shorter Hindi strings.
