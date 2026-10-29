/**
 * CN-A3 … A5 template test: every contract-particulars field reaches the paper, the parts are lazy and data-gated
 * (never on receipt paper), accent variable only, IT TDS printed once, and non-construction documents print unchanged.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headerRows } from '../src/lib/construction/cn-print.ts';
import { worksLineText, raDocTitle, trackingText } from '../src/components/templates/paper-helpers.ts';
import { cnPaperT as cnT } from '../src/i18n/areas/construction-r11-paper.ts';
import type { CnHeader } from '../src/types/construction-r11.ts';

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

const FULL: CnHeader = {
  name_of_work: 'Widening of SH-12 km 4–9', agreement_no: '12/EE/2026-27', agreement_date: '2026-04-15', work_order_no: 'WO/77', work_order_date: '2026-04-20',
  tender_ref: 'NIT 3/2026', client_office: 'PWD Division 3, Pune circle', engineer: 'Executive Engineer', site: { address: 'Km 4–9, SH-12', state_code: '27' },
  contract_value: 1150000, stipulated_start: '2026-05-01', stipulated_completion: '2027-03-31', extended_completion: '2027-06-30', ra_label: '4th RA bill (running)',
  period_from: '2026-10-01', period_to: '2026-10-31', measured_on: '2026-11-02', mb_nos: ['112', '113'], jv_note: 'ABC–XYZ JV (60%)',
};
const fmt = { date: (d: string) => d.split('-').reverse().join('-'), money: (n: number) => `₹${n}`, state: (c: string) => (c === '27' ? 'Maharashtra' : c) };

test('every contract-particulars field prints, in order, with a paper label in English and Hindi', () => {
  const rows = headerRows(FULL, fmt);
  assert.deepEqual(rows.map((r) => r.key), ['nameOfWork', 'agreement', 'workOrder', 'tender', 'clientOffice', 'engineer', 'site', 'contractValue', 'stipulated', 'extended', 'bill', 'period', 'measuredOn', 'mbNos', 'jv']);
  const v = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  assert.equal(v.agreement, '12/EE/2026-27 · 15-04-2026');
  assert.equal(v.site, 'Km 4–9, SH-12, Maharashtra');
  assert.equal(v.contractValue, '₹1150000');
  assert.equal(v.period, '01-10-2026 – 31-10-2026');
  assert.equal(v.mbNos, '112, 113');
  for (const r of rows) {
    const k = `p.${r.key}` as keyof typeof cnT.en;
    assert.ok(cnT.en[k] && cnT.hi[k], `${k} labelled`);
  }
  assert.deepEqual(headerRows({ ra_label: '1st RA bill (running)' }, fmt).map((r) => r.key), ['bill'], 'empty fields are skipped');
  assert.deepEqual(headerRows(undefined, fmt), []);
});

test('line sub-line: BOQ item no., M-book, class with approval; nothing on old documents', () => {
  const cn = { lines: { a: { ref: '2.1.3', mb: '112/45–47' }, b: { ref: '2.4', kind: 'extra', approval: 'EE/123' }, c: { kind: 'substituted', substitutes: '2.2', approval: 'SE/7' }, d: { kind: 'deviation' } } };
  assert.equal(worksLineText({ id: 'a' }, cn), 'Item 2.1.3 · MB 112/45–47');
  assert.equal(worksLineText({ id: 'b' }, cn), 'Item 2.4 · Extra item (approval EE/123)');
  assert.equal(worksLineText({ id: 'c' }, cn), 'Substituted item for 2.2 (approval SE/7)');
  assert.equal(worksLineText({ id: 'd' }, cn), 'Deviation');
  assert.equal(worksLineText({ id: 'z' }, cn), '');
  assert.equal(worksLineText({ id: 'a' }, undefined), '');
  assert.equal(trackingText({ boq_ref: '2.1' } as never), '', 'trackingText unchanged for an ordinary line');
  assert.equal(raDocTitle({ ra_no: 4 }, 'Tax Invoice'), 'Tax Invoice: Running Account Bill No. 4');
  assert.equal(raDocTitle({ ra_no: 4, ra_final: true }, 'Tax Invoice'), 'Tax Invoice: Final Bill');
});

test('TemplateEngine mounts the works parts lazily, gated by the snapshot, never on receipt paper', () => {
  const engine = src('components/templates/TemplateEngine.tsx');
  assert.match(engine, /const worksPaper = \(\) => import\('\.\/parts\/WorksPaper'\);/);
  assert.match(engine, /const cnDoc = layout !== 'receipt' && \(invoice\.boq_terms\?\.cn \|\| invoice\.ra_no\)/);
  for (const part of ['LazyWorksHeader', 'LazyRaItems', 'LazyWorksDeds', 'LazyWorksAbstract', 'LazyPvPage', 'LazyDemand']) assert.ok((engine.match(new RegExp(`<${part} `, 'g')) ?? []).length >= 1, `${part} mounted`);
  assert.match(engine, /works=\{cnDoc\?\.paper === 'pwd' && <Suspense fallback=\{null\}><LazyRaItems/);
  assert.match(engine, /<GstBody [^>]*works=\{worksHead\}/, 'contract box inside the gst grid, under the parties');
  assert.match(engine, /\{cnDoc\?\.abstract && <Suspense fallback=\{null\}><LazyWorksAbstract/);
  assert.ok(!/from '\.\/parts\/Works(HeaderBlock|DeductionsBlock|AbstractPage)'/.test(engine), 'no eager import of a works part');
});

test('IT TDS printed once; Site, not Ship to; accent variable only (no raw colours)', () => {
  const footer = src('components/templates/parts/FooterBlocks.tsx');
  assert.match(footer, /totals\.tds_amount > 0 && !invoice\.ra_deductions\?\.length/);
  assert.match(src('components/templates/parts/PartyPanel.tsx'), /invoice\.boq_terms\?\.cn \? 'Site' : t\('shipTo'\)/);
  assert.match(src('components/templates/parts/GstBody.tsx'), /invoice\.boq_terms\?\.cn \? 'Site' : 'Consignee \(Ship to\)'/);
  const css = src('components/templates/parts/works-paper.module.css');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css), 'no hard-coded colour');
  assert.match(css, /var\(--tpl-accent\)/);
  for (const f of ['WorksHeaderBlock', 'WorksDeductionsBlock', 'WorksAbstractPage', 'RaItemsTable']) assert.ok(!/#[0-9a-f]{6}|style=\{\{\s*color/i.test(src(`components/templates/parts/${f}.tsx`)), `${f}: no inline colour`);
  const deds = src('components/templates/parts/WorksDeductionsBlock.tsx');
  for (const k of ['p.measuredBy', 'p.checkedBy', 'p.passedFor', 'p.net', 'p.words']) assert.ok(deds.includes(k), `${k} printed`);
});
