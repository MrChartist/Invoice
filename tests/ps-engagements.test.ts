/** PS-A2 engagements: model validation, milestones ≤ 100 %, ENG numbering, success-fee prompt, letter → acceptance → active, renewal, delete. */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings, clientMH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setActorProvider } from '../src/lib/access.ts';
import { acceptedFromQuote, deleteEngagement, engagementOf, loadEngagements, milestoneAmount, renewalsDue, saveEngagement, successPrompt, syncAcceptances, validateEngagement, type EngagementInput } from '../src/lib/prof/ps-engagements.ts';
import { letterLines, makeLetter } from '../src/lib/prof/ps-letters.ts';
import { saveCheck } from '../src/lib/prof/ps-conflicts.ts';
import { setQuoteAcceptance } from '../src/lib/quote-acceptance.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  localDb.clients.upsert(clientMH);
});
afterEach(() => setActorProvider(null));

const base = (over: Partial<EngagementInput> = {}): EngagementInput => ({ client_id: clientMH.id!, matter_ids: ['m1'], title: 'Defence', model: 'hourly', currency: 'INR', disb_policy: 'agent', start: '2026-05-01', status: 'draft', ...over });

test('model validation and milestone shares', () => {
  assert.match(validateEngagement(base({ model: 'fixed' })), /fixed fee/);
  assert.match(validateEngagement(base({ model: 'capped' })), /cap/);
  assert.match(validateEngagement(base({ model: 'blended' })), /blended/);
  assert.match(validateEngagement(base({ model: 'success', success: { basis: 'recovery', event: 'Decree', pct: 0 } })), /success event/);
  assert.match(validateEngagement(base({ model: 'milestone', fee: 60000, milestones: [{ id: 'a', label: 'Filing', pct: 60 }, { id: 'b', label: 'Trial', pct: 50 }] })), /more than 100/);
  assert.equal(validateEngagement(base({ model: 'milestone', fee: 60000, milestones: [{ id: 'a', label: 'Filing', pct: 40 }, { id: 'b', label: 'Trial', amount: 10000 }] })), '');
  assert.equal(milestoneAmount({ fee: 60000 }, { pct: 40 }), 24000);
});

test('ENG/FY numbering, matters, renewal, engagementOf; conflict warns, never blocks', () => {
  saveCheck({ date: '2026-04-01', terms: [clientMH.name], hits: [], result: 'conflict' });
  const { row, warnings } = saveEngagement(base({ model: 'capped', cap: 40000, renew_on: '2026-05-20' }));
  assert.match(row.number, /^ENG\/FY26-27\/0001$/);
  assert.equal(warnings.length, 1);
  assert.equal(saveEngagement(base({ title: 'Second' })).row.number, 'ENG/FY26-27/0002');
  assert.equal(engagementOf('m1', loadEngagements())?.id, row.id);
  assert.deepEqual(renewalsDue(loadEngagements(), '2026-05-01').map((e) => e.id), [row.id]);
});

test('success fee: a legal / CA profile warns and needs the owner\'s reason; others see no prompt', () => {
  const s = base({ model: 'success', success: { basis: 'amount recovered', event: 'Decree', pct: 10, base_amount: 500000 } });
  assert.equal(successPrompt('consulting', s), '');
  assert.match(successPrompt('legal', s), /Rule 20/);
  assert.match(successPrompt('ca', s), /clause \(10\)/);
  assert.throws(() => saveEngagement(s, { kind: 'legal' }), /owner's reason/);
  setActorProvider(() => ({ id: 'u2', name: 'Clerk', role: 'clerk' }));
  assert.throws(() => saveEngagement({ ...s, ethics_reason: 'Non-litigation advisory' }, { kind: 'legal' }));
  setActorProvider(null);
  assert.equal(saveEngagement({ ...s, ethics_reason: 'Non-litigation advisory' }, { kind: 'legal' }).row.model, 'success');
});

test('letter: a quotation with sections and fee lines; acceptance makes the engagement active', () => {
  installSettings({ prof_kind: 'ca' } as never);
  localDb.clients.upsert(clientMH);
  const { row } = saveEngagement(base({ model: 'milestone', fee: 60000, milestones: [{ id: 'a', label: 'Filing', pct: 50 }, { id: 'b', label: 'Trial', pct: 50 }] }));
  assert.deepEqual(letterLines(row, '998211', 18).map((l) => l.amount), [30000, 30000]);
  const q = makeLetter(row.id);
  assert.equal(q.doc_type, 'QUOTATION');
  assert.ok(q.proposal_sections!.some((s) => s.title === 'UDIN'), 'CA starter sections');
  assert.equal(q.ps?.engagement?.number, row.number);
  assert.equal(loadEngagements()[0].status, 'sent');
  assert.equal(acceptedFromQuote(loadEngagements()[0], {}), null);
  setQuoteAcceptance(q.id, { signer: 'Client', signed_at: '2026-05-03T10:00:00.000Z', method: 'remote', amount: q.total });
  assert.equal(syncAcceptances(localDb.invoices.getAll()), 1);
  assert.deepEqual([loadEngagements()[0].status, loadEngagements()[0].accepted_at], ['active', '2026-05-03T10:00:00.000Z']);
});

test('delete: refused once billed; else goes (number stays used)', () => {
  const { row } = saveEngagement(base());
  assert.throws(() => deleteEngagement(row.id, [{ id: 'i1', status: 'Sent', ps: { engagement: { id: row.id, number: row.number, model: 'hourly' } } } as never]), /close it instead/);
  deleteEngagement(row.id, []);
  assert.equal(loadEngagements().length, 0);
  assert.equal(saveEngagement(base()).row.number, 'ENG/FY26-27/0002', 'never reused');
});
