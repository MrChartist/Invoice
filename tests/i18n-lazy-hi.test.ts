/**
 * R16-A1: area Hindi as a lazy chunk. The build (scripts/vite-hi-split.mjs) passes `defineArea` a loader instead of the
 * Hindi object; these tests drive that runtime path directly: English until the Hindi arrives, `setLanguage('hi')`
 * awaits every registered loader, an area evaluated while Hindi is on loads at once and notifies `useT()` subscribers,
 * `.hi` falls back to English (never undefined), and an offline switch without the pack rejects and stays English.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { defineArea } from '../src/i18n/area.ts';
import { LANG_PACK_OFFLINE, getLanguage, resetI18nForTests, setCatalogueForTests, setLanguage, subscribe } from '../src/i18n/index.ts';

type Mod = { default: Record<string, string> };
/** A loader the test releases by hand, counting calls. */
function deferredLoader(table: Record<string, string>) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const state = { calls: 0, release };
  const load = async (): Promise<Mod> => {
    state.calls++;
    await gate;
    return { default: table };
  };
  return { state, load };
}
const asHi = <T>(load: () => Promise<Mod>) => load as unknown as T;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Hindi shell catalogue "loaded" (a stub), interface in English. */
async function englishWithHindiCatalogue() {
  resetI18nForTests();
  setCatalogueForTests('hi', {});
  await setLanguage('en', { persist: false });
}

async function withNavigator(nav: Record<string, unknown>, fn: () => Promise<void>) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { ...nav }, configurable: true, writable: true });
  try {
    await fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test('a lazy area shows English until setLanguage("hi") has loaded its Hindi', async () => {
  await englishWithHindiCatalogue();
  const { state, load } = deferredLoader({ title: 'शीर्षक', due: '{date} तक' });
  const a = defineArea({ title: 'Title', due: 'Due {date}' } as const, asHi<{ title: string; due: string }>(load));
  assert.equal(state.calls, 0, 'English device: the Hindi chunk is never requested');
  assert.equal(a('title'), 'Title');
  assert.deepEqual(a.hi, a.en, '.hi falls back to English before the load');
  const switching = setLanguage('hi', { persist: false });
  await tick();
  assert.equal(getLanguage(), 'en', 'the language does not change before the area Hindi arrives (no half-translated frame)');
  state.release();
  await switching;
  assert.equal(getLanguage(), 'hi');
  assert.equal(state.calls, 1);
  assert.equal(a('due', { date: '5 May' }), '5 May तक');
  assert.equal(a.hi.title, 'शीर्षक', '.hi is the loaded object');
  // Back to English and to Hindi again: the loaded table is reused.
  await setLanguage('en', { persist: false });
  assert.equal(a('title'), 'Title');
  await setLanguage('hi', { persist: false });
  assert.equal(state.calls, 1, 'loaded once');
  resetI18nForTests();
});

test('an area evaluated while Hindi is on loads at once and notifies subscribers on arrival', async () => {
  await englishWithHindiCatalogue();
  await setLanguage('hi', { persist: false });
  let notified = 0;
  const off = subscribe(() => notified++);
  const { state, load } = deferredLoader({ tab: 'फ़ंड' });
  const a = defineArea({ tab: 'Funds' } as const, asHi<{ tab: string }>(load));
  assert.equal(state.calls, 1, 'requested at evaluation');
  assert.equal(a('tab'), 'Funds', 'English for the first frame');
  state.release();
  await tick();
  await tick();
  assert.equal(a('tab'), 'फ़ंड');
  assert.ok(notified >= 1, 'useT() subscribers are told (version bump)');
  off();
  resetI18nForTests();
});

test('a failing Hindi chunk leaves the interface in English; the next switch retries', async () => {
  await englishWithHindiCatalogue();
  let calls = 0;
  let fail = true;
  const a = defineArea({ x: 'X' } as const, asHi<{ x: string }>(async () => {
    calls++;
    if (fail) throw new Error('chunk 404');
    return { default: { x: 'एक्स' } };
  }));
  await assert.rejects(setLanguage('hi', { persist: false }), /chunk 404/);
  assert.equal(getLanguage(), 'en');
  fail = false;
  await setLanguage('hi', { persist: false });
  assert.equal(calls, 2);
  assert.equal(a('x'), 'एक्स');
  resetI18nForTests();
});

test('offline switch without the language pack: LANG_PACK_OFFLINE, stays English', async () => {
  await englishWithHindiCatalogue();
  const posted: unknown[] = [];
  const worker = (complete: boolean) => ({
    controller: {
      postMessage(msg: unknown, ports: MessagePort[]) {
        posted.push(msg);
        ports[0].postMessage({ complete });
      },
    },
  });
  let loads = 0;
  defineArea({ y: 'Y' } as const, asHi<{ y: string }>(async () => {
    loads++;
    throw new Error('offline fetch failed');
  }));
  // The worker could not cache the pack and the device is offline: reject before loading anything.
  await withNavigator({ onLine: false, serviceWorker: worker(false) }, async () => {
    await assert.rejects(setLanguage('hi'), (e: Error) => e.message === LANG_PACK_OFFLINE);
  });
  assert.equal(getLanguage(), 'en');
  assert.equal(loads, 0, 'nothing fetched once the worker said the pack is missing');
  assert.deepEqual(posted, [{ type: 'lang', lang: 'hi' }], 'the page told the worker the language');
  // The worker says complete but a chunk still fails while offline: the same message.
  await withNavigator({ onLine: false, serviceWorker: worker(true) }, async () => {
    await assert.rejects(setLanguage('hi'), (e: Error) => e.message === LANG_PACK_OFFLINE);
  });
  assert.equal(getLanguage(), 'en');
  // Online, the worker's answer does not block: the real error surfaces (not the offline message).
  await withNavigator({ onLine: true, serviceWorker: worker(false) }, async () => {
    await assert.rejects(setLanguage('hi'), /offline fetch failed/);
  });
  assert.equal(getLanguage(), 'en');
  resetI18nForTests();
});

test('switching back to English never waits for the worker', async () => {
  resetI18nForTests();
  const posted: unknown[] = [];
  await withNavigator({ onLine: false, serviceWorker: { controller: { postMessage: (m: unknown) => posted.push(m) } } }, async () => {
    await setLanguage('en', { persist: false });
  });
  assert.equal(getLanguage(), 'en');
  assert.deepEqual(posted, [{ type: 'lang', lang: 'en' }]);
  resetI18nForTests();
});
