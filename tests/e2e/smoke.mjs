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
    await page.getByText('Transport / dispatch details').click();
    await page.getByLabel('Vehicle number').fill('ka01ab0001');
    await page.getByLabel('Transporter name').fill('Speedy Roadways');
    await page.keyboard.press('Control+s');
    const inv = (await readJson(page, 'invoices', [], (v) => v[0]?.transport?.vehicle_no))[0];
    check(/^KA01AB0001$/i.test(inv.transport?.vehicle_no ?? ''), `transport details are saved on the invoice (${inv.transport?.vehicle_no})`);
    await page.getByRole('button', { name: /Preview & download PDF/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.waitFor();
    const vehicle = await dialog.locator('[data-transport-row="vehicle"]').first().innerText();
    check(/KA01AB0001/i.test(vehicle), `the transport block prints the vehicle no. (${vehicle.replace(/\s+/g, ' ').trim()})`);

    const pdfPages = async () => {
      await dialog.getByRole('button', { name: /^Share/ }).click();
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Download PDF/ }).click()]);
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
    await page.getByRole('button', { name: 'Undo' }).click();
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
    check((await dlg.locator('#ret-Cash').inputValue()) === '118', `refund defaults to cash 118 (${await dlg.locator('#ret-Cash').inputValue()})`);
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

  await step('delete without undo really deletes', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByRole('button', { name: /^Delete INV/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(6500);
    const left = (await readJson(page, 'invoices', [], (v) => v.length === 0)).length;
    check(left === 0, `the delete is committed after the undo window (${left} left)`);
  });

  await step('composition profile issues a Bill of Supply with the Rule 49 declaration', async () => {
    await page.goto(srv.origin + '/settings');
    await page.getByLabel('GST scheme').selectOption('composition');
    await page.getByLabel('Composition category').selectOption('trader');
    await page.getByRole('button', { name: 'Save settings' }).click();
    const s = await readJson(page, 'settings', {}, (v) => v.profiles?.some((p) => p.gst_scheme === 'composition'));
    check(s.profiles?.find((p) => p.id === s.activeProfileId)?.gst_scheme === 'composition', 'profile switched to the composition scheme');

    await page.goto(srv.origin + '/invoice');
    const type = await page.getByRole('combobox', { name: /^Type/ }).first().inputValue();
    check(type === 'BILL_OF_SUPPLY', `a composition profile opens a Bill of Supply (${type})`);
    await page.getByLabel('Client name').fill('Corner Shop');
    await page.getByLabel('Item 1 name').fill('Biscuits');
    await page.getByLabel('Item 1 quantity').fill('10');
    await page.getByLabel('Item 1 rate').fill('100');
    check((await page.getByLabel('Item 1 GST rate').count()) === 0, 'no GST rate column on a Bill of Supply');
    await page.keyboard.press('Control+s');
    await page.getByText(/saved/i).first().waitFor();
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
