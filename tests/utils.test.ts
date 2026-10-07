import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatDate } from '../src/lib/utils.ts';
import { amountInWords } from '../src/lib/amount-in-words.ts';

test('amountInWords: zero', () => {
  assert.equal(amountInWords(0), 'Zero');
});

test('amountInWords: thousands', () => {
  assert.equal(amountInWords(125000), 'Rupees One Lakh Twenty Five Thousand Only');
});

test('amountInWords: lakh + paise (Indian system)', () => {
  assert.equal(amountInWords(150000.5), 'Rupees One Lakh Fifty Thousand and Fifty Paise Only');
});

test('amountInWords: crore', () => {
  assert.equal(amountInWords(12345678), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
});

test('amountInWords: USD prefix', () => {
  assert.equal(amountInWords(100, 'USD'), 'Dollars One Hundred Only');
});

test('formatCurrency: INR grouping', () => {
  const out = formatCurrency(1234567.5, 'INR');
  assert.ok(out.includes('12,34,567'), `expected Indian grouping, got ${out}`);
});

test('formatDate: empty string is safe', () => {
  assert.equal(formatDate(''), '');
});

test('formatDate: ISO renders day-month-year', () => {
  assert.equal(formatDate('2026-04-01'), '1 Apr 2026');
});

import { csvCell, toCsv } from '../src/lib/download.ts';

test('csvCell: quotes commas and doubles quotes', () => {
  assert.equal(csvCell('Acme, "Ltd"'), '"Acme, ""Ltd"""');
});

test('csvCell: neutralises spreadsheet formulas but keeps negative numbers', () => {
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell(-120.5), '-120.5');
});

test('toCsv: joins rows with CRLF', () => {
  assert.equal(toCsv([['a', 1], ['b', 2]]), 'a,1\r\nb,2');
});

import { isValidIfsc, isValidUpi } from '../src/lib/validators.ts';

test('isValidUpi / isValidIfsc: accept real shapes, reject typos', () => {
  assert.equal(isValidUpi('rohit.singh@okicici'), true);
  assert.equal(isValidUpi('no-at-sign'), false);
  assert.equal(isValidIfsc('icic0000949'), true);
  assert.equal(isValidIfsc('ICIC1000949'), false);
});
