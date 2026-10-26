import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import {
  BATCH_RUNS_TABLE, batchRunsDb, batchToRecurring, buildBatchDrafts, issueBatch, matchPastedParties, partyKey, partySnapshot, runKey, templateFromDocument, undoBatch,
  type BatchParty,
} from '../src/lib/batch-invoices.ts';
import { recurringDb } from '../src/lib/recurring.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { saveApprovalPolicy } from '../src/lib/approvals.ts';
import type { Client, InvoiceRecord, SenderProfile } from '../src/types/invoice.ts';

const sender = { companyName: 'Green Society', companyGstin: '27AAPFU0939F1ZV', stateCode: '27', invoicePrefix: '' } as SenderProfile;

function source(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'src', invoice_number: 'INV/FY25-26/0009', doc_type: 'TAX_INVOICE', issue_date: '2026-02-01', due_date: '2026-02-15', status: 'Sent',
    currency: 'INR', template_id: 't', client: { name: 'Template party', email: '', address: '', city: '', zip: '' }, sender,
    items: [
      { id: 'l1', name: 'Maintenance — {month}', type: 'service', hsn: '999598', quantity: 1, rate: 2500, tax_rate: 18, amount: 2500, serials: ['X'] },
      { id: 'l2', name: 'Water', type: 'service', quantity: 1, rate: 300, tax_rate: 0, amount: 300 },
      { id: 'l3', name: 'Gym (optional)', type: 'service', quantity: 1, rate: 500, tax_rate: 18, amount: 500, optional: true },
    ],
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: 'Thank you', terms: '',
    subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
    ...over,
  } as InvoiceRecord;
}

const member = (id: string, over: Partial<Client> = {}): Client => ({ id, name: `Member ${id}`, email: '', address: '', city: 'Pune', zip: '', state_code: '27', ...over });
const parties = (list: Client[], over: Record<string, BatchParty['override']> = {}): BatchParty[] => list.map((c) => ({ key: partyKey(c), client: c, override: over[c.id!] }));

test('template from a document: serials and unselected optional lines dropped', () => {
  const t = templateFromDocument(source());
  assert.deepEqual(t.items.map((i) => i.name), ['Maintenance — {month}', 'Water']);
  assert.equal(t.items[0].serials, undefined);
});

test('drafts: place of supply per party switches IGST vs CGST + SGST; overrides on the first line; sender snapshot', () => {
  const t = templateFromDocument(source());
  const list = [member('a'), member('b', { state_code: '', gstin: '29AAACB1234C1ZV' }), member('c')];
  const drafts = buildBatchDrafts(t, parties(list, { c: { qty: 2, rate: 3000, notes: 'Flat C-12', po_number: 'PO-7' } }), { date: '2026-04-01', dueDays: 10, sender, newId: (() => { let n = 0; return () => `d${++n}`; })() });
  assert.deepEqual(drafts.map((d) => d.record.gst_mode), ['CGST_SGST', 'IGST', 'CGST_SGST']);
  assert.equal(drafts[1].record.place_of_supply, '29');
  assert.equal(drafts[0].record.taxable_value, 2800);
  assert.equal(drafts[2].record.items[0].quantity, 2);
  assert.equal(drafts[2].record.items[0].rate, 3000);
  assert.equal(drafts[2].record.items[1].rate, 300, 'only the first line is overridden');
  assert.equal(drafts[2].record.notes, 'Flat C-12');
  assert.equal(drafts[2].record.po_number, 'PO-7');
  assert.equal(drafts[0].record.due_date, '2026-04-11');
  assert.equal(drafts[0].record.sender?.companyName, 'Green Society');
  assert.equal(drafts[0].record.invoice_number, '');
  assert.equal(drafts[1].einvoice, 'unknown', 'B2B party, AATO not set');
  assert.equal(drafts[0].einvoice, 'no', 'B2C');
  const big = buildBatchDrafts(t, parties([list[1]]), { date: '2026-04-01', dueDays: 10, sender: { ...sender, einvoice_aato: 6e7 } });
  assert.equal(big[0].einvoice, 'yes');
  assert.equal(partySnapshot({ ...member('z'), contacts: [{ id: 'k', name: 'K' }], credit_limit: 5 } as Client).contacts, undefined);
});

test('pasted names / GSTINs', () => {
  const list = [member('a'), member('b', { gstin: '29AAACB1234C1ZV' })];
  const m = matchPastedParties('member a\n29aaacb1234c1zv; Nobody, member A', list);
  assert.deepEqual(m.matched.map((c) => c.id), ['a', 'b']);
  assert.deepEqual(m.unknown, ['Nobody']);
});

test('issue: consecutive numbering across the FY boundary, one run row, idempotent re-run guard, undo drafts', () => {
  resetStorage();
  const t = templateFromDocument(source());
  const list = [member('a'), member('b'), member('c')];
  const march = buildBatchDrafts(t, parties(list.slice(0, 2)), { date: '2026-03-31', dueDays: 10, sender });
  const r1 = issueBatch(march, { sourceId: 'src', sourceKind: 'invoice', date: '2026-03-31', mode: 'issue' });
  assert.deepEqual(r1.invoices.map((i) => i.invoice_number), ['INV/FY25-26/0001', 'INV/FY25-26/0002']);
  assert.ok(r1.invoices.every((i) => i.status === 'Sent'));
  const april = buildBatchDrafts(t, parties(list), { date: '2026-04-01', dueDays: 10, sender });
  const r2 = issueBatch(april, { sourceId: 'src', sourceKind: 'invoice', date: '2026-04-01', mode: 'draft' });
  // QA5-2 F15: drafts take no number (numbered in their FY series when issued, like recurring drafts).
  assert.deepEqual(r2.invoices.map((i) => i.invoice_number), ['', '', '']);
  assert.ok(r2.invoices.every((i) => i.status === 'Draft'));
  assert.equal(batchRunsDb.all().length, 2);
  assert.equal(r2.run.run_key, runKey('src', '2026-04-01', ['a', 'b', 'c']));
  assert.throws(() => issueBatch(april, { sourceId: 'src', sourceKind: 'invoice', date: '2026-04-01', mode: 'draft' }), /already issued/);
  // Undo the draft run: drafts deleted, numbers gone with them.
  const u = undoBatch(r2.run.id);
  assert.deepEqual([u.removed, u.cancelled, u.kept.length], [3, 0, 0]);
  assert.equal(batchRunsDb.get(r2.run.id)?.status, 'undone');
  assert.equal(localDb.invoices.getAll().length, 2);
  // Once undone, the same batch may run again.
  assert.equal(issueBatch(april, { sourceId: 'src', sourceKind: 'invoice', date: '2026-04-01', mode: 'draft' }).invoices.length, 3);
});

test('QA5-2 F15: a draft run consumes no FY numbers; undo leaves no reused number; issuing numbers the draft', () => {
  resetStorage();
  const t = templateFromDocument(source());
  issueBatch(buildBatchDrafts(t, parties([member('z')]), { date: '2026-06-01', dueDays: 10, sender }), { sourceId: 'src0', sourceKind: 'invoice', date: '2026-06-01', mode: 'issue' });
  const list = [member('a'), member('b'), member('c'), member('d')];
  const r = issueBatch(buildBatchDrafts(t, parties(list), { date: '2026-06-02', dueDays: 10, sender }), { sourceId: 'src', sourceKind: 'invoice', date: '2026-06-02', mode: 'draft' });
  assert.ok(r.invoices.every((i) => i.status === 'Draft' && i.invoice_number === ''));
  assert.equal(localDb.invoices.nextNumber('2026-06-03', 'TAX_INVOICE'), 'INV/FY26-27/0002', 'no number taken by the drafts');
  // Issuing one draft numbers it next in the series.
  const first = localDb.invoices.getById(r.invoices[0].id)!;
  const issued = localDb.invoices.save({ ...first, status: 'Sent' });
  assert.equal(issued.invoice_number, 'INV/FY26-27/0002');
  undoBatch(r.run.id);
  assert.equal(localDb.invoices.nextNumber('2026-06-03', 'TAX_INVOICE'), 'INV/FY26-27/0003', 'the issued number is never handed out again');
});

test('QA5-2 F7 / F14: a party with no state gets the seller state (with a warning); the source PO is not copied', () => {
  resetStorage();
  // Source billed to a Karnataka party (IGST, place of supply 29) with its own PO.
  const t = templateFromDocument(source({ place_of_supply: '29', gst_mode: 'IGST', po_number: 'KA-PO-77' }));
  assert.equal(t.po_number, undefined, 'the template carries no PO number');
  const list = [member('mh'), member('none', { state_code: '', state: '', gstin: '' }), member('gj', { state_code: '', state: 'Gujarat' })];
  const drafts = buildBatchDrafts(t, parties(list, { gj: { po_number: 'GJ-1' } }), { date: '2026-06-01', dueDays: 10, sender });
  assert.deepEqual(drafts.map((d) => d.record.place_of_supply), ['27', '27', '24']);
  assert.deepEqual(drafts.map((d) => d.record.gst_mode), ['CGST_SGST', 'CGST_SGST', 'IGST']);
  assert.equal(drafts[1].record.igst_amount, 0);
  assert.deepEqual(drafts.map((d) => !!d.stateWarning), [false, true, false]);
  assert.deepEqual(drafts.map((d) => d.record.po_number ?? ''), ['', '', 'GJ-1']);
  // An export keeps the source's own place of supply (the foreign party has no Indian state).
  const exp = templateFromDocument(source({ supply_type: 'EXPORT_LUT', place_of_supply: '96', gst_mode: 'IGST' } as Partial<InvoiceRecord>));
  const [x] = buildBatchDrafts(exp, parties([member('us', { state_code: '', state: '', country: 'USA' } as Partial<Client>)]), { date: '2026-06-01', dueDays: 10, sender });
  assert.equal(x.record.place_of_supply, '96');
  assert.equal(x.stateWarning, '');
});

test('undo of issued invoices: never deleted — kept, or cancelled with a reason', () => {
  resetStorage();
  const t = templateFromDocument(source());
  const r = issueBatch(buildBatchDrafts(t, parties([member('a'), member('b')]), { date: '2026-06-01', dueDays: 10, sender }), { sourceId: 'src', sourceKind: 'invoice', date: '2026-06-01', mode: 'issue' });
  const kept = undoBatch(r.run.id);
  assert.equal(kept.kept.length, 2);
  assert.equal(batchRunsDb.get(r.run.id)?.status, 'partly_undone');
  const done = undoBatch(r.run.id, { cancelReason: 'Billed twice' });
  assert.equal(done.cancelled, 2);
  assert.ok(localDb.invoices.getAll().every((i) => i.status === 'Cancelled'));
  assert.equal(localDb.invoices.getAll().length, 2, 'issued numbers stay');
});

test('a save refused by the period lock rolls the whole batch back (no invoices, no run row)', () => {
  resetStorage();
  const t = templateFromDocument(source());
  localDb.settings.save({ ...localDb.settings.get(), lock_until: '2026-06-30' });
  const drafts = buildBatchDrafts(t, parties([member('a'), member('b')]), { date: '2026-06-01', dueDays: 10, sender });
  assert.throws(() => issueBatch(drafts, { sourceId: 'src', sourceKind: 'invoice', date: '2026-06-01', mode: 'issue' }), /lock/i);
  assert.equal(localDb.invoices.getAll().length, 0);
  assert.equal(batchRunsDb.all().length, 0);
  // After the lock date the same batch goes through.
  const july = buildBatchDrafts(t, parties([member('a'), member('b')]), { date: '2026-07-01', dueDays: 10, sender });
  assert.equal(issueBatch(july, { sourceId: 'src', sourceKind: 'invoice', date: '2026-07-01', mode: 'issue' }).invoices.length, 2);
});

test('approval-held rows: a clerk issuing above the threshold gets drafts held for the owner, listed', () => {
  resetStorage();
  setActorProvider(() => ({ id: 'o', name: 'Owner', role: 'owner' }));
  saveApprovalPolicy({ enabled: true, mode: 'above', threshold: 4000 });
  setActorProvider(() => ({ id: 'c', name: 'Asha', role: 'clerk' }));
  try {
    const t = templateFromDocument(source());
    const drafts = buildBatchDrafts(t, parties([member('a'), member('b')], { b: { rate: 5000 } }), { date: '2026-06-01', dueDays: 10, sender });
    const r = issueBatch(drafts, { sourceId: 'src', sourceKind: 'invoice', date: '2026-06-01', mode: 'issue' });
    assert.deepEqual(r.invoices.map((i) => i.status), ['Sent', 'Draft']);
    assert.equal(r.held.length, 1);
    assert.match(r.held[0].reason, /approval/i);
    assert.deepEqual(r.run.held_ids, [r.invoices[1].id]);
  } finally {
    setActorProvider(null);
  }
});

test('save as batch recurring: one schedule per party with its own client', () => {
  resetStorage();
  const t = templateFromDocument(source());
  const n = batchToRecurring(t, parties([member('a'), member('b', { state_code: '29' })]), { name: 'Maintenance', frequency: 'monthly', start_date: '2026-05-01' });
  assert.equal(n, 2);
  const s = recurringDb.getAll();
  assert.deepEqual(s.map((x) => x.template.client.name), ['Member a', 'Member b']);
  assert.equal(s[1].template.gst_mode, 'IGST');
  assert.match(s[0].name, /Maintenance — Member a/);
});

test('wiring: batch_runs / proposal_snippets registered in backup, access, audit and sync', () => {
  const read = (f: string) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), 'utf8');
  for (const t of [BATCH_RUNS_TABLE, 'proposal_snippets']) {
    assert.equal(read('backup.ts').split(`'${t}'`).length - 1, 2, `${t} in both backup lists`);
    assert.match(read('access.ts'), new RegExp(`${t}: 'doc.create'`));
    assert.match(read('audit-edits.ts'), new RegExp(`${t}: \\{ entity`));
  }
  assert.ok(read('sync-engine.ts').includes('`${DB_PREFIX}batch_runs`]: \'date\''));
});
