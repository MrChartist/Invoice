import test from 'node:test';
import assert from 'node:assert/strict';
import { autoHighlight, suggest } from '../src/lib/suggest.ts';

const clients = [
  { name: 'Acme Buyers', company: 'Acme Pvt Ltd', gstin: '27AAAAA0000A1Z5' },
  { name: 'Bharat Traders', company: '', gstin: '29BBBBB1111B1Z5' },
  { name: 'Acorn Studio', company: 'Acorn LLP', gstin: '' },
  { name: '', company: 'Nameless' },
];
const opts = { label: (c: (typeof clients)[number]) => c.name, extra: (c: (typeof clients)[number]) => [c.company, c.gstin], sub: (c: (typeof clients)[number]) => c.gstin };

test('prefix and word-start matches rank first; empty names are skipped', () => {
  assert.deepEqual(suggest('ac', clients, opts).map((s) => s.label), ['Acme Buyers', 'Acorn Studio']);
  assert.deepEqual(suggest('trad', clients, opts).map((s) => s.label), ['Bharat Traders']);
  assert.deepEqual(suggest('', clients, opts), []);
  assert.ok(!suggest('nameless', clients, opts).length);
});

test('extra fields (GSTIN, company) find a row at a lower weight', () => {
  assert.equal(suggest('29BBB', clients, opts)[0]?.label, 'Bharat Traders');
  assert.equal(suggest('llp', clients, opts)[0]?.label, 'Acorn Studio');
});

test('autoHighlight only when the top label starts with the query', () => {
  assert.equal(autoHighlight('acm', suggest('acm', clients, opts)), 0);
  assert.equal(autoHighlight('buyers', suggest('buyers', clients, opts)), -1, 'mid-word match must not be picked by Enter');
  assert.equal(autoHighlight('zzz', []), -1);
});
