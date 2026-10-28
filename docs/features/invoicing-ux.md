# Invoicing UX & insights (roadmap 8G, rows 8.100 – 8.111)

Zoho Books / FreshBooks / Xero / TallyPrime 7 habits, rebuilt for an offline, single-device app: no portal, no server,
no background jobs. Everything below runs in the browser from the open company's tables; GST outputs stay working
papers — **verify with your CA**.

| Area | Files |
|---|---|
| Payment schedules & deposits (8.100) | `src/lib/payment-schedule.ts` (readers: due date, open instalments), `src/lib/schedule-tools.ts` (presets, checks), `src/lib/doc-snapshots.ts` (validation in `normalizeRecord`), `src/components/invoicing-ux/PaymentScheduleCard.tsx`, `creator/AdvanceNotice.tsx` (partial apply), `templates/parts/AcceptanceBlock.tsx` (print) |
| Quote acceptance (8.101) | `src/lib/quote-acceptance.ts`, `AcceptQuoteDialog.tsx`, `client-copy.ts` (`respond` links), `AcceptanceBlock.tsx` |
| Margin chip (8.102) | `src/lib/margin.ts`, `MarginChip.tsx` (lazy, in the summary) |
| SmartFind (8.103) | `src/lib/smart-find.ts`, `src/lib/search.ts` (`buildIndex`, `searchIndex`, `searchPeek`), `src/lib/company-peek.ts`, `command/CommandPalette.tsx` |
| Last rate (8.104) | `src/lib/last-rate.ts`, `creator/pricing-actions.ts`, `LastRateHints.tsx` |
| Today card, send sheet (8.105) | `src/lib/today.ts`, `TodayPanel.tsx`, `src/lib/send-summary.ts`, `SendSheet.tsx` |
| Bulk remind / write-off (8.106) | `src/lib/write-off.ts`, `BulkCollectDialog.tsx`, `ReceivablesBulk.tsx`, Transactions bulk bar |
| MTD / QTD / YTD (8.107) | `periodForPreset` in `src/lib/books.ts`, `period-context.ts`, `books/PeriodBar.tsx` |
| Insights (8.108) | `src/lib/insights.ts`, `InsightsPanel.tsx` (dashboard tile) |
| Saved views & packs (8.109) | `src/lib/report-views.ts`, `src/lib/report-pack.ts`, `src/lib/report-pack-alerts.ts`, `ReportViewsBar.tsx` (Reports and Books) |
| Editor flow (8.110) | `src/lib/counter-receipt.ts`, `PayModeChips.tsx`, `src/lib/save-choice.ts`, `MetaSummary.tsx`, `editor-actions.ts`, `creator/PartiesSection.tsx`, `creator/DocumentActions.tsx` |
| Strings | `src/i18n/areas/invoicing-ux.ts` (`uxT`), `src/i18n/areas/smart-find.ts` (`sfT`, palette only); "save" = सेव करें |
| Tests | `tests/invoicing-ux.test.ts`, `tests/invoice-store.test.ts` (persisted fields); e2e: post-save sheet step and "8G: 390 px editor layout …" in `tests/e2e/smoke.mjs` |

## Storage

No new tables. Two additive document fields and one additive payment field — all in `RECORD_KEYS`, validated by
`normalizeRecord`, absent on legacy rows, so old documents never change (Critical Rule 3):

- `payment_schedule?: PaymentInstalment[]` — `{ id, label?, due_date (local day), percent? | amount? }`, at most 24,
  sorted by date.
- `acceptance?: QuoteAcceptance` — `{ signer, signed_at (ISO), method: 'counter' | 'remote', amount, signature? (PNG
  data URL ≤ 350 kB), note? }`.
- `Payment.write_off?: true` — a bad-debt write-off row.

Device-local viewing preferences (localStorage, **outside** the `mrchartist_inv_` prefix, so never backed up, synced or
restored — like `mrchartist_report_prefs`): `mrchartist_report_views` (saved views) and `mrchartist_report_pack` (pack
schedule). `mrchartist_inv_save_choice` (split Save) is listed in `DEVICE_LOCAL_KEYS`. **Decision:** views are
per-device choices about how to look at the data, not company data; a shared company table would make one person's
layout overwrite another's after a sync, and the figures are always recomputed anyway.

## 8.100 Deposits & payment schedules

- The editor's **Payment schedule** card (quotation, proforma, sales order, invoice, tax invoice, bill of supply):
  ready-made splits (50/50, 30/70, three parts), add rows, each row % or ₹ with its own due date. Warnings when the
  percentages exceed 100% or the instalments exceed / do not cover the total. Paid / still due per instalment.
- **One reader each**: received money (receivable total − balance) settles instalments in due-date order.
  `effectiveDueDate` = earliest unpaid instalment (else `due_date`) — used by reminders (`pendingReminders`,
  `suggestStage`) and ageing (`buildReceivables` bills). The cash forecast spreads the open balance over the unpaid
  instalments (`scheduledParts`). The credit-note status agent's receivables due helper was not present when this
  merged; if one lands, call `effectiveDueDate` from it so the due maths stays in one place.
- **Request deposit** (first instalment): "Record deposit received" saves an **advance receipt voucher** through
  `saveAdvance` (Rule 50 path: GST worked out on the advance, ADV series, period lock, audit) — supply = services when
  any line is a service, rate = highest line rate, place of supply from the document. Or "Raise proforma for deposit"
  (quote / order): a new proforma draft for the client with one "Deposit against …" line, untaxed.
- On the final invoice the existing advances banner ("Advances available ₹X") now takes an **amount**, so part of an
  advance can be applied (oldest first).
- Printed: a "Payment schedule" block from the document's own schedule (accent variable only).

## 8.101 Quote acceptance offline

- **Remote**: the client copy (static HTML, CSP `default-src 'none'`) of a quotation shows "Accept" and "Request
  changes" buttons — pre-filled `https://wa.me/<business phone>?text=…` (else `mailto:<business e-mail>`), quoting the
  number and amount. Only those two link shapes are ever written; no script. The business then records it with
  **Sign & accept → By message**.
- **Counter**: Document actions → **Sign & accept** → signature on a canvas (pointer events: mouse, pen, finger), signer
  name. `setQuoteAcceptance` writes the snapshot once (a second call is refused), sets `quote_status` Accepted, respects
  the period lock and is audited ("… accepted by Ravi (signed at the counter)").
- **Immutable**: `localDb.invoices.save` keeps the stored `acceptance` on every later save — an edit can neither change
  nor remove it. Duplicating a quotation drops it.
- Printed: an "Accepted" block (signer, time, amount, signature image).

## 8.102 Margin chip

Costs are built once per editor visit (`buildUnitCosts`: latest purchase line per base unit incl. landed cost → latest
standard cost → opening rate); the margin follows the lines through `useDeferredValue` (`documentMargin` is O(lines)).
Shown only for rupee sales documents with at least one costed line, only for users who may edit documents (viewers never
see it), outside the paper and `no-print`. Revenue is pre-tax and before the bill discount — an indicator, not a P&L.

## 8.103 SmartFind

- Groups: invoices, clients, catalogue, **purchase bills, suppliers, payments & advances, vouchers, cheques**, pages,
  actions, and **other companies (read-only)**.
- `parseQuery` splits the query: amount filter (`12.5k`, `₹12,500`, `1.2L`, `2cr`, `>50k`, `<=1000`, `10k-20k`) — bare
  digits stay text (so `0007` is still an invoice sequence and `12500` matches raw amounts); identifiers (GSTIN, PAN,
  IRN, UTR / bank reference) must match a record's ids; the rest is fuzzy text, now with a **typo fallback**
  (Damerau edit distance 1 for 4–6 letters, 2 for longer, ranked below real matches).
- The index (`buildIndex`) is cached by the stored text of its tables and the day (`searchIndex`), so typing never
  re-parses storage; the palette warms it on open. The palette chunk stays lazy; its strings are in the small `sfT` area.
- **All companies**: a checkbox (only with 2+ companies) peeks the other companies' databases read-only
  (`company-peek.ts`: opened without a version — never upgraded or created; vault-sealed values skipped). Hits open
  nothing; the palette says which company to switch to.

## 8.104 Last rate to this party

On a catalogue pick, a price level / selling price list / slab (6.9 / 7S) wins; otherwise the rate last billed to the
same party (issued sale, same currency, same unit) is applied with basis "Last rate"; a quantity change keeps it. The
hint under the lines shows "last billed at ₹X on date (INV/…)" with **Use last rate** or **Use catalogue rate**.

## 8.105 Today card and the post-save sheet

- Dashboard tile **Today** (on by default for new layouts): sales (bills), cash / UPI / bank collected (advance
  adjustments and write-offs excluded), udhaar given (unpaid part of today's sales), expenses (expense bills dated today),
  cash in hand (cash book). **Share to my WhatsApp** opens the owner's own chat with the summary.
- **Post-save success sheet** (A1) replaces the 10-second toast after an issued save (drafts keep the toast; Save & new
  keeps its toast): ✓ number, client, total, balance; **WhatsApp** (summary + balance + party outstanding + next
  instalment + UPI pay link; a phone field when the client has none), **Share PDF** and **Print** (the preview opens and
  runs them), **Record payment** (balance due), **New**, plus e-mail and the usual Share menu. Stays until dismissed /
  Esc; a bottom sheet under 640 px.

## 8.106 Bulk actions

- Transactions (selected rows of the filtered list) and Receivables → **Bulk actions** (filter by ageing bucket, tick
  bills): **Remind** — one WhatsApp per tap (browsers open one chat per gesture), each logged in `reminders` so the queue
  and cooldowns know; **Write off** — explicit confirmation + reason, date; each eligible bill's open balance becomes a
  `write_off` payment ("Written off", no receipt number) through the payments API (period lock, approvals, status), plus
  one summary audit row.
- Accounting: cash book / BRS skip it (`buildVouchers`), the payment-modes report skips it, the simple P&L books it as
  an indirect expense "Bad debts written off" (accrual; nothing on cash basis), the double-entry ledger posts Dr Other
  expenses / Cr Sundry debtors. GST already paid is not reversed (no GST relief on bad debts) — verify with your CA.
  Note: the Reports cross-check "purchases vs P&L expenses" shows the write-off as a difference.

## 8.107 MTD / QTD / YTD

`periodForPreset('mtd' | 'qtd' | 'ytd')`: start of the month / Indian-FY quarter / Indian FY to today (local day).
First in the period bar (Books, Reports) and accepted by the shared period context.

## 8.108 Insights

`buildInsights(input, today)` — pure and deterministic; this month to date vs the average of the three full months before:
revenue (projected to month end), top customers (share; concentration > 50% warns), expense heads ≥ 1.5× their average
and ≥ ₹1,000 more, DSO today vs 30 days ago (outstanding on the day ÷ last 90 days' sales × 90), customers paying ≥ 7
days slower (amount-weighted days from invoice to payment: last 90 days vs the 9 months before), gross margin vs average
(≥ 3 points down warns; needs costs), stock at risk (tracked items at / below reorder level or under 7 days of cover at
the last 30 days' rate), GST payable estimate (output tax − input tax on bills). Each card links to its report. Shown in
the dashboard tile **Insights**.

## 8.109 Saved views and month-end packs

- **Saved views** bar on Reports and Books: name the current tab + period preset (custom dates kept) + every report's
  F12 options (`getAllReportPrefs` / `setAllReportPrefs`); a view opens via its chip or `?view=<id>`. Same name on the
  same screen replaces.
- **Month-end pack**: one ZIP (`zip.ts`) for a month — `PnL_<month>.csv`, `BalanceSheet_<end>.csv` (ledger statements
  with `loadStockValuer`, so Books and the pack agree), `Ageing_<end>.csv`, GSTR-1 section CSVs, `GSTR3B_<month>.csv`, a
  printable GST summary page and a README.
- **"Scheduled", offline**: pick a day (1 – 10). On the first open on / after that day the bell offers last month's pack
  (`report-pack-alerts.ts`, loaded only once a schedule exists); with "Also save it in my backup folder" and a connected
  backup folder whose permission is already granted (File System Access), the pack is written there automatically and
  the bell says so. Downloading last month's pack marks it done.

## 8.110 Editor flow (competitor tutorials)

- **A2 Record payment** in Document actions for unpaid invoices / tax invoices / bills of supply (the payment dialog,
  lazily); hidden without `payment.record`.
- **A3 Payment mode on "Amount received"**: Cash / UPI / Bank chips (+ UTR for UPI / bank) and **Fully paid** (total −
  TDS, follows the total while lines change). On save the part of Amount received not yet in the ledger becomes a real
  receipt with that method (`splitCounterReceipt`: the invoice is saved with the ledger's amount, then
  `payments.record` adds the rest — never counted twice). Without a mode the old behaviour stays.
- **A4 Split Save**: Save / Save & print / Save & WhatsApp; the choice is remembered on this device. **Alt+P** prints,
  **Alt+D** duplicates the open document into a new unsaved one (no snapshots copied).
- **A5 Customer & items first**: document details (type, number, dates, currency, transport, cost centre …) move below
  the items as one line — "Tax invoice · INV/… · 25 Oct 2026 · due in 15 d · Edit" — opening by themselves on errors, a
  number clash or a non-rupee currency. Bill-to shows name, GSTIN and phone; address, company, e-mail and ship-to sit
  behind **More details**.
- **A6 Cash sale (walk-in)**: fills the POS walk-in name, clears the address and sets Fully paid + Cash.

## Bundle

All screens are lazy chunks (sheet, schedule card, margin chip, pay-mode chips, insights, Today, views bar, bulk
dialogs, acceptance dialog, company peek, pack builder). First paint grew by about 0.4 kB gz (the schedule-aware due date
used by the dashboard's reminders and the new chunk names in the preload map).
