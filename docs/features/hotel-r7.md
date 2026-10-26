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
