# QA report: sales-ui (Dashboard, Invoice editor, Ledger, Clients, shared UI)

Verified in headless Chromium against the production build at 1440 / 1024 / 768 / 390 px, light and dark, with seeded data
(6 invoices incl. overdue, partial, paid, a quotation, a duplicate) and with a fresh empty context.

## Verified working
- Editor: save validation messages, Ctrl+S, draft autosave and "Restore draft" banner (also after reload), IGST / CGST+SGST / no-tax,
  per-line HSN, discount %, flat discount in rupees, TDS/TCS panel, amount received, Convert menu, credit-note dialog.
- Ledger: search, filters, "No matches" state, CSV export, duplicate, delete confirm (Escape closes), payment modal (overpay, zero,
  partial with correct pre-fill, remove payment, full payment closes the modal).
- Numbers agree between Dashboard and Invoices: billed, received, outstanding, overdue (checked after payments were added and removed).
- No horizontal scroll and no page errors at any tested width.

## Defects found and fixed
1. Items table switched to the stacked layout at desktop width (container query threshold was above the real column width). Rewrote
   the breakpoints: full grid at 920px and up, two-row labelled mini-form between 560 and 920, three-per-row below 560; bordered inputs
   and 40px targets in stacked mode.
2. Toasts covered the mobile Save bar. Toast now lifts by `--bottom-bar-h`, set by the editor on small screens; page gets bottom padding.
3. `Modal` re-ran its focus effect when the parent passed an inline `onClose` (focus jumped while typing). `onClose` is now read from a ref.
4. `Modal` focused the Close button first. Now focuses `[data-autofocus]`/`[autofocus]`, else the first form field (pickers land in search).
5. `Modal` never returned focus to the trigger when a child used `autoFocus`. Uses the last element focused outside a dialog.
6. Content behind a modal was still reachable by assistive tech and Tab. Siblings of the dialog are now `inert` while open.
7. Ledger "Unpaid / Overdue / Paid" counts included quotations; they now only count revenue documents, so tab counts match the stat cards.
8. Ledger filter used `role=tab` without panels or arrow-key support; now a button group with `aria-pressed`.
9. Phone layouts: Ledger, Clients and Dashboard "Recent documents" tables scrolled sideways. They now render as cards under 640px.
10. Stat cards stacked one per row on phones; now two per row.
11. Client form validation error rendered at the bottom of a scrolling dialog (invisible on phones). Moved to the top with `role=alert`.
12. Payment modal: float residue in the pre-filled balance (now `round2`), error is `role=alert`, remove-payment button names the amount.
13. Advanced tax panel: unlabeled selects/inputs got `aria-label`s, rate inputs clamp to 0-100, added chevron, focus ring and 44px phone targets.
14. GST treatment select truncated its label ("CGST + SGST (same st"); labels shortened. Due-date presets no longer orphan "45d"
    ("Now", 40px chips on phones). "Leave blank to number automatically" hint hidden when editing a numbered document.
15. Currency/Status stay two-up on phones (shorter form).
16. `beforeunload` warning when a saved document has unsaved edits (new documents already autosave as drafts).
17. Removed hover lift on non-interactive stat cards (looked clickable).

## Found, not fixed (outside my files)
- Sidebar highlights "New invoice" while editing an existing invoice (`/invoice/:id`); expected "Invoices". Layout file.
- Dashboard shows the same overdue invoices twice ("Payments to chase" from `RemindersPanel`, then "Needs attention").
- In-app navigation away from a dirty saved document has no confirm (BrowserRouter has no `useBlocker`); edits stay in the store only.
- Dashboard empty chart shows ghost gridlines before any data (cosmetic, mine to polish later).

## Visual changes
Items table redesign (above), 2-up stat grid on phones, card rows for tables on phones, shorter GST labels, chevron on advanced-tax summary.
