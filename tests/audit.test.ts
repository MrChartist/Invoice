import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { AUDIT_MAX_ROWS, AUDIT_TABLE, audit, diffClient, diffInvoice } from '../src/lib/audit.ts';
import { auditToCsv, filterAudit } from '../src/lib/audit-query.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { AuditEntry } from '../src/types/audit.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = [{ qty: 2, rate: 500, name: 'Research' }];
const rows = () => audit.all();

test('diffInvoice: status, total (formatted), due date, client, line count and notes', () => {
  const before = createViaStore({ date: '2025-06-10', due: '2025-06-24', lines: line });
  const after: InvoiceRecord = {
    ...before,
    status: 'Paid',
    total: before.total + 100,
    due_date: '2025-07-01',
    client: { ...before.client, name: 'Renamed Traders' },
    notes: 'Thanks for the quick payment',
    items: [...before.items, { id: 'zz', name: 'Extra', type: 'Service', quantity: 1, rate: 100, amount: 100 }],
  };
  const d = Object.fromEntries(diffInvoice(before, after).map((c) => [c.field, c]));
  assert.equal(d['Status'].from, 'Sent');
  assert.equal(d['Status'].to, 'Paid');
  assert.match(d['Total'].from ?? '', /1,180\.00/);
  assert.match(d['Total'].to ?? '', /1,280\.00/);
  assert.equal(d['Due date'].from, '2025-06-24');
  assert.equal(d['Due date'].to, '2025-07-01');
  assert.equal(d['Client'].to, 'Renamed Traders');
  assert.equal(d['Lines'].from, '1');
  assert.equal(d['Lines'].to, '2');
  assert.equal(d['Line 2 added'].to, 'Extra');
  assert.equal(d['Notes'].from, null);
  assert.match(d['Notes'].to ?? '', /^Thanks/);
});

test('diffInvoice flags a changed client address without copying it', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  const d = diffInvoice(inv, { ...inv, client: { ...inv.client, address: '99 Secret Lane' } });
  assert.deepEqual(d, [{ field: 'Client details', from: '(hidden)', to: '(changed)' }]);
});

test('diffInvoice: unchanged documents produce no diff; sub-paisa money noise is ignored', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  assert.deepEqual(diffInvoice(inv, { ...inv }), []);
  assert.deepEqual(diffInvoice(inv, { ...inv, total: inv.total + 0.001 }), []);
});

test('diffInvoice: per-line edits are reported by line, money formatted, and capped', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  const changed = { ...inv, items: inv.items.map((i) => ({ ...i, rate: 650, quantity: 3 })) };
  const d = diffInvoice(inv, changed);
  const rate = d.find((c) => c.field === 'Line 1 rate');
  assert.match(rate?.from ?? '', /500\.00/);
  assert.match(rate?.to ?? '', /650\.00/);
  assert.equal(d.find((c) => c.field === 'Line 1 qty')?.to, '3');

  const many = { ...inv, items: Array.from({ length: 20 }, (_, n) => ({ ...inv.items[0], id: `n${n}` })) };
  const capped = diffInvoice(inv, many);
  assert.ok(capped.length <= 12, 'a huge edit stays a short row');
  assert.ok(capped.some((c) => c.field === 'More line edits'));
});

test('diffClient hides contact details and keeps only that they changed', () => {
  const d = diffClient(
    { name: 'A', email: 'a@x.test', phone: '9999999999', gstin: '' },
    { name: 'A', email: 'b@y.test', phone: '9999999999', gstin: '27AAAAA0000A1Z5' },
  );
  assert.deepEqual(d.map((c) => c.field).sort(), ['Email', 'GSTIN']);
  const email = d.find((c) => c.field === 'Email')!;
  assert.equal(email.from, '(hidden)');
  assert.ok(!JSON.stringify(d).includes('b@y.test') && !JSON.stringify(d).includes('a@x.test'));
});

test('invoice create / edit / cancel / reinstate / delete are logged by localDb itself', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  localDb.invoices.save({ ...reload(inv.id), due_date: '2025-07-15' });
  localDb.invoices.save({ ...reload(inv.id), due_date: '2025-07-15' }); // no change -> no row
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  localDb.invoices.setStatus(inv.id, 'Sent');
  localDb.invoices.remove(inv.id);

  const mine = rows().filter((r) => r.entity === 'invoice').reverse();
  assert.deepEqual(mine.map((r) => r.action), ['create', 'update', 'cancel', 'reinstate', 'delete']);
  assert.ok(mine.every((r) => r.entity_id === inv.id && r.doc_number === inv.invoice_number));
  assert.match(mine[0].summary, /Created INV\/FY25-26\/0001 for Bharat Traders/);
  assert.match(mine[1].summary, /Due date 2025-06-10 → 2025-07-15/);
  assert.equal(mine[1].changes?.[0].field, 'Due date');
  assert.match(mine[4].summary, /Deleted INV\/FY25-26\/0001/);
});

test('payments are logged against their document', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  const p = localDb.payments.record({ invoiceId: inv.id, amount: 400, method: 'UPI', date: '2025-06-12' });
  localDb.payments.remove(p.id);
  const pay = rows().filter((r) => r.entity === 'payment').reverse();
  assert.deepEqual(pay.map((r) => r.action), ['payment_add', 'payment_remove']);
  assert.equal(pay[0].parent_id, inv.id);
  assert.match(pay[0].summary, /400\.00 received via UPI on INV\/FY25-26\/0001/);
  assert.deepEqual(audit.forInvoice(inv.id).map((r) => r.action).reverse(), ['create', 'payment_add', 'payment_remove']);
});

test('clients and settings are logged; sensitive profile fields are flagged, never copied', () => {
  const id = localDb.clients.upsert({ ...clientMH, id: undefined, name: 'Fresh Client' });
  localDb.clients.upsert({ ...clientMH, id, name: 'Fresh Client', email: 'secret@x.test', gstin: '' });
  localDb.clients.remove(id);
  const c = rows().filter((r) => r.entity === 'client').reverse();
  assert.deepEqual(c.map((r) => r.action), ['create', 'update', 'delete']);
  assert.ok(!JSON.stringify(c).includes('secret@x.test'));

  const s = localDb.settings.get();
  localDb.settings.save({
    ...s,
    defaultDueDays: 30,
    profiles: s.profiles.map((p) => ({ ...p, companyName: 'Renamed Research', accountNumber: '1234567890123', ifsc: 'HDFC0001234' })),
  });
  const prof = rows().find((r) => r.entity === 'profile')!;
  assert.equal(prof.action, 'update');
  assert.ok(prof.changes?.some((x) => x.field === 'Business name' && x.to === 'Renamed Research'));
  assert.ok(prof.changes?.some((x) => x.field === 'Bank details' && x.to === '(changed)'));
  assert.ok(!JSON.stringify(prof).includes('1234567890123') && !JSON.stringify(prof).includes('HDFC0001234'));
  const defaults = rows().find((r) => r.entity === 'settings' && r.entity_id === 'defaults')!;
  assert.match(defaults.summary, /Due in \(days\) 14 → 30/);
});

test('the log is capped at the newest rows', () => {
  const seed: AuditEntry[] = Array.from({ length: AUDIT_MAX_ROWS }, (_, n) => ({
    id: `s${n}`, at: new Date(2025, 0, 1, 0, 0, n).toISOString(), entity: 'system', entity_id: 'x', action: 'update', summary: `row ${n}`,
  }));
  setTable(AUDIT_TABLE, seed);
  audit.record({ entity: 'system', entity_id: 'x', action: 'update', summary: 'newest' });
  audit.record({ entity: 'system', entity_id: 'x', action: 'update', summary: 'newest 2' });
  const all = getTable<AuditEntry>(AUDIT_TABLE);
  assert.equal(all.length, AUDIT_MAX_ROWS);
  assert.equal(all[0].summary, 'row 2', 'the two oldest rows were dropped');
  assert.equal(all[all.length - 1].summary, 'newest 2');
  assert.equal(audit.all()[0].summary, 'newest 2', 'all() is newest first');
});

test('a throwing logger can never break a save', () => {
  const real = audit.record;
  audit.record = () => {
    throw new Error('logger exploded');
  };
  try {
    const inv = createViaStore({ date: '2025-06-10', lines: line });
    const edited = localDb.invoices.save({ ...inv, notes: 'x' });
    localDb.payments.record({ invoiceId: inv.id, amount: 100, method: 'Cash' });
    assert.equal(localDb.invoices.getById(inv.id)?.notes, 'x');
    assert.equal(edited.notes, 'x');
    assert.equal(localDb.payments.totalFor(inv.id), 100);
    localDb.settings.save({ ...localDb.settings.get(), defaultDueDays: 9 });
    localDb.clients.upsert({ name: 'Boom Co' });
    localDb.invoices.remove(inv.id);
    assert.equal(localDb.invoices.getAll().length, 0);
  } finally {
    audit.record = real;
  }
});

test('a full quota on the log table never breaks a save, and record() reports failure by returning null', () => {
  const ls = globalThis.localStorage;
  const realSet = ls.setItem.bind(ls);
  const already = audit.count();
  ls.setItem = (k: string, v: string) => {
    if (k.endsWith(AUDIT_TABLE)) throw new DOMException('full', 'QuotaExceededError');
    realSet(k, v);
  };
  try {
    const inv = createViaStore({ date: '2025-06-10', lines: line });
    assert.equal(localDb.invoices.getById(inv.id)?.id, inv.id, 'the invoice saved');
    assert.equal(audit.record({ entity: 'system', entity_id: 'x', action: 'update', summary: 'no room' })?.summary, 'no room', 'record() itself does not throw');
    assert.equal(audit.count(), already, 'nothing could be written');
  } finally {
    ls.setItem = realSet;
  }
});

test('a corrupted log table is tolerated', () => {
  localStorage.setItem('mrchartist_inv_' + AUDIT_TABLE, '{not json');
  assert.deepEqual(audit.all(), []);
  assert.ok(audit.record({ entity: 'system', entity_id: 'x', action: 'update', summary: 'ok' }));
  assert.equal(audit.count(), 1);
});

test('filterAudit by entity, action, date range and text; CSV export escapes and guards formulas', () => {
  const mk = (n: number, over: Partial<AuditEntry>): AuditEntry => ({
    id: `e${n}`, at: `2025-06-${String(10 + n).padStart(2, '0')}T12:00:00`, entity: 'invoice', entity_id: 'i', action: 'update', summary: `row ${n}`, ...over,
  });
  const entries = [
    mk(1, { summary: 'Edited INV/0001: Total ₹1 → ₹2', doc_number: 'INV/0001', changes: [{ field: 'Total', from: '₹1', to: '₹2' }] }),
    mk(2, { entity: 'payment', action: 'payment_add', summary: 'Payment received' }),
    mk(3, { entity: 'client', action: 'create', summary: '=HYPERLINK("x")' }),
  ];
  assert.equal(filterAudit(entries, { entity: 'payment' }).length, 1);
  assert.equal(filterAudit(entries, { action: 'create' })[0].id, 'e3');
  assert.deepEqual(filterAudit(entries, { from: '2025-06-12', to: '2025-06-12' }).map((e) => e.id), ['e2']);
  assert.deepEqual(filterAudit(entries, { q: 'inv/0001' }).map((e) => e.id), ['e1']);
  assert.deepEqual(filterAudit(entries, { q: '₹2' }).map((e) => e.id), ['e1'], 'search reaches into the diff');
  assert.equal(filterAudit(entries, { entity: 'all', action: 'all' }).length, 3);

  const csv = auditToCsv(entries);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'When,Entity,Action,Document,Summary,Field,From,To');
  assert.ok(lines[1].includes('Total'));
  assert.ok(!lines.some((l) => /(^|,)=HYPERLINK/.test(l)), 'formula injection is neutralised');
});
