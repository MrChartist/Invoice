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
    await page.getByRole('button', { name: /Finish/ }).click();
    await page.waitForURL(/\/invoice/);
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_settings') || '{}'));
    const p = s.profiles?.find((x) => x.id === s.activeProfileId) ?? {};
    check(s.onboarded === true && p.companyName === 'E2E Trader' && p.stateCode === '27' && p.upiId === 'e2e@okhdfcbank',
      `wizard saves the profile (${p.companyName}, state ${p.stateCode}, ${p.upiId}) and opens the editor`);
  });

  await step('create and save an invoice', async () => {
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
    await page.evaluate(() => localStorage.removeItem('mrchartist_inv_draft'));
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

  await step('client copy is a static web page with a pay button', async () => {
    // The earlier step stubbed navigator.share; drop it so this one downloads.
    await page.evaluate(() => { delete navigator.share; delete navigator.canShare; });
    await page.reload();
    await page.getByRole('button', { name: /preview|view/i }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Document preview' });
    await dialog.getByRole('button', { name: /^Share/ }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Client copy/ }).click()]);
    const html = readFileSync(await dl.path(), 'utf8');
    check(/\.html$/.test(dl.suggestedFilename()) && !/<script/i.test(html) && html.includes('Acme Buyers') && /href="upi:\/\/pay\?pa=e2e@okhdfcbank/.test(html),
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
    const paid = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices'))[0]);
    check(paid.status === 'Paid' && paid.balance_due === 0, `bulk mark paid settles the invoice (${paid.status}, balance ${paid.balance_due})`);

    await page.getByRole('button', { name: /^Delete INV/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(6500);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices')).length);
    check(after === 1, `Undo keeps the deleted invoice (${after} stored after the undo window)`);
    await page.getByText('Acme Buyers').first().waitFor();
  });

  await step('raise a debit note from the invoice', async () => {
    const id = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices'))[0].id);
    await page.goto(srv.origin + '/invoice/' + id);
    await page.getByRole('button', { name: /^Convert/ }).click();
    await page.getByRole('menuitem', { name: 'Create debit note' }).click();
    const dlg = page.getByRole('dialog', { name: 'Create debit note' });
    await dlg.getByLabel('Reason *').fill('Rate revision');
    await dlg.getByLabel('Line 1 description').fill('Rate difference');
    await dlg.getByLabel('Line 1 rate').fill('200');
    await dlg.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/invoice/') && !u.pathname.endsWith(id));
    const dn = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices')).find((i) => i.doc_type === 'DEBIT_NOTE'));
    check(!!dn && /^DBN\/FY\d{2}-\d{2}\/0001$/.test(dn.invoice_number) && Math.abs(dn.total - 236) < 0.01,
      `debit note ${dn?.invoice_number} for ${dn?.total} opens in the editor`);
    // Keep later steps about the original invoice simple.
    await page.evaluate((dnId) => {
      const rows = JSON.parse(localStorage.getItem('mrchartist_inv_invoices')).filter((i) => i.id !== dnId);
      localStorage.setItem('mrchartist_inv_invoices', JSON.stringify(rows));
    }, dn.id);
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
    const vouchers = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_vouchers') || '[]'));
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
    await page.getByRole('button', { name: 'Capital account' }).click();
    await page.getByRole('tab', { name: 'Ledger', selected: true }).waitFor();
    check(await page.getByText(/JV\/FY\d{2}-\d{2}\/0001/).first().isVisible(), 'drill-down opens the capital ledger with the voucher');
  });

  await step('sales order converts its pending quantity; purchase orders tab opens', async () => {
    const soId = await page.evaluate(() => {
      const rows = JSON.parse(localStorage.getItem('mrchartist_inv_invoices'));
      const so = {
        ...rows[0],
        id: 'e2e-so',
        doc_type: 'SALES_ORDER',
        invoice_number: 'SO/FY26-27/0001',
        status: 'Sent',
        amount_paid: 0,
        items: rows[0].items.map((i) => ({ ...i, id: 'e2e-so-line', quantity: 3 })),
      };
      localStorage.setItem('mrchartist_inv_invoices', JSON.stringify([...rows, so]));
      return so.id;
    });
    await page.goto(srv.origin + '/invoice/' + soId);
    await page.getByRole('region', { name: 'Order fulfilment' }).getByText('Open', { exact: true }).waitFor();
    await page.getByRole('button', { name: /^Convert/ }).click();
    await page.getByRole('menuitem', { name: /Convert to Delivery Challan/ }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/invoice/') && !u.pathname.endsWith(soId));
    const dc = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices')).find((i) => i.doc_type === 'DELIVERY_CHALLAN'));
    check(dc?.sales_order_id === soId && dc.items.length === 1 && dc.items[0].quantity === 3 && dc.items[0].order_line_id === 'e2e-so-line',
      `challan ${dc?.invoice_number} carries the order's pending quantity (${dc?.items?.[0]?.quantity})`);
    await page.goto(srv.origin + '/transactions?type=SALES_ORDER');
    await page.locator('td').getByText('Partly fulfilled').first().waitFor();
    check(true, 'the order list shows the sales order as Partly fulfilled');
    await page.goto(srv.origin + '/expenses?tab=orders');
    await page.getByText('No purchase orders yet').waitFor();
    check(true, 'Expenses → Purchase orders tab loads');
    await page.evaluate((ids) => {
      const rows = JSON.parse(localStorage.getItem('mrchartist_inv_invoices')).filter((i) => !ids.includes(i.id));
      localStorage.setItem('mrchartist_inv_invoices', JSON.stringify(rows));
      localStorage.setItem('mrchartist_inv_doc_links', '[]');
    }, [soId, dc?.id]);
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

  await step('delete without undo really deletes', async () => {
    await page.goto(srv.origin + '/transactions');
    await page.getByRole('button', { name: /^Delete INV/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await page.waitForTimeout(6500);
    const left = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices') || '[]').length);
    check(left === 0, `the delete is committed after the undo window (${left} left)`);
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
    const inv = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_invoices') || '[]')[0]);
    const item = inv?.items?.[0] ?? {};
    check(inv?.status === 'Draft' && item.quantity === 1.5 && item.unit === 'HRS' && item.hsn === '998311',
      `bill-from-time draft: ${inv?.status}, ${item.quantity} ${item.unit}, SAC ${item.hsn}`);
    const entries = await page.evaluate(() => JSON.parse(localStorage.getItem('mrchartist_inv_time_entries') || '[]'));
    check(entries.length === 1 && entries[0].invoiced_in === inv.id, `time entry linked to the invoice (${entries.length})`);
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
