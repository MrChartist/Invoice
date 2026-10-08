import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGstr1Json } from '../src/lib/gstr-json.ts';

const empty: any = {
  gstin: '27ABCDE1234F1Z5', fp: '042025',
  b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], exp: [], nil: [], hsn: [], docIssue: [],
};

test('GSTR-1 JSON: gt/cur_gt default to 0 and accept explicit values', () => {
  const d = buildGstr1Json(empty);
  assert.equal(d.gt, 0);
  assert.equal(d.cur_gt, 0);
  const e = buildGstr1Json(empty, { gt: 1234567.891, curGt: 500 });
  assert.equal(e.gt, 1234567.89);
  assert.equal(e.cur_gt, 500);
});
