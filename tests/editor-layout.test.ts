import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  DEFAULT_EDITOR_LAYOUT, EDITOR_LAYOUT_KEY, PREVIEW_MIN_WIDTH, draftHasContent, draftHash, lowEndDevice, parseEditorLayout,
  readEditorLayout, sectionForBlock, writeEditorLayout,
} from '../src/lib/editor-layout.ts';

test('editor layout: defaults, tolerant parse', () => {
  assert.equal(PREVIEW_MIN_WIDTH, 1280);
  assert.deepEqual(parseEditorLayout(null), DEFAULT_EDITOR_LAYOUT);
  assert.deepEqual(parseEditorLayout('not json'), DEFAULT_EDITOR_LAYOUT);
  assert.deepEqual(parseEditorLayout('[1]'), DEFAULT_EDITOR_LAYOUT);
  assert.deepEqual(parseEditorLayout('{"preview":false}'), { preview: false });
  assert.deepEqual(parseEditorLayout('{"preview":"no"}'), { preview: false });
});

test('editor layout: round trip in localStorage, outside the data prefix', () => {
  resetStorage();
  assert.equal(EDITOR_LAYOUT_KEY.startsWith('mrchartist_inv_'), false, 'device-local, never backed up');
  assert.deepEqual(readEditorLayout(), { preview: false });
  writeEditorLayout({ preview: true });
  assert.equal(globalThis.localStorage.getItem(EDITOR_LAYOUT_KEY), '{"preview":true}');
  assert.deepEqual(readEditorLayout(), { preview: true });
});

test('editor layout: storage that throws never breaks the editor', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(readEditorLayout(bad), { preview: false });
  assert.deepEqual(writeEditorLayout({ preview: true }, bad), { preview: true });
});

test('thumbnails: low-end devices, draft hash and content check', () => {
  assert.equal(lowEndDevice(4, false), true);
  assert.equal(lowEndDevice(8, false), false);
  assert.equal(lowEndDevice(8, true), true);
  assert.equal(lowEndDevice(undefined, false), false);
  const a = { client: { name: 'A' }, items: [{ name: 'x', rate: 1 }] };
  assert.equal(draftHash(a), draftHash(JSON.parse(JSON.stringify(a))));
  assert.notEqual(draftHash(a), draftHash({ ...a, client: { name: 'B' } }));
  assert.equal(draftHasContent({ client: { name: ' ' }, items: [{ name: '', rate: 0 }] }), false);
  assert.equal(draftHasContent({ client: null, items: [{ name: '', rate: 5 }] }), true);
  assert.equal(sectionForBlock('items'), 'items');
  assert.equal(sectionForBlock('x'), null);
});
