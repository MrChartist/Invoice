#!/usr/bin/env node
/**
 * R20-A browser-conflict matrix (PRD §5.3): for every key the registry may claim (and the never-claimed list), does
 * a keydown listener receive it, and does preventDefault keep the page (no reload, no navigation, no new tab)?
 * Runs Playwright's Chromium on a blank local page — no app, no network. Prints one line per key and a summary.
 * Note: Playwright sends keys through the DevTools protocol into the page; browser-level accelerators that the OS /
 * browser shell handles before the page (Ctrl+T, Ctrl+W, Alt+F4 …) are not exercised by synthetic input, so those
 * stay in NEVER_CLAIM by rule, not by this run.
 *
 *   node tests/e2e/key-matrix.mjs
 */
import { createServer } from 'node:http';
import { loadPlaywright } from '../../scripts/lib/harness.mjs';

const KEYS = [
  'F1', 'F2', 'Alt+F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Control+F1', 'Control+F3', 'Alt+F3',
  'Control+F5', 'Control+F6', 'Control+F7', 'Control+F8', 'Control+F9', 'Control+Shift+F4', 'Alt+F1', 'Alt+F5', 'Alt+F6', 'Alt+F7',
  'Alt+F8', 'Alt+F9', 'Alt+F12', 'Alt+KeyG', 'Control+KeyG', 'Alt+KeyK', 'Alt+KeyY', 'Alt+KeyO', 'Alt+KeyS', 'Alt+KeyD', 'Alt+KeyT',
  'Alt+KeyC', 'Alt+KeyX', 'Alt+Digit2', 'Alt+KeyA', 'Alt+KeyQ', 'Alt+KeyI', 'Alt+KeyU', 'Alt+KeyN', 'Control+KeyA', 'Control+KeyD',
  'Control+KeyL', 'Control+KeyH', 'Control+KeyJ', 'Control+KeyB', 'Control+KeyE', 'Control+KeyO', 'Control+KeyP', 'Control+KeyU',
  'Control+KeyM', 'Control+KeyR', 'Control+KeyF', 'Control+KeyI', 'Control+Alt+KeyN', 'Control+Alt+KeyR', 'Control+Alt+KeyB',
  'Control+Alt+KeyI', 'Control+Alt+KeyW', 'Control+Shift+KeyS', 'PageUp', 'PageDown', 'Control+Slash', 'Shift+Slash',
];

const html = `<!doctype html><meta charset="utf-8"><title>k</title><input id="f"><script>
window.got = []; window.loads = (window.loads || 0) + 1;
addEventListener('keydown', (e) => { got.push(e.key); if (window.block) e.preventDefault(); });
</script>`;
const srv = createServer((_, res) => res.end(html));
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const ctx = await browser.newContext();
const rows = [];
for (const block of [true, false]) {
  for (const key of KEYS) {
    const page = await ctx.newPage();
    await page.goto(url);
    await page.evaluate((b) => { window.block = b; window.marker = 1; }, block);
    const pages = ctx.pages().length;
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({ got: window.got.length, marker: window.marker === 1 })).catch(() => ({ got: 0, marker: false }));
    const newTab = ctx.pages().length > pages;
    rows.push({ key, block, received: state.got > 0, kept: state.marker && page.url() === url && !newTab });
    for (const p of ctx.pages()) await p.close();
  }
}
const version = browser.version();
await browser.close();
srv.close();

let unsafe = 0;
for (const key of KEYS) {
  const b = rows.find((r) => r.key === key && r.block);
  const f = rows.find((r) => r.key === key && !r.block);
  const ok = b.received && b.kept;
  if (!ok) unsafe++;
  console.log(`${ok ? 'safe  ' : 'UNSAFE'} ${key.padEnd(20)} received=${b.received} kept-with-preventDefault=${b.kept} default-action-without=${f.kept ? 'none seen' : 'page left / reloaded'}`);
}
console.log(`\n${KEYS.length} keys, ${unsafe} unsafe (Chromium ${version})`);
