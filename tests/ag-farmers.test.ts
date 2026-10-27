/** AG-A2 farmers: code sequence and uniqueness, Aadhaar last 4 only, import mapping, principal_kind, balances, duplicates. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { aadhaarProblem, duplicateWarnings, farmerBalances, farmersFromRows, importFarmers, loadFarmers, nextFarmerCode, saveFarmer } from '../src/lib/agri/ag-farmers.ts';
import type { FarmerCycle } from '../src/types/agri-r12.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('codes: F-0001 sequence above the highest; unique', () => {
  assert.equal(nextFarmerCode([]), 'F-0001');
  assert.equal(nextFarmerCode(['F-0009', 'X', undefined, 'F-0042']), 'F-0043');
  const a = saveFarmer({ name: 'Ram Lal', ag: {} });
  assert.equal(a.ag.code, 'F-0001');
  assert.equal(a.principal_kind, 'agriculturist', 'the RCM prompt and 6DD(e) see him');
  assert.equal(saveFarmer({ name: 'Shyam', ag: {} }).ag.code, 'F-0002');
  assert.throws(() => saveFarmer({ name: 'Dup', ag: { code: 'f-0001' } }), /already used/);
});

test('Aadhaar: exactly four digits, never the full number', () => {
  assert.equal(aadhaarProblem('1234'), '');
  assert.equal(aadhaarProblem(''), '');
  assert.ok(aadhaarProblem('12345'));
  assert.ok(aadhaarProblem('1234 5678 9012'));
  assert.throws(() => saveFarmer({ name: 'X', ag: { aadhaar_last4: '12345' } }), /last 4/);
});

test('bank fields mirror to the vendor (e-payment files); duplicate phone / account warn', () => {
  const a = saveFarmer({ name: 'Ram', ag: { phone: '98765 43210', bank: { account: '1234 5678 90', ifsc: 'sbin0001234' } } });
  assert.deepEqual([a.bank_account_no, a.bank_ifsc, a.ag.phone], ['1234567890', 'SBIN0001234', '9876543210']);
  const w = duplicateWarnings({ ag: { code: 'F-0009', phone: '9876543210', bank: { account: '1234567890' } } }, loadFarmers());
  assert.equal(w.length, 2);
});

test('import mapping: headers matched loosely; a missing code takes the next', () => {
  const rows = farmersFromRows([{ 'Farmer Name': 'Ram', Village: 'Rampur', Mobile: '9876543210', 'Aadhaar': '1234-5678-9012' }, { Code: 'F-0100', Name: 'Shyam' }, { Name: '' }], ['F-0005']);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].ag.code, rows[0].ag.village, rows[0].ag.aadhaar_last4], ['F-0006', 'Rampur', '9012']);
  assert.equal(importFarmers([{ Name: 'A' }, { Name: 'B' }]), 2);
  assert.equal(loadFarmers().length, 2);
});

test('balances: own vouchers payable, closed cycles net, receivable from the linked client', () => {
  const f = saveFarmer({ name: 'Ram', ag: { code: 'F-0001' } });
  const purchases = [{ id: 'p1', kind: 'PURCHASE', vendor_id: f.id, vendor_name: 'Ram', bill_number: 'FPV/FY26-27/0001', date: '2026-10-01', category: 'x', lines: [], taxable: 1000, cgst: 0, sgst: 0, igst: 0, total: 1000, amount_paid: 400, itc_eligible: false }];
  const cycles = [{ id: 'c', number: 'CYB', period_from: '2026-10-01', period_to: '2026-10-10', source: 'milk', status: 'closed', lines: [{ farmer_id: f.id, qty: 1, unit: 'L', amount: 500, deductions: [], net: 500 }] }] as FarmerCycle[];
  const clients = [{ id: 'c1', name: 'Ram', email: '', address: '', city: '', zip: '', ag: { code: 'F-0001' } }];
  const invoices = [{ id: 'i1', client: { id: 'c1' }, total: 300, status: 'Sent', doc_type: 'INVOICE' }];
  const b = farmerBalances(loadFarmers(), purchases, cycles, clients as never, invoices as never, [{ id: 'r', invoice_id: 'i1', amount: 100, method: 'Cash', date: '2026-10-02' }]);
  assert.deepEqual(b.get(f.id), { payable: 1100, receivable: 200 });
});
