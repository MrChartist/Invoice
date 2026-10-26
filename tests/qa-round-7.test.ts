/**
 * QA round 7 (docs/prd/qa-round-7.md): one regression test per finding G1–G10, built on the QA probes
 * (`qa7/probes/zz-qa7-*.test.ts`). Browser-only halves (Escape over stacked dialogs, the stale-tab banner) are
 * also stepped in tests/e2e/smoke.mjs.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { pinCompany, readRegistry, realCompanies, writeRegistry, type CompanyEntry } from '../src/lib/company-registry.ts';
import { demoDatabaseOpen, demoStatus, loadDemoData } from '../src/lib/demo-data.ts';
import { readRaw, writeRaw } from '../src/lib/storage.ts';
import { companyMoved } from '../src/lib/cross-tab.ts';
import { isTopModal, pushModal } from '../src/lib/modal-stack.ts';
import { SHARE_CAP, capForShare, emptyDraft, encodedLength, mailtoLink, subjectFor, whatsappLink } from '../src/lib/feedback.ts';
import { scrubTyped } from '../src/lib/diagnostics.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

const MAIN: CompanyEntry = { id: 'default', name: 'Asha Traders', created: '' };
const DEMO: CompanyEntry = { id: 'demo1', name: 'Demo', created: '', demo: true, from: 'default' };

function realInvoice(): InvoiceRecord {
  return {
    id: 'real-1', invoice_number: 'INV/FY26-27/0001', doc_type: 'TAX_INVOICE', issue_date: '2026-09-01', due_date: '2026-09-15',
    status: 'Sent', currency: 'INR', client: { id: 'rc', name: 'Real Customer' },
    items: [{ id: 'i', name: 'Real', quantity: 1, rate: 100, tax_rate: 0, amount: 100 }], total: 100, balance_due: 100,
  } as unknown as InvoiceRecord;
}

const owner = () => setActorProvider(() => ({ id: 'o', name: 'Owner', role: 'owner' }));

beforeEach(() => {
  resetStorage();
  pinCompany(null);
  owner();
});
afterEach(() => {
  pinCompany(null);
  setActorProvider(null);
});

test('QA7 G1: a stale tab still on the real company is not the Demo company after another tab switches; no sample write lands there', async () => {
  const { fillDemo, isDemoCompanyOpen, resetDemoSamples, takePending, DEMO_PENDING_KEY } = await import('../src/components/onboarding/demo-company.ts');
  // Tab B booted on the main company (its database is pinned) …
  writeRegistry({ active: 'default', list: [MAIN, DEMO] });
  pinCompany('default');
  localDb.settings.save({ ...localDb.settings.get(), onboarded: true });
  // … then tab A opened the Demo company: the device-local registry now says "demo1", with a pending fill.
  writeRegistry({ active: 'demo1', list: [MAIN, DEMO] });
  writeRaw(DEMO_PENDING_KEY, 'demo1|wholesale');

  assert.equal(companyMoved(), true, 'the stale tab is told "This tab is on another company — reload"');
  assert.equal(isDemoCompanyOpen(), false, 'no Demo banner / Reset samples in the real company');
  assert.equal(takePending(), null, 'the pending request is left for the Demo tab');
  assert.equal(readRaw(DEMO_PENDING_KEY), 'demo1|wholesale', 'and is not consumed here');
  await assert.rejects(resetDemoSamples());
  await assert.rejects(fillDemo());
  assert.deepEqual(loadDemoData({ confirm: true }), { ok: false, reason: 'not_demo_company' }, 'the data layer refuses too');
  assert.equal(localDb.invoices.getAll().length, 0, 'the real company holds no sample invoice');
  assert.ok(src('components/pwa/CrossTabNotice.tsx').includes('moved={companyMoved()}'), 'the shell banner reads the same check');

  // The Demo tab itself (its database pinned to demo1) takes the request, marks its database and fills it.
  resetStorage();
  writeRegistry({ active: 'demo1', list: [MAIN, DEMO] });
  pinCompany('demo1');
  writeRaw(DEMO_PENDING_KEY, 'demo1|wholesale');
  assert.equal(companyMoved(), false);
  assert.deepEqual(takePending(), { id: 'demo1', business_type: 'wholesale' });
  assert.equal(localDb.settings.get().demo_company, true, 'marker written inside the Demo database');
  assert.equal(isDemoCompanyOpen(), true);
  await fillDemo({ business_type: 'wholesale' });
  assert.ok(demoStatus().counts.invoices > 0);
  assert.ok(localDb.invoices.getAll().every((i) => (i as { demo?: boolean }).demo));
});

test('QA7 G2: a company the user named "Demo" is never the sample company; only the creator\'s flag + marker count', async () => {
  const { isDemoCompanyOpen, resetDemoSamples, takePending, DEMO_PENDING_KEY } = await import('../src/components/onboarding/demo-company.ts');
  for (const name of ['demo', 'Demo']) {
    resetStorage();
    owner();
    writeRegistry({ active: 'c2', list: [MAIN, { id: 'c2', name, created: '' }] });
    localDb.settings.save({ ...localDb.settings.get(), onboarded: true, business_type: 'wholesale' } as never);
    localDb.invoices.save(realInvoice());
    assert.equal(isDemoCompanyOpen(), false, `"${name}" with a real invoice is not the Demo company`);
    await assert.rejects(resetDemoSamples());
    writeRaw(DEMO_PENDING_KEY, 'c2');
    assert.equal(takePending(), null, `"${name}": a pending request does not fill it`);
    assert.equal(localDb.invoices.getAll().length, 1, 'only the real invoice');
    assert.equal(readRegistry().list.find((c) => c.id === 'c2')?.demo, undefined, 'never flagged');
  }
  // A database carrying the marker (say, restored from a Demo backup) whose registry entry is not flagged: refused.
  resetStorage();
  writeRegistry({ active: 'c2', list: [MAIN, { id: 'c2', name: 'Shop', created: '' }] });
  localDb.settings.save({ ...localDb.settings.get(), demo_company: true });
  assert.equal(demoDatabaseOpen(), false);
  assert.deepEqual(loadDemoData({ confirm: true }), { ok: false, reason: 'not_demo_company' });
  // The flag without the database marker is refused as well (a registry entry alone proves nothing).
  resetStorage();
  writeRegistry({ active: 'demo1', list: [MAIN, DEMO] });
  assert.equal(demoDatabaseOpen(), false);
  assert.equal(isDemoCompanyOpen(), false);
});

test('QA7 G2: a Demo company made by the earlier flow is recognised by how it was made (fresh "Demo" + samples only)', async () => {
  const { isDemoCompanyOpen, takePending, DEMO_PENDING_KEY } = await import('../src/components/onboarding/demo-company.ts');
  const legacy: CompanyEntry = { id: 'old1', name: 'Demo', created: '' };
  // The earlier flow: createCompany("Demo"), pending flag, switch; the database is still fresh when the tab opens.
  writeRegistry({ active: 'old1', list: [MAIN, legacy] });
  writeRaw(DEMO_PENDING_KEY, 'old1');
  assert.ok(takePending(), 'a pending request from the earlier version is finished in its fresh Demo company');
  assert.equal(readRegistry().list.find((c) => c.id === 'old1')?.demo, true);
  assert.equal(localDb.settings.get().demo_company, true);

  // Already filled by the earlier version: sample rows only, no profile of the user's own → adopted on open.
  resetStorage();
  writeRegistry({ active: 'old1', list: [MAIN, legacy] });
  localDb.invoices.save({ ...realInvoice(), id: 'd1', demo: true } as InvoiceRecord);
  assert.equal(isDemoCompanyOpen(), true);
  assert.equal(readRegistry().list.find((c) => c.id === 'old1')?.demo, true);

  // The same name holding one invoice of the user's own is never adopted.
  resetStorage();
  writeRegistry({ active: 'old1', list: [MAIN, legacy] });
  localDb.invoices.save({ ...realInvoice(), id: 'd1', invoice_number: 'INV/FY26-27/0009', demo: true } as InvoiceRecord);
  localDb.invoices.save(realInvoice());
  assert.equal(isDemoCompanyOpen(), false);
});

test('QA7 G3: Escape acts on the top dialog only (modal stack)', () => {
  const form = {};
  const help = {};
  const popForm = pushModal(form);
  assert.equal(isTopModal(form), true);
  const popHelp = pushModal(help); // F1 Help over the Add client form
  assert.equal(isTopModal(help), true);
  assert.equal(isTopModal(form), false, 'the form underneath ignores the Escape');
  popHelp();
  assert.equal(isTopModal(form), true, 'the next Escape reaches the form');
  popForm();
  assert.equal(isTopModal(form), false);
  const modal = src('components/ui/Modal.tsx');
  assert.ok(modal.includes('if (!isTopModal(token)) return;'), 'Modal checks the stack before acting on a key');
  assert.ok(src('layouts/DashboardLayout.tsx').includes("f1: () => { if (!document.querySelector('[aria-modal]')) openHelp(); }"), 'F1 is quiet while a dialog is open');
});

test('QA7 G4: an emoji at the cut point never splits a surrogate pair or throws', () => {
  for (let n = 1500; n < 1800; n += 3) {
    const d = { ...emptyDraft(''), did: 'x'.repeat(n) + '😀'.repeat(200) };
    const c = capForShare(d, 'diag');
    assert.ok(c.shortened);
    assert.doesNotThrow(() => whatsappLink(c.text), `cut at ${n}`);
    assert.doesNotThrow(() => mailtoLink(subjectFor(d), c.text));
    assert.ok(encodedLength(c.text) <= SHARE_CAP);
  }
  // A lone surrogate pasted in is replaced, not passed to encodeURIComponent.
  const broken = capForShare({ ...emptyDraft(''), did: 'half \uD83D emoji' }, 'diag');
  assert.doesNotThrow(() => whatsappLink(broken.text));
  assert.ok(src('components/layout/ReportProblemDialog.tsx').includes('} catch {\n      return null;'), 'the dialog builds its links inside try / catch');
});

test('QA7 G5: the share cap bounds the ENCODED link text (English and Hindi), full report still composed', () => {
  const diag = Array.from({ length: 40 }, (_, i) => `line ${i} of the diagnostic block with some words`).join('\n');
  for (const text of ['I saved the bill and the total went wrong. '.repeat(20), 'मैंने बिल सेव किया और कुल गलत आया। '.repeat(20), 'मैंने बिल सेव किया '.repeat(200)]) {
    const d = { ...emptyDraft('GST reports'), did: text };
    const c = capForShare(d, diag);
    assert.equal(c.shortened, true);
    assert.ok(encodedLength(c.text) <= SHARE_CAP, `encoded ${encodedLength(c.text)}`);
    assert.ok(whatsappLink(c.text).length <= SHARE_CAP + 30);
    assert.ok(c.text.includes('the full report was copied'));
  }
  const small = capForShare({ ...emptyDraft(''), did: 'short' }, 'diag');
  assert.equal(small.shortened, false);
});

test('QA7 G6: the typed-text scrubber masks UPI IDs, Devanagari digits, grouped amounts and lower-case PANs; codes stay', () => {
  const cases: [string, string][] = [
    ['upi asha@okhdfcbank', 'upi [upi]'],
    ['pan aapfu0939f and AapFu0939F', 'pan [pan] and [pan]'],
    ['billed 1,250 to Asha Traders', 'billed [amount] to Asha Traders'],
    ['then 12.5k and 2 lakh', 'then [amount] and [amount]'],
    ['paid 999 rupees', 'paid [amount]'],
    ['राशि ५०० रुपये', 'राशि [amount]'],
  ];
  for (const [input, want] of cases) assert.equal(scrubTyped(input), want, input);
  assert.ok(!/\d/.test(scrubTyped('1,25,000.50 and 10,500')), 'lakh-grouped amounts leave no digit');
  const hi = scrubTyped('फ़ोन ९८७६५४३२१० पर करें, राशि १२५०० रुपये');
  assert.ok(!/[0-9०-९]{3,}/.test(hi), hi);
  assert.equal(scrubTyped('Form 194C on GSTR-3B, 26Q and section 194J'), 'Form 194C on GSTR-3B, 26Q and section 194J', 'codes stay readable');
  assert.equal(scrubTyped('mail asha@example.co.in'), 'mail [email]');
});

test('QA7 G7: the Demo company does not count toward "several companies" (Practice desk, All companies)', () => {
  writeRegistry({ active: 'default', list: [MAIN, DEMO] });
  assert.deepEqual(realCompanies().map((c) => c.id), ['default']);
  const layout = src('layouts/DashboardLayout.tsx');
  assert.ok(/practice = [^\n]*realCompanies\(\)\.length > 1/.test(layout), 'the sidebar rule counts real companies only');
  assert.ok(!layout.includes('readRegistry().list.length'), 'no raw registry count left in the shell');
  assert.ok(src('pages/Practice.tsx').includes('practiceEmpty(realCompanies().length)'));
  assert.ok(src('components/command/CommandPalette.tsx').includes('realCompanies().length > 1'));
  writeRegistry({ active: 'default', list: [MAIN, DEMO, { id: 'c3', name: 'Second shop', created: '' }] });
  assert.equal(realCompanies().length, 2);
});

test('QA7 G8: Ctrl+K Tabs / Features rows follow the role (a viewer is not offered BRS, recurring, payroll, Data & backup)', async () => {
  const { tabDestinations, featureDestinations } = await import('../src/components/command/tab-destinations.ts');
  const hrefs = () => new Set(tabDestinations().map((r) => r.href));
  const all = hrefs();
  for (const h of ['/reconcile?tab=brs', '/recurring?tab=schedules', '/settings?tab=data']) assert.ok(all.has(h), `owner sees ${h}`);
  setActorProvider(() => ({ id: 'v', name: 'Viewer', role: 'viewer' }));
  const viewer = hrefs();
  for (const h of all) {
    if (/^\/(reconcile|recurring|time|payroll)\?/.test(h)) assert.ok(!viewer.has(h), `viewer is offered ${h}`);
  }
  for (const h of ['/settings?tab=data', '/settings?tab=business', '/settings?tab=defaults']) assert.ok(!viewer.has(h), h);
  assert.ok(viewer.has('/settings?tab=features') && viewer.has('/books?tab=day'), 'what a viewer may open stays');
  assert.ok(featureDestinations().length > 0, 'Settings → Features is readable by every role');
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  assert.ok(!hrefs().has('/payroll?tab=run') && hrefs().has('/reconcile?tab=brs'), 'a clerk: no payroll, books tabs stay');
});

test('QA7 G9: palette help topics follow the language of each open', async () => {
  const { helpRows, loadHelpIndex } = await import('../src/components/command/tab-destinations.ts');
  const raw = await loadHelpIndex();
  const tb = raw.find((r) => r.title === 'Trial balance');
  assert.ok(tb?.hiTitle, 'the topic has a Hindi title');
  assert.equal(helpRows(raw, 'en').find((r) => r.id === `help:${tb!.id}`)?.title, 'Trial balance');
  assert.equal(helpRows(raw, 'hi').find((r) => r.id === `help:${tb!.id}`)?.title, tb!.hiTitle, 'Hindi after the switch');
  const palette = src('components/command/CommandPalette.tsx');
  assert.ok(palette.includes('disc.helpRows(helpRaw, getLanguage())'), 'mapped per open from the raw index');
  assert.ok(!palette.includes('setHelpEntries'), 'no once-only titled copy left');
});

test('QA7 G10: a clerk\'s Skip / Hide applies to that clerk only; the owner\'s card and the stored shape stay', async () => {
  const { loadSetupProgress, saveSetupProgress, showCard, allSteps, SETUP_PROGRESS_KEY } = await import('../src/lib/checklist-steps.ts');
  const facts = { profileReady: false, clients: 0, items: 0, invoices: 0, messagesSent: 0, payments: 0 };
  // The owner skipped "item" earlier (R6-A1 shape).
  saveSetupProgress({ skipped: ['item'] });
  setActorProvider(() => ({ id: 'c', name: 'Clerk', role: 'clerk' }));
  assert.deepEqual(loadSetupProgress(), { skipped: [] }, 'a clerk starts from their own empty state');
  saveSetupProgress({ skipped: ['client'], hidden_at: '2026-10-26T10:00:00.000Z' });
  assert.equal(loadSetupProgress().hidden_at, '2026-10-26T10:00:00.000Z', 'the clerk\'s card is hidden for the clerk');
  owner();
  const p = loadSetupProgress();
  assert.deepEqual(p, { skipped: ['item'] }, 'the owner\'s state is untouched');
  const steps = allSteps(facts, { packs: [], modules: null, role: 'owner' }, p);
  assert.equal(showCard(steps, p, 'owner'), true, 'the owner still sees the card');
  assert.equal(steps.find((s) => s.key === 'client')?.skipped, false);
  // The owner's own save keeps the clerk's slot; the stored top level keeps the R6-A1 shape.
  saveSetupProgress({ skipped: ['item', 'opening'] });
  const stored = JSON.parse(readRaw(SETUP_PROGRESS_KEY) ?? 'null');
  assert.deepEqual(stored.skipped, ['item', 'opening']);
  assert.equal(stored.byUser.c.hidden_at, '2026-10-26T10:00:00.000Z');
  // A legacy object without byUser still reads.
  writeRaw(SETUP_PROGRESS_KEY, JSON.stringify({ skipped: ['backup'], hidden_at: 'x' }));
  assert.deepEqual(loadSetupProgress(), { skipped: ['backup'], hidden_at: 'x' });
});

test('QA7: the Demo banner\'s "Switch to" returns to the company the user came from', async () => {
  const { companyToReturnTo } = await import('../src/components/onboarding/demo-company.ts');
  writeRegistry({ active: 'demo1', list: [{ id: 'default', name: 'Main business', created: '' }, { id: 'c3', name: 'Shop two', created: '' }, { ...DEMO, from: 'c3' }] });
  assert.equal(companyToReturnTo()?.id, 'c3');
  writeRegistry({ active: 'demo1', list: [MAIN, { ...DEMO, from: 'gone' }] });
  assert.equal(companyToReturnTo()?.id, 'default', 'falls back to the first own company');
});
