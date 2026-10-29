/**
 * R20-A2: the key registry's invariants (PRD §4 A2) and the cheat sheet's search / "This screen" helpers (A4).
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILT, KEY_ROWS, NEVER_CLAIM, SIMPLE_KEYS, comboFor, normCombo, rowById } from '../src/lib/keys/registry.ts';
import { rowMatches, sheetRows } from '../src/lib/keys/cheat.ts';
import { keysT } from '../src/i18n/areas/keys-r20a.ts';
import { isAssignableCombo } from '../src/lib/pos-keys.ts';

const LAYOUTS = ['prime', 'erp9'] as const;

test('row ids are unique and every row has a scope, a package and a twin', () => {
  assert.ok(KEY_ROWS.length >= 110, `${KEY_ROWS.length} rows (the whole round's map)`);
  assert.equal(new Set(KEY_ROWS.map((r) => r.id)).size, KEY_ROWS.length, 'duplicate row id');
  for (const r of KEY_ROWS) {
    assert.ok(r.twin && r.twin.length > 2, `${r.id}: every key has a visible twin (U1)`);
    assert.ok(['have', 'A', 'B', 'C', 'D'].includes(r.pkg), `${r.id}: package`);
    assert.ok(r.combo.prime, `${r.id}: a TallyPrime combo`);
  }
  for (const p of ['have', 'A'] as const) assert.ok(BUILT.has(p), `${p} is built`);
});

test('no combo appears twice in one scope and layout', () => {
  for (const layout of LAYOUTS) {
    const seen = new Map<string, string>();
    for (const r of KEY_ROWS) {
      const c = comboFor(r, layout);
      if (!c) continue;
      const k = `${r.scope}|${c}`;
      assert.ok(!seen.has(k), `${layout}: ${c} twice in ${r.scope} (${seen.get(k)}, ${r.id})`);
      seen.set(k, r.id);
    }
  }
});

test('no row claims a key the browser or the OS owns (NEVER_CLAIM)', () => {
  const never = new Set(NEVER_CLAIM.filter((n) => !n.apple).map((n) => normCombo(n.combo)));
  for (const r of KEY_ROWS) for (const l of LAYOUTS) assert.ok(!never.has(comboFor(r, l)), `${r.id} uses ${comboFor(r, l)}`);
  assert.equal(normCombo('Ctrl+Shift+F4'), 'mod+shift+f4');
  assert.ok(NEVER_CLAIM.some((n) => n.combo === 'mod+t' && n.say), 'Ctrl+T is listed with what to use instead');
  // POS reads the same list and keeps its own rules (8E).
  for (const k of ['Ctrl+F4', 'Alt+F4', 'Ctrl+W']) assert.ok(!isAssignableCombo(k), k);
  for (const k of ['F2', 'Shift+F8', 'Alt+Q', 'PageUp']) assert.ok(isAssignableCombo(k), k);
});

test('every row has English and Hindi labels (plain name and Tally name)', () => {
  for (const r of KEY_ROWS) {
    for (const k of [r.plain, r.tally]) {
      if (!k) continue;
      assert.ok(keysT.en[k], `${r.id}: English label ${k}`);
      assert.ok(keysT.hi[k] && /[ऀ-ॿ]|^[A-Za-z. 0-9]+$/.test(keysT.hi[k]), `${r.id}: Hindi label ${k}`);
    }
  }
  for (const n of NEVER_CLAIM) if (n.say) assert.ok(keysT.en[n.say] && keysT.hi[n.say], n.combo);
});

test('mode "always" rows use only the simple-mode keys (U7); the layouts differ only where Tally moved them', () => {
  for (const r of KEY_ROWS) if (r.mode === 'always') assert.ok(SIMPLE_KEYS.has(normCombo(r.combo.prime)), `${r.id}: ${r.combo.prime}`);
  const at = (id: string, l: (typeof LAYOUTS)[number]) => comboFor(rowById(id)!, l);
  assert.equal(at('creditNote', 'prime'), 'alt+f6');
  assert.equal(at('creditNote', 'erp9'), 'mod+f8');
  assert.equal(at('debitNote', 'prime'), 'alt+f5');
  assert.equal(at('debitNote', 'erp9'), 'mod+f9');
  assert.equal(at('salesOrder', 'prime'), 'mod+f8');
  assert.equal(at('salesOrder', 'erp9'), '', 'ERP 9: sales order only through F10');
  assert.equal(at('payroll', 'prime'), 'mod+shift+f4', 'Ctrl+F4 closes the tab');
  assert.equal(at('postDated', 'prime'), 'alt+t', 'Ctrl+T opens a tab');
  assert.equal(rowById('debitNote')!.on?.route, '/expenses?tab=returns&new=dn');
});

test('cheat sheet search: English, Hindi, Tally names and key text', () => {
  const ids = (q: string) => KEY_ROWS.filter((r) => rowMatches(r, q)).map((r) => r.id);
  assert.ok(ids('भुगतान').includes('payment'), 'Hindi finds Payment');
  assert.ok(ids('f5').includes('payment') && ids('f5').includes('debitNote'), 'a key finds its rows');
  assert.ok(!ids('f1').includes('features'), 'F1 does not match F11');
  assert.ok(ids('ctrl+f8').includes('salesOrder') && ids('ctrl + f8').includes('creditNote'), 'Ctrl+F8: sales order (Prime) and credit note (ERP 9)');
  assert.ok(ids('contra').includes('contra'), 'Tally name');
  assert.ok(ids('money paid').includes('payment'), 'plain name');
  assert.equal(ids('').length, KEY_ROWS.length);
});

test('"This screen": a report lists report keys; rows of unbuilt packages never show', () => {
  const tb = sheetRows('/books', []);
  assert.ok(tb.some((r) => r.id === 'detail') && tb.some((r) => r.id === 'options'), 'Alt+F1 and F12 on /books');
  assert.ok(!tb.some((r) => r.scope === 'editor'), 'no editor keys on a report');
  assert.ok(!sheetRows(null).some((r) => !BUILT.has(r.pkg)), 'unbuilt rows hidden');
  assert.ok(sheetRows('/', ['voucher']).some((r) => r.scope === 'voucher'), 'a registered scope joins the screen');
});
