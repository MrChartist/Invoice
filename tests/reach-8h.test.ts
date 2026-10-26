/**
 * 8H · Shop mode, languages, reach: module filtering, quick create, language fallback and message
 * templates, amount in words, catalogue v2 (escaping, CSP hashes, cart message), loans / EMI maths and
 * vouchers, finer user rights, currency reference rates, import presets, checklist v2.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';

import { enabledModules, isPathVisible, moduleOfPath, ALL_MODULES, type ModuleId } from '../src/lib/shop-mode.ts';
import { BUSINESS_DEFAULTS, PRESETS, applyBusinessDefaults, applyBusinessType, isTileVisible } from '../src/lib/shop-presets.ts';
import { DASHBOARD_ACTIONS, quickActions } from '../src/lib/quick-create.ts';
import { getLanguage, isLang, loadLanguageForTests, resetI18nForTests, t, LANGUAGES } from '../src/i18n/index.ts';
import { en } from '../src/i18n/en.ts';
import { enPages } from '../src/i18n/en-pages.ts';
import { REGIONAL } from '../src/i18n/regional.ts';
import { defineArea } from '../src/i18n/area.ts';
import { amountInWordsIn, numberWordsIn } from '../src/lib/amount-in-words-in.ts';
import { buildReminderIn, defaultMessageLang, messageLangOf, PARTY_TEMPLATES, REMINDER_TEMPLATES, STATEMENT_LABELS } from '../src/lib/message-langs.ts';
import { buildCatalogue, buildCatalogueHtml, cartMessage, CATALOGUE_INLINE, mrpSaving } from '../src/lib/catalogue-html.ts';
import { catalogueMaps } from '../src/lib/catalogue-export.ts';
import { addMonths, emiAmount, emiSchedule, loadLoans, loanStatement, payEmi, deleteLoanPayment, postDisbursement, saveLoan, validateLoan } from '../src/lib/loans.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { actorCan, can, setActorProvider } from '../src/lib/access.ts';
import { checkDocRight } from '../src/lib/rights.ts';
import { POS_CASHIER, backdateProblem, cleanRights, discountProblem, enforceRights, maxDiscountPercent, rightsFilter } from '../src/lib/user-rights.ts';
import { mergeRates, parseRatesCsv, rateOn } from '../src/lib/currency-rates.ts';
import { detectPreset, guessMapping, IMPORT_PRESETS } from '../src/lib/import-mapping.ts';
import { buildChecklist } from '../src/lib/checklist.ts';
import { answersFrom, applyAnswers } from '../src/lib/onboarding.ts';
import { localDb } from '../src/lib/localDb.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
afterEach(() => {
  setActorProvider(null);
  resetI18nForTests();
});

/* ── Shop mode ─────────────────────────────────────────────── */

test('shop mode: absent modules = full; presets narrow the sidebar; unknown paths stay visible', () => {
  assert.equal(enabledModules({}), null, 'existing companies keep every module');
  assert.equal(isPathVisible('/payroll', null), true);
  const kirana = enabledModules(applyBusinessType('kirana'));
  assert.ok(kirana);
  assert.equal(isPathVisible('/pos', kirana), true);
  assert.equal(isPathVisible('/books?tab=coa&m=menu', kirana), false, 'query strings are ignored');
  assert.equal(isPathVisible('/payroll', kirana), false);
  assert.equal(isPathVisible('/transactions', kirana), true, 'core screens always show');
  assert.equal(isPathVisible('/settings', kirana), true);
  assert.equal(isPathVisible('/some-new-screen', kirana), true, 'a screen the table does not know never vanishes');
  assert.equal(moduleOfPath('/gateway/vouchers'), 'accounts');
  assert.deepEqual(applyBusinessType('full'), { business_type: 'full', modules: undefined });
  assert.deepEqual([...PRESETS.full], [...ALL_MODULES]);
  assert.equal(enabledModules({ modules: ['pos', 'bogus' as never] })!.has('pos'), true);
  assert.equal(enabledModules({ modules: ['pos', 'bogus' as never] })!.size, 1, 'unknown module ids are dropped');
  // Dashboard tiles follow the modules.
  const services = enabledModules(applyBusinessType('services'));
  assert.equal(isTileVisible('lowStock', services), false);
  assert.equal(isTileVisible('receivables', services), true);
  assert.equal(isTileVisible('lowStock', null), true);
});

test('shop mode: business defaults set due days and the landing screen; settings keep the modules', () => {
  const s = applyBusinessDefaults<{ defaultDueDays: number; modules?: ModuleId[] }>({ defaultDueDays: 14 }, 'kirana');
  assert.equal(s.defaultDueDays, 0);
  assert.deepEqual(s.modules, [...PRESETS.kirana]);
  assert.equal(BUSINESS_DEFAULTS.kirana.landing, '/pos');
  localDb.settings.save({ ...localDb.settings.get(), ...applyBusinessType('wholesale') });
  assert.equal(localDb.settings.get().business_type, 'wholesale');
  assert.deepEqual(localDb.settings.get().modules, [...PRESETS.wholesale]);
});

test('quick create: filtered by role and modules; Dashboard row order', () => {
  const all = () => true;
  assert.deepEqual(quickActions(all, null).map((a) => a.id), ['sale', 'pos', 'payment', 'expense', 'bill', 'quote']);
  assert.deepEqual(quickActions(all, null, DASHBOARD_ACTIONS).map((a) => a.id), ['sale', 'payment', 'pos', 'expense']);
  const services = enabledModules(applyBusinessType('services'));
  assert.deepEqual(quickActions(all, services).map((a) => a.id), ['sale', 'payment', 'expense', 'bill', 'quote'], 'no POS for a services firm');
  const viewer = (a: string) => a === 'view';
  assert.deepEqual(quickActions(viewer, null), []);
  const expense = quickActions(all, null).find((a) => a.id === 'expense')!;
  assert.equal(expense.to, '/expenses?new=expense');
});

/* ── Languages ─────────────────────────────────────────────── */

test('languages: Marathi / Gujarati / Tamil load lazily; missing keys and area strings fall back to English', async () => {
  for (const code of ['mr', 'gu', 'ta', 'bn', 'te', 'kn'] as const) assert.ok(isLang(code));
  assert.equal(LANGUAGES.length, 8);
  await loadLanguageForTests('mr');
  assert.equal(getLanguage(), 'mr');
  assert.equal(t('nav.clients'), 'ग्राहक');
  assert.equal(t('editor.newDoc', { doc: 'इनव्हॉइस' }), 'नवीन इनव्हॉइस');
  assert.equal(t('login.lede'), en['login.lede'], 'an untranslated key shows English, never the key');
  const area = defineArea({ total: 'Total', other: 'Something only in English {n}' } as const, { total: 'कुल', other: 'हिंदी {n}' });
  assert.equal(area('total'), 'एकूण', 'area strings use the phrase glossary');
  assert.equal(area('other', { n: 3 }), 'Something only in English 3', 'and fall back to English');
  await loadLanguageForTests('ta');
  assert.equal(t('nav.invoices'), 'இன்வாய்ஸ்கள்');
  await loadLanguageForTests('hi');
  assert.equal(area('total'), 'कुल', 'Hindi still comes from the area file');
  await loadLanguageForTests('kn');
  assert.equal(t('nav.settings'), 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು');
  assert.equal(t('dash.recent'), en['dash.recent']);
});

test('languages: regional catalogues use real keys and the same placeholders as English', () => {
  const english: Record<string, string> = { ...en, ...enPages };
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [code, cat] of Object.entries(REGIONAL)) {
    for (const [key, value] of Object.entries(cat.messages)) {
      assert.ok(key in english, `${code}: unknown key ${key}`);
      assert.ok(value && value.trim(), `${code}: empty ${key}`);
      assert.equal(ph(value!), ph(english[key]), `${code}: placeholders of ${key}`);
    }
    for (const [source, value] of Object.entries(cat.phrases ?? {})) assert.equal(ph(value), ph(source), `${code}: phrase placeholders of "${source}"`);
  }
  assert.ok(Object.keys(REGIONAL.mr.messages).length > 150, 'Marathi covers the shell, editor, payment and settings header');
});

test('amount in words: Marathi, Gujarati, Tamil (Indian system, paise, zero, negatives)', () => {
  assert.equal(numberWordsIn('mr', 0), 'शून्य');
  assert.equal(numberWordsIn('mr', 125), 'एकशे पंचवीस');
  assert.equal(numberWordsIn('mr', 100), 'शंभर');
  assert.equal(numberWordsIn('mr', 250000), 'दोन लाख पन्नास हजार');
  assert.equal(amountInWordsIn('mr', 1234.5), 'रुपये एक हजार दोनशे चौतीस आणि पन्नास पैसे फक्त');
  assert.equal(numberWordsIn('gu', 99), 'નવ્વાણું');
  assert.equal(amountInWordsIn('gu', 12_34_56_789.05), 'રૂપિયા બાર કરોડ ચોત્રીસ લાખ છપ્પન હજાર સાત સો નેવ્યાસી અને પાંચ પૈસા પૂરા');
  assert.equal(numberWordsIn('ta', 21), 'இருபத்து ஒன்று');
  assert.equal(numberWordsIn('ta', 100), 'நூறு');
  assert.equal(numberWordsIn('ta', 105), 'நூற்று ஐந்து');
  assert.equal(numberWordsIn('ta', 1000), 'ஒரு ஆயிரம்');
  assert.equal(numberWordsIn('ta', 2500), 'இரண்டு ஆயிரத்து ஐந்நூறு');
  assert.equal(numberWordsIn('ta', 10_00_000), 'பத்து இலட்சம்');
  assert.equal(amountInWordsIn('ta', -15), 'கழித்தல் ரூபாய் பதினைந்து மட்டும்');
  assert.equal(amountInWordsIn('bn', 10), '', 'unsupported language: callers show English');
  assert.equal(amountInWordsIn('mr', 19.999), 'रुपये वीस फक्त', 'rounds to paise first');
});

const inv = (over: Partial<InvoiceRecord> = {}): InvoiceRecord =>
  ({
    id: 'i1', invoice_number: 'INV/FY26-27/0007', doc_type: 'TAX_INVOICE', issue_date: '2026-10-01', due_date: '2026-10-11', status: 'Sent',
    currency: 'INR', client: { name: 'Patil Traders', email: '', address: '', city: '', zip: '', message_lang: 'mr' },
    sender: { companyName: 'Shree Stores', upiId: 'shree@okhdfc', companyPhone: '9876543210' },
    items: [{ id: 'l1', name: 'Rice', type: 'Product', quantity: 10, rate: 100, tax_rate: 5, amount: 1000 }],
    gst_mode: 'CGST_SGST', total: 1050, amount_paid: 0, balance_due: 1050, terms: '', notes: '',
    ...over,
  }) as unknown as InvoiceRecord;

test('message templates: party message language drives reminders; every regional stage keeps the placeholders', () => {
  const invoice = inv();
  assert.equal(messageLangOf(invoice.client), 'mr');
  assert.equal(defaultMessageLang({}, 'gu'), 'gu');
  assert.equal(defaultMessageLang({}, 'kn'), 'en');
  const m = buildReminderIn(invoice, 'overdue_polite', 'mr', new Date(2026, 9, 20));
  assert.match(m.body, /नमस्कार Patil Traders/);
  assert.match(m.body, /टॅक्स इनव्हॉइस INV\/FY26-27\/0007/);
  assert.match(m.body, /9 दिवस थकीत/);
  assert.match(m.body, /UPI ने पेमेंट करा: shree@okhdfc/);
  assert.match(m.body, /upi:\/\/pay/, 'the pay link survives');
  assert.ok(!/\{\w+\}/.test(m.body + m.subject), 'no placeholder left');
  const en = buildReminderIn(invoice, 'overdue_polite', 'en', new Date(2026, 9, 20));
  assert.match(en.body, /^Hi Patil Traders/, 'English is unchanged');
  const ta = buildReminderIn(invoice, 'due_today', 'ta', new Date(2026, 9, 11));
  assert.match(ta.subject, /இன்று/);
  const required = ['{document}', '{number}', '{business}'];
  for (const [lang, stages] of Object.entries(REMINDER_TEMPLATES)) {
    for (const [stage, tpl] of Object.entries(stages)) for (const p of required) assert.ok(tpl.body.includes(p) || tpl.subject.includes(p), `${lang}/${stage} has ${p}`);
  }
  for (const t2 of Object.values(PARTY_TEMPLATES)) assert.ok(t2.overdue.includes('{amount}') && t2.balance.includes('{net}'));
  assert.equal(Object.keys(STATEMENT_LABELS).sort().join(), 'en,gu,hi,mr,ta');
});

/* ── Catalogue v2 ──────────────────────────────────────────── */

const items: InvoiceItem[] = [
  { id: 'a', name: 'Soap </script><b>', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 18, amount: 0, mrp: 150 } as InvoiceItem,
  { id: 'b', name: "Comb 'x' & \"y\"", type: 'Product', unit: 'PCS', quantity: 1, rate: 50, tax_rate: 0, amount: 0 } as InvoiceItem,
  { id: 'c', name: 'Atta', type: 'Product', unit: 'KG', quantity: 1, rate: 40, tax_rate: 0, amount: 0 } as InvoiceItem,
];

test('catalogue v2: categories, photos, MRP badge, escaped, script-free fallback', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const html = buildCatalogueHtml(items, {
    business: 'A & B <Stores>',
    phone: '9876543210',
    images: new Map([['a', png], ['b', 'data:image/svg+xml;base64,PHN2Zz4=']]),
    categories: new Map([['a', 'Personal care'], ['b', 'Personal care'], ['c', 'Grocery']]),
  });
  assert.ok(!/<script/i.test(html), 'v1 path stays script-free');
  assert.match(html, /A &amp; B &lt;Stores&gt;/);
  assert.match(html, /Soap &lt;\/script&gt;&lt;b&gt;/);
  assert.match(html, /Comb &#39;x&#39; &amp; &quot;y&quot;/);
  assert.ok(html.includes(`src="${png}"`), 'raster photo inlined');
  assert.ok(!html.includes('svg+xml'), 'SVG photos are refused');
  assert.match(html, /21% off MRP/);
  assert.ok(html.indexOf('Grocery') < html.indexOf('Personal care'), 'categories sorted');
  assert.match(html, /Order from this category/);
  assert.match(html, /text=Order%20\(Grocery\)%20from%20A%20%26%20B%20%3CStores%3E%3A%0A%E2%80%A2%20Atta%20\(KG\)%20%C3%97/);
  assert.equal(mrpSaving(118, 150), 21);
  assert.equal(mrpSaving(150, 100), 0);
});

test('catalogue v2 cart: pinned CSP hashes match the inline style and script; data block cannot break out', async () => {
  const html = await buildCatalogue(items, { business: 'Shop', phone: '9876543210', cart: true });
  const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
  assert.ok(html.includes(`script-src ${sha(CATALOGUE_INLINE.script)}`));
  assert.ok(html.includes(`style-src ${sha(CATALOGUE_INLINE.style)}`));
  assert.match(html, /default-src 'none'; img-src data:/);
  assert.ok(!html.includes("'unsafe-inline'"));
  assert.ok(html.includes(`<script>${CATALOGUE_INLINE.script}</script>`), 'the script in the file is exactly the hashed one');
  const data = /<script type="application\/json" id="cat-data">([\s\S]*?)<\/script>/.exec(html)![1];
  assert.ok(!data.includes('</script'), 'the item name cannot close the data block');
  assert.equal(JSON.parse(data).items.a.n, 'Soap </script><b>');
  assert.equal(JSON.parse(data).wa, '919876543210');
  assert.match(html, /data-add="a" hidden/, 'cart buttons appear only when the script runs');
  const plain = await buildCatalogue(items, { business: 'Shop', phone: '9876543210', cart: false });
  assert.match(plain, /script-src 'none'/);
  assert.ok(!/<script/.test(plain));
});

test('catalogue cart message: one WhatsApp order for the whole cart', () => {
  const msg = cartMessage('Shree Stores', [
    { name: 'Rice', qty: 2, price: 52.5, unit: 'KG' },
    { name: 'Soap', qty: 3, price: 40 },
    { name: 'Ghost', qty: 0, price: 10 },
  ], { name: 'Asha' });
  assert.equal(msg, 'Order for Shree Stores\n\n1. Rice × 2 KG @ ₹52.50 = ₹105.00\n2. Soap × 3 @ ₹40.00 = ₹120.00\n\nTotal: ₹225.00\nName: Asha');
  assert.match(cartMessage('X', [{ name: 'A', qty: 1, price: 10 }], { withTax: false }), /Total: ₹10\.00 \+ GST/);
});

test('catalogue maps: photo and category from the catalogue item, else its stock item', () => {
  const assets = JSON.stringify([{ id: 'h1', data: 'data:image/jpeg;base64,/9j/4AAQ' }]);
  const m = catalogueMaps(
    [{ id: 'a', name: 'Rice', image: 'asset:h1' } as InvoiceItem, { id: 'b', name: 'Dal', group_id: 'g2' } as InvoiceItem],
    [{ name: 'rice', group_id: 'g1' }],
    [{ id: 'g1', name: 'Grains' }, { id: 'g2', name: 'Pulses' }],
    assets,
  );
  assert.equal(m.categories.get('a'), 'Grains');
  assert.equal(m.categories.get('b'), 'Pulses');
  assert.equal(m.images.get('a'), 'data:image/jpeg;base64,/9j/4AAQ');
});

/* ── Loans / EMI ───────────────────────────────────────────── */

test('EMI maths: reducing balance, rounding absorbed by the last EMI, 0 % loans, month-end dates', () => {
  assert.equal(emiAmount(100000, 12, 12), 8884.88);
  assert.equal(emiAmount(500000, 9.5, 60), 10500.93);
  assert.equal(emiAmount(120000, 0, 12), 10000);
  const rows = emiSchedule({ principal: 100000, rate: 12, tenure_months: 12, first_emi: '2026-01-31' });
  assert.equal(rows.length, 12);
  assert.equal(rows[0].interest, 1000);
  assert.equal(rows[0].principal, 7884.88);
  assert.equal(rows[11].closing, 0);
  assert.equal(Math.round(rows.reduce((s, r) => s + r.principal, 0) * 100) / 100, 100000);
  assert.ok(Math.abs(rows[11].emi - 8884.88) < 0.05, 'last EMI only absorbs paise');
  assert.equal(rows[1].date, '2026-02-28', 'clamped to month end');
  assert.equal(rows[2].date, '2026-03-31');
  assert.equal(addMonths('2027-12-15', 1), '2028-01-15');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.deepEqual(validateLoan({ lender: '', principal: 0, rate: 70, tenure_months: 0, date: '', first_emi: '' }).length, 6);
});

test('loans: numbered series, disbursement and EMI vouchers split interest / principal, undo', () => {
  const loan = saveLoan({ lender: 'HDFC Bank', principal: 100000, rate: 12, tenure_months: 12, date: '2026-04-05', first_emi: '2026-05-05' });
  assert.equal(loan.number, 'LOAN/FY26-27/0001');
  const d = postDisbursement(loan.id);
  const dv = loadVouchers().find((v) => v.id === d.disbursal_voucher_id)!;
  assert.equal(dv.type, 'RECEIPT');
  assert.deepEqual(dv.lines.map((l) => [l.account_id === A.bank, l.dr, l.cr]), [[true, 10000000, 0], [false, 0, 10000000]]);
  const p1 = payEmi(loan.id, 1);
  const v1 = loadVouchers().find((v) => v.id === p1.voucher_id)!;
  assert.equal(v1.type, 'PAYMENT');
  assert.deepEqual(v1.lines.map((l) => [l.dr, l.cr]), [[788488, 0], [100000, 0], [0, 888488]]);
  assert.equal(v1.lines[1].account_id, A.interestExp);
  assert.throws(() => payEmi(loan.id, 1), /already paid/);
  const st = loanStatement(loadLoans()[0], '2026-07-01');
  assert.equal(st.paidPrincipal, 7884.88);
  assert.equal(st.paidInterest, 1000);
  assert.equal(st.outstanding, 92115.12);
  assert.equal(st.next?.n, 2);
  assert.equal(st.overdue.length, 1, 'June EMI is due and not recorded');
  assert.throws(() => saveLoan({ ...loadLoans()[0], rate: 10 }), /EMIs recorded/);
  deleteLoanPayment(loan.id, p1.id);
  assert.equal(loadLoans()[0].payments.length, 0);
  assert.equal(loadVouchers().filter((v) => v.voucher_class === 'Loan EMI').length, 0);
  const second = saveLoan({ lender: 'SBI', principal: 50000, rate: 10, tenure_months: 6, date: '2026-06-01', first_emi: '2026-07-01' });
  assert.equal(second.number, 'LOAN/FY26-27/0002');
});

/* ── Finer user rights ─────────────────────────────────────── */

test('rights: per-document toggles narrow a clerk, never lift a viewer or touch the owner', () => {
  const clerk = { id: 'c1', name: 'Counter', role: 'clerk' as const, rights: cleanRights({ docs: { quote: { create: false }, sales: { delete: false } } })! };
  assert.equal(rightsFilter(clerk.rights, 'doc.create'), true, 'invoices still allowed');
  assert.equal(actorCan(clerk, 'clerk', 'doc.create'), true);
  const nothing = cleanRights({ docs: { sales: { create: false }, quote: { create: false }, note: { create: false }, challan: { create: false } } })!;
  assert.equal(actorCan({ ...clerk, rights: nothing }, 'clerk', 'doc.create'), false);
  const viewer = { id: 'v1', name: 'V', role: 'viewer' as const, rights: cleanRights({ pos_only: true })! };
  assert.equal(actorCan(viewer, 'viewer', 'doc.create'), false, 'rights never lift a role');
  assert.equal(actorCan(viewer, 'viewer', 'data.erase'), false);
  assert.equal(actorCan({ id: 'owner', name: 'O', role: 'owner', rights: nothing }, 'owner', 'doc.create'), true, 'the owner is never limited');
  const cashier = { id: 'k1', name: 'Cashier', role: 'clerk' as const, rights: POS_CASHIER };
  setActorProvider(() => cashier);
  assert.equal(can('doc.create'), true);
  assert.equal(can('master.edit'), false, 'POS-only cashier cannot edit masters');
  assert.equal(can('report.export'), false);
  assert.equal(can('doc.deleteIssued'), false, 'owner-only stays owner-only');
  assert.equal(can('settings.manage'), false);
  assert.equal(cleanRights({ back_days: '', discount_cap: 150, docs: { sales: { create: true } } }), undefined, 'nothing restrictive left');
});

test('rights: back-dated window, discount cap and the data-layer check (fails closed, then enforces)', () => {
  const r = cleanRights({ back_days: 2, discount_cap: 10 })!;
  assert.equal(backdateProblem(r, '2026-10-23', '2026-10-25'), '');
  assert.match(backdateProblem(r, '2026-10-22', '2026-10-25'), /up to 2 day/);
  assert.match(backdateProblem({ back_days: 0 }, '2026-10-24', '2026-10-25'), /today/);
  assert.equal(discountProblem(r, 10), '');
  assert.match(discountProblem(r, 12.5), /at most 10%/);
  assert.equal(maxDiscountPercent({ items: [{ discount_percent: 5 }], discount_type: 'PERCENT', discount_rate: 15 }), 15);
  assert.equal(maxDiscountPercent({ items: [], discount_type: 'AMOUNT', subtotal: 1000, discount_amount: 200 }), 20);
  assert.throws(() => enforceRights(r, 'TAX_INVOICE', 'create', '2026-10-01', undefined, '2026-10-25'), /day\(s\) back/);
  assert.throws(() => enforceRights(r, 'TAX_INVOICE', 'alter', '2026-10-25', { items: [{ discount_percent: 20 }] }, '2026-10-25'), /discount/);
  assert.throws(() => enforceRights(POS_CASHIER, 'QUOTATION', 'create', '2026-10-25', undefined, '2026-10-25'), /cannot create/);
  assert.throws(() => enforceRights(POS_CASHIER, 'TAX_INVOICE', 'delete'), /cannot delete/);
  enforceRights(POS_CASHIER, 'TAX_INVOICE', 'create', '2026-10-25', { items: [{ discount_percent: 10 }] }, '2026-10-25');
  // Owner / no rights: always passes; a clerk with rights goes through the registered rules.
  checkDocRight(null, 'TAX_INVOICE', 'delete');
  checkDocRight({ role: 'owner', rights: POS_CASHIER }, 'TAX_INVOICE', 'delete');
  assert.throws(() => checkDocRight({ role: 'clerk', rights: POS_CASHIER }, 'CREDIT_NOTE', 'create', '2026-10-25'), /cannot create/);
});

test('rights: localDb refuses a back-dated invoice and an over-cap discount for a limited clerk', () => {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const old = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 10);
  setActorProvider(() => ({ id: 'c1', name: 'Counter', role: 'clerk', rights: { back_days: 3, discount_cap: 5 } }));
  assert.throws(() => localDb.invoices.save(inv({ id: 'x1', issue_date: iso(old), status: 'Draft' })), /day\(s\) back/);
  assert.throws(
    () => localDb.invoices.save(inv({ id: 'x2', issue_date: iso(today), status: 'Draft', items: [{ id: 'l', name: 'A', type: 'Product', quantity: 1, rate: 10, discount_percent: 8, amount: 9.2 }] as never })),
    /discount/,
  );
});

/* ── Currency master ───────────────────────────────────────── */

test('currency rates: RBI-style wide CSV and long CSV; the document picks the rate on or before its date', () => {
  const wide = 'Date,USD,GBP,EUR,100 JPY\n24-10-2026,84.10,109.5,91.2,55.40\n25/10/2026,84.25,,91.4,55.10\nbad,1,2,3,4';
  const { rows, skipped } = parseRatesCsv(wide, 'RBI');
  assert.equal(skipped, 1);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.find((r) => r.currency === 'JPY' && r.date === '2026-10-24'), { currency: 'JPY', date: '2026-10-24', rate: 0.554, source: 'RBI' });
  const long = parseRatesCsv('Date,Currency,Rate\n2026-10-20,usd,83.9\n2026-10-21,INR,1');
  assert.equal(long.rows.length, 1);
  const merged = mergeRates([], [...rows, ...long.rows]);
  assert.equal(rateOn(merged, 'USD', '2026-10-24')?.rate, 84.1);
  assert.equal(rateOn(merged, 'usd', '2026-10-23')?.rate, 83.9, 'the latest rate before the date');
  assert.equal(rateOn(merged, 'USD', '2026-10-19'), null);
  assert.equal(rateOn(merged, 'GBP', '2026-10-30')?.date, '2026-10-24');
  const again = mergeRates(merged, [{ currency: 'USD', date: '2026-10-24', rate: 84.2, source: 'manual' }]);
  assert.equal(again.filter((r) => r.currency === 'USD' && r.date === '2026-10-24').length, 1, 'one rate per currency and day');
});

/* ── Import presets, checklist, onboarding ─────────────────── */

test('import presets: QuickBooks, Xero, Refrens, ClearOne, Marg are detected from their headers', () => {
  for (const id of ['quickbooks', 'xero', 'refrens', 'clearone', 'marg', 'busy']) assert.ok(IMPORT_PRESETS.some((p) => p.id === id), id);
  assert.equal(detectPreset('clients', ['ContactName', 'EmailAddress', 'POAddressLine1', 'POCity', 'TaxNumber']), 'xero');
  assert.equal(detectPreset('invoices', ['Bill No', 'Bill Date', 'Party Name', 'Taxable', 'CGST', 'Net Amount']), 'marg');
  assert.equal(detectPreset('invoices', ['Invoice Number', 'Invoice Date', 'Customer Name', 'Customer GSTIN', 'CGST Amount', 'Invoice Total']), 'clearone');
  const g = guessMapping('invoices', ['Num', 'Date', 'Customer', 'Amount', 'Open Balance'], [], 'quickbooks');
  assert.equal(g.mapping.invoice_number, 0);
  assert.equal(g.mapping.balance_due, 4);
});

test('checklist v2: seven steps derived from facts', () => {
  const none = buildChecklist({ profileReady: false, clients: 0, items: 0, invoices: 0, messagesSent: 0, payments: 0 });
  assert.deepEqual(none.map((s) => s.id), ['profile', 'client', 'item', 'invoice', 'whatsapp', 'payment', 'backup']);
  assert.ok(none.every((s) => !s.done));
  const all = buildChecklist({ profileReady: true, clients: 1, items: 2, invoices: 3, messagesSent: 1, payments: 1, lastBackup: '2026-10-01T10:00:00Z' });
  assert.ok(all.every((s) => s.done));
});

test('onboarding: composition answer makes the profile a composition dealer (Bills of Supply)', () => {
  const s0 = localDb.settings.get();
  const a = { ...answersFrom(null, 'classic_orange'), companyName: 'Shree', gstRegistered: true, companyGstin: '27AAPFU0939F1ZV', composition: true };
  const s1 = applyAnswers(s0, a);
  const p = s1.profiles.find((x) => x.id === s1.activeProfileId)!;
  assert.equal(p.gst_scheme, 'composition');
  assert.equal(s1.gst_filing_frequency, 'composition');
  const s2 = applyAnswers(s0, { ...a, composition: false });
  assert.equal(s2.profiles.find((x) => x.id === s2.activeProfileId)!.gst_scheme, s0.profiles[0].gst_scheme);
  assert.notEqual(s2.gst_filing_frequency, 'composition');
});

/* ── R6-B2: sidebar reach ──────────────────────────────────── */

test('R6-B2 sidebar: Manufacturing and Distribution entries; kirana hides features (hint count > 0), full hides none', async () => {
  const { countHidden, impliedPacks } = await import('../src/lib/shop-mode.ts');
  const layout = readFileSync(new URL('../src/layouts/DashboardLayout.tsx', import.meta.url), 'utf8');
  const nav = layout.slice(layout.indexOf('const NAV_GROUPS'), layout.indexOf('const SETTINGS_ENTRY'));
  const paths = [...nav.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.includes('/manufacturing') && paths.includes('/distribution'));
  assert.ok(paths.indexOf('/manufacturing') === paths.indexOf('/inventory') + 1, 'Manufacturing sits after Inventory');
  assert.ok(paths.indexOf('/distribution') === paths.indexOf('/receivables') + 1, 'Distribution sits after Receivables');
  assert.ok(paths.length <= 26, `sidebar has ${paths.length} entries (Settings is pinned apart)`);
  const kirana = applyBusinessType('kirana');
  assert.ok(countHidden(paths, enabledModules(kirana), impliedPacks(kirana)) > 0);
  assert.equal(countHidden(paths, enabledModules(applyBusinessType('full')), impliedPacks({ business_type: 'full' })), 0);
  assert.equal(countHidden(paths, null), 0, 'no shop mode = nothing hidden');
  // A transporter keeps Distribution (its pack's screen) although the preset has no inventory module.
  const transport = applyBusinessType('transport');
  assert.equal(isPathVisible('/distribution', enabledModules(transport), impliedPacks(transport)), true);
  // The hint, F1, the route trail and the help-event listener are wired in the shell.
  assert.match(layout, /\/settings\?tab=features/);
  assert.match(layout, /OPEN_HELP_EVENT/);
  assert.match(layout, /pushRoute\(location\)/);
  assert.match(layout, /f1:/);
  assert.match(layout, /'\/practice'/);
});
