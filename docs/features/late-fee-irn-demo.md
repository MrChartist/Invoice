# IRN + signed QR on paper, late-payment interest, sample data

Three small modules closing gaps against Tally Prime / Zoho Books / Vyapar. All offline, no new dependencies, additive-only persisted fields.

## 1. IRN, Ack and signed QR on every template

**Done and live; nothing to wire.** `TemplateEngine` looks the invoice up in `einvoice_meta` by `invoice.id` and, when details exist, appends one `IrnBlock` after the layout body. Because it is added by the engine, all 26 templates (classic, corporate, minimal, centered, ink, ember, letterhead, bilingual, gst, receipt) and all papers (A4, A5, 80 mm thermal) get it, and no layout file changed.

| Piece | Where |
| --- | --- |
| Decision logic (pure, unit-tested) | `src/lib/einvoice-print.ts`: `buildIrnPrint(meta)`, `irnQrSize(paper)`, `resolveEInvoiceMeta(id)`, `MAX_SIGNED_QR_BYTES` |
| Rendering | `src/components/templates/parts/IrnBlock.tsx` + `.irn*` rules at the end of `invoice-paper.module.css` |
| Engine hook | `TemplateEngine`: optional prop `einvoiceMeta?: EInvoiceMeta \| null` (omit = look up by id, `null` = print none) |

Behaviour:

- Prints a ruled strip at the foot of the paper: signed QR (left), then `IRN`, `Ack No` / `Ack Date`, and `e-Way Bill No` (+ "valid upto") lines. Thermal / receipt layouts stack it centred and use a 150 px QR; A5 uses 104 px; A4 118 px. The UPI "scan to pay" QR stays in the payment block above it, so the two never touch.
- Nothing stored, only blanks, or only transport details (vehicle, distance): the block is not rendered at all, so the invoice is byte-for-byte what it was before.
- IRN without a signed QR prints the text only. A signed QR above 2,900 bytes (the QR limit) is skipped instead of crashing the render. An e-Way number alone (no IRN) prints just that line.
- Unsaved invoices (no `id`) never match a row.
- The lookup caches the parsed table keyed on its raw string, so re-rendering on every keystroke does not re-parse it.
- The QR uses `QRCodeSVG` at error-correction level L (the signed payload is about 1.2 to 1.8 kB), crisp at any print scale.

Layout caveat: the block is about 130 px tall. An A4 invoice that already fills more than roughly 85 % of the page (a long table, several notes) gets the block on page 2 (kept whole, never split). Checked on the 26 templates with the demo invoices: 23 of 26 stay on one A4 page with a 3-line invoice; GST, bilingual and letterhead go to two pages when the invoice is nearly full. The PDF export slices at page height the same way.

### Bug fixed on the way: IGST invoices printed `CGST 0.00 / SGST 0.00`

`paper-helpers.isTaxed()` said "CGST+SGST is being charged" for every mode except NONE / SINGLE, so an inter-state (IGST) invoice printed zero CGST and SGST rows, no IGST row and a CGST/SGST breakup table of zeros, in every template. It now requires `gst_mode === 'CGST_SGST'`; IGST invoices print the IGST line/column. Covered in `tests/templates.test.ts`.

## 2. Late-payment interest (informational)

`src/lib/interest.ts` (pure maths + its own storage key), UI in `src/components/interest/`.

Legal hygiene, enforced in code and wording:

- Default config is **off with no rate**. A rate is never assumed or pre-filled.
- Every surface says the figure is based on the rate the user entered to match their own invoice terms, is not part of the invoice total, and that whether it can be charged depends on their agreement.
- The interest is never added to a total. `buildInterestItem()` returns an `InvoiceItem` only when the user clicks.
- Reminders mention the accrued amount only when the config is on **and** the invoice's own terms/notes mention interest or late fees (`termsMentionInterest`); otherwise nothing is said.
- Tax on the "Interest" line defaults to 0 %. Whether GST applies to late fees is for the user's CA (option `taxRate`).

Maths (`computeInterest(input, config, asOf)`):

- Principal = `total - tds_amount`. Only `INVOICE` / `TAX_INVOICE` that are not Draft / Cancelled qualify (`reason` says why not).
- Interest starts the day after `due_date + grace_days` (grace is interest-free, not back-dated).
- Day `t` accrues on the balance after every payment or credit note dated before `t`; paying on day D therefore costs interest through D. Each interval at a different balance is a row in `segments` (`from`, `to`, `days`, `balance`, `amount`); the total is the sum of the rounded rows.
- `annual`: rate % a year, simple, 365-day year. `monthly_flat`: rate % a month, pro-rated by day on a 30-day month. `compounding` (off) lets interest earn interest daily. `cap_percent` stops the total at that % of the principal (`capped`, `cap_amount`).
- Settled invoices stop on the day the balance reaches zero (`settled`, `settled_on`), so the figure is frozen whatever "today" is. Credit notes count from their issue date. A payment dated after `asOf` is not applied. Calendar-day arithmetic, independent of time zone; capped at 3,660 days.

Storage: key `mrchartist_inv_late_fee` (included in backups automatically): `{ enabled, mode: 'annual'|'monthly_flat', rate, grace_days, cap_percent?, compounding?, profiles?: { [profileId]: partial } }`.
`getLateFeeConfig(profileId?)` returns the global default overlaid by that profile's override; `saveLateFeeConfig(cfg, profileId?)`, `clearProfileLateFee(id)`, `hasProfileLateFee(id)`, `sanitizeLateFee()` (hand-edited backups are coerced, never trusted).

Other exports: `accruedInterestFor(invoice, asOf?)` (reads payments + credit notes from storage), `interestInputFor(invoice, payments, links, allInvoices)`, `interestForReminder(invoice)`, `describeBasis(config)`, `INTEREST_DISCLAIMER`.

### Wiring for the lead

1. Settings, Defaults tab (`src/components/settings/DefaultsPanel.tsx` or `pages/Settings.tsx`):

   ```tsx
   import { LateFeeSettings } from '../components/interest';
   // inside the Defaults tab, under "New document defaults":
   <LateFeeSettings profileId={activeProfile?.id} profileName={activeProfile?.companyName} />
   // or omit profileId for a single global rule with no per-profile override checkbox
   ```

   It saves on every change; it does not touch `AppSettings`.

2. Overdue chip / panel on an invoice (receivables rows, invoice preview toolbar, invoice detail):

   ```tsx
   import { InterestChip, OverdueInterest } from '../components/interest';
   <InterestChip invoice={invoice} />          // "Interest accrued ₹X (as of today)", renders nothing when there is none
   <OverdueInterest invoice={invoice} onAddLine={addInterestLine} />  // chip + how it was worked out + wording
   ```

   Both render nothing unless late fees are enabled, a rate is set and interest has accrued. `useInterest(invoice, asOf?)` gives the raw `InterestResult`.

3. "Add as an Interest line" (explicit click only). The handler should start a **new** invoice, never edit the overdue one:

   ```tsx
   const addInterestLine = (item: InvoiceItem) => {
     const s = useInvoiceStore.getState();
     s.newDraft('INVOICE');
     s.setClient(invoice.client);
     const blank = useInvoiceStore.getState().items[0];
     s.applyCatalogItem(blank.id, item);   // name, description, rate, quantity 1, tax_rate 0
     navigate('/invoice');
   };
   ```

4. Reminders: already wired in `src/components/share/ReminderModal.tsx` (`buildReminder(..., today, { interestAccrued: interestForReminder(invoice) })`). `reminders.ts` gained an optional 5th parameter `extras?: ReminderExtras`; other callers are unchanged. With terms that mention interest and an accrued amount, the final notice reads "As per the terms on the invoice, late-payment interest of ₹X has accrued as of <date>. The balance above does not include it." (English and Hinglish); with no amount it keeps the generic "late-payment charges may apply" line; with terms silent it says nothing.

## 3. Sample data (onboarding)

`src/lib/demo-data.ts`, UI in `src/components/demo/`.

Contents (built for "today", deterministic ids/values): a "Sample Studio (demo)" profile (fictitious GSTIN/PAN, `sample@demo` UPI, `DEMO` prefix), 6 clients across 5 states with checksum-valid fake GSTINs, 12 catalogue items, 25 tax invoices over the last six months (paid on time, paid late, split payments, part-paid, overdue, sent, one draft, one cancelled; terms mention 18 % interest on every second one), 19 payments, one credit note (sales return, linked in `doc_links`), 2 vendors, 8 purchases/expenses with payments, and a monthly retainer schedule whose first run is next month (nothing is auto-generated).

Contract:

- Every row carries `demo: true` (profile, clients, items, invoices, payments, doc_links, vendors, purchases, purchase payments, schedule). `removeDemoData()` deletes exactly those plus invoices generated by the demo schedule (`recurring_id`), their payments, links, e-invoice meta and reminder-log rows. Real data is byte-identical afterwards (tested).
- Demo documents use their own number series (`DEMO/FY26-27/0001`, `DEMOCN/...`), so real numbering never moves.
- Goes through `localDb.invoices.save` with totals from `invoice-calc`; the clients/catalogue tables are then replaced by "your rows + demo rows" so the save side-effects cannot leave un-marked rows or overwrite a real client with the same name.
- `loadDemoData({ confirm?, today? })` returns `{ ok: false, reason: 'has_real_data' }` when the user has their own invoices unless `confirm: true`, and `{ ok: false, reason: 'already_loaded' }` on a second call (changes nothing). A failed load rolls back.
- The demo profile becomes active only when the active profile is still an empty starter; a user with a real profile keeps it.
- `demoStatus()` -> `{ loaded, counts, realInvoices }`; `isDemo(row)`; `buildDemoDataset(today)` is pure.

UI:

- `SampleDataCard` is already mounted in `DataPanel` (Settings, Data & backup): "Try with sample data" / "Remove sample data", each behind a confirm dialog (the add dialog names the user's own invoice count when there are some). After a change it reloads the page, because Settings keeps its own in-memory copy of the profiles.
- `DemoNotice` for the Dashboard (not mounted; lead to wire):

  ```tsx
  import { DemoNotice } from '../components/demo';
  // top of the Dashboard page content:
  <DemoNotice />                 // banner: "Demo data ... Remove sample data"
  // or <DemoNotice compact />   // small "Demo data" pill for headers
  ```

  Renders nothing when no demo rows exist.

Notes for the lead: the demo profile has bank/UPI details but `settings.onboarded` is left alone, so the Dashboard "Add your business & payment details" checklist item stays open until the user enters their own. Editing a demo invoice keeps its `demo` flag (it is still sample data and is removed with the rest). `purchases` is only read by id/`demo` when removing, so no `purchase-contract` entry is needed.

## Tests

`tests/interest.test.ts` (20), `tests/demo-data.test.ts` (10), `tests/templates.test.ts` (9), plus one new case in `tests/reminders.test.ts`. Template tests run on the pure `einvoice-print` helper, the real QR encoder (`qrcode.react` + `react-dom/server`, no JSX) and the engine wiring, because Node's type-stripping cannot load `.tsx` / CSS modules.

Browser checks (Playwright, Chromium): all 26 templates x A4 / A5 / thermal with IRN present (no horizontal overflow, block inside the paper, last child, no overlap with the UPI QR), the same 78 without IRN (no block), unsaved invoice (no block), `page.pdf()` page counts with and without IRN, and the new UI at 1440 and 390 px in light and dark.
