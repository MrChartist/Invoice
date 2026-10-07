#!/usr/bin/env node
/**
 * Non-default performance + CSP smoke run against the production build (dist/), served
 * with the headers from public/_headers.  NOT part of `npm test`.
 *
 *   npm run build && node tests/perf/run.mjs [--json]
 *
 * Sections: load metrics (FCP/LCP/CLS/long tasks), 300-invoice memory, keystroke latency
 * with 20 line items, CSP sweep (all routes, PDF export, QR, logo upload, service worker).
 * Exits non-zero only on CSP violations / page errors / keystroke p95 over budget.
 */
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIST, isCsp, loadPlaywright, seedAuth, serve, watch } from '../../scripts/lib/harness.mjs';

if (!existsSync(join(DIST, 'index.html'))) { console.error('run `npm run build` first'); process.exit(2); }

const KEY_P95_BUDGET_MS = Number(process.env.KEY_P95_BUDGET_MS ?? 50);
const out = {};
const problems = [];
const { chromium } = await loadPlaywright();
const srv = await serve();
const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const KNOWN = /api\.dicebear\.com/;

const OBSERVERS = `
  window.__m = { cls: 0, longTasks: [], fcp: 0, lcp: 0 };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { const e = l.getEntries().at(-1); window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
`;

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];

function makeInvoices(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const items = Array.from({ length: 5 }, (_, j) => ({ id: `it${i}_${j}`, name: `Service line ${j} for invoice ${i}`, type: 'service', quantity: j + 1, rate: 1000 + j * 50, tax_rate: 18, amount: (j + 1) * (1000 + j * 50) }));
    const subtotal = items.reduce((s, x) => s + x.amount, 0);
    rows.push({
      id: `inv_${i}`, invoice_number: `INV/FY25-26/${String(i + 1).padStart(4, '0')}`, doc_type: 'INVOICE',
      issue_date: '2025-06-01', due_date: '2025-06-15', status: ['DRAFT', 'SENT', 'PAID', 'OVERDUE'][i % 4], currency: 'INR', template_id: 'classic_orange',
      client: { id: `c${i % 40}`, name: `Client ${i % 40}`, email: `c${i % 40}@example.com`, address: 'Street 1', city: 'Mumbai', zip: '400001' },
      sender: null, items, gst_mode: 'INTRA', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0,
      tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: i % 4 === 2 ? subtotal * 1.18 : 0, notes: '', terms: '',
      subtotal, discount_amount: 0, taxable_value: subtotal, cgst_amount: subtotal * 0.09, sgst_amount: subtotal * 0.09, igst_amount: 0,
      tax_amount: subtotal * 0.18, round_off: 0, total: subtotal * 1.18, balance_due: i % 4 === 2 ? 0 : subtotal * 1.18,
      created_at: '2025-06-01T00:00:00.000Z', updated_at: '2025-06-01T00:00:00.000Z',
    });
  }
  return rows;
}

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: opts.sw ? 'allow' : 'block', acceptDownloads: true, viewport: { width: 1366, height: 800 } });
  await seedAuth(ctx, opts.store || {});
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|api\.dicebear\.com/, (r) => r.abort());
  await ctx.addInitScript(OBSERVERS);
  const page = await ctx.newPage();
  if (process.env.THROTTLE) { // THROTTLE=1: ~Fast 4G (40 ms RTT, 1.6 Mbit/s down) + 4x CPU slowdown
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const errors = [];
  watch(page, errors);
  return { ctx, page, errors };
}

const metrics = (page) => page.evaluate(() => ({ ...window.__m, cls: +window.__m.cls.toFixed(4), fcp: Math.round(window.__m.fcp), lcp: Math.round(window.__m.lcp), longTasks: window.__m.longTasks, nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transferKB: Math.round(performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0) / 1024) }; })() }));

try {
  // 1. Load metrics (cold, 3 runs each, median) ───────────────────────────
  out.load = {};
  for (const route of ['/', '/invoice']) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const { ctx, page } = await newPage();
      await page.goto(srv.origin + route, { waitUntil: 'load' });
      await page.waitForSelector('#root > *');
      await page.waitForTimeout(800);
      runs.push(await metrics(page));
      await ctx.close();
    }
    out.load[route] = { fcp: median(runs.map((r) => r.fcp)), lcp: median(runs.map((r) => r.lcp)), cls: Math.max(...runs.map((r) => r.cls)), longTasks: runs[1].longTasks, dcl: median(runs.map((r) => r.nav.dcl)), load: median(runs.map((r) => r.nav.load)), transferKB: runs[0].nav.transferKB };
  }

  // 2. Route transitions (SPA) ─────────────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    await page.goto(srv.origin + '/');
    await page.waitForSelector('#root > *');
    out.transitions = {};
    for (const [label, sel] of [['/transactions', 'a[href="/transactions"]'], ['/clients', 'a[href="/clients"]'], ['/invoice', 'a[href="/invoice"]'], ['/settings', 'a[href="/settings"]'], ['/', 'a[href="/"]']]) {
      const link = page.locator(sel).first();
      if (!(await link.count())) continue;
      const t = await page.evaluate(() => performance.now());
      await link.click();
      await page.waitForURL('**' + label);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      out.transitions[label] = Math.round((await page.evaluate(() => performance.now())) - t);
    }
    await ctx.close();
  }

  // 3. Memory + load with 300 invoices ─────────────────────────────────────
  {
    const store = { mrchartist_inv_invoices: JSON.stringify(makeInvoices(300)) };
    out.memory300 = {};
    for (const route of ['/', '/transactions', '/clients']) {
      const { ctx, page, errors } = await newPage({ store });
      await page.goto(srv.origin + route);
      await page.waitForSelector('#root > *');
      await page.waitForTimeout(600);
      await page.evaluate(() => window.gc && window.gc());
      const heapMB = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
      const m = await metrics(page);
      out.memory300[route] = { heapMB, fcp: m.fcp, longTasks: m.longTasks, storageKB: await page.evaluate(() => Math.round(localStorage.getItem('mrchartist_inv_invoices').length / 1024)), pageErrors: errors.filter((e) => e.kind === 'pageerror').length };
      await ctx.close();
    }
    const { ctx, page } = await newPage();
    await page.goto(srv.origin + '/'); await page.waitForSelector('#root > *'); await page.waitForTimeout(600);
    await page.evaluate(() => window.gc && window.gc());
    out.memory300.baselineHeapMB = await page.evaluate(() => +(performance.memory.usedJSHeapSize / 1048576).toFixed(1));
    await ctx.close();
  }

  // 4. Keystroke latency, 20 line items ────────────────────────────────────
  {
    const { ctx, page } = await newPage();
    await page.goto(srv.origin + '/invoice');
    await page.waitForSelector('input[placeholder="Description"]');
    const add = page.getByRole('button', { name: /add item/i });
    while ((await page.locator('input[placeholder="Description"]').count()) < 20) await add.click();
    await page.evaluate(() => {
      window.__keys = [];
      document.addEventListener('keydown', () => {
        const t0 = performance.now();
        // input handler (sync React flush) runs after keydown; measure to the next painted frame
        requestAnimationFrame(() => setTimeout(() => window.__keys.push(performance.now() - t0), 0));
      }, true);
    });
    const field = page.locator('input[placeholder="Description"]').nth(19);
    await field.click();
    const text = 'Consulting services for the quarter ending March';
    for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(40); }
    await page.waitForTimeout(200);
    const keys = await page.evaluate(() => window.__keys);
    out.typing = { items: await page.locator('input[placeholder="Description"]').count(), keys: keys.length, medianMs: +median(keys).toFixed(1), p95Ms: +pct(keys, 0.95).toFixed(1), maxMs: +Math.max(...keys).toFixed(1), valueOk: (await field.inputValue()) === text };
    if (out.typing.p95Ms > KEY_P95_BUDGET_MS) problems.push(`keystroke p95 ${out.typing.p95Ms}ms > ${KEY_P95_BUDGET_MS}ms`);
    // CPU slowdown x4 approximates a mid-range phone
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => { window.__keys.length = 0; });
    await field.fill('');
    for (const ch of 'Throttled typing test') { await page.keyboard.type(ch); await page.waitForTimeout(60); }
    await page.waitForTimeout(300);
    const k4 = await page.evaluate(() => window.__keys);
    out.typing.cpu4x = { medianMs: +median(k4).toFixed(1), p95Ms: +pct(k4, 0.95).toFixed(1) };
    await ctx.close();
  }

  // 5. CSP sweep ───────────────────────────────────────────────────────────
  {
    const profile = { id: 'p1', companyName: 'QA Co', companyTagline: '', companyEmail: 'qa@example.com', companyPhone: '', companyAddress: 'Mumbai', companyGstin: '', companyWebsite: '', bankName: 'Bank', accountName: 'QA Co', accountNumber: '1234567890', ifsc: 'ABCD0000001', upiId: 'qa@upi' };
    const settings = JSON.stringify({ profiles: [profile], activeProfileId: 'p1', onboarded: true, defaultCurrency: 'INR', defaultTaxRate: 18, invoicePrefix: '', defaultDueDays: 14, defaultTerms: '', defaultNotes: '', roundOff: false });
    const { ctx, page, errors } = await newPage({ sw: true, store: { mrchartist_inv_settings: settings } });
    out.csp = { routes: {}, checks: {} };
    for (const route of ['/', '/invoice', '/invoice/abc', '/transactions', '/clients', '/settings']) {
      const before = errors.length;
      await page.goto(srv.origin + route);
      await page.waitForSelector('#root > *');
      await page.waitForTimeout(500);
      out.csp.routes[route] = errors.slice(before).filter(isCsp).filter((e) => !KNOWN.test(e.text)).length;
    }
    // service worker under CSP (worker-src 'self')
    out.csp.checks.serviceWorker = await page.evaluate(async () => { try { const r = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; return !!r; } catch (e) { return String(e); } });
    // logo upload -> data: URL image
    await page.goto(srv.origin + '/settings');
    await page.waitForSelector('input[type=file]');
    const tmp = mkdtempSync(join(tmpdir(), 'mci-logo-'));
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    writeFileSync(join(tmp, 'logo.png'), png);
    await page.locator('input[type=file]').first().setInputFiles(join(tmp, 'logo.png'));
    await page.waitForTimeout(500);
    out.csp.checks.logoDataUrl = await page.evaluate(() => [...document.images].some((i) => i.src.startsWith('data:image/png') && i.complete && i.naturalWidth > 0));
    rmSync(tmp, { recursive: true, force: true });
    // preview: QR canvas + PDF export
    await page.goto(srv.origin + '/invoice');
    await page.waitForSelector('input[placeholder="Description"]');
    await page.locator('input[placeholder="Description"]').first().fill('QA item');
    await page.locator('input[placeholder="0.00"]').first().fill('1500');
    await page.getByRole('button', { name: /^preview$/i }).first().click();
    await page.waitForSelector('text=Download PDF');
    out.csp.checks.qrCanvas = (await page.locator('canvas').count()) > 0;
    const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.getByRole('button', { name: /download pdf/i }).click();
    const d = await dl;
    out.csp.checks.pdfDownload = d ? d.suggestedFilename() : false;
    await page.waitForTimeout(500);
    const all = errors.filter(isCsp);
    out.csp.violations = all.filter((e) => !KNOWN.test(e.text)).map((e) => e.text.slice(0, 300));
    out.csp.knownThirdPartyAvatarViolations = all.filter((e) => KNOWN.test(e.text)).length;
    out.csp.pageErrors = errors.filter((e) => e.kind === 'pageerror').map((e) => e.text.slice(0, 200));
    if (out.csp.violations.length) problems.push(`${out.csp.violations.length} CSP violations`);
    if (out.csp.pageErrors.length) problems.push('page errors in CSP sweep');
    for (const [k, v] of Object.entries(out.csp.checks)) if (!v || (typeof v === 'string' && k !== 'pdfDownload')) problems.push(`csp check failed: ${k}=${v}`);
    await ctx.close();
  }
} catch (e) {
  problems.push('exception: ' + (e && e.stack || e));
} finally {
  await browser.close();
  await srv.close();
}

console.log(JSON.stringify(out, null, 2));
if (problems.length) { console.error('\nPROBLEMS:\n- ' + problems.join('\n- ')); process.exit(1); }
