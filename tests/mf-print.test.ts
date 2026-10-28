/** MF-A5 paper: Udyam / FSSAI line by snapshot, MSE clause, FSSAI validation, sub-lines per kind, block boxes, `mf` kept by normalizeRecord, plain documents unchanged. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mfDeclaration, mfLineText, mfSellerText, trackingText } from '../src/components/templates/paper-helpers.ts';
import { normalizeRecord, R9_RECORD_KEYS, R13_RECORD_KEYS } from '../src/store/invoice-defaults.ts';
import { mfSnapshot } from '../src/lib/mfg/mf-snapshot.ts';
import { mfBoxes, validateFssai } from '../src/lib/mfg/mf-print.ts';

const SELLER = { msme_udyam: 'UDYAM-MH-26-0012345', msme_category: 'MICRO' as const };

test('Udyam line only with the category on the snapshot (old snapshots print nothing new); switch off; FSSAI line', () => {
  assert.equal(mfSellerText(SELLER), 'Udyam: UDYAM-MH-26-0012345 (Micro)');
  assert.equal(mfSellerText({ msme_udyam: 'UDYAM-MH-26-0012345' }), '', 'a snapshot saved before Round 13 prints nothing new');
  assert.equal(mfSellerText({ ...SELLER, udyam_print: false }), '');
  assert.equal(mfSellerText({ fssai_no: '10020022003456' }), 'FSSAI Lic. No. 10020022003456');
  assert.equal(mfSellerText(undefined), '');
  assert.equal(validateFssai('1002 0022 0034 56'), '');
  assert.match(validateFssai('12345'), /14 digits/);
});

test('MSE clause: micro / small seller to a GSTIN buyer only; snapshot declarations', () => {
  const inv = (sender: object, gstin = '27AAPFU0939F1ZV', mf?: object) => ({ sender, client: { gstin }, doc_type: 'INVOICE', mf }) as never;
  assert.match(mfDeclaration(inv(SELLER)), /^Payment due within 45 days of acceptance — MSMED Act 2006 Sec 15/);
  assert.equal(mfDeclaration(inv(SELLER, '')), '', 'no clause without the buyer\'s GSTIN');
  assert.equal(mfDeclaration(inv({ ...SELLER, msme_category: 'MEDIUM' })), '');
  assert.equal(mfDeclaration(inv({})), '');
  assert.match(mfDeclaration(inv({}, '', mfSnapshot('scrap', { scrap: { tcs: true, rows: [{ item: 'Turnings', net_kg: 300 }] } }))), /TCS u\/s 394\(1\)/);
  assert.match(mfDeclaration(inv({}, '', mfSnapshot('export_aa', { export_aa: { aa_no: 'AA-1' } }))), /Advance Authorisation no\. AA-1/);
});

test('sub-lines per kind; nothing without `mf`; boxes', () => {
  const mf = mfSnapshot('drawing', { header: { customer_po: 'PO-77', drawings: '' }, lines: { l1: { drawing: '1145-B', rev: 'C', po_line: '20', heat: 'H2231' }, l2: { batch: 'NK2610', packed_on: '2026-10-12', best_before: '2027-01-11', mrp: 40 }, l3: { style: 'KT-22', lot: 'CUT/26-27/0014', sizes: 'S6 M12 L12 XL6' }, l4: { drawing: '' } } });
  assert.equal(mfLineText({ id: 'l1' }, mf), 'Drg. 1145-B rev C · PO 20 · Heat H2231');
  assert.equal(mfLineText({ id: 'l2' }, mf), 'Batch NK2610 · Packed 12/10/26 · Best before 11/01/27 · MRP ₹40');
  assert.equal(mfLineText({ id: 'l3' }, mf), 'Style KT-22 · Lot CUT/26-27/0014 · S6 M12 L12 XL6');
  assert.equal(mf.lines?.l4, undefined, 'empty line parts dropped');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never, undefined, mf), 'Batch B1 · Drg. 1145-B rev C · PO 20 · Heat H2231');
  assert.equal(trackingText({ id: 'x', batch_no: 'B1' } as never), 'Batch B1', 'old documents print as before');
  assert.deepEqual(mfBoxes(mf), [{ title: 'Job particulars', rows: [['Customer PO', 'PO-77']] }]);
  assert.deepEqual(mfBoxes(mfSnapshot('print', { print: { colours: '4 + varnish', ups: 4, sheets: 2500 } }))[0].rows, [['Colours', '4 + varnish'], ['Ups', 4], ['Sheets', 2500]]);
});

test('`mf` is one record key kept by normalizeRecord; the paper mounts it lazily, never on receipts', () => {
  assert.deepEqual([...R13_RECORD_KEYS], ['mf']);
  assert.ok((R9_RECORD_KEYS as readonly string[]).includes('mf'));
  const mf = mfSnapshot('drawing', { lines: { l1: { drawing: 'D1' } } });
  assert.deepEqual(normalizeRecord({ id: 'i', doc_type: 'INVOICE', items: [], mf } as never).mf, mf);
  assert.equal('mf' in normalizeRecord({ id: 'j', doc_type: 'INVOICE', items: [] } as never), false, 'absent stays absent');
  const te = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  assert.match(te, /const LazyMfgBlock = lazy\(\(\) => import\('\.\/parts\/MfgBlock'\)\);/);
  assert.match(te, /invoice\.mf && layout !== 'receipt' && <Suspense fallback=\{null\}><LazyMfgBlock/);
  assert.match(te, /invoice\.mf && layout !== 'receipt' && <Suspense fallback=\{null\}><LazyMfgAnnexure/);
});
