/**
 * P1-13 Voucher Types master: numbering per type (prefix / suffix / start / yearly or monthly restart,
 * never reused), the Indian-FY default untouched, invoices / manual vouchers / POS integration.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, createViaStore, clientMH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { useInvoiceStore } from '../src/store/useInvoiceStore.ts';
import {
  BUILT_IN_PREFIX,
  deleteVoucherType,
  documentDefaults,
  loadVoucherTypes,
  numberingExample,
  posVoucherType,
  saveVoucherType,
  typesForDoc,
  validateVoucherType,
} from '../src/lib/voucher-types.ts';
import { seriesPrefix, typedNumber } from '../src/lib/voucher-series.ts';
import { loadVouchers, saveVoucher } from '../src/lib/ledger/vouchers.ts';
import { A } from '../src/lib/ledger/accounts.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const line = [{ qty: 1, rate: 1000 }];

test('typedNumber: prefix / FY / padded sequence / suffix, start number, monthly restart', () => {
  const s = { id: 't', base: 'SALES' as const, prefix: 'EXP', suffix: '-E', start_number: 101, width: 5 };
  assert.equal(typedNumber(s, '2026-04-02', [], 0), 'EXP/FY26-27/00101-E');
  assert.equal(typedNumber(s, '2026-04-02', ['EXP/FY26-27/00140-E', 'EXP/FY26-27/00900'], 0), 'EXP/FY26-27/00141-E');
  // High-water mark wins over the existing numbers (a deleted latest number is not reused).
  assert.equal(typedNumber(s, '2026-04-02', ['EXP/FY26-27/00140-E'], 150), 'EXP/FY26-27/00151-E');
  const m = { id: 'm', base: 'SALES' as const, prefix: 'RET', restart: 'monthly' as const };
  assert.equal(seriesPrefix(m, '2026-05-31'), 'RET-05');
  assert.equal(typedNumber(m, '2026-05-31', ['RET-04/FY26-27/0009'], 0), 'RET-05/FY26-27/0001');
  // 31 March is still the previous FY in every zone (local day parsing).
  assert.equal(typedNumber({ id: 'y', base: 'SALES', prefix: 'YR' }, '2027-03-31', [], 0), 'YR/FY26-27/0001');
});

test('validation: name / prefix unique, built-in prefixes reserved, base-specific defaults', () => {
  const ok = { name: 'Sales – Export', base: 'SALES' as const, prefix: 'EXP' };
  assert.deepEqual(validateVoucherType(ok, []), []);
  assert.match(validateVoucherType({ ...ok, prefix: 'INV' }, [])[0], /built-in/);
  assert.deepEqual(validateVoucherType({ ...ok, prefix: 'INV', suffix: 'E' }, []), []);
  assert.match(validateVoucherType({ ...ok, prefix: 'ex p' }, [])[0], /Prefix/);
  const saved = saveVoucherType(ok);
  assert.match(validateVoucherType({ ...ok, prefix: 'EX2' }, loadVoucherTypes())[0], /already exists/);
  assert.match(validateVoucherType({ name: 'Other', base: 'CREDIT_NOTE', prefix: 'EXP' }, loadVoucherTypes())[0], /prefix and suffix/);
  assert.match(validateVoucherType({ name: 'R', base: 'RECEIPT', prefix: 'RC', godown_id: 'g' }, [])[0], /godown/);
  assert.match(validateVoucherType({ name: 'P', base: 'PAYMENT', prefix: 'PC', use_for_pos: true }, [])[0], /POS/);
  assert.equal(saved.base, 'SALES');
  assert.equal(BUILT_IN_PREFIX.SALES, 'INV');
});

test('no user type: the Indian-FY default series is unchanged (Critical Rule 4)', () => {
  saveVoucherType({ name: 'Sales – Export', base: 'SALES', prefix: 'EXP' });
  const a = createViaStore({ date: '2026-04-10', client: clientMH, lines: line });
  assert.equal(a.invoice_number, 'INV/FY26-27/0001');
  assert.equal(a.voucher_type_id, undefined);
  assert.equal(localDb.invoices.nextNumber('2026-04-11'), 'INV/FY26-27/0002');
});

test('invoice in a user type: own series, print title snapshot, never reused after delete', () => {
  const t = saveVoucherType({ name: 'Sales – Export', base: 'SALES', prefix: 'EXP', print_title: 'Export Invoice', start_number: 5 });
  const st = () => useInvoiceStore.getState();
  st().newDraft('INVOICE');
  st().setClient(clientMH);
  st().setDates('2026-06-01', '2026-06-01');
  st().patch(documentDefaults(t));
  st().updateItem(st().items[0].id, 'name', 'Goods');
  st().updateItem(st().items[0].id, 'rate', 500);
  const r1 = st().saveInvoice();
  assert.ok(r1.ok, r1.errors.join());
  assert.equal(r1.record?.invoice_number, 'EXP/FY26-27/0005');
  assert.equal(r1.record?.print_title, 'Export Invoice');
  assert.equal(r1.record?.voucher_type_id, t.id);
  // The default series is not consumed.
  assert.equal(localDb.invoices.nextNumber('2026-06-01'), 'INV/FY26-27/0001');
  assert.equal(localDb.invoices.nextNumber('2026-06-01', 'INVOICE', undefined, t.id), 'EXP/FY26-27/0006');
  // Deleting the latest document does not free its number (series_counters).
  setTable('invoices', []);
  assert.equal(localDb.invoices.nextNumber('2026-06-01', 'INVOICE', undefined, t.id), 'EXP/FY26-27/0006');
  // A sales type never numbers a credit note.
  assert.equal(localDb.invoices.nextNumber('2026-06-01', 'CREDIT_NOTE', undefined, t.id), 'CRN/FY26-27/0001');
  // Changing the document to another base drops the type.
  st().newDraft('INVOICE');
  st().patch(documentDefaults(t));
  st().setDocType('CREDIT_NOTE');
  assert.equal(st().voucher_type_id, undefined);
  assert.equal(st().print_title, undefined);
  // A used type cannot be deleted.
  setTable('invoices', [{ ...r1.record!, id: 'x1' }]);
  assert.throws(() => deleteVoucherType(t.id), /inactive/);
});

test('picker list, POS type, inactive types and documentDefaults', () => {
  const a = saveVoucherType({ name: 'Sales – Retail', base: 'SALES', prefix: 'RET', use_for_pos: true, template_id: 'gst_classic', godown_id: 'g1' });
  const b = saveVoucherType({ name: 'Sales – Counter', base: 'SALES', prefix: 'CTR', use_for_pos: true });
  saveVoucherType({ name: 'Notes', base: 'CREDIT_NOTE', prefix: 'CN-B' });
  assert.deepEqual(typesForDoc('INVOICE').map((t) => t.name), ['Sales – Counter', 'Sales – Retail']);
  assert.equal(typesForDoc('QUOTATION').length, 0);
  assert.equal(posVoucherType()?.id, b.id, 'only one POS type: the last one marked wins');
  assert.equal(loadVoucherTypes().find((t) => t.id === a.id)?.use_for_pos, undefined);
  saveVoucherType({ ...a, inactive: true });
  assert.deepEqual(typesForDoc('INVOICE').map((t) => t.name), ['Sales – Counter']);
  assert.deepEqual(documentDefaults(a), { voucher_type_id: a.id, print_title: undefined, template_id: 'gst_classic', godown_id: 'g1' });
  assert.deepEqual(documentDefaults(undefined), { voucher_type_id: undefined, print_title: undefined });
  assert.equal(numberingExample({ prefix: 'rc', restart: 'monthly' }, '2026-07-15'), 'RC-07/FY26-27/0001');
});

test('manual vouchers: a receipt type numbers its own series; editing keeps the number', () => {
  const t = saveVoucherType({ name: 'Receipt – Cash', base: 'RECEIPT', prefix: 'RCASH', bank_account_id: A.cash });
  const lines = [
    { account_id: A.cash, dr: 10000, cr: 0 },
    { account_id: A.sales, dr: 0, cr: 10000 },
  ];
  const v1 = saveVoucher({ type: 'RECEIPT', date: '2026-04-05', narration: 'a', lines, voucher_type_id: t.id });
  assert.equal(v1.number, 'RCASH/FY26-27/0001');
  assert.equal(v1.voucher_type_id, t.id);
  const v2 = saveVoucher({ type: 'RECEIPT', date: '2026-04-06', narration: 'b', lines });
  assert.equal(v2.number, 'RV/FY26-27/0001', 'default receipt series unaffected');
  // Inactive type: an edit keeps both the type and the number.
  saveVoucherType({ ...t, inactive: true });
  const e = saveVoucher({ ...v1, narration: 'edited' });
  assert.equal(e.number, 'RCASH/FY26-27/0001');
  assert.equal(loadVouchers().find((v) => v.id === v1.id)?.voucher_type_id, t.id);
  assert.ok(getTable<{ id: string }>('series_counters').some((r) => r.id === 'RCASH/FY26-27'));
});
