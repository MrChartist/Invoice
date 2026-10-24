#!/usr/bin/env node
/**
 * End-to-end smoke test against the PRODUCTION build (dist/) served with the real CSP headers.
 *
 *   npm run build && npm run test:e2e
 *
 * Journey: first-run account → dashboard → new invoice (client + line) → save → appears in the
 * list with the FY number → preview opens with focus inside → backup download → restore that
 * backup (with undo copy) → data still there. Fails on any page error or CSP violation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, isCsp, isFontNoise, loadPlaywright, serve, watch } from '../../scripts/lib/harness.mjs';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ missing - run `npm run build` first');
  process.exit(2);
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures.push(msg);
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (err) {
    check(false, `${name}: ${err?.message?.split('\n')[0] ?? err}`);
    if (process.env.E2E_SHOTS) {
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {});
      console.log(`      url: ${page.url()}\n      ${(err?.message ?? '').split('\n').slice(0, 6).join('\n      ')}`);
    }
    throw err;
  }
};

const { chromium } = await loadPlaywright();
const srv = await serve();
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
watch(page, errors);
page.setDefaultTimeout(10000);

try {
  await step('first-run account', async () => {
    await page.goto(srv.origin + '/');
    await page.getByLabel('Full name').fill('E2E Trader');
    await page.locator('#login-pin').fill('482916');
    await page.locator('#login-confirm').fill('482916');
    await page.getByRole('button', { name: /Create account/ }).click();
    // PBKDF2 hashing is async: wait for the stored credential and the app shell, not the URL.
    await page.waitForFunction(() => !!localStorage.getItem('mrchartist_inv_auth'), null, { timeout: 15000 });
    await page.getByText('Stored on this device').waitFor({ timeout: 15000 });
    check(true, 'account created and app unlocked');
  });

  await step('create and save an invoice', async () => {
    // A sender profile, as the user would enter it in Settings → Profiles.
    await page.evaluate(() => {
      const profile = {
        id: 'p1', companyName: 'E2E Trader', companyAddress: 'Pune', companyGstin: '27AAAAA0000A1Z5', stateCode: '27',
        companyEmail: '', companyPhone: '', companyTagline: '', companyWebsite: '', invoicePrefix: '',
      };
      const s = JSON.parse(localStorage.getItem('mrchartist_inv_settings') || '{}');
      localStorage.setItem('mrchartist_inv_settings', JSON.stringify({ ...s, profiles: [profile], activeProfileId: 'p1', onboarded: true }));
    });
    await page.goto(srv.origin + '/invoice');
    await page.getByLabel('Client name').fill('Acme Buyers');
    await page.getByLabel('Item 1 name').fill('Consulting');
    await page.getByLabel('Item 1 quantity').fill('2');
    await page.getByLabel('Item 1 rate').fill('1500');
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices') || '[]'));
    check(stored.length === 1, `one invoice stored (${stored.length})`);
    check(/^INV\/FY\d{2}-\d{2}\/0001$/.test(stored[0]?.invoice_number ?? ''), `Indian-FY number (${stored[0]?.invoice_number})`);
    check(stored[0]?.status === 'Sent', `Save issues the document (${stored[0]?.status})`);
    check(Math.abs((stored[0]?.total ?? 0) - 3540) < 0.01, `total with 18% GST = 3540 (${stored[0]?.total})`);
  });

  await step('invoice list and preview', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByText('Acme Buyers').first().waitFor();
    check(true, 'invoice appears in the list');
    await page.getByRole('button', { name: /preview|view/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.waitFor();
    const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[aria-label="Document preview"]'));
    check(focusInside, 'preview moves focus into the dialog');

    // Download PDF produces a real PDF file.
    await dialog.getByRole('button', { name: /^Share/ }).click();
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Download PDF/ }).click()]);
    const head = readFileSync(await pdf.path()).subarray(0, 5).toString();
    check(head === '%PDF-' && /\.pdf$/.test(pdf.suggestedFilename()), `Download PDF gives a PDF (${pdf.suggestedFilename()})`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('share the PDF file through the OS share sheet', async () => {
    // Stand in for a phone's share sheet: capture what the app hands over.
    await page.evaluate(() => {
      Object.assign(navigator, {
        canShare: (d) => !!d.files?.length,
        share: async (d) => {
          window.__shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, title: d.title };
        },
      });
    });
    await page.getByRole('button', { name: /preview|view/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.getByRole('button', { name: /^Share/ }).click();
    await page.getByRole('menuitem', { name: /Share PDF/ }).click();
    await page.waitForFunction(() => !!window.__shared, null, { timeout: 20000 });
    const shared = await page.evaluate(() => window.__shared);
    check(shared.type === 'application/pdf' && shared.size > 1000 && /\.pdf$/.test(shared.name), `Share PDF hands a PDF file to the share sheet (${shared.name}, ${shared.size} bytes)`);
    await page.keyboard.press('Escape');
  });

  await step('change in a second tab', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByText('Acme Buyers').first().waitFor();
    const tab2 = await context.newPage();
    await tab2.goto(srv.origin + '/clients');
    await tab2.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('mrchartist_inv_invoices') || '[]');
      rows[0].notes = 'changed in tab 2';
      localStorage.setItem('mrchartist_inv_invoices', JSON.stringify(rows));
    });
    await page.getByText('Updated in another tab').waitFor();
    check(true, 'first tab is told about the change made in the second tab');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Updated in another tab').waitFor({ state: 'detached' });
    await tab2.close();
  });

  let backupPath = '';
  await step('download a backup', async () => {
    await page.goto(srv.origin + '/settings?tab=data');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Download backup/ }).first().click(),
    ]);
    backupPath = await download.path();
    const file = JSON.parse(readFileSync(backupPath, 'utf8'));
    check(file.app === 'mrchartist-invoice' && file.data?.mrchartist_inv_invoices?.includes('Acme Buyers'), 'backup file contains the invoice');
    check(!('mrchartist_inv_auth' in (file.data ?? {})), 'backup never carries the PIN');
  });

  await step('restore the backup', async () => {
    await page.evaluate(() => localStorage.setItem('mrchartist_inv_invoices', '[]'));
    await page.reload();
    await page.locator('input[type=file][accept*="json"]').first().setInputFiles(backupPath);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.waitForEvent('load', { timeout: 15000 });
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices') || '[]'));
    check(stored.length === 1, `restored invoice is back (${stored.length})`);
    const version = await page.evaluate(() => localStorage.getItem('mrchartist_inv_schema_version'));
    check(Number(version) >= 1, `schema version stamped (${version})`);
    await page.goto(srv.origin + '/settings?tab=data');
    await page.getByRole('button', { name: /Undo last restore/ }).waitFor();
    check(true, 'an undo copy of the replaced data is offered');
  });
} catch {
  /* already reported */
} finally {
  const real = errors.filter((e) => !isFontNoise(e));
  check(real.filter(isCsp).length === 0, `no CSP violations (${real.filter(isCsp).length})`);
  check(real.length === 0, `no page errors (${real.length}${real.length ? ': ' + real[0].text.slice(0, 160) : ''})`);
  await browser.close();
  await srv.close();
}

if (failures.length) {
  console.error(`\n${failures.length} e2e check(s) failed`);
  process.exit(1);
}
console.log('\nall e2e checks passed');
