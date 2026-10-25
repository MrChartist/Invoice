# Folder sync between devices (roadmap 5.7)

Keep one company in step across several computers **without a server**. The user picks a folder that their cloud
app already syncs (Google Drive / Dropbox / OneDrive / iCloud for desktop); the app reads and writes encrypted
files in it with the File System Access API, and the cloud client moves them. The app makes no network calls
(Critical Rule 1).

| Piece | File |
|---|---|
| Device id / name, per-company switch, "this device issues as" profile (tiny, in the shell) | `src/lib/sync-device.ts` |
| Folder layout, encryption, manifest, retries | `src/lib/sync-files.ts` |
| Change detection, merge, conflicts, resolution, run | `src/lib/sync-engine.ts` |
| Folder picker, key storage, permission, "Sync now" | `src/lib/sync-folder.ts` |
| Settings → Data & backup → **Sync folder** | `src/components/sync/SyncPanel.tsx` (lazy) |
| Start-up + every 5 minutes | `src/components/sync/SyncRunner.tsx` (shell; imports the engine only when sync is on) |
| Tests | `tests/sync.test.ts` (two simulated devices + an in-memory folder), `tests/sync-vault.test.ts`, e2e step "folder sync" |

## Setting it up
1. Settings → Data & backup → Sync folder → name this device → **Choose sync folder**.
2. First device: **Start a new group** (a folder name, default from the company name) and a **sync passphrase**
   (8+ characters; separate from the PIN and the vault passphrase). Other devices: choose the same folder,
   **Join** the group, type the same passphrase (checked against the group's manifest).
3. Optional but recommended: give each device its own business profile with a different number prefix and pick it
   under **This device issues as** (see Numbering).

Opt-in and per company: each company (6.20) has its own group, handle and key. Supported where
`showDirectoryPicker` exists (Chrome / Edge on a computer). Elsewhere the panel says "Folder sync is not supported in
this browser" and points to backup → restore.

## Folder layout
```
<picked folder>/
  mrchartist-sync/
    <group>/
      manifest.json                      written once by the device that created the group
      devices/<deviceId>.mcsync           one per device; ONLY that device ever writes it
      blobs/<deviceId>/<attachmentId>.mcblob   attachment files that device uploaded (immutable)
```
Each device writes only its own files, so the cloud client never sees two writers on one file (no "conflicted copy"
files). The group folder name and the random device ids are the only plain text; everything else is encrypted.

## Encryption
- Key: PBKDF2-SHA-256, 600,000 iterations, over the sync passphrase with the group's random salt (stored in
  `manifest.json`), imported as a **non-extractable** AES-GCM-256 key. The passphrase is never stored; the key is kept
  in the company's IndexedDB `kv` store like the backup key, so unattended syncs work after a reload.
- Files: `{ app, kind, v, device, envelope: { v, kdf, iter, salt, iv, ct, z } }` — the same envelope fields as encrypted
  backups, fresh 12-byte IV per write, payload gzip-compressed before encryption (`CompressionStream`). The AES-GCM
  additional data is `mcsync1|<group>|<kind>|<deviceId>[|<attachmentId>]`, so a file copied or renamed to pose as
  another device or group fails to decrypt.
- `manifest.json` carries a sealed check text: a wrong passphrase is refused when joining.
- Tests assert that no client name, GSTIN, invoice number, amount, device name, table name or attachment bytes appear in
  any file in the folder.

## What is synced
Every `mrchartist_inv_*` data key of the company except per-device ones: the editor draft, `schema_version`,
`audit_log` (handled separately), running timer, backup schedule / snooze, install / notification state, export
preferences, sync bookkeeping and the device-local keys (`DEVICE_LOCAL_KEYS`). Attachment files (`att_*`) travel as
blobs (below).

- **Array-valued keys** (every table) are synced **per row**, matched by the row's `id`. Rows without an id (legacy)
  or with a duplicate id get a content id, so editing one is a delete + add — never a silent overwrite.
- **Other keys** (settings, template, design prefs, …) are **singletons**: one value, last writer wins (below).
- Raw stored JSON is used, so invoice snapshots keep their `asset:<id>` logo references; the `assets` table syncs as a
  table and is written first. A merge that would leave a dangling logo reference or damaged settings writes nothing.

## Change tracking (why at sync time)
Nothing is added to the save path. At each sync the engine hashes every row (64-bit cyrb53 over its JSON) and compares
with the hash recorded at the last sync in `sync_state`: changed or new → a new version; gone → a tombstone. This
covers every writer (localDb, purchases, imports, the ledger, restore…) without wiring, leaves `tests/perf.test.ts`
untouched, and costs ~0.3–0.6 s for 10,000 rows per sync (`tests/sync.test.ts` perf case). Two edits between syncs
collapse into one version, which is all a state-based merge needs.

## Versions and clocks
Each row / singleton version carries `{ h, t, d, vv, o, del? }`: content hash, Lamport time, editing device, a
**version vector** (device id → that device's Lamport counter when it last changed the row), the device that first
introduced the row, and the tombstone flag.

- Ordering never trusts wall clocks (two PCs can be minutes or days apart). Each device keeps a Lamport counter in
  `sync_state`; local changes are stamped first, then the counter jumps past every peer's counter it has read, so
  later local edits sort after everything seen. `written_at` is shown in the panel ("by its clock") but not used.
- A device whose sync state was lost (restore, erase) restarts its counter above the highest value peers have
  recorded for it, so it can never reuse old counters (a reused counter could otherwise make a new edit look old).

## Merge rules
For every row id in another device's file:

| Situation | Result |
|---|---|
| Only on one side | added (or tombstone recorded) |
| Same content (or same JSON in a different key order) | vectors merged, nothing changes |
| Remote vector dominates (it saw our version and changed it) | remote version applied: update, add or **delete** |
| Local vector dominates | kept |
| Neither dominates (edited on both sides since they last saw each other), incl. edit vs delete | **CONFLICT**: local version kept, remote version stored in `sync_conflicts`; the user picks **Keep mine** / **Use theirs**. Never auto-discarded |

So a tombstone wins only when it causally follows the other side's last edit; a delete concurrent with an edit is a
conflict. Singletons use the same comparison, but a concurrent pair is decided **last writer wins** by Lamport time
(device id breaks ties) — identical on every device, so they converge — and the losing value is listed so the user can
switch to it.

Resolving creates a new version whose vector covers both sides, so every device converges on the choice at its next
sync, and a device that listed the same conflict drops it automatically when the resolved version arrives. One
listing per row (a newer remote version replaces the stored one).

## Numbering safety
Two devices can issue the same `INV/FY26-27/0007`. After every merge the engine groups invoices by the canonical
number key (`numberKey`): any number used by two documents is listed as a **duplicate** with both documents (links to
open them). Issued numbers are **never renumbered automatically**; the user renumbers or cancels one and marks the
pair reviewed. Prevention:
- **This device issues as**: a device-local choice of business profile (device key `mrchartist_inv_sync_device`); the
  invoice editor's default sender on this device, so each device numbers from its own prefix (`OFF/…`, `LAP/…`).
- The panel warns when another device reports the same issuing prefix, and when documents of one series
  (`prefix/FY`) were introduced by more than one device.

## Period lock and vault
- A synced add / edit / delete of a document dated on or before the lock date (`invoices`, `transactions`, `purchases`,
  `purchase_payments`, `vouchers`, `stock_moves`, `stock_transfers`; the later of the local and remote lock dates) is
  **not applied**: it is listed as a "locked period" conflict. **Apply with PIN** verifies the PIN and writes an
  `override` audit row; **Keep mine** declines it (it stays on the other device; not offered again until it changes
  there). A remote settings change that moves the lock date earlier or removes it is held the same way.
- Vault mode: files are decrypted in memory; merged rows, `sync_state`, `sync_conflicts` (which hold the other
  version's data) and `sync_audit` are written through the storage layer, so they are sealed at rest like every other
  value. Nothing readable is written outside the vault store (`tests/sync-vault.test.ts`). The folder is encrypted
  with the sync key regardless of vault mode.

## Audit log
Each device's `audit_log` stays **its own hash chain**; rows from other devices are never interleaved into it (which
would break `prev` links). Instead each device file carries its log, and the receiver keeps a per-device copy in
`sync_audit` (`{ [deviceId]: { name, rows } }`): extended by id where it overlaps, replaced when the other device's
log has rolled past the copy (row cap, restore). `verifyAuditChain` therefore passes on the local log and on each
stored device log separately. Every merge that changes data or finds conflicts appends one local `import` row
("Folder sync from Laptop: 3 added, 1 changed …"), resolutions append `update` / `override` rows.

## Damaged or half-synced files
A file is read, its envelope validated, decrypted (the GCM tag fails on a truncated or tampered file), parsed and
checked row by row (each row's hash must match its content). Any failure is retried (3 attempts, 1.5 s apart) — the
cloud client may still be writing it — and then that device is skipped for this run and shown as "could not be read"
in the device list. Nothing from a bad file is applied. Own writes go through `createWritable()` (atomic swap on
close in Chromium) and are read back and decrypted before the state records them as written; an unchanged snapshot
is not rewritten (no cloud upload churn every 5 minutes). Files from a device on another schema version are skipped
with "update the app".

## When it runs
On app start (after 4 s), every 5 minutes while the tab is visible, and on **Sync now**. Runs are serialised in the
tab and across tabs (Web Locks). Unattended runs never prompt: if the browser dropped folder permission, the panel
shows **Allow access and sync** (a click is a user gesture). Changed tables raise the usual "Updated in another tab
… or by folder sync" banner, and the editor's stale-copy guard refuses to save over a document that sync changed.

## Storage
| key | where | backed up? |
|---|---|---|
| `mrchartist_inv_sync_device` | localStorage (device-local) | never |
| `mrchartist_inv_sync_state` (versions, Lamport clock, peers, declined, last report) | company IndexedDB (sealed in vault) | **no** |
| `mrchartist_inv_sync_conflicts` | company IndexedDB | **no** |
| `mrchartist_inv_sync_audit` | company IndexedDB | **no** |
| `sync-dir-handle`, `sync-key`, `sync-config` | company IndexedDB `kv` store | no |

The three `sync_*` keys (`SYNC_META_KEYS`) describe what this device last exchanged with the folder, so they are left
out of backups, ignored in a restored file, kept out of the restore undo copy — but removed by a restore or erase.
After a restore the next sync compares from scratch: rows that differ from the other devices become conflicts instead
of the restored (older) data silently overwriting newer data elsewhere (`tests/sync.test.ts`). Erase / Forgot-PIN
clear the `kv` store, which disconnects sync.

## Limits (v1)
- Chrome / Edge desktop only (File System Access API); no Safari / Firefox / mobile.
- Not real-time: changes arrive when both the cloud client and the next sync have run (≤ 5 minutes while open).
- Each device file is a full snapshot (gzip-compressed): large books mean larger uploads, though only when something
  changed. Tombstones are kept indefinitely (small).
- Settings are one singleton: two devices editing different profiles at the same time → one wins, the other is listed
  to re-apply.
- Attachment deletions do not propagate as file deletions (an unreferenced file just stays); files are fetched only
  for records that reference them.
- Rows from another device are applied as stored there; data-layer side effects (catalogue learning, client upsert)
  are not re-run.
- A non-extractable sync key in IndexedDB lets this browser profile read the folder without the passphrase (same
  trade-off as scheduled encrypted backups). Disconnect sync on a device you give away; changing the passphrase means
  starting a new group.
- Two devices with the same device id (a copied browser profile) are not detected.
