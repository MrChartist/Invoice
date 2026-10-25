/** Regressions for the Phase 4 security review. */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { buildUpiUrl } from '../src/components/templates/paper-helpers.ts';
import { localDb } from '../src/lib/localDb.ts';
import { forgetDeviceData } from '../src/lib/auto-backup.ts';
import { reportErrorsCsv } from '../src/lib/importers.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('printed UPI QR only uses a valid VPA (a doctored profile cannot redirect payment)', () => {
  const ok = buildUpiUrl({ upiId: 'shop@okhdfcbank', companyName: 'Shop & Co' } as never);
  assert.match(ok, /^upi:\/\/pay\?pa=shop@okhdfcbank&pn=Shop%20%26%20Co&cu=INR$/);
  assert.equal(buildUpiUrl({ upiId: 'shop@okhdfcbank&pa=thief@ybl', companyName: 'X' } as never), '');
  assert.equal(buildUpiUrl({ upiId: 'not a vpa', companyName: 'X' } as never), '');
});

test('forgetDeviceData never throws without IndexedDB (tests / private mode)', async () => {
  await forgetDeviceData();
});

test('import error CSVs neutralise formula cells echoed from the source file', () => {
  const csv = reportErrorsCsv({ created: 0, updated: 0, skipped: 0, errors: [{ line: 2, label: '=HYPERLINK("http://x")', message: 'bad' }] } as never);
  assert.ok(!csv.includes(',=HYPERLINK'), 'formula is escaped');
});

test('a payment whose invoice update fails is rolled back (no double payment on retry)', () => {
  const inv = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  const original = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (k: string, v: string) => {
    if (k === 'mrchartist_inv_invoices') throw new DOMException('full', 'QuotaExceededError');
    original(k, v);
  };
  try {
    assert.throws(() => localDb.payments.record({ invoiceId: inv.id, amount: 500, method: 'UPI', date: '2026-04-12' }));
  } finally {
    localStorage.setItem = original;
  }
  assert.equal(localDb.payments.listFor(inv.id).length, 0);
  assert.equal(reload(inv.id).amount_paid, 0);
});

test('parallel wrong PIN attempts each count toward the lockout', async () => {
  const auth = await import('../src/lib/auth.ts');
  const { hashPin } = await import('../src/lib/crypto.ts');
  localStorage.setItem('mrchartist_inv_auth', JSON.stringify({ name: 'A', createdAt: '2026-01-01', v: 2, ...(await hashPin('482916')) }));
  await Promise.all([auth.checkPinWithGuard('000001'), auth.checkPinWithGuard('000002'), auth.checkPinWithGuard('000003')]);
  assert.equal(auth.getAttemptsLeft(), 2, 'three racing failures, not one');
  assert.equal((await auth.checkPinWithGuard('482916')).ok, true);
  assert.equal(auth.getAttemptsLeft(), 5);
});
