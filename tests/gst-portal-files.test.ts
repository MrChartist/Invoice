import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import {
  MAX_FINDINGS, bookDocs, buildRecord, diffFindings, diffPortalBooks, errorFindings, errorHint, findByHash, matchErrors, openPortalErrors,
  parsePortalJson, portalFilesDb, readPortalFile, subsetChecks, subsetReport,
} from '../src/lib/gst-portal-files.ts';
import { buildGstr1Json } from '../src/lib/gstr-json.ts';
import { writeZip } from '../src/lib/zip.ts';
import { gstin } from './einvoice-fixtures.ts';
import type { DocRow, Gstr1Report } from '../src/lib/gst-reports.ts';

const ME = gstin('27AABCU9603R1Z');
const C1 = gstin('27AAACB2230M1Z');
const C2 = gstin('29AABCT1332L1Z');

const doc = (id: string, ctin: string, number: string, date: string, taxable: number, over: Partial<DocRow> = {}): DocRow => ({
  invoiceId: id, number, date, value: taxable * 1.18, pos: ctin.slice(0, 2), rchrg: 'N', partyName: id, ctin,
  items: [{ rate: 18, txval: taxable, igst: 0, cgst: taxable * 0.09, sgst: taxable * 0.09, cess: 0 }],
  taxable, igst: 0, cgst: taxable * 0.09, sgst: taxable * 0.09, ...over,
});

function report(): Gstr1Report {
  return {
    period: { kind: 'month', fyStart: 2026, month: 5 }, gstin: ME, fp: '052026',
    b2b: [doc('i1', C1, 'INV/FY26-27/0001', '2026-05-03', 1000), doc('i2', C1, 'INV/FY26-27/0002', '2026-05-04', 500), doc('i3', C2, 'INV/FY26-27/0003', '2026-05-05', 2000)],
    b2cl: [doc('i4', '', 'INV/FY26-27/0004', '2026-05-06', 300000, { pos: '29' })],
    b2cs: [{ supply: 'INTRA', pos: '27', rate: 18, txval: 100, igst: 0, cgst: 9, sgst: 9 }],
    cdnr: [], cdnur: [], exp: [], nil: [], hsn: [], hsnB2b: [], hsnB2c: [], hsnSplit: false, hsnMinDigits: 4, docIssue: [],
    totals: { taxable: 0, igst: 0, cgst: 0, sgst: 0, value: 0 }, counts: { included: 5, drafts: 0, cancelled: 0, notTaxDocs: 0 },
  } as Gstr1Report;
}

const fixture = (vals: Record<string, string>) => {
  let s = readFileSync(new URL('./fixtures/gstr1-error-report.json', import.meta.url), 'utf8');
  for (const [k, v] of Object.entries(vals)) s = s.replaceAll(`{{${k}}}`, v);
  return s;
};

const errorJson = fixture({ GSTIN: ME, FP: '052026', CTIN: C1, INUM: 'inv/fy26-27/0002', IDT: '04-05-2026' });

test('detect: error report, downloaded GSTR-1, unknown', () => {
  const err = parsePortalJson(JSON.parse(errorJson));
  assert.equal(err.kind, 'gstr1_error');
  assert.equal(err.gstin, ME);
  assert.equal(err.fp, '052026');
  assert.equal(err.docs.length, 1);
  assert.equal(err.docs[0].date, '2026-05-04');
  assert.equal(err.docs[0].taxable, 1000);
  assert.equal(err.docs[0].tax, 180);
  assert.deepEqual(err.sectionErrors.map((e) => e.section), ['b2cs']);
  // A wrapped download (data: {...}) without error fields is GSTR-1 data.
  const data = parsePortalJson({ data: JSON.parse(JSON.stringify(buildGstr1Json(report()))) });
  assert.equal(data.kind, 'gstr1_data');
  assert.equal(data.docs.length, 4);
  // Not a portal file.
  assert.equal(parsePortalJson({ hello: 'world' }).kind, 'unknown');
  assert.equal(parsePortalJson([1, 2]).kind, 'unknown');
  // Group-level error applies to its documents; tolerant amount strings.
  const g = parsePortalJson({ gstin: ME, fp: '052026', b2b: [{ ctin: C2, error_cd: 'X1', error_msg: 'Recipient GSTIN is invalid', inv: [{ inum: 'A1', idt: '2026-05-01', val: '1,180.00', itms: [{ itm_det: { txval: '1000', iamt: '180' } }] }] }] });
  assert.equal(g.docs[0].errorCode, 'X1');
  assert.equal(g.docs[0].value, 1180);
});

test('match by normalised number + GSTIN (+ date), with hints and fix targets', () => {
  const parsed = parsePortalJson(JSON.parse(errorJson));
  const rows = matchErrors(parsed, bookDocs(report()));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ours?.invoiceId, 'i2', 'lower-case number with leading zeros matches');
  assert.equal(rows[0].hint, 'date_period');
  assert.equal(rows[0].dateDiffers, undefined);
  // Wrong GSTIN does not match; a different date still matches on number but is flagged.
  const other = matchErrors({ docs: [{ ...parsed.docs[0], ctin: C2 }] }, bookDocs(report()));
  assert.equal(other[0].ours, undefined);
  const shifted = matchErrors({ docs: [{ ...parsed.docs[0], date: '2026-05-20' }] }, bookDocs(report()));
  assert.equal(shifted[0].dateDiffers, true);
  assert.equal(errorHint('', 'Duplicate invoice number'), 'duplicate');
  assert.equal(errorHint('', 'Recipient GSTIN is not active'), 'gstin_invalid');
  assert.equal(errorHint('', 'POS is not valid for supply type'), 'pos_mismatch');
  assert.equal(errorHint('', 'Rate is not allowed'), 'rate_not_allowed');
  assert.equal(errorHint('', 'Something else'), 'other');
});

test('corrected JSON of the failed documents equals the full build filtered', () => {
  const g1 = report();
  const keep = new Set(['b2b|i2', 'b2cl|i4']);
  const subset = buildGstr1Json(subsetReport(g1, keep)) as { b2b: { ctin: string; inv: { inum: string }[] }[]; b2cl: unknown[]; b2cs?: unknown };
  const full = buildGstr1Json(g1) as { b2b: { ctin: string; inv: { inum: string }[] }[]; b2cl: unknown[] };
  const filtered = full.b2b.map((g) => ({ ...g, inv: g.inv.filter((i) => i.inum === 'INV/FY26-27/0002') })).filter((g) => g.inv.length);
  assert.deepEqual(subset.b2b, filtered);
  assert.deepEqual(subset.b2cl, full.b2cl);
  assert.equal(subset.b2cs, undefined, 'summary sections are not resent');
  // Preflight of the subset.
  const bad = subsetReport({ ...g1, b2b: [doc('x', '27BADGSTIN', '', '2026-06-01', 10)] }, new Set(['b2b|x']));
  assert.deepEqual(subsetChecks(bad, g1.period).map((i) => i.problem).sort(), ['date', 'gstin', 'number']);
  assert.deepEqual(subsetChecks(subsetReport(g1, keep), g1.period), []);
});

test('downloaded GSTR-1 vs books: missing on portal / in books, differences of ₹1 or more', () => {
  const g1 = report();
  const portal = parsePortalJson(buildGstr1Json(g1));
  assert.deepEqual(diffPortalBooks(portal, bookDocs(g1)), [], 'identical → no findings');
  const tweaked = parsePortalJson(JSON.parse(JSON.stringify(buildGstr1Json(g1)).replace('"INV/FY26-27/0003"', '"INV/FY26-27/0099"')));
  tweaked.docs[0] = { ...tweaked.docs[0], taxable: tweaked.docs[0].taxable - 0.5 }; // under ₹1: ignored
  tweaked.docs[1] = { ...tweaked.docs[1], tax: tweaked.docs[1].tax + 2 };
  const diff = diffPortalBooks(tweaked, bookDocs(g1));
  assert.deepEqual(diff.map((d) => `${d.cls}:${d.number}`).sort(), ['missing_in_books:INV/FY26-27/0099', 'missing_on_portal:INV/FY26-27/0003', 'value_diff:INV/FY26-27/0002']);
  assert.equal(diff.find((d) => d.cls === 'value_diff')?.dTax, -2);
  assert.equal(diffFindings(diff).length, 3);
});

test('zip input, unknown file rejected, same-hash re-import detected, findings capped', async () => {
  resetStorage();
  const bytes = new TextEncoder().encode(errorJson);
  const zipped = await writeZip([{ name: 'error_report/GSTR1_err.json', data: bytes }, { name: 'readme.txt', data: new TextEncoder().encode('x') }]);
  const fromZip = await readPortalFile(zipped);
  assert.equal(fromZip.kind, 'gstr1_error');
  assert.equal(fromZip.docs.length, 1);
  const plain = await readPortalFile(bytes);
  assert.equal(plain.kind, 'gstr1_error');
  assert.equal((await readPortalFile(new TextEncoder().encode('{"x":1}'))).kind, 'unknown');
  assert.equal((await readPortalFile(new TextEncoder().encode('not json'))).kind, 'unknown');

  const rows = matchErrors(plain, bookDocs(report()));
  const rec = buildRecord({ parsed: plain, findings: errorFindings(rows, plain.sectionErrors), counts: { docs: 1, errors: 1 }, fileName: 'err.json' });
  portalFilesDb.save(rec);
  assert.equal(findByHash(portalFilesDb.all(), plain.hash)?.id, rec.id, 're-import of the same bytes is found');
  assert.equal(findByHash(portalFilesDb.all(), fromZip.hash), undefined, 'a different file is not');
  assert.equal(openPortalErrors(portalFilesDb.all(), '052026', ME), 2);
  portalFilesDb.setResolved(rec.id, rec.findings[0].key, true);
  assert.equal(openPortalErrors(portalFilesDb.all(), '052026', ME), 1);
  portalFilesDb.save({ ...rec });
  assert.equal(portalFilesDb.all().length, 1, 'saving the same hash replaces, never duplicates');
  const many = buildRecord({ parsed: plain, findings: Array.from({ length: 2500 }, (_, i) => ({ key: `k${i}`, section: 'b2b', number: String(i), date: '', ctin: '' })), counts: { docs: 2500 } });
  assert.equal(many.findings.length, MAX_FINDINGS);
});
