# e-Invoice (IRP) and e-Way Bill — offline JSON generators

Generates the JSON files a taxpayer uploads to the GST e-Invoice (IRP) and e-Way Bill portals,
checks them first, and records what the portals return. **The app never calls a GST portal.**

## Surface

- Route: none. It is a modal opened from an invoice (Invoices list row action, and/or the invoice preview toolbar).
- Nav label: not a nav item. Button label "e-Invoice / e-Way", suggested lucide icon `FileJson`.
- Table: `einvoice_meta` (`mrchartist_inv_einvoice_meta`), one row per invoice, additive only.

## Exported symbols

`src/lib/einvoice.ts`
- `buildEInvoice(record, options?) -> { payload, assumptions }` NIC schema v1.1 for one invoice.
- `buildEInvoiceBulk(payloads)`, `stringifyEInvoice(payloadOrArray)` (always emits a JSON array, accepted by the IRP bulk tool). Bulk selection with preflight: `src/lib/einvoice-bulk.ts` (below).
- `mapUnitToUqc`, `portalUqc` (units-master UQC first, WP-8), `toNicDate`, `parseIsoDate`, `splitAddress`, `normalisePhone`, `DOC_NO_REGEX`, `UQC_CODES`.
- Meta: `EInvoiceMeta`, `getEInvoiceMeta(invoiceId)`, `getAllEInvoiceMeta()`, `saveEInvoiceMeta(meta)`, `deleteEInvoiceMeta(id)`, `upsertMeta(rows, meta)` (pure), `validateMeta(meta)`.

`src/lib/eway.ts`
- `buildEway(record, { transport, shipFrom, shipTo, fallbackSender }) -> { payload, bill, assumptions, skippedServiceLines }` (version `1.0.0621`, `billLists`).
- `buildEwayBulk(bills)`, `stringifyEway(payload)`, `normaliseVehicle`, `VEHICLE_REGEX`, `EWAY_THRESHOLD` (50000).

`src/lib/einvoice-validate.ts`
- `preflightEInvoice(record, options) -> { errors, warnings, ready, payload }`
- `preflightEway(record, options) -> { errors, warnings, ready, bill, skippedServiceLines }`
- `validateEInvoice(payload, record?, { now })`, `validateEway(bill, record?, ...)` for already-built payloads.
- Each issue is `{ severity, code, field, message }`.

`src/components/einvoice` (barrel `index.ts`)
- `EInvoiceModal` props: `{ invoice: InvoiceRecord; open: boolean; onClose: () => void }`. State is created fresh each time it opens.
- `EInvoiceButton` props: `{ invoice: InvoiceRecord; label?: string }` — button plus modal in one.
- `ReadinessList`, and re-exports of the meta helpers.

## Mapping notes

- Supply type is automatic: `B2B`, or `EXPWP`/`EXPWOP` when place of supply is `99` (IGST present or not). SEZ and deemed export are chosen in the modal.
- Doc type: Tax Invoice / Invoice -> `INV`, Credit Note -> `CRN`. Quotations, proformas and challans are blocked (the IRP does not take them). Debit notes (`DBN`) can be forced through `options.docType`.
- All discounts (line + allocated invoice discount) go into the item `Discount`, so `AssAmt = TotAmt - Discount`. Untaxed shipping + other charges go to `ValDtls.OthChrg`; with `charges_taxable` they are one more taxable item at the principal rate/HSN instead, so AssVal and the tax totals reconcile (see `freight-fx.md`). Foreign-currency invoices are converted to INR at `exchange_rate` (`FX_RATE_MISSING` error without one).
- Hence `GstRt` is the combined rate (18, not 9+9). `IgstOnIntra = Y` is set when IGST is charged though seller state equals place of supply.
- Seller city and PIN are not stored separately in the sender profile: PIN is read from the address text (last 6-digit number) and the city from the last address part that is not a PIN or state. Overrides exist in `options.seller`. Buyer city/PIN use `client.city` / `client.zip`.
- Export: buyer `Gstin = URP`, `Stcd = Pos = 96`, `Pin = 999999`, plus `ExpDtls` (`ForCur`, `CntCode`, port, shipping bill; port / shipping bill default from the invoice's `port_code` / `shipping_bill_no` / `shipping_bill_date`).
- e-Way: services (SAC `99...`) are left out; services-only blocks. Value above Rs 50,000 is the mandatory threshold; at or below it a warning says so. A vehicle number or a transporter GSTIN is required for bulk upload.

## Doc number length (verified)

`INV/FY25-26/0001` is exactly **16 characters**, so the default format fits the IRP limit with no spare room.
A longer per-profile prefix (e.g. `MCHART/FY25-26/0001` = 19) is a blocking error naming the limit. The validator also rejects characters other than letters, digits, `/` and `-`, and a leading `0`, `/` or `-`.
Leading zeros inside the number are fine. Document numbers are upper-cased in the output.

## Wiring snippets for the lead

No route or nav entry is needed. Add the trigger where an invoice is actioned (e.g. the invoice row/preview toolbar):

```tsx
import { EInvoiceButton } from '../components/einvoice';
// ...
<EInvoiceButton invoice={invoice} />
```

or with your own button:

```tsx
import { EInvoiceModal } from '../components/einvoice';
const [einvOpen, setEinvOpen] = useState(false);
<EInvoiceModal invoice={invoice} open={einvOpen} onClose={() => setEinvOpen(false)} />
```

Print IRN + QR on templates later:

```tsx
import { getEInvoiceMeta } from '../../lib/einvoice';
const meta = getEInvoiceMeta(invoice.id);   // { irn, ack_no, ack_date, signed_qr, eway_no, ... } | undefined
// render <QRCodeSVG value={meta.signed_qr} /> (qrcode.react) and meta.irn when present
```

Backup: `einvoice_meta` lives under the `mrchartist_inv_` prefix, so `collectAppData()` already includes it.
Optional cleanup when an invoice is deleted: `deleteEInvoiceMeta(id)`.

## Bulk files and IRP response import (roadmap 6.24)

**GST reports → Bulk e-Invoice** opens a lazy modal (`src/components/einvoice/BulkEInvoiceModal.tsx`) for the period picked on the page.

- **Generate files**: lists the finalised tax invoices, credit and debit notes in the period (B2B / SEZ / export ones without an IRN are pre-ticked). For the ticked ones it builds **one IRP bulk JSON** (array of v1.1 payloads) and **one e-Way bulk JSON** (`billLists`). Every invoice goes through the same preflight as the single dialog (`preflightEInvoice` / `preflightEway`); those with blocking errors are left out and listed with their reasons. Also left out, with a reason: drafts, cancelled documents, quotations etc., documents that already have an IRN / e-Way Bill no. (unless "include" is ticked: the portal rejects duplicates), and a repeated document number in the same file. Credit / debit notes linked to an invoice get it as `PrecDocDtls`. For e-Way, the transport saved with an invoice is used; the shared vehicle / distance / transporter in the dialog fill the rest.
- **Import IRP response**: load the JSON the IRP returned or the bulk tool's result sheet saved as CSV (or paste it). Each row is matched to an invoice by document number (case-insensitive; a repeated number is narrowed by seller GSTIN, then by document date) and IRN, Ack No, Ack date, signed QR and, if present, e-Way Bill no. / date / valid-until are merged into its `einvoice_meta` row (transport details already saved are kept). The result lists rows saved, not matched, and rejected / skipped (IRP error or failed status, no IRN, bad IRN / Ack / EWB format, or an invoice that already has a different IRN unless "replace" is ticked).

### Response format: assumptions

The bulk-response layout is not published as a stable schema, so the reader is tolerant (`src/lib/einvoice-bulk.ts`):

- JSON: an array of results, an object holding such an array under any key, or one object. A result may wrap its fields in `Data` / `data` (object or JSON string, as the IRP API does). `ErrorDetails: [{ ErrorCode, ErrorMessage }]` is read as the error.
- CSV: one row per document under a header row.
- Field names are matched ignoring case, spaces and punctuation: `DocNo` / `Doc No` / `Document Number` / `Invoice No` / `DocDtls.No`, `DocDt`, `SellerGstin`, `Irn`, `AckNo`, `AckDt`, `SignedQRCode`, `EwbNo`, `EwbDt`, `EwbValidTill` / `Valid Upto`, `Status`, `ErrorMessage` / `Error Details` / `Remarks`.
- A row without a document number (the IRP API response has none) takes it from the signed QR: the middle part of the JWT is base64url JSON whose `data` holds `DocNo`, `DocDt`, `SellerGstin` and `Irn`.
- Status `0`, `failed`, `failure`, `error`, `rejected`, `cancelled` / `CNL`, or an error with no IRN, means the row is not saved.
- Dates `dd/mm/yyyy [hh:mm[:ss]] [AM|PM]` and ISO are stored as `yyyy-mm-dd hh:mm:ss` (Ack date) or `yyyy-mm-dd` (e-Way dates).

Exported symbols: `bulkCandidates`, `buildBulkEInvoice`, `buildBulkEway`, `parseIrpResponse`, `applyIrpResponse` (pure), `importIrpResponse` (reads `invoices` + `einvoice_meta`, writes `einvoice_meta` once, only when something matched), `decodeSignedQr`, `normaliseIrpDate`. Tests: `tests/einvoice-bulk.test.ts`.

`einvoice_meta` is now also checked by backup validation (`RECORD_TABLES` in `backup.ts`): a restore refuses a file where it is not a list of objects.

## Limits worth knowing

- GSTIN checks are structure + checksum; registration status is not verified (offline).
- NIC may change schema details; version strings are in `EInvoicePayload.Version` and `EWAY_VERSION`.
- WP-6 (`gst-setoff.md`): `ShipDtls` from `invoice.ship_to`, `DispDtls` from the `dispatch` option, `PayDtls` from the sender's bank details / terms / due date (opt out: `withPayment: false`) and `EwbDtls` from `invoice.transport` (opt out: `withEwb: false`) are now generated. Field names / limits per NIC schema v1.1 as best known — verify. The e-Invoice modal has no dispatch-from form yet (option only).
- Not generated: advance/ref docs other than preceding invoice.
- 7R (7.126): **consolidated e-Way Bill (EWB-02)** JSON from several EWB numbers for one vehicle — GST reports tab "Consolidated e-Way" (`src/lib/eway-consolidated.ts`; numbers picked from `einvoice_meta.eway_no` or pasted, 12-digit check, vehicle / transport document checks, expired bills flagged). Layout unverified — see `gst-setoff.md`.

## 8D: IRP 30-day window and the cancel flow (8.60, 8.64)

**Reporting window** (`src/lib/gst-guards.ts`, lazy). `IRP_REPORTING_WINDOW_RULES` is keyed by the reporting day:

| From | AATO | Days | Documents | Source |
| --- | --- | --- | --- | --- |
| 1 Nov 2023 | ≥ ₹100 crore | 30 | invoices | GSTN advisory 13 Sep 2023 (notes exclusion unverified) |
| 1 Apr 2025 | ≥ ₹10 crore | 30 | invoices, credit and debit notes | GSTN advisory 5 Nov 2024 |

Day 1 is the document date, so a document of 1 April must be reported by 30 April (GSTN's own example); `irpWindow(doc, aato, today)` returns `{ deadline, day, daysLeft, stage: open | day20 | day27 | closed }`.
The AATO is the additive profile field `SenderProfile.einvoice_aato` (₹), entered in the e-Invoice dialog (shown when unknown) or on GST reports → GST guards; the live profile matching the document's sender GSTIN wins over the snapshot (AATO changes every year). Unknown AATO = no window shown.

- e-Invoice dialog: countdown banner on the e-Invoice tab (`IrpWindowNote`); bulk list: a "N d left" / "window closed" pill next to the date (`IrpWindowPill`).
- Bell (`src/lib/gst-guard-alerts.ts`, loaded lazily by `NotificationBell` once an AATO, an e-invoice row or a tax invoice older than two years exists): documents still without an IRN on **day 20** (warning) and **day 27** (critical), and for 7 days after the window closed.
- e-invoicing mandate thresholds (`EINVOICE_MANDATE_RULES`, by document date, "exceeds"): ₹500 cr (1 Oct 2020) → 100 → 50 → 20 → 10 → ₹5 crore from 1 Aug 2023 (Notification 10/2023-CT). Used by the exceptions list.

**Cancel flow** (`src/lib/einvoice-cancel.ts`, `src/components/einvoice/EinvCancelPanel.tsx`). The cancel dialog of a document with an IRN or e-Way Bill loads the panel lazily:

- deadlines: IRN = Ack date + 24 h; e-Way Bill = e-Way date (+ time when known; date only → counted from 00:00, flagged approximate) + 24 h;
- "Prepare e-Way + IRN cancel JSON" downloads `ewb_cancel_<no>.json` (`{ ewbNo, cancelRsnCode, cancelRmrk }`) then `irn_cancel_<no>.json` (`{ Irn, CnlRsn, CnlRem }`) in the NIC API shape (the app never calls a portal) — the e-Way Bill first, since an active EWB generated with the IRN blocks the IRN cancellation;
- after the window: IRN → issue a credit note (it stays valid); EWB → the recipient may reject within 72 h;
- status on the meta row (additive): `irn_cancel` / `ewb_cancel` = `{ status: prepared | done, reason, remark, prepared_at, done_on? }`; the e-Invoice dialog header shows "portal cancellation pending / cancelled on the portals" (`cancelState`).
- Reason codes: IRN 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 others; EWB 1 duplicate, 2 order cancelled, 3 data entry mistake, 4 others. Field names / codes as best known — verify.

Tests: `tests/gst-guards-8d.test.ts`.
