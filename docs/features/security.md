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
| `src/components/security/` | `SecurityPanel`, `ChangePinModal`, `EncryptedBackup`, `IdleLock` |

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
There is no server, so the only recovery is erasing the device: `resetAllData(phrase)` requires the exact phrase `DELETE ALL MY DATA` (case/spacing-insensitive) and removes every `mrchartist_inv_*` key (plus the session). Keys outside the prefix (e.g. `theme`) are untouched. The login page offers it behind "Forgot PIN?".

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
  theme are not data and are not encrypted. Exported backups are whatever you choose (use an encrypted export);
  the panel warns when automatic folder backups are unencrypted.
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
  vault record shows "Your data could not be opened" with the same erase option.
- **Limits.** Not a defence against malware or someone using the unlocked app; data is decrypted in memory while the
  tab is open. Passphrase attempts are not rate-limited beyond the cost of PBKDF2 (an attacker with a copy of the
  data can guess offline, so use a long passphrase; the minimum is 10 characters). Needs IndexedDB and a secure page.

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
