#!/usr/bin/env node
/**
 * Screenshots and page-frame metrics of the built app (docs/prd/ios-ui.md: before / after sets, PL / QA acceptance).
 * Build-independent: it serves whatever is in dist/ (or DIST_DIR / --dist) under the real headers; run a build first.
 * Signs up a fresh local account, opens the Demo company with sample data, silences one-time tips, then shoots.
 *
 *   node scripts/ui-shots.mjs --out <dir> [--screens dashboard,transactions] [--sizes 375x812,1280x900]
 *        [--themes light,dark,hc-light,hc-dark] [--extra dashboard@1920x1080] [--overlays] [--metrics] [--dist <dir>] [--lang hi]
 *
 * Files: <out>/<screen>-<theme>-<w>x<h>.png (theme "light" / "dark" / "hc-light" / "hc-dark"),
 * overlays as overlay-<name>-<theme>-<w>.png, and with --metrics <out>/frame-metrics.json (frame width, title x / y /
 * size, sideways scroll per screen and size). Defaults: the 11 main screens, 375x812 and 1280x900, light and dark.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPlaywright, serve, DIST } from './lib/harness.mjs';

const SCREENS = {
  dashboard: '/', editor: '/invoice', transactions: '/transactions', clients: '/clients', settings: '/settings',
  books: '/books', gst: '/gst-reports', inventory: '/inventory', pos: '/pos', receivables: '/receivables', 'empty-loans': '/loans',
  // Further routes for frame metrics (PL); name them in --screens to shoot them.
  tables: '/tables', recurring: '/recurring', time: '/time', distribution: '/distribution', expenses: '/expenses',
  manufacturing: '/manufacturing', gateway: '/gateway', reports: '/reports', tds: '/tds', payroll: '/payroll',
  exports: '/exports', reconcile: '/reconcile', cheques: '/cheques', practice: '/practice',
};
const MAIN = ['dashboard', 'editor', 'transactions', 'clients', 'settings', 'books', 'gst', 'inventory', 'pos', 'receivables', 'empty-loans'];

function args(argv) {
  const o = { lang: 'en', screens: MAIN, sizes: ['375x812', '1280x900'], themes: ['light', 'dark'], extra: [], overlays: false, metrics: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--out') o.out = next();
    else if (a === '--dist') o.dist = next();
    else if (a === '--screens') o.screens = next().split(',').filter(Boolean);
    else if (a === '--sizes') o.sizes = next().split(',').filter(Boolean);
    else if (a === '--themes') o.themes = next().split(',').filter(Boolean);
    else if (a === '--extra') o.extra.push(...next().split(',').filter(Boolean));
    else if (a === '--overlays') o.overlays = true;
    else if (a === '--lang') o.lang = next();
    else if (a === '--metrics') o.metrics = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}
const opt = args(process.argv.slice(2));
if (opt.help || !opt.out) {
  console.log('usage: node scripts/ui-shots.mjs --out <dir> [--screens a,b] [--sizes 375x812,1280x900] [--themes light,dark,hc-light,hc-dark] [--extra screen@WxH] [--overlays] [--metrics] [--dist dir]');
  process.exit(opt.help ? 0 : 2);
}
for (const s of [...opt.screens, ...opt.extra.map((e) => e.split('@')[0])]) if (!SCREENS[s]) throw new Error(`unknown screen ${s} (${Object.keys(SCREENS).join(', ')})`);
const size = (s) => s.split('x').map(Number);
const OUT = resolve(opt.out);
mkdirSync(OUT, { recursive: true });

const { chromium } = await loadPlaywright();
const srv = await serve({ dist: opt.dist ? resolve(opt.dist) : DIST });
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);

// Fresh account + Demo company with sample data (never a real company).
await page.goto(srv.origin + '/');
await page.getByLabel('Full name').fill('Asha Traders');
await page.locator('#login-pin').fill('482916');
await page.locator('#login-confirm').fill('482916');
await page.getByRole('button', { name: /Create account/ }).click();
await page.waitForFunction(() => !!localStorage.getItem('mrchartist_inv_auth'), null, { timeout: 15000 });
await page.getByRole('button', { name: /sample data/i }).click();
await page.waitForTimeout(6000);
await page.evaluate((lang) => {
  try {
    localStorage.setItem('mrchartist_tips_off', '1');
    if (lang !== 'en') localStorage.setItem('mrchartist_inv_lang', lang); // device-local interface language (5.4)
  } catch { /* ignore */ }
}, opt.lang);

async function dismiss() {
  for (const n of ['Remind later', 'Got it']) {
    const b = page.getByRole('button', { name: n });
    if (await b.count()) await b.first().click({ timeout: 1000 }).catch(() => {});
  }
}
async function settle() {
  await page.waitForTimeout(1200);
  await dismiss();
  await page.waitForTimeout(300);
}
/** Theme = the saved light / dark choice plus the high-contrast display pref (both read by public/theme-init.js). */
async function setTheme(theme) {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t.includes('dark') ? 'dark' : 'light');
    const p = JSON.parse(localStorage.getItem('mrchartist_display_prefs') || '{}');
    p.high_contrast = t.startsWith('hc-');
    localStorage.setItem('mrchartist_display_prefs', JSON.stringify(p));
  }, theme);
}
const metrics = [];
async function measure(name, theme, w, h) {
  const m = await page.evaluate(() => {
    const main = document.querySelector('main');
    const mr = main?.getBoundingClientRect();
    const h1 = main?.querySelector('h1');
    const hr = h1?.getBoundingClientRect();
    const cs = h1 ? getComputedStyle(h1) : null;
    let left = Infinity;
    let right = 0;
    for (const e of main ? main.querySelectorAll('*') : []) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.width > innerWidth * 0.9) continue;
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
    }
    return {
      mainLeft: Math.round(mr?.left ?? 0), mainW: Math.round(mr?.width ?? 0), usedLeft: Math.round(left), usedW: Math.round(right - left),
      h1: h1 ? h1.textContent.trim().slice(0, 40) : null, h1Left: Math.round(hr?.left ?? -1), h1Top: Math.round(hr?.top ?? -1),
      h1Size: cs?.fontSize ?? null, h1Weight: cs?.fontWeight ?? null, hscroll: document.documentElement.scrollWidth > innerWidth,
    };
  });
  metrics.push({ screen: name, theme, size: `${w}x${h}`, ...m });
}
async function shoot(name, theme, s) {
  const [w, h] = size(s);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(srv.origin + SCREENS[name]);
  await settle();
  await page.screenshot({ path: `${OUT}/${name}-${theme}${opt.lang === 'en' ? '' : `-${opt.lang}`}-${w}x${h}.png` });
  if (opt.metrics) await measure(name, theme, w, h);
}

let count = 0;
for (const theme of opt.themes) {
  await setTheme(theme);
  for (const s of opt.sizes) for (const name of opt.screens) { await shoot(name, theme, s); count++; }
  for (const e of opt.extra) { const [name, s] = e.split('@'); await shoot(name, theme, s); count++; }
}

if (opt.overlays) {
  for (const theme of opt.themes) {
    await setTheme(theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(srv.origin + '/'); await settle();
    await page.keyboard.press('Control+k'); await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/overlay-cmdk-${theme}-1280.png` }); count++;
    await page.keyboard.press('Escape');
    for (const w of [1280, 375]) {
      await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
      await page.goto(srv.origin + '/clients'); await settle();
      const add = page.getByRole('button', { name: /Add client|New client/i });
      if (await add.count()) {
        await add.first().click(); await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/overlay-modal-${theme}-${w}.png` }); count++;
        await page.keyboard.press('Escape');
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(srv.origin + '/transactions'); await settle();
    await page.keyboard.press('F1'); await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/overlay-help-${theme}-1280.png` }); count++;
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(srv.origin + '/'); await settle();
    const menu = page.getByRole('button', { name: /menu/i });
    if (await menu.count()) {
      await menu.first().click(); await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/overlay-drawer-${theme}-375.png` }); count++;
      await page.keyboard.press('Escape');
    }
    await page.goto(srv.origin + '/'); await settle();
    const plus = page.getByRole('button', { name: /^New$|Create new/ });
    if (await plus.count()) {
      await plus.last().click(); await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/overlay-create-sheet-${theme}-375.png` }); count++;
      await page.keyboard.press('Escape');
    }
  }
}

if (opt.metrics) writeFileSync(`${OUT}/frame-metrics.json`, JSON.stringify(metrics, null, 1));
console.log(`ui-shots: ${count} screenshots in ${OUT}${opt.metrics ? ' (+ frame-metrics.json)' : ''}`);
await browser.close();
await srv.close();
