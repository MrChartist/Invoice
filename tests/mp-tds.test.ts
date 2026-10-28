/**
 * R17-B4 expected client TDS (R14-D path): 194C by the bill date (2026-03-31 / 2026-04-01 labels), deductee by our firm
 * form (1 % proprietor, 2 % others), base = taxable value without GST, thresholds, the client's own section; the GST
 * TDS u/s 51 hint for a TDS-only Government client, never on reverse charge; the paper line only when asked.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientTds, gstTdsHint } from '../src/lib/manpower/mp-tds-io.ts';

const c = { id: 'c', name: 'Client' };

test('194C by date and firm form on the taxable value; thresholds; the client\'s section', () => {
  const after = clientTds(c, '2026-10-31', 128600, [], 'proprietorship')!;
  assert.deepEqual([after.section, after.rate, after.expected], ['194C-1', 1, 1286]);
  assert.match(after.label!, /^Sec 393\(1\).*supply of manpower is work \(from 1 Apr 2026\)$/);
  const before = clientTds(c, '2026-03-31', 128600, [], 'proprietorship')!;
  assert.deepEqual([before.label, before.expected], ['194C-1', 1286]);
  assert.deepEqual(clientTds(c, '2026-10-31', 128600, [], 'company')?.expected, 2572, '2 % for others');
  assert.equal(clientTds(c, '2026-10-31', 25000, [], 'proprietorship'), null, 'below the single-bill threshold');
  assert.equal(clientTds({ ...c, mp: { tds: { section: 'none', deductee: 'other' } } }, '2026-10-31', 128600, [], 'proprietorship'), null);
  const j = clientTds({ ...c, mp: { tds: { section: '194J', deductee: 'other' } } }, '2026-03-31', 128600, [], 'proprietorship')!;
  assert.deepEqual([j.section, j.label?.includes('manpower')], ['194J', false], 'a client\'s 194J before 1 Apr 2026 is accepted (MP15)');
});

test('GST TDS u/s 51 hint: TDS-only Government client, forward charge, above the threshold', () => {
  const gov = { mp: { gst_tds_only: true } };
  assert.match(gstTdsHint(gov, 'fwd', 300000, '2026-10-31'), /GST TDS u\/s 51 expected at 2 %.*MP13/);
  assert.equal(gstTdsHint(gov, 'rcm', 300000, '2026-10-31'), '');
  assert.equal(gstTdsHint(gov, 'fwd', 200000, '2026-10-31'), '');
  assert.equal(gstTdsHint({}, 'fwd', 300000, '2026-10-31'), '');
  assert.equal(gstTdsHint(gov, 'fwd', 300000, '2018-09-30'), '');
});

test('the paper prints the TDS line only from the snapshot flag', () => {
  const s = readFileSync(new URL('../src/components/templates/parts/manpower/DutyAnnex.tsx', import.meta.url), 'utf8');
  assert.match(s, /mp\.tds_print && mp\.tds &&/);
  assert.ok(!/readManpowerSettings|storage/.test(s), 'the paper never reads live settings');
});
