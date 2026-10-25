/** WP-9 branches: master validation, tagging (explicit and inferred), filters, summary, roles. */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, SELLER, gstin } from './helpers/world.ts';
import { setActorProvider, isAccessDeniedError } from '../src/lib/access.ts';
import {
  UNASSIGNED, branchOfInvoice, branchOfPurchase, branchPredicates, branchSummary, branchesDb, filterByBranch, tagPurchases, validateBranch,
} from '../src/lib/branch.ts';
import { saveVoucher, loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
});
afterEach(() => setActorProvider(null));

const inv = (id: string, extra: Partial<InvoiceRecord>): InvoiceRecord =>
  ({ id, invoice_number: id, doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-10', taxable_value: 1000, total: 1180, currency: 'INR', sender: SELLER, ...extra }) as InvoiceRecord;
const bill = (id: string, extra: Partial<PurchaseRecord>): PurchaseRecord =>
  ({ id, kind: 'PURCHASE', vendor_name: 'V', bill_number: id, date: '2026-05-10', taxable: 500, total: 590, lines: [], cgst: 45, sgst: 45, igst: 0, itc_eligible: true, amount_paid: 0, category: 'Purchases', ...extra }) as PurchaseRecord;

test('branch master: validation, GSTIN → state, roles', () => {
  const mumbai = branchesDb.save({ name: 'Mumbai HO', profile_id: SELLER.id, code: 'mum' });
  assert.equal(mumbai.code, 'MUM');
  const pune = branchesDb.save({ name: 'Bengaluru', gstin: gstin('29AABCU9603R1Z').toLowerCase() });
  assert.equal(pune.state_code, '29');
  assert.match(validateBranch({ name: 'mumbai ho' }, branchesDb.all())[0], /already exists/);
  assert.match(validateBranch({ name: 'X', gstin: 'bad' }, [])[0], /15 characters/);
  assert.match(validateBranch({ name: 'Y', profile_id: SELLER.id }, branchesDb.all())[0], /profile/);
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  assert.throws(() => branchesDb.save({ name: 'Z' }), isAccessDeniedError);
  assert.throws(() => setTable('branches', []), isAccessDeniedError, 'table guard');
});

test('tagging: explicit beats inferred; profile, GSTIN and single-state inference', () => {
  const ho = branchesDb.save({ name: 'HO', profile_id: SELLER.id });
  const ka = branchesDb.save({ name: 'KA', gstin: gstin('29AABCU9603R1Z') });
  const all = branchesDb.all();
  assert.equal(branchOfInvoice(inv('a', {}), all), ho.id, 'from the sender profile');
  assert.equal(branchOfInvoice(inv('b', { branch_id: ka.id }), all), ka.id, 'explicit tag');
  assert.equal(branchOfInvoice(inv('c', { sender: { ...SELLER, id: 'other', companyGstin: ka.gstin! } }), all), ka.id, 'from the GSTIN');
  assert.equal(branchOfInvoice(inv('d', { sender: { ...SELLER, id: 'x', companyGstin: '' } }), all), '');
  assert.equal(branchOfPurchase(bill('p', { place_of_supply: '29' }), all), ka.id);
  assert.equal(branchOfPurchase(bill('q', { place_of_supply: '07' }), all), '');
  assert.equal(branchOfPurchase(bill('r', { branch_id: ho.id, place_of_supply: '29' }), all), ho.id);
});

test('filters and branch-wise summary', () => {
  const ho = branchesDb.save({ name: 'HO', profile_id: SELLER.id });
  const ka = branchesDb.save({ name: 'KA', state_code: '29' });
  const all = branchesDb.all();
  const invoices = [
    inv('a', {}),
    inv('b', { branch_id: ka.id, taxable_value: 2000 }),
    inv('c', { doc_type: 'CREDIT_NOTE', branch_id: ka.id, taxable_value: 300 }),
    inv('d', { status: 'Draft', branch_id: ka.id }),
    inv('e', { sender: { ...SELLER, id: 'x', companyGstin: '' } }),
  ];
  const purchases = [bill('p', { place_of_supply: '29' }), bill('q', { branch_id: ho.id })];
  const p = branchPredicates(ka.id, all);
  assert.deepEqual(invoices.filter(p.invoice).map((i) => i.id), ['b', 'c', 'd']);
  assert.deepEqual(purchases.filter(p.purchase).map((x) => x.id), ['p']);
  assert.deepEqual(filterByBranch(invoices, UNASSIGNED, (i) => branchOfInvoice(i, all)).map((i) => i.id), ['e']);
  assert.equal(filterByBranch(invoices, '', () => 'x').length, 5);
  const rows = branchSummary(all, invoices, purchases);
  const k = rows.find((r) => r.id === ka.id)!;
  assert.deepEqual([k.sales, k.returns, k.purchases, k.documents, k.bills], [2000, 300, 500, 1, 1]);
  assert.equal(rows.find((r) => r.id === '')?.sales, 1000, 'No branch row');
  assert.equal(rows.find((r) => r.id === ho.id)?.purchases, 500);
});

test('vouchers and purchases carry the branch tag', () => {
  const ka = branchesDb.save({ name: 'KA', state_code: '29' });
  const v = saveVoucher({ type: 'JOURNAL', date: '2026-05-10', narration: 'x', branch_id: ka.id, lines: [{ account_id: 'rent', dr: 100, cr: 0 }, { account_id: 'cash', dr: 0, cr: 100 }] });
  assert.equal(loadVouchers().find((x) => x.id === v.id)?.branch_id, ka.id);
  assert.equal(branchPredicates(ka.id).voucher(v), true);
  setTable('purchases', [bill('p', {})]);
  assert.equal(tagPurchases(['p'], ka.id), 1);
  assert.equal(getTable<PurchaseRecord>('purchases')[0].branch_id, ka.id);
});
