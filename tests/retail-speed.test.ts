/**
 * 8E · Retail speed pack: weighing-scale labels + serial frames (8.140), counter entry — quantity prefix,
 * short codes, gross → rate (8.141), keymap overrides (8.141), cashier shifts (8.142), customer display
 * messages (8.143), Cheque / Wallet tenders (8.144), MRP-less pricing (8.145), WhatsApp bill (8.148) and
 * create-item-from-code (8.149).
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import {
  DEFAULT_SCALE, SCALE_PROFILE_KEY, cleanScaleProfile, findByPlu, loadScaleProfile, makeScaleBarcode, parsePrefixList,
  parseScaleBarcode, parseScaleFrame, saveScaleProfile, scaleLine, splitFrames, type ScaleProfile,
} from '../src/lib/scale-barcode.ts';
import {
  POS_KEYMAP_KEY, assignKey, cleanKeymap, effectiveKeys, isAssignableCombo, keymapConflicts, loadKeymap, looksLikeCode,
  parseCounterEntry, rateFromGross, saveKeymap, searchTermOf,
} from '../src/lib/pos-keys.ts';
import { findByShortCode } from '../src/lib/scan.ts';
import { shortCodeFirst } from '../src/components/creator/line-keys.ts';
import { autoHighlight, suggest } from '../src/lib/suggest.ts';
import { POS_SHORTCUTS, buildPosRecord, keyCombo, posShortcut, savePosBill, tenderSummary } from '../src/lib/pos.ts';
import { closeBlocker, nextShiftNumber, shiftReport, shiftsDb, shiftTotals } from '../src/lib/pos-shifts.ts';
import { billMessage, readDisplayMessage, thanksMessage, DISPLAY_MAX_LINES } from '../src/lib/pos-display.ts';
import { levelRate, mrpLessRate, resolvePrice } from '../src/lib/pricing.ts';
import { applyCatalogDraft, createItemFromCode, quickItemDraft, validateCatalogItem } from '../src/lib/catalog.ts';
import { posBillPhone, posBillText, posWhatsappHref } from '../src/lib/pos-share.ts';
import { parseHeld } from '../src/lib/pos-hold.ts';
import { localDb } from '../src/lib/localDb.ts';
import { DB_PREFIX } from '../src/lib/storage.ts';
import { buildBackup, parseBackup } from '../src/lib/backup.ts';
import { isSyncedKey } from '../src/lib/sync-engine.ts';
import { ean13CheckDigit } from '../src/lib/barcode.ts';
import type { InvoiceItem } from '../src/types/invoice.ts';

const DAY = '2026-05-10';
beforeEach(() => {
  resetStorage();
  installSettings();
  freezeDate(`${DAY}T10:00:00`);
});
afterEach(() => thawDate());

const item = (id: string, name: string, rate: number, extra: Partial<InvoiceItem> = {}): InvoiceItem => ({
  id, name, type: 'Product', hsn: '0701', unit: 'KG', quantity: 1, rate, tax_rate: 0, amount: 0, ...extra,
});

/* ── 8.140 weighing-scale labels ─────────────────────────────── */

const WEIGHT: ScaleProfile = { ...DEFAULT_SCALE, enabled: true, prefixes: ['21', '22'] };

test('scale: PPIIIIIVVVVVC weight label → PLU + kg; price label → ₹; check digit and prefix enforced', () => {
  const code = makeScaleBarcode(WEIGHT, '21', 123, 1.25);
  assert.equal(code.length, 13);
  assert.equal(code.slice(0, 12), '210012301250');
  assert.equal(Number(code[12]), ean13CheckDigit(code.slice(0, 12)));
  assert.deepEqual(parseScaleBarcode(code, WEIGHT), { prefix: '21', plu: '00123', value: 1.25, kind: 'weight' });
  // Off, other prefix, wrong check digit, not 13 digits → null.
  assert.equal(parseScaleBarcode(code, { ...WEIGHT, enabled: false }), null);
  assert.equal(parseScaleBarcode(code, { ...WEIGHT, prefixes: ['25'] }), null);
  const bad = code.slice(0, 12) + ((Number(code[12]) + 1) % 10);
  assert.equal(parseScaleBarcode(bad, WEIGHT), null);
  assert.ok(parseScaleBarcode(bad, { ...WEIGHT, checkDigit: false }), 'check digit can be ignored');
  assert.equal(parseScaleBarcode('8901030865275', WEIGHT), null);
  // Price label, 4-digit PLU → 6-digit value with 2 decimals.
  const price: ScaleProfile = { ...WEIGHT, value: 'price', decimals: 2, pluLength: 4 };
  const pc = makeScaleBarcode(price, '22', 42, 1234.5);
  assert.deepEqual(parseScaleBarcode(pc, price), { prefix: '22', plu: '0042', value: 1234.5, kind: 'price' });
});

test('scale: profile cleaning, prefix list, PLU lookup and persistence (device-local key)', () => {
  assert.deepEqual(parsePrefixList('21, 22 30 2x 29;21'), ['21', '22', '29']);
  const c = cleanScaleProfile({ enabled: true, prefixes: ['19', '23'], pluLength: 9, value: 'price', decimals: 7, baud: 123 });
  assert.deepEqual(c, { enabled: true, prefixes: ['23'], pluLength: 5, value: 'price', decimals: 2, checkDigit: true, baud: 9600 });
  assert.deepEqual(cleanScaleProfile(null), DEFAULT_SCALE);
  saveScaleProfile(WEIGHT);
  assert.ok(!SCALE_PROFILE_KEY.startsWith(DB_PREFIX), 'outside the company data prefix: never backed up / synced');
  assert.deepEqual(loadScaleProfile().prefixes, ['21', '22']);
  const items = [item('a', 'Tomato', 40, { plu: '123' }), item('b', 'Onion', 30, { plu: '0045' })];
  assert.equal(findByPlu(items, '00123')?.name, 'Tomato');
  assert.equal(findByPlu(items, '45')?.name, 'Onion');
  assert.equal(findByPlu(items, '99'), undefined);
});

test('scale: weight × rate, and a price label derives the quantity with the amount exact', () => {
  assert.deepEqual(scaleLine({ kind: 'weight', value: 1.25 }, 80), { quantity: 1.25, rate: 80, amount: 100 });
  const p = scaleLine({ kind: 'price', value: 100 }, 80);
  assert.equal(p.quantity, 1.25);
  assert.equal(p.amount, 100);
  // ₹100 of an item at ₹30/kg: 3.333 kg; the rate is nudged so the line is exactly ₹100.
  const q = scaleLine({ kind: 'price', value: 100 }, 30);
  assert.equal(q.quantity, 3.333);
  assert.equal(q.amount, 100);
  for (const [price, rate] of [[57.35, 120], [9.99, 333], [1234.5, 87.25]]) {
    assert.equal(scaleLine({ kind: 'price', value: price }, rate).amount, price, `${price} @ ${rate}`);
  }
});

test('scale: serial frames — stability flags, units, overload and stream splitting', () => {
  assert.deepEqual(parseScaleFrame('ST,GS,+  1.234kg'), { weight: 1.234, stable: true });
  assert.deepEqual(parseScaleFrame('US,GS,+  1.230kg'), { weight: 1.23, stable: false });
  assert.deepEqual(parseScaleFrame('S   0.500 kg'), { weight: 0.5, stable: true });
  assert.deepEqual(parseScaleFrame('U   0.480 kg'), { weight: 0.48, stable: false });
  assert.deepEqual(parseScaleFrame('  1250 g'), { weight: 1.25, stable: true });
  assert.deepEqual(parseScaleFrame('1.234KG ?'), { weight: 1.234, stable: false });
  assert.deepEqual(parseScaleFrame('+001.234'), { weight: 1.234, stable: true });
  assert.equal(parseScaleFrame('ST,OL'), null);
  assert.equal(parseScaleFrame(''), null);
  const s = splitFrames('\x02ST,GS,+1.000kg\r\nST,GS,+1.0');
  assert.deepEqual(s, { frames: ['ST,GS,+1.000kg'], rest: 'ST,GS,+1.0' });
  assert.deepEqual(splitFrames('A\x03B\nC').frames, ['A', 'B']);
});

/* ── 8.141 counter entry ─────────────────────────────────────── */

test('entry: quantity prefix with * or space, "3*" alone, gross "=500", plain search', () => {
  assert.deepEqual(parseCounterEntry('3*8901030865275'), { kind: 'item', term: '8901030865275', raw: '3*8901030865275', qty: 3 });
  assert.deepEqual(parseCounterEntry('2.5 × SB'), { kind: 'item', term: 'SB', raw: '2.5 × SB', qty: 2.5 });
  assert.deepEqual(parseCounterEntry('3 8901030865275'), { kind: 'item', term: '8901030865275', raw: '3 8901030865275', qty: 3, loose: true });
  assert.deepEqual(parseCounterEntry('3*'), { kind: 'item', term: '', raw: '3*', qty: 3 });
  assert.deepEqual(parseCounterEntry('=500'), { kind: 'gross', amount: 500 });
  assert.deepEqual(parseCounterEntry('= 99.5'), { kind: 'gross', amount: 99.5 });
  assert.deepEqual(parseCounterEntry('=0'), { kind: 'empty' });
  assert.deepEqual(parseCounterEntry('  '), { kind: 'empty' });
  assert.deepEqual(parseCounterEntry('soap bar'), { kind: 'item', term: 'soap bar', raw: 'soap bar' });
  // "2 litre milk" is not a prefix (more than one word after the number) → plain search.
  assert.deepEqual(parseCounterEntry('2 litre milk'), { kind: 'item', term: '2 litre milk', raw: '2 litre milk' });
  assert.equal(parseCounterEntry('0*SB').kind, 'item');
  assert.equal((parseCounterEntry('0*SB') as { qty?: number }).qty, undefined, 'zero is not a quantity');
  assert.equal(searchTermOf('3*soap'), 'soap');
  assert.equal(searchTermOf('3 soap'), '3 soap', 'a loose prefix searches the whole text');
  assert.equal(searchTermOf('=500'), '');
  assert.ok(looksLikeCode('8901030865275'));
  assert.ok(!looksLikeCode('soap'));
  assert.ok(!looksLikeCode('SB'));
});

test('entry: short codes match exactly (POS) and go first in the editor typeahead', () => {
  const rows = [item('a', 'Soap bar', 40, { short_code: 'SB' }), item('b', 'Shampoo bottle', 120, { short_code: '007' }), item('c', 'Sugar', 45)];
  assert.equal(findByShortCode('sb', rows)?.id, 'a');
  assert.equal(findByShortCode('7', rows)?.id, 'b', 'leading zeros ignored like barcodes');
  assert.equal(findByShortCode('S', rows), undefined);
  const list = shortCodeFirst('SB', rows, suggest('SB', rows, { label: (i) => i.name, extra: (i) => [i.short_code] }));
  assert.equal(list[0].row.id, 'a');
  assert.equal(list[0].exact, true);
  assert.equal(autoHighlight('SB', list), 0, 'Enter picks the exact short code');
  assert.equal(shortCodeFirst('zz', rows, []).length, 0);
});

test('entry: gross amount works the rate back (discount respected, 4 decimals when needed)', () => {
  assert.equal(rateFromGross(500, 2), 250);
  assert.equal(rateFromGross(100, 3), 33.3333);
  assert.equal(Math.round(3 * rateFromGross(100, 3) * 100) / 100, 100);
  assert.equal(rateFromGross(450, 1, 10), 500);
  assert.equal(rateFromGross(100, 0), 0);
});

test('catalogue: short code / PLU / MRP-less validated and saved; rate follows MRP less %', () => {
  const existing = [item('a', 'Soap bar', 40, { short_code: 'SB', plu: '12' })];
  assert.equal(validateCatalogItem({ name: 'Soap 2', type: 'Product', hsn: '', unit: 'NOS', rate: 1, tax_rate: 18, short_code: 'sb' }, existing)?.field, 'short_code');
  assert.equal(validateCatalogItem({ name: 'Soap 2', type: 'Product', hsn: '', unit: 'NOS', rate: 1, tax_rate: 18, short_code: 'a b' }, existing)?.field, 'short_code');
  assert.equal(validateCatalogItem({ name: 'Soap 2', type: 'Product', hsn: '', unit: 'NOS', rate: 1, tax_rate: 18, plu: '0012' }, existing)?.field, 'plu');
  assert.equal(validateCatalogItem({ name: 'Soap 2', type: 'Product', hsn: '', unit: 'NOS', rate: 1, tax_rate: 18, mrp_less_percent: 10 }, existing)?.field, 'mrp_less_percent');
  const { saved } = applyCatalogDraft([], { name: 'Biscuit', type: 'Product', hsn: '1905', unit: 'NOS', rate: 0, tax_rate: 18, mrp: 50, mrp_less_percent: 10, short_code: 'BIS', plu: '7', sold_by_weight: true }, () => 'x');
  assert.equal(saved.rate, 45);
  assert.equal(saved.mrp_less_percent, 10);
  assert.equal(saved.short_code, 'BIS');
  assert.equal(saved.plu, '7');
  assert.equal(saved.sold_by_weight, true);
  const { saved: cleared } = applyCatalogDraft([saved], { id: 'x', name: 'Biscuit', type: 'Product', hsn: '1905', unit: 'NOS', rate: 48, tax_rate: 18, mrp: 50, mrp_less_percent: 0, short_code: '', plu: '', sold_by_weight: false });
  assert.equal(cleared.rate, 48);
  assert.ok(!('mrp_less_percent' in cleared) && !('short_code' in cleared) && !('plu' in cleared) && !('sold_by_weight' in cleared));
});

/* ── 8.145 MRP less % ────────────────────────────────────────── */

test('pricing: MRP less % on items and on price levels', () => {
  assert.equal(mrpLessRate({ rate: 99, mrp: 100, mrp_less_percent: 12 }), 88);
  assert.equal(mrpLessRate({ rate: 99 }), 99);
  const it = { id: 'i', rate: 90, mrp: 100 };
  assert.equal(levelRate({ id: 'l', name: 'Retail', percent_off: 5, basis: 'mrp' }, it), 95);
  assert.equal(levelRate({ id: 'l', name: 'Retail', percent_off: 5 }, it), 85.5);
  assert.equal(levelRate({ id: 'l', name: 'Retail', percent_off: 5, basis: 'mrp' }, { id: 'j', rate: 90 }), 85.5, 'no MRP: off the rate');
  assert.equal(resolvePrice({ id: 'i', rate: 99, mrp: 100, mrp_less_percent: 10 }, 1).rate, 90);
});

/* ── 8.141 keymap ────────────────────────────────────────────── */

test('keys: combos, defaults unchanged, overrides, swaps, refusals and conflicts', () => {
  assert.equal(keyCombo({ key: 'F5', ctrlKey: true }), 'Ctrl+F5');
  assert.equal(keyCombo({ key: 'œ', code: 'KeyQ', altKey: true }), 'Alt+Q', 'macOS Option+Q');
  assert.equal(keyCombo({ key: 'Shift', shiftKey: true }), null);
  assert.equal(posShortcut({ key: 'F2' }), 'search');
  assert.equal(posShortcut({ key: 'F8', shiftKey: true }), 'hold');
  assert.equal(posShortcut({ key: 'F1', shiftKey: true }), 'help');
  assert.equal(posShortcut({ key: 'F5', ctrlKey: true }), 'daySummary');
  assert.equal(posShortcut({ key: 'PageUp' }), 'prevBill');
  assert.equal(posShortcut({ key: 'q', code: 'KeyQ', altKey: true }), 'lastQty');
  assert.equal(posShortcut({ key: 'F4', shiftKey: true }), 'account');
  assert.equal(posShortcut({ key: 'a' }), null);
  // Every default key is assignable and unique.
  assert.equal(new Set(POS_SHORTCUTS.map((s) => s.keys)).size, POS_SHORTCUTS.length);
  for (const s of POS_SHORTCUTS) assert.ok(isAssignableCombo(s.keys), s.keys);
  assert.equal(keymapConflicts().size, 0);
  // Refused: plain letters, Ctrl+letter, Alt+F4, bare F12, Enter.
  for (const k of ['A', 'Ctrl+S', 'Alt+F4', 'Ctrl+F4', 'F12', 'Enter', 'Meta+F2']) assert.ok(!isAssignableCombo(k), k);
  // Override: save on F12 with Shift; F9 then does nothing.
  const map = assignKey({}, 'save', 'Shift+F12');
  assert.equal(posShortcut({ key: 'F12', shiftKey: true }, map), 'save');
  assert.equal(posShortcut({ key: 'F9' }, map), null);
  // Taking a key in use swaps: cash gets F6, UPI gets F4.
  const swap = assignKey({}, 'cash', 'F6');
  assert.equal(effectiveKeys(swap).cash, 'F6');
  assert.equal(effectiveKeys(swap).upi, 'F4');
  assert.equal(keymapConflicts(swap).size, 0);
  assert.equal(keymapConflicts({ cash: 'F6' }).get('F6')?.length, 2);
  // Clean / store: unknown actions, bad combos and defaults dropped; device-local key.
  assert.deepEqual(cleanKeymap({ cash: 'F6', bogus: 'F11', upi: 'A', card: 'F7' }), { cash: 'F6' });
  saveKeymap(swap);
  assert.deepEqual(loadKeymap(), swap);
  assert.ok(!POS_KEYMAP_KEY.startsWith(DB_PREFIX));
  saveKeymap({});
  assert.equal(localStorage.getItem(POS_KEYMAP_KEY), null);
});

/* ── 8.144 tenders ───────────────────────────────────────────── */

test('tenders: cheque and wallet are non-cash; held carts keep them', () => {
  const t = tenderSummary(500, [{ method: 'Cash', amount: 100 }, { method: 'Cheque', amount: 300, reference: 'CHQ 1' }, { method: 'Wallet', amount: 100 }]);
  assert.deepEqual([t.change, t.due, t.nonCash], [0, 0, 400]);
  assert.deepEqual(t.payments.map((p) => p.method), ['Cash', 'Cheque', 'Wallet']);
  assert.equal(tenderSummary(100, [{ method: 'Wallet', amount: 150 }]).errors.length, 1, 'no change from a wallet');
  const held = parseHeld(JSON.stringify([{ id: 'h', items: [{ id: 'l', name: 'X' }], tender: { Cash: 1, UPI: 0, Card: 0, Cheque: 5 }, total: 6 }]));
  assert.deepEqual(held[0].tender, { Cash: 1, UPI: 0, Card: 0, Cheque: 5 });
});

/* ── 8.142 shifts ────────────────────────────────────────────── */

const bill = (rate: number, tenders: { method: 'Cash' | 'UPI' | 'Card'; amount: number }[]) => {
  const rec = buildPosRecord({
    items: [{ id: 'l1', name: 'Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate, tax_rate: 0, amount: rate }],
    party: {}, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: DAY,
  });
  const res = savePosBill({ record: rec, tenders });
  assert.ok(res.ok, res.errors.join('; '));
  return res.record!;
};

test('shifts: open with a float, bills counted per shift, X report, close blocked by held bills, Z frozen', () => {
  const s1 = shiftsDb.open(500, DAY);
  assert.equal(s1.number, 1);
  assert.throws(() => shiftsDb.open(0, DAY), /already have a shift open/);
  const b1 = bill(100, [{ method: 'Cash', amount: 100 }]);
  const b2 = bill(250, [{ method: 'UPI', amount: 250 }]);
  shiftsDb.addBill(s1.id, b1.id);
  shiftsDb.addBill(s1.id, b2.id);
  shiftsDb.addBill(s1.id, b2.id); // idempotent
  bill(999, [{ method: 'Cash', amount: 999 }]); // billed outside the shift
  const cur = shiftsDb.current()!;
  assert.deepEqual(cur.bill_ids, [b1.id, b2.id]);
  const x = shiftReport(cur, localDb.invoices.getAll(), localDb.payments.getAll());
  assert.deepEqual([x.bills, x.net, x.tenders.cash, x.tenders.upi], [2, 350, 100, 250]);
  assert.match(closeBlocker(2), /2 bills are on hold/);
  assert.equal(closeBlocker(0), '');
  assert.throws(() => shiftsDb.close(cur.id, x, 600, 1), /on hold/);
  const closed = shiftsDb.close(cur.id, x, 590, 0, 'short 10');
  assert.deepEqual([closed.expected_cash, closed.counted_cash, closed.difference], [600, 590, -10]);
  assert.deepEqual(closed.totals, shiftTotals(x));
  assert.equal(shiftsDb.current(), undefined);
  assert.throws(() => shiftsDb.close(cur.id, x, 590, 0), /already closed/);
  // Next shift of the day is number 2; the table is backed up and synced (company data).
  assert.equal(nextShiftNumber(shiftsDb.all(), DAY), 2);
  const data = parseBackup(JSON.stringify(buildBackup())).data!;
  assert.ok(data[DB_PREFIX + 'pos_shifts'], 'pos_shifts in a backup');
  assert.ok(isSyncedKey(DB_PREFIX + 'pos_shifts'));
});

/* ── 8.143 customer display ──────────────────────────────────── */

test('display: bill message (lines, total, UPI), thanks, and a validating reader', () => {
  const items = Array.from({ length: DISPLAY_MAX_LINES + 2 }, (_, n) => ({ id: `l${n}`, name: `Item ${n}`, type: 'Product', hsn: '', unit: 'PCS', quantity: 2, rate: 10, tax_rate: 0, amount: 20, discount_percent: n === 0 ? 50 : 0 }) as InvoiceItem);
  const m = billMessage({ items, total: 840, discount_amount: 0, sender: { companyName: 'Shop' } }, { link: 'upi://pay?pa=shop@upi&am=840.00', amount: 840 });
  assert.equal(m.type, 'bill');
  if (m.type !== 'bill') return;
  assert.equal(m.lines.length, DISPLAY_MAX_LINES);
  assert.equal(m.more, 2);
  assert.equal(m.count, DISPLAY_MAX_LINES + 2);
  assert.equal(m.upi?.amount, 840);
  assert.deepEqual(readDisplayMessage(JSON.parse(JSON.stringify(m))), m, 'round trip');
  assert.equal(billMessage({ items: [], total: 0 }, { link: null, amount: 10 }).type, 'bill');
  assert.ok(!('upi' in billMessage({ items: [], total: 0 }, { link: null, amount: 10 })));
  // The reader refuses junk and non-UPI links.
  assert.equal(readDisplayMessage({ v: 2, type: 'bill' }), null);
  assert.equal(readDisplayMessage('x'), null);
  const evil = readDisplayMessage({ v: 1, type: 'bill', lines: [{ name: 'A\u0000B', qty: 1, amount: 5 }], upi: { link: 'javascript:alert(1)', amount: 5 } });
  assert.ok(evil && evil.type === 'bill' && !evil.upi && evil.lines[0].name === 'A B');
  assert.deepEqual(readDisplayMessage(thanksMessage('Shop', 100, 20)), { v: 1, type: 'thanks', business: 'Shop', total: 100, change: 20 });
  assert.deepEqual(readDisplayMessage({ v: 1, type: 'hello' }), { v: 1, type: 'hello' });
});

/* ── 8.148 WhatsApp bill / 8.149 quick item ──────────────────── */

test('WhatsApp: phone from the bill or typed, summary text with a UPI link for a balance', () => {
  const rec = buildPosRecord({
    items: [{ id: 'l1', name: 'Soap', type: 'Product', hsn: '3401', unit: 'PCS', quantity: 1, rate: 100, tax_rate: 0, amount: 100 }],
    party: { phone: '98765 43210' }, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), day: DAY,
  });
  const saved = savePosBill({ record: rec, tenders: [{ method: 'Cash', amount: 100 }] }).record!;
  assert.equal(posBillPhone(saved), '919876543210');
  assert.equal(posBillPhone({ client: { ...saved.client, phone: '' } }, '+91 99999 00000'), '919999900000');
  assert.equal(posBillPhone({ client: { ...saved.client, phone: '' } }), null);
  const href = posWhatsappHref(saved)!;
  assert.match(href, /^https:\/\/wa\.me\/919876543210\?text=/);
  assert.match(decodeURIComponent(href), new RegExp(saved.invoice_number.replace(/\//g, '\\/')));
  assert.ok(!/Pay now/.test(posBillText(saved)), 'paid bill: no pay link');
});

test('quick item: an unknown code becomes the barcode (or a short code) and is saved with master.edit', () => {
  assert.equal(quickItemDraft('8901234567890', { name: 'X', rate: 10, tax_rate: 5 }).barcode, '8901234567890');
  assert.equal(quickItemDraft('SB', { name: 'X', rate: 10, tax_rate: 5 }).short_code, 'SB');
  const r = createItemFromCode('8901030865275', { name: 'New soap', rate: 35, tax_rate: 18, hsn: '3401', unit: 'PCS' });
  assert.ok(r.ok);
  const all = localDb.items.getAll();
  assert.equal(all.find((i) => i.barcode === '8901030865275')?.name, 'New soap');
  const dup = createItemFromCode('8901030865275', { name: 'Other', rate: 1, tax_rate: 0 });
  assert.ok(!dup.ok);
  assert.equal((dup as { error?: { field: string } }).error?.field, 'barcode');
});
