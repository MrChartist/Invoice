/**
 * 7.167 (PENDING 43): the ITC-04 JSON layout could not be checked against a primary source (GSTN publishes no JSON
 * schema for the offline tool), so it stays a flagged working paper: `verified: false`, the CA item named, the "verify
 * with your CA" note kept, and no marker key added to the upload file itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ITC04_JSON_LAYOUT, ITC04_JSON_NOTE, buildItc04Json } from '../src/lib/itc04-json.ts';
import type { Itc04Report } from '../src/lib/itc04.ts';

test('ITC-04 JSON stays unverified, with the CA note and only the documented sections', () => {
  assert.equal(ITC04_JSON_LAYOUT.verified, false);
  assert.equal(ITC04_JSON_LAYOUT.ca, 'G43');
  assert.match(ITC04_JSON_NOTE, /unverified/);
  assert.match(ITC04_JSON_NOTE, /verify with your CA/);
  const j = buildItc04Json({ period: { from: '2026-04-01', to: '2026-09-30' }, table4: [], table5: [] } as unknown as Itc04Report, '27aabcu9603r1zm');
  assert.deepEqual(Object.keys(j), ['gstin', 'fp', 'm2jw', 'jw2m', 'jw2jw', 'jwsupply']);
});
