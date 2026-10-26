/** R5-B: with the transport / works packs off, nothing reads their tables and nothing first-paint imports the package. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupTransport, setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX, setReadTrace } from '../src/lib/storage.ts';
import { registerTransportAlerts } from '../src/lib/transport/transport-alerts.ts';
import { registerWorksAlerts } from '../src/lib/works/works-alerts.ts';
import { buildContext, collectNotifications } from '../src/lib/notifications.ts';
import { billWarnings } from '../src/lib/bill-guard.ts';
import { visibleTabs, activePacks } from '../src/lib/industry-packs.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

const B_TABLES = ['consignment_notes', 'gta_options', 'vehicles', 'trips', 'ra_measurements', 'boq_coefficients'];

const traced = (fn: () => void): string[] => {
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    fn();
  } finally {
    setReadTrace(prev);
  }
  return B_TABLES.filter((t) => seen.has(DB_PREFIX + t) || seen.has(t));
};

test('packs off: bell providers and the bill guard read no R5-B table and raise nothing', () => {
  setupTransport({ industry_packs: [] });
  registerTransportAlerts();
  registerWorksAlerts();
  let out: ReturnType<typeof collectNotifications> = [];
  assert.deepEqual(traced(() => { out = collectNotifications(buildContext(new Date('2027-02-01T10:00:00'))); }), []);
  assert.ok(!out.some((n) => n.id.startsWith('tw:')));
  const bill = { kind: 'PURCHASE', vendor_name: 'X', bill_number: '1', date: '2026-07-01', category: 'Repairs', lines: [], taxable: 100, cgst: 9, sgst: 9, igst: 0, total: 118, itc_eligible: true, amount_paid: 0 } as Omit<PurchaseRecord, 'id'>;
  assert.deepEqual(traced(() => billWarnings(bill, [])), []);
});

test('pack on: the transport provider reads its tables (and the GTA window notice shows)', () => {
  setupTransport();
  registerTransportAlerts();
  let out: ReturnType<typeof collectNotifications> = [];
  const keys = traced(() => { out = collectNotifications(buildContext(new Date('2027-02-01T10:00:00'))); });
  assert.ok(keys.includes('gta_options') && keys.includes('vehicles'));
  assert.ok(out.some((n) => n.id === 'tw:gta:27-28'));
});

test('tabs: Transport / Works are listed only with their pack (or business type); the URL still opens them', () => {
  const dist = ['masters', 'transport'].map((id) => ({ id, ...(id === 'transport' ? { pack: 'transport' as const } : {}) }));
  assert.deepEqual(visibleTabs(dist, {}).map((t) => t.id), ['masters']);
  assert.deepEqual(visibleTabs(dist, { business_type: 'kirana' }).map((t) => t.id), ['masters']);
  assert.deepEqual(visibleTabs(dist, { business_type: 'transport' }).map((t) => t.id), ['masters', 'transport']);
  assert.deepEqual(visibleTabs(dist, { industry_packs: [] }, 'transport').map((t) => t.id), ['masters', 'transport']);
  assert.deepEqual(activePacks({ business_type: 'contractor' }), ['works']);
});

test('receivables: documents without RA deductions age exactly as before (no held amount)', () => {
  const boq = setupWorks({ industry_packs: [] });
  void boq;
  localDb.invoices.save({ ...localDb.invoices.getById('boq1')!, id: '', invoice_number: '', doc_type: 'TAX_INVOICE', issue_date: '2026-06-01', due_date: '2026-06-15', status: 'Sent' });
  const rep = buildReceivables({ invoices: localDb.invoices.getAll(), payments: [], clients: localDb.clients.getAll() }, { now: new Date('2026-12-31T10:00:00') });
  const b = rep.parties[0].bills[0];
  assert.equal(b.held, undefined);
  assert.equal(rep.totals.overdue, b.outstanding);
});

test('no first-paint module imports the transport / works package statically; the tabs are lazy', () => {
  for (const f of ['src/main.tsx', 'src/App.tsx', 'src/layouts/DashboardLayout.tsx', 'src/pages/Dashboard.tsx', 'src/store/useInvoiceStore.ts', 'src/components/command/NotificationBell.tsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/^import type [^;]*;/gm, '');
    assert.ok(!/^import [^;]*(lib\/transport\/|lib\/works\/|transport-works-rules|components\/transport|components\/works)/m.test(src), f);
  }
  const dist = readFileSync(new URL('../src/pages/Distribution.tsx', import.meta.url), 'utf8');
  assert.match(dist, /lazy\(\(\) => import\('\.\.\/components\/transport\/TransportTab'\)\)/);
  const time = readFileSync(new URL('../src/pages/Time.tsx', import.meta.url), 'utf8');
  assert.match(time, /lazy\(\(\) => import\('\.\.\/components\/works\/WorksTab'\)\)/);
  const pay = readFileSync(new URL('../src/components/modals/PaymentModal.tsx', import.meta.url), 'utf8');
  assert.match(pay, /lazy\(\(\) => import\('\.\.\/works\/RaReceiptPanel'\)\)/);
  const tax = readFileSync(new URL('../src/lib/tax-rules.ts', import.meta.url), 'utf8');
  assert.ok(!/GTA_RATE_RULES/.test(tax), 'B rules live outside the first-paint tax-rules.ts');
});
