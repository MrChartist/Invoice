import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRecent,
  fold,
  fuzzyMatch,
  groupResults,
  matchNumberToken,
  numberSequence,
  searchAll,
} from '../src/lib/search.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const NOW = new Date(2026, 5, 15);

function inv(over: Partial<InvoiceRecord> & { id: string; invoice_number: string }): InvoiceRecord {
  return {
    doc_type: 'INVOICE',
    status: 'Sent',
    due_date: '2026-07-30',
    total: 1000,
    balance_due: 1000,
    amount_paid: 0,
    client: { name: 'Acme Traders', email: '', address: '', city: '', zip: '' },
    ...over,
  } as InvoiceRecord;
}

const invoices = [
  inv({ id: 'a', invoice_number: 'INV/FY25-26/0007', total: 11800 }),
  inv({ id: 'b', invoice_number: 'INV/FY25-26/0017', client: { name: 'Zenith Labs' } as never }),
  inv({ id: 'c', invoice_number: 'INV/FY25-26/0070' }),
  inv({ id: 'd', invoice_number: 'QTN/FY25-26/0007', status: 'Draft' }),
];

test('fold: accents and case are ignored, indices preserved', () => {
  assert.equal(fold('Café Ünï'), 'cafe uni');
  assert.equal(fold('ÀB').length, 2);
});

test('fuzzyMatch: non-subsequence returns null', () => {
  assert.equal(fuzzyMatch('xyz', 'Acme Traders'), null);
  assert.equal(fuzzyMatch('longerthantext', 'abc'), null);
});

test('fuzzyMatch: accent/case insensitive', () => {
  assert.ok(fuzzyMatch('cafe', 'CAFÉ Noir'));
});

test('fuzzyMatch: ordering — exact > prefix > word-boundary > scattered', () => {
  const exact = fuzzyMatch('acme', 'acme')!.score;
  const prefix = fuzzyMatch('acme', 'Acme Traders')!.score;
  const word = fuzzyMatch('acme', 'The Acme Co')!.score;
  const inner = fuzzyMatch('acme', 'Pacmen')!.score;
  const scattered = fuzzyMatch('acme', 'a big cat mess')!.score;
  assert.ok(exact > prefix, 'exact > prefix');
  assert.ok(prefix > word, 'prefix > word start');
  assert.ok(word > inner, 'word start > mid-word');
  assert.ok(inner > scattered, 'substring > scattered subsequence');
});

test('fuzzyMatch: word-boundary initials beat random subsequence', () => {
  const initials = fuzzyMatch('mct', 'Mr Chartist Traders')!.score;
  const random = fuzzyMatch('mct', 'amazing recent')!.score;
  assert.ok(initials > random);
});

test('fuzzyMatch: ranges cover matched characters', () => {
  const m = fuzzyMatch('trd', 'Acme Traders')!;
  const text = 'Acme Traders';
  const picked = m.ranges.map(([s, e]) => text.slice(s, e)).join('').toLowerCase();
  assert.equal(picked, 'trd');
});

test('numberSequence / matchNumberToken', () => {
  assert.equal(numberSequence('INV/FY25-26/0007'), 7);
  assert.equal(numberSequence('no digits'), null);
  assert.equal(matchNumberToken('0007', 'INV/FY25-26/0007'), 1000);
  assert.equal(matchNumberToken('7', 'INV/FY25-26/0007'), 1000);
  assert.equal(matchNumberToken('8', 'INV/FY25-26/0007'), 0);
  assert.ok(matchNumberToken('00', 'INV/FY25-26/0007') > 0);
  assert.equal(matchNumberToken('inv', 'INV/FY25-26/0007'), 0);
});

test('searchAll: "0007" finds exact sequence ahead of 0017 / 0070', () => {
  const r = searchAll('0007', { data: { invoices, clients: [], items: [] }, now: NOW }).filter(
    (x) => x.group === 'invoices',
  );
  assert.ok(r.length >= 2);
  assert.ok(['inv:a', 'inv:d'].includes(r[0].id));
  assert.ok(['inv:a', 'inv:d'].includes(r[1].id));
  assert.ok(r.slice(2).every((x) => x.id !== 'inv:a'));
});

test('searchAll: "inv 7" prefers INV numbers with sequence 7', () => {
  const r = searchAll('inv 7', { data: { invoices, clients: [], items: [] }, now: NOW }).filter(
    (x) => x.group === 'invoices',
  );
  assert.equal(r[0].id, 'inv:a');
  assert.ok(r[0].ranges.length > 0);
});

test('searchAll: matches client name, status, and amount on invoices', () => {
  const data = { invoices, clients: [], items: [] };
  assert.equal(searchAll('zenith', { data, now: NOW })[0].id, 'inv:b');
  assert.equal(searchAll('draft', { data, now: NOW })[0].id, 'inv:d');
  assert.equal(searchAll('11800', { data, now: NOW })[0].id, 'inv:a');
});

test('searchAll: clients by name, company, GSTIN, city; items by name and HSN', () => {
  const data = {
    invoices: [],
    clients: [
      { id: 'c1', name: 'Ravi Kumar', company: 'Kumar Steel', gstin: '27ABCDE1234F1Z5', city: 'Pune' } as never,
      { id: 'c2', name: 'Meera', company: '', gstin: '', city: 'Chennai' } as never,
    ],
    items: [{ id: 'i1', name: 'Web design', hsn: '998314', rate: 5000 }],
    pages: [],
  };
  assert.equal(searchAll('kumar steel', { data })[0].id, 'client:c1');
  assert.equal(searchAll('27abcde', { data })[0].id, 'client:c1');
  assert.equal(searchAll('chennai', { data })[0].id, 'client:c2');
  const items = searchAll('998314', { data });
  assert.equal(items[0].group, 'items');
  assert.equal(searchAll('wbd', { data })[0].id, 'item:i1');
});

test('searchAll: pages and actions; empty query yields nothing; perGroup caps', () => {
  const data = {
    invoices: [],
    clients: [],
    items: [],
    actions: [{ id: 'act:theme', title: 'Toggle theme', icon: 'action', actionId: 'toggle-theme', keywords: ['dark', 'light'] }],
  };
  const r = searchAll('dark', { data });
  assert.equal(r[0].actionId, 'toggle-theme');
  assert.equal(searchAll('   ', { data }).length, 0);
  const many = Array.from({ length: 20 }, (_, i) => inv({ id: `x${i}`, invoice_number: `INV/FY25-26/00${i}` }));
  const capped = searchAll('inv', { data: { invoices: many, clients: [], items: [], pages: [] }, perGroup: 5 });
  assert.equal(capped.length, 5);
});

test('groupResults: best group first', () => {
  const r = searchAll('0007', { data: { invoices, clients: [], items: [], pages: [] }, now: NOW });
  const g = groupResults(r);
  assert.equal(g[0].group, 'invoices');
});

test('addRecent: dedupes case-insensitively, newest first, caps at 8', () => {
  let list: string[] = [];
  for (let i = 0; i < 12; i++) list = addRecent(list, `q${i}`);
  assert.equal(list.length, 8);
  assert.equal(list[0], 'q11');
  list = addRecent(list, 'Q9');
  assert.equal(list[0], 'Q9');
  assert.equal(list.filter((x) => x.toLowerCase() === 'q9').length, 1);
  assert.deepEqual(addRecent(['a'], '  '), ['a']);
});
