/**
 * WP-7 P0-12 / P1-22: the Tally export carries the rest of the books — supplier payments (with TDS
 * on payment) and advances, manual Journal / Contra / Payment / Receipt vouchers with cost centres
 * and reversals, fixed-asset and depreciation journals, stock transfers as Stock Journal, user group /
 * cost-centre / godown masters and ledger opening balances with bill-wise opening bills.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTallyModel, generateTallyExport, voucherImbalance, type TallyVoucher } from '../src/lib/tally-xml.ts';
import { chartOf, A, type Account } from '../src/lib/ledger/accounts.ts';
import type { ManualVoucher } from '../src/lib/ledger/vouchers.ts';
import type { TallyBooksSource } from '../src/lib/tally-books.ts';
import type { ExportSource } from '../src/lib/export-shared.ts';
import { PURCHASE, fullSource } from './export-fixtures.ts';

const OPTS = { companyName: 'Demo Co' };
const user: Account[] = [{ id: 'acc-st', code: 'X1', name: 'Stationery', group: 'INDIRECT_EXPENSES', under: 'g-office' }];

function mv(over: Partial<ManualVoucher>): ManualVoucher {
  return { id: 'v', type: 'JOURNAL', number: 'JV/FY25-26/0001', date: '2025-05-31', narration: '', lines: [], created_at: '2025-05-31T00:00:00Z', ...over };
}

function books(): TallyBooksSource {
  return {
    today: '2026-04-15',
    chart: chartOf(user),
    userGroups: [{ id: 'g-office', name: 'Office Expenses', parent: 'INDIRECT_EXPENSES' }, { id: 'g-sub', name: 'Printing', parent: 'g-office' }],
    purchasePayments: [
      { id: 'pp1', purchase_id: 'pb-1', amount: 1000, date: '2025-05-10', method: 'NEFT', reference: 'UTR1' },
      { id: 'pp2', purchase_id: 'pb-1', amount: 1300, tds_amount: 60, date: '2025-05-20', method: 'Cash' },
      { id: 'pp3', purchase_id: 'missing', amount: 50, date: '2025-05-21', method: 'Cash' },
    ],
    vendorPayments: [{ id: 'vp123456789', vendor_name: 'Supplies & Co', date: '2025-06-01', amount: 500, method: 'UPI', kind: 'ADVANCE', reference: 'ADV-9' }],
    costCentres: [{ id: 'cc1', name: 'Pune Branch', kind: 'branch', active: true, created_at: '' }],
    manualVouchers: [
      mv({ id: 'j1', narration: 'Stationery accrued', reverse_on: '2025-06-01', lines: [{ account_id: 'acc-st', dr: 25000, cr: 0, cost_centre_id: 'cc1' }, { account_id: A.provisions, dr: 0, cr: 25000 }] }),
      mv({ id: 'c1', type: 'CONTRA', number: 'CV/FY25-26/0001', date: '2025-05-15', lines: [{ account_id: A.bank, dr: 100000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 100000 }] }),
      mv({ id: 'p1', type: 'PAYMENT', number: 'PV/FY25-26/0001', date: '2025-05-16', lines: [{ account_id: A.creditors, dr: 70000, cr: 0, party: 'Supplies & Co' }, { account_id: A.bank, dr: 0, cr: 70000 }] }),
      mv({ id: 'o1', number: 'JV/FY25-26/0002', variant: 'OPTIONAL', lines: [{ account_id: A.rent, dr: 1, cr: 0 }, { account_id: A.cash, dr: 0, cr: 1 }] }),
    ],
    fixedAssets: [{ id: 'fa1aaaaaaaa', name: 'Laptop', block: 'COMPUTER', account_id: A.faComputers, cost: 60000, acquired_on: '2025-05-05', put_to_use: '2025-05-05', paid_from: A.bank, created_at: '' }],
    stockItems: [{ id: 'i1', name: 'Widget', unit: 'nos' }],
    godowns: [{ id: 'g2', name: 'Warehouse 2' }],
    stockTransfers: [{ id: 't1', transfer_number: 'STR/FY25-26/0001', date: '2025-05-25', from_godown: 'main', to_godown: 'g2', lines: [{ id: 'l1', item_id: 'i1', qty: 5 }] }],
    openings: [
      { id: 'o1', ledger_id: A.capital, dr: 0, cr: 50000000 },
      { id: 'o2', ledger_id: 'party:debtor:c1', dr: 3000000, cr: 0 },
      { id: 'o3', ledger_id: A.bank, dr: 47000000, cr: 0 },
    ],
    openingBills: [{ id: 'b1', party_id: 'c1', party_name: 'Acme', side: 'receivable', ref_no: 'OLD-1', date: '2025-03-10', amount: 30000, dr_cr: 'Dr' }],
  };
}

function source(): ExportSource {
  return { ...fullSource(), books: books(), clients: [{ id: 'c1', name: 'Acme', email: '', address: '', city: '', zip: '' }] };
}

const find = (vs: TallyVoucher[], type: string, number: string) => vs.find((v) => v.type === type && v.number === number)!;

test('every books voucher is balanced and typed as Tally expects', () => {
  const b = buildTallyModel(source(), { ...OPTS, range: { from: '2025-04-01', to: '2026-03-31' } });
  for (const v of b.vouchers) assert.equal(voucherImbalance(v), 0, `${v.type} ${v.number}`);
  const types = b.vouchers.map((v) => `${v.type}:${v.number}`);
  for (const t of ['Payment:B-1/P1', 'Payment:B-1/P2', 'Payment:VP/vp123456', 'Journal:JV/FY25-26/0001', 'Journal:JV/FY25-26/0001-R', 'Contra:CV/FY25-26/0001', 'Payment:PV/FY25-26/0001', 'Journal:FA/fa1aaaaa', 'Journal:DEP/2026', 'Stock Journal:STR/FY25-26/0001']) {
    assert.ok(types.includes(t), `missing ${t} in ${types.join(', ')}`);
  }
  assert.ok(!types.includes('Journal:JV/FY25-26/0002'), 'optional vouchers are not in the books');
  assert.ok(b.warnings.some((w) => /its bill is missing/.test(w)));
});

test('supplier payment: Dr supplier Agst Ref the bill, Cr bank / cash, TDS on payment to its own ledger', () => {
  const b = buildTallyModel(source(), OPTS);
  const p1 = find(b.vouchers, 'Payment', 'B-1/P1');
  assert.deepEqual(p1.entries.map((e) => [e.ledger, e.side, e.paise, e.bill?.type ?? '']), [['Supplies & Co', 'Dr', 100000, 'Agst Ref'], ['Bank Account', 'Cr', 100000, '']]);
  const p2 = find(b.vouchers, 'Payment', 'B-1/P2');
  assert.deepEqual(p2.entries.map((e) => [e.ledger, e.side, e.paise]), [['Supplies & Co', 'Dr', 136000], ['Cash', 'Cr', 130000], ['TDS Payable', 'Cr', 6000]]);
  const adv = find(b.vouchers, 'Payment', 'VP/vp123456');
  assert.equal(adv.entries[0].bill?.type, 'Advance');
  assert.equal(PURCHASE.bill_number, 'B-1');
});

test('manual vouchers keep our number / narration; cost centre, sub-group parent and party ledgers', () => {
  const ex = generateTallyExport(source(), OPTS);
  const j = find(ex.build.vouchers, 'Journal', 'JV/FY25-26/0001');
  assert.equal(j.narration, 'Stationery accrued');
  assert.deepEqual(j.entries[0], { ledger: 'Stationery', side: 'Dr', paise: 25000, costCentres: [{ name: 'Pune Branch', paise: 25000 }] });
  assert.equal(j.entries[1].ledger, 'Provisions & expenses payable');
  const rev = find(ex.build.vouchers, 'Journal', 'JV/FY25-26/0001-R');
  assert.equal(rev.date, '2025-06-01');
  assert.equal(rev.entries[0].side, 'Cr');
  const pv = find(ex.build.vouchers, 'Payment', 'PV/FY25-26/0001');
  assert.equal(pv.entries[0].ledger, 'Supplies & Co');
  const st = ex.build.ledgers.find((l) => l.name === 'Stationery')!;
  assert.equal(st.parent, 'Office Expenses');
  assert.equal(st.costCentres, true);
  assert.match(ex.vouchersXml, /<VOUCHER VCHTYPE="Journal"/);
  assert.match(ex.vouchersXml, /<CATEGORYALLOCATIONS\.LIST>[\s\S]*?<NAME>Pune Branch<\/NAME>\s*<AMOUNT>-250\.00<\/AMOUNT>/);
  assert.match(ex.vouchersXml, /<VOUCHER VCHTYPE="Contra"/);
  assert.equal(ex.counts.journals! >= 4, true);
  assert.equal(ex.counts.contras, 1);
  assert.equal(ex.counts.stockJournals, 1);
});

test('masters: groups parents first, cost centres, godowns, opening balances with bill-wise openings', () => {
  const ex = generateTallyExport(source(), OPTS);
  const m = ex.mastersXml;
  const office = m.indexOf('<GROUP NAME="Office Expenses"');
  const printing = m.indexOf('<GROUP NAME="Printing"');
  assert.ok(office > 0 && printing > office, 'parent group before its sub-group');
  assert.match(m, /<GROUP NAME="Office Expenses" ACTION="Create">\s*<PARENT>Indirect Expenses<\/PARENT>/);
  assert.match(m, /<GROUP NAME="Printing" ACTION="Create">\s*<PARENT>Office Expenses<\/PARENT>/);
  assert.match(m, /<COSTCENTRE NAME="Pune Branch"/);
  assert.match(m, /<GODOWN NAME="Warehouse 2"/);
  assert.match(m, /<LEDGER NAME="Capital account" ACTION="Create">\s*<PARENT>Capital Account<\/PARENT>[\s\S]*?<OPENINGBALANCE>500000\.00<\/OPENINGBALANCE>/);
  assert.match(m, /<LEDGER NAME="Bank Account"[\s\S]*?<OPENINGBALANCE>-470000\.00<\/OPENINGBALANCE>/, 'a debit opening is negative in Tally');
  assert.match(m, /<LEDGER NAME="Acme"[\s\S]*?<OPENINGBALANCE>-30000\.00<\/OPENINGBALANCE>\s*<BILLALLOCATIONS\.LIST>\s*<NAME>OLD-1<\/NAME>\s*<BILLDATE>20250310<\/BILLDATE>/);
});

test('stock transfer → Stock Journal out of one godown into the other', () => {
  const ex = generateTallyExport(source(), OPTS);
  const xml = ex.vouchersXml;
  assert.match(xml, /<VOUCHER VCHTYPE="Stock Journal"[\s\S]*?<INVENTORYENTRIESOUT\.LIST>[\s\S]*?<STOCKITEMNAME>Widget<\/STOCKITEMNAME>[\s\S]*?<GODOWNNAME>Main Location<\/GODOWNNAME>[\s\S]*?<INVENTORYENTRIESIN\.LIST>[\s\S]*?<GODOWNNAME>Warehouse 2<\/GODOWNNAME>/);
  assert.match(xml, /<ACTUALQTY>5 NOS<\/ACTUALQTY>/);
});

test('a receipt row allocated by a manual receipt voucher (P0-11) is exported once, with the voucher', () => {
  const src = fullSource();
  const inv = src.invoices.find((i) => i.doc_type !== 'CREDIT_NOTE' && i.status !== 'Draft')!;
  const row = { id: 'tx-v', invoice_id: inv.id, amount: 10, date: '2025-05-30', method: 'NEFT', voucher_id: 'rv1' };
  const rv = mv({ id: 'rv1', type: 'RECEIPT', number: 'RV/FY25-26/0001', date: '2025-05-30', lines: [{ account_id: A.bank, dr: 1000, cr: 0 }, { account_id: A.debtors, dr: 0, cr: 1000, party: 'Acme' }] });
  const b = buildTallyModel({ ...src, payments: [...src.payments, row as never], books: { manualVouchers: [rv], chart: chartOf(), today: '2026-01-01' } }, OPTS);
  assert.equal(b.vouchers.filter((v) => v.type === 'Receipt' && v.date === '2025-05-30').length, 1);
  assert.ok(b.vouchers.some((v) => v.number === 'RV/FY25-26/0001'));
});

test('a source without books is unchanged (old exports stay byte-identical)', () => {
  const plain = generateTallyExport(fullSource(), OPTS);
  const withEmpty = generateTallyExport({ ...fullSource(), books: {} }, OPTS);
  assert.equal(withEmpty.vouchersXml, plain.vouchersXml);
  assert.equal(withEmpty.mastersXml, plain.mastersXml);
});
