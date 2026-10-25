# Security module

Hashed PIN, brute-force lockout, idle auto-lock, forgot-PIN recovery and passphrase-encrypted backups.
No network, no dependencies — only WebCrypto (`crypto.subtle`).

## Files
| file | role |
|---|---|
| `src/lib/crypto.ts` | PBKDF2-SHA-256 (600k iter; older 310k PIN records are re-hashed on the next correct unlock) PIN hashing, constant-time compare, AES-GCM-256 string encryption (envelope `{v,kdf,iter,salt,iv,ct}`, header bound as AAD), base64 helpers |
| `src/lib/auth.ts` | credential record, session, lockout, `changePin`, idle timeout, `resetAllData` |
| `src/lib/backup.ts` | `buildEncryptedBackup`, `decryptBackup`, `isEncryptedBackup`, `markBackupDone`, `getLastBackup`, `daysSinceBackup` |
| `src/pages/LoginPage.tsx` | login / register (with confirm + strength hint) / lockout countdown / forgot-PIN wipe |
| `src/components/security/` | `SecurityPanel`, `ChangePinModal`, `EncryptedBackup`, `IdleLock`, `UsersPanel`, `RequireAccess` |
| `src/lib/access.ts`, `src/lib/users.ts` | local user roles (6.21) — see § Local user roles |

## Behaviour changes the lead must know
1. **`login` and `verifyPin` are now async** (hashing is async). `isAuthenticated()`, `getUser()` and `logout()` stay synchronous with the same signatures.
   Only `LoginPage` called `login`/`verifyPin`; `src/App.tsx` (`isAuthenticated`), `DashboardLayout.tsx` (`getUser`, `logout`) and `Dashboard.tsx` (`getUser`) need **no change**.
2. **`logout()` now only locks** (clears the session). Before, it deleted the credential record, so logging out let anyone re-register a new PIN. `getUser()` keeps returning the account while locked (needed for the login screen) and returns `{name, createdAt}` only, never secrets.
3. **The unlocked flag lives in `sessionStorage`** (`mrchartist_inv_session`), so closing the tab locks the app. Existing users see the PIN screen once after upgrading. The `mrchartist_inv_auth` key is unchanged; legacy `{name,pin,createdAt}` records still work and are silently rewritten as hashed records on the first successful unlock.
4. New device-local keys (`auth_guard`, `idle_min`, `session`, `last_backup`) are excluded from backup export/import/wipe (`DEVICE_LOCAL_KEYS` in `auth.ts`). `wipeAppData()` keeps them too.
5. Idle auto-lock defaults to **30 minutes** (0 = never).
6. `AuthUser.pin` is now optional/legacy and never populated.

## Wiring snippets

### 1. Idle lock — `src/App.tsx`
```tsx
import { IdleLock } from './components/security/IdleLock';
// ...inside the authenticated branch of the shell:
<IdleLock onLock={() => setAuthed(false)} />
```
`onLock` is called after `logout()`; set whatever state makes `App` render `<LoginPage>` again (the existing `isAuthenticated()` gate).
`LoginPage` is used exactly as before: `<LoginPage onSuccess={() => setAuthed(true)} />`.

### 2. Settings — new "Security" tab/section in `src/pages/Settings.tsx`
```tsx
import { SecurityPanel } from '../components/security/SecurityPanel';
// where the other panels render (notify comes from useToast()):
<SecurityPanel notify={notify} onLock={() => window.location.reload()} />
```
(`onLock` is optional; without it "Lock now" reloads the page, which lands on the PIN screen.)

### 3. Record plain backups — `src/components/settings/DataPanel.tsx`
After each successful plaintext export (`exportBackup` and `saveToDisk`) add:
```ts
import { markBackupDone } from '../../lib/backup';
// ...after downloadText(...) / writable.close():
markBackupDone();
```
Encrypted exports call `markBackupDone()` themselves.

### 4. Restoring an encrypted file from the existing Restore button (optional)
`parseBackup(text)` throws `EncryptedBackupError` (`err.code === 'encrypted'`) for encrypted files. `DataPanel.onFile` already shows `err.message` ("This backup is encrypted. Enter its passphrase to restore it."); the `SecurityPanel` → "Restore encrypted backup" button handles the passphrase prompt. To handle it inline instead, catch `EncryptedBackupError`, ask for a passphrase and call `await decryptBackup(text, passphrase)` (same return shape as `parseBackup`).

### 5. Backup reminder (optional, Dashboard)
```ts
import { daysSinceBackup } from '../lib/backup';
const d = daysSinceBackup(); // null = never backed up
```

## Lockout policy
5 consecutive wrong PINs -> 30 s lock; each further lockout doubles (30 s, 60 s, 120 s ... capped at 1 h). State is persisted in `mrchartist_inv_auth_guard`, so a reload does not reset it; a correct PIN resets it. Correct PINs are refused while locked. `changePin` shares the same counter.

## Forgot PIN
There is no server, so the only recovery is erasing the device: `resetAllData(phrase, { ownerName })` requires the exact phrase `DELETE ALL MY DATA` (case/spacing-insensitive) and removes every `mrchartist_inv_*` key (plus the session). Keys outside the prefix (e.g. `theme`) are untouched. The login page offers it behind "Forgot PIN?" (owner selected only; a clerk / viewer is sent to the owner). When clerks / viewers exist on the device (`resetNeedsOwnerName()`), the reset also needs the owner's name typed, and the screen says that every other user and their PIN go too: anyone at the PIN screen can reach it, so it is a deliberate extra step (not a secret) against a casual or mistaken wipe. It stays a full reset: nothing is preserved.

## Encrypted backup file format
```json
{ "app": "mrchartist-invoice", "encrypted": true, "version": 1, "exportedAt": "...",
  "envelope": { "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "salt": "b64", "iv": "b64", "ct": "b64" } }
```
`ct` decrypts to the normal `BackupFile` JSON. Filename: `mrchartist-invoice-backup-YYYY-MM-DD.encrypted.json`. A wrong passphrase or any modification fails the GCM tag: "Wrong passphrase, or the file has been modified."

## Honest limits
A 4-6 digit PIN has ~13-20 bits of entropy. The hash + lockout stops casual snooping and slows UI guessing, but anyone with raw access to the browser profile can read `localStorage` directly (invoice data is not encrypted at rest) or brute-force the hash offline. Use an encrypted backup with a real passphrase for portable secrecy.

## Tests
`tests/crypto.test.ts`, `tests/auth.test.ts` (injected clock + in-memory storage), `tests/backup.test.ts` (existing cases kept, encrypted cases added).

## HTTP headers & CSP

`scripts/security-headers.mjs` is the single source for the CSP and security/caching headers.
`node scripts/gen-headers.mjs` regenerates `public/_headers`, the `[[headers]]` blocks of `netlify.toml` and the
`headers` array of `vercel.json`; `tests/security-headers.test.ts` fails if any of them drifts. Production builds
also prepend the CSP (minus `frame-ancestors`, which only works as a header) as a `<meta>` tag in `index.html`, so a
host that ignores those files still enforces it. Older backups encrypted at 310k iterations still open (the
iteration count travels in the envelope).

## Vault mode (roadmap 5.8)

Optional, Settings → Security → **Vault mode**. Protects the stored data itself, unlike the PIN.

- **Keys.** A random AES-GCM-256 data key encrypts every value the app keeps in IndexedDB. It is wrapped with AES-KW
  under a key derived from the passphrase (PBKDF2-SHA-256, 600,000 iterations, random salt); only the wrapped key,
  salt and iteration count are stored (`__vault__` record). In memory the data key is a non-extractable `CryptoKey`.
  Changing the passphrase re-wraps the same data key, so the data is not re-encrypted.
- **Values.** Sealed one by one as `mcv1:<iv>:<ciphertext>` with a fresh 96-bit IV and the storage key name as
  AES-GCM additional data, so a ciphertext copied onto another key fails to open. A value that fails to decrypt is
  reported on the unlock screen and left untouched; everything else opens.
- **Boot.** With a vault on the device, an unlock screen appears before the app (and before the PIN screen); nothing
  reads the store until the passphrase has decrypted it. "Lock vault now" reloads the page, dropping the key.
- **What else is covered.** The restore undo copy (IndexedDB `kv` store) is sealed with the same key, including one
  saved before the vault was turned on (and it is written back readable when the vault is turned off). Device-local
  keys that stay in localStorage (PIN hash, lockout, idle timer, session, last-backup time, backend marker) and the
  theme are not data and are not encrypted. **Backups follow the vault:** while it is on, plain JSON backups are
  refused — Data → "Download backup" / "Save to a folder" are disabled with a warning, `exportPlainBackup` and
  `downloadBackupNow` refuse, and scheduled folder backups write nothing (reason `encryption`, shown in Automatic
  backups) until a backup passphrase is set; encrypted exports work as before. Folder sync (5.7) files are always encrypted with
  the separate sync passphrase; what sync merges, its bookkeeping and the other version of a conflict are stored
  sealed like any other value (`docs/features/sync.md`).
- **Multiple tabs.** Every write to the store runs in one IndexedDB transaction that first reads the vault record and
  aborts unless it is the one this tab expects (its unlocked vault, or no vault at all). So a tab can never write
  sealed values into a store whose vault was removed or re-created elsewhere, nor readable values into a vault store.
  A refused write stops further writes in that tab with a "reload this tab" message; reload paths ask before
  dropping unsaved changes. Turning the vault on or off is also broadcast so other tabs reload, a tab waiting on the
  unlock screen reads the store and the vault record afresh when unlocked, and the IndexedDB schema version was
  bumped to 3 so tabs still running an older build lose their connection instead of writing. Each tab asks for the
  passphrase separately.
- **Untrusted values.** A vault store holds only sealed values: anything readable found there (or a stale
  localStorage copy) is not loaded, so readable data planted in the browser profile cannot slip into invoices.
  Values that do not decrypt are reported and left untouched; Erase removes them too.
- **No recovery.** A lost passphrase means the data cannot be decrypted. The unlock screen's "Forgot the passphrase?"
  erases everything this app stored on the device (typed `ERASE`), after which a backup can be restored. A damaged
  vault record shows "Your data could not be opened" with the same erase option. So does a **missing** record while
  sealed (`mcv1:`) values are still in the store (`initStorage` → `unavailable`, `vaultDamaged`): the app never boots
  in plain mode over sealed data. Turning the vault off removes sealed values that never decrypted, so it cannot
  leave such orphans behind.
- **Owner only.** `enableVault`, `disableVault` and `changeVaultPassphrase` call `requireAccess('security.manage')`.
- **Limits.** Not a defence against malware or someone using the unlocked app; data is decrypted in memory while the
  tab is open. Passphrase attempts are not rate-limited beyond the cost of PBKDF2 (an attacker with a copy of the
  data can guess offline, so use a long passphrase; the minimum is 10 characters). Needs IndexedDB and a secure page.

## Local user roles (roadmap 6.21)

**Convenience access control on a shared device, not security.** Everything runs in one browser profile: anyone
with the device and the browser's developer tools can read or change the stored data, or skip these checks. Roles
stop a colleague from deleting an issued invoice or erasing the books by mistake. Real protection is vault mode
(the data is encrypted at rest) and a separate operating-system account per person. The UI says so in Settings →
Security.

### Roles
| action (`AccessAction`) | owner | clerk | viewer |
|---|---|---|---|
| `view` — screens, print / download a document PDF | ✓ | ✓ | ✓ |
| `report.export` — CSV / Excel / GST working papers | ✓ | ✓ | ✓ |
| `doc.create`, `doc.edit` — new / edit / convert / cancel documents | ✓ | ✓ | |
| `doc.deleteDraft` — delete a Draft | ✓ | ✓ | |
| `doc.deleteIssued` — delete anything that left Draft | ✓ | | |
| `payment.record` — record / remove payments, bulk mark paid | ✓ | ✓ | |
| `master.edit` — clients, items, vendors | ✓ | ✓ | |
| `books.edit` — purchases, expenses, vouchers, cheques, recurring, time, reconcile | ✓ | ✓ | |
| `settings.manage` — business profiles, custom fields, defaults, lock date, Design studio, add / rename / delete companies | ✓ | | |
| `security.manage` — users, idle timeout, vault mode | ✓ | | |
| `settings.manage` also covers folder sync: connect, disconnect, re-enter passphrase, "Sync now" | ✓ | | |
| `data.backup` — download a full backup, encrypted export, backup folder / schedule / passphrase, "Back up now" | ✓ | | |
| `data.restore`, `data.erase` | ✓ | | |
| `period.override` — unlock a locked document / move the lock date earlier | ✓ | | |

Decisions: a clerk cannot download full backups (a backup is every table, so it is an owner decision); automatic
folder backups the owner set up keep running whoever is signed in, because they go to the owner's folder. There is
exactly one owner (the account in `mrchartist_inv_auth`); added users are clerks or viewers and the owner can switch
them. A clerk may delete purchases / expenses / vouchers they can edit (only issued *sales* documents are protected).
Users are device-wide (the PIN screen comes before any company is opened): every role may switch between companies
(6.20), only the owner creates, renames or deletes them.

### Files
| file | role |
|---|---|
| `src/lib/access.ts` | role matrix (`roleCan`), `can(action)`, `requireAccess(action)` → `AccessDeniedError` (`code: 'ACCESS_DENIED'`), labels. Imports nothing, so the data layer can use it without cycles. |
| `src/lib/auth.ts` | users list, per-user PIN check and lockout, session → current user (`getCurrentUser`), registers the actor for `access.ts` |
| `src/lib/users.ts` | owner-only `addUser`, `setUserRole`, `resetUserPin`, `removeUser` (audited; loaded with the Settings chunk) |
| `src/hooks/useCan.ts` | `useCan()` → `{ can, role, actor }` for screens |
| `src/components/security/RequireAccess.tsx` | route guard: redirects with a message shown as a toast by `DashboardLayout` |
| `src/components/security/UsersPanel.tsx` | Settings → Security → Users on this device |

### Storage and migration
- `mrchartist_inv_auth` keeps its name and shape: it is the **owner**. Legacy `{name, pin}` and older hashes still
  unlock and are upgraded exactly as before; additive fields on the record are preserved on re-hash / PIN change.
- New device-local keys (in `DEVICE_LOCAL_KEYS`, so never exported, imported, wiped by Erase, or encrypted by vault
  mode): `mrchartist_inv_auth_users` — `[{id, name, role: 'clerk'|'viewer', createdAt, v: 2, kdf, iter, salt, hash}]`
  (PBKDF2-SHA-256 at the same 600k iterations as the owner); `mrchartist_inv_auth_guard_users` — `{userId: GuardState}`.
  A stored role other than `clerk` reads as `viewer`; an "owner" in that list is never honoured.
- Session (`sessionStorage`): `'1'` = owner (what older builds wrote, so an open tab stays signed in after the
  upgrade), `'u:<id>'` = another user. Only the id is stored; name and role are read from the users list each time,
  so a role change applies at once and a removed user is signed out on the next check.
- With **no PIN set up** (single-user installs, tests) or no actor provider, every check passes, as before; boot
  code (migrations) runs inside `asSystem`. Once a PIN exists, a tab where no valid user resolves — locked, or **the
  signed-in user was removed** in another tab — is *signed out*: `currentRole()` is `viewer`, never the owner
  (`isSignedOut()` in `access.ts`). `App.tsx` re-checks `isAuthenticated()` on `storage` events for the auth / users /
  session keys, on the user-change broadcast (`announceUserChange`, sent by `users.ts` on add / remove / role change /
  PIN reset), on window focus and on every idle-lock tick, and locks when it is false; a changed role remounts the
  shell so every screen re-reads its permissions.
- Registering a fresh owner (after Forgot PIN) clears any users left behind. The owner's Forgot PIN still erases
  everything (users included); a clerk / viewer who forgets their PIN is pointed to the owner, who resets it in
  Settings → Security (this also lifts that user's lockout). Nothing is erased.

### Login
With more than one user a **User** picker appears (owner selected by default), then the PIN. **Lockout is per user**
(same 5 attempts → 30 s doubling to 1 h): the owner keeps `auth_guard`, others live in `auth_guard_users`, so a
clerk mistyping cannot lock the owner out. Idle lock and the all-tab lock are unchanged (locking ends whoever's
session it is).

### Enforcement
- **Screens:** navigation (New invoice, Recurring, Time, Reconcile, Cheques, Design studio), the mobile "New" tab, command
  palette actions, Dashboard / Transactions / Receivables / Clients / Expenses create buttons, Transactions Edit /
  Duplicate / Record payment / Delete (issued only for the owner; bulk Delete needs every selected row deletable),
  Settings tabs (clerk: Items, Activity, Security; viewer: Activity, Security), the period-lock "Unlock with PIN"
  banner button, the backup nudge, the setup wizard and checklist.
- **Routes:** `/invoice` (`doc.create`) and `/invoice/:id` (`doc.edit`) send a viewer to `/transactions` (preview /
  PDF live there); `/recurring`, `/time`, `/reconcile`, `/cheques` need `books.edit`; `/design` needs `settings.manage`.
- **Data layer** (so the command palette or a missed button cannot get round it): `localDb.invoices.save / setStatus
  / remove` (issued vs draft), `localDb.payments.record / remove`, `localDb.clients.remove`, `purchasesDb.save /
  remove`, purchase `paymentsDb.record / remove`, `saveVoucher` / `deleteVoucher`, `saveCheque` / `deleteCheque` / `transitionCheque`, `vendorsDb.remove`,
  `createCompany` / `renameCompany` / `deleteCompany`,
  `restoreBackup`, `applyBackup`, `wipeAppData`, `saveSafetySnapshot` (restore → `data.restore`, wipe → `data.erase`,
  so a refused restore cannot replace the owner's undo copy), `grantOverride` (period lock; also verifies the
  signed-in user's PIN), `setIdleTimeout`, the vault switches. The viewer's recurring runner does not generate invoices.
- **Backups (owner only):** `buildBackup`, `buildEncryptedBackup`, `exportPlainBackup`, `backupPayload`,
  `downloadBackupNow`, `runAutoBackup({ interactive: true })`, `chooseBackupFolder`, `disconnectFolder`, `saveConfig`,
  `setBackupPassphrase` / `clearBackupPassphrase`. Unattended scheduled runs (`runDueBackup`) use
  `buildScheduledBackup` and keep running whoever is signed in — the owner chose the folder and the schedule. The
  Automatic backups card and the download buttons are hidden without `data.backup`.
- **Folder sync (owner only):** `connectSync`, `reenterPassphrase`, `disconnectSync` and interactive `runSyncNow` need
  `settings.manage`; the Sync card is hidden otherwise. The connection records `connected_by`; automatic runs refuse a
  connection not made by the owner, and a connection from before this was recorded runs automatically only after
  the owner's first run vouches for it. Merges still run `asSystem` (another device's changes are not a user edit),
  but a settings change from another device that **alters payment details** (any profile's UPI ID, bank name,
  account name / number, IFSC) is never applied silently: it is listed as a sync conflict (reason `payment`, this
  device keeps its version) for the owner to accept or decline (`resolveConflict` on settings needs
  `settings.manage`; declining is remembered like a declined locked-period change). See `docs/features/sync.md`.

### Audit
`AuditEntry.by` (additive) holds the signed-in user's name, set by `audit.record` from `currentActor()`. It is part
of the hashed row, so the chain verifies and rewriting who did something breaks it; older rows simply have no `by`.
Shown in Settings → Activity, the document timeline and the CSV export (new last column `By`). Adding / removing a
user, changing a role and resetting a PIN are logged (never the PIN).

### Known gaps
Some secondary controls (e.g. on Inventory and Books tabs) are still visible to a viewer. Their writes are refused:
besides the per-API guards above, `storage.setTable` checks a table → permission map (`requireTableWrite` in
`access.ts`: masters such as catalogue, stock items, godowns, cost centres, bank accounts, price levels → `master.edit`;
stock moves, transfers, purchases, recurring, vouchers, budgets, fixed assets, cheques, advances … → `books.edit`).
Invoices and payments are guarded by their APIs (finer rules); audit, notifications, export / design preferences and
compliance marks stay writable because the app writes them while viewing. Writes no person asked for (folder-sync
merges, migrations) run inside `asSystem()`. Settings saves are hidden
from non-owners but not refused in `localDb.settings.save` (setup and GST-frequency flows call it). Tests:
`tests/roles.test.ts`, `tests/roles-tables.test.ts`, e2e step "local roles" in `tests/e2e/smoke.mjs`.

## Import parser caps

Any file parsed into a table (CSV `parseTable` / `parseCsv`, `.xlsx` `readXlsx` / `sheetToTable`, bank statements,
26AS, IRP responses) is capped at **1,000 columns** (`MAX_TABLE_COLUMNS`) and **5,000,000 cells** (`MAX_TABLE_CELLS`,
counted while scanning, before any padding) in `src/lib/csv.ts`. Beyond either, a `TableLimitError` with a readable
message is shown instead of padding a tiny file (one cell in column XFD on every row, a 4,000-column header over
one-cell rows) into a grid that freezes the tab. Trailing blank columns never count toward the width.

## Security review fixes (roles, backups, sync, parsers)

Tests: `tests/security-review.test.ts` (removed-user lock M1, owner-only backups M2, undo copy L3, idle timeout L6,
forgot-PIN L2, payment-detail sync hold M3, parser caps L1) and `tests/security-review-idb.test.ts` (vault damaged
boot L5, vault switches L6, vault + plain backups L4, folder-sync gates M3). `dompurify` (a `jspdf` dependency) is
pinned to a fixed release through `overrides` in `package.json`.

## Review fixes (Phase 4)

- **CI actions pinned to commit SHAs** (`.github/workflows/ci.yml`, tag in a trailing comment), kept current by
  `.github/dependabot.yml` (GitHub Actions only, monthly), so a moved tag cannot change what CI runs.
- **Erase / Forgot-PIN reset forget IndexedDB too** (`forgetDeviceData` in `auto-backup.ts`): the restore undo copy,
  the backup encryption key and the backup-folder handle are cleared, and Erase keeps no undo copy, so a new PIN holder
  cannot "undo" the owner's data back or write over the owner's backup folder. Erase needs `ERASE` typed.
- **PIN lockout counts the attempt before the slow hash**, so attempts racing from several tabs cannot each slip past.
- **Lock applies to every tab** (`BroadcastChannel` from `logout`, honoured by `onRemoteLock` in `App.tsx`).
- **Printed UPI QR codes and statement QR** are built through the validating `upiLink`, and the statement email uses
  `mailtoLink`, so a doctored VPA or e-mail (e.g. `a@b.com?bcc=…`) from an imported or restored file is refused.
- **Import error CSVs** use the formula-guarded `toCsv`; file reads (backups, 26AS) are capped at 25 MB.
- **Payments are atomic**: if the invoice update fails (quota), the payment row is rolled back.
- **Service worker** only caches SPA routes as the app shell, never a real `.html` file such as `/offline.html`.
