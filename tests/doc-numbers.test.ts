import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { useInvoiceStore } from '../src/store/useInvoiceStore.ts';
import {
  DuplicateNumberError,
  findNumberClash,
  gapsIfIssued,
  nextInvoiceNumber,
  numberKey,
  parseDocNumber,
  seriesGaps,
} from '../src/lib/invoice-number.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = [{ qty: 1, rate: 1000 }];

/** Fill the editor like a user typing a manual number, then save. */
function saveTyped(number: string, date: string, client = 'Typed Co') {
  const st = () => useInvoiceStore.getState();
  st().newDraft('INVOICE');
  st().setSender(localDb.settings.activeProfile()!);
  st().setClient({ name: client });
  st().setDates(date, date);
  st().updateItem(st().items[0].id, 'name', 'Work');
  st().updateItem(st().items[0].id, 'quantity', 1);
  st().updateItem(st().items[0].id, 'rate', 500);
  st().setInvoiceNumber(number);
  return st().saveInvoice();
}

test('numberKey is case-, space- and zero-padding-insensitive', () => {
  assert.equal(numberKey('INV/FY25-26/0007'), numberKey(' inv / fy25-26 / 0007 '));
  assert.equal(numberKey('INV/FY25-26/0007'), numberKey('INV/FY25-26/7'));
  assert.notEqual(numberKey('INV/FY25-26/0007'), numberKey('INV/FY26-27/0007'));
  assert.equal(numberKey('Custom 1'), numberKey('custom1'), 'free-form numbers compare ignoring case and spaces');
  assert.equal(parseDocNumber('qtn/fy24-25/0012')?.seq, 12);
  assert.equal(parseDocNumber('nonsense'), null);
});

test('findNumberClash ignores the document itself', () => {
  const docs = [{ id: 'a', invoice_number: 'INV/FY25-26/0001' }, { id: 'b', invoice_number: 'INV/FY25-26/0002' }];
  assert.equal(findNumberClash(docs, 'inv/fy25-26/0002', 'a')?.id, 'b');
  assert.equal(findNumberClash(docs, 'INV/FY25-26/0002', 'b'), undefined);
  assert.equal(findNumberClash(docs, '', undefined), undefined);
});

test('saving a document with a number already used by another is refused, naming the clash', () => {
  const first = createViaStore({ date: '2025-06-10', lines: line });
  assert.equal(first.invoice_number, 'INV/FY25-26/0001');

  const res = saveTyped(' inv/FY25-26/0001 ', '2025-06-11', 'Other Co');
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /INV\/FY25-26\/0001/);
  assert.match(res.errors.join(' '), /already used by/i);
  assert.match(res.errors.join(' '), /Bharat Traders/, 'names the document that holds the number');
  assert.equal(localDb.invoices.getAll().length, 1, 'nothing was written');
});

test('the data layer refuses a clash too (no UI path can bypass it), across document types', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  const q = createViaStore({ date: '2025-06-10', lines: line, docType: 'QUOTATION' });
  assert.match(q.invoice_number, /^QTN\//);
  assert.throws(
    () => localDb.invoices.save({ ...q, id: 'new-id', invoice_number: inv.invoice_number.toLowerCase() }),
    (e) => e instanceof DuplicateNumberError && /already used by/.test(e.message),
  );
  // a cancelled document still owns its number (rule 46: numbers are never reused)
  localDb.invoices.setStatus(inv.id, 'Cancelled');
  assert.throws(() => localDb.invoices.save({ ...q, id: 'x2', invoice_number: inv.invoice_number }), DuplicateNumberError);
});

test('editing a document keeps its own number valid', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  const edited = localDb.invoices.save({ ...inv, notes: 'edited', invoice_number: ` ${inv.invoice_number.toLowerCase()} ` });
  assert.equal(edited.notes, 'edited');
  assert.equal(localDb.invoices.checkNumber(inv.invoice_number, inv.id).ok, true);
  assert.equal(localDb.invoices.checkNumber(inv.invoice_number, 'someone-else').ok, false);
});

test('a legacy document that already shares a number can still be edited', () => {
  const a = createViaStore({ date: '2025-06-10', lines: line });
  const b = createViaStore({ date: '2025-06-11', lines: line });
  // Corrupt the data the way a pre-uniqueness version could have.
  const all = localDb.invoices.getAll().map((i) => (i.id === b.id ? { ...i, invoice_number: a.invoice_number } : i));
  localStorage.setItem('mrchartist_inv_invoices', JSON.stringify(all));
  const saved = localDb.invoices.save({ ...reload(b.id), notes: 'still editable' });
  assert.equal(saved.notes, 'still editable');
});

test('auto-numbering skips numbers that are taken, however they were typed', () => {
  assert.equal(nextInvoiceNumber({ existingNumbers: ['INV/FY25-26/0001', 'INV/FY25-26/0002'], dateStr: '2025-06-01' }), 'INV/FY25-26/0003');
  // spaced / lower-case legacy entries are not parsed by the highest-sequence scan but must still be avoided
  assert.equal(
    nextInvoiceNumber({ existingNumbers: ['inv / fy25-26 / 0001'], dateStr: '2025-06-01' }),
    'INV/FY25-26/0002',
  );
  // deleting the newest never reuses a number that is still on file
  const a = createViaStore({ date: '2025-06-10', lines: line });
  createViaStore({ date: '2025-06-11', lines: line });
  localDb.invoices.remove(a.id);
  assert.equal(localDb.invoices.nextNumber('2025-06-12'), 'INV/FY25-26/0003');
});

test('a manual number that skips ahead is allowed and reports the numbers it leaves unused', () => {
  createViaStore({ date: '2025-06-10', lines: line }); // 0001
  createViaStore({ date: '2025-06-11', lines: line }); // 0002
  const hint = localDb.invoices.checkNumber('INV/FY25-26/0006');
  assert.equal(hint.ok, true);
  assert.deepEqual(hint.gap?.missingNumbers, ['INV/FY25-26/0003', 'INV/FY25-26/0004', 'INV/FY25-26/0005']);
  assert.equal(hint.gap?.missingCount, 3);

  const res = saveTyped('INV/FY25-26/0006', '2025-06-12', 'Gap Co');
  assert.equal(res.ok, true, res.errors.join());
  assert.equal(res.gap?.missingCount, 3);

  // next number or a hole-filler is not a gap
  assert.equal(localDb.invoices.checkNumber('INV/FY25-26/0007').gap, null);
  assert.equal(localDb.invoices.checkNumber('INV/FY25-26/0004').gap, null);
  assert.equal(gapsIfIssued(['INV/FY25-26/0001'], 'free text'), null);
});

test('seriesGaps finds holes per series for the FY (read-only helper for GST reports)', () => {
  const numbers = [
    'INV/FY25-26/0001', 'INV/FY25-26/0002', 'INV/FY25-26/0005', 'INV/FY25-26/0007',
    'CRN/FY25-26/0001', 'CRN/FY25-26/0002',
    'INV/FY24-25/0003',
    'manual-1',
  ];
  const gaps = seriesGaps(numbers, '25-26');
  assert.equal(gaps.length, 1, 'only INV has holes in FY25-26');
  assert.equal(gaps[0].prefix, 'INV');
  assert.deepEqual(gaps[0].missing, [3, 4, 6]);
  assert.equal(gaps[0].highest, 7);
  assert.deepEqual(gaps[0].missingNumbers.slice(0, 1), ['INV/FY25-26/0003']);
  // all FYs
  const all = seriesGaps(numbers);
  assert.deepEqual(all.map((g) => `${g.prefix}${g.fy}:${g.missingCount}`), ['INV24-25:2', 'INV25-26:3']);
  assert.deepEqual(seriesGaps([]), []);
});

test('gap listing is capped but the count stays exact', () => {
  const gap = gapsIfIssued(['INV/FY25-26/0001'], 'INV/FY25-26/9999');
  assert.equal(gap?.missingCount, 9997);
  assert.ok((gap?.missing.length ?? 0) <= 25);
});
