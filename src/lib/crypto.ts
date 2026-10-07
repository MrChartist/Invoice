/**
 * WebCrypto helpers — PIN hashing and passphrase encryption.
 *
 * Everything runs on the built-in `crypto.subtle` (browsers and Node >= 20), so
 * there are no dependencies and nothing leaves the device.
 *
 *  - PINs are stored as PBKDF2-SHA-256 hashes with a random per-record salt.
 *  - Backups are encrypted with AES-GCM-256 using a PBKDF2-derived key. The
 *    envelope header (version, kdf, iterations) is bound to the ciphertext as
 *    additional authenticated data, so any tampering fails the auth tag.
 *
 * A 4-6 digit PIN has very little entropy, so hashing only slows an attacker
 * who already holds the browser profile. It is a privacy gate, not a vault —
 * use an encrypted backup (with a real passphrase) for anything sensitive.
 */

export const PBKDF2_ITERATIONS = 310_000;
export const MIN_ITERATIONS = 210_000;
/** Upper bound accepted when reading an envelope, so a doctored file cannot hang the tab. */
const MAX_ITERATIONS = 5_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KDF_NAME = 'PBKDF2-SHA256';

export interface CipherEnvelope {
  v: 1;
  kdf: typeof KDF_NAME;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export interface PinHash {
  kdf: typeof KDF_NAME;
  iter: number;
  salt: string;
  hash: string;
}

export class CryptoError extends Error {
  readonly code: 'unsupported' | 'bad-envelope' | 'decrypt-failed';
  constructor(message: string, code: CryptoError['code']) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CryptoError('Secure cryptography is not available in this browser context (HTTPS required).', 'unsupported');
  return s;
}

/* ── bytes <-> base64 (Node and browsers) ─────────────────────── */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
    throw new CryptoError('Malformed encrypted data.', 'bad-envelope');
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Constant-time equality for two byte arrays (length differences are not secret). */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time string comparison (UTF-8 bytes). Used for the legacy plaintext PIN check. */
export function constantTimeEqualStrings(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  // Pad to equal length so the loop count does not leak the shorter length.
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

async function deriveBits(secret: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<ArrayBuffer> {
  const base = await subtle().importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, 256);
}

/* ── PIN hashing ──────────────────────────────────────────────── */

export async function hashPin(pin: string, iter: number = PBKDF2_ITERATIONS): Promise<PinHash> {
  if (iter < MIN_ITERATIONS) throw new CryptoError('Too few PBKDF2 iterations.', 'bad-envelope');
  const salt = randomBytes(SALT_BYTES);
  const bits = await deriveBits(pin, salt, iter);
  return { kdf: KDF_NAME, iter, salt: bytesToBase64(salt), hash: bytesToBase64(new Uint8Array(bits)) };
}

export async function verifyPinHash(pin: string, record: PinHash): Promise<boolean> {
  try {
    if (record.kdf !== KDF_NAME || !Number.isInteger(record.iter) || record.iter < 1 || record.iter > MAX_ITERATIONS) return false;
    const bits = await deriveBits(pin, base64ToBytes(record.salt), record.iter);
    return constantTimeEqual(new Uint8Array(bits), base64ToBytes(record.hash));
  } catch {
    return false;
  }
}

/* ── AES-GCM string encryption ────────────────────────────────── */

function aad(iter: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`v1|${KDF_NAME}|${iter}`);
}

async function aesKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number, usage: KeyUsage): Promise<CryptoKey> {
  const bits = await deriveBits(passphrase, salt, iter);
  return subtle().importKey('raw', bits, { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptString(
  plaintext: string,
  passphrase: string,
  iter: number = PBKDF2_ITERATIONS,
): Promise<CipherEnvelope> {
  if (!passphrase) throw new CryptoError('A passphrase is required.', 'bad-envelope');
  if (iter < MIN_ITERATIONS) throw new CryptoError('Too few PBKDF2 iterations.', 'bad-envelope');
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await aesKey(passphrase, salt, iter, 'encrypt');
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(iter) }, key, encoder.encode(plaintext));
  return { v: 1, kdf: KDF_NAME, iter, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export function isCipherEnvelope(value: unknown): value is CipherEnvelope {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    e.v === 1 &&
    e.kdf === KDF_NAME &&
    typeof e.iter === 'number' &&
    Number.isInteger(e.iter) &&
    e.iter >= MIN_ITERATIONS &&
    e.iter <= MAX_ITERATIONS &&
    typeof e.salt === 'string' &&
    typeof e.iv === 'string' &&
    typeof e.ct === 'string'
  );
}

export async function decryptString(envelope: unknown, passphrase: string): Promise<string> {
  if (!isCipherEnvelope(envelope)) throw new CryptoError('This is not a valid encrypted file.', 'bad-envelope');
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    if (iv.length !== IV_BYTES || salt.length < 8) throw new CryptoError('Malformed encrypted data.', 'bad-envelope');
    const key = await aesKey(passphrase, salt, envelope.iter, 'decrypt');
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv, additionalData: aad(envelope.iter) },
      key,
      base64ToBytes(envelope.ct),
    );
    return decoder.decode(plain);
  } catch (err) {
    if (err instanceof CryptoError && err.code !== 'decrypt-failed') throw err;
    throw new CryptoError('Wrong passphrase, or the file has been modified.', 'decrypt-failed');
  }
}
