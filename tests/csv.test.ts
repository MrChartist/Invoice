import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, parseCsv, parseTable, writeCsv, unwrapExcelText } from '../src/lib/csv.ts';

test('parses quotes, embedded delimiters, quotes and newlines', () => {
  const rows = parseCsv('a,b,c\n"x, y","he said ""hi""","line1\nline2"\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\nline2']]);
});

test('handles BOM, CRLF, CR and a missing trailing newline', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n1,2\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCsv('a,b\r1,2\r'), [['a', 'b'], ['1', '2']]);
});

test('drops blank rows but keeps empty cells', () => {
  assert.deepEqual(parseCsv('a,b,c\n\n,,\n1,,3\n'), [['a', 'b', 'c'], ['1', '', '3']]);
});

test('auto-detects semicolon, tab and pipe delimiters', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3\n'), ';');
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3\n'), '\t');
  assert.equal(detectDelimiter('a|b|c\n1|2|3\n'), '|');
  assert.equal(detectDelimiter('a,b,c\n1,2,3\n'), ',');
  assert.equal(detectDelimiter('name;amt\n"A, B";"1,5"\n"C, D";"2,5"\n'), ';');
  assert.deepEqual(parseCsv('n;a\n"A, B";1,5\n'), [['n', 'a'], ['A, B', '1,5']]);
});

test('single-column files default to comma', () => {
  assert.equal(detectDelimiter('name\nAcme\nBeta\n'), ',');
  assert.deepEqual(parseCsv('name\nAcme\n'), [['name'], ['Acme']]);
});

test('unwraps Excel text formulas that protect leading zeros', () => {
  assert.equal(unwrapExcelText('="0123"'), '0123');
  assert.deepEqual(parseCsv('pin,hsn\n="0123",="998314"\n"=""0456""",x\n'), [
    ['pin', 'hsn'],
    ['0123', '998314'],
    ['0456', 'x'],
  ]);
});

test('a stray quote inside an unquoted field is literal', () => {
  assert.deepEqual(parseCsv('a,b\n5" pipe,ok\n'), [['a', 'b'], ['5" pipe', 'ok']]);
});

test('an unterminated quote does not hang', () => {
  const rows = parseCsv('a,b\n"open,1\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], 'open,1');
});

test('parseTable skips a report title block and pads ragged rows', () => {
  const t = parseTable('Sales Register\nAcme Co,,\n\nDate,Particulars,Amount\n01-04-2025,Foo\n02-04-2025,Bar,100\n');
  assert.deepEqual(t.headers, ['Date', 'Particulars', 'Amount']);
  assert.deepEqual(t.rows, [['01-04-2025', 'Foo', ''], ['02-04-2025', 'Bar', '100']]);
});

test('parseTable names blank headers and trims empty trailing columns', () => {
  const t = parseTable('a,,c,\n1,2,3,\n');
  assert.deepEqual(t.headers, ['a', 'Column 2', 'c']);
});

test('writeCsv quotes only when needed and round-trips', () => {
  const rows = [['a', 'b,c', 'd"e', 'f\ng', ' pad'], ['1', '', '₹ 5', '', '']];
  const text = writeCsv(rows);
  assert.equal(text, 'a,"b,c","d""e","f\ng"," pad"\r\n1,,₹ 5,,\r\n');
  assert.deepEqual(parseCsv(text, { trim: false }), rows);
});

test('writeCsv can prepend a BOM and use another delimiter', () => {
  assert.equal(writeCsv([['a', 'b;c']], { delimiter: ';', eol: '\n', bom: true }), '﻿a;"b;c"\n');
});
