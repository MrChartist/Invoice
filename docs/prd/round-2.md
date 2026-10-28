# PRD — Round 2: what the established suites still do better

Status: draft for build · Drafted 2026-10-25 · Baseline: branch `claude/elegant-cannon-cwapiv` at `f84d57e`
(Phases 0–8 built: 8A–8F and 8I merged; 7Q follow-ups in a worktree; 8G / 8H queued).
Raw sources (URLs and the claim taken from each):
`/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/research/round2-sources.md`.

Every item respects `AGENTS.md`: local-first and serverless (no network, no gateways, no bank feeds), vanilla CSS
Modules with tokens, invoice snapshots never change, Indian-FY numbering, bare dates parsed as local days, statutory
values date-keyed, GST / statutory outputs labelled as working papers ("verify with your CA").

---

## 1. Problem statement

Round 1 closed the gap with the Indian daily apps (Vyapar, myBillBook, Khatabook, OkCredit, Swipe, GimBooks) and
Phases 6–8 reached Tally parity. Users who move to us from the established suites (Zoho Books / Invoice, QuickBooks
Online, Xero, FreshBooks, Wave, Refrens, BUSY, Marg, TallyPrime, Odoo) still miss a set of habits those products have
trained them in. They fall into three groups:

1. **Getting the last rupee in.** Suites treat collection as a process, not a message: payment terms with instalments
   and early-payment discounts (Odoo, Refrens), short-payment / settlement discount on a receipt (BUSY, Marg, Tally
   practice: "kasar / vatav"), bad-debt write-off in bulk (Zoho, Apr 2026), configurable reminder schedules and an
   "expected payment date" that pauses reminders (Zoho, Odoo follow-up levels, Xero's planned "commit to a payment
   date"), and statements in the three QuickBooks styles with an ageing table. Today our reminders have fixed stages
   (`src/lib/reminders.ts:82` — 3 / 0 / 7 / 30 days hard-coded), a receipt has no discount or write-off path
   (`Payment` in `src/types/invoice.ts:363` has no such field; `CREDIT_REASONS` in `src/lib/documents.ts:69` only
   knows GST notes), and the statement is a single ledger-style layout (`src/components/receivables/StatementDocument.tsx`).
2. **Selling bigger jobs.** Project and B2B sellers rely on progress / milestone invoicing from an estimate
   (QuickBooks, Xero), batch invoicing of one template to many customers (QuickBooks), quote revisions and optional
   lines (Xero tracks "revised"; Odoo / FreshBooks proposals), contact persons and several addresses per customer
   (Zoho added custom fields on contact persons in Sep 2026), and turning a sales order into a purchase order
   (QuickBooks, May 2026; Xero backorders, Jul 2026). We convert sales orders partially by quantity only
   (`src/lib/documents.ts` `TRANSITIONS`), recurring is one client per schedule (`src/lib/recurring.ts` `client: Client`),
   quotes have a lifecycle but no versions (`src/lib/quote-status.ts`), and a client has one address and one contact
   (`Client`, `src/types/invoice.ts:218–269`).
3. **Year-end and output polish.** Odoo 19 ships an Annual Statements composite report and Zoho a text block in
   financial reports; we have every statement but no notes to accounts or single annual pack. Zoho's July 2026
   packages (dimensions, net / gross weight) and Xero's column renaming / logo-derived colours have no counterpart;
   TallyPrime 7.0 added IMS ITC-reduction entry for credit notes, which our IMS worksheet lacks
   (`Gstr2bAction`, `src/lib/gstr2b.ts:671` has only `action` + `note`). Zoho's May 2026 accessibility preferences
   have no equivalent in our UI.

**Goal of Round 2:** ship 18 features in three parallel work packages (R2-A collections & settlement, R2-B sales
documents, R2-C books / compliance / output) with mostly disjoint files, so three agents can build at once.

**Non-goals:** anything needing a server or the network — payment gateways, card-on-file, auto-charge, terminal
payments, bank feeds, invoice view tracking, SMS / e-mail delivery from the app, GSTN / IRP pulls or pushes, cloud
backup, AI assistants (JAX, Zia, Intuit Intelligence, Freya) and AI OCR. Local substitutes are named where they exist.

---

## 2. Per-competitor findings

Status column: **B** = built (cited), **P** = partial, **M** = missing, **Q** = queued in 8G / 8H (not re-proposed),
**X** = dropped (needs network / server). Proposed items carry their Round 2 id.

| Competitor | Feature / UX pattern users love | Our status (evidence) | Round 2 |
|---|---|---|---|
| **Zoho Books / Invoice** | Automated reminders N days before / after due, editable, stop per invoice | P — fixed stages, snooze only (`src/lib/reminders.ts:16–96, 314`) | R2-A5 |
| | Expected payment date suppresses reminders until then | M — no promise / expected date anywhere in `src/` | R2-A4 |
| | Bulk invoice write-off (India, Apr 2026) | M — no write-off / bad-debt code or ledger head (`src/lib/ledger/accounts.ts`) | R2-A3 |
| | Retainer invoices (down payment applied later) | B — advances ADV / RFV, Table 11 (`src/lib/advances.ts`, `docs/features/advances.md`) | — |
| | Client portal: view, pay, accept quote, download statement | P — static client-copy HTML for invoices and statements with UPI pay (`src/lib/client-copy.ts`, `client-copy-dom.ts`, `docs/features/khata.md` 8.3); quote accept queued 8G | Q |
| | Custom fields on contact persons (Sep 2026); contact persons per customer | M — one email / phone on `Client` | R2-B4 |
| | Package types with dimensions, net / gross weight (Jul 2026) | M — no packing / weight fields | R2-C4 |
| | Profit margin while editing quotes / invoices (Apr 2026) | Q — 8G live margin chip | Q |
| | Text block in financial reports; Insights | M (notes) / Q (insights, 8G) | R2-C1 |
| | MTD / QTD / YTD filters (Jul 2026) | Q — 8G presets | Q |
| | Accessibility preferences (text spacing, underline links, shortcut list) (May 2026) | M — only template density (`src/lib/design-prefs.ts:63`); shortcut list exists (`ShortcutsOverlay.tsx`) | R2-C6 |
| | TDS summary on invoice PDF (Sep 2026) | B — "Less: TDS (section)" (`src/components/templates/parts/FooterBlocks.tsx:249`) | — |
| | Vendor filing insights from 2B (Sep 2026) | B — `supprd` / `supfildt` parsed (`src/lib/gstr2b.ts:27, 229`) | — |
| | CMP-08 (Jul 2026); self-billed notes | B — `src/lib/composition-returns.ts`; RCM self-invoice `src/lib/rcm-self-invoice.ts` | — |
| | Workflow rules, validation rules, custom schedulers | M — only approvals (`src/lib/approval-gate.ts`) | long tail |
| | Reporting tags | P — cost centres per document (`src/lib/cost-centres.ts`) | long tail |
| | Record deposit from undeposited funds | B — deposit slip (`src/lib/deposit-slip.ts`) | — |
| | Terminal payments, gateway auto-charge, WhatsApp API sending, e-invoice pull from GSTN | X | — |
| **QuickBooks Online** | Progress invoicing (% or amount of an estimate, invoice remaining balance, summary report) | M — SO partial by quantity only (`src/lib/sales-orders.ts`) | R2-B2 |
| | Batch invoicing (many invoices from one entry) | M — recurring is one client (`src/lib/recurring.ts:45`) | R2-B1 |
| | Statements: balance-forward / open-item / transaction + ageing table | P — ledger style only, no ageing strip (`StatementDocument.tsx`); batch exists (`BulkStatements.tsx`) | R2-A6 |
| | Convert sales order → purchase order (May 2026) | M — no SO link in `src/lib/purchase-orders.ts` | R2-B5 |
| | Delayed charges / delayed credits | P — billable time / expenses only (`src/lib/timesheets.ts`) | long tail |
| | Bundles | B — kits (`src/lib/variants.ts`, `events-kits.ts`) | — |
| | 100+ keyboard shortcuts | B — F-keys, Gateway, palette (`src/hooks/useHotkeys.ts`, `useTallyKeys.ts`) | — |
| | Contact details on invoice | B — `PartyPanel.tsx:70`, `GstBody.tsx:132` | — |
| | Custom automations with schedules (Aug 2026) | M | long tail |
| | Payment links, viewed notifications, AI invoice drafts | X (UPI deep link built: `src/lib/share.ts`) | — |
| **Xero** | Progress payments; deposits before work | M / Q (deposits 8G) | R2-B2 |
| | Online quote accept / decline, tracks "revised" | P — lifecycle stored (`quote-status.ts`); no revisions; accept is 8G | R2-B3 |
| | Logo upload pulls brand colours; rename columns; fonts | P — accent / font pickers (`DesignPanel.tsx`), no column rename, no logo colour | R2-C5 |
| | "Pay" on online statements to settle several invoices | B — statement web page + UPI for balance (8.3) | — |
| | Multi-invoice payments | B — FIFO allocation in ₹ Received (`docs/features/khata.md` 8.2) | — |
| | Customer commits to a future payment date (planned) | M | R2-A4 |
| | Scheduled send, SMS delivery | X (local "send on" prompt in long tail) | — |
| | Backorders for tracked inventory (Jul 2026) | P — SO outstanding report (`docs/features/inventory.md`, 7.63); no back-to-back PO | R2-B5 |
| | Branding themes for invoices / quotes / statements | B — 26 templates + Design Studio per profile | — |
| **FreshBooks** | Proposals with scope sections, images, e-signature | P — quotes only; signature capture queued 8G | R2-B3 |
| | Deposits on estimates; retainers with hours budget | Q (deposits) / P (recurring + timesheets) | long tail |
| | Late fees, up to 3 reminders after due | B — late-fee line (`src/lib/late-fee.ts`); reminders P | R2-A5 |
| | Time & expense billing, mileage | B — `src/lib/timesheets.ts`, `docs/features/time-expenses.md` | — |
| | Checkout links, card-on-file, BNPL | X | — |
| **Wave** | Per-customer payment and communication history | P — reminder log per invoice (`reminders` table), khata ledger; no follow-up notes | R2-A4 |
| | Deposits via estimates; estimate → invoice | Q / B | — |
| | Reminders before and after due | P | R2-A5 |
| **Refrens** | EarlyPay discount (amount / % with expiry, printed) | M — no early discount (only a forecast phrase in `src/lib/cash-forecast.ts:217`) | R2-A1, R2-A2 |
| | Average payment time, client creditworthiness | P — DSO company-wide (`src/lib/receivables.ts:609`), lag per party only inside the forecast (`src/lib/cash-forecast.ts:119`) | R2-A7 |
| | Partial / full conversion between documents | P — SO partial by qty (`sales-orders.ts`) | R2-B2 |
| | Column / formula customisation | P | R2-C5 |
| | Approval workflows | B — `src/lib/approvals.ts`, `purchase-approvals.ts` | — |
| | View tracking, gateways, AI assistant, CRM pipelines | X / out of scope | — |
| **BUSY** | GST IMS accept / reject / hold | B — IMS worksheet (`src/lib/gstr2b.ts:666–691`) | — |
| | Interest calculation (product / Mahajani, bills) | B — `src/lib/interest.ts`, `src/lib/ledger/ledger-interest.ts` | — |
| | Manual payment reminder (balance-only or due bills) | B — party reminders + "Remind all" (8.4) | — |
| | Multi-branch with address profiles, HO-BO sync | B — branches (`src/lib/branch.ts`), folder sync (`src/lib/sync-engine.ts`) | — |
| | Bill sundries (discount / freight lines in a bill) | B — charges (3.3), discount knobs (`src/types/invoice.ts:464`) | — |
| | Discount allowed on receipt (practice) | M | R2-A2 |
| | AI voucher scan of purchase bills | P — e-invoice QR capture (`src/lib/bill-capture.ts`); OCR X | — |
| **Marg ERP 9+** | Outstanding, interest & collection reports | B — receivables + interest | — |
| | eOrder per salesman, credit limit live | B — order pad (`src/lib/order-pad.ts`), `credit-policy.ts` | — |
| | WhatsApp / SMS pending reminders | B — `wa.me` reminders (8.4) | — |
| | Breakage / expiry, schemes | B — `expiry-ops.ts`, `offers.ts` | — |
| **TallyPrime 7.0 / 7.2** | Scheduled auto backup, restore any | B — `src/lib/auto-backup.ts`, `auto-backup-schedule.ts` | — |
| | SmartFind across companies | Q — 8G universal search | Q |
| | Cancel EWB + IRN + voucher together | B — `src/lib/einvoice-cancel.ts` (8.64) | — |
| | GSTR-3B JSON / Excel | B — `src/lib/gstr-json.ts` | — |
| | IMS ITC reduction for credit notes, per-invoice declared ITC, remarks | P — action + note only (`gstr2b.ts:671–683`) | R2-C3 |
| | Duplicate vouchers in uncertain transactions | B — exceptions list (`src/lib/gst-guards.ts:234`), series checks | — |
| | Notifications snooze | B — `src/lib/notifications.ts:67` | — |
| | 7.2: PO print templates | P — PO printed as plain HTML (`PurchaseOrdersTab.tsx:46`) | long tail |
| | PrimeBanking payments, TallyDrive | X (e-payment file is local: `src/lib/epay-confirm.ts`) | — |
| **Odoo 19** | Follow-up levels (offset days, actions, responsible, next date, per-customer auto / manual) | P — fixed stages, no per-party mode, no next action | R2-A4, R2-A5 |
| | Payment terms with instalments, EOM, early discount, instalment dates printed | M — only `credit_days` (`src/types/invoice.ts:250`) | R2-A1 |
| | Customer statement (many customers, PDF / XLSX) + due vs overdue report | P — batch statements B; no open-item / ageing variant | R2-A6 |
| | Annual Statements composite report | M — no notes / pack (`src/lib/ledger/reports.ts`, `src/lib/year-end.ts`) | R2-C1 |
| | Cash rounding | B — `round_off` (`src/lib/invoice-calc.ts:228`) | — |
| | Authorized signatory, preview as customer | B — signature in Design Studio; client copy | — |
| | Deferred revenue / expense on bills and invoices | M — no deferral code; only "Advances from customers" 2410 | R2-C2 |
| | Quote builder headers / footers | M | R2-B3 |

---

## 3. Gap list ranked by user value / effort

Value 1–5 (5 = asked for daily by many users), Effort S = 1, M = 2, L = 3; score = value ÷ effort. Ties broken by value.
Items marked **Q** were already queued in 8G / 8H and are listed only to show the overlap.

| Rank | Id | Gap | Seen in | Value | Effort | Score | Package |
|---|---|---|---|---|---|---|---|
| 1 | R2-A5 | Configurable reminder schedule, per-party reminder mode, editable templates | Zoho, Odoo, FreshBooks, Wave | 4 | S | 4.0 | A |
| 2 | R2-A6 | Statement styles: open-item / balance-forward / transaction + ageing strip | QBO, Odoo, Zoho | 4 | S | 4.0 | A |
| 3 | R2-C3 | IMS ITC-reduction declaration on credit notes + IMS working file | TallyPrime 7.0, BUSY | 4 | S | 4.0 | C |
| 4 | R2-A7 | Party payment score (avg days late, on-time %, trend) in receivables and editor | Refrens, QBO Payments AI | 3 | S | 3.0 | A |
| 5 | R2-B5 | Sales order → purchase order (back-to-back) + backorder list | QBO (May 2026), Xero (Jul 2026) | 3 | S | 3.0 | B |
| 6 | R2-C5 | Design Studio labels: column / title overrides, logo-derived accent | Xero (Feb 2026), Refrens | 3 | S | 3.0 | C |
| 7 | R2-C6 | Accessibility & display preferences (text size, contrast, motion, underline) | Zoho (May 2026) | 3 | S | 3.0 | C |
| 8 | R2-A2 | Settlement discount / short payment (kasar) on a receipt → financial credit note | BUSY, Marg, Refrens, Odoo | 5 | M | 2.5 | A |
| 9 | R2-A4 | Collections follow-ups: promise-to-pay, follow-up log, next action, broken-promise alert | Zoho, Odoo, Xero, Wave | 5 | M | 2.5 | A |
| 10 | R2-A1 | Payment terms master: Net N, EOM, day of next month, instalments, early-pay discount | Odoo, Refrens, Zoho | 4 | M | 2.0 | A |
| 11 | R2-A3 | Bad-debt write-off, single and bulk, with recovery | Zoho (Apr 2026), Tally practice | 4 | M | 2.0 | A |
| 12 | R2-B1 | Batch invoices: one template × many parties | QBO | 4 | M | 2.0 | B |
| 13 | R2-B2 | Progress / milestone billing from a quotation or sales order | QBO, Xero, Refrens | 4 | M | 2.0 | B |
| 14 | R2-B3 | Quotation revisions, optional / alternative lines, proposal sections | Xero, Odoo, FreshBooks | 4 | M | 2.0 | B |
| 15 | R2-B4 | Contact persons + ship-to address book per party, "Kind attn." printed | Zoho, QBO, Odoo | 4 | M | 2.0 | B |
| 16 | R2-C1 | Annual accounts pack with notes to accounts | Odoo 19, Zoho, Xero Workpapers | 5 | L | 1.7 | C |
| 17 | R2-C2 | Deferred revenue / prepaid expense schedules | Odoo | 3 | M | 1.5 | C |
| 18 | R2-C4 | Packing list with package dimensions and net / gross weight | Zoho (Jul 2026) | 3 | M | 1.5 | C |
| 19 | — | Local automation + validation rules (on save / daily: notify, queue, require field) | Zoho, QBO (Aug 2026) | 4 | L | 1.3 | later |
| 20 | — | Retainer with hours budget and overage | FreshBooks | 2 | M | 1.0 | later |
| 21 | — | Unbilled charges queue (QBO delayed charges / credits) | QBO | 2 | M | 1.0 | later |
| 22 | — | Multi-dimension reporting tags | Zoho, Xero, QBO | 3 | L | 1.0 | later |
| 23 | — | PO / GRN / debit-note printing on the template engine | TallyPrime 7.2 | 2 | M | 1.0 | later |
| 24 | — | "Send on" date prompt in the bell (local stand-in for scheduled send) | Xero, Zoho | 1 | S | 1.0 | later |
| 25 | — | Drag-to-fill / bulk edit of editor lines | Xero (Jul 2026) | 1 | S | 1.0 | later |
| Q | — | Profit margin chip, SmartFind, MTD/QTD/YTD, insights, quote acceptance + signature, deposits, report packs, catalogue images, import presets (QBO / Xero / Refrens / BUSY / Marg), finer rights / discount cap, per-party message language | Zoho, Tally, Xero, FreshBooks, QBO | — | — | — | 8G / 8H |

**Overlap notes for the lead.** (1) 8G "deposits & payment schedules": R2-A1 delivers the payment-schedule part
(instalments on a terms master); 8G should keep only the deposit request. (2) 8G "month-end report packs" and
R2-C1: R2-C1 builds the annual pack and notes; a month-end pack can reuse its renderer. (3) 8G quote acceptance and
R2-B3: R2-B3 adds revisions / optional lines; acceptance from the client copy should accept a specific revision.
(4) 8H per-party message language: R2-A5 adds the per-party reminder **mode** only and must not add a language field.

**Dropped (network or server):** payment gateways, payment links, card-on-file, auto-charge, terminal payments,
BNPL, bank feeds, view / open tracking, SMS / e-mail sending, scheduled server-side sending, GSTN / IRP pull and push
(Zoho "reconcile e-invoices in GSTR-1", Tally IMS portal sync), cloud backup (TallyDrive), PrimeBanking, AI
assistants and AI OCR (BUSY AI scan, Zoho receipt scan; our local substitute is the e-invoice QR capture),
webhooks. Local substitutes already built: UPI deep links / QR (`src/lib/share.ts`), client-copy HTML
(`src/lib/client-copy.ts`), e-payment files (`src/lib/epay-confirm.ts`), folder sync (`src/lib/sync-engine.ts`).

---

## 4. Specifications (top 18)

Conventions for every item:
- Pure logic in `src/lib/*.ts`, tested with `node:test` in `tests/*.test.ts`; UI lazy-loaded; strings in the package's
  own i18n area file (`defineArea(en, hi)`, Hindi required by typecheck).
- New persisted data = a new `mrchartist_inv_<table>` via `getTable/setTable`; fields snake_case and additive.
- Destructive data-layer calls call `requireAccess` (`src/lib/access.ts`); writes inside a locked period go through
  `assertUnlocked` (`src/lib/period-lock.ts`).
- Numbered series go through `src/lib/series-counters.ts` (`nextSeriesNumberFor`, `recordSeries`) with Indian FY
  labels.
- Money in `round2` / paise (`src/lib/invoice-calc.ts`); dates parsed as local days.
- New tables are registered in `RECORD_TABLES` / `ID_TABLES` (`src/lib/backup.ts:294, 365`), `WATCHED_TABLES`
  (`src/lib/audit-edits.ts:29`), `TABLE_ACTIONS` (`src/lib/access.ts:224`) and, for dated / numbered rows, `DATED` /
  `NUMBERED` in `src/lib/sync-engine.ts:278, 859` (see §6 for the merge protocol).

### R2-A — Collections & settlement

#### R2-A1 Payment terms master (Net N, EOM, day of next month, instalments, early-pay discount)

*Seen in:* Odoo payment terms (instalments, EOM buffer, early discount, "Show installment dates"), Refrens EarlyPay,
Zoho / QBO terms. *Today:* only `Client.credit_days` (`src/types/invoice.ts:250`) feeds the due date (8.6).

**User story.** As a distributor selling on "30% advance, 70% in 45 days, 2% off if paid in 7 days", I want to pick
a named term on the customer and on the invoice, see every instalment date and the early-pay offer printed, and have
reminders follow the next unpaid instalment, so that buyers pay on the agreed schedule.

**Acceptance criteria.**
1. Settings → Defaults → **Payment terms**: create / edit / deactivate terms of kind `net` (N days), `eom` (end of the
   issue month + N days), `day_next_month` (day D of next month), `instalments` (rows of % + offset kind, % summing to
   100, last row takes the rounding remainder), each with an optional early-pay discount (% and days).
   Starter set: Due on receipt, Net 7, Net 15, Net 30, Net 45, EOM + 30.
2. A client can carry `payment_terms_id`; a new document for that client pre-selects it (falls back to
   `credit_days`, then the profile default). `DocumentMetaCard` shows a terms picker next to the due date; picking a
   term sets `due_date` to the final instalment date; editing the due date by hand clears the term to "Custom".
3. On save the invoice stores a **snapshot** `payment_terms` `{ id, name, schedule: [{ due_date, percent, amount }],
   early_discount?: { percent, until, amount } }` computed from the issue date and the receivable total
   (`receivableTotal`, `src/lib/rcm.ts`). Changing the master later never changes saved invoices.
4. Templates print a schedule block ("Instalment 2 of 3 · ₹ 35,000 · due 12 Dec 2026") and, when present, "Pay
   ₹ 98,000 by 02 Nov 2026 (2% early-payment discount)". The UPI QR keeps the full amount (no second QR).
5. Reminders (`src/lib/reminders.ts`) compute days-to-due from the **next unpaid instalment** (instalments are settled
   oldest first by money received + credits); ageing stays on the invoice due date (documented).
6. MSME guard: when the sender profile records an Udyam number and the term's final due date exceeds 45 days, show a
   non-blocking note that a business buyer's deduction may be disallowed under Sec 43B(h) — "verify with your CA".
7. Recurring invoices and converted documents carry the term id and recompute the snapshot on issue.

**Files.** New: `src/lib/payment-terms.ts` (types, `resolveTerms(term, issueDate, total)`, `nextUnpaidInstalment`),
`src/components/settings/PaymentTermsPanel.tsx`, `src/components/templates/parts/PaymentScheduleBlock.tsx`,
`src/i18n/areas/collections.ts` (package area). Edit: `src/components/creator/DocumentMetaCard.tsx`,
`src/components/templates/TemplateEngine.tsx` (one insertion next to `<PartyBalanceBlock`, see §6),
`src/lib/reminders.ts` (`daysUntil` input), `src/lib/recurring.ts` (carry id), `src/store/useInvoiceStore.ts`
(`RECORD_KEYS` append), `src/pages/Settings.tsx` (Defaults tab panel), `src/types/invoice.ts` (R2-A owns this file).

**Storage.** Table `payment_terms` (rows). Additive: `Client.payment_terms_id?`, `InvoiceRecord.payment_terms?`
(snapshot), `RecurringRule.payment_terms_id?`.

**Tests.** `tests/payment-terms.test.ts`: each kind across month ends (31 Jan + EOM, Feb in leap years), local-day
parsing near 31 Mar (FY boundary), instalment rounding sums exactly to total, early discount `until` date, next unpaid
instalment with partial payments and credit notes, snapshot unaffected by master edits. Extend
`tests/reminders.test.ts` for instalment-based stages. E2E: create term → invoice → PDF shows schedule.

#### R2-A2 Settlement discount and short payment on a receipt (financial credit note)

*Seen in:* Odoo early-payment discount applied at payment, Refrens EarlyPay, BUSY / Marg receipt discount
("kasar / vatav"), Tally practice. *Today:* `Payment` (`src/types/invoice.ts:363`) has no discount; the only way to
close ₹ 37 of rounding is a GST credit note.

**User story.** As a wholesaler whose customer pays ₹ 98,000 against ₹ 1,00,000 (2% early-pay) or ₹ 49,960 against
₹ 50,000 (short by ₹ 40), I want to record the receipt and settle the difference as a discount in the same step, so
the bill closes without a fake GST credit note.

**Acceptance criteria.**
1. `PaymentModal` and the khata ₹ Received sheet show **"Settle the rest"** when the amount is below the due: options
   *Early-payment discount* (pre-filled from `invoice.payment_terms.early_discount` when the receipt date is on or
   before `until`), *Short payment / kasar*, *Leave open* (default).
2. Settling creates a **financial credit note** (`doc_type: 'CREDIT_NOTE'`, additive `note_kind: 'financial'`,
   `financial_reason: 'settlement_discount' | 'short_payment'`) with no GST, linked through `doc_links`
   (`credit_note` relation), numbered in its own series `FCN/FY25-26/0001`. `amountDue` (`src/lib/amount-due.ts`)
   needs no change: linked live credit notes already reduce the due.
3. Optional GST variant (only for *settlement_discount*, off by default, per company setting): the note carries GST
   pro rata from the invoice like a normal discount credit note and is reported in GSTR-1 CDNR / CDNUR — UI text:
   "Use only when the discount was agreed before or at the time of supply and the buyer reverses ITC (Sec 15(3)) —
   verify with your CA".
4. Financial notes (no GST) are **excluded** from GSTR-1 (CDNR / CDNUR / HSN / docs issued), GSTR-3B, GSTR-9, e-Invoice
   and e-Way builders; included in receivables, statements, Day Book and the party ledger.
5. Ledger: Dr *Discount allowed* (new default account under indirect expenses) / Cr party for both reasons
   (configurable target account for short payments, e.g. *Rounding off*). Tally export writes a Credit Note voucher
   without GST ledgers.
6. Dashboard revenue (`isRevenueDoc` / credit-note netting in `src/lib/stats.ts`) treats settlement discounts as
   expense, not revenue reduction (documented choice; P&L shows them under indirect expenses).
7. A clerk can record a settlement only up to a company cap (default ₹ 100 or 2%); above it the owner's approval is
   asked through the existing approval queue (`src/lib/approvals.ts`).
8. Deleting / cancelling the payment does not cancel the note automatically; the receipt's undo offers to cancel it too.

**Files.** New: `src/lib/settlement.ts` (`buildFinancialNote`, `settlementOptions`, caps), `src/components/collections/SettleRestFields.tsx`.
Edit: `src/components/modals/PaymentModal.tsx`, `src/components/khata/QuickEntrySheet.tsx`, `src/lib/gst-reports.ts`
(skip `note_kind === 'financial'` in the CDN / HSN / doc-issue builders), `src/lib/gstr-json.ts`, `src/lib/einvoice.ts`
/ `src/lib/einvoice-validate.ts` (refuse), `src/lib/ledger/postings.ts`, `src/lib/ledger/accounts.ts` (default accounts
*Discount allowed*, *Bad debts*, *Bad debts recovered*), `src/lib/tally-xml.ts`, `src/lib/stats.ts`, `src/lib/documents.ts`
(`CREDIT_REASONS` unchanged; add `isFinancialNote` helper).

**Storage.** No new table: `invoices` rows with additive `note_kind?: 'financial'`, `financial_reason?`; `doc_links`
rows; series `FCN` in `series_counters`. Company setting `settlement` `{ gst_variant: boolean, clerk_cap_abs, clerk_cap_pct, short_pay_account }` in a new object key `collection_settings`.

**Tests.** `tests/settlement.test.ts`: due after settlement = 0, status Paid, receivables net, GSTR-1 build unchanged
with a financial note present (snapshot compare), GST variant appears in CDNR with pro-rata tax, ledger trial balance
balances, Tally XML has no GST ledger lines, clerk cap → approval. Add the GSTR / e-invoice exclusions to
`tests/gst-reports.test.ts` and `tests/einvoice.test.ts`.

#### R2-A3 Bad-debt write-off, single and bulk, with recovery

*Seen in:* Zoho bulk invoice write-off (India, Apr 2026). *Today:* none; overdue bills stay open forever and distort
DSO (`computeDso`) and the forecast.

**User story.** As an owner closing the year, I want to write off a list of irrecoverable bills in one action, keep a
register of what was written off and why, and record a later recovery as income, so receivables and DSO reflect reality.

**Acceptance criteria.**
1. Receivables → Ageing: select bills (or a filter "older than N days") → **Write off** → reason, date (default today,
   must be in an unlocked period), owner PIN confirm (`PinConfirmModal`). Each bill gets a financial credit note with
   `financial_reason: 'bad_debt'` for its full due (R2-A2 engine), series `FCN`.
2. Ledger: Dr *Bad debts* / Cr party. GST is untouched (no output-tax reduction for bad debts) — the dialog says so,
   "verify with your CA".
3. **Write-off register** (Receivables → Collections sub-view): party, bill, written-off amount, date, reason,
   recovered so far; CSV / XLSX export.
4. **Recovery:** recording money from that party against a written-off bill offers "Record as bad debt recovered":
   same FY → cancels the note up to the amount and records the receipt; earlier FY → a receipt voucher to *Bad debts
   recovered* (other income) via `src/lib/ledger/vouchers.ts`, and the register shows it.
5. Written-off bills leave reminders, khata queue, credit-limit exposure and the cash forecast; DSO excludes them.
6. `requireAccess('doc.deleteIssued')` (owner) guards write-off and its reversal.

**Files.** New: `src/lib/write-off.ts` (selection, register, recovery), `src/components/collections/WriteOffDialog.tsx`,
`src/components/collections/WriteOffRegister.tsx`. Edit: `src/pages/Receivables.tsx` (actions + sub-view),
`src/lib/receivables.ts` (DSO exclusion flag), `src/lib/cash-forecast.ts`, `src/lib/khata.ts` (queue filter),
`src/lib/credit-limit.ts`.

**Storage.** Reuses `invoices` (financial notes) and `doc_links`; optional table `write_off_recoveries` (receipt id,
note id, amount, fy) only for prior-FY recoveries.

**Tests.** `tests/write-off.test.ts`: bulk selection by age, notes created with correct amounts, period lock refusal,
recovery same FY vs prior FY, register totals, DSO / forecast / khata exclusions, role guard.

#### R2-A4 Collections follow-ups: promise-to-pay, follow-up log, next action

*Seen in:* Zoho expected payment date, Odoo follow-up (responsible, next reminder date, chatter log), Xero planned
"commit to a payment date", Wave communication history. *Today:* reminders are logged per invoice and can be snoozed
(`makeSnooze`, `src/lib/reminders.ts:314`), but there is no promise, outcome or next action.

**User story.** As the person who calls customers every morning, I want to note "promised ₹ 40,000 on 5 Nov", see
today's follow-ups and broken promises in one list, and have reminders pause until the promised date, so nothing slips.

**Acceptance criteria.**
1. From a Receivables row, the statement viewer and the khata Remind queue: **Log follow-up** → type (call / visit /
   WhatsApp / note), outcome text, optional **promise** (amount, date, bills or "on account"), optional **next action
   date** and assignee (local user from `src/lib/users.ts`).
2. Receivables → new **Follow-ups** tab: Today, Overdue actions, Promises due, **Broken promises** (promise date passed
   and money received since the promise < promised amount), Kept promises (last 30 days); one-tap WhatsApp
   (existing `buildPartyReminder`) and "Log outcome".
3. While a promise is open, `pendingReminders` skips that party's covered bills until the promise date (Zoho's
   "Don't remind until then"); after a broken promise the next reminder suggests the firm stage.
4. Notification bell: "3 promises due today", "2 promises broken" (fingerprinted ids, snooze / dismiss as today).
5. Party timeline (statement viewer side panel): reminders sent, follow-ups, promises and receipts in date order.
6. Kept / broken counts feed R2-A7.

**Files.** New: `src/lib/collections.ts` (types, `promiseStatus`, `followUpsDue`, timeline merge),
`src/components/collections/FollowUpsTab.tsx`, `FollowUpDialog.tsx`. Edit: `src/pages/Receivables.tsx` (tab),
`src/lib/reminders.ts` (`pendingReminders` promise filter), `src/components/khata/RemindQueue.tsx`,
`src/lib/notifications.ts` (two new notices), `src/components/receivables/StatementViewer.tsx` (timeline panel).

**Storage.** Table `collection_notes` rows `{ id, party_key, kind, outcome, promise?: { amount, date, invoice_ids? },
next_action?: { date, user_id? }, created_at, created_by }`.

**Tests.** `tests/collections.test.ts`: promise kept / broken / partly kept with receipts after the promise date,
reminder suppression window, follow-ups due today in local time, notification fingerprints stable, party-key matching
for clients without id (`name:<lower>`).

#### R2-A5 Configurable reminder schedule, per-party mode, editable templates

*Seen in:* Zoho (three reminders N days before / after due, editable), Odoo follow-up levels (negative offsets, per
customer automatic / manual), FreshBooks (three after due). *Today:* thresholds hard-coded (`UPCOMING_WINDOW_DAYS = 3`,
7 / 30 days in `stageForDays`), English / Hinglish templates fixed in code.

**User story.** As a business with 15-day terms, I want to choose when each reminder stage starts, edit the wording,
and mark some customers "never remind" or "remind manually", so reminders fit my trade.

**Acceptance criteria.**
1. Settings → Defaults → **Reminder schedule**: offsets for upcoming (days before), polite / firm / final (days after),
   per-stage cooldown days; validation keeps them ordered; "Reset to defaults" restores today's 3 / 0 / 7 / 30.
2. Template editor per stage and language (English, Hinglish), using the existing `PLACEHOLDERS` with a live preview;
   blank = built-in text. Unknown placeholders are flagged.
3. Party field `reminder_mode`: `auto` (default — appears in queues), `manual` (only on demand), `never` (excluded,
   with a badge). Edited from the client form and the Remind queue row.
4. `stageForDays` and `pendingReminders` read the schedule (defaults equal today's behaviour, so existing tests pass
   unchanged).
5. No per-party language field (8H owns that).

**Files.** Edit: `src/lib/reminders.ts` (schedule input, template override), `src/components/share/ReminderModal.tsx`,
`src/components/khata/RemindQueue.tsx`, `src/lib/khata.ts`. New: `src/components/settings/ReminderSchedulePanel.tsx`.
Client form field: one `<ReminderModeField>` line in `ClientFormModal.tsx` (owned by R2-B; see §6).

**Storage.** Object key `reminder_settings` `{ upcoming_days, polite_after, firm_after, final_after, cooldowns, templates }`.
Additive `Client.reminder_mode?`.

**Tests.** Extend `tests/reminders.test.ts`: default schedule reproduces current stages; custom offsets; `never` /
`manual` filtering; template override with placeholders; invalid template falls back.

#### R2-A6 Statement styles and ageing strip

*Seen in:* QuickBooks (balance-forward, open-item, transaction statements + ageing table), Odoo customer statement and
follow-up report (due vs overdue). *Today:* ledger-style statement only (`StatementDocument.tsx`), batch exists
(`BulkStatements.tsx`), no ageing on the paper.

**User story.** As an accountant sending month-end statements, I want to choose open-item or balance-forward, include
an ageing strip, and print them for all customers with a balance, so customers see exactly which bills are open.

**Acceptance criteria.**
1. Statement viewer and bulk statements gain a **style** select: *Balance forward* (today's paper), *Open items*
   (open bills only: number, date, due, original, credited, received, open, days overdue), *Transactions* (all
   documents and receipts in the range, no opening / closing balance).
2. Toggle **Ageing strip** (Current, 1–30, 31–60, 61–90, 90+, using the receivables buckets / configured slabs) at
   the foot; "As of" date.
3. Bulk: skip parties with no activity in range (QBO behaviour) and parties with zero balance for open-item.
4. Same styles in the statement web page (client copy) and Share PDF; WhatsApp text unchanged.
5. Device-local remembered style (`mrchartist_report_prefs` pattern) — not backed up.

**Files.** New: `src/lib/statement-styles.ts` (row builders from `ReceivablesReport` / `Ledger`). Edit:
`src/components/receivables/StatementDocument.tsx`, `StatementViewer.tsx`, `BulkStatements.tsx`,
`src/lib/receivables.ts` (export bucket helper if needed).

**Storage.** None (device-local preference only).

**Tests.** `tests/statement-styles.test.ts`: open-item totals = party net when no unallocated credits; transaction
style ordering; ageing buckets at boundaries (local days); bulk skip rules.

#### R2-A7 Party payment score

*Seen in:* Refrens (average payment time, creditworthiness), QBO Payments AI (payment patterns). *Today:* DSO is
company-wide (`src/lib/receivables.ts:609`); per-party lag is computed only inside the forecast
(`collectionLags`, `src/lib/cash-forecast.ts:119`).

**User story.** As a seller deciding whether to give credit, I want to see how a customer usually pays (on time %,
average days late, promises kept) before I save a bill, so I can ask for advance from slow payers.

**Acceptance criteria.**
1. `paymentScore(party)` over the last 12 months of settled bills: average days from due to settlement (weighted by
   amount), on-time %, longest delay, promises kept / broken (R2-A4), trend vs the previous 12 months; grade
   A / B / C / D with plain-language reasons. Parties with fewer than 3 settled bills show "Not enough history".
2. Shown in Receivables ageing rows (badge + tooltip), statement viewer header and the editor's credit warning
   (`src/components/creator/CreditWarning.tsx`), hidden from viewers' prints.
3. `reminderPriority` can use the grade (documented weight change, tests updated).
4. Pure and cheap: computed from data already loaded by receivables (no new storage).

**Files.** New: `src/lib/payment-score.ts`. Edit: `src/components/creator/CreditWarning.tsx`, `src/pages/Receivables.tsx`,
`src/components/receivables/StatementViewer.tsx`, `src/lib/reminders.ts` (`reminderPriority`), reuse
`collectionLags` from `src/lib/cash-forecast.ts` (export, no behaviour change).

**Storage.** None.

**Tests.** `tests/payment-score.test.ts`: grading thresholds, amount weighting, credit notes and advances as
settlement, partial payments, insufficient history, trend.

### R2-B — Sales documents

#### R2-B1 Batch invoices (one template × many parties)

*Seen in:* QuickBooks batch invoicing. *Today:* recurring holds one client per schedule (`src/lib/recurring.ts:45`).

**User story.** As a housing society / coaching institute / landlord, I want to bill the same lines to 80 members at
once with a per-member quantity or rate, review, and issue them in number order, so month-end billing takes minutes.

**Acceptance criteria.**
1. Recurring page → new **Batch** tab: pick a source (saved invoice, quotation or recurring template), pick parties
   (search, group / area / beat filters, select all, CSV paste of names / GSTINs), optional per-party overrides
   (qty, rate, notes, PO no.) in a grid.
2. Preview shows each draft's total, place of supply (from the party's state → IGST vs CGST + SGST recomputed),
   credit-limit warnings (`credit-policy.ts`), and e-invoice applicability per party.
3. **Issue** saves drafts or issued invoices in one transaction (`src/lib/table-txn.ts`), numbered consecutively
   through `localDb.invoices.save` (Indian FY, profile prefix), sender snapshot per invoice; period lock and
   approvals respected (held invoices listed).
4. A `batch_runs` row records the run (source, party list, invoice ids, totals); **Undo run** deletes drafts and, for
   issued invoices, offers cancel (never deletes issued numbers silently).
5. After issue: open Batch PDF / ZIP (`BatchPdfModal`) and the khata reminder stepper for the run's parties.
6. "Save as batch recurring" creates one recurring row per party (no schema change to recurring).

**Files.** New: `src/lib/batch-invoices.ts` (`buildBatchDrafts`, `issueBatch`, `undoBatch`),
`src/components/recurring/BatchTab.tsx`, `src/i18n/areas/sales-r2.ts` (package area). Edit: `src/pages/Recurring.tsx` (tab).

**Storage.** Table `batch_runs` `{ id, created_at, source_id, party_keys, invoice_ids, totals, status }`.

**Tests.** `tests/batch-invoices.test.ts`: consecutive numbering across FY boundary (31 Mar / 1 Apr dates), POS /
IGST switch per party, overrides, snapshot per invoice, approval-held rows, undo of drafts vs issued, idempotent re-run guard.

#### R2-B2 Progress / milestone billing from a quotation or sales order

*Seen in:* QBO progress invoicing (% or amount, invoice remaining balance, summary report), Xero progress payments,
Refrens partial conversion. *Today:* sales orders convert by pending quantity only (`src/lib/sales-orders.ts`).

**User story.** As a contractor with a ₹ 12 lakh quotation billed 30 / 40 / 30, I want to raise each stage invoice from
the quotation, see billed vs quoted, and raise the final "balance" invoice that closes it, so I never over- or under-bill.

**Acceptance criteria.**
1. `ConvertMenu` on an accepted quotation / open sales order: **Progress invoice** → by % of the whole, by amount, or
   by line (% per line). Lines are scaled proportionally (HSN, rate, GST preserved) and titled "Stage n — 30% of
   QT/FY26-27/0012".
2. Optional milestone plan on the quotation (name, %, expected date); stage invoices tick milestones.
3. Billed-vs-quoted panel on the quotation (`DocumentTimeline`): quoted, invoiced, credited, remaining, % complete;
   refuses billing beyond 100% unless "allow over-billing" is ticked (with reason).
4. **Invoice remaining balance** creates the last invoice for exactly the remainder (rounding absorbed) and marks the
   quotation Converted.
5. Report **Progress billing summary** (by party / quotation) with CSV.
6. Links stored in `doc_links` with relation `progress` (additive relation value); credit notes against a stage
   reduce "invoiced".
7. Help text on time of supply for continuous supply of services / construction (Sec 13, Sec 31(5)) — "verify with your CA".

**Files.** New: `src/lib/progress-billing.ts`, `src/components/documents/ProgressInvoiceDialog.tsx`,
`src/components/documents/ProgressPanel.tsx`. Edit: `src/components/documents/ConvertMenu.tsx`,
`src/components/documents/DocumentTimeline.tsx`, `src/lib/documents.ts` (`buildDocumentChain` understands `progress`),
`src/lib/sales-reports.ts` (summary).

**Storage.** `doc_links` rows (relation `progress`); additive `InvoiceRecord.milestones?: { id, name, percent, expected_date?, invoice_id? }[]`
on quotations / SOs, `InvoiceRecord.progress_of?: { source_id, basis: 'percent' | 'amount' | 'lines', value }` on stage invoices.

**Tests.** `tests/progress-billing.test.ts`: proportional scaling keeps tax split, cumulative cap at 100%, remainder
exact to the paisa, credit note interaction, chain view, multi-currency quote.

#### R2-B3 Quotation revisions, optional / alternative lines, proposal sections

*Seen in:* Xero (tracks revised quotes), Odoo optional products and quote builder headers / footers, FreshBooks
proposals (scope sections, images). *Today:* lifecycle only (`src/lib/quote-status.ts`); acceptance is 8G.

**User story.** As a service firm, I want to send v2 of a quote without losing v1, offer optional add-ons the client can
pick, and add a cover / scope / timeline section, so my quote reads like a proposal.

**Acceptance criteria.**
1. **Revise** on a sent quotation creates a new record with the same base number + `-R2` suffix
   (`QT/FY26-27/0012-R2`), `revision_of` / `revision_no`; the old one becomes "Superseded" (derived state in
   `quoteState`), hidden from default lists, visible in a Revisions drawer with a line-level diff.
2. Line flag `optional` (quotations only): printed in an "Optional items" block with its own subtotal, excluded from
   the quote total by `invoice-calc` unless `selected`; converting to SO / invoice keeps only selected optional lines.
3. Alternative groups: lines sharing `alt_group` print as "Option A / Option B"; exactly one may be selected.
4. **Proposal sections** on quotations: ordered blocks (title + plain text, optional image from attachments) placed
   as *Cover*, *Before items* or *After items*; reusable section snippets in a small library.
5. Client copy HTML prints sections and optional items (acceptance still 8G).
6. `isRevenueDoc` unaffected (quotes are not revenue).

**Files.** New: `src/lib/quote-revisions.ts`, `src/lib/proposal-sections.ts`, `src/components/templates/parts/OptionalItemsBlock.tsx`,
`src/components/templates/parts/ProposalSections.tsx`, `src/components/creator/ProposalSectionsCard.tsx`.
Edit: `src/lib/invoice-calc.ts` (skip unselected optional lines), `src/lib/quote-status.ts` (Superseded),
`src/components/creator/ItemsTable.tsx` (optional / alt toggles), `src/components/templates/TemplateEngine.tsx`
(insertions after the items block and before the header for a cover, see §6), `src/lib/documents.ts`
(`buildConvertedDraft` drops unselected optional lines), `src/pages/Transactions.tsx` (hide superseded by default).

**Storage.** Additive `InvoiceRecord.revision_of?`, `revision_no?`, `proposal_sections?: { id, place, title, body, attachment_id? }[]`;
additive `InvoiceItem.optional?`, `selected?`, `alt_group?`. Table `proposal_snippets` (reusable sections).

**Tests.** `tests/quote-revisions.test.ts`: revision numbering, superseded state, diff; `tests/invoice-calc.test.ts`
extension: optional / alternative totals; conversion keeps selected only; template snapshot for sections.

#### R2-B4 Contact persons, ship-to address book, "Kind attn."

*Seen in:* Zoho contact persons (custom fields, Sep 2026), QBO / Odoo multiple addresses. *Today:* one email / phone /
address per `Client`; ship-to is typed per invoice (`PartiesSection.tsx:29, 147`).

**User story.** As a B2B seller to a company with three plants and separate accounts and purchase contacts, I want to
save each plant's address and each contact person, pick them on the invoice and print "Kind attn.", so dispatch and
billing go to the right desk.

**Acceptance criteria.**
1. Client form: **Contact persons** (name, role, phone, email, "primary", "send statements / reminders") and
   **Addresses** (label, address, city, PIN, state / state code, GSTIN of that unit if any, default ship-to).
2. Editor `PartiesSection`: ship-to picker from the address book (fills `ship_to` with state code → POS logic
   unchanged), contact picker sets additive `attention` snapshot; "Save this ship-to to the party".
3. Templates print "Kind attn.: name, role" in the party block (all layouts incl. GST); e-Way / e-Invoice ShipDtls
   keep reading `invoice.ship_to` (no change).
4. Contact search in the client typeahead (`src/lib/suggest.ts`) matches contact names and phones.
5. Import / export: client CSV / XLSX gets optional `contact_*` and `address_*` columns (first contact / address).
6. A small exported helper `partyRecipients(client)` returns reminder recipients for later use by reminders
   (wiring into `ReminderModal` is a post-merge follow-up, not part of this item).

**Files.** New: `src/lib/contacts.ts`, `src/components/clients/ContactsEditor.tsx`, `src/components/clients/AddressBookEditor.tsx`.
Edit: `src/components/modals/ClientFormModal.tsx`, `src/pages/Clients.tsx`, `src/components/creator/PartiesSection.tsx`,
`src/components/templates/parts/PartyPanel.tsx`, `src/components/templates/parts/GstBody.tsx` (party cell only),
`src/lib/suggest.ts`, `src/lib/importers.ts` / `src/lib/import-mapping.ts`.

**Storage.** Additive `Client.contacts?: ContactPerson[]`, `Client.addresses?: PartyAddress[]` (declared by
declaration merging in `src/types/contacts.ts`, see §6); additive `InvoiceRecord.attention?: { name, role?, phone?, email? }`.

**Tests.** `tests/contacts.test.ts`: primary rules, default ship-to, state code → POS, typeahead matching, CSV
round-trip, invoice snapshot unaffected by later contact edits.

#### R2-B5 Sales order → purchase order (back-to-back) and backorders

*Seen in:* QBO "Convert to purchase order" (May 2026), Xero backorders (Jul 2026). *Today:* reorder and MRP raise POs
(`src/lib/reorder.ts`, `src/lib/mrp.ts`); sales orders do not.

**User story.** As a trader who orders from the supplier only after the customer confirms, I want to raise a PO from
a sales order for the short quantity and see which customer orders wait on which PO, so I can promise delivery dates.

**Acceptance criteria.**
1. Sales order → **Create purchase order**: lines with pending qty minus free stock (godown-aware, option "full qty"),
   supplier chosen per line (last supplier of the item pre-filled), one PO per supplier; lines carry `so_id` /
   `so_line_id`.
2. Optional drop-ship: PO ship-to = the customer's address (from R2-B4 if merged, else typed).
3. **Backorders** view (Inventory → Order outstanding): SO lines short of stock with linked PO, PO expected date and
   GRN status; "Fulfil" when goods arrive opens the delivery challan / invoice for that SO.
4. The SO timeline shows linked POs; cancelling the SO warns about open linked POs.

**Files.** New: `src/lib/back-to-back.ts`, `src/components/documents/SoToPoDialog.tsx`. Edit: `src/lib/purchase-orders.ts`
(additive fields, query by SO), `src/lib/sales-orders.ts` (backorder rows), `src/components/documents/OrderFulfilment.tsx`,
`src/components/purchases/PurchaseOrdersTab.tsx` (prefill entry), Inventory order-outstanding tab component.

**Storage.** Additive `PurchaseOrder.so_id?`, PO line `so_line_id?`, `drop_ship?` (in `src/types/purchases.ts`). No new table.
Purchases contract: these modules read `purchase_orders`, not `purchases`; if they read GRNs / bills, add them to
`tests/purchase-contract.test.ts`.

**Tests.** `tests/back-to-back.test.ts`: short qty with stock and alternate units (`lineFactor`), one PO per supplier,
backorder status through GRN, cancel warning.

### R2-C — Books, compliance & output

#### R2-C1 Annual accounts pack with notes to accounts

*Seen in:* Odoo 19 Annual Statements (BS + P&L + TB), Zoho text block in financial reports, Xero Workpapers.
*Today:* every statement exists (`src/lib/ledger/reports.ts`, Schedule III BS, P&L, cash flow AS 3, TB, fixed-asset
register `src/lib/ledger/assets.ts`, year-end wizard `src/lib/year-end.ts`) but there is no single pack and no notes.

**User story.** As an owner preparing papers for my CA, I want one PDF / HTML with balance sheet, P&L, cash flow,
trial balance and notes (accounting policies, fixed-asset schedule, receivables / payables ageing with MSME dues,
contingent liabilities) with my own text where needed, so the CA starts from a complete draft.

**Acceptance criteria.**
1. Books → Reports hub → **Annual pack** for an FY (and branch filter): cover (company, FY, "Draft — prepared from
   books, verify with your CA"), index, Schedule III Balance Sheet and P&L with previous-year column, Cash-flow
   statement, Trial balance, and notes.
2. Auto notes from data: share capital / capital account movement, reserves, borrowings, trade payables with MSME
   split (vendors' Udyam / category, `src/types/purchases.ts:21`) and ageing, trade receivables ageing (secured /
   unsecured placeholder), fixed-asset schedule (gross block, additions, deletions, depreciation, net block), inventory
   (closing stock source via `loadStockValuer()`), revenue split (goods / services), GST and TDS balances.
3. Editable text notes (accounting policies, contingent liabilities, related parties, events after the balance sheet
   date) with starter text; saved per FY; each auto note can carry an extra paragraph.
4. Output: print-ready HTML (script-free like the client copy) and PDF through the existing `html-to-image` + `jspdf`
   batch path; XLSX of the numeric schedules via `src/lib/xlsx.ts` (dynamic import).
5. Numbers come from the same builders as Books / Gateway (closing stock never double counted — `loadStockValuer`).
6. Small-company / non-corporate wording toggle (proprietor / partnership vs company) — statutory: "verify with your CA".

**Files.** New: `src/lib/ledger/annual-pack.ts` (model), `src/lib/ledger/notes-auto.ts`, `src/components/books/ledger/AnnualPackTab.tsx`,
`src/components/books/ledger/NotesEditor.tsx`, `src/i18n/areas/books-r2.ts` (package area). Edit:
`src/components/books/ledger/ReportsHub.tsx` (entry), `src/pages/Books.tsx` (tab if needed).

**Storage.** Table `notes_to_accounts` rows `{ id: 'FY25-26', notes: { [noteId]: { text, extra } }, entity_type, updated_at }`.

**Tests.** `tests/annual-pack.test.ts`: BS totals equal Books, previous-year column, MSME split, fixed-asset schedule
roll-forward ties to the register, closing stock not double counted with a closing-stock journal, notes persistence per FY.

#### R2-C2 Deferred revenue and prepaid expense schedules

*Seen in:* Odoo deferred revenue / expense. *Today:* no deferral code; AMC contracts exist (`src/lib/amc.ts`).

**User story.** As a firm billing annual AMC / subscriptions upfront, I want the income spread month by month in the
P&L while GST stays on the invoice date, so monthly profit is not lumpy.

**Acceptance criteria.**
1. Books → **Deferrals**: create a schedule from an invoice line (revenue) or a purchase bill line (prepaid expense):
   start, months (or end date), method straight-line by days or by months; preview table.
2. On creation a journal moves the amount to *Income received in advance* (liability) / *Prepaid expenses* (asset);
   monthly journals release it back on each month end; journals are ordinary manual vouchers (`src/lib/ledger/vouchers.ts`)
   created when their date arrives (on open, idempotent, period lock respected) or all at once ("post up to date").
3. Default accounts are created as user accounts on first use (no edit to the default chart owned by R2-A).
4. Report: deferral register with opening, released, closing per FY; ties to the ledger balances.
5. GST, GSTR-1 and receivables are untouched (time of supply is the invoice) — note "verify with your CA".
6. Cancelling the source invoice offers to stop the schedule and reverse unreleased amounts.

**Files.** New: `src/lib/deferrals.ts`, `src/components/books/planning/DeferralsTab.tsx`. Edit: `src/pages/Books.tsx` (tab).
Reads purchases → add `deferrals.ts` to `tests/purchase-contract.test.ts`.

**Storage.** Table `deferrals` `{ id, source: { kind: 'invoice' | 'purchase', id, line_index }, amount_paise, start, months, method, account_id, voucher_ids, status }`.

**Tests.** `tests/deferrals.test.ts`: schedule by days vs months, leap year, FY split, idempotent posting, period
lock, reversal on cancel, register ties to TB.

#### R2-C3 IMS ITC-reduction declaration and IMS working file

*Seen in:* TallyPrime 7.0 (ITC reduction for B2BA / CDNRA / B2BDNA, per-invoice declared ITC, remarks), BUSY IMS.
*Today:* IMS worksheet stores `action` + `note` per document (`src/lib/gstr2b.ts:671–683`), no amounts, no file.

**User story.** As a GST filer, I want to record, for credit notes I accept or keep pending, how much ITC I am reducing
by head, and download my IMS decisions as a working file, so GSTR-3B and the portal action match my books.

**Acceptance criteria.**
1. On CDNR / CDNRA (and B2BA where the amendment reduces tax) lines, enter **ITC reduction** by head (IGST / CGST /
   SGST / cess), pre-filled from the note's tax; "Declared ITC" for invoices where the claim is partial.
2. Remarks are required for Pending / Rejected where the portal expects them (validation configurable, defaults per
   GSTN advisory as understood — "verify with your CA").
3. Period summary: accepted, rejected, pending counts; total ITC reduction by head, shown next to the 3B Table 4
   working (display only — no change to the 3B builder in this item).
4. Download **IMS working file** (JSON + XLSX of the decisions, labelled "layout unverified — working paper").
5. Additive fields only; old actions read as before.

**Files.** Edit: `src/lib/gstr2b.ts` (types, summary), `src/components/gst-reports/Gstr2bView.tsx`. New:
`src/lib/ims-file.ts`, `src/i18n/areas/gst-r2.ts`.

**Storage.** Additive on `gstr2b_actions` rows: `itc_reduction?: { igst, cgst, sgst, cess }`, `declared_itc?: {…}`, `remark?`.
Any statutory constant (e.g. remark-required rules by date) goes into `src/lib/tax-rules.ts` keyed by effective date.

**Tests.** `tests/ims.test.ts`: reduction defaults from tax, partial declared ITC, summary totals, remark validation by
date, file shape snapshot, backward compatibility with stored actions.

#### R2-C4 Packing list with packages and weights

*Seen in:* Zoho package types, net / gross weight (Jul 2026). *Today:* transport details exist (`src/lib/transport.ts`,
`TransportBlock.tsx`) but no packing list.

**User story.** As an exporter / dispatcher, I want a packing list from an invoice or delivery challan with box numbers,
dimensions and net / gross weight, so the shipment documents match.

**Acceptance criteria.**
1. From an invoice / challan (Document actions): **Packing list** → packages (type from a saved list with L×B×H and
   tare weight, count, marks & numbers), assign line quantities to packages (auto-fill "one line per box" or "all in
   one"), net weight from item `net_weight` × qty (alternate units via `lineFactor`), gross = net + tare.
2. Validation: every line quantity packed exactly once; totals per package and overall; CBM.
3. Printable A4 packing list (own print module, brand accent from Design Studio) and XLSX; numbered `PKL/FY…`.
4. Item master gets optional `net_weight` / `gross_weight` / weight unit; package types master in Settings → Items.
5. The invoice snapshot is not changed; the packing list stores its own snapshot of lines.

**Files.** New: `src/lib/packing.ts`, `src/lib/packing-print.ts`, `src/components/dispatch/PackingListDialog.tsx`,
`src/components/dispatch/PackageTypesPanel.tsx`. Edit: `src/components/creator/DocumentActions.tsx` (entry),
`src/components/settings/CatalogPanel.tsx` (weights).

**Storage.** Tables `packing_lists` (`PKL/FY` numbered) and `package_types`; additive `items_catalog` /
`stock_items` `net_weight?`, `gross_weight?`, `weight_unit?`.

**Tests.** `tests/packing.test.ts`: allocation completeness, alternate units, weights / CBM, numbering, snapshot.

#### R2-C5 Design Studio labels and logo-derived accent

*Seen in:* Xero (rename columns, logo colours pulled into the template, Feb 2026), Refrens (columns, language).
*Today:* show / hide columns, accent, font, density (`src/lib/design-prefs.ts:35–80`); labels fixed in
`src/components/templates/labels.ts`.

**User story.** As a consultant, I want "Qty" to read "Hours" and "Tax Invoice" to read "Tax Invoice — Professional
Services", and the accent to match my logo, so the invoice looks like mine without fiddling.

**Acceptance criteria.**
1. Design Studio → **Labels**: override any printed label in `labels.ts` (Description, Qty, Rate, HSN/SAC, Amount,
   Bill to, Ship to, Due date …) per profile and optionally per document type; blank = default; Hindi bilingual line
   unaffected unless overridden.
2. Document title suffix per type (statutory title "Tax Invoice" / "Bill of Supply" stays and cannot be removed — the
   override appends).
3. **Suggest accent from logo**: sample the logo image on a canvas (no network), pick the dominant non-neutral colour,
   adjust for contrast with `contrastText`, offer 3 swatches.
4. Labels are part of the design prefs (not the invoice snapshot), consistent with how design applies today.

**Files.** Edit: `src/lib/design-prefs.ts` (additive `labels?`, `title_suffix?`), `src/components/templates/labels.ts`
(lookup through overrides), `src/components/templates/paper-context.ts` (pass overrides),
`src/components/design/DesignPanel.tsx`. New: `src/lib/logo-colour.ts`.

**Storage.** Additive fields on `design_prefs` rows.

**Tests.** `tests/design-labels.test.ts`: override resolution order (type → profile → global → default), statutory
title kept; `tests/logo-colour.test.ts` with fixed pixel arrays (pure function over RGBA data).

#### R2-C6 Accessibility and display preferences

*Seen in:* Zoho accessibility preferences (May 2026). *Today:* none beyond theme and language.

**User story.** As an older shop owner on a small phone, I want bigger text, stronger contrast and less motion, so I can
use the app all day.

**Acceptance criteria.**
1. Settings → Security & device (or the user menu): **Display**: text size (90–130%), high contrast, reduce motion
   (follows the OS by default), underline links, larger tap targets, focus ring always visible.
2. Applied before first paint from `public/theme-init.js` as classes / CSS variables on `<html>`; tokens in
   `src/index.css` honour them; printed documents unaffected.
3. Device-local key `mrchartist_display_prefs` (outside the `mrchartist_inv_` prefix, like `mrchartist_report_prefs`),
   never backed up or synced; read / write wrapped in try / catch.
4. Lighthouse / axe pass on Dashboard, editor and POS at 130% with no horizontal scroll at 360 px.

**Files.** New: `src/lib/display-prefs.ts`, `src/components/settings/DisplayPanel.tsx`. Edit: `public/theme-init.js`,
`src/index.css`, `src/pages/Settings.tsx` (one panel line, see §6).

**Storage.** Device-local `mrchartist_display_prefs`.

**Tests.** `tests/display-prefs.test.ts` (parse / clamp / defaults); Playwright step toggling text size and checking
computed font size and no overflow.

---

## 5. Work packages

Three packages, each buildable by one agent in its own worktree. Files are owned by one package; the few shared
touchpoints are append-only and listed in §6.

### R2-A — Collections & settlement (7 items)

Items: **A1** payment terms master · **A2** settlement discount / short payment · **A3** bad-debt write-off ·
**A4** follow-ups & promises · **A5** reminder schedule · **A6** statement styles · **A7** party payment score.

Owned files (new): `src/lib/payment-terms.ts`, `settlement.ts`, `write-off.ts`, `collections.ts`, `statement-styles.ts`,
`payment-score.ts`; `src/components/collections/*`; `src/components/settings/PaymentTermsPanel.tsx`,
`ReminderSchedulePanel.tsx`; `src/components/templates/parts/PaymentScheduleBlock.tsx`; `src/i18n/areas/collections.ts`;
`docs/features/collections.md`; tests listed above.
Owned files (edit): `src/lib/reminders.ts`, `receivables.ts`, `khata.ts`, `amount-due.ts` (only if needed),
`cash-forecast.ts`, `credit-limit.ts`, `stats.ts`, `gst-reports.ts`, `gstr-json.ts`, `einvoice.ts`, `einvoice-validate.ts`,
`tally-xml.ts`, `notifications.ts`, `recurring.ts`, `documents.ts` (helper only); `src/lib/ledger/postings.ts`,
`src/lib/ledger/accounts.ts`; `src/types/invoice.ts`; `src/pages/Receivables.tsx`, `src/pages/Settings.tsx`;
`src/components/receivables/*`, `src/components/khata/*`, `src/components/share/ReminderModal.tsx`,
`src/components/modals/PaymentModal.tsx`, `src/components/creator/DocumentMetaCard.tsx`, `CreditWarning.tsx`.

### R2-B — Sales documents (5 items)

Items: **B1** batch invoices · **B2** progress / milestone billing · **B3** quote revisions, optional lines, proposal
sections · **B4** contact persons & address book · **B5** sales order → purchase order & backorders.

Owned files (new): `src/lib/batch-invoices.ts`, `progress-billing.ts`, `quote-revisions.ts`, `proposal-sections.ts`,
`contacts.ts`, `back-to-back.ts`; `src/types/contacts.ts`, `src/types/sales-r2.ts` (declaration merging);
`src/components/recurring/BatchTab.tsx`; `src/components/documents/ProgressInvoiceDialog.tsx`, `ProgressPanel.tsx`,
`SoToPoDialog.tsx`; `src/components/clients/*`; `src/components/creator/ProposalSectionsCard.tsx`;
`src/components/templates/parts/OptionalItemsBlock.tsx`, `ProposalSections.tsx`; `src/i18n/areas/sales-r2.ts`;
`docs/features/sales-r2.md`.
Owned files (edit): `src/lib/invoice-calc.ts`, `quote-status.ts`, `sales-orders.ts`, `purchase-orders.ts`,
`sales-reports.ts`, `suggest.ts`, `importers.ts`, `import-mapping.ts`; `src/types/purchases.ts` (PO fields);
`src/pages/Recurring.tsx`, `src/pages/Clients.tsx`, `src/pages/Transactions.tsx`;
`src/components/documents/ConvertMenu.tsx`, `DocumentTimeline.tsx`, `OrderFulfilment.tsx`;
`src/components/modals/ClientFormModal.tsx`; `src/components/creator/PartiesSection.tsx`, `ItemsTable.tsx`;
`src/components/purchases/PurchaseOrdersTab.tsx`; `src/components/templates/TemplateEngine.tsx`,
`parts/PartyPanel.tsx`, `parts/GstBody.tsx`.
Note: `src/lib/documents.ts` is shared with A (A adds one helper; B edits `buildConvertedDraft` / `buildDocumentChain`)
— different functions, no overlapping hunks expected.

### R2-C — Books, compliance & output (6 items)

Items: **C1** annual accounts pack & notes · **C2** deferred revenue / prepaid schedules · **C3** IMS ITC reduction &
working file · **C4** packing list · **C5** Design Studio labels & logo accent · **C6** accessibility & display prefs.

Owned files (new): `src/lib/ledger/annual-pack.ts`, `notes-auto.ts`; `src/lib/deferrals.ts`, `ims-file.ts`, `packing.ts`,
`packing-print.ts`, `logo-colour.ts`, `display-prefs.ts`; `src/components/books/ledger/AnnualPackTab.tsx`,
`NotesEditor.tsx`; `src/components/books/planning/DeferralsTab.tsx`; `src/components/dispatch/*`;
`src/components/settings/DisplayPanel.tsx`; `src/i18n/areas/books-r2.ts`, `gst-r2.ts`; `docs/features/books-r2.md`.
Owned files (edit): `src/lib/gstr2b.ts`, `design-prefs.ts`, `tax-rules.ts` (append-only date-keyed rows);
`src/components/gst-reports/Gstr2bView.tsx`; `src/components/books/ledger/ReportsHub.tsx`; `src/pages/Books.tsx`;
`src/components/templates/labels.ts`, `paper-context.ts`; `src/components/design/DesignPanel.tsx`;
`src/components/creator/DocumentActions.tsx`; `src/components/settings/CatalogPanel.tsx`; `public/theme-init.js`;
`src/index.css`; `tests/purchase-contract.test.ts` (add `deferrals.ts`).

---

## 6. Merge protocol for shared touchpoints

These files are edited by more than one package. Each edit is small and placed so the hunks do not overlap.
Merge order: **R2-A → R2-B → R2-C**; each later package rebases and resolves any one-line conflicts mechanically.

| File | Who | Rule |
|---|---|---|
| `src/types/invoice.ts` | A only | B adds its `InvoiceRecord` / `InvoiceItem` / `Client` fields by **declaration merging** in `src/types/sales-r2.ts` / `src/types/contacts.ts` (`declare module './invoice' { interface Client { contacts?: … } }`). C adds no invoice fields. |
| `src/store/useInvoiceStore.ts` `RECORD_KEYS` | A, B | The completeness check (`recordKeysComplete`) forces every new invoice field into the list. A **appends** after `'party_balance_snapshot'`; B **prepends** right after `const RECORD_KEYS = [`. |
| `src/components/templates/TemplateEngine.tsx` | A, B | B owns the file; A adds one line `<PaymentScheduleBlock invoice={invoice} />` directly after `<PartyBalanceBlock …/>`; B inserts its blocks after the items / GST body and a cover before the header. C does not edit it (labels go through `labels.ts` / `paper-context.ts`). |
| `src/pages/Settings.tsx` | A, C | A adds two panels inside the existing `defaults` tab; C adds `DisplayPanel` inside the `security` tab. No new tab ids. |
| `src/lib/backup.ts` `RECORD_TABLES` / `ID_TABLES` | A, B, C | Each package appends one line with a `// Round 2 (R2-X)` comment at the end of each list. |
| `src/lib/audit-edits.ts` `WATCHED_TABLES` | A, B, C | Same: one appended block per package. |
| `src/lib/access.ts` `TABLE_ACTIONS` | A, B, C | Same. |
| `src/lib/sync-engine.ts` `DATED` / `NUMBERED` | A, B, C | Same (only for dated / numbered tables: `collection_notes`, `batch_runs`, `packing_lists`, `deferrals`). |
| `src/lib/documents.ts` | A, B | A: new exported helper at the end of the file; B: edits inside `buildConvertedDraft` / `buildDocumentChain`. |
| `src/components/modals/ClientFormModal.tsx` | B, A | B owns; A adds one `<ReminderModeField client={…} onChange={…} />` line (component in `src/components/collections/`) directly after the credit-limit / credit-days inputs. |
| `src/components/command/CommandPalette.tsx` | A, B, C | Each adds its commands in one appended group. |
| `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` | lead | Packages write only their own `docs/features/*.md`; the lead adds the Round 2 rows, table rows and storage keys after merging. |

Every package must pass `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` on its own branch and
again after rebasing on the previous package. No new runtime dependencies; first-paint bundle budget unchanged
(all new UI lazy).

---

## 7. New storage summary

| Key / table | Package | Kind | Backed up | Synced |
|---|---|---|---|---|
| `mrchartist_inv_payment_terms` | A | rows | yes | yes |
| `mrchartist_inv_collection_notes` | A | rows (dated) | yes | yes |
| `mrchartist_inv_reminder_settings` | A | object | yes | yes |
| `mrchartist_inv_collection_settings` | A | object | yes | yes |
| `mrchartist_inv_write_off_recoveries` | A | rows (optional) | yes | yes |
| `FCN/FY…` series in `series_counters` | A | counter | yes | yes |
| `mrchartist_inv_batch_runs` | B | rows (dated) | yes | yes |
| `mrchartist_inv_proposal_snippets` | B | rows | yes | yes |
| `mrchartist_inv_notes_to_accounts` | C | rows (per FY) | yes | yes |
| `mrchartist_inv_deferrals` | C | rows (dated) | yes | yes |
| `mrchartist_inv_packing_lists` (`PKL/FY…`) | C | rows (numbered) | yes | yes |
| `mrchartist_inv_package_types` | C | rows | yes | yes |
| `mrchartist_display_prefs` | C | device-local (outside prefix) | no | no |
| Additive fields | A: `InvoiceRecord.payment_terms`, `note_kind`, `financial_reason`; `Client.payment_terms_id`, `reminder_mode`; `RecurringRule.payment_terms_id` · B: `InvoiceRecord.milestones`, `progress_of`, `revision_of`, `revision_no`, `proposal_sections`, `attention`; `InvoiceItem.optional`, `selected`, `alt_group`; `Client.contacts`, `addresses`; `PurchaseOrder.so_id`, `drop_ship`, line `so_line_id` · C: `gstr2b_actions.itc_reduction`, `declared_itc`, `remark`; `design_prefs.labels`, `title_suffix`; catalogue / stock item `net_weight`, `gross_weight`, `weight_unit` | — | — | — |

---

## 8. Open questions

Statutory questions are flagged **(verify with your CA)**; outputs stay labelled as working papers.

1. **Settlement discount and GST (R2-A2) (verify with your CA).** Default is a financial credit note without GST
   (Circular 92/11/2019-GST as understood). When may the GST variant be used under Sec 15(3)(b) — must the discount
   be in the agreement at the time of supply and linked to specific invoices, and must we capture proof of the
   buyer's ITC reversal? Should the GST variant be hidden unless the invoice carried an early-pay term (R2-A1)?
2. **Bad-debt write-off (R2-A3) (verify with your CA).** Confirm there is no output-GST relief for bad debts and that
   the Sec 34 credit-note route is not appropriate; income-tax deduction under Sec 36(1)(vii) on write-off in books;
   treatment of TDS already deducted by the customer on a written-off bill.
3. **MSME 45-day note (R2-A1) (verify with your CA).** Is a warning to the *seller* about the buyer's Sec 43B(h)
   disallowance useful, and should it depend on the buyer being a business (GSTIN present) and on the seller's
   Udyam category (micro / small only, traders excluded)?
4. **Early-pay discount and TDS / TCS (R2-A1, R2-A2) (verify with your CA).** Is TDS by the buyer computed on the
   gross invoice, and how should a later discount note interact with the TDS receivable register (`src/lib/tds-register.ts`)?
5. **Progress billing time of supply (R2-B2) (verify with your CA).** For continuous supply of services and works
   contracts, should the stage invoice date be suggested from the milestone date or the payment due date (Sec 13(2),
   Sec 31(5))? Any e-invoice implication for many small stage invoices?
6. **IMS (R2-C3) (verify with your CA).** Exact rules for ITC-reduction declaration on credit notes and remark
   requirements by date (GSTN advisories from Oct 2025 as understood); the IMS offline file layout is unverified —
   keep "layout unverified". Should the declared reduction later feed GSTR-3B Table 4(B) automatically?
7. **Annual pack (R2-C1) (verify with your CA).** Schedule III Division I wording for companies vs a simpler format for
   proprietorships / firms; MSMED Act Sec 22 disclosure fields; which notes are mandatory for small companies.
   Should the pack carry a "prepared by" block for the CA, and should it include the audit-trail chain head
   (7Q per-FY auditor export, in progress in a worktree) for reference?
8. **Deferrals (R2-C2) (verify with your CA).** Revenue recognition basis (AS 9 / Ind AS 115) — straight-line by days
   as default? Should AMC contracts (`src/lib/amc.ts`) create deferrals automatically?
9. **Batch invoices (R2-B1).** Should a batch of B2B invoices for e-invoice-liable sellers open the bulk e-Invoice JSON
   (`src/lib/einvoice-bulk.ts`) automatically? (verify with your CA for the 30-day IRP window, 8.60.)
10. **Revenue presentation (R2-A2).** Settlement discount as indirect expense (current proposal) or as reduction of
    revenue in the dashboard and P&L? Product decision; affects `src/lib/stats.ts`.
11. **Coordination with 8G / 8H.** Confirm the overlap split in §3 (8G keeps deposits; R2-A1 owns instalment
    schedules; 8H owns per-party language; 8G acceptance accepts a specific R2-B3 revision).
12. **Long-tail items.** Is a local automation / validation rules engine (Zoho workflow rules, QBO custom automations)
    worth an L-sized Round 3 item, given the save path it touches (`useInvoiceStore.ts`, `localDb.ts`)?
