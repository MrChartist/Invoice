/** R16-A3: the one HTML escape for print windows escapes all five characters, including `'`. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escHtml } from '../src/lib/html-esc.ts';

test('escapes & < > " and \' (attribute-safe with either quote)', () => {
  assert.equal(escHtml(`<b class="x" title='y'>Tom & Jerry</b>`), '&lt;b class=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/b&gt;');
  assert.equal(escHtml("O'Brien Traders"), 'O&#39;Brien Traders');
  assert.equal(escHtml('&amp;'), '&amp;amp;', 'escapes once, never decodes');
});

test('non-strings: numbers print, null / undefined print empty', () => {
  assert.equal(escHtml(1250.5), '1250.5');
  assert.equal(escHtml(0), '0');
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml('हिन्दी'), 'हिन्दी');
});

test('the copies that missed `\'` now use the shared escape (or escape it themselves)', () => {
  for (const f of [
    'src/components/prof/TdsChasePanel.tsx',
    'src/components/prof/PresumptiveView.tsx',
    'src/components/hotel/RoomPicker.tsx',
    'src/components/retail-r9/DeliveriesTab.tsx',
    'src/lib/mfg/mf-msme-recv.ts',
  ]) {
    const src = readFileSync(f, 'utf8');
    assert.ok(/from '[./]*(lib\/)?html-esc'/.test(src) || /\[&<>"'\]/.test(src), `${f} escapes '`);
    assert.doesNotMatch(src, /replace\(\/\[&<>"\]\/g/, `${f} still has an escape without '`);
  }
});
