# Documents module (sales document workflow)

Quotation -> Proforma -> Tax Invoice -> Delivery Challan, credit / debit notes, cancellation.
No dedicated page: it is a set of components + a lib that the lead wires into the invoice
screens. All saves go through `localDb.invoices.save`.

## Route / nav
- No route and no nav entry. (If a page is wanted later: `/documents`, label "Documents", icon `GitBranch`.)

## Tables
- `doc_links` (via `getTable/setTable`, key `mrchartist_inv_doc_links`):
  `{ id, from_id, to_id, relation: 'converted'|'credit_note'|'debit_note'|'cancelled', reason?, prev_status?, payments_acknowledged?, created_at }`.
  `cancelled` links have `from_id === to_id`; reinstating removes that link.
- Invoices table: new rows only, via `localDb.invoices.save`. Source quotes/proformas in `Draft` become `Sent` when converted; nothing else on the source changes.

## Lib: `src/lib/documents.ts`
Pure (unit-tested): `allowedConversions`, `canConvert`, `canRaiseNote`, `buildConvertedDraft`, `statusAfterConversion`, `buildCreditNote`, `buildDebitNote`, `creditableLines`, `creditedQuantities`, `creditNotesFor`, `totalCredited`, `effectiveOutstanding(invoice, links, allInvoices)`, `cancelBlockedReason`, `buildDocumentChain(id, links, invoices)`.
Storage-backed: `convertDocument(source, target)`, `createCreditNote(invoice, {lines:[{itemId,quantity}], reason})`, `createDebitNote`, `cancelDocument(invoice, reason, {acknowledgePayments})`, `reinstateDocument`, `getDocumentChain(id)`, `readLinks()`, `activeCancellation(id, links)`.
Constants/types: `CREDIT_REASONS`, `DocLink`, `DocRelation`, `DocumentError`, `ChainNode`.
Storage-backed functions throw `DocumentError` (validation) or `StorageWriteError` (quota).

Bill of Supply (5.9): a target wherever TAX_INVOICE / INVOICE is (quotation, proforma, sales order, challan) and BILL_OF_SUPPLY -> DELIVERY_CHALLAN; `isInvoiceType` includes it, so credit / debit notes can be raised against it (untaxed). `startAmendment(invoice, reason)` marks a saved document as a GSTR-1 amendment (see `composition-amendments.md`); conversions, notes and late fees never copy `amends`.

Transition matrix: QUOTATION -> PROFORMA | TAX_INVOICE | INVOICE | DELIVERY_CHALLAN; PROFORMA -> TAX_INVOICE | INVOICE | DELIVERY_CHALLAN; INVOICE/TAX_INVOICE -> DELIVERY_CHALLAN; DELIVERY_CHALLAN -> TAX_INVOICE | INVOICE; CREDIT_NOTE -> none; Cancelled -> none. Credit notes are raised via the modal (invoices that are not Draft/Cancelled).

Behaviour notes:
- Conversion: new id + number from `nextNumber(today, target)` (INVOICE and TAX_INVOICE share the INV series; QTN/PRO/CRN/DCH separate), items get fresh ids, `amount_paid` 0, status Draft, issue date today, due date = today + `defaultDueDays` (challan: today). Totals are recomputed with `calculateInvoice` and equal the source's.
- Credit note: CRN series, status `Sent`, `balance_due` 0 (it is not receivable; **receivables code must skip `CREDIT_NOTE` rows and use `effectiveOutstanding` for invoices**). Credit-note items keep the ORIGINAL item `id`, which is how cumulative per-line credit is tracked. Same `gst_mode` / `place_of_supply` / `round_off_enabled`; invoice-level discount is carried as an equivalent percent so partial credits get a proportional share. `po_number` = original invoice number; `notes` = "Credit note against Tax Invoice INV/... dated YYYY-MM-DD. Reason: ...". Rejected if any line or the cumulative total (tolerance 0.02) would exceed the original (compared on what the customer owes — `receivableTotal`, so an older reverse-charge invoice's tax does not count); cancelled credit notes free the quantity. `goods_returned` (additive) records whether goods came back: `CreditInput.goodsReturned`, else the reason (`reasonReturnsGoods`: only Discount / Rate difference / GST correction / Cancellation of service are value-only); a value-only note carries no serials and moves no stock (`inventory.md`). A note against a reverse-charge invoice is calculated the current way (`rcm_tax_excluded`).
- Debit note: no `DEBIT_NOTE` doc type exists, so it is a new **INVOICE/TAX_INVOICE draft** (same type as the original, normal invoice number) with `po_number` = original number, notes "Debit note against ...", plus a `debit_note` link. No UI yet; call `createDebitNote(invoice, { reason, lines:[{name, quantity, rate, tax_rate?, hsn?, unit?}] })` from wherever needed.
- Cancel: status `Cancelled`, reason stored in `doc_links` with `prev_status`; refuses when `amount_paid > 0` unless `acknowledgePayments`. Cancelling a goods-returning credit note whose returned serials were resold is refused; when later documents used its quantities it needs `acknowledgeStock` (the dialog asks).
- Reinstate restores `prev_status` **only after re-checking** what was released while it was cancelled (`reinstateIssues`): the batch / serial / godown issue checks with the restored status (as of its date, against later documents), advance capacity (an adjustment re-applied elsewhere would over-adjust), time entries / trips / re-billed costs billed on another invoice since, and sales-order over-delivery / over-invoicing. Any conflict refuses with a message naming the other document.
- Credit notes take serials from the invoice line **minus those on earlier live credit notes** against it, and `createCreditNote` runs the same tracking checks as the editor before saving it as Sent.

## Components (`src/components/documents/`, all CSS Modules in `documents.module.css`)
- `ConvertMenu` props `{ invoice, onCreated?(rec), onRequestCreditNote?() }`. Default `onCreated` navigates to `/invoice/:id` (needs Router context). Renders nothing when no action applies. Toasts errors itself.
- `CreditNoteModal` props `{ invoice, open, onClose, onCreated(rec) }`.
- `CancelDialog` props `{ invoice, open, onClose, onDone(rec) }`: cancels, or reinstates if the invoice is already Cancelled.
- `DocumentTimeline` props `{ invoiceId, refreshKey?, className? }`: links each node to `/invoice/:id`.

## Wiring the lead must add
In `src/pages/InvoiceCreator.tsx` (saved invoice header / actions, where `invoiceId` and the saved record `savedInvoice` exist):

```tsx
import { ConvertMenu } from '../components/documents/ConvertMenu';
import { CreditNoteModal } from '../components/documents/CreditNoteModal';
import { CancelDialog } from '../components/documents/CancelDialog';
import { DocumentTimeline } from '../components/documents/DocumentTimeline';

const [creditOpen, setCreditOpen] = useState(false);
const [cancelOpen, setCancelOpen] = useState(false);
const [docTick, setDocTick] = useState(0);
const reloadAfterDoc = () => { setDocTick((t) => t + 1); /* reload invoice from localDb.invoices.getById(id) */ };

{savedInvoice && (<>
  <ConvertMenu invoice={savedInvoice} onRequestCreditNote={() => setCreditOpen(true)} />
  <button onClick={() => setCancelOpen(true)}>{savedInvoice.status === 'Cancelled' ? 'Reinstate' : 'Cancel'}</button>
  <CreditNoteModal invoice={savedInvoice} open={creditOpen} onClose={() => setCreditOpen(false)}
    onCreated={(r) => { reloadAfterDoc(); navigate(`/invoice/${r.id}`); }} />
  <CancelDialog invoice={savedInvoice} open={cancelOpen} onClose={() => setCancelOpen(false)} onDone={reloadAfterDoc} />
  <DocumentTimeline invoiceId={savedInvoice.id} refreshKey={docTick} />
</>)}
```

Dashboard/Transactions row actions can reuse `ConvertMenu` and `CancelDialog` unchanged.

Receivables / stats: what an invoice still owes is `amountDue(inv, linkedCredits(links, invoices).get(inv.id))` (`src/lib/amount-due.ts`, see `receivables.md` → Amount due), never `inv.balance_due` alone; exclude `CREDIT_NOTE` from sales totals. Issuing, editing, cancelling, reinstating or deleting a credit note re-derives the original's status (`resettleCreditedInvoices` in `localDb.ts`): a note that covers the rest makes it Paid without any receipt.

Backup: add `doc_links` to the backup table list (`src/lib/backup.ts`) so links round-trip.

Template note: the `Credit Note` template should render `po_number` / `notes` (they hold the original number/date reference).

## Quotation outcome and ship-to

- `quote_status` (`Accepted` | `Declined`, additive) is set from the editor's **Quotation** row
  (`localDb.invoices.setQuoteStatus`, period-lock checked, audited). `quoteState()` in `src/lib/quote-status.ts`
  derives what the list shows: Draft, Sent, Accepted, Declined, **Expired** (past the quote's "valid until" =
  `due_date`) or **Converted** (a `converted` link exists). Converting a quotation marks it Accepted.
- `ship_to` (additive `{name, address, city, state_code, zip, gstin}`) comes from "Ship to a different address" in
  the editor, prints as **Ship to** (Consignee on the GST layout), and is the e-Way bill's delivery address unless
  the e-Way dialog overrides it.
- `normalizeRecord` and the store's `RECORD_KEYS` must both carry every persisted field;
  `tests/invoice-store.test.ts` fails if loading → saving would drop one.

## Debit notes

`DEBIT_NOTE` is its own document type with the `DBN/FY<yy-yy>/<seq>` series. Convert → **Create debit note** on an
issued invoice (`createDebitNote`) links it (`doc_links` relation `debit_note`). It counts as revenue and as a
receivable, posts like a sale in Books / Tally, is reported in GSTR-1 as CDNR / CDNUR with `ntty: "D"` (document
type 4 in the doc-issue table), and is e-invoiced as `DBN` with the original invoice pre-filled as the preceding
document. Credit and debit notes linked to an invoice are classified by that invoice: a note against a B2CL
invoice goes to CDNUR (B2CL) whatever its own value.

## Sales orders (Roadmap 6.5)

`SALES_ORDER` is its own document type with the `SO/FY<yy-yy>/<seq>` series (Indian FY). It is a confirmed customer
order, **not a tax document**: every classifier uses an allow-list of tax types, so it is excluded from revenue
(`stats.isRevenueDoc`), receivables (`isLedgerDoc`), Books (`SALES_TYPES`), sales reports, GSTR-1/3B
(`TAX_DOC_TYPES`, doc-issue table), stock (`inventory.invoiceEffect` → null), Tally/accounting exports
(`voucherKindOf` → null), e-Invoice (`eInvoiceDocType` → null), e-Way (preflight error), reminders, recurring
schedules, the PAID/OVERDUE stamp and the client-copy UPI button. It only appears in listings.

- Created from the editor's Type select (`/invoice?type=SALES_ORDER`, palette "New sales order") or Convert →
  "Convert to Sales Order" on a quotation (marks the quotation Accepted / Converted). The due date prints as
  **Delivery by**.
- Transition matrix: `QUOTATION → SALES_ORDER`; `SALES_ORDER → DELIVERY_CHALLAN | TAX_INVOICE | INVOICE`.
- **Partial conversion**: `convertDocument(so, target)` pre-fills only the pending quantity — challans take
  ordered − delivered, invoices ordered − invoiced; fully covered lines are left off. The new document gets
  `sales_order_id = so.id` and each line `order_line_id = <SO line id>` (both additive; carried along when that
  challan is later converted to an invoice). A `converted` doc_link is added as for any conversion. On a partial
  conversion an AMOUNT discount is re-expressed as the equivalent percent; shipping / other charges ride only on the
  first challan and the first invoice.
- **Fulfilment is derived** (`src/lib/sales-orders.ts`, pure): `buildOrderIndex(invoices, links)` /
  `orderFulfilment(so, invoices, links)` → per line ordered / delivered / invoiced / pending, and a state.
  Invoiced = live INVOICE/TAX_INVOICE lines; delivered = live challans not made from an invoice + invoices not made
  from a challan (so SO → challan → invoice counts the goods once each). Drafts count, cancelled documents and credit
  notes do not. Deliver goods on a challan *and then invoice that challan* (Convert on the challan); invoicing the
  same goods directly from the order as well would count the delivery twice (pending never goes below zero).
- **State**: Draft / Open / Partly fulfilled / Fulfilled (every line delivered and invoiced) / Closed / Cancelled.
  `order_closed_on` (local YYYY-MM-DD, additive) is set by **Close order** on a part-fulfilled order
  (`localDb.invoices.setOrderClosed(id, day | undefined)`, period-lock checked, audited); a closed order offers no
  conversions until reopened.
- UI: `OrderFulfilment` (lazy, `src/components/documents/OrderFulfilment.tsx`) in the saved document's actions shows
  the per-line table, the linked documents and Close / Reopen. The invoice list (`/transactions?type=SALES_ORDER`)
  shows the order state as the badge and, when filtered to sales orders, an order-status filter. "Duplicate" on the
  list strips the order stamps so a copy never counts as fulfilment.
- Tests: `tests/integration/orders.test.ts`, `tests/documents.test.ts`.
