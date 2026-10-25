import test from 'node:test';
import assert from 'node:assert/strict';
import { answersFrom, applyAnswers, shouldShowWizard, stepProblem } from '../src/lib/onboarding.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import type { AppSettings } from '../src/lib/localDb.ts';

const GSTIN = '27AAPFU0939F1Z' + gstinChecksumChar('27AAPFU0939F1Z');
const settings = { profiles: [{ id: 'p1', companyName: '', bankName: '' }, { id: 'p2', companyName: 'Other' }], activeProfileId: 'p1', onboarded: false } as unknown as AppSettings;
const base = { ...answersFrom(null, 'classic_orange'), companyName: 'Ravi Traders', stateCode: '' };

test('each step blocks only on what it asks for', () => {
  assert.match(stepProblem('business', { ...base, companyName: ' ' }), /name/);
  assert.match(stepProblem('business', { ...base, pin: '4006' }), /6 digits/);
  assert.equal(stepProblem('business', base), '');
  assert.match(stepProblem('gst', { ...base, gstRegistered: false }), /state/);
  assert.equal(stepProblem('gst', { ...base, gstRegistered: false, stateCode: '27' }), '');
  assert.match(stepProblem('gst', { ...base, gstRegistered: true, companyGstin: '27AAPFU0939F1ZX' }), /checksum|format/i);
  assert.equal(stepProblem('gst', { ...base, gstRegistered: true, companyGstin: GSTIN }), '');
  assert.match(stepProblem('payment', { ...base, upiId: 'nope' }), /UPI/);
  assert.match(stepProblem('payment', { ...base, ifsc: 'HDFC1234' }), /IFSC/);
  assert.equal(stepProblem('payment', base), '', 'payment details are optional');
});

test('applyAnswers fills the active profile only, derives the state from the GSTIN and marks onboarded', () => {
  const out = applyAnswers(settings, { ...base, gstRegistered: true, companyGstin: GSTIN.toLowerCase(), upiId: 'ravi@okhdfc', accountNumber: '1234 5678 90', ifsc: 'hdfc0001234' });
  const p = out.profiles[0];
  assert.equal(out.onboarded, true);
  assert.equal(p.companyName, 'Ravi Traders');
  assert.equal(p.companyGstin, GSTIN);
  assert.equal(p.stateCode, '27');
  assert.equal(p.accountNumber, '1234567890');
  assert.equal(p.ifsc, 'HDFC0001234');
  assert.equal(p.accountName, 'Ravi Traders', 'account name defaults to the business name');
  assert.equal(out.profiles[1].companyName, 'Other');
  // Not registered: GSTIN dropped even if typed, chosen state kept.
  const unreg = applyAnswers(settings, { ...base, gstRegistered: false, companyGstin: GSTIN, stateCode: '29' }).profiles[0];
  assert.equal(unreg.companyGstin, '');
  assert.equal(unreg.stateCode, '29');
});

test('the wizard appears only for a brand-new account', () => {
  assert.equal(shouldShowWizard({ onboarded: false }, 0), true);
  assert.equal(shouldShowWizard({ onboarded: true }, 0), false);
  assert.equal(shouldShowWizard({ onboarded: false }, 3), false, 'existing users with data are never interrupted');
});
