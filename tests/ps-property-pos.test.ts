/** R14 PS-B4 place of supply for design services on immovable property (Sec 12(3) / 13(4) IGST, PS6). */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inIndia, propertyPos } from '../src/lib/prof/ps-property-pos.ts';

test('property in India for a foreign client: POS is the property\'s State, not an export', () => {
  assert.deepEqual(propertyPos({ state: 'Maharashtra', city: 'Pune', country: 'India' }, { country: 'UAE', state_code: '96' }), { pos: '27', basis: 'property', exportPossible: false });
  assert.equal(propertyPos({ state: '29' }, { state_code: '27' }).pos, '29', 'a code works too');
});

test('property abroad: the location of the recipient', () => {
  assert.deepEqual(propertyPos({ city: 'Dubai', country: 'AE' }, { country: 'AE' }), { pos: '96', basis: 'recipient', exportPossible: true });
  assert.deepEqual(propertyPos({ city: 'London', country: 'UK' }, { state_code: '27' }), { pos: '27', basis: 'recipient', exportPossible: false });
  assert.deepEqual(['', 'IN', 'india', 'US'].map(inIndia), [true, true, true, false]);
});
