/** Debit and credit notes through GSTR-1, its JSON, e-Invoice and revenue. */
import '../helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from '../helpers/shim.ts';
import { BUYER_KA, SELLER_GSTIN, clientKA, clientRetail, createViaStore, installSettings, reload } from '../helpers/world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { createCreditNote, createDebitNote, readLinks } from '../../src/lib/documents.ts';
import { buildGstReport } from '../../src/lib/gst-reports.ts';
import { buildGstr1Json } from '../../src/lib/gstr-json.ts';
import { eInvoiceDocType } from '../../src/lib/einvoice.ts';
import { isRevenueDoc, summarize } from '../../src/lib/stats.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const PERIOD = { kind: 'month' as const, fyStart: 2026, month: 4 };
const issue = (id: string) => {
  const r = reload(id);
  localDb.invoices.save({ ...r, status: 'Sent', issue_date: '2026-04-20', due_date: '2026-04-30' });
  return reload(id);
};
const report = () => buildGstReport(localDb.invoices.getAll(), [], { period: PERIOD, gstin: SELLER_GSTIN, links: readLinks() });

test('a debit note gets its own DBN series, adds to B2B liability as CDNR ntty D and counts as revenue', () => {
  const inv = createViaStore({ date: '2026-04-10', client: clientKA, lines: [{ qty: 10, rate: 1000, tax: 18 }] });
  const dn = issue(createDebitNote(inv, { reason: 'Rate revision', lines: [{ name: 'Rate difference', quantity: 1, rate: 1000, tax_rate: 18 }] }).id);
  assert.equal(dn.doc_type, 'DEBIT_NOTE');
  assert.match(dn.invoice_number, /^DBN\/FY26-27\/0001$/);
  assert.equal(eInvoiceDocType(dn), 'DBN');
  assert.ok(isRevenueDoc(dn));

  const r = report();
  assert.equal(r.gstr1.cdnr.length, 1);
  assert.equal(r.gstr1.cdnr[0].noteType, 'D');
  assert.equal(r.gstr1.cdnr[0].ctin, BUYER_KA);
  // 3B outward taxable = invoice + debit note.
  assert.equal(r.gstr3b.outward.taxable.taxable, 11000);
  const json = buildGstr1Json(r.gstr1) as { cdnr: { nt: { ntty: string }[] }[]; doc_issue: { doc_det: { doc_num: number }[] } };
  assert.equal(json.cdnr[0].nt[0].ntty, 'D');
  assert.ok(json.doc_issue.doc_det.some((d) => d.doc_num === 4), 'debit notes are document type 4');
  assert.equal(summarize(localDb.invoices.getAll(), new Date('2026-05-01')).billed, 11800 + 1180);
});

test('a small credit note against a large B2C invoice is classified by that invoice (CDNUR B2CL)', () => {
  const retailKA = { ...clientRetail, id: 'r-ka', name: 'Retail KA', state_code: '29' };
  // 2,00,000 + 18% inter-state to an unregistered buyer: B2CL.
  const inv = createViaStore({ date: '2026-04-10', client: retailKA, lines: [{ qty: 200, rate: 1000, tax: 18 }] });
  issue(inv.id);
  const itemId = reload(inv.id).items[0].id;
  const cn = issue(createCreditNote(reload(inv.id), { reason: 'Damaged', lines: [{ itemId, quantity: 5 }] }).id);
  assert.ok(cn.total < 100000, 'the note on its own is small');
  const r = report();
  assert.equal(r.gstr1.b2cl.length, 1);
  assert.equal(r.gstr1.cdnur.length, 1);
  assert.equal(r.gstr1.cdnur[0].unregType, 'B2CL');
  assert.equal(r.gstr1.cdnur[0].noteType, 'C');
  // Without the link it would have been netted into B2CS.
  const unlinked = buildGstReport(localDb.invoices.getAll(), [], { period: PERIOD, gstin: SELLER_GSTIN });
  assert.equal(unlinked.gstr1.cdnur.length, 0);
});
