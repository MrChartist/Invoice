import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DESIGN,
  GLOBAL_PROFILE_ID,
  applyPreset,
  contrastText,
  formatDatePref,
  formatNumberPref,
  pageSlices,
  paperSize,
  presets,
  printPageCss,
  resolveDesignFrom,
  sanitizeDesign,
  sanitizeHex,
  stampFor,
} from '../src/lib/design-prefs.ts';

test('sanitizeHex normalises and rejects', () => {
  assert.equal(sanitizeHex('#EE6125'), '#ee6125');
  assert.equal(sanitizeHex('#f60'), '#ff6600');
  assert.equal(sanitizeHex('red'), undefined);
  assert.equal(sanitizeHex('#12345'), undefined);
  assert.equal(sanitizeHex(42), undefined);
});

test('sanitizeDesign: garbage in, valid design out', () => {
  const d = sanitizeDesign({
    accent: 'url(javascript:alert(1))',
    font: 'comic-sans',
    logo_position: 'diagonal',
    paper: 'A3',
    density: 'huge',
    show_qr: 'yes',
    show_columns: { hsn: false, bogus: true },
    footer_text: 'x'.repeat(500),
  });
  assert.equal(d.accent, undefined);
  assert.equal(d.font, undefined);
  assert.equal(d.logo_position, 'auto');
  assert.equal(d.paper, 'A4');
  assert.equal(d.density, 'comfortable');
  assert.equal(d.show_qr, true);
  assert.equal(d.show_columns.hsn, false);
  assert.equal(d.show_columns.unit, true);
  assert.equal(d.footer_text.length, 200);
  assert.equal(sanitizeDesign(null).paper, 'A4');
  assert.equal(sanitizeDesign('nope').density, 'comfortable');
});

test('sanitizeDesign: keeps valid values, empty watermark means none', () => {
  const d = sanitizeDesign({ paper: 'thermal80', accent: '#ABC', watermark: '  ', font: 'mono', date_format: 'yyyy-MM-dd' });
  assert.equal(d.paper, 'thermal80');
  assert.equal(d.accent, '#aabbcc');
  assert.equal(d.watermark, 'none');
  assert.equal(d.font, 'mono');
  assert.equal(d.date_format, 'yyyy-MM-dd');
});

test('resolveDesignFrom: defaults <- global <- profile', () => {
  const rows = [
    { profile_id: GLOBAL_PROFILE_ID, paper: 'A5', accent: '#112233', show_qr: false },
    { profile_id: 'p1', accent: '#ee6125', density: 'compact' },
  ] as never[];
  const none = resolveDesignFrom([], 'p1');
  assert.equal(none.paper, 'A4');
  assert.equal(none.profile_id, 'p1');

  const p1 = resolveDesignFrom(rows, 'p1');
  assert.equal(p1.paper, 'A5'); // from global
  assert.equal(p1.show_qr, false); // from global
  assert.equal(p1.accent, '#ee6125'); // profile wins
  assert.equal(p1.density, 'compact');

  const p2 = resolveDesignFrom(rows, 'p2'); // no own row
  assert.equal(p2.accent, '#112233');
  assert.equal(p2.density, 'comfortable');
  assert.equal(resolveDesignFrom(rows, undefined).profile_id, GLOBAL_PROFILE_ID);
});

test('presets: every preset yields a valid design and keeps accent/font', () => {
  const base = { ...DEFAULT_DESIGN, profile_id: 'p9', accent: '#ee6125', font: 'outfit', footer_text: 'Thanks' };
  for (const p of presets) {
    const d = applyPreset(base, p.id);
    assert.equal(d.profile_id, 'p9');
    assert.equal(d.accent, '#ee6125');
    assert.equal(d.font, 'outfit');
    assert.equal(d.footer_text, 'Thanks');
    assert.deepEqual(sanitizeDesign(d), d);
  }
  assert.equal(applyPreset(base, 'receipt').paper, 'thermal80');
  assert.equal(applyPreset(base, 'compact').density, 'compact');
  assert.equal(applyPreset(base, 'minimal').show_columns.hsn, false);
  assert.equal(applyPreset(applyPreset(base, 'receipt'), 'classic').paper, 'A4');
  assert.equal(applyPreset(base, 'nonexistent'), base);
});

test('paperSize and pageSlices', () => {
  assert.deepEqual([paperSize().width, paperSize().height], [794, 1123]);
  assert.deepEqual([paperSize({ paper: 'A5' }).width, paperSize({ paper: 'A5' }).height], [559, 794]);
  assert.equal(paperSize({ paper: 'thermal80' }).width, 302);
  assert.equal(paperSize({ paper: 'thermal80' }).autoHeight, true);
  assert.equal(pageSlices(900).length, 1);
  assert.equal(pageSlices(1123).length, 1);
  assert.equal(pageSlices(1124).length, 2);
  assert.deepEqual(pageSlices(2300, { paper: 'A4' }).map((s) => s.top), [0, 1123, 2246]);
  assert.deepEqual(pageSlices(1500, { paper: 'thermal80' }), [{ top: 0, height: 1500 }]);
  assert.match(printPageCss({ paper: 'A5' }), /148mm 210mm/);
  assert.match(printPageCss({ paper: 'thermal80' }), /80mm auto/);
});

test('formatNumberPref: indian vs international grouping', () => {
  assert.equal(formatNumberPref(1234567.5, 'INR', 'indian'), '12,34,567.50');
  assert.equal(formatNumberPref(1234567.5, 'INR', 'international'), '1,234,567.50');
  assert.equal(formatNumberPref(NaN, 'INR', 'international'), '0.00');
});

test('formatDatePref', () => {
  assert.equal(formatDatePref('2026-04-05', 'dd MMM yyyy'), '5 Apr 2026');
  assert.equal(formatDatePref('2026-04-05', 'dd/MM/yyyy'), '05/04/2026');
  assert.equal(formatDatePref('2026-04-05', 'MM/dd/yyyy'), '04/05/2026');
  assert.equal(formatDatePref('2026-04-05', 'yyyy-MM-dd'), '2026-04-05');
  assert.equal(formatDatePref('2026-04-05', 'dd-MM-yyyy'), '05-04-2026');
  assert.equal(formatDatePref('', 'dd/MM/yyyy'), '');
  assert.equal(formatDatePref('garbage', 'dd/MM/yyyy'), '');
});

test('contrastText picks readable colour', () => {
  assert.equal(contrastText('#14100c'), '#ffffff');
  assert.equal(contrastText('#ee6125'), '#ffffff');
  assert.equal(contrastText('#fde047'), '#14100c');
  assert.equal(contrastText('nonsense'), '#ffffff');
});

test('stampFor', () => {
  assert.equal(stampFor('none', 'Paid', 'INVOICE'), null);
  assert.deepEqual(stampFor('auto-status', 'Paid', 'TAX_INVOICE'), { label: 'PAID', tone: 'paid' });
  assert.deepEqual(stampFor('auto-status', 'Overdue', 'INVOICE'), { label: 'OVERDUE', tone: 'overdue' });
  assert.deepEqual(stampFor('auto-status', 'Cancelled', 'INVOICE'), { label: 'CANCELLED', tone: 'cancelled' });
  assert.deepEqual(stampFor('auto-status', 'Draft', 'QUOTATION'), { label: 'DRAFT', tone: 'draft' });
  assert.equal(stampFor('auto-status', 'Paid', 'QUOTATION'), null);
  assert.equal(stampFor('auto-status', 'Sent', 'INVOICE'), null);
  assert.deepEqual(stampFor('Sample copy', 'Sent', 'INVOICE'), { label: 'SAMPLE COPY', tone: 'custom' });
});
