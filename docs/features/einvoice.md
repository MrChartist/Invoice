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
- `buildEInvoiceBulk(payloads)`, `stringifyEInvoice(payloadOrArray)` (always emits a JSON array, accepted by the IRP bulk tool).
- `mapUnitToUqc`, `toNicDate`, `parseIsoDate`, `splitAddress`, `normalisePhone`, `DOC_NO_REGEX`, `UQC_CODES`.
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
- All discounts (line + allocated invoice discount) go into the item `Discount`, so `AssAmt = TotAmt - Discount`. Shipping + other charges go to `ValDtls.OthChrg` (untaxed, matching the app's calc order).
- Hence `GstRt` is the combined rate (18, not 9+9). `IgstOnIntra = Y` is set when IGST is charged though seller state equals place of supply.
- Seller city and PIN are not stored separately in the sender profile: PIN is read from the address text (last 6-digit number) and the city from the last address part that is not a PIN or state. Overrides exist in `options.seller`. Buyer city/PIN use `client.city` / `client.zip`.
- Export: buyer `Gstin = URP`, `Stcd = Pos = 96`, `Pin = 999999`, plus `ExpDtls` (`ForCur`, `CntCode`, port, shipping bill).
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

## Limits worth knowing

- GSTIN checks are structure + checksum; registration status is not verified (offline).
- NIC may change schema details; version strings are in `EInvoicePayload.Version` and `EWAY_VERSION`.
- Not generated: payment details (`PayDtls`), ship-to (`ShipDtls`), dispatch-from (`DispDtls`) on the e-Invoice, cess, advance/ref docs other than preceding invoice.
