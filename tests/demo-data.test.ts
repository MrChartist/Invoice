import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, resetStorage } from './helpers/shim.ts';
import {
  DEMO_PROFILE_ID,
  DEMO_PROFILE_NAME,
  buildDemoDataset,
  demoStatus,
  fakeGstin,
  isDemo,
  loadDemoData,
  removeDemoData,
} from '../src/lib/demo-data.ts';
import { localDb } from '../src/lib/localDb.ts';
import { KEYS, getTable } from '../src/lib/storage.ts';
import { checkGstin } from '../src/lib/gstin.ts';
import { summarize, isRevenueDoc } from '../src/lib/stats.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { calcInputFromRecord, calculateInvoice, round2 } from '../src/lib/invoice-calc.ts';
import { readLinks, creditNotesFor } from '../src/lib/documents.ts';
import { recurringDb } from '../src/lib/recurring.ts';
import { purchasesDb, paymentsDb, balanceOf } from '../src/lib/purchases.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const TODAY = '2026-10-07';
const NOW = new Date(2026, 9, 7);

beforeEach(() => resetStorage());

function realInvoice(id = 'real-1'): InvoiceRecord {
  const base = {
    id,
    invoice_number: 'INV/FY26-27/0001',
    doc_type: 'TAX_INVOICE',
    issue_date: '2026-09-01',
    due_date: '2026-09-15',
    status: 'Sent',
    currency: 'INR',
    template_id: 'classic_orange',
    client: { id: 'real-client', name: 'Real Customer', email: '', address: '', city: '', zip: '' },
    sender: null,
    items: [{ id: 'ri1', name: 'Real item', type: 'Service', quantity: 2, rate: 1000, tax_rate: 18, amount: 2000 }],
    gst_mode: 'CGST_SGST',
    place_of_supply: '27',
    reverse_charge: false,
    discount_type: 'PERCENT',
    discount_rate: 0,
    tax_rate: 18,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: true,
    amount_paid: 0,
    notes: '',
    terms: '',
    subtotal: 0, discount_amount: 0, taxable_value: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0,
    tax_amount: 0, round_off: 0, total: 0, balance_due: 0,
  } as InvoiceRecord;
  const t = calculateInvoice(calcInputFromRecord(base));
  return { ...base, subtotal: t.subtotal, tax_amount: t.tax_amount, total: t.total, balance_due: t.balance_due };
}

const snapshot = () => dumpStorage();
/** Storage minus nothing: exact equality of every key/value. */
const assertSameStorage = (a: Record<string, string>, b: Record<string, string>) => {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  for (const k of Object.keys(a)) assert.equal(a[k], b[k], `key ${k} changed`);
};

test('dataset: shape, counts and clearly fake identities', () => {
  const d = buildDemoDataset(TODAY);
  assert.equal(d.profile.companyName, DEMO_PROFILE_NAME);
  assert.equal(DEMO_PROFILE_NAME, 'Sample Studio (demo)');
  assert.equal(d.clients.length, 6);
  assert.equal(d.items.length, 12);
  assert.equal(d.invoices.length, 25);
  assert.equal(d.vendors.length, 2);
  assert.equal(d.purchases.length, 8);
  for (const g of [d.profile.companyGstin, ...d.clients.map((c) => c.gstin), ...d.vendors.map((v) => v.gstin)]) {
    assert.equal(checkGstin(g).valid, true, `${g} should pass the checksum`);
  }
  // GSTIN state prefix agrees with the stated state code
  for (const c of d.clients) assert.equal(c.gstin!.slice(0, 2), c.state_code);
  // every row is marked
  for (const rows of [d.clients, d.items, d.invoices, d.payments, d.vendors, d.purchases, d.purchasePayments]) {
    assert.ok(rows.length > 0);
    assert.ok(rows.every(isDemo));
  }
  assert.ok(isDemo(d.profile));
  // deterministic
  assert.deepEqual(buildDemoDataset(TODAY), d);
  // numbers use their own series and never touch INV/
  assert.ok(d.invoices.every((i) => i.invoice_number.startsWith('DEMO/FY')));
  assert.equal(new Set(d.invoices.map((i) => i.invoice_number)).size, 25);
  assert.equal(fakeGstin('27', 'AAACS0001A'), d.profile.companyGstin);
});

test('dataset: a six-month spread with mixed statuses and part payments', () => {
  const d = buildDemoDataset(TODAY);
  const dates = d.invoices.map((i) => i.issue_date).sort();
  assert.ok(dates[0] >= '2026-04-01' && dates[0] <= '2026-04-20', dates[0]);
  assert.ok(dates[dates.length - 1] <= TODAY);
  const by = (s: string) => d.invoices.filter((i) => i.status === s).length;
  assert.ok(by('Paid') >= 10);
  assert.ok(by('Partially Paid') >= 3);
  assert.ok(by('Sent') >= 4);
  assert.equal(by('Draft'), 1);
  assert.equal(by('Cancelled'), 1);
  // overdue = sent/part invoices past due with something left
  const overdue = d.invoices.filter((i) => (i.status === 'Sent' || i.status === 'Partially Paid') && i.due_date < TODAY && i.balance_due > 0);
  assert.ok(overdue.length >= 3);
  // nothing is dated in the future, payments land after the invoice and never exceed it
  for (const p of d.payments) {
    const inv = d.invoices.find((i) => i.id === p.invoice_id)!;
    assert.ok(p.date > inv.issue_date && p.date < TODAY, `${p.id} ${p.date}`);
  }
  for (const inv of d.invoices) {
    const paid = round2(d.payments.filter((p) => p.invoice_id === inv.id).reduce((s, p) => s + p.amount, 0));
    assert.equal(inv.amount_paid, paid, inv.id);
    assert.equal(inv.balance_due, round2(inv.total - paid), inv.id);
    // totals really come from the calculator
    const t = calculateInvoice(calcInputFromRecord(inv));
    assert.equal(inv.total, t.total, inv.id);
    assert.equal(inv.cgst_amount + inv.sgst_amount + inv.igst_amount, inv.tax_amount);
  }
  assert.ok(d.invoices.some((i) => d.payments.filter((p) => p.invoice_id === i.id).length === 2 && i.status === 'Paid'));
  // intra-state clients get CGST+SGST, others IGST
  for (const inv of d.invoices) assert.equal(inv.gst_mode, inv.place_of_supply === '27' ? 'CGST_SGST' : 'IGST');
});

test('load: writes everything through the real tables and is idempotent', () => {
  const r = loadDemoData({ today: TODAY });
  assert.equal(r.ok, true);
  const s = demoStatus();
  assert.equal(s.loaded, true);
  assert.equal(s.realInvoices, 0);
  assert.equal(s.counts.invoices, 26); // 25 + 1 credit note
  assert.equal(s.counts.creditNotes, 1);
  assert.equal(s.counts.clients, 6);
  assert.equal(s.counts.items, 12);
  assert.equal(s.counts.vendors, 2);
  assert.equal(s.counts.purchases, 8);
  assert.equal(s.counts.schedules, 1);
  assert.equal(s.counts.profiles, 1);
  assert.ok(s.counts.payments >= 15);

  // exact tables: no un-marked rows slipped in via the save side-effects
  assert.equal(getTable(KEYS.clients).length, 6);
  assert.equal(getTable(KEYS.items).length, 12);
  assert.ok(getTable(KEYS.clients).every(isDemo));
  assert.ok(getTable(KEYS.items).every(isDemo));
  assert.ok(getTable(KEYS.invoices).every(isDemo));

  // active profile became the demo one over the empty starter
  const settings = localDb.settings.get();
  assert.equal(settings.activeProfileId, DEMO_PROFILE_ID);
  assert.equal(localDb.settings.activeProfile()?.companyName, DEMO_PROFILE_NAME);

  // second load changes nothing
  const before = snapshot();
  const again = loadDemoData({ today: TODAY });
  assert.deepEqual(again, { ok: false, reason: 'already_loaded' });
  assertSameStorage(snapshot(), before);
  const forced = loadDemoData({ today: TODAY, confirm: true });
  assert.equal(forced.ok, false);
  assertSameStorage(snapshot(), before);
});

test('totals reconcile: billed = Σ invoice totals − credit notes, across stats and receivables', () => {
  loadDemoData({ today: TODAY });
  const all = localDb.invoices.getAll();
  const links = readLinks();
  const sumInvoices = round2(all.filter(isRevenueDoc).reduce((s, i) => s + i.total, 0));
  const credits = round2(all.filter((i) => i.doc_type === 'CREDIT_NOTE').reduce((s, i) => s + i.total, 0));
  assert.ok(credits > 0);

  const sum = summarize(all, NOW, links, 'INR');
  assert.equal(sum.credited, credits);
  assert.equal(sum.billed, round2(sumInvoices - credits));
  assert.equal(sum.count, all.filter(isRevenueDoc).length);

  // received equals the payments ledger
  const ledgerPaid = round2(localDb.payments.getAll().reduce((s, p) => s + p.amount, 0));
  assert.equal(sum.received, ledgerPaid);
  assert.equal(sum.received, round2(all.filter(isRevenueDoc).reduce((s, i) => s + i.amount_paid, 0)));

  // outstanding = billed - received (credit notes already netted into billed)
  assert.equal(sum.outstanding, round2(sum.billed - sum.received));

  // the credit note is linked and reduces exactly one invoice
  const cn = all.find((i) => i.doc_type === 'CREDIT_NOTE')!;
  const link = links.find((l) => l.to_id === cn.id)!;
  assert.equal(link.relation, 'credit_note');
  assert.equal(creditNotesFor(link.from_id, links, all).length, 1);
  assert.equal(cn.balance_due, 0);

  // receivables ledger agrees: gross - credit notes - advances
  const rep = buildReceivables({ invoices: all, payments: localDb.payments.getAll(), clients: localDb.clients.getAll() }, { now: NOW });
  assert.equal(rep.totals.creditNotes, credits);
  assert.equal(rep.totals.gross, round2(sumInvoices - round2(all.filter(isRevenueDoc).reduce((s, i) => s + i.amount_paid, 0))));
});

test('purchase side: totals, payments and vendor links are consistent', () => {
  loadDemoData({ today: TODAY });
  const purchases = purchasesDb.all();
  assert.equal(purchases.length, 8);
  for (const p of purchases) {
    assert.equal(round2(p.taxable + p.cgst + p.sgst + p.igst), p.total, p.bill_number);
    const paid = round2(paymentsDb.forPurchase(p.id).reduce((s, x) => s + x.amount, 0));
    assert.equal(paid, p.amount_paid, p.bill_number);
    assert.ok(balanceOf(p) >= 0);
    if (p.vendor_id) assert.ok(vendorsDb.get(p.vendor_id), 'vendor exists');
  }
  assert.ok(purchases.some((p) => balanceOf(p) > 0));
  assert.ok(purchases.some((p) => p.kind === 'EXPENSE') && purchases.some((p) => p.kind === 'PURCHASE'));
  // recurring schedule starts in the future so nothing is generated behind the user's back
  const sched = recurringDb.getAll()[0];
  assert.ok(sched.next_run > TODAY);
  assert.equal(sched.run_count, 0);
  assert.ok(sched.template.items.length > 0);
});

test('real invoices block the load unless confirmed, and the real series is untouched', () => {
  localDb.invoices.save(realInvoice());
  const before = snapshot();
  const refused = loadDemoData({ today: TODAY });
  assert.deepEqual(refused, { ok: false, reason: 'has_real_data', realInvoices: 1 });
  assertSameStorage(snapshot(), before);

  const ok = loadDemoData({ today: TODAY, confirm: true });
  assert.equal(ok.ok, true);
  assert.equal(demoStatus().realInvoices, 1);
  // next real number is still 0002 of the INV series: demo numbers never advance it
  assert.equal(localDb.invoices.nextNumber('2026-09-10'), 'INV/FY26-27/0002');
});

test('remove: deletes exactly the demo rows and leaves real data byte-identical', () => {
  // a user's real data across every table the demo touches
  localDb.settings.save({
    ...localDb.settings.get(),
    profiles: [{ ...localDb.settings.get().profiles[0], id: 'mine', companyName: 'My Real Business' }],
    activeProfileId: 'mine',
    onboarded: true,
  });
  localDb.invoices.save(realInvoice('real-1'));
  localDb.invoices.save({ ...realInvoice('real-2'), invoice_number: 'INV/FY26-27/0002' });
  localDb.payments.record({ invoiceId: 'real-1', amount: 500, method: 'UPI', date: '2026-09-05' });
  purchasesDb.save({
    id: 'real-bill', kind: 'EXPENSE', vendor_name: 'Real vendor', bill_number: 'B1', date: '2026-09-02',
    category: 'Rent', lines: [], taxable: 100, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: 100, amount_paid: 0,
  });
  vendorsDb.save({ id: 'real-vendor', name: 'Real vendor' });
  const before = snapshot();
  assert.equal(before['mrchartist_inv_clients'] !== undefined, true);

  loadDemoData({ today: TODAY, confirm: true });
  // the user's active profile was NOT switched
  assert.equal(localDb.settings.get().activeProfileId, 'mine');
  assert.equal(localDb.settings.get().profiles.length, 2);
  assert.notDeepEqual(snapshot(), before);

  const removed = removeDemoData();
  assert.equal(removed.invoices, 26);
  assert.equal(removed.clients, 6);
  assert.equal(removed.profiles, 1);
  assert.equal(demoStatus().loaded, false);

  const after = snapshot();
  // tables the demo wrote to and the user also had: same rows (order and content) as before.
  for (const key of Object.keys(before)) {
    if (key.endsWith('_settings')) continue; // compared structurally below
    assert.equal(after[key], before[key], `${key} must be unchanged`);
  }
  const s0 = JSON.parse(before['mrchartist_inv_settings']);
  const s1 = JSON.parse(after['mrchartist_inv_settings']);
  assert.deepEqual(s1.profiles, s0.profiles);
  assert.equal(s1.activeProfileId, 'mine');
  // keys that did not exist before are gone or empty (no demo residue)
  for (const key of Object.keys(after)) {
    if (key in before) continue;
    const v = JSON.parse(after[key]);
    assert.ok(Array.isArray(v) ? v.length === 0 : true, `${key} left residue`);
  }
  assert.equal(localDb.invoices.getAll().length, 2);
  assert.equal(localDb.payments.getAll().length, 1);
});

test('remove on a fresh install returns to the empty starter state', () => {
  loadDemoData({ today: TODAY });
  const removed = removeDemoData();
  assert.equal(removed.invoices, 26);
  assert.equal(demoStatus().loaded, false);
  assert.equal(localDb.invoices.getAll().length, 0);
  assert.equal(localDb.clients.getAll().length, 0);
  assert.equal(localDb.items.getAll().length, 0);
  assert.equal(localDb.payments.getAll().length, 0);
  assert.equal(purchasesDb.all().length, 0);
  assert.equal(recurringDb.getAll().length, 0);
  const s = localDb.settings.get();
  assert.equal(s.profiles.some(isDemo), false);
  assert.ok(s.profiles.some((p) => p.id === s.activeProfileId));
  // removing again is a harmless no-op
  assert.equal(removeDemoData().invoices, 0);
  // and loading again works
  assert.equal(loadDemoData({ today: TODAY }).ok, true);
});

test('remove also sweeps what the demo schedule generated and logs attached to demo invoices', () => {
  loadDemoData({ today: TODAY });
  const sched = recurringDb.getAll()[0];
  const invs = localDb.invoices.getAll();
  // a draft the recurring runner produced later (no demo flag, but recurring_id is the demo schedule)
  localDb.invoices.save({ ...realInvoice('gen-1'), recurring_id: sched.id, recurring_date: '2026-11-01', invoice_number: 'INV/FY26-27/0099' });
  localStorage.setItem(
    'mrchartist_inv_reminders',
    JSON.stringify([
      { id: 'r1', invoice_id: invs[0].id, channel: 'copy', tone: 'upcoming', sent_at: '2026-10-01T00:00:00Z' },
      { id: 'r2', invoice_id: 'someone-elses', channel: 'copy', tone: 'upcoming', sent_at: '2026-10-01T00:00:00Z' },
    ]),
  );
  removeDemoData();
  assert.equal(localDb.invoices.getAll().length, 0);
  const rem = JSON.parse(localStorage.getItem('mrchartist_inv_reminders')!);
  assert.deepEqual(rem.map((r: { id: string }) => r.id), ['r2']);
});

test('a real client that merely shares nothing with the demo set survives removal', () => {
  localDb.clients.upsert({ name: 'Orchid Retail (real)', email: 'a@b.co' });
  const before = getTable(KEYS.clients);
  loadDemoData({ today: TODAY, confirm: true });
  assert.equal(getTable(KEYS.clients).length, 7);
  removeDemoData();
  assert.deepEqual(getTable(KEYS.clients), before);
});
