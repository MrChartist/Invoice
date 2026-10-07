import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage so the storage-backed wrappers can run.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const docs = await import('../src/lib/documents.ts');
const { localDb } = await import('../src/lib/localDb.ts');
const { calculateInvoice, round2 } = await import('../src/lib/invoice-calc.ts');
import type { InvoiceRecord } from '../src/types/invoice.ts';

function make(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const items = [
    { id: 'a', name: 'Research', type: 'service', quantity: 4, rate: 1000, tax_rate: 18, amount: 4000 },
    { id: 'b', name: 'Report', type: 'service', quantity: 2, rate: 550.5, tax_rate: 12, amount: 1101 },
  ];
  const base = {
    id: 'inv1',
    invoice_number: 'INV/FY25-26/0001',
    doc_type: 'TAX_INVOICE',
    issue_date: '2025-06-01',
    due_date: '2025-06-15',
    status: 'Sent',
    currency: 'INR',
    template_id: 't',
    client: { name: 'Acme', email: '', address: '', city: '', zip: '' },
    sender: null,
    items,
    gst_mode: 'CGST_SGST',
    place_of_supply: '27',
    reverse_charge: false,
    discount_type: 'PERCENT',
    discount_rate: 0,
    tax_rate: 0,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    amount_paid: 0,
    notes: '',
    terms: '',
  } as unknown as InvoiceRecord;
  const rec = { ...base, ...over };
  const t = calculateInvoice(rec);
  return {
    ...rec,
    subtotal: t.subtotal,
    discount_amount: t.discount_amount,
    taxable_value: t.taxable_value,
    cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount,
    igst_amount: t.igst_amount,
    tax_amount: t.tax_amount,
    round_off: t.round_off,
    total: t.total,
    balance_due: t.balance_due,
  };
}

const ctx = { id: 'cn1', invoice_number: 'CRN/FY25-26/0001', today: '2025-07-01' };

test('transition matrix', () => {
  const t = (d: InvoiceRecord['doc_type']) =>
    docs.allowedConversions({ doc_type: d, status: 'Draft' }).map((o) => o.target);
  assert.deepEqual(t('QUOTATION'), ['PROFORMA', 'TAX_INVOICE', 'INVOICE', 'DELIVERY_CHALLAN']);
  assert.ok(!t('PROFORMA').includes('PROFORMA'));
  assert.deepEqual(t('CREDIT_NOTE'), []);
  assert.deepEqual(docs.allowedConversions({ doc_type: 'QUOTATION', status: 'Cancelled' }), []);
  assert.ok(docs.canConvert({ doc_type: 'TAX_INVOICE', status: 'Sent' }, 'DELIVERY_CHALLAN'));
  assert.ok(!docs.canConvert({ doc_type: 'TAX_INVOICE', status: 'Sent' }, 'QUOTATION'));
});

test('conversion round-trip preserves totals and resets payment/status/dates', () => {
  const q = make({ doc_type: 'QUOTATION', status: 'Draft', amount_paid: 0, discount_rate: 5 });
  const d = docs.buildConvertedDraft(q, 'TAX_INVOICE', {
    id: 'new',
    invoice_number: 'INV/FY25-26/0002',
    today: '2025-08-01',
    dueDays: 10,
  });
  assert.equal(d.total, q.total);
  assert.equal(d.tax_amount, q.tax_amount);
  assert.equal(d.doc_type, 'TAX_INVOICE');
  assert.equal(d.status, 'Draft');
  assert.equal(d.issue_date, '2025-08-01');
  assert.equal(d.due_date, '2025-08-11');
  assert.equal(d.amount_paid, 0);
  assert.equal(d.balance_due, d.total);
  assert.notEqual(d.items[0].id, q.items[0].id);
  assert.equal(d.items[0].quantity, q.items[0].quantity);
  assert.throws(() => docs.buildConvertedDraft(q, 'CREDIT_NOTE', { id: 'x', invoice_number: 'x', today: '2025-08-01', dueDays: 1 }));
});

test('convertDocument: numbering per type, links and source status', () => {
  mem.clear();
  const q = localDb.invoices.save(make({ id: 'q1', doc_type: 'QUOTATION', status: 'Draft', invoice_number: 'QTN/FY25-26/0001' }));
  const p = docs.convertDocument(q, 'PROFORMA');
  assert.match(p.invoice_number, /^PRO\/FY\d\d-\d\d\/0001$/);
  const i1 = docs.convertDocument(p, 'TAX_INVOICE');
  const i2 = docs.convertDocument(q, 'INVOICE');
  assert.match(i1.invoice_number, /\/0001$/);
  assert.match(i2.invoice_number, /\/0002$/, 'invoice series is shared by INVOICE and TAX_INVOICE');
  const c = docs.convertDocument(i1, 'DELIVERY_CHALLAN');
  assert.match(c.invoice_number, /^DCH\//);
  assert.equal(localDb.invoices.getById('q1')?.status, 'Sent');
  assert.equal(localDb.invoices.getById('q1')?.items.length, 2, 'source data kept');
  const chain = docs.getDocumentChain(c.id);
  assert.equal(chain[0].doc.id, 'q1');
  assert.equal(chain[0].relation, 'origin');
  assert.ok(chain.some((n) => n.doc.id === c.id && n.depth === 3));
});

test('partial credit with CGST/SGST', () => {
  const inv = make();
  const r = docs.buildCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: 'a', quantity: 1 }] }, [], [inv], ctx);
  assert.deepEqual(r.errors, []);
  const cn = r.record!;
  assert.equal(cn.doc_type, 'CREDIT_NOTE');
  assert.equal(cn.taxable_value, 1000);
  assert.equal(cn.cgst_amount, 90);
  assert.equal(cn.sgst_amount, 90);
  assert.equal(cn.igst_amount, 0);
  assert.equal(cn.total, 1180);
  assert.equal(cn.gst_mode, 'CGST_SGST');
  assert.equal(cn.place_of_supply, '27');
  assert.equal(cn.po_number, inv.invoice_number);
  assert.match(cn.notes, /INV\/FY25-26\/0001/);
  assert.match(cn.notes, /2025-06-01/);
  assert.equal(cn.balance_due, 0);
});

test('partial credit with IGST', () => {
  const inv = make({ gst_mode: 'IGST', place_of_supply: '29' });
  const r = docs.buildCreditNote(inv, { reason: 'Discount', lines: [{ itemId: 'b', quantity: 1 }] }, [], [inv], ctx);
  const cn = r.record!;
  assert.equal(cn.taxable_value, 550.5);
  assert.equal(cn.igst_amount, 66.06);
  assert.equal(cn.cgst_amount, 0);
  assert.equal(cn.total, round2(550.5 + 66.06));
});

test('invoice-level discount is shared proportionally', () => {
  const inv = make({ discount_rate: 10 });
  const full = docs.buildCreditNote(
    inv,
    { reason: 'Sales return', lines: inv.items.map((i) => ({ itemId: i.id, quantity: i.quantity })) },
    [],
    [inv],
    ctx,
  ).record!;
  assert.ok(Math.abs(full.total - inv.total) <= 0.02);
  const half = docs.buildCreditNote(inv, { reason: 'Discount', lines: [{ itemId: 'a', quantity: 2 }] }, [], [inv], ctx).record!;
  assert.equal(half.taxable_value, 1800); // 2000 less 10%
});

test('cumulative caps per line and total', () => {
  const inv = make();
  const first = docs.buildCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: 'a', quantity: 3 }] }, [], [inv], ctx).record!;
  const stored: InvoiceRecord = { ...first, id: 'cn1' };
  const links = [{ id: 'l1', from_id: inv.id, to_id: 'cn1', relation: 'credit_note' as const, created_at: '2025-07-01T00:00:00Z' }];
  const all = [inv, stored];

  const rem = docs.creditableLines(inv, links, all).find((l) => l.item.id === 'a')!;
  assert.equal(rem.creditedQty, 3);
  assert.equal(rem.remainingQty, 1);

  const over = docs.buildCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: 'a', quantity: 2 }] }, links, all, { ...ctx, id: 'cn2' });
  assert.equal(over.record, null);
  assert.match(over.errors[0], /only 1 of 4/);

  const ok = docs.buildCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: 'a', quantity: 1 }, { itemId: 'b', quantity: 2 }] }, links, all, { ...ctx, id: 'cn2' });
  assert.deepEqual(ok.errors, []);
  assert.ok(docs.totalCredited(inv.id, links, all) + ok.record!.total <= inv.total + 0.02);

  // Cancelled credit notes free the quantity again.
  const freed = docs.creditableLines(inv, links, [inv, { ...stored, status: 'Cancelled' }]).find((l) => l.item.id === 'a')!;
  assert.equal(freed.remainingQty, 4);
});

test('credit validation: reason, empty selection, unknown line, bad doc type', () => {
  const inv = make();
  assert.ok(docs.buildCreditNote(inv, { reason: '', lines: [{ itemId: 'a', quantity: 1 }] }, [], [inv], ctx).errors.length);
  assert.ok(docs.buildCreditNote(inv, { reason: 'Discount', lines: [] }, [], [inv], ctx).errors.length);
  assert.ok(docs.buildCreditNote(inv, { reason: 'Discount', lines: [{ itemId: 'zzz', quantity: 1 }] }, [], [inv], ctx).errors.length);
  const q = make({ doc_type: 'QUOTATION' });
  assert.ok(docs.buildCreditNote(q, { reason: 'Discount', lines: [{ itemId: 'a', quantity: 1 }] }, [], [q], ctx).errors.length);
});

test('effectiveOutstanding subtracts payments and credits, floors at zero', () => {
  const inv = make({ amount_paid: 1000 });
  const cn = docs.buildCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: 'a', quantity: 1 }] }, [], [inv], ctx).record!;
  const links = [{ id: 'l', from_id: inv.id, to_id: cn.id, relation: 'credit_note' as const, created_at: '' }];
  assert.equal(docs.effectiveOutstanding(inv, [], [inv]), round2(inv.total - 1000));
  assert.equal(docs.effectiveOutstanding(inv, links, [inv, cn]), round2(inv.total - 1000 - cn.total));
  assert.equal(docs.effectiveOutstanding({ ...inv, amount_paid: inv.total }, links, [inv, cn]), 0);
  assert.equal(docs.effectiveOutstanding({ ...inv, status: 'Cancelled' }, [], []), 0);
});

test('cancel / reinstate with payment acknowledgement', () => {
  mem.clear();
  const inv = localDb.invoices.save(make({ id: 'c1', status: 'Partially Paid', amount_paid: 500 }));
  assert.throws(() => docs.cancelDocument(inv, 'Customer withdrew'), docs.DocumentError);
  assert.throws(() => docs.cancelDocument(inv, ' ', { acknowledgePayments: true }), docs.DocumentError);
  const cancelled = docs.cancelDocument(inv, 'Customer withdrew', { acknowledgePayments: true });
  assert.equal(cancelled.status, 'Cancelled');
  assert.equal(docs.activeCancellation('c1', docs.readLinks())?.reason, 'Customer withdrew');
  assert.equal(cancelled.items.length, 2, 'data preserved');
  const back = docs.reinstateDocument(cancelled);
  assert.equal(back.status, 'Partially Paid');
  assert.equal(docs.activeCancellation('c1', docs.readLinks()), undefined);

  const unpaid = localDb.invoices.save(make({ id: 'c2', status: 'Sent' }));
  assert.equal(docs.cancelDocument(unpaid, 'Duplicate').status, 'Cancelled');
});

test('createCreditNote persists, numbers CRN series and enforces caps', () => {
  mem.clear();
  const inv = localDb.invoices.save(make({ id: 'p1' }));
  const a = docs.createCreditNote(inv, { reason: 'Sales return', lines: [{ itemId: 'a', quantity: 4 }] });
  assert.match(a.invoice_number, /^CRN\/FY\d\d-\d\d\/0001$/);
  const b = docs.createCreditNote(inv, { reason: 'Discount', lines: [{ itemId: 'b', quantity: 1 }] });
  assert.match(b.invoice_number, /\/0002$/);
  assert.throws(() => docs.createCreditNote(inv, { reason: 'Discount', lines: [{ itemId: 'a', quantity: 1 }] }), docs.DocumentError);
  assert.equal(docs.getDocumentChain('p1').length, 3);
});

test('debit note is an INVOICE referencing the original', () => {
  const inv = make();
  const d = docs.buildDebitNote(
    inv,
    { reason: 'Rate difference', lines: [{ name: 'Rate revision', quantity: 1, rate: 500, tax_rate: 18 }] },
    { id: 'd1', invoice_number: 'INV/FY25-26/0002', today: '2025-07-01', dueDays: 7 },
  );
  assert.equal(d.doc_type, 'TAX_INVOICE');
  assert.equal(d.po_number, inv.invoice_number);
  assert.equal(d.total, 590);
  assert.equal(d.due_date, '2025-07-08');
});
