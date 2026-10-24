import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { quoteState } from '../src/lib/quote-status.ts';
import { convertDocument, readLinks } from '../src/lib/documents.ts';
import { localDb } from '../src/lib/localDb.ts';
import { buildEway } from '../src/lib/eway.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const NOW = new Date('2026-05-01T10:00:00');
const q = (o: Partial<InvoiceRecord>) => ({ id: 'q', status: 'Sent', due_date: '2026-05-10', ...o }) as InvoiceRecord;

test('quote states: draft, sent, expired, accepted, declined, converted', () => {
  assert.equal(quoteState(q({ status: 'Draft' }), [], NOW), 'Draft');
  assert.equal(quoteState(q({}), [], NOW), 'Sent');
  assert.equal(quoteState(q({ due_date: '2026-04-30' }), [], NOW), 'Expired');
  assert.equal(quoteState(q({ due_date: '2026-04-30', quote_status: 'Accepted' }), [], NOW), 'Accepted', 'an accepted quote never expires');
  assert.equal(quoteState(q({ quote_status: 'Declined' }), [{ from_id: 'q', relation: 'converted' }], NOW), 'Declined');
  assert.equal(quoteState(q({}), [{ from_id: 'q', relation: 'converted' }], NOW), 'Converted');
  assert.equal(quoteState(q({ status: 'Cancelled' }), [], NOW), 'Declined');
});

test('setQuoteStatus records the answer on quotations only; converting accepts', () => {
  const quote = createViaStore({ date: '2026-04-10', docType: 'QUOTATION', lines: [{ qty: 1, rate: 1000 }] });
  localDb.invoices.setQuoteStatus(quote.id, 'Declined');
  assert.equal(reload(quote.id).quote_status, 'Declined');
  localDb.invoices.setQuoteStatus(quote.id, undefined);
  assert.equal(reload(quote.id).quote_status, undefined);
  const inv = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 1000 }] });
  localDb.invoices.setQuoteStatus(inv.id, 'Accepted');
  assert.equal(reload(inv.id).quote_status, undefined, 'ignored on non-quotations');

  convertDocument(reload(quote.id), 'TAX_INVOICE');
  assert.equal(reload(quote.id).quote_status, 'Accepted');
  assert.equal(quoteState(reload(quote.id), readLinks()), 'Converted');
});

test('ship_to survives the editor round trip and feeds the e-Way bill', () => {
  const inv = createViaStore({ date: '2026-04-10', lines: [{ qty: 1, rate: 60000, hsn: '8471' } as never] });
  const withShip = localDb.invoices.save({ ...inv, ship_to: { name: 'Warehouse', address: 'Plot 4, MIDC', city: 'Nagpur', zip: '440016', state_code: '27' } });
  assert.equal(reload(withShip.id).ship_to?.city, 'Nagpur');
  const e = buildEway(reload(withShip.id), { transport: { distance: 0 } });
  assert.equal(e.bill.toPlace, 'Nagpur');
  assert.equal(e.bill.toPincode, 440016);
});
