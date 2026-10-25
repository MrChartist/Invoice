/**
 * Folder sync (5.7): where the sync key lives on this device (company IndexedDB `kv` store).
 *
 *  - Vault off: a non-extractable AES-GCM CryptoKey (usable by this browser profile, bytes not readable),
 *    like the scheduled-backup key.
 *  - Vault on: the key bytes sealed with the vault key (`vaultSeal`), so a locked vault also protects the
 *    folder copy; the CryptoKey is rebuilt in memory only after the vault is unlocked.
 *
 * Vault switches carry the key across (`registerVaultTransition`, like the restore undo copy): sealed →
 * readable re-imports the bytes as a non-extractable key; a non-extractable key cannot be sealed, so
 * turning the vault on drops it and the panel asks for the sync passphrase once (`needs_passphrase`).
 * VaultPanel imports this module so the hook is registered before a switch.
 */

import { idbDel, idbGet, idbSet } from './idb-kv';
import { registerVaultTransition, vaultEnabled, vaultSeal, vaultUnseal } from './storage';
import { importSyncKey, type SyncKey } from './sync-files';

export const SYNC_KEY_KEY = 'sync-key';
const SEAL_NAME = 'sync-key';

interface StoredPlain {
  key: CryptoKey;
  salt: string;
  iter: number;
}
interface StoredSealed {
  sealed: string;
  salt: string;
  iter: number;
}
type Stored = StoredPlain | StoredSealed;

const isSealedRec = (v: unknown): v is StoredSealed => !!v && typeof (v as StoredSealed).sealed === 'string';
const isPlainRec = (v: unknown): v is StoredPlain => !!v && !!(v as StoredPlain).key && typeof (v as StoredPlain).salt === 'string';

async function store(k: SyncKey, raw: string | undefined): Promise<boolean> {
  if (vaultEnabled()) {
    if (!raw) return false;
    const rec: StoredSealed = { sealed: await vaultSeal(SEAL_NAME, raw), salt: k.salt, iter: k.iter };
    return idbSet(SYNC_KEY_KEY, rec);
  }
  const rec: StoredPlain = { key: k.key, salt: k.salt, iter: k.iter };
  return idbSet(SYNC_KEY_KEY, rec);
}

/** Remember a freshly derived key (needs `raw` when the vault is on). */
export function storeSyncKey(k: SyncKey): Promise<boolean> {
  return store(k, k.raw);
}

/** The usable key, or null (none stored, vault locked, or dropped by a vault switch). */
export async function loadSyncKey(): Promise<SyncKey | null> {
  const rec = await idbGet<Stored>(SYNC_KEY_KEY);
  if (isSealedRec(rec)) {
    const raw = await vaultUnseal(SEAL_NAME, rec.sealed);
    if (!raw) return null;
    try {
      return await importSyncKey(raw, rec.salt, rec.iter);
    } catch {
      return null;
    }
  }
  if (isPlainRec(rec)) {
    // A readable key left in a vault store (vault turned on in a build without this hook) is not used.
    if (vaultEnabled()) return null;
    return { key: rec.key, salt: rec.salt, iter: rec.iter };
  }
  return null;
}

export async function hasStoredSyncKey(): Promise<boolean> {
  return (await idbGet<Stored>(SYNC_KEY_KEY)) !== undefined;
}

export async function forgetSyncKey(): Promise<void> {
  await idbDel(SYNC_KEY_KEY);
}

registerVaultTransition({
  // Read with the OLD mode: sealed bytes are opened with the old vault key.
  before: async () => {
    const rec = await idbGet<Stored>(SYNC_KEY_KEY);
    if (isSealedRec(rec)) {
      const raw = await vaultUnseal(SEAL_NAME, rec.sealed);
      return raw ? { raw, salt: rec.salt, iter: rec.iter } : { drop: true };
    }
    if (isPlainRec(rec)) return { plain: rec };
    return null;
  },
  after: async (state) => {
    const s = state as { raw?: string; salt: string; iter: number; plain?: StoredPlain; drop?: boolean } | null;
    if (!s) return;
    if (s.drop) return void (await idbDel(SYNC_KEY_KEY));
    if (s.raw) {
      const k = await importSyncKey(s.raw, s.salt, s.iter);
      await store(k, s.raw);
      return;
    }
    // A non-extractable key cannot be sealed: drop it; the panel asks for the passphrase again.
    if (s.plain && vaultEnabled()) await idbDel(SYNC_KEY_KEY);
  },
});
