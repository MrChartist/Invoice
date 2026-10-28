/**
 * PENDING #24 (R6 §7 Q6): samples an earlier version loaded into a REAL company move to the Demo company — exactly the
 * sample rows leave, the user's own rows stay, the Demo company is opened only through `startDemoCompany`; refused (and
 * nothing removed) without a second-company database, in the Demo company, without samples, or for a clerk.
 */
import './helpers/shim.ts';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { pinCompany, readRegistry, writeRegistry, type CompanyEntry } from '../src/lib/company-registry.ts';
import { demoStatus } from '../src/lib/demo-data.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { moveSamplesToDemo } from '../src/components/onboarding/demo-company.ts';

const MAIN: CompanyEntry = { id: 'default', name: 'Asha Traders', created: '' };
const inv = (id: string, demo: boolean) => ({
  id, invoice_number: `INV/FY26-27/000${id.length}`, doc_type: 'TAX_INVOICE', issue_date: '2026-09-01', due_date: '2026-09-15', status: 'Sent', currency: 'INR',
  client: { id: 'c', name: 'C' }, items: [{ id: 'i', name: 'X', quantity: 1, rate: 100, tax_rate: 0, amount: 100 }], total: 100, balance_due: 100, ...(demo ? { demo: true } : {}),
}) as unknown as InvoiceRecord;

const owner = () => setActorProvider(() => ({ id: 'o', name: 'Owner', role: 'owner' }));
beforeEach(() => {
  resetStorage();
  pinCompany(null);
  owner();
  writeRegistry({ active: 'default', list: [MAIN] });
  localDb.invoices.save(inv('real', false));
  localDb.invoices.save(inv('sample1', true));
});
afterEach(() => {
  pinCompany(null);
  setActorProvider(null);
});

test('the sample rows leave the real company and the Demo company is started', async () => {
  let started = 0;
  assert.equal(demoStatus().loaded, true);
  const r = await moveSamplesToDemo({ supported: () => true, start: () => { started++; return true; } });
  assert.equal(r, 'moved');
  assert.equal(started, 1);
  assert.equal(demoStatus().loaded, false, 'no sample row is left here');
  assert.deepEqual(localDb.invoices.getAll().map((i) => i.id), ['real'], "the user's own invoice stays");
  assert.equal(readRegistry().list.find((c) => c.id === 'default')?.demo, undefined, 'the real company is never flagged');
});

test('refused, nothing removed: no second-company database, a clerk, no samples, or inside the Demo company', async () => {
  const start = () => { throw new Error('must not start'); };
  assert.equal(await moveSamplesToDemo({ supported: () => false, start }), 'no_companies');
  assert.equal(await moveSamplesToDemo({ start }), 'no_companies', 'node has no IndexedDB: the real check refuses');
  assert.equal(demoStatus().loaded, true);
  setActorProvider(() => ({ id: 'k', name: 'Clerk', role: 'clerk' }));
  await assert.rejects(moveSamplesToDemo({ supported: () => true, start }));
  assert.equal(demoStatus().loaded, true, 'a clerk removes nothing');
  owner();
  // The Demo company itself (flag + marker): its samples stay where they belong.
  writeRegistry({ active: 'default', list: [{ ...MAIN, demo: true }] });
  localDb.settings.save({ ...localDb.settings.get(), demo_company: true });
  assert.equal(await moveSamplesToDemo({ supported: () => true, start }), 'in_demo');
  assert.equal(demoStatus().loaded, true);
  resetStorage();
  writeRegistry({ active: 'default', list: [MAIN] });
  assert.equal(await moveSamplesToDemo({ supported: () => true, start }), 'no_samples');
});
