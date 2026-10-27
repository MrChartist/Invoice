/**
 * QA round 17 — Round 14 (professional firms) cross-package seams. One test per finding of docs/prd/qa-round-17.md;
 * each fails on the baseline `ca0438f`.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { bankAccountsDb, pickableBankAccounts } from '../src/lib/bank-accounts.ts';
import { deleteVoucher, loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { computeRun } from '../src/lib/prof/ps-partner-run.ts';
import { postRun } from '../src/lib/prof/ps-partner-post.ts';
import { creditPartner } from '../src/lib/prof/ps-194t.ts';
import { loadPartners, savePartner } from '../src/lib/prof/ps-partners.ts';
import { feeBase } from '../src/lib/prof/ps-tds-recv.ts';
import { presumptive } from '../src/lib/prof/ps-presumptive.ts';
import { thresholdCard } from '../src/lib/prof/ps-threshold.ts';
import { refundSvcPaper } from '../src/lib/prof/ps-refund-svc.ts';
import { recoveryValue, PURE_AGENT_CHARGE } from '../src/lib/trade/pure-agent.ts';
import { exportCheck, verdict } from '../src/lib/prof/ps-export-check.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  setActorProvider(null);
});

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const twoPartners = () => {
  const t = (rate: number) => [{ from: '2025-04-01', share_pct: 50, remuneration: { mode: 'fixed' as const, amount: 100000 }, interest_pct: rate }];
  savePartner({ name: 'Asha', pan: 'AAAPA1234A', kind: 'working', joined: '2025-04-01', terms: t(15) });
  savePartner({ name: 'Bala', pan: 'AAAPB1234B', kind: 'working', joined: '2025-04-01', terms: t(12) });
  return loadPartners();
};

test('R1: a partner posting\'s journals cannot be deleted in Books while the run lives (no orphan run)', () => {
  const ps = twoPartners();
  const run = postRun(computeRun({ fy: 2025, partners: ps, netProfit: 900000, capital: Object.fromEntries(ps.map((p) => [p.id, 100000])) }));
  for (const id of run.voucher_ids) assert.throws(() => deleteVoucher(id), /Time → Firm/);
  const credit = creditPartner({ partnerId: ps[0].id, kind: 'remuneration', amount: 10000, date: '2026-05-31' });
  assert.throws(() => deleteVoucher(credit.voucher_ids[0]), /Time → Firm/);
  assert.equal(loadVouchers().length, run.voucher_ids.length + 1, 'nothing deleted');
  assert.equal(getTable('partner_runs').length, 2);
});

test('R2: interest above the 12 % cap is added back to book profit before the Sec 40(b) limit', () => {
  const ps = twoPartners();
  const r = computeRun({ fy: 2025, partners: ps, netProfit: 900000, capital: Object.fromEntries(ps.map((p) => [p.id, 1000000])) });
  assert.equal(r.interestTotal, 270000);
  assert.equal(r.interestDisallowed, 30000);
  assert.equal(r.bookProfit, 900000 - 270000 + 30000, 'book profit after the ALLOWABLE interest only');
  assert.equal(r.allowable, 540000 + 36000, '90 % of ₹6 lakh + 60 % of ₹60,000 (old: ₹558,000)');
});

/** A fee note: ₹10,000 fee with a 10 % line discount, plus ₹1,000 court fee recovered as pure agent (0 %). */
const feeNote = (date: string, extra: Partial<InvoiceRecord> = {}): InvoiceRecord => {
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date, lines: [{ name: 'Professional fees', hsn: '998213', qty: 1, rate: 10000, tax: 18 }, { name: 'Reimbursement — court fee', qty: 1, rate: 1000, tax: 0 }], status: 'Sent' });
  const items = inv.items.map((it, i) => (i === 0 ? { ...it, discount_percent: 10 } : { ...it, charge_head_id: 'rule33', description: PURE_AGENT_CHARGE }));
  return { ...inv, items, taxable_value: 10000, ...extra } as InvoiceRecord;
};

test('R3: pure-agent recoveries stay out of the 194J fee base, 44ADA receipts, the GST threshold and the Rule 89(4) turnover', () => {
  const inv = feeNote('2026-06-10');
  assert.equal(recoveryValue(inv), 1000);
  assert.equal(feeBase(inv), 9000, 'fee net of its own line discount (old: ₹9,090.91)');
  assert.equal(recoveryValue({ items: inv.items, discount_type: 'PERCENT', discount_rate: 10 }), 900, 'its share of an invoice discount');
  assert.equal(presumptive({ fy: 2026, invoices: [inv], receipts: [] }).accrual, 9000);
  assert.equal(thresholdCard([inv], '2026-10-01').turnover, 9000, 'a reimbursement is no supply (old: ₹10,000)');
  const exp = { ...feeNote('2026-07-05'), id: 'x1', supply_type: 'EXPORT_LUT', currency: 'INR', total: 10000 } as InvoiceRecord;
  const p = refundSvcPaper({ from: '2026-07-01', to: '2026-09-30', invoices: [exp, { ...inv, issue_date: '2026-07-10' }], payments: [{ id: 'p1', invoice_id: 'x1', amount: 10000, date: '2026-08-01', method: 'Bank Transfer' }], advances: [], netItc: { igst: 1000, cgst: 0, sgst: 0, cess: 0 } as never });
  assert.equal(p.zeroRated, 9000, 'the court-fee part of the receipt is no payment for the service');
  assert.equal(p.domestic, 9000);
});

test('R4: the office receipt of a to-fees client-money entry cannot be removed on its own', async () => {
  localDb.clients.upsert(clientMH);
  bankAccountsDb.save({ id: 'cm', name: 'Client account', active: true, client_money: true } as never);
  const { recordClientMoney } = await import('../src/lib/prof/ps-cm-post.ts');
  const mod = await import('../src/lib/prof/ps-client-money.ts');
  const base = { client_id: 'c-mh', bank_account_id: 'cm', purpose: 'expenses' as const, ref: 'r', narration: '' };
  recordClientMoney({ ...base, kind: 'receipt', date: '2026-10-01', amount: 50000 });
  const inv = createViaStore({ client: clientMH, docType: 'TAX_INVOICE', date: '2026-10-10', lines: [{ name: 'Fees', hsn: '998213', qty: 1, rate: 20000, tax: 0 }], status: 'Sent' });
  const tf = recordClientMoney({ ...base, kind: 'to_fees', date: '2026-10-12', amount: 20000, invoice_id: inv.id, authority: { date: '2026-10-11', mode: 'email', ref: 'mail' } });
  const guard = (mod as Record<string, unknown>).assertNotClientMoneyReceipt as ((id: string) => void) | undefined;
  assert.equal(typeof guard, 'function');
  assert.throws(() => guard!(tf.payment_id!), /Client money/);
  assert.doesNotThrow(() => guard!('other'));
  assert.match(src('src/components/modals/PaymentModal.tsx'), /assertNotClientMoneyReceipt\(id\)/, 'the payment dialog asks before removing');
});

test('R5: a marketplace payout never lands in a client-money account', () => {
  bankAccountsDb.save({ id: 'cm', name: 'Client account', active: true, client_money: true } as never);
  bankAccountsDb.save({ id: 'clr', name: 'Amazon clearing', active: true, clearing: true } as never);
  assert.deepEqual(pickableBankAccounts('payout').map((a) => a.id), ['default']);
  assert.doesNotMatch(src('src/components/marketplace/SettlementsPanel.tsx'), /pickableBankAccounts\('brs'\)/);
});

test('R6: a stage bill for an Indian property of a client abroad fails the Sec 2(6) check (13(4))', async () => {
  const { createStageBill, exampleStages } = await import('../src/lib/prof/ps-stages.ts');
  localDb.clients.upsert({ id: 'dxb', name: 'Mr A. Khan (Dubai)', email: '', address: 'Dubai', city: 'Dubai', zip: '', state_code: '96', country: 'AE' } as never);
  const e = { id: 'e1', number: 'ENG/FY26-27/0001', model: 'milestone', client_id: 'dxb', stage: { fee_pct: 6, cost_basis: 'estimate' as const, revisions: [{ date: '2026-04-01', cost: 42000000 }], stages: exampleStages(), property: { state: 'Karnataka', city: 'Bengaluru', country: 'India' } } };
  const bill = createStageBill(e, 's1', '2026-05-01');
  const c = exportCheck({ invoice: bill, client: localDb.clients.getById('dxb') as never });
  assert.equal(c.items.find((i) => i.id === 'pos')!.state, 'fail');
  assert.equal(verdict(c), 'not');
});

test('R7: the annual pack\'s partner-wise table foots (194T TDS and interest on drawings shown)', async () => {
  const { partnerStatements } = await import('../src/lib/prof/ps-partner-post.ts');
  const { buildAnnualPack } = await import('../src/lib/ledger/annual-pack.ts');
  const { loadLedger, loadStockValuer } = await import('../src/lib/ledger/index.ts');
  const ps = twoPartners();
  postRun(computeRun({ fy: 2025, partners: ps, netProfit: 900000, capital: Object.fromEntries(ps.map((p) => [p.id, 100000])) }));
  const p = (x: number) => Math.round(x * 100);
  const rows = partnerStatements(2025).map((r) => ({ name: r.name, opening: p(r.opening), introduced: p(r.introduced), drawings: p(r.drawings), interest: p(r.interest), remuneration: p(r.remuneration), share: p(r.share), closing: p(r.closing) }));
  const pack = buildAnnualPack({ ledger: loadLedger(), stock: loadStockValuer(), fyStartYear: 2025, assets: [], vendors: [], invoices: [], company: { name: 'A & B' }, entity: 'partnership', generatedOn: '2026-04-30', partnerRows: rows });
  const t = pack.notes.find((n) => n.id === 'capital')!.tables.find((x) => /Partner-wise/.test(x.title ?? ''))!;
  for (const r of t.rows) {
    const [, open, intro, draw, int, rem, share, other, close] = r as number[];
    assert.equal(open + intro - draw + int + rem + share + other, close, String(r[0]));
  }
  assert.ok(t.rows.some((r) => (r[7] as number) < 0), 'the TDS deducted shows');
});
