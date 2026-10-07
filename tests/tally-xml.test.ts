import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTallyModel,
  escapeXml,
  generateTallyExport,
  stripIllegalXmlChars,
  tallyAmount,
  tallyDate,
  voucherImbalance,
  type TallyVoucher,
} from '../src/lib/tally-xml.ts';
import { ACME, INVOICE_IGST_ROUNDED, PAYMENTS, PURCHASE, fullSource, makeInvoice } from './export-fixtures.ts';

const OPTS = { companyName: 'Mr. Chartist & Co' };
const find = (vs: TallyVoucher[], type: string, number?: string) =>
  vs.find((v) => v.type === type && (!number || v.number === number))!;
const amt = (v: TallyVoucher, ledger: string) =>
  v.entries.filter((e) => e.ledger === ledger).reduce((s, e) => s + (e.side === 'Cr' ? e.paise : -e.paise), 0);

/** Minimal well-formedness check: balanced tags, no stray & or <. */
function assertWellFormed(xml: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, '');
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[5] !== undefined) {
      assert.ok(!/&(?!(amp|lt|gt|quot|apos);)/.test(m[5]), `bad entity in text: ${m[5]}`);
      continue;
    }
    if (m[4]) continue; // self-closing
    if (m[1]) assert.equal(stack.pop(), m[2], `mismatched </${m[2]}>`);
    else stack.push(m[2]);
  }
  assert.deepEqual(stack, []);
}

test('amount and date formatting', () => {
  assert.equal(tallyAmount(-118000), '-1180.00');
  assert.equal(tallyAmount(0), '0.00');
  assert.equal(tallyAmount(5), '0.05');
  assert.equal(tallyDate('2025-04-15'), '20250415');
});

test('escapeXml escapes specials and strips illegal characters', () => {
  assert.equal(escapeXml(`A&B <C> "D" 'E'`), 'A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
  assert.equal(stripIllegalXmlChars('a\u0001b\u0008c\ufffed\u000be'), 'abcde');
  assert.equal(stripIllegalXmlChars('tab\tnl\n ok'), 'tab\tnl\n ok');
  assert.equal(escapeXml('emoji 😀 stays'), 'emoji 😀 stays');
});

test('Sales voucher: Dr party negative, Cr sales/taxes positive, sums to zero', () => {
  const { vouchers } = buildTallyModel(fullSource(), OPTS);
  const v = find(vouchers, 'Sales', 'INV/FY25-26/0001');
  assert.equal(amt(v, 'Acme Traders'), -118000);
  assert.equal(amt(v, 'Sales'), 100000);
  assert.equal(amt(v, 'Output CGST'), 9000);
  assert.equal(amt(v, 'Output SGST'), 9000);
  assert.equal(voucherImbalance(v), 0);
  assert.equal(v.entries.find((e) => e.ledger === 'Output IGST'), undefined);
});

test('IGST invoice with round off posts Dr Round Off 0.41 and balances', () => {
  const { vouchers } = buildTallyModel({ ...fullSource(), invoices: [INVOICE_IGST_ROUNDED] }, OPTS);
  const v = find(vouchers, 'Sales');
  assert.equal(amt(v, 'Delhi Buyer'), -117900);
  assert.equal(amt(v, 'Sales'), 99950);
  assert.equal(amt(v, 'Output IGST'), 17991);
  assert.equal(amt(v, 'Round Off'), -41); // debit
  assert.equal(voucherImbalance(v), 0);
});

test('Credit note mirrors the sale: Cr party, Dr sales and tax', () => {
  const { vouchers } = buildTallyModel(fullSource(), OPTS);
  const v = find(vouchers, 'Credit Note');
  assert.equal(amt(v, 'Acme Traders'), 118000);
  assert.equal(amt(v, 'Sales'), -100000);
  assert.equal(amt(v, 'Output CGST'), -9000);
  assert.equal(voucherImbalance(v), 0);
});

test('Receipts: Dr bank/cash, Cr party with Agst Ref bill allocation', () => {
  const { vouchers } = buildTallyModel(fullSource(), OPTS);
  const r1 = find(vouchers, 'Receipt', 'INV/FY25-26/0001/R1');
  assert.equal(amt(r1, 'Bank Account'), -50000);
  assert.equal(amt(r1, 'Acme Traders'), 50000);
  assert.deepEqual(r1.entries.find((e) => e.bill)!.bill, { name: 'INV/FY25-26/0001', type: 'Agst Ref' });
  const r2 = find(vouchers, 'Receipt', 'INV/FY25-26/0001/R2');
  assert.equal(amt(r2, 'Cash'), -30000);
  assert.equal(voucherImbalance(r1) + voucherImbalance(r2), 0);
});

test('Purchase: Cr vendor, Dr purchases and input tax', () => {
  const { vouchers, ledgers } = buildTallyModel(fullSource(), OPTS);
  const v = find(vouchers, 'Purchase');
  assert.equal(amt(v, 'Supplies & Co'), 236000);
  assert.equal(amt(v, 'Purchases'), -200000);
  assert.equal(amt(v, 'Input CGST'), -18000);
  assert.equal(amt(v, 'Input SGST'), -18000);
  assert.equal(voucherImbalance(v), 0);
  assert.equal(ledgers.find((l) => l.name === 'Supplies & Co')!.parent, 'Sundry Creditors');
});

test('every voucher in a full export balances to zero', () => {
  const src = fullSource();
  src.invoices.push(
    makeInvoice({ id: 'x', invoice_number: 'X1', shipping: 50, other_charges: 25, total: 1255, balance_due: 1255 }),
    makeInvoice({ id: 'y', invoice_number: 'Y1', gst_mode: 'SINGLE', cgst_amount: 0, sgst_amount: 0, total: 1180 }),
  );
  const { vouchers } = buildTallyModel(src, { ...OPTS, includeInventory: true });
  assert.ok(vouchers.length >= 8);
  for (const v of vouchers) assert.equal(voucherImbalance(v), 0, `${v.type} ${v.number}`);
  const x = find(vouchers, 'Sales', 'X1');
  assert.equal(amt(x, 'Freight and Other Charges'), 7500);
  const y = find(vouchers, 'Sales', 'Y1');
  assert.equal(amt(y, 'Output GST'), 18000);
});

test('inconsistent legacy totals are absorbed by Round Off, never unbalanced', () => {
  const bad = makeInvoice({ id: 'z', invoice_number: 'Z1', total: 1181.37 });
  const { vouchers } = buildTallyModel({ ...fullSource(), invoices: [bad], payments: [] }, OPTS);
  const v = find(vouchers, 'Sales');
  assert.equal(amt(v, 'Round Off'), 137);
  assert.equal(voucherImbalance(v), 0);
});

test('drafts, cancelled, quotations and out-of-range documents are skipped', () => {
  const src = fullSource();
  src.invoices = [
    makeInvoice({ id: 'd', invoice_number: 'D', status: 'Draft' }),
    makeInvoice({ id: 'c', invoice_number: 'C', status: 'Cancelled' }),
    makeInvoice({ id: 'q', invoice_number: 'Q', doc_type: 'QUOTATION' }),
    makeInvoice({ id: 'o', invoice_number: 'O', issue_date: '2024-01-01' }),
    makeInvoice({ id: 'ok', invoice_number: 'OK' }),
  ];
  src.payments = [];
  src.purchases = [];
  const range = { from: '2025-04-01', to: '2026-03-31' };
  assert.deepEqual(buildTallyModel(src, { ...OPTS, range }).vouchers.map((v) => v.number), ['OK']);
  assert.equal(buildTallyModel(src, { ...OPTS, range, includeDrafts: true }).vouchers.length, 2);
});

test('XML envelope, sign convention and escaping', () => {
  const evil = makeInvoice({
    id: 'e',
    invoice_number: 'E&1',
    client: { ...ACME, name: 'A&B <Traders> "Q" \u0001', company: '' },
  });
  const t = generateTallyExport({ ...fullSource(), invoices: [evil], payments: [], purchases: [] }, OPTS);
  const xml = t.vouchersXml;
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<TALLYREQUEST>Import Data<\/TALLYREQUEST>/);
  assert.match(xml, /<REPORTNAME>Vouchers<\/REPORTNAME>/);
  assert.match(xml, /<SVCURRENTCOMPANY>Mr\. Chartist &amp; Co<\/SVCURRENTCOMPANY>/);
  assert.match(xml, /<VOUCHER VCHTYPE="Sales" ACTION="Create"/);
  assert.match(xml, /<DATE>20250415<\/DATE>/);
  assert.match(xml, /<VOUCHERNUMBER>E&amp;1<\/VOUCHERNUMBER>/);
  assert.match(xml, /<PARTYLEDGERNAME>A&amp;B &lt;Traders&gt; &quot;Q&quot;<\/PARTYLEDGERNAME>/);
  assert.match(xml, /<PLACEOFSUPPLY>Maharashtra<\/PLACEOFSUPPLY>/);
  assert.match(xml, /<PARTYGSTIN>27AAAAA0000A1Z5<\/PARTYGSTIN>/);
  // Party debit: Yes + negative amount; sales credit: No + positive.
  assert.match(
    xml,
    /<LEDGERNAME>A&amp;B[^<]*<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>-1180\.00<\/AMOUNT>/,
  );
  assert.match(
    xml,
    /<LEDGERNAME>Sales<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>[\s\S]*?<AMOUNT>1000\.00<\/AMOUNT>/,
  );
  assert.ok(!xml.includes('\u0001'));
  assertWellFormed(xml);
  assertWellFormed(t.mastersXml);
  assertWellFormed(t.combinedXml);
});

test('masters XML: party ledgers under Sundry Debtors with GSTIN/state, tax ledgers as Duties & Taxes', () => {
  const t = generateTallyExport(fullSource(), OPTS);
  const m = t.mastersXml;
  assert.match(m, /<REPORTNAME>All Masters<\/REPORTNAME>/);
  assert.match(m, /<LEDGER NAME="Acme Traders" ACTION="Create">/);
  assert.match(m, /<PARENT>Sundry Debtors<\/PARENT>/);
  assert.match(m, /<GSTIN>27AAAAA0000A1Z5<\/GSTIN>/);
  assert.match(m, /<GSTREGISTRATIONTYPE>Regular<\/GSTREGISTRATIONTYPE>/);
  assert.match(m, /<LEDSTATENAME>Maharashtra<\/LEDSTATENAME>/);
  assert.match(m, /<LEDGER NAME="Output CGST" ACTION="Create">[\s\S]*?<PARENT>Duties &amp; Taxes<\/PARENT>/);
  assert.match(m, /<GSTDUTYHEAD>Integrated Tax<\/GSTDUTYHEAD>/);
  assert.match(m, /<LEDGER NAME="Round Off" ACTION="Create">/);
  assert.match(m, /<PARENT>Sundry Creditors<\/PARENT>/);
  assert.match(m, /<PARENT>Bank Accounts<\/PARENT>/);
  assert.match(m, /<PARENT>Cash-in-Hand<\/PARENT>/);
  assert.equal(t.counts.sales, 2);
  assert.equal(t.counts.creditNotes, 1);
  assert.equal(t.counts.receipts, 2);
  assert.equal(t.counts.purchases, 1);
});

test('inventory mode emits stock entries whose allocations equal the sales ledger', () => {
  const t = generateTallyExport({ ...fullSource(), invoices: [makeInvoice()], payments: [], purchases: [] }, {
    ...OPTS,
    includeInventory: true,
  });
  assert.match(t.vouchersXml, /<STOCKITEMNAME>Consulting<\/STOCKITEMNAME>/);
  assert.match(t.vouchersXml, /<RATE>500\.00\/HRS<\/RATE>/);
  assert.match(t.vouchersXml, /<BILLEDQTY>2 HRS<\/BILLEDQTY>/);
  assert.match(t.vouchersXml, /<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<AMOUNT>1000\.00<\/AMOUNT>/);
  assert.match(t.mastersXml, /<STOCKITEM NAME="Consulting" ACTION="Create">/);
  assert.match(t.mastersXml, /<HSNCODE>998313<\/HSNCODE>/);
  assert.match(t.mastersXml, /<UNIT NAME="HRS" ACTION="Create">/);
  assert.match(t.mastersXml, /<GSTRATE>9<\/GSTRATE>/);
  assertWellFormed(t.vouchersXml);
  assertWellFormed(t.mastersXml);
  // The top-level Sales ledger entry is replaced by per-line allocations.
  assert.ok(!/<ALLLEDGERENTRIES\.LIST>\s*<LEDGERNAME>Sales</.test(t.vouchersXml));
});

test('output is deterministic and independent of input order', () => {
  const a = generateTallyExport(fullSource(), OPTS);
  const rev = fullSource();
  rev.invoices.reverse();
  rev.payments = [...PAYMENTS].reverse();
  const b = generateTallyExport(rev, OPTS);
  assert.equal(a.combinedXml, b.combinedXml);
  assert.equal(a.vouchersXml, generateTallyExport(fullSource(), OPTS).vouchersXml);
});

test('amount paid exceeding recorded receipts raises a warning', () => {
  const inv = makeInvoice({ amount_paid: 1180, status: 'Paid' });
  const t = generateTallyExport({ ...fullSource(), invoices: [inv], payments: [], purchases: [] }, OPTS);
  assert.equal(t.build.warnings.length, 1);
  assert.match(t.build.warnings[0], /INV\/FY25-26\/0001/);
});

test('purchases read defensively from alternate field names', () => {
  const alt = { id: 'p9', number: 'S-9', supplier: { name: 'Alt Supplier', gstin: '24DDDDD3333D1Z8' }, date: '2025-07-01', subtotal: 100, igst: 18, total: 118 };
  const { vouchers } = buildTallyModel({ ...fullSource(), invoices: [], payments: [], purchases: [alt, null, { junk: true }] }, OPTS);
  assert.equal(vouchers.length, 1);
  assert.equal(amt(vouchers[0], 'Alt Supplier'), 11800);
  assert.equal(amt(vouchers[0], 'Input IGST'), -1800);
  assert.equal(PURCHASE.id, 'pb-1');
});
