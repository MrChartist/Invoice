/**
 * QA round 6 F4 (QA6-1): receipt rows that moved no money — gift-voucher redemptions, deposit adjustments, RA
 * deduction rows, bad-debt write-offs and advance adjustments — are never bank / cash money. One predicate
 * (`movedNoCash`, `src/lib/no-cash.ts`) decides it for every cash / bank reader; the static guard at the end keeps new
 * readers on it.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { giftVouchersDb, redeemOnInvoice } from '../src/lib/retail/gift-vouchers.ts';
import { movedNoCash } from '../src/lib/no-cash.ts';
import { todaySummary } from '../src/lib/today.ts';
import { receiptCandidates } from '../src/lib/bank-recon.ts';
import { paymentModes } from '../src/lib/sales-reports.ts';
import { buildTallyModel, buildTallyVouchersXml } from '../src/lib/tally-xml.ts';
import { receipts as receiptsCsv } from '../src/lib/accounting-export.ts';
import { collectionLags } from '../src/lib/cash-forecast.ts';
import { zReport } from '../src/lib/pos.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { recordDeductionRow } from '../src/lib/works/ra-receivable.ts';
import { adjustAgainstInvoice, recordDeposit } from '../src/lib/property/deposits.ts';
import type { Payment } from '../src/types/invoice.ts';

const DAY = '2026-07-20';
const FY = { start: '2026-04-01', end: '2027-03-31' };
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

test('movedNoCash: every no-cash marker, and nothing else', () => {
  assert.equal(movedNoCash({}), false);
  assert.equal(movedNoCash(null), false);
  for (const k of ['gift_voucher_id', 'deposit_adjustment_id', 'ra_journal_id', 'advance_id']) assert.equal(movedNoCash({ [k]: 'x' }), true, k);
  assert.equal(movedNoCash({ write_off: true }), true);
  assert.equal(movedNoCash({ gift_voucher_id: '' }), false);
});

function gvPaidBill() {
  const [gv] = giftVouchersDb.sell({ count: 1, face_value: 1000, issued_on: DAY, method: 'Cash' }).vouchers;
  const a = createViaStore({ date: DAY, lines: [{ qty: 1, rate: 1000, tax: 0 }], status: 'Sent' });
  redeemOnInvoice({ invoiceId: a.id, code: gv.code, amount: 1000, date: DAY });
  return { gv, a };
}

const tallyReceipts = () => {
  const src = { invoices: localDb.invoices.getAll(), payments: getTable<Payment>('transactions'), clients: localDb.clients.getAll(), items: [], purchases: [], vendors: [] };
  const xml = buildTallyVouchersXml(buildTallyModel(src as never, { companyName: 'X', includeReceipts: true } as never), { companyName: 'X', includeReceipts: true } as never);
  return [...xml.matchAll(/<VOUCHER [^>]*VCHTYPE="Receipt"[\s\S]*?<\/VOUCHER>/g)].map((m) => m[0]);
};
const debitLedgers = (xml: string) => [...xml.matchAll(/<LEDGERNAME>([^<]*)<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes/g)].map((m) => m[1]);

test('F4: a gift-voucher redemption is not bank money — Today, BRS candidates, payment modes, Tally, receipts CSV, collection lag, Z report', () => {
  const { a } = gvPaidBill();
  const pays = getTable<Payment>('transactions');
  const invs = localDb.invoices.getAll();
  const t = todaySummary({ invoices: invs, payments: pays, purchases: [] }, DAY);
  assert.deepEqual([t.cash, t.upi, t.bank], [0, 0, 0], 'Today card');
  assert.equal(receiptCandidates(invs, pays).length, 0, 'BRS candidates');
  assert.equal(paymentModes(pays, invs, FY).count, 0, 'payment modes');
  const r = tallyReceipts();
  assert.equal(r.length, 1);
  assert.deepEqual(debitLedgers(r[0]), ['Gift vouchers outstanding'], 'Tally: Dr the voucher liability, not the bank');
  const csv = receiptsCsv({ invoices: invs, payments: pays, clients: [], items: [], purchases: [], vendors: [] } as never);
  assert.equal(csv.rows.length, 1);
  assert.equal(String(csv.rows[0][5]), 'Gift vouchers outstanding', 'CSV: Deposit To is the voucher liability');
  assert.equal(collectionLags(invs, pays).size, 0, 'not a collection');
  const z = zReport(DAY, invs.map((i) => (i.id === a.id ? { ...i, pos: true } : i)) as never, pays);
  assert.equal(z.received, 0);
  assert.equal(z.giftVouchers, 1000);
});

test('F4: RA deduction rows and a deposit adjustment are not bank money in Tally, the receipts CSV or the collection lag', () => {
  const boq = setupWorks();
  freezeDate('2026-07-25T10:00:00');
  saveBoqTerms(boq.id, { deductions: [{ kind: 'gst_tds' }, { kind: 'labour_cess' }], dlp_months: 12 } as never);
  const ra = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  localDb.payments.record({ invoiceId: ra.id, amount: 1000, method: 'Bank transfer', date: '2026-07-20' });
  recordDeductionRow(ra.id, 'gst_tds', { date: '2026-07-20' });
  recordDeductionRow(ra.id, 'labour_cess', { date: '2026-07-20' });
  const dep = recordDeposit({ direction: 'received', party_id: '', party_name: 'PWD Division 3', amount: 3000, date: '2026-07-01', mode: 'bank' });
  const rent = localDb.invoices.save({ ...ra, id: '', invoice_number: '', doc_type: 'INVOICE', items: [{ id: 'y', name: 'Rent', type: 'Service', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }], ra_deductions: undefined, ra_no: undefined, boq_id: undefined, progress_of: undefined, tds_enabled: false, tds_amount: 0, issue_date: '2026-07-20', amount_paid: 0 } as never);
  adjustAgainstInvoice(dep.id, rent.id, 1000, '2026-07-21');
  const pays = getTable<Payment>('transactions');
  const invs = localDb.invoices.getAll();
  assert.equal(pays.filter((p) => movedNoCash(p)).length, 3);
  const csv = receiptsCsv({ invoices: invs, payments: pays, clients: [], items: [], purchases: [], vendors: [] } as never);
  const depositTo = csv.rows.map((r) => `${r[4]}→${r[5]}`).sort();
  assert.deepEqual(depositTo, ['Bank transfer→Bank', 'GST TDS (Sec 51)→RA deductions clearing', 'Labour cess deducted→RA deductions clearing', 'Security deposit adjustment→Security deposits received'].sort());
  for (const r of tallyReceipts()) {
    if (/Bank transfer/.test(r)) continue;
    assert.ok(!debitLedgers(r).includes('Bank Account'), `Tally receipt does not debit the bank: ${debitLedgers(r).join(',')}`);
  }
  const lags = [...collectionLags(invs, pays).values()];
  assert.equal(lags.reduce((s, l) => s + l.receipts, 0), 1, 'only the bank receipt is a collection');
});

/* ── Guard: every cash / bank reader of receipt rows goes through movedNoCash ── */

const SRC = join(import.meta.dirname, '..', 'src');
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
});
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/');

/** Readers that turn receipt rows into cash / bank figures (QA6-1 F4 list). Add a new reader here. */
const CASH_READERS = [
  'lib/books.ts', 'lib/today.ts', 'lib/bank-recon.ts', 'lib/sales-reports.ts', 'lib/tally-xml.ts', 'lib/accounting-export.ts',
  'lib/cash-forecast.ts', 'lib/pos.ts', 'lib/forex-bank.ts',
];
/** Modules that WRITE a marker or post it to its own ledger: they may name the fields directly. */
const MARKER_OWNERS = new Set([
  'lib/no-cash.ts', 'lib/ledger/postings.ts', 'lib/retail/gift-voucher-core.ts', 'lib/retail/gift-vouchers.ts', 'lib/pos.ts',
  'lib/works/ra-receivable.ts', 'lib/property/deposits.ts', 'lib/trust/recycle-bin.ts', 'lib/localDb.ts',
  // Realisation of an export bill: an advance adjustment DOES realise it, so this reader keeps its own list.
  'lib/trade/export-register.ts',
  // Settlement payout matching reads only its clearing account's rows.
  'lib/marketplace/settlement-post.ts',
  'lib/trust/open-export-schema.ts', 'pages/Pos.tsx', 'components/modals/PaymentModal.tsx',
]);

test('guard: the cash / bank readers call movedNoCash', () => {
  for (const f of CASH_READERS) assert.match(readFileSync(join(SRC, f), 'utf8'), /\bmovedNoCash\(/, `${f} must skip no-cash rows with movedNoCash()`);
});

test('guard: no other module tests the no-cash markers itself (use movedNoCash from src/lib/no-cash.ts)', () => {
  const bad: string[] = [];
  for (const p of walk(SRC)) {
    const f = rel(p);
    if (f.startsWith('types/') || f.startsWith('i18n/') || MARKER_OWNERS.has(f)) continue;
    const text = readFileSync(p, 'utf8');
    if (/\.\s*(gift_voucher_id|deposit_adjustment_id|ra_journal_id)\b/.test(text)) bad.push(f);
  }
  assert.deepEqual(bad, [], 'these files read a no-cash marker directly');
});

test('guard: a module that reads receipt rows and works out cash / bank money uses movedNoCash', () => {
  const reads = /getTable<Payment[^>]*>\(\s*'transactions'|peekTable<Payment[^>]*>\(\s*'transactions'|localDb\.payments\.getAll\(|\bbooks\.transactions\b|\binput\.payments\b|\bsource\.payments\b/;
  const money = /accountForMethod\(|isCashMethod\(|Deposit To|\bmodeOf\(|methodKey\(/;
  const missing = walk(SRC).map(rel).filter((f) => !MARKER_OWNERS.has(f)).filter((f) => {
    const t = readFileSync(join(SRC, f), 'utf8');
    return reads.test(t) && money.test(t) && !/\bmovedNoCash\(/.test(t);
  });
  assert.deepEqual(missing, [], 'cash / bank readers without movedNoCash');
});
