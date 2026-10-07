# Security module

Hashed PIN, brute-force lockout, idle auto-lock, forgot-PIN recovery and passphrase-encrypted backups.
No network, no dependencies — only WebCrypto (`crypto.subtle`).

## Files
| file | role |
|---|---|
| `src/lib/crypto.ts` | PBKDF2-SHA-256 (310k iter) PIN hashing, constant-time compare, AES-GCM-256 string encryption (envelope `{v,kdf,iter,salt,iv,ct}`, header bound as AAD), base64 helpers |
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
  "envelope": { "v": 1, "kdf": "PBKDF2-SHA256", "iter": 310000, "salt": "b64", "iv": "b64", "ct": "b64" } }
```
`ct` decrypts to the normal `BackupFile` JSON. Filename: `mrchartist-invoice-backup-YYYY-MM-DD.encrypted.json`. A wrong passphrase or any modification fails the GCM tag: "Wrong passphrase, or the file has been modified."

## Honest limits
A 4-6 digit PIN has ~13-20 bits of entropy. The hash + lockout stops casual snooping and slows UI guessing, but anyone with raw access to the browser profile can read `localStorage` directly (invoice data is not encrypted at rest) or brute-force the hash offline. Use an encrypted backup with a real passphrase for portable secrecy.

## Tests
`tests/crypto.test.ts`, `tests/auth.test.ts` (injected clock + in-memory storage), `tests/backup.test.ts` (existing cases kept, encrypted cases added).
