/**
 * Barcode encoders (6.7): Code 128 B and EAN-13 bar patterns against known vectors, check digits,
 * SVG output and the A4 label sheet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE128_TABLE, EAN_G, EAN_L, EAN_PARITY, EAN_R, barRuns, barcodeSvg, code128BValues, code128Checksum,
  code128Symbol, ean13CheckDigit, encodeCode128B, encodeEan13, isValidEan13, nextInStoreEan, pickSymbology,
  widthsToModules,
} from '../src/lib/barcode.ts';
import { LABEL_LAYOUTS, expandLabels, labelSheetHtml, sheetCount } from '../src/lib/label-sheet.ts';

test('Code 128 table: 107 symbols, 11 modules each (stop 13), all distinct, bar-first', () => {
  assert.equal(CODE128_TABLE.length, 107);
  const seen = new Set<string>();
  CODE128_TABLE.forEach((w, v) => {
    const sum = [...w].reduce((s, d) => s + Number(d), 0);
    assert.equal(sum, v === 106 ? 13 : 11, `symbol ${v} width`);
    const bars = [...w].filter((_, i) => i % 2 === 0).reduce((s, d) => s + Number(d), 0);
    assert.equal(bars % 2, 0, `symbol ${v} has an even number of bar modules (parity rule)`);
    seen.add(w);
  });
  assert.equal(seen.size, 107);
});

test('Code 128 known symbol patterns (ISO/IEC 15417)', () => {
  assert.equal(code128Symbol(103), '11010000100'); // Start A
  assert.equal(code128Symbol(104), '11010010000'); // Start B
  assert.equal(code128Symbol(105), '11010011100'); // Start C
  assert.equal(code128Symbol(106), '1100011101011'); // Stop
  assert.equal(code128Symbol(0), '11011001100'); // space
  assert.equal(code128Symbol(33), '10100011000'); // 'A'
  assert.equal(code128Symbol(34), '10001011000'); // 'B'
  assert.equal(code128Symbol(102), '11110101110'); // FNC1
  assert.equal(widthsToModules('212222'), '11011001100');
});

test('Code 128 B: checksum and full pattern for known strings', () => {
  // "PJJ123C": 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879 → 879 mod 103 = 55
  assert.deepEqual(code128BValues('PJJ123C'), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106]);
  assert.equal(code128Checksum(104, [33]), 34);
  // "A": Start B, 'A', checksum 34, Stop
  assert.equal(encodeCode128B('A'), '11010010000' + '10100011000' + '10001011000' + '1100011101011');
  // Length: 11 per symbol + 13 for stop
  assert.equal(encodeCode128B('Wikipedia').length, 11 * (1 + 9 + 1) + 13);
  assert.throws(() => encodeCode128B('café'), /letters, digits/);
  assert.throws(() => encodeCode128B(''), /letters, digits/);
});

test('EAN-13 tables: L odd parity, G even parity, R = inverted L, G = reversed R', () => {
  for (let d = 0; d < 10; d++) {
    assert.equal(EAN_L[d].length, 7);
    assert.equal([...EAN_L[d]].filter((b) => b === '1').length % 2, 1, `L${d} odd`);
    assert.equal([...EAN_G[d]].filter((b) => b === '1').length % 2, 0, `G${d} even`);
    assert.equal(EAN_L[d][0], '0');
    assert.equal(EAN_R[d][0], '1');
  }
  assert.equal(EAN_R[0], '1110010');
  assert.equal(EAN_G[0], '0100111');
  assert.equal(EAN_G[9], '0010111');
  assert.equal(EAN_PARITY[0], 'LLLLLL');
});

test('EAN-13 check digit and validation', () => {
  assert.equal(ean13CheckDigit('400638133393'), 1);
  assert.equal(ean13CheckDigit('590123412345'), 7);
  assert.equal(ean13CheckDigit('890103086527'), 5);
  assert.ok(isValidEan13('4006381333931'));
  assert.ok(isValidEan13('5901234123457'));
  assert.ok(!isValidEan13('4006381333932'));
  assert.ok(!isValidEan13('400638133393'));
  assert.ok(!isValidEan13('40063813339ab'));
  assert.throws(() => ean13CheckDigit('123'), /12 digits/);
});

test('EAN-13 pattern for 4006381333931 (first digit 4 → LGLLGG)', () => {
  const bits = encodeEan13('4006381333931');
  assert.equal(bits.length, 95);
  const expected =
    '101' +
    EAN_L[0] + EAN_G[0] + EAN_L[6] + EAN_L[3] + EAN_G[8] + EAN_G[1] +
    '01010' +
    EAN_R[3] + EAN_R[3] + EAN_R[3] + EAN_R[9] + EAN_R[3] + EAN_R[1] +
    '101';
  assert.equal(bits, expected);
  // Literal modules of the left half of 4006381333931 (published reference rendering).
  assert.equal(bits.slice(0, 45), '101' + '0001101' + '0100111' + '0101111' + '0111101' + '0001001' + '0110011');
  assert.throws(() => encodeEan13('4006381333932'), /check digit/);
});

test('symbology choice, bar runs, SVG and in-store codes', () => {
  assert.equal(pickSymbology('5901234123457'), 'EAN13');
  assert.equal(pickSymbology('5901234123458'), 'CODE128'); // bad check digit: printed as plain text code
  assert.equal(pickSymbology('SKU-12'), 'CODE128');
  assert.equal(pickSymbology('ñ'), null);
  assert.deepEqual(barRuns('0110111001'), [[1, 2], [4, 3], [9, 1]]);
  const svg = barcodeSvg('SKU-12');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(svg, />SKU-12<\/text>/);
  assert.ok(!/script/i.test(svg));
  assert.equal(barcodeSvg('<x>').includes('<x>'), false, 'text is escaped');
  const code = nextInStoreEan(new Set());
  assert.ok(isValidEan13(code) && code.startsWith('2'));
  assert.notEqual(nextInStoreEan(new Set([code])), code);
});

test('label sheet: copies, skipped codes, sheet count and script-free HTML', () => {
  const layout = LABEL_LAYOUTS.find((l) => l.id === 'a4-65')!;
  const items = [
    { name: 'Soap 100 g', code: '8901030865275', rate: 40, mrp: 45, copies: 3 },
    { name: 'No code', code: '', rate: 10, copies: 2 },
    { name: 'Pen', code: 'PEN-BLUE', rate: 10, copies: 64 },
  ];
  const { labels, skipped } = expandLabels(items);
  assert.equal(labels.length, 67);
  assert.deepEqual(skipped, ['No code']);
  assert.equal(sheetCount(layout, 67), 2);
  assert.equal(sheetCount(layout, 65, 1), 2);
  const html = labelSheetHtml(items, { layout, price: 'both', skip: 2, business: 'Shop & Co' });
  assert.equal((html.match(/<section class="sheet">/g) ?? []).length, 2);
  assert.match(html, /MRP ₹45\.00 · ₹40\.00/, 'small labels keep the price short');
  assert.match(labelSheetHtml(items, { layout: LABEL_LAYOUTS[0], price: 'both' }), /MRP ₹45\.00 · Our price ₹40\.00/);
  assert.match(html, /Shop &amp; Co/);
  assert.ok(!/<script/i.test(html));
  assert.equal((html.match(/<svg /g) ?? []).length, 67);
});
