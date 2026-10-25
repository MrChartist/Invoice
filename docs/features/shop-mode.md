# Shop mode, quick create and the first-run wizard (8H, roadmap 8.120, 8.128, 8.129)

Status: **done**. A kirana counter and a CA firm open the same app but see a sidebar sized to them.

| Piece | Where | Tests |
|---|---|---|
| Modules, path → module map, `enabledModules`, `isPathVisible` (shell, ~0.2 kB gz) | `src/lib/shop-mode.ts` | `tests/reach-8h.test.ts` |
| Business types, presets, tile map, business defaults | `src/lib/shop-presets.ts` (lazy screens only) | same |
| Sidebar filter | `src/layouts/DashboardLayout.tsx` (`navGroups`) | e2e "8H" step |
| Settings → Defaults → Shop mode (type, modules, "Show all features") | `src/components/settings/ShopModePanel.tsx` (lazy) | e2e |
| Dashboard tiles filter | `src/components/dashboard/DashboardTiles.tsx` (`isTileVisible`) | unit |
| Quick create (phone "+", Dashboard row) | `src/lib/quick-create.ts`, `src/components/layout/QuickCreateSheet.tsx`, `src/components/dashboard/DashboardStart.tsx` | unit + e2e at 390 px |
| Wizard step 0 (language + business type), composition, Demo company | `src/lib/onboarding.ts`, `src/components/onboarding/{SetupWizard.tsx,demo-company.ts}` | unit + e2e |
| Checklist v2 | `src/lib/checklist.ts`, `DashboardStart.tsx` | unit |

## Shop mode

- **Stored on the company** (`mrchartist_inv_settings`): additive `business_type` and `modules`. It is backed up, synced
  and per company like every setting. **Absent `modules` = every module**, so existing companies see exactly what they
  saw before; nothing is migrated.
- **Modules**: `pos`, `recurring`, `time`, `purchases`, `inventory` (incl. manufacturing), `accounts` (Books, Gateway,
  Accounts Info), `banking` (Reconcile, Cheques), `tds`, `payroll`, `reports`, `gst` (GST reports, Exports), `loans`,
  `design`. Invoices, Clients, Receivables, the Dashboard and Settings are always shown.
- **Presets**: Kirana / retail = POS, purchases, inventory, reports · Wholesale / distributor = purchases, inventory,
  books, banking, reports, GST, TDS, loans · Services / freelancer = recurring, time, purchases, reports, GST, TDS,
  design · Manufacturer = purchases, inventory, books, banking, reports, GST, TDS, payroll, loans · CA / full = all.
  Modules can be ticked one by one after picking a type.
- **Progressive disclosure, never removal**: only the sidebar and Dashboard tiles are filtered. Every screen stays
  reachable through Ctrl+K (the palette lists all `NAV_ITEMS`), its URL / bookmarks and the Gateway. "Show all features"
  clears the filter. A path the table does not know (a new screen) is always shown.
- **Data-driven shell**: the sidebar filter is one table lookup per item; the business-type list, presets and tile map
  live in `shop-presets.ts`, loaded only by the wizard, Settings and the tiles. Settings fires `mrc:shop-mode` after a
  save so the sidebar updates without a reload.

## Quick create ("+") and the Dashboard row

- On phones the bottom bar's **+** opens a sheet: Sale invoice, POS bill, ₹ Payment in (unpaid list with the payment
  dialog, the palette's "Record a payment" link), Expense (`/expenses?new=expense` opens the quick-expense form), Purchase
  bill (`?new=bill`), Quotation. Each action is filtered by `can()` (roles / finer rights) and by the shop-mode modules.
- "“+” opens a new invoice directly" (in the sheet) keeps the old one-tap behaviour. It is a device-local preference
  (`mrchartist_plus_one_tap`, outside the `mrchartist_inv_` prefix: never backed up or synced).
- The Dashboard shows a row of four: New invoice, ₹ Received, POS, Expense (same filtering). It is lazy (no first-paint
  cost); the 8G "Today" card is separate.

## First-run wizard

Steps: **What do you do?** (language picker — sets the device-local `mrchartist_inv_lang` — and the business type) →
Your business → GST registration (with "Composition scheme": the profile gets `gst_scheme: 'composition'` and the filing
frequency `composition`, so new invoices default to a Bill of Supply) → How clients pay you → Logo & design.

The business type also picks the starting **design** (until the user picks one), the **default due days** (kirana 0,
services 15, wholesale / manufacturer 30, full 14) and where the wizard lands (a kirana counter opens **POS**).

**Explore with sample data instead** (last step): creates (or reuses) a company called "Demo", switches to it and fills
it with the existing sample dataset; the user's own company stays empty. The request survives the reload in the
device-local `mrchartist_demo_pending`. Browsers without IndexedDB (no separate companies) load the sample data into the
current company instead.

## Checklist v2

Seven steps derived by `buildChecklist`: business & payment details, first client, first item, first invoice, an invoice
sent on WhatsApp (a reminder / share log entry that is not a snooze), a payment recorded, a backup taken (device-local
`last_backup`). Shown to the owner until everything is done. An empty company also gets **Try with sample data**
(`loadDemoData`, removable from Settings → Data).
