# Advances, receipt vouchers and GSTR-1 Table 11 (roadmap 5.3)

Money a client pays **before** the invoice. Each advance gets a receipt voucher, GST is worked out on it where the law
says so, and it is later applied to the invoice (fully or in parts) or refunded. Everything here is a **working paper —
verify with your CA**.

| | |
|---|---|
| UI | Receivables → **Advances** tab (`/receivables?tab=advances[&party=<client id or name:…>]`, lazy `src/components/advances/AdvancesTab.tsx`); **Apply advance** in the payment dialog (`ApplyAdvancePanel`, lazy) and a notice in the invoice editor (`creator/AdvanceNotice.tsx`, lazy); "Advance ₹X unadjusted" link on the Clients list; GST reports tabs **Advances 11A** / **Adjusted 11B** |
| Lib | `src/lib/advance-tax.ts` (pure maths shared by every reader), `src/lib/advances.ts` (storage, numbering, apply / refund, vouchers, CSV) |
| Types | `src/types/advances.ts` (`AdvanceRecord`, `AdvanceRefund`, `AdvanceTax`); `Payment.advance_id` (additive) |
| Rules | `ADVANCE_GST_ON_GOODS_RULES` / `ADVANCE_GST_ON_SERVICES_RULES`, `advanceTaxable()` in `src/lib/tax-rules.ts` (date-keyed) |
| Tests | `tests/advances.test.ts`; e2e step "advances: record a service advance…" in `tests/e2e/smoke.mjs` |

## Storage
- New table **`advances`** (`mrchartist_inv_advances`), one `AdvanceRecord` per receipt voucher: number, date, client
  snapshot (id, name, company, GSTIN, address, state), place of supply, goods / services, GST rate, amount received
  (tax-inclusive, INR only), method / reference, description, the **GST snapshot** (`tax`: applies, INTRA / INTER,
  taxable, IGST, CGST, SGST — worked out once when saved), the **issuer snapshot** (`sender`: name, address, GSTIN,
  state of the active profile; no images) and `refunds[]`.
- **Adjustments are not stored twice.** Applying an advance records an ordinary `transactions` row through
  `localDb.payments.record` with `advance_id`, method "Advance adjusted" and the ADV number as reference. That row is
  "the adjustment record": deleting the invoice, removing the payment in the payment dialog, or cancelling the invoice
  (an adjustment counts only while its invoice is issued) gives the advance back automatically.
- In `RECORD_TABLES` / `ID_TABLES` of `src/lib/backup.ts` (a restore refuses a damaged table) and listed in
  `docs/ARCHITECTURE.md`. No migration: the table is new and `advance_id` is additive.

## Numbering
- Receipt vouchers `ADV/FY25-26/0001`, refund vouchers `RFV/FY25-26/0001`: one series each per Indian FY (1 Apr – 31 Mar,
  bare dates parsed as local days): the highest number already issued or the `series_counters` high-water mark,
  whichever is higher, + 1 — so a deleted voucher's number is never reused, not even the latest one. Editing an
  advance into another FY gives it the next number of that FY.
- `advanceBalance` also returns `over` (adjusted + refunded beyond the advance; `open` is clamped at zero, so `over`
  is what reveals an over-adjustment). Reinstating a cancelled invoice whose adjustment would over-adjust its advance
  is refused (`documents.reinstateIssues`).
- Adjustment rows take **no** `RCPT/…` payment-receipt number (`receiptNumber` skips `advance_id`), because the advance
  already has its own receipt voucher.

## GST on an advance
- **Services:** tax is due on receipt (CGST Act Sec 13(2): earlier of invoice and payment).
- **Goods:** none since **15 Nov 2017** (Notification 66/2017-CT); taxed from 1 Jul 2017 to 14 Nov 2017. Notification
  40/2017-CT (small taxpayers from 13 Oct 2017) and the composition-dealer exception are not modelled.
- **Export (POS 96/99) or rate 0:** no tax (LUT assumed).
- **Maths (tax-inclusive):** tax = amount × rate ÷ (100 + rate), rounded to the paisa; CGST = half (rounded), SGST = the
  rest when the place of supply is the supplier's state (from the snapshotted profile's state code or GSTIN), else IGST.
  An unknown supplier state is treated as intra-state. Cess is not modelled.
- **Release on adjustment / refund:** each adjustment or refund releases its share of the advance's tax, cut on the
  running total (`share(c) = head × c ÷ amount`, the last movement takes the exact remainder) so no paisa is left behind.
- Rule 50 provisos (18% when the rate is not known, inter-state when the nature of supply is not known) are left to the
  user: pick the rate and place of supply on the form.

## Applying an advance
- From the advance (**Apply** → choose one of the client's issued rupee invoices with a balance) or from the invoice
  (**Record payment → Apply advance**, or the editor notice "Apply ₹X to this invoice", which applies the client's
  open advances oldest first up to the balance).
- Checks: same party (client id, else case-folded name), invoice issued (not draft / cancelled), INR, amount ≤ the
  advance's unadjusted balance and ≤ the invoice balance (net of TDS), date not before the advance or the invoice and
  not in the future. Default date: the later of the invoice date and the advance date (normally the invoice date, so
  Table 11B lands in the invoice's month).
- **Period lock:** the adjustment date is checked (it changes Table 11B of that month) and the payments API checks the
  invoice ('pay'). Saving, editing and deleting an advance check its own date (old and new); refunds check the refund
  date. Audit: entity `advance` (create / edit / delete / adjusted / refunded rows) plus the usual `payment` row.
- An advance that has been adjusted or refunded cannot be edited or deleted; remove those entries first.
- **Local roles (6.21):** recording, editing, deleting, applying and refunding need `payment.record`
  (`requireAccess` in `advances.ts`; owner and clerk). A viewer sees the register and prints vouchers; the buttons are
  hidden for them.

## Refund (Rule 51)
Refund of an unadjusted balance (no supply made): amount ≤ unadjusted, date on or after the advance. Kept on the advance
(`refunds[]`), printable Refund Voucher, removable (lock permitting). Its share of the advance's GST is reported with
adjustments in **Table 11B** of the refund month — **an assumption to confirm with your CA** (some practitioners amend
11A instead).

## Vouchers (print)
`advanceVoucherHtml` (Receipt Voucher, Rule 50: supplier name / address / GSTIN, serial number, date, recipient name /
address / GSTIN, description, amount, rate and CGST / SGST / IGST, place of supply with state, reverse charge "No",
signature line) and `refundVoucherHtml` (Refund Voucher, Rule 51, with the receipt voucher number and date). Both are
complete, script-free HTML documents with every value escaped, printed from a plain window (CSP-safe); a blocked
pop-up saves the page as HTML.

## GSTR-1 Table 11 and GSTR-3B
- `advanceTaxEvents()` → `BuildOptions.advances` of `buildGstReport`. `advanceTables()` keeps taxed movements dated in
  the period (filer-GSTIN filter on the voucher's sender GSTIN, like invoices) and groups them by place of supply ×
  rate: **11A** (`gstr1.at`) = advances received; **11B** (`gstr1.txpd`) = adjusted + refunded. Both are absent when
  empty, so reports without advances keep their exact shape.
- **JSON** (`buildGstr1Json`): `at` / `txpd` = `[{ pos, sply_ty, itms: [{ rt, ad_amt, iamt | camt + samt, csamt }] }]`
  with `ad_amt` = the advance **excluding** tax. Layout set in `ADVANCE_JSON_LAYOUT` (`gstr-json.ts`) and marked
  **unverified** against the live offline-tool schema. CSV (`sectionCsv(r, 'at' | 'txpd')`) and .xlsx per tab.
- Advances received and invoiced in the same month are reported gross in both 11A and 11B (GSTN allows leaving them out;
  the net liability is identical).
- **GSTR-3B:** the portal folds Table 11 into 3.1(a), so `buildGstr3b` adds 11A and subtracts 11B in 3.1(a) (taxable and
  tax) and therefore in the 6.1 liability; `gstr3b.advances` holds the two parts, shown as "of which" rows in the 3B CSV
  and as a note on the 3B tab. **3.2 (inter-state to unregistered) is not adjusted for advances.**
- **GSTR-9:** Table **4F** = Table 11A − 11B over the year (net advances on which tax was paid without an invoice).
- GSTR-1 `totals` and the page's tiles stay document-only (advances excluded); the printable summary lists 11A / 11B rows.

## Ledger (double entry)
New default accounts (constants, nothing stored): **2410 Advances from customers** (Other current liabilities) and
**2380 GST paid on advances received** (Duties & taxes; a debit balance shows under short-term loans & advances).

| Movement | Debit | Credit |
|---|---|---|
| Advance received (Receipt) | Cash / Bank — amount | Advances from customers (party) — amount |
| … GST on a service advance | GST paid on advances — tax | Output CGST / SGST / IGST |
| Advance adjusted (Journal, the `advance_id` payment) | Advances from customers — amount (+ TDS receivable if this row settles the customer's TDS) | Sundry debtors (party) |
| … its share of the GST | Output CGST / SGST / IGST | GST paid on advances |
| Advance refunded (Payment) | Advances from customers — amount | Cash / Bank |
| … its share of the GST | Output heads | GST paid on advances |

Why this treatment: the advance stays a liability at the gross amount received; the tax paid on it is a recoverable
asset until the invoice books its own full output GST, when the reversal stops the tax being counted twice. After full
adjustment both new accounts are nil and Output GST equals the invoice's GST. Every voucher balances in paise and the
trial balance agrees (tested). The `advance_id` payment never posts a cash receipt.

**Books (single-entry views):** the Cash / Bank book shows the advance as a receipt on its date and a refund as a
payment; the adjustment moves no money. Cash-basis P&L recognises the income when the advance is applied to the invoice
(the adjustment row). The indicative balance sheet counts the advance (less refunds) against receivables; GST on
advances is left out there because it nets to nil with its asset.

## Receivables
`buildReceivables({ …, advances })`: the advance is a credit on the party ledger (dated when received), a refund a
debit, and the adjustment appears as an information line (no amount) while it settles the bill. The party's "Credits"
include the unadjusted balance; net = open bills − credit notes − advances and still equals the ledger closing balance
(tested). Statements (print, CSV, text) therefore show advances.

Other readers skip adjustment rows: bank-reconciliation candidates, payment-mode report, cash-forecast collection lags.

## Tally XML
Advance → **Receipt** (Dr Bank / Cash, Cr party with bill allocation type **Advance**, name = ADV number); refund →
**Payment** (Dr party "Agst Ref" the ADV number, Cr Bank / Cash). Applying the advance is bill-wise matching inside
Tally, so no voucher is sent for the adjustment. **Not exported:** GST on advances (record it with Tally's own advance
receipt / stat-adjustment feature); if an adjustment row is the one that settles a customer's TDS, a warning asks you to
post that TDS journal in Tally.

## Limits / not done
- INR only; one advance can be applied to many invoices and an invoice can take many advances, but always for the same
  party. Advances are not matched to bank-statement lines yet.
- Cess, composition dealers, Notification 40/2017-CT, Rule 50's default-rate provisos and 3.2 are not modelled.
- Advance tax is shown per voucher; there is no separate "GST on advance" payment voucher — the 3B liability includes it.


- With several bank accounts (multi-account BRS) an advance and each refund carry `bank_account_id` ("Received into" / "Paid from" picker, never for cash), so per-account bank balances include them.

## 8G additions
- **Request deposit** from a schedule's first instalment records an advance here (`saveAdvance`); the editor banner can now apply **part** of the open advances. See `docs/features/invoicing-ux.md` § 8.100.
