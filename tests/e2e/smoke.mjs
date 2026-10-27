#!/usr/bin/env node
/**
 * End-to-end smoke test against the PRODUCTION build (dist/) served with the real CSP headers.
 *
 *   npm run build && npm run test:e2e
 *
 * Journey: first-run account → dashboard → new invoice (client + line) → save → appears in the
 * list with the FY number → preview opens with focus inside → backup download → restore that
 * backup (with undo copy) → data still there → a pre-4.x localStorage user is moved to IndexedDB.
 * Data tables live in IndexedDB (read/written here like a second tab would). Fails on any page
 * error or CSP violation.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { DIST, isCsp, isFontNoise, loadPlaywright, serve, watch } from '../../scripts/lib/harness.mjs';

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ missing - run `npm run build` first');
  process.exit(2);
}

/** A valid 24x24 orange PNG (built here, no fixture file) used as the business logo. */
const LOGO_PNG = (() => {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const w = 24;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [240, 120, 20]).flat())]);
  const idat = deflateSync(Buffer.concat(Array.from({ length: w }, () => row)));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]).toString('base64');
})();

/*
 * The app keeps its data tables in IndexedDB (Phase 4.2) behind an in-memory cache. These helpers
 * read and write that store directly, the way a second tab would: a write is announced on the
 * app's BroadcastChannel so open tabs refresh their cache. Reads poll until `ok(value)` holds,
 * because the app commits its writes a moment after the screen updates.
 */
/** 8G A1: close the post-save success sheet when a step goes on working in the editor. */
async function closeSendSheet(p) {
  const sheet = p.locator('[data-send-sheet]');
  await sheet.waitFor({ timeout: 10000 }).catch(() => {});
  if (await sheet.count()) {
    await p.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
  }
}

async function idbGet(p, key) {
  return p.evaluate((k) => new Promise((resolve, reject) => {
    const open = indexedDB.open('mrchartist_inv_kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('data', 'readonly').objectStore('data').get(k);
      req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
      req.onerror = () => { db.close(); reject(req.error); };
    };
  }), key);
}
async function idbPut(p, key, value) {
  await p.evaluate(([k, v]) => new Promise((resolve, reject) => {
    const open = indexedDB.open('mrchartist_inv_kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('data', 'readwrite');
      if (v === null) tx.objectStore('data').delete(k);
      else tx.objectStore('data').put(v, k);
      tx.oncomplete = () => {
        db.close();
        const ch = new BroadcastChannel('mrchartist_inv_sync');
        ch.postMessage({ keys: [k] });
        ch.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  }), [key, value]);
}
async function readJson(p, name, fallback, ok = () => true, timeout = 5000) {
  const until = Date.now() + timeout;
  for (;;) {
    const raw = await idbGet(p, `mrchartist_inv_${name}`);
    const value = raw === null ? fallback : JSON.parse(raw);
    if (ok(value) || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const writeJson = (p, name, value) => idbPut(p, `mrchartist_inv_${name}`, value === null ? null : JSON.stringify(value));

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
    // Always print where the page was, so a CI-only failure can be diagnosed from the log alone.
    const seen = await page.evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 600)).catch(() => '');
    console.log(`      url: ${page.url()}\n      ${(err?.message ?? '').split('\n').slice(0, 8).join('\n      ')}\n      page: ${seen}`);
    if (process.env.E2E_SHOTS) {
      await page.screenshot({ path: join(process.env.E2E_SHOTS, `${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {});
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
// E2E_TIMEOUT (ms) helps on a loaded machine; 10 s otherwise.
page.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 10000);

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

  await step('first-run setup wizard', async () => {
    // 8H step 0: language + "What do you do?" (CA / full accounting keeps every module for the journey).
    const start = page.getByRole('dialog', { name: 'What do you do?' });
    await start.waitFor();
    await start.getByRole('radio', { name: /CA \/ full accounting/ }).click();
    await page.getByRole('button', { name: /Next/ }).click();
    const wizard = page.getByRole('dialog', { name: 'Your business' });
    await wizard.waitFor();
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByText('Add the name to print on your invoices.').waitFor();
    check(true, 'wizard refuses to continue without a business name');
    await page.getByLabel('Name on invoices *').fill('E2E Trader');
    await page.getByLabel('City').fill('Pune');
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('dialog', { name: 'GST registration' }).waitFor();
    await page.getByRole('radio', { name: 'I have a GSTIN' }).click();
    await page.getByLabel('GSTIN', { exact: true }).fill('27AAPFU0939F1ZV');
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('dialog', { name: 'How clients pay you' }).waitFor();
    await page.getByLabel('UPI ID').fill('e2e@okhdfcbank');
    await page.getByRole('button', { name: /Next/ }).click();
    await page.getByRole('dialog', { name: /Logo/ }).waitFor();
    // A real logo, so later steps can prove the image stored by reference still renders.
    await page.getByLabel('Upload logo image').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(LOGO_PNG, 'base64') });
    await page.getByRole('dialog', { name: /Logo/ }).locator('img[src^="data:image/"]').first().waitFor();
    await page.getByRole('button', { name: /Finish/ }).click();
    await page.waitForURL(/\/invoice/);
    const s = await readJson(page, 'settings', {}, (v) => v.onboarded === true);
    const p = s.profiles?.find((x) => x.id === s.activeProfileId) ?? {};
    check(s.onboarded === true && p.companyName === 'E2E Trader' && p.stateCode === '27' && p.upiId === 'e2e@okhdfcbank',
      `wizard saves the profile (${p.companyName}, state ${p.stateCode}, ${p.upiId}) and opens the editor`);
  });

  await step('interface language: switch to Hindi, see the Hindi shell and Dashboard, switch back', async () => {
    const nav = page.getByRole('navigation', { name: /Primary|मुख्य मेन्यू/ });
    await page.goto(srv.origin + '/settings');
    await page.getByLabel('Language / भाषा').first().selectOption('hi');
    await nav.getByRole('link', { name: 'डैशबोर्ड' }).waitFor();
    await nav.getByRole('link', { name: 'नया इनवॉइस' }).waitFor();
    check((await page.evaluate(() => document.documentElement.lang)) === 'hi', 'Hindi sets <html lang="hi">');
    // A reload keeps the device's choice; the Dashboard opens in Hindi before first paint.
    await page.goto(srv.origin + '/');
    await page.getByText('हाल के दस्तावेज़').waitFor();
    const stored = await page.evaluate(() => localStorage.getItem('mrchartist_inv_lang'));
    const fontOk = await page.evaluate(async () => {
      await document.fonts.load("16px 'Noto Sans Devanagari'", 'क');
      return document.fonts.check("16px 'Noto Sans Devanagari'", 'क');
    });
    check(stored === 'hi' && fontOk, `the choice is kept on this device (${stored}) and the self-hosted Devanagari font loads (${fontOk})`);
    // Round 2 area catalogues: the Clients list (sales area) is translated too.
    await page.goto(srv.origin + '/clients');
    await page.getByRole('button', { name: 'ग्राहक जोड़ें' }).first().waitFor();
    await page.getByRole('searchbox', { name: 'ग्राहक खोजें' }).waitFor();
    check(true, 'Clients page shows Hindi (sales area catalogue)');
    // Round 2 areas: the GST page (lazy chunk + its area catalogue) opens in Hindi too.
    await page.goto(srv.origin + '/gst-reports');
    await page.getByRole('heading', { name: 'GST रिपोर्ट' }).first().waitFor();
    await page.getByText('दाख़िल करने से पहले अपने CA से जाँच करवाएँ।').first().waitFor();
    check(true, 'GST page shows Hindi (gst area catalogue)');
    await page.goto(srv.origin + '/settings');
    // Round 2 area catalogues: the Settings tabs follow the language too.
    await page.getByRole('tab', { name: 'डेटा और बैकअप' }).waitFor();
    check(true, 'Settings tabs are in Hindi (डेटा और बैकअप)');
    await page.getByLabel('Language / भाषा').first().selectOption('en');
    await nav.getByRole('link', { name: 'Dashboard' }).waitFor();
    check((await page.evaluate(() => document.documentElement.lang)) === 'en', 'back to English (<html lang="en">)');
  });

  await step('8H: Marathi interface, shop-mode sidebar (Kirana) and the phone "+" quick-create sheet', async () => {
    const nav = page.getByRole('navigation', { name: /Primary|मुख्य/ });
    await page.goto(srv.origin + '/settings');
    await page.getByLabel('Language / भाषा').first().selectOption('mr');
    await nav.getByRole('link', { name: 'डॅशबोर्ड' }).waitFor();
    await nav.getByRole('link', { name: 'ग्राहक' }).waitFor();
    check((await page.evaluate(() => document.documentElement.lang)) === 'mr', 'Marathi sets <html lang="mr"> and the sidebar is in Marathi');
    await page.getByLabel('Language / भाषा').first().selectOption('en');
    await nav.getByRole('link', { name: 'Dashboard' }).waitFor();

    // Shop mode: Kirana hides Books / Payroll from the sidebar, keeps POS; "Show all features" brings them back.
    await page.goto(srv.origin + '/settings?tab=defaults');
    await page.getByLabel('Business type').selectOption('kirana');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await nav.getByRole('link', { name: 'POS' }).waitFor();
    await nav.getByRole('link', { name: 'Books' }).waitFor({ state: 'detached' });
    const hidden = (await nav.getByRole('link', { name: 'Payroll' }).count()) === 0 && (await nav.getByRole('link', { name: 'GST reports' }).count()) === 0;
    check(hidden, 'Kirana shop mode narrows the sidebar (no Books, Payroll, GST reports; POS shown)');
    await page.getByRole('button', { name: 'Show all features' }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await nav.getByRole('link', { name: 'Books' }).waitFor();
    check(true, '"Show all features" restores every module');

    // Phone "+" opens the quick-create sheet; Expense opens the quick-expense form.
    await page.setViewportSize({ width: 390, height: 844 });
    try {
      await page.goto(srv.origin + '/');
      await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'New' }).click();
      const sheet = page.getByRole('dialog', { name: 'Create new' });
      await sheet.waitFor();
      await sheet.getByRole('link', { name: 'Expense' }).click();
      await page.waitForURL(/\/expenses\?new=expense/);
      await page.getByRole('dialog', { name: 'Quick add expense' }).waitFor();
      check(true, '390 px: "+" → Create new → Expense opens the quick-expense form');
    } finally {
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  });

  await step('beta: badge next to the logo; Help -> Report a problem builds a local diagnostic', async () => {
    await page.goto(srv.origin + '/');
    const badge = page.getByRole('img', { name: 'Beta version (private test build)' }).first();
    await badge.waitFor();
    check(/^beta$/i.test((await badge.innerText()).trim()), 'Beta badge next to the logo, with an accessible label');
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    await page.getByRole('button', { name: /Report a problem/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Report a problem' });
    await dlg.waitFor();
    await page.waitForFunction(() => /Recent errors/.test(document.querySelector('[data-report-problem]')?.value ?? ''));
    const text = await dlg.locator('[data-report-problem]').inputValue();
    check(
      /Version: \d+\.\d+\.\d+/.test(text) && /\[Storage health\]/.test(text) && /Screen: \/$/m.test(text) && !/E2E Trader|e2e@okhdfcbank/.test(text),
      `diagnostic report: version, screen, storage health, no business data (${text.split('\n')[5]})`,
    );
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached' });
  });

  await step('create and save an invoice', async () => {
    await page.goto(srv.origin + '/invoice');
    await page.getByLabel('Client name').fill('Acme Buyers');
    await page.getByLabel('Item 1 name').fill('Consulting');
    await page.getByLabel('Item 1 quantity').fill('2');
    await page.getByLabel('Item 1 rate').fill('1500');
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
    const stored = await readJson(page, 'invoices', [], (v) => v.length === 1);
    check(stored.length === 1, `one invoice stored (${stored.length})`);
    check(/^INV\/FY\d{2}-\d{2}\/0001$/.test(stored[0]?.invoice_number ?? ''), `Indian-FY number (${stored[0]?.invoice_number})`);
    check(stored[0]?.status === 'Sent', `Save issues the document (${stored[0]?.status})`);
    check(Math.abs((stored[0]?.total ?? 0) - 3540) < 0.01, `total with 18% GST = 3540 (${stored[0]?.total})`);
    // A1: the post-save sheet stays (no 10 s timeout) and its WhatsApp link carries the UPI pay link.
    const sheet = page.locator('[data-send-sheet]');
    await sheet.waitFor();
    await page.waitForTimeout(12000);
    check(await sheet.isVisible(), 'post-save success sheet is still open after 12 s');
    const wa = (await sheet.locator('[data-send-whatsapp]').getAttribute('href')) ?? '';
    check(wa.includes('wa.me') && wa.includes('upi%3A'), `sheet WhatsApp link has wa.me + the UPI link (${wa.slice(0, 60)}…)`);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    const assets = await readJson(page, 'assets', []);
    const lsData = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^mrchartist_inv_(invoices|settings|clients|assets)$/.test(k)));
    const marker = await page.evaluate(() => localStorage.getItem('mrchartist_inv_storage_backend'));
    check(lsData.length === 0 && marker === 'idb', `data tables live in IndexedDB, not localStorage (marker ${marker}, ${lsData.length} stray keys)`);
    check(/^asset:/.test(stored[0]?.sender?.logo ?? '') && assets.length === 1 && assets[0].data.startsWith('data:image/'),
      `the snapshot stores the logo by reference (${String(stored[0]?.sender?.logo).slice(0, 24)}, ${assets.length} asset)`);
  });

  await step('typeahead fills client and item from what was saved', async () => {
    await page.goto(srv.origin + '/invoice');
    const name = page.getByLabel('Client name');
    await name.fill('');
    await name.pressSequentially('acm');
    await page.getByRole('option', { name: /Acme Buyers/ }).waitFor();
    await name.press('Enter');
    check((await name.inputValue()) === 'Acme Buyers', `Enter picks the client suggestion (${await name.inputValue()})`);
    const item = page.getByLabel('Item 1 name');
    await item.pressSequentially('cons');
    await page.getByRole('option', { name: /Consulting/ }).waitFor();
    await item.press('ArrowDown');
    await item.press('Enter');
    // The catalogue fill is a state update: wait for it rather than reading too early.
    await page.waitForFunction(() => (document.querySelector('[aria-label="Item 1 rate"]')?.value ?? '') !== '', null, { timeout: 5000 }).catch(() => {});
    const rate = await page.getByLabel('Item 1 rate').inputValue();
    check((await item.inputValue()) === 'Consulting' && /1,?500/.test(rate), `item suggestion fills the catalogue rate (${rate})`);
    const lines = await page.locator('[data-line]').count();
    check(lines === 1, `Enter on a suggestion does not add a line (${lines})`);
    // Leave without saving this second draft.
    await writeJson(page, 'draft', null);
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
    const logoSrc = await dialog.locator('img[src^="data:image/"]').count();
    check(logoSrc > 0, 'the preview renders the logo resolved from its reference');

    // Download PDF produces a real PDF file.
    await dialog.getByRole('button', { name: /^Share/ }).click();
    const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('menuitem', { name: /Download PDF/ }).click()]);
    const head = readFileSync(await pdf.path()).subarray(0, 5).toString();
    check(head === '%PDF-' && /\.pdf$/.test(pdf.suggestedFilename()), `Download PDF gives a PDF (${pdf.suggestedFilename()})`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('custom field: define a printable field and see it in the preview', async () => {
    await page.goto(srv.origin + '/settings?tab=fields');
    await page.locator('#cf-label').fill('Vehicle no.');
    await page.getByLabel('Print on invoices').check();
    await page.getByRole('button', { name: 'Add field' }).click();
    await page.getByRole('list', { name: 'Custom fields' }).getByText('Vehicle no.').waitFor();
    const defs = await readJson(page, 'custom_fields', [], (v) => v.length === 1);
    check(defs.length === 1 && defs[0].print === true && defs[0].applies_to === 'document', `field definition stored (${defs[0]?.label})`);
    const id = (await readJson(page, 'invoices', []))[0].id;
    await page.goto(srv.origin + '/invoice/' + id);
    await page.getByLabel(/^Vehicle no\./).fill('MH12AB1234');
    await page.keyboard.press('Control+s');
    await closeSendSheet(page);
    const inv = (await readJson(page, 'invoices', [], (v) => v[0]?.custom_values?.length === 1))[0];
    check(inv.custom_values?.[0]?.label === 'Vehicle no.' && inv.custom_values[0].value === 'MH12AB1234',
      `the invoice snapshots label + value (${inv.custom_values?.[0]?.label}: ${inv.custom_values?.[0]?.value})`);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.waitFor();
    const block = dialog.locator('[data-custom-fields]').first();
    await block.waitFor();
    const text = await block.innerText();
    check(text.includes('Vehicle no.') && text.includes('MH12AB1234'), `the preview prints the custom field (${text.replace(/\s+/g, ' ').trim()})`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('transport details print; preview with 3 copies downloads a PDF with 3x the pages', async () => {
    const id = (await readJson(page, 'invoices', []))[0].id;
    await page.goto(srv.origin + '/invoice/' + id);
    await page.locator('[data-meta-edit]').click(); // A5: transport sits in the document details
    await page.getByText('Transport / dispatch details').click();
    await page.getByLabel('Vehicle number').fill('ka01ab0001');
    await page.getByLabel('Transporter name').fill('Speedy Roadways');
    await page.keyboard.press('Control+s');
    await closeSendSheet(page);
    const inv = (await readJson(page, 'invoices', [], (v) => v[0]?.transport?.vehicle_no))[0];
    check(/^KA01AB0001$/i.test(inv.transport?.vehicle_no ?? ''), `transport details are saved on the invoice (${inv.transport?.vehicle_no})`);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.waitFor();
    const vehicle = await dialog.locator('[data-transport-row="vehicle"]').first().innerText();
    check(/KA01AB0001/i.test(vehicle), `the transport block prints the vehicle no. (${vehicle.replace(/\s+/g, ' ').trim()})`);

    const pdfPages = async () => {
      await dialog.getByRole('button', { name: /^Share/ }).click();
      // A 3-copy capture can take over 10 s on a loaded box (seen at load average 7 on 4 cores).
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('menuitem', { name: /Download PDF/ }).click()]);
      const body = readFileSync(await dl.path()).toString('latin1');
      return (body.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    };
    const single = await pdfPages();
    await dialog.getByRole('button', { name: /^1 copy$/ }).click();
    const opts = page.getByRole('dialog', { name: 'Print options' });
    for (const name of ['Original', 'Duplicate', 'Triplicate']) await opts.getByLabel(name, { exact: true }).check();
    await dialog.locator('[data-print-copy="triplicate"]').waitFor();
    const banners = await dialog.locator('[data-copy-banner]').allInnerTexts();
    check(banners.length === 3 && /ORIGINAL FOR RECIPIENT/i.test(banners[0]) && /TRIPLICATE/i.test(banners[2]), `three copy banners (${banners.join(' / ')})`);
    await page.keyboard.press('Escape'); // closes the options panel, not the preview
    const triple = await pdfPages();
    check(single >= 1 && triple === single * 3, `3 copies give 3x the PDF pages (${single} -> ${triple})`);
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

  await step('client copy is a static web page with a pay button', async () => {
    // The earlier step stubbed navigator.share; drop it so this one downloads.
    await page.evaluate(() => { delete navigator.share; delete navigator.canShare; });
    await page.reload();
    await page.getByRole('button', { name: /preview|view/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.getByRole('button', { name: /^Share/ }).click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('menuitem', { name: /Client copy/ }).click()]);
    const html = readFileSync(await dl.path(), 'utf8');
    check(/\.html$/.test(dl.suggestedFilename()) && !/<script/i.test(html) && html.includes('Acme Buyers') && /href="upi:\/\/pay\?pa=e2e@okhdfcbank/.test(html) && /src="data:image\//.test(html) && !html.includes('asset:'),
      `client copy: ${dl.suggestedFilename()}, ${Math.round(html.length / 1024)} KB, no scripts, pay link present`);
    // It renders on its own, offline, under its own strict CSP.
    const viewer = await context.newPage();
    const errs = [];
    viewer.on('pageerror', (e) => errs.push(String(e)));
    await viewer.setContent(html);
    const shown = await viewer.locator('text=Pay with UPI').count();
    check(shown === 1 && errs.length === 0, 'client copy opens standalone with the Pay with UPI button');
    await viewer.close();
    await page.keyboard.press('Escape');
  });

  await step('change in a second tab', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByText('Acme Buyers').first().waitFor();
    const tab2 = await context.newPage();
    await tab2.goto(srv.origin + '/clients');
    const rows = await readJson(tab2, 'invoices', []);
    rows[0].notes = 'changed in tab 2';
    await writeJson(tab2, 'invoices', rows);
    await page.getByText('Updated in another tab').waitFor();
    check(true, 'first tab is told about the change made in the second tab');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('Updated in another tab').waitFor({ state: 'detached' });
    await tab2.close();
  });

  await step('record a part payment and print its receipt', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByRole('button', { name: /^Record payment for INV/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Record payment' });
    await dlg.getByLabel('Amount').fill('1000');
    await dlg.getByRole('combobox').selectOption('Bank transfer');
    await dlg.getByText('UTR number (optional)').waitFor();
    check(true, 'reference field asks for the UTR on a bank transfer');
    await dlg.getByLabel(/UTR number/).fill('HDFC0000123456');
    await dlg.getByRole('button', { name: 'Record payment' }).click();
    await dlg.getByText('Payment history').waitFor();
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      dlg.getByRole('button', { name: /^Receipt for/ }).first().click(),
    ]);
    await popup.waitForLoadState();
    const text = await popup.locator('body').innerText();
    check(/PAYMENT RECEIPT/i.test(text) && /RCPT\/FY\d{2}-\d{2}\/0001/.test(text) && text.includes('HDFC0000123456') && /One Thousand/.test(text),
      'receipt shows number, reference and amount in words');
    await popup.close();
    await page.keyboard.press('Escape');
  });

  await step('khata (8A): Clients shows the balance, ₹ Received drops it, the WhatsApp statement carries a upi:// link', async () => {
    await page.goto(srv.origin + '/clients');
    const row = page.locator('tr[data-client-row="Acme Buyers"]');
    await row.getByText('To collect ₹2,540.00').waitFor();
    check(true, 'balance-first Clients list: Acme Buyers shows "To collect ₹2,540.00"');
    const wa = (await row.locator('a[data-wa-statement]').getAttribute('href')) ?? '';
    const text = decodeURIComponent(wa.split('?text=')[1] ?? '');
    check(wa.startsWith('https://wa.me/') && /upi:\/\/pay\?pa=e2e@okhdfcbank/.test(text) && /am=2540\.00/.test(text),
      `WhatsApp statement link carries a upi:// link for the net due (${text.replace(/\s+/g, ' ').slice(0, 90)}…)`);
    await row.getByRole('button', { name: 'Record money received from Acme Buyers' }).click();
    const dlg = page.getByRole('dialog', { name: /Received from Acme Buyers/ });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Amount (₹)', null, { timeout: 5000 });
    check(true, 'the amount field is focused when the sheet opens');
    await dlg.getByLabel('Amount (₹)', { exact: true }).fill('500');
    await dlg.getByRole('radio', { name: 'UPI' }).click();
    await dlg.getByLabel(/UTR/).fill('UPI-E2E-1');
    const firstBill = await dlg.getByLabel(/^Amount for INV/).first().inputValue();
    check(firstBill === '500', `the ₹500 is allocated to the oldest open bill first (${firstBill})`);
    await dlg.getByRole('button', { name: 'Save' }).click();
    await row.getByText('To collect ₹2,040.00').waitFor();
    const tx = (await readJson(page, 'transactions', [], (v) => v.some((t) => t.reference === 'UPI-E2E-1'))).filter((t) => t.reference === 'UPI-E2E-1');
    check(tx.length === 1 && tx[0].amount === 500 && tx[0].method === 'UPI' && tx[0].client_name === 'Acme Buyers' && !!tx[0].invoice_id,
      `₹ Received saved one UPI receipt against the bill, tagged with the party (${tx.length} row, ₹${tx[0]?.amount})`);
  });

  await step('R2-A: a receipt ₹10 short settles the rest as kasar — FCN financial credit note, bill Paid', async () => {
    // Later steps expect one open invoice: snapshot the tables this step writes and put them back afterwards.
    const keys = ['invoices', 'transactions', 'doc_links', 'series_counters', 'audit_log'].map((n) => `mrchartist_inv_${n}`);
    const before = await Promise.all(keys.map((k) => idbGet(page, k)));
    await page.goto(srv.origin + '/transactions');
    await page.getByRole('button', { name: /^Record payment for INV/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Record payment' });
    const amount = dlg.getByLabel('Amount', { exact: true });
    // The dialog pre-fills the balance after it opens: wait for it rather than reading an empty field.
    let due = 0;
    for (let i = 0; i < 50 && !(due > 10); i++) {
      due = Number(await amount.inputValue());
      if (!(due > 10)) await page.waitForTimeout(100);
    }
    check(due > 10, `the payment dialog pre-fills the balance (${due})`);
    await amount.fill(String(Math.round((due - 10) * 100) / 100));
    await dlg.locator('[data-settle-rest]').waitFor({ timeout: 15000 });
    await dlg.locator('[data-settle-choice="short_payment"]').check();
    check((await dlg.locator('[data-settle-amount]').inputValue()) === '10', 'Settle the rest pre-fills the ₹10 left open');
    await dlg.getByRole('button', { name: 'Record payment' }).click();
    const notes = await readJson(page, 'invoices', [], (v) => v.some((i) => i.note_kind === 'financial'));
    const fcn = notes.filter((i) => i.note_kind === 'financial');
    check(fcn.length === 1 && /^FCN\/FY\d{2}-\d{2}\/0001$/.test(fcn[0].invoice_number) && fcn[0].total === 10 && fcn[0].financial_reason === 'short_payment' && !fcn[0].tax_amount,
      `financial credit note ${fcn[0]?.invoice_number} for ₹${fcn[0]?.total}, no GST`);
    const bill = notes.find((i) => i.invoice_number === fcn[0]?.po_number);
    check(bill?.status === 'Paid', `the bill is settled (${bill?.status})`);
    await page.keyboard.press('Escape');
    for (let i = 0; i < keys.length; i++) await idbPut(page, keys[i], before[i]);
    await page.goto(srv.origin + '/transactions');
    await page.getByRole('button', { name: /^Record payment for INV/ }).first().waitFor();
  });

  await step('bulk mark paid, then delete with undo', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByLabel('Select INV/FY', { exact: false }).first().check();
    await page.getByText('1 selected').waitFor();
    await page.getByRole('button', { name: 'Mark paid' }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark paid' }).click();
    await page.getByText(/1 marked paid/).waitFor();
    const paid = (await readJson(page, 'invoices', [], (v) => v[0]?.status === 'Paid'))[0];
    check(paid.status === 'Paid' && paid.balance_due === 0, `bulk mark paid settles the invoice (${paid.status}, balance ${paid.balance_due})`);

    await page.getByRole('button', { name: /^Delete INV/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    // R4-C4: Alt+Z runs the latest Undo while its toast is shown.
    await page.getByRole('button', { name: 'Undo' }).waitFor();
    await page.keyboard.press('Alt+KeyZ');
    await page.waitForTimeout(6500);
    const after = (await readJson(page, 'invoices', [])).length;
    check(after === 1, `Undo keeps the deleted invoice (${after} stored after the undo window)`);
    await page.getByText('Acme Buyers').first().waitFor();
  });

  await step('raise a debit note from the invoice', async () => {
    const id = (await readJson(page, 'invoices', []))[0].id;
    await page.goto(srv.origin + '/invoice/' + id);
    await page.getByRole('button', { name: /^Convert/ }).click();
    await page.getByRole('menuitem', { name: 'Create debit note' }).click();
    const dlg = page.getByRole('dialog', { name: 'Create debit note' });
    await dlg.getByLabel('Reason *').fill('Rate revision');
    await dlg.getByLabel('Line 1 description').fill('Rate difference');
    await dlg.getByLabel('Line 1 rate').fill('200');
    await dlg.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/invoice/') && !u.pathname.endsWith(id));
    const dn = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.doc_type === 'DEBIT_NOTE'))).find((i) => i.doc_type === 'DEBIT_NOTE');
    check(!!dn && /^DBN\/FY\d{2}-\d{2}\/0001$/.test(dn.invoice_number) && Math.abs(dn.total - 236) < 0.01,
      `debit note ${dn?.invoice_number} for ${dn?.total} opens in the editor`);
    // Keep later steps about the original invoice simple.
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== dn.id));
  });

  await step('attach a receipt photo to an expense; it is still there after a reload', async () => {
    await page.goto(srv.origin + '/expenses');
    await page.getByRole('button', { name: /Quick expense/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Quick add expense' });
    await dlg.locator('#exp-amt').fill('1200');
    await dlg.getByLabel(/attach a photo or PDF/).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from(LOGO_PNG, 'base64') });
    await dlg.locator('li img[src^="data:image/"]').first().waitFor();
    await dlg.getByRole('button', { name: 'Add expense' }).click();
    await dlg.waitFor({ state: 'detached' });
    const rows = await readJson(page, 'purchases', [], (v) => v.some((p) => p.attachments?.length === 1));
    const ref = rows.find((p) => p.attachments?.length)?.attachments?.[0];
    const stored = ref ? await idbGet(page, `mrchartist_inv_att_${ref.id}`) : null;
    check(!!ref && ref.mime.startsWith('image/') && typeof stored === 'string' && JSON.parse(stored).data.startsWith('data:image/'),
      `expense references the receipt, stored once in IndexedDB (${ref?.name}, ${ref?.size} bytes)`);
    await page.reload();
    await page.getByRole('button', { name: /^Edit Rent/ }).first().click();
    const edit = page.getByRole('dialog', { name: 'Edit expense' });
    await edit.locator('li img[src^="data:image/"]').first().waitFor();
    check(await edit.getByText(ref?.name ?? 'receipt').count() > 0, 'after a reload the expense still shows its receipt');
    await page.keyboard.press('Escape');
    await edit.waitFor({ state: 'detached' });
  });

  await step('8I: Scan bill in the Expenses header opens the capture chooser; GST filing steps, grouped tabs and the JSON check', async () => {
    await page.goto(srv.origin + '/expenses');
    await page.getByTestId('scan-bill').click();
    const chooser = page.getByRole('dialog', { name: 'Scan a supplier bill' });
    await chooser.waitFor();
    check(await chooser.getByRole('button', { name: 'Choose a photo or PDF' }).isVisible() && await chooser.getByRole('button', { name: 'Take a photo of the bill' }).isVisible(),
      'Scan bill opens the chooser (photo / file; camera QR where BarcodeDetector exists)');
    await page.keyboard.press('Escape');
    await chooser.waitFor({ state: 'detached' });

    // An old deep link still lands on its tab inside the grouped tab strip.
    await page.goto(srv.origin + '/gst-reports?tab=setoff');
    await page.locator('[data-filing-strip]').waitFor();
    const setoff = page.getByRole('tab', { name: /Set-off/ });
    check((await setoff.getAttribute('aria-selected')) === 'true', '?tab=setoff still opens Set-off & payment');
    check(await page.locator('[data-tab-group]').count() === 4, 'tabs grouped into GSTR-1 / GSTR-3B / Reconcile / Tools');
    await setoff.focus();
    await page.keyboard.press('ArrowRight');
    check((await page.getByRole('tab', { name: /Cash ledger/ }).getAttribute('aria-selected')) === 'true', 'arrow key moves to the next tab');
    await page.locator('[data-filing-check]').click();
    const pf = page.getByRole('dialog', { name: 'Check before filing' });
    await pf.waitFor();
    check(await pf.getByText(/verify with your CA/).count() > 0, 'the check keeps the "verify with your CA" wording');
    await page.keyboard.press('Escape');
    await pf.waitFor({ state: 'detached' });
    const json = page.locator('[data-gstr1-json]');
    if ((await page.locator('[data-gstr1-json] [data-json-badge]').count()) > 0 && await json.isEnabled()) {
      await json.click();
      const dl = page.getByRole('dialog', { name: 'Check before you download GSTR-1 JSON' });
      await dl.waitFor();
      check(await dl.getByRole('button', { name: 'Download anyway' }).isVisible(), 'GSTR-1 JSON with problems stops at the check first');
      await page.keyboard.press('Escape');
      await dl.waitFor({ state: 'detached' });
    }
  });

  await step('TDS on payables: a 194J bill with TDS, payment of the net amount, the deduction in Form 26Q', async () => {
    await page.goto(srv.origin + '/expenses');
    await page.getByRole('button', { name: /Add bill/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Add purchase bill' });
    await dlg.getByRole('button', { name: /New vendor/ }).click();
    await dlg.locator('#bill-vendor-vname').fill('Rao Associates');
    await dlg.getByRole('button', { name: 'Save vendor' }).click();
    await dlg.locator('#bill-no').fill('RA/1');
    await dlg.getByLabel('Line 1 item').fill('Audit fee');
    await dlg.getByLabel('Line 1 rate').fill('100000');
    await dlg.getByText('TDS deducted by you').click();
    await dlg.getByLabel('TDS section').selectOption('194J');
    await dlg.getByLabel('Supplier PAN').fill('ABCPK1234F');
    await dlg.getByText(/Suggested: 10% on/).waitFor();
    await dlg.getByRole('button', { name: 'Save bill' }).click();
    await dlg.waitFor({ state: 'detached' });
    const bills = await readJson(page, 'purchases', [], (v) => v.some((p) => p.bill_number === 'RA/1'));
    const b = bills.find((p) => p.bill_number === 'RA/1');
    check(!!b && b.tds_section === '194J' && b.tds_amount === 10000 && b.tds_on === 'BILL' && b.total === 118000,
      `194J bill stores TDS ${b?.tds_amount} on ${b?.tds_base} (deduct on bill)`);
    await page.getByRole('button', { name: 'Payments for Rao Associates RA/1' }).click();
    const pay = page.getByRole('dialog', { name: 'Record payment' });
    check(await pay.locator('#pp-amt').inputValue() === '108000', 'payment dialog offers the net amount (total − TDS)');
    await pay.getByRole('button', { name: 'Record payment' }).click();
    await pay.waitFor({ state: 'detached' });
    const pays = await readJson(page, 'purchase_payments', [], (v) => v.some((p) => p.purchase_id === b.id));
    check(pays.find((p) => p.purchase_id === b.id)?.amount === 108000, 'supplier paid the net amount; the bill is settled');
    await page.goto(srv.origin + '/tds?tab=returns');
    const row = page.locator('[data-form-row="26Q"]').filter({ hasText: 'ABCPK1234F' });
    await row.first().waitFor();
    check((await row.first().innerText()).includes('4JB') && (await row.first().innerText()).includes('10000.00'), 'Form 26Q working paper lists the 194J deduction');
  });

  await step('double-entry books: journal voucher, trial balance, balance sheet, cash flow', async () => {
    await page.goto(srv.origin + '/books?tab=vch');
    await page.getByRole('button', { name: 'New voucher' }).click();
    const dlg = page.getByRole('dialog', { name: 'New voucher' });
    await dlg.getByLabel('Line 1 account').selectOption('bank');
    await dlg.getByLabel('Line 1 debit').fill('50000');
    await dlg.getByLabel('Line 2 account').selectOption('capital');
    await dlg.getByLabel('Line 2 credit').fill('50000');
    await dlg.getByText('Balanced').waitFor();
    await dlg.getByRole('button', { name: 'Save voucher' }).click();
    await dlg.waitFor({ state: 'detached' });
    const vouchers = await readJson(page, 'vouchers', [], (v) => v.length === 1);
    check(vouchers.length === 1 && /^JV\/FY\d{2}-\d{2}\/0001$/.test(vouchers[0].number) && vouchers[0].lines[0].dr === 5000000,
      `journal voucher stored in paise with an FY number (${vouchers[0]?.number})`);
    await page.getByRole('tab', { name: 'Trial balance' }).click();
    await page.getByText('Debits = credits').waitFor();
    check(true, 'trial balance agrees');
    await page.getByRole('tab', { name: 'Balance sheet' }).click();
    await page.getByText('Assets = liabilities + equity').waitFor();
    check(true, 'Schedule III balance sheet ties');
    await page.getByRole('tab', { name: 'Cash flow' }).click();
    await page.getByText('Reconciles to cash & bank').waitFor();
    check(true, 'cash-flow statement reconciles');
    await page.getByRole('tab', { name: 'Trial balance' }).click();
    // The group row and the ledger row are both called "Capital account": the ledger is the second.
    await page.getByRole('button', { name: 'Capital account', exact: true }).last().click();
    await page.getByText('Ledger Monthly Summary: Capital account').first().waitFor();
    await page.getByRole('button', { name: 'All vouchers' }).click();
    check(await page.getByText(/JV\/FY\d{2}-\d{2}\/0001/).first().isVisible(), 'drill-down opens the capital ledger with the voucher');
  });

  await step('reports engine: a journal shows in Day Book, P&L and TB; BS drills to the voucher; Esc goes back', async () => {
    await page.goto(srv.origin + '/books?tab=vch');
    await page.getByRole('button', { name: 'New voucher' }).click();
    const dlg = page.getByRole('dialog', { name: 'New voucher' });
    await dlg.getByLabel('Line 1 account').selectOption('rent');
    await dlg.getByLabel('Line 1 debit').fill('1234');
    await dlg.getByLabel('Line 2 account').selectOption('bank');
    await dlg.getByLabel('Line 2 credit').fill('1234');
    await dlg.getByText('Balanced').waitFor();
    await dlg.getByRole('button', { name: 'Save voucher' }).click();
    await dlg.waitFor({ state: 'detached' });
    const jv2 = /JV\/FY\d{2}-\d{2}\/0002/;
    await page.getByRole('tab', { name: 'Day book' }).click();
    await page.getByRole('button', { name: jv2 }).first().waitFor();
    check(true, 'the manual journal is in the ledger Day Book');
    await page.getByRole('tab', { name: 'Profit & loss' }).click();
    await page.getByRole('button', { name: 'Other (indirect) expenses' }).first().click();
    await page.getByText('Group Summary: Other (indirect) expenses').first().waitFor();
    await page.getByRole('button', { name: 'Rent', exact: true }).first().waitFor();
    check(true, 'P&L → group drill shows the Rent ledger from the journal');
    await page.keyboard.press('Escape');
    await page.getByText('Trading account').first().waitFor();
    check(true, 'Esc goes back to the Trading / P&L account');
    await page.getByRole('tab', { name: 'Trial balance' }).click();
    await page.getByText('Debits = credits').waitFor();
    await page.getByRole('button', { name: 'Rent', exact: true }).first().waitFor();
    check(true, 'the journal is in the trial balance');
    await page.getByRole('tab', { name: 'Balance sheet' }).click();
    await page.getByText('Assets = liabilities + equity').waitFor();
    await page.getByRole('button', { name: 'Cash & cash equivalents' }).click();
    await page.getByText('Group Summary: Cash & bank').first().waitFor();
    await page.getByRole('button', { name: 'Bank account', exact: true }).first().click();
    await page.getByText('Ledger Monthly Summary: Bank account').first().waitFor();
    await page.getByRole('button', { name: 'All vouchers' }).click();
    await page.getByRole('button', { name: jv2 }).first().click();
    const edit = page.getByRole('dialog', { name: /Edit voucher/ });
    await edit.waitFor();
    check(true, 'BS → group → ledger → vouchers → voucher opens the voucher editor');
    await page.keyboard.press('Escape');
    await edit.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape');
    await page.getByText('Ledger Monthly Summary: Bank account').first().waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByText('Assets = liabilities + equity').waitFor();
    check(await page.getByRole('navigation', { name: 'Drill-down path' }).count() === 0, 'Esc walks back level by level to the balance sheet');
  });

  await step('Gateway of Tally: V → F5 payment voucher, Ctrl+A saves, Day Book drills into it, Esc back', async () => {
    await page.goto(srv.origin + '/gateway');
    await page.getByRole('heading', { name: 'Gateway of Tally' }).waitFor();
    await page.getByTestId('gw-create').waitFor();
    await page.keyboard.press('v');
    await page.getByTestId('gw-v-payment').waitFor();
    await page.keyboard.press('F5');
    await page.getByRole('heading', { name: 'Payment voucher' }).waitFor();
    await page.getByTestId('vline-1-ledger').fill('Rent');
    await page.keyboard.press('Enter');
    await page.getByTestId('vline-1-amount').fill('1500');
    await page.keyboard.press('Enter');
    // Line 2 opens on the credit side with the difference pre-filled.
    await page.getByTestId('vline-2-ledger').fill('Bank account');
    await page.keyboard.press('Enter');
    check((await page.getByTestId('vline-2-amount').inputValue()) === '1500.00', 'second line pre-filled with the balancing amount');
    await page.keyboard.press('Enter');
    await page.getByText('Balanced', { exact: true }).waitFor();
    await page.keyboard.type('Office rent');
    await page.keyboard.press('Control+a');
    const vouchers = await readJson(page, 'vouchers', [], (v) => v.some((x) => x.type === 'PAYMENT'));
    const pv = vouchers.find((x) => x.type === 'PAYMENT');
    check(!!pv && /^PV\/FY\d{2}-\d{2}\/0001$/.test(pv.number) && pv.lines[0].account_id === 'rent' && pv.lines[0].dr === 150000 && pv.lines[1].account_id === 'bank',
      `Ctrl+A saved the payment voucher Dr Rent / Cr Bank (${pv?.number})`);
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/gateway');
    await page.getByTestId('gw-create').waitFor();
    await page.keyboard.press('d');
    await page.getByRole('heading', { name: 'Day book' }).waitFor();
    const row = page.getByRole('row', { name: new RegExp(pv.number.replace(/\//g, '\\/')) });
    await row.click();
    await page.getByRole('heading', { name: `Alter Payment voucher ${pv.number}` }).waitFor();
    check(true, 'Day Book shows the voucher and Enter/click drills into it');
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: 'Day book' }).waitFor();
    check(true, 'Esc returns to the Day Book');
  });

  await step('branch-wise books: a voucher tagged to a branch; Books TB, Gateway TB and Transactions filter by branch (P1-19)', async () => {
    // No state / GSTIN / profile: nothing is inferred to it, so only the tagged voucher belongs to the branch.
    await writeJson(page, 'branches', [{ id: 'br-e2e', name: 'Pune branch', code: 'PUN' }]);
    await page.goto(srv.origin + '/books?tab=vch');
    await page.getByRole('button', { name: 'New voucher' }).click();
    const dlg = page.getByRole('dialog', { name: 'New voucher' });
    await dlg.getByLabel('Branch / location').selectOption('br-e2e');
    await dlg.getByLabel('Line 1 account').selectOption('rent');
    await dlg.getByLabel('Line 1 debit').fill('777');
    await dlg.getByLabel('Line 2 account').selectOption('bank');
    await dlg.getByLabel('Line 2 credit').fill('777');
    await dlg.getByText('Balanced').waitFor();
    await dlg.getByRole('button', { name: 'Save voucher' }).click();
    await dlg.waitFor({ state: 'detached' });
    const tagged = await readJson(page, 'vouchers', [], (v) => v.some((x) => x.branch_id === 'br-e2e'));
    check(tagged.some((x) => x.branch_id === 'br-e2e' && x.lines[0].dr === 77700), 'the voucher is saved with its branch');
    await page.getByRole('tab', { name: 'Trial balance' }).click();
    await page.getByText('Debits = credits').waitFor();
    await page.getByTestId('books-branch').selectOption('br-e2e');
    await page.getByText('Branch view:', { exact: false }).first().waitFor();
    await page.getByText('Debits = credits').waitFor();
    const rentRow = page.getByRole('row', { name: /Rent/ }).first();
    const rentText = await rentRow.innerText();
    check(/777\.00/.test(rentText) && !/1,234|2,734|1,500/.test(rentText), `Books trial balance for the branch shows only its ₹777 rent (${rentText.replace(/\s+/g, ' ')})`);
    await page.goto(srv.origin + '/gateway/display?r=tb&b=br-e2e');
    await page.getByRole('heading', { name: 'Trial balance' }).waitFor();
    check((await page.getByTestId('gw-branch').inputValue()) === 'br-e2e', 'the Gateway trial balance keeps the branch from the URL');
    await page.getByTestId('gw-row-g-INDIRECT_EXPENSES').waitFor();
    const gwText = await page.getByTestId('gw-row-g-INDIRECT_EXPENSES').innerText();
    check(/777\.00/.test(gwText), `Gateway branch TB: indirect expenses = the branch voucher (${gwText.replace(/\s+/g, ' ')})`);
    await page.goto(srv.origin + '/transactions');
    await page.getByTestId('tx-branch').waitFor();
    await page.locator('tbody tr').first().waitFor();
    const before = await page.locator('tbody tr').count();
    await page.getByTestId('tx-branch').selectOption('br-e2e');
    await page.waitForTimeout(300);
    const after = await page.locator('tbody tr').count();
    check(before > 0 && after < before, `Transactions filtered to a branch with no documents (${before} → ${after} rows)`);
    await writeJson(page, 'branches', []);
  });

  await step('integration: the Gateway reaches Accounts Info, banking documents, ratio analysis and the year-end wizard', async () => {
    const gateway = async () => {
      await page.goto(srv.origin + '/gateway');
      await page.getByTestId('gw-create').waitFor();
    };
    await gateway();
    await page.keyboard.press('o');
    await page.getByText('Groups, ledgers and opening balances', { exact: false }).first().waitFor();
    check(/\/books\?tab=coa&m=menu/.test(page.url()), 'O opens Accounts Info (WP-1 masters menu)');
    await gateway();
    await page.keyboard.press('n');
    await page.getByTestId('gw-b-deposit').waitFor();
    await page.keyboard.press('d');
    await page.waitForURL(/\/reconcile\?tab=documents&doc=deposit/);
    await page.getByText('Deposit slip').first().waitFor();
    check(true, 'Banking → D opens the deposit slip (WP-5)');
    await gateway();
    await page.keyboard.press('m');
    await page.getByTestId('gw-m-ratio').waitFor();
    await page.keyboard.press('o');
    await page.getByRole('tab', { name: 'Ratio analysis', selected: true }).waitFor();
    check(true, 'Display more reports → O opens Ratio analysis');
    await gateway();
    await page.keyboard.press('y');
    const wizard = page.getByRole('dialog', { name: /Start new year/ });
    await wizard.waitFor();
    await wizard.getByText('Closing stock', { exact: false }).first().waitFor();
    check(true, 'Y opens the year-end wizard (WP-7) from the Gateway');
    await page.keyboard.press('Escape');
    await wizard.waitFor({ state: 'hidden' });
    // Phone width: the Tally-parity screens must not scroll the page sideways (tables scroll inside their wrapper).
    await page.setViewportSize({ width: 360, height: 780 });
    try {
      for (const path of ['/gateway', '/books?tab=coa&m=menu', '/reconcile?tab=documents&doc=deposit', '/books?tab=ratio', '/expenses?tab=returns', '/tds', '/gst-reports?tab=setoff', '/manufacturing']) {
        await page.goto(srv.origin + path);
        await page.locator('h1').first().waitFor();
        await page.waitForTimeout(300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(over <= 1, `${path}: no horizontal page scroll at 360 px (${over} px over)`);
      }
    } finally {
      await page.setViewportSize({ width: 1280, height: 900 });
    }
  });

  await step('masters: sub-group under Sundry Debtors, party with a ₹10,000 Dr opening bill, seen in ageing and the trial balance', async () => {
    await page.goto(srv.origin + '/books?tab=coa&m=group-create');
    const gform = page.getByRole('region', { name: 'Group Creation' });
    await gform.getByLabel('Name', { exact: true }).fill('Debtors – Mumbai');
    await gform.getByLabel('Under', { exact: true }).selectOption('TRADE_RECEIVABLES');
    await gform.getByLabel('Name', { exact: true }).press('Control+a'); // Tally: Ctrl+A accepts
    const groups = await readJson(page, 'groups', [], (v) => v.length === 1);
    check(groups.length === 1 && groups[0].parent === 'TRADE_RECEIVABLES', 'group created under Sundry Debtors with Ctrl+A');

    await page.goto(srv.origin + '/books?tab=coa&m=ledger-create');
    const lform = page.getByRole('region', { name: 'Ledger Creation' });
    await lform.getByLabel('Name', { exact: true }).fill('Mumbai Mart');
    await lform.getByLabel('Under', { exact: true }).selectOption(groups[0].id);
    await lform.getByLabel(/^Opening balance \(on/).first().fill('10000');
    await lform.getByRole('button', { name: 'Accept (Ctrl+A)' }).click();
    const bw = page.getByRole('region', { name: 'Bill-wise details for: Mumbai Mart' });
    await bw.waitFor();
    // A bill dated before the books begin (1 April of the current FY by default).
    const now = new Date();
    const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    await bw.getByLabel('Bill 1 reference').fill('OB/1');
    await bw.getByLabel('Bill 1 date', { exact: true }).fill(`${fyStartYear}-02-01`);
    await bw.getByLabel('Bill 1 due date').fill(`${fyStartYear}-03-03`);
    await bw.getByRole('button', { name: 'Accept (Ctrl+A)' }).click();
    const bills = await readJson(page, 'opening_bills', [], (v) => v.length === 1);
    const clients = await readJson(page, 'clients', [], (v) => v.some((c) => c.name === 'Mumbai Mart'));
    const party = clients.find((c) => c.name === 'Mumbai Mart');
    check(party?.group_id === groups[0].id, 'the party is a client placed in the sub-group');
    check(bills.length === 1 && bills[0].amount === 10000 && bills[0].dr_cr === 'Dr' && bills[0].party_id === party?.id, 'opening bill stored (₹10,000 Dr)');
    const openings = await readJson(page, 'ledger_openings', [], (v) => v.length === 1);
    check(openings[0]?.dr === 1000000, 'ledger opening stored in paise');

    await page.goto(srv.origin + '/receivables');
    await page.getByText('Mumbai Mart').first().waitFor();
    check(await page.getByText(/90\+ days|61–90 days|31–60 days|1–30 days/).first().isVisible(), 'receivables ageing shows the overdue opening bill');

    await page.goto(srv.origin + '/books?tab=tb');
    await page.getByText('Debits = credits').waitFor();
    check(await page.getByRole('button', { name: 'Opening balance difference' }).first().isVisible(), 'trial balance carries the difference in opening balances, still balanced');
  });

  await step('sales order converts its pending quantity; purchase orders tab opens', async () => {
    const rows = await readJson(page, 'invoices', [], (v) => v.length > 0);
    const so = {
      ...rows[0],
      id: 'e2e-so',
      doc_type: 'SALES_ORDER',
      invoice_number: 'SO/FY26-27/0001',
      status: 'Sent',
      amount_paid: 0,
      items: rows[0].items.map((i) => ({ ...i, id: 'e2e-so-line', quantity: 3 })),
    };
    await writeJson(page, 'invoices', [...rows, so]);
    const soId = so.id;
    await page.goto(srv.origin + '/invoice/' + soId);
    await page.getByRole('region', { name: 'Order fulfilment' }).getByText('Open', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Convert/ }).click();
    await page.getByRole('menuitem', { name: /Convert to Delivery Challan/ }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/invoice/') && !u.pathname.endsWith(soId));
    const dc = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.doc_type === 'DELIVERY_CHALLAN'))).find((i) => i.doc_type === 'DELIVERY_CHALLAN');
    check(dc?.sales_order_id === soId && dc.items.length === 1 && dc.items[0].quantity === 3 && dc.items[0].order_line_id === 'e2e-so-line',
      `challan ${dc?.invoice_number} carries the order's pending quantity (${dc?.items?.[0]?.quantity})`);
    await page.goto(srv.origin + '/transactions?type=SALES_ORDER');
    await page.locator('td').getByText('Partly fulfilled').first().waitFor();
    check(true, 'the order list shows the sales order as Partly fulfilled');
    await page.goto(srv.origin + '/expenses?tab=orders');
    await page.getByText('No purchase orders yet').waitFor();
    check(true, 'Expenses → Purchase orders tab loads');
    const ids = [soId, dc?.id];
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => !ids.includes(i.id)));
    await writeJson(page, 'doc_links', []);
  });

  await step('batch item bought with an expiry is sold FEFO; serial lookup finds the bill', async () => {
    const before = await readJson(page, 'invoices', [], (v) => v.length > 0);
    // Earlier steps own rows in these tables (e.g. a bill with an attachment): keep them and put them back.
    const prevPurchases = await readJson(page, 'purchases', null);
    const prevStock = await readJson(page, 'stock_items', null);
    const item = (id, name, extra) => ({ id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra });
    await writeJson(page, 'stock_items', [
      item('e2e-syr', 'Cough Syrup', { hsn: '3004', track_batches: true }),
      item('e2e-ph', 'Phone X', { hsn: '8517', track_serials: true, warranty_months: 12 }),
    ]);
    const line = (id, name, hsn, quantity, extra) => ({ id, name, hsn, quantity, rate: 50, tax_rate: 12, ...extra });
    await writeJson(page, 'purchases', [...(prevPurchases ?? []), {
      id: 'e2e-bill', kind: 'PURCHASE', vendor_name: 'E2E Pharma', bill_number: 'EP/77', date: '2026-04-02', category: 'Purchases',
      lines: [
        line('b1', 'Cough Syrup', '3004', 10, { batch_no: 'LATE', expiry_date: '2030-12-31' }),
        line('b2', 'Cough Syrup', '3004', 5, { batch_no: 'SOON', expiry_date: '2029-06-30' }),
        line('b3', 'Phone X', '8517', 2, { serials: ['IMEI-E2E-1', 'IMEI-E2E-2'] }),
      ],
      taxable: 850, cgst: 51, sgst: 51, igst: 0, itc_eligible: true, total: 952, amount_paid: 0,
    }]);
    await page.goto(srv.origin + '/invoice');
    await page.getByLabel('Client name').fill('Ravi Medicals');
    await page.getByLabel('Item 1 name').fill('Cough Syrup');
    await page.getByLabel('Item 1 HSN or SAC').fill('3004');
    await page.getByLabel('Item 1 quantity').fill('2');
    await page.getByLabel('Item 1 rate').fill('80');
    const batch = page.getByLabel('Item 1 batch');
    await page.waitForFunction(() => document.querySelector('[aria-label="Item 1 batch"]')?.value === 'SOON', null, { timeout: 5000 }).catch(() => {});
    check((await batch.inputValue()) === 'SOON', `the batch that expires first is pre-selected (${await batch.inputValue()})`);
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
    const sold = (await readJson(page, 'invoices', [], (v) => v.length > before.length)).find((i) => i.client?.name === 'Ravi Medicals');
    check(sold?.items?.[0]?.batch_no === 'SOON' && sold.items[0].batch_expiry === '2029-06-30',
      `the invoice line carries the FEFO batch (${sold?.items?.[0]?.batch_no}, exp ${sold?.items?.[0]?.batch_expiry})`);

    await page.goto(srv.origin + '/inventory?tab=serials');
    await page.getByLabel('Serial / IMEI number').fill('imei-e2e-2');
    const card = page.getByRole('article', { name: 'Serial IMEI-E2E-2' });
    await card.waitFor();
    const text = await card.innerText();
    check(/EP\/77/.test(text) && /E2E Pharma/.test(text) && /In stock/.test(text), 'serial lookup shows the purchase bill, vendor and stock state');

    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== sold?.id));
    await writeJson(page, 'stock_items', prevStock);
    await writeJson(page, 'purchases', prevPurchases);
  });

  await step('manufacturing: BOM, then manufacture 2 units; finished stock +2, components reduced', async () => {
    const prevStock = await readJson(page, 'stock_items', null);
    const item = (id, name, extra) => ({ id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra });
    await writeJson(page, 'stock_items', [
      item('e2e-leg', 'E2E Leg', { opening_qty: 20, opening_rate: 30 }),
      item('e2e-top', 'E2E Top', { opening_qty: 5, opening_rate: 200 }),
      item('e2e-table', 'E2E Table'),
    ]);
    await page.goto(srv.origin + '/manufacturing?tab=boms');
    await page.getByRole('button', { name: 'New BOM' }).click();
    await page.getByLabel('Finished item').selectOption({ label: 'E2E Table' });
    await page.getByLabel('Component Line 1 item').selectOption({ label: 'E2E Leg (NOS)' });
    await page.getByLabel('Component Line 1 quantity').fill('4');
    await page.getByLabel('Component Line 1 quantity').press('Enter');
    await page.getByLabel('Component Line 2 item').selectOption({ label: 'E2E Top (NOS)' });
    await page.getByLabel('Component Line 2 quantity').fill('1');
    await page.keyboard.press('Control+Enter');
    await page.getByText('BOM "Standard" saved').waitFor();
    // The app commits to IndexedDB a moment later: wait for it before reloading the page.
    await readJson(page, 'boms', [], (v) => v.length === 1);

    await page.goto(srv.origin + '/manufacturing?tab=mfg');
    await page.getByRole('button', { name: 'New manufacturing journal' }).click();
    await page.getByLabel('Finished item').selectOption({ label: 'E2E Table' });
    const qty = page.getByLabel(/Quantity to manufacture/);
    await qty.fill('2');
    await qty.blur();
    check((await page.getByLabel('Component Line 1 quantity').inputValue()) === '8', 'components are filled from the default BOM for 2 units');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/MFG\/FY\d\d-\d\d\/0001 saved/).waitFor();
    const vouchers = await readJson(page, 'manufacturing_vouchers', [], (v) => v.length > 0);
    // 8 legs × ₹30 + 2 tops × ₹200 = ₹640.
    check(vouchers.length === 1 && vouchers[0].qty === 2 && vouchers[0].cost_snapshot?.finished === 640,
      `the manufacturing journal is saved with its cost (${vouchers[0]?.cost_snapshot?.finished})`);

    await page.goto(srv.origin + '/manufacturing?tab=reports');
    const row = (name) => page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
    await row('E2E Table').waitFor();
    check(/\b2 NOS\b/.test(await row('E2E Table').innerText()), 'stock summary: finished goods +2');
    check(/\b12 NOS\b/.test(await row('E2E Leg').innerText()) && /\b3 NOS\b/.test(await row('E2E Top').innerText()), 'stock summary: components reduced (legs 20 → 12, tops 5 → 3)');

    await writeJson(page, 'manufacturing_vouchers', null);
    await writeJson(page, 'boms', null);
    await writeJson(page, 'stock_items', prevStock);
  });

  await step('job work: Material Out to a job worker (still our stock), Material In processed; ITC-04 lists the challan', async () => {
    const prevStock = await readJson(page, 'stock_items', null);
    const prevGodowns = await readJson(page, 'godowns', null);
    const item = (id, name, extra) => ({ id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra });
    await writeJson(page, 'stock_items', [item('e2e-rod', 'E2E Rod', { unit: 'KG', opening_qty: 100, opening_rate: 50 }), item('e2e-shaft', 'E2E Shaft')]);
    await page.goto(srv.origin + '/manufacturing?tab=jobwork&jw=out');
    await page.getByRole('button', { name: 'New Material Out (challan)' }).click();
    await page.getByLabel('Job worker', { exact: true }).fill('E2E Acme');
    await page.getByLabel('Send line 1 item').selectOption({ label: 'E2E Rod (KG)' });
    await page.getByLabel('Send line 1 quantity').fill('40');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/Saved JWC\/FY\d\d-\d\d\/0001/).waitFor();
    const outs = await readJson(page, 'job_work_out', [], (v) => v.length === 1);
    const godowns = await readJson(page, 'godowns', [], (v) => v.some((g) => g.job_worker));
    check(outs[0]?.job_worker_godown === godowns.find((g) => g.job_worker)?.id, "the challan sends the goods to the job worker's own godown");

    await page.getByRole('tab', { name: 'Material in' }).click();
    await page.getByRole('button', { name: 'New Material In' }).click();
    await page.getByLabel('Goods received back line 1 item').selectOption({ label: 'E2E Shaft (NOS)' });
    await page.getByLabel('Goods received back line 1 quantity').fill('10');
    await page.getByLabel('Inputs consumed at the job worker line 1 item').selectOption({ label: 'E2E Rod (KG)' });
    await page.getByLabel('Inputs consumed at the job worker line 1 quantity').fill('30');
    await page.getByLabel('Job work charges (₹, ex-GST)').fill('500');
    await page.getByText(/Processed goods cost/).waitFor();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/Saved JWR\/FY\d\d-\d\d\/0001/).waitFor();
    await readJson(page, 'job_work_in', [], (v) => v.length === 1);

    await page.goto(srv.origin + '/manufacturing?tab=reports');
    const row = (name) => page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
    await row('E2E Rod').waitFor();
    check(/\b70 KG\b/.test(await row('E2E Rod').innerText()), 'stock summary: rod 100 → 70 KG (10 KG still with the job worker counts as ours)');
    check(/\b10 NOS\b/.test(await row('E2E Shaft').innerText()), 'stock summary: 10 processed shafts received');

    await page.goto(srv.origin + '/manufacturing?tab=jobwork&jw=itc04');
    await page.getByText('Table 4 — goods sent to job workers').waitFor();
    check((await page.getByRole('row').filter({ hasText: /JWC\/FY\d\d-\d\d\/0001/ }).count()) >= 1, 'ITC-04 Table 4 lists the challan');
    check(await page.getByText(/verify with your CA/i).first().isVisible(), 'ITC-04 carries the verify-with-your-CA wording');

    for (const t of ['job_work_out', 'job_work_in']) await writeJson(page, t, null);
    await writeJson(page, 'godowns', prevGodowns);
    await writeJson(page, 'stock_items', prevStock);
  });

  await step('production plan (7S): 2 tables → MRP buys the missing legs, saves the plan, raises the PO, Manufacture opens a filled journal', async () => {
    const prev = { stock: await readJson(page, 'stock_items', null), boms: await readJson(page, 'boms', null), vendors: await readJson(page, 'vendors', null), pos: await readJson(page, 'purchase_orders', null) };
    const item = (id, name, extra) => ({ id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra });
    await writeJson(page, 'stock_items', [
      item('e2e-leg', 'E2E Leg', { opening_qty: 3, opening_rate: 30 }),
      item('e2e-top', 'E2E Top', { opening_qty: 5, opening_rate: 200 }),
      item('e2e-table', 'E2E Table'),
    ]);
    await writeJson(page, 'boms', [{ id: 'e2e-bom', item_id: 'e2e-table', name: 'Standard', batch_qty: 1, is_default: true, components: [{ id: 'c1', item_id: 'e2e-leg', qty: 4 }, { id: 'c2', item_id: 'e2e-top', qty: 1 }] }]);
    await writeJson(page, 'vendors', [...(prev.vendors ?? []), { id: 'e2e-v', name: 'E2E Timber' }]);
    await page.goto(srv.origin + '/manufacturing?tab=plan');
    await page.getByLabel('Finished item 1').selectOption({ label: 'E2E Table ★' });
    await page.getByLabel('Quantity 1').fill('2');
    const table = page.getByTestId('mrp-table');
    const mrpRow = (name) => table.getByRole('row').filter({ hasText: name });
    await mrpRow('E2E Leg').waitFor();
    check(/Buy/.test(await mrpRow('E2E Leg').innerText()) && /\b5\b/.test(await mrpRow('E2E Leg').innerText()), 'MRP: 8 legs needed, 3 in stock → buy 5');
    check(/Covered/.test(await mrpRow('E2E Top').innerText()), 'MRP: tops are covered by stock');
    await page.getByTestId('mrp-save').click();
    await page.getByText(/Plan PP\/FY\d\d-\d\d\/0001 saved/).waitFor();
    await readJson(page, 'production_plans', [], (v) => v.length === 1);
    await page.getByLabel('Vendor', { exact: true }).selectOption({ label: 'E2E Timber' });
    await page.getByTestId('mrp-po').click();
    await page.getByText(/Purchase order PO\/FY\d\d-\d\d\/\d+ created/).waitFor();
    const pos = await readJson(page, 'purchase_orders', [], (v) => v.some((p) => p.vendor_name === 'E2E Timber'));
    const po = pos.find((p) => p.vendor_name === 'E2E Timber');
    check(po?.lines?.length === 1 && po.lines[0].item_id === 'e2e-leg' && po.lines[0].quantity === 5, 'the PO orders 5 legs');
    await mrpRow('E2E Table').getByRole('link', { name: 'Manufacture' }).click();
    await page.getByLabel('Component Line 1 quantity').waitFor();
    check((await page.getByLabel('Component Line 1 quantity').inputValue()) === '8', 'Manufacture opens a journal for 2 tables, components filled from the BOM');
    await page.keyboard.press('Escape');

    await writeJson(page, 'production_plans', null);
    await writeJson(page, 'purchase_orders', prev.pos);
    await writeJson(page, 'vendors', prev.vendors);
    await writeJson(page, 'boms', prev.boms);
    await writeJson(page, 'stock_items', prev.stock);
  });

  await step('R4-A: production order from a sales order → issue → partial output → close with write-off → variance report', async () => {
    const keys = ['stock_items', 'boms', 'invoices', 'godowns', 'stock_transfers', 'manufacturing_vouchers', 'stock_journals', 'production_orders', 'series_counters'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const item = (id, name, extra) => ({ id, name, unit: 'NOS', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, ...extra });
    await writeJson(page, 'stock_items', [
      item('e2e-leg', 'E2E Leg', { opening_qty: 20, opening_rate: 30 }),
      item('e2e-top', 'E2E Top', { opening_qty: 5, opening_rate: 200 }),
      item('e2e-table', 'E2E Table'),
    ]);
    await writeJson(page, 'boms', [{ id: 'e2e-bom', item_id: 'e2e-table', name: 'Standard', batch_qty: 1, is_default: true, components: [{ id: 'c1', item_id: 'e2e-leg', qty: 4 }, { id: 'c2', item_id: 'e2e-top', qty: 1 }] }]);
    const so = {
      id: 'e2e-wo-so', invoice_number: 'SO/FY26-27/0099', doc_type: 'SALES_ORDER', status: 'Sent', issue_date: '2026-04-01', due_date: '2026-04-30',
      client: { name: 'E2E Furniture Buyer' }, items: [{ id: 'e2e-wo-line', name: 'E2E Table', quantity: 2, rate: 1500, amount: 3000 }],
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), so]);
    await page.goto(srv.origin + '/manufacturing?tab=orders');
    await page.getByRole('button', { name: 'Make to order' }).click();
    await page.locator('#mto-so').selectOption('e2e-wo-so');
    await page.getByTestId('mto-create').click();
    await page.getByText(/1 production order\(s\) created for SO\/FY26-27\/0099/).waitFor();
    const detail = page.getByTestId('wo-detail');
    await detail.getByRole('button', { name: 'Release', exact: true }).click();
    await page.getByText(/^Released WO\/FY\d\d-\d\d\/0001/).waitFor();
    check(/\b8\b/.test(await detail.getByTestId('wo-materials').getByRole('row').filter({ hasText: 'E2E Leg' }).innerText()), 'release explodes the BOM: 8 legs required for 2 tables');

    await detail.getByRole('button', { name: 'Issue materials' }).click();
    await page.getByTestId('wo-issue-save').click();
    await page.getByText(/Materials issued on STR\/FY\d\d-\d\d\/\d+/).waitFor();
    const strs = await readJson(page, 'stock_transfers', [], (v) => v.some((t) => t.production_order_id));
    const issue = strs.find((t) => t.production_order_id);
    check(issue?.lines?.length === 2 && issue.lines.some((l) => l.item_id === 'e2e-leg' && l.qty === 8), 'the issue is a normal stock transfer into the shop-floor godown, tagged with the order');

    await detail.getByRole('button', { name: 'Report output' }).click();
    const made = page.getByLabel(/Quantity made/);
    await made.fill('1');
    await made.blur();
    await page.getByTestId('wo-output-save').click();
    await page.getByText(/MFG\/FY\d\d-\d\d\/\d+ saved: 1 made/).waitFor();
    const mfgRows = await readJson(page, 'manufacturing_vouchers', [], (v) => v.some((m) => m.production_order_id));
    const out = mfgRows.find((m) => m.production_order_id);
    check(out?.qty === 1 && out.components.some((c) => c.item_id === 'e2e-leg' && c.qty === 4 && c.godown_id === issue?.to_godown), 'partial output: a manufacturing journal consuming 4 legs from the shop floor');
    await detail.getByText('In progress').first().waitFor();

    await detail.getByRole('button', { name: 'Close order' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Write off as scrap/).check();
    await dialog.getByRole('button', { name: 'Close order' }).click();
    await page.getByText(/WO\/FY\d\d-\d\d\/0001 closed/).waitFor();
    const orders = await readJson(page, 'production_orders', [], (v) => v.some((o) => o.status === 'closed'));
    const journals = await readJson(page, 'stock_journals', [], (v) => v.some((j) => j.production_order_id));
    check(orders[0]?.status === 'closed' && journals.some((j) => j.production_order_id === orders[0]?.id && j.produce.length === 0), 'close writes the shop-floor balance off (consume-only stock journal) and closes the order');

    await page.goto(srv.origin + '/manufacturing?tab=costing');
    const costRow = page.getByTestId('costing-table').getByRole('row').filter({ hasText: orders[0].number });
    await costRow.waitFor();
    check(/50%/.test(await costRow.innerText()), 'variance report: 1 of 2 made → yield 50%');
    await costRow.getByRole('button', { name: /Details/ }).click();
    await page.getByText('Yield variance').first().waitFor();
    check(true, 'the order drill-down shows the variance split');

    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('POS: typed barcode, split cash + UPI, bill saved Paid, Z report shows the totals', async () => {
    const prevCatalog = await readJson(page, 'items_catalog', []);
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await writeJson(page, 'items_catalog', [...prevCatalog, {
      id: 'e2e-soap', name: 'E2E Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 18, amount: 0, barcode: '8901030865275',
    }]);
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor();
    // A USB scanner is a keyboard: it types the code and presses Enter.
    await scan.fill('8901030865275');
    await scan.press('Enter');
    await page.getByLabel('Quantity of E2E Soap (line 1)').waitFor();
    await scan.fill('8901030865275');
    await scan.press('Enter');
    const qty = page.getByLabel('Quantity of E2E Soap (line 1)');
    await page.waitForFunction(() => document.querySelector('[aria-label="Quantity of E2E Soap (line 1)"]')?.value === '2', null, { timeout: 5000 }).catch(() => {});
    check((await qty.inputValue()) === '2', `scanning the same code again raises the quantity (${await qty.inputValue()})`);
    const total = await page.locator('[data-pos-total]').innerText();
    check(/236\.00/.test(total), `total with 18% GST (${total})`);
    await page.locator('#pos-Cash').fill('100');
    await page.keyboard.press('F6'); // UPI takes the rest
    await page.waitForFunction(() => document.querySelector('#pos-UPI')?.value === '136', null, { timeout: 5000 }).catch(() => {});
    check((await page.locator('#pos-UPI').inputValue()) === '136', `F6 fills the rest into UPI (${await page.locator('#pos-UPI').inputValue()})`);
    await page.getByRole('button', { name: /Save bill/ }).click();
    await page.getByText(/INV\/FY\d\d-\d\d\/\d{4} saved/).first().waitFor();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id) && i.pos))).find((i) => !beforeIds.has(i.id) && i.pos);
    check(bill?.status === 'Paid' && bill.total === 236 && bill.client?.name === 'Walk-in customer', `POS bill saved as a paid invoice (${bill?.status}, ${bill?.total})`);
    const pays = (await readJson(page, 'transactions', [], (v) => v.filter((t) => t.invoice_id === bill?.id).length === 2)).filter((t) => t.invoice_id === bill?.id);
    check(pays.length === 2 && pays.some((p) => p.method === 'Cash' && p.amount === 100) && pays.some((p) => p.method === 'UPI' && p.amount === 136),
      `one payment per tender (${pays.map((p) => `${p.method} ${p.amount}`).join(', ')})`);
    check((await scan.inputValue()) === '' && (await page.getByText('Scan an item or search by name to start the bill.').count()) === 1, 'the counter resets for the next bill');

    await page.getByRole('button', { name: 'Z report' }).click();
    const z = page.getByRole('dialog', { name: 'Day-end Z report' });
    await z.waitFor();
    const net = await z.locator('[data-z="net"]').innerText();
    const cash = await z.locator('[data-z="cash"]').innerText();
    const upi = await z.locator('[data-z="upi"]').innerText();
    check(/236\.00/.test(net) && /100\.00/.test(cash) && /136\.00/.test(upi), `Z report totals (net ${net}, cash ${cash}, UPI ${upi})`);
    await z.locator('#z-counted').fill('100');
    await z.getByRole('button', { name: 'Close the day' }).click();
    const closes = await readJson(page, 'pos_day_close', [], (v) => v.length > 0);
    check(closes.length === 1 && closes[0].counted_cash === 100 && closes[0].difference === 0, 'day close stored with the drawer count');
    await z.getByRole('button', { name: 'Close', exact: true }).first().click().catch(() => page.keyboard.press('Escape'));

    await writeJson(page, 'transactions', (await readJson(page, 'transactions', [])).filter((t) => t.invoice_id !== bill?.id));
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== bill?.id));
    await writeJson(page, 'items_catalog', prevCatalog);
    await writeJson(page, 'pos_day_close', null);
  });

  await step('R4-B: sell a gift voucher, redeem it as a POS tender; transfer request → dispatch → receive with a shortage', async () => {
    const keys = ['items_catalog', 'invoices', 'transactions', 'gift_vouchers', 'vouchers', 'accounts', 'series_counters', 'godowns', 'stock_items', 'stock_transfers', 'transfer_requests'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    // 1. Sell one ₹500 voucher: a receipt voucher to the liability ledger, no invoice.
    await page.goto(srv.origin + '/receivables?tab=giftvouchers');
    await page.locator('[data-gv-face]').fill('500');
    await page.locator('[data-gv-face]').blur();
    await page.locator('[data-gv-sell-save]').click();
    await page.getByText(/1 voucher\(s\) sold — receipt RV\/FY\d\d-\d\d\/\d+/).waitFor();
    const [gv] = await readJson(page, 'gift_vouchers', [], (v) => v.length > 0);
    const rv = (await readJson(page, 'vouchers', [], (v) => v.some((x) => x.voucher_class === 'Gift voucher sale'))).find((x) => x.voucher_class === 'Gift voucher sale');
    check(/^GV\/FY\d\d-\d\d\/0001$/.test(gv?.number ?? '') && /^\d{11}-[A-Z2-9]{4}$/.test(gv?.code ?? '') && rv?.lines?.[0]?.dr === 50000, `voucher sold as a liability (${gv?.number} ${gv?.code})`);
    await page.locator('[data-gv-register]').getByText(gv.number).waitFor();

    // 2. Redeem it at the counter for a ₹236 bill: the voucher pays, ₹264 stays on it.
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-gv-soap', name: 'E2E GV Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 200, tax_rate: 18, amount: 0, barcode: '8901030865299' }]);
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.fill('8901030865299');
    await scan.press('Enter');
    await page.getByLabel('Quantity of E2E GV Soap (line 1)').waitFor();
    await page.locator('[data-gv-code]').fill(gv.code);
    await page.locator('[data-gv-code]').press('Enter');
    await page.getByText(/^GV\/FY\d\d-\d\d\/0001$/).waitFor();
    await page.getByRole('button', { name: /Save bill/ }).click();
    await page.getByText(/INV\/FY\d\d-\d\d\/\d{4} saved/).first().waitFor();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id) && i.pos))).find((i) => !beforeIds.has(i.id) && i.pos);
    const pay = (await readJson(page, 'transactions', [], (v) => v.some((t) => t.invoice_id === bill?.id))).find((t) => t.invoice_id === bill?.id);
    check(bill?.status === 'Paid' && pay?.method === 'Gift voucher' && pay.gift_voucher_id === gv.id && pay.amount === 236, `POS bill paid by the voucher (${bill?.status}, ${pay?.method} ${pay?.amount})`);

    // 3. A store asks the warehouse (Main) for 10; 10 go into transit; 9 arrive, 1 short.
    await writeJson(page, 'godowns', [{ id: 'e2e-mall', name: 'E2E Mall' }]);
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), { id: 'e2e-tee', name: 'E2E Tee', unit: 'PCS', track_stock: true, opening_qty: 20, opening_rate: 150, reorder_level: 0 }]);
    await page.goto(srv.origin + '/inventory?tab=transfers&view=requests');
    await page.locator('[data-trq-new]').click();
    await page.locator('[data-trq-to]').selectOption('e2e-mall');
    await page.locator('[data-trq-item]').selectOption('e2e-tee');
    await page.locator('[data-trq-qty]').fill('10');
    await page.locator('[data-trq-qty]').blur();
    await page.locator('[data-trq-save]').click();
    await page.getByText(/Transfer request TRQ\/FY\d\d-\d\d\/0001 raised/).waitFor();
    await page.locator('[data-trq-dispatch]').click();
    await page.locator('[data-trq-dispatch-save]').click();
    await page.getByText(/Dispatched on STR\/FY\d\d-\d\d\/\d+/).waitFor();
    await page.locator('[data-trq-receive]').click();
    await page.locator('[data-trq-received]').fill('9');
    await page.locator('[data-trq-short]').fill('1');
    await page.locator('[data-trq-short]').blur();
    await page.locator('[data-trq-receive-save]').click();
    await page.getByText(/1 shortage\(s\) to resolve/).waitFor();
    const strs = await readJson(page, 'stock_transfers', [], (v) => v.filter((t) => t.request_id).length === 2);
    const out = strs.find((t) => t.leg === 'out');
    const got = strs.find((t) => t.leg === 'in');
    const [req] = await readJson(page, 'transfer_requests', [], (v) => v[0]?.exceptions?.length === 1);
    check(out?.lines?.[0]?.qty === 10 && got?.lines?.[0]?.qty === 9 && got.to_godown === 'e2e-mall' && out.to_godown === got.from_godown, 'dispatch into transit, receipt out of transit into the store');
    check(req?.exceptions?.[0]?.kind === 'short' && req.exceptions[0].qty === 1 && req.exceptions[0].status === 'open', 'the short unit stays in transit as an open exception');
    await page.locator('[data-trq-detail]').waitFor();
    check(await page.locator('[data-trq-exception="open"]').count() === 1, 'the request details offer write-off / claim / found');

    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('8B: POS calculator qty, hold & recall across a reload, UPI QR for the exact amount with the bill number', async () => {
    const prevCatalog = await readJson(page, 'items_catalog', []);
    await writeJson(page, 'items_catalog', [...prevCatalog, {
      id: 'e2e-hold', name: 'E2E Hold Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 18, amount: 0, barcode: '8901030865305',
    }]);
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor();
    await scan.fill('8901030865305');
    await scan.press('Enter');
    const qty = page.getByLabel('Quantity of E2E Hold Soap (line 1)');
    await qty.waitFor();
    // 8.25: a sum typed into a number field is worked out (no eval).
    await qty.fill('2*3');
    await qty.press('Tab');
    check((await qty.inputValue()) === '6', `calculator: "2*3" → ${await qty.inputValue()}`);

    // 8.21: Shift+F8 parks the bill; it survives a reload (company store) and F1 → 1 recalls it.
    await page.keyboard.press('Shift+F8');
    await page.getByText(/Bill parked \(1 on hold\)/).first().waitFor();
    check((await page.getByText('Scan an item or search by name to start the bill.').count()) === 1, 'hold starts a new bill');
    const held = await readJson(page, 'pos_held', [], (v) => v.length === 1);
    check(held.length === 1 && held[0].items?.[0]?.name === 'E2E Hold Soap' && held[0].items[0].quantity === 6, `held cart stored (${held.length})`);
    await page.reload();
    await scan.waitFor();
    check(/1/.test(await page.locator('[data-pos-held]').innerText()), 'held count shown after a reload');
    await page.keyboard.press('F1');
    const dlg = page.getByRole('dialog', { name: 'Bills on hold' });
    await dlg.waitFor();
    await page.keyboard.press('1');
    await qty.waitFor();
    check((await qty.inputValue()) === '6', 'recalled bill keeps its lines');
    const after = await readJson(page, 'pos_held', [], (v) => v.length === 0);
    check(after.length === 0, 'recalled bill leaves the hold list');

    // 8.22: UPI tender → customer-facing QR for the exact amount, bill number as the reference.
    await page.keyboard.press('F6');
    const qr = page.locator('[data-pos-upi-qr]');
    await qr.waitFor();
    check((await qr.getAttribute('data-pos-upi-qr')) === '708.00', `UPI QR amount (${await qr.getAttribute('data-pos-upi-qr')})`);
    check((await qr.locator('svg').count()) > 0 && /INV\/FY\d\d-\d\d\/\d{4}/.test(await qr.innerText()), 'QR drawn with the bill number');
    await qr.getByRole('button', { name: 'Show to customer' }).click();
    const full = page.getByRole('dialog', { name: 'Pay by UPI' });
    await full.waitFor();
    await full.locator('#pos-utr-full').fill('UTR123456');
    await full.getByRole('button', { name: 'Done' }).click();
    check((await page.locator('#pos-utr').inputValue()) === 'UTR123456', 'UTR typed on the customer screen is kept');

    await page.keyboard.press('F8');
    await writeJson(page, 'pos_held', null);
    await writeJson(page, 'items_catalog', prevCatalog);
  });

  await step('8E: weighed scale label + qty prefix / short code, shift X report, change strip, WhatsApp href, create item from an unknown EAN', async () => {
    const ean = (body) => {
      const s = [...body].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0);
      return body + ((10 - (s % 10)) % 10);
    };
    const prevCatalog = await readJson(page, 'items_catalog', []);
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await writeJson(page, 'items_catalog', [...prevCatalog,
      { id: 'e2e-tomato', name: 'E2E Tomato', type: 'Product', hsn: '0702', unit: 'KG', quantity: 1, rate: 80, tax_rate: 0, amount: 0, plu: '123', sold_by_weight: true },
      { id: 'e2e-bar', name: 'E2E Bar', type: 'Product', hsn: '1704', unit: 'PCS', quantity: 1, rate: 10, tax_rate: 0, amount: 0, short_code: 'EB' },
    ]);
    await page.evaluate(() => localStorage.setItem('mrchartist_pos_scale', JSON.stringify({ enabled: true, prefixes: ['21'], pluLength: 5, value: 'weight', decimals: 3, checkDigit: true })));
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor();

    // Cashier shift with a float (8.142).
    await page.locator('[data-pos-shift]').click();
    await page.locator('#shift-float').fill('500');
    await page.locator('[data-shift-open]').click();
    await page.locator('[data-x-report]').waitFor();
    await page.keyboard.press('Escape');

    // Weighing-scale label: PLU 00123, 1.250 kg → qty 1.25 × ₹80.
    await scan.fill(ean('210012301250'));
    await scan.press('Enter');
    const tq = page.getByLabel('Quantity of E2E Tomato (line 1)');
    await tq.waitFor();
    check((await tq.inputValue()) === '1.25', `scale label weight → quantity (${await tq.inputValue()})`);
    // Quantity prefix + short code.
    await scan.fill('3*EB');
    await scan.press('Enter');
    const bq = page.getByLabel('Quantity of E2E Bar (line 2)');
    await bq.waitFor();
    check((await bq.inputValue()) === '3', `3*EB adds three of the short-code item (${await bq.inputValue()})`);
    const total = await page.locator('[data-pos-total]').innerText();
    check(/130\.00/.test(total), `1.25 kg × 80 + 3 × 10 (${total})`);

    await page.getByLabel('Walk-in phone').fill('9876543210');
    await page.locator('#pos-Cash').fill('200');
    await page.getByRole('button', { name: /Save bill/ }).click();
    const strip = page.locator('[data-pos-change-strip]');
    await strip.waitFor({ timeout: 5000 });
    check(/70\.00/.test(await strip.innerText()), `change strip (${await strip.innerText()})`);
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id) && i.pos))).find((i) => !beforeIds.has(i.id) && i.pos);
    check(bill?.total === 130, `scale bill saved (${bill?.total})`);
    const wa = await page.locator('a[data-pos-whatsapp]').getAttribute('href');
    check(/^https:\/\/wa\.me\/919876543210\?text=/.test(wa ?? ''), `WhatsApp this bill (${(wa ?? '').slice(0, 40)})`);

    // X report of the shift: the one bill, its cash.
    await page.locator('[data-pos-shift]').click();
    await page.locator('[data-x-report]').waitFor();
    const xNet = await page.locator('[data-x="net"]').innerText();
    const xBills = await page.locator('[data-x="bills"]').innerText();
    check(/130\.00/.test(xNet) && /\b1\b/.test(xBills), `shift X report (${xBills.replace(/\s+/g, ' ')}, ${xNet.replace(/\s+/g, ' ')})`);
    const shifts = await readJson(page, 'pos_shifts', [], (v) => v.length === 1 && v[0].bill_ids?.length === 1);
    check(shifts[0]?.opening_float === 500 && shifts[0]?.bill_ids?.[0] === bill?.id, 'shift row holds the bill');
    await page.keyboard.press('Escape');

    // Unknown EAN → create-item sheet → the new item lands on the bill (8.149).
    const unknown = ean('890103086531');
    await scan.fill(unknown);
    await scan.press('Enter');
    const sheet = page.locator(`[data-quick-item="${unknown}"]`);
    await sheet.waitFor();
    await page.locator('#qi-name').fill('E2E New Item');
    await page.locator('#qi-rate').fill('50');
    await page.locator('[data-qi-save]').click();
    await page.getByLabel('Quantity of E2E New Item (line 1)').waitFor();
    const cat = await readJson(page, 'items_catalog', [], (v) => v.some((i) => i.barcode === unknown));
    check(cat.some((i) => i.barcode === unknown && i.name === 'E2E New Item'), 'item created with the scanned barcode');

    await page.keyboard.press('F8');
    await writeJson(page, 'transactions', (await readJson(page, 'transactions', [])).filter((t) => t.invoice_id !== bill?.id));
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== bill?.id));
    await writeJson(page, 'items_catalog', prevCatalog);
    await writeJson(page, 'pos_shifts', null);
    await page.evaluate(() => localStorage.removeItem('mrchartist_pos_scale'));
  });

  await step('POS return: bill → return one item → refund cash; Z report shows the return (WP-9)', async () => {
    const prevCatalog = await readJson(page, 'items_catalog', []);
    const before = await readJson(page, 'invoices', []);
    const beforeIds = new Set(before.map((i) => i.id));
    const prevVouchers = await readJson(page, 'vouchers', []);
    await writeJson(page, 'items_catalog', [...prevCatalog, {
      id: 'e2e-ret', name: 'E2E Return Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 18, amount: 0, barcode: '8901030865282',
    }]);
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor();
    await scan.fill('8901030865282');
    await scan.press('Enter');
    await page.getByLabel('Quantity of E2E Return Soap (line 1)').fill('2');
    await page.keyboard.press('F4'); // cash takes the rest
    await page.getByRole('button', { name: /Save bill/ }).click();
    await page.getByText(/INV\/FY\d\d-\d\d\/\d{4} saved/).first().waitFor();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id) && i.pos))).find((i) => !beforeIds.has(i.id) && i.pos);
    check(bill?.total === 236 && bill.status === 'Paid', `bill for the return (${bill?.total}, ${bill?.status})`);

    await page.getByRole('button', { name: 'Return / exchange' }).click();
    const dlg = page.getByRole('dialog', { name: 'Return / exchange' });
    await dlg.waitFor();
    await dlg.locator('#ret-bill').fill(bill?.invoice_number ?? '');
    await dlg.getByRole('button', { name: 'Find' }).click();
    await dlg.getByLabel('Return quantity of E2E Return Soap (line 1)').fill('1');
    await page.waitForFunction(() => /118\.00/.test(document.querySelector('[data-ret-total]')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
    // The refund tender fills in after the total settles; wait for it instead of reading it once.
    await page.waitForFunction(() => document.querySelector('#ret-Cash')?.value === '118', null, { timeout: 5000 }).catch(() => {});
    const cash = await dlg.locator('#ret-Cash').inputValue();
    check(cash === '118', `refund defaults to cash 118 (${cash})`);
    await dlg.getByRole('button', { name: 'Save return' }).click();
    await page.getByText(/CRN\/FY\d\d-\d\d\/\d{4} saved — refund/).first().waitFor();
    const cn = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.doc_type === 'CREDIT_NOTE' && !beforeIds.has(i.id)))).find((i) => i.doc_type === 'CREDIT_NOTE' && !beforeIds.has(i.id));
    check(cn?.goods_returned === true && cn.total === 118, `credit note with goods returned (${cn?.invoice_number}, ${cn?.total})`);
    const rets = await readJson(page, 'pos_returns', [], (v) => v.length > 0);
    check(rets.length === 1 && rets[0].refunds?.[0]?.method === 'Cash' && rets[0].refunds[0].amount === 118 && !!rets[0].voucher_id, 'return row with a cash refund and its voucher');

    await page.getByRole('button', { name: 'Z report' }).click();
    const z = page.getByRole('dialog', { name: 'Day-end Z report' });
    await z.waitFor();
    const returns = await z.locator('[data-z="returns"]').innerText();
    const refund = await z.locator('[data-z="refund-cash"]').innerText();
    check(/^1\b/.test(returns.trim()) && /118\.00/.test(refund), `Z report shows the return (${returns}, refund ${refund})`);
    await page.keyboard.press('Escape');

    await writeJson(page, 'transactions', (await readJson(page, 'transactions', [])).filter((t) => t.invoice_id !== bill?.id));
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== bill?.id && i.id !== cn?.id));
    await writeJson(page, 'doc_links', (await readJson(page, 'doc_links', [])).filter((l) => l.to_id !== cn?.id));
    await writeJson(page, 'vouchers', prevVouchers.length ? prevVouchers : null);
    await writeJson(page, 'pos_returns', null);
    await writeJson(page, 'items_catalog', prevCatalog);
  });

  await step('7U: a bill-value offer applies on the POS with its own line; the Forex bank tab opens', async () => {
    const prevCatalog = await readJson(page, 'items_catalog', []);
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await writeJson(page, 'items_catalog', [...prevCatalog, {
      id: 'e2e-offer', name: 'E2E Offer Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 18, amount: 0, barcode: '8901030865299',
    }]);
    await writeJson(page, 'schemes', [{ id: 'e2e-bv', kind: 'bill_value', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, label: 'E2E offer', slabs: [{ min_value: 150, percent: 10 }] }]);
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor();
    await scan.fill('8901030865299');
    await scan.press('Enter');
    await page.getByLabel('Quantity of E2E Offer Soap (line 1)').fill('2');
    const offer = page.locator('[data-pos-offer]');
    await offer.waitFor({ timeout: 5000 });
    const offerText = await offer.innerText();
    const total = await page.locator('[data-pos-total]').innerText();
    check(/E2E offer: 10% off/.test(offerText) && /20\.00/.test(offerText), `offer line on the POS (${offerText})`);
    check(/212\.(40|00)/.test(total), `GST on the value after the offer: 180 + 18% (${total})`);
    await page.keyboard.press('F4');
    await page.getByRole('button', { name: /Save bill/ }).click();
    await page.getByText(/INV\/FY\d\d-\d\d\/\d{4} saved/).first().waitFor();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id) && i.pos))).find((i) => !beforeIds.has(i.id) && i.pos);
    check(bill?.offer?.value === 20 && bill.taxable_value === 180 && Math.abs(bill.total - 212.4) < 0.5, `offer saved on the bill (${JSON.stringify(bill?.offer)}, ${bill?.total})`);
    check((await page.locator('[data-pos-printer]').count()) === 1, 'printer settings button on the POS');

    await page.goto(srv.origin + '/reconcile?tab=documents&doc=forex');
    await page.getByRole('button', { name: 'Forex bank' }).waitFor();
    const forex = page.getByText(/main account stays in rupees|EEFC \/ foreign-currency accounts/).first();
    await forex.waitFor({ timeout: 10000 }).catch(() => {});
    check((await forex.count()) > 0, 'Forex bank panel renders');

    await writeJson(page, 'transactions', (await readJson(page, 'transactions', [])).filter((t) => t.invoice_id !== bill?.id));
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== bill?.id));
    await writeJson(page, 'items_catalog', prevCatalog);
    await writeJson(page, 'schemes', null);
  });

  let backupPath = '';
  await step('R3-A: open table 1 → add items → Send KOT → split by item → two bills settled with the order link', async () => {
    const prevCatalog = await readJson(page, 'items_catalog', []);
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await writeJson(page, 'items_catalog', [...prevCatalog,
      { id: 'e2e-tikka', name: 'E2E Paneer Tikka', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 200, tax_rate: 5, amount: 0 },
      { id: 'e2e-naan', name: 'E2E Butter Naan', type: 'Product', hsn: '996331', unit: 'NOS', quantity: 1, rate: 50, tax_rate: 5, amount: 0 },
    ]);
    await page.goto(srv.origin + '/tables');
    await page.locator('[data-print-tickets]').uncheck(); // no print pop-up in the smoke run
    await page.locator('[data-table="1"]').click();
    await page.locator('[data-open-order]').click();
    const search = page.locator('#order-search');
    await search.waitFor();
    for (const name of ['E2E Paneer Tikka', 'E2E Butter Naan']) {
      await search.fill(name);
      await search.press('Enter');
      await page.locator(`[data-order-line="${name}"]`).waitFor();
    }
    await page.locator('[data-send-kot]').click();
    await page.getByText(/K\d+ Kitchen sent to the kitchen/).first().waitFor();
    const sent = await readJson(page, 'table_orders', [], (v) => v.some((o) => o.status === 'open' && o.kots?.length));
    const order = sent.find((o) => o.status === 'open' && o.kots?.length);
    check(order?.kots.length === 1 && order.kots[0].number.startsWith('K') && order.kots[0].lines.length === 2, `KOT stored on the order (${order?.kots?.[0]?.number})`);
    check((await page.locator('[data-table="1"]').getAttribute('data-state')) === 'occupied', 'table 1 shows occupied');

    await page.locator('[data-split]').click();
    const dlg = page.getByRole('dialog', { name: 'Split the bill' });
    await dlg.waitFor();
    await dlg.getByRole('tab', { name: 'By item' }).click();
    await dlg.locator('[data-split-recon]').waitFor();
    check((await dlg.locator('[data-recon-exact]').getAttribute('data-recon-exact')) === '1', 'reconciliation strip: GST adds up');
    await dlg.locator('[data-split-save]').click();
    await page.getByText(/order settled/).first().waitFor();
    const bills = (await readJson(page, 'invoices', [], (v) => v.filter((i) => !beforeIds.has(i.id) && i.table_order_id).length === 2))
      .filter((i) => !beforeIds.has(i.id) && i.table_order_id);
    check(bills.length === 2 && bills.every((b) => b.pos && b.status === 'Paid' && b.table_order_id === order?.id && b.split_of?.parts === 2),
      `two POS bills, paid, linked to the order (${bills.map((b) => `${b.invoice_number} ${b.split_of?.part}/${b.split_of?.parts}`).join(', ')})`);
    const done = (await readJson(page, 'table_orders', [], (v) => v.some((o) => o.id === order?.id && o.status === 'settled'))).find((o) => o.id === order?.id);
    check(done?.status === 'settled' && done.invoice_ids?.length === 2, 'order settled with both invoice ids');
    check((await page.locator('[data-table="1"]').getAttribute('data-state')) === 'free', 'table 1 is free again');

    const ids = new Set(bills.map((b) => b.id));
    await writeJson(page, 'transactions', (await readJson(page, 'transactions', [])).filter((t) => !ids.has(t.invoice_id)));
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => !ids.has(i.id)));
    await writeJson(page, 'table_orders', null);
    await writeJson(page, 'items_catalog', prevCatalog);
  });

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
    await writeJson(page, 'invoices', []);
    await page.reload();
    await page.locator('input[type=file][accept*="json"]').first().setInputFiles(backupPath);
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.waitForEvent('load', { timeout: 15000 });
    await page.waitForTimeout(500);
    const stored = await readJson(page, 'invoices', [], (v) => v.length === 1);
    check(stored.length === 1, `restored invoice is back (${stored.length})`);
    const ref = (await readJson(page, 'purchases', [])).find((p) => p.attachments?.length)?.attachments?.[0];
    check(!!ref && typeof (await idbGet(page, `mrchartist_inv_att_${ref.id}`)) === 'string', 'the receipt file came back with the restore');
    const version = await readJson(page, 'schema_version', null);
    check(Number(version) >= 1, `schema version stamped (${version})`);
    await page.goto(srv.origin + '/settings?tab=data');
    await page.getByRole('button', { name: /Undo last restore/ }).waitFor();
    check(true, 'an undo copy of the replaced data is offered');
  });

  await step('delete without undo really deletes, even when the tab is reloaded with the Undo toast still up', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByRole('button', { name: /^Delete INV/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    // R4-C4: an Undo toast waits for the user (no auto-dismiss). QA6-1 F16: the delete is committed at once (to the
    // recycle bin), so a reload that never touches the toast cannot bring the invoice back.
    await page.waitForTimeout(6500);
    const undo = page.getByRole('button', { name: 'Undo' });
    check(await undo.isVisible(), 'the Undo toast is still there after 6.5 s (no auto-dismiss)');
    const gone = (await readJson(page, 'invoices', [], (v) => v.length === 0)).length;
    check(gone === 0, `the delete is committed while the toast is up (${gone} left)`);
    await page.reload();
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await page.waitForTimeout(500);
    const left = (await readJson(page, 'invoices', [], (v) => v.length === 0)).length;
    check(left === 0, `still deleted after a reload (${left} left)`);
    check(await page.getByRole('button', { name: /^Delete INV/ }).count() === 0, 'the list does not show it after the reload');
  });

  await step('R4-C4: the deleted invoice is in Recently deleted; restoring it brings it back with the same number', async () => {
    // Later steps expect the books as the delete left them: put invoices / receipts back afterwards.
    const before = { invoices: await readJson(page, 'invoices', []), transactions: await readJson(page, 'transactions', []) };
    const binned = await readJson(page, 'recycle_bin', [], (v) => v.some((e) => e.table === 'invoices'));
    const entry = binned.find((e) => e.table === 'invoices');
    const number = entry?.row?.invoice_number;
    check(!!number && binned.some((e) => e.table === 'transactions' && e.row?.invoice_id === entry.row_id), `the invoice ${number} and its receipt are in the recycle bin`);
    await page.goto(srv.origin + '/settings?tab=data&bin=1');
    const dlg = page.getByRole('dialog', { name: /Recently deleted/ });
    await dlg.waitFor();
    const row = dlg.locator(`[data-bin-row="${number}"]`);
    await row.waitFor();
    const linked = binned.filter((e) => e.table === 'transactions' && e.row?.invoice_id === entry.row_id).length;
    await row.getByRole('button', { name: new RegExp(`Restore with ${linked} linked row`) }).click();
    const back = await readJson(page, 'invoices', [], (v) => v.length === 1);
    check(back[0]?.invoice_number === number && back[0]?.id === entry.row_id, `restored with the same number and id (${back[0]?.invoice_number})`);
    const pays = await readJson(page, 'transactions', [], (v) => v.filter((t) => t.invoice_id === entry.row_id).length === linked);
    check(pays.filter((t) => t.invoice_id === entry.row_id).length === linked, `its ${linked} receipt(s) came back with it`);
    check((await readJson(page, 'recycle_bin', [], (v) => !v.some((e) => e.row_id === entry.row_id))).every((e) => e.row_id !== entry.row_id), 'the bin entry is gone');
    const audit = await readJson(page, 'audit_log', [], (v) => v.some((e) => e.action === 'restore'));
    check(audit.some((e) => e.action === 'restore' && /recycle bin/.test(e.summary)), 'the restore is in the edit log');
    await page.keyboard.press('Escape');
    await writeJson(page, 'invoices', before.invoices);
    await writeJson(page, 'transactions', before.transactions);
  });

  await step('R4-C1/C2: an export without an LUT is flagged before filing; LUT added; an IRM realises the shipping bill', async () => {
    const keys = ['invoices', 'lut_register', 'export_irms'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 10);
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-10`;
    const fyStart = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    const fy = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
    const exp = {
      id: 'e2e-exp', invoice_number: `EXP/${fy}/0001`, doc_type: 'INVOICE', status: 'Sent', issue_date: day, due_date: day, currency: 'USD', exchange_rate: 83,
      supply_type: 'EXPORT_LUT', place_of_supply: '96', gst_mode: 'IGST', total: 1000, amount_paid: 0, balance_due: 1000, lut_number: '', lut_date: '',
      shipping_bill_no: '7654321', shipping_bill_date: day, incoterm: 'FOB', country_of_destination: 'AE',
      sender: { companyName: 'E2E Trader', companyGstin: '27AAPFU0939F1ZV', stateCode: '27', iec: 'AAPFU0939F' },
      client: { name: 'E2E Gulf Buyer LLC', state: 'Other country' }, items: [{ id: 'x1', name: 'Spice export', hsn: '0904', quantity: 1, rate: 1000, tax_rate: 0, amount: 1000 }],
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), exp]);
    await page.goto(srv.origin + '/gst-reports');
    await page.locator('[data-filing-check]').click();
    await page.locator('[data-preflight-group="issue:LUT_MISSING"]').waitFor();
    check(/without an LUT/.test(await page.locator('[data-preflight-group="issue:LUT_MISSING"]').innerText()), 'preflight: LUT_MISSING for the zero-rated export');
    await page.keyboard.press('Escape');

    await page.goto(srv.origin + '/settings');
    const panel = page.locator('[data-export-settings]');
    await panel.waitFor();
    await panel.getByLabel('Financial year').selectOption(fy);
    await panel.getByLabel('ARN').fill('AD2704260012345');
    await panel.getByLabel('Filed on').fill(`${fyStart}-03-20`);
    await panel.getByRole('button', { name: 'Add LUT' }).click();
    const lut = await readJson(page, 'lut_register', [], (v) => v.length === 1);
    check(lut[0]?.fy === fy && lut[0]?.arn === 'AD2704260012345', `LUT register row for ${fy}`);

    await page.goto(srv.origin + '/gst-reports?tab=export-desk&view=irms');
    await page.getByRole('button', { name: 'Add IRM' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('IRM / FIRC no.').fill('E2EIRM0001');
    await form.getByLabel('Amount (FCY)').fill('1000');
    await form.getByLabel('Amount (FCY)').blur();
    await form.getByRole('button', { name: new RegExp(`^Add ${exp.invoice_number}`) }).click();
    await form.getByTestId('irm-save').click();
    const irms = await readJson(page, 'export_irms', [], (v) => v.length === 1);
    check(irms[0]?.allocations?.[0]?.invoice_id === 'e2e-exp' && irms[0]?.allocations?.[0]?.fcy === 1000, 'the IRM is matched to the export invoice');
    await page.goto(srv.origin + '/gst-reports?tab=export-desk&view=register');
    const reg = page.locator(`[data-realisation-row="${exp.invoice_number}"]`);
    await reg.waitFor();
    check(/Realised/.test(await reg.innerText()), 'the realisation register shows the shipping bill as realised');

    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('R5-A: e-commerce pack on → channel → import an Amazon MTR and a settlement → post → clearing nets to ₹0.00', async () => {
    const keys = ['settings', 'invoices', 'transactions', 'vouchers', 'items_catalog', 'clients', 'bank_accounts', 'accounts', 'doc_links', 'series_counters',
      'sales_channels', 'channel_skus', 'marketplace_imports', 'settlements', 'marketplace_returns'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const settings = prev.settings ?? {};
    await writeJson(page, 'settings', { ...settings, industry_packs: ['marketplace'], lock_until: undefined });
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-mug', name: 'E2E Red Mug', sku: 'MUG-RED', hsn: '6912', unit: 'NOS', tax_rate: 18, rate: 500, type: 'Product', quantity: 1, amount: 0 }]);
    await page.goto(srv.origin + '/receivables');
    await page.getByRole('tab', { name: 'Marketplace' }).click();
    await page.locator('[data-mkt-view="channels"]').click();
    await page.locator('[data-mkt-ch-name]').fill('E2E Amazon');
    await page.locator('[data-mkt-ch-gstins]').fill('27AAICA3918J1CT');
    await page.locator('[data-mkt-ch-save]').click();
    const ch = await readJson(page, 'sales_channels', [], (v) => v.length === 1);
    const banks = await readJson(page, 'bank_accounts', [], (v) => v.some((b) => b.clearing));
    check(!!ch[0]?.clearing_bank_id && banks.some((b) => b.id === ch[0].clearing_bank_id && b.clearing), 'the channel has its own clearing account');
    // The pack-of-3 listing maps to the mug (SKU map row).
    await writeJson(page, 'channel_skus', [{ id: 'e2e-sku', channel_id: ch[0].id, channel_sku: 'MUG-3PK', listing_id: 'B0MUG3', item_id: 'e2e-mug', qty_per_unit: 3 }]);
    const fx = (n) => decodeURIComponent(new URL(`../fixtures/marketplace/${n}`, import.meta.url).pathname);

    await page.goto(srv.origin + '/receivables?tab=marketplace&view=import');
    await page.locator('[data-mkt-sales-file]').setInputFiles(fx('amazon-mtr.csv'));
    await page.locator('[data-mkt-preview]').waitFor();
    check(/3 invoices and 1 credit notes/.test(await page.locator('[data-mkt-preview]').innerText()), 'preview: 3 invoices and 1 credit note');
    await page.locator('[data-mkt-sales-import]').click();
    const docs = await readJson(page, 'invoices', [], (v) => v.filter((d) => d.channel_id === ch[0].id).length === 4);
    check(docs.filter((d) => d.channel_id === ch[0].id && d.eco_gstin === '27AAICA3918J1CT').length === 4, 'four documents with the marketplace numbers, tagged to the operator GSTIN');

    await page.goto(srv.origin + '/receivables?tab=marketplace&view=settlements');
    await page.locator('[data-mkt-settlement-file]').setInputFiles(fx('amazon-settlement-v2.csv'));
    await page.locator('[data-mkt-settlement-import]').click();
    await readJson(page, 'settlements', [], (v) => v.length === 1);
    await page.locator('[data-mkt-post]').click();
    await readJson(page, 'settlements', [], (v) => !!v[0]?.posted);
    await page.locator('[data-mkt-clearing-total]').waitFor();
    const total = await page.locator('[data-mkt-clearing-total]').innerText();
    check(/₹0\.00/.test(total), `clearing account nets to zero (${total.trim()})`);

    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('R5-B: contractor pack on → BOQ → RA bill with retention and 194C → the receivable splits into due now and held', async () => {
    const keys = ['settings', 'invoices', 'transactions', 'clients', 'doc_links', 'series_counters', 'ra_measurements', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const settings = prev.settings ?? {};
    await writeJson(page, 'settings', { ...settings, industry_packs: ['works'], lock_until: undefined });
    const dept = { id: 'e2e-pwd', name: 'E2E PWD Division', email: '', address: 'Mumbai', city: 'Mumbai', zip: '', state_code: '27' };
    await writeJson(page, 'clients', [...(prev.clients ?? []), dept]);
    // The BOQ is an ordinary issued sales order (the editor flow is covered by the earlier steps).
    const boq = {
      id: 'e2e-boq', invoice_number: 'SO/E2E/0001', doc_type: 'SALES_ORDER', issue_date: '2026-05-01', due_date: '2026-05-31', status: 'Sent', currency: 'INR', template_id: 'classic_orange',
      client: dept, sender: (settings.profiles ?? [])[0] ?? null,
      items: [
        { id: 'e2e-l1', name: 'Earthwork excavation', boq_ref: '2.1', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 1000, rate: 250, tax_rate: 18, discount_percent: 0, amount: 250000 },
        { id: 'e2e-l2', name: 'PCC 1:4:8', boq_ref: '2.2', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 200, rate: 4500, tax_rate: 18, discount_percent: 0, amount: 900000 },
      ],
      gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false,
      amount_paid: 0, notes: '', terms: '', subtotal: 1150000, discount_amount: 0, taxable_value: 1150000, cgst_amount: 103500, sgst_amount: 103500, igst_amount: 0, tax_amount: 207000, round_off: 0, total: 1357000, balance_due: 1357000,
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), boq]);
    await page.goto(srv.origin + '/time');
    await page.getByRole('tab', { name: 'Works' }).click();
    await page.locator('[data-works-boq]').selectOption('e2e-boq');
    await page.locator('[data-ded-on="retention"]').check();
    await page.locator('[data-ded-rate="retention"]').fill('5');
    await page.locator('[data-ded-on="it_tds"]').check();
    await page.locator('[data-ded-save]').click();
    await readJson(page, 'invoices', [], (v) => (v.find((d) => d.id === 'e2e-boq')?.boq_terms?.deductions ?? []).length === 2);
    await page.locator('[data-tw-view="ra"]').click();
    await page.locator('[data-ra-cum="2.1"]').fill('400');
    await page.locator('[data-ra-save]').click();
    const docs = await readJson(page, 'invoices', [], (v) => v.some((d) => d.boq_id === 'e2e-boq' && d.ra_no === 1));
    const ra = docs.find((d) => d.boq_id === 'e2e-boq' && d.ra_no === 1);
    check(!!ra && ra.total === 118000 && ra.taxable_value === 100000, `RA bill 1: ₹1,00,000 + GST = ₹1,18,000 (${ra?.total})`);
    const kinds = (ra?.ra_deductions ?? []).map((d) => `${d.kind}:${d.amount}`).join(',');
    check(kinds === 'retention:5000,it_tds:2000' && ra.tds_amount === 2000 && ra.ra_net_payable === 111000, `deductions retention 5% and 194C 2%, net payable ₹1,11,000 (${kinds})`);
    await page.locator('[data-ra-register]').waitFor();
    await page.locator('[data-tw-view="retention"]').click();
    const row = page.locator(`[data-ra-split="${ra.invoice_number}"]`);
    await row.waitFor();
    const due = (await row.locator('[data-ra-due]').innerText()).trim();
    const held = (await row.locator('[data-ra-held="retention"]').innerText()).trim();
    check(/1,11,000\.00/.test(due), `due now ₹1,11,000.00 (${due})`);
    check(/5,000\.00/.test(held), `held: retention ₹5,000.00 (${held})`);

    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  // R7-C: hotel stay. R7-B (folios / check-out) is not on this base yet, so the step stops after the night audit and
  // Form C; R7-B adds "post laundry → charge to room → check out → one invoice" here.
  await step('R7 hotel stay: pack on → walk-in a foreign guest (Form C due) → night audit posts 1 night → Form C filed → GST → Hotel "specified" at ₹7,600', async () => {
    const keys = ['settings', 'invoices', 'advances', 'series_counters', 'audit_log', 'hotel_room_types', 'hotel_rooms', 'hotel_rate_plans', 'hotel_reservations', 'hotel_folios', 'hotel_guests', 'hotel_night_audits', 'hotel_settings'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), industry_packs: ['hotel'], lock_until: undefined });
    await writeJson(page, 'hotel_room_types', [{ id: 'e2e-dlx', name: 'Deluxe', code: 'DLX', base_occupancy: 2, max_occupancy: 3, max_extra_beds: 1, sac: '996311' }]);
    await writeJson(page, 'hotel_rooms', [101, 102].map((n) => ({ id: `e2e-r${n}`, number: String(n), room_type_id: 'e2e-dlx', floor: '1', active: true, hk_status: 'clean' })));
    await writeJson(page, 'hotel_rate_plans', [{ id: 'e2e-ep', name: 'Room only', code: 'EP', meal_plan: 'EP', audience: 'public', active: true, rates: [{ room_type_id: 'e2e-dlx', single: 3000, double: 3000, extra_adult: 0, extra_child: 0, extra_bed: 0 }] }]);
    await writeJson(page, 'hotel_settings', { business_date: today });
    for (const k of ['hotel_reservations', 'hotel_folios', 'hotel_guests', 'hotel_night_audits']) await writeJson(page, k, []);

    await page.goto(srv.origin + '/tables?tab=frontdesk');
    await page.locator('[data-walk-in]').click();
    const dlg = page.getByRole('dialog');
    await dlg.locator('[data-f="name"]').first().fill('Jane Doe');
    await dlg.locator('[data-f="nationality"]').first().fill('GB');
    await dlg.locator('[data-f="passport_no"]').fill('P1234567');
    await dlg.locator('[data-check-in-go]').click();
    const res = await readJson(page, 'hotel_reservations', [], (v) => v.some((r) => r.lines?.[0]?.status === 'checked_in'));
    const line = res[0].lines[0];
    check(!!line.form_c?.due_at && Date.parse(line.form_c.due_at) - Date.parse(line.checked_in_at) === 24 * 3600e3, 'a foreign guest starts the 24-hour Form C clock');
    await page.locator('[data-formc-chip]').first().waitFor();
    check(true, 'the board shows the Form C countdown chip');

    await page.locator('[data-hotel-view="audit"]').click();
    await page.locator('[data-run-audit]').click();
    const audits = await readJson(page, 'hotel_night_audits', [], (v) => v.length === 1);
    const folios = await readJson(page, 'hotel_folios', []);
    const room = folios.flatMap((f) => f.lines).filter((l) => l.kind === 'room');
    check(audits[0].business_date === today && room.length === 1 && room[0].amount === 3000, `night audit posts 1 room night at ₹3,000 (${room.map((l) => l.amount)})`);

    await page.locator('[data-hotel-view="formc"]').click();
    const row = page.locator('[data-formc-row]').first();
    check(await row.getAttribute('data-formc-status') === 'due', 'Form C desk lists the guest as due');
    await row.locator('[data-formc-sheet]').click();
    check(/P1234567/.test(await row.locator('[data-formc-data]').innerText()), 'the data sheet shows the passport number');
    await row.locator(`[data-f="${line.id}"]`).fill('FRRO-E2E-1');
    await row.locator('[data-formc-filed]').click();
    const filed = await readJson(page, 'hotel_reservations', [], (v) => !!v[0]?.lines?.[0]?.form_c?.filed_at);
    check(filed[0].lines[0].form_c.ref === 'FRRO-E2E-1', 'Form C marked filed with the reference');

    await page.goto(srv.origin + '/gst-reports?tab=hotel-gst');
    const card = page.locator('[data-premises]').first();
    await card.waitFor();
    check(await card.getAttribute('data-specified') === 'no', 'no previous-FY value: not specified premises');
    await page.locator('[data-hotel-gst] [data-f="prev"]').fill('7600');
    await page.locator('[data-prev-save]').click();
    await page.locator('[data-premises][data-specified="yes"]').first().waitFor();
    check(await card.locator('[data-fnb-rate]').getAttribute('data-fnb-rate') === '18', 'previous-FY ₹7,600 → specified premises, F&B 18%');

    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('composition profile issues a Bill of Supply with the Rule 49 declaration', async () => {
    await page.goto(srv.origin + '/settings');
    await page.getByLabel('GST scheme').selectOption('composition');
    await page.getByLabel('Composition category').selectOption('trader');
    await page.getByRole('button', { name: 'Save settings' }).click();
    const s = await readJson(page, 'settings', {}, (v) => v.profiles?.some((p) => p.gst_scheme === 'composition'));
    check(s.profiles?.find((p) => p.id === s.activeProfileId)?.gst_scheme === 'composition', 'profile switched to the composition scheme');

    await page.goto(srv.origin + '/invoice');
    await page.locator('[data-meta-edit]').click(); // A5: document details are one line until edited
    const type = await page.getByRole('combobox', { name: /^Type/ }).first().inputValue();
    check(type === 'BILL_OF_SUPPLY', `a composition profile opens a Bill of Supply (${type})`);
    await page.getByLabel('Client name').fill('Corner Shop');
    await page.getByLabel('Item 1 name').fill('Biscuits');
    await page.getByLabel('Item 1 quantity').fill('10');
    await page.getByLabel('Item 1 rate').fill('100');
    check((await page.getByLabel('Item 1 GST rate').count()) === 0, 'no GST rate column on a Bill of Supply');
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
    await closeSendSheet(page);
    const bos = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.doc_type === 'BILL_OF_SUPPLY'))).find((i) => i.doc_type === 'BILL_OF_SUPPLY');
    check(!!bos && /^BOS\/FY\d{2}-\d{2}\/0001$/.test(bos.invoice_number) && bos.tax_amount === 0 && Math.abs(bos.total - 1000) < 0.01 && bos.sender?.gst_scheme === 'composition',
      `bill of supply ${bos?.invoice_number}: total ${bos?.total}, tax ${bos?.tax_amount}, scheme snapshotted (${bos?.sender?.gst_scheme})`);

    await page.getByRole('button', { name: /Preview/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.waitFor();
    const declared = await dialog.getByText('Composition taxable person, not eligible to collect tax on supplies').count();
    const titled = await dialog.getByText('Bill of Supply').count();
    check(declared > 0 && titled > 0, `preview shows the title and the composition declaration (${titled} / ${declared})`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    // Back to a regular profile and no documents, as the later steps expect.
    await writeJson(page, 'invoices', (await readJson(page, 'invoices', [])).filter((i) => i.id !== bos?.id));
    const fresh = await readJson(page, 'settings', {});
    await writeJson(page, 'settings', { ...fresh, profiles: fresh.profiles.map((p) => ({ ...p, gst_scheme: 'regular' })) });
  });

  await step('time tracking: timer pill, manual entry, bill to a draft invoice', async () => {
    await page.goto(srv.origin + '/time');
    await page.locator('#tm-client').selectOption({ label: 'Acme Buyers' });
    await page.getByRole('button', { name: /Start timer/ }).click();
    const pill = page.getByRole('link', { name: /Timer running for Acme Buyers/ }).first();
    await pill.waitFor();
    // Reload only once the running timer has reached IndexedDB (the write is flushed asynchronously; a
    // reload a few ms after the click can beat it on a fast runner).
    await readJson(page, 'timer', null, (v) => !!v && v.started_at !== null);
    await page.reload();
    await pill.waitFor();
    check(true, 'timer pill shows in the header and survives a reload');
    await page.getByRole('button', { name: /Stop & log/ }).click();
    await page.getByRole('button', { name: /Start timer/ }).waitFor();
    check(await pill.count() === 0, 'pill disappears once the timer stops');

    await page.getByRole('button', { name: /Add time/ }).click();
    await page.locator('#te-client').selectOption({ label: 'Acme Buyers' });
    await page.getByLabel('Description').fill('Strategy call');
    await page.getByLabel('Time (h:mm)').fill('1:30');
    await page.getByLabel('Rate / hour').fill('1000');
    await page.getByRole('button', { name: 'Add entry' }).click();
    await page.getByText('Strategy call').first().waitFor();

    await page.getByRole('tab', { name: 'Unbilled' }).click();
    await page.getByRole('button', { name: /^Bill$/ }).first().click();
    await page.getByRole('button', { name: 'Create draft invoice' }).click();
    await page.waitForURL(/\/invoice\/.+/);
    const inv = (await readJson(page, 'invoices', [], (v) => v.length > 0))[0];
    const item = inv?.items?.[0] ?? {};
    check(inv?.status === 'Draft' && item.quantity === 1.5 && item.unit === 'HRS' && item.hsn === '998311',
      `bill-from-time draft: ${inv?.status}, ${item.quantity} ${item.unit}, SAC ${item.hsn}`);
    const entries = await readJson(page, 'time_entries', [], (v) => v.some((e) => e.invoiced_in));
    check(entries.length === 1 && entries[0].invoiced_in === inv.id, `time entry linked to the invoice (${entries.length})`);
  });

  await step('cost centres: create a project, tag an invoice and an expense, see the project P&L', async () => {
    await page.goto(srv.origin + '/books?tab=proj');
    await page.getByRole('button', { name: 'Add cost centre' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'New cost centre' });
    await dlg.getByLabel('Name').fill('Website revamp');
    await dlg.getByRole('button', { name: 'Save' }).click();
    await dlg.waitFor({ state: 'detached' });
    const centres = await readJson(page, 'cost_centres', [], (v) => v.length === 1);
    check(centres.length === 1 && centres[0].kind === 'project', `cost centre stored (${centres.length})`);

    await page.goto(srv.origin + '/invoice');
    await page.locator('[data-meta-edit]').click();
    await page.locator('#doc-cost-centre').selectOption({ label: 'Website revamp · Project' });
    await page.getByLabel('Client name').fill('Acme Buyers');
    await page.getByLabel('Item 1 name').fill('Design sprint');
    await page.getByLabel('Item 1 quantity').fill('1');
    await page.getByLabel('Item 1 rate').fill('10000');
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
    const invs = await readJson(page, 'invoices', [], (v) => v.some((i) => i.cost_centre_id));
    check(invs.some((i) => i.cost_centre_id === centres[0].id), 'invoice carries the cost centre');

    await page.goto(srv.origin + '/expenses');
    await page.getByRole('button', { name: /Quick expense/ }).click();
    const exp = page.getByRole('dialog');
    await exp.locator('#exp-cat').selectOption('Software & subscriptions');
    await exp.getByLabel('Amount (₹)').fill('2500');
    await exp.locator('#exp-cost-centre').selectOption({ label: 'Website revamp · Project' });
    await exp.getByRole('button', { name: 'Add expense' }).click();
    await exp.waitFor({ state: 'detached' });
    const bills = await readJson(page, 'purchases', [], (v) => v.some((p) => p.cost_centre_id));
    check(bills.some((p) => p.cost_centre_id === centres[0].id), 'expense carries the cost centre');

    await page.goto(srv.origin + '/books?tab=proj');
    const table = page.getByTestId('project-pnl');
    await table.waitFor();
    check(await table.getByRole('columnheader', { name: 'Website revamp' }).isVisible(), 'project column in the project P&L');
    check(await page.getByText('Ties to the P&L').isVisible(), 'project P&L ties to the overall P&L');
    // Software is an indirect expense: margin 10,000, net 10,000 − 2,500.
    const net = await table.getByRole('row', { name: /^Net profit/ }).first().textContent();
    check(/^Net profit \/ \(loss\)7,500\.00/.test(net ?? ''), `project net = 10,000 − 2,500 (${net})`);

    await page.getByRole('tab', { name: 'Budgets' }).click();
    await page.getByRole('button', { name: 'Add budget line' }).click();
    const bud = page.getByRole('dialog', { name: 'New budget line' });
    await bud.locator('#bud-acct').selectOption('sales');
    await bud.getByLabel('Annual budget (₹)').fill('120000');
    await bud.getByRole('button', { name: 'Save budget' }).click();
    await bud.waitFor({ state: 'detached' });
    const budgets = await readJson(page, 'budgets', [], (v) => v.length === 1);
    check(budgets.length === 1 && budgets[0].months.every((m) => m === 1000000), `budget spread evenly in paise (${budgets[0]?.months?.[0]})`);
    await page.getByRole('button', { name: 'Full year' }).click();
    const rep = page.getByTestId('budget-report');
    await rep.waitFor();
    const row = await rep.getByRole('row', { name: /Sales/ }).first().textContent();
    check(/1,20,000\.00/.test(row ?? '') && /10,000\.00/.test(row ?? ''), `budget vs actual row (${row})`);
  });

  await step('R3-B: project with an hours budget → log time on its task → bill the project with the timesheet annexure → print', async () => {
    await page.goto(srv.origin + '/time?tab=projects');
    await page.locator('[data-new-project]').click();
    const pdlg = page.getByRole('dialog', { name: 'New project' });
    await pdlg.locator('#pj-name').fill('Mobile app');
    await pdlg.locator('#pj-client').selectOption({ label: 'Acme Buyers' });
    await pdlg.locator('#pj-hours').fill('2');
    await pdlg.locator('[data-save-project]').click();
    await pdlg.waitFor({ state: 'detached' });
    const centres = await readJson(page, 'cost_centres', [], (v) => v.some((c) => c.name === 'Mobile app'));
    const proj = centres.find((c) => c.name === 'Mobile app');
    check(proj?.budget_minutes === 120 && proj?.kind === 'project', `project stored with a 2 h budget (${proj?.budget_minutes})`);
    await page.locator('[data-project-select]').selectOption(proj.id);
    await page.locator('[data-add-task]').click();
    const tdlg = page.getByRole('dialog', { name: 'Add task' });
    await tdlg.locator('#tk-title').fill('Wireframes');
    await tdlg.locator('#tk-est').fill('1');
    await tdlg.locator('[data-save-task]').click();
    await tdlg.waitFor({ state: 'detached' });
    await page.locator('[data-task-id]').filter({ hasText: 'Wireframes' }).waitFor();

    // Log 1:45 on the task: picking the task sets the project.
    await page.getByRole('button', { name: /Add time/ }).click();
    await page.locator('#te-client').selectOption({ label: 'Acme Buyers' });
    await page.locator('#te-task').selectOption({ label: 'Wireframes' });
    await page.getByLabel('Description').fill('Wireframes v1');
    await page.getByLabel('Time (h:mm)').fill('1:45');
    await page.getByLabel('Rate / hour').fill('1200');
    await page.getByRole('button', { name: 'Add entry' }).click();
    const logged = await readJson(page, 'time_entries', [], (v) => v.some((e) => e.description === 'Wireframes v1'));
    const te = logged.find((e) => e.description === 'Wireframes v1');
    check(!!te?.task_id && te?.cost_centre_id === proj?.id, `entry carries the task and its project (${te?.cost_centre_id === proj?.id})`);
    await page.reload();
    await page.locator('[data-project-select]').selectOption(proj.id);
    const header = await page.locator('[data-project-header]').innerText();
    check(/1h 45m of 2h 00m/.test(header) && /87% of the hours budget/.test(header), `header: tracked vs budget and the 80% warning (${header.replace(/\s+/g, ' ').slice(0, 120)})`);

    // Bill the project with the annexure.
    await page.locator('[data-bill-project]').click();
    await page.locator('[data-attach-annexure]').check();
    await page.getByRole('button', { name: 'Create draft invoice' }).click();
    await page.waitForURL(/\/invoice\/.+/);
    const id = page.url().split('/invoice/')[1];
    const inv = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.id === id && i.annexure))).find((i) => i.id === id);
    check(inv?.annexure?.rows?.length === 1 && inv.annexure.rows[0].task === 'Wireframes' && inv.annexure.rows[0].billed_minutes === 105,
      `annexure snapshot on the invoice (${inv?.annexure?.rows?.length} row, task ${inv?.annexure?.rows?.[0]?.task})`);
    check(inv?.items?.length === 1 && inv.items[0].quantity === 1.75, `one time line of 1.75 h (${inv?.items?.[0]?.quantity})`);

    // Issue it, dismiss the post-save sheet, then print: the annexure is a following page.
    await page.keyboard.press('Control+s');
    await closeSendSheet(page);
    await page.locator('[data-annexure-actions]').waitFor();
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.waitFor();
    const annex = dialog.locator('[data-annexure]').first();
    await annex.waitFor();
    const text = await annex.innerText();
    check(/Annexure to INV\/FY\d{2}-\d{2}\/\d{4}/i.test(text) && /Wireframes v1/.test(text), `preview prints the annexure (${text.replace(/\s+/g, ' ').slice(0, 60)}…)`);
    await dialog.getByRole('button', { name: /^Share/ }).click();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('menuitem', { name: /Download PDF/ }).click()]);
    const body = readFileSync(await dl.path()).toString('latin1');
    const pages = (body.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    check(pages >= 2, `the PDF carries the annexure on a following page (${pages} pages)`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  });

  await step('cheque register: record a post-dated cheque, see the reminder, clear it against the invoice', async () => {
    const day = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const today = day(0);
    const invoices = await readJson(page, 'invoices', []);
    invoices.push({
      id: 'chq-inv', invoice_number: 'INV/CHQ/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: today, due_date: today, currency: 'INR',
      template_id: 'classic_orange', client: { name: 'Cheque Buyer', email: '', address: '', city: '', zip: '' }, sender: null,
      items: [{ id: 'l1', name: 'Goods', type: 'Goods', quantity: 1, rate: 5000, tax_rate: 0, amount: 5000 }], gst_mode: 'NONE',
      place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0,
      round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: 5000, discount_amount: 0, taxable_value: 5000, cgst_amount: 0,
      sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 5000, balance_due: 5000,
    });
    await writeJson(page, 'invoices', invoices);
    await page.goto(srv.origin + '/cheques');
    await page.getByRole('button', { name: 'Cheque received' }).click();
    const dlg = page.getByRole('dialog', { name: 'Record a cheque received' });
    await dlg.getByLabel('Received from *').fill('Cheque Buyer');
    await dlg.getByLabel('Cheque no. *').fill('004512');
    await dlg.getByLabel('Drawn on (bank) *').fill('HDFC Bank');
    await dlg.getByLabel('Cheque date *').fill(day(2));
    const linkSelect = dlg.getByLabel('Against invoice (optional)');
    await linkSelect.selectOption(await linkSelect.locator('option', { hasText: 'INV/CHQ/0001' }).getAttribute('value'));
    await dlg.getByText(/Post-dated: you will be reminded/).waitFor();
    await dlg.getByRole('button', { name: 'Save cheque' }).click();
    await dlg.waitFor({ state: 'detached' });
    const saved = (await readJson(page, 'cheques', [], (v) => v.length === 1))[0];
    check(saved?.status === 'received' && saved.amount === 5000 && saved.invoice_id === 'chq-inv' && saved.cheque_date === day(2),
      `post-dated cheque stored, linked to the invoice (${saved?.status}, ${saved?.amount}, ${saved?.cheque_date})`);
    await page.getByText('PDC', { exact: true }).first().waitFor();

    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('dialog', { name: 'Notifications' }).getByText(/post-dated cheque due within 3 days/).waitFor();
    check(true, 'the notification bell reminds about the post-dated cheque');
    await page.keyboard.press('Escape');

    // The customer asked us to present it today: move the date, then clear it.
    await page.getByRole('button', { name: 'Edit cheque 004512' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit cheque' });
    await edit.getByLabel('Cheque date *').fill(today);
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await edit.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Clear cheque 004512' }).click();
    const act = page.getByRole('dialog', { name: /Mark cleared · cheque 004512/ });
    await act.getByText(/Record the payment of ₹5,000\.00 against INV\/CHQ\/0001/).waitFor();
    await act.getByRole('button', { name: 'Mark cleared' }).click();
    await act.waitFor({ state: 'detached' });
    const cleared = (await readJson(page, 'cheques', [], (v) => v[0]?.status === 'cleared'))[0];
    const tx = (await readJson(page, 'transactions', [], (v) => v.some((t) => t.invoice_id === 'chq-inv'))).find((t) => t.invoice_id === 'chq-inv');
    const inv = (await readJson(page, 'invoices', [], (v) => v.find((i) => i.id === 'chq-inv')?.status === 'Paid')).find((i) => i.id === 'chq-inv');
    check(cleared?.status === 'cleared' && tx?.method === 'Cheque' && tx?.reference === '004512' && tx?.amount === 5000 && cleared.payment_id === tx.id,
      `clearing records the cheque payment (${cleared?.status}, ${tx?.method} ${tx?.reference} ${tx?.amount})`);
    check(inv?.status === 'Paid' && inv.balance_due === 0, `the invoice is settled (${inv?.status}, balance ${inv?.balance_due})`);

    await page.goto(srv.origin + '/books?tab=fcst');
    await page.getByText('Estimate, not a statement.').waitFor();
    await page.getByRole('radio', { name: '30 days' }).click();
    await page.getByRole('img', { name: /Closing balance goes from/ }).waitFor();
    await page.goto(srv.origin + '/books?tab=fx');
    await page.getByText(/Period-end revaluation of open receivables/).waitFor();
    await page.goto(srv.origin + '/reports?tab=party');
    await page.getByRole('table', { name: 'Profitability by customer' }).waitFor();
    check(true, 'forecast, FX gain/loss and party-profit screens render');
  });

  await step('payroll: add an employee with a salary structure, run the month, see the payslip net pay', async () => {
    await page.goto(srv.origin + '/payroll');
    await page.getByRole('button', { name: 'Add employee' }).click();
    const dlg = page.getByRole('dialog', { name: 'New employee' });
    await dlg.getByLabel('Name *').fill('Payroll Tester');
    await dlg.getByRole('button', { name: 'Save employee' }).click();
    await dlg.waitFor({ state: 'detached' });
    await page.getByRole('tab', { name: 'Salary structures' }).click();
    await page.getByRole('button', { name: 'Create structure' }).click();
    await page.getByLabel('Monthly amount for Basic').fill('20000');
    await page.getByLabel('Monthly amount for Basic').press('Enter');
    await page.getByRole('button', { name: 'Save structure' }).click();
    await page.getByText('Salary structure saved').waitFor();
    await page.getByRole('tab', { name: 'Payroll run' }).click();
    await page.getByRole('button', { name: 'Auto fill' }).click();
    await page.getByRole('button', { name: 'Payslip for Payroll Tester' }).click();
    const slip = page.getByRole('dialog', { name: /Payslip · Payroll Tester/ });
    // Basic 20,000 − PF 12% (1,800) − ESI 0.75% (150) = 18,050
    await slip.getByText('Net pay: ₹18,050.00').waitFor();
    check(true, 'payslip shows net pay after PF and ESI');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Finalize & post' }).click();
    const runs = await readJson(page, 'payroll_runs', [], (v) => v[0]?.status === 'final');
    check(runs[0]?.status === 'final' && /^PRL\/FY/.test(runs[0].number), `payroll finalized with a PRL number (${runs[0]?.number})`);
  });

  await step('local roles: the owner adds a viewer, who sees a read-only app, then the owner signs back in', async () => {
    await page.goto(srv.origin + '/settings?tab=security');
    await page.getByText('Users on this device').waitFor();
    await page.locator('#user-name').fill('E2E Viewer');
    await page.locator('#user-role').selectOption('viewer');
    await page.locator('#user-pin').fill('135790');
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.getByText('E2E Viewer added as viewer').waitFor({ timeout: 15000 });
    const users = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_auth_users') || '[]'));
    check(users.length === 1 && users[0].role === 'viewer' && !JSON.stringify(users).includes('135790'), 'viewer stored device-locally with a hashed PIN');

    await page.getByRole('button', { name: 'Lock app' }).click();
    await page.locator('#login-user').selectOption({ label: 'E2E Viewer (Viewer)' });
    await page.locator('#login-pin').fill('135790');
    await page.getByText('Viewer · shared device').waitFor({ timeout: 15000 });
    check(await page.getByRole('link', { name: 'New invoice' }).count() === 0, 'viewer: no "New invoice" in the navigation or dashboard');

    await page.goto(srv.origin + '/transactions');
    await page.getByText('Acme Buyers').first().waitFor();
    check(await page.getByRole('button', { name: /^Delete INV/ }).count() === 0 && await page.getByRole('button', { name: /^Preview INV/ }).count() > 0,
      'viewer: invoices can be previewed but not deleted');

    await page.goto(srv.origin + '/invoice');
    await page.getByText('cannot create documents', { exact: false }).waitFor();
    check(page.url().endsWith('/transactions'), 'viewer: the editor route redirects with a message');

    await page.goto(srv.origin + '/settings?tab=security');
    await page.getByText('Your role: Viewer').waitFor();
    check(await page.getByText('Users on this device').count() === 0 && await page.getByRole('button', { name: 'Turn on vault mode' }).count() === 0
      && await page.getByRole('tab', { name: /Data & backup/ }).count() === 0, 'viewer: no users, vault or data/backup settings');

    await page.getByRole('button', { name: 'Lock app' }).click();
    await page.locator('#login-user').selectOption({ label: 'E2E Trader (Owner)' });
    await page.locator('#login-pin').fill('482916');
    await page.getByText('Stored on this device').waitFor({ timeout: 15000 });
    check(await page.getByRole('link', { name: 'New invoice' }).count() > 0, 'owner signed back in with full access');
  });

  await step('advances: record a service advance, raise an invoice, apply it, see Table 11', async () => {
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    // Received last month (the GST page opens on the previous month), invoiced today.
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const advDay = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-01`;

    await page.goto(srv.origin + '/receivables?tab=advances');
    await page.getByRole('button', { name: 'Record advance' }).click();
    const dlg = page.getByRole('dialog', { name: 'Record an advance' });
    await dlg.getByLabel('Received from *').fill('Advance Client');
    await dlg.getByLabel('Amount received (₹) *').fill('11800');
    await dlg.getByLabel('Date received *').fill(advDay);
    await dlg.getByLabel('GST rate of the supply').selectOption('18');
    await dlg.getByLabel('Place of supply *').selectOption('27');
    await dlg.getByText(/GST due on this advance: ₹1,800\.00/).waitFor();
    await dlg.getByRole('button', { name: 'Save advance' }).click();
    await dlg.waitFor({ state: 'detached' });
    const adv = (await readJson(page, 'advances', [], (v) => v.length === 1))[0];
    check(/^ADV\/FY\d\d-\d\d\/0001$/.test(adv?.number ?? '') && adv.tax?.cgst === 900 && adv.tax?.sgst === 900 && adv.tax?.taxable === 10000,
      `advance stored with its receipt voucher number and GST (${adv?.number}, CGST ${adv?.tax?.cgst})`);

    const invoices = await readJson(page, 'invoices', []);
    invoices.push({
      id: 'adv-inv', invoice_number: 'INV/ADV/0001', doc_type: 'INVOICE', status: 'Sent', issue_date: today, due_date: today, currency: 'INR',
      template_id: 'classic_orange', client: { name: 'Advance Client', email: '', address: '', city: '', zip: '' },
      sender: { companyName: 'E2E Trader', companyGstin: '27AAPFU0939F1ZV', stateCode: '27' },
      items: [{ id: 'l1', name: 'Retainer', type: 'Service', hsn: '998311', quantity: 1, rate: 20000, tax_rate: 18, amount: 20000 }], gst_mode: 'CGST_SGST',
      place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, shipping: 0, other_charges: 0,
      round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: 20000, discount_amount: 0, taxable_value: 20000, cgst_amount: 1800,
      sgst_amount: 1800, igst_amount: 0, tax_amount: 3600, round_off: 0, total: 23600, balance_due: 23600,
    });
    await writeJson(page, 'invoices', invoices);

    await page.goto(srv.origin + '/receivables?tab=advances');
    await page.getByRole('button', { name: `Apply advance ${adv.number}` }).click();
    const apply = page.getByRole('dialog', { name: `Apply ${adv.number}` });
    const sel = apply.getByLabel('Invoice');
    await sel.selectOption(await sel.locator('option', { hasText: 'INV/ADV/0001' }).getAttribute('value'));
    await apply.getByLabel('Amount to apply (₹)').fill('11800');
    await apply.getByRole('button', { name: 'Apply advance', exact: true }).click();
    await apply.waitFor({ state: 'detached' });
    const tx = (await readJson(page, 'transactions', [], (v) => v.some((t) => t.advance_id === adv.id))).find((t) => t.advance_id === adv.id);
    const inv = (await readJson(page, 'invoices', [], (v) => v.find((i) => i.id === 'adv-inv')?.status === 'Partially Paid')).find((i) => i.id === 'adv-inv');
    check(tx?.amount === 11800 && tx.invoice_id === 'adv-inv' && tx.date === today, `the adjustment is a payment on the invoice (${tx?.amount}, ${tx?.date})`);
    check(inv?.status === 'Partially Paid' && inv.balance_due === 11800, `the invoice is partly paid (${inv?.status}, balance ${inv?.balance_due})`);

    await page.goto(srv.origin + '/gst-reports?tab=at');
    const t11a = page.getByRole('table', { name: 'Advances received, Table 11A' });
    await t11a.getByText('10,000.00').first().waitFor();
    await t11a.getByText('900.00').first().waitFor();
    check(true, 'GSTR-1 Table 11A shows the advance in the month received (taxable 10,000, CGST 900)');
    await page.getByRole('tab', { name: /Adjusted 11B/ }).click();
    // The adjustment is in the current month: 11B is empty in the previous month's view.
    await page.getByText('No advances adjusted or refunded in this period.').waitFor();
    check(true, 'Table 11B is reported in the month of adjustment, not the month received');
  });

  await step('8G: 390 px editor layout, Record payment in the editor, palette finds by amount, insights tile', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(srv.origin + '/invoice');
    // A5: document details as one line, party extras behind "More details".
    await page.locator('[data-meta-summary]').waitFor();
    check((await page.locator('#due-date').count()) === 0, 'document details are collapsed to one line at 390 px');
    check((await page.getByLabel('Billing address').count()) === 0 && (await page.locator('[data-party-more]').count()) === 1, 'billing address sits behind More details');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `no horizontal scroll in the editor at 390 px (${overflow})`);
    await page.getByLabel('Client name').fill('Gamma Eight');
    await page.getByLabel('Item 1 name').fill('Audit 8G');
    await page.getByLabel('Item 1 quantity').fill('1');
    await page.getByLabel('Item 1 rate').fill('1000');
    await page.keyboard.press('Control+s');
    await closeSendSheet(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    // A2: Record payment from the editor settles the invoice.
    await page.locator('[data-record-payment]').click();
    const dlg = page.getByRole('dialog', { name: 'Record payment' });
    await dlg.waitFor();
    const amount = dlg.getByLabel('Amount');
    if (!(await amount.inputValue())) await amount.fill('1180');
    await dlg.getByRole('button', { name: 'Record payment' }).click();
    const paid = (await readJson(page, 'invoices', [], (v) => v.some((x) => x.client?.name === 'Gamma Eight' && x.status === 'Paid'))).find((x) => x.client?.name === 'Gamma Eight');
    check(paid?.status === 'Paid', `Record payment in the editor marks it Paid (${paid?.status})`);
    await page.keyboard.press('Escape');
    // 8.103 SmartFind: an amount range finds it in the palette.
    await page.goto(srv.origin + '/transactions');
    await page.getByText('Every document you have issued').first().waitFor();
    await page.getByRole('button', { name: /Search invoices/ }).first().click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('gamma 1.1k-1.2k');
    await palette.getByRole('option', { name: new RegExp(paid?.invoice_number.replace(/[/]/g, '\\/') ?? 'INV') }).first().waitFor();
    check(true, 'palette finds the invoice by party + amount range');
    await page.keyboard.press('Escape');
    // 8.108 insights tile on the dashboard.
    await page.goto(srv.origin + '/');
    await page.locator('[data-tile="insights"] [data-insight="revenue"]').waitFor({ timeout: 15000 });
    check(true, 'dashboard shows the offline insights tile');
  });

  await step('an existing localStorage user moves to IndexedDB on first load', async () => {
    // A device last used by a pre-4.x build: data in localStorage, schema v1, logo inline in the snapshot.
    const logo = `data:image/png;base64,${LOGO_PNG}`;
    const legacy = {
      mrchartist_inv_schema_version: '1',
      mrchartist_inv_settings: JSON.stringify({ profiles: [{ id: 'p1', companyName: 'Legacy Co', logo }], activeProfileId: 'p1', onboarded: true }),
      mrchartist_inv_invoices: JSON.stringify([{ id: 'old-1', invoice_number: 'INV/FY24-25/0001', sender: { id: 'p1', companyName: 'Legacy Co', logo }, items: [], total: 100 }]),
      mrchartist_inv_clients: JSON.stringify([{ id: 'c1', name: 'Old Client' }]),
    };
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    await ctx.addInitScript((data) => {
      if (sessionStorage.getItem('seeded')) return; // seed once per tab, before the app runs
      sessionStorage.setItem('seeded', '1');
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, legacy);
    const p2 = await ctx.newPage();
    watch(p2, errors);
    await p2.goto(srv.origin + '/');
    const inv = await readJson(p2, 'invoices', [], (v) => v.length === 1 && /^asset:/.test(v[0].sender?.logo ?? ''));
    const assets = await readJson(p2, 'assets', []);
    const clients = await readJson(p2, 'clients', []);
    const left = await p2.evaluate(() => Object.keys(localStorage).filter((k) => /^mrchartist_inv_(invoices|clients|settings|schema_version)$/.test(k)));
    check(inv.length === 1 && clients.length === 1 && left.length === 0,
      `localStorage tables copied to IndexedDB and the copy removed (${inv.length} invoice, ${clients.length} client, ${left.length} left behind)`);
    check(/^asset:/.test(inv[0]?.sender?.logo ?? '') && assets.length === 1 && assets[0].data === logo,
      'the v2 migration ran on the moved data: the inline logo is now one shared asset');
    await p2.reload();
    const again = await readJson(p2, 'invoices', []);
    check(again.length === 1 && again[0].id === 'old-1', 'after a reload the data is served from IndexedDB');
    await ctx.close();
  });

  await step('vault mode: encrypt at rest, unlock after reload, turn off', async () => {
    const PASS = 'e2e vault passphrase';
    await page.goto(srv.origin + '/settings?tab=security');
    await page.getByRole('button', { name: 'Turn on vault mode' }).click();
    await page.locator('#vault-pass').fill(PASS);
    await page.locator('#vault-pass2').fill(PASS);
    await page.getByLabel(/lost passphrase means lost data/).check();
    await page.getByRole('button', { name: 'Encrypt my data' }).click();
    await page.getByText('Vault mode is on', { exact: false }).first().waitFor({ timeout: 20000 });
    const sealed = await idbGet(page, 'mrchartist_inv_clients');
    check(typeof sealed === 'string' && sealed.startsWith('mcv1:') && !sealed.includes('Acme'),
      `client table is encrypted in IndexedDB (${String(sealed).slice(0, 12)}…)`);

    await page.reload();
    await page.getByRole('heading', { name: 'Unlock your vault' }).waitFor();
    await page.getByLabel('Vault passphrase').fill('not the passphrase');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('alert').getByText('Wrong passphrase').waitFor({ timeout: 20000 });
    check(true, 'a wrong passphrase is refused');
    await page.getByLabel('Vault passphrase').fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByRole('button', { name: 'Turn off' }).waitFor({ timeout: 20000 });
    check(true, 'the right passphrase opens the app');

    await page.getByRole('button', { name: 'Turn off' }).click();
    await page.locator('#vault-current').fill(PASS);
    await page.getByRole('button', { name: 'Turn off vault mode' }).click();
    await page.getByText('Vault mode is off', { exact: false }).first().waitFor({ timeout: 20000 });
    const clients = await readJson(page, 'clients', []);
    check(clients.some((c) => c.name === 'Acme Buyers'), 'turning it off writes the data back readable');
  });

  await step('separate companies: create, switch, data stays apart, switch back, delete', async () => {
    await page.goto(srv.origin + '/settings?tab=data');
    await page.getByLabel('New company').fill('E2E Second Co');
    await page.getByRole('button', { name: 'Add company' }).click();
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('listitem').filter({ hasText: 'E2E Second Co' }).getByRole('button', { name: 'Switch' }).click(),
    ]);
    await page.locator('#company-switch').waitFor({ timeout: 15000 });
    check(await page.locator('#company-switch').inputValue() !== 'default', 'reloaded into the new company; the sidebar switcher appears');
    await page.goto(srv.origin + '/clients');
    await page.waitForTimeout(500);
    check(await page.getByText('Acme Buyers').count() === 0, 'the new company does not see the main company’s clients');
    await Promise.all([page.waitForEvent('load'), page.locator('#company-switch').selectOption('default')]);
    await page.goto(srv.origin + '/clients');
    await page.getByText('Acme Buyers').first().waitFor({ timeout: 15000 });
    check(true, 'switching back shows the main company’s data');
    await page.goto(srv.origin + '/settings?tab=data');
    await page.getByRole('listitem').filter({ hasText: 'E2E Second Co' }).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('textbox').fill('E2E Second Co');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete company' }).click();
    await page.getByText('"E2E Second Co" deleted.').first().waitFor({ timeout: 15000 });
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    check(!dbs.some((n) => n?.startsWith('mrchartist_inv_kv__')), `the company database is removed (${dbs.join(', ')})`);
  });

  await step('several bank accounts: add one, pick it for the BRS, remove it', async () => {
    await page.goto(srv.origin + '/reconcile');
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.locator('#ba-name').fill('ICICI current');
    await page.locator('#ba-opening').fill('500');
    await page.locator('#ba-asof').fill('2026-04-01');
    await page.getByRole('button', { name: 'Save account' }).click();
    await page.locator('#rec-account').waitFor();
    const options = await page.locator('#rec-account option').allTextContents();
    check(options.length === 2 && options.some((o) => o.startsWith('ICICI current')), `account picker lists both accounts (${options.join(' | ')})`);
    const stored = await readJson(page, 'bank_accounts', [], (v) => v.length > 0);
    check(stored.some((a) => a.name === 'ICICI current' && a.opening === 500), 'the account and its opening are saved');
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.locator('#rec-account').waitFor({ state: 'detached' });
    check(true, 'an unused account can be deleted; the picker goes away with one account');
  });

  await step('8F distribution: add an area and a beat, beat plan and reports render, stock analysis tab loads', async () => {
    await page.goto(srv.origin + '/distribution?tab=masters');
    await page.locator('[data-area-name]').fill('E2E North');
    await page.locator('[data-area-name]').press('Enter');
    await readJson(page, 'dist_areas', [], (v) => v.some((a) => a.name === 'E2E North'));
    await page.locator('[data-beat-name]').fill('E2E Market Rd');
    await page.getByRole('checkbox', { name: 'Mon' }).check();
    await page.getByRole('button', { name: 'Add beat' }).click();
    const beats = await readJson(page, 'dist_beats', [], (v) => v.some((b) => b.name === 'E2E Market Rd'));
    check(beats.find((b) => b.name === 'E2E Market Rd')?.days?.includes(1), 'beat saved with its visiting weekday');
    await page.getByRole('tab', { name: 'Reports' }).click();
    await page.locator('[data-dist-reports]').waitFor({ timeout: 15000 });
    await page.getByRole('tab', { name: 'Beat plan' }).click();
    await page.locator('[data-beat-plan]').waitFor({ timeout: 15000 });
    const prevStock = await readJson(page, 'stock_items', []);
    await writeJson(page, 'stock_items', [...prevStock, { id: 'e2e-8f', name: 'E2E Soap', unit: 'NOS', track_stock: true, opening_qty: 5, opening_rate: 10, reorder_level: 0 }]);
    await page.goto(srv.origin + '/inventory?tab=analysis');
    await page.locator('[data-stock-analysis]').waitFor({ timeout: 15000 });
    check(await page.locator('[data-move-class="non"]').filter({ hasText: 'E2E Soap' }).count() === 1, 'stock analysis: an item with no outward is non-moving');
    await writeJson(page, 'stock_items', prevStock.length ? prevStock : null);
    await writeJson(page, 'dist_beats', null);
    await writeJson(page, 'dist_areas', null);
  });

  await step('R2-C: text size 130% applies before paint, no sideways scroll at 360 px; annual pack renders its pages', async () => {
    await page.goto(srv.origin + '/settings?tab=security');
    await page.locator('[data-display-prefs]').waitFor({ timeout: 15000 });
    await page.locator('[data-text-scale="130"]').click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_display_prefs') ?? 'null'));
    check(stored?.text_scale === 130 && (await idbGet(page, 'mrchartist_display_prefs')) === null, 'display prefs: device-local key in localStorage only');
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto(srv.origin + '/');
    await page.waitForLoadState('domcontentloaded');
    const fs = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    check(fs === '20.8px', `130% text applied from theme-init.js before the app boots (${fs})`);
    await page.locator('main').first().waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(() => Math.max(0, ...[document.documentElement, ...document.querySelectorAll('main')].map((e) => e.scrollWidth - e.clientWidth)));
    check(overflow <= 1, `no horizontal scroll at 360 px and 130% (${overflow}px)`);
    await page.evaluate(() => localStorage.removeItem('mrchartist_display_prefs'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(srv.origin + '/books?tab=rpt');
    await page.getByRole('button', { name: 'Annual pack' }).click();
    await page.locator('[data-annual-preview] .ap-page').first().waitFor({ timeout: 15000 });
    check(await page.locator('[data-annual-preview] .ap-page').count() === 6, 'annual pack: cover, balance sheet, P&L, cash flow, trial balance, notes');
    check(/verify with your CA/.test((await page.locator('[data-annual-preview]').textContent()) ?? ''), 'annual pack carries the "verify with your CA" draft line');
    // QA-3 F18: a year still running is an interim pack to date, never "As at 31 Mar" of a year that has not ended.
    const packText = (await page.locator('[data-annual-preview]').textContent()) ?? '';
    const fyEnd = await page.evaluate(() => { const d = new Date(); return d.getMonth() === 2 && d.getDate() === 31; });
    check(fyEnd || (/interim/i.test(packText) && !/For the year ended/.test(packText)), 'annual pack during the year is labelled interim, to date');
  });

  await step('R2-B batch invoices: one saved invoice billed to two parties as drafts, numbered in order; undo deletes them', async () => {
    const prevInvoices = await readJson(page, 'invoices', []);
    const prevClients = await readJson(page, 'clients', []);
    const src = prevInvoices.find((i) => (i.doc_type === 'INVOICE' || i.doc_type === 'TAX_INVOICE') && i.status !== 'Cancelled');
    check(!!src, 'a saved invoice to use as the source');
    if (!src) return;
    await writeJson(page, 'clients', [...prevClients,
      { id: 'e2e-b1', name: 'E2E Member One', email: '', address: '', city: 'Pune', zip: '', state_code: '27' },
      { id: 'e2e-b2', name: 'E2E Member Two', email: '', address: '', city: 'Bengaluru', zip: '', state_code: '29' }]);
    await page.goto(srv.origin + '/recurring?tab=batch');
    await page.locator('[data-batch-tab]').waitFor({ timeout: 15000 });
    await page.locator('[data-batch-source]').selectOption(src.id);
    await page.locator('[data-batch-search]').fill('E2E Member');
    await page.locator('[data-batch-select-all]').click();
    await page.locator('[data-batch-preview]').waitFor();
    check((await page.locator('[data-batch-preview]').textContent())?.includes('IGST') === true, 'the Karnataka party is billed IGST in the preview');
    await page.locator('[data-batch-issue]').click();
    await page.locator('[data-batch-result]').waitFor();
    const after = await readJson(page, 'invoices', [], (v) => v.length === prevInvoices.length + 2);
    const made = after.filter((i) => !prevInvoices.some((p) => p.id === i.id));
    check(made.length === 2 && made.every((i) => i.status === 'Draft'), 'two draft invoices saved');
    const runs = await readJson(page, 'batch_runs', [], (v) => v.length > 0);
    check(runs[0]?.invoice_ids?.length === 2, 'the run is recorded');
    await page.locator('[data-batch-runs] button').first().click();
    await page.locator('[data-batch-undo]').click();
    await readJson(page, 'invoices', [], (v) => v.length === prevInvoices.length);
    check(true, 'undo removed the run\'s drafts');
    await writeJson(page, 'clients', prevClients);
    await writeJson(page, 'batch_runs', null);
  });

  await step('QA-3 QA-2: document strip first with the type inline; a quotation offers no payment; one invoice target in Convert; quote "Valid until"; bill Esc asks first', async () => {
    const prevInvoices = await readJson(page, 'invoices', []);
    const prevClients = await readJson(page, 'clients', []);
    const prevItems = await readJson(page, 'items_catalog', []);
    await page.goto(srv.origin + '/invoice');
    const type = page.locator('[data-meta-type]');
    await type.waitFor({ timeout: 15000 });
    const stripFirst = await page.evaluate(() => {
      const strip = document.querySelector('[data-meta-summary]');
      const client = document.querySelector('input[aria-label="Client name"], input[placeholder="Client name *"]');
      return !!strip && !!client && !!(strip.compareDocumentPosition(client) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    check(stripFirst, 'F21: "1 · Document" strip comes before the parties');
    check((await page.locator('[data-save-choice] option').allInnerTexts()).join('|') === 'Just save|Then print|Then WhatsApp', 'F21: the after-save picker does not read as another Save');
    await type.selectOption('QUOTATION');
    await page.getByLabel('Client name').fill('E2E Quote Party');
    await page.getByLabel('Item 1 name').fill('E2E Chairs');
    await page.getByLabel('Item 1 rate').fill('1000');
    await page.keyboard.press('Control+s');
    const sheet = page.locator('[data-send-sheet]');
    await sheet.waitFor({ timeout: 10000 });
    const sheetText = await sheet.innerText();
    check((await sheet.locator('[data-send-pay]').count()) === 0 && !/Balance on this bill/.test(sheetText), 'F3: the quotation sheet shows no balance and no Record payment');
    const mail = decodeURIComponent((await sheet.locator('a[href^="mailto:"]').getAttribute('href')) ?? '');
    check(mail.includes('Quotation') && !mail.includes('*'), 'F23: the e-mail body has no WhatsApp *bold* markers');
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: /^Convert/ }).click();
    const items = await page.getByRole('menuitem').allInnerTexts();
    check(items.some((t) => /Convert to Tax Invoice/.test(t)) && !items.some((t) => /Convert to Invoice$/.test(t.trim())), `F22: one invoice target in the Convert menu (${items.filter((t) => /Invoice/.test(t)).join(', ')})`);
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/transactions');
    const row = page.locator('tr', { hasText: 'E2E Quote Party' }).first();
    await row.waitFor({ timeout: 10000 });
    check(/Valid until/.test(await row.innerText()), 'F22: the ledger shows a quotation as "Valid until"');
    await writeJson(page, 'invoices', prevInvoices);
    await writeJson(page, 'clients', prevClients);
    await writeJson(page, 'items_catalog', prevItems);
    // F12: a purchase bill with a typed line asks before Esc throws it away.
    await page.goto(srv.origin + '/expenses');
    await page.getByRole('button', { name: /Add bill/ }).first().click();
    const bill = page.getByRole('dialog');
    await bill.waitFor();
    await bill.getByLabel(/Line 1 item|line 1/i).first().fill('E2E Steel');
    let asked = '';
    page.once('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(/Discard this bill/.test(asked) && (await bill.isVisible()), 'F12: Esc on a filled bill asks, and Cancel keeps it open');
    page.once('dialog', (d) => d.accept());
    await page.keyboard.press('Escape');
    await bill.waitFor({ state: 'detached' });
  });

  await step('QA-3 F6: recurring from an invoice starts after it; the list refreshes after the first run; Run now asks before billing early; drafts take no number', async () => {
    const prevInvoices = await readJson(page, 'invoices', []);
    const prevSchedules = await readJson(page, 'recurring', []);
    const src = prevInvoices.find((i) => (i.doc_type === 'INVOICE' || i.doc_type === 'TAX_INVOICE') && i.status !== 'Cancelled' && i.status !== 'Draft');
    check(!!src, 'a saved invoice to make recurring');
    if (!src) return;
    const today = await page.evaluate(() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; });
    await page.goto(srv.origin + '/recurring?from=' + src.id);
    const first = page.locator('#rec-start');
    await first.waitFor({ timeout: 15000 });
    check((await first.inputValue()) > src.issue_date, `the first date defaults to after the invoice (${src.issue_date} -> ${await first.inputValue()})`);
    await first.fill(today);
    await page.getByRole('button', { name: 'Create schedule' }).click();
    const after = await readJson(page, 'invoices', [], (v) => v.some((i) => i.recurring_id && !prevInvoices.some((p) => p.id === i.id)), 15000);
    const made = after.filter((i) => !prevInvoices.some((p) => p.id === i.id));
    check(made.length === 1 && made[0].status === 'Draft' && made[0].invoice_number === '', `the first run made one unnumbered draft (${made.map((i) => `${i.status}:${i.invoice_number || '-'}`).join(', ')})`);
    const card = page.locator('article').filter({ has: page.getByRole('button', { name: 'Run now' }) }).last();
    await card.getByText('Run history (1)').waitFor({ timeout: 15000 });
    check(true, 'the schedule card shows the run without a reload');
    await card.getByRole('button', { name: 'Run now' }).click();
    const ask = page.getByRole('dialog', { name: 'Bill the next period early?' });
    await ask.waitFor();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    const still = await readJson(page, 'invoices', []);
    check(still.length === after.length, 'Run now on a period not yet due bills nothing until confirmed');
    await writeJson(page, 'recurring', prevSchedules);
    await writeJson(page, 'invoices', prevInvoices);
  });

  await step('QA-3 F4 / F5: "Explore with sample data instead" fills a Demo company; the Dashboard chooser opens a separate Demo company (R6-B4)', async () => {
    const tableIn = (p, name) => p.evaluate((k) => new Promise((resolve) => {
      const reg = JSON.parse(localStorage.getItem('mrchartist_inv_companies') || 'null');
      const db = reg?.active && reg.active !== 'default' ? `mrchartist_inv_kv__${reg.active}` : 'mrchartist_inv_kv';
      const open = indexedDB.open(db);
      open.onsuccess = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains('data')) { d.close(); resolve(null); return; }
        const req = d.transaction('data', 'readonly').objectStore('data').get(`mrchartist_inv_${k}`);
        req.onsuccess = () => { d.close(); resolve(req.result ? JSON.parse(req.result) : null); };
      };
      open.onerror = () => resolve(null);
    }), name);
    const waitRows = async (p, name, min, timeout = 15000) => {
      const until = Date.now() + timeout;
      for (;;) {
        // The demo flow reloads (twice for the wizard path): a poll caught mid-navigation just retries.
        const rows = (await tableIn(p, name).catch(() => null)) ?? [];
        if (rows.length >= min || Date.now() > until) return rows;
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    const fresh = async () => {
      const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      const p = await ctx.newPage();
      watch(p, errors);
      p.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 10000);
      await p.goto(srv.origin + '/');
      await p.getByLabel('Full name').fill('E2E Demo');
      await p.locator('#login-pin').fill('482916');
      await p.locator('#login-confirm').fill('482916');
      await p.getByRole('button', { name: /Create account/ }).click();
      await p.getByRole('dialog', { name: 'What do you do?' }).waitFor({ timeout: 15000 });
      return { ctx, p };
    };
    // F4: the wizard's demo choice, from its last step.
    const a = await fresh();
    await a.p.getByRole('radio', { name: /CA \/ full accounting/ }).click();
    await a.p.getByRole('button', { name: /Next/ }).click();
    await a.p.getByLabel('Name on invoices *').fill('E2E Demo Traders');
    await a.p.getByRole('button', { name: /Next/ }).click();
    await a.p.getByRole('radio', { name: 'I have a GSTIN' }).click();
    await a.p.getByLabel('GSTIN', { exact: true }).fill('27AAPFU0939F1ZV');
    await a.p.getByRole('button', { name: /Next/ }).click();
    await a.p.getByRole('dialog', { name: 'How clients pay you' }).waitFor();
    await a.p.getByRole('button', { name: /Next/ }).click();
    await a.p.getByRole('dialog', { name: /Logo/ }).waitFor();
    await a.p.getByRole('button', { name: 'Explore with sample data instead' }).click();
    await a.p.locator('#company-switch').waitFor({ timeout: 20000 });
    const demoInv = await waitRows(a.p, 'invoices', 1);
    check(demoInv.length > 0, `the Demo company holds the sample invoices (${demoInv.length})`);
    await a.p.waitForLoadState('load');
    await a.p.locator('#company-switch').waitFor({ timeout: 20000 });
    await a.p.waitForTimeout(500);
    check(await a.p.getByRole('dialog', { name: 'What do you do?' }).count() === 0, 'the wizard does not start again in the Demo company');
    await a.ctx.close();
    // F5: skip the wizard, then the Dashboard card.
    const b = await fresh();
    await b.p.getByRole('button', { name: /Skip for now/ }).first().click();
    await b.p.getByRole('dialog', { name: 'What do you do?' }).waitFor({ state: 'detached' });
    // QA7 G1: a second tab stays open on the real company while the first one opens the Demo company.
    const other = await b.ctx.newPage();
    watch(other, errors);
    other.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 10000);
    await other.goto(srv.origin + '/');
    await other.locator('#login-pin, [data-testid="demo-notice"], button:has-text("Open a separate Demo company")').first().waitFor({ timeout: 15000 });
    if (await other.locator('#login-pin').count()) {
      await other.locator('#login-pin').fill('482916');
      await other.keyboard.press('Enter');
    }
    await other.getByRole('button', { name: 'Open a separate Demo company (recommended)' }).waitFor({ timeout: 15000 });
    await b.p.bringToFront();
    const cta = b.p.getByRole('button', { name: 'Open a separate Demo company (recommended)' });
    await cta.waitFor({ timeout: 15000 });
    await Promise.all([b.p.waitForEvent('load', { timeout: 20000 }), cta.click()]);
    await b.p.locator('#company-switch').waitFor({ timeout: 20000 });
    const sample = await waitRows(b.p, 'invoices', 1, 20000);
    const activeId = await b.p.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_companies') || 'null')?.active ?? 'default');
    check(sample.length > 0 && activeId !== 'default', `the Dashboard chooser filled a separate Demo company (${sample.length} invoices in ${activeId})`);
    await b.p.locator('[data-demo-company]').getByRole('button', { name: /Switch to/ }).waitFor({ timeout: 15000 });
    check(true, 'the Demo banner offers the way back to the company the user came from');
    await other.bringToFront();
    await other.locator('[data-company-moved]').waitFor({ timeout: 15000 });
    check(/another company/i.test(await other.locator('[data-company-moved]').innerText()), 'the stale tab says "This tab is on another company — reload"');
    await other.evaluate(() => { history.pushState({}, '', '/transactions'); dispatchEvent(new PopStateEvent('popstate')); });
    await other.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
    await other.waitForTimeout(1500);
    check(await other.locator('[data-demo-company]').count() === 0, 'the stale tab (real company) shows no Demo banner / Reset samples');
    const mainInvoices = await other.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('mrchartist_inv_kv');
      open.onsuccess = () => {
        const d = open.result;
        const req = d.transaction('data', 'readonly').objectStore('data').get('mrchartist_inv_invoices');
        req.onsuccess = () => { d.close(); resolve(req.result ? JSON.parse(req.result).length : 0); };
        req.onerror = () => { d.close(); resolve(-1); };
      };
      open.onerror = () => resolve(-1);
    }));
    check(mainInvoices === 0, `the real company holds no sample invoice (${mainInvoices})`);
    await Promise.all([other.waitForEvent('load', { timeout: 20000 }), other.locator('[data-company-moved]').getByRole('button', { name: 'Reload' }).click()]);
    await other.locator('#company-switch').waitFor({ timeout: 20000 });
    check(await other.locator('#company-switch').inputValue() === activeId, 'Reload opens the company the device switched to');
    await b.ctx.close();
  });

  await step('R3-C: live preview pane at 1366 px follows typing (not loaded at 390 px); GSTR-1 error file round trip', async () => {
    // C1: the pane is a device toggle on wide screens; typing a line reaches the paper.
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(srv.origin + '/invoice');
    await page.locator('[data-live-preview-toggle]').click();
    const pane = page.locator('[data-live-preview]');
    await pane.waitFor({ timeout: 15000 });
    await page.getByLabel('Client name').fill('Pane Client R3C');
    await page.getByLabel('Item 1 name').fill('Pane line R3C');
    await page.getByLabel('Item 1 quantity').fill('1');
    await page.getByLabel('Item 1 rate').fill('500');
    await pane.getByText('Pane line R3C').first().waitFor({ timeout: 10000 });
    check(true, 'typing a line updates the live preview pane');
    await page.keyboard.press('Control+s');
    await closeSendSheet(page);
    // Phones never request the pane chunk, even with the toggle remembered on.
    const asked = [];
    const onReq = (r) => { if (/LivePreviewPane/.test(r.url())) asked.push(r.url()); };
    await page.setViewportSize({ width: 390, height: 844 });
    page.on('request', onReq);
    await page.goto(srv.origin + '/invoice');
    await page.locator('[data-meta-summary]').waitFor();
    await page.waitForTimeout(500);
    page.off('request', onReq);
    check(asked.length === 0 && (await page.locator('[data-live-preview]').count()) === 0, `no pane chunk requested at 390 px (${asked.length})`);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(srv.origin + '/invoice');
    await page.locator('[data-live-preview-toggle]').click(); // back off for the steps that follow
    await page.locator('[data-live-preview]').waitFor({ state: 'detached' });

    // C4: a B2B invoice of last month, the portal's error report for it (fixture), corrected JSON of the failed document.
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 10);
    const mm = String(prev.getMonth() + 1).padStart(2, '0');
    const day = `${prev.getFullYear()}-${mm}-10`;
    const fp = `${mm}${prev.getFullYear()}`;
    const before = await readJson(page, 'invoices', []);
    const num = 'INV/R3C/0007';
    await writeJson(page, 'invoices', [...before, {
      id: 'r3c-b2b', invoice_number: num, doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: day, due_date: day, currency: 'INR',
      template_id: 'classic_orange', client: { name: 'Portal Buyer', gstin: '27AAACB2230M1ZW', email: '', address: '', city: 'Pune', zip: '', state: 'Maharashtra' },
      sender: { companyName: 'E2E Trader', companyGstin: '27AAPFU0939F1ZV', stateCode: '27' },
      items: [{ id: 'l1', name: 'Pump', type: 'Goods', hsn: '8413', quantity: 1, rate: 1000, tax_rate: 18, amount: 1000 }], gst_mode: 'CGST_SGST',
      place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, shipping: 0, other_charges: 0,
      round_off_enabled: false, amount_paid: 0, notes: '', terms: '', subtotal: 1000, discount_amount: 0, taxable_value: 1000, cgst_amount: 90,
      sgst_amount: 90, igst_amount: 0, tax_amount: 180, round_off: 0, total: 1180, balance_due: 1180,
    }]);
    let fixture = readFileSync(new URL('../fixtures/gstr1-error-report.json', import.meta.url), 'utf8');
    const vals = { GSTIN: '', FP: fp, CTIN: '27AAACB2230M1ZW', INUM: num.toLowerCase(), IDT: `10-${mm}-${prev.getFullYear()}` };
    for (const [k, v] of Object.entries(vals)) fixture = fixture.replaceAll(`{{${k}}}`, v);
    await page.goto(srv.origin + '/gst-reports?tab=portal-files');
    await page.locator('[data-portal-files]').waitFor({ timeout: 15000 });
    const upload = () => page.locator('[data-portal-file-input]').setInputFiles({ name: 'GSTR1_error_report.json', mimeType: 'application/json', buffer: Buffer.from(fixture) });
    await upload();
    const findings = page.locator('[data-portal-findings]');
    await findings.waitFor({ timeout: 10000 });
    check(await findings.getByRole('link', { name: num }).count() > 0, 'the portal error is matched to our invoice (normalised number + GSTIN + date)');
    const saved = await readJson(page, 'gst_portal_files', [], (v) => v.length === 1);
    check(saved[0]?.kind === 'gstr1_error' && saved[0].findings.some((f) => f.invoice_id === 'r3c-b2b'), 'the import is saved with its findings');
    const dlP = page.waitForEvent('download');
    await page.locator('[data-portal-corrected]').click();
    if (await page.locator('[data-portal-preflight]').count()) await page.getByRole('button', { name: 'Download anyway' }).click();
    const dl = await dlP;
    const body = JSON.parse(readFileSync(await dl.path(), 'utf8'));
    const invs = (body.b2b ?? []).flatMap((g) => g.inv);
    check(invs.length === 1 && invs[0].inum === num && body.fp === fp && !body.b2cs, `corrected JSON holds only the failed document (${invs.map((i) => i.inum).join(',')})`);
    check(await page.locator('[data-filing-portal-errors]').count() === 1, 'the filing strip shows the "Portal files (n)" step');
    await upload();
    await page.locator('[data-portal-status]').getByText(/already read/).waitFor();
    check((await readJson(page, 'gst_portal_files', [])).length === 1, 're-importing the same file is detected, not saved twice');
    await writeJson(page, 'invoices', before);
    await writeJson(page, 'gst_portal_files', null);
  });

  await step('R5-C non-profit pack: turn it on, issue a donation receipt, see its Form 10BD CSV row and the fund statement', async () => {
    await page.goto(srv.origin + '/settings?tab=defaults');
    const box = page.locator('[data-industry-packs] label', { hasText: 'Non-profit' }).locator('input');
    await box.waitFor({ timeout: 15000 });
    if (!(await box.isChecked())) await box.check();
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => Array.isArray(v.industry_packs) && v.industry_packs.includes('nonprofit'));
    check(st.industry_packs?.includes('nonprofit'), 'the non-profit pack is on');
    const before = await readJson(page, 'donations', []);
    await page.goto(srv.origin + '/receivables?tab=donations');
    await page.locator('[data-donation-new]').click({ timeout: 15000 });
    await page.locator('[data-donor-name]').fill('E2E Donor Trust');
    await page.locator('[data-donor-id]').fill('ABCPD1234F');
    await page.locator('[data-donation-amount]').fill('5000');
    await page.locator('[data-donation-save]').click();
    const after = await readJson(page, 'donations', [], (v) => v.length === before.length + 1);
    const don = after.find((d) => !before.some((b) => b.id === d.id));
    check(/^DON\/FY\d{2}-\d{2}\/\d{4}$/.test(don?.number ?? '') && !!don?.voucher_id, `donation receipt ${don?.number} with its receipt voucher`);
    await page.locator('[data-r5c-view="form10bd"]').click();
    const t = new Date();
    const fy = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
    await page.locator('[data-10bd-panel] select').first().selectOption(String(fy));
    await page.locator('[data-10bd-rows]', { hasText: 'E2E Donor Trust' }).waitFor();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-10bd-csv]').click()]);
    const csv = readFileSync(await dl.path(), 'utf8');
    check(/Unique Identification Number/.test(csv) && /Permanent Account Number,ABCPD1234F,Section 80G,.*E2E Donor Trust.*,5000/.test(csv), 'the 10BD CSV has the donor row in template column order');
    await page.goto(srv.origin + '/books?tab=funds&view=statement');
    const stmt = page.locator('[data-fund-statement]');
    await stmt.waitFor({ timeout: 15000 });
    const text = await stmt.textContent();
    check(/General fund/.test(text ?? '') && /Donations received/.test(text ?? '') && /5,000\.00/.test(text ?? ''), 'the General fund statement shows the donation');
  });

  await step('R6-B discoverability: Ctrl+K "3b" opens GSTR-3B; kirana "more features" opens Features; empty Books / Inventory say what to do', async () => {
    // B1: a tab found by its portal short form.
    await page.goto(srv.origin + '/');
    await page.getByRole('navigation', { name: /Primary/ }).getByRole('link', { name: 'Dashboard' }).waitFor();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.locator('[data-palette-try]').waitFor();
    check(true, 'the empty palette shows the "Try: GSTR-3B · …" line');
    await palette.getByRole('combobox').fill('3b');
    await palette.getByRole('option', { name: /GSTR-3B/ }).first().waitFor();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/gst-reports\?tab=gstr3b/);
    check(true, 'Ctrl+K "3b" → Enter opens GST reports → GSTR-3B');

    // B2 / B5: kirana shop mode hides features; the sidebar says so and the link opens Settings → Features.
    const nav = page.getByRole('navigation', { name: /Primary/ });
    await nav.getByRole('link', { name: 'Distribution' }).waitFor();
    await nav.getByRole('link', { name: 'Manufacturing' }).waitFor();
    check(true, 'the sidebar lists Distribution and Manufacturing');
    await page.goto(srv.origin + '/settings?tab=defaults');
    await page.getByLabel('Business type').selectOption('kirana');
    await page.getByRole('button', { name: 'Save settings' }).click();
    const more = nav.getByRole('link', { name: /more features — Show/ });
    await more.waitFor();
    await more.click();
    await page.waitForURL(/\/settings\?tab=features/);
    await page.locator('[data-features-panel]').waitFor();
    check((await page.locator('[data-feature="mod.payroll"]').count()) === 1 && (await page.locator('[data-feature="adv.batches"]').count()) === 1, 'Settings → Features lists modules and advanced options');
    await page.locator('[data-features-panel]').getByRole('button', { name: 'Show all features' }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await nav.getByRole('link', { name: 'Books' }).waitFor();
    check((await nav.getByRole('link', { name: /more features/ }).count()) === 0, '"Show all features" from Features brings every module back; the hint goes');

    // B3: a fresh company's Books and Inventory say what fills them.
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    try {
      const p = await ctx.newPage();
      watch(p, errors);
      p.setDefaultTimeout(Number(process.env.E2E_TIMEOUT) || 10000);
      await p.goto(srv.origin + '/');
      await p.getByLabel('Full name').fill('E2E Empty');
      await p.locator('#login-pin').fill('482916');
      await p.locator('#login-confirm').fill('482916');
      await p.getByRole('button', { name: /Create account/ }).click();
      await p.getByRole('dialog', { name: 'What do you do?' }).waitFor({ timeout: 15000 });
      await p.getByRole('button', { name: /Skip for now/ }).first().click();
      await p.goto(srv.origin + '/books?tab=tb');
      await p.locator('[data-books-empty]').getByRole('link', { name: 'Opening balances' }).waitFor();
      check(true, 'empty Books shows "Opening balances"');
      await p.goto(srv.origin + '/inventory');
      await p.getByRole('button', { name: 'Add first item' }).waitFor();
      await p.locator('[data-inv-import]').waitFor();
      check(true, 'empty Inventory shows "Add first item" and "Import items"');
    } finally {
      await ctx.close();
    }
  });

  await step('folder sync: the panel offers setup, or says "not supported" without the File System Access API', async () => {
    // The folder picker cannot be driven headless; the merge itself is covered by tests/sync.test.ts.
    await page.goto(srv.origin + '/settings?tab=data');
    await page.locator('#sync-title').waitFor({ timeout: 15000 });
    const supported = await page.evaluate(() => typeof window.showDirectoryPicker === 'function');
    if (supported) {
      await page.getByRole('button', { name: 'Choose sync folder' }).waitFor({ timeout: 15000 });
      check(await page.locator('#sync-device-name').inputValue() !== '', 'setup state: device name prefilled, folder picker offered');
    } else {
      await page.getByTestId('sync-unsupported').waitFor({ timeout: 15000 });
      check(true, 'this browser reports folder sync as not supported');
    }
    // Last step: the same signed-in tab, reloaded as a browser without the API (Safari / Firefox).
    const p3 = page;
    await p3.addInitScript(() => {
      try {
        delete window.showDirectoryPicker;
      } catch {
        /* fall through */
      }
      if (typeof window.showDirectoryPicker === 'function') Object.defineProperty(window, 'showDirectoryPicker', { value: undefined });
    });
    await p3.goto(srv.origin + '/settings?tab=data');
    await p3.getByTestId('sync-unsupported').waitFor({ timeout: 15000 });
    const text = await p3.getByTestId('sync-unsupported').textContent();
    check(/not supported/.test(text ?? '') && /backup/.test(text ?? ''), 'without File System Access: "not supported", use backup / restore');
    const local = await p3.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_sync_device') ?? 'null'));
    check(typeof local?.id === 'string' && (await idbGet(p3, 'mrchartist_inv_sync_device')) === null, 'the device id lives in localStorage only (never in the data store or a backup)');
  });

  await step('R6-A help: "On this screen", About strip, glossary term, version', async () => {
    await page.goto(srv.origin + '/gst-reports?tab=cdnur');
    const strip = page.locator('[data-about-strip="gst-reports:cdnur"]');
    await strip.waitFor({ timeout: 15000 });
    check(/credit and debit notes/i.test(await strip.innerText()), 'GST → CDNUR shows its "About this tab" strip');
    // F1 is wired by the shell (R6-B); the Help button opens the same dialog.
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    const help = page.locator('[data-screen-help="gst-reports:cdnur"]');
    await help.waitFor({ timeout: 15000 });
    check(/On this screen: CDNUR/.test(await help.innerText()), 'Help opens on "On this screen: CDNUR"');
    check(/CA checklist: G8/.test(await help.innerText()), 'the statutory topic names its CA checklist ids');
    check(/Version \d+\.\d+\.\d+/.test(await page.locator('[data-app-version]').innerText()), 'Help shows the package.json version');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/gst-reports?tab=b2cl');
    await page.locator('[data-term="b2cl"]').first().click();
    const pop = page.locator('[data-term-pop="b2cl"]');
    await pop.waitFor({ timeout: 15000 });
    await page.waitForFunction(() => /In this app/.test(document.querySelector('[data-term-pop="b2cl"]')?.textContent ?? ''));
    check(/unregistered/i.test(await pop.innerText()), 'tapping B2CL opens its glossary popover');
  });

  await step('QA7 G3: F1 over a form opens nothing; Help stacked over a form closes alone on Escape, the form keeps its text', async () => {
    await page.goto(srv.origin + '/clients?new=1');
    const form = page.getByRole('dialog').first();
    await form.waitFor({ timeout: 15000 });
    await form.locator('input').first().fill('Asha Stack Test');
    await form.locator('h2').first().click();
    await page.keyboard.press('F1');
    await page.waitForTimeout(800);
    check(await page.getByRole('dialog').count() === 1, 'F1 does not stack Help over an open dialog');
    // Help can still be stacked from inside a dialog (a "Learn more" link): one Escape closes only Help.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('mrchartist:open-help', { detail: {} })));
    await page.locator('[data-app-version]').waitFor({ timeout: 15000 });
    check(await page.getByRole('dialog').count() === 2, 'Help is open over the form');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    check(await page.getByRole('dialog').count() === 1, 'one Escape closes only the top dialog');
    check(await page.getByRole('dialog').first().locator('input').first().inputValue() === 'Asha Stack Test', 'the form keeps what was typed');
  });

  await step('R6-C import openings: a pasted trial balance shows the 1090 difference in the dry run and saves the openings', async () => {
    await page.goto(srv.origin + '/settings?tab=data&import=ledgers');
    // Earlier steps may have left openings in this company: the dry run shows the difference after the import.
    const before = await readJson(page, 'ledger_openings', [], () => true);
    const diff = before.reduce((s, o) => s + (o.dr || 0) - (o.cr || 0), 0) - 10000;
    const want = `Difference in opening balances: ₹${(Math.abs(diff) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${diff > 0 ? 'Dr' : 'Cr'}`;
    await page.getByRole('button', { name: 'Paste instead' }).click({ timeout: 15000 });
    await page.locator('#import-paste').fill('Name,Group,Debit,Credit\nE2E Partner Capital,Capital Account,,1000\nE2E Current Account,Bank Accounts,900,');
    await page.getByRole('button', { name: 'Use pasted data' }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Next/ }).click();
    const note = await page.getByTestId('import-openings-note').textContent({ timeout: 15000 });
    check(diff !== 0 && (note ?? '').includes(want), `the dry run shows the difference in opening balances (${want}; shown: ${note})`);
    await page.getByRole('button', { name: /^Import 2 records/ }).click();
    const rows = await readJson(page, 'ledger_openings', [], (v) => v.length >= before.length + 2, 10000);
    check(rows.length >= before.length + 2, `the openings are saved (${rows.length})`);
    const runs = await readJson(page, 'import_runs', [], (v) => v.some((r) => r.kind === 'ledgers'));
    check(runs.some((r) => r.kind === 'ledgers'), 'the import run is recorded');
  });
  await step('R8-C trade profile + agency: Wholesale → Commission agent, an arrival of 80 bags, an agency sale from the lot, a bikri patti with its net payable; Ctrl+K "patti"; F1 help', async () => {
    const keys = ['settings', 'vendors', 'clients', 'invoices', 'arrivals', 'sale_pattis', 'godowns', 'vouchers', 'accounts', 'series_counters'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const settings = prev.settings ?? {};
    await writeJson(page, 'settings', { ...settings, business_type: 'wholesale', modules: undefined, industry_packs: undefined, trade_kind: undefined, lock_until: undefined });
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-trade-kind-card="agent"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.trade_kind === 'agent');
    check(st.trade_kind === 'agent' && st.business_type === 'wholesale' && st.industry_packs?.includes('agency') && !st.modules?.includes('pos'), 'Commission agent: wholesale, agency + commodity packs, no POS module');
    await writeJson(page, 'vendors', [...(prev.vendors ?? []), { id: 'e2e-farmer', name: 'E2E Ram Singh', principal_kind: 'agriculturist' }]);
    await page.goto(srv.origin + '/distribution?tab=agency');
    await page.locator('[data-agency-tab]').waitFor({ timeout: 15000 });
    check((await page.locator('a[href="/pos"]').count()) === 0, 'the sidebar has no POS entry');
    await page.locator('[data-arrival-form] summary').click();
    await page.locator('[data-arrival-principal]').selectOption('e2e-farmer');
    await page.locator('[data-arrival-lot]').fill('E2E-L1');
    await page.locator('[data-arrival-item]').fill('E2E Mustard');
    await page.locator('[data-arrival-packages]').fill('80');
    await page.locator('[data-arrival-qty]').fill('40');
    await page.locator('[data-arrival-save]').click();
    const arrivals = await readJson(page, 'arrivals', [], (v) => v.some((a) => a.lot_no === 'E2E-L1'));
    const arr = arrivals.find((a) => a.lot_no === 'E2E-L1');
    const godowns = await readJson(page, 'godowns', []);
    check(/^ARR\/FY\d{2}-\d{2}\/\d+$/.test(arr?.number ?? '') && godowns.some((g) => g.id === arr.godown_id && g.kind === 'consignment'), `arrival ${arr?.number} in the consignment godown`);
    // The editor offers the lot on a sale line (the sale itself is saved directly; the editor flow is covered above).
    await page.goto(srv.origin + '/invoice');
    const picker = page.locator('[data-lot-picker="0"]');
    await picker.waitFor({ timeout: 15000 });
    check((await picker.locator('option', { hasText: 'E2E-L1' }).count()) === 1, 'the editor line offers the lot');
    const buyer = { id: 'e2e-buyer', name: 'E2E Grain Buyer', email: '', address: 'Jaipur', city: 'Jaipur', zip: '', state_code: '08' };
    await writeJson(page, 'clients', [...(prev.clients ?? []), buyer]);
    const sale = {
      id: 'e2e-agency-sale', invoice_number: 'INV/E2E/AG1', doc_type: 'INVOICE', issue_date: arr.date, due_date: arr.date, status: 'Sent', currency: 'INR', template_id: 'classic_orange', client: buyer, sender: (settings.profiles ?? [])[0] ?? null,
      items: [{ id: 'e2e-ag-l1', name: 'E2E Mustard', type: 'Goods', hsn: '1207', unit: 'QTL', quantity: 25, rate: 5800, tax_rate: 0, discount_percent: 0, amount: 145000, arrival_id: arr.id, godown_id: arr.godown_id }],
      gst_mode: 'CGST_SGST', place_of_supply: '08', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, agency: true,
      subtotal: 145000, discount_amount: 0, taxable_value: 145000, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0, total: 145000, balance_due: 145000,
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), sale]);
    await page.goto(srv.origin + '/distribution?tab=agency&view=pattis');
    await page.locator('[data-patti-principal]').selectOption('e2e-farmer', { timeout: 15000 });
    await page.locator('[data-patti-lot="E2E-L1"]').check();
    await page.locator('[data-patti-rate="0"]').fill('2.5');
    await page.locator('[data-patti-make]').click();
    const pattis = await readJson(page, 'sale_pattis', [], (v) => v.some((p) => p.principal_id === 'e2e-farmer'));
    const pt = pattis.find((p) => p.principal_id === 'e2e-farmer');
    check(pt?.gross === 145000 && pt?.net_payable === 141375, `patti ${pt?.number}: gross ₹1,45,000 less aadat 2.5% = ₹1,41,375 (${pt?.net_payable})`);
    await page.locator(`[data-patti="${pt.number}"] [data-patti-view]`).click();
    const print = await page.locator('[data-patti-print]').innerText();
    check(/Net payable/.test(print) && /1,41,375/.test(print), 'the patti print shows the net payable');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('patti');
    await palette.getByRole('option', { name: /Bikri patti/ }).first().waitFor({ timeout: 15000 });
    check(true, 'Ctrl+K "patti" finds Agency → Bikri patti');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    await page.locator('[data-screen-help="distribution:agency:pattis"]').waitFor({ timeout: 15000 });
    check(true, 'Help opens on the Bikri patti topic');
    await page.keyboard.press('Escape');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R8-A discounts + claims: a party rate prices the line, "18+4" → 21.28 % printed as "18 + 4 %", a price-drop run makes one financial note, Receivables → Interest lists the party', async () => {
    const keys = ['settings', 'clients', 'items_catalog', 'invoices', 'party_rates', 'price_drops', 'doc_links', 'series_counters', 'interest_settings'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const ymd = (offset) => page.evaluate((o) => { const d = new Date(); d.setDate(d.getDate() + o); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }, offset);
    const [today, tomorrow, old] = [await ymd(0), await ymd(1), await ymd(-75)];
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'wholesale', trade_kind: 'distributor', industry_packs: ['distributor'], trade_discounts: true, modules: undefined, lock_until: undefined });
    const buyer = { id: 'e2e-dist-buyer', name: 'E2E Sharma Traders', email: '', address: 'Pune', city: 'Pune', zip: '', state_code: '27' };
    await writeJson(page, 'clients', [...(prev.clients ?? []), buyer]);
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-mcb', name: 'E2E Havells MCB', type: 'Product', hsn: '8536', unit: 'NOS', quantity: 1, rate: 1000, tax_rate: 18, amount: 0 }]);
    await writeJson(page, 'party_rates', [{ id: 'e2e-pr', side: 'sale', party_id: buyer.id, party_name: buyer.name, item_id: 'e2e-mcb', item_name: 'E2E Havells MCB', rate: 900, valid_from: old }]);
    const before = new Set((prev.invoices ?? []).map((i) => i.id));
    await page.goto(srv.origin + '/invoice');
    await page.getByLabel('Client name').fill(buyer.name);
    await page.getByLabel('Item 1 name').fill('E2E Havells');
    await page.getByRole('option', { name: /E2E Havells MCB/ }).first().click({ timeout: 15000 });
    await page.getByText('Party rate price').first().waitFor({ timeout: 15000 });
    // The "Party rate" label can paint a frame before the rate input takes the new value: wait for the value itself.
    let rateNow = '';
    for (let i = 0; i < 150 && !rateNow.startsWith('900'); i++) {
      rateNow = await page.getByLabel('Item 1 rate').inputValue();
      if (!rateNow.startsWith('900')) await new Promise((r) => setTimeout(r, 100));
    }
    check(rateNow.startsWith('900'), `the party rate prices the line (${rateNow})`);
    await page.locator('[data-disc-chain="0"]').fill('18+4');
    await page.locator('[data-disc-eff="0"]').waitFor({ timeout: 15000 });
    check(/21\.28%/.test(await page.locator('[data-disc-eff="0"]').innerText()), 'the line shows the effective 21.28 %');
    await page.getByLabel('Item 1 quantity').fill('10');
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
    await closeSendSheet(page);
    const inv = (await readJson(page, 'invoices', [], (v) => v.some((i) => !before.has(i.id) && i.client?.name === buyer.name))).find((i) => !before.has(i.id) && i.client?.name === buyer.name);
    check(inv?.items?.[0]?.discount_percent === 21.28 && inv.items[0].disc_chain?.join('+') === '18+4', `the line stores 21.28 % and the chain (${inv?.items?.[0]?.discount_percent})`);
    await page.getByRole('button', { name: /Preview/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.getByText('Disc 18 + 4 %').first().waitFor({ timeout: 15000 });
    check(true, 'the preview prints "Disc 18 + 4 %"');
    await page.keyboard.press('Escape');
    await writeJson(page, 'invoices', [...(await readJson(page, 'invoices', [])).map((i) => (i.id === inv.id ? { ...i, status: 'Sent', issue_date: today } : i)), { ...inv, id: 'e2e-old-bill', invoice_number: 'INV/E2E/OLD', status: 'Sent', issue_date: old, due_date: old, items: [{ ...inv.items[0], name: 'E2E Old cable', disc_chain: undefined, discount_percent: 0 }] }]);
    await page.goto(srv.origin + '/distribution?tab=claims&view=pricedrop');
    await page.locator('[data-drop-items]').fill('E2E Havells MCB, 50', { timeout: 15000 });
    await page.locator('input[type="date"]').first().fill(tomorrow);
    await page.locator('[data-drop-rows]').waitFor({ timeout: 15000 });
    await page.locator('[data-drop-issue]').click();
    const notes = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.price_drop_id))).filter((i) => i.price_drop_id);
    check(notes.length === 1 && notes[0].note_kind === 'financial' && notes[0].total === 500 && /^FCN\//.test(notes[0].invoice_number), `one financial credit note of ₹500 (${notes.map((n) => `${n.invoice_number} ${n.total}`).join(', ')})`);
    await page.goto(srv.origin + '/receivables?tab=interest');
    await page.locator('[data-interest-rate]').fill('18', { timeout: 15000 });
    await page.locator(`[data-interest-party="${buyer.name}"]`).waitFor({ timeout: 15000 });
    check(true, 'Receivables → Interest lists the party with the overdue bill');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R8-B weight + charges: a weighed line (120 bags / 6,072 kg / tare 0.6 / dhalta 1 kg a qtl → 59.400 QTL), the market fee line added by itself, the broker; Mandi register and Brokers statement', async () => {
    const keys = ['settings', 'stock_items', 'trade_charge_heads', 'sales_agents', 'invoices', 'draft'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'wholesale', industry_packs: ['commodity'], trade_kind: 'commodity', modules: undefined, lock_until: undefined });
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), { id: 'e2e-wheat', name: 'E2E Wheat', hsn: '1001', unit: 'KG', track_stock: true, opening_qty: 10000, opening_rate: 20, reorder_level: 0, alt_units: [{ unit: 'QTL', factor: 100 }], sold_by_weight_bags: true }]);
    await writeJson(page, 'trade_charge_heads', [{ id: 'e2e-mfee', name: 'Market fee', side: 'both', basis: 'percent', rate: 1, gst: 'in_value', payable: true, auto: true, order: 0 }]);
    await writeJson(page, 'sales_agents', [...(prev.sales_agents ?? []), { id: 'e2e-broker', name: 'E2E Dalal', rate: 0, basis: 'invoice', kind: 'broker', brokerage_basis: 'per_qtl', brokerage_rate: 5 }]);
    await writeJson(page, 'draft', null);
    await page.goto(srv.origin + '/invoice');
    const line = page.locator('[data-line]').first();
    await line.locator('[data-field="name"]').fill('E2E Wheat', { timeout: 15000 });
    await page.keyboard.press('Escape');
    await line.locator('[data-field="unit"]').selectOption('QTL'); // unit first: a later unit change rescales the rate
    await line.locator('[data-field="rate"]').fill('2450');
    await line.locator('[data-weigh]').click({ timeout: 15000 });
    await line.locator('[data-wt="packages"]').fill('120');
    await line.locator('[data-wt="gross"]').fill('6072');
    await line.locator('[data-wt="tare"]').fill('0.6');
    await line.locator('[data-wt="ded"]').fill('1');
    await page.waitForFunction(() => document.querySelector('[data-line] [data-field="quantity"]')?.value === '59.4', null, { timeout: 15000 });
    check(true, 'net 5,940 kg becomes the quantity 59.4 QTL');
    await page.locator('[data-line] [data-field="name"]').nth(1).waitFor({ timeout: 15000 });
    check((await page.locator('[data-line] [data-field="name"]').nth(1).inputValue()) === 'Market fee', 'the market-fee head adds its line by itself');
    await page.locator('[data-broker]').selectOption('e2e-broker');
    const draft = await readJson(page, 'draft', null, (v) => v?.broker_id === 'e2e-broker' && v?.items?.some((l) => l.charge_head_id), 10000);
    const fee = draft?.items?.find((l) => l.charge_head_id === 'e2e-mfee');
    check(draft?.items?.[0]?.wt?.packages === 120 && fee?.rate === 1455.3 && fee?.hsn === draft.items[0].hsn && fee?.tax_rate === draft.items[0].tax_rate, `the draft keeps the weighing and a ₹1,455.30 market-fee line at the goods' HSN / rate (${fee?.rate})`);
    const day = draft?.issue_date;
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), { ...draft, id: 'e2e-cm-sale', invoice_number: 'INV/E2E/CM1', status: 'Sent' }]);
    await page.goto(srv.origin + `/distribution?tab=mandi`);
    const reg = page.locator('[data-mandi-register]');
    await reg.waitFor({ timeout: 15000 });
    check(/Market fee[\s\S]*1,455\.30/.test(await reg.innerText()) && /1,455\.30/.test(await page.locator('[data-mandi-payable]').innerText()), `Mandi shows the register row and the payable (${day})`);
    await page.goto(srv.origin + '/distribution?tab=brokers');
    const st = page.locator('[data-brokerage]');
    await st.waitFor({ timeout: 15000 });
    check((await st.getAttribute('data-brokerage')) === '297', `Brokers lists the brokerage ₹297 (59.4 qtl × ₹5): ${await st.getAttribute('data-brokerage')}`);
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R9-A retail profile: Kirana → Grocery (MRP warn on), ₹48 over a ₹45 MRP warns at the counter, a COD delivery bill delivered and the rider settled (Z "Cash with riders" ₹0), short book → draft PO, a 10 + 1 bill line → stock 11', async () => {
    const keys = ['settings', 'items_catalog', 'invoices', 'transactions', 'retail_settings', 'pharma_settings', 'delivery_riders', 'rider_settlements', 'short_book', 'purchase_orders', 'purchases', 'stock_items', 'accounts', 'vouchers', 'series_counters'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const settings = prev.settings ?? {};
    await writeJson(page, 'settings', { ...settings, business_type: 'kirana', modules: undefined, industry_packs: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'retail_settings', null);
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-retail-kind-card="grocery"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.retail_kind === 'grocery');
    const rs = await readJson(page, 'retail_settings', {}, (v) => v?.mrp_guard === 'warn');
    check(st.retail_kind === 'grocery' && st.business_type === 'kirana' && Array.isArray(st.industry_packs) && st.industry_packs.length === 0 && st.modules?.includes('pos'), 'Grocery: kirana, no pack, POS module');
    check(rs?.mrp_guard === 'warn' && rs?.delivery?.enabled && rs?.short_book?.enabled && rs?.free_qty, 'Grocery turns on the MRP warning, deliveries, short book and free quantity');
    // MRP ₹45, typed rate ₹48 → the counter warns.
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-biscuit', name: 'E2E Biscuit', type: 'Product', hsn: '1905', unit: 'PCS', quantity: 1, rate: 48, mrp: 45, tax_rate: 0, amount: 0, barcode: '8901063010011' }]);
    await writeJson(page, 'delivery_riders', [{ id: 'e2e-rider', name: 'E2E Raju', active: true }]);
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor({ timeout: 15000 });
    await scan.fill('8901063010011');
    await scan.press('Enter');
    await page.locator('[data-pos-mrp]').waitFor({ timeout: 15000 });
    check(/above the MRP ₹45\.00/.test(await page.locator('[data-pos-mrp]').innerText()), 'the counter warns: above the MRP');
    // A COD delivery bill (nothing tendered: the rider collects).
    await page.locator('[data-pos-delivery]').check();
    await page.locator('[data-delivery-address]').fill('12 E2E Lane');
    await page.locator('[data-delivery-rider]').selectOption('e2e-rider');
    await page.locator('[data-delivery-cod]').check();
    await page.getByRole('button', { name: /Save bill/ }).click();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id) && i.delivery))).find((i) => !beforeIds.has(i.id) && i.delivery);
    check(bill?.delivery?.status === 'packed' && bill.delivery.cod && bill.balance_due === 48, `delivery bill ${bill?.invoice_number} saved packed, ₹48 to collect`);
    await page.goto(srv.origin + '/receivables?tab=deliveries');
    await page.locator(`[data-delivery-order="${bill.invoice_number}"] [data-delivery-next="out"]`).click({ timeout: 15000 });
    await page.locator(`[data-delivery-order="${bill.invoice_number}"] [data-delivery-next="delivered"]`).click({ timeout: 15000 });
    const pays = await readJson(page, 'transactions', [], (v) => v.some((p) => p.invoice_id === bill.id && p.rider_id === 'e2e-rider'));
    check(pays.some((p) => p.invoice_id === bill.id && p.rider_id === 'e2e-rider' && p.method === 'Cash' && p.amount === 48), 'delivered COD: a cash receipt with the rider');
    await page.locator('[data-settle] summary').click();
    await page.locator('[data-settle-rider]').selectOption('e2e-rider');
    await page.locator('[data-settle-save]').click();
    const sets = await readJson(page, 'rider_settlements', [], (v) => v.length > 0);
    check(sets.length === 1 && sets[0].expected === 48 && sets[0].counted === 48, 'the rider settled ₹48');
    await page.goto(srv.origin + '/pos');
    await page.getByRole('button', { name: 'Z report' }).click({ timeout: 15000 });
    const z = page.getByRole('dialog', { name: 'Day-end Z report' });
    await z.locator('[data-z="riders"]').waitFor({ timeout: 15000 });
    check(/0\.00/.test(await z.locator('[data-z="riders"]').innerText()), 'Z report: Cash with riders ₹0 after settling');
    await page.keyboard.press('Escape');
    // Short book → draft purchase order.
    const poBefore = (await readJson(page, 'purchase_orders', [])).length;
    await page.goto(srv.origin + '/inventory?tab=shortbook');
    await page.locator('[data-sb-name]').fill('E2E Ghee', { timeout: 15000 });
    await page.locator('[data-sb-add]').click();
    await page.locator('[data-sb-row="E2E Ghee"]').waitFor({ timeout: 15000 });
    await page.locator('[data-sb-po]').click();
    const pos = await readJson(page, 'purchase_orders', [], (v) => v.length > poBefore);
    check(pos.length === poBefore + 1 && pos[pos.length - 1].lines.some((l) => l.name === 'E2E Ghee'), 'Make draft PO creates a purchase order');
    // A supplier bill line 10 + 1 free at ₹80 less 5% → stock + 11.
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), { id: 'e2e-strip', name: 'E2E Strip', hsn: '3004', unit: 'STRIP', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0 }]);
    await writeJson(page, 'purchases', [...(prev.purchases ?? []), { id: 'e2e-free-bill', kind: 'PURCHASE', vendor_name: 'E2E Distributor', bill_number: 'FREE-1', date: bill.issue_date, status: 'unpaid', lines: [{ id: 'e2e-fl', name: 'E2E Strip', hsn: '3004', unit: 'STRIP', quantity: 10, free_qty: 1, rate: 80, discount_percent: 5, tax_rate: 5, item_id: 'e2e-strip' }], taxable: 760, cgst: 19, sgst: 19, igst: 0, total: 798, amount_paid: 0, itc_eligible: true }]);
    await page.goto(srv.origin + '/inventory');
    const row = page.locator('tr', { hasText: 'E2E Strip' }).first();
    await row.waitFor({ timeout: 15000 });
    check(/\b11\b/.test(await row.innerText()), `stock of the 10 + 1 line is 11 (${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 80)})`);
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('R9-C apparel: Garments profile, a ₹2,799 kurta less 15% → 5% band, no discount → 18%; a 4 × 3 size grid on a supplier bill makes 12 lines; alteration slip ALT/FY…/0001 prints', async () => {
    const keys = ['settings', 'items_catalog', 'stock_items', 'alteration_jobs', 'series_counters', 'retail_settings', 'invoices'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'kirana', modules: undefined, industry_packs: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-retail-kind-card="apparel"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.retail_kind === 'apparel');
    check(st.retail_kind === 'apparel' && st.industry_packs?.includes('apparel'), 'Garments: the apparel pack is on');
    const sizes = ['S', 'M', 'L', 'XL'];
    const colours = ['Red', 'Blue', 'Green'];
    const style = { id: 'e2e-krt', name: 'E2E KRT-104', hsn: '6211', unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 1400, reorder_level: 0, sale_rate: 2799, tax_rate: 18, gst_band: 'apparel', variant_axes: [{ name: 'Size', values: sizes }, { name: 'Colour', values: colours }] };
    const kids = sizes.flatMap((sz) => colours.map((c) => ({ id: `e2e-krt-${sz}-${c}`, name: `E2E KRT-104 - ${sz} / ${c}`, hsn: '6211', unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 1400, reorder_level: 0, sale_rate: 2799, tax_rate: 18, gst_band: 'apparel', variant_of: 'e2e-krt', variant_attrs: { Size: sz, Colour: c } })));
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), style, ...kids]);
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-kurta', name: 'E2E Kurta KRT-104', type: 'Product', hsn: '6211', unit: 'PCS', quantity: 1, rate: 2799, tax_rate: 18, amount: 0, gst_band: 'apparel' }]);
    // RT-C1: the band follows the price per piece after the discount.
    await page.goto(srv.origin + '/invoice');
    await page.getByLabel('Item 1 name').fill('E2E Kurta');
    await page.getByRole('option', { name: /E2E Kurta KRT-104/ }).first().click({ timeout: 15000 });
    await page.locator('[data-band-chip="18"]').waitFor({ timeout: 15000 });
    await page.getByLabel('Item 1 discount percent').fill('15');
    await page.locator('[data-band-chip="5"]').waitFor({ timeout: 15000 });
    check(await page.getByLabel('Item 1 GST rate').inputValue() === '5', '₹2,799 less 15% = ₹2,379.15 a piece → GST 5%');
    await page.getByLabel('Item 1 discount percent').fill('0');
    await page.locator('[data-band-chip="18"]').waitFor({ timeout: 15000 });
    check(await page.getByLabel('Item 1 GST rate').inputValue() === '18', 'without the discount → GST 18%');
    // RT-C2: one 4 × 3 grid on a supplier bill → 12 lines.
    await page.goto(srv.origin + '/expenses');
    await page.getByRole('button', { name: /Add bill/ }).click({ timeout: 15000 });
    const dlg = page.getByRole('dialog', { name: 'Add purchase bill' });
    await dlg.locator('[data-grid-open]').click({ timeout: 15000 });
    const grid = page.getByRole('dialog', { name: /Size × colour grid/ });
    await grid.locator('[data-grid-style]').selectOption('e2e-krt', { timeout: 15000 });
    const cells = grid.locator('[data-grid-cell]');
    await cells.first().waitFor({ timeout: 15000 });
    check(await cells.count() === 12, `the grid has 12 cells (${await cells.count()})`);
    for (let i = 0; i < 12; i++) await cells.nth(i).fill(String(1 + (i % 3)));
    await grid.locator('[data-grid-apply]').click();
    await grid.waitFor({ state: 'detached' });
    const names = await dlg.getByLabel(/^Line \d+ item$/).evaluateAll((els) => els.map((e) => e.value));
    check(names.length === 12 && names.every((n) => n.startsWith('E2E KRT-104 - ')), `the grid made 12 bill lines (${names.length})`);
    await page.keyboard.press('Escape');
    // RT-C3: an alteration slip ALT/FY…/0001 prints.
    await writeJson(page, 'alteration_jobs', []);
    await writeJson(page, 'series_counters', (prev.series_counters ?? []).filter((r) => !String(r?.id ?? '').startsWith('ALT')));
    await page.goto(srv.origin + '/inventory?tab=apparel&view=alterations');
    await page.locator('[data-alt-customer]').fill('E2E Ravi', { timeout: 15000 });
    await page.locator('[data-alt-garment]').fill('Trousers — shorten 2 cm');
    await page.locator('[data-alt-save]').click();
    const slip = page.locator('[data-alt-slip]');
    await slip.waitFor({ timeout: 15000 });
    const number = await slip.getAttribute('data-alt-slip');
    check(/^ALT\/FY\d{2}-\d{2}\/0001$/.test(number ?? ''), `the slip is numbered ${number}`);
    await page.evaluate(() => { window.__slipHtml = ''; window.open = () => ({ document: { write: (h) => { window.__slipHtml += h; }, close() {} }, print() {} }); });
    await slip.locator('[data-alt-print]').click();
    const printed = await page.evaluate(() => window.__slipHtml);
    check(printed.includes(number) && /Customer copy/.test(printed) && /Shop copy/.test(printed), 'the slip prints with the customer and shop copies');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R9-B pharmacy: Medical store → an H1 item at the POS needs doctor + patient (blocked, then saved with a picked doctor), Registers lists the bill, a refill shows in the due list, Ctrl+K "doctor" and F1 help', async () => {
    const keys = ['settings', 'items_catalog', 'invoices', 'transactions', 'retail_settings', 'pharma_settings', 'stock_items', 'doctors', 'rx_refills', 'series_counters'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'kirana', modules: undefined, industry_packs: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'retail_settings', null);
    await writeJson(page, 'pharma_settings', null);
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-retail-kind-card="pharmacy"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.retail_kind === 'pharmacy');
    const ph = await readJson(page, 'pharma_settings', {}, (v) => v?.require_rx === true);
    check(st.industry_packs?.includes('pharmacy') && ph?.enabled && ph?.require_rx, 'Medical store: pharmacy pack, pharma switches and "Require prescription" on');
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), { id: 'e2e-azi', name: 'E2E Azithro 500', hsn: '3004', unit: 'TAB', track_stock: false, opening_qty: 0, opening_rate: 0, reorder_level: 0, drug_schedule: 'H1' }]);
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-azi-c', name: 'E2E Azithro 500', type: 'Product', hsn: '3004', unit: 'TAB', quantity: 1, rate: 100, mrp: 100, tax_rate: 0, amount: 0, barcode: '8901063099001' }]);
    await writeJson(page, 'doctors', [{ id: 'e2e-doc', name: 'E2E Dr Mehta', reg_no: 'MMC 9', active: true }]);
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor({ timeout: 15000 });
    await scan.fill('8901063099001');
    await scan.press('Enter');
    await page.locator('[data-rx-strip]').waitFor({ timeout: 15000 });
    await page.locator('#pos-Cash').fill('100');
    await page.getByRole('button', { name: /Save bill/ }).click();
    await page.getByText(/patient and prescriber needed/).first().waitFor({ timeout: 15000 });
    check((await readJson(page, 'invoices', [])).every((i) => beforeIds.has(i.id)), 'no prescription: the bill is not saved');
    await page.locator('[data-rx-doctor]').selectOption('e2e-doc');
    await page.locator('[data-rx-patient]').fill('E2E Asha');
    await page.getByRole('button', { name: /Save bill/ }).click();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id)))).find((i) => !beforeIds.has(i.id));
    check(bill?.rx?.doctor_id === 'e2e-doc' && bill.rx.prescriber === 'E2E Dr Mehta' && bill.rx.prescriber_reg === 'MMC 9' && bill.rx.patient === 'E2E Asha', `bill ${bill?.invoice_number} keeps the doctor snapshot`);
    await page.goto(srv.origin + '/inventory?tab=pharmacy&view=registers');
    await page.locator('[data-rtb-row]', { hasText: bill.invoice_number }).first().waitFor({ timeout: 15000 });
    check(true, 'Pharmacy → Registers (H1) lists the bill');
    await page.goto(srv.origin + '/inventory?tab=pharmacy&view=rx');
    await page.getByLabel('Every (days)').fill('3', { timeout: 15000 });
    await page.locator('[data-rtb-make-refill]').first().click();
    const refills = await readJson(page, 'rx_refills', [], (v) => v.length > 0);
    check(refills.length === 1 && refills[0].every_days === 3 && refills[0].name === 'E2E Asha', 'Make refill saves the schedule');
    await page.goto(srv.origin + '/inventory?tab=pharmacy&view=refills');
    const due = page.locator('[data-rtb-row]', { hasText: 'E2E Asha' }).first();
    await due.waitFor({ timeout: 15000 });
    check(/in 3 day\(s\)/.test(await due.innerText()), 'the due list shows the refill 3 days ahead');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('doctor');
    await palette.getByRole('option', { name: /Doctors/ }).first().click({ timeout: 15000 });
    await page.locator('[data-pharmacy-desk="doctors"]').waitFor({ timeout: 15000 });
    check(true, 'Ctrl+K "doctor" opens Pharmacy → Doctors');
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    await page.locator('[data-screen-help="inventory:pharmacy:doctors"]').waitFor({ timeout: 15000 });
    check(true, 'Help opens on the Doctors topic');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R9-D electronics: Electronics profile; two phones bought with IMEI pairs, scanning IMEI 2 at the POS adds the phone with IMEI 1; a finance tender → Devices → Finance lists the DO; a buy-back exchange settles a bill with no cash moved', async () => {
    const keys = ['settings', 'items_catalog', 'stock_items', 'purchases', 'invoices', 'transactions', 'finance_deals', 'vouchers', 'bank_accounts', 'vendors', 'godowns', 'series_counters', 'retail_settings', 'imei_checks'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'kirana', modules: undefined, industry_packs: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'retail_settings', null);
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-retail-kind-card="electronics"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.retail_kind === 'electronics');
    check(st.industry_packs?.includes('electronics'), 'Electronics: the electronics pack is on');
    const [A1, A2, B1] = ['490154203237518', '356938035643809', '353918052034572'];
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), { id: 'e2e-ph', name: 'E2E Phone X', hsn: '8517', unit: 'NOS', track_stock: true, track_serials: true, serial_kind: 'imei', warranty_months: 12, opening_qty: 0, opening_rate: 0, reorder_level: 0, sale_rate: 20000, tax_rate: 0 },
      { id: 'e2e-chg', name: 'E2E Charger', hsn: '8504', unit: 'NOS', track_stock: false, opening_qty: 0, opening_rate: 0, reorder_level: 0, sale_rate: 6000, tax_rate: 0 }]);
    await writeJson(page, 'items_catalog', [...(prev.items_catalog ?? []), { id: 'e2e-chg-c', name: 'E2E Charger', type: 'Product', hsn: '8504', unit: 'NOS', quantity: 1, rate: 6000, tax_rate: 0, amount: 0, barcode: '8901063099777' }]);
    await writeJson(page, 'purchases', [...(prev.purchases ?? []), { id: 'e2e-ph-bill', kind: 'PURCHASE', vendor_name: 'E2E Distributor', bill_number: 'E2E-D1', date: '2026-01-02', category: 'Purchases', lines: [{ id: 'l1', name: 'E2E Phone X', item_id: 'e2e-ph', hsn: '8517', quantity: 2, rate: 15000, tax_rate: 0, serials: [A1, B1], serial_pairs: { [A1]: A2 } }], taxable: 30000, cgst: 0, sgst: 0, igst: 0, total: 30000, amount_paid: 0, itc_eligible: true }]);
    // RT-D1: scanning IMEI 2 adds the phone with IMEI 1 picked; RT-D2: the finance tender leaves ₹15,000 to the financier.
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.goto(srv.origin + '/pos');
    const scan = page.locator('#pos-scan');
    await scan.waitFor({ timeout: 15000 });
    await page.locator('[data-pos-devices]').waitFor({ timeout: 15000 });
    await scan.fill(A2);
    await scan.press('Enter');
    await page.locator('[data-pos-finance-on]').check({ timeout: 15000 });
    await page.locator('[data-pos-financier]').fill('E2E Finserv');
    await page.locator('[data-pos-loan]').fill('15000');
    await page.locator('[data-pos-do]').fill('E2E-DO-1');
    await page.locator('#pos-Cash').fill('5000');
    await page.getByRole('button', { name: /Save bill/ }).click();
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id)))).find((i) => !beforeIds.has(i.id));
    const line = bill?.items?.[0];
    check(line?.name === 'E2E Phone X' && line.serials?.[0] === A1 && line.serial_pairs?.[A1] === A2, `IMEI 2 scan → the phone with IMEI 1 and its pair (${JSON.stringify(line?.serials)})`);
    const deals = await readJson(page, 'finance_deals', [], (v) => v.length > 0);
    check(deals[0]?.do_no === 'E2E-DO-1' && deals[0].loan === 15000 && deals[0].invoice_id === bill.id, 'the finance deal (DO) is recorded on the bill');
    check((await readJson(page, 'invoices', [], (v) => v.some((i) => i.id === bill.id && i.status === 'Paid'))).some((i) => i.id === bill.id), 'the customer\'s bill is settled (the loan moved to the financier)');
    await page.goto(srv.origin + '/inventory?tab=devices&view=finance');
    await page.locator('[data-dev-deal="E2E-DO-1"]').waitFor({ timeout: 15000 });
    check(true, 'Devices → Finance lists the DO');
    // RT-D3: a buy-back (URD voucher) settles ₹5,000 of a ₹6,000 bill; only ₹1,000 cash moves.
    await page.goto(srv.origin + '/inventory?tab=devices&view=buyback');
    await page.locator('[data-dev-customer]').fill('E2E Ravi', { timeout: 15000 });
    await page.locator('[data-dev-model]').fill('Old phone');
    await page.locator('[data-dev-imei]').fill('358240051111110');
    await page.locator('[data-dev-value]').fill('5000');
    await page.locator('[data-dev-save]').click();
    const urd = (await readJson(page, 'purchases', [], (v) => v.some((p) => p.used_goods))).find((p) => p.used_goods);
    check(/^URD\/FY\d{2}-\d{2}\/0001$/.test(urd?.bill_number ?? '') && urd.cgst + urd.sgst + urd.igst === 0 && urd.itc_eligible === false, `buy-back voucher ${urd?.bill_number}: no GST / ITC`);
    const before2 = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.goto(srv.origin + '/pos');
    await page.locator('#pos-scan').waitFor({ timeout: 15000 });
    await page.getByLabel('Walk-in name').fill('E2E Ravi');
    await page.locator('#pos-scan').fill('8901063099777');
    await page.locator('#pos-scan').press('Enter');
    await page.locator('[data-pos-exchange-pick]').selectOption(urd.id, { timeout: 15000 });
    await page.locator('#pos-Cash').fill('1000');
    await page.getByRole('button', { name: /Save bill/ }).click();
    const sale = (await readJson(page, 'invoices', [], (v) => v.some((i) => !before2.has(i.id)))).find((i) => !before2.has(i.id));
    const rows = (await readJson(page, 'transactions', [], (v) => v.some((p) => p.invoice_id === sale.id && p.exchange_purchase_id))).filter((p) => p.invoice_id === sale.id);
    const cash = rows.filter((p) => p.method === 'Cash').reduce((s, p) => s + p.amount, 0);
    const ex = rows.find((p) => p.exchange_purchase_id === urd.id);
    check(sale.total === 6000 && ex?.amount === 5000 && cash === 1000, `bill ₹${sale.total}: exchange ₹${ex?.amount} (no cash), cash ₹${cash}`);
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R9-E jewellery: Jewellery profile, 22K rate ₹9,350, a tag 6.420 / 0.380 g with HUID billed to the paisa (₹66,374.48), the paper shows net weight, "22K (916)", HUID and the BIS line; old gold settles part by exchange (no cash); ₹2,00,000 cash is refused', async () => {
    const keys = ['settings', 'retail_settings', 'stock_items', 'stock_moves', 'metal_rates', 'jewel_tags', 'invoices', 'transactions', 'purchases', 'vendors', 'godowns', 'series_counters'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'kirana', modules: undefined, industry_packs: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'retail_settings', null);
    for (const k of ['metal_rates', 'jewel_tags']) await writeJson(page, k, []);
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-retail-kind-card="jewellery"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.retail_kind === 'jewellery');
    const rs = await readJson(page, 'retail_settings', {}, (v) => v?.cash_guard === 'block');
    check(st.industry_packs?.includes('jewellery') && rs.cash_guard === 'block' && rs.require_pan === true, 'Jewellery: pack on, cash guard block, Require PAN');
    // RT-E1: today's rate, then a tagged ring.
    await page.goto(srv.origin + '/inventory?tab=jewellery&view=rates');
    await page.locator('[data-rate-sale="gold:22K"]').fill('9350', { timeout: 15000 });
    await page.locator('[data-rates-save]').click();
    const rates = await readJson(page, 'metal_rates', [], (v) => v.length > 0);
    check(rates.some((r) => r.metal === 'gold' && r.purity === '22K' && r.sale === 9350), 'the 22K sale rate is on today\'s board');
    await page.goto(srv.origin + '/inventory?tab=jewellery&view=tags');
    const fill = async (k, v) => page.locator(`[data-tag-form] [data-jw="${k}"]`).fill(String(v), { timeout: 15000 });
    await fill('item', 'E2E Rings');
    for (const [k, v] of [['gross', 6.42], ['stone', 0.38], ['stones', 4800], ['wastage', 2], ['making', 650], ['hallmark', 45], ['huid', 'AB12CD']]) await fill(k, v);
    await page.locator('[data-tag-save]').click();
    const [tag] = await readJson(page, 'jewel_tags', [], (v) => v.length === 1);
    check(tag.net_wt === 6.04 && tag.huid === 'AB12CD', `tag ${tag.tag}: net 6.040 g, HUID AB12CD`);
    await page.locator(`[data-tag-row="${tag.tag}"]`).waitFor({ timeout: 15000 });
    // RT-E2: bill it in the editor.
    const before = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.goto(srv.origin + '/invoice');
    await page.getByLabel('Client name').fill('E2E Mrs Rao');
    await page.getByLabel('Item 1 name').fill('E2E Rings');
    const row = page.locator('[data-jewel-row]').first();
    await row.locator('[data-jw="tag"]').selectOption(tag.tag, { timeout: 15000 });
    await row.locator('[data-jw-amount]', { hasText: '66,374.48' }).waitFor({ timeout: 15000 });
    check(await page.getByLabel('Item 1 rate').inputValue() === '66374.48', 'the line amount equals the ring example (₹66,374.48)');
    await page.keyboard.press('Control+s');
    await closeSendSheet(page);
    const sale = (await readJson(page, 'invoices', [], (v) => v.some((i) => !before.has(i.id)))).find((i) => !before.has(i.id));
    check(sale?.items?.[0]?.jw?.tag === tag.tag && sale.items[0].tax_rate === 3 && sale.items[0].serials?.[0] === tag.tag, `${sale?.invoice_number}: the jw snapshot, GST 3%, the tag as its serial`);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.getByText(/BIS-recognised A&H centre/).first().waitFor({ timeout: 15000 });
    const paper = await dialog.innerText();
    check(/Net 6\.040 g/.test(paper) && paper.includes('22K (916)') && paper.includes('HUID AB12CD') && /Hallmarking ₹45/.test(paper), 'the paper shows net weight, 22K (916), HUID, hallmarking and the BIS line');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    // RT-E3: old gold settles part of the bill by exchange (no cash).
    await page.goto(srv.origin + '/inventory?tab=jewellery&view=oldgold');
    const og = (k, v) => page.locator(`[data-og-form] [data-og="${k}"], [data-og-form] [data-jw="${k}"]`).first().fill(String(v), { timeout: 15000 });
    await og('name', 'E2E Mrs Rao');
    for (const [k, v] of [['og-gross', 2], ['og-touch', 84], ['og-melt', 2], ['og-rate', 10000], ['bill', sale.invoice_number]]) await og(k, v);
    await page.locator('[data-og-value]', { hasText: '16,464' }).waitFor({ timeout: 15000 });
    await page.locator('[data-og-save]').click();
    const urd = (await readJson(page, 'purchases', [], (v) => v.some((p) => p.old_metal))).find((p) => p.old_metal);
    const ex = (await readJson(page, 'transactions', [], (v) => v.some((t) => t.exchange_purchase_id))).find((t) => t.exchange_purchase_id === urd.id);
    check(/^URD\/FY\d{2}-\d{2}\/0001$/.test(urd.bill_number) && urd.cgst === 0 && urd.itc_eligible === false && urd.total === 16464, `${urd.bill_number}: 2 g @ 84% less 2% = 1.646 g fine, ₹16,464, no GST / ITC`);
    check(ex?.invoice_id === sale.id && ex.amount === 16464 && ex.method === 'Exchange', 'the exchange receipt settles ₹16,464 of the bill (no cash moved)');
    // RT-E3: a ₹2,00,000 cash tender is refused at the counter.
    await writeJson(page, 'jewel_tags', [...(await readJson(page, 'jewel_tags', [])), { ...tag, id: 'e2e-tag-2', tag: 'E2E-BIG', gross_wt: 25, stone_wt: 0, net_wt: 25, stone_value: 0 }]);
    await writeJson(page, 'stock_moves', [...(await readJson(page, 'stock_moves', [])), { id: 'e2e-mv-big', item_id: tag.item_id, date: rates[0].date, qty: 1, rate: 0, kind: 'adjustment', serials: ['E2E-BIG'] }]);
    const posBefore = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.goto(srv.origin + '/pos');
    await page.locator('[data-pos-tag]').fill('E2E-BIG', { timeout: 15000 });
    await page.locator('[data-pos-tag]').press('Enter');
    await page.locator('#pos-Cash').fill('200000');
    await page.locator('[data-pos-cash-guard], [data-guard="error"]', { hasText: /269ST/ }).first().waitFor({ timeout: 15000 }); // RT-D's counter guard (cash guard on)
    await page.getByRole('button', { name: /Save bill/ }).click();
    await page.getByText(/cannot be accepted from one person in a day/).first().waitFor({ timeout: 15000 });
    check((await readJson(page, 'invoices', [])).every((i) => posBefore.has(i.id)), '₹2,00,000 in cash is refused (Sec 269ST): no bill saved');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('R11-A RA bill paper: Contractor → Civil / EPC + government; a BOQ with its site in Karnataka; RA 1 with MB refs → the paper shows "Running Account Bill No. 1", the contract box, "Item 2.1 · MB 112/45-47", Net payable and the sign-off boxes, the abstract page; a plain invoice is unchanged; Ctrl+K "RA bill"; help', async () => {
    const keys = ['settings', 'construction_settings', 'invoices', 'transactions', 'clients', 'doc_links', 'series_counters', 'ra_measurements', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'contractor', modules: undefined, industry_packs: undefined, construction_kind: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'construction_settings', null);
    // CN-A1: the construction picker in Settings → Features.
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-construction-kind-card="civil"]').click({ timeout: 15000 });
    await page.locator('[data-construction-government] input').check();
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.construction_kind === 'civil');
    const cs = await readJson(page, 'construction_settings', {}, (v) => v?.ra_paper === 'pwd' && v?.signoff_boxes === true);
    check(st.industry_packs?.includes('works') && cs.government === true && cs.views?.contracts === true, 'Civil + government: works pack, PWD paper, sign-off boxes, contract views switched on');
    // A BOQ whose site is in another State (place of supply = site, Sec 12(3)) with typed contract particulars.
    const dept = { id: 'e2e-cn-dept', name: 'E2E PWD Division 7', email: '', address: 'Mumbai', city: 'Mumbai', zip: '', state_code: '27', gst_tds_deductor: true };
    await writeJson(page, 'clients', [...(prev.clients ?? []), dept]);
    const boq = {
      id: 'e2e-cn-boq', invoice_number: 'SO/E2E/0011', doc_type: 'SALES_ORDER', issue_date: '2026-05-01', due_date: '2026-05-31', status: 'Sent', currency: 'INR', template_id: 'classic_orange',
      client: dept, sender: (prev.settings?.profiles ?? [])[0] ?? null,
      items: [
        { id: 'e2e-cn-l1', name: 'Earthwork excavation', boq_ref: '2.1', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 1000, rate: 250, tax_rate: 18, discount_percent: 0, amount: 250000 },
        { id: 'e2e-cn-l2', name: 'PCC 1:4:8', boq_ref: '2.2', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 200, rate: 4500, tax_rate: 18, discount_percent: 0, amount: 900000 },
      ],
      gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false,
      amount_paid: 0, notes: '', terms: '', subtotal: 1150000, discount_amount: 0, taxable_value: 1150000, cgst_amount: 103500, sgst_amount: 103500, igst_amount: 0, tax_amount: 207000, round_off: 0, total: 1357000, balance_due: 1357000,
      boq_terms: {
        work_order: 'WO/E2E/7', deductions: [{ kind: 'retention', rate: 5 }, { kind: 'it_tds', section: '194C-2' }, { kind: 'gst_tds' }, { kind: 'labour_cess' }],
        header: { name_of_work: 'E2E widening of SH-12', agreement_no: '12/EE/2026-27', engineer: 'Executive Engineer', site: { address: 'Km 4–9, Belagavi', state_code: '29' } },
      },
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), boq]);
    await page.goto(srv.origin + '/time?tab=works&view=ra&boq=e2e-cn-boq');
    await page.locator('[data-ra-cum="2.1"]').fill('400', { timeout: 15000 });
    await page.locator('[data-ra-cum="2.1"]').locator('xpath=../following-sibling::td[2]/input').fill('112/45-47');
    await page.locator('[data-ra-save]').click();
    const ra = (await readJson(page, 'invoices', [], (v) => v.some((d) => d.boq_id === 'e2e-cn-boq' && d.ra_no === 1))).find((d) => d.boq_id === 'e2e-cn-boq' && d.ra_no === 1);
    check(ra.place_of_supply === '29' && ra.gst_mode === 'IGST' && ra.boq_terms?.cn?.paper === 'pwd', `place of supply = site State (Karnataka, IGST), PWD paper (${ra.place_of_supply} ${ra.gst_mode})`);
    check((ra.boq_terms?.cn?.abstract ?? []).some((r) => r.mb === '112/45-47'), 'the abstract snapshot carries the MB ref');
    await page.goto(srv.origin + '/invoice/' + ra.id);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.locator('[data-works-abstract]').first().waitFor({ timeout: 15000 });
    const paper = await dialog.innerText();
    check(/RUNNING ACCOUNT BILL NO\. 1/i.test(paper), 'the title reads "Running Account Bill No. 1"');
    check(await dialog.locator('[data-works-header]').count() > 0 && paper.includes('E2E widening of SH-12') && paper.includes('12/EE/2026-27') && /Karnataka/.test(paper), 'the contract particulars box: name of work, agreement, site and its State');
    check(paper.includes('Item 2.1 · MB 112/45-47'), 'the line sub-line shows the BOQ item no. and the M-book ref');
    check(await dialog.locator('[data-net-payable]').count() > 0 && /Net payable/.test(paper) && /GST TDS u\/s 51/.test(paper), 'the deductions block runs down to Net payable with the GST TDS note');
    check(await dialog.locator('[data-signoff="measuredBy"]').count() > 0 && /Passed for payment/i.test(paper) && /Measured by/i.test(paper), 'the measured / checked / passed boxes print');
    check(/Abstract of cost/i.test(paper) && /A\. BOQ items/i.test(paper), 'page 2 is the abstract of cost');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    // A plain invoice prints no construction part.
    const plain = (prev.invoices ?? []).find((i) => !['SALES_ORDER', 'QUOTATION', 'DELIVERY_CHALLAN'].includes(i.doc_type) && !i.ra_no && !i.boq_terms?.cn && i.status !== 'Cancelled');
    check(!!plain, `a plain invoice to compare (${plain?.invoice_number})`);
    if (plain) {
      await page.goto(srv.origin + '/invoice/' + plain.id);
      await page.getByRole('button', { name: /Preview & download PDF/ }).click();
      const d2 = page.getByRole('dialog', { name: 'Document preview' });
      await d2.waitFor();
      check(await d2.locator('[data-works-header], [data-works-deductions], [data-works-abstract], [data-works-line]').count() === 0, 'a plain invoice prints unchanged (no construction part)');
      await page.keyboard.press('Escape');
      await d2.waitFor({ state: 'detached' });
    }
    await page.goto(srv.origin + '/');
    await page.getByRole('navigation', { name: /Primary/ }).getByRole('link', { name: 'Dashboard' }).waitFor();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('RA bill');
    await palette.getByRole('option', { name: /RA bills/ }).first().waitFor({ timeout: 15000 });
    check(true, 'Ctrl+K "RA bill" finds Time → Works → RA bills');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/time?tab=works&view=ra');
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    await page.locator('[data-screen-help="time:works:ra"]').waitFor({ timeout: 15000 });
    check(true, 'Help opens on the RA bills topic');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R11-C builder desk: Contractor → Builder; a project with RERA no. and a tower of 4 units; book A-101 with stamp duty as pass-through, a 12% receipt before the agreement warns; certify Plinth → the demand shows land one-third and CGST 3.75% + SGST 3.75%, the RERA account and the plan; after the CC date the next demand is non-GST; RERA view shows 70% required', async () => {
    const keys = ['settings', 'construction_settings', 'invoices', 'transactions', 'clients', 'doc_links', 'series_counters', 'advances', 'bank_accounts', 'cost_centres', 'realty_projects', 'realty_units', 'realty_bookings', 'payment_plans', 'stage_certificates', 'rera_withdrawals', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'contractor', modules: undefined, industry_packs: undefined, construction_kind: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'construction_settings', null);
    await writeJson(page, 'bank_accounts', [...(prev.bank_accounts ?? []), { id: 'e2e-rera', name: 'E2E RERA account', account_no: '50100099887', ifsc: 'HDFC0000123', active: true }]);
    // Settings → Features: the Builder profile switches the realty pack on.
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-construction-kind-card="builder"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.construction_kind === 'builder');
    check(st.industry_packs?.includes('realty'), 'Builder profile: the realty pack is on');
    // C1: project + units.
    await page.goto(srv.origin + '/receivables?tab=realty&view=projects');
    const pf = page.locator('[data-rc-project-form]');
    await pf.locator('[data-rc="p-name"]').fill('E2E Green Heights', { timeout: 15000 });
    await pf.locator('[data-rc="p-rera"]').fill('P52100099999');
    await pf.locator('[data-rc="p-towers"]').fill('A:1:20');
    await pf.locator('[data-rc="p-rera-acc"]').selectOption('e2e-rera');
    await page.locator('[data-rc-save-project]').click();
    const proj = (await readJson(page, 'realty_projects', [], (v) => v?.some((p) => p.name === 'E2E Green Heights'))).find((p) => p.name === 'E2E Green Heights');
    check(proj?.rera_no === 'P52100099999' && proj?.towers?.[0]?.name === 'A', 'project saved with its RERA no. and tower A');
    await page.goto(srv.origin + '/receivables?tab=realty&view=units');
    const bulk = page.locator('[data-rc-bulk]');
    await bulk.locator('[data-rc="b-carpet"]').fill('100', { timeout: 15000 });
    await bulk.locator('[data-rc="b-rate"]').fill('5000');
    await page.locator('[data-rc-add-units]').click();
    await page.locator('[data-rc-unit="A-104"]').waitFor({ timeout: 15000 });
    check(await page.locator('[data-rc-unit]').count() === 4, 'a tower of 4 units (A-101 … A-104)');
    // The units must reach IndexedDB before the next page load reads them back.
    await readJson(page, 'realty_units', [], (v) => v?.filter((u) => u.project_id === proj?.id).length >= 4, 15000);
    // C3: a construction-linked plan.
    await page.goto(srv.origin + '/receivables?tab=realty&view=plans');
    await page.locator('[data-rc="plan-name"]').fill('E2E CLP', { timeout: 15000 });
    await page.locator('[data-rc-plan-save]').click();
    await readJson(page, 'payment_plans', [], (v) => v?.length > 0);
    // C2: book A-101 with stamp duty as pass-through, then a 12% receipt before the agreement.
    await page.goto(srv.origin + '/receivables?tab=realty&view=bookings');
    await page.locator('[data-rc="k-name"]').fill('E2E Buyer Asha', { timeout: 15000 });
    await page.locator('[data-rc="h-Stamp duty"]').fill('400000');
    await page.locator('[data-rc-book-save]').click();
    const bk = (await readJson(page, 'realty_bookings', [], (v) => v?.length > 0))[0];
    check(/^BKG\/FY\d\d-\d\d\/0001$/.test(bk?.number ?? '') && bk.cost_sheet.some((h) => h.head === 'Stamp duty' && h.pass_through && h.amount === 400000) && bk.agreement_value === 5381950, `booking ${bk?.number}: stamp duty outside the agreement value (${bk?.agreement_value})`);
    await page.locator('[data-rc="r-amount"]').fill(String(Math.round(bk.agreement_value * 0.12)));
    await page.locator('[data-rc-receipt-save]').click();
    await page.locator('[data-rc-warn10]').waitFor({ timeout: 15000 });
    check(true, 'a 12% receipt before the registered agreement shows the RERA Sec 13 10% warning');
    const adv = (await readJson(page, 'advances', [], (v) => v?.some((a) => a.booking_id === bk.id))).find((a) => a.booking_id === bk.id);
    check(adv?.tax_rate === 5, 'the receipt is an advance tagged with the booking, GST 5%');
    check(await page.locator('[data-rc-tds]').count() > 0, '194-IA hint shows for a booking of ₹50 lakh or more');
    // C3: certify Plinth → raise the demand.
    await page.goto(srv.origin + '/receivables?tab=realty&view=demands');
    await page.locator('[data-rc="c-stage"]').selectOption('Plinth', { timeout: 15000 });
    await page.locator('[data-rc-certify-save]').click();
    await page.locator('[data-rc-raise]').click({ timeout: 15000 });
    const dm = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.boq_terms?.cn?.demand?.booking_id === bk.id))).find((i) => i.boq_terms?.cn?.demand?.booking_id === bk.id);
    check(dm.doc_type === 'TAX_INVOICE' && dm.boq_terms.cn.demand.land?.notif === 7.5 && Math.abs(dm.tax_amount - dm.taxable_value * 0.05) < 0.02, `demand ${dm.boq_terms.cn.demand.number}: 7.5% on two-thirds = 5% (${dm.tax_amount})`);
    await page.goto(srv.origin + '/invoice/' + dm.id);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.locator('[data-demand]').first().waitFor({ timeout: 15000 });
    const paper = await dialog.innerText();
    check(/Value of land deemed one-third/.test(paper) && /CGST 3\.75% \+ SGST 3\.75%/.test(paper), 'the demand paper shows land one-third and CGST 3.75% + SGST 3.75% on two-thirds');
    check(/Pay only to this account: E2E RERA account/.test(paper) && /Payment plan/.test(paper) && paper.includes('P52100099999'), 'the RERA account, the stage table and the RERA no. print');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    // CC date → the next stage is a non-GST "not a supply" demand.
    const projects = await readJson(page, 'realty_projects', []);
    const today = dm.issue_date;
    await writeJson(page, 'realty_projects', projects.map((p) => (p.id === proj.id ? { ...p, cc_date: today } : p)));
    await page.goto(srv.origin + '/receivables?tab=realty&view=demands');
    await page.locator('[data-rc="c-stage"]').selectOption('1st slab', { timeout: 15000 });
    await page.locator('[data-rc-certify-save]').click();
    await page.locator('[data-rc-raise]').click({ timeout: 15000 });
    const dm2 = (await readJson(page, 'invoices', [], (v) => v.filter((i) => i.boq_terms?.cn?.demand?.booking_id === bk.id).length > 1)).filter((i) => i.boq_terms?.cn?.demand?.booking_id === bk.id).find((i) => i.id !== dm.id);
    check(dm2?.doc_type === 'BILL_OF_SUPPLY' && dm2.tax_amount === 0 && dm2.boq_terms.cn.demand.cc_after === true && /not a supply/.test(dm2.notes), 'after the completion certificate the demand is non-GST (Sch III para 5(b))');
    // C4: the RERA view shows 70% required vs deposited.
    await page.goto(srv.origin + '/receivables?tab=realty&view=rera');
    const rera = page.locator('[data-rc-table="rera"]');
    await rera.waitFor({ timeout: 15000 });
    check(/70% required/i.test(await rera.innerText()) && /Deposited/i.test(await rera.innerText()), 'RERA view: 70% required vs deposited');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('R11-B contractor finance: a contract with water + electricity, a mobilisation advance at 10% and a secured advance on 100 bags; RA 2 recovers advance + interest + secured + client material; Advances balance ₹0; escalation → supplementary bill with the working page; recovery receipts move no cash; a PBG expiring in 20 days rings the bell', async () => {
    const keys = ['settings', 'construction_settings', 'invoices', 'transactions', 'clients', 'advances', 'vouchers', 'accounts', 'bank_accounts', 'doc_links', 'series_counters', 'ra_measurements', 'works_contracts', 'secured_advances', 'price_variations', 'bank_guarantees', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const day = (n) => page.evaluate((x) => { const d = new Date(); d.setDate(d.getDate() + x); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, n);
    const today = await day(0);
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'contractor', modules: undefined, industry_packs: ['works'], construction_kind: 'civil', lock_until: undefined });
    await writeJson(page, 'construction_settings', { views: { contracts: true, advances: true, escalation: true, guarantees: true } });
    const dept = { id: 'e2e-cnb-dept', name: 'E2E CPWD Division 2', email: '', address: 'Mumbai', city: 'Mumbai', zip: '', state_code: '27' };
    await writeJson(page, 'clients', [...(prev.clients ?? []), dept]);
    const boq = {
      id: 'e2e-cnb-boq', invoice_number: 'SO/E2E/0021', doc_type: 'SALES_ORDER', issue_date: await day(-90), due_date: await day(-60), status: 'Sent', currency: 'INR', template_id: 'classic_orange',
      client: dept, sender: (prev.settings?.profiles ?? [])[0] ?? null,
      items: [
        { id: 'e2e-cnb-l1', name: 'Earthwork excavation', boq_ref: '2.1', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 1000, rate: 250, tax_rate: 18, discount_percent: 0, amount: 250000 },
        { id: 'e2e-cnb-l2', name: 'PCC 1:4:8', boq_ref: '2.2', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 200, rate: 4500, tax_rate: 18, discount_percent: 0, amount: 900000 },
      ],
      gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false,
      amount_paid: 0, notes: '', terms: '', subtotal: 1150000, discount_amount: 0, taxable_value: 1150000, cgst_amount: 103500, sgst_amount: 103500, igst_amount: 0, tax_amount: 207000, round_off: 0, total: 1357000, balance_due: 1357000,
      boq_terms: { deductions: [{ kind: 'retention', rate: 5 }] },
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), boq]);
    const adv = { id: 'e2e-cnb-adv', number: 'ADV/E2E/0001', date: await day(-60), client: { id: dept.id, name: dept.name }, place_of_supply: '27', supply: 'services', tax_rate: 18, amount: 115000, method: 'Bank transfer', tax: { applies: true, supply_type: 'INTRA', taxable: 97457.63, igst: 0, cgst: 8771.19, sgst: 8771.18 }, created_at: new Date().toISOString() };
    await writeJson(page, 'advances', [...(prev.advances ?? []), adv]);
    // B1: the contract.
    await page.goto(srv.origin + '/time?tab=works&view=contracts');
    await page.locator('[data-cn-new-contract]').click({ timeout: 15000 });
    await page.locator('[data-cn-f="client_id"]').selectOption(dept.id);
    await page.locator('[data-cn-f="boq_id"]').selectOption(boq.id);
    for (const [k, v] of [['name_of_work', 'E2E road SH-4'], ['agreement_no', 'AG/E2E/4'], ['contract_value', '1150000'], ['water_pct', '1'], ['power_pct', '1']]) await page.locator(`[data-cn-f="${k}"]`).fill(v);
    await page.locator('[data-cn-save-contract]').click();
    const contract = (await readJson(page, 'works_contracts', [], (v) => v?.some((c) => c.boq_id === boq.id))).find((c) => c.boq_id === boq.id);
    check(contract?.agreement_no === 'AG/E2E/4' && contract?.water_pct === 1, 'the contract is saved against its BOQ');
    await page.locator('[data-cn-row="AG/E2E/4"]').waitFor();
    // B2: link the advance (10% interest) and record a secured advance on 100 bags.
    await page.locator('[data-tw-view="advances"]').click();
    await page.locator('[data-cn-f="advance_id"]').selectOption(adv.id, { timeout: 15000 });
    await page.locator('[data-cn-adv-link]').click();
    await readJson(page, 'works_contracts', [], (v) => v?.some((c) => c.advance_terms?.length));
    for (const [k, v] of [['description0', 'Cement'], ['qty0', '100'], ['unit0', 'bag'], ['rate0', '400']]) await page.locator(`[data-cn-f="${k}"]`).fill(v);
    await page.locator('[data-cn-sa-save]').click();
    const sa = (await readJson(page, 'secured_advances', [], (v) => v?.length > 0))[0];
    check(sa?.amount === 30000, `secured advance 75% of ₹40,000 = ₹30,000 (${sa?.amount})`);
    // RA 1 and RA 2 (RA 2 recovers the advance on schedule, interest, the secured advance and client cement).
    await page.locator('[data-tw-view="ra"]').click();
    await page.locator('[data-ra-cum="2.1"]').fill('400', { timeout: 15000 });
    await page.locator('[data-ra-save]').click();
    await readJson(page, 'invoices', [], (v) => v.some((d) => d.boq_id === boq.id && d.ra_no === 1));
    await page.locator('[data-ra-cum="2.2"]').fill('100');
    await page.locator('[data-cn-recoveries] summary').click();
    await page.locator('[data-cn-f="kind0"]').selectOption('secured_advance');
    await page.locator('[data-cn-f="ref0"]').selectOption(sa.id);
    await page.locator('[data-cn-f="qty0"]').fill('100');
    await page.locator('[data-cn-rec-add]').click();
    await page.locator('[data-cn-f="kind1"]').selectOption('material_recovery');
    await page.locator('[data-cn-f="qty1"]').fill('10');
    await page.locator('[data-cn-f="rate1"]').fill('450');
    await page.locator('[data-ra-save]').click();
    const ra2 = (await readJson(page, 'invoices', [], (v) => v.some((d) => d.boq_id === boq.id && d.ra_no === 2))).find((d) => d.boq_id === boq.id && d.ra_no === 2);
    const by = (k) => (ra2?.ra_deductions ?? []).find((d) => d.kind === k)?.amount ?? 0;
    const ra1 = (await readJson(page, 'invoices', [])).find((d) => d.boq_id === boq.id && d.ra_no === 1);
    const interest = (ra1?.ra_deductions ?? []).find((d) => d.kind === 'advance_interest')?.amount ?? 0;
    check(by('advance_recovery') > 0 && interest > 0, `mobilisation advance: RA 2 recovers ${by('advance_recovery')} (10%→80% schedule), interest ${interest} on the balance`);
    check(by('secured_advance') === 30000 && by('material_recovery') === 4500 && by('water_power') === 9000, `RA 2: secured ₹30,000, cement ₹4,500, water + electricity 2% ₹9,000 (${by('secured_advance')} ${by('material_recovery')} ${by('water_power')})`);
    check(ra2?.total === 531000, 'GST on the full value (₹4,50,000 + 18%)');
    await page.locator('[data-tw-view="advances"]').click();
    const bal = (await page.locator('[data-cn-sa-balance]').first().innerText({ timeout: 15000 })).trim();
    check(/₹0\.00/.test(bal), `Works → Advances: secured advance balance ${bal}`);
    // B3: escalation → supplementary bill with the working page.
    await page.locator('[data-tw-view="escalation"]').click();
    await page.locator('[data-cn-f="s0"]').fill('100', { timeout: 15000 });
    await page.locator('[data-cn-f="b0"]').fill('400');
    await page.locator('[data-cn-pv-clause]').click();
    await readJson(page, 'works_contracts', [], (v) => v?.some((c) => c.escalation?.components?.length === 1));
    await page.locator('[data-cn-f="from"]').fill(await day(-1), { timeout: 15000 });
    await page.locator('[data-cn-f="to"]').fill(today);
    await page.locator('[data-cn-f="i:cement"]').fill('440');
    await page.locator('[data-cn-pv-save]').click();
    await page.locator('[data-cn-pv-bill]').click({ timeout: 15000 });
    const pv = (await readJson(page, 'price_variations', [], (v) => v?.[0]?.status === 'billed'))[0];
    check(pv?.amount === 46750, `PV = 0.85 × ₹5,50,000 × 10% = ₹46,750 (${pv?.amount})`);
    await page.goto(srv.origin + '/invoice/' + pv.invoice_id);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.locator('[data-pv-working]').first().waitFor({ timeout: 15000 });
    check(/Price variation statement PVB\/FY/i.test(await dialog.innerText()) && /46,750/.test(await dialog.innerText()), 'the working prints as the following page (PVB number, ₹46,750)');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    // B4: recovery receipts (cement, water + electricity …) are recorded through the clearing account — no cash.
    await page.goto(srv.origin + '/time?tab=works&view=retention');
    const row = page.locator(`[data-ra-split="${ra2.invoice_number}"]`);
    await row.waitFor({ timeout: 15000 });
    for (let i = 0; i < 4; i++) {
      const btn = row.getByRole('button', { name: 'Record deducted' }).first();
      if (!(await btn.count())) break;
      await btn.click();
      await page.waitForTimeout(300);
    }
    const rows = (await readJson(page, 'transactions', [], (v) => v.filter((p) => p.invoice_id === ra2.id && p.ra_journal_id).length >= 3)).filter((p) => p.invoice_id === ra2.id);
    check(rows.some((p) => p.ra_kind === 'material_recovery') && rows.some((p) => p.ra_kind === 'water_power') && rows.every((p) => p.ra_journal_id || p.advance_id), 'recovery receipts carry their journal (no cash moved)');
    // B5: a performance guarantee expiring in 20 days rings the bell.
    await page.goto(srv.origin + '/time?tab=works&view=guarantees');
    for (const [k, v] of [['bank', 'E2E Bank'], ['bg_no', 'PBG/E2E/1'], ['amount', '57500'], ['expires_on', await day(20)]]) await page.locator(`[data-cn-f="${k}"]`).fill(v, { timeout: 15000 });
    await page.locator('[data-cn-bg-save]').click();
    await page.locator('[data-cn-bg-row="PBG/E2E/1"]').waitFor();
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('dialog', { name: 'Notifications' }).getByText(/Bank guarantee PBG\/E2E\/1/).first().waitFor({ timeout: 15000 });
    check(true, 'the bell lists the guarantee expiring in 20 days');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });

  await step('R11-D site desk: a work order back-to-back at 90% of the BOQ rate; measuring 100 sqm makes the purchase bill with 194C on the value before GST and 5% retention by journal; a muster day settles as MUS with a payment voucher; the site P&L shows the sub-contractor cost and the margin', async () => {
    const keys = ['settings', 'construction_settings', 'invoices', 'vendors', 'godowns', 'cost_centres', 'purchases', 'vouchers', 'accounts', 'series_counters', 'sub_work_orders', 'sub_measurements', 'site_labour', 'muster_days', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'contractor', modules: undefined, industry_packs: ['works'], construction_kind: 'civil', retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'construction_settings', { views: { subcon: true, labour: true, plant: true, reco: true, pnl: true } });
    await writeJson(page, 'cost_centres', [...(prev.cost_centres ?? []), { id: 'e2e-sd-cc', name: 'E2E SH-14 project', kind: 'project', active: true }]);
    await writeJson(page, 'godowns', [...(prev.godowns ?? []), { id: 'e2e-sd-site', name: 'E2E SH-14 site', kind: 'site', boq_id: 'e2e-sd-boq', cost_centre_id: 'e2e-sd-cc' }]);
    await writeJson(page, 'vendors', [...(prev.vendors ?? []), { id: 'e2e-sd-sub', name: 'E2E Kumar Plasterers', pan: 'ABCPK1234L', state_code: '27' }]);
    const client = { id: 'e2e-sd-dept', name: 'E2E PWD Division 9', email: '', address: 'Pune', city: 'Pune', zip: '', state_code: '27' };
    const boq = {
      id: 'e2e-sd-boq', invoice_number: 'SO/E2E/0014', doc_type: 'SALES_ORDER', issue_date: '2026-05-01', due_date: '2026-05-31', status: 'Sent', currency: 'INR', template_id: 'classic_orange', client, sender: (prev.settings?.profiles ?? [])[0] ?? null,
      items: [{ id: 'e2e-sd-l1', name: 'Plaster 12 mm', boq_ref: '5.1', type: 'Service', hsn: '995411', unit: 'SQM', quantity: 1000, rate: 400, tax_rate: 18, discount_percent: 0, amount: 400000 }],
      gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false,
      amount_paid: 0, notes: '', terms: '', subtotal: 400000, discount_amount: 0, taxable_value: 400000, cgst_amount: 36000, sgst_amount: 36000, igst_amount: 0, tax_amount: 72000, round_off: 0, total: 472000, balance_due: 472000,
      boq_terms: { cost_centre_id: 'e2e-sd-cc' },
    };
    await writeJson(page, 'invoices', [...(prev.invoices ?? []), boq]);
    // D1: work order from the BOQ at 90%, 5% retention.
    await page.goto(srv.origin + '/time?tab=works&view=subcon&boq=e2e-sd-boq');
    await page.locator('[data-sd="wo-vendor"]').selectOption('e2e-sd-sub', { timeout: 15000 });
    await page.locator('[data-sd-save-wo]').click();
    const wo = (await readJson(page, 'sub_work_orders', [], (v) => v?.length > 0))[0];
    check(/^SWO\/FY\d\d-\d\d\/0001$/.test(wo?.number ?? '') && wo.lines[0].rate === 360 && wo.lines[0].ref === '5.1', `work order ${wo?.number}: back-to-back at 90% (${wo?.lines?.[0]?.rate})`);
    // Measure 100 sqm → the purchase bill.
    await page.locator('[data-sd-cum]').first().fill('100');
    await page.locator('[data-sd-save-bill]').click();
    const bill = (await readJson(page, 'purchases', [], (v) => v?.some((p) => p.cn_sub?.kind === 'subcon'))).find((p) => p.cn_sub?.kind === 'subcon');
    check(bill?.taxable === 36000 && bill.tds_section === '194C-1' && bill.tds_amount === 360 && bill.cn_sub.deductions.some((d) => d.kind === 'retention' && d.amount === 1800) && bill.amount_paid === 1800, `sub-contractor bill ${bill?.bill_number}: 194C 1% on ₹36,000 and 5% retention by journal`);
    const jv = (await readJson(page, 'vouchers', [], (v) => v?.some((x) => x.id === bill?.cn_sub?.jv_id))).find((x) => x.id === bill?.cn_sub?.jv_id);
    check(jv?.voucher_class === 'Sub-contractor deductions', 'the deductions journal is posted');
    // D2: a worker, a muster day, the weekly settlement.
    await page.goto(srv.origin + '/time?tab=works&view=labour');
    await page.locator('[data-sd="w-name"]').fill('E2E Ramu', { timeout: 15000 });
    await page.locator('[data-sd="w-rate"]').fill('800');
    await page.locator('[data-sd-add-worker]').click();
    await page.locator('[data-sd-mark]').click({ timeout: 15000 });
    await readJson(page, 'muster_days', [], (v) => v?.length > 0);
    await page.locator('[data-sd-settle]').click({ timeout: 15000 });
    const days = await readJson(page, 'muster_days', [], (v) => v?.some((d) => d.mus_no));
    check(/^MUS\/FY\d\d-\d\d\/0001$/.test(days[0]?.mus_no ?? '') && !!days[0].voucher_id, `muster settled ${days[0]?.mus_no} with a payment voucher`);
    // D5: the site P&L.
    await page.goto(srv.origin + '/time?tab=works&view=pnl&boq=e2e-sd-boq');
    const pnl = page.locator('[data-sd-table="pnl"]');
    await pnl.waitFor({ timeout: 15000 });
    const text = await pnl.innerText();
    check(/Sub-contractor bills/.test(text) && /36,000/.test(text) && /Site wages/.test(text) && /800/.test(text) && (await page.locator('[data-sd-margin]').count()) === 1, 'site P&L: sub-contractor bill and muster wages as costs, a margin line');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R10-A service desk: Services → Salon (salon pack, staff required, ITC caution); a plan at 10% and a stylist; a booking from the day grid with a 9997 service (5% after 22 Sep 2025); arrived → Bill → the POS has the line with the stylist; the appointment shows Billed; the statement shows her commission; Ctrl+K "appointment"; help', async () => {
    const keys = ['settings', 'service_settings', 'service_staff', 'commission_plans', 'appointments', 'invoices', 'transactions', 'series_counters', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'services', modules: undefined, industry_packs: undefined, service_kind: undefined, construction_kind: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'service_settings', null);
    // SV-A1: the service picker in Settings → Features.
    await page.goto(srv.origin + '/settings?tab=features');
    await page.locator('[data-service-kind-card="salon"]').click({ timeout: 15000 });
    await page.getByRole('button', { name: 'Save settings' }).first().click();
    const st = await readJson(page, 'settings', {}, (v) => v.service_kind === 'salon');
    const ss = await readJson(page, 'service_settings', {}, (v) => v?.staff_required === true);
    check(st.industry_packs?.includes('salon') && st.modules?.includes('pos') && st.modules?.includes('time') && ss.itc_caution === true, 'Salon: salon pack, POS + Time modules, staff required and the ITC caution on');
    // SV-A3: a plan (services 10%) and a stylist on it.
    await page.goto(srv.origin + '/time?tab=commission&view=plans');
    await page.locator('[data-plan-name]').fill('E2E Stylist 10%', { timeout: 15000 });
    await page.locator('[data-plan-save]').click();
    await readJson(page, 'commission_plans', [], (v) => v.some((p) => p.name === 'E2E Stylist 10%'));
    await page.goto(srv.origin + '/time?tab=commission&view=staff');
    await page.locator('[data-staff-name]').fill('E2E Priya', { timeout: 15000 });
    await page.locator('[data-staff-plan]').selectOption({ label: 'E2E Stylist 10%' });
    await page.locator('[data-staff-save]').click();
    const staff = (await readJson(page, 'service_staff', [], (v) => v.some((x) => x.name === 'E2E Priya'))).find((x) => x.name === 'E2E Priya');
    check(!!staff?.plan_id, 'the stylist is saved with her plan');
    // SV-A2: book from the day grid (Priya's column, 11:00), a beauty (9997) service.
    await page.goto(srv.origin + '/time?tab=appointments');
    await page.locator('[data-slot="E2E Priya@11:00"]').click({ timeout: 15000 });
    await page.locator('[data-appt-client]').fill('E2E Salon Client');
    await page.locator('[data-appt-add-service]').click();
    await page.locator('[data-appt-service="0"]').fill('E2E Haircut');
    const row = page.locator('[data-appt-service="0"]').locator('xpath=ancestor::tr');
    await row.locator('td').nth(2).locator('input').fill('500');
    await row.locator('td').nth(3).locator('select').selectOption('beauty_9997');
    await page.locator('[data-appt-save]').click();
    const appt = (await readJson(page, 'appointments', [], (v) => v.some((a) => a.client_name === 'E2E Salon Client'))).find((a) => a.client_name === 'E2E Salon Client');
    check(appt?.start === '11:00' && appt.staff_id === staff.id && appt.services[0]?.sv_class === 'beauty_9997', 'booked at 11:00 with the stylist and a 9997 service');
    await page.locator('[data-appt-chip="E2E Salon Client"]').click();
    await page.locator('[data-appt-status="arrived"]').click();
    await readJson(page, 'appointments', [], (v) => v.some((a) => a.id === appt.id && a.status === 'arrived'));
    await page.locator('[data-appt-chip="E2E Salon Client"]').click();
    await page.locator('[data-appt-bill]').click();
    await page.waitForURL(/\/pos/, { timeout: 15000 });
    await page.getByText('E2E Haircut').first().waitFor({ timeout: 15000 });
    const beforeIds = new Set((await readJson(page, 'invoices', [])).map((i) => i.id));
    await page.waitForFunction(() => /[1-9]/.test(document.querySelector('[data-pos-total]')?.textContent ?? ''), null, { timeout: 15000 });
    const due = (await page.locator('[data-pos-total]').innerText()).replace(/[^\d.]/g, '');
    await page.locator('#pos-Cash').fill(due); // paid in cash
    await page.getByRole('button', { name: /Save bill/ }).click();
    const fresh = (await readJson(page, 'invoices', [], (v) => v.some((i) => !beforeIds.has(i.id)))).filter((i) => !beforeIds.has(i.id));
    const bill = fresh.find((i) => i.items?.some((l) => l.sv?.appointment_id === appt.id));
    check(!!bill, `the POS bill carries the appointment on its line (new bills: ${fresh.map((i) => i.invoice_number).join(', ') || 'none'})`);
    const line = bill?.items.find((l) => l.sv?.appointment_id === appt.id);
    check(line?.sv?.staff_id === staff.id && line.sv.cls === 'beauty_9997' && Number(line.tax_rate) === 5, `the POS bill ${bill?.invoice_number} carries the stylist and the 5% class rate`);
    await page.goto(srv.origin + '/time?tab=appointments');
    await page.locator('[data-appt-chip="E2E Salon Client"]').waitFor({ timeout: 15000 });
    check(/Billed/.test(await page.locator('[data-appt-chip="E2E Salon Client"]').innerText()), 'the appointment shows Billed');
    // The month's statement.
    await page.goto(srv.origin + '/time?tab=commission&view=statement');
    await page.locator('[data-statement-staff]').selectOption({ label: 'E2E Priya' }, { timeout: 15000 });
    check(/50\.00/.test(await page.locator('[data-statement-total]').innerText()), 'the statement shows 10% of the ₹500 taxable value');
    // Ctrl+K and help.
    await page.goto(srv.origin + '/');
    await page.getByRole('navigation', { name: /Primary/ }).getByRole('link', { name: 'Dashboard' }).waitFor();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill('appointment');
    await palette.getByRole('option', { name: /Appointments/ }).first().waitFor({ timeout: 15000 });
    check(true, 'Ctrl+K "appointment" finds Time → Appointments');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/time?tab=appointments');
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    await page.locator('[data-screen-help="time:appointments"]').waitFor({ timeout: 15000 });
    check(true, 'Help opens on the Appointments topic');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
  });
  await step('R10-C members desk: Gym — sell a 6-month plan (5%), freeze 20 days → the end moves 20 days; check-in by member code shows "Active till", an expired member the renew prompt; a 6-facial package redeemed at the POS is a ₹0 line "Session 1 of 6"; coaching: Fees → Batches timetable, a refund after 3 of 10 months → a credit note', async () => {
    const keys = ['settings', 'service_settings', 'member_plans', 'memberships', 'checkins', 'class_schedules', 'class_attendance', 'appointments', 'clients', 'fee_plans', 'fee_runs', 'batch_runs', 'invoices', 'transactions', 'doc_links', 'series_counters', 'audit_log'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    const ymd = (t) => `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    const now = new Date();
    const today = ymd(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
    const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return ymd(new Date(Date.UTC(y, m - 1, d + n))); };
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'services', modules: undefined, industry_packs: ['fitness', 'salon', 'fees'], service_kind: 'fitness', construction_kind: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'service_settings', { checkin_gate: 'warn' });
    for (const k of ['member_plans', 'memberships', 'checkins', 'class_schedules', 'class_attendance', 'fee_runs']) await writeJson(page, k, null);
    const base = { email: '', address: '', city: '', zip: '' };
    await writeJson(page, 'clients', [...(prev.clients ?? []), { ...base, id: 'e2e-meera', name: 'E2E Meera' }, { ...base, id: 'e2e-kiran', name: 'E2E Kiran', enrolments: [{ plan_id: 'e2e-fp', from: '2026-06-01', concessions: [] }] }]);
    await writeJson(page, 'fee_plans', [{ id: 'e2e-fp', name: 'E2E JEE', year_label: '2026-27', preset: 'coaching', heads: [{ name: 'Tuition', amount: 100000, tax: 'taxable', gst_rate: 18, sac: '999293', frequency: 'per_instalment' }], instalments: [{ label: 'Full', due_date: today, share: 100 }] }]);
    // C1: plans.
    await page.goto(srv.origin + '/time?tab=members&view=plans');
    await page.locator('[data-mp-name]').fill('E2E 6 months', { timeout: 15000 });
    await page.locator('[data-mp-months]').fill('6');
    await page.locator('[data-mp-price]').fill('9000');
    await page.locator('[data-mp-cls]').selectOption('fitness_9997');
    await page.locator('[data-mp-save]').click();
    await readJson(page, 'member_plans', [], (v) => v?.some((p) => p.name === 'E2E 6 months'));
    await page.locator('[data-mp-name]').fill('E2E 6 facials');
    await page.locator('[data-mp-kind]').selectOption('package');
    await page.locator('[data-mp-sessions]').fill('6');
    await page.locator('[data-mp-price]').fill('9000');
    await page.locator('[data-mp-covers]').fill('Facial');
    await page.locator('[data-mp-save]').click();
    await readJson(page, 'member_plans', [], (v) => v?.length === 2);
    // C1: sell, freeze.
    await page.goto(srv.origin + '/time?tab=members&view=members');
    const sell = async (name, plan, start) => {
      await page.locator('[data-mem-client]').first().fill(name, { timeout: 15000 });
      await page.locator('[data-mem-plan]').selectOption({ label: plan });
      await page.locator('[data-mem-start]').fill(start);
      await page.locator('[data-mem-sell]').click();
      return (await readJson(page, 'memberships', [], (v) => v?.some((m) => m.client_name === name))).find((m) => m.client_name === name);
    };
    const rahul = await sell('E2E Rahul', 'E2E 6 months', today);
    const sale = (await readJson(page, 'invoices', [])).find((i) => i.id === rahul?.invoice_ids?.[0]);
    check(/^MEM\/FY\d\d-\d\d\/\d{4}$/.test(rahul?.number ?? '') && sale?.status === 'Sent' && Number(sale.items[0].tax_rate) === 5 && sale.items[0].rate === 9000, `plan sold: ${rahul?.number} with one issued 5% invoice for the whole price`);
    const old = await sell('E2E Old', 'E2E 6 months', '2025-04-01');
    const meera = await sell('E2E Meera', 'E2E 6 facials', today);
    check(meera?.client_id === 'e2e-meera', 'the package is on the saved customer');
    await page.locator('tr', { hasText: rahul.number }).locator('[data-mem-act-row]').click();
    await page.locator('[data-mem-act]').selectOption('freeze');
    await page.locator('[data-mem-from]').fill(addDays(today, 10));
    await page.locator('[data-mem-to]').fill(addDays(today, 29));
    await page.locator('[data-mem-go]').click();
    const frozen = (await readJson(page, 'memberships', [], (v) => v.some((m) => m.id === rahul.id && m.freezes?.length))).find((m) => m.id === rahul.id);
    check(frozen?.end === addDays(rahul.end, 20), `freeze 20 days: end ${rahul.end} → ${frozen?.end}`);
    // C2: check-in by member code; an expired member gets the renew prompt (warn).
    await page.goto(srv.origin + '/time?tab=members&view=checkin');
    await page.locator('[data-checkin-code]').fill(rahul.number, { timeout: 15000 });
    await page.locator('[data-checkin-status]').first().waitFor({ timeout: 15000 });
    check(/Active till/.test(await page.locator('[data-checkin-status]').first().innerText()), 'check-in by code shows "Active till …"');
    await page.locator('[data-checkin-go]').first().click();
    const days = await readJson(page, 'checkins', [], (v) => v?.some((d) => d.entries?.some((e) => e.membership_id === rahul.id)));
    check(days.length === 1 && days[0].date === today, 'one check-in row for the day');
    await page.locator('[data-checkin-code]').fill(old.number);
    await page.waitForFunction(() => /renew\?/.test(document.querySelector('[data-checkin-status]')?.textContent ?? ''), null, { timeout: 15000 });
    check(true, 'an expired member shows "Expired … — renew?"');
    // C1: the package redeemed at the POS (the appointment brings the customer and the Facial line).
    await writeJson(page, 'appointments', [...(prev.appointments ?? []), { id: 'e2e-appt-c', date: today, start: '10:00', minutes: 45, client_id: 'e2e-meera', client_name: 'E2E Meera', services: [{ name: 'Facial', minutes: 45, price: 1500 }], status: 'arrived', created_at: `${today}T09:00:00.000Z` }]);
    await page.goto(srv.origin + '/pos?appt=e2e-appt-c');
    await page.locator('[data-pos-redeem]').first().click({ timeout: 15000 });
    await page.waitForFunction(() => /5 left/.test(document.querySelector('[data-pos-redeem]')?.textContent ?? ''), null, { timeout: 15000 });
    check(!/[1-9]/.test(await page.locator('[data-pos-total]').innerText()), 'the POS line becomes the ₹0 redemption "Session 1 of 6" (5 left)');
    // C3: coaching — bill the instalment, a batch with its timetable, the student on it, a refund after 3 of 10 months.
    await page.goto(srv.origin + '/recurring?tab=fees&view=bill');
    await page.locator('[data-fee-preview]').click({ timeout: 15000 });
    await page.locator('[data-fee-issue]').click({ timeout: 15000 });
    await readJson(page, 'invoices', [], (v) => v.some((i) => i.fee_plan_id === 'e2e-fp' && i.status !== 'Draft'));
    await page.goto(srv.origin + '/recurring?tab=fees&view=batches');
    const batches = page.locator('[data-fees-r10="batches"]');
    await page.locator('[data-class-name]').fill('E2E Batch B', { timeout: 15000 });
    for (const d of ['Mon', 'Wed', 'Fri']) await batches.getByLabel(d, { exact: true }).check();
    await batches.getByLabel('Start date').fill('2026-06-01');
    await page.locator('[data-class-to]').fill('2027-03-31');
    await page.locator('[data-class-save]').click();
    await page.locator('[data-timetable]').getByText(/E2E Batch B/).first().waitFor({ timeout: 15000 });
    check(true, 'Fees → Batches shows the batch on the timetable');
    await batches.locator('select[aria-label="Batch"]').first().selectOption({ label: 'E2E Batch B' });
    await readJson(page, 'clients', [], (v) => v.some((c) => c.id === 'e2e-kiran' && c.enrolments?.[0]?.class_id));
    await page.goto(srv.origin + '/recurring?tab=fees&view=refunds');
    await page.locator('[data-refund-leave]').fill('2026-08-31', { timeout: 15000 });
    await page.locator('[data-refund-basis]').selectOption('months');
    await page.locator('[data-refund-preview]').click();
    const calc = await page.locator('[data-refund-calc]').innerText({ timeout: 15000 });
    check(/used 3 \/ 10/.test(calc) && /70,000/.test(calc), `refund preview: ${calc.slice(0, 120)}`);
    await page.locator('[data-refund-issue]').click();
    const notes = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.doc_type === 'CREDIT_NOTE' && i.client?.id === 'e2e-kiran'))).filter((i) => i.doc_type === 'CREDIT_NOTE' && i.client?.id === 'e2e-kiran');
    check(notes.length === 1 && Number(notes[0].taxable_value) === 70000 && Number(notes[0].tax_amount) === 12600, `credit note ${notes[0]?.invoice_number}: ₹70,000 taxable with 18% reversed`);
  await step('R10-D workshop desk: Services → Vehicle workshop; vehicle MH12AB1234 and a labour op; job card with the odometer; estimate (pads + labour) approved by phone; Bill job → parts and labour lines at their own rates; a ₹50,000 accident job with a cashless claim approved ₹42,000 → two invoices (insurer, owner) totalling the job; Reminders shows the next service; help', async () => {
    const keys = ['settings', 'workshop_settings', 'service_assets', 'labour_ops', 'service_jobs', 'invoices', 'stock_items', 'clients', 'payer_claims', 'series_counters', 'audit_log', 'doc_links', 'transactions', 'appointments'];
    const prev = Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await readJson(page, k, null)])));
    await writeJson(page, 'settings', { ...(prev.settings ?? {}), business_type: 'services', modules: undefined, industry_packs: ['workshop'], service_kind: 'workshop', construction_kind: undefined, retail_kind: undefined, trade_kind: undefined, lock_until: undefined });
    await writeJson(page, 'stock_items', [...(prev.stock_items ?? []), { id: 'e2e-pads', name: 'E2E Brake pads', unit: 'NOS', hsn: '8708', track_stock: true, opening_qty: 10, opening_rate: 1500, reorder_level: 0, sale_rate: 2150, tax_rate: 18 }]);
    await writeJson(page, 'clients', [...(prev.clients ?? []), { id: 'e2e-acko', name: 'E2E ACKO General', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27' }]);
    // SV-D1 vehicle; SV-D2 labour op, rates and the interval.
    await page.goto(srv.origin + '/time?tab=workshop&view=vehicles');
    await page.locator('[data-ws-reg_no]').fill('mh12 ab 1234', { timeout: 15000 });
    await page.locator('[data-ws-make]').fill('Maruti');
    await page.locator('[data-ws-model]').fill('Swift');
    await page.locator('[data-ws-owner_name]').fill('E2E Mr Patil');
    await page.locator('[data-ws-cls]').selectOption('hatch');
    await page.locator('[data-ws-asset-save]').click();
    const asset = (await readJson(page, 'service_assets', [], (v) => v.some((a) => a.reg_no === 'MH12AB1234'))).find((a) => a.reg_no === 'MH12AB1234');
    check(asset?.vclass === 'hatch', 'the vehicle is saved with its registration no. normalised');
    await page.goto(srv.origin + '/time?tab=workshop&view=labour');
    await page.locator('[data-ws-code]').fill('BRK01', { timeout: 15000 });
    await page.locator('[data-ws-name]').fill('Front brake pad replace');
    await page.locator('[data-ws-hhatch]').fill('0.8');
    await page.locator('[data-ws-op-save]').click();
    await readJson(page, 'labour_ops', [], (v) => v.some((o) => o.code === 'BRK01'));
    await page.locator('[data-ws-rhatch]').fill('900');
    await page.locator('[data-ws-interval_days]').last().fill('20');
    await page.locator('[data-ws-settings-save]').click();
    await readJson(page, 'workshop_settings', {}, (v) => v?.labour_rate?.hatch === 900);
    // Job card with the odometer.
    await page.goto(srv.origin + '/time?tab=workshop&view=jobs');
    await page.locator('[data-ws-asset]').selectOption(asset.id, { timeout: 15000 });
    await page.locator('[data-ws-odometer]').fill('48210');
    await page.locator('[data-ws-complaints]').fill('Brake noise');
    await page.locator('[data-ws-open]').click();
    const job = (await readJson(page, 'service_jobs', [], (v) => v.some((j) => j.asset_id === asset.id))).find((j) => j.asset_id === asset.id);
    check(job?.odometer_in === 48210 && /^SVC\//.test(job.number), `job card ${job?.number} with the odometer`);
    // Estimate: pads + labour, approved by phone.
    await page.goto(srv.origin + '/time?tab=workshop&view=estimates');
    await page.locator('[data-ws-job]').selectOption(job.id, { timeout: 15000 });
    await page.locator('[data-ws-op]').selectOption({ label: 'BRK01 · Front brake pad replace' });
    await page.locator('[data-ws-add-op]').click();
    await page.locator('[data-ws-item]').selectOption('e2e-pads');
    await page.locator('[data-ws-qty]').fill('1');
    await page.locator('[data-ws-add-part]').click();
    await page.locator('[data-ws-estimate]').click();
    const quote = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.sv?.job?.id === job.id && i.doc_type === 'QUOTATION'))).find((i) => i.sv?.job?.id === job.id && i.doc_type === 'QUOTATION');
    check(quote?.items?.length === 2, 'the estimate is a quotation on the job');
    await page.locator('[data-ws-quote]').selectOption(quote.id);
    await page.locator('[data-ws-by]').fill('E2E Mr Patil');
    await page.locator('[data-ws-approve]').click();
    await readJson(page, 'service_jobs', [], (v) => v.some((j) => j.id === job.id && j.approvals?.[0]?.how === 'phone'));
    // Board: move to ready, Bill job.
    await page.goto(srv.origin + '/time?tab=workshop&view=jobs');
    const row = page.locator(`[data-ws-job="${job.number}"]`);
    for (const s of ['diagnosed', 'approved', 'in_repair', 'ready']) {
      await row.locator(`[data-ws-move="${s}"]`).click({ timeout: 15000 });
      await readJson(page, 'service_jobs', [], (v) => v.some((j) => j.id === job.id && j.status === s));
    }
    await row.locator('[data-ws-bill]').click();
    await page.waitForURL(/\/invoice\//, { timeout: 15000 });
    const bill = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.sv?.job?.id === job.id && i.doc_type !== 'QUOTATION'))).find((i) => i.sv?.job?.id === job.id && i.doc_type !== 'QUOTATION');
    const lab = bill?.items.find((l) => l.sv?.labour_op_id);
    const pad = bill?.items.find((l) => l.name === 'E2E Brake pads');
    check(lab?.quantity === 0.8 && lab.rate === 900 && lab.hsn === '998714' && Number(lab.tax_rate) === 18 && pad?.rate === 2150 && pad.hsn === '8708', `bill ${bill?.invoice_number}: labour 0.8 h × ₹900 (SAC 998714, 18%) and the pads at their own HSN`);
    // Claim: a ₹50,000 job, cashless, approved ₹42,000.
    await page.goto(srv.origin + '/time?tab=workshop&view=jobs');
    await page.locator('[data-ws-asset]').selectOption(asset.id, { timeout: 15000 });
    await page.locator('[data-ws-odometer]').fill('48300');
    await page.locator('[data-ws-complaints]').fill('Accident repair');
    await page.locator('[data-ws-open]').click();
    const job2 = (await readJson(page, 'service_jobs', [], (v) => v.filter((j) => j.asset_id === asset.id).length === 2)).find((j) => j.asset_id === asset.id && j.id !== job.id);
    await page.goto(srv.origin + '/time?tab=workshop&view=estimates');
    await page.locator('[data-ws-job]').selectOption(job2.id, { timeout: 15000 });
    await page.locator('[data-ws-sublet]').fill('Body work');
    await page.locator('[data-ws-cost]').fill('42372.88');
    await page.getByRole('button', { name: /Outside work \+/ }).click();
    await page.locator('[data-ws-estimate]').click();
    const q2 = (await readJson(page, 'invoices', [], (v) => v.some((i) => i.sv?.job?.id === job2.id))).find((i) => i.sv?.job?.id === job2.id);
    await page.locator('[data-ws-quote]').selectOption(q2.id);
    await page.locator('[data-ws-by]').fill('E2E Surveyor');
    await page.locator('[data-ws-approve]').click();
    await readJson(page, 'service_jobs', [], (v) => v.some((j) => j.id === job2.id && j.approvals?.length));
    await page.goto(srv.origin + '/time?tab=workshop&view=claims');
    await page.locator('[data-ws-job]').first().selectOption(job2.id, { timeout: 15000 });
    await page.locator('[data-ws-insurer]').selectOption('e2e-acko');
    await page.locator('[data-ws-apr]').first().fill('42000');
    await page.locator('[data-ws-claim]').click();
    await readJson(page, 'service_jobs', [], (v) => v.some((j) => j.id === job2.id && j.claim_id));
    await page.goto(srv.origin + '/time?tab=workshop&view=jobs');
    const row2 = page.locator(`[data-ws-job="${job2.number}"]`);
    for (const s of ['diagnosed', 'approved', 'in_repair', 'ready']) {
      await row2.locator(`[data-ws-move="${s}"]`).click({ timeout: 15000 });
      await readJson(page, 'service_jobs', [], (v) => v.some((j) => j.id === job2.id && j.status === s));
    }
    await row2.locator('[data-ws-bill]').click();
    await page.waitForURL(/\/invoice\//, { timeout: 15000 });
    await page.goto(srv.origin + '/time?tab=workshop&view=claims');
    await page.locator('[data-ws-job]').last().selectOption(job2.id, { timeout: 15000 });
    await page.locator('[data-ws-apr]').last().fill('42000');
    await page.locator('[data-ws-split]').click();
    const claim = (await readJson(page, 'payer_claims', [], (v) => v.some((c) => c.source?.id === job2.id && c.payer_invoice_id))).find((c) => c.source?.id === job2.id);
    const invs = await readJson(page, 'invoices', []);
    const payer = invs.find((i) => i.id === claim?.payer_invoice_id);
    const owner = invs.find((i) => i.id === claim?.beneficiary_invoice_id);
    check(payer?.client?.name === 'E2E ACKO General' && Math.abs(Number(payer.total) - 42000) <= 1 && Math.abs(Number(payer.total) + Number(owner?.total) - 50000) <= 1, `two invoices: insurer ${payer?.total}, owner ${owner?.total} (job ₹50,000)`);
    // Reminders: next service within 20 days.
    await page.goto(srv.origin + '/time?tab=workshop&view=reminders');
    await page.locator('[data-ws-due="service"]').first().waitFor({ timeout: 15000 });
    check(/MH12AB1234/.test(await page.locator('[data-ws-due="service"]').first().innerText()), 'Reminders shows the next service');
    await page.getByRole('button', { name: 'Help and about' }).first().click();
    await page.locator('[data-screen-help^="time:workshop"]').first().waitFor({ timeout: 15000 });
    check(true, 'Help opens on a workshop topic');
    await page.keyboard.press('Escape');
    await page.goto(srv.origin + '/expenses');
    for (const k of keys) await writeJson(page, k, prev[k]);
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
