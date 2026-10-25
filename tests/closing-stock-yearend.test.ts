/**
 * Integration pass: report-time closing-stock valuation (WP-2) and the year-end wizard's closing-stock
 * journal (WP-7) never count the stock twice.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  A,
  buildLedger,
  ledgerBalanceSheet,
  ledgerProfitAndLoss,
  loadLedgerInput,
  loadStockValuer,
  saveBooksBegin,
  saveOpenings,
  saveVoucher,
  stockJournalConflicts,
} from '../src/lib/ledger/index.ts';
import {
  CLOSING_STOCK_CLASS,
  manualValuer,
  netOfStockJournals,
  netOfStockOpening,
  saveClosingStockConfig,
  stockJournalPostings,
} from '../src/lib/ledger/closing-stock.ts';
import { loadYearEnd, postClosingStock, stopValuingStock } from '../src/lib/year-end-store.ts';
import { yearEndChecklist } from '../src/lib/year-end.ts';
import { buildFrame } from '../src/lib/gateway/drill.ts';
import { installSettings } from './helpers/world.ts';

const FY = 2025;
const PERIOD = { start: '2025-04-01', end: '2026-03-31' };
const NEXT = { start: '2026-04-01', end: '2026-09-30' };

const jv = (date: string, lines: Array<[string, number, number]>, type: 'JOURNAL' | 'PAYMENT' | 'RECEIPT' = 'JOURNAL', extra: Record<string, unknown> = {}) =>
  saveVoucher({ type, date, narration: '', ...extra, lines: lines.map(([account_id, dr, cr]) => ({ account_id, dr, cr })) });

beforeEach(() => {
  resetStorage();
  installSettings();
  saveBooksBegin('2025-04-01');
  saveOpenings([
    { ledger_id: A.bank, amount: 10000000 },
    { ledger_id: A.capital, amount: -10000000 },
  ]);
  jv('2025-06-01', [[A.bank, 5000000, 0], [A.sales, 0, 5000000]], 'RECEIPT'); // sales ₹50,000
  jv('2025-07-01', [[A.purchases, 3000000, 0], [A.bank, 0, 3000000]], 'PAYMENT'); // purchases ₹30,000
  // Typed closing stock: ₹10,000 at 31 March 2026, ₹12,000 at 30 Sep 2026.
  saveClosingStockConfig({ mode: 'manual', entries: [{ date: '2026-03-31', value: 1000000 }, { date: '2026-09-30', value: 1200000 }] });
});

const figures = () => {
  const ledger = buildLedger(loadLedgerInput());
  const stock = loadStockValuer();
  const pl = ledgerProfitAndLoss(ledger, PERIOD, stock);
  const pl2 = ledgerProfitAndLoss(ledger, NEXT, stock);
  const bs = ledgerBalanceSheet(ledger, PERIOD.end, stock);
  const bs2 = ledgerBalanceSheet(ledger, NEXT.end, stock);
  return { stock, pl, pl2, bs, bs2 };
};

test('valuation alone: gross profit = sales − purchases + closing stock', () => {
  const f = figures();
  assert.equal(f.pl.grossProfit, 5000000 - 3000000 + 1000000);
  assert.equal(f.bs.difference, 0);
  assert.equal(f.stock?.netted, undefined);
  assert.deepEqual(stockJournalConflicts(), []);
});

test('a closing-stock journal on top of valuation is netted off: every statement equals the valuation-only figures', () => {
  const base = figures();
  // As if posted before valuation was switched on (postClosingStock now refuses while valuing).
  jv('2026-03-31', [[A.stock, 1000000, 0], [A.purchases, 0, 1000000]], 'JOURNAL', { voucher_class: CLOSING_STOCK_CLASS, reverse_on: '2026-04-01' });
  const f = figures();
  assert.equal(f.pl.netProfit, base.pl.netProfit, 'FY with the journal: stock counted once');
  assert.equal(f.pl2.netProfit, base.pl2.netProfit, 'next FY (reversal as opening stock): counted once');
  assert.equal(f.bs.totalAssets, base.bs.totalAssets);
  assert.equal(f.bs2.totalAssets, base.bs2.totalAssets);
  assert.equal(f.bs.difference, 0);
  assert.equal(f.bs2.difference, 0);
  assert.equal(f.stock?.netted?.length, 1, 'the warning knows which journal');
  assert.equal(stockJournalConflicts().length, 1);
});

test('netOfStockJournals is pure; memo / optional journals and non-stock journals are ignored', () => {
  const v = manualValuer({ mode: 'manual', entries: [{ date: '2026-03-31', value: 500 }] });
  const mk = (extra: Record<string, unknown>) => ({
    id: String(Math.random()), type: 'JOURNAL' as const, number: 'J', date: '2026-03-31', narration: 'Closing stock', created_at: '',
    lines: [{ account_id: 'stock', dr: 500, cr: 0 }, { account_id: 'purchases', dr: 0, cr: 500 }], ...extra,
  });
  assert.equal(stockJournalPostings([mk({ variant: 'MEMO' }), mk({ variant: 'OPTIONAL' })], '2026-10-01').length, 0);
  assert.equal(stockJournalPostings([mk({ narration: 'Rent', voucher_class: undefined })], '2026-10-01').length, 0);
  const p = stockJournalPostings([mk({ reverse_on: '2026-04-01' })], '2026-10-01');
  assert.deepEqual(p.map((x) => [x.date, x.delta]), [['2026-03-31', 500], ['2026-04-01', -500]]);
  const n = netOfStockJournals(v, p)!;
  assert.equal(n.value('2026-03-31'), 0);
  assert.equal(n.value('2026-04-01'), 500);
  assert.equal(netOfStockJournals(undefined, p), undefined);
  assert.equal(netOfStockJournals(v, []), v);
});

test('year-end wizard: valuation on → step shows the valued figure, done, and posting is refused', () => {
  const st = loadYearEnd(FY);
  const step = st.steps.find((s) => s.id === 'closing_stock')!;
  assert.equal(step.status, 'done');
  assert.equal(step.amount, 1000000);
  assert.match(step.facts.join(' '), /report time/);
  assert.equal(st.valuation?.mode, 'manual');
  assert.throws(() => postClosingStock(FY, 1000000), /valued at report time/);

  // One-click switch: valuation off → the journal is offered and posts; reports then rely on it alone.
  stopValuingStock();
  assert.equal(loadYearEnd(FY).valuation?.mode, 'none');
  postClosingStock(FY, 1000000);
  const ledger = buildLedger(loadLedgerInput());
  const stock = loadStockValuer();
  assert.equal(stock, undefined);
  assert.equal(ledgerProfitAndLoss(ledger, PERIOD, stock).netProfit, 5000000 - 3000000 + 1000000, 'journal alone gives the same profit');
});

test('yearEndChecklist (pure): valuation off keeps the old journal behaviour', () => {
  const ledger = buildLedger(loadLedgerInput());
  const steps = yearEndChecklist({
    fyStart: FY, ledger, integrity: { ok: true, issues: [], totals: { dr: 0, cr: 0, diff: 0 }, negativeCashDays: [] } as never,
    closingStock: { value: 700, items: 2 }, valuation: { mode: 'none', label: '', value: 0 }, assets: [], manual: [], lockUntil: '',
    oldOpenBills: { count: 0, amount: 0 }, today: '2026-05-01',
  });
  const s = steps.find((x) => x.id === 'closing_stock')!;
  assert.equal(s.status, 'todo');
  assert.equal(s.amount, 700);
});

test('Gateway Display balance sheet / P&L equal the Books statements with stock valued', () => {
  // Opening stock too, so both stock rows appear.
  saveClosingStockConfig({ mode: 'manual', opening: 200000, entries: [{ date: '2026-03-31', value: 1000000 }] });
  const ledger = buildLedger(loadLedgerInput());
  const stock = loadStockValuer();
  const books = ledgerBalanceSheet(ledger, PERIOD.end, stock);
  const gw = buildFrame(ledger, 'bs', [], PERIOD, '2026-10-01', { stock })!;
  const cell = (id: string) => gw.rows.find((r) => r.id === id)?.cells[0];
  assert.equal(cell('t-liab'), books.totalEquityAndLiabilities);
  assert.equal(cell('t-assets'), books.totalAssets);
  assert.equal(cell('t-liab'), cell('t-assets'), 'the Gateway sheet ties');
  assert.equal(cell('pl'), books.profitForYear);
  assert.equal(cell('stock-open'), 200000);
  // The valued stock sits inside the Inventories head; drilling the head shows the stock line (as Books).
  assert.equal(cell('g-INVENTORIES'), books.closingStock);
  const head = buildFrame(ledger, 'bs', [{ t: 'g', v: 'INVENTORIES' }], PERIOD, '2026-10-01', { stock })!;
  const stockRow = head.rows.find((r) => r.open === '/inventory')!;
  assert.equal(stockRow.cells[0], 1000000);
  assert.equal(head.total![0], books.closingStock);
  const iTotal = gw.rows.findIndex((r) => r.id === 't-liab');
  const sum = (rows: typeof gw.rows) => rows.filter((r) => !r.heading).reduce((s, r) => s + Number(r.cells[0] ?? 0), 0);
  assert.equal(sum(gw.rows.slice(0, iTotal)), books.totalEquityAndLiabilities, 'liability rows add up');
  assert.equal(sum(gw.rows.slice(iTotal + 1)), books.totalAssets, 'asset rows add up');

  const pl = ledgerProfitAndLoss(ledger, PERIOD, stock);
  const gpl = buildFrame(ledger, 'pl', [], PERIOD, '2026-10-01', { stock })!;
  assert.equal(gpl.rows.find((r) => r.id === 'net')!.cells[0], Math.abs(pl.netProfit));
  assert.equal(gpl.rows.find((r) => r.id === 'stock-close')!.cells[0], pl.trading.closingStock);
  // Without the valuer the Gateway would disagree: proves the stock really flows through.
  assert.notEqual(buildFrame(ledger, 'pl', [], PERIOD, '2026-10-01')!.rows.find((r) => r.id === 'net')!.cells[0], Math.abs(pl.netProfit));
});

test('H1: a Stock-in-hand ledger opening is netted only up to the opening stock the valuation carries', () => {
  const v = manualValuer({ opening: 50_000_00, entries: [{ date: '2026-03-31', value: 70_000_00 }] });
  const n = netOfStockOpening(v, 30_000_00, '2025-03-31')!;
  assert.equal(n.value('2025-03-30'), 50_000_00, 'before the opening voucher nothing is netted');
  assert.equal(n.value('2025-04-30'), 20_000_00, '50,000 valued − 30,000 already in the ledger');
  assert.equal(n.openingIn('2025-04-30'), 20_000_00);
  assert.equal(n.value('2026-03-31') - n.openingIn('2026-03-31'), v.value('2026-03-31') - v.openingIn('2026-03-31'), 'profit unchanged');
  const capped = netOfStockOpening(manualValuer({ opening: 10_000_00 }), 30_000_00, '2025-03-31')!;
  assert.equal(capped.value('2025-04-30'), 0, 'only the overlap is netted; the rest of the ledger opening stands');
  assert.equal(netOfStockOpening(manualValuer({}), 30_000_00, '2025-03-31')!.value('2025-04-30'), 0);
  assert.equal(netOfStockOpening(undefined, 30_000_00, '2025-03-31'), undefined);
});
