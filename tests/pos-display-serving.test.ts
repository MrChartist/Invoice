/** PENDING 12 (SV-A): the services queue's "Now serving" token reaches the POS customer display. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DISPLAY_CHANNEL, readDisplayMessage } from '../src/lib/pos-display.ts';
import { SERVING_CHANNEL, isHello, readServing, servingMessage } from '../src/lib/pos-serving.ts';

test('PENDING 12: serving message round trip; anything but a token 1–99999 clears the line', () => {
  assert.equal(SERVING_CHANNEL, DISPLAY_CHANNEL, 'the display listens on one channel');
  assert.deepEqual(servingMessage(7), { v: 1, type: 'serving', token: 7 });
  assert.equal(readServing(JSON.parse(JSON.stringify(servingMessage(7)))), 7);
  assert.deepEqual(servingMessage(null), { v: 1, type: 'serving', token: null });
  assert.equal(readServing(servingMessage(undefined)), null, 'null clears the line');
  for (const bad of [0, -3, 2.5, 100000, '12', '<b>1</b>']) assert.equal(readServing({ v: 1, type: 'serving', token: bad }), null, String(bad));
  assert.equal(readServing({ v: 2, type: 'serving', token: 3 }), undefined);
  assert.equal(readServing({ v: 1, type: 'bill', lines: [] }), undefined, 'a bill is not a serving message');
  assert.equal(readDisplayMessage(servingMessage(4)), null, 'the counter (Pos.tsx) ignores serving messages');
  assert.deepEqual([isHello({ v: 1, type: 'hello' }), isHello({ v: 1, type: 'idle' }), isHello(null)], [true, false, false]);
});

test('PENDING 12: the display keeps the token over bills; the queue view sends it and answers hello', () => {
  const d = readFileSync(new URL('../src/components/pos-retail/CustomerDisplay.tsx', import.meta.url), 'utf8');
  assert.match(d, /if \(s !== undefined\) return setServing\(s\)/);
  assert.equal((d.match(/\{now\}/g) ?? []).length, 3, 'idle, thanks and bill screens');
  const q = readFileSync(new URL('../src/components/services-r10/FrontDesk.tsx', import.meta.url), 'utf8');
  assert.match(q, /openBroadcast\(SERVING_CHANNEL\)/);
  assert.match(q, /postMessage\(servingMessage\(servingToken\)\)/);
  assert.match(q, /if \(isHello\(e\.data\)\) send\(\)/);
  assert.doesNotMatch(q, /lib\/pos-display/, 'the desk does not import pos-display');
  const pd = readFileSync(new URL('../src/lib/pos-display.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(pd, /serving/, 'pos-display stays a small lazy leaf (≤ 3,000 bytes, vite.config leafGroup)');
  const area = readFileSync(new URL('../src/i18n/areas/retail.ts', import.meta.url), 'utf8');
  assert.equal((area.match(/displayServing:/g) ?? []).length, 2, 'English and Hindi');
});
