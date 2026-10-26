/** R5-A4 integration: a posted settlement in the real ledger, receivables, revenue totals and the Tally export. */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, importMtr, setupWorld } from '../helpers/marketplace.ts';
import { importSettlement, parseSettlement } from '../../src/lib/marketplace/settlement-import.ts';
import { postSettlement } from '../../src/lib/marketplace/settlement-post.ts';
import { buildLedger } from '../../src/lib/ledger/postings.ts';
import { loadLedgerInput } from '../../src/lib/ledger/index.ts';
import { trialBalance } from '../../src/lib/ledger/reports.ts';
import { bankLedgerId } from '../../src/lib/bank-ledgers.ts';
import { buildReceivables } from '../../src/lib/receivables.ts';
import { isRevenueDoc } from '../../src/lib/stats.ts';
import { buildTallyModel } from '../../src/lib/tally-xml.ts';
import { loadTallyBooksSource } from '../../src/lib/tally-books.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { getTable } from '../../src/lib/storage.ts';
import type { SalesChannel } from '../../src/types/marketplace-r5.ts';
import type { Payment } from '../../src/types/invoice.ts';

let ch: SalesChannel;
beforeEach(() => {
  ch = setupWorld();
  importMtr(ch);
  const s = importSettlement(ch, parseSettlement([{ name: 'v2', table: fixture('amazon-settlement-v2.csv') }], 'amazon_v2'), 'v2.csv');
  postSettlement(s.id);
});

const revenue = () => localDb.invoices.getAll().filter(isRevenueDoc).reduce((a, d) => a + d.total, 0);

test('trial balance stays balanced and the clearing ledger closes at zero', () => {
  const led = buildLedger(loadLedgerInput(undefined, '2026-12-31'));
  const tb = trialBalance(led, { start: '2026-04-01', end: '2027-03-31' });
  assert.equal(tb.totals.debit, tb.totals.credit);
  const clearing = tb.rows.find((r) => r.account.id === bankLedgerId(ch.clearing_bank_id));
  assert.ok(clearing, 'clearing ledger present');
  assert.equal(clearing!.closing, 0);
  const bank = tb.rows.find((r) => r.account.id === 'bank');
  assert.equal(bank?.closing, 201657, 'the payout reached the main bank (paise)');
});

test('receivables show the settled orders paid; revenue totals are unchanged by posting', () => {
  assert.equal(revenue(), 590 + 1062 + 1180);
  const rep = buildReceivables({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), links: getTable('doc_links') } as never, { now: new Date('2026-10-26') }) as unknown as { totals: { net: number } };
  assert.ok(Math.abs(rep.totals.net) < 0.01, `receivable left: ${rep.totals.net}`);
  for (const no of ['IN-1002', 'IN-1003']) assert.equal(localDb.invoices.getAll().find((d) => d.invoice_number === no)!.status, 'Paid');
});

test('Tally export lists the settlement journal and contra', () => {
  const m = buildTallyModel({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll() as Payment[], clients: localDb.clients.getAll(), items: [], purchases: [], vendors: [], books: loadTallyBooksSource('2026-12-31') }, { companyName: 'Test', includeInventory: false });
  assert.ok(m.vouchers.some((v) => v.type === 'Journal' && /settlement 9001/.test(v.narration ?? '')), m.vouchers.map((v) => v.type).join(','));
  assert.ok(m.vouchers.some((v) => v.type === 'Contra'));
});
