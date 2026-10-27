/** PS-D5 UDIN register: format (verify), unique, revoke, unbilled list through `bill_refs`, delete refused while billed. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { deleteUdin, loadUdins, revokeUdin, saveUdin, udinProblems, udinRef, unbilledUdins } from '../src/lib/prof/ps-udin.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const row = (udin: string, date = '2026-10-12') => saveUdin({ udin, date, client_id: 'c1', kind: 'certificate', description: 'Net worth certificate', member_no: '123456' });

test('format: 18 characters, year of generation, membership no. inside', () => {
  assert.deepEqual(udinProblems('26123456ABCDEF1234', '123456', '2026-10-12'), []);
  assert.deepEqual(udinProblems('26012345ABCDEF1234', '12345', '2026-10-12'), [], 'member no. zero-padded');
  assert.equal(udinProblems('26123456ABCDEF123', '123456', '2026-10-12').length, 1);
  assert.match(udinProblems('25123456ABCDEF1234', '123456', '2026-10-12').join(' '), /year/);
  assert.match(udinProblems('26999999ABCDEF1234', '123456', '2026-10-12').join(' '), /membership/);
});

test('unique, revoke keeps the row, unbilled list follows live invoices', () => {
  const a = row('26123456abcdef1234');
  assert.equal(a.udin, '26123456ABCDEF1234');
  assert.throws(() => row('26123456ABCDEF1234'), /already/);
  const b = row('26123456ABCDEF9999', '2026-10-01');
  const inv = (status: string) => [{ status, items: [{ bill_refs: [udinRef(a.id)] }] }] as unknown as InvoiceRecord[];
  assert.deepEqual(unbilledUdins(loadUdins(), []).map((r) => r.id), [b.id, a.id]);
  assert.deepEqual(unbilledUdins(loadUdins(), inv('Draft')).map((r) => r.id), [b.id]);
  assert.deepEqual(unbilledUdins(loadUdins(), inv('Cancelled')).map((r) => r.id), [b.id, a.id], 'cancel frees it');
  assert.throws(() => deleteUdin(a.id, inv('Sent')), /billed/);
  revokeUdin(b.id, '2026-10-20', 'Wrong client');
  assert.deepEqual(unbilledUdins(loadUdins(), []).map((r) => r.id), [a.id]);
  assert.equal(loadUdins().find((r) => r.id === b.id)?.revoked?.reason, 'Wrong client');
  deleteUdin(a.id, []);
  assert.equal(loadUdins().length, 1);
});
