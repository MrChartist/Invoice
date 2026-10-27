/** PS-D5 CA events from a peeked company fixture (filed / not filed), DSC and checklist events, UDINs, billed through `bill_refs`, cancel frees. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caEvents, caKey, companyEvents } from '../src/lib/prof/ps-ca-events.ts';
import type { PracticeTables } from '../src/lib/practice.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { UdinRow } from '../src/types/prof-r14d.ts';

const peek: PracticeTables = Object.freeze({
  compliance: [
    { id: 'GSTR3B:2026-10:', form: 'GSTR3B', period_key: '2026-10', gstin: '', filed_on: '2026-11-18', marked_at: '' },
    { id: 'GSTR1:2026-10:', form: 'GSTR1', period_key: '2026-10', gstin: '', filed_on: '2026-11-10', marked_at: '' },
    { id: 'GSTR1:2026-11:', form: 'GSTR1', period_key: '2026-11', gstin: '', filed_on: '', marked_at: '', downloaded_at: 'x' },
    { id: 'PMT06:2026-10:', form: 'PMT06', period_key: '2026-10', gstin: '', filed_on: '2026-11-20', marked_at: '' },
  ],
  tds_returns: [{ id: '26Q:2026-Q2', form: '26Q', fy: 2026, quarter: 2, filed_on: '2026-11-05' }],
  dsc_register: [{ id: 'd1', holder: 'Ravi', role: 'director', valid_from: '2026-11-02', valid_to: '2028-11-01' }],
  client_checklist: [{ id: '2026-11', items: [{ id: 'a', label: 'Books updated', done_at: '2026-11-25T10:00:00Z' }, { id: 'b', label: 'TDS challan paid' }] }],
}) as unknown as PracticeTables;

test('events of a linked company for the month: filed returns only, TDS return, DSC renewal, checklist', () => {
  const ev = companyEvents('c1', 'co1', peek, '2026-11');
  assert.deepEqual(ev.map((e) => [e.kind, e.period, e.date]), [['gstr3b', '2026-10', '2026-11-18'], ['gstr1', '2026-10', '2026-11-10'], ['tds_return', '2026-Q2-26Q', '2026-11-05'], ['dsc_renewal', '2026-11-02', '2026-11-02'], ['checklist', '2026-11', '2026-11-25']]);
  assert.equal(ev[0].key, caKey('c1', 'gstr3b', '2026-10'));
  assert.deepEqual(companyEvents('c1', 'co1', peek, '2026-10'), [], 'nothing filed in October');
  assert.deepEqual(companyEvents('c1', 'co1', undefined, '2026-11'), [], 'locked / missing company');
});

test('UDINs, retainer, billed state through bill_refs; a cancelled invoice frees the events', () => {
  const udins: UdinRow[] = [{ id: 'u1', udin: '26123456ABCDEF1234', date: '2026-11-12', client_id: 'c1', kind: 'certificate', description: 'Turnover certificate', member_no: '123456' }];
  const settings = { company_clients: [{ company_id: 'co1', client_id: 'c1' }] };
  const peeks = new Map([['co1', peek]]);
  const billed = (status: string) => [{ id: 'inv1', status, items: [{ bill_refs: [caKey('c1', 'gstr3b', '2026-10'), 'udin:u1'] }] }] as unknown as InvoiceRecord[];
  const all = caEvents({ settings, peeks, udins, month: '2026-11', invoices: [], retainerClients: new Set(['c1']) });
  assert.equal(all.length, 7);
  assert.ok(all.some((e) => e.kind === 'certificate' && e.udin === '26123456ABCDEF1234'));
  assert.ok(all.some((e) => e.kind === 'retainer' && e.key === 'ca:c1:retainer:2026-11'));
  const after = caEvents({ settings, peeks, udins, month: '2026-11', invoices: billed('Draft') });
  assert.deepEqual(after.filter((e) => e.billedBy).map((e) => e.kind).sort(), ['certificate', 'gstr3b']);
  assert.equal(caEvents({ settings, peeks, udins, month: '2026-11', invoices: billed('Cancelled') }).filter((e) => e.billedBy).length, 0);
});
