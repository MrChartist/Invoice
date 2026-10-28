/**
 * R2-A4 follow-ups & promises: kept / broken / partly kept, reminder hold until the promise date, firm stage
 * after a broken promise, follow-ups due in local days, notification fingerprints, party keys without ids.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, freezeDate, thawDate } from './helpers/shim.ts';
import { installSettings, createViaStore } from './helpers/world.ts';
import {
  brokenPromiseParties, followUpIssues, followUpsDue, isHeldByPromise, loadCollectionNotes, markActionDone, openPromises, partyKeyFor, partyTimeline,
  promiseCounts, promiseNotices, promiseProgress, receiptsByParty, saveFollowUp, type CollectionNote, type PartyReceipt,
} from '../src/lib/collections.ts';
import { pendingReminders } from '../src/lib/reminders.ts';
import { partyReminderQueue } from '../src/lib/khata.ts';
import { buildReceivables } from '../src/lib/receivables.ts';
import { reminderOptions } from '../src/lib/reminder-context.ts';
import { promiseProvider } from '../src/lib/notifications.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';

beforeEach(() => { resetStorage(); installSettings(); });
afterEach(() => { setActorProvider(null); thawDate(); });

const note = (over: Partial<CollectionNote>): CollectionNote => ({
  id: over.id ?? 'n1', party_key: 'c1', kind: 'call', outcome: 'spoke', date: '2026-10-01', created_at: '2026-10-01T05:00:00.000Z', ...over,
});
const r = (date: string, amount: number, party_key = 'c1'): PartyReceipt => ({ party_key, date, amount });

test('promise kept / broken / partly kept, counted only between the promise and its date', () => {
  const n = note({ promise: { amount: 40000, date: '2026-10-05' } });
  assert.equal(promiseProgress(n, [], '2026-10-03')?.state, 'open');
  assert.equal(promiseProgress(n, [r('2026-10-04', 40000)], '2026-10-06')?.state, 'kept');
  const broken = promiseProgress(n, [r('2026-09-30', 40000), r('2026-10-06', 40000)], '2026-10-06')!;
  assert.equal(broken.state, 'broken', 'money before the promise or after its date does not count');
  const partly = promiseProgress(n, [r('2026-10-02', 15000)], '2026-10-06')!;
  assert.deepEqual([partly.state, partly.received, partly.partly], ['broken', 15000, true]);
  assert.equal(promiseProgress(n, [r('2026-10-05', 40000, 'other')], '2026-10-06')?.state, 'broken', 'another party\'s money');
  assert.deepEqual(promiseCounts('c1', [n, note({ id: 'n2', promise: { amount: 10, date: '2026-10-02' } })], [r('2026-10-02', 10)], '2026-10-06'), { kept: 1, broken: 1 });
});

test('open promises hold the covered bills (or all, on account) until the promise date; broken → firm', () => {
  const notes = [
    note({ id: 'a', promise: { amount: 100, date: '2026-10-10', invoice_ids: ['i1'] } }),
    note({ id: 'b', party_key: 'c2', promise: { amount: 100, date: '2026-10-10' } }),
    note({ id: 'c', party_key: 'c3', promise: { amount: 100, date: '2026-10-02' } }),
  ];
  const holds = openPromises(notes, [], '2026-10-05');
  assert.equal(isHeldByPromise(holds, 'i1', 'c1'), true);
  assert.equal(isHeldByPromise(holds, 'i2', 'c1'), false, 'only the covered bill');
  assert.equal(isHeldByPromise(holds, 'anything', 'c2'), true, 'on account covers every bill');
  assert.equal(isHeldByPromise(holds, 'x', 'c3'), false, 'a promise whose date passed holds nothing');
  assert.deepEqual([...brokenPromiseParties(notes, [], '2026-10-05')], ['c3']);
  assert.equal(openPromises(notes, [], '2026-10-11').size, 0, 'after the date reminders resume');
});

test('pendingReminders skips held bills and suggests the firm stage after a broken promise (end to end)', () => {
  freezeDate('2026-10-20T10:00:00');
  const inv = createViaStore({ date: '2026-10-01', due: '2026-10-15', lines: [{ qty: 1, rate: 1000, tax: 0 }], gstMode: 'NONE', status: 'Sent' });
  const today = new Date(2026, 9, 20);
  assert.equal(pendingReminders(localDb.invoices.getAll(), today, [], reminderOptions(localDb.invoices.getAll(), today))[0].stage, 'overdue_polite');
  saveFollowUp({ party_key: inv.client.id!, party_name: inv.client.name, kind: 'call', outcome: 'will pay', promise: { amount: 1000, date: '2026-10-25' } });
  assert.equal(pendingReminders(localDb.invoices.getAll(), today, [], reminderOptions(localDb.invoices.getAll(), today)).length, 0, 'held until the promise date');
  const later = new Date(2026, 9, 27);
  const p = pendingReminders(localDb.invoices.getAll(), later, [], reminderOptions(localDb.invoices.getAll(), later));
  assert.equal(p.length, 1);
  assert.equal(p[0].stage, 'overdue_firm', '12 days late would be polite; the broken promise makes it firm');
});

test('follow-ups due: today / overdue in local days, a later note supersedes, promises due / broken / kept', () => {
  const notes = [
    note({ id: 'a', next_action: { date: '2026-10-05' } }),
    note({ id: 'b', party_key: 'c2', next_action: { date: '2026-10-03' } }),
    note({ id: 'c', party_key: 'c3', next_action: { date: '2026-10-03' } }),
    note({ id: 'd', party_key: 'c3', date: '2026-10-04', created_at: '2026-10-04T01:00:00.000Z', outcome: 'call back later' }),
    note({ id: 'e', party_key: 'c4', promise: { amount: 50, date: '2026-10-05' } }),
    note({ id: 'f', party_key: 'c5', promise: { amount: 50, date: '2026-10-02' } }),
    note({ id: 'g', party_key: 'c6', promise: { amount: 50, date: '2026-10-02' } }),
  ];
  const l = followUpsDue(notes, [r('2026-10-02', 50, 'c6')], '2026-10-05');
  assert.deepEqual(l.today.map((x) => x.note.id), ['a']);
  assert.deepEqual(l.overdue.map((x) => x.note.id), ['b'], 'c3\'s action was superseded by a later note');
  assert.deepEqual(l.promisesDue.map((x) => x.note.id), ['e']);
  assert.deepEqual(l.broken.map((x) => x.note.id), ['f']);
  assert.deepEqual(l.kept.map((x) => x.note.id), ['g']);
});

test('storage: validation, roles, mark done; party keys for clients without an id', () => {
  assert.ok(followUpIssues({ party_key: 'c', kind: 'call', outcome: '', date: '2026-10-05' }).length);
  assert.ok(followUpIssues({ party_key: 'c', kind: 'call', outcome: 'x', date: '2026-10-05', promise: { amount: 10, date: '2026-10-01' } }).some((e) => /before today/.test(e)));
  const saved = saveFollowUp({ party_key: 'name:walk in', kind: 'visit', outcome: 'met', next_action: { date: '2099-01-01' } });
  markActionDone(saved.id);
  assert.equal(loadCollectionNotes()[0].next_action?.done, true);
  setActorProvider(() => ({ id: 'v', name: 'V', role: 'viewer' }));
  assert.throws(() => saveFollowUp({ party_key: 'c', kind: 'call', outcome: 'x' }), /cannot/);
  setActorProvider(null);
  const idByName = new Map([['name:bharat traders', 'c-mh']]);
  assert.equal(partyKeyFor({ name: ' Bharat Traders ' }, idByName), 'c-mh', 'a typed name matches the master');
  assert.equal(partyKeyFor({ name: 'Walk In' }), 'name:walk in');
  const inv = createViaStore({ date: '2026-10-01', lines: [{ qty: 1, rate: 100, tax: 0 }], gstMode: 'NONE', status: 'Sent' });
  localDb.payments.record({ invoiceId: inv.id, amount: 60, method: 'UPI', date: '2026-10-02' });
  assert.deepEqual(receiptsByParty(localDb.invoices.getAll(), localDb.payments.getAll(), localDb.clients.getAll()), [{ party_key: inv.client.id, date: '2026-10-02', amount: 60 }]);
});

test('notifications: promises due today and broken, with stable fingerprints', () => {
  const notes = [note({ id: 'a', party_name: 'A', promise: { amount: 100, date: '2026-10-05' } }), note({ id: 'b', party_name: 'B', party_key: 'c2', promise: { amount: 100, date: '2026-10-03' } })];
  assert.deepEqual(promiseNotices(notes, [], '2026-10-05').due.map((n) => n.id), ['a']);
  const ctx = { now: new Date(2026, 9, 5, 9), invoices: [], clients: [], profile: null, lastBackup: null, storageUsedBytes: 0, storageQuotaBytes: 1, collectionNotes: notes, partyReceipts: [] };
  const one = promiseProvider(ctx);
  const two = promiseProvider({ ...ctx, now: new Date(2026, 9, 5, 18) });
  assert.equal(one.length, 2);
  assert.deepEqual(one.map((n) => n.id), two.map((n) => n.id), 'same condition, same id');
  assert.ok(one.some((n) => n.severity === 'critical' && /broken/.test(n.title)));
  const timeline = partyTimeline('c1', { notes, receipts: [r('2026-10-04', 100)], reminders: [{ invoice_id: '', party_key: 'c1', channel: 'whatsapp', tone: 'overdue_polite', sent_at: '2026-10-02T04:00:00.000Z' }] });
  assert.deepEqual(timeline.map((t) => t.kind), ['receipt', 'reminder', 'followup', 'promise'], 'newest first');
});

test('khata queue: open promises and manual / never parties are left out and counted', () => {
  const a = createViaStore({ date: '2026-09-01', due: '2026-09-10', lines: [{ qty: 1, rate: 100, tax: 0 }], gstMode: 'NONE', status: 'Sent' });
  const cid = a.client.id as string;
  const today = new Date(2026, 9, 5);
  const report = () => buildReceivables({ invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll(), clients: localDb.clients.getAll() }, { now: today });
  assert.equal(partyReminderQueue(report(), localDb.clients.getAll(), [], { today }).items.length, 1);
  const held = partyReminderQueue(report(), localDb.clients.getAll(), [], { today, heldParties: new Set([cid]) });
  assert.deepEqual([held.items.length, held.promised], [0, 1]);
  const master = localDb.clients.getById(cid);
  assert.ok(master);
  localDb.clients.upsert({ ...master, reminder_mode: 'never' });
  const muted = partyReminderQueue(report(), localDb.clients.getAll(), [], { today });
  assert.deepEqual([muted.items.length, muted.muted], [0, 1]);
  // A later save of an old snapshot never resets the master's reminder mode.
  const doc = localDb.invoices.getById(a.id);
  assert.ok(doc);
  localDb.invoices.save({ ...doc, notes: 'edited' });
  assert.equal(localDb.clients.getById(cid)?.reminder_mode, 'never');
});
