/** R14 PS-C2: FEMA 2026 realisation rows (append-only), the services clock from the invoice date, the INR rule. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { buildRegister, isServicesExport } from '../src/lib/trade/export-register.ts';
import { EXPORT_REALISATION_INR_MONTHS_RULES, EXPORT_REALISATION_MONTHS_RULES, exportRealisationInrMonths, exportRealisationMonths } from '../src/lib/trade/trade-rules.ts';
import { realisationReminders, realisationRule, servicesRows } from '../src/lib/prof/ps-fema.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => resetStorage());

const svc = [{ id: 'l', name: 'Software development', type: 'Service', hsn: '998314', quantity: 1, rate: 6000, tax_rate: 0, amount: 6000 }];
const goods = [{ id: 'g', name: 'Yarn', type: 'Product', hsn: '5205', quantity: 1, rate: 6000, tax_rate: 0, amount: 6000 }];
const exp = (id: string, over: Partial<InvoiceRecord> = {}): Partial<InvoiceRecord> => ({
  id, invoice_number: `EXP/${id}`, doc_type: 'INVOICE', status: 'Sent', supply_type: 'EXPORT_LUT', place_of_supply: '96', currency: 'EUR', total: 6000,
  issue_date: '2026-10-14', client: { name: 'Berlin GmbH' } as InvoiceRecord['client'], items: svc as InvoiceRecord['items'], ...over,
});
const reg = (invoices: Partial<InvoiceRecord>[], today = '2026-11-25') => buildRegister({ invoices, payments: [], irms: [], writeoffs: [], today });

test('rule rows are appended, never edited: 9 → 15 (13 Nov 2025) → 9 (1 Oct 2026); INR 12 from 1 Oct 2026', () => {
  assert.deepEqual(EXPORT_REALISATION_MONTHS_RULES.map((r) => [r.from, r.value]), [['2013-04-01', 9], ['2025-11-13', 15], ['2026-06-05', 9], ['2026-10-01', 9]]);
  assert.equal(exportRealisationMonths('2026-06-04'), 15);
  assert.equal(exportRealisationMonths('2026-09-30'), 9, 'QA17 R9: 9 months from 5 Jun 2026');
  assert.equal(exportRealisationMonths('2026-10-01'), 9);
  assert.equal(EXPORT_REALISATION_INR_MONTHS_RULES[0].from, '2026-10-01');
  assert.equal(exportRealisationInrMonths('2026-10-01'), 12);
  assert.equal(exportRealisationInrMonths('2026-09-15'), 9, 'before the INR rule: the FX rule (9 from 5 Jun 2026, QA17 R9)');
  assert.deepEqual(realisationRule('2026-10-01', true), { months: 12, rule: 'inr' });
  assert.deepEqual(realisationRule('2026-09-01', true), { months: 9, rule: 'fx' });
  assert.deepEqual(realisationRule('2026-05-01', true), { months: 15, rule: 'fx' });
});

test('services exports: clock from the invoice date, never flagged; 9 months from 1 Oct 2026, and from 5 Jun 2026 (QA17 R9)', () => {
  const [oct, sep] = reg([exp('1'), exp('2', { issue_date: '2026-09-15' })]).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate)).reverse();
  assert.deepEqual([oct.services, oct.sbMissing, oct.shipDate, oct.months, oct.dueDate], [true, false, '2026-10-14', 9, '2027-07-14']);
  assert.deepEqual([sep.months, sep.dueDate], [9, '2027-06-15']);
  // A typed shipping-bill date does not move a services clock.
  assert.equal(reg([exp('3', { shipping_bill_date: '2026-11-30', shipping_bill_no: 'X' })])[0].shipDate, '2026-10-14');
});

test('INR-invoiced exports take the INR rule; goods move to 9 months from 1 Oct 2026, older shipments unchanged', () => {
  const [inr] = reg([exp('1', { currency: 'INR' })]);
  assert.deepEqual([inr.months, inr.inrRule, inr.dueDate], [12, true, '2027-10-14']);
  const g = reg([
    exp('g1', { items: goods as InvoiceRecord['items'], shipping_bill_no: 'SB1', shipping_bill_date: '2026-10-05' }),
    exp('g2', { items: goods as InvoiceRecord['items'], shipping_bill_no: 'SB2', shipping_bill_date: '2026-02-05', issue_date: '2026-02-04' }),
  ]);
  const by = new Map(g.map((r) => [r.invoiceId, r]));
  assert.deepEqual([by.get('g1')!.months, by.get('g1')!.services], [9, undefined]);
  assert.equal(by.get('g2')!.months, 15);
  // Mixed documents keep the shipping-bill clock; no lines = not services.
  assert.equal(isServicesExport({ items: [...svc, ...goods] as InvoiceRecord['items'] }), false);
  assert.equal(isServicesExport({ items: [] }), false);
  assert.equal(isServicesExport({ items: [{ ...goods[0], type: 'item', hsn: '998313' }] as InvoiceRecord['items'] }), true);
});

test('services view: "settled in INR" takes 12 months; reminders 30 days ahead and past due', () => {
  const invs = [exp('1', { ps: { export: { inr_settled: true } } } as Partial<InvoiceRecord>), exp('2', { issue_date: '2026-01-10', items: svc as InvoiceRecord['items'] }), exp('g', { items: goods as InvoiceRecord['items'] })];
  const rows = servicesRows(reg(invs, '2027-07-20'), invs, '2027-07-20');
  assert.deepEqual(rows.map((r) => r.invoiceId).sort(), ['1', '2']);
  const one = rows.find((r) => r.invoiceId === '1')!;
  assert.deepEqual([one.months, one.inrRule, one.dueDate, one.status], [12, true, '2027-10-14', 'open']);
  const rem = realisationReminders(servicesRows(reg(invs, '2027-04-01'), invs, '2027-04-01'));
  assert.deepEqual(rem.map((r) => `${r.row.invoiceId}:${r.kind}`), ['2:soon']); // 10 Jan 2026 + 15 months = 10 Apr 2027
  assert.deepEqual(realisationReminders(servicesRows(reg(invs, '2027-05-01'), invs, '2027-05-01')).map((r) => r.kind), ['past']);
});
