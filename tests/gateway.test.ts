/**
 * Phase 7 (Tally parity): Gateway menu filtering & accelerators, Tally key routing, the period store,
 * voucher entry balancing / Alt+C creation, and drill-down path data.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { gwT } from '../src/i18n/areas/gateway.ts';
import {
  GATEWAY_SCREENS,
  accelIndex,
  duplicateAccelerators,
  entryForKey,
  entryRoute,
  filterGoto,
  flattenMenu,
  resolveScreen,
  screenEntries,
} from '../src/lib/gateway/menu.ts';
import { resolveTallyKey, TALLY_KEYS, type KeyLike } from '../src/lib/tally-keys.ts';
import { roleCan } from '../src/lib/access.ts';
import {
  getGatewayPeriod,
  getTallyTerms,
  getVoucherDate,
  isCalendarDay,
  resetGatewayForTests,
  setGatewayPeriod,
  setTallyTerms,
  setVoucherDate,
  subscribeGateway,
  validatePeriod,
} from '../src/lib/gateway/period.ts';
import {
  autoFill,
  balancingAmount,
  createLedgerInline,
  entryTotals,
  firstSide,
  ledgerOptions,
  nextAccountCode,
  nextLine,
  searchLedgers,
  toVoucherInput,
  type EntryLine,
} from '../src/lib/gateway/voucher-entry.ts';
import { buildLedger, chartOf, loadUserAccounts, loadVouchers, saveVoucher, validateVoucher, type LedgerInput } from '../src/lib/ledger/index.ts';
import { EMPTY_BOOKS } from '../src/lib/books.ts';
import { buildFrame, decodePath, encodePath, voucherTarget, type Seg } from '../src/lib/gateway/drill.ts';
import { localDb } from '../src/lib/localDb.ts';
import { vendorsDb } from '../src/lib/vendors.ts';

beforeEach(() => {
  resetStorage();
  resetGatewayForTests();
});

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

/* ── Menu ─────────────────────────────────────────────── */

test('every menu screen has unique accelerators and every screen target exists', () => {
  for (const s of GATEWAY_SCREENS) {
    assert.deepEqual(duplicateAccelerators(s), [], `${s.id} duplicates`);
    for (const e of screenEntries(s)) {
      assert.match(e.accel, /^[a-z0-9]$/, `${e.id} accel`);
      if ('screen' in e.target) assert.ok(resolveScreen(e.target.screen), `${e.id} → ${e.target.screen}`);
    }
  }
});

test('Tally accelerators on the Gateway: C Create, A Alter, V Vouchers, D/K Day book, B, P, S, M', () => {
  const root = resolveScreen('root');
  const id = (k: string) => entryForKey(root, k)?.id;
  assert.equal(id('c'), 'create');
  assert.equal(id('A'), 'alter');
  assert.equal(id('v'), 'vouchers');
  assert.equal(id('d'), 'daybook');
  assert.equal(id('k'), 'daybook', 'Tally’s own K works as an alias');
  assert.equal(id('b'), 'bs');
  assert.equal(id('p'), 'pl');
  assert.equal(id('s'), 'stock');
  assert.equal(id('m'), 'more');
  assert.equal(id('z'), undefined);
  assert.equal(id('Enter'), undefined, 'named keys are never accelerators');
  const vouchers = resolveScreen('vouchers');
  assert.equal(entryForKey(vouchers, 'p')?.fkey, 'f5');
  assert.equal(entryRoute(entryForKey(vouchers, 'p')!.target, 'vouchers'), '/gateway/voucher/payment');
  assert.equal(entryRoute({ display: 'r=bs' }, 'root'), '/gateway/display?r=bs&from=root');
  assert.equal(entryRoute({ screen: 'more' }, 'root'), '/gateway?m=more');
});

test('roles hide entries they cannot use', () => {
  const viewer = (a: Parameters<typeof roleCan>[1]) => roleCan('viewer', a);
  const root = resolveScreen('root', viewer);
  assert.equal(entryForKey(root, 'c'), undefined, 'viewer cannot create masters');
  const v = resolveScreen('vouchers', viewer);
  assert.equal(screenEntries(v).length, 0);
  assert.equal(resolveScreen('vouchers', (a) => roleCan('clerk', a))!.sections[0].entries.some((e) => e.id === 'v-payment'), true);
});

test('accelIndex finds the letter to highlight, -1 when the label lacks it', () => {
  assert.equal(accelIndex('Balance sheet', 'b'), 0);
  assert.equal(accelIndex('Day book', 'k'), 7);
  assert.equal(accelIndex('बैलेंस शीट', 'b'), -1);
});

test('Go To filters every leaf menu entry and report, ranked by label prefix', () => {
  const items = flattenMenu({ label: (k) => gwT.en[k], alt: (k) => gwT.hi[k] });
  assert.ok(items.length > 40);
  assert.ok(!items.some((i) => 'screen' in i.entry.target), 'sub-menus are walked, not listed');
  const tb = filterGoto(items, 'trial');
  assert.equal(tb[0].entry.id, 'm-tb');
  assert.deepEqual(tb[0].path, ['Display more reports']);
  assert.equal(filterGoto(items, 'pay')[0].label, 'Payment');
  assert.ok(filterGoto(items, 'out rec').some((i) => i.entry.id === 'st-rec'), 'all words must match');
  assert.equal(filterGoto(items, 'बैलेंस')[0].entry.id, 'bs', 'Hindi labels are searched too');
  assert.equal(filterGoto(items, 'gstr3b')[0].entry.id, 'sr-gstr3b', 'keywords are searched');
  assert.deepEqual(filterGoto(items, '   '), []);
  assert.deepEqual(filterGoto(items, 'zzzz'), []);
  const terms = flattenMenu({ label: (k) => gwT.en[k], terms: true });
  assert.ok(filterGoto(terms, 'sales voucher').some((i) => i.entry.id === 'v-sales'));
});

/* ── Tally keys ───────────────────────────────────────── */

test('Tally keys route F-keys outside fields, never inside inputs, on /pos or under a modal', () => {
  const ctx = { pathname: '/', typing: false };
  assert.equal(resolveTallyKey(key('F5'), ctx)?.to, '/gateway/voucher/payment');
  assert.equal(resolveTallyKey(key('F4'), ctx)?.to, '/gateway/voucher/contra');
  assert.equal(resolveTallyKey(key('F8'), ctx)?.to, '/invoice');
  assert.equal(resolveTallyKey(key('F9'), ctx)?.to, '/expenses?new=bill');
  assert.equal(resolveTallyKey(key('F8', { ctrlKey: true }), ctx)?.to, '/invoice?type=CREDIT_NOTE');
  assert.equal(resolveTallyKey(key('F9', { metaKey: true }), ctx)?.to, '/invoice?type=DEBIT_NOTE');
  assert.equal(resolveTallyKey(key('F2'), ctx)?.state?.tally, 'date');
  assert.equal(resolveTallyKey(key('F2', { altKey: true }), ctx)?.state?.tally, 'period');
  assert.equal(resolveTallyKey(key('g', { altKey: true }), ctx)?.state?.tally, 'goto');
  assert.equal(resolveTallyKey(key('g', { ctrlKey: true }), ctx)?.state?.tally, 'goto');
  assert.equal(resolveTallyKey(key('/', { ctrlKey: true }), ctx)?.id, 'help');
  assert.equal(resolveTallyKey(key('F12'), ctx)?.to, '/settings');
  assert.equal(resolveTallyKey(key('F5', { shiftKey: true }), ctx), null);
  assert.equal(resolveTallyKey(key('F7', { altKey: true }), ctx), null, 'Stock journal hook waits for its screen');
  assert.equal(resolveTallyKey(key('F7', { ctrlKey: true }), ctx), null, 'Physical stock hook waits for its screen');
  assert.equal(resolveTallyKey(key('a'), ctx), null);

  assert.equal(resolveTallyKey(key('F5'), { pathname: '/', typing: true }), null, 'not while typing');
  assert.equal(resolveTallyKey(key('F8', { ctrlKey: true }), { pathname: '/', typing: true }), null, 'not even Ctrl combos in fields');
  assert.equal(resolveTallyKey(key('F5'), { pathname: '/pos', typing: false }), null, 'POS owns the F-keys');
  assert.equal(resolveTallyKey(key('F2'), { pathname: '/pos/', typing: false }), null);
  assert.equal(resolveTallyKey(key('F5'), { pathname: '/position', typing: false })?.id, 'payment');
  assert.equal(resolveTallyKey(key('F5'), { pathname: '/', typing: false, modalOpen: true }), null);
  assert.equal(resolveTallyKey(key('F5'), { ...ctx, can: (a) => roleCan('viewer', a) }), null, 'role cannot record vouchers');
  assert.equal(resolveTallyKey(key('F12'), { ...ctx, can: (a) => roleCan('viewer', a) })?.id, 'configure');
  assert.equal(new Set(TALLY_KEYS.map((k) => k.combo)).size, TALLY_KEYS.length, 'combos are unique');
});

/* ── Period store ─────────────────────────────────────── */

test('period store: FY default, validation, voucher date, subscribers, Tally terms', () => {
  const p = getGatewayPeriod();
  assert.match(p.start, /^\d{4}-04-01$/);
  assert.match(p.end, /^\d{4}-03-31$/);
  assert.ok(isCalendarDay(getVoucherDate()));
  let calls = 0;
  const off = subscribeGateway(() => calls++);
  assert.equal(setGatewayPeriod({ start: '2025-04-01', end: '2025-06-30' }), true);
  assert.deepEqual(getGatewayPeriod(), { start: '2025-04-01', end: '2025-06-30' });
  assert.equal(setGatewayPeriod({ start: '2025-07-01', end: '2025-06-30' }), false);
  assert.equal(validatePeriod({ start: '2025-07-01', end: '2025-06-30' }), 'order');
  assert.equal(validatePeriod({ start: '2025-02-30', end: '2025-06-30' }), 'date');
  assert.equal(setVoucherDate('2025-05-10'), true);
  assert.equal(setVoucherDate('2025-13-10'), false);
  assert.equal(getVoucherDate(), '2025-05-10');
  assert.equal(getTallyTerms(), false);
  setTallyTerms(true);
  assert.equal(getTallyTerms(), true);
  off();
  setTallyTerms(false);
  assert.equal(calls, 3);
});

/* ── Voucher entry ────────────────────────────────────── */

const L = (k: number, side: 'dr' | 'cr', account_id: string, amount: string): EntryLine => ({ key: k, side, account_id, amount });

test('voucher entry: first side, totals, the next line carries the difference, auto-fill', () => {
  assert.equal(firstSide('PAYMENT'), 'dr');
  assert.equal(firstSide('RECEIPT'), 'cr');
  assert.equal(firstSide('CONTRA'), 'cr');
  const lines = [L(1, 'dr', 'rent', '5,000.50'), L(2, 'dr', 'office_supplies', '99.5')];
  assert.deepEqual(entryTotals(lines), { dr: 510000, cr: 0, diff: 510000 });
  const next = nextLine(lines, 3, 'PAYMENT', true)!;
  assert.equal(next.side, 'cr');
  assert.equal(next.amount, '5100.00');
  const balanced = [...lines, { ...next, account_id: 'bank' }];
  assert.equal(entryTotals(balanced).diff, 0);
  assert.equal(nextLine(balanced, 4, 'PAYMENT', true), null, 'balanced: go to narration');
  assert.equal(nextLine(balanced, 4, 'PAYMENT')!.amount, '');
  const filled = autoFill([L(1, 'dr', 'rent', '1200'), L(2, 'cr', 'bank', '')], 2);
  assert.equal(filled[1].amount, '1200.00');
  assert.equal(autoFill([L(1, 'dr', 'rent', '1200'), L(2, 'dr', 'cash', '')], 2)[1].amount, '', 'no fill on the side that is ahead');
  assert.equal(balancingAmount([L(1, 'cr', 'bank', '10')], 'dr'), 1000);
});

test('voucher entry saves through the manual voucher API (validation, FY number)', () => {
  const chart = chartOf(loadUserAccounts());
  const input = toVoucherInput({ type: 'PAYMENT', date: '2025-05-10', narration: 'May rent' }, [L(1, 'dr', 'rent', '5000'), L(2, 'cr', 'bank', '5000'), L(3, 'dr', '', '')], chart);
  assert.equal(input.lines.length, 2, 'blank lines dropped');
  assert.deepEqual(validateVoucher(input, chart), []);
  const v = saveVoucher(input, chart);
  assert.match(v.number, /^PV\/FY25-26\/0001$/);
  assert.equal(loadVouchers()[0].lines[0].dr, 500000);
  const bad = toVoucherInput({ type: 'PAYMENT', date: '2025-05-10', narration: '' }, [L(1, 'dr', 'rent', '5000'), L(2, 'cr', 'bank', '4000')], chart);
  assert.match(validateVoucher(bad, chart)[0], /differ/);
});

test('ledger type-ahead: accounts + parties, contra offers cash/bank only', () => {
  const chart = chartOf([]);
  const opts = ledgerOptions(chart, [{ name: 'Asha Traders' }, { name: 'asha traders' }], [{ name: 'Rentco Supplies' }], 'PAYMENT');
  const asha = opts.filter((o) => o.party?.toLowerCase() === 'asha traders');
  assert.equal(asha.length, 1, 'duplicate client names collapse');
  assert.equal(asha[0].account_id, 'debtors');
  assert.equal(searchLedgers(opts, 'rent')[0].name.toLowerCase().startsWith('rent'), true);
  assert.ok(searchLedgers(opts, 'supp').some((o) => o.kind === 'vendor' && o.account_id === 'creditors'));
  assert.ok(ledgerOptions(chart, [{ name: 'X' }], [], 'CONTRA').every((o) => o.kind === 'account' && chart.find((a) => a.id === o.account_id)?.group === 'CASH_BANK'));
});

test('Alt+C creates a ledger account, customer or vendor inline', () => {
  const chart = chartOf([]);
  const code = nextAccountCode(chart, 'INDIRECT_EXPENSES');
  assert.match(code, /^\d+$/);
  assert.ok(!chart.some((a) => a.code === code));
  const acc = createLedgerInline({ kind: 'account', name: 'Diwali gifts', group: 'INDIRECT_EXPENSES' });
  assert.equal(acc.kind, 'account');
  assert.ok(loadUserAccounts().some((a) => a.id === acc.account_id && a.code === code));
  assert.throws(() => createLedgerInline({ kind: 'account', name: 'Diwali gifts', group: 'INDIRECT_EXPENSES' }), /already exists/);
  assert.throws(() => createLedgerInline({ kind: 'account', name: '  ', group: 'INDIRECT_EXPENSES' }), /name/);
  const c = createLedgerInline({ kind: 'customer', name: 'Meera Stores', gstin: '27aaaca1234a1z5' });
  assert.deepEqual([c.account_id, c.party], ['debtors', 'Meera Stores']);
  assert.equal(localDb.clients.getAll()[0].gstin, '27AAACA1234A1Z5');
  const v = createLedgerInline({ kind: 'vendor', name: 'Kiran Paper' });
  assert.deepEqual([v.account_id, v.party], ['creditors', 'Kiran Paper']);
  createLedgerInline({ kind: 'vendor', name: 'kiran paper' });
  assert.equal(vendorsDb.all().length, 1, 'existing vendor is reused');
  // The new account posts like any other.
  const chart2 = chartOf(loadUserAccounts());
  const saved = saveVoucher(toVoucherInput({ type: 'PAYMENT', date: '2025-05-10', narration: '' }, [L(1, 'dr', acc.account_id, '100'), L(2, 'cr', 'cash', '100')], chart2), chart2);
  assert.match(saved.number, /^PV\//);
});

/* ── Drill-down ───────────────────────────────────────── */

function ledgerWith(): ReturnType<typeof buildLedger> {
  const chart = chartOf([]);
  saveVoucher(toVoucherInput({ type: 'JOURNAL', date: '2025-04-05', narration: 'capital' }, [L(1, 'dr', 'bank', '100000'), L(2, 'cr', 'capital', '100000')], chart), chart);
  saveVoucher(toVoucherInput({ type: 'PAYMENT', date: '2025-05-10', narration: 'rent' }, [L(1, 'dr', 'rent', '5000'), L(2, 'cr', 'bank', '5000')], chart), chart);
  saveVoucher(
    toVoucherInput({ type: 'RECEIPT', date: '2025-05-20', narration: 'advance' }, [{ ...L(1, 'cr', 'debtors', '2000'), party: 'Asha' }, L(2, 'dr', 'cash', '2000')], chart),
    chart,
  );
  const input: LedgerInput = { ...EMPTY_BOOKS, userAccounts: [], manual: loadVouchers(), assets: [], today: '2025-06-30' };
  return buildLedger(input);
}

test('drill path encodes, decodes and drops junk', () => {
  const segs: Seg[] = [{ t: 'g', v: 'CASH_BANK' }, { t: 'a', v: 'bank' }, { t: 'p', v: 'A/B & Co' }, { t: 'm', v: '2025-05' }, { t: 'pl' }];
  assert.deepEqual(decodePath(encodePath(segs)), segs);
  assert.deepEqual(decodePath('g:NOPE/a:/m:2025-5/x:1/%E0%A4'), []);
  assert.deepEqual(decodePath(null), []);
});

test('balance sheet → group → ledger → month → voucher, figures tie at every level', () => {
  const ledger = ledgerWith();
  const period = { start: '2025-04-01', end: '2026-03-31' };
  const bs = buildFrame(ledger, 'bs', [], period, '2025-06-30')!;
  assert.equal(bs.asOf, '2025-06-30', 'as at capped at today');
  const total = bs.rows.filter((r) => r.heading && typeof r.label !== 'string' && r.label.key === 'total').map((r) => r.cells[0]);
  assert.equal(total[0], total[1], 'liabilities + P&L = assets');
  const cashRow = bs.rows.find((r) => r.id === 'g-CASH_BANK')!;
  assert.equal(cashRow.cells[0], 9700000, 'bank 95,000 + cash 2,000');
  const plRow = bs.rows.find((r) => r.id === 'pl')!;
  assert.equal(plRow.cells[0], -500000, 'loss of 5,000 (rent)');
  assert.equal(buildFrame(ledger, 'bs', [{ t: 'pl' }], period, '2025-06-30')!.rows.find((r) => r.id === 'net')!.cells[0], 500000);

  const group = buildFrame(ledger, 'bs', [cashRow.drill!], period, '2025-06-30')!;
  const bank = group.rows.find((r) => r.id === 'a-bank')!;
  assert.deepEqual(bank.cells, [0, 10000000, 500000, 9500000]);
  assert.equal(group.total![3], 9700000);

  const months = buildFrame(ledger, 'bs', [cashRow.drill!, bank.drill!], period, '2025-06-30')!;
  assert.deepEqual(months.rows.map((r) => r.id), ['open', 'm-2025-04', 'm-2025-05', 'm-2025-06']);
  assert.deepEqual(months.rows[2].cells, [null, 500000, 9500000]);

  const vch = buildFrame(ledger, 'bs', [cashRow.drill!, bank.drill!, months.rows[2].drill!], period, '2025-06-30')!;
  const row = vch.rows.find((r) => !r.heading)!;
  assert.equal(row.cells[1], 'Payment');
  assert.match(String(row.open), /^\/gateway\/voucher\/payment\?id=/);
  assert.equal(vch.rows[0].cells[5], 10000000, 'opening of the month');
});

test('control accounts drill through parties; day book lists every voucher with its target', () => {
  const ledger = ledgerWith();
  const period = { start: '2025-04-01', end: '2026-03-31' };
  const out = buildFrame(ledger, 'acct', [], period, '2025-06-30', { account: 'debtors' })!;
  assert.deepEqual(out.rows.map((r) => r.label), ['Asha']);
  assert.equal(out.rows[0].cells[3], -200000, 'Asha in credit by 2,000');
  const party = buildFrame(ledger, 'acct', [out.rows[0].drill!], period, '2025-06-30', { account: 'debtors' })!;
  assert.deepEqual(party.title, { text: 'Asha' });
  assert.equal(party.total![2], -200000);
  assert.equal(buildFrame(ledger, 'acct', [], period, '2025-06-30', { account: 'nope' }), null);

  const day = buildFrame(ledger, 'daybook', [], { start: '2025-05-01', end: '2025-05-31' }, '2025-06-30')!;
  assert.deepEqual(day.rows.map((r) => r.cells[1]), ['Payment', 'Receipt']);
  assert.equal(day.total![3], 700000);
  assert.ok(day.rows.every((r) => typeof r.open === 'string'));
  assert.equal(voucherTarget({ ...ledger.vouchers[0], source: 'auto', link: '/invoice/x', manualId: undefined }), '/invoice/x');

  const tb = buildFrame(ledger, 'tb', [], period, '2025-06-30')!;
  assert.equal(tb.total![0], tb.total![1], 'trial balance agrees');
  const cash = buildFrame(ledger, 'cash', [], period, '2025-06-30')!;
  assert.ok(cash.rows.some((r) => r.id === 'a-cash') && cash.rows.some((r) => r.id === 'a-bank'));
});
