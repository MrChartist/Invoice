/** QA round 23: fixes to the PENDING-item work of PRs #94–#112 (`docs/prd/qa-round-23.md`). */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastEmis, loanCommitments } from '../src/lib/cash-forecast.ts';
import { emiSchedule } from '../src/lib/loans.ts';
import { clientToParty } from '../src/store/invoice-defaults.ts';
import { useInvoiceStore } from '../src/store/useInvoiceStore.ts';
import { buildGstReport, periodForDate } from '../src/lib/gst-reports.ts';
import { SELLER, SELLER_GSTIN, clientKA, clientMH } from './helpers/world.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { applyBillOffer, bestBillOffer } from '../src/lib/offers.ts';
import type { Scheme } from '../src/lib/pricing.ts';
import { setupR5c } from './helpers/r5c.ts';
import { localDb } from '../src/lib/localDb.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { saveDonation } from '../src/lib/nonprofit/donations.ts';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { purchaseReturnsDb } from '../src/lib/purchase-returns.ts';
import { purchasesDb, returnedQtyIssue } from '../src/lib/purchases.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

test('W1: the cash forecast follows re-scheduled prepayments and leaves closed loans out', () => {
  const base = { principal: 500000, rate: 10.5, tenure_months: 36, first_emi: '2026-01-31' };
  for (const reschedule of ['emi', 'tenure'] as const) {
    const l = { ...base, payments: [{ id: 'p', n: 0, date: '2026-05-10', principal: 200000, interest: 0, voucher_id: '', voucher_number: '', reschedule }] };
    assert.deepEqual(forecastEmis(l), emiSchedule(l).map((r) => ({ n: r.n, date: r.date, emi: r.emi })), reschedule);
  }
  const loan = { number: 'LOAN/1', lender: 'HDFC', principal: 12000, rate: 0, tenure_months: 12, first_emi: '2026-09-05', payments: [{ n: 0, date: '2026-09-10', principal: 12000 }], closed: true } as never;
  assert.deepEqual(loanCommitments([loan], '2026-12-31'), [], 'a loan closed by prepayment has no EMIs left');
});

test('W2: a composition / UIN client picked in the editor keeps its kind on the document (GSTR-3B 3.2)', () => {
  const comp = { ...clientKA, gst_reg_type: 'composition' as const };
  assert.equal(clientToParty(comp).gst_reg_type, 'composition');
  const st = useInvoiceStore.getState;
  st().setClient(clientToParty(comp));
  assert.equal(st().client.gst_reg_type, 'composition');
  st().setClient(clientToParty(clientMH));
  assert.equal(st().client.gst_reg_type, undefined, 'picking a regular client clears it');
  const doc = {
    id: 'i1', invoice_number: 'INV/FY25-26/0001', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2025-06-05',
    place_of_supply: '29', gst_mode: 'IGST', total: 1180, sender: { ...SELLER }, client: { ...clientToParty(comp), custom_fields: undefined },
    items: [{ id: 'l1', name: 'Widget', hsn: '8471', quantity: 1, rate: 1000, tax_rate: 18 }],
  } as unknown as InvoiceRecord;
  const rep = buildGstReport([doc], [], { period: periodForDate('month', '2025-06-01'), gstin: SELLER_GSTIN });
  assert.deepEqual(rep.gstr3b.interStateComp, [{ pos: '29', taxable: 1000, igst: 180 }]);
});

test('W3: a customer-only offer applies to an editor bill whose client copy has no id (matched by name)', () => {
  const bv: Scheme = { id: 's1', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, label: 'Key accounts', slabs: [{ min_value: 1000, percent: 10 }], client_ids: [clientMH.id!] };
  const items = [{ id: 'l1', name: 'Widget', quantity: 20, rate: 100, tax_rate: 18 }] as InvoiceRecord['items'];
  const rec = { id: 'x', doc_type: 'INVOICE', issue_date: '2026-05-01', discount_type: 'AMOUNT', discount_rate: 0, items, client: { ...clientToParty(clientMH), custom_fields: undefined } } as unknown as InvoiceRecord;
  assert.equal(rec.client.id, undefined);
  assert.equal(applyBillOffer(rec, [bv], { clients: [clientMH, clientKA] }).offer?.value, 200);
  assert.equal(bestBillOffer([bv], 2000, '2026-05-01', { items, client: { ...clientKA, id: undefined } }, [clientMH, clientKA]), null, 'another customer: no offer');
});

test('W4: a gift in kind is never journalised to cash / bank, and clearing its ledger removes the old journal', () => {
  setupR5c();
  const donor = localDb.clients.upsert({ name: 'Asha', email: '', address: '', city: '', zip: '', donor: { id_code: 'pan', id_no: 'ABCPD1234F' } });
  const base = { date: '2026-05-10', amount: 900, mode: 'kind' as const, type: 'others' as const, section: '80G' as const, donor_id: donor };
  assert.throws(() => saveDonation({ ...base, kind_account_id: A.cash }, 'Asha'), 'a journal Dr cash would show money that never came in');
  const k = saveDonation({ ...base, kind_account_id: A.office }, 'Asha');
  assert.ok(loadVouchers().some((v) => v.id === k.voucher_id));
  const k2 = saveDonation({ ...k, kind_account_id: undefined }, 'Asha');
  assert.equal(k2.voucher_id, undefined);
  assert.equal(loadVouchers().some((v) => v.id === k.voucher_id), false, 'the old journal does not stay in the books');
});

const pBill = (id: string, date: string, qty: number): PurchaseRecord => ({
  id, kind: 'PURCHASE', vendor_id: 'v-alpha', vendor_name: 'Alpha Pharma', bill_number: `A/${id}`, date, place_of_supply: '27', category: 'Purchases',
  lines: [{ id: `l-${id}`, name: 'Paracetamol 500', quantity: qty, rate: 20, tax_rate: 12 }], taxable: qty * 20, cgst: qty * 1.2, sgst: qty * 1.2, igst: 0,
  itc_eligible: true, total: qty * 22.4, amount_paid: 0,
});

test('W5: a bill covered by a multi-bill goods note can still be edited (only its own lines count)', () => {
  setActorProvider(null);
  resetStorage();
  installSettings();
  setTable('purchases', [pBill('b1', '2026-04-10', 10), pBill('b2', '2026-04-12', 5)]);
  purchaseReturnsDb.createMulti({ date: '2026-05-10', reason: '01', goodsReturned: true, lines: [
    { id: 'n1', purchase_id: 'b1', bill_line_id: 'l-b1', name: 'Paracetamol 500', quantity: 4, rate: 20, tax_rate: 12 },
    { id: 'n2', purchase_id: 'b2', bill_line_id: 'l-b2', name: 'Paracetamol 500', quantity: 2, rate: 20, tax_rate: 12 },
  ] });
  const notes = purchaseReturnsDb.all();
  assert.equal(returnedQtyIssue(purchasesDb.get('b2')!, notes), '', 'b1\'s returned line is not looked for on b2');
  assert.match(returnedQtyIssue({ ...purchasesDb.get('b2')!, lines: [{ ...purchasesDb.get('b2')!.lines[0], quantity: 1 }] }, notes), /already returned/);
});

test('W6: a goods debit note is not restored from the bin onto a bill edited below what it returned', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  setActorProvider(null);
  resetStorage();
  installSettings();
  setTable('purchases', [pBill('b1', '2026-04-10', 10)]);
  const dn = purchaseReturnsDb.create({ kind: 'DEBIT_NOTE', date: '2026-05-10', purchaseId: 'b1', reason: '01', goodsReturned: true, lines: [{ id: 'n1', bill_line_id: 'l-b1', name: 'Paracetamol 500', quantity: 4, rate: 20, tax_rate: 12 }] });
  purchaseReturnsDb.remove(dn.id);
  await Promise.resolve();
  const b = purchasesDb.get('b1')!;
  purchasesDb.save({ ...b, lines: [{ ...b.lines[0], quantity: 2 }], taxable: 40, cgst: 2.4, sgst: 2.4, total: 44.8 });
  const entry = getTable<{ id: string; table: string; row_id: string }>('recycle_bin').find((x) => x.table === 'purchase_returns' && x.row_id === dn.id);
  assert.ok(entry, 'the note went to the bin');
  assert.throws(() => restoreEntry(entry!.id), /already returned/);
});
