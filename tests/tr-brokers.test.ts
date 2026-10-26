/** TR-B3 brokers: each basis, memo rows, 194H threshold / catch-up / rate change, overlaps, undo; salesman opt-in. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { agentsDb, deleteCommissionPosting, postCommission, tds194h, type SalesAgent } from '../src/lib/sales-commission.ts';
import { brokerageCsv, brokerageStatement, docBrokerage, loadBrokeragePostings, loadBrokers } from '../src/lib/trade/tr-brokers.ts';
import { deleteBrokeragePosting, postBrokerage as post } from '../src/lib/trade/tr-brokers-post.ts';

const postBrokerage = (id: string, period: { from: string; to: string }, date: string) => {
  const b = loadBrokers().find((x) => x.id === id)!;
  return post(b, period, date, brokerageStatement(b, period, { invoices: getTable<InvoiceRecord>('invoices'), purchases: getTable('purchases') }));
};
import { loadManualDeductions } from '../src/lib/tds-payables.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import type { LineWeight } from '../src/types/trade-r8.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());
const wt: LineWeight = { packages: 120, kind: 'BAG', gross: 6072, tare_per_package: 0.6, deduction: { basis: 'per_qtl', value: 1 }, gross_unit: 'KG' };
const lines = [
  { name: 'Wheat', hsn: '1001', unit: 'QTL', quantity: 59.4, rate: 2450, wt },
  { name: 'Market fee', hsn: '1001', unit: 'OTH', quantity: 1, rate: 1455.3, charge_head_id: 'h' },
];
const sale = (id: string, date: string, broker: string, rate = 2450, status = 'Sent') =>
  ({ id, doc_type: 'INVOICE', status, invoice_number: id, issue_date: date, client: { name: 'Buyer' }, broker_id: broker, items: [{ ...lines[0], id: `${id}-1`, rate, type: 'Goods', amount: 0 }, { ...lines[1], id: `${id}-2`, type: 'Goods', amount: 0 }] }) as unknown as InvoiceRecord;
const broker = (p: Partial<SalesAgent>) => agentsDb.save({ id: '', name: 'Mehta Dalal', rate: 0, basis: 'invoice', kind: 'broker', brokerage_basis: 'percent', brokerage_rate: 1, pan: 'ABCPM1234D', ...p });

test('each basis on the goods lines only (charge lines are not brokered)', () => {
  assert.deepEqual(docBrokerage({ brokerage_basis: 'percent', brokerage_rate: 1 }, lines), { base: 145_530, brokerage: 1455.3 });
  assert.deepEqual(docBrokerage({ brokerage_basis: 'per_package', brokerage_rate: 2 }, lines), { base: 120, brokerage: 240 });
  assert.deepEqual(docBrokerage({ brokerage_basis: 'per_qtl', brokerage_rate: 5 }, lines), { base: 59.4, brokerage: 297 });
  assert.deepEqual(docBrokerage({ brokerage_basis: 'per_unit', brokerage_rate: 0.25 }, [{ name: 'Cloth', quantity: 1000, rate: 80, unit: 'MTR' }]), { base: 1000, brokerage: 250 });
});

test('statement: sales and goods bills of the broker; memo when the other party pays; brokers stay out of salesmen', () => {
  const b = broker({});
  const memo = broker({ name: 'Buyer’s dalal', paid_by: 'other_party' });
  assert.equal(loadBrokers().length, 2);
  const invoices = [sale('s1', '2026-10-02', b.id), sale('s2', '2026-10-03', memo.id), sale('s3', '2026-10-04', b.id, 2450, 'Draft')];
  const bill = { id: 'p1', kind: 'PURCHASE', vendor_name: 'Farmer', bill_number: 'F/1', date: '2026-10-05', category: 'Purchases', broker_id: b.id, lines: [{ id: 'x', name: 'Wheat', quantity: 10, rate: 2300, tax_rate: 0, unit: 'QTL' }], taxable: 23000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 23000, amount_paid: 0 };
  const st = brokerageStatement(b, { from: '2026-10-01', to: '2026-10-31' }, { invoices, purchases: [bill] });
  assert.deepEqual(st.lines.map((l) => [l.side, l.number, l.brokerage]), [['sale', 's1', 1455.3], ['purchase', 'F/1', 230]]);
  assert.equal(st.total, 1685.3);
  const m = brokerageStatement(memo, { from: '2026-10-01', to: '2026-10-31' }, { invoices, purchases: [] });
  assert.deepEqual([m.total, m.memoTotal], [0, 1455.3], 'memo rows are never posted');
  assert.match(brokerageCsv(memo, { from: '2026-10-01', to: '2026-10-31' }, m), /memo only/);
});

test('194H: none below ₹20,000 in the FY, then the whole FY amount (catch-up); 5% → 2% from 1 Oct 2024', () => {
  assert.equal(tds194h('2026-05-31', 12_000, 'ABCPM1234D', []).amount, 0);
  const crossed = tds194h('2026-06-30', 9_000, 'ABCPM1234D', [{ id: 'a', date: '2026-05-31', base: 12_000, tds: 0, code: '194H' }]);
  assert.deepEqual([crossed.base, crossed.rate, crossed.amount], [21_000, 2, 420]);
  assert.equal(tds194h('2024-09-30', 30_000, 'ABCPM1234D', []).rate, 5);
  assert.equal(tds194h('2024-10-01', 30_000, 'ABCPM1234D', []).rate, 2);
  assert.equal(tds194h('2026-06-30', 30_000, '', []).rate, 20, 'no PAN: Sec 206AA');
});

test('post: journal Dr Brokerage / Cr broker / Cr TDS 194H with a 26Q row; overlapping periods refused; undo deletes both', () => {
  const b = broker({ brokerage_basis: 'per_qtl', brokerage_rate: 200 });
  setTable('invoices', [sale('s1', '2026-05-10', b.id), sale('s2', '2026-06-10', b.id)]);
  const may = postBrokerage(b.id, { from: '2026-05-01', to: '2026-05-31' }, '2026-05-31');
  assert.deepEqual([may.amount, may.tds], [11_880, 0], 'below ₹20,000 in the FY');
  assert.throws(() => postBrokerage(b.id, { from: '2026-05-15', to: '2026-06-30' }, '2026-06-30'), /already posted/);
  const june = postBrokerage(b.id, { from: '2026-06-01', to: '2026-06-30' }, '2026-06-30');
  assert.deepEqual([june.tds, june.tds_rate], [475, 2], 'catch-up on ₹23,760 (2% = 475.20, rounded to the rupee)');
  const v = loadVouchers().find((x) => x.id === june.voucher_id)!;
  assert.equal(v.lines.reduce((t, l) => t + l.dr, 0), 1_188_000);
  assert.ok(v.lines.some((l) => l.account_id === 'tds_194h' && l.cr === 47_500));
  assert.equal(loadManualDeductions().length, 1);
  assert.equal(loadManualDeductions()[0].section, '194H');
  deleteBrokeragePosting(june.id);
  assert.equal(loadVouchers().some((x) => x.id === june.voucher_id), false);
  assert.equal(loadManualDeductions().length, 0);
  assert.equal(loadBrokeragePostings().length, 1);
  assert.equal(getTable<{ table?: string }>('recycle_bin').filter((r) => r.table === 'brokerage_postings').length, 1);
});

test('salesman commission: unchanged by default, 194H when ticked (§8 Q18)', () => {
  const a = agentsDb.save({ id: '', name: 'Ravi', rate: 20, basis: 'invoice', pan: 'ABCPR1234E' });
  setTable('invoices', [{ ...sale('s1', '2026-07-10', ''), agent_id: a.id }]);
  const plain = postCommission(a.id, { from: '2026-07-01', to: '2026-07-31' }, '2026-07-31');
  assert.equal(plain.tds, undefined);
  deleteCommissionPosting(plain.id);
  const withTds = postCommission(a.id, { from: '2026-07-01', to: '2026-07-31' }, '2026-07-31', { tds194h: true });
  assert.deepEqual([withTds.amount, withTds.tds], [29_397.06, 588]);
  assert.equal(loadVouchers().find((x) => x.id === withTds.voucher_id)!.lines.find((l) => l.account_id === 'tds_194h')?.cr, 58_800);
  assert.equal(loadManualDeductions().length, 1, 'the 194H row is in the TDS register');
  deleteCommissionPosting(withTds.id);
  assert.equal(loadManualDeductions().length, 0, 'undo removes it');
});
