/** PENDING 10 (AG-C4-4): the agri e-Way hint is shown in the invoice editor, from the editor's computed lines. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorEwayHint } from '../src/lib/agri/ag-packing.ts';

test('PENDING 10: editor lines → exempt-only note, taxable > ₹50,000 prompt, services left out', () => {
  const L = (id: string, taxable: number, tax_rate: number, hsn = '1006') => ({ id, hsn, taxable, tax_rate });
  assert.equal(editorEwayHint([L('a', 90000, 0), L('b', 40000, 0)], []).kind, 'exempt_note');
  assert.deepEqual(editorEwayHint([L('a', 60000, 5), L('b', 90000, 0)], []), { kind: 'prompt', taxable: 60000 });
  assert.equal(editorEwayHint([L('a', 40000, 5)], []).kind, 'none', 'at or below the threshold');
  assert.equal(editorEwayHint([L('a', 90000, 18, '998719')], []).kind, 'none', 'SAC 99… is a service');
  assert.equal(editorEwayHint([L('a', 90000, 18, '')], [{ id: 'a', type: 'Service' }]).kind, 'none', 'Service item');
  assert.equal(editorEwayHint([L('a', 90000, 0), L('s', 90000, 18, '9954')], []).kind, 'exempt_note', 'a service line does not hide the exempt note');
});

test('PENDING 10: the items footer mounts the lazy hint with an agri pack, never for quotes / pro formas', () => {
  const src = readFileSync(new URL('../src/components/creator/ItemsTable.tsx', import.meta.url), 'utf8');
  assert.match(src, /const AgEwayHint = lazy\(\(\) => import\('\.\.\/agri\/AgEwayHint'\)\)/);
  assert.match(src, /agriOn && docType !== 'QUOTATION' && docType !== 'PROFORMA' && <Suspense fallback=\{null\}><AgEwayHint lines=\{totals\.lines\} items=\{items\} \/>/);
  for (const p of ['agri', 'dairy', 'mill', 'coldstore', 'agri_inputs', 'fpo']) assert.ok(src.includes(`'${p}'`), p);
  const hint = readFileSync(new URL('../src/components/agri/AgEwayHint.tsx', import.meta.url), 'utf8');
  assert.match(hint, /editorEwayHint\(lines, items\)/);
  assert.doesNotMatch(hint, /useInvoiceStore/, 'props only: no store import in the lazy chunk');
  const area = readFileSync(new URL('../src/i18n/areas/agri-r12c.ts', import.meta.url), 'utf8');
  assert.equal((area.match(/ewExempt:/g) ?? []).length, 2, 'English and Hindi');
  assert.equal((area.match(/ewPrompt:/g) ?? []).length, 2);
});
