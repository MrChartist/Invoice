/** WP-9 maker-checker: policy, the localDb gate, owner approval / rejection, roles and audit. */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER } from './helpers/world.ts';
import { setActorProvider, roleCan, isAccessDeniedError, type Role } from '../src/lib/access.ts';
import { localDb } from '../src/lib/localDb.ts';
import { audit } from '../src/lib/audit.ts';
import {
  approvalLog, approvalRequired, approveDocument, pendingApprovals, readApprovalPolicy, rejectDocument, saveApprovalPolicy,
} from '../src/lib/approvals.ts';
import { DEFAULT_POLICY } from '../src/lib/approval-gate.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const as = (role: Role, name: string = role) => setActorProvider(() => ({ id: name, name, role }));

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

function doc(id: string, total: number, status: InvoiceRecord['status'] = 'Sent'): InvoiceRecord {
  return {
    id, invoice_number: `INV/FY26-27/${id}`, doc_type: 'INVOICE', issue_date: '2026-05-10', due_date: '2026-05-24', status, currency: 'INR',
    template_id: 'classic_orange', client: { name: 'Acme' } as InvoiceRecord['client'], sender: SELLER,
    items: [{ id: 'l', name: 'Work', type: 'Service', hsn: '998314', unit: 'NOS', quantity: 1, rate: total, tax_rate: 0, amount: total }],
    gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0,
    other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: total, discount_amount: 0, taxable_value: total,
    cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total, balance_due: total,
  } as InvoiceRecord;
}

test('roles: only the owner may approve', () => {
  assert.equal(roleCan('owner', 'doc.approve'), true);
  assert.equal(roleCan('clerk', 'doc.approve'), false);
  assert.equal(roleCan('viewer', 'doc.approve'), false);
});

test('policy defaults off and only the owner changes it', () => {
  assert.deepEqual(readApprovalPolicy(), DEFAULT_POLICY);
  as('clerk');
  assert.throws(() => saveApprovalPolicy({ enabled: true, mode: 'all', threshold: 0 }), isAccessDeniedError);
  as('owner');
  saveApprovalPolicy({ enabled: true, mode: 'above', threshold: 10000 });
  assert.deepEqual(readApprovalPolicy(), { enabled: true, mode: 'above', threshold: 10000 });
});

test('pure rule: issuing only, threshold, POS exempt, own approval only', () => {
  const p = { enabled: true, mode: 'above' as const, threshold: 1000 };
  assert.equal(approvalRequired(doc('a', 1500), undefined, p, false), true);
  assert.equal(approvalRequired(doc('a', 500), undefined, p, false), false);
  assert.equal(approvalRequired(doc('a', 1500), undefined, p, true), false, 'owner saves freely');
  assert.equal(approvalRequired(doc('a', 1500, 'Draft'), undefined, p, false), false, 'drafts are free');
  assert.equal(approvalRequired(doc('a', 1500), { status: 'Sent' }, p, false), false, 'already issued');
  assert.equal(approvalRequired({ ...doc('a', 1500), pos: true }, undefined, p, false), false);
  const approved = { state: 'approved' as const, doc_id: 'a', requested_status: 'Sent' as const, requested_by: 'x', requested_at: '' };
  assert.equal(approvalRequired({ ...doc('a', 1500), approval: approved }, undefined, p, false), false);
  assert.equal(approvalRequired({ ...doc('b', 1500), approval: approved }, undefined, p, false), true, 'a copied approval does not count');
  assert.equal(approvalRequired(doc('a', 1), undefined, { ...p, mode: 'all' }, false), true);
  assert.equal(approvalRequired(doc('a', 1500), undefined, { ...p, enabled: false }, false), false);
});

test('clerk issue above the limit is held; owner approves; audit + log', () => {
  as('owner', 'Rohit');
  saveApprovalPolicy({ enabled: true, mode: 'above', threshold: 10000 });
  as('clerk', 'Asha');
  const small = localDb.invoices.save(doc('s', 5000));
  assert.equal(small.status, 'Sent');
  const big = localDb.invoices.save(doc('b', 25000));
  assert.equal(big.status, 'Draft');
  assert.equal(big.approval?.state, 'pending');
  assert.equal(big.approval?.requested_by, 'Asha');
  assert.equal(big.invoice_number, 'INV/FY26-27/b', 'provisional number kept');
  assert.deepEqual(pendingApprovals().map((i) => i.id), ['b']);
  assert.throws(() => approveDocument('b'), isAccessDeniedError, 'a clerk cannot approve');

  as('owner', 'Rohit');
  const ok = approveDocument('b');
  assert.equal(ok.status, 'Sent');
  assert.equal(ok.approval?.state, 'approved');
  assert.equal(ok.approval?.decided_by, 'Rohit');
  assert.equal(pendingApprovals().length, 0);
  assert.equal(approvalLog().length, 1);
  assert.ok(audit.all().some((e) => /Approved INV\/FY26-27\/b/.test(e.summary)));

  // An approved document edited later by the clerk stays issued.
  as('clerk', 'Asha');
  const edited = localDb.invoices.save({ ...localDb.invoices.getById('b')!, notes: 'edit' });
  assert.equal(edited.status, 'Sent');
});

test('rejection needs a note, keeps a draft; resubmitting files a new request', () => {
  as('owner');
  saveApprovalPolicy({ enabled: true, mode: 'all', threshold: 0 });
  as('clerk', 'Asha');
  localDb.invoices.save(doc('r', 100));
  as('owner');
  assert.throws(() => rejectDocument('r', ' '), /note/);
  const r = rejectDocument('r', 'Wrong rate');
  assert.equal(r.status, 'Draft');
  assert.equal(r.approval?.state, 'rejected');
  assert.equal(r.approval?.note, 'Wrong rate');
  assert.throws(() => approveDocument('r'), /not waiting/);
  as('clerk', 'Asha');
  const again = localDb.invoices.save({ ...localDb.invoices.getById('r')!, status: 'Sent' });
  assert.equal(again.status, 'Draft');
  assert.equal(again.approval?.state, 'pending');
});

test('single-user installs (nobody signed in) are never held', () => {
  setActorProvider(null);
  saveApprovalPolicy({ enabled: true, mode: 'all', threshold: 0 });
  assert.equal(localDb.invoices.save(doc('x', 100)).status, 'Sent');
});
