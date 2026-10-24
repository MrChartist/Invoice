# Architecture & module contract

Mr. Chartist Invoice is a **local-first, serverless** React 19 + TypeScript + Vite SPA.
Everything lives in `localStorage` behind `src/lib/storage.ts`.

## Ground rules (every module)
1. No backend, no network calls, no analytics. No new runtime dependencies.
2. Vanilla CSS + CSS Modules only; colours/spacing come from tokens in `src/index.css`
   (never hard-code hex in components). Reuse `src/styles/surface.module.css`,
   `src/styles/controls.module.css` and `src/components/ui/*`.
3. Persisted field names are snake_case and **additive only** — never rename/remove.
4. New persisted data = a new table via `getTable/setTable` (`src/lib/storage.ts`),
   key `mrchartist_inv_<table>`. Backup/restore picks every `mrchartist_inv_*` key up
   automatically.
5. Money maths goes through `src/lib/invoice-calc.ts` (`round2`, `num`); never use raw
   floating-point sums for display values.
6. Pure logic lives in `src/lib/*.ts` with `node:test` tests in `tests/*.test.ts`
   (`npm test`, Node ≥ 22, no browser APIs in tested modules).
7. Indian FY numbering (`INV/FY25-26/0001`) is fixed — do not change it.

## Tables (localStorage `mrchartist_inv_<table>`)
| table | owner module | shape |
|---|---|---|
| `invoices` | core | `InvoiceRecord` (`src/types/invoice.ts`) |
| `clients` | core | `Client` |
| `items_catalog` | core | `InvoiceItem` |
| `transactions` | core | `Payment` (payments received) |
| `vendors` | purchases | `Vendor` (`src/types/purchases.ts`) |
| `purchases` | purchases | `PurchaseRecord` |
| `recurring` | recurring | defined by that module |
| `reminders` | reminders-share | defined by that module |
| `doc_links` | documents | defined by that module |
| `stock_moves` | inventory | defined by that module |
| `einvoice_meta` | einvoice | defined by that module |
| `design_prefs` | templates-studio | defined by that module |
| `purchase_payments` | purchases | `{id, purchase_id, amount, date, method, reference}` |
| `audit_log` | audit | `AuditEntry` (`src/types/audit.ts`) — written by `localDb` mutations, capped at 5,000 rows |
| `bank_statements` | reconcile | imported statement lines + match state (`docs/features/reconcile-reports.md`) |
| `book_opening` | books | opening cash/bank balances |
| `export_prefs` | exports | last-used export options |
| `notif_state` | notifications | read / snoozed / dismissed notice ids |
| `tds_certificates` | receivables (TDS) | Form 16A received flag per deductor × quarter (`TdsCertificate`, `src/lib/tds-register.ts`) |
| `gstr2b_actions` | GST reports (2B match) | `Gstr2bAction` IMS decision per return period + section + supplier GSTIN + normalised document no. (`src/lib/gstr2b.ts`) |
| `time_entries` | time (6.13) | `TimeEntry` (`src/types/time.ts`); billed state derived from `invoiced_in` (`docs/features/time-expenses.md`) |
| `mileage` | time (6.14) | `MileageEntry` (`src/types/time.ts`), same derived billing |
| `compliance` | compliance (GST) | `FiledReturn` marks: GST return filed per form / period / GSTIN (`docs/features/compliance.md`) |
| `accounts` | ledger | user-added `Account` rows (`src/lib/ledger/accounts.ts`); default accounts are constants, never stored |
| `vouchers` | ledger | manual `ManualVoucher` rows, amounts in integer paise (`src/lib/ledger/vouchers.ts`) |
| `fixed_assets` | ledger | `FixedAsset` register rows (`src/lib/ledger/assets.ts`) |

## Schema versions & migrations

`mrchartist_inv_schema_version` holds the last migration applied. `runMigrations()` (`src/lib/migrations.ts`) runs
in `main.tsx` before the first render: a fresh install is stamped with the latest version, existing data runs each
newer migration in order, a throwing migration rolls every key back and leaves the version unchanged, and data from
a newer app version is never touched. Restores reload the page, so restored data is migrated the same way.
To change a stored shape, append a `Migration` (next version number, idempotent, additive, never rewrites an
invoice's `sender` snapshot) and cover it in `tests/migrations.test.ts`.

## Integration
Feature modules are **self-contained**: they export a page/component and (optionally) a pure
`lib` API. The lead wires routes, navigation and cross-links in the shared shell
(`src/App.tsx`, `src/layouts/DashboardLayout.tsx`, `src/pages/*`). Feature agents must not
edit shared shell files; describe the exact wiring in `docs/features/<module>.md`.
