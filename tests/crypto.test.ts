import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  constantTimeEqual,
  constantTimeEqualStrings,
  decryptString,
  encryptString,
  hashPin,
  verifyPinHash,
  MIN_ITERATIONS,
} from '../src/lib/crypto.ts';

test('base64 helpers round-trip arbitrary bytes, including large buffers', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.throws(() => base64ToBytes('not base64!!'), /Malformed/);
});

test('constant-time compares', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2])), false);
  assert.equal(constantTimeEqualStrings('1234', '1234'), true);
  assert.equal(constantTimeEqualStrings('1234', '12345'), false);
  assert.equal(constantTimeEqualStrings('', ''), true);
});

test('hashPin: verifies the right PIN, rejects the wrong one, salts uniquely', async () => {
  const a = await hashPin('4821');
  const b = await hashPin('4821');
  assert.ok(a.iter >= 210_000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.ok(!JSON.stringify(a).includes('4821'));
  assert.equal(await verifyPinHash('4821', a), true);
  assert.equal(await verifyPinHash('4822', a), false);
  assert.equal(await verifyPinHash('4821', { ...a, hash: b.hash }), false);
  assert.equal(await verifyPinHash('4821', { ...a, salt: '###' }), false);
});

test('hashPin refuses weak iteration counts', async () => {
  await assert.rejects(hashPin('1234', MIN_ITERATIONS - 1));
});

test('encrypt/decrypt round-trips unicode text with a fresh salt and iv each time', async () => {
  const text = JSON.stringify({ name: 'रोहित ₹1,00,000', n: [1, 2, 3] });
  const a = await encryptString(text, 'correct horse battery');
  const b = await encryptString(text, 'correct horse battery');
  assert.equal(a.v, 1);
  assert.equal(a.kdf, 'PBKDF2-SHA256');
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.iv, b.iv);
  assert.equal(await decryptString(a, 'correct horse battery'), text);
});

test('decrypt rejects a wrong passphrase', async () => {
  const env = await encryptString('secret', 'right-passphrase');
  await assert.rejects(decryptString(env, 'wrong-passphrase'), /Wrong passphrase/);
});

test('decrypt detects tampering with ciphertext, iv, and the authenticated header', async () => {
  const env = await encryptString('secret data', 'right-passphrase');
  const ct = base64ToBytes(env.ct);
  ct[0] ^= 1;
  await assert.rejects(decryptString({ ...env, ct: bytesToBase64(ct) }, 'right-passphrase'), /modified/);
  const iv = base64ToBytes(env.iv);
  iv[0] ^= 1;
  await assert.rejects(decryptString({ ...env, iv: bytesToBase64(iv) }, 'right-passphrase'));
  await assert.rejects(decryptString({ ...env, iter: env.iter + 1 }, 'right-passphrase'));
});

test('decrypt rejects malformed envelopes', async () => {
  await assert.rejects(decryptString(null, 'x'), /not a valid/);
  await assert.rejects(decryptString({ v: 2 }, 'x'), /not a valid/);
  const env = await encryptString('a', 'passphrase1');
  await assert.rejects(decryptString({ ...env, iter: 1 }, 'passphrase1'), /not a valid/);
});
