import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTable } from '../src/lib/csv.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { guessMapping, detectPreset, templateRows, missingRequired } from '../src/lib/import-mapping.ts';
import {
  applyImport,
  buildPreview,
  dryRunReport,
  errorRowsCsv,
  parseDate,
  parseNumber,
  resolveStateText,
  type ExistingData,
  type ImportSink,
} from '../src/lib/importers.ts';
import type { Client, InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

const mk = (first14: string) => first14 + gstinChecksumChar(first14);
const G_MH = mk('27AAPFU0939F1Z');
const G_WB = mk('19AABCS1234K1Z');
const G_BAD = G_MH.slice(0, 14) + (G_MH[14] === 'A' ? 'B' : 'A');

const empty: ExistingData = { clients: [], items: [], invoices: [] };

function run(kind: 'clients' | 'items' | 'invoices', csv: string, existing = empty, options = {}, presetId?: string) {
  const table = parseTable(csv);
  const guess = guessMapping(kind, table.headers, table.rows, presetId);
  const preview = buildPreview({ kind, table, mapping: guess.mapping, existing, options });
  return { table, guess, preview };
}

/* ── number parsing ─────────────────────────────────────────── */

test('parseNumber: Indian grouping, symbols and signs', () => {
  assert.equal(parseNumber('₹ 1,23,456.50').value, 123456.5);
  assert.equal(parseNumber('Rs. 1,000/-').value, 1000);
  assert.equal(parseNumber('(500.25)').value, -500.25);
  assert.equal(parseNumber('-1,50,000').value, -150000);
  assert.equal(parseNumber('2,500.00 Dr').value, 2500);
  assert.equal(parseNumber('18%').value, 18);
  assert.equal(parseNumber('1,234').value, 1234);
  assert.equal(parseNumber('12,5').value, 12.5);
  assert.equal(parseNumber('1.234,56').value, 1234.56);
  assert.equal(parseNumber('1.234.567').value, 1234567);
  assert.equal(parseNumber('1.5E+3').value, 1500);
  assert.equal(parseNumber(' 100 ').value, 100);
});

test('parseNumber: empties are fine, garbage is not', () => {
  assert.deepEqual(parseNumber(''), { value: null, ok: true });
  assert.deepEqual(parseNumber('-'), { value: null, ok: true });
  assert.equal(parseNumber('abc').ok, false);
  assert.equal(parseNumber('12abc').ok, false);
  assert.equal(parseNumber('1,2,3').ok, false);
});

/* ── dates ──────────────────────────────────────────────────── */

test('parseDate: the formats Indian exports use', () => {
  assert.equal(parseDate('15/03/2025'), '2025-03-15');
  assert.equal(parseDate('15-03-25'), '2025-03-15');
  assert.equal(parseDate('15.03.2025'), '2025-03-15');
  assert.equal(parseDate('2025-03-15'), '2025-03-15');
  assert.equal(parseDate('2025-03-15T10:20:00'), '2025-03-15');
  assert.equal(parseDate('05-Mar-2025'), '2025-03-05');
  assert.equal(parseDate('5 March 2025'), '2025-03-05');
  assert.equal(parseDate('Mar 5, 2025'), '2025-03-05');
  assert.equal(parseDate('20250315'), '2025-03-15');
  // Day-first, but a >12 second part can only be the day.
  assert.equal(parseDate('03/04/2025'), '2025-04-03');
  assert.equal(parseDate('03/25/2025'), '2025-03-25');
});

test('parseDate: Excel serials and rejects', () => {
  assert.equal(parseDate('45731'), '2025-03-15');
  assert.equal(parseDate('45731.5'), '2025-03-15');
  assert.equal(parseDate('31/02/2025'), null);
  assert.equal(parseDate('hello'), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('12'), null);
});

test('resolveStateText: names, codes, abbreviations and legacy names', () => {
  assert.equal(resolveStateText('Maharashtra')?.code, '27');
  assert.equal(resolveStateText('MAHARASHTRA ')?.code, '27');
  assert.equal(resolveStateText('27-Maharashtra')?.code, '27');
  assert.equal(resolveStateText('Karnataka (29)')?.code, '29');
  assert.equal(resolveStateText('7')?.code, '07');
  assert.equal(resolveStateText('MH')?.code, '27');
  assert.equal(resolveStateText('Orissa')?.code, '21');
  assert.equal(resolveStateText('Jammu and Kashmir')?.code, '01');
  assert.equal(resolveStateText('Narnia'), undefined);
});

/* ── mapping ────────────────────────────────────────────────── */

test('guessMapping: Vyapar-style party headers', () => {
  const headers = ['Party Name', 'Contact No.', 'Email Id', 'GSTIN', 'Billing Address', 'State'];
  const g = guessMapping('clients', headers, [['A', '98', 'a@b.in', G_MH, 'x', 'Maharashtra']]);
  assert.deepEqual(g.mapping, { name: 0, phone: 1, email: 2, gstin: 3, address: 4, state: 5 });
  assert.ok(g.confidence.name >= 0.9);
});

test('guessMapping: Zoho invoice headers incl. line-item columns', () => {
  const headers = [
    'Invoice Date', 'Invoice Number', 'Invoice Status', 'Customer Name', 'GST Identification Number (GSTIN)',
    'Place of Supply', 'Due Date', 'Item Name', 'Quantity', 'Item Price', 'Item Tax %', 'HSN/SAC', 'Total', 'Balance',
  ];
  const g = guessMapping('invoices', headers);
  assert.equal(g.mapping.issue_date, 0);
  assert.equal(g.mapping.invoice_number, 1);
  assert.equal(g.mapping.status, 2);
  assert.equal(g.mapping.client_name, 3);
  assert.equal(g.mapping.client_gstin, 4);
  assert.equal(g.mapping.place_of_supply, 5);
  assert.equal(g.mapping.due_date, 6);
  assert.equal(g.mapping.item_name, 7);
  assert.equal(g.mapping.item_qty, 8);
  assert.equal(g.mapping.item_rate, 9);
  assert.equal(g.mapping.item_tax_rate, 10);
  assert.equal(g.mapping.item_hsn, 11);
  assert.equal(g.mapping.total, 12);
  assert.equal(g.mapping.balance_due, 13);
  assert.equal(g.presetId, 'zoho');
});

test('guessMapping: Tally headers and each column is used once', () => {
  const headers = ['Date', 'Particulars', 'Voucher Type', 'Voucher No.', 'GSTIN/UIN', 'Value', 'Gross Total'];
  const g = guessMapping('invoices', headers);
  assert.equal(g.mapping.invoice_number, 3);
  assert.equal(g.mapping.client_name, 1);
  assert.equal(g.mapping.client_gstin, 4);
  assert.equal(g.mapping.taxable_value, 5);
  assert.equal(g.mapping.total, 6);
  const cols = Object.values(g.mapping);
  assert.equal(new Set(cols).size, cols.length);
  assert.equal(g.presetId, 'tally');
});

test('guessMapping: item synonyms; Rate / Selling Price / HSN', () => {
  const g = guessMapping('items', ['Item Name', 'HSN/SAC', 'Selling Price', 'GST %', 'UOM']);
  assert.deepEqual(g.mapping, { name: 0, hsn: 1, rate: 2, tax_rate: 3, unit: 4 });
});

test('guessMapping: unknown headers stay unmapped; missingRequired reports them', () => {
  const g = guessMapping('clients', ['foo', 'bar']);
  assert.deepEqual(g.mapping, {});
  assert.deepEqual(missingRequired('clients', g.mapping).map((f) => f.key), ['name']);
});

test('detectPreset needs a clear match', () => {
  assert.equal(detectPreset('clients', ['a', 'b']), undefined);
  assert.equal(detectPreset('clients', ['Display Name', 'Company Name', 'EmailID', 'MobilePhone']), 'zoho');
});

test('templates are re-importable: headers map back to every field', () => {
  for (const kind of ['clients', 'items', 'invoices'] as const) {
    const rows = templateRows(kind);
    const g = guessMapping(kind, rows[0], rows.slice(1));
    assert.equal(Object.keys(g.mapping).length, rows[0].length, `${kind} template maps fully`);
  }
});

/* ── clients ────────────────────────────────────────────────── */

const CLIENT_CSV = [
  'Party Name,GSTIN,Phone,State,Email,PIN',
  `Acme Traders Pvt Ltd,${G_MH},9820012345.0,Maharashtra,accounts@acme.in,="400069"`,
  `  Sharma   & Sons ,,"98200,12345",MH,not-an-email,4000`,
  `Bengal Foods,${G_WB},,,,`,
  `Broken Gst Co,${G_BAD},,,,`,
  ',,,,,',
  '"Quote ""Q"" Ltd",,,Narnia,,',
].join('\r\n');

test('clients: normalises, validates GSTIN checksum, resolves state, flags problems', () => {
  const { preview } = run('clients', CLIENT_CSV);
  const [acme, sharma, bengal, broken, quote] = preview.rows;
  assert.equal(preview.rows.length, 5); // blank row ignored
  assert.equal(acme.action, 'create');
  assert.deepEqual(acme.record, {
    name: 'Acme Traders Pvt Ltd', gstin: G_MH, email: 'accounts@acme.in', phone: '9820012345', zip: '400069',
    state: 'Maharashtra', state_code: '27',
  });
  assert.equal(sharma.record && 'name' in sharma.record && sharma.record.name, 'Sharma & Sons');
  assert.equal((sharma.record as Client).state_code, '27');
  assert.ok(sharma.issues.some((i) => i.field === 'email' && i.level === 'warning'));
  assert.ok(sharma.issues.some((i) => i.field === 'zip' && i.level === 'warning'));
  // State is derived from the GSTIN when the column is empty.
  assert.equal((bengal.record as Client).state, 'West Bengal');
  // Bad checksum is an error by default…
  assert.equal(broken.action, 'error');
  assert.match(broken.issues[0].message, /checksum/i);
  // …and a warning when lenient.
  const lenient = run('clients', CLIENT_CSV, empty, { strictGstin: false }).preview.rows[3];
  assert.equal(lenient.action, 'create');
  assert.equal((lenient.record as Client).gstin, G_BAD);
  // Unknown state: warn only.
  assert.equal(quote.action, 'create');
  assert.ok(quote.issues.some((i) => i.field === 'state'));
  assert.equal(preview.summary.error, 1);
});

test('clients: duplicates by GSTIN or case-insensitive name, update vs skip', () => {
  const existing: ExistingData = {
    ...empty,
    clients: [
      { id: 'c1', name: 'ACME TRADERS', gstin: G_MH, email: '', address: '', city: '', zip: '' },
      { id: 'c2', name: 'bengal foods', email: '', address: '', city: '', zip: '' },
    ],
  };
  const csv = `Name,GSTIN,City\nAcme Traders Private Limited,${G_MH},Mumbai\nBengal Foods,,Kolkata\nNew One,,Pune\nNew One,,Pune again`;
  const upd = run('clients', csv, existing).preview;
  assert.deepEqual(upd.rows.map((r) => r.action), ['update', 'update', 'create', 'skip']);
  assert.equal(upd.rows[0].matchId, 'c1');
  assert.ok(upd.rows[0].issues.some((i) => /kept/.test(i.message)));
  assert.match(upd.rows[3].skipReason!, /Duplicate of row 4/);
  const skip = run('clients', csv, existing, { duplicateMode: 'skip' }).preview;
  assert.deepEqual(skip.rows.map((r) => r.action), ['skip', 'skip', 'create', 'skip']);
  assert.deepEqual(dryRunReport(skip), { created: 1, updated: 0, skipped: 3, errors: [] });
});

test('user-skipped rows are never written', () => {
  const table = parseTable('Name\nA\nB\nC\n');
  const g = guessMapping('clients', table.headers);
  const p = buildPreview({ kind: 'clients', table, mapping: g.mapping, existing: empty, skipped: new Set([1]) });
  assert.deepEqual(p.rows.map((r) => r.action), ['create', 'skip', 'create']);
  assert.equal(p.rows[1].skipReason, 'Skipped by you');
});

/* ── items ──────────────────────────────────────────────────── */

test('items: rate/GST/HSN/unit normalisation and type guess', () => {
  const csv = [
    'Item Name,HSN/SAC,Selling Price,GST %,UOM,Description',
    'Website design,="998314","₹ 25,000.00",18%,Nos,5 pages',
    'A4 paper,48025610,"1,20,000",12,Reams,',
    'Bad rate,1234,abc,18,,',
    'Weird GST,1234,10,17,,',
    'Short HSN,9,10,18,,',
  ].join('\n');
  const { preview } = run('items', csv);
  const [web, paper, badRate, weird, shortHsn] = preview.rows;
  assert.deepEqual(web.record, {
    name: 'Website design', description: '5 pages', hsn: '998314', unit: 'NOS', rate: 25000, tax_rate: 18, type: 'Service',
  });
  assert.equal((paper.record as InvoiceItem).unit, 'REAMS');
  assert.equal((paper.record as InvoiceItem).type, 'Product');
  assert.equal((paper.record as InvoiceItem).rate, 120000);
  assert.equal(badRate.action, 'error');
  assert.equal(weird.action, 'create');
  assert.ok(weird.issues.some((i) => /standard slab/.test(i.message)));
  assert.ok(shortHsn.issues.some((i) => i.field === 'hsn'));
});

test('items: duplicates by name + HSN', () => {
  const existing: ExistingData = {
    ...empty,
    items: [
      { id: 'i1', name: 'Consulting', hsn: '998311', type: 'Service', quantity: 1, rate: 1, amount: 1 },
      { id: 'i2', name: 'Widget', hsn: '', type: 'Product', quantity: 1, rate: 1, amount: 1 },
    ],
  };
  const csv = 'Item Name,HSN,Rate\nconsulting,998311,500\nConsulting,998312,500\nWidget,8471,9\nWidget,8471,9\nWidget,8471,10';
  const { preview } = run('items', csv, existing);
  assert.deepEqual(preview.rows.map((r) => r.action), ['update', 'create', 'update', 'skip', 'skip']);
  assert.equal(preview.rows[0].matchId, 'i1');
});

/* ── invoices ───────────────────────────────────────────────── */

const SENDER_OPTS = { senderStateCode: '27' };

test('invoices: keeps number and total; derives taxable from tax %, CGST/SGST intra-state', () => {
  const csv = [
    'Invoice No.,Date,Party Name,GSTIN,Total,Received,GST %,Status',
    `INV/FY24-25/0042,15/03/2025,Acme Traders,${G_MH},"59,000.00",0,18,Unpaid`,
    `INV/FY24-25/0043,2025-03-28,Bengal Foods,${G_WB},"14,160",14160,18,Paid`,
  ].join('\n');
  const { preview } = run('invoices', csv, empty, SENDER_OPTS);
  const [a, b] = preview.rows;
  const ia = a.record as InvoiceRecord;
  assert.equal(a.action, 'create');
  assert.equal(ia.invoice_number, 'INV/FY24-25/0042');
  assert.equal(ia.total, 59000);
  assert.equal(ia.gst_mode, 'CGST_SGST');
  assert.equal(ia.taxable_value, 50000);
  assert.equal(ia.cgst_amount + ia.sgst_amount, 9000);
  assert.equal(ia.balance_due, 59000);
  assert.equal(ia.status, 'Sent');
  assert.equal(ia.issue_date, '2025-03-15');
  assert.equal(ia.due_date, '2025-03-29');
  assert.equal(ia.items.length, 1);
  // Different state -> IGST; fully paid.
  const ib = b.record as InvoiceRecord;
  assert.equal(ib.gst_mode, 'IGST');
  assert.equal(ib.total, 14160);
  assert.equal(ib.igst_amount, 2160);
  assert.equal(ib.status, 'Paid');
  assert.equal(ib.balance_due, 0);
  assert.equal(ib.place_of_supply, '19');
});

test('invoices: explicit taxable + CGST/SGST columns, odd-paisa total preserved exactly', () => {
  const csv = 'Voucher No.,Date,Particulars,Value,CGST,SGST,Gross Total\nV-1,01-04-2025,Acme,1000.10,90.01,90.01,1180.12';
  const { preview } = run('invoices', csv, empty, SENDER_OPTS);
  const inv = preview.rows[0].record as InvoiceRecord;
  assert.equal(inv.total, 1180.12);
  assert.equal(inv.gst_mode, 'CGST_SGST');
  assert.equal(inv.round_off_enabled, false);
  // Totals are internally consistent.
  assert.equal(
    Math.round((inv.taxable_value + inv.tax_amount + inv.other_charges + inv.round_off) * 100),
    Math.round(inv.total * 100),
  );
});

test('invoices: no tax columns -> tax-free with a warning; rounding to whole rupees', () => {
  const { preview } = run('invoices', 'Invoice No,Date,Customer,Total\nA1,01/04/2025,Zed,"1,000"');
  const inv = preview.rows[0].record as InvoiceRecord;
  assert.equal(inv.gst_mode, 'NONE');
  assert.equal(inv.total, 1000);
  assert.ok(preview.rows[0].issues.some((i) => /tax-free/.test(i.message)));
});

test('invoices: Zoho-style line rows are merged per invoice number', () => {
  const csv = [
    'Invoice Date,Invoice Number,Customer Name,Place of Supply,Item Name,Quantity,Item Price,Item Tax %,HSN/SAC,Total,Balance',
    '01/04/2025,ZB-1,Acme,Maharashtra,Design,2,"5,000",18,998314,"11,800","11,800"',
    '01/04/2025,ZB-1,Acme,Maharashtra,Hosting,1,"1,000",18,998315,"11,800","11,800"',
    '02/04/2025,ZB-2,Beta,Karnataka,Audit,1,"2,000",18,998221,"2,360",0',
  ].join('\n');
  const { preview } = run('invoices', csv, empty, SENDER_OPTS);
  assert.equal(preview.rows.length, 2);
  const z1 = preview.rows[0].record as InvoiceRecord;
  assert.deepEqual(preview.rows[0].sourceIndexes, [0, 1]);
  assert.equal(z1.items.length, 2);
  assert.equal(z1.taxable_value, 11000);
  // File total (11,800) differs from lines (12,980): kept exactly, with a warning.
  assert.equal(z1.total, 11800);
  assert.ok(preview.rows[0].issues.some((i) => i.level === 'warning' && i.field === 'total'));
  const z2 = preview.rows[1].record as InvoiceRecord;
  assert.equal(z2.total, 2360);
  assert.equal(z2.gst_mode, 'IGST');
  assert.equal(z2.status, 'Paid');
});

test('invoices: never overwrite an existing number; duplicates in file skipped', () => {
  const existing: ExistingData = { ...empty, invoices: [{ invoice_number: 'inv-7 ' }] };
  const csv = 'Invoice No,Date,Party,Total\nINV-7,01/04/2025,A,100\nINV-8,01/04/2025,A,100\nINV-8,01/04/2025,A,999\n,01/04/2025,A,5';
  const { preview } = run('invoices', csv, existing);
  assert.deepEqual(preview.rows.map((r) => r.action), ['error', 'create', 'skip', 'error']);
  assert.match(preview.rows[0].issues.find((i) => i.level === 'error')!.message, /never overwritten/);
  assert.equal((preview.rows[1].record as InvoiceRecord).total, 100);
});

test('invoices: bad dates, missing client and negative totals are row errors', () => {
  const csv = 'Invoice No,Date,Party,Total\nX1,31/02/2025,A,100\nX2,01/04/2025,,100\nX3,01/04/2025,B,-5\nX4,01/04/2025,B,abc';
  const { preview } = run('invoices', csv);
  assert.deepEqual(preview.rows.map((r) => r.action), ['error', 'error', 'error', 'error']);
  assert.equal(preview.summary.error, 4);
});

test('invoices: balance column derives payment; partial -> Partially Paid; reuses existing client', () => {
  const existing: ExistingData = {
    ...empty,
    clients: [{ id: 'c1', name: 'Acme', gstin: G_MH, state_code: '27', email: '', address: '', city: '', zip: '' }],
  };
  const csv = 'Invoice No,Date,Party Name,Total,Balance,GST %\nP1,01/04/2025,ACME,"11,800","5,800",18';
  const { preview } = run('invoices', csv, existing, SENDER_OPTS);
  const inv = preview.rows[0].record as InvoiceRecord;
  assert.equal(inv.amount_paid, 6000);
  assert.equal(inv.balance_due, 5800);
  assert.equal(inv.status, 'Partially Paid');
  assert.equal(inv.client.gstin, G_MH);
  assert.equal(inv.gst_mode, 'CGST_SGST');
});

/* ── apply ──────────────────────────────────────────────────── */

function memorySink() {
  const clients: Client[] = [];
  const items: unknown[] = [];
  const invoices: InvoiceRecord[] = [];
  const sizes: number[] = [];
  const sink: ImportSink = {
    clients: (rows) => {
      sizes.push(rows.length);
      for (const r of rows) clients.push(r.record as Client);
    },
    items: (rows) => void items.push(...rows.map((r) => r.record)),
    invoices: (rows) => {
      const have = new Set(invoices.map((i) => i.invoice_number));
      const out: string[] = [];
      for (const r of rows) {
        if (have.has(r.invoice_number)) continue;
        invoices.push(r);
        out.push(r.id);
      }
      return out;
    },
  };
  return { sink, clients, items, invoices, sizes };
}

test('applyImport: chunks 5,000 rows, reports progress and counts', async () => {
  const lines = ['Name,GSTIN,City'];
  for (let i = 0; i < 5000; i++) lines.push(`Client ${i},,City ${i % 10}`);
  const { preview } = run('clients', lines.join('\n'));
  assert.equal(preview.summary.create, 5000);
  const mem = memorySink();
  const progress: number[] = [];
  let yields = 0;
  const report = await applyImport(preview, mem.sink, {
    chunkSize: 250,
    onProgress: (d) => progress.push(d),
    yieldToUi: async () => void yields++,
  });
  assert.equal(report.created, 5000);
  assert.equal(mem.clients.length, 5000);
  assert.equal(mem.sizes.length, 20);
  assert.equal(yields, 20);
  assert.equal(progress.at(-1), 5000);
});

test('applyImport: sink failures are reported per row, not thrown', async () => {
  const { preview } = run('clients', 'Name\nA\nB');
  const report = await applyImport(preview, {
    clients: () => {
      throw new Error('Browser storage is full');
    },
    items: () => {},
    invoices: () => [],
  });
  assert.equal(report.created, 0);
  assert.equal(report.skipped, 2);
  assert.equal(report.errors[0].message, 'Browser storage is full');
});

test('applyImport: invoices rejected by the sink are counted as skipped', async () => {
  const { preview } = run('invoices', 'Invoice No,Date,Party,Total\nA,01/04/2025,X,10\nB,01/04/2025,X,20');
  const mem = memorySink();
  mem.invoices.push({ invoice_number: 'B' } as InvoiceRecord); // appeared after the preview
  const report = await applyImport(preview, mem.sink, { yieldToUi: async () => {} });
  assert.equal(report.created, 1);
  assert.equal(report.skipped, 1);
  assert.match(report.errors[0].message, /already exists/);
});

test('dry run matches what apply does', async () => {
  const { preview } = run('clients', `Name,GSTIN\nOne,\nTwo,${G_BAD}\nThree,`);
  const dry = dryRunReport(preview);
  const real = await applyImport(preview, memorySink().sink, { yieldToUi: async () => {} });
  assert.deepEqual(dry, real);
  assert.equal(dry.created, 2);
  assert.equal(dry.errors.length, 1);
});

test('errorRowsCsv lists failing source rows with the reason', () => {
  const { table, preview } = run('clients', `Name,GSTIN\nOne,\nTwo,${G_BAD}`);
  const csv = errorRowsCsv(table, preview);
  const lines = csv.replace(/\r\n$/, '').split('\r\n');
  assert.equal(lines[0], '﻿Source row,Name,GSTIN,Import error');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^3,Two,/);
  assert.match(lines[1], /checksum/i);
});
