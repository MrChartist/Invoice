# pwa-backup: installable, offline, never lose data

Owner files: `public/sw.js`, `public/offline.html`, `src/lib/{pwa,auto-backup,idb-kv}.ts`,
`src/components/pwa/**`, `tests/auto-backup.test.ts`, `public/manifest.json` (added `lang`, `categories`, `shortcuts` only).

## Lead wiring (exact snippets)

### 1. `src/main.tsx` (one line, plus import)
```ts
import { registerServiceWorker } from './lib/pwa';
// after createRoot(...).render(...)
void registerServiceWorker();
```
Production only (`import.meta.env.PROD`); a no-op in `npm run dev`.

### 2. App shell (`src/App.tsx` or `DashboardLayout.tsx`), rendered once, inside the PIN gate
```tsx
import { InstallPrompt } from './components/pwa/InstallPrompt';
import { UpdateToast } from './components/pwa/UpdateToast';
import { BackupNudge } from './components/pwa/BackupNudge';
import { AutoBackupRunner } from './components/pwa/AutoBackupRunner';

<AutoBackupRunner />
<UpdateToast />
<BackupNudge />
<InstallPrompt />
```
Optional: `<InstallPrompt variant="button" />` in the sidebar/topbar (renders nothing unless installable or iOS).
`BackupNudge` accepts `onResult(result)` if you want a toast.

### 3. `src/pages/Settings.tsx`
```tsx
import { AutoBackupPanel } from '../components/pwa/AutoBackupPanel';
const { notify, toastNode } = useToast();
<AutoBackupPanel onNotify={notify} />
```
Place it next to the existing manual export/import card.

## Exports

**`src/lib/pwa.ts`**: `registerServiceWorker({onUpdate?})`, `applyUpdate()`, `dismissUpdate()`,
`useUpdateAvailable() -> {available, apply, dismiss}`, `requestPersistentStorage() -> {supported, persisted, usage, quota}`,
`useInstallPrompt() -> {canInstall, showIosHint, installed, install()}`, `isStandalone()`, `isIosSafari()`.
The module captures `beforeinstallprompt` on import, so import it early (main.tsx does).

**`src/lib/idb-kv.ts`**: `idbGet`, `idbSet`, `idbDel` (fail-soft; DB `mrchartist_inv_kv`).

**`src/lib/auto-backup.ts`**
- Pure (tested): `shouldBackup(lastIso, now, frequency)`, `shouldNudge({lastIso, now, hasData, snoozeUntilIso})`,
  `filesToDelete(names, keep)`, `isBackupFile`, `parseConfig`, `describeAge`.
- Storage: `getConfig/saveConfig`, `getLastBackup/recordBackup`, `snoozeNudge/getSnooze`, `hasBackupWorthyData`.
- Actions (never throw, return `BackupResult`): `chooseBackupFolder`, `disconnectFolder`, `getFolderHandle`,
  `runAutoBackup({interactive})`, `runDueBackup()`, `downloadBackupNow()` (async; Safari/Firefox fallback), `isFolderBackupSupported()`.
- **Encryption (opt-in):** `setBackupPassphrase(pass)` derives an AES-GCM key (PBKDF2, random salt) and stores it in
  IndexedDB (`backup-enc-key`) as a **non-extractable, encrypt-only** `CryptoKey` — the passphrase is never stored.
  While a key exists, folder and download backups are written as `mrchartist-invoice-backup-YYYY-MM-DD.encrypted.json`
  in the same format as a manual encrypted export, so Settings → Data restores them with the passphrase on any device.
  `clearBackupPassphrase()` goes back to plain JSON.
- Keys (all `mrchartist_inv_*`, so they ride along in JSON backups): `mrchartist_inv_last_backup` (ISO),
  `mrchartist_inv_auto_backup` (`{enabled, frequency: daily|weekly|on-close, retention}`), `mrchartist_inv_backup_snooze`.
  Also `mrchartist_inv_install_dismissed` (InstallPrompt). The folder handle is in IndexedDB, not localStorage.

## Behaviour notes
- Files are `mrchartist-invoice-backup-YYYY-MM-DD.json` (via `backupFilename()`); same-day runs overwrite. Rotation
  only ever deletes files matching that exact pattern, keeping the newest N.
- Unattended runs never prompt. If folder permission lapsed (typical after a browser restart) they return `permission`;
  the user re-allows by clicking Back up now (a user gesture), in the panel or the nudge.
- "on-close" uses `visibilitychange`/`pagehide`; browsers may cut async writes short, so treat it as best effort.
  It is debounced to one write per 5 minutes.
- Nudge: data exists and last backup > 7 days (or never); "Remind later"/close snoozes 3 days; any successful backup clears it.
- The nudge's Backup now uses the connected folder if present, else downloads a file.

## Service worker (`public/sw.js`)
- Caches: `mci-shell-v1` (index.html, manifest, logo, offline page, other same-origin statics: stale-while-revalidate),
  `mci-assets` (`/assets/*`, cache-first, capped 160, survives versions because files are fingerprinted),
  `mci-fonts` (Google Fonts, stale-while-revalidate, opaque responses cached, errors never, capped 60).
- Navigations: network-first with a 3.5s budget, falling back to cached `/index.html` so `/invoice/abc` works offline.
  Successful navigations refresh the cached shell. Offline with nothing cached: `/offline.html`.
- Install pre-fetches `/`, parses `/assets/...` URLs from it and caches them. Other cross-origin requests, non-GET and range requests are untouched.
- Updates: new worker waits; `UpdateToast` posts `SKIP_WAITING`, and `controllerchange` reloads once.
  Bump `SW_VERSION` in sw.js to drop the shell cache.
- Hosting: sw.js must be served from `/` with a JS MIME type and ideally `Cache-Control: no-cache`.
  SPA fallback must serve index.html for unknown paths (already needed for deep links).

## Verification done
`npx tsc -b`, `npm run lint` (0 errors), `npm test` (34 pass), `npm run build` pass. Playwright smoke against
`vite preview`: SW registered, page became controlled, shell/assets/fonts cached, and with the context offline
`/invoice/abc` loaded the React shell (200, root mounted).

## Restore safety

- `parseBackup` / `validateBackupData` refuse a file before anything is written when a record table
  (`invoices`, `clients`, `items_catalog`, `transactions`, `vendors`, `purchases`, `purchase_payments`, `recurring`,
  `doc_links`, `audit_log`, `assets`) is not a JSON array of objects (core tables and `assets` need an `id`), settings
  are not an object, the file / `schema_version` is newer than this app, or an invoice / recurring snapshot refers to
  an `asset:<id>` image the file does not contain.
- Backups stay self-contained: the `assets` table (snapshot logos / signatures since schema v3) is an ordinary
  `mrchartist_inv_*` key and rides along. An older backup with inline images restores as is, renders the same, and
  the v3 migration moves its images into `assets` on the reload after the restore.
- Backups read the in-memory cache (`collectAppData`), so they contain exactly what the app shows; a restore,
  erase or forgot-PIN reset commits to IndexedDB (`reloadAfterFlush`) before the page reloads.
- Before a restore or an erase, `saveSafetySnapshot(reason)` copies every app key into IndexedDB (`safety-snapshot`,
  in the `kv` store, separate from the data tables). Settings → Data shows **Undo last restore / erase** while that copy exists.

## Storage health

`src/lib/storage-health.ts`: `measureStorage()` counts app keys through the storage layer (the IndexedDB-backed
cache since 4.2, else localStorage, which `navigator.storage.estimate()` does not cover); the quota is ~5 MB on
localStorage and the browser's IndexedDB estimate otherwise (Settings → Data), the logo/signature images still copied inline into invoice snapshots (pre-v3 data),
the shared `assets` table (`sharedImageChars`) and invoices that reference it (`invoicesSharingImages`); `assessStorage()` turns
that plus persistence, iOS-Safari-outside-Home-Screen and backup age into findings (`ok`/`warn`/`critical`) shown in
Settings → Data. Folder backups are read back after writing (`isIntactBackup`); a file that does not reopen intact is
reported as a failed backup and the "last backup" time is not advanced.

Attachment files (6.12, one `mrchartist_inv_att_<id>` key each) are reported as a single "attachments" entry with
their count, size and how many no record uses any more; Settings → Data offers **Clean up unused files**
(`docs/features/attachments-custom-fields.md`). The restore pickers accept backups up to 200 MB (`MAX_BACKUP_BYTES`)
because receipts travel inside the file.

**Folder sync (5.7)** reuses the same File System Access patterns (handle in the company's IndexedDB `kv` store,
`queryPermission` / `requestPermission` only on a click, unattended runs report `permission`) and a stored
non-extractable key derived from a separate sync passphrase; see `docs/features/sync.md`. Sync bookkeeping is never in
a backup, and a restore removes it so the next sync compares from scratch.

## Phones: share backup, share target, shortcuts (8B · roadmap 8.20, 8.23, 8.24)

Phones (no `showDirectoryPicker`: Android Chrome, iOS Safari; also desktop Safari / Firefox) cannot run folder
backups, so the backup has to leave through the OS share sheet.

- **Share backup** (`src/lib/backup-share.ts`, `ShareBackupDialog.tsx`): owner only (`data.backup`). The file is
  encrypted with the stored backup key (Automatic backups → passphrase) or with a passphrase set in the dialog
  (default: remembered as the same encrypt-only key; untick to use it once). Two taps by design: the slow key
  derivation runs on "Set passphrase", then "Share backup" opens the sheet with a fresh user gesture. A readable file
  needs "Share without encryption" + a warning, and is **refused in vault mode** (`shareBackupGate`, reason `vault`).
  Android Chrome refuses `.json` in the share sheet, so `….encrypted.json` is tried, then `….encrypted.txt`
  (text/plain); the restore pickers accept `.txt` (content is validated, not the extension). Only a completed share
  counts as a backup (`recordBackup`); cancel does not. Without Web Share the dialog offers the download.
- **Nudges** (`src/lib/phone-backup.ts`, `PhoneBackupNudge.tsx`, lazy): on phones the banner appears after
  **10 new documents** (invoices + purchases created since the last backup) **or 3 days**, snooze as before; its
  button is Share backup. Folder-capable browsers keep the 7-day `BackupNudge`.
- **Status line** (`BackupStatusLine.tsx`, lazy): "Backed up 2 h ago ✓" / "Not backed up — tap to save" /
  "N new documents since the last backup" on the Dashboard (phones) and at the top of the bell panel (every device),
  owner only; tapping opens Share backup.
- **Share target** (`public/manifest.json` `share_target`, `public/sw.js`, `src/lib/share-inbox.ts`,
  `src/pages/ShareTarget.tsx`): the installed app appears in the phone's share sheet. Android POSTs the file to
  `/share-target`; the service worker stores up to 10 files (≤ 200 MB each) in the `mci-share` cache (kept across
  versions in `KEEP`) and redirects to `/share-target` (behind the PIN / vault screens), which reads and empties the
  cache and routes by name / type: **backup** (`.json` / `.txt`) → Settings → Security → restore (owner only;
  `EncryptedBackup` runs its usual validation, passphrase and restore undo copy); **image / PDF** → Expenses → new
  expense with the files attached (`attachFile`; unused ones released on cancel); **CSV / XLSX** → Reconcile → bank
  statement import (`ImportPanel`). Nothing is uploaded anywhere.
- **Manifest shortcuts** added: POS (`/pos`), Payment in (`/clients?pay=1` — the quick-pay screen belongs to the
  receivables / khata work), New expense (`/expenses?new=expense`).
- **Contacts** (8.24): `ContactPickButton` in the add-client form uses the Contact Picker API (Android Chrome,
  feature-detected, hidden elsewhere) and fills blank name / phone / e-mail / address / city / PIN fields only.
- Tests: `tests/phone-backup-share.test.ts` (owner gate, encryption, `.txt` fallback, cancel, vault), share routing
  and nudge rules in `tests/phone-counter.test.ts`; `npm run verify:offline` passes with the new SW branch.
