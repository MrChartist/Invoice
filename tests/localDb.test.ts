import test from 'node:test';
import assert from 'node:assert/strict';
import { getIndianFY, generateInvoiceNumber } from '../src/lib/localDb.ts';

// Indian Financial Year = 1 Apr -> 31 Mar. This is a DO-NOT-BREAK rule.
test('getIndianFY: 1 April starts the new FY', () => {
  assert.deepEqual(getIndianFY('2025-04-01'), { label: '25-26', startYear: 2025, endYear: 2026 });
});

test('getIndianFY: 31 March is still the previous FY', () => {
  assert.deepEqual(getIndianFY('2025-03-31'), { label: '24-25', startYear: 2024, endYear: 2025 });
});

test('getIndianFY: mid-December sits in the Apr-started FY', () => {
  assert.equal(getIndianFY('2025-12-15').label, '25-26');
});

test('generateInvoiceNumber: format INV/FY<yy-yy>/0001', () => {
  // No localStorage in this runtime -> getTable() yields [] -> first number is 0001.
  assert.match(generateInvoiceNumber('2025-04-10'), /^INV\/FY25-26\/0001$/);
});
