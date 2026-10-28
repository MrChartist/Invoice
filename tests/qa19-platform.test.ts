/**
 * QA round 19 (Round 16 platform pass): regression tests. U1–U3 also run for real in scripts/verify-offline.mjs
 * (production build, Chromium service worker); here public/sw.js runs in a `vm` sandbox over an in-memory Cache API.
 *
 * U1 a Hindi device upgrading from a pre-R16 worker (no `/__lang__` recorded) gets the language packs on install.
 * U2 activate prunes /assets/ files no current or replaced build lists; never the core, the device's pack or the
 *    replaced build's files; nothing while a shell has no manifest copy.
 * U3 a worker that takes over the page (first install's claim, an update) is told the stored language.
 * U4 hook initialisers that translate area strings depend on `lang` (else the first render's English freezes now
 *    that area Hindi arrives after the first render).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..');

/* ── a tiny Cache Storage ─────────────────────────────────────────── */
class MemCache {
  map = new Map<string, Response>();
  key = (r: string | Request | URL) => new URL(typeof r === 'string' ? r : r instanceof URL ? r.href : r.url, 'https://app.test').pathname;
  async match(r: string | Request) {
    const hit = this.map.get(this.key(r));
    return hit ? hit.clone() : undefined;
  }
  async put(r: string | Request, res: Response) {
    this.map.set(this.key(r), res.clone());
  }
  async delete(r: string | Request) {
    return this.map.delete(this.key(r));
  }
  async keys() {
    return [...this.map.keys()].map((p) => new Request('https://app.test' + p));
  }
}
class MemStorage {
  stores = new Map<string, MemCache>();
  async open(n: string) {
    if (!this.stores.has(n)) this.stores.set(n, new MemCache());
    return this.stores.get(n)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(n: string) {
    return this.stores.delete(n);
  }
  paths(n: string) {
    return [...(this.stores.get(n)?.map.keys() ?? [])];
  }
}

const MANIFEST = {
  version: 'new',
  files: ['/', '/offline.html', '/assets/index-NEW.js', '/assets/books-NEW.js'],
  langs: { hi: ['/assets/lang-hi-books-NEW.js', '/assets/lang-hi-core-NEW.js'], regional: ['/assets/lang-regional-NEW.js'] },
};

/** Loads public/sw.js (stamped `new`) into a sandbox; returns its event handlers and the caches. */
function loadWorker(storage: MemStorage, manifest = MANIFEST) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const fetched: string[] = [];
  const fetchStub = async (req: string | Request) => {
    const url = new URL(typeof req === 'string' ? req : req.url, 'https://app.test').pathname;
    fetched.push(url);
    if (url === '/precache-manifest.json') return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
    return new Response('/* ' + url + ' */', { headers: { 'content-type': url.endsWith('.js') ? 'text/javascript' : 'text/html' } });
  };
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    location: { origin: 'https://app.test' },
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  };
  const src = readFileSync(join(ROOT, 'public/sw.js'), 'utf8').replace('__BUILD_ID__', 'new');
  // Request resolves relative URLs against the worker's origin, as in a browser.
  const Req = class extends Request {
    constructor(input: string | Request, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, 'https://app.test').href : input, init);
    }
  };
  vm.runInNewContext(src, { self, caches: storage, fetch: fetchStub, Request: Req, Response, URL, setTimeout, clearTimeout, console });
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers[type]({ waitUntil: (p: Promise<unknown>) => (done = p), ...extra });
    await done;
  };
  return { fire, fetched };
}

/** A device that ran the build `old` (its shell, its assets) — with or without the R16 manifest copy / language. */
async function oldDevice({ manifest, lang }: { manifest: boolean; lang?: string }) {
  const s = new MemStorage();
  const shell = await s.open('mci-shell-old');
  await shell.put('/index.html', new Response('old'));
  if (manifest) {
    await shell.put('/__manifest__', new Response(JSON.stringify({ files: ['/', '/assets/index-OLD.js'], langs: { hi: ['/assets/lang-hi-books-OLD.js'], regional: ['/assets/lang-regional-OLD.js'] } })));
  }
  const assets = await s.open('mci-assets');
  for (const p of ['/assets/index-OLD.js', '/assets/lang-hi-books-OLD.js', '/assets/lang-regional-OLD.js', '/assets/ancient-chunk.js']) await assets.put(p, new Response(p));
  if (lang) await (await s.open('mci-lang')).put('/__lang__', new Response(lang));
  return s;
}

test('U1: install after a worker that never recorded a language caches every pack; a recorded language only its own', async () => {
  const pre = await oldDevice({ manifest: false });
  await loadWorker(pre).fire('install');
  for (const u of [...MANIFEST.langs.hi, ...MANIFEST.langs.regional]) assert.ok(pre.paths('mci-assets').includes(u), `pre-R16 upgrade caches ${u}`);

  const en = await oldDevice({ manifest: true, lang: 'en' });
  await loadWorker(en).fire('install');
  assert.ok(!en.paths('mci-assets').some((u) => /lang-.*NEW/.test(u)), 'an English device downloads no pack');

  const hi = await oldDevice({ manifest: true, lang: 'hi' });
  await loadWorker(hi).fire('install');
  assert.ok(MANIFEST.langs.hi.every((u) => hi.paths('mci-assets').includes(u)), 'a Hindi device gets the Hindi pack');
  assert.ok(!hi.paths('mci-assets').includes('/assets/lang-regional-NEW.js'), '… and not the regional one');

  const fresh = new MemStorage();
  await loadWorker(fresh).fire('install');
  assert.ok(!fresh.paths('mci-assets').some((u) => /lang-/.test(u)), 'a first install waits for the page to say its language');
});

test('U2: activate prunes stale assets, keeps core + replaced build + the device pack; nothing without a manifest copy', async () => {
  const hi = await oldDevice({ manifest: true, lang: 'hi' });
  const w = loadWorker(hi);
  await w.fire('install');
  await w.fire('activate');
  const kept = hi.paths('mci-assets');
  assert.deepEqual(hi.paths('mci-shell-old'), [], 'old shell removed');
  assert.ok(!(await hi.keys()).includes('mci-shell-old'));
  for (const u of ['/assets/index-NEW.js', '/assets/books-NEW.js', ...MANIFEST.langs.hi]) assert.ok(kept.includes(u), `keeps ${u}`);
  assert.ok(kept.includes('/assets/index-OLD.js') && kept.includes('/assets/lang-hi-books-OLD.js'), 'keeps the replaced build (and its Hindi) for an open tab');
  assert.ok(!kept.includes('/assets/ancient-chunk.js'), 'prunes what no build lists');
  assert.ok(!kept.includes('/assets/lang-regional-OLD.js'), 'prunes a pack the device does not use');

  const pre = await oldDevice({ manifest: false });
  const w2 = loadWorker(pre);
  await w2.fire('install');
  await w2.fire('activate');
  assert.ok(pre.paths('mci-assets').includes('/assets/ancient-chunk.js'), 'replaced shell without a manifest copy: nothing pruned');
  assert.ok(pre.paths('mci-assets').includes('/assets/index-OLD.js'));

  const unknown = await oldDevice({ manifest: true });
  const w3 = loadWorker(unknown);
  await w3.fire('install');
  await w3.fire('activate');
  assert.ok(unknown.paths('mci-assets').includes('/assets/lang-regional-OLD.js'), 'language unknown: every pack is kept');
});

test('U3: the page tells a worker that takes it over (controllerchange) the stored language', async () => {
  const posted: unknown[] = [];
  const sw = new EventTarget() as EventTarget & { controller: { postMessage: (m: unknown) => void } };
  sw.controller = { postMessage: (m) => posted.push(m) };
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, localStorage: g.localStorage, nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  g.window = { addEventListener: () => undefined };
  g.localStorage = { getItem: () => 'hi', setItem: () => undefined };
  Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw, onLine: true }, configurable: true, writable: true });
  try {
    const { initI18n, resetI18nForTests } = await import('../src/i18n/index.ts');
    await initI18n().catch(() => undefined);
    const before = posted.length;
    sw.dispatchEvent(new Event('controllerchange'));
    assert.equal(posted.length, before + 1, 'one message on controllerchange');
    assert.deepEqual(posted.at(-1), { type: 'lang', lang: 'hi' });
    resetI18nForTests();
  } finally {
    g.window = saved.window;
    g.localStorage = saved.localStorage;
    if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav);
  }
});

/* ── U4: frozen translations ──────────────────────────────────────── */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
function closeParen(s: string, i: number): number {
  let depth = 0;
  let q: string | null = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) {
      if (c === '\\') j++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return j;
  }
  return -1;
}

test('U4: useMemo / useState initialisers that translate area strings depend on lang', () => {
  const bad: string[] = [];
  for (const f of sourceFiles(join(ROOT, 'src'))) {
    const s = readFileSync(f, 'utf8');
    if (!/i18n\/areas\//.test(s)) continue;
    for (const m of s.matchAll(/\b(useMemo|useState)\s*(<[^>]*>)?\(/g)) {
      const start = m.index! + m[0].length - 1;
      const call = s.slice(start, closeParen(s, start) + 1);
      if (!/\b[a-z][a-zA-Z0-9]*T\(\s*['`]/.test(call)) continue;
      const line = s.slice(0, m.index).split('\n').length;
      const where = `${f.slice(ROOT.length + 1)}:${line}`;
      if (m[1] === 'useState') bad.push(`${where} useState(<translated>) freezes the first language; keep null and translate at render`);
      else {
        const deps = /,\s*(\[[^\]]*\])\s*,?\s*\)$/.exec(call)?.[1] ?? '';
        if (!/\blang\b/.test(deps)) bad.push(`${where} useMemo translates but its deps ${deps || '(none)'} lack lang`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
