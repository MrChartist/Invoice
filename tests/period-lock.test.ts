import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { dumpStorage, resetStorage } from './helpers/shim.ts';
import { createViaStore, installSettings, reload } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { audit } from '../src/lib/audit.ts';
import {
  OVERRIDE_TTL_MS,
  PeriodLockedError,
  SETTINGS_OVERRIDE,
  clearOverrides,
  getLockUntil,
  grantOverride,
  hasOverride,
  isDateLocked,
  isLocked,
  normalizeLockDate,
  partitionByLock,
} from '../src/lib/period-lock.ts';
import { lockPresets } from '../src/lib/lock-presets.ts';
import { useInvoiceStore } from '../src/store/useInvoiceStore.ts';
import { applyBackup, buildBackup, parseBackup } from '../src/lib/backup.ts';
import { createLocalSink } from '../src/lib/importers.ts';
import * as R from '../src/lib/recurring.ts';
import * as docs from '../src/lib/documents.ts';
import { makeDraft } from '../src/store/invoice-defaults.ts';

const line = [{ qty: 2, rate: 500, name: 'Research' }];

function setLock(date: string | undefined) {
  localDb.settings.save({ ...localDb.settings.get(), lock_until: date });
}

beforeEach(() => {
  resetStorage();
  clearOverrides();
  installSettings();
});

test('isDateLocked: on or before the lock day is frozen; the next day is open', () => {
  assert.equal(isDateLocked('2026-03-31', '2026-03-31'), true);
  assert.equal(isDateLocked('2026-03-30', '2026-03-31'), true);
  assert.equal(isDateLocked('2026-04-01', '2026-03-31'), false);
  assert.equal(isDateLocked('2026-03-31T23:30:00', '2026-03-31'), true, 'a stamped time keeps its written day');
  assert.equal(isDateLocked('2020-01-01', ''), false, 'no lock -> open');
  assert.equal(isDateLocked('', '2026-03-31'), false);
  assert.equal(normalizeLockDate('2026-02-30'), '', 'impossible dates are rejected');
  assert.equal(normalizeLockDate(' 2026-03-31 '), '2026-03-31');
});

test('lock_until is an additive settings field and survives a round trip', () => {
  setLock('2025-03-31');
  assert.equal(getLockUntil(), '2025-03-31');
  assert.equal(localDb.settings.get().lock_until, '2025-03-31');
  setLock('2025-04-30'); // raising is always allowed
  assert.equal(getLockUntil(), '2025-04-30');
  assert.deepEqual(lockPresets('garbage'), []);
});

test('lockPresets: end of last month / quarter / financial year', () => {
  const p = (d: string) => Object.fromEntries(lockPresets(d).map((x) => [x.id, x.date]));
  assert.deepEqual(p('2026-10-07'), { month: '2026-09-30', quarter: '2026-09-30', fy: '2026-03-31' });
  assert.deepEqual(p('2026-11-15'), { month: '2026-10-31', quarter: '2026-09-30', fy: '2026-03-31' });
  assert.deepEqual(p('2026-01-05'), { month: '2025-12-31', quarter: '2025-12-31', fy: '2025-03-31' });
  assert.deepEqual(p('2026-03-01'), { month: '2026-02-28', quarter: '2025-12-31', fy: '2025-03-31' });
  assert.deepEqual(p('2024-03-10'), { month: '2024-02-29', quarter: '2023-12-31', fy: '2023-03-31' }, 'leap year');
  assert.deepEqual(p('2026-04-02'), { month: '2026-03-31', quarter: '2026-03-31', fy: '2026-03-31' });
});

test('a document dated in the locked period cannot be edited, cancelled, reinstated, deleted or paid', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  const paid = localDb.payments.record({ invoiceId: inv.id, amount: 100, method: 'Cash' });
  setLock('2025-06-30');
  const frozen = reload(inv.id);
  assert.equal(isLocked(frozen), true);

  const refuses = (fn: () => unknown, re: RegExp) =>
    assert.throws(fn, (e) => e instanceof PeriodLockedError && re.test(e.message) && /30 Jun 2025/.test(e.message));

  refuses(() => localDb.invoices.save({ ...frozen, notes: 'sneaky' }), /edited/);
  refuses(() => localDb.invoices.setStatus(inv.id, 'Cancelled'), /cancelled/);
  refuses(() => localDb.invoices.save({ ...frozen, status: 'Cancelled' }), /cancelled/);
  refuses(() => localDb.invoices.remove(inv.id), /deleted/);
  refuses(() => localDb.payments.record({ invoiceId: inv.id, amount: 50, method: 'UPI' }), /paid/);
  refuses(() => localDb.payments.remove(paid.id), /payments cannot be removed/);

  const after = reload(inv.id);
  assert.equal(after.notes, frozen.notes);
  assert.equal(after.status, 'Partially Paid');
  assert.equal(localDb.payments.totalFor(inv.id), 100, 'the payment is still there');
});

test('nothing can be created in, or moved into, the locked period; the day after is open', () => {
  const open = createViaStore({ date: '2025-07-05', lines: line });
  setLock('2025-06-30');
  assert.throws(() => createViaStore({ date: '2025-06-30', lines: line }), /locked up to 30 Jun 2025/);
  assert.throws(() => localDb.invoices.save({ ...open, id: 'brand-new', invoice_number: '', issue_date: '2025-06-15' }), PeriodLockedError);
  // moving an open document back into the closed period is also refused
  assert.throws(() => localDb.invoices.save({ ...open, issue_date: '2025-06-01' }), PeriodLockedError);
  const next = createViaStore({ date: '2025-07-01', lines: line });
  assert.ok(next.id);
  assert.equal(localDb.invoices.save({ ...open, notes: 'fine' }).notes, 'fine');
});

test('the store reports a lock instead of throwing, with a friendly message', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  setLock('2025-06-30');
  const st = () => useInvoiceStore.getState();
  assert.ok(st().loadInvoice(inv.id));
  st().setNotes('edit after lock');
  const res = st().saveInvoice();
  assert.equal(res.ok, false);
  assert.equal(res.locked, true);
  assert.match(res.errors[0], /Books are locked up to 30 Jun 2025/);
  assert.match(res.errors[0], /Unlock it with your PIN/);

  // a brand-new document dated inside the lock is refused with its own message
  st().newDraft('INVOICE');
  st().setSender(localDb.settings.activeProfile()!);
  st().setClient({ name: 'X Co' });
  st().setDates('2025-06-20', '2025-06-20');
  st().updateItem(st().items[0].id, 'name', 'Work');
  st().updateItem(st().items[0].id, 'rate', 100);
  const r2 = st().saveInvoice();
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join(' '), /inside the locked period/);
});

test('lowering or removing the lock needs a verified PIN; raising it does not', async () => {
  setLock('2025-06-30');
  assert.throws(() => setLock('2025-05-31'), (e) => e instanceof PeriodLockedError && e.action === 'settings');
  assert.throws(() => setLock(undefined), PeriodLockedError);
  assert.equal(getLockUntil(), '2025-06-30');

  assert.equal(await grantOverride('0000', { scope: SETTINGS_OVERRIDE, verify: async () => false }), false, 'wrong PIN grants nothing');
  assert.throws(() => setLock(undefined), PeriodLockedError);

  assert.equal(await grantOverride('4827', { scope: SETTINGS_OVERRIDE, verify: async (p) => p === '4827' }), true);
  setLock(undefined);
  assert.equal(getLockUntil(), '');
  assert.equal(hasOverride(SETTINGS_OVERRIDE), false, 'the override is spent once used');
});

test('a PIN override reopens exactly one document, for a limited time, and is audited', async () => {
  const a = createViaStore({ date: '2025-06-10', lines: line });
  const b = createViaStore({ date: '2025-06-11', lines: line });
  setLock('2025-06-30');
  const t0 = 1_000_000;
  assert.equal(
    await grantOverride('4827', { scope: a.id, docNumber: a.invoice_number, now: t0, verify: async () => true }),
    true,
  );
  assert.equal(hasOverride(a.id, t0 + 1000), true);
  assert.equal(hasOverride(a.id, t0 + OVERRIDE_TTL_MS + 1), false, 'expires');

  // `hasOverride` default clock is real time; re-grant against the real clock for the lib calls
  await grantOverride('4827', { scope: a.id, docNumber: a.invoice_number, verify: async () => true });
  assert.equal(localDb.invoices.save({ ...reload(a.id), notes: 'corrected under override' }).notes, 'corrected under override');
  assert.throws(() => localDb.invoices.save({ ...reload(b.id), notes: 'other doc' }), PeriodLockedError);
  localDb.payments.record({ invoiceId: a.id, amount: 10, method: 'Cash' });

  const log = audit.forInvoice(a.id).map((r) => `${r.action}:${r.summary}`);
  assert.ok(log.some((l) => l.startsWith('override:') && /Period lock overridden with PIN/.test(l)));
  assert.ok(log.some((l) => l.startsWith('update:') && l.includes('(period-lock override)')), 'the edit itself is tagged');
  assert.ok(log.some((l) => l.startsWith('payment_add:') && l.includes('(period-lock override)')));
});

test('setting, moving and removing the lock are audited as lock / unlock', async () => {
  setLock('2025-03-31');
  setLock('2025-06-30');
  await grantOverride('1', { scope: SETTINGS_OVERRIDE, verify: async () => true });
  setLock('2025-04-30');
  await grantOverride('1', { scope: SETTINGS_OVERRIDE, verify: async () => true });
  setLock(undefined);
  const acts = audit.all().filter((r) => r.entity_id === 'lock_until').reverse().map((r) => r.action);
  assert.deepEqual(acts, ['lock', 'lock', 'override', 'unlock', 'override', 'unlock']);
  const last = audit.all()[0];
  assert.match(last.summary, /Period lock removed \(was 2025-04-30\)/);
});

test('recurring: an occurrence inside the lock is skipped and counted, later ones still run', () => {
  const draft = makeDraft({ settings: localDb.settings.get(), sender: null });
  draft.client = { ...draft.client, name: 'Acme Traders', email: 'a@acme.test' };
  draft.items = [{ id: 'i1', name: 'Plan {month}', type: 'Service', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }];
  draft.gst_mode = 'NONE';
  draft.round_off_enabled = false;
  const s = R.createSchedule({
    name: 'Retainer',
    template: R.templateFromInvoice(draft),
    frequency: 'monthly',
    due_in_days: 10,
    mode: 'issue',
    start_date: '2025-04-10',
  });
  R.recurringDb.save({ ...s, next_run: '2025-04-10' });
  setLock('2025-05-31');
  const report = R.runDueSchedules('2025-07-20');
  assert.deepEqual(report.generated.map((g) => g.issue_date), ['2025-06-10', '2025-07-10']);
  assert.equal(report.errors.length, 2);
  assert.match(report.errors[0], /skipped 2025-04-10 — Books are locked/);
  const saved = R.recurringDb.getById(s.id)!;
  assert.equal(saved.skipped_count, 2);
  assert.equal(saved.next_run, '2025-08-10');
  assert.equal(R.runDueSchedules('2025-07-20').errors.length, 0, 'nothing is retried forever');
});

test('import: rows dated inside the lock are not written and the import is logged', () => {
  const inv = createViaStore({ date: '2025-07-05', lines: line });
  setLock('2025-06-30');
  const mk = (id: string, number: string, date: string) => ({ ...inv, id, invoice_number: number, issue_date: date });
  const written = createLocalSink().invoices([
    mk('imp1', 'IMP/FY25-26/0001', '2025-06-01'),
    mk('imp2', 'IMP/FY25-26/0002', '2025-07-02'),
    mk('imp3', ' imp/fy25-26/0002 ', '2025-07-03'),
  ]);
  assert.deepEqual(written, ['imp2'], 'locked row skipped; spaced duplicate of imp2 skipped');
  const row = audit.all()[0];
  assert.equal(row.action, 'import');
  assert.match(row.summary, /Imported 1 document; 1 skipped \(dated inside the locked period/);
});

test('restore replaces everything even over a locked period, and says so in the log', () => {
  createViaStore({ date: '2025-06-10', lines: line });
  setLock('2025-06-30');
  const file = JSON.stringify(buildBackup());
  const { data } = parseBackup(file);
  applyBackup(data);
  assert.equal(audit.all()[0].action, 'restore');
  assert.ok(Object.keys(dumpStorage()).some((k) => k.endsWith('audit_log')));
});

test('cancelling goes through the same lock (documents module needs no changes)', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: line });
  setLock('2025-06-30');
  assert.throws(() => docs.cancelDocument(reload(inv.id), 'oops'), PeriodLockedError);
  // a document dated after the lock is untouched by it
  const quote = createViaStore({ date: '2025-07-02', lines: line, docType: 'QUOTATION' });
  assert.ok(quote.id);
});

test('converting a quotation that sits inside the lock still creates the new document', () => {
  const old = createViaStore({ date: '2025-06-05', lines: line, docType: 'QUOTATION', asDraft: true });
  setLock('2025-06-30');
  const converted = docs.convertDocument(reload(old.id), 'INVOICE');
  assert.equal(converted.doc_type, 'INVOICE');
  assert.equal(reload(old.id).status, 'Draft', 'the locked source keeps its status');
});

test('partitionByLock splits rows', () => {
  setLock('2025-06-30');
  const { open, locked } = partitionByLock([{ issue_date: '2025-06-30' }, { issue_date: '2025-07-01' }, { issue_date: '' }]);
  assert.equal(locked.length, 1);
  assert.equal(open.length, 2);
});
