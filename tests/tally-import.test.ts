/**
 * WP-7 P0-7: Tally XML import — safe parsing, mapping / dry-run plan, applying through the WP-1 and
 * ledger APIs, opening TB to the paisa, re-import duplicate detection, roles, no GST documents.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { TALLY_FIXTURE } from './tally-fixture.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { audit } from '../src/lib/audit.ts';
import { getTable, readRaw, writeRaw } from '../src/lib/storage.ts';
import { A, ledgerBalanceSheet, loadLedger, loadStockValuer, loadOpenings, loadUserAccounts, loadUserGroups, loadVouchers, openingDifference, partyLedgerId } from '../src/lib/ledger/index.ts';
import { loadOpeningBills } from '../src/lib/opening-bills.ts';
import { decodeTallyBytes, parseXmlLite, sanitizeTallyXml, TallyXmlError, xmlNodeFromDom } from '../src/lib/tally-xml-read.ts';
import { parseTallyXml, planTallyImport, suggestBooksBegin, tallyDay, tallyPaise, voucherTag } from '../src/lib/tally-import.ts';
import { applyTallyImport, loadExistingBooks, openingCheck } from '../src/lib/tally-import-apply.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadCostCentres } from '../src/lib/cost-centres.ts';
import { stockDb } from '../src/lib/inventory.ts';

beforeEach(() => {
  resetStorage();
  setActorProvider(null);
});

const BOOKS = '2025-04-01';
const plan = () => planTallyImport(parseTallyXml(TALLY_FIXTURE), loadExistingBooks(), { booksBegin: BOOKS });

test('reading: amounts keep Tally signs, dates are local days, forex text takes the rupee part', () => {
  assert.equal(tallyPaise('-1180.00'), -118000);
  assert.equal(tallyPaise('1,180.50'), 118050);
  assert.equal(tallyPaise('$100.00 @ ₹ 82.50/$ = ₹ 8250.00'), 825000);
  assert.equal(tallyPaise('-0.005'), -1);
  assert.equal(tallyPaise(''), 0);
  assert.equal(tallyDay('20250401'), '2025-04-01');
  assert.equal(tallyDay('20250231'), '', 'impossible day');
});

test('safe XML: &#4; markers and control characters removed, DOCTYPE / ENTITY refused, entities decoded', () => {
  assert.equal(sanitizeTallyXml('<A>x&#4;y&#x1F;z\u0001</A>'), '<A>xyz</A>');
  assert.throws(() => parseXmlLite('<!DOCTYPE x [<!ENTITY a "aaaa">]><A>&a;</A>'), TallyXmlError);
  assert.throws(() => parseXmlLite('<A><!ENTITY b SYSTEM "file:///etc/passwd"></A>'), TallyXmlError);
  const root = parseXmlLite('<?xml version="1.0"?><!-- c --><A k="1 &amp; 2"><B>&lt;b&gt; &#8377;5</B><C/><![CDATA[<raw>]]></A>');
  const a = root.children[0];
  assert.equal(a.attrs.k, '1 & 2');
  assert.equal(a.children[0].text, '<b> ₹5');
  assert.equal(a.children[1].name, 'C');
  assert.match(a.text, /<raw>/);
  assert.throws(() => parseXmlLite('<A><B>'.repeat(1) + '<C'), TallyXmlError, 'truncated file');
});

test('UTF-16 exports (Tally default) decode, with and without a BOM', () => {
  const text = '<ENVELOPE><X>₹ Acme</X></ENVELOPE>';
  const le = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    le[i * 2] = text.charCodeAt(i) & 0xff;
    le[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  assert.equal(decodeTallyBytes(new Uint8Array([0xff, 0xfe, ...le])), text);
  assert.equal(decodeTallyBytes(le), text);
  assert.equal(decodeTallyBytes(new TextEncoder().encode(text)), text);
});

test('a DOM tree converts to the same shape as the built-in parser', () => {
  const dom = {
    nodeType: 9, nodeName: '#document', nodeValue: null,
    childNodes: [{ nodeType: 1, nodeName: 'A', nodeValue: null, attributes: [{ name: 'k', value: 'v' }], childNodes: [{ nodeType: 3, nodeName: '#text', nodeValue: 'hi', childNodes: [] }] }],
  };
  assert.deepEqual(xmlNodeFromDom(dom), parseXmlLite('<A k="v">hi</A>'));
});

test('parse: masters, custom voucher type, invoice-view allocations, cost centres, cancelled flag', () => {
  const p = parseTallyXml(TALLY_FIXTURE);
  assert.equal(p.company, 'Demo Traders & Co');
  assert.equal(p.ledgers.length, 11);
  const acme = p.ledgers.find((l) => l.name === 'Acme Retail')!;
  assert.equal(acme.opening, 6000000, 'Tally -60000.00 = 60,000 Dr');
  assert.equal(acme.gstin, '27AAACA1234A1ZK');
  assert.equal(acme.creditDays, 30);
  assert.equal(acme.address, '12 MG Road, Pune');
  assert.deepEqual(acme.bills.map((b) => [b.ref, b.date, b.paise]), [['A-1', '2025-02-10', 4000000], ['A-2', '2025-03-15', 2000000]]);
  assert.equal(p.ledgers.find((l) => l.name === 'Profit & Loss A/c')!.parent, '', '"Primary" is no parent');
  assert.equal(p.stockItems[0].openingValue, 2000000);
  assert.equal(p.stockItems[0].openingQty, 100);
  assert.equal(p.stockItems[0].gstRate, 18);
  const sale = p.vouchers.find((v) => v.number === '101')!;
  assert.equal(sale.base, 'Sales', 'custom "Sales GST" resolved through its VOUCHERTYPE master');
  assert.equal(sale.lines.reduce((s, l) => s + l.paise, 0), 0, 'balanced');
  assert.deepEqual(sale.lines.find((l) => l.ledger === 'Sales')!.costCentres, [{ name: 'Pune Branch', paise: 600000 }, { name: 'Mumbai Branch', paise: 400000 }]);
  assert.ok(sale.hasInventory);
  assert.equal(p.vouchers.find((v) => v.number === 'R-1')!.narration, 'NEFT from Acme');
  assert.ok(p.vouchers.find((v) => v.number === 'J-1')!.cancelled);
  assert.throws(() => parseTallyXml('<NOTTALLY/>'), /not a Tally XML export/);
});

test('plan: groups, ledger mapping, opening TB, voucher statuses (dry run writes nothing)', () => {
  const pl = plan();
  assert.deepEqual(pl.groups.map((g) => [g.name, g.parent, g.primary]), [['Retail Debtors', 'TRADE_RECEIVABLES', 'TRADE_RECEIVABLES'], ['Office Expenses', 'INDIRECT_EXPENSES', 'INDIRECT_EXPENSES']]);
  const t = (n: string) => pl.ledgers.find((l) => l.rec.name === n)!.target;
  assert.deepEqual(t('Capital Account'), { kind: 'account', accountId: A.capital, existing: true });
  assert.deepEqual(t('Profit & Loss A/c'), { kind: 'account', accountId: A.reserves, existing: true });
  assert.deepEqual(t('Cash'), { kind: 'account', accountId: A.cash, existing: true });
  assert.deepEqual(t('CGST'), { kind: 'account', accountId: A.outCgst, existing: true });
  assert.deepEqual(t('Sales'), { kind: 'account', accountId: A.sales, existing: true });
  assert.equal(t('HDFC Bank').kind, 'account');
  assert.deepEqual(t('Stationery'), { kind: 'account', existing: false, group: 'INDIRECT_EXPENSES', underGroup: 'Office Expenses', code: 'T0003' });
  assert.deepEqual(t('Acme Retail'), { kind: 'client', groupName: 'Retail Debtors' });
  assert.deepEqual(t('Sharma Supplies'), { kind: 'vendor' });
  assert.deepEqual(pl.openingTotals, { dr: 29500000, cr: 29500000, diff: 0 });
  assert.equal(pl.stockOpening, 2000000, 'stock item value goes to Stock-in-hand (no ledger opening there)');
  const st = Object.fromEntries(pl.vouchers.map((v) => [v.rec.number, [v.status, v.type]]));
  assert.deepEqual(st, {
    101: ['ok', 'JOURNAL'], 'R-1': ['ok', 'RECEIPT'], 'P-1': ['ok', 'PAYMENT'], 'C-1': ['ok', 'CONTRA'],
    'J-1': ['cancelled', 'JOURNAL'], 'P-0': ['before_books', 'PAYMENT'],
  });
  assert.equal(pl.costCentres.length, 2);
  assert.ok(pl.warnings.some((w) => /not GST documents/.test(w)));
  assert.equal(suggestBooksBegin(parseTallyXml(TALLY_FIXTURE), '2026-01-01'), '2024-04-01');
  assert.equal(getTable('accounts').length + getTable('clients').length + getTable('vouchers').length, 0, 'planning writes nothing');
});

test('apply: masters via WP-1 APIs, openings match Tally to the paisa, vouchers as manual vouchers only', () => {
  const pl = plan();
  const res = applyTallyImport(pl);
  assert.deepEqual(res.failed, []);
  assert.equal(res.groups, 2);
  assert.equal(res.accounts, 3, 'HDFC Bank, Office Furniture, Stationery');
  assert.equal(res.clients, 1);
  assert.equal(res.vendors, 1);
  assert.equal(res.vouchers, 4);
  assert.equal(res.openingBills, 3);

  const groups = loadUserGroups();
  const retail = groups.find((g) => g.name === 'Retail Debtors')!;
  const acme = localDb.clients.getAll().find((c) => c.name === 'Acme Retail')!;
  assert.equal(acme.group_id, retail.id);
  assert.equal(acme.gstin, '27AAACA1234A1ZK');
  assert.equal(acme.state_code, '27');
  assert.equal(acme.credit_days, 30);
  const sharma = vendorsDb.all().find((v) => v.name === 'Sharma Supplies')!;
  assert.equal(sharma.state_code, '29');
  const stationery = loadUserAccounts().find((a) => a.name === 'Stationery')!;
  assert.equal(stationery.group, 'INDIRECT_EXPENSES');
  assert.equal(stationery.under, groups.find((g) => g.name === 'Office Expenses')!.id);

  const op = new Map(loadOpenings().map((o) => [o.ledger_id, o.dr - o.cr]));
  assert.equal(op.get(partyLedgerId('debtor', acme.id!)), 6000000);
  assert.equal(op.get(partyLedgerId('creditor', sharma.id)), -1500000);
  assert.equal(op.get(A.reserves), -3000000);
  assert.equal(op.get(A.stock), 2000000);
  assert.equal(openingDifference(loadOpenings()), 0, 'opening TB balances like Tally');
  const check = openingCheck(pl, res.ledgerIds);
  assert.ok(check.matches, JSON.stringify(check.rows));
  assert.deepEqual(loadOpeningBills().map((b) => [b.ref_no, b.side, b.amount, b.dr_cr]).sort(), [['A-1', 'receivable', 40000, 'Dr'], ['A-2', 'receivable', 20000, 'Dr'], ['S-9', 'payable', 15000, 'Cr']]);

  const vs = loadVouchers();
  assert.equal(vs.length, 4);
  const sale = vs.find((v) => v.narration.includes('#101'))!;
  assert.equal(sale.type, 'JOURNAL');
  assert.equal(sale.voucher_class, 'Tally import');
  assert.match(sale.narration, /Tally Sales GST #101, 10 widgets \[tally:[0-9a-f]{12}\]/);
  const debtorLine = sale.lines.find((l) => l.account_id === A.debtors)!;
  assert.deepEqual([debtorLine.dr, debtorLine.party], [1180000, 'Acme Retail']);
  const centres = loadCostCentres();
  assert.deepEqual(sale.lines.filter((l) => l.account_id === A.sales).map((l) => [l.cr, centres.find((c) => c.id === l.cost_centre_id)?.name]), [[600000, 'Pune Branch'], [400000, 'Mumbai Branch']]);
  assert.equal(vs.find((v) => v.type === 'CONTRA')!.lines.length, 2);
  assert.equal(getTable('invoices').length + getTable('purchases').length, 0, 'never an invoice or a bill: nothing reaches GSTR papers');
  assert.equal(stockDb.items()[0].opening_rate, 200);

  const rows = audit.all();
  assert.ok(rows.some((r) => r.action === 'import' && /finished/.test(r.summary)));
  assert.ok(rows.some((r) => r.entity === 'voucher' && r.action === 'create'));
});

test('H1: imported opening stock is counted once on the balance sheet (stock items + Stock-in-hand opening)', () => {
  applyTallyImport(plan());
  const bs = ledgerBalanceSheet(loadLedger(), '2025-04-30', loadStockValuer());
  const inv = bs.assets.flatMap((s) => s.items).find((i) => i.label === 'Inventories');
  // 100 Widgets at ₹200 opening, once; since 7.49 the sales voucher's 10 Widgets leave stock (stock move): 90 × ₹200.
  assert.equal(inv?.amount, 1800000, JSON.stringify(inv));
  assert.equal(bs.difference, 0);
});

test('H1: at the year end the imported opening stock is still counted once', () => {
  applyTallyImport(plan());
  const bs = ledgerBalanceSheet(loadLedger(), '2026-03-31', loadStockValuer());
  const inv = bs.assets.flatMap((s) => s.items).find((i) => i.label === 'Inventories');
  assert.equal(inv?.amount, 1800000, 'opening once, less the 10 Widgets sold (7.49)');
  assert.equal(bs.difference, 0);
});

test('re-import: everything is recognised, nothing is added twice', async () => {
  applyTallyImport(plan());
  await Promise.resolve();
  const again = plan();
  assert.equal(again.counts.groupsNew, 0);
  assert.equal(again.counts.accountsNew, 0);
  assert.equal(again.counts.clientsNew + again.counts.vendorsNew, 0);
  assert.equal(again.counts.vouchersOk, 0);
  assert.equal(again.counts.vouchersDuplicate, 4);
  const res = applyTallyImport(again);
  assert.equal(res.vouchers + res.groups + res.accounts + res.clients + res.vendors, 0);
  assert.equal(loadVouchers().length, 4);
  assert.equal(openingDifference(loadOpenings()), 0);
});

test('voucher fingerprint uses the GUID when there is one, else type + date + number + amount', () => {
  const base = { guid: '', vtype: 'Payment', date: '2025-04-01', number: '7', lines: [{ ledger: 'x', paise: 100, costCentres: [] }, { ledger: 'y', paise: -100, costCentres: [] }] };
  assert.equal(voucherTag(base), voucherTag({ ...base }));
  assert.notEqual(voucherTag(base), voucherTag({ ...base, number: '8' }));
  assert.equal(voucherTag({ ...base, guid: 'g1' }), voucherTag({ ...base, guid: 'g1', number: '9' }));
});

test('locked period and unknown ledgers are reported, not imported', () => {
  const parsed = parseTallyXml(TALLY_FIXTURE);
  const pl = planTallyImport(parsed, { ...loadExistingBooks(), lockUntil: '2025-04-12' }, { booksBegin: BOOKS, includeOpenings: false });
  const st = Object.fromEntries(pl.vouchers.map((v) => [v.rec.number, v.status]));
  assert.equal(st['101'], 'locked');
  assert.equal(st['R-1'], 'locked');
  assert.equal(st['P-1'], 'ok');
  const noMasters = { ...parsed, ledgers: [], groups: [] };
  const pl2 = planTallyImport(noMasters, loadExistingBooks(), { booksBegin: BOOKS });
  assert.equal(pl2.vouchers.find((v) => v.rec.number === 'P-1')!.status, 'error');
  assert.match(pl2.vouchers.find((v) => v.rec.number === 'P-1')!.reason!, /Stationery/);
  assert.equal(pl2.vouchers.find((v) => v.rec.number === 'C-1')!.status, 'error', 'HDFC Bank unknown');
});

test('roles: only the owner may import (data.restore)', () => {
  setActorProvider(() => ({ id: 'u1', name: 'Clerk', role: 'clerk' }));
  try {
    assert.throws(() => applyTallyImport(plan()), /cannot/);
  } finally {
    setActorProvider(null);
  }
  assert.equal(loadVouchers().length, 0);
});

test('L2: Tally names like "constructor" / "__proto__" / "toString" are plain names, never object keys', () => {
  const extra = `
    <TALLYMESSAGE><GROUP NAME="constructor" ACTION="Create"><PARENT>Indirect Expenses</PARENT></GROUP></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="toString" ACTION="Create"><PARENT>constructor</PARENT></LEDGER></TALLYMESSAGE>
    <TALLYMESSAGE><LEDGER NAME="__proto__" ACTION="Create"><PARENT>Indirect Expenses</PARENT></LEDGER></TALLYMESSAGE>`;
  const xml = TALLY_FIXTURE.replace('</REQUESTDATA>', `${extra}</REQUESTDATA>`);
  const pl = planTallyImport(parseTallyXml(xml), loadExistingBooks(), { booksBegin: BOOKS });
  assert.ok(pl.groups.some((g) => g.name === 'constructor' && g.primary === 'INDIRECT_EXPENSES'), JSON.stringify(pl.groups));
  const ts = pl.ledgers.find((l) => l.rec.name === 'toString')!;
  assert.equal(ts.primary, 'INDIRECT_EXPENSES');
  const res = applyTallyImport(pl);
  assert.deepEqual(res.failed, []);
  assert.equal(typeof res.ledgerIds['__proto__'], 'string');
  assert.ok(Object.hasOwn(res.ledgerIds, '__proto__'));
  assert.equal(typeof res.ledgerIds['tostring'], 'string');
  assert.equal(res.ledgerIds['constructor'], undefined, 'no inherited value for a name that was not imported');
  assert.ok(loadUserAccounts().some((a) => a.name === '__proto__'));
  assert.ok(openingCheck(pl, res.ledgerIds).matches);
});

test('L3: a failed import rolls back the books but keeps this company’s folder-sync state', () => {
  writeRaw('mrchartist_inv_sync_state', '{"keys":{},"clock":7}');
  writeRaw('mrchartist_inv_sync_conflicts', '[{"id":"c1"}]');
  const pl = plan();
  // Make the import fail half-way with an unexpected error (a ledger master write that throws).
  const broken = { ...pl, groups: [...pl.groups, { name: '', parent: 'nope', parentIsPrimary: false, primary: 'INDIRECT_EXPENSES' }] } as typeof pl;
  assert.throws(() => applyTallyImport(broken));
  assert.equal(getTable('accounts').length, 0, 'books rolled back');
  assert.equal(readRaw('mrchartist_inv_sync_state'), '{"keys":{},"clock":7}');
  assert.equal(readRaw('mrchartist_inv_sync_conflicts'), '[{"id":"c1"}]');
});
