/** TR-A4: party-wise interest over interest.ts, opening bills, part payments, no double charge, minimum, bulk drafts. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { computeInterest, interestInputFor } from '../src/lib/interest.ts';
import { applyTotals } from '../src/lib/demo-data.ts';
import { loadInterestRuns, loadInterestSettings, overlaps, partyInterest, raiseInterest, saveInterestSettings, type InterestData } from '../src/lib/trade/tr-interest.ts';
import type { InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { InterestRun } from '../src/types/trade-r8.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const bill = (id: string, date: string, due: string, total: number, client = clientMH) =>
  applyTotals({
    id, invoice_number: `INV/${id}`, doc_type: 'TAX_INVOICE', issue_date: date, due_date: due, status: 'Sent', currency: 'INR', template_id: 't', client: { ...client }, sender: SELLER,
    items: [{ id: `${id}-l`, name: 'Cable', type: 'Goods', hsn: '8544', unit: 'NOS', quantity: 1, rate: total, tax_rate: 0, amount: total }],
    gst_mode: 'NONE', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
  } as unknown as InvoiceRecord);

const data = (over: Partial<InterestData> = {}): InterestData => ({ invoices: [], payments: [], links: [], clients: [clientMH, clientKA], openingBills: [], runs: [], ...over });

test('party total = Σ interest.ts per bill; part payments reduce the balance; opening bills included', () => {
  const invoices = [bill('a', '2026-07-01', '2026-07-31', 100000), bill('b', '2026-08-01', '2026-08-31', 50000), bill('k', '2026-08-01', '2026-08-15', 20000, clientKA)];
  const payments = [{ invoice_id: 'a', amount: 40000, date: '2026-08-30' }, { invoice_id: 'ob1', amount: 5000, date: '2026-07-15' }] as Payment[];
  const openingBills = [{ id: 'ob1', party_id: clientMH.id, party_name: clientMH.name, ref_no: 'OB/1', date: '2026-03-01', due_date: '2026-03-31', amount: 10000, dr_cr: 'Dr' as const }];
  const rows = partyInterest('2026-10-31', { rate: 18 }, data({ invoices, payments, openingBills }));
  const mh = rows.find((r) => r.party === clientMH.name)!;
  const cfg = { enabled: true, mode: 'annual' as const, rate: 18, grace_days: 0 };
  const own = ['a', 'b'].map((id) => computeInterest(interestInputFor(invoices.find((i) => i.id === id)!, payments, [], invoices), cfg, '2026-10-31').amount);
  const ob = computeInterest({ doc_type: 'INVOICE', status: 'Sent', due_date: '2026-03-31', total: 10000, payments: [{ date: '2026-07-15', amount: 5000 }] }, cfg, '2026-10-31').amount;
  assert.equal(mh.total, Math.round((own[0] + own[1] + ob) * 100) / 100);
  assert.deepEqual(mh.bills.map((b) => b.number).sort(), ['INV/a', 'INV/b', 'OB/1']);
  assert.equal(mh.bills.find((b) => b.number === 'INV/a')!.days, 92);
  // Bill-date basis: from the bill date + the party's credit days.
  const kaBill = partyInterest('2026-10-31', { rate: 18, basis: 'bill' }, data({ invoices, clients: [clientMH, { ...clientKA, credit_days: 30 }] })).find((r) => r.party === clientKA.name)!.bills[0];
  assert.equal(kaBill.due, '2026-08-31');
  // A party's own late-fee % wins; no rate at all → not listed.
  const own12 = partyInterest('2026-10-31', {}, data({ invoices, clients: [{ ...clientMH, late_fee: { mode: 'percent_pa', rate: 12, graceDays: 0 } }, clientKA] }));
  assert.deepEqual(own12.map((r) => [r.party, r.rate]), [[clientMH.name, 12]]);
});

test('minimum suppresses a party; a bill charged before is charged only after that date (overlap listed)', () => {
  const invoices = [bill('a', '2026-07-01', '2026-07-31', 100000), bill('k', '2026-10-01', '2026-10-21', 1000, clientKA)];
  const rows = partyInterest('2026-10-31', { rate: 18, min_amount: 100 }, data({ invoices }));
  assert.equal(rows.find((r) => r.party === clientKA.name)!.below_min, true);
  const runs: InterestRun[] = [{ id: 'r', date: '2026-09-30', as_of: '2026-09-30', bills: [{ id: 'a', party: clientMH.name, from: '2026-08-01', to: '2026-09-30', amount: 3008.22 }], invoice_ids: [], total: 3008.22 }];
  const again = partyInterest('2026-10-31', { rate: 18 }, data({ invoices, runs })).find((r) => r.party === clientMH.name)!;
  assert.deepEqual([again.bills[0].from, again.bills[0].to, again.bills[0].days], ['2026-10-01', '2026-10-31', 31]);
  assert.equal(again.bills[0].amount, Math.round(100000 * 0.18 / 365 * 31 * 100) / 100);
  assert.deepEqual(overlaps([again]), ['INV/a (charged to 2026-09-30)']);
  assert.equal(partyInterest('2026-09-30', { rate: 18 }, data({ invoices, runs })).length, 0, 'nothing new to charge');
});

test('raise: one draft per ticked party at the bill GST rate, with the run id; the run is recorded; settings saved', () => {
  localDb.clients.upsert({ ...clientMH });
  const a = localDb.invoices.save({ ...bill('a', '2026-07-01', '2026-07-31', 100000), items: [{ id: 'l', name: 'Cable', type: 'Goods', hsn: '8544', unit: 'NOS', quantity: 1, rate: 100000, tax_rate: 18, amount: 100000 }], gst_mode: 'CGST_SGST' });
  saveInterestSettings({ rate: 18, grace_days: 0, basis: 'due', min_amount: 0 });
  assert.equal(loadInterestSettings().rate, 18);
  const rows = partyInterest('2026-10-31', loadInterestSettings(), data({ invoices: [a], clients: getTable('clients') }));
  const run = raiseInterest(rows, '2026-10-31', '2026-10-31');
  assert.equal(run.invoice_ids.length, 1);
  const inv = localDb.invoices.getById(run.invoice_ids[0])!;
  assert.deepEqual([inv.status, inv.interest_run_id, inv.items[0].tax_rate, inv.items[0].hsn], ['Draft', run.id, 18, '8544']);
  assert.match(inv.items[0].description ?? '', /INV\/a.*2026-08-01 to 2026-10-31 \(92 days\)/);
  assert.equal(loadInterestRuns()[0].bills[0].to, '2026-10-31');
  // The interest draft itself never earns interest, and the bill is not charged twice.
  assert.equal(partyInterest('2026-10-31', loadInterestSettings(), data({ invoices: localDb.invoices.getAll(), clients: getTable('clients'), runs: loadInterestRuns() })).length, 0);
});
