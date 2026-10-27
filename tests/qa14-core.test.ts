/**
 * QA round 14 — whole-app regression pass on the core paths of a plain company (no packs). Each finding of
 * `docs/prd/qa-round-14.md` has a regression here (Q1 … Qn).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, freezeDate, inTimeZones, resetStorage, thawDate } from './helpers/shim.ts';
import { SELLER, createViaStore, gstin, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, getTable, readRaw, setTable, writeRaw } from '../src/lib/storage.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { branchesDb } from '../src/lib/branch.ts';
import { buildTransferPair } from '../src/lib/branch-transfer.ts';
import { buildTallyModel } from '../src/lib/tally-xml.ts';
import { chartOf, A } from '../src/lib/ledger/accounts.ts';
import { deleteVoucher, loadVouchers, saveVoucher } from '../src/lib/ledger/vouchers.ts';
import { BIN_TABLE, restoreEntry } from '../src/lib/trust/recycle-bin.ts';
import { withCancel } from '../src/lib/einvoice-cancel.ts';
import { BACKUP_RECORD_TABLES, buildBackup, parseBackup, restoreBackup, wipeAppData } from '../src/lib/backup.ts';
import { fullSource } from './export-fixtures.ts';
import { readFileSync } from 'node:fs';
import { amountInWords } from '../src/lib/amount-in-words.ts';
import { amountInWordsHi } from '../src/lib/amount-in-words-hi.ts';
import type { StockTransfer } from '../src/types/stock.ts';
import type { BinEntry } from '../src/types/trade-r4.ts';
import type { EInvoiceMeta } from '../src/lib/einvoice.ts';

beforeEach(() => {
  setActorProvider(null);
  resetStorage();
  installSettings();
  freezeDate('2026-08-01T10:00:00');
});
afterEach(() => thawDate());

test('Q1: a branch transfer typed in an alternate unit is billed in base units at the per-unit cost', () => {
  const mh = branchesDb.save({ name: 'Mumbai HO', profile_id: SELLER.id, gstin: SELLER.companyGstin });
  const ka = branchesDb.save({ name: 'Bengaluru', gstin: gstin('29AABCU9603R1Z') });
  const items = [{ id: 'it1', name: 'Widget', hsn: '8471', unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, tax_rate: 18 }];
  // 10 BOX of 12 = 120 pieces; the dialog's rate is per piece (average cost ₹100).
  const t: StockTransfer = { id: 's1', transfer_number: 'STR/FY26-27/0001', date: '2026-08-01', from_godown: 'a', to_godown: 'b', lines: [{ id: 'tl1', item_id: 'it1', qty: 10, unit: 'BOX', unit_factor: 12 }] };
  const pair = buildTransferPair({ transfer: t, from: mh, to: ka, items, rates: { tl1: 100 }, settings: localDb.settings.get(), profile: SELLER, invoiceId: 'i', invoiceNumber: 'X', billId: 'b', newId: () => 'n' });
  assert.equal(pair.invoice.items[0].quantity, 120);
  assert.equal(pair.invoice.items[0].unit, 'NOS');
  assert.equal(pair.invoice.taxable_value, 12000, 'was 1,000 (10 × the per-piece cost)');
  assert.equal(pair.invoice.igst_amount, 2160);
  assert.equal(pair.bill.lines[0].quantity, 120);
  assert.equal(pair.bill.taxable, 12000);
});

test('Q2: a hand-entered journal whose class matches a module class restores from the bin', () => {
  const v = saveVoucher({ type: 'JOURNAL', date: '2026-07-10', narration: 'Loan from director', voucher_class: 'Loan', lines: [{ account_id: A.bank, dr: 500000, cr: 0 }, { account_id: A.capital, dr: 0, cr: 500000 }] });
  deleteVoucher(v.id);
  assert.equal(loadVouchers().length, 0);
  const e = getTable<BinEntry>(BIN_TABLE).find((b) => b.table === 'vouchers' && b.row_id === v.id)!;
  restoreEntry(e.id);
  assert.equal(loadVouchers().find((x) => x.id === v.id)?.voucher_class, 'Loan', 'refused before: "was undone where it was posted"');
  // A company that uses business loans still guards that class (the module may have undone it).
  setTable('business_loans', [{ id: 'bl1', lender: 'Bank' }]);
  const w = saveVoucher({ type: 'JOURNAL', date: '2026-07-11', narration: 'EMI', voucher_class: 'Loan', lines: [{ account_id: A.bank, dr: 100, cr: 0 }, { account_id: A.capital, dr: 0, cr: 100 }] });
  deleteVoucher(w.id);
  const e2 = getTable<BinEntry>(BIN_TABLE).find((b) => b.table === 'vouchers' && b.row_id === w.id)!;
  assert.throws(() => restoreEntry(e2.id), /post it twice/);
});

test('Q5: an e-invoice cancel marked done just after midnight is dated the local day', () => {
  const meta = { invoice_id: 'i1', irn: 'x' } as unknown as EInvoiceMeta;
  inTimeZones(ZONES, (tz) => {
    const at = new Date(2026, 9, 25, 0, 30); // 25 Oct 00:30 local (IST: 24 Oct 19:00 UTC)
    assert.equal(withCancel(meta, 'irn', { status: 'done' }, at).irn_cancel?.done_on, '2026-10-25', tz);
  });
});

test('Q3: Tally stock journal — a transfer line in an alternate unit goes out in the item base unit', () => {
  const src = { ...fullSource(), books: { today: '2026-08-01', chart: chartOf([]), stockItems: [{ id: 'i1', name: 'Widget', unit: 'nos' }], godowns: [{ id: 'g2', name: 'Warehouse 2' }], stockTransfers: [{ id: 't1', transfer_number: 'STR/FY26-27/0002', date: '2026-07-25', from_godown: 'main', to_godown: 'g2', lines: [{ id: 'l1', item_id: 'i1', qty: 5, unit: 'BOX', unit_factor: 12 }] }] } };
  const b = buildTallyModel(src as never, { companyName: 'X' });
  const sj = b.vouchers.find((v) => v.type === 'Stock Journal')!;
  assert.deepEqual(sj.stock?.lines.map((l) => [l.qty, l.unit]), [[60, 'NOS']]);
});

test('Q4: amount in words at ₹1,000 crore and above (never "undefined Hundred Crore")', () => {
  assert.equal(amountInWords(1e11), 'Rupees Ten Thousand Crore Only');
  assert.equal(amountInWords(12e9), 'Rupees One Thousand Two Hundred Crore Only', 'same words as the Hindi line (एक हज़ार दो सौ करोड़)');
  assert.match(amountInWordsHi(12e9), /एक हज़ार दो सौ करोड़/);
  assert.equal(amountInWords(1e12 + 0.5), 'Rupees One Lakh Crore and Fifty Paise Only');
  assert.equal(amountInWords(2e12, 'USD'), 'Dollars Two Thousand Billion Only');
  assert.equal(amountInWords(99_99_99_999.99), 'Rupees Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine and Ninety Nine Paise Only', 'below 1,000 crore unchanged');
});

test('Q6: the paper reads receipt rows without copying the table (it renders on every keystroke of the live preview)', () => {
  const src = readFileSync(new URL('../src/components/templates/paper-helpers.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bgetTable\b/, 'peekTable only: a 20,000-row receipts table was copied row by row on each render');
});

test('backup → wipe → restore round-trips every record table (R7–R12 included) of a plain company', () => {
  createViaStore({ date: '2026-07-01', lines: [{ qty: 1, rate: 100 }] });
  for (const t of BACKUP_RECORD_TABLES) if (!readRaw(DB_PREFIX + t)) writeRaw(DB_PREFIX + t, JSON.stringify([{ id: `${t}-1`, date: '2026-07-01', name: t }]));
  const before = Object.fromEntries(BACKUP_RECORD_TABLES.map((t) => [t, readRaw(DB_PREFIX + t)]));
  const text = JSON.stringify(buildBackup());
  wipeAppData();
  assert.equal(readRaw(DB_PREFIX + 'hotel_folios'), null);
  restoreBackup(parseBackup(text).data);
  assert.match(readRaw(DB_PREFIX + 'audit_log') ?? '', /restored from a backup/i, 'the edit log carries the restore marker on top');
  for (const t of BACKUP_RECORD_TABLES) if (t !== 'audit_log') assert.deepEqual(JSON.parse(readRaw(DB_PREFIX + t) ?? 'null'), JSON.parse(before[t] ?? 'null'), t);
});
