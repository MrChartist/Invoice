import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { outputs } from '../scripts/gen-headers.mjs';
import { CSP, CSP_META } from '../scripts/security-headers.mjs';

test('host header files match scripts/security-headers.mjs (run node scripts/gen-headers.mjs)', () => {
  for (const [rel, expected] of outputs() as [string, string][]) {
    assert.equal(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'), expected, `${rel} drifted`);
  }
});

test('CSP stays strict and the meta copy drops only frame-ancestors', () => {
  for (const d of ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(CSP.includes(d), d);
  }
  assert.ok(!/unsafe-eval|https?:/.test(CSP), 'no eval and no remote origins');
  assert.ok(!CSP_META.includes('frame-ancestors'));
  assert.equal(CSP_META.split('; ').length, CSP.split('; ').length - 1);
});
