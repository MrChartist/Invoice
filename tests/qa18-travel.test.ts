/**
 * QA round 18 — Round 15 (travel, tour & events; R15-A netting / audit coalescing) cross-package seams. One test per
 * finding of docs/prd/qa-round-18.md; each fails on the baseline `0dad0d9`.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { setActorProvider } from '../src/lib/access.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  setActorProvider(null);
});

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('T1: the items footer (Add line, pack rows, travel chips) sits outside the lines\' size container', () => {
  const css = src('src/components/creator/ItemsTable.module.css');
  const rule = (name: string) => css.match(new RegExp(`\\n\\.${name} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.doesNotMatch(rule('wrap'), /container-type/, '.wrap (which holds the footer) is no size container');
  assert.match(rule('lines'), /container-type:\s*inline-size/, 'the lines block is the container the @container rules query');
  const tsx = src('src/components/creator/ItemsTable.tsx');
  const open = tsx.indexOf('data-items-lines');
  const footer = tsx.indexOf('data-items-footer');
  assert.ok(open > 0 && footer > open, 'lines block, then the footer');
  // The lines block (opened at the wrap's indentation + 2) closes right after the line map, before the footer opens.
  assert.match(tsx, /\n {6}<div className=\{styles\.lines\} data-items-lines>[\s\S]*\n {8}\}\)\}\n {6}<\/div>\n\n {6}<div className=\{styles\.footer\} data-items-footer>/);
});
