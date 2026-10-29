/**
 * R20-A1: the first-paint claim stub — its claimed list is generated from the registry (never hand-edited), and
 * keys match the physical key with Alt down (Mac Option / AltGr, bug 1).
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY_CLAIMS } from '../src/lib/keys/stub.ts';
import { claimList, comboOf } from '../src/lib/keys/registry.ts';
import { matchesEvent, parseCombo } from '../src/hooks/useHotkeys.ts';

const ev = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent;

test('KEY_CLAIMS equals the registry (run claimList() and paste it when BUILT or a global row changes)', () => {
  assert.equal(KEY_CLAIMS, claimList(), `stub.ts KEY_CLAIMS must be:\n'${claimList()}'`);
  const tok = KEY_CLAIMS.split(' ');
  assert.ok(tok.includes('f5') && tok.includes('alt+f6^') && tok.includes('mod+f1~'));
  assert.ok(!tok.some((t) => /^mod\+(t|w|n|f4)$/.test(t)), 'no never-claimed key');
});

test('bug 1: Alt + letter / digit match e.code (Mac Option+G types "©")', () => {
  assert.ok(matchesEvent(parseCombo('alt+g'), ev({ key: '©', code: 'KeyG', altKey: true })));
  assert.ok(matchesEvent(parseCombo('alt+2'), ev({ key: '™', code: 'Digit2', altKey: true })));
  assert.ok(matchesEvent(parseCombo('alt+p'), ev({ key: 'p', altKey: true })), 'synthetic events without a code still match');
  assert.ok(!matchesEvent(parseCombo('alt+g'), ev({ key: 'g', code: 'KeyH', altKey: true })), 'the physical key wins');
  assert.equal(comboOf(ev({ key: '©', code: 'KeyG', altKey: true })), 'alt+g');
  assert.equal(comboOf(ev({ key: 'F8', code: 'F8', ctrlKey: true })), 'mod+f8');
  assert.equal(comboOf(ev({ key: 'F4', ctrlKey: true, shiftKey: true })), 'mod+shift+f4');
  assert.equal(comboOf(ev({ key: '?', shiftKey: true })), '?', 'a symbol already holds Shift');
  assert.equal(comboOf(ev({ key: ' ' })), 'space');
});
