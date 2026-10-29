/**
 * PENDING 49 (8.111): the month-end pack as one PDF — the papers are built from the same files as the ZIP, every value
 * escaped, empty GSTR-1 sections left out, and the module stays lazy (html-to-image / jspdf only through PdfBuilder).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { csvTableHtml, packPdfPapers } from '../src/lib/report-pack-pdf.ts';
import { toCsv } from '../src/lib/csv.ts';

test('csvTableHtml: header + rows, escaped, numbers right-aligned; header-only CSV is empty', () => {
  const html = csvTableHtml(toCsv([['Particulars', 'Amount'], ['<Sales>', 1200.5]]));
  assert.match(html, /<th[^>]*>Particulars<\/th>/);
  assert.ok(html.includes('&lt;Sales&gt;'));
  assert.ok(!html.includes('<Sales>'));
  assert.match(html, /text-align:right">1200\.5</);
  assert.equal(csvTableHtml(toCsv([['GSTIN', 'Value']])), '');
});

test('packPdfPapers: P&L, balance sheet, ageing, GSTR-1 (sections with rows only), GSTR-3B', () => {
  const files = [
    { name: 'PnL_2026-09.csv', text: toCsv([['Particulars', 'Amount'], ['Sales', 100]]) },
    { name: 'BalanceSheet_2026-09-30.csv', text: toCsv([['Head', 'Amount'], ['Capital', 50]]) },
    { name: 'Ageing_2026-09-30.csv', text: toCsv([['Client', '0-30'], ['Asha', 10]]) },
    { name: 'GSTR1_2026-09_b2b.csv', text: toCsv([['GSTIN', 'Value'], ['27AAAAA0000A1Z5', 100]]) },
    { name: 'GSTR1_2026-09_exp.csv', text: toCsv([['Port', 'Value']]) },
    { name: 'GSTR3B_2026-09.csv', text: toCsv([['Table', 'IGST'], ['3.1(a)', 18]]) },
    { name: 'GST_summary_2026-09.html', text: '<html></html>' },
    { name: 'README.txt', text: 'x' },
  ];
  const papers = packPdfPapers('2026-09', files, 'A & B');
  assert.deepEqual(papers.map((p) => p.title), ['Profit & loss', 'Balance sheet', 'Receivables ageing', 'GSTR-1', 'GSTR-3B']);
  const g1 = papers[3].html;
  assert.ok(g1.includes('B2B') && !g1.includes('EXP'));
  assert.ok(papers[0].html.includes('A &amp; B · 2026-09'));
  assert.ok(papers.every((p) => /verify with your CA/.test(p.html)));
});

test('the PDF pack is lazy and uses the existing PDF stack', () => {
  const src = readFileSync('src/lib/report-pack-pdf.ts', 'utf8');
  assert.ok(src.includes("import('./pdf-batch')"));
  assert.ok(!/from 'jspdf'|from 'html-to-image'/.test(src));
  const bar = readFileSync('src/components/invoicing-ux/ReportViewsBar.tsx', 'utf8');
  assert.ok(bar.includes("import('../../lib/report-pack-pdf')"));
});
