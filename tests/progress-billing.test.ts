import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  buildBalanceInvoice, buildProgressInvoice, progressBlocked, progressReport, progressSummary, cleanMilestones,
  createProgressInvoice, createBalanceInvoice, saveMilestones, type LinkLike,
} from '../src/lib/progress-billing.ts';
import { quoteState } from '../src/lib/quote-status.ts';
import { buildCreditNote, buildDocumentChain, readLinks } from '../src/lib/documents.ts';
import { orderFulfilment } from '../src/lib/sales-orders.ts';
import { localDb } from '../src/lib/localDb.ts';
import { progressSummaryCsv } from '../src/lib/sales-reports.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const sender = { companyName: 'Build Co', companyGstin: '27AAPFU0939F1ZV', stateCode: '27' } as InvoiceRecord['sender'];

function quote(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'q1', invoice_number: 'QTN/FY26-27/0012', doc_type: 'QUOTATION', issue_date: '2026-05-01', due_date: '2026-05-31', status: 'Sent',
    currency: 'INR', template_id: 't', client: { name: 'Acme', email: '', address: '', city: '', zip: '', state_code: '27' }, sender,
    items: [
      { id: 'a', name: 'Civil works', type: 'service', hsn: '995411', unit: 'LOT', quantity: 1, rate: 1000000, tax_rate: 18, amount: 1000000 },
      { id: 'b', name: 'Electrical', type: 'service', hsn: '995461', unit: 'LOT', quantity: 1, rate: 200000, tax_rate: 12, amount: 200000 },
    ],
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '',
    subtotal: 0, discount_amount: 0, taxable_value: 1200000, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
    ...over,
  } as InvoiceRecord;
}

const ctx = (id: string, invoices: InvoiceRecord[], links: LinkLike[], over = {}) => ({ id, invoice_number: `INV/FY26-27/${id}`, date: '2026-06-01', dueDays: 15, invoices, links, ...over });

test('30 / 40 / 30: proportional scaling keeps HSN, rate and the tax split; the remainder is exact to the paisa', () => {
  const q = quote();
  const links: LinkLike[] = [];
  const s1 = buildProgressInvoice(q, { basis: 'percent', value: 30 }, ctx('s1', [q], links));
  assert.equal(s1.doc_type, 'TAX_INVOICE');
  assert.equal(s1.items[0].hsn, '995411');
  assert.equal(s1.items[0].rate, 1000000);
  assert.equal(s1.items[0].quantity, 0.3);
  assert.equal(s1.items[0].progress_line_of, 'a');
  assert.equal(s1.taxable_value, 360000);
  assert.ok(s1.cgst_amount > 0 && s1.sgst_amount > 0 && s1.igst_amount === 0, 'intra-state stays CGST + SGST');
  assert.equal(s1.cgst_amount, s1.sgst_amount);
  assert.match(s1.notes, /^Stage 1 — 30% of QTN\/FY26-27\/0012/);
  assert.deepEqual(s1.progress_of, { source_id: 'q1', basis: 'percent', value: 30, stage: 1 });
  assert.equal(s1.acceptance, undefined);
  assert.equal(s1.quote_status, undefined);
  links.push({ from_id: 'q1', to_id: 's1', relation: 'progress' });
  const s2 = buildProgressInvoice(q, { basis: 'percent', value: 40 }, ctx('s2', [q, s1], links));
  links.push({ from_id: 'q1', to_id: 's2', relation: 'progress' });
  const all = [q, s1, s2];
  assert.equal(progressSummary(q, all, links).percent, 70);
  const fin = buildBalanceInvoice(q, ctx('s3', all, links));
  assert.equal(fin.progress_of?.final, true);
  const sum = [s1, s2, fin].reduce((s, i) => s + i.taxable_value, 0);
  assert.equal(Math.round(sum * 100) / 100, 1200000);
  links.push({ from_id: 'q1', to_id: 's3', relation: 'progress', final: true });
  const done = progressSummary(q, [...all, fin], links);
  assert.equal(done.remaining, 0);
  assert.equal(done.percent, 100);
  assert.equal(done.closed, true);
  assert.equal(quoteState(q, links), 'Converted');
  assert.match(progressBlocked(q, links), /already invoiced/);
});

test('cumulative cap at 100% unless over-billing is allowed with a reason', () => {
  const q = quote();
  const s1 = buildProgressInvoice(q, { basis: 'percent', value: 80 }, ctx('s1', [q], []));
  const links = [{ from_id: 'q1', to_id: 's1', relation: 'progress' }];
  assert.throws(() => buildProgressInvoice(q, { basis: 'percent', value: 30 }, ctx('s2', [q, s1], links)), /beyond 100%/);
  assert.throws(() => buildProgressInvoice(q, { basis: 'percent', value: 30, allowOver: true }, ctx('s2', [q, s1], links)), /reason/);
  const ok = buildProgressInvoice(q, { basis: 'percent', value: 30, allowOver: true, overReason: 'Extra scope agreed' }, ctx('s2', [q, s1], links));
  assert.equal(ok.progress_of?.over_reason, 'Extra scope agreed');
});

test('by amount and by line; remainder absorbs quantity rounding', () => {
  const q = quote({ items: [{ id: 'a', name: 'Supply', type: 'goods', hsn: '7308', unit: 'NOS', quantity: 7, rate: 333.33, tax_rate: 18, amount: 2333.31 }] });
  const s1 = buildProgressInvoice(q, { basis: 'amount', value: 1000 }, ctx('s1', [q], []));
  assert.ok(Math.abs(s1.taxable_value - 1000) < 0.05, `≈ ₹1000 (${s1.taxable_value})`);
  const links = [{ from_id: 'q1', to_id: 's1', relation: 'progress' }];
  const fin = buildBalanceInvoice(q, ctx('s2', [q, s1], links));
  assert.equal(Math.round((s1.taxable_value + fin.taxable_value) * 100) / 100, 2333.31);
  const lines = buildProgressInvoice(quote(), { basis: 'lines', linePercents: { a: 50 } }, ctx('s9', [quote()], []));
  assert.equal(lines.items.length, 1);
  assert.equal(lines.taxable_value, 500000);
  assert.equal(lines.progress_of?.basis, 'lines');
});

test('a credit note against a stage reduces "invoiced" and frees the quantity again', () => {
  const q = quote();
  const s1 = { ...buildProgressInvoice(q, { basis: 'percent', value: 50 }, ctx('s1', [q], [])), status: 'Sent' as const };
  const links: LinkLike[] = [{ from_id: 'q1', to_id: 's1', relation: 'progress' }];
  const cn = buildCreditNote(s1, { lines: [{ itemId: s1.items[0].id, quantity: 0.1 }], reason: 'Discount' }, links as never, [q, s1], { id: 'cn1', invoice_number: 'CRN/1', today: '2026-06-10' });
  assert.ok(cn.record, cn.errors.join(' '));
  links.push({ from_id: 's1', to_id: 'cn1', relation: 'credit_note' });
  const sum = progressSummary(q, [q, s1, cn.record!], links);
  assert.equal(sum.credited, 100000);
  assert.equal(sum.remaining, 700000);
  assert.equal(sum.lines[0].billedQty, 0.4);
});

test('sales order source: stage lines carry order_line_id so the order sees what was billed; multi-currency stays', () => {
  const so = quote({ id: 'so1', doc_type: 'SALES_ORDER', invoice_number: 'SO/FY26-27/0001', currency: 'USD', exchange_rate: 83.5, gst_mode: 'IGST', place_of_supply: '96' });
  const s1 = buildProgressInvoice(so, { basis: 'percent', value: 25 }, ctx('s1', [so], []));
  assert.equal(s1.sales_order_id, 'so1');
  assert.equal(s1.items[0].order_line_id, 'a');
  assert.equal(s1.currency, 'USD');
  assert.equal(s1.exchange_rate, 83.5);
  assert.ok(s1.igst_amount > 0 && s1.cgst_amount === 0);
  const f = orderFulfilment(so, [so, s1], []);
  assert.equal(f.lines[0].invoiced, 0.25);
  assert.equal(f.lines[0].pendingInvoice, 0.75);
});

test('blocked sources and milestone plans', () => {
  assert.match(progressBlocked(quote({ status: 'Draft' }), []), /draft/);
  assert.match(progressBlocked(quote({ doc_type: 'TAX_INVOICE' }), []), /quotation or a sales order/);
  assert.match(progressBlocked(quote(), [{ from_id: 'q1', to_id: 'q2', relation: 'revised' }]), /revision/);
  assert.deepEqual(cleanMilestones([{ name: '', percent: 10 }, { name: 'Plinth', percent: 30, expected_date: 'bad' }]).map((m) => [m.name, m.percent, m.expected_date]), [['Plinth', 30, undefined]]);
  const q = quote({ milestones: [{ id: 'm1', name: 'Plinth', percent: 30 }] });
  const s = buildProgressInvoice(q, { basis: 'amount', value: 1, milestoneId: 'm1' }, ctx('s1', [q], []));
  assert.equal(s.progress_of?.milestone_id, 'm1');
  assert.equal(s.taxable_value, 360000, 'milestone percent wins over the typed basis');
});

test('storage: stage invoices save with a progress link, tick the milestone, the chain and the report see them', () => {
  resetStorage();
  localDb.invoices.save(quote({ milestones: [{ id: 'm1', name: 'Plinth', percent: 30 }] }));
  assert.throws(() => saveMilestones('q1', [{ name: 'A', percent: 70 }, { name: 'B', percent: 40 }]), /more than 100%/);
  const s1 = createProgressInvoice(localDb.invoices.getById('q1')!, { basis: 'percent', milestoneId: 'm1' }, '2026-06-05');
  assert.equal(s1.status, 'Draft');
  assert.match(s1.invoice_number, /^INV\/FY26-27\/\d{4}$/);
  assert.equal(localDb.invoices.getById('q1')!.milestones![0].invoice_id, s1.id);
  assert.equal(localDb.invoices.getById('q1')!.quote_status, 'Accepted');
  const fin = createBalanceInvoice(localDb.invoices.getById('q1')!, '2026-07-05');
  const links = readLinks();
  assert.equal(links.filter((l) => l.relation === 'progress').length, 2);
  assert.ok(links.some((l) => l.to_id === fin.id && l.final));
  const chain = buildDocumentChain('q1', links, localDb.invoices.getAll());
  assert.deepEqual(chain.map((n) => n.relation), ['origin', 'progress', 'progress']);
  const rows = progressReport(localDb.invoices.getAll(), links);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].percent, 100);
  assert.match(progressSummaryCsv(rows), /QTN\/FY26-27\/0012,2026-05-01,1200000,1200000,0,0,100,2,Yes/);
});
