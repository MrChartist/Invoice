# Service billing & party speed (Round 3, R3-B)

Spec: `docs/prd/round-3.md` → R3-B1 … R3-B7. Everything new is lazy: the shell only gained the
`'annexure'` string in `RECORD_KEYS`, the `ensureProjectAlerts` bell gate and one `alt+r` row in the
shortcuts list.

## What is built

### B1 Rate cards (`src/lib/rate-cards.ts`)
- **Resolution order:** task rate → project (cost centre) `hourly_rate` → client `doc_defaults.hourly_rate`
  → work type rate → `default_rate`. `resolveRate(ctx)` / `resolveEntryRate(entry, data)`; an inactive work type
  is skipped. The entry still **captures** the resolved rate (`TimeEntry.hourly_rate`), so card edits never
  reprice logged time.
- **Work types** (Time → Settings, `WorkTypesCard.tsx`): name, rate, optional SAC. The SAC overrides `prefs.sac`
  on the bill line (`sacFor`); `timeLines` now also groups by work type. A work type used by entries is made
  inactive instead of deleted.
- The timer and the time form show the rate source next to the rate ("from client", "typed" …) and the rate can
  be overwritten. The shell timer pill (`timer.ts`) is untouched; the extra timer fields (`task_id`,
  `work_type_id`, `cost_centre_id`) come by declaration merging.
- **Re-rate unbilled** (Unbilled → Bill → "Re-rate unbilled"): preview of the changes (from / to / source), then
  `commitReRate` writes only the previewed unbilled entries (entries in a locked period are skipped). Billed
  entries are never passed in.

### B2 Projects (`src/lib/projects.ts`, `ProjectsBoard.tsx`, `ProjectHeader.tsx`, `project-alerts.ts`)
- A cost centre of kind `project` gets optional `budget_minutes`, `fee_budget`, `start`, `due`, `status`,
  `hourly_rate` (`normalizeCostCentres` / `saveCostCentre` keep them; forms that do not know them, such as
  Books → cost centres, keep the stored values).
- Tasks (`project_tasks`): title, column, estimate, assignee (local user), rate, due, sort. Columns are per
  company (`project_settings.columns`, renamable / addable; default To do / Doing / Done). **Invoiced** is a
  derived column: a task shows there while it has billable time and all of it is billed by a live invoice
  (cancelling the invoice moves it back).
- `/time?tab=projects&project=<id>`: Board (drag between columns, Alt+← / Alt+→ on a focused card) and List;
  each card shows tracked vs estimate with a bar. Header: hours tracked / budget, billed / unbilled ₹, fee budget
  used, straight-line forecast to the due date, 80% / 100% warnings.
- Bell: `ensureProjectAlerts` (NotificationBell) loads `project-alerts.ts` only once `project_tasks` has rows;
  notices `project-hours:<id>:80|100` and `project-fee:<id>:80|100`.
- Timer / time form take a task; picking it sets the project (cost centre) and the rate.
- **Bill project** opens the Unbilled flow filtered to the project (`unbilledFor(key, live, { projectId })`).
- Export tasks with hours (CSV / XLSX via the dynamic `xlsx.ts`).
- `deleteCostCentre` refuses a project that still has tasks (`CostCentreUsage.tasks`); a task with logged time
  cannot be deleted.

### B3 Retainers (`src/lib/retainers.ts`, `RetainersTab.tsx`, `RetainerReport.tsx`)
- Per client: hours per period (month, or Indian-FY quarter Apr–Jun / Jul–Sep / Oct–Dec / Jan–Mar), fee, start,
  rollover cap, overage rate, optional recurring template for the fee invoice, optional project limit.
- Billable time draws the period down in date order (then creation time). Covered minutes are left out of the
  Unbilled flow (`unbilledTime(entries, live, cover, prefs)`); an entry straddling the end of the block comes
  back as an in-memory copy holding only its overage minutes; overage entries take the overage rate on the
  bill only (the stored entry keeps its captured rate).
- Fee invoice: the close row's / hand-linked `fee_invoices[period]`, else the linked recurring template's
  invoice dated in the period. A **cancelled** fee invoice uncovers the period; no fee invoice yet = covered
  ("pending").
- Period close (banner on the first open after the period end, or on demand): records used / rolled /
  forfeited minutes and stamps the covered entries with `retainer_id` / `retainer_period`. Periods close in
  order; refused in a locked period; `withTablesRollback` over `retainers` + `time_entries`; audited.
- Statement-style report per client, printed through the voucher-print path (`printHtmlDocument`).

### B4 Timesheet annexure (`src/lib/annexure.ts`, `templates/parts/AnnexureBlock.tsx`, `creator/AnnexureActions.tsx`)
- `BillClientModal` → "Attach timesheet annexure" (ticked by default when the client's `doc_defaults.annexure`
  is set). `billUnbilled(key, sel, prefs, { annexure: true })` stores `InvoiceRecord.annexure` = snapshot of the
  billed rows (date, who = task assignee, project, task, description, minutes, billed minutes, rate, amount,
  `ref`) and re-billed costs (vendor, amount as on the line, markup %, pure agent).
- Templates print it as a following page ("Annexure to INV/FY26-27/0012"), lazily (`LazyAnnexure` inside
  `Suspense` in `TemplateEngine`), never on receipt / thermal paper. `break-before: page` for printing; a
  measured spacer pushes it to the next page boundary for the sliced PDF.
- Editor (Document actions): Download annexure (CSV / Excel), "Refresh annexure from billed rows", and a
  tie-out warning when the lines no longer match (never on paper). Editing lines never rebuilds it.
- `normalizeRecord` (store defaults) carries `annexure` unchanged, so load → edit → save keeps it.

### B5 Party document defaults (`src/lib/party-defaults.ts`, `clients/DocDefaultsFields.tsx`)
- Client form → Document defaults: template, currency, line discount %, notes, terms, hourly rate, attach
  annexure, Bilingual print language.
- Picking the party from the directory on a **new** document applies them once (`PartyHabitsStrip`, lazy):
  template (Hindi print language → the Bilingual (Hindi) template when no template is set), currency with the
  8H currency master's rate on the document date, notes / terms only while empty or still the profile default,
  and the discount on lines added afterwards. Chip "Defaults from <party> applied · Undo".
- An existing document never re-applies; recurring, batch (R2-B1) and converted documents copy their source
  document's values (they never go through the party pick), so no re-apply there either.
- Client CSV export / import carries the optional columns `default_template`, `default_currency`,
  `default_discount_percent`, `default_notes`, `default_terms`, `hourly_rate`, `attach_annexure`, `print_lang`.

### B6 Repeat last bill & usual items (`src/lib/party-habits.ts`, `PartyHabitsStrip.tsx`, `UsualTiles.tsx`)
- After a party pick on a new sales document: **Repeat last bill** (Alt+R) — lines of the party's latest issued
  document of the same type, quantities kept, today's catalogue rate (× unit factor for an alternate unit),
  then the editor's pricing path (levels / slabs / price lists) and schemes recomputed. Billing refs, batch /
  serial / bin picks, scheme free lines, order / stage links and price bases are stripped; numbers, dates,
  payments, IRN / EWB and attachments are document fields and never copied.
- Up to 8 **usual items** chips (frequency × recency over 180 days); a chip adds the item with its last quantity
  through the same pricing path.
- The strip hides on desktop once a line is named; on phones it stays, collapsible. Cached per party for the
  session.
- POS: a "Usual" tile row for a saved customer (dynamic import), through the counter's own add path.

### B7 Customers gone quiet (`src/lib/quiet-customers.ts`, `clients/QuietCustomers.tsx`)
- Quiet = ≥ 3 issued sales invoices in 12 months and days since the last > max(threshold, 1.5 × median gap);
  threshold 30 days by default. Walk-in bills, `reminder_mode: 'never'` (R2-A5), snoozed and "Not a regular"
  parties are left out. A typed-name invoice joins its client master by name.
- Dashboard insights card `quietCustomers` (links to `/clients?quiet=1`), Clients chip **Gone quiet · n** with
  the report (last bill, usual gap, days quiet, 12-month sales, top items, CSV), WhatsApp nudge in the party's
  message language listing the usual items, snooze 30 / 60 / 90 days, "Not a regular", threshold field.

## Storage (all `mrchartist_inv_*`, backed up and synced)

| Key | Kind | Notes |
|---|---|---|
| `work_types` | rows | `{ id, name, rate, sac?, inactive? }` — `master.edit` |
| `project_tasks` | rows | `{ id, cost_centre_id, title, column, estimate_minutes, assignee_id?, rate?, due?, sort, created_at, updated_at? }` — `books.edit` |
| `project_settings` | object | `{ columns: string[] }` |
| `retainers` | rows (DATED by `start`) | `{ id, client_key, client_name?, hours_per_period, period, fee, start, rollover_cap, overage_rate?, recurring_id?, cost_centre_ids?, fee_invoices?, closes[], inactive? }` — `books.edit` |
| `quiet_settings` | object | `{ threshold_days, snoozed: { [party_key]: until }, excluded: [] }` |

Additive fields: `InvoiceRecord.annexure`; `Client.doc_defaults`; `TimeEntry.work_type_id`, `task_id`,
`retainer_id`, `retainer_period`; `CostCentre.hourly_rate`, `budget_minutes`, `fee_budget`, `start`, `due`,
`status`; `reminders` rows with `kind: 'nudge'` + `nudge_party_key`.

Registries: `RECORD_TABLES` / `ID_TABLES` (backup), `WATCHED_TABLES` (audit edits), `TABLE_ACTIONS` (access),
`DATED` (sync: `retainers` by `start`), `RECORD_KEYS` (`'annexure'`), CommandPalette (`service-r3-destinations.ts`),
NotificationBell (`ensureProjectAlerts`).

## GST / statutory points — verify with your CA

1. **Retainer time of supply (B3).** The fee invoice is an ordinary tax invoice on its own issue date. Whether
   time of supply for a monthly / quarterly retainer is the invoice date, or the earlier of invoice / payment,
   as a continuous supply of services (Sec 13, Sec 31(5) CGST Act), is a statutory point. The app shows this as
   help text on the Retainers tab and in the report, worded "verify with your CA".
2. **Forfeited hours (B3).** Treated as no change to the fee invoice (no credit note is suggested). Whether a
   forfeited unused block is plain income with no GST change — verify with your CA.
3. **Overage in the next period (B3).** Overage bills through the normal Unbilled flow as its own invoice
   (a separate supply on that invoice's date) — verify with your CA.
4. **Pure-agent expenses on the annexure (B4).** Flagged as "pure agent (Rule 33), outside the taxable value",
   same as the existing expense line note.

## Deviations from the spec

- **Project client:** the existing `CostCentre.client_id` is used instead of a new `client_key` (projects pick a
  client from the directory, which always has an id).
- **Board columns:** the stored columns are the user's (default To do / Doing / Done, renamable / addable);
  **Invoiced** is a fixed derived column (not renamable), since it is never set by hand.
- **Retainer `bill_refs` on the fee invoice:** never written. The saved fee invoice is not edited (Critical
  Rule 3); coverage stays derived from the retainer row and, after a close, from the entries' stamps.
- **Partly covered entry:** billed as an in-memory copy with only its overage minutes; with an "up" billing step
  the overage portion is rounded again on the bill (at most one step).
- **Print language:** 'hi' picks the Bilingual (Hindi) template when no template default is set; the bilingual
  label order itself is unchanged (the paper labels are not owned by R3-B).
- **Party pick:** defaults / habits trigger on a typeahead pick in the party field; the "Find client" search
  dialog (InvoiceCreator) does not trigger them yet.
- **Nudge log:** the `reminders` row carries `kind: 'nudge'` and `nudge_party_key` but **no** `party_key`, so the
  khata payment-reminder history ("last reminded") is not affected by re-order nudges.
- **`invoice-defaults.ts`:** one additive line in `normalizeRecord` keeps `annexure` (needed so the editor does
  not drop it on save); `tests/invoice-store.test.ts` sample gained the field.
- `src/pages/Pos.tsx`: two lines (the lazy declaration + the `<UsualTiles>` line).

## Rows for the lead to add

**docs/ROADMAP.md (Round 3):**
- R3-B1 Rate cards (task → project → client → work type → default) + re-rate unbilled — done.
- R3-B2 Projects: hours / fee budget, tasks, board / list, estimate vs actual, 80/100% bell — done.
- R3-B3 Prepaid retainer hours: drawdown, rollover / forfeit, overage, report — done (verify with your CA).
- R3-B4 Timesheet & expense annexure snapshot, printed as a following page — done.
- R3-B5 Party document defaults — done.
- R3-B6 Repeat last bill (Alt+R) and usual items (editor + POS) — done.
- R3-B7 Customers gone quiet: insight, Clients chip, report, WhatsApp nudge — done.

**docs/ARCHITECTURE.md → Tables:**
- `work_types` | rate cards (R3-B1, `src/lib/rate-cards.ts`) | `WorkType {id, name, rate, sac?, inactive?}`; `master.edit`
- `project_tasks` | projects (R3-B2, `src/lib/projects.ts`) | `ProjectTask`; board columns in the object key `project_settings`; Invoiced derived from billed time
- `retainers` | retainers (R3-B3, `src/lib/retainers.ts`) | `Retainer` with `closes[]`; coverage derived; covered entries stamped `retainer_id` / `retainer_period` on close
- `quiet_settings` (object) | quiet customers (R3-B7, `src/lib/quiet-customers.ts`) | threshold, snoozed, excluded
- `cost_centres` row: add "additive project fields `hourly_rate` / `budget_minutes` / `fee_budget` / `start` / `due` / `status` (R3-B)".
- `invoices` row: add "additive `annexure` timesheet snapshot (R3-B4)".

**AGENTS.md → Storage keys:** "R3-B company data: `work_types`, `project_tasks`, `project_settings`, `retainers`,
`quiet_settings`; additive `Client.doc_defaults`, `InvoiceRecord.annexure`, `TimeEntry.work_type_id / task_id /
retainer_id / retainer_period`."

## Shell wiring

None needed: everything lives in the existing lazy `/time` and `/clients` routes, the editor chunk, the POS page
and the lazy dashboard insights tile.

## Tests

`tests/rate-cards.test.ts`, `tests/projects.test.ts`, `tests/retainers.test.ts`, `tests/annexure.test.ts`,
`tests/party-defaults.test.ts`, `tests/party-habits.test.ts`, `tests/quiet-customers.test.ts`; e2e step
"R3-B: project … → bill the project with the timesheet annexure → print" in `tests/e2e/smoke.mjs`.
