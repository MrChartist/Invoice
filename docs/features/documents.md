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

Transition matrix: QUOTATION -> PROFORMA | TAX_INVOICE | INVOICE | DELIVERY_CHALLAN; PROFORMA -> TAX_INVOICE | INVOICE | DELIVERY_CHALLAN; INVOICE/TAX_INVOICE -> DELIVERY_CHALLAN; DELIVERY_CHALLAN -> TAX_INVOICE | INVOICE; CREDIT_NOTE -> none; Cancelled -> none. Credit notes are raised via the modal (invoices that are not Draft/Cancelled).

Behaviour notes:
- Conversion: new id + number from `nextNumber(today, target)` (INVOICE and TAX_INVOICE share the INV series; QTN/PRO/CRN/DCH separate), items get fresh ids, `amount_paid` 0, status Draft, issue date today, due date = today + `defaultDueDays` (challan: today). Totals are recomputed with `calculateInvoice` and equal the source's.
- Credit note: CRN series, status `Sent`, `balance_due` 0 (it is not receivable; **receivables code must skip `CREDIT_NOTE` rows and use `effectiveOutstanding` for invoices**). Credit-note items keep the ORIGINAL item `id`, which is how cumulative per-line credit is tracked. Same `gst_mode` / `place_of_supply` / `round_off_enabled`; invoice-level discount is carried as an equivalent percent so partial credits get a proportional share. `po_number` = original invoice number; `notes` = "Credit note against Tax Invoice INV/... dated YYYY-MM-DD. Reason: ...". Rejected if any line or the cumulative total (tolerance 0.02) would exceed the original; cancelled credit notes free the quantity.
- Debit note: no `DEBIT_NOTE` doc type exists, so it is a new **INVOICE/TAX_INVOICE draft** (same type as the original, normal invoice number) with `po_number` = original number, notes "Debit note against ...", plus a `debit_note` link. No UI yet; call `createDebitNote(invoice, { reason, lines:[{name, quantity, rate, tax_rate?, hsn?, unit?}] })` from wherever needed.
- Cancel: status `Cancelled`, reason stored in `doc_links` with `prev_status`; refuses when `amount_paid > 0` unless `acknowledgePayments`. Reinstate restores `prev_status`.

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

Receivables / stats: replace `inv.balance_due` with `effectiveOutstanding(inv, readLinks(), allInvoices)` and exclude `CREDIT_NOTE` from sales totals (or subtract `totalCredited`).

Backup: add `doc_links` to the backup table list (`src/lib/backup.ts`) so links round-trip.

Template note: the `Credit Note` template should render `po_number` / `notes` (they hold the original number/date reference).
