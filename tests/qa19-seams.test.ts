/**
 * QA round 19: Round 16 seams (R16-B / C / D) walked at the data layer. Each test fails on the code before its fix.
 *
 * U7 a re-issue whose fare difference is negative credits EXACTLY that difference (the credit note rounded the derived
 *    quantity to 2 decimals: ₹800 on a ₹5,350 fare became ₹802.50), and the note stays out of GSTR-1 values like the
 *    pure-agent fare line it credits.
 * U8 R16-D1 (netting to a hand-linked vendor's own creditor ledger) was fixed in the app's ledger only: the Tally XML
 *    journal and the receipts CSV still debited "<client> (Creditor)", leaving the supplier's ledger at the full bill.
 * U9 R16-B5 delete partner checked vouchers only: a capital / current ledger with an opening balance let it go.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { saveTrip } from '../src/lib/travel/tv-trips.ts';
import { saveBooking } from '../src/lib/travel/tv-bookings.ts';
import { billTickets } from '../src/lib/travel/tv-air.ts';
import { reissueTicket } from '../src/lib/travel/tv-reissue.ts';
import { creditableLines, readLinks } from '../src/lib/documents.ts';
import { buildGstReport } from '../src/lib/gst-reports.ts';
import type { TvTicket } from '../src/types/travel-r15.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});

const tk = (no: string): TvTicket => ({ pax: 'MEHTA/RAVI', airline: '6E', ticket_no: no, pnr: 'ABC123', sector: 'DEL-BOM', class: 'economy', basic: 4200, taxes: 940, airline_gst: 210 });

test('U7: a negative re-issue difference credits exactly that amount; the note is a pure-agent credit (no GSTR-1 value)', () => {
  const t = saveTrip({ name: 'Mumbai trip', client_id: 'c-mh', tv: { code: '2610-001', kind: 'trip', scope: 'domestic', start: '2026-10-05', regime: 'agent', status: 'confirmed', pax: [] } });
  const bk = saveBooking({ trip_id: t.id, component: 'air', start: '2026-10-05', cost: 5350, sell: 5350, status: 'confirmed', ref: 'ABC123' });
  const inv = billTickets(bk.id, [tk('0581234567890')], { method: 'deemed', fee: 0, date: '2026-10-05' });
  localDb.invoices.setStatus(inv.id, 'Sent');
  const r = reissueTicket(bk.id, { old_no: '0581234567890', new_no: '0581234567899', diff: -800, penalty: 0, fee: 0, date: '2026-10-12' });
  const cn = r.credit!;
  assert.equal(cn.total, 800, `credit total ${cn.total}`);
  assert.equal(cn.items[0].amount, 800);
  // The fare line still has the rest creditable (by quantity), never more than the line.
  const fare = localDb.invoices.getById(inv.id)!;
  const st = creditableLines(fare, readLinks(), localDb.invoices.getAll()).find((s) => s.item.id === cn.items[0].id)!;
  assert.ok(Math.abs(st.remainingQty * st.item.rate - (5350 - 800)) < 0.01, `remaining value ${st.remainingQty * st.item.rate}`);
  // GSTR-1: a pure-agent (Rule 33) credit has no taxable value to report.
  const g = buildGstReport(localDb.invoices.getAll(), [], { period: { kind: 'fy', fyStart: 2026 }, gstin: '27AAPFU0939F1ZV' });
  const noteRows = [...g.gstr1.cdnr, ...g.gstr1.cdnur, ...g.gstr1.b2b].filter((x) => JSON.stringify(x).includes(cn.invoice_number));
  assert.ok(noteRows.every((x) => !(x as { taxable?: number }).taxable), `CDN rows carry no taxable value: ${JSON.stringify(noteRows)}`);
});

/* ── U8: R16-D1's netting fix reaches the Tally XML and the receipts CSV ── */
test('U8: netting with a hand-linked vendor (another name): Tally debits the supplier\'s own ledger (Agst Ref the bill); CSV deposits to it', async () => {
  const { createViaStore } = await import('./helpers/world.ts');
  const { vendorsDb } = await import('../src/lib/vendors.ts');
  const { purchasesDb } = await import('../src/lib/purchases.ts');
  const { postNetting } = await import('../src/lib/netting.ts');
  const { buildTallyModel } = await import('../src/lib/tally-xml.ts');
  const { receipts } = await import('../src/lib/accounting-export.ts');
  const who = { ...clientMH, name: 'Mehta Tours', gstin: '' };
  const clientId = localDb.clients.upsert(who);
  const vendor = vendorsDb.save({ name: 'Mehta Travels Pvt Ltd', client_id: clientId } as never);
  const a = createViaStore({ date: '2026-05-01', lines: [{ qty: 1, rate: 65000, tax: 0 }], client: { ...who, id: clientId } });
  const p = purchasesDb.save({
    kind: 'PURCHASE', vendor_name: 'Mehta Travels Pvt Ltd', vendor_id: vendor.id, bill_number: 'MT-77', date: '2026-05-10', category: 'Purchases',
    lines: [{ id: 'l1', name: 'Holiday packages', quantity: 1, rate: 180000, tax_rate: 0 }],
    taxable: 180000, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 180000, amount_paid: 0,
  } as never);
  postNetting({ clientId, vendorId: vendor.id, invoiceIds: [a.id], billIds: [p.id], amount: 65000, date: '2026-06-01' });
  const src = { invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: localDb.clients.getAll(), items: [], purchases: purchasesDb.all(), vendors: vendorsDb.all() };
  const b = buildTallyModel(src as never, { companyName: 'X', includeReceipts: true, includePurchases: true } as never);
  const bal = (name: string) => b.vouchers.flatMap((v) => v.entries).filter((e) => e.ledger === name).reduce((s, e) => s + (e.side === 'Dr' ? e.paise : -e.paise), 0) / 100;
  assert.equal(bal('Mehta Travels Pvt Ltd'), -115000, 'supplier ledger: Cr 1,15,000 left (bill 1,80,000 − netted 65,000)');
  assert.equal(bal('Mehta Tours'), 0, 'client ledger settled');
  assert.ok(!b.ledgers.some((l) => l.name === 'Mehta Tours (Creditor)'), 'no phantom creditor ledger in the client\'s name');
  const j = b.vouchers.find((v) => v.type === 'Journal')!;
  assert.deepEqual(j.entries.map((e) => [e.ledger, e.side]), [['Mehta Travels Pvt Ltd', 'Dr'], ['Mehta Tours', 'Cr']]);
  const csv = receipts(src as never);
  assert.equal(csv.rows[0][5], 'Mehta Travels Pvt Ltd', 'receipts CSV: deposited to the supplier\'s ledger');
});

/* ── U9: a partner whose capital ledger carries an opening balance cannot be deleted (R16-B5) ── */
test('U9: deletePartner refuses while the capital / current ledger has an opening balance; deletes once it is cleared', async () => {
  const { savePartner, deletePartner, loadPartners } = await import('../src/lib/prof/ps-partners.ts');
  const { saveOpenings } = await import('../src/lib/ledger/openings.ts');
  const term = { from: '2025-04-01', share_pct: 100, remuneration: { mode: 'max_allowable' as const }, interest_pct: 12 };
  const p = savePartner({ name: 'Asha', kind: 'working', joined: '2025-04-01', terms: [term] });
  saveOpenings([{ ledger_id: p.capital_account_id, amount: -50000000 }]); // Cr ₹5,00,000 brought in
  assert.throws(() => deletePartner(p.id), /postings/);
  assert.equal(loadPartners().length, 1);
  saveOpenings([{ ledger_id: p.capital_account_id, amount: 0 }]);
  deletePartner(p.id);
  assert.equal(loadPartners().length, 0);
});
