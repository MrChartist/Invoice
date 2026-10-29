/** PS-A5 professional paper: boxes from the snapshot, sub-lines, declarations, annexure, `ps` survives normalizeRecord, SWIFT / IBAN on export documents only, plain documents unchanged. */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psAnnexure, psBoxes } from '../src/lib/prof/ps-print.ts';
import { mergePs, psSnapshot } from '../src/lib/prof/ps-snapshot.ts';
import { psDeclaration, psLineText, trackingText } from '../src/components/templates/paper-helpers.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { exportPrintRows } from '../src/lib/trade/exporter.ts';

const ps = psSnapshot('fee', { matter: { id: 'm', code: 'RSK/014', name: 'Sec 138 NI Act', court: 'Saket' }, engagement: { id: 'e', number: 'ENG/FY26-27/0031', model: 'milestone' }, basis: 'Fixed fee: stage 2 of 3', udin: [], lines: { l1: { matter: 'RSK/014' }, l2: { covered: true }, l3: { udin: '26123456ABCDEF1234' } } });

test('snapshot drops empty parts; merge keeps both sides per line', () => {
  assert.equal('udin' in ps, false);
  assert.deepEqual(mergePs(ps, { lines: { l1: { stage: 'Stage 2' } } }).lines?.l1, { matter: 'RSK/014', stage: 'Stage 2' });
});

test('boxes, line sub-lines and declarations from the snapshot only', () => {
  assert.deepEqual(psBoxes(ps)[0].rows, [['Matter', 'RSK/014: Sec 138 NI Act'], ['Court / forum', 'Saket'], ['Engagement', 'ENG/FY26-27/0031 · Milestones'], ['Billing basis', 'Fixed fee: stage 2 of 3']]);
  assert.equal(psLineText({ id: 'l1' }, ps), 'Matter RSK/014');
  assert.equal(psLineText({ id: 'l2' }, ps), 'Covered by the agreed fee');
  assert.equal(psLineText({ id: 'l3' }, ps), 'UDIN 26123456ABCDEF1234');
  assert.equal(trackingText({ id: 'l1' } as never, undefined, undefined, ps), 'Matter RSK/014');
  assert.equal(psDeclaration({ ps: { legal: { regime: 'rcm' } }, items: [{ charge_head_id: 'rule33' }] } as never), 'GST on this supply is payable by the recipient under reverse charge: N 13/2017-CT(R) entry 2 (verify, PS1). Disbursements recovered at actual as pure agent (Rule 33): outside the taxable value (verify, PS3).');
  assert.deepEqual(psAnnexure({ ps, annexure: { kind: 'timesheet', rows: [{ date: '2026-06-01', who: 'Asha', description: '', minutes: 120, billed_minutes: 120, rate: 4000, amount: 8000 }, { date: '2026-06-02', who: 'Asha', description: '', minutes: 60, billed_minutes: 60, rate: 4000, amount: 4000 }] } })[0].rows, [['Asha', 3, 4000, 12000]]);
});

test('documents without `ps` print exactly as before', () => {
  assert.equal(psLineText({ id: 'l1' }, undefined), '');
  assert.equal(psDeclaration({ items: [{ charge_head_id: 'rule33' }] } as never), '', 'no snapshot, no new sentence');
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never), 'Batch B1');
  assert.deepEqual(psAnnexure({ ps: undefined, annexure: { kind: 'timesheet', rows: [{ date: 'd', who: 'A', description: '', minutes: 1, billed_minutes: 1, rate: 1, amount: 1 }] } }), []);
});

test('`ps` survives normalizeRecord; SWIFT / IBAN only on export documents', () => {
  const rec = normalizeRecord({ id: 'x', items: [], ps } as never);
  assert.deepEqual(rec.ps, ps);
  const sender = { swift: 'HDFCINBB', iban: 'IN00HDFC0001' };
  assert.deepEqual(exportPrintRows({ supply_type: 'EXPORT_LUT' } as never, sender as never).filter((r) => r.key === 'swift' || r.key === 'iban').map((r) => r.value), ['HDFCINBB', 'IN00HDFC0001']);
  assert.deepEqual(exportPrintRows({ place_of_supply: '27' } as never, sender as never), []);
});
