/** QA round 3, package QA-2 (documents, GST, settings, i18n): one regression test per finding. */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings } from './helpers/world.ts';
import { localDb, catalogueItemType } from '../src/lib/localDb.ts';
import { sheetState, sendMessage } from '../src/lib/send-summary.ts';
import { emailText, invoiceSummaryText } from '../src/lib/share.ts';
import { buildGstReport, type ReportPeriod } from '../src/lib/gst-reports.ts';
import { gstRateOptions, rateInSlabs, slabsAt, GST_SLABS, GST_SLAB_RULES } from '../src/lib/tax-rules.ts';
import { gstExceptions, isOwnGstin, GST_SLAB_RULES as GUARD_RULES } from '../src/lib/gst-guards.ts';
import { gstinChecksumChar } from '../src/lib/gstin.ts';
import { billFormSnapshot, expenseAmountLabel } from '../src/lib/purchases.ts';
import { neverBackedUp, shouldNudge } from '../src/lib/auto-backup-schedule.ts';
import { backupBusinessName, exportPlainBackup, parseBackup } from '../src/lib/backup.ts';
import { applyPreset, DEFAULT_DESIGN, presets } from '../src/lib/design-prefs.ts';
import { packAsAt } from '../src/lib/ledger/annual-pack.ts';
import { wizardDraft, answersFrom } from '../src/lib/onboarding.ts';
import { allowedConversions, isRecurringSource, menuConversions } from '../src/lib/documents.ts';
import { catalogueEntryFor, setStockShortCode } from '../src/lib/catalog.ts';
import { salesT } from '../src/i18n/areas/sales.ts';
import { uxT } from '../src/i18n/areas/invoicing-ux.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const g = (first14: string) => first14 + gstinChecksumChar(first14);
const ME = g('27AAPFU0939F1Z');

function doc(over: Partial<InvoiceRecord>): InvoiceRecord {
  return {
    id: 'd1', invoice_number: 'QTN/FY26-27/0001', doc_type: 'QUOTATION', issue_date: '2026-10-25', due_date: '2026-11-08', status: 'Sent',
    currency: 'INR', template_id: 't', client: { name: 'Quote Party', email: '', address: '', city: '', zip: '' },
    sender: { companyName: 'Asha Traders', companyGstin: ME, stateCode: '27', upiId: 'asha@okhdfcbank' },
    items: [{ id: 'i1', name: 'Chairs', type: 'Product', hsn: '9401', unit: 'NOS', quantity: 1, rate: 1000, tax_rate: 18, amount: 1000 }],
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, total: 1180, balance_due: 1180,
    ...over,
  } as unknown as InvoiceRecord;
}

/* F3 (UI half) + F23 */

test('F3: the post-save sheet offers no balance or payment on a quotation (and other non-revenue docs)', () => {
  for (const t of ['QUOTATION', 'PROFORMA', 'SALES_ORDER', 'DELIVERY_CHALLAN'] as const) {
    const s = sheetState(doc({ doc_type: t }));
    assert.deepEqual([s.balance, s.canPay, s.hint], [0, false, null], t);
  }
  const inv = sheetState(doc({ doc_type: 'TAX_INVOICE', invoice_number: 'INV/FY26-27/0001' }));
  assert.equal(inv.balance, 1180);
  assert.equal(inv.canPay, true);
  // The shared summary text of a quote carries no balance / UPI and says "Valid until".
  const text = invoiceSummaryText(doc({}));
  assert.ok(!/Balance due|UPI:/.test(text), text);
  assert.ok(/Valid until: /.test(text));
  assert.ok(!/Total outstanding/.test(sendMessage(doc({}), { total: 0, bills: 0 })));
});

test('F23: the e-mail body has no WhatsApp *bold* markers; the instalment hint needs a schedule', () => {
  const body = emailText(invoiceSummaryText(doc({ doc_type: 'TAX_INVOICE', invoice_number: 'INV/FY26-27/0001' })));
  assert.ok(body.startsWith('Tax Invoice INV/FY26-27/0001'), body.split('\n')[0]);
  assert.ok(!body.includes('*'));
  assert.equal(emailText('5 * 3 = 15'), '5 * 3 = 15', 'a lone asterisk stays');
  assert.equal(sheetState(doc({ doc_type: 'TAX_INVOICE' })).hint, 'balance');
  assert.equal(sheetState(doc({ doc_type: 'TAX_INVOICE', payment_schedule: [{ id: 'x', due_date: '2026-11-01', percent: 100 }] } as never)).hint, 'instalment');
  assert.ok(uxT.en.ssHintBalance && uxT.hi.ssHintBalance);
});

/* F8 */

test('F8: HSN summary keeps lines without HSN apart (one row per item, its own description)', () => {
  const period: ReportPeriod = { kind: 'month', fyStart: 2026, month: 10 };
  const base = doc({ doc_type: 'TAX_INVOICE', status: 'Sent', client: { name: 'B', gstin: g('27BBBBB1111B1Z'), email: '', address: '', city: '', zip: '' } as never });
  const line = (name: string, qty: number, rate: number) => ({ id: name, name, type: 'Product', hsn: '', unit: 'NOS', quantity: qty, rate, tax_rate: 18, amount: qty * rate });
  const invs = [
    { ...base, id: 'a', invoice_number: 'INV/1', items: [line('Steel rack', 4, 1250)], total: 5900 },
    { ...base, id: 'b', invoice_number: 'INV/2', items: [line('Banquet chairs', 50, 700)], total: 41300 },
  ];
  const r = buildGstReport(invs as never, [], { period, gstin: ME });
  const na = r.gstr1.hsn.filter((h) => h.hsn === 'NA');
  assert.equal(na.length, 2, JSON.stringify(na.map((h) => h.description)));
  assert.deepEqual(na.map((h) => h.description).sort(), ['Banquet chairs', 'Steel rack']);
  assert.equal(na.find((h) => h.description === 'Steel rack')?.qty, 4);
});

/* F9 */

test('F9: rate pickers offer the slabs in force on the document date; older docs keep theirs', () => {
  assert.ok(gstRateOptions('2026-10-25').includes(40));
  assert.ok(!gstRateOptions('2026-10-25').includes(12), '12% is not offered after 22 Sep 2025');
  assert.ok(gstRateOptions('2025-06-01').includes(12) && !gstRateOptions('2025-06-01').includes(40));
  // An old bill being edited still shows its 12%.
  assert.ok(gstRateOptions('2026-10-25', 12).includes(12));
  // Every offered rate passes the guard for that date, and the table is the one the guards use (never deleted).
  for (const r of gstRateOptions('2026-10-25')) assert.ok(rateInSlabs(r, '2026-10-25'), String(r));
  assert.equal(GUARD_RULES, GST_SLAB_RULES);
  assert.equal(GST_SLAB_RULES[0].value.includes(12), true);
  assert.ok(slabsAt('2017-07-01').includes(28));
  assert.ok(GST_SLABS.includes(12 as never), 'the union list keeps old slabs');
});

/* F10 */

test('F10: a client GSTIN equal to your own is a GST-guards warning (not an error)', () => {
  assert.ok(isOwnGstin(ME.toLowerCase(), ME));
  assert.ok(!isOwnGstin('', ''));
  const inv = doc({ id: 'own', doc_type: 'TAX_INVOICE', invoice_number: 'INV/9', client: { name: 'Nashik Hotels', gstin: ME, email: '', address: '', city: '', zip: '' } as never });
  const ex = gstExceptions([inv], { from: '2026-10-01', to: '2026-10-31', irnIds: new Set(), aato: () => 0, today: '2026-10-26' });
  const own = ex.find((e) => e.code === 'OWN_GSTIN');
  assert.ok(own, JSON.stringify(ex));
  assert.equal(own!.severity, 'warning');
});

/* F11 */

test('F11: the quick-expense amount says whether it includes GST', () => {
  assert.equal(expenseAmountLabel(0, true), 'amountRs');
  assert.equal(expenseAmountLabel(18, true), 'amountInclGst');
  assert.equal(expenseAmountLabel(18, false), 'amountExGst');
});

/* F12 */

test('F12: a bill form with typed lines differs from its starting snapshot (Esc asks first)', () => {
  const blank = billFormSnapshot({ vendorId: '', billNumber: '', lines: [{ name: '', quantity: 1, rate: 0, tax_rate: 18, hsn: '' }], notes: '' });
  assert.equal(blank, billFormSnapshot({ vendorId: '', billNumber: '', lines: [], notes: '' }), 'blank lines do not count');
  const typed = billFormSnapshot({ vendorId: 'v1', billNumber: 'MT/1', lines: [{ name: 'Steel', quantity: 2, rate: 100, tax_rate: 18, hsn: '7308' }], notes: '' });
  assert.notEqual(typed, blank);
});

/* F13 / F14 */

test('F13: a never-backed-up account is told so; F14: the restore summary names the business and date', () => {
  assert.equal(neverBackedUp(null), true);
  assert.equal(neverBackedUp('2026-10-20T10:00:00Z'), false);
  assert.equal(shouldNudge({ lastIso: null, now: new Date(), hasData: true }), true);
  createViaStore({ date: '2026-10-25', lines: [{ qty: 1, rate: 100, name: 'Item' }] });
  const { summary, data } = parseBackup(exportPlainBackup());
  assert.equal(summary.business, localDb.settings.activeProfile()?.companyName);
  assert.ok(summary.business);
  assert.match(summary.exportedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(backupBusinessName(data), summary.business);
  assert.equal(backupBusinessName({}), '');
});

/* F17 */

test('F17: the Compact preset keeps the discount column (shown only when a line has one) and the UPI QR', () => {
  const c = applyPreset({ ...DEFAULT_DESIGN, profile_id: 'p' } as never, 'compact');
  assert.equal(c.show_columns.discount, true);
  assert.equal(c.show_qr, true);
  for (const p of presets) assert.equal(applyPreset({ ...DEFAULT_DESIGN, profile_id: 'p' } as never, p.id).show_columns.discount, true, p.id);
});

/* F18 */

test('F18: the annual pack runs to the FY end only once the FY has ended; otherwise to the as-at date, interim', () => {
  const fy = { start: '2026-04-01', end: '2027-03-31' };
  assert.deepEqual(packAsAt(fy, '2026-10-25'), { asAt: '2026-10-25', interim: true });
  assert.deepEqual(packAsAt(fy, '2026-10-25', '2026-09-30'), { asAt: '2026-09-30', interim: true });
  assert.deepEqual(packAsAt(fy, '2026-10-25', '2027-03-31'), { asAt: '2026-10-25', interim: true }, 'never in the future');
  assert.deepEqual(packAsAt(fy, '2026-10-25', '2025-12-31'), { asAt: '2026-10-25', interim: true }, 'a date in another FY is ignored');
  assert.deepEqual(packAsAt(fy, '2027-05-02', '2026-10-25'), { asAt: '2027-03-31', interim: false });
});

/* F20 */

test('F20: leaving the wizard for the demo keeps what was typed, without marking the account set up', () => {
  const s = localDb.settings.get();
  const before = { ...s, onboarded: false };
  const a = { ...answersFrom(localDb.settings.activeProfile(), 'classic_orange'), companyName: 'Asha Traders New' };
  const draft = wizardDraft(before, a)!;
  assert.equal(draft.onboarded, false);
  assert.equal(draft.profiles.find((p) => p.id === draft.activeProfileId)?.companyName, 'Asha Traders New');
  const empty = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' ? '' : v]));
  assert.equal(wizardDraft(before, { ...(empty as typeof a), logo: undefined } as typeof a), null);
});

/* F22 */

test('F22: the Convert menu lists one invoice target; quotes show "Valid until"; recurring never starts from a note', () => {
  const quote = doc({});
  assert.ok(allowedConversions(quote).some((o) => o.target === 'INVOICE'), 'the matrix still allows both');
  const reg = menuConversions(quote).map((o) => o.target);
  assert.ok(reg.includes('TAX_INVOICE') && !reg.includes('INVOICE'), reg.join());
  const unreg = menuConversions(doc({ sender: { companyName: 'Small' } as never })).map((o) => o.target);
  assert.ok(unreg.includes('INVOICE') && !unreg.includes('TAX_INVOICE') && !unreg.includes('BILL_OF_SUPPLY'), unreg.join());
  assert.equal(salesT('tx.validUntil', { date: '8 Nov 2026' }), 'Valid until 8 Nov 2026');
  assert.equal(isRecurringSource('CREDIT_NOTE'), false);
  assert.equal(isRecurringSource('DEBIT_NOTE'), false);
  assert.equal(isRecurringSource('TAX_INVOICE'), true);
});

/* F24 */

test('F24: items learnt from invoices take their type from the HSN; a short code can be set from the stock item', () => {
  assert.equal(catalogueItemType({ hsn: '9403', type: 'Service' }), 'Product');
  assert.equal(catalogueItemType({ hsn: '998314', type: 'Service' }), 'Service');
  assert.equal(catalogueItemType({ hsn: '', type: 'Service' }), 'Service');
  localDb.items.upsert({ name: 'Old rack', type: 'Service', hsn: '9403', rate: 10, unit: 'NOS', tax_rate: 18 });
  createViaStore({ date: '2026-10-25', lines: [{ qty: 1, rate: 1250, name: 'Steel rack', hsn: '9403' }, { qty: 1, rate: 10, name: 'Old rack', hsn: '9403' }] });
  const items = localDb.items.getAll();
  assert.equal(items.find((i) => i.name === 'Steel rack')?.type, 'Product');
  assert.equal(items.find((i) => i.name === 'Old rack')?.type, 'Product', 'an earlier wrong "Service" is corrected');
  assert.equal(items.find((i) => i.name === 'Old rack')?.rate, 10, 'nothing else changes');

  assert.deepEqual(setStockShortCode({ name: 'Steel rack' }, 'SR'), { ok: true });
  assert.equal(catalogueEntryFor('steel rack')?.short_code, 'SR');
  assert.equal(catalogueEntryFor('steel rack')?.rate, 1250);
  const dup = setStockShortCode({ name: 'Old rack' }, 'sr');
  assert.equal(dup.ok, false);
  assert.equal(setStockShortCode({ name: 'Soap bar', hsn: '3401', sale_rate: 40, tax_rate: 18 }, 'SB').ok, true);
  assert.equal(catalogueEntryFor('Soap bar')?.type, 'Product');
  setStockShortCode({ name: 'Steel rack' }, '');
  assert.equal(catalogueEntryFor('Steel rack')?.short_code, undefined);
});

/* F19 */

test('F19: Marathi covers the strings QA saw in English on the screens it claims; Hindi leftovers are translated', async () => {
  const { mr } = await import('../src/i18n/mr.ts');
  const { hi } = await import('../src/i18n/hi.ts');
  const { edT } = await import('../src/i18n/areas/editor.ts');
  const { reportsT } = await import('../src/i18n/areas/reports-engine.ts');
  const { desT } = await import('../src/i18n/areas/design.ts');
  const phrases = mr.phrases ?? {};
  const seen = [
    // wizard step 0, Dashboard checklist / reminders, editor, Clients (khata), POS toolbar
    'What do you do?', 'Kirana / retail shop', 'Get set up', '{done} of {total} done', 'Payments to chase',
    'Fill in the details, then save.', 'Cash sale (walk-in)', 'More details (address, e-mail, ship-to)', 'Payment schedule', 'Summary and tax', 'Other charges', 'Fully paid',
    "You'll get", "You'll give", 'Remind all overdue', 'Sort',
    'Open shift', 'Hold & new', 'On hold', 'Return / exchange', 'Save & print', 'New bill',
  ];
  for (const s of seen) assert.ok(phrases[s] && /[ऀ-ॿ]/.test(phrases[s]), `mr phrase for "${s}"`);
  assert.ok(/[ऀ-ॿ]/.test(edT.hi.ecoSold));
  assert.ok(/[ऀ-ॿ]/.test(reportsT.hi['vk.Sales']) && /[ऀ-ॿ]/.test(reportsT.hi['vk.Receipt']));
  assert.ok(/[ऀ-ॿ]/.test(desT.hi['preset.compact.desc']));
  assert.ok(/[ऀ-ॿ]/.test((hi as { messages?: Record<string, string> }).messages?.['common.validGstin'] ?? (hi as unknown as Record<string, string>)['common.validGstin'] ?? ''));
});
