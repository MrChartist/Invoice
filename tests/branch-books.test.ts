/**
 * Branch-wise books (WP-9 × WP-2, P1-19): the reports engine's `{ branchId }` option, the Gateway
 * Display branch filter and Schedule III head drill, and the Sec 25(4) inter-branch transfer pair.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientKA, gstin, SELLER } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { UNASSIGNED, branchesDb, type Branch } from '../src/lib/branch.ts';
import { localDb } from '../src/lib/localDb.ts';
import { purchasesDb, paymentsDb } from '../src/lib/purchases.ts';
import { godownsDb } from '../src/lib/godowns.ts';
import {
  A,
  buildLedger,
  groupSummary,
  ledgerBalanceSheet,
  ledgerDayBook,
  ledgerProfitAndLoss,
  loadLedgerInput,
  saveVoucher,
  scopeLedger,
  trialBalance,
  voucherRegister,
  type Ledger,
} from '../src/lib/ledger/index.ts';
import { buildFrame } from '../src/lib/gateway/drill.ts';
import { branchOfGodown, buildTransferPair, raiseTransferPair, transferInvoiceOf, transferTaxPair } from '../src/lib/branch-transfer.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { StockTransfer } from '../src/types/stock.ts';

const PERIOD = { start: '2026-04-01', end: '2027-03-31' };
let mh: Branch;
let ka: Branch;

const bill = (extra: Partial<PurchaseRecord>): PurchaseRecord =>
  purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Paper Mart', bill_number: `B-${Math.random()}`, date: '2026-05-12', category: 'Purchases',
    lines: [{ id: 'l', name: 'Paper', quantity: 1, rate: 1000, tax_rate: 18 }], taxable: 1000, cgst: 90, sgst: 90, igst: 0,
    itc_eligible: true, total: 1180, amount_paid: 0, place_of_supply: '27', ...extra,
  });

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
  mh = branchesDb.save({ name: 'Mumbai HO', profile_id: SELLER.id, gstin: SELLER.companyGstin });
  ka = branchesDb.save({ name: 'Bengaluru', gstin: gstin('29AABCU9603R1Z') });

  // Sales: Mumbai (inferred from the sender profile), Bengaluru (tagged), and one with no branch.
  const a = createViaStore({ date: '2026-05-01', lines: [{ qty: 1, rate: 10000 }] });
  const b = createViaStore({ date: '2026-05-02', client: clientKA, lines: [{ qty: 2, rate: 5000 }], patch: { branch_id: ka.id } });
  createViaStore({ date: '2026-05-03', lines: [{ qty: 1, rate: 700 }], patch: { branch_id: 'gone' } }); // unknown branch tag
  localDb.payments.record({ invoiceId: a.id, amount: 5000, method: 'Cash', date: '2026-05-10' });
  localDb.payments.record({ invoiceId: b.id, amount: 11800, method: 'Bank Transfer', date: '2026-05-11' });
  // Purchases: inferred Mumbai (only branch in state 27), tagged Bengaluru, and a state with no branch.
  const p1 = bill({});
  bill({ branch_id: ka.id, place_of_supply: '29', cgst: 0, sgst: 0, igst: 180 });
  bill({ place_of_supply: '07', cgst: 0, sgst: 0, igst: 180 });
  paymentsDb.record(p1.id, { amount: 1180, date: '2026-05-20', method: 'Bank Transfer' });
  // Manual vouchers: rent at Bengaluru, office expense with no branch.
  saveVoucher({ type: 'PAYMENT', date: '2026-06-01', narration: 'Rent', branch_id: ka.id, lines: [{ account_id: A.rent, dr: 2000000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 2000000 }] });
  saveVoucher({ type: 'PAYMENT', date: '2026-06-02', narration: 'Misc', lines: [{ account_id: A.otherExp, dr: 50000, cr: 0 }, { account_id: A.cash, dr: 0, cr: 50000 }] });
});

const ledger = (): Ledger => buildLedger(loadLedgerInput(undefined, '2026-10-01'));
const scopes = () => [mh.id, ka.id, UNASSIGNED];

test('branch trial balances each balance and add up to the company trial balance', () => {
  const l = ledger();
  assert.ok(l.voucherBranch && l.voucherBranch.size > 0, 'the ledger records voucher branches');
  const company = trialBalance(l, PERIOD);
  const parts = scopes().map((b) => trialBalance(l, PERIOD, { branchId: b }));
  for (const tb of parts) assert.equal(tb.totals.debit, tb.totals.credit, 'each branch TB balances');
  assert.equal(parts.reduce((s, t) => s + t.totals.debit, 0), company.totals.debit, 'debits add up');
  assert.equal(parts.reduce((s, t) => s + t.totals.credit, 0), company.totals.credit, 'credits add up');
  // Per account closing balances add up too.
  for (const row of company.rows) {
    const sum = parts.reduce((s, t) => s + (t.rows.find((r) => r.account.id === row.account.id)?.closing ?? 0), 0);
    assert.equal(sum, row.closing, `closing of ${row.account.name}`);
  }
  // Every branch saw something; vouchers are never in two branches.
  const counts = scopes().map((b) => scopeLedger(l, { branchId: b }).vouchers.length);
  assert.ok(counts.every((n) => n > 0));
  assert.equal(counts.reduce((s, n) => s + n, 0), l.vouchers.length);
});

test('documents, receipts, bills, supplier payments and vouchers follow their branch', () => {
  const l = ledger();
  const kinds = (b: string) => scopeLedger(l, { branchId: b }).vouchers.map((v) => `${v.kind}:${v.number}`).sort();
  const k = kinds(ka.id);
  assert.equal(k.filter((x) => x.startsWith('Sales')).length, 1);
  assert.equal(k.filter((x) => x.startsWith('Receipt')).length, 1, 'the receipt follows its invoice');
  assert.equal(k.filter((x) => x.startsWith('Purchase')).length, 1);
  assert.equal(k.filter((x) => x.startsWith('Payment')).length, 1, 'the rent voucher');
  const m = kinds(mh.id);
  assert.equal(m.filter((x) => x.startsWith('Sales')).length, 1, 'inferred from the sender profile');
  assert.equal(m.filter((x) => x.startsWith('Payment')).length, 1, 'the supplier payment follows its bill');
  const none = kinds(UNASSIGNED);
  assert.equal(none.filter((x) => x.startsWith('Sales')).length, 1, 'unknown branch tag → no matching branch');
  assert.equal(none.filter((x) => x.startsWith('Purchase')).length, 1, 'no branch in that state');

  const pnl = scopes().map((b) => ledgerProfitAndLoss(l, PERIOD, undefined, { branchId: b }).netProfit);
  assert.equal(pnl.reduce((s, n) => s + n, 0), ledgerProfitAndLoss(l, PERIOD).netProfit, 'branch profits add up');
  assert.equal(ledgerProfitAndLoss(l, PERIOD, undefined, { branchId: ka.id }).netProfit, 1000000 - 100000 - 2000000, 'Bengaluru: sales 10,000 − paper 1,000 − rent 20,000');
  const bs = ledgerBalanceSheet(l, PERIOD.end, undefined, { branchId: ka.id });
  assert.equal(bs.difference, 0, 'a branch balance sheet ties');
  // Group summary, day book and registers take the same option.
  assert.equal(groupSummary(l, PERIOD, null, { branchId: ka.id }).rows.reduce((s, r) => s + r.debit, 0), trialBalance(l, PERIOD, { branchId: ka.id }).totals.debit);
  assert.equal(ledgerDayBook(l, PERIOD, undefined, { branchId: ka.id }).entries.length, scopeLedger(l, { branchId: ka.id }).vouchers.length);
  assert.equal(voucherRegister(l, 'sales', PERIOD, { branchId: ka.id }).count, 1);
  assert.equal(scopeLedger(l, {}), l, 'no scope → the same ledger');
});

test('Gateway Display: branch filter and Schedule III heads drill to party advances', () => {
  const l = ledger();
  const company = buildFrame(l, 'tb', [], PERIOD, '2026-10-01')!;
  const branch = buildFrame(l, 'tb', [], PERIOD, '2026-10-01', { branchId: ka.id })!;
  assert.notDeepEqual(branch.total, company.total);
  assert.equal(branch.total![0], branch.total![1], 'the branch group trial balance balances');
  const ledgers = buildFrame(l, 'ledgers', [], PERIOD, '2026-10-01', { branchId: ka.id })!;
  assert.equal(ledgers.total![1], trialBalance(l, PERIOD, { branchId: ka.id }).totals.debit, 'ledgers screen = branch TB movement');
  // An advance paid to a supplier (payment with no bill) sits under short-term advances, as in Books.
  saveVoucher({ type: 'PAYMENT', date: '2026-07-01', narration: 'Advance', lines: [{ account_id: A.creditors, party: 'Steel Co', dr: 300000, cr: 0 }, { account_id: A.bank, dr: 0, cr: 300000 }] });
  const l2 = ledger();
  const head = buildFrame(l2, 'bs', [{ t: 'g', v: 'LOANS_ADV_ST' }], PERIOD, '2026-10-01')!;
  const adv = head.rows.find((r) => String(r.label).includes('Steel Co'))!;
  assert.equal(adv.cells[0], 300000);
  assert.deepEqual(adv.drillTo, [{ t: 'a', v: A.creditors }, { t: 'p', v: 'Steel Co' }]);
  const books = ledgerBalanceSheet(l2, '2026-10-01').assets.flatMap((s) => s.items).find((i) => i.groupId === 'LOANS_ADV_ST')!;
  assert.equal(head.total![0], books.amount, 'same total as the Books line');
  // The party line drills straight into that party's monthly summary.
  const monthly = buildFrame(l2, 'bs', [{ t: 'g', v: 'LOANS_ADV_ST' }, ...adv.drillTo!], PERIOD, '2026-10-01')!;
  assert.equal(monthly.total![2], 300000);
});

test('Sec 25(4): a transfer between two GSTINs raises a tax invoice + bill that net out', () => {
  const gMh = godownsDb.save({ name: 'Bhiwandi' });
  const gKa = godownsDb.save({ name: 'Hosur' });
  const room = godownsDb.save({ name: 'Hosur cold room', parent_id: gKa.id });
  mh = branchesDb.save({ ...mh, godown_id: gMh.id });
  ka = branchesDb.save({ ...ka, godown_id: gKa.id });
  const branches = branchesDb.all();
  const godowns = godownsDb.list();
  assert.equal(branchOfGodown(room.id, branches, godowns)?.id, ka.id, 'a sub-godown belongs to its parent’s branch');
  const t: StockTransfer = { id: 'str1', transfer_number: 'STR/FY26-27/0001', date: '2026-08-01', from_godown: gMh.id, to_godown: room.id, lines: [{ id: 'tl1', item_id: 'it1', qty: 10 }] };
  assert.deepEqual(transferTaxPair(t, branches, godowns)?.to.id, ka.id);
  assert.equal(transferTaxPair({ ...t, to_godown: gMh.id }, branches, godowns), null, 'same branch');
  assert.equal(transferTaxPair({ ...t, to_godown: 'main' }, branches, godowns), null, 'godown without a branch');

  const items = [{ id: 'it1', name: 'Widget', hsn: '8471', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, tax_rate: 18 }];
  const pure = buildTransferPair({ transfer: t, from: mh, to: ka, items, rates: { tl1: 100 }, settings: localDb.settings.get(), profile: SELLER, invoiceId: 'i', invoiceNumber: 'X', billId: 'b', newId: () => 'n' });
  assert.equal(pure.invoice.gst_mode, 'IGST');
  assert.equal(pure.invoice.igst_amount, 180);
  assert.equal(pure.invoice.place_of_supply, '29');
  assert.equal(pure.invoice.client.gstin, ka.gstin);
  assert.equal(pure.invoice.sender?.companyGstin, mh.gstin);
  assert.match(pure.invoice.notes, /verify with your CA/);
  assert.match(pure.invoice.items[0].name, /branch transfer STR/, 'lines never match a stock item a second time');
  assert.equal(pure.bill.igst, 180);
  assert.equal(pure.bill.branch_id, ka.id);

  const { invoice, bill: b } = raiseTransferPair(t, { tl1: 100 });
  assert.equal(invoice.branch_transfer_id, 'str1');
  assert.equal(b.bill_number, invoice.invoice_number);
  assert.equal(transferInvoiceOf('str1', localDb.invoices.getAll())?.id, invoice.id);
  assert.throws(() => raiseTransferPair(t, { tl1: 100 }), /already raised/);

  const l = ledger();
  const tb = trialBalance(l, PERIOD);
  const bal = (id: string) => tb.rows.find((r) => r.account.id === id)?.closing ?? 0;
  assert.equal(bal(A.branchTransferOut), -100000, 'outward ₹1,000 credit');
  assert.equal(bal(A.branchTransferIn), 100000, 'inward ₹1,000 debit');
  // Each side lands in its own branch.
  assert.equal(trialBalance(l, PERIOD, { branchId: mh.id }).rows.find((r) => r.account.id === A.branchTransferOut)?.credit, 100000);
  assert.equal(trialBalance(l, PERIOD, { branchId: ka.id }).rows.find((r) => r.account.id === A.branchTransferIn)?.debit, 100000);
});
