# Compliance: unique numbers, audit trail, period lock

Three features GST-registered users expect from Tally Prime / Zoho Books / Vyapar. All are enforced
in the **data layer** (`localDb`), so no screen, importer or recurring run can bypass them.

| Feature | Library | UI |
|---|---|---|
| Unique document numbers (GST Rule 46) | `src/lib/invoice-number.ts`, `localDb.invoices.save/checkNumber` | number field hint in the editor, save-time error, "series gap" hint + toast |
| Audit trail (Tally edit log) | `src/lib/audit.ts`, `audit-events.ts`, `audit-query.ts` | Settings → **Activity** (`ActivityPanel`), `ActivityTimeline` in *Document actions* |
| Period lock ("books beginning" / filed GST month) | `src/lib/period-lock.ts`, `lock-presets.ts` | read-only banner + PIN unlock in the editor, Settings → Defaults → **Lock books**, Transactions lock icon |

Also in this wave: Tally-style keyboard entry in the editor (see the last section).

## 1. Unique document numbers

* **Rule**: a document cannot be saved with a number another document already holds. Comparison key
  (`numberKey`) is case-, space- and zero-padding-insensitive: `inv / fy25-26 / 0007` == `INV/FY25-26/7`.
  It spans every document type (quotation, credit note…) and **includes cancelled documents** — numbers
  are never reused.
* **Editing keeps its own number valid**, even if legacy data already contained a duplicate.
* **Errors**: `DuplicateNumberError` (`code: 'DUPLICATE_NUMBER'`, `.clash`) from `localDb.invoices.save`;
  the store's `validate()` reports the same message ("Number … is already used by invoice … for <client>…")
  before anything is written.
* **Auto numbering** (`nextInvoiceNumber`) is still "highest + 1" and additionally skips any number whose
  key is taken. Indian-FY format is unchanged.
* **Gap hint**: a hand-typed number that skips ahead (`gapsIfIssued`) is allowed; the editor shows a gentle
  hint and the save toast lists up to three unused numbers (`SaveResult.gap`).
* **Pure helpers** (no storage, safe to call from reports): `parseDocNumber`, `numberKey`,
  `findNumberClash`, `gapsIfIssued`, and **`seriesGaps(numbers, fyLabel?)`** → per prefix × FY
  `{prefix, fy, highest, missing[], missingCount, missingNumbers[]}` (list capped at 25, count exact).
  Intended for the GST "documents issued" summary: `seriesGaps(invoices.map(i => i.invoice_number), '25-26')`.
* `localDb.invoices.checkNumber(number, selfId?)` → `{ ok, clash?, gap }` for UIs.

## 2. Audit trail

Table **`audit_log`** (`mrchartist_inv_audit_log`, part of backups). Rows oldest → newest; capped at the
newest **5,000** (`AUDIT_MAX_ROWS`).

```ts
interface AuditEntry {
  id: string; at: string;                       // ISO instant
  entity: 'invoice'|'payment'|'client'|'profile'|'settings'|'purchase'|'item'|'system';
  entity_id: string;                            // invoice id, payment id, client id, 'lock_until', 'defaults'…
  action: 'create'|'update'|'delete'|'cancel'|'reinstate'|'payment_add'|'payment_remove'
        | 'lock'|'unlock'|'override'|'restore'|'import';
  summary: string;                              // one readable sentence
  changes?: { field: string; from: string|null; to: string|null }[];   // display strings, money formatted
  doc_number?: string;                          // invoice / payment rows
  parent_id?: string;                           // payments → owning invoice id
}
```

* **Automatic hooks** inside `localDb`: `invoices.save/remove/setStatus` (create / update / cancel /
  reinstate / delete), `payments.record/remove`, `clients.upsert/remove`, `settings.save` (profile
  create/update/delete, defaults, `lock` / `unlock`). Anything that goes through `localDb` — documents
  module, recurring, store, other agents' code — is logged without changing.
* **Other writers**: importers (`createLocalSink().invoices`) log one `import` row; `applyBackup` /
  `restoreBackup` log one `restore` row (restore replaces everything and is allowed even over a locked period).
  `audit.record(input)` is public for modules that write tables directly (purchases, etc.).
* **Diffs**: `diffInvoice` (status, number, dates, client, GSTIN, items value, discount, shipping, charges, GST,
  TCS/TDS, total, received, supply fields, notes/terms excerpts, line count, per-line name/qty/rate/disc/GST/HSN —
  max 8 line changes then "More line edits"). No-op saves (nothing material changed) write **no row**.
  Sub-paisa money noise is ignored. `diffClient`, `diffProfile` likewise.
* **Privacy**: email, phone, address, bank details, UPI, logo, signature are recorded as
  `(hidden) → (changed)` only; notes/terms are excerpted to 60 characters; no full snapshots.
* **Never breaks a save**: `audit.record` swallows every error and returns `null`; a quota error sheds the
  oldest half once and retries; `localDb` additionally wraps row construction (`logSafe`). Tests cover a throwing
  logger and a full quota on the log table.
* **Read side**: `audit.all()` (newest first), `audit.forInvoice(id)` (own rows + its payments),
  `filterAudit(entries, {entity, action, from, to, q})`, `auditToCsv(entries)` (formula-injection safe).
* **UI**: `ActivityPanel` (lazy-loaded Settings tab: search, area, action, date range, expandable diffs, CSV,
  mobile cards) and `ActivityTimeline` (`invoiceId`, `refreshKey?`) in the editor's *Document actions*.

## 3. Period lock

`settings.lock_until` (`YYYY-MM-DD`, additive field on `mrchartist_inv_settings`; absent = open).

* **Frozen** = a document whose **issue date is on or before** `lock_until`. It cannot be **created, edited,
  cancelled, reinstated, deleted, paid, or have a payment removed**. Moving an open document's date *into* the
  locked period is refused too.
* **Enforcement** (`assertUnlocked` in `localDb`): `invoices.save`, `invoices.remove`, `invoices.setStatus`,
  `payments.record`, `payments.remove` throw `PeriodLockedError`
  (`code: 'PERIOD_LOCKED'`, `.lockUntil`, `.docDate`, `.docNumber`, `.action`) with a friendly message:
  *"Books are locked up to 30 Sep 2026. INV/… is dated 15 Aug 2026, so it cannot be edited. Unlock it with your PIN
  in the editor, or move the lock date in Settings → Defaults."*
  `store.saveInvoice()` returns `{ ok: false, locked: true, errors }` instead of throwing.
* **Override** (only way past it): `grantOverride(pin, { scope: invoiceId | SETTINGS_OVERRIDE })` verifies the PIN with
  `auth.verifyPin` (counts toward the lockout), then opens a **10-minute, in-memory, single-document** window.
  Grant → `override` audit row; every change made under it is tagged "(period-lock override)".
  Lowering or removing `lock_until` (`localDb.settings.save`) needs a `SETTINGS_OVERRIDE` grant, which is spent on use;
  raising the lock never needs a PIN.
* **Read helpers**: `getLockUntil()`, `isDateLocked(date, lockUntil?)`, `isLocked(doc)` (override counts as open),
  `lockState(doc)` → `'open'|'overridden'|'locked'`, `partitionByLock(rows)`, `lockPresets(today)`
  (end of last month / quarter / FY), `prettyDay`.
* **Other paths**:
  * *Recurring* (`runDueSchedules`): an occurrence inside the lock is **skipped and counted** (`skipped_count`),
    reported in `RunReport.errors`, never retried forever.
  * *Import*: rows dated inside the lock are **not written** (reported per row) and the import is logged.
  * *Convert*: the new document is dated today and is created; if the *source* is locked its status is left alone.
  * *Restore from backup*: replaces everything, allowed, logged (`restore`). Settings in the backup (including
    its `lock_until`) come back with it.
* **UI**: editor — `<fieldset disabled>` over the form, `LockBanner` (lock date, "Unlock with PIN", override
  countdown with "Re-lock now"), Save buttons disabled; Settings → Defaults → *Lock books* (date + three presets,
  explanation, PIN modal when loosening); Transactions rows show a lock icon and disable Edit / Delete /
  Record-payment; `PaymentModal` explains and blocks.

## Keyboard entry (editor)

* **Enter** in the last field of a line → next line's name; on the last line → adds a line and focuses its name.
* **Alt+↑ / Alt+↓** moves the line (focus stays in the same field). **Ctrl/⌘+Enter** saves. Ctrl/⌘+S still works.
* Pure logic: `src/components/creator/line-keys.ts` (`lineKeyAction`, `isSaveShortcut`), unit-tested.
* **Save & new** button; after a save a toast offers **View** (preview), **Share** (opens the share menu) and **New**.
* A client GSTIN fills the place of supply / state and re-picks CGST+SGST vs IGST (`setClient`; covered by a test).

## Integration notes for the lead

* `docs/ARCHITECTURE.md` table: add `audit_log | audit | AuditEntry (src/types/audit.ts)`.
* GST reports may call `seriesGaps(...)` for the documents-issued summary (read-only; no edit needed there).
* Files outside the owned list that received small, deliberate edits: `src/lib/recurring.ts` (skip locked
  occurrences), `src/lib/importers.ts` (skip locked rows + log), `src/lib/backup.ts` (log restore),
  `src/lib/documents.ts` (tolerate a locked source on convert), `src/pages/Transactions.tsx` (lock icon / disabled
  buttons only). `tests/documents.test.ts` and `tests/integration/backup-roundtrip.test.ts` were adjusted
  (duplicate-number fixture; the audit table is excluded from byte-for-byte restore comparisons).

## Limits

* The log is per device, not tamper-proof (a user with devtools can edit `localStorage`); it is an honest edit
  log, not an immutable ledger. The PIN lock is likewise a speed bump, not encryption (see AGENTS.md).
* Only localDb-mediated changes are logged individually; direct table writers (purchases, inventory, recurring
  schedule edits, importers' per-row writes) are not, unless they call `audit.record`.
* Payments are locked by the **document's** date, not the receipt date.
* 5,000-row cap; each write rewrites the table (fine at this size; ~1 MB at the cap counts toward the browser quota).
* Lock overrides live in memory: a page reload re-locks.
