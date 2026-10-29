/**
 * R20-D: Go To index (Tally names, Hindi, synonyms), the Company / Data / Import sheets (every row an existing route or
 * action, letters unique, labels in both languages), the setup-wizard answer and the D rows of the registry.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage, dumpStorage } from './helpers/shim.ts';
import { MENUS, applyTallyAnswer, gotoEntries, itemForLetter, menuItems, screenName, type MenuId } from '../src/lib/keys/nav-actions.ts';
import { gatewayGoto } from '../src/lib/keys/nav-goto.ts';
import { KEY_ROWS, claimList, isBuilt, rowById } from '../src/lib/keys/registry.ts';
import { KEY_CLAIMS, keysLayout, keysOn } from '../src/lib/keys/stub.ts';
import { keysT } from '../src/i18n/areas/keys-r20a.ts';
import { navT } from '../src/i18n/areas/keys-r20d.ts';
import { GOTO_SYNONYMS } from '../src/lib/palette/synonyms.ts';
import { searchAll } from '../src/lib/search.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const routes = new Set([...app.matchAll(/path="([^"]+)"/g)].map((m) => `/${m[1].replace(/^\//, '').split('/')[0]}`));

test('menu sheets: letters unique, rows exist, every item an existing route or action, labels in both languages', () => {
  for (const id of Object.keys(MENUS) as MenuId[]) {
    const letters = MENUS[id].map((m) => m.letter);
    assert.equal(new Set(letters).size, letters.length, id);
    for (const m of MENUS[id]) {
      assert.ok(m.to || m.act, `${id} ${m.letter}`);
      if (m.to) assert.ok(routes.has(m.to.split(/[?#]/)[0].replace(/^(\/[^/]*).*$/, '$1')), `${m.to} is a route`);
      if (m.row) assert.ok(rowById(m.row), m.row);
      if (m.k) assert.ok(keysT.en[m.k] && keysT.hi[m.k] !== keysT.en[m.k], m.k);
      if (m.n) assert.ok(navT.en[m.n] && navT.hi[m.n], m.n);
    }
  }
  assert.deepEqual(menuItems('data', () => false).map((m) => m.letter), ['C', 'E'], 'rights filter the rows');
  assert.equal(itemForLetter(MENUS.data, 'b')?.act, 'backup');
  assert.equal(itemForLetter(MENUS.data, 'Enter'), undefined);
});

test('D rows are built, and every global one is claimed by the stub', () => {
  const d = KEY_ROWS.filter((r) => r.pkg === 'D');
  assert.ok(d.length >= 20 && d.every(isBuilt));
  assert.equal(KEY_CLAIMS, claimList());
  for (const r of d.filter((x) => x.scope === 'global')) assert.match(KEY_CLAIMS, new RegExp(`(^| )${r.combo.prime.replace(/\+/g, '\\+')}~`), r.id);
});

test('setup wizard: "Have you used Tally?" sets the switch (yes → on, TallyPrime keys; no → off; skipped → unchanged)', () => {
  resetStorage();
  applyTallyAnswer(true);
  assert.equal(keysOn(), true);
  assert.equal(keysLayout(), 'prime');
  applyTallyAnswer(null);
  assert.equal(dumpStorage().mrchartist_tally_keys, 'on');
  applyTallyAnswer(false);
  assert.equal(keysOn(), false);
});

test('Go To: Tally names, report synonyms and Hindi find the screen', () => {
  const pages = gatewayGoto();
  assert.ok(pages.length > 40);
  assert.equal(new Set(pages.map((p) => p.id)).size, pages.length, 'one row per destination');
  const top = (q: string) => searchAll(q, { data: { invoices: [], clients: [], items: [], pages, actions: [] } }).filter((r) => r.group === 'pages')[0]?.href ?? '';
  assert.match(top('trial'), /r=tb/);
  assert.match(top('daily entries'), /r=daybook/);
  assert.match(top('warehouse summary'), /tab=godowns/);
  assert.match(top('outstanding'), /x=(debtors|creditors)/);
  assert.match(top('तलपट'), /r=tb/);
  assert.match(top('रोज़नामचा'), /r=daybook/);
});

test('gotoEntries: de-duplicates by destination and adds synonyms by entry id', () => {
  const rows = gotoEntries(
    [
      { id: 'daybook', label: 'Day book', path: [], href: '/gateway/display?r=daybook&from=root', haystack: 'day book' },
      { id: 'm-daybook', label: 'Day book', path: ['More'], href: '/gateway/display?r=daybook&from=more', haystack: 'day book' },
    ],
    GOTO_SYNONYMS,
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].keywords?.includes('daily entries'));
  assert.equal(rows[0].subtitle, 'Gateway');
});

test('screenName: the page heading, else the document title', () => {
  assert.equal(screenName({ querySelector: () => ({ textContent: ' Invoices ' }), title: 'x' } as never), 'Invoices');
  assert.equal(screenName({ querySelector: () => null, title: 'Books · Mr. Chartist' } as never), 'Books');
});
