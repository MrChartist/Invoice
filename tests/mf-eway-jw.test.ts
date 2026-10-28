/**
 * MF-C3 job-work e-Way JSON: sub-type 6 from a principal-register return (values from the principal's challan), job
 * worker → job worker (5B) dispatched from the first job worker, the needed flag (inter-State always; intra-State above
 * ₹50,000 unless the State exemption setting), and the existing sub-type 4 builder unchanged.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJwOnwardEway, buildJwReturnEway, dispatchFrom, jwEwayNeeded } from '../src/lib/mfg/mf-eway-jw.ts';
import { buildJobWorkEway } from '../src/lib/eway-job-work.ts';
import type { MaterialOut, PrincipalMovement } from '../src/types/job-work.ts';
import type { StockItem } from '../src/lib/inventory.ts';

const sender = { name: 'Rangrez Dyeing', gstin: '27AABCU9603R1ZM', address: 'Plot 4, MIDC Bhiwandi, Maharashtra 421302', stateCode: '27' };
const ret: PrincipalMovement = {
  id: 'm2', number: 'JWP/FY26-27/0007', date: '2026-10-20', kind: 'return', party_name: 'Surat Mills', party_gstin: '24AAACS1234A1Z5', challan_no: 'OUR/45',
  lines: [{ id: 'l1', name: 'Dyed fabric', qty: 1200, unit: 'MTR', hsn: '5407', value: 96000, processed: true }, { id: 'l2', name: 'Unused greige', qty: 0, unit: 'MTR' }],
};

test('job-work return: sub-type 6, document CHL, from us to the principal, value of his goods, needed inter-State', () => {
  const b = buildJwReturnEway(ret, { name: 'Surat Mills', gstin: '24AAACS1234A1Z5', address: 'Ring Road, Surat, Gujarat 395002' }, { sender });
  assert.deepEqual([b.bill.supplyType, b.bill.subSupplyType, b.bill.docType, b.bill.docNo], ['O', 6, 'CHL', 'JWP/FY26-27/0007']);
  assert.deepEqual([b.bill.fromGstin, b.bill.toGstin, b.bill.actToStateCode], ['27AABCU9603R1ZM', '24AAACS1234A1Z5', 24]);
  assert.deepEqual([b.bill.itemList.length, b.bill.itemList[0].taxableAmount, b.bill.totInvValue, b.bill.cgstValue + b.bill.igstValue], [1, 96000, 96000, 0]);
  assert.equal(b.required, true);
  assert.ok(b.notes.some((n) => /MF11/.test(n)));
  assert.throws(() => buildJwReturnEway({ ...ret, kind: 'receipt' }, undefined, { sender }), /not a return/);
});

test('needed flag: inter-State whatever the value; intra-State above ₹50,000 unless the State exempts', () => {
  assert.equal(jwEwayNeeded('27', '24', 100).needed, true);
  assert.equal(jwEwayNeeded('27', '27', 50000).needed, false);
  assert.equal(jwEwayNeeded('27', '27', 50001).needed, true);
  assert.equal(jwEwayNeeded('27', '27', 90000, true).needed, false);
  assert.match(jwEwayNeeded('27', '27', 90000, true).note, /MF11/);
});

const items: StockItem[] = [{ id: 'fab', name: 'Cut pieces KT-22', unit: 'MTR', hsn: '5208', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, tax_rate: 5 }];
const out: MaterialOut = { id: 'o', number: 'JWC/FY26-27/0003', date: '2026-10-21', party_name: 'Embroidery Co', party_gstin: '27AAPFU0939F1ZV', job_worker_godown: 'jw2', lines: [{ id: 'x', item_id: 'fab', qty: 57.6, rate: 120 }] };

test('job worker → job worker (5B): our challan, dispatch-from the first job worker; sub-type 4 builder unchanged', () => {
  const plain = buildJobWorkEway(out, { sender, items });
  const b = buildJwOnwardEway(out, { name: 'Rehmat Tailors', gstin: '27AAACB2230M1ZT', address: 'Lane 3, Bhiwandi, Maharashtra 421305' }, { name: 'Embroidery Co', gstin: '27AAPFU0939F1ZV', address: 'Surat Road, Bhiwandi 421302' }, items, { sender });
  assert.deepEqual([b.bill.subSupplyType, b.bill.transType, b.bill.fromGstin, b.bill.fromPincode], [4, 3, sender.gstin, 421305]);
  assert.deepEqual([plain.bill.subSupplyType, plain.bill.transType, plain.bill.fromPincode], [4, 1, 421302], 'sub-type 4 output as before');
  assert.equal(b.required, false, 'intra-State ₹6,912');
  assert.ok(b.notes.some((n) => /5B/.test(n)));
  assert.equal(dispatchFrom({ ...plain.bill, transType: 2 }, { name: 'J', state_code: '24', address: 'Surat 395002' }).transType, 4, 'bill-to-ship-to + dispatch-from = combination');
});
