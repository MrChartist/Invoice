/**
 * PENDING 50 (8.7 / 8.27 / 8.151): drawer hand-over between shifts, non-INR khata balances, price-list tiles,
 * GS1 price check digit on scale labels, USB-HID / Bluetooth scale frames, statement web page from list rows.
 */
import './helpers/shim.ts';
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { pendingHandover, shiftReport, shiftsDb } from '../src/lib/pos-shifts.ts';
import { localDb } from '../src/lib/localDb.ts';
import { foreignBalances } from '../src/lib/khata.ts';
import { priceListItems } from '../src/lib/pos-tiles.ts';
import { cleanScaleProfile, makeScaleBarcode, parseScaleBarcode, priceCheckDigit } from '../src/lib/scale-barcode.ts';
import { parseBleWeight, parseHidScaleReport } from '../src/lib/scale-serial.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const DAY = '2026-05-10';

test('drawer hand-over: cash left at close is proposed to the next shift, which records what it found', () => {
  const a = shiftsDb.open(1000, DAY);
  const z = shiftReport(a, localDb.invoices.getAll(), localDb.payments.getAll());
  assert.throws(() => shiftsDb.close(a.id, z, 1000, 0, '', 1500), /more than the cash counted/);
  const closed = shiftsDb.close(a.id, z, 1000, 0, '', 800);
  assert.equal(closed.handover, 800);
  assert.equal(pendingHandover(shiftsDb.all())?.id, a.id);
  const b = shiftsDb.open(750, DAY);
  assert.deepEqual(b.took_over, { shift_id: a.id, amount: 800, difference: -50 });
  assert.equal(pendingHandover(shiftsDb.all()), undefined, 'taken over once');
});

const inv = (id: string, currency: string, total: number, client = { id: 'c1', name: 'Acme Inc' }): InvoiceRecord =>
  ({ id, invoice_number: id, doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-05-01', due_date: '2026-05-31', client, currency, items: [], subtotal: total, total, amount_paid: 0 }) as unknown as InvoiceRecord;

test('non-INR khata: balances per foreign currency by party, INR left to the main column', () => {
  const input = { invoices: [inv('a', 'USD', 1200), inv('b', 'USD', 300), inv('c', 'EUR', 50), inv('d', 'INR', 9000)], payments: [] };
  const f = foreignBalances(input, ['INR', 'USD', 'EUR'], new Date('2026-06-01T00:00:00'));
  assert.deepEqual(f.get('c1'), [{ currency: 'USD', net: 1500 }, { currency: 'EUR', net: 50 }]);
});

test('price-list tiles: only items with a list rate today, carrying that rate', () => {
  const items = [{ id: '1', name: 'Rice', rate: 50 }, { id: '2', name: 'Dal', rate: 90 }] as InvoiceItem[];
  const out = priceListItems(items, (i) => (i.name === 'Rice' ? 46 : undefined));
  assert.deepEqual(out.map((i) => [i.name, i.rate]), [['Rice', 46]]);
  assert.equal(items[0].rate, 50, 'source items are not changed');
});

test('scale labels: GS1 price check digit (4 and 5 digits) is checked when the profile asks for it', () => {
  assert.equal(priceCheckDigit('2875'), 9);
  assert.equal(priceCheckDigit('14685'), 6);
  const p = cleanScaleProfile({ enabled: true, prefixes: ['22'], pluLength: 4, value: 'price', decimals: 2, priceCheck: true });
  const code = makeScaleBarcode(p, '22', 123, 146.85);
  assert.equal(code.slice(6, 12), '614685');
  assert.deepEqual(parseScaleBarcode(code, p), { prefix: '22', plu: '0123', value: 146.85, kind: 'price' });
  const bad = code.slice(0, 6) + '5' + code.slice(7, 12);
  assert.equal(parseScaleBarcode(bad + String(eanCheck(bad)), p), null, 'wrong price check digit refused');
  assert.equal(cleanScaleProfile({}).priceCheck, undefined, 'off by default');
});

function eanCheck(first12: string): number {
  const s = [...first12].reduce((t, d, i) => t + Number(d) * (i % 2 ? 3 : 1), 0);
  return (10 - (s % 10)) % 10;
}

test('USB HID / Bluetooth scale frames', () => {
  assert.deepEqual(parseHidScaleReport([4, 2, 0, 0xd2, 0x04]), { weight: 1.234, stable: true }, 'grams, stable');
  assert.deepEqual(parseHidScaleReport([3, 3, 0xfd, 0xd2, 0x04]), { weight: 1.234, stable: false }, 'kg × 10^-3, in motion');
  assert.equal(parseHidScaleReport([6, 2, 0, 0, 0]), null, 'overweight');
  assert.deepEqual(parseBleWeight([0, 0xf6, 0x00]), { weight: 1.23, stable: true }, '246 × 0.005 kg');
  assert.equal(parseBleWeight([0, 0xff, 0xff]), null);
});

test('statement web page from list rows: Clients row links with web=1 and the viewer makes the page on open', () => {
  const clients = readFileSync('src/pages/Clients.tsx', 'utf8');
  assert.match(clients, /tab=statements&party=\$\{encodeURIComponent\(row\.key\)\}&web=1/);
  const rcv = readFileSync('src/pages/Receivables.tsx', 'utf8');
  assert.match(rcv, /autoWeb=\{params\.get\('web'\) === '1'\}/);
  const viewer = readFileSync('src/components/receivables/StatementViewer.tsx', 'utf8');
  assert.match(viewer, /\[data-statement-web\]/);
});
