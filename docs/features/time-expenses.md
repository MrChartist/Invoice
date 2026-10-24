# Time tracking, billable expenses & mileage (roadmap 6.13 / 6.14)

> Cost centres (6.16): time entries and trips carry an optional `cost_centre_id` (a picker appears once a cost centre exists); billing copies it, or a `project` label matching an active cost centre's name, onto the invoice line. See `cost-centres-budgets.md`.

For freelancers and consultants who bill by the hour: track time (running timer or manual entries), log client
trips, mark expenses / purchase bills as re-billable, then turn everything unbilled for a client into a **new draft
invoice** in one step. Fully local, no new dependencies.

- Route: `/time` (page `Time`, lazy in `src/App.tsx`); nav item **Time** under *Sales* (lucide `Timer`).
  Tabs via `?tab=`: `timesheet` (default), `mileage`, `billing` ("Unbilled"), `settings`.
- Header pill: `src/components/time/TimerPill.tsx`, shown only while a timer runs. The shell imports only
  `src/lib/timer.ts` + `src/hooks/useTimer.ts` (no timesheet / invoice code), so the initial bundle barely moves.

## Data

| key | shape |
|---|---|
| `mrchartist_inv_time_entries` | `TimeEntry[]` — client id + name snapshot, optional project, description, date (local `YYYY-MM-DD`), raw `minutes`, `hourly_rate`, `billable`, `invoiced_in?` |
| `mrchartist_inv_mileage` | `MileageEntry[]` — client, date, from / to / purpose, `km`, `rate_per_km` (captured at logging), `invoiced_in?` |
| `mrchartist_inv_time_prefs` | `TimePrefs` — `round_increment` (0/6/10/15/30), `round_mode` (`none`/`nearest`/`up`), `default_rate`, `sac` (default `998311`), `gst_rate` (default 18), `mileage_rate` (default ₹10/km) |
| `mrchartist_inv_timer` | `TimerState` — the one running/paused timer |
| `purchases` (additive) | `billable_to_client_id?`, `markup_percent?`, `pure_agent?`, `rebilled_in?` on `PurchaseRecord` |

`time_entries` and `mileage` are in backup validation (`RECORD_TABLES` + `ID_TABLES`, `src/lib/backup.ts`). The timer
and prefs keys are ordinary `mrchartist_inv_*` keys, so backups carry them too.

## Timer (`src/lib/timer.ts`)

Only the moment the current run started (`started_at`, ms) and the time banked by earlier runs (`accumulated_ms`) are
stored, so the clock survives reloads and tab closes: elapsed = accumulated + (now − started_at). Pause banks the run,
resume restarts it, stop logs `round(elapsed / 1 min)` minutes on the day the timer was started (under a minute logs
nothing). One key = one timer at a time. Changes broadcast a `mrc-timer-change` window event; other tabs follow via
the `storage` event.

## Billing (`src/lib/timesheets.ts`)

**Derived billing state.** A row is billed only while the invoice id in `invoiced_in` / `rebilled_in` still exists and
is not cancelled (`liveInvoiceIds`, `isBilled`). Deleting or cancelling the invoice frees every row on it — no clean-up
code. Editing lines on the invoice does not unlink rows.

`billUnbilled(clientKey, selection)` builds lines, creates a fresh draft from the active sender profile (`makeDraft`),
sets the client from the CRM, picks place of supply and CGST+SGST / IGST, recomputes totals (`calculateInvoice`),
saves it as a numbered **Draft** (`localDb.invoices.save`, period lock applies to the new date) and stamps the rows.
The page then opens `/invoice/:id` for review.

Lines:
- **Time** — grouped by project + description + rate; each entry rounded to the billing step first, then shown as
  hours to 2 dp, unit `HRS`, SAC from prefs, GST at `gst_rate`. Non-billable entries never bill.
- **Re-billed expense** — cost × (1 + markup %), where cost is the taxable value when ITC was claimed, else the full
  amount paid. Part of the taxable supply at `gst_rate` with the SAC of the main service.
- **Pure agent** (Rule 33, CGST Rules) — the actual amount paid, no markup, GST 0%, with an explanatory description
  ("excluded from the taxable value. Verify with your CA."). Whether the Rule 33 conditions hold is the user's call.
- **Mileage** — one line per rate, quantity = total km (unit `KM`), taxed like the main supply.

`purchasesDb.setRebilled(ids, invoiceId)` changes only the link field and so is allowed inside a locked period (like a
payment roll-up); any edit of the cost itself still goes through `purchasesDb.save`, which enforces the period lock.

## UI

- `TimerCard` (client / project / description → Start; Pause / Resume / Stop & log / Discard).
- Timesheet tab: week navigator (Monday start), client × project grid with day / row totals, list of the week's
  entries with edit / delete and Billed / Unbilled / Non-billable badges (billed links to the invoice); CSV and .xlsx
  export of all entries (`toCsv`; `downloadXlsx` loaded on demand).
- Mileage tab: trips list, totals, CSV / .xlsx export.
- Unbilled tab: per-client time / expenses / mileage, **Bill** → `BillClientModal` (choose what to include, preview
  lines, create the draft).
- Settings tab: rounding, default hourly rate, mileage rate, SAC, GST rate.
- Expense and bill modals: compact "Bill this cost to a client" block (`BillableFields`: client, markup %, pure-agent
  checkbox, CA note).

## Tests

`tests/timesheets.test.ts` (timer persistence / pause maths, rounding, duration parsing, weekly grid and totals, line
building, markup, pure agent, mileage totals, end-to-end bill → marks rows → delete / cancel frees them, IGST for an
inter-state client, re-bill link inside a locked period, CSV rows, backup validation) and
`tests/purchase-contract.test.ts` (report readers ignore the new purchase fields; timesheets reads them).

## Not done

- Rows billed onto an invoice stay linked even if their lines are edited out of it.
- Pure-agent costs still appear as an expense in Books / P&L (and the reimbursement as income).
- No per-client or per-project default rates (one default rate + per-entry override).
