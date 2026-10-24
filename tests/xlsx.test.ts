import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, openZip, writeZip, ZipError } from '../src/lib/zip.ts';
import {
  columnIndex,
  columnName,
  dayToExcelSerial,
  decodeEntities,
  excelSerialToDay,
  formatNumber,
  isDateFormatCode,
  readXlsx,
  readXlsxTable,
  scanXml,
  writeXlsx,
  xlsxToCsv,
} from '../src/lib/xlsx.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ── Hand-crafted ZIP builder (independent of src/lib/zip.ts's writer) ── */

interface RawEntry {
  name: string;
  data: Uint8Array;
  /** 0 STORE, 8 DEFLATE */
  method?: 0 | 8;
  flags?: number;
  /** Override the declared uncompressed size (to fake a liar / bomb). */
  declaredSize?: number;
  /** Override the declared CRC. */
  crc?: number;
}

function craftZip(entries: RawEntry[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(e.data) : Buffer.from(e.data);
    const name = Buffer.from(e.name, 'utf8');
    const crc = e.crc ?? crc32(e.data);
    const size = e.declaredSize ?? e.data.length;
    const flags = (e.flags ?? 0) | 0x800;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    parts.push(lh, name, body);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eocd]));
}

const SHEET_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** A workbook the way Excel writes it: shared strings, styles with date formats, rich text, gaps. */
function excelStyleWorkbook(): Uint8Array {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook ${SHEET_NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="B2B" sheetId="1" r:id="rId7"/><sheet name="Other" sheetId="2" r:id="rId8"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/data.xml"/><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const sst = `<?xml version="1.0"?><sst ${SHEET_NS} count="4" uniqueCount="4"><si><t>GSTIN</t></si><si><r><rPr><b/></rPr><t>Bill</t></r><r><t xml:space="preserve"> no</t></r></si><si><t>Tom &amp; Jerry_x000D_</t><rPh><t>IGNORED</t></rPh></si><si><t/></si></sst>`;
  const styles = `<?xml version="1.0"?><styleSheet ${SHEET_NS}><numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`;
  const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="B1" t="s"><x:v>1</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>Date</x:t></x:is></x:c><x:c r="D1" t="str"><x:f>"Am"&amp;"t"</x:f><x:v>Amt</x:v></x:c><x:c r="E1" t="inlineStr"><x:is><x:t>Ok</x:t></x:is></x:c></x:row>
    <x:row r="2"><x:c r="A2" t="s"><x:v>2</x:v></x:c><x:c r="C2" s="1"><x:v>45383</x:v></x:c><x:c r="D2" s="3"><x:v>0.30000000000000004</x:v></x:c><x:c r="E2" t="b"><x:v>1</x:v></x:c></x:row>
    <x:row r="4"><x:c r="B4"><x:v>7</x:v></x:c><x:c r="C4" s="2"><x:v>45382.75</x:v></x:c><x:c r="D4" t="e"><x:v>#N/A</x:v></x:c><x:c r="F4" t="s"><x:v>3</x:v></x:c></x:row>
    <x:row r="5"/>
    <x:row><x:c><x:v>1</x:v></x:c><x:c><x:v>2</x:v></x:c></x:row>
  </x:sheetData></x:worksheet>`;
  const sheet2 = `<worksheet ${SHEET_NS}><sheetData><row r="1"><c r="AA1" t="inlineStr"><is><t>far</t></is></c></row></sheetData></worksheet>`;
  return craftZip([
    { name: '[Content_Types].xml', data: enc.encode('<Types/>'), method: 0 },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(rels) },
    { name: 'xl/sharedStrings.xml', data: enc.encode(sst) },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
    { name: 'xl/worksheets/data.xml', data: enc.encode(sheet) },
    { name: 'xl/worksheets/sheet2.xml', data: enc.encode(sheet2), method: 0 },
  ]);
}

/* ── ZIP ── */

test('zip: hand-crafted archive with STORE and DEFLATE entries reads back byte-exact', async () => {
  const big = enc.encode('hello world '.repeat(500));
  const zip = openZip(craftZip([
    { name: 'a.txt', data: enc.encode('stored'), method: 0 },
    { name: 'dir/b.txt', data: big, method: 8 },
    { name: 'ünï.txt', data: enc.encode('utf8 name') },
  ]));
  assert.deepEqual(zip.entries.map((e) => e.name), ['a.txt', 'dir/b.txt', 'ünï.txt']);
  assert.equal(await zip.text('a.txt'), 'stored');
  assert.equal(await zip.text('/DIR/b.txt'), dec.decode(big), 'lookups ignore case and a leading slash');
  assert.equal(await zip.text('ünï.txt'), 'utf8 name');
  assert.equal(await zip.read('missing'), null);
});

test('zip: writer round-trips with and without compression', async () => {
  const files = [
    { name: 'x.json', data: JSON.stringify({ a: 'b'.repeat(1000) }) },
    { name: 'bin.dat', data: new Uint8Array([0, 1, 2, 255]) },
  ];
  for (const compress of [true, false]) {
    const z = openZip(await writeZip(files, { compress, date: new Date(2026, 3, 1, 10, 30) }));
    assert.equal(z.entries[0].method, compress ? 8 : 0);
    assert.equal(JSON.parse((await z.text('x.json')) ?? '').a.length, 1000);
    assert.deepEqual([...((await z.read('bin.dat')) ?? [])], [0, 1, 2, 255]);
  }
  await assert.rejects(writeZip([{ name: 'a', data: '1' }, { name: 'A', data: '2' }]), ZipError);
});

test('zip: rejects encrypted entries', () => {
  const z = craftZip([{ name: 'secret.xml', data: enc.encode('x'), method: 0, flags: 0x1 }]);
  assert.throws(() => openZip(z), /password-protected/);
});

test('zip: zip-bomb guards — declared size liar, total cap, entry count, file size', async () => {
  const zeros = new Uint8Array(2 * 1024 * 1024); // 2 MB of zeros deflates to ~2 kB
  // Entry claims to be 1 kB but inflates to 2 MB: inflation stops at the declared size.
  const liar = openZip(craftZip([{ name: 'bomb.xml', data: zeros, declaredSize: 1024 }]));
  await assert.rejects(liar.read('bomb.xml'), /zip bomb/);
  // Honest sizes, but the archive total passes the cap.
  const many = openZip(
    craftZip([{ name: 'a', data: zeros }, { name: 'b', data: zeros }]),
    { maxTotalBytes: 3 * 1024 * 1024 },
  );
  assert.ok(await many.read('a'));
  await assert.rejects(many.read('b'), /zip bomb/);
  // Declared size alone over the cap is refused before inflating.
  const declared = openZip(craftZip([{ name: 'a', data: zeros }]), { maxTotalBytes: 1024 });
  await assert.rejects(declared.read('a'), /zip bomb/);
  // Entry-count cap.
  const lots = craftZip(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, data: enc.encode('x'), method: 0 as const })));
  assert.throws(() => openZip(lots, { maxEntries: 10 }), /too many entries/);
  // Input size cap.
  assert.throws(() => openZip(new Uint8Array(2048), { maxBytes: 1024 }), /larger than/);
});

test('zip: damaged input is reported, not crashed on', async () => {
  assert.throws(() => openZip(enc.encode('not a zip at all, just some text padding padding')), ZipError);
  const bad = openZip(craftZip([{ name: 'a.txt', data: enc.encode('abc'), method: 0, crc: 1234 }]));
  await assert.rejects(bad.read('a.txt'), /checksum/);
});

/* ── XML / cells ── */

test('xml tokenizer: entities, CDATA, comments, DOCTYPE, prefixes, quoted ">"', () => {
  const events: string[] = [];
  scanXml(
    `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><!-- c --><a:root b:attr='1 &gt; 0' q="x>y"><t>A &amp; B &#x20B9;&#8377; &e;</t><![CDATA[<raw>]]><e/></a:root>`,
    {
      open: (n, a, self) => events.push(`open:${n}:${JSON.stringify(a)}:${self}`),
      close: (n) => events.push(`close:${n}`),
      text: (t) => events.push(`text:${t}`),
    },
  );
  assert.deepEqual(events, [
    'open:root:{"attr":"1 > 0","q":"x>y"}:false',
    'open:t:{}:false',
    'text:A & B ₹₹ &e;',
    'close:t',
    'text:<raw>',
    'open:e:{}:true',
    'close:e',
    'close:root',
  ]);
  assert.equal(decodeEntities('&lt;&quot;&apos;&bogus;'), `<"'&bogus;`);
  // Truncated input never throws.
  assert.doesNotThrow(() => scanXml('<a><b attr="unterminated', {}));
});

test('date serials: 1900 system (incl. the phantom 29 Feb 1900) and 1904 system', () => {
  assert.equal(excelSerialToDay(1), '1900-01-01');
  assert.equal(excelSerialToDay(59), '1900-02-28');
  assert.equal(excelSerialToDay(61), '1900-03-01');
  assert.equal(excelSerialToDay(45383), '2024-04-01');
  assert.equal(excelSerialToDay(45382.99), '2024-03-31', 'time of day never moves the calendar day');
  assert.equal(excelSerialToDay(46112), '2026-03-31');
  assert.equal(excelSerialToDay(0, true), '1904-01-01');
  assert.equal(excelSerialToDay(43921, true), '2024-04-01');
  assert.equal(excelSerialToDay(-1), '');
  for (const d of ['1900-01-01', '1900-02-28', '1900-03-01', '2024-04-01', '2026-03-31']) {
    assert.equal(excelSerialToDay(dayToExcelSerial(d) ?? -1), d);
  }
});

test('number formatting, date format detection, column letters', () => {
  assert.equal(formatNumber('0.30000000000000004'), '0.3');
  assert.equal(formatNumber('1180'), '1180');
  assert.equal(formatNumber('1234567890123456'), '1234567890123456');
  assert.equal(formatNumber('-12.5'), '-12.5');
  assert.ok(isDateFormatCode('dd\\-mm\\-yyyy'));
  assert.ok(isDateFormatCode('[$-409]mmm-yy;@'));
  assert.ok(isDateFormatCode('mmmm'));
  assert.ok(!isDateFormatCode('#,##0.00'));
  assert.ok(!isDateFormatCode('0.00 "Days"'));
  assert.ok(!isDateFormatCode('[h]:mm:ss'));
  assert.equal(columnIndex('A1'), 0);
  assert.equal(columnIndex('AA10'), 26);
  assert.equal(columnIndex('$XFD$1'), 16383);
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(27), 'AB');
  assert.equal(columnName(16383), 'XFD');
});

test('reader: Excel-style workbook — shared/rich/inline/formula strings, dates, numbers, booleans, gaps', async () => {
  const wb = await readXlsx(excelStyleWorkbook());
  assert.deepEqual(wb.sheets.map((s) => s.name), ['B2B', 'Other']);
  assert.deepEqual(wb.sheets[0].rows, [
    ['GSTIN', 'Bill no', 'Date', 'Amt', 'Ok'],
    ['Tom & Jerry\r', '', '2024-04-01', '0.3', 'TRUE'],
    ['', '7', '2024-03-31'],
    ['1', '2'],
  ]);
  assert.deepEqual(wb.sheets[1].rows, [[...Array(26).fill(''), 'far']]);
  const only = await readXlsx(excelStyleWorkbook(), { sheets: ['other'] });
  assert.deepEqual(only.sheets.map((s) => s.name), ['Other']);
});

test('writer → reader round-trip, table shape, CSV bridge, formula-injection guard', async () => {
  const bytes = await writeXlsx(
    [
      {
        name: 'Invoices: FY25/26',
        rows: [
          ['Number', 'Client', 'Total', 'Paid', 'Note'],
          ['INV/FY25-26/0001', 'A & B <Traders>', 1180, true, '=HYPERLINK("http://x")'],
          ['INV/FY25-26/0002', '+91 98765 43210', -250.5, false, '@SUM(A1)'],
          ['INV/FY25-26/0003', 'Ünïcode ₹ देव', 0.1 + 0.2, null, ''],
        ],
      },
      { name: 'Invoices: FY25/26', rows: [['dup name']] },
    ],
    { date: new Date(2026, 9, 24) },
  );
  const wb = await readXlsx(bytes);
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Invoices  FY25 26', 'Invoices  FY25 26 2']);
  assert.deepEqual(wb.sheets[0].rows[1], ['INV/FY25-26/0001', 'A & B <Traders>', '1180', 'TRUE', `'=HYPERLINK("http://x")`]);
  assert.deepEqual(wb.sheets[0].rows[2], ['INV/FY25-26/0002', '+91 98765 43210', '-250.5', 'FALSE', `'@SUM(A1)`]);
  assert.deepEqual(wb.sheets[0].rows[3], ['INV/FY25-26/0003', 'Ünïcode ₹ देव', '0.3']);

  const table = await readXlsxTable(bytes);
  assert.equal(table.sheet, 'Invoices  FY25 26');
  assert.deepEqual(table.headers, ['Number', 'Client', 'Total', 'Paid', 'Note']);
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[2].length, 5, 'rows are padded to the header width');

  const csv = await xlsxToCsv(bytes);
  assert.ok(csv.startsWith('Number,Client,Total,Paid,Note\r\n'));
  assert.ok(csv.includes('"A & B <Traders>"') || csv.includes('A & B <Traders>'));
});

test('reader: rejects non-xlsx ZIPs and .ods with a readable message', async () => {
  await assert.rejects(readXlsx(craftZip([{ name: 'content.xml', data: enc.encode('<x/>') }])), /OpenDocument/);
  await assert.rejects(readXlsx(craftZip([{ name: 'foo.txt', data: enc.encode('x') }])), /Not an Excel/);
});
