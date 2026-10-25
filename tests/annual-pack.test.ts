/** R2-C1: annual accounts pack and notes to accounts. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import {
  A,
  buildLedger,
  ledgerBalanceSheet,
  ledgerProfitAndLoss,
  loadAssets,
  loadLedgerInput,
  loadStockValuer,
  saveAsset,
  saveBooksBegin,
  saveOpenings,
  saveVoucher,
} from '../src/lib/ledger/index.ts';
import { CLOSING_STOCK_CLASS, saveClosingStockConfig } from '../src/lib/ledger/closing-stock.ts';
import {
  annualPackBody,
  annualPackHtml,
  annualPackSheets,
  balanceSheetLines,
  buildAnnualPack,
  fyId,
  notesDb,
  profitLossLines,
  DRAFT_LINE,
} from '../src/lib/ledger/annual-pack.ts';
import { ageParties, capitalTitle, fixedAssetSchedule, revenueShares, PAYABLE_BUCKETS } from '../src/lib/ledger/notes-auto.ts';
import { setTable } from '../src/lib/storage.ts';
import type { Vendor } from '../src/types/purchases.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const TODAY = '2026-04-30';
const jv = (date: string, lines: Array<[string, number, number]>, type: 'JOURNAL' | 'PAYMENT' | 'RECEIPT' = 'JOURNAL', extra: Record<string, unknown> = {}) =>
  saveVoucher({ type, date, narration: '', ...extra, lines: lines.map(([account_id, dr, cr]) => ({ account_id, dr, cr })) });

const vendors: Vendor[] = [
  { id: 'v1', name: 'Micro Tools', msme_category: 'MICRO', msme_udyam: 'UDYAM-MH-01-0000001' },
  { id: 'v2', name: 'Big Steel' },
];

beforeEach(() => {
  resetStorage();
  installSettings();
  saveBooksBegin('2024-04-01');
  saveOpenings([
    { ledger_id: A.bank, amount: 50_000_00 },
    { ledger_id: A.capital, amount: -50_000_00 },
  ]);
  // FY 24-25: sales 20,000, purchases 8,000
  jv('2024-06-01', [[A.bank, 20_000_00, 0], [A.sales, 0, 20_000_00]], 'RECEIPT');
  jv('2024-07-01', [[A.purchases, 8_000_00, 0], [A.bank, 0, 8_000_00]], 'PAYMENT');
  // FY 25-26: sales 30,000, purchases 12,000 on credit (MSME 5,000 / other 7,000), capital introduced 10,000
  jv('2025-05-01', [[A.bank, 30_000_00, 0], [A.sales, 0, 30_000_00]], 'RECEIPT');
  setTable('vendors', vendors);
  setTable('purchases', [
    { id: 'p1', kind: 'PURCHASE', vendor_id: 'v1', vendor_name: 'Micro Tools', bill_number: 'MT/1', date: '2025-12-01', taxable: 5000, cgst: 0, sgst: 0, igst: 0, total: 5000, amount_paid: 0, lines: [] },
    { id: 'p2', kind: 'PURCHASE', vendor_id: 'v2', vendor_name: 'Big Steel', bill_number: 'BS/9', date: '2024-12-15', taxable: 7000, cgst: 0, sgst: 0, igst: 0, total: 7000, amount_paid: 0, lines: [] },
  ]);
  jv('2025-08-01', [[A.bank, 10_000_00, 0], [A.capital, 0, 10_000_00]], 'RECEIPT');
  saveAsset({ name: 'Laptop', block: 'COMPUTER', account_id: 'fa_computers', cost: 60000, acquired_on: '2024-06-01', put_to_use: '2024-06-01', paid_from: A.bank });
  saveClosingStockConfig({ mode: 'manual', entries: [{ date: '2025-03-31', value: 2_000_00 }, { date: '2026-03-31', value: 3_000_00 }] });
});

const pack = (extra: Partial<Parameters<typeof buildAnnualPack>[0]> = {}) => {
  const ledger = buildLedger(loadLedgerInput(undefined, TODAY));
  const stock = loadStockValuer();
  return {
    ledger,
    stock,
    pack: buildAnnualPack({ ledger, stock, fyStartYear: 2025, assets: loadAssets(), vendors, invoices: [], company: { name: 'Asha Traders', gstin: '27AABCU9603R1ZX' }, generatedOn: TODAY, ...extra }),
  };
};

test('balance sheet totals equal Books, and the books tie', () => {
  const { ledger, stock, pack: p } = pack();
  const books = ledgerBalanceSheet(ledger, '2026-03-31', stock);
  assert.equal(p.bs.totalAssets, books.totalAssets);
  assert.equal(p.bs.totalEquityAndLiabilities, books.totalEquityAndLiabilities);
  assert.equal(p.difference, 0);
  const lines = balanceSheetLines(p);
  const totals = lines.filter((l) => l.label === 'TOTAL');
  assert.equal(totals[0].cur, books.totalEquityAndLiabilities);
  assert.equal(totals[1].cur, books.totalAssets);
  const pl = ledgerProfitAndLoss(ledger, { start: '2025-04-01', end: '2026-03-31' }, stock);
  assert.equal(profitLossLines(p).at(-1)?.cur, pl.netProfit, 'P&L profit = Books');
});

test('previous-year column is the prior FY’s figures', () => {
  const { ledger, stock, pack: p } = pack();
  const prevBooks = ledgerBalanceSheet(ledger, '2025-03-31', stock);
  assert.equal(balanceSheetLines(p).filter((l) => l.label === 'TOTAL')[1].prev, prevBooks.totalAssets);
  const prevPl = ledgerProfitAndLoss(ledger, { start: '2024-04-01', end: '2025-03-31' }, stock);
  const pl = profitLossLines(p);
  assert.equal(pl[0].prev, 20_000_00, 'revenue 24-25');
  assert.equal(pl[0].cur, 30_000_00, 'revenue 25-26');
  assert.equal(pl.at(-1)?.prev, prevPl.netProfit);
});

test('trade payables: MSME split from the vendor master and ageing from the bill date', () => {
  const { ledger, pack: p } = pack();
  const note = p.notes.find((n) => n.id === 'payables')!;
  const t = note.tables[0];
  const msme = t.rows.find((r) => r[0] === 'MSME')!;
  const others = t.rows.find((r) => r[0] === 'Others')!;
  assert.equal(msme.at(-1), 5_000_00);
  assert.equal(msme[1], 5_000_00, '< 1 year');
  assert.equal(others.at(-1), 7_000_00);
  assert.equal(others[2], 7_000_00, 'bill of Dec 2024 is 1–2 years old at 31 Mar 2026');
  const ag = ageParties(ledger, A.creditors, '2026-03-31', 'cr', PAYABLE_BUCKETS.limits, PAYABLE_BUCKETS.labels);
  assert.equal(ag.totals.reduce((s, x) => s + x, 0), 12_000_00);
  assert.match(note.paragraphs[0], /verify with your CA/);
});

test('fixed-asset schedule rolls forward and ties to the register', () => {
  const { ledger } = pack();
  const s = fixedAssetSchedule(ledger, { start: '2025-04-01', end: '2026-03-31' }, '2025-03-31', loadAssets());
  assert.equal(s.gross.opening, 60_000_00);
  assert.equal(s.gross.additions, 0);
  assert.equal(s.gross.closing, s.gross.opening + s.gross.additions - s.gross.deletions);
  // Computers 40%: FY24-25 24,000 → WDV 36,000; FY25-26 14,400 → WDV 21,600
  assert.equal(s.depreciation.opening, 24_000_00);
  assert.equal(s.depreciation.charge, 14_400_00);
  assert.equal(s.depreciation.closing, 38_400_00);
  assert.equal(s.net.closing, 21_600_00);
  assert.equal(s.registerWdv, s.net.closing, 'net block = register WDV');
  const { pack: p } = pack();
  assert.match(p.notes.find((n) => n.id === 'fixed_assets')!.paragraphs[0], /agrees with the written-down value/);
});

test('closing stock is not double counted when a closing-stock journal is also posted', () => {
  const before = pack().pack;
  jv('2026-03-31', [[A.stock, 3_000_00, 0], [A.purchases, 0, 3_000_00]], 'JOURNAL', { voucher_class: CLOSING_STOCK_CLASS, reverse_on: '2026-04-01' });
  const after = pack().pack;
  assert.equal(after.bs.totalAssets, before.bs.totalAssets);
  assert.equal(after.pl.netProfit, before.pl.netProfit);
  assert.equal(after.bs.closingStock, 0, 'the valuation is netted off the journal…');
  assert.equal(after.notes.find((n) => n.id === 'inventory')!.tables[0].rows[0][1], 3_000_00);
  assert.equal(after.difference, 0);
});

test('notes persist per FY; extra paragraphs and edited text appear; wording follows the entity type', () => {
  notesDb.save(fyId(2025), { policies: { text: 'Our own policy text.' }, payables: { extra: 'All MSME dues paid in April.' } }, 'company');
  notesDb.save(fyId(2024), { policies: { text: 'Last year policy.' } });
  assert.equal(notesDb.get('FY25-26')?.entity_type, 'company');
  const { pack: p } = pack({ notes: notesDb.get('FY25-26') });
  assert.equal(p.entity, 'company');
  assert.deepEqual(p.notes[0].paragraphs, ['Our own policy text.']);
  assert.equal(p.notes.find((n) => n.id === 'payables')?.extra, 'All MSME dues paid in April.');
  assert.equal(p.notes.find((n) => n.id === 'capital')?.title, 'Share capital');
  assert.equal(capitalTitle('partnership'), "Partners' capital accounts");
  const other = pack({ notes: notesDb.get('FY24-25'), fyStartYear: 2024 }).pack;
  assert.deepEqual(other.notes[0].paragraphs, ['Last year policy.']);
  // A blank text falls back to the starter wording.
  notesDb.save(fyId(2025), { policies: { text: '   ' } });
  assert.ok(pack({ notes: notesDb.get('FY25-26') }).pack.notes[0].paragraphs.length > 1);
  assert.deepEqual(p.notes.map((n) => n.no), p.notes.map((_, i) => i + 1));
});

test('capital note movement and revenue split', () => {
  const { pack: p } = pack();
  const cap = p.notes.find((n) => n.id === 'capital')!.tables[0].rows.find((r) => r[0] === 'Capital account')!;
  assert.deepEqual(cap.slice(1), [50_000_00, 10_000_00, 0, 60_000_00]);
  const inv = (type: string, hsn: string, qty: number, rate: number): InvoiceRecord =>
    ({ id: type + hsn, doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2025-06-01', items: [{ id: 'l', name: 'x', type, hsn, quantity: qty, rate, amount: qty * rate }] }) as unknown as InvoiceRecord;
  const shares = revenueShares([inv('Goods', '8471', 1, 300), inv('', '998314', 1, 100), { ...inv('Goods', '1', 1, 999), status: 'Cancelled' } as InvoiceRecord], '2025-04-01', '2026-03-31');
  assert.deepEqual(shares, { goods: 300, services: 100 });
  const withInv = pack({ invoices: [inv('Goods', '8471', 1, 300), inv('', '998314', 1, 100)] }).pack;
  const rev = withInv.notes.find((n) => n.id === 'revenue')!.tables[0].rows;
  assert.equal(rev[0][1], 22_500_00);
  assert.equal(rev[1][1], 7_500_00);
  assert.equal(rev[2][1], 30_000_00, 'ties to the Sales ledger');
});

test('output: script-free HTML with the draft line, escaped text, XLSX sheets', () => {
  notesDb.save(fyId(2025), { events: { text: '<script>alert(1)</script> & co' } });
  const { pack: p } = pack({ notes: notesDb.get('FY25-26') });
  const html = annualPackHtml(p);
  assert.ok(!/<script/i.test(html), 'no script element');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes(DRAFT_LINE));
  assert.match(DRAFT_LINE, /verify with your CA/);
  assert.equal((annualPackBody(p).match(/class="ap-page"/g) ?? []).length, 6, 'cover, BS, P&L, cash flow, TB, notes');
  const sheets = annualPackSheets(p);
  assert.deepEqual(sheets.map((s) => s.name), ['Balance sheet', 'Profit & loss', 'Cash flow', 'Trial balance', 'Notes']);
  assert.equal(sheets[0].rows[0][2], 'FY 2025-26');
  assert.equal(sheets[0].rows[0][3], 'FY 2024-25');
});
