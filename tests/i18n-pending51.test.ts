/**
 * PENDING 51 (languages): the QA19 §2 English leftovers with Hindi on (ratio-analysis rows, "GSTR-1 filed" on the
 * practice desk, "Dine-in"), `src/lib` messages shown on the purchases / inventory / settings screens, and the GST
 * screens that were still English (GSTR-4 Tables 7–9, Table 14). On the baseline the area files and `lib-msg.ts` do
 * not exist and the screens print the library's English.
 */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resetI18nForTests, setLanguage } from '../src/i18n/index.ts';
import { ratioFormula, ratioLabel, ratioT } from '../src/i18n/areas/tally-ratios.ts';
import { checklistLabel } from '../src/i18n/areas/desks-checklist.ts';
import { rT } from '../src/i18n/areas/restaurant.ts';
import { HI_LIB, HI_LIB_BUILT } from '../src/i18n/hi-lib.ts';
import { errText, libMsg, loadLibHindi } from '../src/i18n/lib-msg.ts';
import { EMPTY_BOOKS } from '../src/lib/books.ts';
import { buildLedger, ratioAnalysis } from '../src/lib/ledger/index.ts';
import { BUILTIN_TEMPLATE } from '../src/lib/client-checklist.ts';
import { STARTER_AREA_NAME, starterMasters } from '../src/lib/restaurant/tables.ts';
import { validateVendor } from '../src/lib/vendors.ts';
import { checkGstin } from '../src/lib/gstin.ts';
import { validatePo } from '../src/lib/purchase-orders.ts';
import { validateTransferShape } from '../src/lib/godowns.ts';
import { validateLevel, validateScheme } from '../src/lib/pricing.ts';
import { validateCatalogItem } from '../src/lib/catalog.ts';
import { validateAltUnits, validateUnit } from '../src/lib/units.ts';
import { validateNode } from '../src/lib/stock-groups.ts';
import { pinStrength } from '../src/lib/auth.ts';
import { describeAge } from '../src/lib/auto-backup-schedule.ts';
import { lockPresets } from '../src/lib/lock-presets.ts';
import { assessStorage } from '../src/lib/storage-health.ts';
import { AccessDeniedError, deniedMessage } from '../src/lib/access.ts';
import { PeriodLockedError } from '../src/lib/period-lock.ts';

const ROOT = join(import.meta.dirname, '..');
const DEVANAGARI = /[ऀ-ॿ]/;
const hindi = async () => {
  resetI18nForTests();
  await setLanguage('hi', { persist: false });
  await loadLibHindi(); // the reset above drops registered loaders
};
afterEach(() => resetI18nForTests());

/** Asserts `en` (a library message) is matched and shown in Hindi; returns the Hindi. */
function inHindi(en: string): string {
  assert.ok(en, 'the library returned a message');
  const hi = libMsg(en);
  assert.ok(DEVANAGARI.test(hi) && hi !== en, `not translated: ${en} → ${hi}`);
  return hi;
}

test('QA19 §2: every ratio-analysis row label and formula resolves to Hindi', async () => {
  const ledger = buildLedger({ ...EMPTY_BOOKS, userAccounts: [], manual: [], assets: [], today: '2026-03-31' });
  const period = { start: '2025-04-01', end: '2026-03-31' };
  const plain = ratioAnalysis(ledger, period);
  const valued = ratioAnalysis(ledger, period, period.end, { mode: 'typed', label: 'weighted average', value: () => 0, openingIn: () => 0 } as never);
  const items = [...plain.groups, ...plain.ratios, ...valued.groups];
  // English: unchanged (the CSV and the screen agree).
  for (const x of items) {
    assert.equal(ratioLabel(x), x.label, x.id);
    assert.equal(ratioFormula(x), x.formula, x.id);
  }
  await hindi();
  for (const x of items) {
    assert.ok(DEVANAGARI.test(ratioLabel(x)), `label ${x.id}: ${ratioLabel(x)}`);
    assert.ok(DEVANAGARI.test(ratioFormula(x)), `formula ${x.id}: ${ratioFormula(x)}`);
  }
  assert.equal(ratioLabel({ id: 'currentRatio', label: 'Current ratio' }), 'चालू अनुपात');
  const days = plain.ratios.find((x) => x.id === 'receivableDays')!;
  assert.match(ratioFormula(days), new RegExp(`× ${plain.days} दिन`));
  assert.match(ratioFormula(valued.groups.find((x) => x.id === 'stock')!), /weighted average/);
  assert.equal(ratioT('days', { n: 45 }), '45 दिन');
  // A label the library changed (or a user ledger name) is shown as written, never a stale translation.
  assert.equal(ratioLabel({ id: 'cash', label: 'Cash' }), 'Cash');
});

test('QA19 §2: "GSTR-1 filed" and the other built-in checklist items show in Hindi; typed items stay as typed', async () => {
  assert.equal(checklistLabel('GSTR-1 filed'), 'GSTR-1 filed');
  await hindi();
  assert.equal(checklistLabel('GSTR-1 filed'), 'GSTR-1 भरा गया');
  for (const item of BUILTIN_TEMPLATE) assert.ok(DEVANAGARI.test(checklistLabel(item)), item);
  assert.equal(checklistLabel('Call the auditor'), 'Call the auditor');
});

test('QA19 §2: the starter "Dine-in" area is shown in Hindi on the Tables screen', async () => {
  assert.equal(starterMasters().areas[0].name, STARTER_AREA_NAME);
  assert.equal(STARTER_AREA_NAME, rT.en.chDine, 'the stored starter name is the English channel label');
  await hindi();
  assert.equal(rT('chDine'), rT.hi.chDine);
  assert.ok(DEVANAGARI.test(rT('chDine')));
  const tables = readFileSync(join(ROOT, 'src/pages/Tables.tsx'), 'utf8');
  assert.match(tables, /a\.name === STARTER_AREA_NAME \? rT\('chDine'\) : a\.name/);
  assert.match(readFileSync(join(ROOT, 'src/components/restaurant/TablesSettings.tsx'), 'utf8'), /STARTER_AREA_NAME \? rT\('chDine'\)/);
  assert.match(readFileSync(join(ROOT, 'src/components/books/tally/RatioTab.tsx'), 'utf8'), /ratioLabel\(x\)[\s\S]*ratioFormula\(x\)/);
  assert.match(readFileSync(join(ROOT, 'src/components/practice/ChecklistPanel.tsx'), 'utf8'), /checklistLabel\(i\.label\)/);
});

test('lib messages: English is returned untouched (no lookup)', () => {
  assert.equal(libMsg('Vendor name is required.'), 'Vendor name is required.');
  assert.equal(errText(new Error('Choose both godowns.')), 'Choose both godowns.');
  assert.equal(errText(new AccessDeniedError('master.edit', 'clerk')), deniedMessage('master.edit', 'clerk'));
});

test('lib messages: validation text from purchases / inventory / settings libraries shows in Hindi', async () => {
  await hindi();
  inHindi(validateVendor({ name: '', gstin: '', email: '' }));
  inHindi(validateVendor({ name: 'A', gstin: '', email: 'x@' }));
  for (const g of ['27AAAAA0000A1Z', '27AAAAA00000AZZ', '27AAAAA0000A1Z9']) inHindi(checkGstin(g).message!);
  inHindi(validatePo({ vendor_name: '', date: '2026-04-01', lines: [] }));
  inHindi(validatePo({ vendor_name: 'V', date: '2026-04-01', lines: [] }));
  inHindi(validateTransferShape({ date: '2026-04-01', from_godown: 'a', to_godown: 'a', lines: [] }));
  inHindi(validateLevel({ id: 'x', name: 'Retail', percent_off: 5 }, [{ id: 'y', name: 'retail', percent_off: 1 } as never]));
  const hi = libMsg(validateLevel({ id: 'x', name: 'Retail', percent_off: 5 }, [{ id: 'y', name: 'retail', percent_off: 1 } as never]));
  assert.equal(hi, '“Retail” नाम का लेवल पहले से है।', 'the placeholder value is carried over');
  inHindi(validateScheme({ item_id: '', item_name: '', buy_qty: 1, free_qty: 1, valid_from: '', valid_to: '' }));
  inHindi(validateCatalogItem({ name: 'Pen', rate: 1, hsn: '12', tax_rate: 18 } as never, [])!.message);
  inHindi(validateCatalogItem({ name: 'Pen', rate: 1, hsn: '', tax_rate: 18 } as never, [{ id: 'p', name: 'pen' }])!.message);
  inHindi(validateUnit({ id: '', symbol: '', first: '', second: '', factor: 0, decimals: 0 } as never, []));
  inHindi(validateUnit({ id: '', symbol: 'BOX', factor: 0, decimals: 0 } as never, [{ id: 'b', symbol: 'box' } as never]));
  inHindi(validateAltUnits([{ unit: 'BOX', factor: 0 }], 'PCS'));
  inHindi(validateAltUnits([{ unit: 'BOX', factor: 1 }], 'PCS'));
  for (const kind of ['group', 'category'] as const) {
    inHindi(validateNode({ id: '', name: '' }, [], kind));
    inHindi(validateNode({ id: '', name: 'Tea' }, [{ id: 't', name: 'tea' } as never], kind));
    inHindi(validateNode({ id: 't', name: 'Tea', parent_id: 'gone' }, [{ id: 't', name: 'Tea' } as never], kind));
  }
});

test('lib messages: PIN hints, backup ages, lock presets and storage-health findings show in Hindi', async () => {
  await hindi();
  for (const pin of ['1111', '1234', '1212']) inHindi(pinStrength(pin).warning!);
  const now = new Date('2026-06-10T12:00:00Z');
  for (const ago of [null, 10_000, 5 * 60_000, 3_600_000, 3 * 3_600_000, 86_400_000, 3 * 86_400_000]) {
    inHindi(describeAge(ago === null ? null : new Date(now.getTime() - ago).toISOString(), now));
  }
  assert.equal(libMsg(describeAge(new Date(now.getTime() - 3 * 86_400_000).toISOString(), now)), '3 दिन पहले');
  for (const p of lockPresets('2026-06-10')) {
    inHindi(p.label);
    inHindi(p.hint);
  }
  const base = { tables: [{ key: 'k', chars: 20 }], embeddedImageChars: 0, invoicesWithImages: 0, persisted: false, iosSafari: false, standalone: false, lastBackupIso: null, now };
  const cases = [
    { ...base, usedChars: 95, quotaChars: 100, invoicesWithImages: 1, embeddedImageChars: 20, unusedAttachments: 1, unusedAttachmentChars: 5 },
    { ...base, usedChars: 80, quotaChars: 100, invoicesWithImages: 3, embeddedImageChars: 20, unusedAttachments: 2, unusedAttachmentChars: 5, iosSafari: true },
    { ...base, usedChars: 1, quotaChars: 100, lastBackupIso: '2026-01-01T00:00:00Z' },
  ];
  let n = 0;
  for (const c of cases) {
    for (const f of assessStorage(c).findings) {
      inHindi(f.title);
      inHindi(f.detail);
      n++;
    }
  }
  assert.ok(n >= 8, `${n} findings checked`);
});

test('errText: access-denied and period-lock errors are rebuilt in Hindi; unknown text passes through', async () => {
  await hindi();
  const denied = errText(new AccessDeniedError('master.edit', 'clerk'));
  assert.ok(DEVANAGARI.test(denied) && !/Your role/.test(denied), denied);
  assert.match(denied, /ग्राहक, आइटम या विक्रेता बदलने/);
  const lock = errText(new PeriodLockedError({ lockUntil: '2026-03-31', docDate: '2026-03-10', docNumber: 'INV/FY25-26/0007', action: 'edit' }));
  assert.match(lock, /^बही-खाता 31 Mar 2026 तक लॉक है। INV\/FY25-26\/0007 की तारीख 10 Mar 2026 है, इसलिए इसे बदला नहीं जा सकता।/);
  assert.match(errText(new PeriodLockedError({ lockUntil: '2026-03-31', docDate: '2026-03-31', action: 'settings' })), /PIN डालें/);
  // A custom lock message (another module's wording) is not replaced by a different sentence.
  assert.equal(errText(new PeriodLockedError({ lockUntil: '2026-03-31', docDate: '2026-03-31', action: 'edit', message: 'Custom text.' })), 'Custom text.');
  assert.equal(errText(new Error('Choose both godowns.')), 'दोनों गोदाम चुनें।');
  assert.equal(errText(new Error('Something else entirely.')), 'Something else entirely.');
  assert.equal(errText('plain string'), 'plain string');
});

test('lib message templates still match their library source (drift guard)', () => {
  const libDir = join(ROOT, 'src/lib');
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  const source = walk(libDir).map((f) => readFileSync(f, 'utf8')).join('\n');
  // Composed with a plural / kind suffix in the library: checked by behaviour in the tests above.
  const composed = /stock (group|category)|^(Enter the|The parent|A) (group|category)|^\{n\} (min|hours|days) ago$|^1 (hour|day) ago$|logo\/signature image|^1 invoice carry|^\{n\} invoices carry|attached files? (is|are) no longer used/;
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const seen = new Set<string>();
  for (const [en, hi] of HI_LIB) {
    assert.ok(!seen.has(en), `hi-lib: "${en}" listed twice`);
    seen.add(en);
    assert.ok(DEVANAGARI.test(hi), `hi-lib: "${en}" has no Hindi`);
    assert.equal(ph(hi), ph(en), `hi-lib: "${en}" placeholders differ`);
    if (composed.test(en)) continue;
    for (const part of en.split(/\{\w+\}/)) {
      if (part.length < 3) continue;
      assert.ok(source.includes(part), `hi-lib: "${part}" is no longer in src/lib — update src/i18n/hi-lib.ts`);
    }
  }
  // Every access action the library names has its Hindi phrase (a new action falls back to English until added).
  const actions = [...readFileSync(join(ROOT, 'src/lib/access.ts'), 'utf8').matchAll(/^ {2}'([\w.]+)': '[a-z][^']*',$/gm)].map((m) => m[1]);
  assert.ok(actions.length >= 15);
  for (const a of actions) assert.ok(HI_LIB_BUILT[`dn.${a}`], `hi-lib: no Hindi for access action ${a}`);
});

test('hi-lib.ts is part of the Hindi pack, never an English chunk', async () => {
  const { langPackOf } = await import('../scripts/vite-hi-split.mjs');
  assert.equal(langPackOf(join(ROOT, 'src/i18n/hi-lib.ts')), 'hi');
  assert.equal(langPackOf(join(ROOT, 'src/i18n/lib-msg.ts')), null);
  assert.doesNotMatch(readFileSync(join(ROOT, 'src/i18n/lib-msg.ts'), 'utf8'), /^import .*hi-lib/m, 'loaded lazily, not statically');
});

test('screens that show lib errors pass them through errText (purchases, inventory, settings, security, companies)', () => {
  const dirs = ['purchases', 'inventory', 'settings', 'security', 'companies'].map((d) => join(ROOT, 'src/components', d));
  const files = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.tsx')).map((f) => join(d, f)));
  files.push(...['Expenses', 'Inventory', 'Settings'].map((p) => join(ROOT, `src/pages/${p}.tsx`)));
  // RightsEditor belongs to the per-voucher-type rights work (PENDING 52); CurrencyRatesPanel to EEFC (PENDING 46).
  const skip = /RightsEditor|CurrencyRatesPanel/;
  const raw = files.filter((f) => !skip.test(f) && /\((err|e) as Error\)\.message/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(raw.map((f) => f.slice(ROOT.length + 1)), [], 'show lib errors with errText(err)');
});

test('GSTR-4 Tables 7–9 and Table 14 screens are translated (no English JSX text left)', async () => {
  const { gstGapT } = await import('../src/i18n/areas/gst-gaps.ts');
  for (const f of ['Gstr4AnnualView', 'EcoView']) {
    const src = readFileSync(join(ROOT, `src/components/gst-reports/${f}.tsx`), 'utf8');
    assert.match(src, /gstGapT\(/, f);
    assert.doesNotMatch(src, />\s*(Table \d|Save entries|Download CSV|Head<|14\(a\) —|Documents marked)/, f);
    assert.doesNotMatch(src, /label: '[A-Z][a-z]+ [a-z]/, `${f}: column labels`);
  }
  await hindi();
  assert.ok(DEVANAGARI.test(gstGapT('t8')));
  assert.ok(DEVANAGARI.test(gstGapT('ecoHint')) && /अपने CA से जाँच/.test(gstGapT('ecoHint')), 'keeps "verify with your CA"');
});
