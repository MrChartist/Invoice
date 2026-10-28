# Round 2 — R2-B Sales documents

Batch invoices, progress / milestone billing, quotation revisions with optional lines and proposal sections,
contact persons with a ship-to address book, and sales order → back-to-back purchase orders with a backorder
view. Spec: `docs/prd/round-2.md` §4 R2-B1–B5.

## Modules

| Item | Logic (pure, unit-tested) | UI (lazy) |
|---|---|---|
| B1 batch invoices | `src/lib/batch-invoices.ts` | `src/components/recurring/BatchTab.tsx` (Recurring → Batch invoices, `/recurring?tab=batch`) |
| B2 progress billing | `src/lib/progress-billing.ts`, `progressSummaryCsv` in `sales-reports.ts` | `documents/ProgressPanel.tsx` (in the document timeline), `ProgressInvoiceDialog.tsx`, `ProgressReportModal.tsx` (Invoices → Progress billing) |
| B3 revisions / optional lines / sections | `src/lib/quote-revisions.ts`, `src/lib/proposal-sections.ts`, `isExcludedLine` in `invoice-calc.ts` | Convert menu → Revise quotation, `documents/RevisionsPanel.tsx`, `creator/QuoteLineFlags.tsx`, `creator/ProposalSectionsCard.tsx`, paper parts `OptionalItemsBlock.tsx`, `ProposalSections.tsx` |
| B4 contacts / address book | `src/lib/contacts.ts`, `clientExtras` in `suggest.ts`, import columns in `import-mapping.ts` / `importers.ts` | `clients/ContactsEditor.tsx`, `clients/AddressBookEditor.tsx` (client form), `clients/PartyBookPickers.tsx` (editor), paper part `AttentionLine.tsx`, Clients → Export CSV |
| B5 back-to-back POs / backorders | `src/lib/back-to-back.ts`, `posForSalesOrder` + drop-ship print in `purchase-orders.ts` | Convert menu → Create purchase order (`documents/SoToPoDialog.tsx`), Inventory → Order outstanding → Backorders (`documents/BackordersView.tsx`, `?tab=orders&view=backorders`) |

## Storage (all additive)

- Tables: `mrchartist_inv_batch_runs` (dated by `date`, registered in backup `RECORD_TABLES` / `ID_TABLES`,
  `TABLE_ACTIONS` = `doc.create`, `WATCHED_TABLES`, sync `DATED`) and `mrchartist_inv_proposal_snippets`
  (backup, `doc.create`, watched).
- Record fields via declaration merging (`src/types/sales-r2.ts`, `src/types/contacts.ts`; `invoice.ts` untouched):
  `InvoiceRecord.milestones`, `progress_of`, `revision_of`, `revision_no`, `proposal_sections`, `attention`;
  `InvoiceItem.optional`, `selected`, `alt_group`, `progress_line_of` (the source line a stage line bills — not
  in the PRD list, needed to track billed quantity on quotations); `Client.contacts`, `addresses`.
  All in `RECORD_KEYS` (prepended) and kept by `normalizeRecord` / `normalizeItem` (`store/invoice-defaults.ts`).
- PO fields (`src/types/purchases.ts`): `PurchaseOrder.so_id`, `drop_ship`, `ship_to`; line `so_line_id`.
- `doc_links` relations: `progress` (with `final: true` on the remaining-balance invoice) and `revised`
  (old quote → its revision). Both appear in `buildDocumentChain`. `quoteState` derives **Superseded** from
  `revised` and **Converted** from a final `progress` link.

## Behaviour notes

- **Batch issue** is all-or-nothing (`withTablesRollback`), numbered consecutively in the FY series of the issue
  date through `localDb.invoices.save` (period lock, approvals, credit gate, sender snapshot). Held invoices
  (approval / credit / missing serial or batch) stay Drafts and are listed. Re-running the same source × date ×
  party list is refused unless "Issue again". Undo deletes drafts; issued invoices are cancelled with a reason or
  kept — never deleted. Overrides apply to the first priced line's quantity / rate.
- **Progress billing** scales the line *quantity* (rate, HSN, GST rate and line discount preserved; 4-decimal
  quantities). "Amount" means rupees before GST, so a stage is within paise of the amount; the remaining-balance
  invoice absorbs rounding in its rate so all stages add up to the source line value exactly. A sales-order stage
  carries `sales_order_id` / `order_line_id`, so order fulfilment and normal conversion see what was billed (it also
  counts as delivered, like any invoice not made from a challan). Credit notes against a stage reduce "invoiced".
- **Revisions** never edit the old quote (an accepted revision keeps its 8G acceptance snapshot); the revision
  starts as a Draft without acceptance. Superseded quotes are hidden in the invoice list unless ticked.
- **Optional / alternative lines** (quotations): unselected ones are outside every total (`calculateInvoice`
  filters them, so the main items table, GST and HSN rows never show them) and print in an "Optional items" block;
  in an alternative group exactly one line is selected. Conversion keeps only selected lines and clears the flags.
- **Kind attn.** is a snapshot on the document; picking a party on a new document fills its default ship-to and
  primary contact. Printed in `PartyPanel` (all standard layouts) and the GST party cell. The thermal receipt
  layout does not print it.
- **Backorders**: free stock is godown-aware (line `godown_id`), converted with `lineFactor`. Free stock is not
  reduced by other open orders' reservations.

## Deviations from the PRD

- Docs file is `docs/features/sales-r2.md` (PRD name).
- Backorder rows live in `back-to-back.ts`, not `sales-orders.ts` (no edit there).
- "Khata reminder stepper for the run's parties" opens the existing balance stepper for all parties (the
  stepper has no party filter; it is owned by R2-A).
- SO → PO creates the purchase orders directly (no prefill hand-off into `PurchaseOrdersTab`); that tab shows the
  sales-order link and the drop-ship tag.
- Wiring outside owned files (small): `DocumentTimeline` hosts the progress / revisions panels (DocumentActions is
  R2-C's), `CancelDialog` shows the open-PO warning, `store/invoice-defaults.ts` keeps the new fields,
  `pages/Transactions.tsx` duplicate drops revision / stage marks.

## Verify with your CA

Consolidated in `docs/CA_REVIEW.md` (ids T6); answers are logged there with the date and the PR.

- Time of supply for stage invoices of continuous services / works contracts (Sec 13, Sec 31(5)); the date is the user's.
- e-Invoice applicability shown in the batch preview (B2B party + AATO over the mandate on the date) and the IRP
  30-day window for many stage / batch invoices.
- Drop-ship (bill-to / ship-to) e-Way bill and place of supply for the supplier's invoice.
- Whether an optional item accepted later needs a fresh quotation revision for the client's records.
