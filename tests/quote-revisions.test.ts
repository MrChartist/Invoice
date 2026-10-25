import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { buildRevision, quoteFamily, reviseBlocked, reviseQuotation, revisionBase, revisionDiff, revisionNumber, revisionOf, supersededIds } from '../src/lib/quote-revisions.ts';
import { calculateInvoice, calcInputFromRecord, isExcludedLine } from '../src/lib/invoice-calc.ts';
import { cleanSections, moveSection, normalizeAltGroups, optionalBlock, sectionsAt, selectLine, setAltGroup, snippetsDb, toggleOptional } from '../src/lib/proposal-sections.ts';
import { buildConvertedDraft, readLinks } from '../src/lib/documents.ts';
import { quoteState } from '../src/lib/quote-status.ts';
import { isRevenueDoc } from '../src/lib/stats.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

const line = (id: string, over: Partial<InvoiceItem> = {}): InvoiceItem => ({ id, name: `Item ${id}`, type: 'service', quantity: 1, rate: 1000, tax_rate: 18, amount: 1000, ...over });

function quote(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'q1', invoice_number: 'QTN/FY26-27/0012', doc_type: 'QUOTATION', issue_date: '2026-05-01', due_date: '2026-05-31', status: 'Sent',
    currency: 'INR', template_id: 't', client: { name: 'Acme', email: '', address: '', city: '', zip: '' },
    sender: { companyName: 'Seller' } as InvoiceRecord['sender'],
    items: [line('a'), line('b', { optional: true }), line('c', { alt_group: 'A', selected: true, rate: 500 }), line('d', { alt_group: 'A', rate: 700 })],
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '',
    subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
    ...over,
  } as InvoiceRecord;
}

test('revision numbering: -R2, -R3 on the base number; revision_of / revision_no; acceptance never copied', () => {
  assert.equal(revisionBase('QTN/FY26-27/0012-R3'), 'QTN/FY26-27/0012');
  assert.equal(revisionNumber('QTN/FY26-27/0012', 2), 'QTN/FY26-27/0012-R2');
  assert.equal(revisionNumber('QTN/FY26-27/0012-R2', 3), 'QTN/FY26-27/0012-R3');
  assert.equal(revisionOf({ invoice_number: 'QTN/FY26-27/0012' }), 1);
  assert.equal(revisionOf({ invoice_number: 'QTN/FY26-27/0012-R4' }), 4);
  const q = quote({ quote_status: 'Accepted', acceptance: { signer: 'R', signed_at: '2026-05-02T00:00:00Z', method: 'remote', amount: 100 } });
  const r = buildRevision(q, { id: 'q2', today: '2026-06-10', highest: 1 });
  assert.equal(r.invoice_number, 'QTN/FY26-27/0012-R2');
  assert.equal(r.revision_of, 'q1');
  assert.equal(r.revision_no, 2);
  assert.equal(r.status, 'Draft');
  assert.equal(r.issue_date, '2026-06-10');
  assert.equal(r.due_date, '2026-07-10', 'same 30-day validity');
  assert.equal(r.acceptance, undefined);
  assert.equal(r.quote_status, undefined);
  assert.ok(q.acceptance, 'the source is not touched');
  assert.equal(buildRevision(q, { id: 'q3', today: '2026-06-10', highest: 4 }).invoice_number, 'QTN/FY26-27/0012-R5');
});

test('superseded state, family and revise guards', () => {
  const links = [{ from_id: 'q1', to_id: 'q2', relation: 'revised' }];
  assert.equal(quoteState(quote(), links), 'Superseded');
  assert.equal(quoteState(quote({ id: 'q2', due_date: '2099-01-01' }), links), 'Sent');
  assert.deepEqual([...supersededIds(links)], ['q1']);
  assert.match(reviseBlocked(quote(), links), /later revision/);
  assert.match(reviseBlocked(quote({ status: 'Draft' }), []), /draft/);
  assert.equal(reviseBlocked(quote(), []), '');
  const fam = quoteFamily(quote(), [quote({ id: 'x', invoice_number: 'QTN/FY26-27/0012-R2', revision_no: 2 }), quote(), quote({ id: 'y', invoice_number: 'QTN/FY26-27/0013' })]);
  assert.deepEqual(fam.map((q) => q.id), ['q1', 'x']);
});

test('line-level diff between revisions', () => {
  const a = quote({ items: [line('a'), line('b', { name: 'Old line' })] });
  const b = quote({ items: [line('a', { quantity: 2 }), line('n', { name: 'New line' })] });
  const d = revisionDiff(a, b);
  assert.deepEqual(d.lines.map((l) => [l.kind, l.name]), [['changed', 'Item a'], ['added', 'New line'], ['removed', 'Old line']]);
  assert.deepEqual(d.lines[0].fields, ['quantity']);
  assert.ok(d.change > 0);
});

test('optional and alternative lines: excluded from totals unless selected; one per group', () => {
  const q = quote();
  const t = calculateInvoice(calcInputFromRecord(q));
  // a (1000) + selected alternative c (500); optional b and unselected d are out
  assert.equal(t.taxable_value, 1500);
  assert.deepEqual(t.lines.map((l) => l.id), ['a', 'c']);
  assert.equal(isExcludedLine(q.items[1]), true);
  const picked = selectLine(q.items, 'd', true);
  assert.deepEqual(picked.filter((i) => i.alt_group).map((i) => [i.id, i.selected]), [['c', false], ['d', true]]);
  assert.deepEqual(selectLine(picked, 'd', false), picked, 'the selected alternative cannot be unselected');
  const withB = selectLine(q.items, 'b', true);
  assert.equal(calculateInvoice(calcInputFromRecord({ ...q, items: withB })).taxable_value, 2500);
  assert.equal(toggleOptional([line('z')], 'z')[0].optional, true);
  assert.equal(toggleOptional([line('z', { optional: true, selected: true })], 'z')[0].optional, undefined);
  const grouped = setAltGroup([line('p'), line('q2')], 'p', 'b');
  assert.equal(grouped[0].alt_group, 'B');
  assert.equal(grouped[0].selected, true, 'a new group selects its first line');
  assert.deepEqual(normalizeAltGroups([line('1', { alt_group: 'X' }), line('2', { alt_group: 'X', selected: true })]).map((i) => i.selected), [false, true]);
  const block = optionalBlock(q);
  assert.deepEqual(block.rows.map((r) => [r.item.id, r.option]), [['b', ''], ['d', 'Option B']]);
  assert.equal(block.subtotal, 1700);
});

test('conversion keeps only selected lines (flags cleared) and drops revision / proposal fields; quotes are not revenue', () => {
  const q = quote({ revision_of: 'q0', revision_no: 2, proposal_sections: [{ id: 's', place: 'cover', title: 'Scope', body: 'x' }] });
  const inv = buildConvertedDraft(q, 'TAX_INVOICE', { id: 'i1', invoice_number: 'INV/FY26-27/0001', today: '2026-06-01', dueDays: 15 });
  assert.deepEqual(inv.items.map((i) => i.name), ['Item a', 'Item c']);
  assert.ok(inv.items.every((i) => i.optional === undefined && i.selected === undefined && i.alt_group === undefined));
  assert.equal(inv.revision_of, undefined);
  assert.equal(inv.proposal_sections, undefined);
  assert.equal(inv.taxable_value, 1500);
  assert.equal(isRevenueDoc(q), false);
});

test('proposal sections: cleaned, placed, reordered; only quotations print them; snippets library', () => {
  resetStorage();
  const list = cleanSections([{ title: '  Scope ', body: 'Line 1\r\nLine 2', place: 'before' }, { title: '', body: '' }, { title: 'Cover', place: 'bogus' as never, body: 'x' }]);
  assert.equal(list.length, 2);
  assert.equal(list[0].body, 'Line 1\nLine 2');
  assert.equal(list[1].place, 'after');
  assert.deepEqual(moveSection(list, list[1].id, -1).map((s) => s.title), ['Cover', 'Scope']);
  const q = quote({ proposal_sections: list });
  assert.deepEqual(sectionsAt(q, 'before').map((s) => s.title), ['Scope']);
  assert.deepEqual(sectionsAt({ ...q, doc_type: 'TAX_INVOICE' }, 'before'), []);
  snippetsDb.save({ title: 'Payment terms', body: '50% advance', place: 'after' });
  snippetsDb.save({ title: 'payment terms', body: '40% advance', place: 'after' });
  assert.equal(snippetsDb.all().length, 1);
  assert.equal(snippetsDb.all()[0].body, '40% advance');
});

test('template wiring: cover before the header, sections and optional items around the items (accent only)', () => {
  const src = readFileSync(new URL('../src/components/templates/TemplateEngine.tsx', import.meta.url), 'utf8');
  assert.match(src, /<ProposalSections invoice=\{invoice\} place="cover" \/>\s*\{layoutBody\}/);
  assert.match(src, /<ProposalSections invoice=\{invoice\} place="before" \/>\s*<PaperItemsTable/);
  assert.match(src, /<TaxSummary invoice=\{invoice\} totals=\{totals\} \/>\s*<OptionalItemsBlock invoice=\{invoice\} \/>\s*<ProposalSections invoice=\{invoice\} place="after" \/>/);
  const css = readFileSync(new URL('../src/components/templates/parts/sales-r2-paper.module.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-f]{3,6}\b/i, 'no raw hex in paper parts');
});

test('storage: revise saves a draft revision and a revised link; the old quote is untouched', () => {
  resetStorage();
  localDb.invoices.save(quote());
  const before = JSON.stringify(localDb.invoices.getById('q1'));
  const r2 = reviseQuotation(localDb.invoices.getById('q1')!);
  assert.equal(r2.invoice_number, 'QTN/FY26-27/0012-R2');
  assert.ok(readLinks().some((l) => l.relation === 'revised' && l.from_id === 'q1' && l.to_id === r2.id));
  const after = localDb.invoices.getById('q1')!;
  assert.equal(JSON.stringify({ ...after, updated_at: undefined }), JSON.stringify({ ...JSON.parse(before), updated_at: undefined }));
  assert.throws(() => reviseQuotation(after), /later revision/);
  localDb.invoices.save({ ...localDb.invoices.getById(r2.id)!, status: 'Sent' });
  const r3 = reviseQuotation(localDb.invoices.getById(r2.id)!);
  assert.equal(r3.invoice_number, 'QTN/FY26-27/0012-R3');
});
