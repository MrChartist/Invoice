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

test('GSTR-3B JSON: section layout carries 3.1, 3.2, 4 and 5 from the working paper', async () => {
  const { buildGstr3bJson } = await import('../src/lib/gstr-json.ts');
  const row = (taxable: number, igst = 0, cgst = 0, sgst = 0, cess = 0) => ({ taxable, igst, cgst, sgst, cess });
  const heads = (igst: number, cgst = 0, sgst = 0, cess = 0) => ({ igst, cgst, sgst, cess });
  const b = {
    outward: { taxable: row(1000.005, 0, 90, 90), zeroRated: row(500, 90), nilExempt: { inter: 10, intra: 20 }, inwardRcm: row(100, 18), nonGst: 5 },
    interStateUnreg: [{ pos: '29', taxable: 300, igst: 54 }],
    itc: { importGoods: heads(36), importServices: heads(0), availableRcm: heads(18), availableOther: heads(0, 45, 45), reversedRules: heads(0), reversedOther: heads(1), net: heads(53, 45, 45), ineligible: heads(2) },
    inwardExempt: { inter: 7, intra: 8 },
  } as never;
  const j = buildGstr3bJson(b, '27AAPFU0939F1ZV', '042026') as any;
  assert.equal(j.ret_period, '042026');
  assert.deepEqual(j.sup_details.osup_det, { txval: 1000.01, iamt: 0, camt: 90, samt: 90, csamt: 0 });
  assert.equal(j.sup_details.osup_nil_exmp.txval, 30);
  assert.deepEqual(j.inter_sup.unreg_details, [{ pos: '29', txval: 300, iamt: 54 }]);
  assert.equal(j.itc_elg.itc_avl.find((x: any) => x.ty === 'IMPG').iamt, 36);
  assert.equal(j.itc_elg.itc_avl.find((x: any) => x.ty === 'ISRC').iamt, 18);
  assert.equal(j.itc_elg.itc_rev.find((x: any) => x.ty === 'OTH').iamt, 1);
  assert.equal(j.itc_elg.itc_net.camt, 45);
  assert.equal(j.inward_sup.isup_details[0].intra, 8);
});
