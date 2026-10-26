/**
 * R6-A2 screen-help registry coverage: every route in App.tsx, every GST tab, every PACK_TABS row and the tab ids of
 * the main pages resolve to their OWN topic (not only the route fallback). A new tab needs a help topic.
 * Also: CA ids exist in docs/CA_REVIEW.md, every topic has English and Hindi titles, and no statutory value is promised.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GST_TABS } from '../src/lib/gst-tabs.ts';
import { PACK_TABS } from '../src/lib/industry-packs.ts';
import { HELP_AREAS, areaOf, candidates, helpFor, hrefOfKey, keyOfHref, topicKey } from '../src/lib/help/registry.ts';
import type { HelpTopic } from '../src/lib/help/types.ts';
import { TOPICS as sales } from '../src/lib/help/topics-sales.ts';
import { TOPICS as purchase } from '../src/lib/help/topics-purchase.ts';
import { TOPICS as books } from '../src/lib/help/topics-books.ts';
import { TOPICS as statutory } from '../src/lib/help/topics-statutory.ts';
import { TOPICS as packs } from '../src/lib/help/topics-packs.ts';
import { TOPICS as settings } from '../src/lib/help/topics-settings.ts';

const root = join(import.meta.dirname, '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');
const FILES: Record<string, readonly HelpTopic[]> = { sales, purchase, books, statutory, packs, settings };
const ALL = Object.values(FILES).flat();
const BY_ID = new Map(ALL.map((x) => [x.id, x]));

/** Route paths of App.tsx (`*` excluded). */
const appRoutes = (): string[] => [...src('src/App.tsx').matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*');

/** Tab ids of a page: the block starting at `start` up to its closing `]` / `;`. */
function tabIds(file: string, start: RegExp): string[] {
  const text = src(file);
  const m = start.exec(text);
  assert.ok(m, `${file}: tab list ${start} not found`);
  const rest = text.slice(m.index);
  const end = rest.search(/\];|\] as const;|;\n/);
  const block = rest.slice(0, end > 0 ? end + 1 : 400);
  const ids = /id: '/.test(block) ? [...block.matchAll(/id: '([^']+)'/g)].map((x) => x[1]) : [...block.matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);
  assert.ok(ids.length > 1, `${file}: no tab ids read`);
  return ids;
}

const PAGE_TABS: [route: string, file: string, start: RegExp][] = [
  ['tds', 'src/pages/Tds.tsx', /const TABS: readonly/],
  ['payroll', 'src/pages/Payroll.tsx', /const TABS = \[/],
  ['books', 'src/pages/Books.tsx', /const TABS = \[/],
  ['manufacturing', 'src/pages/Manufacturing.tsx', /const TABS: Tab\[\] = \[/],
  ['expenses', 'src/pages/Expenses.tsx', /type Tab = /],
  ['receivables', 'src/pages/Receivables.tsx', /type Tab = /],
  ['reports', 'src/pages/Reports.tsx', /const TABS = \[/],
  ['settings', 'src/pages/Settings.tsx', /type Tab = /],
  ['inventory', 'src/pages/Inventory.tsx', /type Tab = /],
  ['distribution', 'src/pages/Distribution.tsx', /const TABS: Tab\[\] = \[/],
  ['recurring', 'src/pages/Recurring.tsx', /const REC_TABS:/],
  ['time', 'src/pages/Time.tsx', /const TABS: \{/],
  ['reconcile', 'src/pages/Reconcile.tsx', /const TABS = \[/],
];

test('topic ids are unique and each lives in the file its area loads', () => {
  assert.equal(BY_ID.size, ALL.length, 'duplicate topic ids');
  for (const [area, list] of Object.entries(FILES)) {
    for (const x of list) assert.equal(areaOf(x.id), area, `${x.id} is in topics-${area}.ts but the registry looks in ${areaOf(x.id)}`);
  }
  assert.deepEqual([...HELP_AREAS].sort(), Object.keys(FILES).sort());
});

test('every App.tsx route has its own topic', () => {
  const routes = appRoutes();
  assert.ok(routes.length >= 25, `read ${routes.length} routes`);
  for (const r of routes) {
    const id = topicKey(r.replace(/\/:.*$|\/\*$/, ''));
    assert.ok(BY_ID.has(id), `route ${r} → ${id} has no topic`);
  }
});

test('every GST tab, every PACK_TABS row and every main-page tab has its own topic', () => {
  for (const t of GST_TABS) assert.ok(BY_ID.has(`gst-reports:${t.id}`), `GST tab ${t.id} has no topic`);
  for (const p of PACK_TABS) assert.ok(BY_ID.has(keyOfHref(p.path)), `pack tab ${p.path} has no topic`);
  for (const [route, file, start] of PAGE_TABS) {
    for (const id of tabIds(file, start)) assert.ok(BY_ID.has(`${route}:${id}`), `${route}?tab=${id} (${file}) has no topic`);
  }
});

test('keys, fallbacks and hrefs', async () => {
  assert.equal(topicKey('/'), 'dashboard');
  assert.equal(topicKey('/invoice/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f'), 'invoice');
  assert.equal(topicKey('/gst-reports', '?tab=cdnur'), 'gst-reports:cdnur');
  assert.equal(topicKey('/receivables', '?tab=marketplace&view=tcs'), 'receivables:marketplace:tcs');
  assert.equal(topicKey('/books', '?view=x'), 'books', 'a view without a tab is ignored');
  assert.deepEqual(candidates('/distribution', '?tab=transport&view=trips'), ['distribution:transport:trips', 'distribution:transport', 'distribution']);
  assert.equal(hrefOfKey('receivables:marketplace:tcs'), '/receivables?tab=marketplace&view=tcs');
  assert.equal(hrefOfKey('dashboard'), '/');
  assert.equal(areaOf('gst-reports:common-credit'), 'packs');
  assert.equal(areaOf('gst-reports:b2cl'), 'statutory');
  assert.equal((await helpFor('/gst-reports', '?tab=cdnur'))?.title, 'CDNUR');
  assert.equal((await helpFor('/gst-reports', '?tab=nope'))?.id, 'gst-reports', 'unknown tab falls back to the route');
  assert.equal((await helpFor('/receivables', '?tab=marketplace&view=tcs'))?.id, 'receivables:marketplace:tcs');
  assert.equal((await helpFor('/gateway/vouchers'))?.id, 'gateway');
});

test('related links open real routes', () => {
  const paths = new Set(appRoutes().map((r) => r.replace(/\/:.*$|\/\*$/, '')));
  for (const x of ALL) {
    for (const r of x.related ?? []) assert.ok(paths.has(r.href.split('?')[0]), `${x.id}: related ${r.href} is not a route`);
  }
});

test('every topic has English and Hindi titles, what / when, ≤ 5 steps; statutory ones carry the CA box', () => {
  for (const x of ALL) {
    assert.ok(x.title.trim() && x.hiTitle.trim(), `${x.id}: titles`);
    assert.match(x.hiTitle, /[ऀ-ॿ]|^[A-Z0-9 ()/.-]+$/, `${x.id}: Hindi title is Devanagari (or a portal code)`);
    assert.ok(x.what.trim() && x.when.trim(), `${x.id}: what / when`);
    assert.ok((x.steps?.length ?? 0) <= 5, `${x.id}: at most 5 steps`);
  }
  for (const t of GST_TABS) {
    const x = BY_ID.get(`gst-reports:${t.id}`)!;
    if (!['hsnmaster'].includes(t.id)) assert.ok(x.statutory?.ca, `${x.id}: statutory topic without the CA box`);
  }
});

test('every caItems id exists in docs/CA_REVIEW.md', () => {
  const ids = new Set([...src('docs/CA_REVIEW.md').matchAll(/^\| ((?:G|T|P|AC|I|X)\d+)\b/gm)].map((m) => m[1]));
  assert.ok(ids.size >= 150, `read ${ids.size} CA ids`);
  for (const x of ALL) for (const id of x.statutory?.caItems ?? []) assert.ok(ids.has(id), `${x.id}: CA item ${id} not in CA_REVIEW.md`);
});

test('no topic promises a statutory value (₹ / % only "as the app applies it")', () => {
  for (const x of ALL) {
    const text = [x.what, x.when, ...(x.steps ?? []), x.statutory?.due ?? ''].join(' ');
    if (/₹\s?\d|\d\s?%/.test(text)) assert.match(text, /as the app applies/, `${x.id}: a value without "as the app applies it"`);
  }
});
