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

Table **`audit_log`** (`mrchartist_inv_audit_log`, part of backups). Rows oldest → newest; capped at
**5,000** (`AUDIT_MAX_ROWS`; past it the oldest are trimmed to 4,500 and a `truncate` anchor records it, §2a).

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
  prev?: string; hash?: string;                 // hash chain (4.5), see §2a
  seal?: AuditSeal;                             // anchor facts (chain_start / truncate / restore)
}
```

* **Automatic hooks** inside `localDb`: `invoices.save/remove/setStatus` (create / update / cancel /
  reinstate / delete), `payments.record/remove`, `clients.upsert/remove`, `settings.save` (profile
  create/update/delete, defaults, `lock` / `unlock`). Anything that goes through `localDb` — documents
  module, recurring, store, other agents' code — is logged without changing.
* **Other writers**: importers (`createLocalSink().invoices`) log one `import` row; `applyBackup` /
  `restoreBackup` log one `restore` marker (restore replaces everything and is allowed even over a locked period;
  the marker records the backup's chain head and the head of the log it replaced, §2a).
  `audit.record(input)` is public for modules that write tables directly (purchases, etc.).
* **Diffs**: `diffInvoice` (status, number, dates, client, GSTIN, items value, discount, shipping, charges, GST,
  TCS/TDS, total, received, supply fields, notes/terms excerpts, line count, per-line name/qty/rate/disc/GST/HSN —
  max 8 line changes then "More line edits"). No-op saves (nothing material changed) write **no row**.
  Sub-paisa money noise is ignored. `diffClient`, `diffProfile` likewise.
* **Privacy**: email, phone, address, bank details, UPI, logo, signature are recorded as
  `(hidden) → (changed)` only; notes/terms are excerpted to 60 characters; no full snapshots.
* **Never breaks a save**: `audit.record` swallows every error and returns `null`; a quota error sheds the
  oldest half once (recorded by a `truncate` anchor) and retries; `localDb` additionally wraps row construction (`logSafe`). Tests cover a throwing
  logger and a full quota on the log table.
* **Read side**: `audit.all()` (newest first), `audit.rows()` (stored order), `audit.head()`, `audit.forInvoice(id)` (own rows + its payments),
  `filterAudit(entries, {entity, action, from, to, q})`, `auditToCsv(entries)` (formula-injection safe).
* **UI**: `ActivityPanel` (lazy-loaded Settings tab: search, area, action, date range, expandable diffs, CSV,
  mobile cards) and `ActivityTimeline` (`invoiceId`, `refreshKey?`) in the editor's *Document actions*.

## 2a. Tamper evidence (hash chain, roadmap 4.5)

**What it gives you.** Every row carries `prev` (the previous row's `hash`) and `hash` =
SHA-256 of the row's **canonical form**. Editing, deleting or reordering rows *inside the app's data* breaks
the chain, and Settings → Activity → **Verify integrity** says where and how. **What it does not give you:**
anyone with full access to the device can rewrite the whole log and recompute every hash. That is why the
panel shows the **chain head** (hash of the newest row) with *Copy* / *Export* (a small `.txt`): note it down or
send it to your CA. Pasting that hash into *Check a hash you noted* later makes a rewrite, or removal of newer
rows, detectable. It is tamper-*evident*, not tamper-*proof*.

* **Hash**: `src/lib/sha256.ts`, a ~60-line synchronous pure-JS SHA-256 (FIPS 180-4; round constants derived
  from primes at first use). Synchronous because `audit.record` runs inside sync `localDb` code, and WebCrypto
  `subtle.digest` is async-only. Tested against the NIST vectors (`""`, `abc`, the 448-bit message, one million
  `a`) and against `node:crypto` on UTF-8 text and every padding boundary.
* **Canonical form** (`canonical` in `audit.ts`): JSON with object keys sorted (recursively), `undefined`
  members left out, arrays in order. `hash = sha256(canonical(row without its hash field))`, so `prev`, `seal`
  and any future field are covered. The first chained row has `prev = AUDIT_GENESIS` (64 zeros).
* **Anchor rows** (`entity: 'system'`, `entity_id: 'audit_log'`, written by the app, chained like every row):
  * `chain_start`: seals a run of **unchained rows** right before it, as `seal.legacy = {count, digest}` with
    `digest = sha256(canonical(rows))`. Its `prev` is the last chained row before the run (or genesis). Written
    by the first `audit.record` after upgrading, and eagerly by **migration 2** (`audit.sealLegacy()`,
    idempotent: a log that already ends in a chained row is untouched; quota errors never block the boot). Also
    covers rows a stale tab running an older version might append later.
  * `truncate`: written when the app itself removes the oldest rows. **Row cap**: going past 5,000 trims to
    the newest 4,500 in one go (`reason: 'cap'`, so not every write after the cap adds an anchor).
    **Storage full**: the quota path still sheds the oldest half and retries (`reason: 'storage'`).
    `seal = {reason, dropped, cut, legacy?}` where `cut` is the `prev` of the first chained row kept and
    `legacy` re-seals any unchained rows still at the front.
  * `restore`: see below.
* **Verification** (`verifyAuditChain(rows, {notedHead?})` in `src/lib/audit-chain.ts`, lazy) returns
  `{ok, total, chained, legacy, head, trimmed?, restores, noted?, broken?: {index, reason, message}}`:
  1. `hash` ≠ recomputed → **edited** (at that row).
  2. `prev` ≠ previous chained row's hash → **reordered** if it points at another row that is present,
     else **deleted** (a row before it is missing). An edit whose hash was recomputed shows up here, on the
     next row.
  3. First chained row: `prev` must be genesis or the newest `truncate` anchor's `cut`; otherwise
     **truncated** ("older entries were removed without the app recording it"). With a matching anchor the
     report carries `trimmed` and the UI says "older entries were removed (storage full / size limit)", not
     "tampered".
  4. An unchained run is fine only when sealed: by the `chain_start` right after it (count + digest), or, for a
     leading run, by the newest `truncate` anchor. Otherwise **edited** / **deleted** (row added, altered or its
     seal stripped). A log with no chained rows at all (not started yet) verifies as legacy.
  5. `notedHead`: present → `{status:'present', index, newer}`; matches a restore marker's `replaced_head`
     → `'replaced'` (not a failure); otherwise **truncated** ("entries after it were removed or the log was
     rewritten").
* **Restore** (`applyBackup` / `restoreBackup`): the log is no longer silently swapped.
  * A backup that **contains** an `audit_log` brings its own chain; it verifies exactly as it did on the
    device that made it (its own genesis / `truncate` / `chain_start` rules). A `restore` marker is then
    appended, linked to the backup's head (`prev = restored head`), with
    `seal = {restored_head, restored_rows, replaced_head, replaced_rows}` — the head and size of the log the
    restore replaced. The replaced rows themselves are not kept in the log (they are in the pre-restore safety
    snapshot in IndexedDB, and their head is in the marker, so a copy you exported earlier can be matched).
  * A backup **without** a log (rare; partial files via `applyBackup`) keeps the device's log; the marker
    continues that chain with `restored_head: null` and no `replaced_*`.
  * A pre-4.5 backup's unchained log gets a `chain_start` before the marker.
* **Cost**: one SHA-256 of a ~300-byte row per write (microseconds); verifying 5,000 rows is a few tens of ms
  and only runs on demand. Adds ~1 kB gz to the data path (`sha256.ts` + canonical/link code).

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
* **Purchases** (`src/lib/purchases.ts`): `purchasesDb.save` / `remove` refuse a bill or expense whose **bill date**
  is frozen (or an edit that moves one into the lock), so ITC already claimed cannot change. Supplier payments
  (`paymentsDb.record` / `remove`) are locked by the **payment's own date** — paying an old bill in an open month
  is allowed.
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

* The log is per device and tamper-**evident**, not tamper-proof: a user with devtools can rewrite all of
  `localStorage`, hashes included. Only a head hash kept *outside* the device (exported / given to a CA) makes
  such a rewrite detectable, and only for rows up to that head. Removing the *newest* rows, or removing the
  oldest rows together with a forged `truncate` anchor, cannot be seen from the device's data alone. The PIN
  lock is likewise a speed bump, not encryption (see AGENTS.md).
* Two tabs writing at the same instant: the last write wins and the other row is lost (as before); the chain
  stays consistent because each write re-reads the table.
* A restore keeps the backup's log plus a marker; the replaced device log survives only as its head hash in
  the marker (and in the safety snapshot).
* Only localDb-mediated changes are logged individually; direct table writers (purchases, inventory, recurring
  schedule edits, importers' per-row writes) are not, unless they call `audit.record`.
* Payments are locked by the **document's** date, not the receipt date.
* 5,000-row cap; each write rewrites the table (fine at this size; ~1 MB at the cap counts toward the browser quota).
* Lock overrides live in memory: a page reload re-locks.
