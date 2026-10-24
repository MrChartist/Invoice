import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWizardState, wizardReducer, PAGE, type WizardAction, type WizardState } from '../src/components/import/wizard-state.ts';

const empty = { clients: [], items: [], invoices: [] };
const table = { headers: ['Name', 'GSTIN', 'City'], rows: [['Acme', '27AAPFU0939F1ZV', 'Mumbai'], ['Beta', '', 'Pune']] };
const run = (actions: WizardAction[], s: WizardState = initialWizardState(undefined, empty)) => actions.reduce(wizardReducer, s);

test('starts on step 1 with the requested kind', () => {
  assert.equal(initialWizardState(undefined, empty).kind, 'clients');
  const s = initialWizardState('items', empty);
  assert.equal(s.kind, 'items');
  assert.equal(s.step, 0);
  assert.equal(s.visible, PAGE);
  assert.equal(s.strictGstin, true);
});

test('loading a table guesses the mapping and clears earlier review state', () => {
  const s = run([
    { type: 'loadFailed', message: 'boom' },
    { type: 'toggleEdit', index: 3 },
    { type: 'loaded', fileName: 'c.csv', table, delimiter: ';' },
  ]);
  assert.equal(s.loadError, '');
  assert.equal(s.fileName, 'c.csv');
  assert.equal(s.delimiterLabel, 'semicolon');
  assert.equal(s.mapping.name, 0);
  assert.equal(s.mapping.gstin, 1);
  assert.equal(s.editing, null);
  assert.equal(s.skipped.size, 0);
});

test('a failed load keeps the previous table unless asked to clear it', () => {
  const loaded = run([{ type: 'loaded', fileName: 'c.csv', table, delimiter: ',' }]);
  assert.equal(wizardReducer(loaded, { type: 'loadFailed', message: 'too big' }).table, table);
  const cleared = wizardReducer(loaded, { type: 'loadFailed', message: 'empty', clearTable: true });
  assert.equal(cleared.table, null);
  assert.equal(cleared.loadError, 'empty');
});

test('one column maps to one field; unmapping zeroes the confidence', () => {
  let s = run([{ type: 'loaded', fileName: 'c.csv', table, delimiter: ',' }]);
  s = wizardReducer(s, { type: 'setColumn', key: 'city', col: 0 });
  assert.equal(s.mapping.city, 0);
  assert.equal(s.mapping.name, undefined, 'column 0 moved from name to city');
  assert.equal(s.confidence.city, 1);
  s = wizardReducer(s, { type: 'setColumn', key: 'city', col: undefined });
  assert.equal('city' in s.mapping, false);
  assert.equal(s.confidence.city, 0);
});

test('changing kind re-guesses only when a table is loaded', () => {
  assert.deepEqual(run([{ type: 'setKind', kind: 'items' }]).mapping, {});
  const s = run([
    { type: 'loaded', fileName: 'c.csv', table, delimiter: ',' },
    { type: 'toggleSkip', sourceIndexes: [1] },
    { type: 'setKind', kind: 'items' },
  ]);
  assert.equal(s.kind, 'items');
  assert.equal(s.skipped.size, 0);
});

test('skip toggles, cell edits, filter resets paging, show more', () => {
  let s = run([{ type: 'loaded', fileName: 'c.csv', table, delimiter: ',' }]);
  s = run([{ type: 'toggleSkip', sourceIndexes: [0, 1] }, { type: 'toggleSkip', sourceIndexes: [1] }], s);
  assert.deepEqual([...s.skipped], [0]);
  s = wizardReducer(s, { type: 'editCell', rowIndex: 1, col: 2, value: 'Nashik' });
  assert.equal(s.table!.rows[1][2], 'Nashik');
  assert.equal(table.rows[1][2], 'Pune', 'original table untouched');
  s = run([{ type: 'showMore' }], s);
  assert.equal(s.visible, PAGE * 5);
  s = run([{ type: 'setFilter', filter: 'errors' }], s);
  assert.equal(s.visible, PAGE);
  assert.equal(s.filter, 'errors');
  s = run([{ type: 'toggleEdit', index: 1 }], s);
  assert.equal(s.editing, 1);
  s = run([{ type: 'toggleEdit', index: 1 }], s);
  assert.equal(s.editing, null);
});

test('steps stop at the last one; next can refresh existing records', () => {
  const fresh = { clients: [{ id: 'c1', name: 'Acme' }], items: [], invoices: [] } as never;
  let s = run([{ type: 'next', existing: fresh }]);
  assert.equal(s.step, 1);
  assert.equal(s.existing, fresh);
  s = run([{ type: 'next' }, { type: 'next' }, { type: 'next' }], s);
  assert.equal(s.step, 3);
  assert.equal(s.existing, fresh);
  assert.equal(wizardReducer(s, { type: 'back' }).step, 2);
});

test('run lifecycle', () => {
  const report = { created: 2, updated: 0, skipped: 0, errors: [] };
  let s = run([{ type: 'runFailed', message: 'old' }, { type: 'runStarted' }, { type: 'runProgress', done: 1 }]);
  assert.equal(s.running, true);
  assert.equal(s.saveError, '');
  assert.equal(s.progress, 1);
  s = run([{ type: 'runSucceeded', report, existing: empty }, { type: 'runEnded' }], s);
  assert.equal(s.report, report);
  assert.equal(s.running, false);
});
