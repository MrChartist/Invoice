/**
 * Vault mode (roadmap 5.8): the whole data store encrypted at rest.
 *
 * Key hierarchy
 *  - A random AES-GCM-256 data key (DEK) encrypts every value in the IndexedDB `data` store.
 *    In memory it is a non-extractable CryptoKey; it is never written anywhere in the clear.
 *  - The DEK is wrapped (AES-KW) with a key-encryption key derived from the passphrase with
 *    PBKDF2-SHA-256 (600k iterations, random salt). The wrapped DEK, salt and iteration count
 *    form the vault record, stored next to the data under `VAULT_KEY`.
 *  - Changing the passphrase re-wraps the same DEK (no re-encryption of the data).
 *
 * Each value is sealed as `mcv1:<iv b64>:<ciphertext b64>` with a fresh 96-bit IV and the
 * storage key as additional data, so a ciphertext cannot be swapped onto another key.
 *
 * There is no recovery: a lost passphrase means the data cannot be decrypted. This module is
 * pure crypto (no storage state); `storage.ts` holds the unlocked key and does the I/O.
 */

import { CryptoError, PBKDF2_ITERATIONS, MIN_ITERATIONS, base64ToBytes, bytesToBase64, randomBytes } from './crypto';

/** Key of the vault record in the IndexedDB `data` store (not `mrchartist_inv_`-prefixed: never a data key). */
export const VAULT_KEY = '__vault__';
export const SEAL_PREFIX = 'mcv1:';
/** Minimum passphrase length accepted by the UI and the API. */
export const MIN_PASSPHRASE = 10;

const MAX_ITERATIONS = 5_000_000;
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface VaultRecord {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  /** The DEK wrapped with AES-KW (base64). */
  wrapped: string;
  /** Random id; changes when the vault is (re-)created, so a tab can tell it holds a stale key. */
  id: string;
  created: string;
}

export class VaultError extends Error {
  readonly code: 'wrong-passphrase' | 'bad-record' | 'weak-passphrase' | 'decrypt-failed';
  constructor(message: string, code: VaultError['code']) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CryptoError('Encryption is not available in this browser (needs a secure https:// page).', 'unsupported');
  return s;
}

export function isVaultRecord(v: unknown): v is VaultRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    r.v === 1 &&
    r.kdf === 'PBKDF2-SHA256' &&
    typeof r.iter === 'number' &&
    Number.isInteger(r.iter) &&
    r.iter >= MIN_ITERATIONS &&
    r.iter <= MAX_ITERATIONS &&
    typeof r.salt === 'string' &&
    r.salt.length >= 12 &&
    r.salt.length <= 128 &&
    typeof r.wrapped === 'string' &&
    r.wrapped.length >= 16 &&
    r.wrapped.length <= 256 &&
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    r.id.length <= 64
  );
}

export function isSealed(value: string): boolean {
  return value.startsWith(SEAL_PREFIX);
}

export function checkPassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) {
    throw new VaultError(`Use a passphrase of at least ${MIN_PASSPHRASE} characters.`, 'weak-passphrase');
  }
}

async function deriveKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrapDek(dek: CryptoKey, passphrase: string, iter: number): Promise<Pick<VaultRecord, 'salt' | 'wrapped' | 'iter'>> {
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, iter);
  const wrapped = await subtle().wrapKey('raw', dek, kek, 'AES-KW');
  return { salt: bytesToBase64(salt), wrapped: bytesToBase64(new Uint8Array(wrapped)), iter };
}

/** Unwrap the DEK. `extractable` only for a re-wrap (passphrase change); the session key is not. */
export async function unwrapDek(record: VaultRecord, passphrase: string, extractable = false): Promise<CryptoKey> {
  if (!isVaultRecord(record)) throw new VaultError('The vault record is damaged.', 'bad-record');
  let salt: Uint8Array<ArrayBuffer>;
  let wrapped: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(record.salt);
    wrapped = base64ToBytes(record.wrapped);
  } catch {
    throw new VaultError('The vault record is damaged.', 'bad-record');
  }
  const kek = await deriveKek(passphrase, salt, record.iter);
  try {
    return await subtle().unwrapKey('raw', wrapped, kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, extractable, [
      'encrypt',
      'decrypt',
    ]);
  } catch {
    // AES-KW's integrity check fails for a wrong passphrase (or a modified record).
    throw new VaultError('Wrong passphrase.', 'wrong-passphrase');
  }
}

/** A new vault: fresh DEK wrapped under `passphrase`. Returns the record and the session key. */
export async function createVault(passphrase: string, iter: number = PBKDF2_ITERATIONS, now: Date = new Date()): Promise<{ record: VaultRecord; key: CryptoKey }> {
  checkPassphrase(passphrase);
  const dek = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = await wrapDek(dek, passphrase, iter);
  const record: VaultRecord = { v: 1, kdf: 'PBKDF2-SHA256', ...wrapped, id: bytesToBase64(randomBytes(12)), created: now.toISOString() };
  // Work with a non-extractable copy from here on; the extractable one goes out of scope.
  const key = await unwrapDek(record, passphrase);
  return { record, key };
}

/** Same DEK, new passphrase (and salt). Throws `wrong-passphrase` when `current` is wrong. */
export async function rewrapVault(record: VaultRecord, current: string, next: string, iter: number = PBKDF2_ITERATIONS): Promise<VaultRecord> {
  checkPassphrase(next);
  const dek = await unwrapDek(record, current, true);
  return { ...record, ...(await wrapDek(dek, next, iter)) };
}

export async function seal(key: CryptoKey, name: string, plaintext: string): Promise<string> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(name) }, key, encoder.encode(plaintext));
  return `${SEAL_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ct))}`;
}

export async function unseal(key: CryptoKey, name: string, sealed: string): Promise<string> {
  if (!isSealed(sealed)) throw new VaultError('Not an encrypted value.', 'decrypt-failed');
  const [ivB64, ctB64] = sealed.slice(SEAL_PREFIX.length).split(':');
  try {
    const iv = base64ToBytes(ivB64 ?? '');
    if (iv.length !== IV_BYTES) throw new Error('bad iv');
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(name) }, key, base64ToBytes(ctB64 ?? ''));
    return decoder.decode(plain);
  } catch {
    throw new VaultError(`"${name}" could not be decrypted (damaged or moved).`, 'decrypt-failed');
  }
}
