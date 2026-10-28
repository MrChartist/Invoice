/**
 * R4-C5 auditor pack per FY: slicing across archive segments, the back-dated rule, overrides / approvals, the
 * integrity text for an intact and a tampered chain (with its SHA-256), payroll rows hidden without the right, and
 * the CSV formula guard.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { audit, auditSegments } from '../src/lib/audit.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { sha256 } from '../src/lib/sha256.ts';
import { backdatedRows, buildAuditorPack, fyBoundsOf, headAt, integrityText, sliceFy } from '../src/lib/trust/auditor-pack.ts';
import type { AuditEntry } from '../src/types/audit.ts';

beforeEach(() => resetStorage());

/** A real hash-chained log: rows recorded through `audit.record` with chosen times. */
function chain(): AuditEntry[] {
  audit.record({ at: '2025-03-20T05:00:00.000Z', entity: 'invoice', entity_id: 'i0', action: 'create', summary: 'Created INV/FY24-25/0009' });
  audit.record({ at: '2025-04-02T05:00:00.000Z', entity: 'invoice', entity_id: 'i1', action: 'create', summary: 'Created INV/FY25-26/0001', doc_number: 'INV/FY25-26/0001' });
  audit.record({ at: '2025-06-01T05:00:00.000Z', entity: 'invoice', entity_id: 'i1', action: 'override', summary: 'Period lock overridden with PIN for INV/FY25-26/0001 (valid 10 min)' });
  audit.record({ at: '2025-07-01T05:00:00.000Z', entity: 'client', entity_id: 'c1', action: 'delete', summary: 'Client =HYPERLINK("x") deleted', changes: [{ field: 'Name', from: '=HYPERLINK("x")', to: null }] });
  audit.record({ at: '2025-08-01T05:00:00.000Z', entity: 'payroll', entity_id: 'pr1', action: 'create', summary: 'Payroll run July: ₹2,40,000' });
  audit.record({ at: '2025-09-01T05:00:00.000Z', entity: 'invoice', entity_id: 'i2', action: 'update', summary: 'Approved INV/FY25-26/0002 (₹1,000) requested by Asha' });
  audit.record({ at: '2026-04-05T05:00:00.000Z', entity: 'invoice', entity_id: 'i3', action: 'create', summary: 'Created INV/FY26-27/0001' });
  return audit.fullRows();
}

test('FY slicing covers archive segments and the live log; the FY end head is the last row up to 31 March', () => {
  const rows = chain();
  // Move the three oldest rows into an archive segment (as the archiver does: still hash-chained).
  setTable('audit_archive_0001', rows.slice(0, 3));
  setTable('audit_log', rows.slice(3));
  assert.deepEqual(auditSegments(), ['audit_archive_0001']);
  const full = audit.fullRows();
  assert.equal(full.length, rows.length);
  assert.deepEqual(fyBoundsOf('FY25-26'), { from: '2025-04-01', to: '2026-03-31' });
  assert.deepEqual(sliceFy(full, 'FY25-26').map((r) => r.entity_id), ['i1', 'i1', 'c1', 'pr1', 'i2']);
  assert.equal(headAt(full, '2026-03-31'), full[5].hash);
});

test('back-dated: created in the FY, dated more than N days before creation', () => {
  const docs = [
    { kind: 'INVOICE', number: 'A', date: '2025-05-01', created_at: '2025-05-05T05:00:00Z' },
    { kind: 'INVOICE', number: 'B', date: '2025-05-01', created_at: '2025-05-20T05:00:00Z' },
    { kind: 'Voucher journal', number: 'JV/1', date: '2025-03-25', created_at: '2025-04-10T05:00:00Z' },
    { kind: 'INVOICE', number: 'C', date: '2024-05-01', created_at: '2024-06-20T05:00:00Z' },
  ];
  assert.deepEqual(backdatedRows(docs, 'FY25-26', 7).map((r) => [r.number, r.daysBefore]), [['JV/1', 16], ['B', 19]]);
  assert.deepEqual(backdatedRows(docs, 'FY25-26', 30).map((r) => r.number), []);
});

test('the pack: overrides + approvals, deletions with before values, payroll hidden without the right, formula guard', () => {
  const full = chain();
  const base = { fy: 'FY25-26', chain: full, segments: [], company: 'E2E Trader', generatedAt: '2026-05-01T00:00:00Z', docs: [], users: [{ name: 'Owner', role: 'owner' }, { name: '=cmd', role: 'clerk' }] };
  const pack = buildAuditorPack({ ...base, payroll: false });
  const file = (n: string) => pack.files.find((f) => f.name === n)!.text;
  assert.deepEqual(pack.files.map((f) => f.name), ['audit-log-FY25-26.csv', 'deletions-FY25-26.csv', 'backdated-FY25-26.csv', 'overrides-FY25-26.csv', 'integrity.txt', 'users.csv', 'README.txt']);
  assert.deepEqual(pack.counts, { entries: 4, deletions: 1, backdated: 0, overrides: 2 });
  assert.ok(!file('audit-log-FY25-26.csv').includes('Payroll run'), 'payroll hidden');
  assert.ok(buildAuditorPack({ ...base, payroll: true }).files[0].text.includes('Payroll run'));
  assert.match(file('overrides-FY25-26.csv'), /Period-lock override/);
  assert.match(file('overrides-FY25-26.csv'), /Approval decision/);
  assert.match(file('deletions-FY25-26.csv'), /'=HYPERLINK/, 'formula guard on the before value');
  assert.ok(!/(^|,)=HYPERLINK/m.test(file('deletions-FY25-26.csv')));
  assert.match(file('users.csv'), /'=cmd/);
  assert.match(file('README.txt'), /verify with your CA/i);
});

test('integrity.txt: INTACT with both heads and its own SHA-256; a tampered row reads BROKEN', () => {
  const full = chain();
  const ok = integrityText({ fy: 'FY25-26', chain: full, segments: [{ name: 'audit_archive_0001', rows: 3 }], company: 'E2E', generatedAt: 'now' });
  assert.match(ok.text, /Chain check: INTACT/);
  assert.match(ok.text, /cannot be disabled/);
  assert.match(ok.text, /audit_archive_0001: 3 entries/);
  const body = ok.text.split('\n\nSHA-256 of the text above: ')[0];
  assert.equal(sha256(body), ok.sha256);
  assert.ok(ok.text.includes(`Current chain head: ${full[full.length - 1].hash}`));
  const tampered = full.map((r, i) => (i === 3 ? { ...r, summary: 'Client deleted (edited later)' } : r));
  const bad = integrityText({ fy: 'FY25-26', chain: tampered, segments: [], company: 'E2E', generatedAt: 'now' });
  assert.match(bad.text, /Chain check: BROKEN/);
  assert.match(bad.text, /Break: entry 4 of/);
  assert.notEqual(bad.sha256, ok.sha256);
  assert.equal(getTable('audit_log').length, full.length, 'reading never writes');
});
