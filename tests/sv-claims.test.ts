/** SV-A5 payer split and claims: split per line / per head, totals, B2B / B2CS routing, write-off, rejection, numbering. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_MH, SELLER, clientRetail, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';
import { CLM, billClaim, deleteClaim, linesTotal, loadClaims, rejectAndRebill, saveClaim, splitForPayer, writeOffShort } from '../src/lib/services/sv-claims.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = (id: string, rate: number, qty = 1): InvoiceItem => ({ id, name: id, type: 'Service', hsn: '998714', unit: 'NOS', quantity: qty, rate, tax_rate: 18, discount_percent: 0, amount: rate * qty });

test('split per line and per head: each line divided exactly; reasons on the beneficiary part', () => {
  const lines = [line('pads', 2000, 2), line('bumper', 6000), line('labour', 3000)];
  const perLine = splitForPayer(lines, { perLine: { pads: 4000, bumper: 3000 }, parts: { bumper: 'depreciation' } });
  assert.deepEqual(perLine.payer.map((l) => [l.name, l.rate * l.quantity]), [['pads', 4000], ['bumper', 3000]]);
  assert.deepEqual(perLine.beneficiary.map((l) => [l.name, l.rate * l.quantity, l.sv?.claim_part]), [['bumper', 3000, 'depreciation'], ['labour', 3000, 'disallowed']]);
  const head = splitForPayer(lines, { approved: 11800, total: 15340 });
  const sum = (ls: InvoiceItem[]) => ls.reduce((n, l) => n + l.rate * l.quantity, 0);
  assert.equal(Math.round((sum(head.payer) + sum(head.beneficiary)) * 100) / 100, 13000, 'adds up to the job');
  assert.ok(head.payer.every((l) => l.sv?.claim_part === 'approved'));
});

test('claim → two bills that total the job; insurer with a GSTIN in B2B, owner in B2CS; numbering CLM never reused', () => {
  const insurerId = localDb.clients.upsert({ name: 'Acme Insurance', gstin: BUYER_MH, state_code: '27' });
  const ownerId = localDb.clients.upsert({ ...clientRetail, id: undefined });
  const job = createViaStore({ client: clientRetail, date: '2026-10-05', lines: [{ name: 'Pads', rate: 20000, qty: 1, tax: 18 }, { name: 'Labour', rate: 22372.88, qty: 1, tax: 18 }], asDraft: true });
  const c = saveClaim({ date: '2026-10-05', kind: 'motor', payer_id: insurerId, payer_name: 'Acme Insurance', beneficiary_id: ownerId, beneficiary_name: clientRetail.name, policy_no: 'P1', claim_no: 'C9', estimate: Number(job.total), approved: 42000 });
  assert.match(c.number, new RegExp(`^${CLM}/FY26-27/0001$`));
  assert.equal(c.status, 'approved');
  const { payer, beneficiary } = billClaim(c.id, job.items, { approved: 42000, total: Number(job.total) }, '2026-10-06', job);
  assert.ok(payer && beneficiary);
  assert.equal(beneficiary!.id, job.id, 'the job draft becomes the owner\'s bill (no number skipped)');
  assert.equal(beneficiary!.invoice_number, job.invoice_number);
  assert.equal(Math.round(linesTotal(payer!, payer!.items)), 42000);
  assert.ok(Math.abs(Number(payer!.total) + Number(beneficiary!.total) - Number(job.total)) <= 1);
  assert.deepEqual([payer!.sv?.claim?.role, payer!.sv?.claim?.claim_no, beneficiary!.sv?.claim?.role], ['payer', 'C9', 'beneficiary']);
  assert.throws(() => billClaim(c.id, job.items, { approved: 1, total: 2 }), /already billed/);
  // Issue both and report.
  for (const inv of [payer!, beneficiary!]) localDb.invoices.save({ ...inv, status: 'Sent' });
  const rep = buildGstReport(getTable<InvoiceRecord>('invoices'), [], { period: { kind: 'month', fyStart: 2026, month: 10 }, gstin: SELLER.companyGstin });
  assert.equal(rep.gstr1.b2b.length, 1);
  assert.ok(rep.gstr1.b2cs.length >= 1);
  // A second claim takes the next number even after the first is gone.
  const c2 = saveClaim({ date: '2026-10-07', kind: 'other', payer_name: 'X', beneficiary_name: 'Y', estimate: 0, approved: 0 });
  deleteClaim(c2.id);
  const c3 = saveClaim({ date: '2026-10-07', kind: 'other', payer_name: 'X', beneficiary_name: 'Y', estimate: 0, approved: 0 });
  assert.equal(c3.number, 'CLM/FY26-27/0003');
  assert.throws(() => deleteClaim(c.id), /has bills/);
});

test('short payment write-off; rejection re-bills the beneficiary and cancels (never deletes) the payer bill', () => {
  const job = createViaStore({ client: clientRetail, date: '2026-10-05', lines: [{ name: 'Room', rate: 10000, qty: 1, tax: 18 }], asDraft: true });
  const c = saveClaim({ date: '2026-10-05', kind: 'health_tpa', payer_name: 'TPA', beneficiary_name: 'Patient', estimate: 11800, approved: 11800 });
  const { payer, beneficiary } = billClaim(c.id, job.items, { approved: 11800, total: Number(job.total) }, '2026-10-06', job);
  assert.equal(beneficiary, undefined);
  assert.equal(payer!.id, job.id, 'fully approved: the job draft becomes the payer bill');
  localDb.invoices.save({ ...payer!, status: 'Sent' });
  const r = rejectAndRebill(c.id, 'Not covered', '2026-10-20');
  assert.equal(localDb.invoices.getById(payer!.id)!.status, 'Cancelled');
  assert.equal(r.sv?.claim?.role, 'beneficiary');
  assert.equal(loadClaims()[0].status, 'rejected');
  // Short payment on a fresh claim.
  const job2 = createViaStore({ client: clientRetail, date: '2026-10-05', lines: [{ name: 'Job', rate: 1000, qty: 1, tax: 18 }], asDraft: true });
  const c2 = saveClaim({ date: '2026-10-05', kind: 'motor', payer_name: 'Ins', beneficiary_name: 'Own', estimate: 1180, approved: 1180 });
  const b2 = billClaim(c2.id, job2.items, { approved: 1180, total: 1180 }, '2026-10-06', job2);
  localDb.invoices.save({ ...b2.payer!, status: 'Sent' });
  writeOffShort(c2.id, '2026-10-30');
  assert.equal(loadClaims().find((x) => x.id === c2.id)!.status, 'short_paid');
  assert.ok(getTable<{ write_off?: boolean; invoice_id: string }>('transactions').some((p) => p.invoice_id === b2.payer!.id && p.write_off));
});
